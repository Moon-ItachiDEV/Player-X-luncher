const { start, shot, settle, go } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a1', env: { PX_SERVERS_SIM: 'normal', PX_CS2_STATS_SIM: 'auto' } })
  try {
    await go(p, 'stats'); await shot(p, 'a4-stats')
    await p.click('.sp-g[data-g=cs2]'); await settle(p, 1500); await shot(p, 'a4-cs2')
    for (const t of ['matches', 'weapons', 'maps']) { await p.click(`.sp-tabs [data-t=${t}]`); await p.waitForTimeout(900); await shot(p, 'a4-cs2-' + t) }
    await p.click('.sp-g[data-g=bf6]'); await settle(p, 800)
    await p.click('.sp-tabs [data-t=loadouts]'); await p.waitForTimeout(700); await shot(p, 'a4-lo')
    await p.click('#loSeed'); await p.waitForTimeout(1200); await shot(p, 'a4-lo2')
    console.log(await p.evaluate(() => ({ builds: BUILDS.length, cats: [...new Set(BUILDS.map((b) => b.cat))], first: BUILDS[0] })))
    await p.click('.lw'); await settle(p, 800); await shot(p, 'a4-lo3')
    await p.click('#bGear'); await p.waitForTimeout(800); await shot(p, 'a4-set-rec')
    for (const s of ['overlay', 'routine', 'library', 'general', 'keys', 'accounts', 'about']) { await p.click(`.sh-t[data-s=${s}]`); await p.waitForTimeout(700); await shot(p, 'a4-set-' + s) }
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
