// Un film fabriqué par l'appli à partir de vrais clips : le bouton de la page appelle editFilmStart avec des identifiants.
// A. Un vrai film : trois clips (un doublé fusionné, un kill, un clip gardé à la main), chaque image du film comparée à
//    celle du clip, l'écart son/image, le film rangé avec les clips, les refus, l'arrêt, un jeu qui démarre.
// B. Un moteur qui rate tout : le film est dit raté, avec un texte à copier sans aucun chemin.
// C. Des encodeurs qui ne marchent pas sur ce PC : le suivant prend le relais, et il est retenu pour le film d'après.
// Sous Linux, c'est le ffmpeg de la machine qui joue le moteur (PX_FFMPEG) et libx264 l'encodeur (PX_FFMPEG_ENCODER) : le
// moteur Windows livré (FFmpeg 9.0.2) n'est jamais lancé ici.
const H = require('./h.cjs')
const C = require('./film-check.cjs')
const { start, sleep, until, launcher, test, simPost, simRunning, payload, probe, decodeCheck, freshDirs, listDir, fs, path } = H
const os = require('os'), { execFileSync } = require('child_process')

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`) }
const FF = process.env.PX_T14_FFMPEG || '/usr/local/bin/ffmpeg'
const workDirs = () => listDir(os.tmpdir()).filter((n) => n.startsWith('px-film-'))
const engines = () => { try { return execFileSync('pgrep', ['-f', 'px-film-'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length } catch { return 0 } }
const two = (n) => String(n).padStart(2, '0')
/** Le nom de fichier d'un clip ou d'un film, comme l'appli l'écrit (clipBaseName). */
const baseName = (c) => { const d = new Date(c.at); return `${c.gameName} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())} ${c.title}.mp4` }
/** Les plans attendus, recalculés ici à part des règles de l'appli : 3 s avant et 1,2 s après chaque kill (8 s et 1 s pour un clip à la main), fusion à 0,6 s. */
function expectedShots(clips) {
  const out = []
  for (const c of [...clips].sort((a, b) => a.at - b.at)) {
    const spans = (c.events || []).filter((e) => e.kind !== 'death').map((e) => (e.kind === 'manual' ? [e.t - 8, e.t + 1] : [e.t - 3, e.t + 1.2])).map(([a, b]) => [Math.max(0, a), Math.min(c.durationS, b)]).sort((x, y) => x[0] - y[0])
    const merged = []
    for (const s of spans) { const last = merged[merged.length - 1]; if (last && s[0] <= last[1] + 0.6) last[1] = Math.max(last[1], s[1]); else merged.push([...s]) }
    for (const [a, b] of merged) if (b - a >= 1) out.push({ clip: c, inS: a, frames: Math.max(1, Math.round(((b - a) * 60) / 3)) * 3 })
  }
  return out
}
const filmEvents = (p) => p.evaluate(() => { window.__film = []; window.__off?.(); window.__off = window.launcher.onEditFilm((s) => window.__film.push(s)) })
const seen = (p) => p.evaluate(() => window.__film)
const waitEnd = (p, ms = 240000) => until(async () => { const l = await seen(p); const s = l[l.length - 1]; return s && s.status !== 'running' ? s : null }, ms, 'fin du film', 300)
const refusal = (promise) => promise.then(() => null, (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))

async function makeClips(app, L) {
  const waitClips = (n, ms = 45000) => until(async () => { const l = await L('clipsList'); return l.length >= n ? l : null }, ms, `${n} clip(s)`)
  await L('clipsSaveSettings', { before: 6, after: 2, merge: 3 })
  await simRunning(app, true)
  await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 10, 30000, 'tampon', 500)
  // Un doublé : deux kills à 2 s d'écart, dans le même clip
  await simPost(app, payload({ round: 1, phase: 'freezetime', ct: 1, t: 0 }))
  await simPost(app, payload({ round: 1, phase: 'live', ct: 1, t: 0 }))
  await simPost(app, payload({ round: 1, kills: 1, rk: 1, rhs: 1, ct: 1, t: 0 }))
  await sleep(2000)
  await simPost(app, payload({ round: 1, kills: 2, rk: 2, rhs: 1, ct: 1, t: 0 }))
  await waitClips(1)
  // Un kill seul, au round suivant
  await sleep(4000)
  await simPost(app, payload({ round: 2, phase: 'freezetime', kills: 2, ct: 2, t: 0 }))
  await simPost(app, payload({ round: 2, phase: 'live', kills: 2, ct: 2, t: 0 }))
  await simPost(app, payload({ round: 2, kills: 3, rk: 1, rhs: 0, ct: 2, t: 0 }))
  await waitClips(2)
  // Un clip gardé à la main
  await sleep(4000)
  await test(app, 'saveNow')
  return waitClips(3)
}

async function partA(dirs) {
  console.log('--- A. Un vrai film, fabriqué par l’appli avec le ffmpeg de la machine')
  const { app, p, errs } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360', PX_FFMPEG: FF, PX_FFMPEG_ENCODER: 'libx264' })
  const L = (...a) => launcher(p, ...a)
  let out = null
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    check('au démarrage : aucun film en cours', (await L('editFilmState')).status === 'idle')
    const clips = await makeClips(app, L)
    const ids = clips.map((c) => c.id)
    check('trois clips : un doublé (deux événements), un kill, un clip à la main', clips.length === 3 && clips.map((c) => (c.events || []).length).sort().join() === '1,1,2' && clips.filter((c) => c.kind === 'manual').length === 1, clips.map((c) => `${c.kind}:${(c.events || []).length}:${c.durationS.toFixed(1)}`))
    const folder = (await L('clipsGetSettings')).folder
    // ----- refus pendant la partie
    const before = workDirs().length
    const r1 = await refusal(L('editFilmStart', ids))
    check('refus pendant qu’un jeu tourne', /Un jeu tourne/.test(r1 || ''), r1)
    check('après ce refus : rien en cours, aucun dossier de travail', (await L('editFilmState')).status === 'idle' && workDirs().length === before)
    await simRunning(app, false)
    await until(async () => (await L('clipsState')).status !== 'recording', 20000, 'fin de la partie', 300)
    // ----- refus de ce qui n'est pas montable
    for (const [what, arg] of [['une liste vide', []], ['autre chose qu’une liste', 'x'], ['des identifiants inconnus', ['0123456789abcdef', '../../etc/passwd', 42]]]) {
      const r = await refusal(L('editFilmStart', arg))
      check(`refus de ${what}`, /Aucun clip lisible/.test(r || '') && (await L('editFilmState')).status === 'idle', r)
    }
    // ----- le film
    await filmEvents(p)
    const t0 = Date.now()
    // Un identifiant inconnu et un doublon dans la demande : l'un est compté à part, l'autre ignoré.
    const started = await L('editFilmStart', [...ids, ids[0], 'ffffffffffffffff'])
    const want = expectedShots(clips)
    const wantFrames = want.reduce((n, s) => n + s.frames, 0)
    check('réponse immédiate : le film est lancé, avec son nom et ses plans', started.status === 'running' && started.title === 'Film Mirage' && started.shots === want.length && started.percent === 0 && started.skipped === 1 && ids.includes(started.fromClipId), started)
    // Pendant ce film : pas de second film, pas d'essai du moteur
    const r2 = await refusal(L('editFilmStart', ids))
    check('refus d’un second film pendant le premier', /déjà en cours/.test(r2 || ''), r2)
    const r3 = await refusal(L('editEngineTest'))
    check('refus d’un essai du moteur pendant un film', /Un film est en cours de fabrication/.test(r3 || ''), r3)
    const end = await waitEnd(p)
    const took = (Date.now() - t0) / 1000
    const events = await seen(p)
    console.log(`    film en ${took.toFixed(1)} s, ${events.length} messages, plans attendus : ${JSON.stringify(want.map((s) => [s.clip.kind, +s.inS.toFixed(2), s.frames]))}`)
    check('fin : film prêt, 100 %, rangé avec les clips', end.status === 'done' && end.percent === 100 && typeof end.clipId === 'string' && end.shots === want.length && Math.abs(end.durationS - wantFrames / 60) < 1e-6 && end.skipped === 1, end)
    const percents = events.filter((e) => e.status === 'running').map((e) => e.percent)
    check('avancement : il monte sans jamais reculer, de 0 à 99 au plus, en plusieurs étapes', percents.length >= 5 && percents.every((x, i) => Number.isInteger(x) && x >= 0 && x <= 99 && (i === 0 || x > percents[i - 1])), percents)
    check('après le film : plus rien en cours, dossier de travail effacé, aucun moteur qui tourne', (await L('editFilmState')).status === 'done' && workDirs().length === before && engines() === 0, { dirs: workDirs(), engines: engines() })
    // ----- le film dans la liste des clips
    const list = await L('clipsList')
    const film = list.find((c) => c.id === end.clipId)
    check('le film est dans la liste : kind « film », nom, plans, 1920 × 1080, sans kills', !!film && film.kind === 'film' && film.title === 'Film Mirage' && film.shots === want.length && film.width === 1920 && film.height === 1080 && film.kills === 0 && film.headshots === 0 && film.pinned === false && film.map === 'de_mirage' && film.sessionId === clips[0].sessionId && !film.events, film)
    check('la fiche publique du film ne donne aucun chemin', !!film && !('file' in film) && !JSON.stringify(film).includes(folder))
    check('les trois clips sont toujours là, inchangés', ids.every((id) => { const a = clips.find((c) => c.id === id), b = list.find((c) => c.id === id); return b && JSON.stringify(a) === JSON.stringify(b) }))
    const filmsDir = path.join(folder, 'Films')
    const file = path.join(filmsDir, baseName(film))
    check('le fichier est dans le sous-dossier Films, sous son nom, sans reste « .part »', fs.existsSync(file) && listDir(filmsDir).length === 1 && fs.statSync(file).size === film.sizeBytes, listDir(filmsDir))
    const thumb = await p.evaluate(async (u) => { const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, type: r.headers.get('content-type'), jpeg: b[0] === 0xff && b[1] === 0xd8, bytes: b.length } }, film.thumbUrl)
    check('la vignette du film se lit par pxclip://', thumb.status === 200 && thumb.type === 'image/jpeg' && thumb.jpeg && thumb.bytes > 2000, thumb)
    const played = await p.evaluate((u) => new Promise((resolve) => { const v = document.createElement('video'); v.muted = true; v.onloadedmetadata = () => resolve({ w: v.videoWidth, h: v.videoHeight, d: v.duration }); v.onerror = () => resolve({ err: v.error && v.error.message }); v.src = u }), film.videoUrl)
    check('le film se lit dans une balise video de l’appli', played.w === 1920 && played.h === 1080 && Math.abs(played.d - wantFrames / 60) < 0.1, played)
    // ----- le fichier lui-même
    const pr = probe(file)
    const v = pr.streams.find((s) => s.type === 'video'), a = pr.streams.find((s) => s.type === 'audio')
    check(`fichier : H.264 1920 × 1080, ${wantFrames} images, son AAC, mêmes durées`, v && a && v.codec === 'h264' && v.w === 1920 && v.h === 1080 && v.packets === wantFrames && Math.abs(v.dur - wantFrames / 60) < 1e-4 && a.codec === 'aac' && Math.abs(a.dur - v.dur) < 0.03 && v.start === 0 && a.start === 0, { v, a })
    const dec = decodeCheck(file)
    check('fichier : décodé en entier sans erreur', dec.ok && !dec.out.trim(), dec)
    const head = fs.readFileSync(file).subarray(0, 4096).toString('latin1')
    check('fichier : index au début (lecture immédiate)', head.indexOf('moov') > 0 && (head.indexOf('mdat') < 0 || head.indexOf('moov') < head.indexOf('mdat')))
    // ----- chaque image du film est celle du clip à cet instant
    const filmClock = C.clocks(file, 1920, 1080)
    check('une heure lue par image du film', filmClock.length === wantFrames, filmClock.length)
    const filmFlash = C.flashes(file), filmBeep = C.beeps(C.pcm(file))
    let base = 0, flashSeen = 0
    for (const [i, s] of want.entries()) {
      const srcFile = path.join(folder, baseName(s.clip))
      const src = { pts: C.framePts(srcFile), clock: C.clocks(srcFile, 640, 360) }
      const r = C.shotFrames(filmClock, base, s.frames, src, s.inS)
      check(`plan ${i + 1} (${s.clip.title}, ${s.frames} images depuis ${s.inS.toFixed(2)} s) : toutes les images sont celles du clip`, src.pts.length === src.clock.length && r.bad === 0 && r.exact >= s.frames * 0.9, r)
      // L'écart entre le flash et le bip. Le flash du film est à sa place à une image du film près (grille à 60 images/s). Le
      // son du plan est calé sur l'horodatage du clip à l'instant de la coupe (comme un lecteur qui s'y place) : le retard
      // attendu du bip sur le flash est donc celui du clip, moins le décalage du flash, plus l'écart d'horodatage du clip à
      // cet instant (voir audioDrift). À 6 ms près.
      const t0s = base / 60, d = s.frames / 60
      const sf = C.flashes(srcFile), sb = C.beeps(C.pcm(srcFile)), driftMs = Math.round(C.audioDrift(srcFile)(s.inS) * 1000)
      const rows = sf.filter((t) => t >= s.inS + 0.15 && t <= s.inS + d - 0.3).map((t) => {
        const cb = C.near(sb, t), ff = C.near(filmFlash, t0s + (t - s.inS)), fb = ff === null ? null : C.near(filmBeep, ff)
        const row = { clip: cb === null ? null : Math.round((cb - t) * 1000), film: ff === null || fb === null ? null : Math.round((fb - ff) * 1000), flashMs: ff === null ? null : Math.round((ff - (t0s + (t - s.inS))) * 1000) }
        return { ...row, attendu: row.clip === null || row.flashMs === null ? null : row.clip - row.flashMs + driftMs }
      }).filter((x) => x.film !== null || x.clip !== null)
      const full = rows.filter((x) => x.clip !== null && x.film !== null)
      flashSeen += full.length
      if (rows.length) check(`plan ${i + 1} : le bip suit le flash comme dans le clip (ms ; écart d'horodatage du clip à la coupe : ${driftMs} ms), flash à sa place à une image près`, full.length > 0 && full.every((x) => Math.abs(x.film - x.attendu) <= 6 && Math.abs(x.flashMs) <= 17), rows)
      base += s.frames
    }
    check('écart son/image mesuré sur au moins 3 flashs', flashSeen >= 3, flashSeen)
    // ----- ce qu'un film n'accepte pas
    const r4 = await refusal(L('editFilmStart', [film.id]))
    check('un film ne se remonte pas dans un film', /Aucun clip lisible/.test(r4 || ''), r4)
    const r5 = await refusal(L('clipsTrim', film.id, 1, 3))
    check('un film ne se coupe pas sans réencodage', /Un film ne se coupe pas ici/.test(r5 || ''), r5)
    // ----- renommer : le fichier suit, dans Films
    const renamed = await L('clipsRename', film.id, 'Mon premier film')
    check('renommer le film : le fichier suit, dans le sous-dossier Films', renamed.title === 'Mon premier film' && fs.existsSync(path.join(filmsDir, baseName(renamed))) && !fs.existsSync(file), listDir(filmsDir))
    // ----- arrêter un film en cours
    await filmEvents(p)
    await L('editFilmStart', ids)
    await until(async () => (await seen(p)).some((s) => s.status === 'running' && s.percent >= 3), 60000, 'film en route', 200)
    check('pendant la fabrication : un dossier de travail, un moteur qui tourne', workDirs().length === before + 1 && engines() >= 1, { dirs: workDirs().length, engines: engines() })
    const ts = Date.now()
    await L('editFilmStop')
    const stopped = await waitEnd(p, 20000)
    check('arrêt : dit en clair, en moins de 3 s', stopped.status === 'stopped' && stopped.message === 'Film arrêté.' && Date.now() - ts < 3000, { ...stopped, ms: Date.now() - ts })
    await sleep(500)
    check('après l’arrêt : aucun film en plus, rien dans Films, dossier de travail effacé, aucun moteur', (await L('clipsList')).length === 4 && listDir(filmsDir).length === 1 && workDirs().length === before && engines() === 0, { films: listDir(filmsDir), dirs: workDirs(), engines: engines() })
    // ----- un jeu démarre pendant la fabrication
    await filmEvents(p)
    await L('editFilmStart', ids)
    await until(async () => (await seen(p)).some((s) => s.status === 'running' && s.percent >= 3), 60000, 'film en route', 200)
    const tg = Date.now()
    await simRunning(app, true)
    const gamed = await waitEnd(p, 20000)
    check('un jeu démarre : le film s’arrête tout seul, en moins de 4 s, et le dit', gamed.status === 'stopped' && /Un jeu a démarré/.test(gamed.message || '') && Date.now() - tg < 4000, { ...gamed, ms: Date.now() - tg })
    await simRunning(app, false)
    await until(async () => (await L('clipsState')).status !== 'recording', 20000, 'fin de la partie', 300)
    await sleep(500)
    check('après cet arrêt : rien dans Films en plus, dossier de travail effacé, aucun moteur', listDir(filmsDir).length === 1 && workDirs().length === before && engines() === 0)
    // ----- un film pendant un essai du moteur
    const testing = L('editEngineTest')
    await sleep(300)
    const r6 = await refusal(L('editFilmStart', ids))
    check('refus d’un film pendant un essai du moteur', /en cours d’essai/.test(r6 || ''), r6)
    await L('editEngineStop')
    await testing.catch(() => {})
    // ----- supprimer le film
    check('supprimer le film : le fichier part', (await L('clipsDelete', film.id)) === true && listDir(filmsDir).length === 0 && (await L('clipsList')).every((c) => c.kind !== 'film'))
    out = { ids, folder, clips }
  } catch (e) { fail++; console.log('ECHEC', e.message.split('\n')[0]) } finally { await app.close().catch(() => {}) }
  check('A : aucune erreur dans la page', errs.length === 0, errs.slice(0, 3))
  return out
}

/** Un faux moteur, écrit par l'essai : un script qui répond à la place de ffmpeg. */
function fakeEngine(dir, name, body) {
  const file = path.join(dir, name)
  fs.writeFileSync(file, `#!/usr/bin/env node\nconst REAL = ${JSON.stringify(FF)}\nconst { spawnSync } = require('child_process')\nconst args = process.argv.slice(2)\nconst pass = (a) => { const r = spawnSync(REAL, a, { stdio: 'inherit' }); process.exit(r.status === null ? 1 : r.status) }\nif (args.includes('-version') || args.includes('-encoders')) pass(args)\n${body}\n`)
  fs.chmodSync(file, 0o755)
  return file
}

async function partB(dirs, A) {
  console.log('--- B. Un moteur qui rate tout : le film est dit raté, avec un texte à copier')
  // Il répond comme ffmpeg quand un fichier est illisible, en citant le chemin du clip qu'on lui a donné.
  const fake = fakeEngine(dirs.base, 'faux-rate.cjs', `const input = (args.find((a) => a.startsWith('file:')) || 'file:?').slice(5)\nprocess.stderr.write('[in#0 @ 0x5581] Error opening input: Invalid data found when processing input\\nError opening input file ' + input + '.\\n')\nprocess.exit(183)`)
  const { app, p, errs } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360', PX_FFMPEG: fake, PX_FFMPEG_ENCODER: 'libx264' })
  const L = (...a) => launcher(p, ...a)
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    check('les clips de la partie A sont toujours là', (await L('clipsList')).length === 3)
    await filmEvents(p)
    await L('editFilmStart', A.ids)
    const end = await waitEnd(p, 60000)
    check('film raté : dit en clair, avec un texte à copier', end.status === 'failed' && end.message === 'Le film n’a pas pu être fabriqué.' && typeof end.report === 'string', end.message)
    const rep = end.report || ''
    console.log(rep.split('\n').map((l) => '    | ' + l).join('\n'))
    const lines = rep.split('\n')
    check('le texte : appli, moteur, PC, film, puis les essais ratés de chaque encodeur', /^Player X V3 Test \S+ : film raté le \d\d\/\d\d\/\d{4} à \d\d h \d\d$/.test(lines[0]) && /^Moteur : FFmpeg /.test(lines[1]) && /^PC : /.test(lines[2]) && /^Film : 3 plans, [\d,]+ s, 1920 × 1080 à 60 images\/s$/.test(lines[3]) && lines.slice(4).length >= 2 && lines.slice(4).every((l) => /^- \S+, plan \d sur 3 : /.test(l)), lines.slice(3))
    check('le texte : deux plans ratés de suite par encodeur, dans l’ordre (libx264 d’abord)', lines[4].startsWith('- libx264, plan 1 sur 3') && lines[5].startsWith('- libx264, plan 2 sur 3') && lines[6].startsWith('- h264_nvenc, plan 1 sur 3'), lines.slice(4, 8))
    check('le texte ne dit ni le dossier des clips, ni le dossier de session, ni le dossier temporaire', !rep.includes(A.folder) && !rep.includes(dirs.home) && !rep.includes(os.tmpdir() + '/px-film-') && /Error opening input file ….*\.mp4|Error opening input file …/.test(rep), rep.length)
    check('après l’échec : aucun film, rien dans Films, dossier de travail effacé', (await L('clipsList')).length === 3 && listDir(path.join(A.folder, 'Films')).length === 0 && workDirs().length === 0, { films: listDir(path.join(A.folder, 'Films')), dirs: workDirs() })
    check('un nouveau film peut être demandé juste après', (await refusal(L('editFilmStart', A.ids))) === null)
    await waitEnd(p, 60000)
  } catch (e) { fail++; console.log('ECHEC', e.message.split('\n')[0]) } finally { await app.close().catch(() => {}) }
  check('B : aucune erreur dans la page', errs.length === 0, errs.slice(0, 3))
}

async function partC(dirs, A) {
  console.log('--- C. Les encodeurs de la carte graphique ne marchent pas ici : le suivant prend le relais')
  const journal = path.join(dirs.base, 'faux-journal.txt')
  // Les encodeurs de carte graphique et celui de Windows échouent ; « libopenh264 » est joué par le libx264 de la machine.
  const fake = fakeEngine(dirs.base, 'faux-relais.cjs', `const i = args.indexOf('-c:v')\nconst enc = i >= 0 ? args[i + 1] : ''\nrequire('fs').appendFileSync(${JSON.stringify(journal)}, (enc || 'autre') + '\\n')\nif (/^h264_(nvenc|amf|qsv|mf)$/.test(enc)) { process.stderr.write('[' + enc + ' @ 0x1] Cannot load the encoder library\\nError while opening encoder\\n'); process.exit(1) }\nif (enc === 'libopenh264') args[i + 1] = 'libx264'\npass(args)`)
  const { app, p, errs } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360', PX_FFMPEG: fake })
  const L = (...a) => launcher(p, ...a)
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await filmEvents(p)
    await L('editFilmStart', A.ids)
    const end = await waitEnd(p)
    const used = fs.readFileSync(journal, 'utf8').trim().split('\n')
    check('le film est fabriqué quand même', end.status === 'done' && end.shots === 3 && !end.skipped, end)
    check('les quatre premiers encodeurs sont essayés dans l’ordre (deux plans chacun), puis le cinquième fait les trois plans', used.join() === 'h264_nvenc,h264_nvenc,h264_amf,h264_amf,h264_qsv,h264_qsv,h264_mf,h264_mf,libopenh264,libopenh264,libopenh264,copy,autre', used)
    const percents = (await seen(p)).filter((e) => e.status === 'running').map((e) => e.percent)
    check('l’avancement ne recule pas pendant les changements d’encodeur', percents.every((x, i) => i === 0 || x > percents[i - 1]), percents)
    // Le film suivant commence directement par celui qui a marché
    fs.writeFileSync(journal, '')
    await filmEvents(p)
    await L('editFilmStart', A.ids)
    const end2 = await waitEnd(p)
    const used2 = fs.readFileSync(journal, 'utf8').trim().split('\n')
    check('le film suivant commence par l’encodeur qui a marché', end2.status === 'done' && used2.join() === 'libopenh264,libopenh264,libopenh264,copy,autre', used2)
    const films = (await L('clipsList')).filter((c) => c.kind === 'film')
    check('deux films rangés, deux fichiers dans Films, aux noms distincts', films.length === 2 && listDir(path.join(A.folder, 'Films')).length === 2 && new Set(listDir(path.join(A.folder, 'Films'))).size === 2, listDir(path.join(A.folder, 'Films')))
  } catch (e) { fail++; console.log('ECHEC', e.message.split('\n')[0]) } finally { await app.close().catch(() => {}) }
  check('C : aucune erreur dans la page', errs.length === 0, errs.slice(0, 3))
}

;(async () => {
  const dirs = freshDirs('t14')
  const A = await partA(dirs)
  if (A) {
    await partB(dirs, A)
    await partC(dirs, A)
  } else console.log('Parties B et C sautées : la partie A n’a pas fini.')
  console.log(`\n${pass} réussis, ${fail} ratés`)
  process.exit(fail ? 1 : 0)
})()
