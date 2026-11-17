// Le sol de l'Arsenal (Brume, Laqué) sur trois jeux de styles différents.
// IMG_DIR : jaquettes et images larges (cyber, bf, cs, bf_hero, cs_hero) posées sur les jeux de démo du même nom.
const { start, shot } = require('./h.cjs')
const fs = require('fs'), path = require('path')
;(async () => {
  const { app, p, errs } = await start({ name: 'sols' })
  try {
    const D = process.env.IMG_DIR
    const img = (n) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(D, n + '.jpg')).toString('base64')
    const pics = { Cyberpunk: [img('cyber'), null], Battlefield: [img('bf'), img('bf_hero')], 'Counter-Strike': [img('cs'), img('cs_hero')] }
    await p.evaluate((pics) => {
      for (const g of GAMES) {
        const k = Object.keys(pics).find((n) => g.name.startsWith(n)); if (!k) continue
        g.cover = pics[k][0]; g.hero = pics[k][1]; if (g.raw) g.raw.coverUrl = pics[k][0]
      }
      Play.sync(); Play.setHome('r')
      document.head.append(Object.assign(document.createElement('style'), { textContent: '#toasts{display:none!important}' }))
    }, pics)
    await p.waitForTimeout(3000)
    for (const name of (process.env.JEUX || 'Cyberpunk,Counter-Strike,Battlefield').split(',')) {
      await p.evaluate((name) => [...document.querySelectorAll('#arIdx .ar-ix')].find((r) => r.textContent.includes(name))?.click(), name)
      await p.mouse.move(800, 300); await p.waitForTimeout(7500)
      for (const s of (process.env.SOLS || 'brume,laque').split(',')) {
        await p.evaluate((s) => Play.setSol(s), s); await p.waitForTimeout(1600)
        const tag = name.toLowerCase().replace(/[^a-z]/g, '')
        await shot(p, `sol-${s}-${tag}`)
        console.log(s, name, await p.evaluate(() => ({ sol: document.documentElement.dataset.sol, gs: document.querySelector('.v-play')?.dataset.gs || 'neutre', front: document.querySelector('.card.is-front')?.getAttribute('aria-label'), spin: document.querySelector('.v-play')?.style.getPropertyValue('--spin') })))
      }
    }
    console.log('ERREURS', errs.length); errs.slice(0, 12).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]); console.log(errs.slice(0, 12).join('\n')) }
  await app.close()
})()
