// Le dossier des clips : celui par défaut, le choix par « Changer » (Paramètres), ce choix gardé après une relance, le ménage
// du démarrage fait dans ce dossier, le secours quand il ne peut plus servir, et le retour au dossier par défaut, gardé lui
// aussi après une relance.
// La fenêtre du système ne s'ouvre pas sous Xvfb : l'essai répond à sa place (dialog.showOpenDialog est remplacé dans le
// processus principal) et note ce que l'appli lui a demandé. Sous Linux seulement, comme les autres scénarios.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, decodeCheck, freshDirs, listDir, fs, path } = H

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }
const mp4s = (d) => listDir(d).filter((n) => n.endsWith('.mp4'))
const errs = []

/** L'appli lancée et sa page prête. La fenêtre « choisir un dossier » est remplacée : elle note la demande et rend la réponse de l'essai. */
async function open(dirs) {
  const s = await start(dirs, ENV)
  s.p.on('pageerror', (e) => errs.push(String(e.message || e)))
  await until(() => s.app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
  await s.p.evaluate(() => { localStorage.setItem('pxv3-setup', '1') }); await s.p.reload(); await s.p.waitForLoadState('domcontentloaded')
  await until(() => s.p.evaluate(() => typeof Settings !== 'undefined' && !!Real.clipsCfg).catch(() => false), 20000, 'page prête')
  await s.app.evaluate(({ dialog, BrowserWindow }) => {
    const d = (globalThis.pxEssaiDossier = { demandes: [], reponse: { canceled: true, filePaths: [] } })
    dialog.showOpenDialog = async (...a) => {
      const o = a[a.length - 1]
      d.demandes.push({ fenetre: a.length === 2 && a[0] instanceof BrowserWindow, titre: o.title, depart: o.defaultPath, options: o.properties })
      return d.reponse
    }
  })
  return s
}
const answer = (app, r) => app.evaluate((_e, r) => { globalThis.pxEssaiDossier.reponse = r }, r)
const asked = (app) => app.evaluate(() => globalThis.pxEssaiDossier.demandes)

;(async () => {
  const dirs = freshDirs('t18')
  const byDefault = path.join(dirs.home, 'Videos', 'Player X V3 Test')
  // Un nom avec un espace et un accent, comme un vrai dossier ; et un dossier impossible : son parent est un fichier
  const chosen = path.join(dirs.base, 'Mes clips à moi'), wall = path.join(dirs.base, 'un-fichier'), broken = path.join(wall, 'clips')
  let s = await open(dirs)
  const L = (...a) => launcher(s.p, ...a)
  // Paramètres › Enregistrement, à la ligne « Dossier des clips » : ce qu'elle montre, et son bouton « Changer »
  const row = async () => {
    await s.p.evaluate(() => Settings.go('rec', 'r-folder'))
    await until(() => s.p.evaluate(() => !!document.getElementById('rFolder')), 5000, 'ligne « Dossier des clips »')
  }
  const shown = () => s.p.evaluate(() => document.querySelector('#r-folder .sr-t span')?.textContent)
  const click = async () => { await row(); await s.p.evaluate(() => document.getElementById('rFolder').click()) }
  /** Un clip de plus : le jeu tourne, le tampon se remplit, le raccourci garde le moment. Rend la liste. */
  const clip = async (n) => {
    await simRunning(s.app, true)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 8, 40000, 'tampon', 500)
    await test(s.app, 'saveNow')
    const list = await until(async () => { const l = await L('clipsList'); return l.length >= n ? l : null }, 45000, `${n} clip(s)`)
    await simRunning(s.app, false); await sleep(2000)
    return list
  }
  try {
    // ----- sans dossier choisi
    const cfg0 = await L('clipsGetSettings')
    check('sans dossier choisi : le dossier par défaut, dans Vidéos', cfg0.folder === byDefault && (await test(s.app, 'info')).folder === byDefault, cfg0.folder)
    const set = await L('clipsSaveSettings', { before: 6, after: 2, merge: 0, quality: 'light' })
    check('un réglage changé est rendu, puis relu', set.before === 6 && set.quality === 'light' && set.folder === byDefault && (await L('clipsGetSettings')).before === 6, { before: set.before, quality: set.quality, folder: set.folder })

    // ----- « Changer », puis Annuler
    await click()
    const d1 = await until(async () => { const d = await asked(s.app); return d.length ? d : null }, 5000, 'fenêtre du système demandée')
    check('« Changer » : la fenêtre du système s’ouvre sur le dossier du moment, attachée à la fenêtre de l’appli', d1.length === 1 && d1[0].fenetre && d1[0].titre === 'Dossier des clips' && d1[0].depart === byDefault && String(d1[0].options) === 'openDirectory,createDirectory', d1)
    await sleep(600)
    check('Annuler : rien ne change, et la demande rend « rien »', (await L('clipsChooseFolder')) === null && (await L('clipsGetSettings')).folder === byDefault && (await shown()) === byDefault, await shown())

    // ----- « Changer », puis un dossier
    await answer(s.app, { canceled: false, filePaths: [chosen] })
    await click()
    await until(async () => (await shown()) === chosen, 8000, 'Paramètres à jour').catch(() => null)
    const cfg1 = await L('clipsGetSettings')
    check('un dossier choisi : enregistré, et Paramètres le montre', cfg1.folder === chosen && (await test(s.app, 'info')).folder === chosen && (await shown()) === chosen, { folder: cfg1.folder, affiche: await shown() })
    check('choisir un dossier ne touche à aucun autre réglage', JSON.stringify({ ...cfg1, folder: '' }) === JSON.stringify({ ...set, folder: '' }), cfg1)
    const before = fs.existsSync(chosen)
    await clip(1)
    const made = mp4s(chosen)
    check('le clip est écrit dans le dossier choisi, créé au besoin, et pas dans celui par défaut', !before && made.length === 1 && mp4s(byDefault).length === 0 && decodeCheck(path.join(chosen, made[0])).ok, { existait: before, choisi: listDir(chosen), defaut: listDir(byDefault) })

    // ----- relance : le choix et les réglages sont relus, et le ménage du démarrage se fait dans le dossier choisi
    const rest = path.join(chosen, 'reste.mp4.part')
    fs.writeFileSync(rest, 'reste d’une écriture coupée')
    await Promise.race([s.app.close().catch(() => {}), sleep(12000)])
    s = await open(dirs)
    await row()
    const cfg2 = await L('clipsGetSettings')
    check('après une relance : le dossier choisi et les réglages sont gardés, et Paramètres les montre', cfg2.folder === chosen && cfg2.before === 6 && cfg2.quality === 'light' && (await shown()) === chosen, { folder: cfg2.folder, before: cfg2.before, quality: cfg2.quality, affiche: await shown() })
    await until(() => !fs.existsSync(rest), 8000, 'ménage du démarrage').catch(() => null)
    check('au démarrage : un clip à moitié écrit part du dossier choisi, le vrai clip reste', !fs.existsSync(rest) && mp4s(chosen).length === 1 && (await L('clipsList')).length === 1, listDir(chosen))

    // ----- le dossier choisi ne peut plus servir : le clip part dans le dossier par défaut
    fs.writeFileSync(wall, 'un fichier, pas un dossier')
    await answer(s.app, { canceled: false, filePaths: [broken] })
    const r = await L('clipsChooseFolder')
    check('la demande rend les réglages, avec le nouveau dossier', !!r && r.folder === broken && r.before === 6, r && r.folder)
    const list = await clip(2)
    // clipsLogTail attend que le journal soit écrit ; il ne rend que 40 lignes, le fichier les a toutes
    await L('clipsLogTail')
    const journal = fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8')
    check('dossier inutilisable : le clip est écrit quand même, dans le dossier par défaut, et le journal le dit', list.length === 2 && mp4s(byDefault).length === 1 && mp4s(chosen).length === 1 && journal.includes(`Dossier ${broken} inutilisable`), { defaut: listDir(byDefault), choisi: listDir(chosen), journal: journal.split('\n').filter((l) => /inutilisable/.test(l)) })

    // ----- retour au dossier par défaut (la page ne peut donner que ça : un chemin envoyé par elle est ignoré, voir t2)
    const back = await L('clipsSaveSettings', { folder: '' })
    check('revenir au dossier par défaut', back.folder === byDefault && (await L('clipsGetSettings')).folder === byDefault && (await test(s.app, 'info')).folder === byDefault, back.folder)
    // Une seconde relance : cette fois le dernier enregistrement vient d'un réglage changé, pas du choix d'un dossier
    await Promise.race([s.app.close().catch(() => {}), sleep(12000)])
    s = await open(dirs)
    const cfg3 = await L('clipsGetSettings')
    check('après une autre relance : le retour au dossier par défaut est gardé, les réglages et les clips aussi', cfg3.folder === byDefault && cfg3.before === 6 && cfg3.quality === 'light' && (await L('clipsList')).length === 2, { folder: cfg3.folder, before: cfg3.before, quality: cfg3.quality })
    check('pas d’erreur dans la page', errs.length === 0, errs.slice(0, 3))
  } catch (e) { fail++; console.log('ECHEC', String(e.message || e).split('\n')[0]) } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    await Promise.race([s.app.close().catch(() => {}), sleep(12000)])
    process.exit(fail ? 1 : 0)
  }
})()
