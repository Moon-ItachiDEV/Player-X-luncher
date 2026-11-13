// Le vrai raccourci Alt C pendant l'enregistrement : la pastille à l'écran, puis le clip.
const { start, shot } = require('./h.cjs')
const { execFileSync } = require('child_process')
;(async () => {
  const { app, p, errs } = await start({ name: 'a17', w: 1240, h: 720, env: { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' } })
  const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : String(JSON.stringify(x)).slice(0, 700))))
  try {
    await p.evaluate(() => Real.saveClips({ before: 6, after: 1, merge: 0, quality: 'light' }))
    await app.evaluate(() => { globalThis.pxCs2Sim.running(true) })
    for (let i = 0; i < 40; i++) { await p.waitForTimeout(1000); if (await p.evaluate(() => (Real.clipsLive?.bufferSeconds || 0) >= 7)) break }
    log('touches', execFileSync('python3', [process.argv[2], 'Alt_L', 'c'], { env: process.env }).toString().trim())
    await p.waitForTimeout(700)
    log('fenetres', app.windows().map((w) => w.url().slice(0, 40)))
    log('titres', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => [w.getTitle(), w.isVisible(), w.getBounds(), w.isFocusable()])))
    execFileSync('import', ['-window', 'root', __dirname + '/shots/a17-root.png'], { env: process.env })
    await p.waitForTimeout(2200)
    log('apres', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle())))
    for (let i = 0; i < 20; i++) { await p.waitForTimeout(1000); if (await p.evaluate(async () => (await API.clipsList()).length)) break }
    log('clips', await p.evaluate(async () => (await API.clipsList()).map((c) => [c.title, c.kind, c.durationS])))
    log('ERREURS', errs.length); errs.slice(0, 10).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 10).join('\n')) }
  const t0 = Date.now(); await app.close(); log('fermeture', Date.now() - t0)
})()
