// Aperçu : le fond des Paramètres teinté par une jaquette (Cyberpunk, couleur simulée faute de réseau Steam)
const fs = require('fs'); const { start, shot } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'sp' })
  try {
    await p.evaluate(() => Settings.open('general')); await p.waitForTimeout(700)
    const b64 = fs.readFileSync('/tmp/claude-0/cp.txt', 'utf8')
    await p.evaluate((b) => { const s = document.getElementById('sheet'); s.style.setProperty('--sh-acc', '#f3e600'); document.getElementById('shArt').style.backgroundImage = `url("data:image/jpeg;base64,${b}")` }, b64)
    await p.waitForTimeout(700); await shot(p, 'sp-apres-teinte-cyberpunk')
    console.log('ERREURS', errs.length)
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]) }
  await app.close()
})()
