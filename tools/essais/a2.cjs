const { start, shot, done, failed } = require('./h.cjs')
const W = 2200
;(async () => {
  const { app, p, errs } = await start({ name: 'a1', env: { PX_NEWS_SIM: 'auto', PX_SERVERS_SIM: 'normal' } })
  try {
    await p.waitForTimeout(1500)
    console.log(await p.evaluate(() => { const t = document.querySelector('#htTitle'), cs = getComputedStyle(t); return { html: t.innerHTML.slice(0, 200), cls: t.className, op: cs.opacity, h: t.offsetHeight, fs: cs.fontSize, col: cs.color } }))
    await shot(p, 'a2-play')
    await p.click('.b-tab[data-go=lib]'); await p.waitForTimeout(W); await shot(p, 'a2-lib')
    await p.click('.lb-t[data-id]'); await p.waitForTimeout(W); await shot(p, 'a2-game')
    await p.click(`.gp-tabs [data-t=overview]`); await p.waitForTimeout(900); await shot(p, 'a2-game-overview')
    await p.click('.b-tab[data-go=friends]'); await p.waitForTimeout(W); await shot(p, 'a2-friends')
    await p.click('.b-tab[data-go=stats]'); await p.waitForTimeout(W); await shot(p, 'a2-stats')
    done(errs)
  } catch (e) { failed(e, errs) }
  await app.close()
})()
