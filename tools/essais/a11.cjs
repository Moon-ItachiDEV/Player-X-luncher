const { start, shot, settle, go } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a9b', w: 1240, h: 720, env: { PX_LAUNCH_SIM: 'ok' } })
  try {
    await p.evaluate(() => Play.focusGame(GAMES.find((g) => g.routine).id)); await p.waitForTimeout(600)
    await p.click('#htPlay')
    let last = ''
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(350)
      const s = await p.evaluate(() => ({ s: S.session?.phase, t2: document.querySelector('#bT2').textContent, time: document.querySelector('#bTime').textContent, kick: document.querySelector('#htKick').textContent, nodes: [...document.querySelectorAll('#bMarks .ln-node')].map((n) => n.classList.contains('done') ? 'd' : n.classList.contains('cur') ? 'c' : '-').join(''), steps: [...document.querySelectorAll('.hs')].map((x) => (x.classList.contains('done') ? 'd' : x.classList.contains('cur') ? 'c' : '-')).join('') }))
      const k = JSON.stringify(s); if (k !== last) { console.log(i, k); last = k }
      if (i === 8) await shot(p, 'a11-run')
      if (s.s === 'game') { await p.waitForTimeout(1200); await shot(p, 'a11-game'); break }
    }
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
