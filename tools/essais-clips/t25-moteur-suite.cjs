// Le moteur vidéo, aux endroits que t21 ne regarde pas : il note son rythme au journal ; un moteur qui a filmé plus d'une
// minute sans coupure remet le compte des coupures à zéro (sinon des coupures espacées finiraient par le faire abandonner) ;
// la vignette d'un clip, tirée par le moteur, est annoncée aux pages une fois prête ; la manière qui a marché est gardée
// dans la base pour passer en premier la fois suivante ; un moteur qui rate écrit ses
// lignes d'erreur au journal, sans le nom de l'utilisateur Windows ni les adresses en mémoire.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, freshDirs, fs, path, execFileSync } = H
const initSqlJs = require('sql.js')

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined && !ok ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
const note = (s) => console.log(`    ${s}`)
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360', PX_FFMPEG: '/usr/bin/ffmpeg', PX_FFMPEG_ENCODER: 'libx264', PX_ENGINE_SOURCE: 'x11' }
const ENGINE = 'écran (essai Linux), libx264, copie avant l’encodeur'
const FILMING = `Moteur : capture par ${ENGINE}.`
const count = (lines, what) => lines.filter((l) => (typeof what === 'string' ? l === what : what.test(l))).length

;(async () => {
  let s, dirs
  const L = (...a) => launcher(s.p, ...a)
  const journal = async () => { await L('clipsLogTail'); return fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^\S+ /, '')) }
  const mark = async () => (await journal()).length
  const since = async (m) => (await journal()).slice(m)
  const ready = () => until(() => s.app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
  const engines = () => {
    let out = ''
    try { out = execFileSync('ps', ['-o', 'pid=,args=', '--ppid', String(s.proc.pid)], { encoding: 'utf8' }) } catch { /* aucun enfant */ }
    return out.split('\n').map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter((m) => m && / -f x11grab /.test(m[2])).map((m) => ({ pid: +m[1], args: m[2] }))
  }
  const state = () => L('clipsState')
  try {
    dirs = freshDirs('t25')
    s = await start(dirs, ENV)
    await ready()
    await L('clipsSaveSettings', { capture: 'engine', quality: 'light', before: 5, after: 0, merge: 0 })
    const m = await mark()
    await simRunning(s.app, true)
    // Tue le moteur une fois qu'il filme (sa première image reçue), et attend qu'il refilme. Rend l'heure de son départ.
    let filmed = 0, last = 0
    const kill = async (what) => {
      await until(async () => count(await since(m), FILMING) > filmed, 30000, `moteur qui filme, ${what}`, 150)
      filmed++
      const e = await until(() => engines().find((x) => x.pid !== last), 5000, `processus du moteur, ${what}`, 50)
      process.kill(e.pid, 'SIGKILL')
      last = e.pid
    }

    // ===== 1. trois coupures, une minute de marche, puis cinq coupures : il ne doit pas abandonner
    for (let n = 1; n <= 3; n++) await kill(`coupure ${n}`)
    await until(async () => count(await since(m), FILMING) > filmed, 30000, 'moteur qui refilme après 3 coupures', 150)
    note('trois coupures ; une minute de marche…')
    await sleep(63000)

    // ===== 2. pendant cette minute, le journal note le rythme du moteur
    const rate = (await since(m)).filter((l) => /^Moteur : [\d.,]+ images\/s /.test(l))
    note(`relevés du rythme : ${rate.length}${rate.length ? ` (« ${rate[rate.length - 1]} »)` : ''}`)
    check('le journal note le rythme du moteur, environ toutes les 10 s la première minute', rate.length >= 4, rate)

    for (let n = 4; n <= 8; n++) await kill(`coupure ${n}`)
    await until(async () => count(await since(m), FILMING) > filmed, 30000, 'moteur qui refilme après 8 coupures', 150)
    const j1 = await since(m), st1 = await state()
    check('après une minute sans coupure, le compte repart de zéro : cinq coupures de plus ne le font pas abandonner', count(j1, /^Moteur arrêté \(code null\) après \d+ s\.$/) === 8 && !j1.some((l) => /^Moteur abandonné/.test(l)) && st1.encoder === `moteur : ${ENGINE}`, { arrets: count(j1, /^Moteur arrêté/), abandon: j1.filter((l) => /^Moteur abandonné/.test(l)), encoder: st1.encoder })

    // ===== 3. un clip filmé par le moteur : sa vignette, tirée du clip écrit, est annoncée aux pages une fois prête
    await s.p.evaluate(() => { window.__changed = []; window.launcher.onClipsChanged(() => window.__changed.push(Date.now())) })
    await sleep(6000)
    await test(s.app, 'saveNow')
    const clip = (await until(async () => { const l = await L('clipsList'); return l.length ? l : null }, 40000, 'un clip du moteur'))[0]
    const thumb = path.join(dirs.userData, 'clips-thumbs', `${clip.id}.jpg`)
    await until(() => fs.existsSync(thumb), 20000, 'la vignette du clip', 100)
    await sleep(2000)
    const drawn = fs.statSync(thumb).mtimeMs, changed = await s.p.evaluate(() => window.__changed)
    note(`vignette écrite à ${Math.round(drawn) % 100000} ; annonces aux pages : ${changed.map((x) => Math.round(x - drawn)).join(', ')} ms après elle`)
    check('la vignette d’un clip du moteur est annoncée aux pages une fois prête', changed.some((x) => x >= drawn - 5), changed.map((x) => Math.round(x - drawn)))
    await simRunning(s.app, false)
    await until(async () => (await state()).status === 'idle', 20000, 'fin de la partie', 300)
    await s.app.close()
    s = null

    // ===== 4. la manière qui a marché est gardée dans la base
    const SQL = await initSqlJs()
    const db = new SQL.Database(fs.readFileSync(path.join(dirs.userData, 'launcher.db')))
    let good = null
    try { const r = db.exec("SELECT value FROM kv WHERE key = 'clipsEngineGood'"); good = r.length ? r[0].values[0][0] : null } finally { db.close() }
    let goodValue = good
    try { goodValue = JSON.parse(good) } catch { /* texte brut */ }
    check('la manière qui a marché est gardée dans la base (libx264/copie)', goodValue === 'libx264/copie', good)

    // ===== 5. un moteur qui rate : ses lignes d'erreur au journal, sans nom d'utilisateur ni adresse en mémoire
    dirs = freshDirs('t25f')
    const fake = path.join(dirs.base, 'ffmpeg-qui-rate.sh')
    fs.writeFileSync(fake, [
      '#!/bin/sh',
      // printf et des guillemets simples : le echo de sh lirait « \e » comme un caractère de contrôle
      "printf '%s\\n' '[x11grab @ 000001d2c4a8b9c0] Cannot open display C:\\Users\\Bob\\Videos\\essai.mkv' >&2",
      "printf '%s\\n' 'Error opening input files: Input/output error' >&2",
      'exit 1', ''
    ].join('\n'))
    fs.chmodSync(fake, 0o755)
    s = await start(dirs, { ...ENV, PX_FFMPEG: fake })
    await ready()
    await L('clipsSaveSettings', { capture: 'engine', quality: 'light' })
    const m2 = await mark()
    await simRunning(s.app, true)
    await until(async () => (await since(m2)).some((l) => /^Moteur abandonné/.test(l)), 30000, 'le moteur abandonné', 200)
    const j2 = (await since(m2)).map((l) => l.trim())
    const i = j2.indexOf(`Moteur : « ${ENGINE} » raté (code 1).`)
    note(`journal après l’échec : ${JSON.stringify(j2.slice(Math.max(0, i), i + 4))}`)
    check('un moteur qui rate : ses lignes d’erreur suivent au journal', i >= 0 && j2[i + 1] === '[x11grab] Cannot open display C:\\Users\\…\\Videos\\essai.mkv' && j2[i + 2] === 'Error opening input files: Input/output error', j2.slice(Math.max(0, i), i + 4))
    check('… sans le nom de l’utilisateur ni l’adresse en mémoire', !j2.some((l) => /Bob|000001d2c4a8b9c0/.test(l)), j2.filter((l) => /Bob|000001d2/.test(l)))
    await simRunning(s.app, false)
    await until(async () => (await state()).status === 'idle', 20000, 'fin de la partie', 300)
    check('pas d’erreur dans la page', s.errs.length === 0, s.errs.slice(0, 3))
  } catch (e) { fail++; console.log('ECHEC', String(e.message || e).split('\n')[0]) } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    if (s) await s.app.close().catch(() => {})
    process.exit(fail ? 1 : 0)
  }
})()
