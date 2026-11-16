// La fenêtre de capture et son enregistreur, aux endroits qu'aucun autre scénario ne regarde : la taille et le rythme voulus
// d'un clip filmé par Chrome ; une autre page de la même session qui demande le micro (refusé) ; la fenêtre fermée, puis sa
// page plantée, et l'enregistreur qui repart vite ; des pannes de suite (le délai de relance grandit) puis un enregistreur
// sain (le délai revient au plus court) ; la taille de l'image qui change (les fragments jetés quittent aussi le disque) ;
// enfin, moteur vidéo choisi, la page qui attend de savoir s'il filme avant de lancer son enregistreur.
// Micro factice (--use-fake-device-for-media-stream) : sans lui, une demande de micro échoue faute de micro, pas de droit.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, freshDirs, listDir, fs, path } = H

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined && !ok ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
const note = (s) => console.log(`    ${s}`)
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }
const ENGINE_ENV = { ...ENV, PX_FFMPEG: '/usr/bin/ffmpeg', PX_FFMPEG_ENCODER: 'libx264', PX_ENGINE_SOURCE: 'x11' }
const FAKE = ['--use-fake-device-for-media-stream']
const CAPTURE_TITLE = 'Player X · capture'

;(async () => {
  let s, dirs
  const L = (...a) => launcher(s.p, ...a)
  const info = () => test(s.app, 'info')
  const state = () => L('clipsState')
  const journal = async () => { await L('clipsLogTail'); return fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^\S+ /, '')) }
  const mark = async () => (await journal()).length
  const since = async (m) => (await journal()).slice(m)
  const ready = () => until(() => s.app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
  /** Le prochain enregistreur, autre que `old`, qui a commencé à remplir le tampon. Rend son id et le temps mis. */
  const nextRecorder = async (old, ms, what) => {
    const t0 = Date.now()
    const id = await until(async () => { const i = await info(); return i.recorder && i.recorder !== old && i.list.some((f) => f.recId === i.recorder) ? i.recorder : null }, ms, what, 100)
    return { id, ms: Date.now() - t0 }
  }
  const delays = (lines) => lines.map((l) => /^Capture interrompue \(.*\) : nouvel essai dans (\d+) s\.$/.exec(l)).filter(Boolean).map((m) => +m[1])
  try {
    dirs = freshDirs('t23')
    s = await start(dirs, ENV, FAKE)
    await ready()
    await L('clipsSaveSettings', { capture: 'chrome', quality: 'balanced', before: 4, after: 1, merge: 0 })
    await simRunning(s.app, true)
    await until(async () => { const st = await state(); return st.status === 'recording' && (st.bufferSeconds || 0) >= 5 ? st : null }, 40000, 'tampon', 300)

    // ===== 1. un clip filmé par Chrome : la source d'essai, au rythme de la qualité choisie
    await test(s.app, 'saveNow')
    const c1 = (await until(async () => { const l = await L('clipsList'); return l.length ? l : null }, 30000, 'un clip'))[0]
    check('un clip filmé par Chrome : la taille de la source d’essai (640 × 360), et 60 images/s voulues en qualité équilibrée', c1.width === 640 && c1.height === 360 && c1.pace && c1.pace.wanted === 60, { width: c1.width, height: c1.height, pace: c1.pace })

    // ===== 2. une autre page dans la session de la capture : le micro lui est refusé
    // Une page locale (file:, comme celle de la capture), mais pas la page de la capture.
    const page = path.join(dirs.base, 'autre-page.html')
    fs.writeFileSync(page, '<!doctype html><p>essai</p>')
    const foreign = await s.app.evaluate(async ({ BrowserWindow }, file) => {
      const w = new BrowserWindow({ show: false, webPreferences: { partition: 'px-clips-capture', sandbox: true, contextIsolation: true } })
      try {
        await w.loadFile(file)
        return await w.webContents.executeJavaScript("(navigator.mediaDevices ? navigator.mediaDevices.getUserMedia({ audio: true }).then((st) => { st.getTracks().forEach((t) => t.stop()); return 'accordé' }, (e) => e.name) : 'pas de mediaDevices')")
      } finally {
        w.destroy()
      }
    }, page)
    check('une autre page dans la session de la capture demande le micro : refusé', foreign === 'NotAllowedError', foreign)

    // ===== 3. la fenêtre de capture fermée, puis sa page plantée : un nouvel enregistreur repart vite
    let rec = (await info()).recorder
    await s.app.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === title)?.destroy(), CAPTURE_TITLE)
    const r1 = await nextRecorder(rec, 20000, 'un enregistreur après la fenêtre fermée')
    note(`fenêtre fermée : nouvel enregistreur en ${r1.ms} ms`)
    check('la fenêtre de capture fermée : un nouvel enregistreur filme en moins de 12 s (sans relance, il en faudrait plus de 15)', r1.ms < 12000, r1)
    let m = await mark()
    await s.app.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === title)?.webContents.forcefullyCrashRenderer(), CAPTURE_TITLE)
    const r2 = await nextRecorder(r1.id, 20000, 'un enregistreur après la page plantée')
    const j2 = await since(m)
    note(`page plantée : nouvel enregistreur en ${r2.ms} ms`)
    check('sa page plantée : le journal le dit, et un nouvel enregistreur filme en moins de 12 s', r2.ms < 12000 && j2.some((l) => /^Page de capture plantée : /.test(l)), { r2, j2 })

    // ===== 4. des pannes de suite : le délai de relance grandit ; un enregistreur sain : il revient au plus court
    m = await mark()
    rec = r2.id
    const held = []
    for (let n = 0; n < 2; n++) {
      const mn = await mark()
      await test(s.app, 'command', 'stop-recorder')
      // Pendant l'attente de la relance, plus rien ne filme : le raccourci est rendu, puis repris avec le nouvel enregistreur.
      await until(async () => (await since(mn)).some((l) => /^Capture interrompue /.test(l)), 10000, `la panne ${n + 1} au journal`, 100)
      const iw = await info()
      held.push({ pendant: iw.hotkeyRegistered, raccourci: iw.hotkey })
      rec = (await nextRecorder(rec, 30000, `un enregistreur après la panne ${n + 1}`)).id
      held[n].après = (await info()).hotkeyRegistered
    }
    check('pendant l’attente d’une relance, le raccourci est rendu ; il est repris avec le nouvel enregistreur', held.every((h) => h.pendant === false && h.raccourci === null && h.après === true), held)
    const d4 = delays(await since(m))
    note(`délais de relance, pannes de suite : ${d4.join(', ')} s`)
    check('des pannes de suite : chaque relance attend plus longtemps que la précédente', d4.length === 2 && d4[1] > d4[0], d4)
    // Sain : plus de 30 s de marche, puis une panne.
    // (le tampon ne garde que les dernières secondes : le temps se compte ici, depuis le départ de cet enregistreur)
    await sleep(32000)
    check('… l’enregistreur tourne toujours, 32 s après', (await info()).recorder === rec)
    m = await mark()
    await test(s.app, 'command', 'stop-recorder')
    rec = (await nextRecorder(rec, 30000, 'un enregistreur après la panne d’un sain')).id
    const d5 = delays(await since(m))
    check('… et après un enregistreur sain, la relance attend de nouveau le moins (1 s)', d5.length === 1 && d5[0] === 1, d5)

    // ===== 5. la taille de l'image change : les fragments jetés quittent aussi le disque
    await until(async () => ((await state()).bufferSeconds || 0) >= 3, 30000, 'tampon avant le changement de taille', 300)
    await test(s.app, 'command', 'resize', { width: 800, height: 450 })
    const r6 = await nextRecorder(rec, 15000, 'un enregistreur après le changement de taille')
    await sleep(1500)
    const i6 = await info()
    const kept = i6.list.filter((f) => f.recId === rec).length
    const onDisk = listDir(path.join(i6.bufferRoot, rec)).filter((n) => n.endsWith('.m4s')).length
    note(`taille changée : ${kept} fragments gardés de l'ancien enregistreur, ${onDisk} fichiers sur le disque`)
    check('la taille de l’image change : les fragments jetés quittent aussi le disque', r6.id && kept > 0 && onDisk === kept, { kept, onDisk })
    await simRunning(s.app, false)
    await until(async () => (await state()).status === 'idle', 20000, 'fin de la partie', 300)
    check('pas d’erreur dans la page', s.errs.length === 0, s.errs.slice(0, 3))
    await s.app.close()
    s = null

    // ===== 6. moteur vidéo choisi : la page attend de savoir s'il filme, puis lance un seul enregistreur, pour le son
    dirs = freshDirs('t23m')
    s = await start(dirs, ENGINE_ENV)
    await ready()
    await L('clipsSaveSettings', { capture: 'engine' })
    m = await mark()
    await simRunning(s.app, true)
    await until(async () => { const st = await state(); return st.status === 'recording' && /^moteur/.test(st.encoder || '') && (st.bufferSeconds || 0) >= 3 ? st : null }, 60000, 'tampon du moteur', 300)
    const asked = (await since(m)).filter((l) => /^Enregistreur \w+ demandé /.test(l))
    check('moteur vidéo choisi : la page lance un seul enregistreur, pour le son seulement', asked.length === 1 && asked[0].includes('(son seulement, image par le moteur'), asked)
    await simRunning(s.app, false)
    await until(async () => (await state()).status === 'idle', 20000, 'fin de la partie avec le moteur', 300)
  } catch (e) { fail++; console.log('ECHEC', String(e.message || e).split('\n')[0]) } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    if (s) await s.app.close().catch(() => {})
    process.exit(fail ? 1 : 0)
  }
})()
