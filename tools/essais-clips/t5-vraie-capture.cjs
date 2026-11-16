// La vraie capture d'écran sous Xvfb : getDisplayMedia + desktopCapturer, réponse sans invite. Micro factice.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simPost, simRunning, payload, probe, ffprobe, decodeCheck, freshDirs, listDir, fs, path, execFileSync } = H
let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`) }
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true })

async function real(quality, want) {
  console.log(`\n--- vraie capture, qualité ${quality}`)
  const dirs = freshDirs('t5' + quality)
  const { app, p, logs, proc, errs } = await start(dirs, { PX_CS2_SIM: 'manual' })
  const L = (...a) => launcher(p, ...a)
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await L('clipsSaveSettings', { before: 6, after: 2, merge: 0, quality })
    await simRunning(app, true)
    await until(async () => { const s = await L('clipsState'); return s.encoder && s.audio ? s : null }, 15000, 'enregistreur')
    const st = await L('clipsState')
    check('capture démarrée sans aucune invite ; le son absent est dit', st.status === 'recording' && st.audio === 'none' && /vidéo seule/.test(st.error || ''), st)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 9, 60000, 'tampon', 500)
    const info = await test(app, 'info')
    console.log('fragments', info.fragments, 'octets', info.bytes, 'durées', info.spans)
    // Quelque chose bouge à l'écran : on change la page principale.
    await p.evaluate(() => { const d = document.createElement('div'); d.textContent = 'ESSAI CAPTURE'; d.style.cssText = 'position:fixed;left:200px;top:300px;font:bold 120px sans-serif;color:#0f0;background:#203;z-index:99999;padding:40px'; document.body.appendChild(d); let n = 0; setInterval(() => { d.style.left = 100 + (n++ * 7) % 800 + 'px' }, 40) })
    await sleep(1500)
    await test(app, 'saveNow')
    await sleep(300)
    const list = await until(async () => { const l = await L('clipsList'); return l.length ? l : null }, 30000, 'clip')
    const c = list[0]
    const folder = (await L('clipsGetSettings')).folder
    const file = path.join(folder, listDir(folder)[0])
    const pr = probe(file)
    console.log(JSON.stringify(pr))
    check(`clip à la bonne taille (${want.join('×')}), sans piste son`, c.width === want[0] && c.height === want[1] && pr.streams.length === 1 && pr.streams[0].w === want[0], [c.width, c.height])
    check('durée finie et décodage complet', pr.duration > 7 && decodeCheck(file).ok, pr.duration)
    const fr = ffprobe(file, '-select_streams', 'v', '-show_entries', 'stream=avg_frame_rate,r_frame_rate,nb_read_frames', '-count_frames').streams[0]
    console.log('images', fr)
    execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, c.durationS - 1)), '-i', file, '-frames:v', '1', path.join(OUT, `frame-${quality}.png`)])
    const thumb = path.join(dirs.userData, 'clips-thumbs', `${c.id}.jpg`)
    check('vignette', fs.existsSync(thumb), fs.existsSync(thumb) && fs.statSync(thumb).size)
    if (fs.existsSync(thumb)) fs.copyFileSync(thumb, path.join(OUT, `thumb-${quality}.jpg`))
    console.log((await L('clipsLogTail')).split('\n').slice(-9).join('\n'))
    await simRunning(app, false)
    await until(async () => (await L('clipsState')).status === 'idle', 10000, 'arrêt')
    check('pas d’erreur dans la page', errs.length === 0, errs)
  } catch (e) { fail++; console.log('ÉCHEC', e); console.log(logs.join('').split('\n').filter((l) => /clips|rror/.test(l)).slice(-25).join('\n')) } finally {
    await Promise.race([app.close(), sleep(8000)]); try { proc.kill('SIGKILL') } catch {}
  }
}

async function micTest() {
  console.log('\n--- micro factice (--use-fake-device-for-media-stream)')
  const dirs = freshDirs('t5m')
  const { app, p, logs, proc, errs } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }, ['--use-fake-device-for-media-stream'])
  const L = (...a) => launcher(p, ...a)
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await L('clipsSaveSettings', { before: 5, after: 1, mic: true })
    await simRunning(app, true)
    await until(async () => { const s = await L('clipsState'); return s.audio ? s : null }, 15000, 'enregistreur')
    let st = await L('clipsState')
    check('micro + son du jeu mélangés', st.audio === 'game+mic' && !st.error, st)
    const gum = await p.evaluate(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); return 'accordé' } catch (e) { return e.name } })
    check('la fenêtre principale n’a toujours pas le micro', gum === 'NotAllowedError', gum)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 6, 30000, 'tampon', 300)
    await test(app, 'saveNow')
    const list = await until(async () => { const l = await L('clipsList'); return l.length ? l : null }, 20000, 'clip')
    const file = path.join((await L('clipsGetSettings')).folder, listDir((await L('clipsGetSettings')).folder)[0])
    const pr = probe(file)
    check('clip avec une seule piste son, décodable', pr.streams.length === 2 && decodeCheck(file).ok, pr.streams)
    const vol = execFileSync('/usr/bin/ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    // Réglage du micro changé en cours : l'enregistreur repart tout de suite.
    const r1 = (await test(app, 'info')).recorder
    await L('clipsSaveSettings', { mic: false })
    const r2 = await until(async () => { const r = (await test(app, 'info')).recorder; return r && r !== r1 ? r : null }, 8000, 'relance réglage')
    await until(async () => (await L('clipsState')).audio === 'game', 8000, 'son du jeu seul')
    check('micro coupé en cours de partie : relance immédiate, son du jeu seul', true, r2)
    await L('clipsSaveSettings', { gameAudio: false })
    await until(async () => { const s = await L('clipsState'); return s.audio === 'none' && s.encoder ? s : null }, 8000, 'sans son')
    st = await L('clipsState')
    check('son du jeu coupé : vidéo seule, sans erreur', !st.error, st)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 2, 15000, 'tampon sans son', 300)
    const tracks = (await L('clipsList')).length
    await test(app, 'saveNow')
    await until(async () => (await L('clipsList')).length > tracks, 20000, 'clip sans son')
    const c2 = (await L('clipsList'))[0]
    const names = listDir((await L('clipsGetSettings')).folder).sort()
    const f2 = path.join((await L('clipsGetSettings')).folder, names[names.length - 1])
    check('clip sans son', probe(f2).streams.length === 1 && decodeCheck(f2).ok, probe(f2).streams)
    check('pas d’erreur dans la page', errs.length === 0, errs)
  } catch (e) { fail++; console.log('ÉCHEC', e); console.log(logs.join('').split('\n').filter((l) => /clips|rror/.test(l)).slice(-25).join('\n')) } finally {
    await Promise.race([app.close(), sleep(8000)]); try { proc.kill('SIGKILL') } catch {}
  }
}

;(async () => {
  const which = process.argv[2] || 'all'
  const W = +(process.argv[3] || 1920), Hh = +(process.argv[4] || 1080)
  if (which === 'all' || which === 'real') {
    await real('balanced', W > 1920 ? [1920, 1080] : [W, Hh])
    await real('high', [W, Hh])
  }
  if (which === 'light') await real('light', W > 1920 ? [1920, 1080] : [W, Hh])
  if (which === 'all' || which === 'mic') await micTest()
  console.log(`\n${pass} OK, ${fail} NON`)
  process.exit(fail ? 1 : 0)
})()
