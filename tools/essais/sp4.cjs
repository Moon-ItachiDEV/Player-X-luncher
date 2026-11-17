// Paramètres > Mon PC avec une carte NVIDIA simulée (pilote à mettre à jour) : le bouton « Voir chez NVIDIA »
const { start, shot } = require('./h.cjs')
const tag = process.argv[2] || 'x'
;(async () => {
  const { app, p, errs } = await start({ name: 'sp4' + tag })
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('pc:state')
      ipcMain.handle('pc:state', () => ({ at: Date.now(), laptop: false, badge: 'Nouveau pilote',
        gpus: [{ name: 'NVIDIA GeForce RTX 4070 Ti', vendor: 'nvidia', version: '621.01', windowsVersion: null, date: '2026-10-19', link: null,
          latest: { version: '621.24', date: '2026-11-12', url: 'https://www.nvidia.com/', status: 'update', bySeries: false } }],
        displays: [{ name: 'MPG321QRF-QD', width: 2560, height: 1440, hz: 144, maxHz: 144, primary: true, low: false }] }))
    })
    await p.evaluate(() => Settings.open('pc')); await p.waitForTimeout(1500); await shot(p, `c-${tag}-pcnv`)
    console.log('ERREURS', errs.length); errs.slice(0, 10).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]) }
  await app.close()
})()
