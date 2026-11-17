// Essai des mises à jour : la vraie fenêtre, sous Xvfb, état poussé par le processus principal (« maj:state »), captures en 1600 × 940.
//   xvfb-run -a node tools/essais/maj.cjs [dossier de sortie]
const { start, settle } = require('./h.cjs')
const fs = require('fs')
const OUT = process.argv[2] || '/tmp/maj-appli'
fs.mkdirSync(OUT, { recursive: true })
const M = 1048576, TOTAL = 139 * M
const base = { current: '0.7.1', configured: true, blocked: false, quiet: false, version: '0.7.2', date: '2026-11-17', size: TOTAL,
  notes: [{ version: '0.7.2', date: '2026-11-17', items: [
    { kind: 'nouveau', title: 'Les mises à jour arrivent dans l’appli', text: 'x' }, { kind: 'ameliore', title: 'Overlay CS2 : Échap quitte l’aperçu', text: 'x' }, { kind: 'corrige', title: 'Petites corrections dans Amis et Stats', text: 'x' }] }] }
const states = {
  dispo: { ...base, status: 'available' },
  dl: { ...base, status: 'downloading', received: Math.round(TOTAL * .42), total: TOTAL, bytesPerSec: 12 * M, etaS: 7 },
  verif: { ...base, status: 'verifying' },
  prete: { ...base, status: 'ready' },
  inst: { ...base, status: 'installing', secondsLeft: 3, endsAt: Date.now() + 3100 },
  err: { ...base, status: 'error', reason: 'Empreinte invalide · fichier supprimé, ta 0.7.1 n’a pas bougé' },
  jeu: { ...base, status: 'ready', blocked: true }
}
;(async () => {
  const { app, p, errs } = await start({ env: { PX_MAJ_SIM: 'notes' }, name: 'maj', w: 1600, h: 940 })
  const send = (s) => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('maj:state', s), s)
  const shot = async (n) => { await p.waitForTimeout(500); await p.evaluate(() => $('#toasts')?.replaceChildren()); await p.screenshot({ path: `${OUT}/${n}.png` }) }
  // 1. les nouveautés après le redémarrage (la simulation les garde en attente)
  await p.waitForSelector('.mj-cl', { timeout: 15000 }).catch(() => {})
  await shot('apres')
  await p.click('#mjOk'); await p.waitForTimeout(400)
  // 2. Stats, comme sur la maquette (sans le salon vocal du mode démo : le milieu de la barre est vide)
  await p.evaluate(() => { VOICE.length = 0; Real.emit('friends') })
  await p.click('.b-tab[data-go=stats]'); await settle(p)
  for (const k of Object.keys(states)) {
    await send(states[k])
    await shot(k)
  }
  await send({ ...base, status: 'idle', configured: true }); await p.waitForTimeout(300)
  // 3. Paramètres › À propos
  await p.click('#bGear'); await settle(p)
  await p.evaluate(() => Settings.open('about')); await settle(p)
  await send({ ...base, status: 'ready', checkedAt: Date.now() - 2 * 3600 * 1000 })
  await shot('reglages')
  await send({ ...base, status: 'uptodate', configured: false })
  await shot('reglages-nonconf')
  console.log('erreurs de page :', errs.length ? errs.join('\n') : 'aucune')
  await app.close()
})().catch((e) => { console.error(e); process.exit(1) })
