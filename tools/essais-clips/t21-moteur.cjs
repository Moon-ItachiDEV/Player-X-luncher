// L'image filmée par le moteur vidéo, le son pris par la page : le chemin par défaut sous Windows, qu'aucun autre scénario ne
// joue (ils filment tous par Chrome). Sous Linux, les captures de Windows ne tournent pas : avec PX_ENGINE_SOURCE=x11
// (développement seulement), le moteur filme l'écran X de l'essai et encode avec libx264. Le reste est le vrai code de
// l'appli : le choix du moteur au début de la partie, son flux rangé dans le tampon, le son de la page en PCM, l'assemblage
// du clip, la vignette tirée du clip, les relances et les abandons.
// Six parties de suite :
//   1. le moteur filme et la page prend le son : le tampon, la vraie touche Alt+C, le clip, l'heure de son image et de son
//      son ; puis, sans arrêter la partie, le moteur tué, l'assemblage du son qui rate, la qualité changée, le réglage passé
//      à Chrome puis remis, le moteur figé une minute, et la fin de la partie avec un clip en attente ;
//   2. le moteur est tué six fois de suite : cinq relances, puis l'appli l'abandonne et Chrome filme ;
//   3. le moteur rate dès son lancement : Chrome filme ;
//   4. le moteur rate après 3 s, la page déjà partie en « son seulement » : elle repart avec l'image ;
//   5. le fichier du moteur manque : Chrome filme ;
//   6. aucun son voulu : le moteur filme seul, la page n'enregistre rien, le clip n'a que l'image, et le raccourci est
//      pris quand même ; puis le son est remis, et coupé de nouveau.
// L'heure de l'image se lit contre une horloge posée à l'écran par un programme à part (xflash.py) : un carré qui passe au
// blanc à des instants irréguliers, notés à la milliseconde. L'heure du son se lit contre les bips de la source d'essai de la
// page (un à chaque passage de 2 s de l'horloge du système) ; la source est mise en pause un instant, ce qui saute un bip et
// en place un autre hors de la grille : un son décalé de 2 s pile se verrait aussi.
// Ce que ce scénario ne joue pas : rien de Windows (la fenêtre du jeu, l'écran, NVENC, AMF, la suite d'essais du moteur), ni
// le micro. Durée : 3 minutes environ, dont une d'attente pour le moteur figé.
const H = require('./h.cjs')
const { audioBeeps } = require('./avsync.cjs')
const { start, sleep, until, launcher, test, simRunning, probe, ffprobe, freshDirs, listDir, mp4Boxes, fs, path, execFileSync } = H
const { spawn, spawnSync } = require('child_process')

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined && !ok ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
const note = (s) => console.log(`    ${s}`)
const FFMPEG = '/usr/bin/ffmpeg'
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360', PX_FFMPEG: FFMPEG, PX_FFMPEG_ENCODER: 'libx264', PX_ENGINE_SOURCE: 'x11' }
/** La manière de filmer du moteur sous Linux, telle que l'appli la nomme. */
const ENGINE = 'écran (essai Linux), libx264, copie avant l’encodeur'
const TRIED = `Moteur : essai « ${ENGINE} ».`, FILMING = `Moteur : capture par ${ENGINE}.`, FAILED = `Moteur : « ${ENGINE} » raté (code 1).`
const AUDIO_ONLY = '(son seulement, image par le moteur, son du jeu : oui, micro : non).', FULL = '(light, son du jeu : oui, micro : non).'
/** Le côté du carré de l'horloge d'écran, posé en bas à gauche : loin du message « Clip gardé » (en haut à droite). */
const CLOCK_SIDE = 240
const setEnv = (app, k, v) => app.evaluate((_e, [k, v]) => { process.env[k] = v }, [k, v])
const waitWall = async (ms) => { const d = ms - Date.now(); if (d > 0) await sleep(d) }
const nearest = (list, x) => list.reduce((b, y) => (b === null || Math.abs(y - x) < Math.abs(b - x) ? y : b), null)
const mean = (list) => list.reduce((s, x) => s + x, 0) / list.length
const count = (lines, what) => lines.filter((l) => (typeof what === 'string' ? l === what : what.test(l))).length
const STOPPED = /^Moteur arrêté \(code \w+\) après \d+ s\.$/, ASKED = /^Enregistreur \w+ demandé \(/, OPENED = /^Clip [0-9a-f]{16} ouvert : /

/** L'horloge d'écran, dans ce carré : `flashes` reçoit l'heure du système (ms) de chaque passage au blanc, prise juste avant de
 *  le peindre. L'heure d'après la peinture peut tomber plus tard que l'image elle-même (le serveur X a peint, l'horloge attend
 *  encore sa réponse, jusqu'à 16 ms vus sous charge) : un flash filmé paraissait alors arrivé avant l'horloge. */
function startClock(box) {
  const child = spawn('python3', [path.join(__dirname, 'xflash.py'), box.x, box.y, box.w, box.h].map(String), { stdio: ['ignore', 'pipe', 'inherit'] })
  const clock = { child, box, flashes: [], ready: false, slowest: 0 }
  let rest = ''
  child.stdout.setEncoding('utf8').on('data', (t) => {
    const lines = (rest + t).split('\n')
    rest = lines.pop()
    for (const l of lines) {
      const m = /^F ([\d.]+) ([\d.]+)$/.exec(l)
      if (m) { clock.flashes.push(+m[1]); clock.slowest = Math.max(clock.slowest, +m[2] - +m[1]) } else if (l.startsWith('PRET')) clock.ready = true
    }
  })
  return clock
}

/** Les flashs de l'horloge d'écran dans un fichier : la seconde de la première image blanche de chacun. Un flash déjà allumé à la première image ne compte pas. */
function clockFlashes(file, box) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-map', '0:v', '-vf', `crop=${box.w}:${box.h}:${box.x}:${box.y},scale=8:8,showinfo`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const out = []
  let prev = null
  for (const l of r.stderr.split('\n')) {
    const m = /pts_time:([\d.]+).*mean:\[(\d+)/.exec(l)
    if (!m) continue
    const white = +m[2] > 128
    if (white && prev === false) out.push(+m[1])
    prev = white
  }
  return out
}

/**
 * Décode tout le fichier : true si le décodeur ne trouve rien à redire, sinon ce qu'il dit. Les images gardent leurs instants
 * (ceux de Chrome ne sont pas réguliers : rangés à 30 par seconde, deux d'entre eux tomberaient au même endroit).
 */
function decodes(file) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-fps_mode', 'passthrough', '-enc_time_base', 'demux', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  return r.status === 0 && !r.stderr.trim() ? true : (r.stderr || `code ${r.status}`).trim().slice(0, 300)
}

/** Le fichier vu par ffprobe : sa piste image et sa piste son (undefined : absente). */
function look(file) {
  const p = probe(file)
  return { p, v: p.streams.find((x) => x.type === 'video'), a: p.streams.find((x) => x.type === 'audio'), n: p.streams.length }
}

/** L'heure du système de la première image du fichier : le moment gardé y est noté à sa seconde. */
const firstWallOf = (c) => c.at - c.events[0].t * 1000

;(async () => {
  const dirs = freshDirs('t21')
  const logFile = path.join(dirs.userData, 'logs', 'clips.log'), thumb = (id) => path.join(dirs.userData, 'clips-thumbs', `${id}.jpg`)
  let s, clock, folder, tmp
  const L = (...a) => launcher(s.p, ...a)
  const info = () => test(s.app, 'info')
  /** Le journal des clips, une fois écrit sur le disque, sans l'heure en tête de ligne. */
  const journal = async () => { await L('clipsLogTail'); return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^\S+ /, '')) }
  /** Les lignes du journal depuis ce repère (le nombre de lignes d'avant). */
  const since = async (mark) => (await journal()).slice(mark)
  const mark = async () => (await journal()).length
  /** Les processus du moteur que l'appli a lancés pour filmer l'écran. */
  const engines = () => {
    let out = ''
    try { out = execFileSync('ps', ['-o', 'pid=,args=', '--ppid', String(s.proc.pid)], { encoding: 'utf8' }) } catch { /* aucun enfant */ }
    return out.split('\n').map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter((m) => m && / -f x11grab /.test(m[2])).map((m) => ({ pid: +m[1], args: m[2] }))
  }
  // Le dossier temporaire du système sert à tous les lancements : seuls comptent les restes apparus pendant ce scénario.
  let tmpBefore = new Set()
  const leftovers = () => listDir(tmp).filter((n) => n.startsWith('player-x-clip-') && !tmpBefore.has(n))
  const pressKey = () => { execFileSync('python3', [path.join(__dirname, 'xkey.py'), 'Alt_L', 'c']) }
  const byEngine = (st) => st.status === 'recording' && st.encoder === `moteur : ${ENGINE}`
  const byChrome = (st) => st.status === 'recording' && !!st.encoder && !/^(moteur|son PCM)/.test(st.encoder)
  const stateWhen = (ok, seconds, what, ms = 40000) => until(async () => { const st = await L('clipsState'); return ok(st) && (st.bufferSeconds || 0) >= seconds ? st : null }, ms, what, 250)
  /** Arrête la partie : rend le temps mis par la capture à s'arrêter (ms). */
  const endGame = async () => { const t0 = Date.now(); await simRunning(s.app, false); return until(async () => ((await L('clipsState')).status !== 'recording' ? Date.now() - t0 : null), 30000, 'fin de la partie', 50) }
  const known = new Set(), files = new Set()
  /** Le clip suivant de la liste : sa fiche, son fichier (celui du dossier des clips qui a son poids) et ce qu'en dit ffprobe. */
  const nextClip = async (what) => {
    const c = await until(async () => (await L('clipsList')).find((x) => !known.has(x.id)), 45000, what)
    known.add(c.id)
    const name = listDir(folder).filter((n) => n.endsWith('.mp4') && !files.has(n)).find((n) => fs.statSync(path.join(folder, n)).size === c.sizeBytes)
    if (!name) throw new Error(`${what} : aucun fichier de ${c.sizeBytes} octets dans le dossier des clips`)
    files.add(name)
    const file = path.join(folder, name)
    return { c, file, ...look(file), first: firstWallOf(c), ok: decodes(file) }
  }
  const thumbOf = async (id) => { await until(() => fs.existsSync(thumb(id)), 10000, `vignette ${id}`, 200).catch(() => null); return fs.existsSync(thumb(id)) ? ffprobe(thumb(id), '-show_streams').streams[0] : null }
  try {
    s = await start(dirs, ENV)
    await until(() => s.app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    const scr = await s.app.evaluate(({ screen }) => screen.getPrimaryDisplay().size)
    clock = startClock({ x: 0, y: scr.height - CLOCK_SIDE, w: CLOCK_SIDE, h: CLOCK_SIDE })
    await until(() => clock.ready, 10000, 'horloge d’écran')
    tmp = await s.app.evaluate(({ app }) => app.getPath('temp'))
    tmpBefore = new Set(listDir(tmp))
    const set0 = await L('clipsGetSettings')
    folder = set0.folder
    check('réglages d’origine : l’image par le moteur vidéo, le son du jeu, pas de micro, Alt+C', set0.capture === 'engine' && set0.gameAudio === true && set0.mic === false && set0.hotkey === 'Alt+C', { capture: set0.capture, gameAudio: set0.gameAudio, mic: set0.mic, hotkey: set0.hotkey })
    await L('clipsSaveSettings', { before: 6, after: 2, merge: 0, quality: 'light' })

    // ===== 1. le moteur filme, la page prend le son
    const mGame = await mark()
    let m = mGame
    await simRunning(s.app, true)
    const st1 = await stateWhen(byEngine, 4, 'tampon du moteur')
    const j1 = await since(m), i1 = await info(), p1 = engines()
    check('début de partie : le moteur filme, la page prend le son, rien à signaler', st1.audio === 'game' && !st1.error, st1)
    check('le journal : un essai du moteur, sa capture à la taille de l’écran, et la page en « son seulement »', j1.indexOf(TRIED) >= 0 && j1.indexOf(FILMING) > j1.indexOf(TRIED) && j1.some((l) => new RegExp(`^En-tête MP4 de e\\w+ : avc1 ${scr.width}×${scr.height}\\.$`).test(l)) && count(j1, ASKED) === 1 && j1.some((l) => ASKED.test(l) && l.endsWith(AUDIO_ONLY)) && j1.some((l) => /^Enregistreur r\w+ : son PCM 16 bits, 48 kHz, stéréo, son : game\.$/.test(l)) && j1.some((l) => /^Enregistreur r\w+ : premier son reçu \(-?\d+ ms après sa capture\)\.$/.test(l)) && !j1.some((l) => /raté|abandonné|arrêté|indisponible/.test(l)), j1)
    check('un seul processus du moteur, lancé par l’appli : tout l’écran, 30 images/s, libx264', p1.length === 1 && p1[0].args.includes(` -f x11grab -framerate 30 -video_size ${scr.width}x${scr.height} -i ${process.env.DISPLAY} `) && p1[0].args.includes(' -c:v libx264 '), p1)
    const ids1 = [...new Set(i1.list.map((f) => f.recId))]
    check('deux enregistreurs : celui du moteur a toute l’image du tampon, celui de la page n’y range rien', i1.recorders === 2 && /^r/.test(i1.recorder || '') && ids1.length === 1 && /^e/.test(ids1[0]) && i1.list.every((f) => f.counts.length === 1), { recorders: i1.recorders, recorder: i1.recorder, ids1 })
    const spans1 = i1.list.map((f) => +(f.endS - f.startS).toFixed(3)), keys1 = i1.list.filter((f) => f.key).map((f) => f.startS), keyGaps1 = keys1.slice(1).map((k, i) => +(k - keys1[i]).toFixed(3))
    const rate1 = i1.list.reduce((n, f) => n + f.counts[0], 0) / (i1.list[i1.list.length - 1].endS - i1.list[0].startS)
    note(`tampon du moteur : ${i1.list.length} fragments de ${Math.min(...spans1)} à ${Math.max(...spans1)} s, images clés espacées de ${keyGaps1.join(', ')} s, ${rate1.toFixed(1)} images/s`)
    check('le tampon du moteur : des fragments d’une demi-seconde qui se suivent, une image clé toutes les 2 s, 30 images/s', spans1.every((d) => d > 0.3 && d < 0.8) && i1.list.every((f, i) => i === 0 || Math.abs(f.startS - i1.list[i - 1].endS) < 0.05) && keyGaps1.length >= 1 && keyGaps1.every((g) => Math.abs(g - 2) < 0.15) && Math.abs(rate1 - 30) < 1.5, { spans1, keyGaps1, rate1 })
    check('le raccourci Alt+C est pris', i1.hotkey === 'Alt+C' && i1.hotkeyRegistered === true, { hotkey: i1.hotkey, pris: i1.hotkeyRegistered })

    // L'heure réelle de chaque bip, prise dans la page au moment où la source d'essai le lance. La source bipe à son premier
    // dessin après chaque passage de 2 s (et à la reprise), sur une minuterie de la page : ce dessin peut venir des dizaines
    // de ms après le passage quand la page est occupée. Mesuré contre le passage, ce retard de la source se comptait dans
    // l'heure du son de l'appli (un bip vu à 115-122 ms) ; mesuré contre le bip réel, il ne reste que l'heure de l'appli.
    const pages = () => s.app.windows().filter((w) => w.url().includes('clips-recorder'))
    for (const w of pages()) await w.evaluate(() => { window.__beeps = []; const set = AudioParam.prototype.setValueAtTime; AudioParam.prototype.setValueAtTime = function (v, at) { if (v === 0.6) window.__beeps.push(Date.now()); return set.call(this, v, at) } })
    // La source d'essai en pause autour d'un passage de 2 s (B + 2 s) : pas de bip à ce passage, un bip à la reprise.
    // Le clip remonte jusqu'à 2,8 s avant B (6 s avant l'appui, reprises à l'image clé d'avant) : B vient assez tard pour que
    // tous ses bips soient vus par la page.
    const B = Math.ceil((Date.now() + 4600) / 2000) * 2000
    await waitWall(B + 400)
    const pause = { from: Date.now() }
    await test(s.app, 'command', 'pause-video', true)
    await waitWall(B + 2700)
    pause.resume = Date.now()
    await test(s.app, 'command', 'pause-video', false)
    pause.to = Date.now()
    await waitWall(B + 5200)
    m = await mark()
    const tKey = Date.now()
    pressKey()
    const k = await nextClip('le clip du raccourci')
    const jk = await since(m)
    check('la vraie touche Alt+C ouvre un clip, un seul, daté de l’appui', count(jk, OPENED) === 1 && jk.includes(`Clip ${k.c.id} ouvert : manual (Counter-Strike 2).`) && k.c.kind === 'manual' && k.c.events.length === 1 && k.c.at >= tKey && k.c.at - tKey < 1500, { jk, at: k.c.at - tKey })
    check('le clip : l’image du moteur à la taille de l’écran (H.264), le son de la page (AAC, stéréo, 48 kHz)', k.n === 2 && !!k.v && k.v.codec === 'h264' && k.v.w === scr.width && k.v.h === scr.height && !!k.a && k.a.codec === 'aac' && mp4Boxes(k.file).some((l) => /trak soun : stsd mp4a 2 canaux, 48000 Hz/.test(l)) && k.c.width === scr.width && k.c.height === scr.height, { p: k.p, boîtes: mp4Boxes(k.file) })
    const t1 = k.c.events[0].t, after1 = +(k.c.durationS - t1).toFixed(3)
    note(`clip du raccourci : ${k.c.durationS} s, le moment à ${t1} s (${after1} s avant la fin), ${k.v ? k.v.packets : '?'} images, rythme ${JSON.stringify(k.c.pace)}`)
    check('sa durée : les 6 s d’avant, reprises à l’image clé d’avant (jusqu’à 2 s de plus), et les 2 s d’après', t1 >= 5.95 && t1 <= 8.15 && after1 >= 1.95 && after1 <= 2.1 && Math.abs(k.p.duration - k.c.durationS) <= 0.1 && Math.abs(k.a.dur - k.v.dur) <= 0.1, { t1, after1, durationS: k.c.durationS, fichier: k.p.duration, image: k.v && k.v.dur, son: k.a && k.a.dur })
    check('il se décode sans erreur, à 30 images/s, et son rythme est noté', k.ok === true && Math.abs(k.v.packets / k.v.dur - 30) < 1.5 && !!k.c.pace && k.c.pace.wanted === 30 && Math.abs(k.c.pace.fps - 30) <= 1.5, { ok: k.ok, pace: k.c.pace })
    const th1 = await thumbOf(k.c.id)
    check('sa vignette est tirée du clip par le moteur : un JPEG de 640 de large', !!th1 && th1.codec_name === 'mjpeg' && th1.width === 640 && th1.height === Math.round((scr.height * 640) / scr.width / 2) * 2, th1)
    check('le journal dit le clip écrit, et rien ne reste dans le dossier temporaire', (await since(m)).some((l) => new RegExp(`^Clip ${k.c.id} écrit : « Clip manuel », ${k.c.durationS.toFixed(1)} s, `).test(l)) && leftovers().length === 0, { jk, restes: leftovers() })
    // L'heure de l'image : chaque flash du fichier contre le flash le plus proche de l'horloge d'écran.
    const seen = clockFlashes(k.file, clock.box).map((t) => k.first + t * 1000)
    const img = seen.map((w) => Math.round(w - nearest(clock.flashes, w)))
    note(`image : ${seen.length} flashs dans le clip, vus ${img.join(', ')} ms après l’horloge d’écran (elle peint en ${clock.slowest.toFixed(1)} ms au plus)`)
    check('l’heure de l’image : chaque flash du clip tombe sur un flash de l’horloge d’écran, de 0 à 90 ms après', img.length >= 4 && img.every((d) => d >= 0 && d <= 90), img)
    // L'heure du son : chaque bip du fichier contre le bip réel le plus proche, lancé par la source dans la page.
    const endWall = k.first + k.c.durationS * 1000
    let real = []
    for (const w of pages()) real = real.concat(await w.evaluate(() => window.__beeps || []))
    const grid = real.filter((t) => Math.abs(t - pause.resume) >= 400).map((t) => t - Math.round(t / 2000) * 2000)
    const heard = audioBeeps(k.file).filter((b) => b > 0.06).map((b) => k.first + b * 1000)
    const snd = heard.map((w) => Math.round(w - nearest(real, w)))
    const missing = real.filter((t) => t > k.first + 100 && t < endWall - 600 && !heard.some((w) => Math.abs(w - t) < 400))
    note(`son : ${heard.length} bips dans le clip, entendus ${snd.join(', ')} ms après le bip de la source (pause de ${pause.to - pause.from} ms, reprise demandée en ${pause.to - pause.resume} ms ; la source bipe ${grid.join(', ')} ms après les passages de 2 s)`)
    check('l’heure du son : chaque bip du clip tombe sur un bip de la source, de 0 à 90 ms après, celui de la reprise compris, et aucun pendant la pause', snd.length >= 4 && snd.every((d) => d >= 0 && d <= 90) && missing.length === 0 && heard.some((w) => Math.abs(w - pause.resume) < 400) && !real.some((t) => pause.from + 50 < t && t < pause.resume - 50), { snd, missing: missing.map((t) => t - k.first) })
    const gap = img.length && snd.length ? Math.round(mean(snd) - mean(img)) : null
    note(`écart moyen du son sur l’image dans ce clip : ${gap} ms`)
    check('l’écart du son sur l’image : de -40 à 60 ms (85 ms de trop avant la correction de la datation du son)', gap !== null && gap >= -40 && gap <= 60, gap)
    const speed = (await since(mGame)).map((l) => /^Moteur : ([\d.]+) images\/s dans le clip \((\d+) images, \d+ reçues de la capture/.exec(l)).filter(Boolean)
    check('le journal donne le rythme du moteur : 30 images/s', speed.length >= 1 && speed.every((x) => Math.abs(+x[1] - 30) <= 2 && +x[2] > 200), speed.map((x) => x[0]))

    // ----- le moteur est tué en pleine partie
    m = await mark()
    const tKill = Date.now()
    process.kill(p1[0].pid, 'SIGKILL')
    const back = await until(async () => ((await info()).list.some((f) => f.startWall > tKill) ? Date.now() - tKill : null), 20000, 'le moteur repart', 100)
    const jKill = await since(m), p2 = engines(), st2 = await L('clipsState')
    note(`moteur tué : première image ${back} ms après`)
    check('moteur tué en pleine partie : le journal le dit, et il repart tout seul en moins de 4 s', jKill.some((l) => /^Moteur arrêté \(code null\) après \d+ s\.$/.test(l)) && count(jKill, TRIED) === 1 && jKill.includes(FILMING) && back < 4000 && p2.length === 1 && p2[0].pid !== p1[0].pid && byEngine(st2), { jKill, back, p2, st2 })
    await sleep(1500)
    await test(s.app, 'saveNow')
    const k2 = await nextClip('le clip d’après la coupure')
    check('le clip suivant s’écrit, avec l’image d’après la coupure seulement, et le son', k2.first >= tKill && k2.c.durationS < 8 && k2.n === 2 && !!k2.a && k2.a.codec === 'aac' && k2.ok === true, { depuisLaCoupure: k2.first - tKill, durationS: k2.c.durationS, p: k2.p, ok: k2.ok })

    // ----- l'assemblage du son rate : le clip garde l'image seule
    await sleep(2500)
    m = await mark()
    await setEnv(s.app, 'PX_FFMPEG', '/bin/false')
    await test(s.app, 'saveNow')
    const k3 = await nextClip('le clip sans son')
    // La vignette est tentée juste après : le moteur n'est remis qu'une fois cet essai fini.
    await until(async () => (await since(m)).some((l) => l.startsWith(`Vignette ${k3.c.id} : `)), 15000, 'vignette tentée', 300).catch(() => null)
    await setEnv(s.app, 'PX_FFMPEG', FFMPEG)
    const jMux = await since(m)
    check('l’assemblage du son rate : le journal le dit, et le clip garde l’image seule', jMux.includes(`Clip ${k3.c.id} : assemblage du son raté (code 1), clip sans son.`) && k3.n === 1 && !!k3.v && k3.v.w === scr.width && k3.ok === true, { jMux, p: k3.p })
    check('… sa vignette n’a pas pu être tirée, le journal le dit, et rien ne reste dans le dossier temporaire', jMux.includes(`Vignette ${k3.c.id} : le moteur n’a pas pu la tirer (code 1).`) && !fs.existsSync(thumb(k3.c.id)) && leftovers().length === 0 && !(await L('clipsState')).error, { jMux, restes: leftovers() })

    // ----- la qualité changée en pleine partie : le moteur et la page repartent tout de suite
    m = await mark()
    const recBefore = (await info()).recorder, tQ = Date.now()
    await L('clipsSaveSettings', { quality: 'balanced' })
    await until(() => { const e = engines(); return e.length === 1 && e[0].pid !== p2[0].pid && / -framerate 60 /.test(e[0].args) }, 20000, 'moteur relancé à 60 images/s', 150)
    await stateWhen(byEngine, 2, 'tampon du moteur relancé')
    const jQ = await since(m), iQ = await info()
    check('qualité changée en pleine partie : le moteur repart tout de suite à 60 images/s, la page aussi', jQ.includes('Enregistreur relancé : réglages changés.') && count(jQ, TRIED) === 1 && !jQ.some((l) => /^Moteur arrêté|raté|abandonné/.test(l)) && !!iQ.recorder && iQ.recorder !== recBefore && jQ.includes(`Enregistreur ${iQ.recorder} demandé ${AUDIO_ONLY}`), { jQ, avant: recBefore, après: iQ.recorder })
    await sleep(1500)
    await test(s.app, 'saveNow')
    const k4 = await nextClip('le clip en 60 images/s')
    note(`clip en qualité équilibrée : ${k4.c.durationS} s, rythme ${JSON.stringify(k4.c.pace)}`)
    check('… et le clip d’après vient du nouveau moteur, avec le son', k4.first >= tQ && k4.n === 2 && !!k4.a && k4.ok === true && !!k4.c.pace && k4.c.pace.wanted === 60, { depuisLeRéglage: k4.first - tQ, p: k4.p, pace: k4.c.pace })

    // ----- le réglage passe à Chrome, puis revient au moteur
    m = await mark()
    await L('clipsSaveSettings', { capture: 'chrome', quality: 'light' })
    const stC = await stateWhen(byChrome, 3, 'capture par Chrome')
    const jC = await since(m), iC = await info()
    check('réglage passé à Chrome en pleine partie : la capture s’arrête, repart par Chrome, et le moteur ne tourne plus', jC.includes('Capture arrêtée : méthode de capture changée.') && jC.includes('Capture par Chrome (réglage).') && count(jC, TRIED) === 0 && engines().length === 0 && iC.recorders === 1 && iC.list.length > 0 && iC.list.every((f) => f.recId === iC.recorder) && iC.hotkeyRegistered === true, { jC, stC, recorders: iC.recorders })
    await test(s.app, 'saveNow')
    const k5 = await nextClip('le clip de Chrome')
    check('… et le clip de Chrome a l’image de la page (640 × 360) et son son', !!k5.v && k5.v.w === 640 && k5.v.h === 360 && !!k5.a && k5.c.width === 640 && k5.c.height === 360 && k5.ok === true, { p: k5.p, ok: k5.ok })
    m = await mark()
    await L('clipsSaveSettings', { capture: 'engine' })
    await stateWhen(byEngine, 3, 'retour au moteur')
    const jE = await since(m), iE = await info()
    check('réglage remis sur le moteur : la capture repart par le moteur, la page en « son seulement »', jE.includes('Capture arrêtée : méthode de capture changée.') && jE.includes(FILMING) && jE.some((l) => ASKED.test(l) && l.endsWith(AUDIO_ONLY)) && engines().length === 1 && iE.recorders === 2 && iE.hotkeyRegistered === true, { jE, recorders: iE.recorders })

    // ----- le moteur figé : après 60 s sans image, l'appli le relance
    m = await mark()
    const frozen = engines()[0], tStop = Date.now()
    // Les enregistreurs du moteur déjà là : défigé, l'ancien moteur rend encore des images (répétées, à cadence fixe) avant
    // de s'arrêter, et leurs fragments sont datés après le gel. Seuls comptent ceux d'un nouveau moteur.
    const oldEng = new Set((await info()).list.map((f) => f.recId).filter((id) => id.startsWith('e')))
    process.kill(frozen.pid, 'SIGSTOP')
    const said = await until(async () => ((await since(m)).includes('Moteur : plus aucune image depuis 60 s, relance.') ? Date.now() - tStop : null), 80000, 'moteur figé vu par l’appli', 500)
    const stFrozen = await L('clipsState')
    // Un processus figé ne lit pas la demande d'arrêt de l'appli : une fois défigé, il la reçoit et s'arrête.
    process.kill(frozen.pid, 'SIGCONT')
    await until(async () => { const e = engines(); return e.length === 1 && e[0].pid !== frozen.pid && (await info()).list.some((f) => f.recId.startsWith('e') && !oldEng.has(f.recId) && f.startWall > tStop + said) && (await since(m)).includes(FILMING) }, 20000, 'le moteur repart après le gel', 200)
    const jS = await since(m)
    note(`moteur figé : l’appli le relance ${(said / 1000).toFixed(1)} s après`)
    check('moteur figé : après 60 s sans image, l’appli lui demande de s’arrêter, puis le relance', said >= 58000 && said <= 66000 && stFrozen.status === 'recording' && count(jS, STOPPED) === 1 && count(jS, TRIED) === 1 && jS.includes(FILMING), { said, stFrozen, jS })

    // ----- la partie finit avec un clip en attente : il s'écrit avec ce qu'il y a
    await stateWhen(byEngine, 4, 'tampon du moteur avant la fin')
    m = await mark()
    await test(s.app, 'saveNow')
    const stopMs = await endGame()
    const k6 = await nextClip('le clip en attente à la fin de la partie')
    const after6 = +(k6.c.durationS - k6.c.events[0].t).toFixed(3)
    note(`fin de partie : capture arrêtée en ${stopMs} ms ; le clip en attente fait ${k6.c.durationS} s, dont ${after6} s après le moment`)
    check('fin de partie avec un clip en attente : il s’écrit avec ce qu’il y a (moins de 1,5 s après le moment), image et son', after6 >= 0 && after6 < 1.5 && k6.n === 2 && !!k6.a && k6.ok === true, { durationS: k6.c.durationS, t: k6.c.events[0].t, p: k6.p, ok: k6.ok })
    const iEnd = await info(), stEnd = await L('clipsState'), jEnd = await since(m)
    check('… la capture s’arrête en moins de 2 s : plus de moteur, tampon vidé, raccourci rendu', stopMs < 2000 && jEnd.includes('Capture arrêtée : plus de jeu en cours.') && stEnd.status === 'idle' && !stEnd.error && engines().length === 0 && iEnd.capture === false && iEnd.recorders === 0 && iEnd.fragments === 0 && iEnd.hotkey === null && iEnd.hotkeyRegistered === false && listDir(iEnd.bufferRoot).length === 0 && leftovers().length === 0, { stopMs, stEnd, iEnd: { ...iEnd, list: undefined }, tampon: listDir(iEnd.bufferRoot), restes: leftovers() })

    // ===== 2. le moteur est tué six fois de suite : cinq relances, puis l'appli l'abandonne pour la partie
    m = await mark()
    await simRunning(s.app, true)
    for (let n = 1, last = 0; n <= 6; n++) {
      // Sa première image d'abord : tué avant, ce serait un essai raté, pas une coupure.
      await until(async () => count(await since(m), FILMING) >= n, 20000, `moteur lancé pour la ${n}e fois`, 150)
      const e = await until(() => engines().find((x) => x.pid !== last), 5000, `processus du moteur, ${n}e fois`, 50)
      process.kill(e.pid, 'SIGKILL')
      last = e.pid
    }
    const stR = await stateWhen(byChrome, 2, 'Chrome après six coupures')
    const jR = await since(m), iR = await info()
    const askedR = jR.filter((l) => ASKED.test(l))
    check('moteur tué six fois de suite : cinq relances, puis l’appli l’abandonne pour la partie', count(jR, /^Moteur arrêté \(code null\) après \d+ s\.$/) === 6 && count(jR, TRIED) === 6 && count(jR, FILMING) === 6 && jR.includes('Moteur abandonné pour cette partie (coupures répétées) : image et son par Chrome.') && engines().length === 0, jR)
    check('… et la page, partie en « son seulement », repart avec l’image : Chrome filme', askedR.length === 2 && askedR[0].endsWith(AUDIO_ONLY) && askedR[1] === `Enregistreur ${iR.recorder} demandé ${FULL}` && stR.audio === 'game' && iR.list.some((f) => f.recId === iR.recorder && f.counts.length === 2) && iR.hotkeyRegistered === true, { askedR, stR, recorder: iR.recorder })
    await endGame()

    // ===== 3. le moteur rate dès son lancement : Chrome filme
    await setEnv(s.app, 'PX_FFMPEG', '/bin/false')
    m = await mark()
    await simRunning(s.app, true)
    const stF = await stateWhen(byChrome, 3, 'Chrome après l’abandon du moteur')
    const jF = await since(m), iF = await info()
    check('le moteur rate dès son lancement : le journal le dit, et Chrome filme l’image et le son', count(jF, TRIED) === 1 && jF.includes(FAILED) && jF.includes('Moteur abandonné pour cette partie (aucune manière n’a marché) : image et son par Chrome.') && stF.audio === 'game' && !stF.error && iF.list.length > 0 && iF.list.every((f) => f.recId === iF.recorder && f.counts.length === 2) && iF.hotkeyRegistered === true && engines().length === 0, { jF, stF, recorder: iF.recorder })
    await test(s.app, 'saveNow')
    const k7 = await nextClip('le clip de Chrome après l’abandon')
    const th7 = await thumbOf(k7.c.id)
    check('… le clip a l’image de la page (640 × 360), son son, et sa vignette', !!k7.v && k7.v.w === 640 && k7.v.h === 360 && !!k7.a && k7.ok === true && !!th7 && th7.codec_name === 'mjpeg', { p: k7.p, ok: k7.ok, th7 })
    await endGame()

    // ===== 4. le moteur rate après 3 s : la page, déjà partie en « son seulement », repart avec l'image
    const slow = path.join(dirs.base, 'moteur-lent.sh')
    fs.writeFileSync(slow, '#!/bin/sh\nsleep 3\nexit 1\n', { mode: 0o755 })
    await setEnv(s.app, 'PX_FFMPEG', slow)
    m = await mark()
    await simRunning(s.app, true)
    const audioOnly = await until(async () => (await info()).recorder, 10000, 'la page en « son seulement »', 100)
    await stateWhen(byChrome, 3, 'Chrome après l’abandon tardif')
    const jL = await since(m), iL = await info()
    const askedL = jL.filter((l) => ASKED.test(l))
    check('le moteur rate après 3 s : la page, partie en « son seulement », s’arrête et repart avec l’image', jL.includes(FAILED) && jL.includes('Moteur abandonné pour cette partie (aucune manière n’a marché) : image et son par Chrome.') && askedL.length === 2 && askedL[0] === `Enregistreur ${audioOnly} demandé ${AUDIO_ONLY}` && askedL[1] === `Enregistreur ${iL.recorder} demandé ${FULL}` && iL.recorder !== audioOnly && iL.list.length > 0 && iL.list.every((f) => f.recId === iL.recorder && f.counts.length === 2), { jL, audioOnly, recorder: iL.recorder })
    await test(s.app, 'saveNow')
    const k8 = await nextClip('le clip de Chrome après l’abandon tardif')
    check('… et le clip a l’image de la page et son son', !!k8.v && k8.v.w === 640 && k8.v.h === 360 && !!k8.a && k8.ok === true, { p: k8.p, ok: k8.ok })
    await endGame()

    // ===== 5. le fichier du moteur manque : Chrome filme
    await setEnv(s.app, 'PX_FFMPEG', path.join(dirs.base, 'absent', 'ffmpeg'))
    m = await mark()
    await simRunning(s.app, true)
    const stA = await stateWhen(byChrome, 2, 'Chrome, moteur absent')
    const jA = await since(m)
    check('le fichier du moteur manque : le journal le dit, aucun essai du moteur, Chrome filme', jA.includes('Moteur vidéo indisponible : image et son par Chrome.') && count(jA, TRIED) === 0 && stA.audio === 'game' && engines().length === 0, { jA, stA })
    await endGame()

    // ===== 6. aucun son voulu : le moteur filme seul, la page n'enregistre rien
    await setEnv(s.app, 'PX_FFMPEG', FFMPEG)
    await L('clipsSaveSettings', { gameAudio: false, mic: false })
    m = await mark()
    await simRunning(s.app, true)
    const stN = await stateWhen(byEngine, 7, 'tampon du moteur, sans son', 60000)
    const jN = await since(m), iN = await info()
    check('aucun son voulu : le moteur filme seul, la page n’enregistre rien', stN.audio === undefined && iN.recorder === null && iN.recorders === 1 && count(jN, /^Enregistreur /) === 0 && engines().length === 1, { stN, recorder: iN.recorder, recorders: iN.recorders, jN })
    m = await mark()
    await test(s.app, 'saveNow')
    const k9 = await nextClip('le clip sans son voulu')
    const th9 = await thumbOf(k9.c.id), jN2 = await since(m)
    check('… un moment gardé s’écrit quand même : l’image seule, à la taille de l’écran, avec sa vignette', k9.n === 1 && !!k9.v && k9.v.w === scr.width && k9.v.h === scr.height && k9.ok === true && !!th9 && !jN2.some((l) => /pas de son|assemblage/.test(l)), { p: k9.p, ok: k9.ok, th9, jN2 })
    // Le raccourci est pris aussi quand le moteur filme seul, et la vraie touche garde un clip : l'image seule.
    check('… le raccourci Alt+C est pris, même sans aucun son voulu', iN.hotkey === 'Alt+C' && iN.hotkeyRegistered === true, { hotkey: iN.hotkey, pris: iN.hotkeyRegistered })
    m = await mark()
    pressKey()
    const k9b = await nextClip('le clip de la touche, sans son voulu')
    check('… et la vraie touche Alt+C garde un clip, un seul : l’image seule, à la taille de l’écran', count(await since(m), OPENED) === 1 && k9b.c.kind === 'manual' && k9b.n === 1 && !!k9b.v && k9b.v.w === scr.width && k9b.ok === true, { p: k9b.p, ok: k9b.ok })
    // Le son du jeu remis en pleine partie : la page démarre en « son seulement », et la touche garde un clip.
    m = await mark()
    let pidN = engines()[0].pid
    await L('clipsSaveSettings', { gameAudio: true })
    const recN = await until(async () => { const i = await info(), st = await L('clipsState'); return i.recorder && i.hotkeyRegistered && st.audio === 'game' ? i.recorder : null }, 20000, 'la page démarre en « son seulement »', 200)
    // Le moteur repart lui aussi (ses réglages peuvent avoir changé) : le tampon est celui du nouveau.
    await until(() => engines().some((e) => e.pid !== pidN), 20000, 'le moteur repart, son remis', 100)
    await stateWhen(byEngine, 3, 'tampon du moteur, son remis')
    const jN3 = await since(m)
    pressKey()
    const k10 = await nextClip('le clip de la touche, son remis')
    check('le son remis en pleine partie : la page démarre en « son seulement », et la vraie touche garde un clip avec le son', jN3.includes(`Enregistreur ${recN} demandé ${AUDIO_ONLY}`) && count(jN3, TRIED) === 1 && count(await since(m), OPENED) === 1 && k10.c.kind === 'manual' && k10.n === 2 && !!k10.a && k10.ok === true, { jN3, p: k10.p, ok: k10.ok })
    // Le son coupé de nouveau : la page s'arrête, le moteur continue seul.
    m = await mark()
    pidN = engines()[0].pid
    await L('clipsSaveSettings', { gameAudio: false })
    await until(() => engines().some((e) => e.pid !== pidN), 20000, 'le moteur repart, son coupé', 100)
    const stN4 = await until(async () => { const i = await info(), st = await L('clipsState'); return i.recorder === null && byEngine(st) && (st.bufferSeconds || 0) >= 1 ? st : null }, 20000, 'la page s’arrête, le moteur continue', 200)
    const jN4 = await since(m)
    check('le son coupé de nouveau : la page s’arrête, le moteur continue seul', stN4.audio === undefined && jN4.includes('Enregistreur relancé : réglages changés.') && count(jN4, ASKED) === 0 && count(jN4, TRIED) === 1 && engines().length === 1, { stN4, jN4 })
    const iN4 = await info()
    check('… et le raccourci reste pris', iN4.hotkey === 'Alt+C' && iN4.hotkeyRegistered === true, { hotkey: iN4.hotkey, pris: iN4.hotkeyRegistered })
    await endGame()
    const iLast = await info()
    check('à la fin : plus de moteur, tampon vidé, rien dans le dossier temporaire', engines().length === 0 && iLast.recorders === 0 && listDir(iLast.bufferRoot).length === 0 && leftovers().length === 0, { moteurs: engines(), tampon: listDir(iLast.bufferRoot), restes: leftovers() })
    const bad = (await journal()).filter((l) => /impossible|illisible|inaccessible|interrompue|ne suit pas|Échec|plantée|pas de son dans le tampon|déjà pris|refusé|non vidé|^Enregistreur \w+ arrêté|^Arrêt de la capture|^Fermeture/.test(l))
    check('le journal ne dit rien d’autre de travers : ni clip impossible, ni flux illisible, ni capture interrompue', bad.length === 0, bad)
    check('pas d’erreur dans la page', s.errs.length === 0, s.errs.slice(0, 3))
  } catch (e) { fail++; console.log('ECHEC', String(e.message || e).split('\n')[0]) } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    if (clock) try { clock.child.kill('SIGKILL') } catch { /* déjà finie */ }
    if (s) await s.app.close().catch(() => {})
    process.exit(fail ? 1 : 0)
  }
})()
