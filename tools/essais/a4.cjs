const { start, shot, settle, go, check, done, failed } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a1', env: { PX_SERVERS_SIM: 'normal', PX_CS2_STATS_SIM: 'auto' } })
  try {
    await go(p, 'stats'); await shot(p, 'a4-stats')
    await p.click('.sp-g[data-g=cs2]'); await settle(p, 1500); await shot(p, 'a4-cs2')
    // Plus d'onglets : une section s'ouvre en volet (« Toutes » sur la tuile des armes) ; `.vl-x` le ferme, sinon il bloque le reste de la page.
    // « Tous les matchs » et « Cartes » n'existent qu'avec des matchs relevés : ce scénario n'en a aucun (la page dit « Aucun match pour l’instant »).
    await p.click('.k-more[data-open=weapons]'); await p.waitForTimeout(900); await shot(p, 'a4-cs2-weapons'); await p.click('.vl-x')
    await p.click('.sp-g[data-g=bf6]'); await settle(p, 800)
    await p.click('#ckHR [data-open=loadouts]'); await p.waitForTimeout(700); await shot(p, 'a4-lo')
    // Carnet vide : « Ajouter mes builds » le remplit. En démo le carnet a déjà ses builds, le bouton n'est pas là.
    if (await p.$('#loSeed')) { await p.click('#loSeed'); await p.waitForTimeout(1200) }
    await shot(p, 'a4-lo2')
    const lo = await p.evaluate(() => ({ builds: BUILDS.length, cats: [...new Set(BUILDS.map((b) => b.cat))], first: BUILDS[0] }))
    console.log(lo)
    check('le carnet a des builds, une arme à ouvrir', lo.builds > 0 && !!(await p.$('.lw')), lo.builds)
    await p.click('.lw'); await settle(p, 800); await shot(p, 'a4-lo3')
    await p.click('.vl-x') // le volet de l'arme ferme toute la pile ; la barre ne se clique plus tant qu'il est ouvert
    await p.click('#bGear'); await p.waitForTimeout(800); await p.click('.sh-t[data-s=rec]'); await p.waitForTimeout(700); await shot(p, 'a4-set-rec')
    for (const s of ['overlay', 'routine', 'library', 'general', 'keys', 'accounts', 'about']) { await p.click(`.sh-t[data-s=${s}]`); await p.waitForTimeout(700); await shot(p, 'a4-set-' + s) }
    done(errs)
  } catch (e) { failed(e, errs) }
  await app.close()
})()
