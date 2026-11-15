const { start, shot, settle, go, done, failed } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a9b', w: 1240, h: 720, env: { PX_LAUNCH_SIM: 'ok' } })
  try {
    // a11 lance la routine qu'a9 enregistre : même dossier de données (« a9b »), a9 d'abord
    if (!(await p.evaluate(() => GAMES.some((g) => g.routine)))) throw new Error('aucun jeu n’a de routine : lance a9 juste avant, avec le même SUF (node tools/essais/tous.cjs a11 le fait)')
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
    done(errs)
  } catch (e) { failed(e, errs) }
  await app.close()
})()
