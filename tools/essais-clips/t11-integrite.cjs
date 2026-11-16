// Toutes les images d'un clip : l'heure peinte dans chaque image suit-elle la date d'affichage du fichier, sans trou aux jonctions de fragments ?
const H = require('./h.cjs')
const { avsync } = require('./avsync.cjs')
const { start, sleep, until, launcher, test, simRunning, probe, ffprobe, decodeCheck, freshDirs, listDir, path, execFileSync } = H
function frameClocks(file, W, Hh) {
  const raw = execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 })
  const n = Math.floor(raw.length / (W * Hh)), cell = Math.floor(W / 40), out = []
  for (let f = 0; f < n; f++) {
    let v = 0
    for (let i = 0; i < 40; i++) if (raw[f * W * Hh + 16 * W + i * cell + (cell >> 1)] > 128) v += 2 ** i
    out.push(v * 10)
  }
  return out
}
;(async () => {
  for (const [name, mime] of [['H.264', ''], ['VP9 (format de secours)', 'video/mp4;codecs=vp9,opus']]) {
    console.log('\n---', name)
    const dirs = freshDirs('t11')
    const { app, p, proc } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360', ...(mime ? { PX_CLIP_TEST_MIME: mime } : {}) })
    const L = (...a) => launcher(p, ...a)
    try {
      await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
      await L('clipsSaveSettings', { before: 10, after: 2, merge: 0 })
      await simRunning(app, true)
      await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 12, 40000, 'tampon', 300)
      console.log(await L('clipsState'))
      const info0 = await test(app, 'info')
      console.log('durées des fragments (ms)', info0.spans, 'octets', info0.bytes)
      await test(app, 'saveNow')
      const list = await until(async () => { const l = await L('clipsList'); return l.length ? l : null }, 30000, 'clip')
      const c = list[0]
      const folder = (await L('clipsGetSettings')).folder
      const file = path.join(folder, listDir(folder)[0])
      const pr = probe(file)
      console.log(JSON.stringify(pr), 'décodage', decodeCheck(file))
      const pts = ffprobe(file, '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'json').packets.map((x) => +x.pts_time).sort((a, b) => a - b)
      const clocks = frameClocks(file, 640, 360)
      const n = Math.min(pts.length, clocks.length)
      let maxGap = 0, maxDev = 0, back = 0
      const devs = []
      for (let i = 0; i < n; i++) {
        const dev = (clocks[i] - clocks[0]) / 1000 - (pts[i] - pts[0])
        devs.push(dev); maxDev = Math.max(maxDev, Math.abs(dev))
        if (i) { maxGap = Math.max(maxGap, pts[i] - pts[i - 1]); if (clocks[i] < clocks[i - 1]) back++ }
      }
      console.log({ images: n, paquets: pts.length, plusLongTrouS: +maxGap.toFixed(3), écartMaxHorlogeS: +maxDev.toFixed(3), reculs: back })
      console.log('son/image', JSON.stringify(avsync(file)))
      const v = await p.evaluate(async (url) => {
        const v = document.createElement('video'); v.muted = true; v.src = url; document.body.appendChild(v)
        await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('erreur ' + (v.error && v.error.message))); setTimeout(() => rej(new Error('délai')), 10000) })
        const d = v.duration
        const seeks = []
        for (const f of [0.9, 0.1, 0.5]) { const t0 = performance.now(); await new Promise((res, rej) => { v.onseeked = res; v.onerror = () => rej(new Error('seek')); v.currentTime = d * f; setTimeout(() => rej(new Error('délai seek')), 10000) }); seeks.push([+v.currentTime.toFixed(2), Math.round(performance.now() - t0)]) }
        const seekable = v.seekable.length ? [v.seekable.start(0), v.seekable.end(0)] : []
        v.remove(); return { d, seekable, seeks, size: [v.videoWidth, v.videoHeight] }
      }, c.videoUrl)
      console.log('balise video', JSON.stringify(v))
    } catch (e) { console.log('ÉCHEC', e) } finally { await Promise.race([app.close(), sleep(8000)]); try { proc.kill('SIGKILL') } catch {} }
  }
  process.exit(0)
})()
