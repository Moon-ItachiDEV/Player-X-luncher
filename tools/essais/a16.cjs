// L'asar exacte de l'installeur, en mode installé (app.isPackaged vrai) : aucun simulateur, la démo refusée, vraie première ouverture.
const { _electron } = require('playwright')
const path = require('path')
const { check, done, failed } = require('./h.cjs')
const BIN = process.argv[2]
const OUT = path.resolve(__dirname, 'shots')
;(async () => {
  if (!BIN) { console.log('ECHEC il manque l’appli empaquetée : node tools/essais/a16.cjs <chemin du binaire>'); process.exitCode = 1; return }
  const dir = path.resolve(__dirname, 'data-a16' + (process.env.SUF || ''))
  const app = await _electron.launch({ executablePath: BIN, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--user-data-dir=' + dir], env: { ...process.env, PX_LAUNCH_SIM: 'ok', PX_CS2_SIM: 'auto', PX_CLIP_TEST_SOURCE: '640x360', PX_SOFTGL: '1' } })
  const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : String(JSON.stringify(x)).slice(0, 900))))
  const p = await app.firstWindow()
  const errs = []
  p.on('pageerror', (e) => errs.push('PAGE ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')))
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource|net::/.test(m.text())) errs.push('CONS ' + m.text().slice(0, 400)) })
  const shot = async (n) => { await p.waitForTimeout(100); await p.screenshot({ path: `${OUT}/a16-${n}.png` }) }
  try {
    const etat = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), name: app.getName(), userData: app.getPath('userData').slice(-30), appPath: app.getAppPath().slice(-40) }))
    log('packaged', etat)
    check('l’appli tourne en mode installé', etat.packaged === true, etat.packaged)
    // PX_CS2_SIM et PX_CLIP_TEST_SOURCE sont donnés exprès : la version installée ne doit pas les écouter
    const sims = await app.evaluate(() => ({ cs2: !!globalThis.pxCs2Sim, clips: !!globalThis.pxClipsTest }))
    log('sims', sims)
    check('aucun simulateur ni outil d’essai dans la version installée', !sims.cs2 && !sims.clips, sims)
    log('url', p.url().replace(/^.*\/resources\//, 'resources/'))
    await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(9000)
    await shot('1')
    log('etat', await p.evaluate(async () => ({ view: document.querySelector('.v:not([hidden])')?.dataset?.v, install: !!document.querySelector('#iw:not([hidden]), .iw'), text: document.body.innerText.slice(0, 160).replace(/\n+/g, ' | '), demo: (await API.getSettings()).demoMode })))
    await p.evaluate(async () => { await API.saveSettings({ demoMode: true }).catch(() => {}) })
    const demo = await p.evaluate(async () => (await API.getSettings()).demoMode)
    log('demo apres essai', demo)
    check('la démo est refusée', demo === false, demo)
    log('mise a jour', await p.evaluate(async () => API.updateState ? await API.updateState().catch((e) => e.message) : Real.st.updates))
    log('clips', await p.evaluate(async () => ({ state: await API.clipsState(), cfg: await API.clipsGetSettings() })))
    // La vraie première ouverture : le scan de cette machine, puis le bouton principal de chaque étape, jusqu'à l'accueil
    await p.waitForSelector('#iw [data-main]', { timeout: 40000 })
    const etapes = []
    for (let i = 0; i < 10 && !(await p.evaluate(() => document.querySelector('#inst').hidden)); i++) {
      if (!(await p.$('#iw [data-main]'))) { await p.waitForTimeout(500); continue }
      etapes.push(await p.evaluate(() => `${document.querySelector('#iwT')?.textContent} [${document.querySelector('#iw [data-main]').textContent.trim()}]`))
      await shot('iw' + etapes.length)
      await p.click('#iw [data-main]'); await p.waitForTimeout(1500)
    }
    const ouverte = await p.evaluate(() => ({ fermee: document.querySelector('#inst').hidden, key: localStorage.getItem('pxv3-setup'), games: GAMES.length, clips: Real.clipsCfg?.enabled }))
    log('premiere ouverture', etapes, ouverte)
    check('première ouverture : trois étapes, puis l’accueil, notée comme vue', etapes.length === 3 && ouverte.fermee && ouverte.key === '1', etapes)
    await shot('2')
    // La page rechargée : plus de première ouverture, l'accueil tout de suite
    await p.reload(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(9000)
    await shot('3')
    const apres = await p.evaluate(() => ({ view: document.querySelector('.v:not([hidden])')?.dataset?.v, premiere: !document.querySelector('#inst').hidden, title: document.querySelector('#htTitle')?.textContent, games: GAMES.length, cta: document.querySelector('#htPlayL')?.textContent }))
    log('apres', apres)
    check('page rechargée : l’accueil, sans première ouverture', apres.view === 'play' && !apres.premiere, apres)
    for (const v of ['lib', 'clips', 'stats', 'friends']) { await p.click(`.b-tab[data-go=${v}]`); await p.waitForTimeout(2500); await shot('v-' + v) }
    await p.keyboard.press('Control+,'); await p.waitForTimeout(2000)
    await p.evaluate(() => Settings.go('overlay')); await p.waitForTimeout(1200); await p.click('#oOn'); await p.waitForTimeout(800); await p.click('#oPrev'); await p.waitForTimeout(3000)
    const fenetres = app.windows().map((w) => w.url().replace(/^.*\/resources\//, 'resources/'))
    log('overlay', fenetres)
    check('l’aperçu de l’overlay ouvre sa propre fenêtre', fenetres.length === 2, fenetres.length)
    await p.evaluate(() => Settings.go('about')); await p.waitForTimeout(1200); await shot('about')
    done(errs, 12)
  } catch (e) { failed(e, errs, 12) }
  const t0 = Date.now(); await app.close(); log('fermeture', Date.now() - t0, 'ms')
})()
