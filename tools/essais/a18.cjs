// Jaquettes des jeux EA qui arrivent après le scan, par le vrai signal games:changed : 7 jeux, comme chez Breezydev, puis 10, 2, et une image cassée.
const { start, shot, settle } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a18', demo: false, setupDone: true, w: 1600, h: 940 })
  const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : String(JSON.stringify(x)).slice(0, 900))))
  const tiles = () => p.evaluate(() => {
    const c = document.querySelector('.card-all'), im = [...c.querySelectorAll('.ca-in img')], box = c.querySelector('.ca-grid')
    return { count: c.querySelector('.ca-t>span').textContent, tiles: im.length, ratio: im[0] ? +(im[0].offsetWidth / im[0].offsetHeight).toFixed(3) : null, size: im[0] ? [im[0].offsetWidth, im[0].offsetHeight] : null, box: [box.offsetWidth, box.offsetHeight], inner: [c.querySelector('.ca-in').offsetWidth, c.querySelector('.ca-in').offsetHeight], repli: im.filter((x) => x.getAttribute('src').startsWith('data:image/svg')).length, names: im.map((x) => x.dataset.name) }
  })
  const repli = () => p.evaluate(() => [...document.querySelectorAll('img[src^="data:image/svg+xml"]')].map((x) => x.closest('.card,.bgw-c,#bCover,.iw-c,.lb-c')?.className || x.parentElement.className).reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {}))
  // Une fausse jaquette 2:3 avec le nom écrit dedans : on voit tout de suite si elle est recadrée
  const art = (names) => p.evaluate((names) => Object.fromEntries(names.map((n, i) => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 450; const g = c.getContext('2d')
    g.fillStyle = `hsl(${i * 47} 60% 38%)`; g.fillRect(0, 0, 300, 450); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(3, 3, 294, 444)
    g.fillStyle = '#fff'; g.font = '700 26px Arial'; g.fillText(n.slice(0, 18), 12, 40); g.fillText(n.slice(0, 18), 12, 430)
    return [n, c.toDataURL('image/jpeg', .8)]
  })), names)
  const setList = async (list, wait = 1600) => {
    await app.evaluate(({ ipcMain, BrowserWindow }, list) => {
      globalThis.__list = list
      ipcMain.removeHandler('games:list'); ipcMain.handle('games:list', () => globalThis.__list)
      ipcMain.removeHandler('steam:library'); ipcMain.handle('steam:library', () => ({ notInstalled: [] }))
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('games:changed')
    }, list)
    await p.waitForTimeout(wait)
  }
  const game = (n, i, urls, ea) => ({ id: (ea ? 'ea:' : 'steam:') + (1000 + i), name: n, store: ea ? 'ea' : 'steam', storeId: String(1000 + i), installDir: 'x', playtime: 60, lastPlayed: Date.now() - i * 60000, ...(urls ? { coverUrl: urls[n], heroUrl: urls[n] } : {}) })
  try {
    const seven = ['Age of Empires IV', 'Battlefield 6', 'Battlefield V', 'Counter-Strike 2', 'DRAGON BALL: Sparking! ZERO', 'EA SPORTS FC 27', 'Hades']
    const isEa = (n) => /Battlefield|EA SPORTS/.test(n), urls = await art(seven)
    await setList(seven.map((n, i) => game(n, i, isEa(n) ? null : urls, isEa(n))))
    log('juste apres le scan', await tiles()); log('replis', await repli())
    for (let i = 0; i < 9 && await p.evaluate(() => document.querySelector('#htTitle').textContent !== 'Toute ta bibliothèque'); i++) { await p.keyboard.press('ArrowUp'); await p.waitForTimeout(900) }
    await p.waitForTimeout(7000); await settle(p, 800)
    log('titre', await p.evaluate(() => document.querySelector('#htTitle').textContent))
    await shot(p, 'a18-avant')
    // Sept jeux dont six sans image : le repli reste entier, le nom lisible
    await setList(seven.map((n, i) => game(n, i, n === 'Hades' ? urls : null, n !== 'Hades')))
    log('presque rien', await tiles()); await p.waitForTimeout(4000); await settle(p, 800); await shot(p, 'a18-repli')
    // Les images EA arrivent : le vrai signal, comme updateArtwork
    await setList(seven.map((n, i) => game(n, i, isEa(n) ? null : urls, isEa(n))))
    await setList(seven.map((n, i) => game(n, i, urls, isEa(n))))
    log('images arrivees', await tiles()); log('replis restants', await repli())
    await p.keyboard.press('ArrowUp'); await settle(p, 1200); await p.keyboard.press('ArrowUp'); await settle(p, 1500)
    log('sur le jeu', await p.evaluate(() => ({ t: document.querySelector('#htTitle').textContent, cover: document.querySelector('.card:not(.card-all) img').getAttribute('src').slice(0, 22) })))
    await shot(p, 'a18-jeu')
    const ten = [...seven, 'Hollow Knight', 'Celeste', 'Portal 2']
    const more = await art(ten); await setList(ten.map((n, i) => game(n, i, more, isEa(n))))
    for (let i = 0; i < 12 && await p.evaluate(() => document.querySelector('#htTitle').textContent !== 'Toute ta bibliothèque'); i++) { await p.keyboard.press('ArrowUp'); await p.waitForTimeout(260) }
    await p.waitForTimeout(7000); await settle(p, 1000); log('dix jeux', await tiles()); await shot(p, 'a18-dix')
    await setList(seven.slice(0, 2).map((n, i) => game(n, i, urls, isEa(n))))
    for (let i = 0; i < 4 && await p.evaluate(() => document.querySelector('#htTitle').textContent !== 'Toute ta bibliothèque'); i++) { await p.keyboard.press('ArrowUp'); await p.waitForTimeout(300) }
    await settle(p, 1200); log('deux jeux', await tiles()); await shot(p, 'a18-deux')
    // Une image qui ne charge pas : le nom du jeu, pas un trou
    await setList(seven.map((n, i) => game(n, i, { ...urls, 'Counter-Strike 2': 'file:///introuvable.jpg', 'Age of Empires IV': 'data:image/jpeg;base64,AAAA' }, isEa(n))))
    await p.waitForTimeout(1500); log('image cassee', await p.evaluate(() => [...document.querySelectorAll('.card-all .ca-in img')].map((x) => [x.dataset.name, x.getAttribute('src').slice(0, 22), x.dataset.fb, x.naturalWidth])))
    log('ERREURS', errs.length); errs.slice(0, 10).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 10).join('\n')) }
  await app.close()
})()
