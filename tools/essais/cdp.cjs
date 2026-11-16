const { chromium } = require('playwright')
;(async () => {
  let b
  for (let i = 0; i < 40; i++) { try { b = await chromium.connectOverCDP('http://127.0.0.1:9333'); break } catch { await new Promise((r) => setTimeout(r, 2000)) } }
  if (!b) { console.log('pas de connexion'); process.exit(1) }
  const pages = b.contexts().flatMap((c) => c.pages())
  console.log('pages', pages.map((p) => p.url()))
  const p = pages.find((x) => /v3\/index\.html/.test(x.url())) || pages[0]
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  for (const t of [20, 40, 60]) {
    await p.waitForTimeout(t === 20 ? 20000 : 20000)
    const st = await p.evaluate(() => ({
      loaded: !!(window.Real && Real.st && Real.st.loaded), games: typeof GAMES !== 'undefined' ? GAMES.length : -1,
      setupDone: localStorage.getItem('pxv3-setup'), view: document.querySelector('.v:not([hidden])')?.dataset?.v, body: document.body.innerText.slice(0, 200).replace(/\n+/g, ' | '),
      size: [innerWidth, innerHeight], clips: window.Real?.clipsLive, demo: window.Real?.st?.settings?.demoMode, update: Real.st.updates?.state
    })).catch((e) => ({ err: e.message }))
    console.log(t, JSON.stringify(st).slice(0, 700))
    await p.screenshot({ path: process.argv[2] + '/cdp' + t + '.png' }).catch((e) => console.log('shot', e.message.slice(0, 120)))
  }
  console.log('demo refuse', await p.evaluate(async () => { await window.launcher.saveSettings({ demoMode: true }).catch(() => {}); return (await window.launcher.getSettings()).demoMode }))
  console.log('sims', await p.evaluate(() => Object.keys(window.launcher).length))
  console.log('erreurs', errs)
  await b.close()
})()
