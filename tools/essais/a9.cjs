const { start, shot, settle, go } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a9b', w: 1240, h: 720, env: { PX_LAUNCH_SIM: 'ok', PX_LAUNCH_SIM_FAST: '1' } })
  try {
    // Loadout : créer, retrouver après rechargement
    await p.evaluate(() => { S.statsGame = 'bf6'; S.statsTab = 'loadouts'; go('stats') }); await settle(p, 900)
    await p.click('#loNew0, #loNew'); await settle(p, 900); await shot(p, 'a9-at0')
    await p.click('#atSave'); await p.waitForTimeout(400); await shot(p, 'a9-at-err')
    await p.fill('#atW', 'M433'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.fill('#atName', 'Mon build test'); await p.waitForTimeout(800)
    await p.fill('#atP-optic', 'CCO 2.00X'); await p.keyboard.press('Tab'); await p.fill('#atN-optic', '10'); await p.waitForTimeout(800); await shot(p, 'a9-at1')
    await p.click('#atSave'); await p.waitForTimeout(1500); await shot(p, 'a9-at-saved')
    console.log(await p.evaluate(async () => ({ builds: BUILDS.map((b) => [b.id, b.w, b.name, b.parts.optic]), real: (await API.getBf6Loadouts()).map((l) => [l.id, l.weapon, l.name, l.parts.optic, l.cat]) , weapons: (await API.getMyBf6Weapons()).map((w) => w.name) })))
    // Collection
    await go(p, 'lib'); await p.click('#lbNew'); await p.waitForTimeout(500); await p.fill('#pnN', 'Avec les potes'); await p.click('.pn-t'); await p.click('.pn-t:nth-child(2)'); await p.waitForTimeout(200); await shot(p, 'a9-col'); await p.click('#pnOk'); await p.waitForTimeout(1200); await shot(p, 'a9-col2')
    console.log(await p.evaluate(async () => ({ shelves: await API.getShelves(), filter: S.libFilter })))
    // Masquer
    await p.click('.lb-t[data-id]'); await settle(p, 800); await p.click('#gpShelf'); await p.waitForTimeout(300); await shot(p, 'a9-shelf')
    await p.keyboard.press('Escape')
    // Routine réelle
    await p.evaluate(() => Settings.open('routine')); await p.waitForTimeout(700)
    await p.fill('#rtN', 'Soirée test'); await p.click('#rtForm button[type=submit]'); await p.waitForTimeout(700)
    await p.click('#rtAdd'); await p.waitForTimeout(300); await shot(p, 'a9-rt-menu'); await p.click('[data-add=wait]'); await p.waitForTimeout(300); await p.fill('#rtV', '200'); await p.keyboard.press('Tab'); await p.waitForTimeout(200); await shot(p, 'a9-rt-err'); await p.fill('#rtV', '2'); await p.click('#rtAddF button[type=submit]'); await p.waitForTimeout(500)
    await p.click('#rtAdd'); await p.waitForTimeout(200); await p.click('[data-add=minimize]'); await p.waitForTimeout(400)
    await p.click('#rtAdd'); await p.waitForTimeout(200); await p.click('[data-add=link]'); await p.fill('#rtV', 'ftp://x'); await p.click('#rtAddF button[type=submit]'); await p.waitForTimeout(200); await p.fill('#rtV', 'https://example.com/a'); await p.click('#rtAddF button[type=submit]'); await p.waitForTimeout(500); await shot(p, 'a9-rt')
    await p.waitForTimeout(400)
    console.log(JSON.stringify(await p.evaluate(async () => API.getRoutines())))
    console.log(await p.evaluate(() => { const g = GAMES.find((x) => x.routine); return g && { g: g.name, r: g.routine, steps: ROUTINES[g.routine].steps.map((s) => s.t) } }))
    await p.keyboard.press('Escape'); await p.waitForTimeout(500)
    await go(p, 'play'); await p.waitForTimeout(500); await shot(p, 'a9-play-rt')
    // Palette
    await p.keyboard.press('Control+k'); await p.waitForTimeout(300); await shot(p, 'a9-pal'); await p.keyboard.type('m433'); await p.waitForTimeout(300); await shot(p, 'a9-pal2'); await p.keyboard.press('Escape')
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
