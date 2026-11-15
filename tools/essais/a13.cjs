// L'overlay CS2 : la vraie fenêtre React, ouverte depuis les paramètres de la V3, puis pendant un match simulé.
// L'aperçu (chiffres d'exemple), puis le match : rien tant que Player X est devant, la partie dès qu'on retourne au jeu.
const { start, shot, settle, check, done, failed } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a13', w: 1240, h: 720, env: { PX_CS2_SIM: 'manual' } })
  const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : String(JSON.stringify(x)).slice(0, 900))))
  // renderer/index.html ne sert qu'à l'overlay (la fenêtre principale charge renderer/v3/index.html). Avant, a13 cherchait
  // une adresse en « #overlay » qui n'existe plus : il ne trouvait jamais la fenêtre et ne vérifiait rien.
  const overlay = () => app.windows().find((w) => /\/renderer\/index\.html/.test(w.url()))
  const seen = (w) => w.evaluate(() => ({ racine: document.querySelector('.ov-root')?.className || null, texte: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 300), fond: getComputedStyle(document.documentElement).backgroundColor, taille: [innerWidth, innerHeight] }))
  const bar = () => p.evaluate(() => document.querySelector('#bT2').textContent)
  try {
    await p.keyboard.press('Control+,'); await settle(p, 800)
    await p.evaluate(() => Settings.go('overlay')); await settle(p, 800)
    await shot(p, 'a13-reglages')
    await p.click('#oOn'); await p.waitForTimeout(800); await shot(p, 'a13-on')
    const style = await p.evaluate(async () => (await API.getSettings()).cs2Overlay)
    log('style', style)
    await p.click('#oPrev')
    await p.waitForTimeout(3000)
    const ov = overlay()
    const fenetres = app.windows().map((w) => w.url().replace(/^.*\/out\//, ''))
    log('fenetres', fenetres)
    if (!check('l’aperçu ouvre la fenêtre de l’overlay', !!ov, fenetres)) throw new Error('pas de fenêtre d’overlay : la suite ne peut rien vérifier')
    ov.on('pageerror', (e) => errs.push('OVERLAY ' + e.message))
    await ov.waitForTimeout(1500)
    const o = await seen(ov)
    log('overlay', o)
    check('aperçu : une carte au style choisi, sur fond transparent, dite « chiffres d’exemple »', o.racine === `ov-root ov-${style}` && /Aperçu · chiffres d’exemple/.test(o.texte) && o.fond === 'rgba(0, 0, 0, 0)', o)
    await ov.screenshot({ path: __dirname + '/shots/a13-apercu.png' })
    await p.evaluate(() => Settings.close()); await settle(p, 400)
    await app.evaluate(() => { globalThis.pxCs2Sim.running(true) })
    await p.waitForTimeout(3000)
    await app.evaluate(() => { globalThis.pxCs2Sim.play() })
    await p.waitForTimeout(16000)
    const ov2 = overlay()
    if (!check('en match : la fenêtre de l’overlay est là', !!ov2, app.windows().length)) throw new Error('plus de fenêtre d’overlay pendant le match')
    if (ov2 !== ov) ov2.on('pageerror', (e) => errs.push('OVERLAY ' + e.message))
    // Player X est devant (et l'aperçu de 24 s est fini) : l'overlay s'efface pour ne pas le couvrir
    const devant = await ov2.waitForFunction(() => !document.querySelector('.ov-root'), null, { timeout: 15000 }).then(() => true, () => false)
    log('en match, Player X devant', await seen(ov2), await bar())
    check('en match, Player X devant : l’overlay ne montre rien', devant)
    // Retour au jeu : Player X n'a plus le focus, l'overlay montre la partie
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.blur() })
    const montre = await ov2.waitForFunction(() => !!document.querySelector('.ov-root'), null, { timeout: 15000 }).then(() => true, () => false)
    // Les mêmes chiffres que la barre de Player X (K/D/A), lus à quelques millisecondes d'écart : jusqu'à cinq lectures
    let m = null, memes = false
    for (let i = 0; i < 5 && !memes; i++) {
      const avant = await bar(); m = await seen(ov2); const apres = await bar()
      memes = [avant, apres].some((t) => { const kda = (/\d+\/\d+\/\d+/.exec(t) || [])[0]; return !!kda && m.texte.includes(kda) })
      log('en match, retour au jeu', m, avant)
      if (!memes) await p.waitForTimeout(700)
    }
    check('en match, retour au jeu : l’overlay montre la partie, au style choisi', montre && m.racine === `ov-root ov-${style}` && !/Aperçu/.test(m.texte), m)
    check('en match, retour au jeu : les mêmes K/D/A que la barre de Player X', memes, m && m.texte)
    await ov2.screenshot({ path: __dirname + '/shots/a13-match.png' })
    done(errs, 12)
  } catch (e) { failed(e, errs, 12) }
  await app.close()
})()
