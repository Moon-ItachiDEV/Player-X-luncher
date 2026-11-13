// Match complet du simulateur, fin du jeu avec un clip en attente, fermeture de l'appli, fenêtre fermée, plantage.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simPost, simRunning, payload, probe, decodeCheck, freshDirs, listDir, fs, path, execFileSync } = H
let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`) }
const exited = (proc, ms) => new Promise((res) => { if (proc.exitCode !== null || proc.signalCode) return res(true); const t = setTimeout(() => res(false), ms); proc.once('exit', () => { clearTimeout(t); res(true) }) })

async function matchAuto() {
  console.log('\n--- match complet du simulateur, jeu fermé alors que le clip attend encore')
  const dirs = freshDirs('t4a')
  const { app, p, logs, proc } = await start(dirs, { PX_CS2_SIM: 'auto', PX_CLIP_TEST_SOURCE: '640x360' })
  const L = (...a) => launcher(p, ...a)
  try {
    await until(async () => (await L('clipsState')).status === 'recording', 15000, 'capture lancée')
    const pendingSeen = await until(async () => (await test(app, 'info').then((i) => i.pendings[0])), 40000, 'clip en attente', 200)
    console.log('premier événement', pendingSeen.kind, pendingSeen.kills)
    await until(async () => (await L('clipsState')).status === 'idle', 70000, 'jeu fermé', 500)
    const list = await until(async () => { const l = await L('clipsList'); return l.length ? l : null }, 15000, 'clip écrit')
    console.log(list.map((c) => ({ t: c.title, k: c.kills, h: c.headshots, d: c.durationS, s: c.sizeBytes, map: c.map, r: c.round, score: c.score })))
    const c = list[0]
    check('match entier fusionné : 1 clip, 27 éliminations, 13 headshots, titre Quadruple', list.length === 1 && c.kills === 27 && c.headshots === 13 && c.title === 'Quadruple' && c.map === 'de_mirage' && c.mode === 'competitive')
    const folder = (await L('clipsGetSettings')).folder
    const file = path.join(folder, listDir(folder)[0])
    check('fichier complet et décodable, sans .part', listDir(folder).length === 1 && decodeCheck(file).ok && Math.abs(probe(file).duration - c.durationS) < 0.05, probe(file))
    await sleep(800)
    check('jeu fermé : fenêtre de capture fermée, tampon vidé, raccourci rendu', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1 && listDir(path.join(dirs.userData, 'clips-buffer')).length === 0 && !(await test(app, 'info')).hotkey)
  } catch (e) { fail++; console.log('ÉCHEC', e); console.log(logs.join('').split('\n').filter((l) => /clips/.test(l)).slice(-25).join('\n')) } finally {
    await Promise.race([app.close(), sleep(10000)]); console.log('sortie', proc.exitCode, proc.signalCode); try { proc.kill('SIGKILL') } catch {}
  }
}

async function quitPending() {
  console.log('\n--- l’appli quitte pendant qu’un clip attend')
  const dirs = freshDirs('t4b')
  const s1 = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' })
  try {
    await until(() => s1.app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await launcher(s1.p, 'clipsSaveSettings', { before: 6, after: 5 })
    await simRunning(s1.app, true)
    await until(async () => ((await launcher(s1.p, 'clipsState')).bufferSeconds || 0) >= 8, 30000, 'tampon', 300)
    await simPost(s1.app, payload({ round: 1, phase: 'freezetime' }))
    await simPost(s1.app, payload({ round: 1, phase: 'live' }))
    await simPost(s1.app, payload({ round: 1, kills: 1, rk: 1, rhs: 1 }))
    await sleep(300)
    check('clip en attente au moment de quitter', (await test(s1.app, 'info')).pendings.length === 1)
    const t0 = Date.now()
    s1.app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) }).catch(() => {})
    const gone = await exited(s1.proc, 12000)
    check('l’appli se ferme toute seule', gone && s1.proc.exitCode === 0, { ms: Date.now() - t0, code: s1.proc.exitCode, signal: s1.proc.signalCode })
    const folder = path.join(dirs.home, 'Videos', 'Player X V3 Test')
    const names = listDir(folder)
    check('le clip en attente est écrit, le tampon vidé, pas de .part', names.length === 1 && names[0].endsWith('.mp4') && listDir(path.join(dirs.userData, 'clips-buffer')).length === 0, names)
    if (names[0]) check('clip décodable', decodeCheck(path.join(folder, names[0])).ok, probe(path.join(folder, names[0])).duration)
    try { s1.proc.kill('SIGKILL') } catch {}
    // Au relancement : le clip est toujours dans la liste
    const s2 = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' })
    const list = await launcher(s2.p, 'clipsList')
    check('après relancement : le clip est dans la liste', list.length === 1 && list[0].title === 'Headshot', list.map((c) => c.title))
    await Promise.race([s2.app.close(), sleep(8000)]); try { s2.proc.kill('SIGKILL') } catch {}
  } catch (e) { fail++; console.log('ÉCHEC', e); console.log(s1.logs.join('').split('\n').filter((l) => /clips/.test(l)).slice(-25).join('\n')); try { s1.proc.kill('SIGKILL') } catch {} }
}

async function closeWindow() {
  console.log('\n--- la fenêtre principale fermée pour de bon pendant la capture')
  const dirs = freshDirs('t4c')
  const { app, p, proc, logs } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' })
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await launcher(p, 'clipsSaveSettings', { before: 5, after: 2 })
    await simRunning(app, true)
    await until(async () => ((await launcher(p, 'clipsState')).bufferSeconds || 0) >= 4, 30000, 'tampon', 300)
    await test(app, 'saveNow')
    const t0 = Date.now()
    app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows().find((w) => w.isVisible()).close(), 0) }).catch(() => {})
    const gone = await exited(proc, 12000)
    check('l’appli quitte malgré la fenêtre de capture', gone, { ms: Date.now() - t0, code: proc.exitCode, signal: proc.signalCode })
    const names = listDir(path.join(dirs.home, 'Videos', 'Player X V3 Test'))
    check('le clip demandé juste avant est écrit', names.length === 1, names)
    check('tampon vidé', listDir(path.join(dirs.userData, 'clips-buffer')).length === 0)
  } catch (e) { fail++; console.log('ÉCHEC', e); console.log(logs.join('').split('\n').filter((l) => /clips/.test(l)).slice(-25).join('\n')) } finally { try { proc.kill('SIGKILL') } catch {} }
}

async function crash() {
  console.log('\n--- plantage : le processus meurt pendant la capture, nettoyage au lancement suivant')
  const dirs = freshDirs('t4d')
  const s1 = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' })
  try {
    await until(() => s1.app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await simRunning(s1.app, true)
    await until(async () => ((await launcher(s1.p, 'clipsState')).bufferSeconds || 0) >= 4, 30000, 'tampon', 300)
    const root = path.join(dirs.userData, 'clips-buffer')
    const had = listDir(root).length
    const folder = path.join(dirs.home, 'Videos', 'Player X V3 Test')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'reste.mp4.part'), 'x')
    s1.proc.kill('SIGKILL')
    await exited(s1.proc, 5000)
    check('des fragments restent sur le disque après le plantage', had === 1 && listDir(root).length === 1)
    const s2 = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' })
    await sleep(1500)
    check('au lancement suivant : tampon et fichiers .part retirés', listDir(root).length === 0 && !fs.existsSync(path.join(folder, 'reste.mp4.part')))
    await Promise.race([s2.app.close(), sleep(8000)]); try { s2.proc.kill('SIGKILL') } catch {}
  } catch (e) { fail++; console.log('ÉCHEC', e); try { s1.proc.kill('SIGKILL') } catch {} }
}

async function games() {
  console.log('\n--- quels jeux ; Battlefield 6 : raccourci seulement ; raccourci réel')
  const dirs = freshDirs('t4e')
  const { app, p, proc, logs } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' })
  const L = (...a) => launcher(p, ...a)
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await L('clipsSaveSettings', { games: 'cs2bf6', before: 5, after: 1 })
    await test(app, 'setRunning', [{ id: 'steam:440', name: 'Team Fortress 2' }])
    await sleep(1200)
    check('cs2bf6 : un autre jeu ne lance pas la capture', (await L('clipsState')).status === 'idle')
    await L('clipsSaveSettings', { games: 'all' })
    await until(async () => (await L('clipsState')).game === 'Team Fortress 2', 6000, 'tout jeu')
    check('all : tout jeu lance la capture', true)
    await L('clipsSaveSettings', { games: 'cs2bf6' })
    await until(async () => (await L('clipsState')).status === 'idle', 8000, 'arrêt')
    check('retour à cs2bf6 : capture arrêtée', true)
    await test(app, 'setRunning', [{ id: 'ea:bf6', name: 'Battlefield™ 6' }])
    await until(async () => (await L('clipsState')).status === 'recording', 8000, 'bf6')
    check('Battlefield 6 lance la capture', (await L('clipsState')).game === 'Battlefield™ 6', await L('clipsState'))
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 4, 30000, 'tampon', 300)
    const info = await test(app, 'info')
    check('raccourci pris pendant que le tampon tourne', info.hotkey === 'Alt+C' && info.hotkeyRegistered === true, info.hotkey)
    console.log(execFileSync('python3', [path.join(__dirname, 'xkey.py'), 'Alt_L', 'c'], { encoding: 'utf8' }).trim())
    await sleep(300)
    const pend = (await test(app, 'info')).pendings
    check('Alt+C au clavier : clip manuel', pend.length === 1 && pend[0].kind === 'manual' && pend[0].gameId === 'ea:bf6', pend.map((x) => [x.kind, x.gameName]))
    const list = await until(async () => { const l = await L('clipsList'); return l.length ? l : null }, 20000, 'clip')
    check('clip Battlefield 6', list[0].gameName === 'Battlefield™ 6' && list[0].title === 'Clip manuel' && !list[0].map, list[0].gameName)
    const f = listDir((await L('clipsGetSettings')).folder)
    check('fichier nommé d’après le jeu', /^Battlefield™ 6 .* Clip manuel\.mp4$/.test(f[0]), f[0])
    await test(app, 'setRunning', [])
    await until(async () => (await L('clipsState')).status === 'idle', 8000, 'arrêt')
    await sleep(300)
    check('raccourci rendu quand le jeu se ferme', !(await test(app, 'info')).hotkey && !(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Alt+C'))))
  } catch (e) { fail++; console.log('ÉCHEC', e); console.log(logs.join('').split('\n').filter((l) => /clips/.test(l)).slice(-25).join('\n')) } finally {
    await Promise.race([app.close(), sleep(8000)]); try { proc.kill('SIGKILL') } catch {}
  }
}

;(async () => {
  const which = process.argv[2] || 'all'
  if (which === 'all' || which === 'match') await matchAuto()
  if (which === 'all' || which === 'quit') await quitPending()
  if (which === 'all' || which === 'close') await closeWindow()
  if (which === 'all' || which === 'crash') await crash()
  if (which === 'all' || which === 'games') await games()
  console.log(`\n${pass} OK, ${fail} NON`)
  process.exit(fail ? 1 : 0)
})()
