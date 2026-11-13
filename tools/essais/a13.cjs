// L'overlay CS2 : la vraie fenêtre React, ouverte depuis les paramètres de la V3, puis pendant un match simulé.
const { start, shot, settle } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a13', w: 1240, h: 720, env: { PX_CS2_SIM: 'manual' } })
  const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : String(JSON.stringify(x)).slice(0, 900))))
  const overlay = () => app.windows().find((w) => /#overlay/.test(w.url()))
  try {
    await p.keyboard.press('Control+,'); await settle(p, 800)
    await p.evaluate(() => Settings.go('overlay')); await settle(p, 800)
    await shot(p, 'a13-reglages')
    await p.click('#oOn'); await p.waitForTimeout(800); await shot(p, 'a13-on')
    log('style', await p.evaluate(async () => (await API.getSettings()).cs2Overlay))
    await p.click('#oPrev')
    await p.waitForTimeout(3000)
    const ov = overlay()
    log('fenetres', app.windows().map((w) => w.url().replace(/^.*\/out\//, '')))
    if (ov) {
      ov.on('pageerror', (e) => errs.push('OVERLAY ' + e.message))
      await ov.waitForTimeout(1500)
      log('overlay', await ov.evaluate(() => ({ text: document.body.innerText.slice(0, 300), bg: getComputedStyle(document.documentElement).backgroundColor, size: [innerWidth, innerHeight] })))
      await ov.screenshot({ path: __dirname + '/shots/a13-apercu.png' })
    }
    await p.evaluate(() => Settings.close()); await settle(p, 400)
    await app.evaluate(() => { globalThis.pxCs2Sim.running(true) })
    await p.waitForTimeout(3000)
    await app.evaluate(() => { globalThis.pxCs2Sim.play() })
    await p.waitForTimeout(16000)
    const ov2 = overlay()
    log('en match', ov2 ? await ov2.evaluate(() => document.body.innerText.slice(0, 400)) : 'pas de fenêtre', await p.evaluate(() => document.querySelector('#bT2').textContent))
    if (ov2) await ov2.screenshot({ path: __dirname + '/shots/a13-match.png' })
    log('ERREURS', errs.length); errs.slice(0, 12).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 12).join('\n')) }
  await app.close()
})()
