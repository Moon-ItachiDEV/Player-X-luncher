// La première ouverture, en démo : le scan, un favori touché, les clips activés, les comptes, puis l'accueil.
const { start, shot, check, done, failed } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a8', setupDone: false, env: { PX_LAUNCH_SIM: 'ok', PX_LAUNCH_SIM_FAST: '1' } })
  const ecran = () => p.evaluate(() => ({ titre: document.querySelector('#iwT')?.textContent, etape: document.querySelector('.iw-steps .cur')?.textContent, boutons: [...document.querySelectorAll('#iw .iw-f button')].map((b) => b.textContent.trim()) }))
  try {
    await p.evaluate(() => localStorage.removeItem('pxv3-setup')); await p.reload(); await p.waitForLoadState('domcontentloaded')
    await p.waitForTimeout(5000); await shot(p, 'a8-scan')
    // Le scan est fini quand le bouton principal arrive
    await p.waitForSelector('#iw [data-main]', { timeout: 30000 }); await p.waitForTimeout(1500); await shot(p, 'a8-scan2')
    const jeux = await ecran()
    console.log(jeux, await p.evaluate(() => ({ jaquettes: document.querySelectorAll('#iwWall .iw-c').length, favoris: GAMES.filter((g) => g.fav).map((g) => g.name) })))
    check('étape 1 : les jeux trouvés, un seul bouton « Continuer »', /jeux? trouvés?$/.test(jeux.titre || '') && jeux.etape === 'Jeux' && jeux.boutons.join() === 'Continuer', jeux)
    // Toucher une jaquette la met en favori
    const nom = await p.evaluate(() => { const c = document.querySelector('#iwWall .iw-c[aria-pressed="false"]'); c.click(); return c.getAttribute('aria-pressed') === 'true' ? c.dataset.name : null })
    await p.waitForTimeout(400); await shot(p, 'a8-s1')
    check('une jaquette touchée passe en favori', !!nom, nom)
    await p.click('#iw [data-main]'); await p.waitForTimeout(1200); await shot(p, 'a8-s2')
    const clips = await ecran(), avant = await p.evaluate(() => Real.clipsCfg?.enabled)
    console.log(clips, { clipsAvant: avant })
    check('étape 2 : les clips, « Retour » et deux choix', clips.etape === 'Clips' && clips.boutons.length === 3 && clips.boutons[0] === 'Retour', clips)
    // « Ne rien enregistrer » coupe les clips et passe aux comptes
    await p.click('#iw [data-rec="0"]'); await p.waitForSelector('#iw .iw-acc', { timeout: 10000 }); await p.waitForTimeout(800); await shot(p, 'a8-s3')
    const comptes = await ecran(), coupes = await p.evaluate(() => Real.clipsCfg?.enabled)
    console.log(comptes, { clips: coupes, lignes: await p.evaluate(() => [...document.querySelectorAll('#iw .iw-acc li')].map((x) => x.textContent.trim().replace(/\s+/g, ' '))) })
    check('« Ne rien enregistrer » : les clips sont coupés', coupes === false, coupes)
    check('étape 3 : les comptes, « Ouvrir l’accueil »', comptes.etape === 'Comptes' && comptes.boutons.includes('Ouvrir l’accueil'), comptes)
    // « Retour » revient aux clips, qui proposent maintenant de les activer
    await p.click('#iwBack'); await p.waitForSelector('#iw [data-rec]', { timeout: 10000 }); await p.waitForTimeout(500); await shot(p, 'a8-s4')
    const retour = { ...(await ecran()), choix: (await p.textContent('#iw [data-rec="1"]')).trim() }
    check('« Retour » revient aux clips, qui proposent de les activer', retour.etape === 'Clips' && retour.choix === 'Activer les clips', retour)
    await p.click('#iw [data-rec="1"]'); await p.waitForSelector('#iw .iw-acc', { timeout: 10000 }); await p.waitForTimeout(500)
    await p.click('#iw [data-main]')
    await p.waitForFunction(() => document.querySelector('#inst').hidden, null, { timeout: 15000 }); await p.waitForTimeout(2500); await shot(p, 'a8-home')
    const fin = await p.evaluate((nom) => ({ key: localStorage.getItem('pxv3-setup'), favs: GAMES.filter((g) => g.fav).map((g) => g.name), clips: Real.clipsCfg?.enabled, vue: S.view, favori: !!GAMES.find((g) => g.name === nom)?.fav }), nom)
    console.log(fin)
    check('fin : la première ouverture est notée comme vue, l’accueil est là', fin.key === '1' && fin.vue === 'play', fin)
    check('fin : le favori touché est gardé', fin.favori, fin.favs)
    check('fin : les clips sont activés', fin.clips === true, fin.clips)
    done(errs)
  } catch (e) { failed(e, errs) }
  await app.close()
})()
