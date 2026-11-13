const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, probe, ffprobe, clockAt, freshDirs, listDir, path } = H
;(async () => {
  for (const [name, patch, args] of [['son + micro', { mic: true }, ['--use-fake-device-for-media-stream']]]) {
    console.log('\n---', name)
    const dirs = freshDirs('t8')
    const { app, p, proc } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }, args)
    const L = (...a) => launcher(p, ...a)
    try {
      await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
      await L('clipsSaveSettings', { before: 5, after: 1, merge: 0, ...patch })
      await simRunning(app, true)
      await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 6, 40000, 'tampon', 300)
      for (let i = 0; i < 3; i++) {
        const n = (await L('clipsList')).length
        await test(app, 'saveNow'); const E = Date.now()
        const list = await until(async () => { const l = await L('clipsList'); return l.length > n ? l : null }, 30000, 'clip')
        const info = await test(app, 'info')
        const folder = (await L('clipsGetSettings')).folder
        const file = path.join(folder, listDir(folder).filter((x) => x.endsWith('.mp4')).sort().pop())
        const pr = probe(file)
        console.log(i, JSON.stringify(pr.streams.map((s) => [s.type, s.dur, s.packets])))
        console.log('  fragments', JSON.stringify(info.list.slice(-7).map((f) => [f.recId.slice(-4), +f.startS.toFixed(2), +f.endS.toFixed(2), f.key, f.counts, +((f.startWall - E) / 1000).toFixed(2)])))
        const pk = ffprobe(file, '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'json').packets.map((x) => +x.pts_time)
        const gaps = []; for (let j = 1; j < pk.length; j++) if (pk[j] - pk[j - 1] > 0.15) gaps.push([pk[j - 1], pk[j]])
        console.log('  trous vidéo', JSON.stringify(gaps), 'dernier', pk[pk.length - 1])
        await sleep(1500)
      }
      console.log((await L('clipsLogTail')).split('\n').slice(-22).join('\n'))
    } catch (e) { console.log('ÉCHEC', e) } finally { await Promise.race([app.close(), sleep(8000)]); try { proc.kill('SIGKILL') } catch {} }
  }
  process.exit(0)
})()
