// Avant/après d'une couleur : l'accueil, la bibliothèque, une fiche, les clips, Paramètres > Mon PC et Général
const { start, shot, go } = require('./h.cjs')
const tag = process.argv[2] || 'x'
;(async () => {
  const { app, p, errs } = await start({ name: 'sp3' + tag })
  try {
    await shot(p, `c-${tag}-accueil`)
    await go(p, 'lib'); await shot(p, `c-${tag}-biblio`)
    await p.click('.lb-t[data-id]'); await p.waitForTimeout(1200); await shot(p, `c-${tag}-fiche`)
    await go(p, 'clips'); await p.waitForTimeout(500); await shot(p, `c-${tag}-clips`)
    await p.evaluate(() => Settings.open('pc')); await p.waitForTimeout(1500); await shot(p, `c-${tag}-pc`)
    await p.click('.sh-t[data-s=accounts]'); await p.waitForTimeout(700); await shot(p, `c-${tag}-comptes`)
    console.log('ERREURS', errs.length); errs.slice(0, 10).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]) }
  await app.close()
})()
