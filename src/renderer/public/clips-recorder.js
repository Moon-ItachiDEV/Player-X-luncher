'use strict'
// Page cachée de capture des clips (services/clips.ts) : écran et son du système dans le même flux, encodés par MediaRecorder
// en MP4 fragmenté. Les morceaux partent au processus principal au fur et à mesure ; il garde les fragments dans le tampon.
;(() => {
  const api = window.pxRecorder

  // Du meilleur au moins bon. H.264 passe par l'encodeur matériel de Windows quand il existe ; AAC (mp4a) est lu partout,
  // Opus demande un lecteur récent. La première valeur que ce Chromium accepte et qui démarre vraiment est gardée.
  const MIMES = [
    'video/mp4;codecs=avc1.640034,mp4a.40.2',
    'video/mp4;codecs=avc1.640034,opus',
    'video/mp4;codecs=avc1.4D0034,mp4a.40.2',
    'video/mp4;codecs=avc1.4D0034,opus',
    'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01F,opus',
    'video/mp4;codecs=vp09.00.41.08,mp4a.40.2',
    'video/mp4;codecs=vp09.00.41.08,opus',
    'video/mp4;codecs=vp9,mp4a.40.2',
    'video/mp4;codecs=vp9,opus',
    'video/mp4'
  ]
  // Bêta 42 : quand le moteur vidéo filme l'image, cette page ne garde que le son (du PC et du micro), lu directement en PCM
  // et daté à l'heure du système (startPcm). Le processus principal le recolle à l'image de chaque clip.
  const PCM_RATE = 48000
  /** Taille d'un morceau : 4096 instants, environ 85 ms. */
  const PCM_BLOCK = 4096
  /** Datation : le plus petit écart arrivée − fin du morceau sur les 30 dernières secondes (suit la dérive des horloges). */
  const PCM_WINDOW_MS = 30000
  /** Le son s'est arrêté puis a repris (plus de 400 ms de retard durable, 2 s de suite) : la datation repart de là. */
  const PCM_GAP_MS = 400

  /** Une image clé toutes les 2 s : MediaRecorder livre un fragment à chacune. */
  const KEY_FRAME_MS = 2000
  /** Les fragments ne sortent qu'aux images clés ; ce délai ne sert qu'à ne rien retenir dans MediaRecorder. */
  const TIMESLICE_MS = 500
  const WATCH_MS = 500
  const THUMB_WIDTH = 640
  /** Le changement de taille se voit au plus tard à la vérification suivante. */
  const RESIZE_MARGIN_MS = WATCH_MS + 200

  /** Capture en cours. */
  let cur = null

  const errName = (e) => (e && (e.name || e.message) ? `${e.name || ''}${e.message ? ` : ${e.message}` : ''}` : String(e))
  const stopTracks = (stream) => stream && stream.getTracks().forEach((t) => t.stop())

  // ---------- sources ----------

  async function screenStream(cmd) {
    const q = cmd.quality
    // Son seulement : Chrome doit quand même ouvrir l'écran pour avoir le son du PC, mais en tout petit et à 1 image/s.
    const video = cmd.audioOnly ? { width: { max: 320 }, height: { max: 180 }, frameRate: { max: 1 } } : { frameRate: { ideal: q.fps, max: q.fps } }
    if (q.maxWidth && !cmd.audioOnly) {
      video.width = { max: q.maxWidth }
      video.height = { max: q.maxHeight }
    }
    if (!cmd.gameAudio) return { stream: await navigator.mediaDevices.getDisplayMedia({ video, audio: false }) }
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio })
      return stream.getAudioTracks().length ? { stream } : { stream, audioError: 'Son du système indisponible : vidéo seule.' }
    } catch (e) {
      api.log(`Son du système refusé (${errName(e)}), essai sans le son.`)
      return { stream: await navigator.mediaDevices.getDisplayMedia({ video, audio: false }), audioError: 'Son du système indisponible : vidéo seule.' }
    }
  }

  /** Développement seulement (PX_CLIP_TEST_SOURCE) : un canvas animé et un oscillateur à la place de l'écran et du son. */
  function testStream(cmd) {
    const c = document.createElement('canvas')
    c.width = cmd.test.width
    c.height = cmd.test.height
    document.body.appendChild(c)
    // Dessin sur le processeur : sans carte graphique, le rendu logiciel de la fenêtre principale retarderait ces images.
    const g = c.getContext('2d', { alpha: false, willReadFrequently: true })
    let frame = 0
    let paused = false
    let tick = 0
    let beepGain = null
    let ctx = null
    const draw = () => {
      if (paused) return
      frame++
      const W = c.width
      const H = c.height
      // Toutes les 2 s, un flash blanc et un bip au même instant : les essais mesurent l'écart entre le son et l'image.
      const now2s = Math.floor(Date.now() / 2000)
      const flash = now2s !== tick
      if (flash) {
        tick = now2s
        if (beepGain) {
          const at = ctx.currentTime
          beepGain.gain.setValueAtTime(0.6, at)
          beepGain.gain.setValueAtTime(0.02, at + 0.1)
        }
      }
      g.fillStyle = flash ? '#fff' : `hsl(${frame % 360} 60% 35%)`
      g.fillRect(0, 0, W, H)
      for (let i = 0; i < 30 && !flash; i++) {
        g.fillStyle = `rgb(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255})`
        g.fillRect(Math.random() * W, 40 + Math.random() * (H - 40), 24, 24)
      }
      g.fillStyle = '#fff'
      g.fillRect((frame * 8) % W, H / 2, 40, 40)
      // L'heure dans l'image, en cases noires et blanches (centièmes de seconde sur 40 bits) : relue par les essais.
      const cell = Math.floor(W / 40)
      const v = Math.floor(Date.now() / 10)
      for (let i = 0; i < 40; i++) {
        g.fillStyle = Math.floor(v / 2 ** i) % 2 ? '#fff' : '#000'
        g.fillRect(i * cell, 0, cell, 32)
      }
    }
    draw()
    const timer = setInterval(draw, 1000 / 30)
    const stream = c.captureStream(30)
    let ac = null
    if (cmd.gameAudio) {
      ac = new AudioContext({ sampleRate: 48000 })
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      gain.gain.value = 0.02
      beepGain = gain
      ctx = ac
      osc.frequency.value = 440
      const dst = ac.createMediaStreamDestination()
      osc.connect(gain).connect(dst)
      osc.start()
      void ac.resume()
      stream.addTrack(dst.stream.getAudioTracks()[0])
    }
    return {
      stream,
      close: () => {
        clearInterval(timer)
        c.remove()
        if (ac) void ac.close()
      },
      control: {
        pause: (on) => (paused = on),
        resize: (w, h) => {
          c.width = w
          c.height = h
        }
      }
    }
  }

  /** Vidéo + son du système + micro éventuel, sur une seule piste son. */
  async function acquire(cmd) {
    const closers = []
    let control = null
    let base
    let audioError
    if (cmd.test) {
      const t = testStream(cmd)
      base = t.stream
      closers.push(t.close)
      control = t.control
    } else {
      const s = await screenStream(cmd)
      base = s.stream
      audioError = s.audioError
    }
    closers.push(() => stopTracks(base))
    const videoTrack = base.getVideoTracks()[0]
    if (!videoTrack) throw new Error('aucune piste vidéo')
    // Bêta 36 : c'est du jeu, pas un écran de texte. Sans cette indication, Chrome traite une capture d'écran comme du
    // texte et garde la netteté en sacrifiant les images quand ça bouge (mesuré sur un clip : 33 images/s au lieu de 60,
    // 22 pendant l'action).
    try { videoTrack.contentHint = 'motion' } catch { /* navigateur qui ne connaît pas l'indication */ }
    const gameTrack = base.getAudioTracks()[0] || null
    let micTrack = null
    if (cmd.mic) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        micTrack = mic.getAudioTracks()[0] || null
        closers.push(() => stopTracks(mic))
      } catch (e) {
        api.log(`Micro indisponible : ${errName(e)}`)
        audioError = [audioError, 'Micro indisponible.'].filter(Boolean).join(' ')
      }
    }
    let audioTrack = gameTrack || micTrack
    if (gameTrack && micTrack) {
      const ac = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' })
      const dst = ac.createMediaStreamDestination()
      ac.createMediaStreamSource(new MediaStream([gameTrack])).connect(dst)
      ac.createMediaStreamSource(new MediaStream([micTrack])).connect(dst)
      void ac.resume()
      audioTrack = dst.stream.getAudioTracks()[0]
      closers.push(() => void ac.close())
    }
    if (cmd.audioOnly && !audioTrack) throw new Error('aucun son à enregistrer')
    const tracks = cmd.audioOnly ? [audioTrack] : audioTrack ? [videoTrack, audioTrack] : [videoTrack]
    let closed = false
    return {
      stream: new MediaStream(tracks),
      videoTrack,
      audioTrack,
      audio: gameTrack && micTrack ? 'game+mic' : gameTrack ? 'game' : micTrack ? 'mic' : 'none',
      audioError,
      control,
      close: () => {
        if (closed) return
        closed = true
        closers.reverse().forEach((f) => f())
      }
    }
  }

  // ---------- enregistrement ----------

  function teardown(s) {
    clearInterval(s.watch)
    s.watch = null
    stopPcm(s)
    try {
      if (s.source) s.source.close()
    } catch (e) {
      api.log(`Fermeture de la capture : ${errName(e)}`)
    }
    if (cur === s) cur = null
  }

  /**
   * Son seulement (bêta 42) : le son est lu tel quel, en PCM 16 bits stéréo à 48 kHz, et part au processus principal par
   * morceaux d'environ 85 ms, chacun daté à l'heure du système de son premier instant. La datation compte les instants reçus
   * (l'horloge du son est régulière) et se cale sur le plus petit écart entre l'arrivée d'un morceau et sa fin : un morceau
   * peut arriver en retard (page occupée), jamais en avance.
   */
  function startPcm(s) {
    let ac
    try {
      ac = new AudioContext({ sampleRate: PCM_RATE, latencyHint: 'playback' })
      const src = ac.createMediaStreamSource(new MediaStream([s.source.audioTrack]))
      const node = ac.createScriptProcessor(PCM_BLOCK, 2, 2)
      // Rien n'est joué : le nœud doit seulement être tiré par la sortie pour tourner.
      const mute = ac.createGain()
      mute.gain.value = 0
      src.connect(node)
      node.connect(mute)
      mute.connect(ac.destination)
      let hist = []
      let prevStart = null
      let lostMs = 0
      let lostLogged = Date.now()
      node.onaudioprocess = (e) => {
        if (s.closing || s.aborted) return
        const now = Date.now()
        const ib = e.inputBuffer
        const n = ib.length
        const l = ib.getChannelData(0)
        const r = ib.numberOfChannels > 1 ? ib.getChannelData(1) : l
        const out = new Int16Array(n * 2)
        for (let i = 0; i < n; i++) {
          const a = l[i] < -1 ? -1 : l[i] > 1 ? 1 : l[i]
          const b = r[i] < -1 ? -1 : r[i] > 1 ? 1 : r[i]
          out[2 * i] = a < 0 ? a * 0x8000 : a * 0x7fff
          out[2 * i + 1] = b < 0 ? b * 0x8000 : b * 0x7fff
        }
        // Bêta 43 : la place du morceau vient de l'horloge du contexte audio (playbackTime), pas du compte des morceaux
        // reçus. Chez Breezydev (bêta 42), des morceaux se perdaient quand la page était en retard : compter les morceaux
        // faisait glisser le son d'environ 400 ms toutes les 20 à 25 s. Un morceau perdu laisse maintenant un silence de
        // 85 ms à sa place, sans décaler la suite.
        const startMs = e.playbackTime * 1000
        const blockMs = (n * 1000) / PCM_RATE
        if (prevStart !== null && startMs - prevStart > blockMs * 1.5) lostMs += startMs - prevStart - blockMs
        prevStart = startMs
        if (now - lostLogged > 60000) {
          if (lostMs > 0) api.log(`Son : ${Math.round(lostMs)} ms perdus en 1 min (page en retard), silence à leur place.`)
          lostMs = 0
          lostLogged = now
        }
        // Écart entre l'arrivée du morceau et sa place dans l'horloge du contexte.
        const off = now - startMs
        hist.push([now, off])
        while (hist.length && hist[0][0] < now - PCM_WINDOW_MS) hist.shift()
        let min = Infinity
        let recent = Infinity
        for (const [t, o] of hist) {
          if (o < min) min = o
          if (t >= now - 2000 && o < recent) recent = o
        }
        // Un arrêt du son (contexte suspendu) : tout arrive durablement plus tard qu'avant.
        if (recent - min > PCM_GAP_MS && hist[0][0] < now - 2000) {
          api.log(`Son : reprise après un arrêt, datation recalée (${Math.round(recent - min)} ms).`)
          hist = hist.filter(([t]) => t >= now - 2000)
          min = recent
        }
        s.gotData = true
        api.pcm(s.cmd.recId, Math.round(min + startMs), new Uint8Array(out.buffer))
      }
      s.pcm = { ac, node, src, mute }
      void ac.resume()
    } catch (e) {
      try { if (ac) void ac.close() } catch { /* déjà fermé */ }
      api.log(`Son en PCM impossible : ${errName(e)}`)
      return false
    }
    api.started({ recId: s.cmd.recId, mime: 'son PCM 16 bits, 48 kHz, stéréo', wall: Date.now(), audio: s.source.audio, audioError: s.source.audioError })
    return true
  }

  function stopPcm(s) {
    const p = s.pcm
    if (!p) return
    s.pcm = null
    try {
      p.node.onaudioprocess = null
      p.src.disconnect()
      p.node.disconnect()
      p.mute.disconnect()
      void p.ac.close()
    } catch (e) {
      api.log(`Fermeture du son : ${errName(e)}`)
    }
  }

  function startRecording(s, from) {
    const q = s.cmd.quality
    const list = s.cmd.testMime ? [s.cmd.testMime] : MIMES
    for (let i = from; i < list.length; i++) {
      const mime = list[i]
      if (!MediaRecorder.isTypeSupported(mime)) continue
      let rec
      try {
        rec = new MediaRecorder(s.source.stream, {
          mimeType: mime,
          videoBitsPerSecond: q.videoBps,
          // Bêta 38 : débit constant. Sans lui, l'encodeur de Windows dépassait largement le débit demandé (mesuré : 75 à
          // 130 Mb/s pour 40 demandés en qualité haute). Un navigateur qui ne connaît pas l'option l'ignore.
          videoBitrateMode: 'constant',
          audioBitsPerSecond: q.audioBps,
          videoKeyFrameIntervalDuration: KEY_FRAME_MS
        })
      } catch (e) {
        api.log(`${mime} refusé : ${errName(e)}`)
        continue
      }
      s.rec = rec
      s.gotData = false
      s.reason = ''
      s.chain = Promise.resolve()
      rec.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return
        if (!s.gotData) {
          s.gotData = true
          // Après le démarrage, MediaRecorder donne le format réel (niveau H.264 choisi par l'encodeur).
          api.encoder(s.cmd.recId, rec.mimeType)
          // La taille de référence : celle des premières images encodées.
          s.settings = s.source.videoTrack.getSettings()
        }
        // Dans l'ordre, même si la lecture d'un morceau est plus longue que celle du suivant.
        s.chain = s.chain.then(async () => api.chunk(s.cmd.recId, new Uint8Array(await e.data.arrayBuffer()))).catch((err) => api.log(`Morceau perdu : ${errName(err)}`))
      }
      rec.onerror = (e) => {
        s.reason = s.reason || (e.error ? errName(e.error) : 'erreur de MediaRecorder')
      }
      rec.onstop = () =>
        void s.chain.then(() => {
          // L'encodeur a refusé de démarrer : format suivant, sans bruit.
          if (!s.closing && !s.aborted && !s.gotData && startRecording(s, i + 1)) return
          const info = { reason: s.closing ? 'demandé' : s.reason || 'MediaRecorder arrêté', ...(s.badSince ? { badSince: s.badSince, quick: true } : {}) }
          teardown(s)
          api.stopped(s.cmd.recId, info)
        })
      const wall = Date.now()
      try {
        rec.start(TIMESLICE_MS)
      } catch (e) {
        api.log(`${mime} n’a pas démarré : ${errName(e)}`)
        continue
      }
      api.started({ recId: s.cmd.recId, mime, mimeIndex: i, wall, audio: s.source.audio, audioError: s.source.audioError })
      if (!s.cmd.audioOnly) describeEncoder(q, s.source.videoTrack.getSettings())
      return true
    }
    return false
  }

  /** Pour le journal : ce PC a-t-il un encodeur H.264 matériel ? Sans lui, c'est le processeur qui encode (bien plus lourd en jeu). */
  function describeEncoder(q, st) {
    if (typeof VideoEncoder === 'undefined') return
    const width = st.width || 1920
    const height = st.height || 1080
    VideoEncoder.isConfigSupported({ codec: 'avc1.640034', width, height, bitrate: q.videoBps, framerate: q.fps, hardwareAcceleration: 'prefer-hardware' })
      .then((r) => api.log(`Encodeur H.264 matériel pour ${width}×${height} à ${q.fps} i/s : ${r.supported ? 'oui' : 'non'}.`))
      .catch((e) => api.log(`Encodeur matériel : ${errName(e)}`))
  }

  /**
   * Pour le journal : les images de la capture, par seconde. « reçues » : ce que l'écran a donné ; « transmises » : ce qui
   * est parti vers l'encodeur ; « perdues » : jetées en route (capture trop lente à suivre). Toutes les 10 s la première
   * minute, puis toutes les minutes. MediaStreamTrack.stats n'existe pas partout : rien n'est écrit sans lui.
   */
  function frameStats(s) {
    const t = s.source.videoTrack
    let st
    try { st = t.stats } catch { return }
    if (!st || typeof st.totalFrames !== 'number') return
    const now = performance.now()
    const prev = s.fstat
    s.fstat = { at: now, total: st.totalFrames, delivered: st.deliveredFrames, discarded: st.discardedFrames, first: prev ? prev.first : now, logged: prev ? prev.logged : now }
    if (!prev) return
    const since = now - s.fstat.logged
    if (since < (now - s.fstat.first < 61000 ? 10000 : 60000)) { s.fstat.total = prev.total; s.fstat.delivered = prev.delivered; s.fstat.discarded = prev.discarded; s.fstat.at = prev.at; return }
    const dt = (now - prev.at) / 1000
    const per = (a, b) => (dt > 0 ? ((a - b) / dt).toFixed(1) : '?')
    const want = s.cmd.quality && s.cmd.quality.fps
    const set = t.getSettings()
    api.log(`Images par seconde : reçues ${per(st.totalFrames, prev.total)}, transmises ${per(st.deliveredFrames, prev.delivered)}, perdues ${per(st.discardedFrames, prev.discarded)} (${want} demandées, ${set.width}×${set.height}, indication ${t.contentHint || 'aucune'}).`)
    s.fstat.logged = now
  }

  /** Piste terminée ou image d'une autre taille : MediaRecorder continuerait sans rien dire, avec un fichier faux. */
  function watch(s) {
    if (!s.cmd.test && !s.cmd.audioOnly) frameStats(s)
    const { videoTrack, audioTrack } = s.source
    if (videoTrack.readyState === 'ended') return endWith(s, 'piste vidéo terminée')
    if (audioTrack && audioTrack.readyState === 'ended') return endWith(s, 'piste son terminée')
    // Son seulement : la petite image ne sert pas, sa taille ne compte pas.
    if (s.cmd.audioOnly) return
    const now = videoTrack.getSettings()
    if (now.width && s.settings && s.settings.width && (now.width !== s.settings.width || now.height !== s.settings.height)) {
      api.log(`Résolution changée : ${s.settings.width}×${s.settings.height} → ${now.width}×${now.height}.`)
      s.badSince = Date.now() - RESIZE_MARGIN_MS
      endWith(s, 'résolution changée')
    }
  }

  function endWith(s, reason) {
    s.reason = s.reason || reason
    clearInterval(s.watch)
    s.watch = null
    if (s.rec && s.rec.state !== 'inactive') s.rec.stop()
    else if (s.pcm) {
      const info = { reason: s.closing ? 'demandé' : s.reason }
      teardown(s)
      api.stopped(s.cmd.recId, info)
    }
  }

  /** Le premier encodage JPEG est lent (chargement du code) : fait au démarrage plutôt qu'au premier kill. */
  function warmThumb() {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 36
    canvas.getContext('2d', { alpha: false, willReadFrequently: true }).fillRect(0, 0, 64, 36)
    canvas.toDataURL('image/jpeg', 0.82)
  }

  async function start(cmd) {
    warmThumb()
    if (cur) {
      cur.closing = true
      cur.rec = null
      teardown(cur)
    }
    const s = { cmd, closing: false, aborted: false, source: null, rec: null, pcm: null, reason: '', badSince: 0, watch: null, settings: null, gotData: false, chain: Promise.resolve() }
    cur = s
    try {
      s.source = await acquire(cmd)
    } catch (e) {
      if (cur === s) cur = null
      return api.failed(cmd.recId, `Capture refusée : ${errName(e)}`)
    }
    // Arrêt demandé pendant que la capture s'ouvrait.
    if (cur !== s || s.closing) {
      s.source.close()
      if (cur === s) cur = null
      return api.stopped(cmd.recId, { reason: 'demandé' })
    }
    if (cmd.audioOnly) {
      if (!startPcm(s)) {
        teardown(s)
        return api.failed(cmd.recId, 'Lecture du son impossible sur ce PC.')
      }
      s.watch = setInterval(() => watch(s), WATCH_MS)
      return
    }
    // Le format demandé (le suivant après un encodeur muet), sinon on repart du début de la liste.
    const from = (cmd.mimeFrom || 0) % (cmd.testMime ? 1 : MIMES.length)
    if (!startRecording(s, from) && !(from > 0 && startRecording(s, 0))) {
      teardown(s)
      return api.failed(cmd.recId, 'Aucun format MP4 accepté sur ce PC.')
    }
    s.watch = setInterval(() => watch(s), WATCH_MS)
  }

  function stop(recId) {
    const s = cur
    if (!s || s.cmd.recId !== recId) return api.stopped(recId, { reason: 'demandé' })
    s.closing = true
    clearInterval(s.watch)
    s.watch = null
    if (s.rec && s.rec.state !== 'inactive') s.rec.stop()
    else if (s.source) {
      teardown(s)
      api.stopped(recId, { reason: 'demandé' })
    }
    // Pas encore de source : la capture qui s'ouvre verra l'arrêt demandé (start).
  }

  // ---------- vignette ----------

  /** L'image courante : ImageCapture, ou à défaut un élément video branché sur le flux le temps d'une image. */
  async function currentFrame(track) {
    try {
      return await new ImageCapture(track).grabFrame()
    } catch (e) {
      api.log(`ImageCapture : ${errName(e)}`)
    }
    const v = document.createElement('video')
    v.muted = true
    v.srcObject = new MediaStream([track])
    try {
      await v.play()
      return await createImageBitmap(v)
    } finally {
      v.srcObject = null
    }
  }

  async function thumb(id) {
    const s = cur
    if (!s || !s.source) return
    try {
      const t0 = performance.now()
      const frame = await currentFrame(s.source.videoTrack)
      const t1 = performance.now()
      const canvas = document.createElement('canvas')
      canvas.width = THUMB_WIDTH
      canvas.height = Math.max(1, Math.round((frame.height / frame.width) * THUMB_WIDTH))
      // Sur le processeur, rien à demander à la carte graphique pendant la partie. toDataURL plutôt que toBlob : encoder
      // 640 px prend quelques millisecondes, toBlob peut attendre plusieurs secondes un moment libre et occupe plus la page.
      canvas.getContext('2d', { alpha: false, willReadFrequently: true }).drawImage(frame, 0, 0, canvas.width, canvas.height)
      frame.close()
      const b64 = canvas.toDataURL('image/jpeg', 0.82).split(',')[1]
      const text = atob(b64)
      const bytes = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
      api.thumb(id, bytes)
      api.log(`Vignette : image ${Math.round(t1 - t0)} ms, encodage ${Math.round(performance.now() - t1)} ms, ${bytes.length} octets.`)
    } catch (e) {
      api.log(`Vignette impossible : ${errName(e)}`)
    }
  }

  // ---------- ordres ----------

  /** Essais en développement seulement : le processus principal n'envoie jamais cet ordre dans la version installée. */
  function test(cmd) {
    const s = cur
    if (!s || !s.source) return
    if (cmd.action === 'stop-recorder' && s.rec) s.rec.stop()
    else if (cmd.action === 'stop-recorder' && s.pcm) endWith(s, 'essai')
    else if (cmd.action === 'end-video') {
      s.source.videoTrack.stop()
      api.log('Essai : piste vidéo arrêtée.')
    } else if (cmd.action === 'pause-video' && s.source.control) s.source.control.pause(cmd.arg === true)
    else if (cmd.action === 'resize' && s.source.control) s.source.control.resize(cmd.arg.width, cmd.arg.height)
  }

  api.onCommand((cmd) => {
    if (!cmd || typeof cmd !== 'object') return
    if (cmd.type === 'start') void start(cmd)
    else if (cmd.type === 'stop') stop(cmd.recId)
    else if (cmd.type === 'abort') {
      if (cur && cur.cmd.recId === cmd.recId) {
        cur.aborted = true
        endWith(cur, cmd.reason || 'arrêté')
      }
    } else if (cmd.type === 'thumb') void thumb(cmd.id)
    else if (cmd.type === 'test') test(cmd)
  })
  api.ready()
})()
