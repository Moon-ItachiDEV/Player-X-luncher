const { start, shot, settle, go } = require('./h.cjs')
const snap = (p) => p.evaluate(() => ({ s: S.session && { g: S.session.game, ph: S.session.phase }, mode: document.querySelector('#bar').dataset.mode, t1: document.querySelector('#bT1').textContent, t2: document.querySelector('#bT2').textContent, time: document.querySelector('#bTime').textContent, cta: document.querySelector('#htPlayL').textContent, toast: [...document.querySelectorAll('.toast')].map((x) => x.textContent).slice(-2), steps: [...document.querySelectorAll('.hs')].map((x) => x.textContent + (x.classList.contains('cur') ? '*' : '')) }))
;(async () => {
  const mode = process.argv[2] || 'ok'
  const { app, p, errs } = await start({ name: 'a5-' + mode, env: { PX_LAUNCH_SIM: mode, PX_LAUNCH_SIM_FAST: '1' } })
  try {
    await p.click('#htPlay')
    for (let i = 0; i < 5; i++) { await p.waitForTimeout(500); console.log(JSON.stringify(await snap(p))); if (i === 1) await shot(p, `a5-${mode}-launch`) }
    await shot(p, `a5-${mode}-end`)
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
