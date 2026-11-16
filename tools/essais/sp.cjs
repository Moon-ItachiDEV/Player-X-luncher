// Aperçu de la page Paramètres : chaque rubrique, puis la recherche
const { start, shot } = require('./h.cjs')
const tag = process.argv[2] || 'avant'
;(async () => {
  const { app, p, errs } = await start({ name: 'sp' })
  try {
    await p.evaluate(() => Settings.open('rec')); await p.waitForTimeout(900)
    for (const s of (process.argv[3] || 'rec,edit,overlay,routine,general,library,keys,accounts,pc,about').split(',')) {
      await p.click(`.sh-t[data-s=${s}]`); await p.waitForTimeout(700); await shot(p, `sp-${tag}-${s}`)
    }
    await p.fill('#shQ', 'micro'); await p.waitForTimeout(400); await shot(p, `sp-${tag}-recherche`)
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
