const H = require('./h.cjs')
const { avsync } = require('./avsync.cjs')
const { start, sleep, until, launcher, test, simRunning, probe, ffprobe, clockAt, freshDirs, listDir, path } = H
;(async () => {
  for (const [name, patch, args] of [['son + micro', { mic: true }, ['--use-fake-device-for-media-stream']], ['son du jeu', {}, []]]) {
    console.log('\n---', name)
    const dirs = freshDirs('t7')
    const { app, p, proc } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }, args)
    const L = (...a) => launcher(p, ...a)
    try {
      await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
      await L('clipsSaveSettings', { before: 5, after: 1, merge: 0, ...patch })
      await simRunning(app, true)
      await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 6, 40000, 'tampon', 300)
      for (let i = 0; i < 4; i++) {
        const n = (await L('clipsList')).length
        await test(app, 'saveNow'); const E = Date.now()
        const list = await until(async () => { const l = await L('clipsList'); return l.length > n ? l : null }, 30000, 'clip')
        const info = await test(app, 'info')
        const folder = (await L('clipsGetSettings')).folder
        const file = path.join(folder, listDir(folder).filter((x) => x.endsWith('.mp4')).sort().pop())
        const pr = probe(file)
        const d = list[0].durationS
        console.log(i, 'écrit après', Date.now() - E, 'ms', JSON.stringify(pr.streams.map((s) => [s.type, s.dur, s.packets])), 'horloge fin', (clockAt(file, d - 0.08, 640, 360) - E) / 1000, 'début', (clockAt(file, 0, 640, 360) - E) / 1000)
        console.log('  fragments', info.list.slice(-5).map((f) => [+((f.startWall - E) / 1000).toFixed(2), +((f.endWall - E) / 1000).toFixed(2)]))
        await sleep(1500)
      }
    } catch (e) { console.log('ÉCHEC', e) } finally { await Promise.race([app.close(), sleep(8000)]); try { proc.kill('SIGKILL') } catch {} }
  }
  process.exit(0)
})()
