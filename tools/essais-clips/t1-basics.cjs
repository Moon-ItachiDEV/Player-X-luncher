// Premier essai : source d'essai, un kill simulé, un clip complet, sa lecture, l'API.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simPost, simRunning, payload, probe, decodeCheck, clockAt, freshDirs, listDir, fs, path } = H

;(async () => {
  const dirs = freshDirs('t1')
  const { app, p, errs, logs, proc } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '1' })
  const report = {}
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'simulateur prêt')
    console.log('état au repos', await launcher(p, 'clipsState'))
    console.log('réglages', JSON.stringify(await launcher(p, 'clipsGetSettings')))
    console.log('écrans', await launcher(p, 'clipsDisplays'))
    console.log('saveNow sans jeu', await test(app, 'saveNow'))
    await simRunning(app, true)
    await until(async () => (await launcher(p, 'clipsState')).status === 'recording', 10000, 'capture lancée')
    const t0 = Date.now()
    await until(async () => ((await launcher(p, 'clipsState')).bufferSeconds || 0) >= 24, 60000, 'tampon de 24 s', 1000)
    console.log('tampon rempli en', Date.now() - t0, 'ms', await launcher(p, 'clipsState'))
    const info = await test(app, 'info')
    console.log('tampon', { fragments: info.fragments, bytes: info.bytes, spans: info.spans, key: info.keyFragments, hotkey: info.hotkey, reg: info.hotkeyRegistered })
    console.log('fichiers', listDir(info.bufferRoot), listDir(path.join(info.bufferRoot, info.recorder)).length)
    // Un match : temps d'achat, puis un headshot.
    await simPost(app, payload({ round: 3, phase: 'freezetime', kills: 4 }))
    await simPost(app, payload({ round: 3, phase: 'live', kills: 4 }))
    const killAt = Date.now()
    await simPost(app, payload({ round: 3, phase: 'live', kills: 5, rk: 1, rhs: 1 }))
    console.log('en attente', (await test(app, 'info')).pendings.map((x) => ({ kind: x.kind, kills: x.kills, hs: x.headshots, map: x.map, round: x.round, score: x.score })))
    const tClip = Date.now()
    const list = await until(async () => { const l = await launcher(p, 'clipsList'); return l.length ? l : null }, 30000, 'clip écrit')
    console.log('clip écrit', Date.now() - tClip, 'ms après le kill')
    const c = list[0]
    console.log(c)
    const folder = (await launcher(p, 'clipsGetSettings')).folder
    const names = listDir(folder)
    console.log('dossier', folder, names)
    const file = path.join(folder, names.find((n) => n.endsWith('.mp4')))
    console.log('ffprobe', JSON.stringify(probe(file)))
    console.log('décodage', decodeCheck(file))
    H.execFileSync('node', [path.join(__dirname, '../clipslab/dump.cjs'), file], { stdio: ['ignore', 'pipe', 'inherit'] }).toString().split('\n').filter((l) => /^\S/.test(l) || /elst|stsd/.test(l)).forEach((l) => console.log('  ', l.slice(0, 120)))
    // Horloge peinte dans l'image : la fenêtre est-elle la bonne ?
    const first = clockAt(file, 0), last = clockAt(file, c.durationS - 0.1)
    console.log('horloge', { début: (first - killAt) / 1000, fin: (last - killAt) / 1000, durée: c.durationS })
    report.window = { start: (first - killAt) / 1000, end: (last - killAt) / 1000 }
    // Vignette
    const thumb = path.join(dirs.userData, 'clips-thumbs', `${c.id}.jpg`)
    console.log('vignette', fs.existsSync(thumb), fs.existsSync(thumb) && fs.statSync(thumb).size)
    if (fs.existsSync(thumb)) console.log(H.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', thumb], { encoding: 'utf8' }).trim())
    // Lecture dans une balise video : durée, avance rapide, image affichée
    const seek = await p.evaluate(async (url) => {
      const v = document.createElement('video'); v.muted = true; v.src = url; document.body.appendChild(v)
      const out = { events: [] }
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video error ' + (v.error && v.error.message))); setTimeout(() => rej(new Error('metadata timeout')), 15000) })
      out.duration = v.duration; out.size = [v.videoWidth, v.videoHeight]; out.seekable = v.seekable.length ? [v.seekable.start(0), v.seekable.end(0)] : []
      const seekTo = (t) => new Promise((res, rej) => { const t0 = performance.now(); v.onseeked = () => res({ asked: t, at: v.currentTime, ms: Math.round(performance.now() - t0), ready: v.readyState }); v.onerror = () => rej(new Error('seek error')); v.currentTime = t; setTimeout(() => rej(new Error('seek timeout')), 15000) })
      out.seeks = []
      for (const t of [v.duration * 0.8, v.duration * 0.2, v.duration * 0.5, v.duration - 0.2]) out.seeks.push(await seekTo(t))
      await seekTo(1)
      let frames = 0; const onFrame = () => { frames++; v.requestVideoFrameCallback(onFrame) }; v.requestVideoFrameCallback(onFrame)
      await v.play(); await new Promise((r) => setTimeout(r, 2000)); out.playedTo = v.currentTime; out.framesShown = frames; v.pause()
      v.remove()
      return out
    }, c.videoUrl)
    console.log('video', JSON.stringify(seek))
    const img = await p.evaluate(async (url) => { const i = new Image(); i.src = url; await i.decode(); return [i.naturalWidth, i.naturalHeight] }, c.thumbUrl)
    console.log('img', img)
    // Range
    const range = await app.evaluate(async ({ session }, url) => {
      const out = {}
      const r1 = await session.defaultSession.fetch(url, { headers: { Range: 'bytes=0-99' } }); out.r1 = [r1.status, r1.headers.get('content-range'), r1.headers.get('content-length'), (await r1.arrayBuffer()).byteLength]
      const r2 = await session.defaultSession.fetch(url); out.r2 = [r2.status, r2.headers.get('accept-ranges'), r2.headers.get('content-length'), (await r2.arrayBuffer()).byteLength]
      const r3 = await session.defaultSession.fetch(url, { headers: { Range: 'bytes=999999999-' } }); out.r3 = [r3.status, r3.headers.get('content-range')]
      const r4 = await session.defaultSession.fetch(url, { headers: { Range: 'bytes=-100' } }); out.r4 = [r4.status, r4.headers.get('content-range'), (await r4.arrayBuffer()).byteLength]
      const r5 = await session.defaultSession.fetch('pxclip://video/0000000000000000'); out.unknown = r5.status
      const r6 = await session.defaultSession.fetch('pxclip://video/..%2F..%2Fetc%2Fpasswd'); out.traversal = r6.status
      const r7 = await session.defaultSession.fetch('pxclip://other/' + url.split('/').pop()); out.other = r7.status
      return out
    }, c.videoUrl)
    console.log('range', JSON.stringify(range), 'taille', c.sizeBytes)
    const pageFetch = await p.evaluate(async (url) => { try { const r = await fetch(url, { headers: { Range: 'bytes=0-9' } }); return [r.status, r.headers.get('content-range'), (await r.arrayBuffer()).byteLength] } catch (e) { return String(e) } }, c.videoUrl)
    console.log('fetch depuis la page', JSON.stringify(pageFetch))
    console.log('journal', (await launcher(p, 'clipsLogTail')).split('\n').slice(-12).join('\n'))
    // Fin du jeu
    await simRunning(app, false)
    await until(async () => (await launcher(p, 'clipsState')).status === 'idle', 10000, 'capture arrêtée')
    await sleep(800)
    console.log('après arrêt', await launcher(p, 'clipsState'), 'tampon:', listDir(path.join(dirs.userData, 'clips-buffer')), 'raccourci:', (await test(app, 'info')).hotkey)
    console.log('fenêtres', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    console.log('erreurs page', errs)
  } catch (e) {
    console.log('ÉCHEC', e)
    console.log(logs.join('').split('\n').filter((l) => /clips|Error|error/.test(l)).slice(-40).join('\n'))
    console.log('journal', await launcher(p, 'clipsLogTail').catch(() => ''))
    process.exitCode = 1
  } finally {
    const c = app.close()
    await Promise.race([c, sleep(10000)])
    console.log('sortie', proc.exitCode, proc.signalCode)
    try { proc.kill('SIGKILL') } catch {}
  }
})()
