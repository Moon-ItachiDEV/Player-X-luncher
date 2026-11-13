// L'asar exacte de l'installeur, en mode installé (app.isPackaged vrai) : aucun simulateur, la démo refusée, vraie première ouverture.
const { _electron } = require('playwright')
const path = require('path')
const BIN = process.argv[2]
const OUT = path.resolve(__dirname, 'shots')
;(async () => {
  const dir = path.resolve(__dirname, 'data-a16' + (process.env.SUF || ''))
  const app = await _electron.launch({ executablePath: BIN, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--user-data-dir=' + dir], env: { ...process.env, PX_LAUNCH_SIM: 'ok', PX_CS2_SIM: 'auto', PX_CLIP_TEST_SOURCE: '640x360', PX_SOFTGL: '1' } })
  const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : String(JSON.stringify(x)).slice(0, 900))))
  const p = await app.firstWindow()
  const errs = []
  p.on('pageerror', (e) => errs.push('PAGE ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')))
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource|net::/.test(m.text())) errs.push('CONS ' + m.text().slice(0, 400)) })
  const shot = async (n) => { await p.waitForTimeout(100); await p.screenshot({ path: `${OUT}/a16-${n}.png` }) }
  try {
    log('packaged', await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), name: app.getName(), userData: app.getPath('userData').slice(-30), appPath: app.getAppPath().slice(-40) })))
    log('sims', await app.evaluate(() => ({ cs2: !!globalThis.pxCs2Sim, clips: !!globalThis.pxClipsTest })))
    log('url', p.url().replace(/^.*\/resources\//, 'resources/'))
    await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(9000)
    await shot('1')
    log('etat', await p.evaluate(async () => ({ view: document.querySelector('.v:not([hidden])')?.dataset?.v, install: !!document.querySelector('#iw:not([hidden]), .iw'), text: document.body.innerText.slice(0, 160).replace(/\n+/g, ' | '), demo: (await API.getSettings()).demoMode })))
    await p.evaluate(async () => { await API.saveSettings({ demoMode: true }).catch(() => {}) })
    log('demo apres essai', await p.evaluate(async () => (await API.getSettings()).demoMode))
    log('mise a jour', await p.evaluate(async () => API.updateState ? await API.updateState().catch((e) => e.message) : Real.st.updates))
    log('clips', { ...(await p.evaluate(async () => ({ state: await API.clipsState(), cfg: await API.clipsGetSettings() }))), save: await app.evaluate(() => globalThis.pxClipsTest.saveNow()) })
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(1500)
      const s = await p.evaluate(() => ({ iw: [...document.querySelectorAll('.iw-act button, .iw button')].map((b) => b.textContent.trim()).slice(0, 4), story: !document.querySelector('#story')?.hidden, kick: document.querySelector('#story .sl-kick')?.textContent, games: GAMES.length }))
      if (i % 6 === 0) log(i, s)
      const go = s.iw[0]
      if (go && !s.story) { await p.click('.iw-act button, .iw button').catch(() => {}); await p.waitForTimeout(1200) }
      if (s.story) break
    }
    await shot('2')
    log('story', await p.evaluate(() => ({ kick: document.querySelector('#story .sl-kick')?.textContent, h: document.querySelector('#story .sl-h1')?.textContent })))
    await p.evaluate(() => Story.close?.()); await p.waitForTimeout(1500)
    await p.evaluate(() => { localStorage.setItem('pxv3-setup', '1') })
    await p.reload(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(9000)
    await shot('3')
    log('apres', await p.evaluate(() => ({ view: document.querySelector('.v:not([hidden])')?.dataset?.v, title: document.querySelector('#htTitle')?.textContent, games: GAMES.length, cta: document.querySelector('#htPlayL')?.textContent })))
    for (const v of ['lib', 'clips', 'stats', 'friends']) { await p.click(`.b-tab[data-go=${v}]`); await p.waitForTimeout(2500); await shot('v-' + v) }
    await p.keyboard.press('Control+,'); await p.waitForTimeout(2000)
    await p.evaluate(() => Settings.go('overlay')); await p.waitForTimeout(1200); await p.click('#oOn'); await p.waitForTimeout(800); await p.click('#oPrev'); await p.waitForTimeout(3000)
    log('overlay', app.windows().map((w) => w.url().replace(/^.*\/resources\//, 'resources/')))
    await p.evaluate(() => Settings.go('about')); await p.waitForTimeout(1200); await shot('about')
    log('ERREURS', errs.length); errs.slice(0, 12).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 12).join('\n')) }
  const t0 = Date.now(); await app.close(); log('fermeture', Date.now() - t0, 'ms')
})()
