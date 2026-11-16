const { start, shot } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a1', env: { PX_NEWS_SIM: 'auto', PX_READY_SIM: 'auto', PX_SERVERS_SIM: 'normal' } })
  try {
    const info = await p.evaluate(() => ({ games: GAMES.length, inst: GAMES.filter((g) => g.installed).length, friends: FRIENDS.length, title: document.title, first: GAMES[0]?.name, ready: GAMES[0]?.ready, focus: Play.focused()?.name, tracked: Real.st.tracked, loadouts: BUILDS.length, clips: !!Real.clipsCfg }))
    console.log(JSON.stringify(info))
    await shot(p, 'a1-play')
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(500); await shot(p, 'a1-play2')
    await p.click('.b-tab[data-go=lib]'); await p.waitForTimeout(700); await shot(p, 'a1-lib')
    await p.click('.lb-t[data-id]'); await p.waitForTimeout(900); await shot(p, 'a1-game')
    for (const t of ['overview', 'clips', 'ach']) { await p.click(`.gp-tabs [data-t=${t}]`); await p.waitForTimeout(500); await shot(p, 'a1-game-' + t) }
    await p.click('.b-tab[data-go=friends]'); await p.waitForTimeout(900); await shot(p, 'a1-friends')
    await p.click('.b-tab[data-go=stats]'); await p.waitForTimeout(1200); await shot(p, 'a1-stats')
    await p.click('.b-tab[data-go=clips]'); await p.waitForTimeout(800); await shot(p, 'a1-clips')
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
