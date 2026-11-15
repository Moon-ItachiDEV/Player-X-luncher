// La vraie première ouverture, sans démo : le scan de cette machine, puis chaque écran avec ce qu'il trouve.
const { start, shot, settle, go, check, done, failed } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a10', demo: false, setupDone: false, w: 1240, h: 720 })
  try {
    // Dossier de données déjà servi : on remet la première ouverture
    if (await p.evaluate(() => localStorage.getItem('pxv3-setup') !== null)) { await p.evaluate(() => localStorage.removeItem('pxv3-setup')); await p.reload(); await p.waitForLoadState('domcontentloaded') }
    // Le scan est fini quand le bouton principal arrive
    await p.waitForSelector('#iw [data-main]', { timeout: 40000 }); await p.waitForTimeout(800); await shot(p, 'a10-scan')
    const scan = await p.evaluate(() => ({ games: GAMES.length, rep: Real.st.report, titre: document.querySelector('#iwT').textContent, boutiques: [...document.querySelectorAll('#iw .iw-stores li')].map((x) => x.textContent) }))
    console.log(scan)
    // Sans jeu sur le PC : l'état de chaque boutique, et « Relancer la recherche » qui refait le scan dans la même fenêtre
    if (!scan.games) {
      check('aucun jeu : les quatre boutiques sont dites, la recherche se relance', scan.titre === 'Aucun jeu trouvé' && scan.boutiques.length === 4 && !!(await p.$('#iwAgain')), scan.boutiques)
      await p.click('#iwAgain'); await p.waitForSelector('#iw [data-main]', { timeout: 40000 }); await p.waitForTimeout(800); await shot(p, 'a10-s1')
    }
    // Échap : on passe, l'accueil s'ouvre tel quel
    await p.keyboard.press('Escape')
    await p.waitForFunction(() => document.querySelector('#inst').hidden, null, { timeout: 15000 }); await p.waitForTimeout(1000); await shot(p, 'a10-home')
    const fin = await p.evaluate(() => ({ key: localStorage.getItem('pxv3-setup'), vue: S.view, demo: Real.st.settings.demoMode }))
    check('Échap passe la première ouverture : notée comme vue, l’accueil est là, sans démo', fin.key === '1' && fin.vue === 'play' && !fin.demo, fin)
    await go(p, 'lib'); await shot(p, 'a10-lib')
    await go(p, 'friends'); await shot(p, 'a10-friends')
    await go(p, 'clips'); await shot(p, 'a10-clips')
    await go(p, 'stats'); await shot(p, 'a10-stats')
    await p.click('.sp-g[data-g=cs2]'); await settle(p, 1500); await shot(p, 'a10-cs2')
    await p.click('#bGear'); await p.waitForTimeout(700); await p.click('.sh-t[data-s=routine]'); await p.waitForTimeout(500); await shot(p, 'a10-rt')
    done(errs)
  } catch (e) { failed(e, errs) }
  await app.close()
})()
