// Le tampon, aux endroits qu'aucun autre scénario ne regarde : il ne garde que ce qui peut servir (avant + après + 10 s),
// et ce qu'il jette quitte aussi le disque ; un clip prolongé longtemps garde son début, même plus vieux que ça ; le dossier
// d'un ancien enregistreur part quand il n'a plus rien ; une écriture impossible arrête l'enregistreur, et un autre repart ;
// la partie finie, le tampon est vidé. Les pages voient le tampon grandir, et aucun fragment ne finit après l'heure qu'il est.
// Enfin, moteur vidéo choisi, le son en PCM ne garde lui aussi que ce qui peut servir.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, freshDirs, listDir, fs, path } = H

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined && !ok ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
const note = (s) => console.log(`    ${s}`)
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }
const ENGINE_ENV = { ...ENV, PX_FFMPEG: '/usr/bin/ffmpeg', PX_FFMPEG_ENCODER: 'libx264', PX_ENGINE_SOURCE: 'x11' }
// avant 5 s, après 0 s : le tampon garde 5 + 0 + 10 = 15 s. Marge : le plus vieux fragment gardé a commencé jusqu’à un fragment avant la limite, et l’élagage n’a lieu qu’à l’arrivée d’un fragment : 5 s.
const KEEP_S = 15, SLACK_S = 5

;(async () => {
  let s, dirs
  const L = (...a) => launcher(s.p, ...a)
  const info = () => test(s.app, 'info')
  const state = () => L('clipsState')
  const journal = async () => { await L('clipsLogTail'); return fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^\S+ /, '')) }
  const mark = async () => (await journal()).length
  const since = async (m) => (await journal()).slice(m)
  const ready = () => until(() => s.app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
  const nextRecorder = (old, ms, what) => until(async () => { const i = await info(); return i.recorder && i.recorder !== old && i.list.some((f) => f.recId === i.recorder) ? i.recorder : null }, ms, what, 100)
  const m4s = (root, rec) => listDir(path.join(root, rec)).filter((n) => n.endsWith('.m4s')).length
  try {
    dirs = freshDirs('t24')
    s = await start(dirs, ENV)
    await ready()
    await L('clipsSaveSettings', { capture: 'chrome', quality: 'light', before: 5, after: 0, merge: 0 })
    await simRunning(s.app, true)
    const rec0 = await nextRecorder(null, 40000, 'un enregistreur')

    // ===== 0. chaque fragment écrit est annoncé aux pages : elles voient le tampon grandir
    const seen = await s.p.evaluate(() => new Promise((done) => {
      const got = []
      const off = window.launcher.onClipsState((st) => got.push(st.bufferSeconds || 0))
      setTimeout(() => { off(); done(got) }, 5000)
    }))
    note(`état reçu par la page en 5 s : ${seen.length} fois, tampon ${seen.map((x) => x.toFixed(1)).join(', ')} s`)
    check('les pages voient le tampon grandir, sans rien demander', seen.length >= 2 && seen[seen.length - 1] > seen[0], seen)

    // ===== 1. le tampon ne garde que ce qui peut servir, et ce qu'il jette quitte le disque
    await sleep((KEEP_S + 8) * 1000)
    let i = await info()
    let tInfo = Date.now()
    const oldest = Math.min(...i.list.map((f) => f.startWall)), age = (Date.now() - oldest) / 1000
    note(`tampon après ${KEEP_S + 8} s : ${i.fragments} fragments, le plus vieux a ${age.toFixed(1)} s`)
    check(`le tampon garde ce qui peut servir (${KEEP_S} s), pas plus`, age >= KEEP_S - 1 && age <= KEEP_S + SLACK_S, { age })
    check('aucun fragment ne finit après l’heure qu’il est', i.list.every((f) => f.endWall <= tInfo), i.list.map((f) => f.endWall - tInfo).filter((d) => d > 0))
    const files = m4s(i.bufferRoot, rec0), kept = i.list.filter((f) => f.recId === rec0).length
    check('… et les fragments jetés quittent le disque (fichiers .m4s = fragments gardés)', kept > 0 && Math.abs(files - kept) <= 1, { files, kept })

    // ===== 2. un clip prolongé plus longtemps que le tampon garde son début
    await L('clipsSaveSettings', { merge: 3 })
    const t0 = Date.now()
    for (let n = 0; n < 11; n++) { await test(s.app, 'saveNow'); await sleep(2000) }
    await test(s.app, 'saveNow')
    const lastAt = Date.now()
    const clip = (await until(async () => { const l = await L('clipsList'); return l.length ? l : null }, 40000, 'le clip prolongé'))[0]
    const want = (lastAt - t0) / 1000 + 5
    note(`clip prolongé : ${clip.durationS.toFixed(1)} s pour ${want.toFixed(1)} s voulues`)
    check(`un clip prolongé ${((lastAt - t0) / 1000).toFixed(0)} s garde son début (5 s avant le premier appui)`, clip.durationS >= want - 1.5, { durationS: clip.durationS, want })
    await L('clipsSaveSettings', { merge: 0 })

    // ===== 3. le dossier d'un ancien enregistreur part quand il n'a plus rien
    let rec = (await info()).recorder
    await test(s.app, 'command', 'stop-recorder')
    const rec1 = await nextRecorder(rec, 30000, 'un enregistreur après l’arrêt')
    note(`ancien dossier tout de suite : ${listDir(i.bufferRoot).includes(rec) ? 'présent' : 'absent'}`)
    await sleep((KEEP_S + SLACK_S + 2) * 1000)
    i = await info()
    check('l’ancien enregistreur, vidé par le temps, quitte la liste et son dossier le disque', !listDir(i.bufferRoot).includes(rec) && i.recorders === 1 && !i.list.some((f) => f.recId === rec), { dirs: listDir(i.bufferRoot), recorders: i.recorders })

    // ===== 4. une écriture du tampon impossible : l'enregistreur s'arrête, un autre repart
    const m = await mark()
    const dir = path.join(i.bufferRoot, rec1)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.writeFileSync(dir, 'pas un dossier')
    const rec2 = await nextRecorder(rec1, 30000, 'un enregistreur après l’écriture impossible')
    const j4 = await since(m)
    check('une écriture du tampon impossible : le journal le dit, et l’enregistreur est remplacé', !!rec2 && j4.some((l) => /^Écriture du tampon impossible : /.test(l)) && j4.some((l) => /^Capture interrompue \(écriture du tampon impossible\)/.test(l)), j4.slice(0, 8))

    // ===== 5. la partie finie, le tampon est vidé
    await simRunning(s.app, false)
    await until(async () => (await state()).status === 'idle', 20000, 'fin de la partie', 300)
    i = await info()
    check('la partie finie : plus aucun fragment ni enregistreur, et le dossier du tampon est parti', i.fragments === 0 && i.recorders === 0 && !fs.existsSync(i.bufferRoot), { fragments: i.fragments, recorders: i.recorders, root: listDir(i.bufferRoot) })
    check('pas d’erreur dans la page', s.errs.length === 0, s.errs.slice(0, 3))
    await s.app.close()
    s = null

    // ===== 6. moteur vidéo choisi : le son en PCM ne garde lui aussi que ce qui peut servir
    dirs = freshDirs('t24m')
    s = await start(dirs, ENGINE_ENV)
    await ready()
    await L('clipsSaveSettings', { capture: 'engine', before: 5, after: 0, merge: 0 })
    await simRunning(s.app, true)
    await until(async () => { const st = await state(); return st.status === 'recording' && /^moteur/.test(st.encoder || '') && (st.bufferSeconds || 0) >= 3 ? st : null }, 60000, 'tampon du moteur', 300)
    const p0 = await until(async () => (await info()).pcmFrom, 20000, 'du son PCM')
    await sleep((KEEP_S + 8) * 1000)
    i = await info()
    tInfo = Date.now()
    check('moteur vidéo : aucun fragment ne finit après l’heure qu’il est', i.list.length > 0 && i.list.every((f) => f.endWall <= tInfo), i.list.map((f) => f.endWall - tInfo).filter((d) => d > 0))
    const pcmAge = i.pcmFrom === null ? null : (Date.now() - i.pcmFrom) / 1000
    note(`son PCM après ${KEEP_S + 8} s : le plus vieux morceau a ${pcmAge === null ? '—' : pcmAge.toFixed(1)} s (premier reçu à ${((Date.now() - p0) / 1000).toFixed(1)} s)`)
    check(`moteur vidéo : le son PCM garde ce qui peut servir (${KEEP_S} s), pas plus`, pcmAge !== null && pcmAge >= KEEP_S - 1 && pcmAge <= KEEP_S + SLACK_S, { pcmAge })
    await simRunning(s.app, false)
    await until(async () => (await state()).status === 'idle', 20000, 'fin de la partie avec le moteur', 300)
    i = await info()
    check('… la partie finie, plus de son PCM gardé', i.pcmFrom === null && i.recorders === 0, { pcmFrom: i.pcmFrom, recorders: i.recorders })
  } catch (e) { fail++; console.log('ECHEC', String(e.message || e).split('\n')[0]) } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    if (s) await s.app.close().catch(() => {})
    process.exit(fail ? 1 : 0)
  }
})()
