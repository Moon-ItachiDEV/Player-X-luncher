// Essai 0.6.2 : la jaquette fournie avec l'appli pour The Witcher 3 (v3ui/assets/cover_witcher3.webp), dans la vraie fenêtre
// en mode démo. Un jeu GOG sans jaquette Steam est ajouté à la liste, comme chez Breezydev, avec un autre jeu GOG sans
// jaquette pour vérifier que le repli (le nom sur sa teinte) reste le même pour les autres.
const { start, shot, settle, go } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'witcher' })
  const ok = (c, m) => console.log(c ? 'OK' : 'NON', m)
  try {
    const add = () => p.evaluate(() => {
      const now = Date.now()
      const gog = (id, name, ago) => ({ id: `gog:${id}`, store: 'gog', storeId: String(id), name, installDir: `C:\\GOG Games\\${name}`, exePath: `C:\\GOG Games\\${name}\\jeu.exe`, lastPlayed: now - ago, lastPlayedSource: 'launch', playtime: 5400, playtimeSource: 'local' })
      Real.st.raw = [...Real.st.raw.filter((r) => r.store !== 'gog'), gog(1495134320, 'The Witcher 3: Wild Hunt - Game of the Year Edition', 60_000), gog(1771589310, 'Disco Elysium - The Final Cut', 120_000)]
      Real.applyGames(); Play.sync()
      document.head.append(Object.assign(document.createElement('style'), { textContent: '#toasts{display:none!important}' }))
    })
    await add(); await p.waitForTimeout(1500)
    const w = await p.evaluate(() => { const g = GAMES.find((x) => x.rid === 'gog:1495134320'); const d = GAMES.find((x) => x.rid === 'gog:1771589310'); return { w: g && { id: g.id, cover: g.cover, own: g.ownCover, src: A(g.cover) }, d: d && { cover: d.cover.slice(0, 30), own: d.ownCover } } })
    console.log(JSON.stringify(w))
    ok(w.w?.cover === 'cover_witcher3' && w.w.own && w.w.src === 'assets/cover_witcher3.webp', 'The Witcher 3 (GOG, sans jaquette Steam) prend la jaquette fournie')
    ok(w.d?.cover.startsWith('data:image/svg') && !w.d.own, 'un autre jeu sans jaquette garde son repli')

    const front = async () => p.evaluate(() => { const c = document.querySelector('.card.is-front'), im = c?.querySelector('img'); return { name: c?.getAttribute('aria-label'), src: im?.getAttribute('src'), nat: im?.naturalWidth || 0 } })
    for (const v of ['v', 'r']) {
      await p.evaluate((v) => Play.setHome(v), v); await p.mouse.move(700, 450); await p.waitForTimeout(1200)
      const f0 = await front()
      await p.evaluate(() => Play.focusGame(GAMES.find((x) => x.rid === 'gog:1495134320')?.id))
      // Le rendu logiciel est lent : la pile peut mettre plusieurs secondes à arriver
      const tr = [f0.name]; let f = f0
      for (let k = 0; k < 40 && !/witcher/i.test(f.name || ''); k++) { await p.waitForTimeout(400); f = await front(); if (tr[tr.length - 1] !== f.name) tr.push(f.name) }
      console.log('trajet', v, tr.join(' > '))
      console.log(v, JSON.stringify(f))
      ok(/witcher/i.test(f.name || '') && /cover_witcher3\.webp$/.test(f.src || '') && f.nat > 300, `accueil ${v === 'v' ? 'Vitrine' : 'Arsenal'} : la jaquette s'affiche (${f.nat} px de large)`)
      await p.waitForTimeout(1500); await shot(p, `witcher-${v}`)
    }
    // La bibliothèque et la fiche du jeu
    await p.evaluate(() => Play.setHome('0'))
    await go(p, 'lib'); await p.waitForTimeout(1500)
    const lib = await p.evaluate(() => [...document.querySelectorAll('img')].filter((im) => /cover_witcher3\.webp$/.test(im.getAttribute('src') || '')).map((im) => im.naturalWidth))
    ok(lib.length > 0 && lib.every((n) => n > 300), `bibliothèque : ${lib.length} image(s) de la jaquette, chargées`)
    await shot(p, 'witcher-biblio')
    const id = await p.evaluate(() => GAMES.find((x) => x.rid === 'gog:1495134320')?.id)
    await p.evaluate((id) => Pages.openGame(id), id); await settle(p, 2500)
    const sheet = await p.evaluate(() => [...document.querySelectorAll('img')].filter((im) => /cover_witcher3\.webp$/.test(im.getAttribute('src') || '') && im.offsetParent).map((im) => im.naturalWidth))
    console.log('fiche', JSON.stringify(sheet))
    await shot(p, 'witcher-fiche')
    // Le jeu GOG est imité dans la page seulement : le moteur ne le connaît pas, donc ses actus répondent « Jeu introuvable ». Attendu, pas compté.
    const vraies = errs.filter((e) => !/news:game.*Jeu introuvable/.test(e))
    console.log('ERREURS', vraies.length, `(${errs.length - vraies.length} attendue : actus du jeu imité)`); vraies.slice(0, 12).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]); console.log(errs.slice(0, 12).join('\n')) }
  await app.close()
})()
