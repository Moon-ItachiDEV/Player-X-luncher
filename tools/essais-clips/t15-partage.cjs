// Bêta 46, lot Partage, de bout en bout sous Linux : de vrais clips filmés par l'appli (source d'essai 640 × 360, environ
// 30 images/s), de vraies copies fabriquées par le ffmpeg de la machine (PX_FFMPEG) avec libx264.
// A. Le rythme réel des clips : une partie en qualité légère (30 images/s demandées : rien à dire), une partie en qualité
//    équilibrée (60 demandées : la source en donne 30, les clips sont lents), la note du clip dans la page, le bilan de la
//    partie, le message de fin de partie (une fois), la ligne de Paramètres, une coupe qui a son propre rythme.
// B. Copier pour Discord : l'original quand il passe, une copie légère sinon (vraie vidéo, sous la limite, l'original
//    intact), la reprise d'une copie déjà faite, le renommage, le refus d'un clip trop long, deux copies à la fois, une
//    copie pendant une partie, une copie refusée pendant un film, le bouton et ses messages, le réglage « Mon Discord »,
//    l'effacement avec le clip.
// C. Après une relance : le ménage, le réglage gardé, le moteur absent, des encodeurs qui ratent (le suivant prend le relais
//    et il est retenu), une copie toujours trop lourde (second essai plus bas, puis abandon), un film et un essai du moteur
//    refusés pendant une copie, avec la bonne raison.
// Les clips d'essai pèsent 1 à 3 Mo : la limite de Discord est imposée par PX_CLIP_TEST_SHARE_MB (développement seulement).
// Le moteur Windows livré (FFmpeg 9.0.2), NVENC et AMF ne tournent jamais ici : ce qu'ils donnent se voit sur le PC de Breezydev.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simPost, simRunning, payload, probe, decodeCheck, freshDirs, listDir, fs, path } = H
const crypto = require('crypto')

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined && !ok ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`) }
const note = (s) => console.log(`    ${s}`)
const FF = process.env.PX_T15_FFMPEG || '/usr/bin/ffmpeg'
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360', PX_FFMPEG: FF, PX_FFMPEG_ENCODER: 'libx264', PX_CLIP_TEST_COPY: '1' }
// Le message tel que la page le reçoit, sans ce qu'ajoutent Playwright et Electron devant.
const refusal = (promise) => promise.then(() => null, (e) => String(e.message || e).replace(/^page\.evaluate: (Error: )?/, '').replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
const setEnv = (app, k, v) => app.evaluate((_e, [k, v]) => { if (v === null) delete process.env[k]; else process.env[k] = v }, [k, v])
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const near = (a, b, tol) => Math.abs(a - b) <= tol
const info = (app) => test(app, 'info')
const shareRoot = (dirs) => path.join(dirs.userData, 'clips-share')
const journal = (dirs) => { try { return fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8') } catch { return '' } }
const inJournal = (dirs, what, ms = 4000) => until(() => (typeof what === 'string' ? journal(dirs).includes(what) : what.test(journal(dirs))), ms, `journal : ${what}`).then(() => true, () => false)
/** La limite (en Mo, 3 décimales) qui laisse ce débit, son compris, à chacun de ces clips : la règle de l'appli, refaite ici. */
const limitAt = (clips, bps) => Math.floor(Math.min(...clips.map((c) => (bps * Math.max(1, c.durationS)) / 8 / 0.94)) / 1000) / 1000
const useLimit = async (app, mb) => { await setEnv(app, 'PX_CLIP_TEST_SHARE_MB', mb === null ? null : String(mb)); return mb === null ? null : Math.round(mb * 1e6) }
/** Le plus long clip de 640 × 360 à 30 images/s qui tient sous cette limite : 680 kb/s pour l'image, 96 kb/s pour le son. */
const maxSAt = (limit) => Math.floor((limit * 0.94 * 8) / (680_000 + 96_000))

// ---------- la page ----------

/** La page sans l'accueil du premier lancement, et un relevé de chaque message affiché. */
async function preparePage(app, p) {
  await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
  await p.evaluate(() => { try { localStorage.setItem('pxv3-setup', '1') } catch { /* */ } })
  await p.reload()
  await p.waitForLoadState('domcontentloaded')
  await until(() => p.evaluate(() => typeof Clips !== 'undefined' && typeof Settings !== 'undefined' && !!document.getElementById('toasts') && !!Real.clipsCfg).catch(() => false), 20000, 'page prête')
  await p.evaluate(() => {
    window.__toasts = []
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || !n.classList.contains('toast')) continue
        const a = n.querySelector('.toast-a')
        window.__toasts.push({ text: [...n.childNodes].filter((x) => x !== a).map((x) => x.textContent).join('').trim(), tone: n.className, action: a ? a.textContent : null })
      }
    }).observe(document.getElementById('toasts'), { childList: true })
  })
}
const toasts = (p) => p.evaluate(() => window.__toasts)
const waitToast = (p, re, from, ms = 30000) => until(async () => (await toasts(p)).slice(from).find((t) => re.test(t.text)), ms, `message ${re}`, 200)
const clickToast = (p, re) => p.evaluate((src) => { const r = new RegExp(src); const t = [...document.querySelectorAll('#toasts .toast')].find((x) => r.test(x.textContent)); t?.querySelector('.toast-a')?.click(); return !!t }, re.source)
const bytesText = (p, n) => p.evaluate((x) => Shared.steamUpdate.formatBytes(x), n)

async function openPlayer(p, id) {
  await p.evaluate(() => { if (Settings && document.querySelector('[data-modal]:not([hidden])')) Settings.close(); if (Clips.isOpen()) Clips.close() })
  await sleep(500)
  await p.evaluate((x) => Clips.open(x), id)
  await until(() => p.evaluate(() => !!document.getElementById('cpShare') && Clips.isOpen()), 8000, 'lecteur ouvert', 150)
  await sleep(600)
  // Le texte du bouton, à chaque changement
  await p.evaluate(() => { window.__labels = []; const s = document.querySelector('#cpShare span'); new MutationObserver(() => window.__labels.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true }) })
}
const labels = (p) => p.evaluate(() => window.__labels)
const buttonText = (p) => p.evaluate(() => document.querySelector('#cpShare span')?.textContent)

// ---------- les clips ----------

const clipsOnly = async (L) => (await L('clipsList')).filter((c) => c.kind !== 'film')
const waitClips = (L, n, ms = 45000) => until(async () => { const l = await clipsOnly(L); return l.length >= n ? l : null }, ms, `${n} clip(s)`)

/** Une partie de CS2 : un kill, puis un clip gardé à la main, puis la fin de la partie et son bilan. */
async function playGame(app, L, quality) {
  await L('clipsSaveSettings', { before: 6, after: 2, merge: 3, quality })
  const before = await clipsOnly(L)
  const at0 = (await L('clipsState')).lastGame?.at || 0
  await simRunning(app, true)
  await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 10, 30000, 'tampon', 500)
  await simPost(app, payload({ round: 1, phase: 'freezetime' }))
  await simPost(app, payload({ round: 1, phase: 'live' }))
  await simPost(app, payload({ round: 1, kills: 1, rk: 1, rhs: 1 }))
  await waitClips(L, before.length + 1)
  await sleep(4000)
  await test(app, 'saveNow')
  const all = await waitClips(L, before.length + 2)
  // Pendant la partie, le bilan reste celui de la partie d'avant
  const during = (await L('clipsState')).lastGame
  await simRunning(app, false)
  await until(async () => (await L('clipsState')).status !== 'recording', 20000, 'fin de la partie', 300)
  const lastGame = await until(async () => { const g = (await L('clipsState')).lastGame; return g && g.at > at0 ? g : null }, 20000, 'bilan de la partie', 300)
  const old = new Set(before.map((c) => c.id))
  return { clips: all.filter((c) => !old.has(c.id)).sort((a, b) => a.at - b.at), lastGame, duringAt: during?.at || 0, at0 }
}

/** Le chemin d'un clip : on le « copie » avec une limite de 500 Mo, et l'appli dit quel fichier elle a mis dans le presse-papiers. */
async function fileOf(app, L, id) {
  const prev = await app.evaluate(() => process.env.PX_CLIP_TEST_SHARE_MB ?? null)
  await setEnv(app, 'PX_CLIP_TEST_SHARE_MB', '500')
  const r = await L('clipsShare', id)
  const f = (await info(app)).copied
  await setEnv(app, 'PX_CLIP_TEST_SHARE_MB', prev)
  if (r.status !== 'copied' || r.reduced || !f) throw new Error(`fichier du clip ${id} introuvable`)
  return f
}

function paceCheck(name, c, file, wanted) {
  const pr = probe(file)
  const v = pr.streams.find((s) => s.type === 'video')
  const real = v.packets / pr.duration
  note(`${name} : ${c.pace?.fps} images/s (2 s les plus lentes : ${c.pace?.low}), ffprobe : ${v.packets} images en ${pr.duration.toFixed(2)} s, soit ${real.toFixed(1)}`)
  check(`${name} : le rythme réel est noté sur le clip (${wanted} images/s demandées)`, !!c.pace && c.pace.wanted === wanted && near(c.pace.fps, real, 1) && c.pace.low >= 0 && c.pace.low <= c.pace.fps, { pace: c.pace, real })
}

// ---------- A. le rythme réel des clips ----------

async function partA(dirs) {
  console.log('--- A. Le rythme réel des clips, sur deux parties')
  const { app, p, errs } = await start(dirs, ENV)
  const L = (...a) => launcher(p, ...a)
  let out = null
  try {
    await preparePage(app, p)
    check('profil neuf : aucun bilan de partie', !(await L('clipsState')).lastGame)
    // ----- partie 1 : qualité légère, 30 images/s demandées
    const g1 = await playGame(app, L, 'light')
    const [a1, a2] = g1.clips
    const fa1 = await fileOf(app, L, a1.id), fa2 = await fileOf(app, L, a2.id)
    paceCheck('partie 1, clip du kill', a1, fa1, 30)
    paceCheck('partie 1, clip gardé à la main', a2, fa2, 30)
    check('partie 1 : aucun clip lent (seuil 25 pour 30 demandées)', g1.clips.every((c) => c.pace && c.pace.fps >= 25), g1.clips.map((c) => c.pace))
    const exp1 = Math.round((g1.clips.reduce((n, c) => n + c.pace.fps * c.durationS, 0) / g1.clips.reduce((n, c) => n + c.durationS, 0)) * 10) / 10
    check('bilan de la partie 1 : 2 clips, aucun lent, la moyenne pondérée par la durée', g1.lastGame.clips === 2 && g1.lastGame.slow === 0 && g1.lastGame.wanted === 30 && /Counter-Strike/.test(g1.lastGame.game) && near(g1.lastGame.fps, exp1, 0.05), { got: g1.lastGame, exp1 })
    check('le journal dit le rythme de chaque clip', await inJournal(dirs, new RegExp(`Clip ${a1.id}.*images/s \\(2 s les plus lentes : [\\d,]+\\)`)), journal(dirs).split('\n').filter((l) => l.includes(a1.id)).slice(0, 3))
    await sleep(1500)
    check('fin de la partie 1 : aucun message (rien à signaler)', !(await toasts(p)).some((t) => /Partie finie/.test(t.text)), await toasts(p))
    await p.evaluate(() => Settings.go('rec', 'r-capm'))
    await until(() => p.evaluate(() => !!document.querySelector('#r-capm')), 5000, 'Paramètres')
    const line1 = await p.evaluate(() => ({ text: document.querySelector('#r-capm .sr-t > span')?.textContent, alert: !!document.querySelector('#r-capm em.rc-err') }))
    check('Paramètres : « Dernière partie : N images/s dans tes clips. », sans couleur d’alerte', (line1.text || '').endsWith(`Dernière partie : ${Math.round(g1.lastGame.fps)} images/s dans tes clips.`) && !line1.alert, line1)
    await p.evaluate(() => Settings.close())
    // ----- partie 2 : qualité équilibrée, 60 images/s demandées ; la source d'essai n'en donne que 30
    const n2 = (await toasts(p)).length
    const g2 = await playGame(app, L, 'balanced')
    const [b1, b2] = g2.clips
    const fb1 = await fileOf(app, L, b1.id), fb2 = await fileOf(app, L, b2.id)
    paceCheck('partie 2, clip du kill', b1, fb1, 60)
    paceCheck('partie 2, clip gardé à la main', b2, fb2, 60)
    check('pendant la partie 2, le bilan affiché reste celui de la partie 1', g2.duringAt === g2.at0 && g2.at0 === g1.lastGame.at)
    check('bilan de la partie 2 : 2 clips, 2 lents', g2.lastGame.clips === 2 && g2.lastGame.slow === 2 && g2.lastGame.wanted === 60, g2.lastGame)
    const t2 = await waitToast(p, /Partie finie/, n2, 8000).catch(() => null)
    check('fin de la partie 2 : un message, en alerte, avec « Voir les réglages »', !!t2 && t2.text === 'Partie finie : 2 clips sur 2 sous 50 images/s.' && /warn/.test(t2.tone) && t2.action === 'Voir les réglages', t2)
    // Le bouton du message ouvre Paramètres sur la ligne de la capture
    check('« Voir les réglages » ouvre Paramètres', await clickToast(p, /Partie finie/))
    await until(() => p.evaluate(() => !!document.querySelector('#r-capm em.rc-err')), 5000, 'ligne du rythme').catch(() => null)
    const line2 = await p.evaluate(() => document.querySelector('#r-capm em.rc-err')?.textContent)
    check('Paramètres : « Dernière partie : 2 clips sur 2 sous 50 images/s. », en couleur d’alerte', line2 === 'Dernière partie : 2 clips sur 2 sous 50 images/s.', line2)
    await p.evaluate(() => Settings.close())
    // D'autres changements d'état ne refont pas le message
    await L('clipsSaveSettings', { merge: 4 })
    await L('clipsSaveSettings', { merge: 3 })
    await sleep(1500)
    check('le message ne revient pas', (await toasts(p)).filter((t) => /Partie finie/.test(t.text)).length === 1)
    // ----- la note sur le clip, dans la liste et dans le lecteur
    await p.evaluate(() => go('clips'))
    await until(() => p.evaluate((id) => !!document.querySelector(`.ct-tile[data-id="${id}"]`), b1.id), 8000, 'liste des clips')
    const subs = await p.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, document.querySelector(`.ct-tile[data-id="${id}"] .ct-t > span`)?.textContent])), [a1.id, a2.id, b1.id, b2.id])
    const slowTxt = (c) => `Filmé à ${Math.floor(c.pace.fps)} images/s`
    check('liste : les clips lents le disent en premier, les autres non', subs[b1.id]?.startsWith(`${slowTxt(b1)} · `) && subs[b2.id]?.startsWith(`${slowTxt(b2)} · `) && !/Filmé/.test(subs[a1.id] || 'x') && !/Filmé/.test(subs[a2.id] || 'x'), subs)
    await openPlayer(p, b1.id)
    const det = await p.evaluate(() => document.querySelector('.cp-slow')?.textContent)
    check('lecteur d’un clip lent : la note sous ses détails', det === slowTxt(b1), det)
    await openPlayer(p, a1.id)
    check('lecteur d’un clip normal : aucune note', await p.evaluate(() => !document.querySelector('.cp-slow')))
    await p.evaluate(() => Clips.close())
    // ----- une coupe a son propre rythme
    const cut = await L('clipsTrim', b1.id, 2.5, b1.durationS - 0.4)
    const fcut = await fileOf(app, L, cut.id)
    check('la coupe est un nouveau clip, plus court', cut.id !== b1.id && cut.durationS < b1.durationS - 0.1, { cut: cut.durationS, b1: b1.durationS })
    paceCheck('la coupe', cut, fcut, 60)
    out = { a1, a2, b1, b2, cut, files: { [a1.id]: fa1, [a2.id]: fa2, [b1.id]: fb1, [b2.id]: fb2, [cut.id]: fcut } }
  } catch (e) { fail++; console.log('ECHEC', e.message.split('\n')[0]) } finally { await app.close().catch(() => {}) }
  check('A : aucune erreur dans la page', errs.length === 0, errs.slice(0, 3))
  return out
}

// ---------- B. copier pour Discord ----------

async function partB(dirs, A) {
  console.log('--- B. Copier pour Discord, avec le ffmpeg de la machine')
  const { app, p, errs } = await start(dirs, ENV)
  const L = (...a) => launcher(p, ...a)
  const root = shareRoot(dirs)
  const { a1, a2, b1, b2, cut } = A
  const made = {}
  let out = null
  try {
    await preparePage(app, p)
    const folder = (await L('clipsGetSettings')).folder
    const rate = (c) => (fs.statSync(A.files[c.id]).size * 8) / c.durationS
    note(`débit des clips : ${[a1, a2, b1, b2, cut].map((c) => `${(rate(c) / 1e6).toFixed(2)} Mb/s`).join(', ')}`)
    check('les clips de la partie 2 sont assez lourds pour demander une copie (plus de 1,3 Mb/s)', [b1, b2, cut].every((c) => rate(c) > 1.3e6))
    // ----- B1. sous la limite du compte (20 Mo par défaut) : le clip lui-même
    check('réglage par défaut : « Sans Nitro »', (await L('clipsGetSettings')).discord === 'free')
    const r1 = await L('clipsShare', a1.id)
    const f1 = (await info(app)).copied
    check('sous 20 Mo : le clip lui-même dans le presse-papiers, sans copie', r1.status === 'copied' && !r1.reduced && r1.limitMb === 20 && f1 === A.files[a1.id] && r1.sizeBytes === fs.statSync(f1).size && f1.startsWith(folder) && listDir(root).length === 0, { r1, f1, share: listDir(root) })
    // ----- B2. au-dessus de la limite : une copie légère
    const mb2 = limitAt([b1], 1_200_000), lim2 = await useLimit(app, mb2)
    const src = A.files[b1.id]
    const orig = { size: fs.statSync(src).size, mtime: fs.statSync(src).mtimeMs, sha: sha(src) }
    await p.evaluate(() => { window.__share = []; window.__offShare?.(); window.__offShare = window.launcher.onClipsShare((s) => window.__share.push(s)) })
    const t0 = Date.now()
    const r2 = await L('clipsShare', b1.id)
    note(`copie de ${b1.durationS.toFixed(1)} s en ${((Date.now() - t0) / 1000).toFixed(1)} s, ${r2.sizeBytes} octets pour une limite de ${lim2} (clip de ${orig.size})`)
    const f2 = (await info(app)).copied
    const dir2 = path.join(root, `${b1.id}-${lim2}`)
    check('copie légère : 640 × 360 à 30 images/s, sous la limite', r2.status === 'copied' && r2.reduced?.width === 640 && r2.reduced?.height === 360 && r2.reduced?.fps === 30 && r2.sizeBytes <= lim2 && r2.limitMb === mb2, r2)
    check('la copie : dans son dossier à part, au nom du clip, seule avec sa note', f2 === path.join(dir2, path.basename(src)) && fs.statSync(f2).size === r2.sizeBytes && listDir(dir2).sort().join() === [path.basename(src), 'copie.json'].sort().join(), { f2, files: listDir(dir2) })
    const pr1 = probe(src), pr2 = probe(f2)
    const v2 = pr2.streams.find((s) => s.type === 'video'), au2 = pr2.streams.find((s) => s.type === 'audio')
    check('la copie est une vraie vidéo : H.264 640 × 360, son AAC, même durée, 30 images/s, lisible jusqu’au bout', v2?.codec === 'h264' && v2.w === 640 && v2.h === 360 && au2?.codec === 'aac' && near(pr2.duration, pr1.duration, 0.5) && near(v2.packets / pr2.duration, 30, 1.5) && decodeCheck(f2).ok, pr2)
    check('le clip d’origine n’a pas bougé (poids, date, contenu)', fs.statSync(src).size === orig.size && fs.statSync(src).mtimeMs === orig.mtime && sha(src) === orig.sha)
    const n2 = JSON.parse(fs.readFileSync(path.join(dir2, 'copie.json'), 'utf8'))
    check('la note de la copie dit d’où elle vient', n2.v === 1 && n2.file === path.basename(src) && n2.srcSize === orig.size && n2.srcMtimeMs === orig.mtime && n2.sizeBytes === r2.sizeBytes && n2.width === 640 && n2.height === 360 && n2.fps === 30, n2)
    const steps = await p.evaluate(() => window.__share)
    const pcts = steps.map((s) => s.percent)
    check('l’avancement arrive à la page : il monte, sans jamais dépasser 99', steps.length >= 1 && steps.every((s) => s.id === b1.id) && pcts.every((x, i) => Number.isInteger(x) && x > 0 && x <= 99 && (i === 0 || x > pcts[i - 1])) && pcts[pcts.length - 1] >= 90, pcts)
    check('le journal dit la copie : taille, cadence, poids, limite, encodeur', await inJournal(dirs, new RegExp(`Copie pour Discord du clip ${b1.id} : 640 × 360 à 30 images/s, [\\d,]+ Mo \\(limite [\\d,]+ Mo, clip de [\\d,]+ Mo\\), libx264, [\\d.]+ s\\.`)))
    made.b1 = dir2
    // ----- B3. la même demande : la copie déjà faite resert
    const m2 = fs.statSync(f2).mtimeMs
    await p.evaluate(() => { window.__share = [] })
    const t3 = Date.now()
    const r3 = await L('clipsShare', b1.id)
    const took3 = Date.now() - t3
    check('la même demande : la copie déjà faite resert, sans refabriquer', r3.status === 'copied' && r3.sizeBytes === r2.sizeBytes && JSON.stringify(r3.reduced) === JSON.stringify(r2.reduced) && (await info(app)).copied === f2 && fs.statSync(f2).mtimeMs === m2 && (await p.evaluate(() => window.__share.length)) === 0 && took3 < 2000, { took3 })
    check('… et le journal dit « déjà faite »', await inJournal(dirs, `Copie pour Discord du clip ${b1.id} : déjà faite`))
    // ----- B4. le clip est renommé : la copie suit son nom
    await L('clipsRename', b1.id, 'Partage Discord')
    const src4 = await fileOf(app, L, b1.id)
    await useLimit(app, mb2)
    const r4 = await L('clipsShare', b1.id)
    const f4 = (await info(app)).copied
    check('clip renommé : la copie reprise prend son nouveau nom', src4 !== src && r4.status === 'copied' && f4 === path.join(dir2, path.basename(src4)) && fs.existsSync(f4) && !fs.existsSync(f2) && JSON.parse(fs.readFileSync(path.join(dir2, 'copie.json'), 'utf8')).file === path.basename(src4) && / Partage Discord\.mp4$/.test(f4), { f4 })
    A.files[b1.id] = src4
    // ----- B5. trop long, même en petit
    const mb5 = limitAt([b1], 500_000), lim5 = await useLimit(app, mb5)
    const r5 = await L('clipsShare', b1.id)
    check('trop long pour la limite : rien n’est copié, la durée qui tient est donnée', r5.status === 'too-long' && r5.maxS === maxSAt(lim5) && r5.limitMb === mb5 && r5.sizeBytes === orig.size && (await info(app)).copied === f4 && !fs.existsSync(path.join(root, `${b1.id}-${lim5}`)), { r5, exp: maxSAt(lim5) })
    // ----- B6. deux copies demandées en même temps
    const mb6 = limitAt([b1, b2], 1_150_000)
    await useLimit(app, mb6)
    const both = await p.evaluate(async (ids) => (await Promise.allSettled(ids.map((id) => window.launcher.clipsShare(id)))).map((r) => (r.status === 'fulfilled' ? { ok: r.value } : { err: String(r.reason?.message || r.reason) })), [b1.id, b2.id])
    check('deux copies en même temps : l’une se fait, l’autre est refusée en clair', both.filter((r) => r.ok?.status === 'copied' && r.ok.reduced).length === 1 && both.filter((r) => /Une copie est déjà en préparation\./.test(r.err || '')).length === 1, both)
    // ----- B7. pendant une partie
    await simRunning(app, true)
    await until(async () => (await L('clipsState')).status === 'recording', 20000, 'partie', 300)
    const mb7 = limitAt([b2], 1_100_000), lim7 = await useLimit(app, mb7)
    const r7 = await L('clipsShare', b2.id)
    check('pendant une partie : la copie se fait quand même', r7.status === 'copied' && !!r7.reduced && r7.sizeBytes <= lim7, r7)
    made.b2Game = path.join(root, `${b2.id}-${lim7}`)
    await simRunning(app, false)
    await until(async () => (await L('clipsState')).status !== 'recording', 20000, 'fin de la partie', 300)
    // ----- B8. pendant un film : refusée en clair, et le film finit
    const mb8 = limitAt([b2], 1_050_000)
    await useLimit(app, mb8)
    const film = await L('editFilmStart', [a2.id])
    const r8 = await refusal(L('clipsShare', b2.id))
    check('pendant un film : la copie est refusée en clair', film.status === 'running' && r8 === 'Le moteur vidéo est occupé (un film ou un essai). Réessaie après.', { film: film.status, r8 })
    const endFilm = await until(async () => { const s = await L('editFilmState'); return s.status !== 'running' ? s : null }, 300000, 'fin du film', 500)
    check('… et le film finit quand même', endFilm.status === 'done', endFilm.status)
    // Un film (1920 × 1080 à 60 images/s, fabriqué par le moteur) : la copie descend en 720p et garde ses 60 images/s
    const filmClip = (await L('clipsList')).find((c) => c.id === endFilm.clipId)
    const fFilm = await fileOf(app, L, filmClip.id)
    const mbF = limitAt([filmClip], 5_000_000), limF = await useLimit(app, mbF)
    const rF = await L('clipsShare', filmClip.id)
    const prF = rF.status === 'copied' ? probe((await info(app)).copied) : null
    const vF = prF?.streams.find((s) => s.type === 'video')
    note(`film de ${filmClip.durationS.toFixed(1)} s, ${fs.statSync(fFilm).size} octets ; copie de ${rF.sizeBytes} octets pour une limite de ${limF}`)
    check('un film trop lourd : copie en 1280 × 720 à 60 images/s, sous la limite, lisible', rF.status === 'copied' && rF.reduced?.width === 1280 && rF.reduced?.height === 720 && rF.reduced?.fps === 60 && rF.sizeBytes <= limF && vF?.w === 1280 && vF?.h === 720 && near(vF.packets / prF.duration, 60, 2) && decodeCheck((await info(app)).copied).ok, { rF, prF })
    // ----- B9. le bouton du lecteur
    const mb9 = limitAt([b2], 1_000_000), lim9 = await useLimit(app, mb9)
    await openPlayer(p, b2.id)
    let from = (await toasts(p)).length
    await p.evaluate(() => document.getElementById('cpShare').click())
    const t9 = await waitToast(p, /presse-papiers/, from)
    const f9 = (await info(app)).copied
    const l9 = await labels(p)
    const w9 = await bytesText(p, fs.statSync(f9).size)
    check('le bouton : « Copie… », puis l’avancement, puis « Prêt : Ctrl V dans Discord »', l9[0] === 'Copie…' && l9.some((x) => /^Préparation… \d+ %$/.test(x)) && l9.includes('Prêt : Ctrl V dans Discord'), l9)
    check('le message : copie légère, son poids, sa taille, sa cadence, et « Mon Discord »', t9.text === `Copie légère dans le presse-papiers : ${w9}, 640 × 360, 30 images/s` && t9.action === 'Mon Discord' && f9 === path.join(root, `${b2.id}-${lim9}`, path.basename(A.files[b2.id])), { t9, f9 })
    made.b2Button = path.join(root, `${b2.id}-${lim9}`)
    await sleep(3200)
    check('le bouton reprend son texte', (await buttonText(p)) === 'Copier pour Discord', await buttonText(p))
    // Trop long : le message, puis « Copier l’original »
    const mb10 = limitAt([b2], 450_000), lim10 = await useLimit(app, mb10)
    from = (await toasts(p)).length
    await p.evaluate(() => document.getElementById('cpShare').click())
    const t10 = await waitToast(p, /Trop long/, from)
    const wOrig = await bytesText(p, fs.statSync(A.files[b2.id]).size)
    check('trop long : le message dit la durée qui tient et propose l’original', t10.text === `Trop long pour ${mb10} Mo : ${maxSAt(lim10)} s au plus. Raccourcis-le, ou copie l’original (${wOrig}).` && /warn/.test(t10.tone) && t10.action === 'Copier l’original', t10)
    check('… et le presse-papiers n’a pas changé', (await info(app)).copied === f9)
    from = (await toasts(p)).length
    await clickToast(p, /Trop long/)
    const t11 = await waitToast(p, /Clip dans le presse-papiers/, from)
    check('« Copier l’original » : le clip lui-même part dans le presse-papiers', (await info(app)).copied === A.files[b2.id] && t11.text === `Clip dans le presse-papiers, ${wOrig}`, { t11, copied: (await info(app)).copied })
    await p.evaluate(() => Clips.close())
    // ----- B10. le réglage « Mon Discord »
    await useLimit(app, null)
    await p.evaluate(() => Settings.go('rec', 'r-disc'))
    await until(() => p.evaluate(() => !!document.querySelector('#r-disc .seg')), 5000, 'réglage Mon Discord')
    const seg = await p.evaluate(() => ({ opts: [...document.querySelectorAll('#r-disc .seg [role=radio]')].map((b) => `${b.textContent}:${b.getAttribute('aria-checked')}`), sub: document.getElementById('rDiscS')?.textContent, title: document.querySelector('#r-disc .sr-t b')?.textContent, group: document.querySelector('#r-disc')?.closest('.sg')?.querySelector('h2')?.textContent }))
    check('Paramètres : « Mon Discord », dans « Partage », trois choix, « Sans Nitro » choisi', seg.title === 'Mon Discord' && seg.group === 'Partage' && seg.opts.join() === 'Sans Nitro:true,Nitro Basic:false,Nitro:false' && seg.sub === 'Copier pour Discord fait une copie plus légère des clips de plus de 20 Mo.', seg)
    await p.evaluate(() => document.querySelector('#r-disc [data-v="basic"]').click())
    await until(async () => (await L('clipsGetSettings')).discord === 'basic', 5000, 'réglage enregistré').catch(() => null)
    const sub2 = await p.evaluate(() => document.getElementById('rDiscS')?.textContent)
    check('choisir « Nitro Basic » : enregistré, et la ligne dit 50 Mo', (await L('clipsGetSettings')).discord === 'basic' && sub2 === 'Copier pour Discord fait une copie plus légère des clips de plus de 50 Mo.', sub2)
    const r12 = await L('clipsShare', b2.id)
    check('la limite suit le réglage : 50 Mo', r12.status === 'copied' && r12.limitMb === 50 && !r12.reduced, r12)
    await L('clipsSaveSettings', { discord: 'gratuit' })
    check('une valeur inconnue ne change rien', (await L('clipsGetSettings')).discord === 'basic')
    await p.evaluate(() => Settings.close())
    // Le réglage se trouve aussi par la recherche
    check('la recherche des réglages connaît « Mon Discord »', await p.evaluate(() => Settings.index().some((x) => x[1] === 'r-disc' && /nitro/.test(x[3]))))
    // ----- B11. le clip part, ses copies aussi
    const mbCut = limitAt([cut], 1_000_000), limCut = await useLimit(app, mbCut)
    const rc = await L('clipsShare', cut.id)
    const dirCut = path.join(root, `${cut.id}-${limCut}`)
    check('la coupe a sa propre copie', rc.status === 'copied' && !!rc.reduced && fs.existsSync(dirCut), rc)
    await L('clipsDelete', cut.id)
    check('supprimer le clip efface ses copies, et rien d’autre', !listDir(root).some((n) => n.startsWith(`${cut.id}-`)) && fs.existsSync(made.b1) && fs.existsSync(made.b2Button), listDir(root))
    out = { made, mb2 }
  } catch (e) { fail++; console.log('ECHEC', e.message.split('\n')[0]) } finally { await app.close().catch(() => {}) }
  check('B : aucune erreur dans la page', errs.length === 0, errs.slice(0, 3))
  return out
}

// ---------- C. après une relance : ménage, pannes, refus croisés ----------

/** Un faux moteur, écrit par l'essai : il note l'encodeur (ou le débit) demandé, puis répond à la place de ffmpeg. */
function fakeEngine(dir, name, journalFile, body) {
  const file = path.join(dir, name)
  fs.writeFileSync(file, `#!/usr/bin/env node\nconst REAL = ${JSON.stringify(FF)}\nconst J = ${JSON.stringify(journalFile)}\nconst fs = require('fs'), { spawnSync } = require('child_process')\nconst args = process.argv.slice(2)\nconst pass = (a) => { const r = spawnSync(REAL, a, { stdio: 'inherit' }); process.exit(r.status === null ? 1 : r.status) }\nif (args.includes('-version') || args.includes('-encoders')) pass(args)\nconst vi = args.indexOf('-c:v'), enc = vi >= 0 ? args[vi + 1] : 'autre'\n${body}\n`)
  fs.chmodSync(file, 0o755)
  return file
}
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) } catch { return [] } }

async function partC(dirs, A, B) {
  console.log('--- C. Après une relance : le ménage, les pannes, les refus croisés')
  const root = shareRoot(dirs)
  const { a1, b1, b2 } = A
  // Des restes à faire disparaître au démarrage
  const unknown = path.join(root, 'ffffffffffffffff-20000000')
  fs.mkdirSync(unknown, { recursive: true })
  fs.writeFileSync(path.join(unknown, 'copie.json'), JSON.stringify({ v: 1, at: Date.now(), file: 'x.mp4', srcSize: 1, srcMtimeMs: 1, sizeBytes: 1, width: 2, height: 2, fps: 30 }))
  fs.writeFileSync(path.join(unknown, 'x.mp4'), 'x')
  const odd = path.join(root, 'pas-une-copie')
  fs.mkdirSync(odd, { recursive: true })
  const oldNote = path.join(B.made.b2Game, 'copie.json')
  fs.writeFileSync(oldNote, JSON.stringify({ ...JSON.parse(fs.readFileSync(oldNote, 'utf8')), at: Date.now() - 8 * 24 * 3600 * 1000 }))
  fs.writeFileSync(path.join(B.made.b2Button, 'copie.part'), 'reste d’une fabrication coupée')
  const { app, p, errs } = await start(dirs, ENV)
  const L = (...a) => launcher(p, ...a)
  const fj = path.join(dirs.base, 'faux-journal.txt')
  try {
    await preparePage(app, p)
    await sleep(1500)
    check('au démarrage : les copies d’un clip inconnu et un dossier étranger partent', !fs.existsSync(unknown) && !fs.existsSync(odd), listDir(root))
    check('au démarrage : une copie qui n’a pas servi depuis 8 jours part', !fs.existsSync(B.made.b2Game))
    check('au démarrage : le reste d’une fabrication coupée part, la copie reste', !fs.existsSync(path.join(B.made.b2Button, 'copie.part')) && listDir(B.made.b2Button).length === 2 && fs.existsSync(B.made.b1), listDir(B.made.b2Button))
    check('le réglage « Mon Discord » est gardé après la relance', (await L('clipsGetSettings')).discord === 'basic')
    const folder = (await L('clipsGetSettings')).folder
    const wB2 = await bytesText(p, fs.statSync(A.files[b2.id]).size)
    // ----- C1. le moteur vidéo manque
    await setEnv(app, 'PX_FFMPEG', path.join(dirs.base, 'absent', 'ffmpeg'))
    const mb1 = limitAt([b2], 1_200_000), lim1 = await useLimit(app, mb1)
    const r1 = await L('clipsShare', b2.id)
    check('moteur absent : pas de copie, rien dans le presse-papiers', r1.status === 'unmade' && r1.reason === 'engine' && r1.limitMb === mb1 && r1.sizeBytes === fs.statSync(A.files[b2.id]).size && (await info(app)).copied === null && !fs.existsSync(path.join(root, `${b2.id}-${lim1}`)), r1)
    await openPlayer(p, b2.id)
    let from = (await toasts(p)).length
    await p.evaluate(() => document.getElementById('cpShare').click())
    const t1 = await waitToast(p, /Moteur vidéo absent/, from)
    check('… et la page le dit, avec l’original à un clic', t1.text === `Moteur vidéo absent ou modifié : pas de copie légère. L’original pèse ${wB2}, pour ${mb1} Mo acceptés.` && t1.action === 'Copier l’original' && /warn/.test(t1.tone), t1)
    // La copie déjà faite resert même sans moteur
    await useLimit(app, B.mb2)
    const rOld = await L('clipsShare', b1.id)
    check('sans moteur, une copie déjà faite resert quand même', rOld.status === 'copied' && !!rOld.reduced && (await info(app)).copied?.startsWith(B.made.b1), rOld)
    await useLimit(app, limitAt([b2], 1_000_000))
    const rKept = await L('clipsShare', b2.id)
    check('après la relance, la copie faite par le bouton resert', rKept.status === 'copied' && !!rKept.reduced && (await info(app)).copied?.startsWith(B.made.b2Button + path.sep), rKept)
    // ----- C2. aucun encodeur ne marche
    const rate = fakeEngine(dirs.base, 'faux-rate.cjs', fj, `fs.appendFileSync(J, enc + '\\n')\nconst input = (args.find((a) => a.startsWith('file:')) || 'file:?').slice(5)\nprocess.stderr.write('[' + enc + ' @ 0x1] Error while opening encoder for ' + input + '\\n')\nprocess.exit(1)`)
    await setEnv(app, 'PX_FFMPEG', rate)
    const mb2 = limitAt([b2], 1_150_000), lim2 = await useLimit(app, mb2)
    fs.writeFileSync(fj, '')
    const before2 = (await info(app)).copied
    const r2 = await L('clipsShare', b2.id)
    const used2 = lines(fj)
    check('aucun encodeur ne marche : copie impossible, presse-papiers inchangé, aucun reste', r2.status === 'unmade' && r2.reason === 'encode' && (await info(app)).copied === before2 && !fs.existsSync(path.join(root, `${b2.id}-${lim2}`)), r2)
    check('chaque encodeur est essayé une fois, dans l’ordre', used2.join() === 'libx264,h264_nvenc,h264_amf,h264_qsv,h264_mf,libopenh264', used2)
    await inJournal(dirs, 'Copie pour Discord, libopenh264 raté')
    const shareLines = journal(dirs).split('\n').filter((l) => l.includes('Copie pour Discord'))
    check('le journal dit chaque échec, sans aucun chemin du PC', used2.every((e) => shareLines.some((l) => l.includes(`Copie pour Discord, ${e} raté : `))) && !shareLines.some((l) => l.includes(folder) || l.includes(dirs.base) || l.includes(dirs.userData)), shareLines.slice(-6))
    // ----- C3. un encodeur qui marche, mais trop lourd deux fois de suite
    const gros = fakeEngine(dirs.base, 'faux-gros.cjs', fj, `const bi = args.indexOf('-b:v')\nfs.appendFileSync(J, enc + ' ' + (bi >= 0 ? args[bi + 1] : '?') + '\\n')\nconst out = args[args.length - 1].slice(5)\nconst r = spawnSync(REAL, args, { stdio: 'inherit' })\nif (r.status === 0) fs.appendFileSync(out, Buffer.alloc(3000000))\nprocess.exit(r.status === null ? 1 : r.status)`)
    await setEnv(app, 'PX_FFMPEG', gros)
    const mb3 = limitAt([b2], 1_100_000), lim3 = await useLimit(app, mb3)
    fs.writeFileSync(fj, '')
    const r3 = await L('clipsShare', b2.id)
    const used3 = lines(fj).map((l) => l.split(' '))
    check('trop lourd deux fois : un second essai plus bas (au moins 10 %), puis l’abandon', r3.status === 'unmade' && r3.reason === 'encode' && used3.length === 2 && used3.every((x) => x[0] === 'libx264') && +used3[1][1] <= +used3[0][1] * 0.9 && !fs.existsSync(path.join(root, `${b2.id}-${lim3}`)), { r3, used3 })
    check('… et le journal le dit', await inJournal(dirs, /second essai plus bas/) && await inJournal(dirs, /au second essai, toujours plus que la limite de [\d,]+ Mo\. Abandon\./))
    // ----- C4. pendant une copie : un film, un essai du moteur, une autre copie, refusés avec la bonne raison
    const lent = fakeEngine(dirs.base, 'faux-lent.cjs', fj, `if (vi >= 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000)\npass(args)`)
    await setEnv(app, 'PX_FFMPEG', lent)
    const mb4 = limitAt([b1, b2], 1_050_000)
    await useLimit(app, mb4)
    await p.evaluate((id) => { window.__slow = window.launcher.clipsShare(id).then((r) => ({ ok: r }), (e) => ({ err: String(e.message || e) })) }, b1.id)
    await sleep(1200)
    const rf = await refusal(L('editFilmStart', [a1.id]))
    const rt = await refusal(L('editEngineTest'))
    const rs = await refusal(L('clipsShare', b2.id))
    const slow = await p.evaluate(() => window.__slow)
    check('pendant une copie : un film est refusé, et le message dit pourquoi', rf === 'Une copie pour Discord est en préparation. Relance le film dans quelques secondes.', rf)
    check('pendant une copie : l’essai du moteur est refusé, et le message dit pourquoi', rt === 'Une copie pour Discord est en préparation. Teste le moteur dans quelques secondes.', rt)
    check('pendant une copie : une autre copie est refusée', rs === 'Une copie est déjà en préparation.', rs)
    check('… et la copie en cours finit bien', slow.ok?.status === 'copied' && !!slow.ok.reduced, slow)
    check('après : aucun film ni essai lancé', (await L('editFilmState')).status !== 'running' && (await L('editEngine')).testing === false)
    // ----- C5. les encodeurs de la carte graphique ratent : le suivant prend le relais, et il est retenu
    const relais = fakeEngine(dirs.base, 'faux-relais.cjs', fj, `fs.appendFileSync(J, enc + '\\n')\nif (/^h264_(nvenc|amf|qsv|mf)$/.test(enc)) { process.stderr.write('[' + enc + ' @ 0x1] Cannot load the encoder library\\n'); process.exit(1) }\nif (enc === 'libopenh264') args[vi + 1] = 'libx264'\npass(args)`)
    await setEnv(app, 'PX_FFMPEG', relais)
    await setEnv(app, 'PX_FFMPEG_ENCODER', null)
    // 920 et 880 kb/s : deux limites qui n'ont encore jamais servi à ce clip (sinon la copie déjà faite resservirait).
    const mb5 = limitAt([b2], 920_000)
    await useLimit(app, mb5)
    fs.writeFileSync(fj, '')
    const r5 = await L('clipsShare', b2.id)
    const used5 = lines(fj)
    check('les encodeurs de la carte graphique ratent : le suivant fait la copie', r5.status === 'copied' && !!r5.reduced && used5.join() === 'h264_nvenc,h264_amf,h264_qsv,h264_mf,libopenh264', { r5, used5 })
    await useLimit(app, limitAt([b2], 880_000))
    fs.writeFileSync(fj, '')
    const r6 = await L('clipsShare', b2.id)
    check('la copie suivante commence par celui qui a marché', r6.status === 'copied' && lines(fj).join() === 'libopenh264', lines(fj))
    await p.evaluate(() => Clips.close())
  } catch (e) { fail++; console.log('ECHEC', e.message.split('\n')[0]) } finally { await app.close().catch(() => {}) }
  check('C : aucune erreur dans la page', errs.length === 0, errs.slice(0, 3))
}

;(async () => {
  const dirs = freshDirs('t15')
  const A = await partA(dirs)
  if (A) {
    const B = await partB(dirs, A)
    if (B) await partC(dirs, A, B)
    else console.log('Partie C sautée : la partie B n’a pas fini.')
  } else console.log('Parties B et C sautées : la partie A n’a pas fini.')
  console.log(`\n${pass} réussis, ${fail} ratés`)
  process.exit(fail ? 1 : 0)
})()
