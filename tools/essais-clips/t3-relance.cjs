// Relances : arrêt forcé du MediaRecorder, piste terminée, changement de résolution, plus d'images ; tampon borné ; clip à cheval.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, probe, decodeCheck, clockAt, freshDirs, listDir, fs, path } = H
let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`) }
const near = (a, b, tol) => Math.abs(a - b) <= tol
;(async () => {
  const dirs = freshDirs('t3')
  const { app, p, errs, logs, proc } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' })
  const L = (...a) => launcher(p, ...a)
  const waitClips = (n, ms = 40000) => until(async () => { const l = await L('clipsList'); return l.length >= n ? l : null }, ms, `${n} clip(s)`)
  const running = () => test(app, 'info').then((i) => i.recorder)
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await L('clipsSaveSettings', { before: 8, after: 2, merge: 0 })
    await simRunning(app, true)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 8, 30000, 'tampon', 300)
    const rec1 = await running()
    const fragsBefore = (await test(app, 'info')).fragments

    // --- arrêt forcé
    const t0 = Date.now()
    await test(app, 'command', 'stop-recorder')
    await until(async () => (await L('clipsState')).status === 'error', 3000, 'état error')
    const st = await L('clipsState')
    check('arrêt forcé : l’état le dit', st.status === 'error' && /interrompue/.test(st.error || ''), st)
    const rec2 = await until(async () => { const r = await running(); return r && r !== rec1 ? r : null }, 10000, 'nouvel enregistreur')
    const relance = Date.now() - t0
    const info = await test(app, 'info')
    check('relance automatique avec délai', relance >= 800 && relance < 5000, { relance })
    check('fragments déjà là conservés', info.fragments >= fragsBefore && info.recorders === 2, { avant: fragsBefore, après: info.fragments, enregistreurs: info.recorders })
    await until(async () => { const s = await L('clipsState'); return s.status === 'recording' && !s.error && (s.bufferSeconds || 0) >= 2 }, 15000, 'reprise')
    // --- clip dont la fenêtre chevauche les deux enregistreurs : un seul enregistreur dans le fichier
    const E = Date.now()
    await test(app, 'saveNow')
    let list = await waitClips(1)
    const f1 = path.join((await L('clipsGetSettings')).folder, listDir((await L('clipsGetSettings')).folder).find((n) => n.endsWith('.mp4')))
    const c0 = (clockAt(f1, 0, 640, 360) - E) / 1000, cN = (clockAt(f1, list[0].durationS - 0.1, 640, 360) - E) / 1000
    check('clip après relance : décodable, sans mélange des enregistreurs', decodeCheck(f1).ok && probe(f1).streams.length === 2, { d: list[0].durationS, c0, cN })
    check('clip après relance : part du nouvel enregistreur seulement', c0 > -8.6 && near(cN, 2, 0.5), { c0, cN })

    // --- piste vidéo terminée (l'écran capturé disparaît)
    const rec3 = await running()
    await test(app, 'command', 'end-video')
    const rec4 = await until(async () => { const r = await running(); return r && r !== rec3 ? r : null }, 15000, 'relance après piste terminée')
    check('piste vidéo terminée : relance', !!rec4)
    await until(async () => { const s = await L('clipsState'); return s.status === 'recording' && !s.error && (s.bufferSeconds || 0) >= 4 }, 20000, 'reprise 2')

    // --- changement de résolution : relance rapide, fichier sans mélange de tailles
    await test(app, 'command', 'resize', { width: 800, height: 450 })
    const rec5 = await until(async () => { const r = await running(); return r && r !== rec4 ? r : null }, 8000, 'relance après résolution')
    check('changement de résolution : relance', !!rec5)
    await until(async () => { const s = await L('clipsState'); return s.status === 'recording' && !s.error && (s.bufferSeconds || 0) >= 5 }, 20000, 'reprise 3')
    const E2 = Date.now()
    await test(app, 'saveNow')
    list = await waitClips(2)
    const c2 = list[0]
    check('clip après changement de résolution : taille du nouvel enregistreur', c2.width === 640 && c2.height === 360, [c2.width, c2.height])
    const folder = (await L('clipsGetSettings')).folder
    const f2 = path.join(folder, listDir(folder).filter((n) => n.endsWith('.mp4')).sort().pop())
    check('clip après changement de résolution : décodable', decodeCheck(f2).ok, probe(f2).streams)
    // Un clip demandé sur l'ancien enregistreur : la dernière tranche (mauvaise taille) n'y est pas.

    // --- plus aucune image : la surveillance relance
    const rec6 = await running()
    await test(app, 'command', 'pause-video', true)
    const tStall = Date.now()
    const rec7 = await until(async () => { const r = await running(); return r && r !== rec6 ? r : null }, 30000, 'relance après plus d’images', 500)
    check('plus aucune image : relance', Date.now() - tStall < 30000, { apres: Date.now() - tStall })
    await until(async () => { const s = await L('clipsState'); return s.status === 'recording' && !s.error && (s.bufferSeconds || 0) >= 2 }, 20000, 'reprise 4')

    // --- tampon borné : before 5 + after 0 + marge 10 → 15 s
    await L('clipsSaveSettings', { before: 5, after: 0 })
    await sleep(26000)
    const b = await test(app, 'info')
    const onDisk = listDir(b.bufferRoot).reduce((n, d) => n + listDir(path.join(b.bufferRoot, d)).length, 0)
    const span = b.list.length ? (b.list[b.list.length - 1].endWall - b.list[0].startWall) / 1000 : 0
    check('tampon borné : les vieux fragments partent du disque', span <= 19 && onDisk === b.fragments && b.recorders <= 2, { span, onDisk, fragments: b.fragments, enregistreurs: b.recorders, octets: b.bytes, dossiers: listDir(b.bufferRoot).length })
    console.log((await L('clipsLogTail')).split('\n').slice(-24).join('\n'))
    check('pas d’erreur dans la page', errs.length === 0, errs)
  } catch (e) {
    fail++
    console.log('ÉCHEC', e)
    console.log(logs.join('').split('\n').filter((l) => /clips|Error/.test(l)).slice(-30).join('\n'))
  } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    await Promise.race([app.close(), sleep(12000)])
    console.log('sortie', proc.exitCode, proc.signalCode)
    try { proc.kill('SIGKILL') } catch {}
    process.exit(fail ? 1 : 0)
  }
})()
