// Essai 0.6.2 : Paramètres, page « Essentiel » et nouveau classement, dans la vraie fenêtre en mode démo.
// Il pose lui-même son état de départ (enregistrement actif, overlay Régie, routine de trois étapes sur Counter-Strike 2) : il peut tourner deux fois de suite.
const { start, shot, OUT } = require('./h.cjs')
const W = 1600, H = 940
;(async () => {
  const { app, p, errs } = await start({ name: 'pe', w: W, h: H })
  const ok = (c, m) => console.log(c ? 'OK ' : 'NON', m)
  const sec = () => p.evaluate(() => document.querySelector('.sh-t[aria-current=page]')?.dataset.s)
  const gear = async () => { await p.evaluate(() => { const g = GAMES[S.focus]; if (g && /Counter-Strike/.test(g.name)) { g.cover = 'cs_dust2'; if (g.raw) g.raw.coverUrl = 'assets/cs_dust2.webp' } }); await p.click('#bGear'); await p.waitForTimeout(1100) }
  const esc = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(500) }
  const fit = () => p.evaluate(() => { const n = document.querySelector('#shNav'); return [n.scrollHeight, n.clientHeight] })
  const resize = async (w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]); await p.waitForTimeout(1500) }
  try {
    await p.evaluate(() => localStorage.removeItem('pxv3-ovstyle')); await p.reload(); await p.waitForTimeout(7000)
    // Un état parlant : enregistrement actif, overlay Régie, une routine de trois étapes sur le jeu en cours (données de démo)
    await p.evaluate(async () => {
      await Real.saveSettings({ cs2Overlay: 'regie' }); await Real.saveClips({ enabled: true, quality: 'balanced' }); Settings.syncBar()
      S.focus = GAMES.findIndex((x) => /Counter-Strike/.test(x.name)); const g = GAMES[S.focus]; g.cover = 'cs_dust2'; if (g.raw) g.raw.coverUrl = 'assets/cs_dust2.webp'
      Object.keys(ROUTINES).forEach((k) => delete ROUTINES[k])
      // Une routine d'un autre jeu, placée avant : « Modifier » doit régler la routine, pas tomber sur la première
      const g2 = GAMES.find((x) => x.installed && x.id !== '__all' && x !== g)
      GAMES.forEach((x) => { x.routine = null })
      ROUTINES.rbefore = { id: 'rbefore', name: g2.name, rid: g2.rid, game: g2.id, trigger: 'launch', steps: [
        Real.stepUi({ id: 'b1', kind: 'link', value: 'discord://-/channels/1/3', name: 'Salon Discord', on: true }, g2),
        Real.stepUi({ id: 'game', kind: 'game', on: true }, g2)] }
      g2.routine = 'rbefore'
      ROUTINES.rdemo = { id: 'rdemo', name: g.name, rid: g.rid, game: g.id, trigger: 'launch', steps: [
        Real.stepUi({ id: 's1', kind: 'link', value: 'discord://-/channels/1/2', name: 'Salon Discord', on: true }, g),
        Real.stepUi({ id: 's2', kind: 'close', value: 'chrome.exe', name: 'chrome', force: true, on: true }, g),
        Real.stepUi({ id: 'game', kind: 'game', on: true }, g)] }
      g.routine = 'rdemo'; Real.saveRoutines(); Bar.syncGame()
    })
    // La règle d'ouverture
    await gear(); ok((await sec()) === 'home', 'la roue ouvre Essentiel')
    await p.click('.sh-t[data-s=rec]'); await p.waitForTimeout(500); await esc()
    await gear(); ok((await sec()) === 'home', 'après une autre rubrique, la roue rouvre Essentiel')
    await p.evaluate(() => { document.querySelector('#shBody').scrollTop = 200 }); await esc()
    await gear(); ok(await p.evaluate(() => document.querySelector('#shBody').scrollTop === 0), 'Essentiel rouvre en haut de page')
    await esc()
    await p.click('#bMe'); await p.waitForTimeout(1000); ok((await sec()) === 'accounts', 'l’avatar ouvre Comptes')
    await esc(); await gear(); ok((await sec()) === 'home', 'puis la roue rouvre Essentiel (le raccourci ne valait que pour sa visite)')
    await p.click('.sh-t[data-s=accounts]'); await p.waitForTimeout(500)
    await p.keyboard.press('Control+,'); await p.waitForTimeout(500); ok((await sec()) === 'accounts', 'Ctrl + virgule déjà ouvert : rien ne change (Comptes reste)')
    await p.click('.sh-t[data-s=home]'); await p.waitForTimeout(500)
    // L'ordre du sommaire et ses noms de groupes
    const nav = await p.evaluate(() => [...document.querySelectorAll('#shNav .sh-t')].map((x) => x.dataset.s).join(','))
    ok(nav === 'home,rec,overlay,routine,keys,general,library,pc,accounts,edit,about', `ordre du sommaire : ${nav}`)
    const gl = await p.evaluate(() => [...document.querySelectorAll('#shNav .sh-gl')].map((x) => x.textContent).join(' | '))
    ok(gl === 'En jeu | Player X et ton PC | Une fois pour toutes', `noms de groupes : ${gl}`)
    const f1 = await fit(); ok(f1[0] <= f1[1] + 1, `la colonne tient sans défiler en ${W}×${H} (${f1})`)
    // Le clavier suit l'ordre du DOM : Fin va à À propos, Début revient à Essentiel
    await p.focus('.sh-t[aria-current=page]'); await p.keyboard.press('End'); await p.waitForTimeout(500); const e1 = await sec()
    await p.keyboard.press('Home'); await p.waitForTimeout(500); const e2 = await sec()
    ok(e1 === 'about' && e2 === 'home', `clavier : Fin ${e1}, Début ${e2}`)
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(400); ok((await sec()) === 'rec', 'clavier : flèche bas suit l’ordre (Enregistrement)')
    await p.click('.sh-t[data-s=home]'); await p.waitForTimeout(700)
    await p.mouse.move(W - 60, 600); await p.waitForTimeout(900); await shot(p, 'pe-a-voir')
    console.log('   page', await p.evaluate(() => [document.querySelector('#shBody').scrollHeight, document.querySelector('#shBody').clientHeight]), '| à voir', await p.evaluate(() => document.querySelectorAll('.hm-todo').length), '| colonne', await p.evaluate(() => document.querySelector('.sh-t[data-s=home] em').textContent))
    await p.evaluate(() => { document.querySelector('#shBody').scrollTop = 9999 }); await p.waitForTimeout(400); await shot(p, 'pe-a-voir-bas'); await p.evaluate(() => { document.querySelector('#shBody').scrollTop = 0 })
    // Les commandes marchent : qualité, style, interrupteurs
    await p.click('#h-qual [data-v=high]'); await p.waitForTimeout(600)
    ok(await p.evaluate(() => Real.clipsCfg.quality === 'high' && /40 Mb/.test(document.querySelector('#h-qual .sr-t span').textContent)), 'qualité Haute enregistrée, sa ligne suit')
    ok(await p.evaluate(() => document.activeElement?.dataset?.v === 'high'), 'le focus reste sur la qualité après le repaint')
    await p.click('#h-ovst [data-v=etendard]'); await p.waitForTimeout(600)
    ok(await p.evaluate(() => Real.st.settings.cs2Overlay === 'etendard' && document.querySelector('.sh-t[data-s=overlay] em').textContent === 'Étendard'), 'style Étendard enregistré, la colonne suit')
    await p.click('#hOv'); await p.waitForTimeout(600); await p.click('#hMaster'); await p.waitForTimeout(700)
    ok(await p.evaluate(() => Real.st.settings.cs2Overlay === 'off' && !Real.clipsCfg.enabled && document.querySelector('.hm-rest').inert), 'overlay et enregistrement coupés')
    ok(await p.evaluate(() => /Coupé, aucun clip/.test(document.querySelector('#h-rec .sr-t span').textContent)), 'la ligne « Garder mes moments » dit Coupé')
    await p.mouse.move(W - 60, 600); await p.waitForTimeout(500); await shot(p, 'pe-coupe')
    await p.click('#h-ovst [data-v=viseur]'); await p.waitForTimeout(500)
    ok(await p.evaluate(() => Real.st.settings.cs2Overlay === 'off' && localStorage.getItem('pxv3-ovstyle') === 'viseur'), 'overlay coupé : le style est gardé pour plus tard')
    await p.click('#hMaster'); await p.waitForTimeout(700); await p.click('#hOv'); await p.waitForTimeout(700)
    ok(await p.evaluate(() => Real.st.settings.cs2Overlay === 'viseur' && Real.clipsCfg.enabled), 'rallumés : Viseur revient')
    // La barre du bas coupe l'enregistrement pendant qu'Essentiel est ouvert : la page suit (Settings.sync)
    await p.evaluate(async () => { await Real.saveClips({ enabled: false }); Settings.sync() }); await p.waitForTimeout(700)
    ok(await p.evaluate(() => document.querySelector('.hm-rest').inert), 'Settings.sync rafraîchit Essentiel')
    await p.evaluate(async () => { await Real.saveClips({ enabled: true }); Settings.sync() }); await p.waitForTimeout(700)
    // Settings.sync sans changement d'état : rien ne se repeint, le focus reste sur la qualité cochée
    await p.evaluate(() => document.querySelector('#h-qual [aria-checked=true]').focus()); await p.evaluate(() => Settings.sync()); await p.waitForTimeout(500)
    ok(await p.evaluate(() => document.activeElement === document.querySelector('#h-qual [aria-checked=true]')), 'sync sans changement : le focus reste sur la qualité')
    // Un changement d'état (l'enregistrement démarre) repeint, et le focus revient sur la même commande
    await p.evaluate(() => { window.__live = Real.clipsLive; Real.clipsLive = { ...(Real.clipsLive || {}), status: 'recording', game: 'Jeu Test', error: undefined }; Settings.sync() }); await p.waitForTimeout(600)
    ok(await p.evaluate(() => /En cours sur Jeu Test/.test(document.querySelector('#h-rec .sr-t span').textContent) && document.activeElement === document.querySelector('#h-qual [aria-checked=true]')), 'sync avec changement : la page suit, le focus revient sur la qualité')
    // Pendant le choix de la touche du clip, sync ne repeint pas
    await p.click('#h-hot .kc'); await p.waitForTimeout(300)
    await p.evaluate(() => { Real.clipsLive = { ...Real.clipsLive, status: 'idle', game: '' }; Settings.sync() }); await p.waitForTimeout(600)
    ok(await p.evaluate(() => /Appuie sur les touches/.test(document.querySelector('#h-hot .kc').textContent)), 'choix de la touche : sync ne fait pas disparaître « Appuie sur les touches »')
    const hk = await p.evaluate(() => Real.clipsCfg.hotkey)
    await p.keyboard.press('Escape'); await p.waitForTimeout(400)
    ok(await p.evaluate((hk) => !/Appuie/.test(document.querySelector('#h-hot .kc').textContent) && Real.clipsCfg.hotkey === hk && !document.querySelector('#sheet').hidden, hk), 'Échap annule le choix, la touche d’origine est gardée')
    await p.evaluate(() => { Real.clipsLive = window.__live; Settings.sync() }); await p.waitForTimeout(500)
    // La durée mène à Enregistrement, sur sa ligne, avec le focus dedans
    await p.click('.hm-rd'); await p.waitForTimeout(900); ok((await sec()) === 'rec' && await p.evaluate(() => !!document.querySelector('#r-dur') && !!document.activeElement?.closest('#r-dur')), 'la durée mène à Enregistrement, sur #r-dur, focus dans la ligne')
    await p.click('.sh-t[data-s=home]'); await p.waitForTimeout(600)
    await p.click('#h-rt [data-go=routine]'); await p.waitForTimeout(900)
    ok((await sec()) === 'routine' && await p.evaluate(() => document.querySelectorAll('#rtList > *').length === 3 && document.querySelector('#r-rt .rt-meta b').textContent === GAMES[S.focus].name), 'Modifier ouvre la routine du jeu en cours (3 étapes), pas la première')
    await esc()
    // Un jeu non installé sans routine : pas de ligne Routine, pas de groupe vide
    const ni = await p.evaluate(() => { const i = GAMES.findIndex((x) => !x.installed && x.id !== '__all'); if (i < 0) return false; S.focus = i; GAMES[i].routine = null; return true })
    ok(ni, 'le démo a un jeu non installé')
    await gear(); ok(await p.evaluate(() => !document.querySelector('#h-rt') && ![...document.querySelectorAll('#shBody h2')].some((h) => /Routines/.test(h.textContent))), 'jeu non installé sans routine : pas de ligne Routine')
    await esc()
    // Un jeu installé sans routine : « Créer » arrive sur ce jeu
    await p.evaluate(() => { S.focus = GAMES.findIndex((x) => /Counter-Strike/.test(x.name)); GAMES[S.focus].routine = null })
    await gear(); await p.click('#h-rt [data-go=routine]'); await p.waitForTimeout(900)
    ok(await p.evaluate(() => document.querySelector('.sh-t[aria-current=page]').dataset.s === 'routine' && document.querySelector('#rtG')?.value === GAMES[S.focus].id), 'Créer ouvre la création pour le jeu en cours (#rtG)')
    // Échap, un autre jeu, Routines : plus de création pour l'ancien
    await esc(); await p.evaluate(() => { S.focus = GAMES.findIndex((x) => x.routine === 'rbefore') })
    await gear(); await p.click('.sh-t[data-s=routine]'); await p.waitForTimeout(800)
    ok(await p.evaluate(() => !document.querySelector('#rtG') && !!document.querySelector('#r-rt')), 'après Créer puis Échap, Routines ne rouvre pas la création de l’ancien jeu')
    await esc(); await p.evaluate(() => { S.focus = GAMES.findIndex((x) => /Counter-Strike/.test(x.name)); GAMES[S.focus].routine = 'rdemo' })
    // Le chevron de chaque groupe
    await gear()
    ok(await p.evaluate(() => [...document.querySelectorAll('.hm-more')].every((x) => /^Tout régler : /.test(x.getAttribute('aria-label')) && x.dataset.tip === 'Tout régler' && !x.textContent.trim())), 'chevrons : libellé « Tout régler », sans texte')
    await p.click('.hm-more[data-go=overlay]'); await p.waitForTimeout(700); ok((await sec()) === 'overlay', 'le chevron d’Overlay mène à Overlay')
    await esc()
    // Retour sur Essentiel : photo finale et petite fenêtre
    await gear(); await p.mouse.move(W - 60, 600); await p.waitForTimeout(900); await shot(p, 'pe')
    await p.evaluate(() => { document.querySelector('#shBody').scrollTop = 9999 }); await p.waitForTimeout(400); await shot(p, 'pe-bas'); await esc()
    await resize(1280, 720)
    await gear(); await p.mouse.move(1220, 500); await p.waitForTimeout(900)
    const f2 = await fit(); ok(f2[0] <= f2[1] + 1, `la colonne tient sans défiler en 1280×720 (${f2})`)
    await shot(p, 'pe-petit'); await esc()
    await resize(W, H)
    // Les dix autres rubriques s'ouvrent sans erreur
    const before = errs.length
    await gear()
    for (const s of ['rec', 'overlay', 'routine', 'keys', 'general', 'library', 'pc', 'accounts', 'edit', 'about']) {
      await p.click(`.sh-t[data-s=${s}]`); await p.waitForTimeout(800)
      ok((await sec()) === s && await p.evaluate(() => document.querySelector('#shBody').children.length > 0 && document.querySelector('#shTitle').textContent.length > 0), `rubrique ${s} s’ouvre`)
    }
    ok(errs.length === before, 'aucune erreur de page en parcourant les rubriques')
    await esc()
    console.log('errs', errs.length, errs.slice(0, 5))
    ok(errs.length === 0, '0 erreur de page')
  } finally { await app.close() }
})().catch((e) => { console.error(e); process.exit(1) })
