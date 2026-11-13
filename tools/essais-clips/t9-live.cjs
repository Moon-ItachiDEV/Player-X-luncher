// La vraie capture montre-t-elle bien l'écran en direct ? La fenêtre change de couleur chaque seconde, on relit le clip.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, probe, freshDirs, listDir, path, execFileSync, fs } = H
const OUT = path.join(__dirname, 'shots')
;(async () => {
  const dirs = freshDirs('t9')
  const { app, p, proc, logs } = await start(dirs, { PX_CS2_SIM: 'manual' })
  const L = (...a) => launcher(p, ...a)
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await L('clipsSaveSettings', { before: 6, after: 3, merge: 0, quality: 'light' })
    await p.evaluate(() => {
      const d = document.createElement('div')
      d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;font:bold 200px sans-serif;color:#fff'
      document.documentElement.appendChild(d)
      setInterval(() => { const s = Math.floor(Date.now() / 1000); d.style.background = ['#ff0000', '#00ff00', '#0000ff'][s % 3]; d.textContent = String(s % 1000) }, 100)
    })
    await p.waitForTimeout(500)
    await p.screenshot({ path: path.join(OUT, 'page.png') }).catch(() => {})
    await simRunning(app, true)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 9, 60000, 'tampon', 500)
    await test(app, 'saveNow')
    const list = await until(async () => { const l = await L('clipsList'); return l.length ? l : null }, 30000, 'clip')
    const c = list[0]
    const folder = (await L('clipsGetSettings')).folder
    const file = path.join(folder, listDir(folder)[0])
    console.log(JSON.stringify(probe(file)))
    const rows = []
    for (let t = 0.2; t < c.durationS - 0.2; t += 1) {
      const raw = execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'crop=200:200:900:300,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
      rows.push([+t.toFixed(1), [...raw]])
    }
    console.log(rows.map((r) => r.join(' ')).join('\n'))
    execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-i', file, '-frames:v', '1', path.join(OUT, 'frame-live.png')])
    const thumb = path.join(dirs.userData, 'clips-thumbs', `${c.id}.jpg`)
    fs.copyFileSync(thumb, path.join(OUT, 'thumb-live.jpg'))
    console.log(H.ffprobe(file, '-select_streams', 'v', '-show_entries', 'stream=avg_frame_rate,nb_read_frames', '-count_frames').streams[0])
    console.log((await L('clipsLogTail')).split('\n').slice(-8).join('\n'))
  } catch (e) { console.log('ÉCHEC', e); console.log(logs.join('').split('\n').filter((l) => /clips/.test(l)).slice(-20).join('\n')) } finally { await Promise.race([app.close(), sleep(8000)]); try { proc.kill('SIGKILL') } catch {} }
  process.exit(0)
})()
