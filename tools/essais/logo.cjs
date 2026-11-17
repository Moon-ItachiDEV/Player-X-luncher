// Essai 0.6.2-beta.6 : le blason en rouge partout (plus de dégradé rose). Captures du logo de la barre, du blason de grade
// sur l'accueil Vitrine, et vérification qu'aucune couleur rose du logo ne reste dans la page.
const { start, shot } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'logo' })
  const ok = (c, m) => console.log(c ? 'OK' : 'NON', m)
  try {
    await p.evaluate(() => Play.setHome('v')); await p.waitForTimeout(2500)
    await p.screenshot({ path: __dirname + '/shots/logo-barre.png', clip: { x: 0, y: 0, width: 420, height: 60 } })
    await shot(p, 'logo-vitrine')
    const html = await p.evaluate(() => document.documentElement.outerHTML.toLowerCase())
    const left = ['#ff3f86', '#ffd3de', '#ff9db4', '#e04065'].filter((c) => html.includes(c))
    ok(!left.length, `aucun rose du logo dans la page (${left.join(', ') || 'rien'})`)
    ok(html.includes('#e8264f'), 'le rouge du blason est là')
    console.log('ERREURS', errs.length); errs.slice(0, 12).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]); console.log(errs.slice(0, 12).join('\n')) }
  await app.close()
})()
