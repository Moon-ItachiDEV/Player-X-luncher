// Fusion, déclencheurs, renommage, épingle, découpe, suppression, rétention, fichier disparu, sécurité.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simPost, simRunning, payload, probe, decodeCheck, clockAt, freshDirs, listDir, fs, path } = H

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`) }
const near = (a, b, tol) => Math.abs(a - b) <= tol

;(async () => {
  const dirs = freshDirs('t2')
  const { app, p, errs, logs, proc } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' })
  const L = (...a) => launcher(p, ...a)
  const waitClips = (n, ms = 30000) => until(async () => { const l = await L('clipsList'); return l.length >= n ? l : null }, ms, `${n} clip(s)`)
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    let changes = 0, states = []
    await p.evaluate(() => { window.__c = 0; window.__s = []; window.launcher.onClipsChanged(() => window.__c++); window.launcher.onClipsState((s) => window.__s.push(s)) })
    const s0 = await L('clipsSaveSettings', { before: 6, after: 2, merge: 3 })
    check('réglages enregistrés', s0.before === 6 && s0.after === 2 && s0.merge === 3)
    await simRunning(app, true)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 10, 30000, 'tampon', 500)
    // --- échauffement et joueur observé : rien
    await simPost(app, payload({ mapPhase: 'warmup', kills: 6, rk: 6 }))
    await simPost(app, payload({ mapPhase: 'warmup', kills: 8, rk: 8, rhs: 3 }))
    await simPost(app, payload({ round: 0, phase: 'freezetime' }))
    await simPost(app, payload({ round: 0, phase: 'live' }))
    await simPost(app, payload({ round: 0, phase: 'live', kills: 31, rk: 3, spectating: true }))
    await sleep(500)
    check('échauffement et joueur observé : aucun clip', (await test(app, 'info')).pendings.length === 0)
    // --- fusion : 3 kills espacés de 2 s, dont 2 headshots (triple)
    await simPost(app, payload({ round: 1, phase: 'freezetime', ct: 1, t: 0 }))
    await simPost(app, payload({ round: 1, phase: 'live', ct: 1, t: 0 }))
    const k1 = Date.now()
    await simPost(app, payload({ round: 1, kills: 1, rk: 1, rhs: 1, ct: 1, t: 0 }))
    await sleep(2000)
    await simPost(app, payload({ round: 1, kills: 2, rk: 2, rhs: 1, ct: 1, t: 0 }))
    await sleep(2000)
    await simPost(app, payload({ round: 1, kills: 3, rk: 3, rhs: 2, ct: 1, t: 0 }))
    const k3 = Date.now()
    const pend = (await test(app, 'info')).pendings
    check('fusion : un seul clip en attente', pend.length === 1 && pend[0].kills === 3 && pend[0].headshots === 2 && pend[0].kind === 'multi', pend.map((x) => [x.kind, x.kills, x.headshots]))
    let list = await waitClips(1)
    const triple = list[0]
    check('titre et compteurs du clip fusionné', triple.title === 'Triple' && triple.kind === 'multi' && triple.kills === 3 && triple.headshots === 2 && triple.round === 2 && triple.map === 'de_mirage', { t: triple.title, k: triple.kills, h: triple.headshots, r: triple.round, s: triple.score })
    const folder = (await L('clipsGetSettings')).folder
    const fileOf = () => path.join(folder, listDir(folder).find((n) => n.endsWith('.mp4')))
    const f1 = fileOf()
    check('nom du fichier', /^Counter-Strike 2 \d{4}-\d\d-\d\d \d\d-\d\d-\d\d Triple\.mp4$/.test(path.basename(f1)), path.basename(f1))
    const clockStart = (clockAt(f1, 0, 640, 360) - k1) / 1000, clockEnd = (clockAt(f1, triple.durationS - 0.1, 640, 360) - k3) / 1000
    check('la fenêtre va de before avant le 1er kill à after après le dernier', clockStart <= -5.5 && clockStart >= -8.5 && near(clockEnd, 2, 0.4), { clockStart, clockEnd, d: triple.durationS })
    const pr = probe(f1)
    check('ffprobe : durée finie, deux pistes', near(pr.duration, triple.durationS, 0.05) && pr.streams.length === 2, pr)
    check('décodage complet sans erreur', decodeCheck(f1).ok)
    // --- renommage (avec caractères interdits)
    const renamed = await L('clipsRename', triple.id, 'Mon/clip: "fou"\n..\\..\\évasion')
    const f2 = fileOf()
    check('renommage : titre et fichier, sans sortir du dossier', renamed.title.startsWith('Mon/clip') && path.dirname(f2) === folder && !fs.existsSync(f1) && /Mon clip fou/.test(f2), { title: renamed.title, file: path.basename(f2) })
    const err1 = await L('clipsRename', triple.id, '   ').then(() => null, (e) => String(e))
    check('nom vide refusé', /nom/i.test(err1 || ''), err1)
    // --- épingle
    check('épingle', (await L('clipsPin', triple.id, true)).pinned === true)
    check('épingle retirée', (await L('clipsPin', triple.id, false)).pinned === false)
    // --- découpe
    const dBefore = renamed.durationS
    const cutStart = 3.2, cutEnd = dBefore - 1.1
    const clockKept0 = clockAt(f2, cutEnd - 0.1, 640, 360)
    const trimmed = await L('clipsTrim', triple.id, cutStart, cutEnd)
    const f3 = fileOf()
    const pr3 = probe(f3)
    check('découpe : nouveau fichier plus court, même identifiant et même chemin', f3 === f2 && trimmed.id === triple.id && trimmed.durationS < dBefore && trimmed.sizeBytes < renamed.sizeBytes && near(pr3.duration, trimmed.durationS, 0.05), { avant: dBefore, après: trimmed.durationS, ffprobe: pr3.duration })
    check('découpe : commence sur une image clé avant le début demandé', trimmed.durationS >= cutEnd - cutStart && trimmed.durationS <= cutEnd - cutStart + 2.3, { demandé: cutEnd - cutStart, obtenu: trimmed.durationS })
    const clockKept1 = clockAt(f3, trimmed.durationS - 0.1, 640, 360)
    check('découpe : même dernière image', near(clockKept1, clockKept0, 150), { écart: clockKept1 - clockKept0 })
    check('découpe : décodage complet sans erreur', decodeCheck(f3).ok)
    const seek = await p.evaluate(async (url) => {
      const v = document.createElement('video'); v.muted = true; v.src = url; document.body.appendChild(v)
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('erreur video')); setTimeout(() => rej(new Error('délai')), 10000) })
      const d = v.duration
      await new Promise((res, rej) => { v.onseeked = res; v.onerror = () => rej(new Error('erreur seek')); v.currentTime = d * 0.7; setTimeout(() => rej(new Error('délai seek')), 10000) })
      const at = v.currentTime; v.remove(); return { d, at }
    }, trimmed.videoUrl)
    check('découpe : durée et avance rapide dans video', near(seek.d, trimmed.durationS, 0.1) && near(seek.at, seek.d * 0.7, 0.05), seek)
    const again = await L('clipsTrim', triple.id, 0, 1.5)
    check('deuxième découpe (MP4 déjà coupé)', again.durationS >= 1.4 && decodeCheck(f3).ok && near(probe(f3).duration, again.durationS, 0.05), { d: again.durationS, p: probe(f3).streams })
    const err2 = await L('clipsTrim', triple.id, 5, 5.1).then(() => null, (e) => String(e))
    check('découpe trop courte refusée', /Découpe invalide/.test(err2 || ''), err2)
    // --- suite : un clip par kill séparé (écart > merge)
    await L('clipsSaveSettings', { merge: 1 })
    await simPost(app, payload({ round: 2, phase: 'freezetime', kills: 3 }))
    await simPost(app, payload({ round: 2, phase: 'live', kills: 3 }))
    await simPost(app, payload({ round: 2, kills: 4, rk: 1 }))
    await sleep(2500)
    await simPost(app, payload({ round: 2, kills: 5, rk: 2, rhs: 1 }))
    list = await waitClips(3)
    check('hors de la fenêtre de fusion : deux clips', list.length === 3, list.map((c) => c.title))
    // --- déclencheur coupé
    await L('clipsSaveSettings', { triggers: { kill: false } })
    await simPost(app, payload({ round: 3, phase: 'freezetime', kills: 5 }))
    await simPost(app, payload({ round: 3, phase: 'live', kills: 5 }))
    await simPost(app, payload({ round: 3, kills: 6, rk: 1 }))
    await sleep(300)
    check('déclencheur kill coupé : pas de clip', (await test(app, 'info')).pendings.length === 0)
    await simPost(app, payload({ round: 3, kills: 7, rk: 2, rhs: 1 }))
    await sleep(300)
    check('headshot encore actif', (await test(app, 'info')).pendings.length === 1)
    await waitClips(4)
    // --- mort, si réglée
    await L('clipsSaveSettings', { triggers: { kill: true, death: true } })
    await simPost(app, payload({ round: 4, phase: 'freezetime', kills: 7 }))
    await simPost(app, payload({ round: 4, phase: 'live', kills: 7 }))
    await simPost(app, payload({ round: 4, kills: 7, health: 0, deaths: 1 }))
    await simPost(app, payload({ round: 4, kills: 31, spectating: true }))
    await sleep(300)
    const deaths = (await test(app, 'info')).pendings
    check('mort réglée : un clip « Mort »', deaths.length === 1 && deaths[0].kind === 'death', deaths.map((x) => x.kind))
    list = await waitClips(5)
    check('titre Mort', list[0].title === 'Mort', list[0].title)
    // --- ace
    await L('clipsSaveSettings', { triggers: { death: false } })
    await simPost(app, payload({ round: 5, phase: 'freezetime', kills: 7 }))
    await simPost(app, payload({ round: 5, phase: 'live', kills: 7 }))
    await simPost(app, payload({ round: 5, kills: 12, rk: 5, rhs: 4 }))
    list = await waitClips(6)
    check('ace d’un coup', list[0].title === 'Ace' && list[0].kills === 5 && list[0].headshots === 4, { t: list[0].title, k: list[0].kills })
    // --- manuel
    check('clip manuel accepté', (await test(app, 'saveNow')) === true)
    list = await waitClips(7)
    check('titre manuel, carte du match en cours', list[0].title === 'Clip manuel' && list[0].kind === 'manual', { t: list[0].title, map: list[0].map, round: list[0].round })
    // --- vignettes
    await sleep(500)
    const thumbs = listDir(path.join(dirs.userData, 'clips-thumbs'))
    check('une vignette par clip', list.every((c) => thumbs.includes(`${c.id}.jpg`)), thumbs.length)
    // --- événements
    check('onClipsChanged reçu', (await p.evaluate(() => window.__c)) > 5, await p.evaluate(() => window.__c))
    check('onClipsState reçu', (await p.evaluate(() => window.__s.length)) > 2, (await p.evaluate(() => window.__s.slice(-1)[0])))
    // --- fichier disparu
    const victim = list[1]
    const victimName = listDir(folder).find((n) => n.includes(victim.title) && n.endsWith('.mp4'))
    fs.unlinkSync(path.join(folder, victimName))
    const listed = await L('clipsList')
    check('fichier disparu : retiré au listage', !listed.some((c) => c.id === victim.id) && listed.length === list.length - 1, victimName)
    const stored = await app.evaluate(() => 0)
    // --- suppression
    const del = listed[0]
    check('suppression', (await L('clipsDelete', del.id)) === true && !(await L('clipsList')).some((c) => c.id === del.id) && !listDir(path.join(dirs.userData, 'clips-thumbs')).includes(`${del.id}.jpg`))
    check('suppression : identifiant inconnu ou chemin refusés', (await L('clipsDelete', 'deadbeefdeadbeef')) === false && (await L('clipsDelete', '../../etc/passwd')) === false)
    check('pxclip après suppression : 404', (await app.evaluate(async ({ session }, u) => (await session.defaultSession.fetch(u)).status, del.videoUrl)) === 404)
    // --- rétention : limite à 10 Mo, le plus vieux épinglé reste
    let cur = await L('clipsList')
    const oldest = cur[cur.length - 1]
    await L('clipsPin', oldest.id, true)
    const total = cur.reduce((n, c) => n + c.sizeBytes, 0)
    console.log('total avant rétention', total, cur.map((c) => [c.title, c.sizeBytes, c.pinned]))
    await L('clipsSaveSettings', { limitGb: oldest.sizeBytes / 1024 ** 3 + 0.0001 + cur[0].sizeBytes / 1024 ** 3 })
    await sleep(1000)
    let after = await L('clipsList')
    check('rétention : on repasse sous la limite, les plus vieux partent, l’épinglé reste', after.some((c) => c.id === oldest.id) && after.length < cur.length && after.reduce((n, c) => n + c.sizeBytes, 0) <= oldest.sizeBytes + cur[0].sizeBytes + 0.0001 * 1024 ** 3, after.map((c) => [c.title, c.pinned]))
    const onDisk = listDir(folder).filter((n) => n.endsWith('.mp4')).length
    check('rétention : fichiers vraiment supprimés', onDisk === after.length, { onDisk, listed: after.length })
    // --- fetch depuis la page, en CORS
    const pf = await p.evaluate(async (url) => { try { const r = await fetch(url, { headers: { Range: 'bytes=0-9' } }); return [r.status, r.headers.get('content-range'), (await r.arrayBuffer()).byteLength] } catch (e) { return String(e) } }, after[0].videoUrl)
    check('fetch depuis la page', pf[0] === 206 && pf[2] === 10, pf)
    // --- sécurité
    const gdm = await p.evaluate(async () => { try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true }); s.getTracks().forEach((t) => t.stop()); return 'accordé' } catch (e) { return e.name } })
    check('la fenêtre principale n’a pas accès à l’écran', gdm !== 'accordé', gdm)
    const gum = await p.evaluate(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); return 'accordé' } catch (e) { return e.name } })
    check('la fenêtre principale n’a pas accès au micro', gum !== 'accordé', gum)
    const hk = await L('clipsSaveSettings', { hotkey: 'K' }).then(() => null, (e) => String(e))
    check('raccourci sans modificateur refusé', /Ajoute Ctrl ou Alt/.test(hk || ''), hk)
    const hk2 = await L('clipsSaveSettings', { hotkey: 'Alt+X' }).then(() => null, (e) => String(e))
    check('raccourci de l’overlay refusé', /déjà/.test(hk2 || ''), hk2)
    const set = await L('clipsSaveSettings', { hotkey: 'Alt+J', folder: '/etc' })
    const inf = await test(app, 'info')
    check('raccourci changé et pris ; dossier jamais reçu de la page', set.hotkey === 'Alt+J' && inf.hotkey === 'Alt+J' && inf.hotkeyRegistered && set.folder === folder, { hk: inf.hotkey, folder: set.folder })
    check('copie du fichier : false hors de Windows', (await L('clipsCopyFile', after[0].id)) === false)
    check('écrans', (await L('clipsDisplays')).length >= 1)
    check('journal', (await L('clipsLogTail')).split('\n').length <= 40)
    // --- réglage coupé : tout s'arrête
    await L('clipsSaveSettings', { enabled: false })
    await until(async () => (await L('clipsState')).status === 'off' && !(await test(app, 'info')).capture, 8000, 'arrêt')
    await sleep(500)
    check('réglage coupé : capture arrêtée, fenêtre fermée, raccourci rendu, tampon vide', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1 && !(await test(app, 'info')).hotkey && listDir(path.join(dirs.userData, 'clips-buffer')).length === 0)
    await L('clipsSaveSettings', { enabled: true })
    await until(async () => (await L('clipsState')).status === 'recording', 8000, 'reprise')
    check('réglage remis : la capture repart', true)
    check('pas d’erreur dans la page', errs.length === 0, errs)
  } catch (e) {
    fail++
    console.log('ÉCHEC', e)
    console.log(logs.join('').split('\n').filter((l) => /clips|Error/.test(l)).slice(-30).join('\n'))
  } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    await Promise.race([app.close(), sleep(12000)])
    console.log('sortie', proc.exitCode, proc.signalCode)
    try { proc.kill('SIGKILL') } catch {}
    process.exit(fail ? 1 : 0)
  }
})()
