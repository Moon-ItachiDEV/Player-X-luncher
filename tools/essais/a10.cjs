const { start, shot, settle, go } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a10', demo: false, setupDone: false, w: 1240, h: 720 })
  try {
    await p.waitForSelector('#iwLaunch', { timeout: 40000 }); await p.waitForTimeout(800); await shot(p, 'a10-scan')
    console.log(await p.evaluate(() => ({ games: GAMES.length, rep: Real.st.report })))
    await p.click('#iwLaunch'); await p.waitForTimeout(3000); await shot(p, 'a10-s1')
    await p.evaluate(() => Story.close()); await p.waitForTimeout(1000); await shot(p, 'a10-home')
    await go(p, 'lib'); await shot(p, 'a10-lib')
    await go(p, 'friends'); await shot(p, 'a10-friends')
    await go(p, 'clips'); await shot(p, 'a10-clips')
    await go(p, 'stats'); await shot(p, 'a10-stats')
    await p.click('.sp-g[data-g=cs2]'); await settle(p, 1500); await shot(p, 'a10-cs2')
    await p.click('#bGear'); await p.waitForTimeout(700); await p.click('.sh-t[data-s=routine]'); await p.waitForTimeout(500); await shot(p, 'a10-rt')
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
