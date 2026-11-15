// L'accueil au repos, six mesures à une seconde d'écart : la fenêtre est visible et le titre du jeu est entré (du texte,
// opaque, son animation d'entrée finie). Avant, a3 mesurait les lettres « .bi » du titre : elles n'existent plus.
const { start, shot, check, done, failed } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a1', env: {} })
  try {
    let m
    for (let i = 0; i < 6; i++) {
      m = await p.evaluate(() => { const t = document.querySelector('#htTitle'), a = t?.getAnimations()[0]; return { n: document.getAnimations().length, hid: document.hidden, vis: document.visibilityState, titre: t?.textContent, cls: t?.className, st: a?.playState, op: t && getComputedStyle(t).opacity, raf: performance.now() } })
      console.log(JSON.stringify(m))
      await p.waitForTimeout(1000)
    }
    check('la fenêtre est visible', !m.hid && m.vis === 'visible')
    check('le titre de l’accueil est entré : du texte, opaque, animation finie', !!m.titre && m.op === '1' && /\bis-(in|fade)\b/.test(m.cls) && (!m.st || m.st === 'finished'), { titre: m.titre, classes: m.cls, opacite: m.op, animation: m.st })
    await shot(p, 'a3')
    done(errs)
  } catch (e) { failed(e, errs) }
  await app.close()
})()
