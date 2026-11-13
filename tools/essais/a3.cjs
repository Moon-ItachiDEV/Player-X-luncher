const { start, shot } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a1', env: {} })
  for (let i = 0; i < 6; i++) {
    console.log(JSON.stringify(await p.evaluate(() => { const b = document.querySelector('#htTitle .bi'), a = b?.getAnimations()[0]; return { n: document.getAnimations().length, hid: document.hidden, vis: document.visibilityState, st: a?.playState, t: a?.currentTime, dur: a?.effect.getTiming().duration, del: a?.effect.getTiming().delay, op: b && getComputedStyle(b).opacity, raf: performance.now() } })))
    await p.waitForTimeout(1000)
  }
  await shot(p, 'a3')
  await app.close()
})()
