const { start, shot, settle, go } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a8', setupDone: false, env: { PX_LAUNCH_SIM: 'ok', PX_LAUNCH_SIM_FAST: '1' } })
  try {
    await p.evaluate(() => localStorage.removeItem('pxv3-setup')); await p.reload(); await p.waitForLoadState('domcontentloaded')
    await p.waitForTimeout(5000); await shot(p, 'a8-scan')
    await p.waitForSelector('#iwLaunch', { timeout: 30000 }); await p.waitForTimeout(1500); await shot(p, 'a8-scan2')
    await p.click('#iwLaunch'); await p.waitForTimeout(3500); await shot(p, 'a8-s1')
    await p.click('[data-next]'); await p.waitForTimeout(1200); await shot(p, 'a8-s2')
    await p.click('[data-next]'); await p.waitForTimeout(1200); await shot(p, 'a8-s3')
    console.log(await p.evaluate(() => ({ cfg: Real.clipsCfg?.enabled })))
    await p.click('[data-rec="1"]'); await p.waitForTimeout(1200); await shot(p, 'a8-s4')
    console.log(await p.evaluate(() => ({ cfg: Real.clipsCfg?.enabled, next: !!document.querySelector('[data-next]'), end: !!document.querySelector('#suEnd') })))
    if (await p.$('[data-next]')) { await p.click('#suOv'); await p.waitForTimeout(300); await p.click('[data-next]'); await p.waitForTimeout(1200) }
    await shot(p, 'a8-s5')
    await p.click('.su-f'); await p.click('#suEnd'); await p.waitForTimeout(2500); await shot(p, 'a8-home')
    console.log(await p.evaluate(() => ({ key: localStorage.getItem('pxv3-setup'), favs: GAMES.filter((g) => g.fav).map((g) => g.name), ov: Real.st.settings.cs2Overlay })))
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
