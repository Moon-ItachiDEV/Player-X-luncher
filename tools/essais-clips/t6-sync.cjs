// Synchronisation son/image : du flux reçu (brut) au clip écrit ; avec et sans micro ; audio plus long que la vidéo ?
const H = require('./h.cjs')
const { avsync, videoFlashes, audioBeeps } = require('./avsync.cjs')
const { start, sleep, until, launcher, test, simRunning, probe, ffprobe, freshDirs, listDir, path } = H
;(async () => {
  for (const [name, patch, args] of [['son du jeu', {}, []], ['son + micro', { mic: true }, ['--use-fake-device-for-media-stream']]]) {
    console.log('\n---', name)
    const dirs = freshDirs('t6')
    const { app, p, proc } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }, args)
    const L = (...a) => launcher(p, ...a)
    try {
      await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
      await L('clipsSaveSettings', { before: 12, after: 3, merge: 0, ...patch })
      await simRunning(app, true)
      await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 14, 40000, 'tampon', 300)
      for (let i = 0; i < 2; i++) {
        const n = (await L('clipsList')).length
        await test(app, 'saveNow')
        await until(async () => (await L('clipsList')).length > n, 30000, 'clip')
        const folder = (await L('clipsGetSettings')).folder
        const file = path.join(folder, listDir(folder).filter((x) => x.endsWith('.mp4')).sort().pop())
        const pr = probe(file)
        console.log(i, JSON.stringify(pr.streams.map((s) => [s.type, s.dur, s.start])), 'total', pr.duration)
        console.log(JSON.stringify(avsync(file)))
        const pk = ffprobe(file, '-show_entries', 'packet=stream_index,pts_time', '-of', 'json').packets
        const last = (idx) => pk.filter((x) => x.stream_index === idx).slice(-1)[0].pts_time
        console.log('dernier paquet', pr.streams.map((s, idx) => [s.type, last(idx)]))
      }
      const st = await test(app, 'info')
      const c = st.list.slice(-3).map((f) => [f.startS.toFixed(2), f.endS.toFixed(2)])
      console.log('derniers fragments', c)
    } catch (e) { console.log('ÉCHEC', e) } finally { await Promise.race([app.close(), sleep(8000)]); try { proc.kill('SIGKILL') } catch {} }
  }
  process.exit(0)
})()
