const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simPost, simRunning, payload, clockAt, freshDirs, listDir, fs, path } = H
;(async () => {
  const dirs = freshDirs('t0')
  const { app, p, proc } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '1' })
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await simRunning(app, true)
    await until(async () => ((await launcher(p, 'clipsState')).bufferSeconds || 0) >= 24, 60000, 'tampon', 500)
    const info = await test(app, 'info')
    console.log('anchor', new Date(info.anchor).toISOString(), 'now', new Date().toISOString())
    const now = Date.now()
    for (const f of info.list.slice(0, 16)) console.log(f.startS.toFixed(3), f.endS.toFixed(3), f.key, ((f.startWall - now) / 1000).toFixed(3), ((f.endWall - now) / 1000).toFixed(3), f.size)
    await test(app, 'saveNow'); const E = Date.now()
    const list = await until(async () => { const l = await launcher(p, 'clipsList'); return l.length ? l : null }, 30000, 'clip')
    console.log('écrit après', Date.now() - E, list[0].durationS)
    const info2 = await test(app, 'info')
    for (const f of info2.list.slice(-8)) console.log(f.startS.toFixed(3), f.endS.toFixed(3), f.key, ((f.startWall - E) / 1000).toFixed(3), ((f.endWall - E) / 1000).toFixed(3))
    const folder = (await launcher(p, 'clipsGetSettings')).folder
    const file = path.join(folder, listDir(folder)[0])
    for (const at of [0, 1, 5, 10, 20, list[0].durationS - 0.2]) console.log('m', at, 'horloge-E', (clockAt(file, at) - E) / 1000)
    console.log((await launcher(p, 'clipsLogTail')).split('\n').slice(-8).join('\n'))
  } catch (e) { console.log('ÉCHEC', e) } finally { await Promise.race([app.close(), sleep(8000)]); try { proc.kill('SIGKILL') } catch {} }
})()
