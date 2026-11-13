const { start, shot, settle, go } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a6', env: { PX_CS2_SIM: 'manual' } })
  try {
    console.log(await p.evaluate(() => ({ st: Real.st.cs2 && { enabled: Real.st.cs2.enabled, config: Real.st.cs2.config, demo: Real.st.cs2.demo }, cs2: G('cs2')?.name, focus: Play.focused().name, set: Real.st.settings.cs2Live })))
    await p.evaluate(() => { Play.focusGame('cs2') }); await p.waitForTimeout(800)
    await app.evaluate(() => { globalThis.pxCs2Sim.play?.() })
    let last = ''
    for (let i = 0; i < 60; i++) {
      await p.waitForTimeout(1000)
      const s = await p.evaluate(() => ({ s: S.session?.phase, t1: document.querySelector('#bT1').textContent, t2: document.querySelector('#bT2').textContent, marks: document.querySelectorAll('#bMarks .ln-x').length, toast: [...document.querySelectorAll('.toast')].map((x) => x.textContent), story: !document.querySelector('#story').hidden }))
      const k = JSON.stringify(s); if (k !== last) { console.log(i, k.slice(0, 220)); last = k }
      if (i === 12) await shot(p, 'a6-live')
      if (s.story) break
      if (s.toast.some((x) => /Voir le bilan/.test(x))) { await p.click('.toast-a'); await p.waitForTimeout(1500); break }
    }
    await shot(p, 'a6-r1')
    for (let i = 2; i <= 4; i++) { const has = await p.evaluate(() => !document.querySelector('#stNext').hidden); if (!has) break; await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1500); await shot(p, 'a6-r' + i) }
    await p.keyboard.press('Escape'); await p.waitForTimeout(800)
    await p.evaluate(() => { S.statsGame = 'cs2'; S.statsTab = 'matches'; go('stats') }); await settle(p, 1200); await shot(p, 'a6-matches')
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
