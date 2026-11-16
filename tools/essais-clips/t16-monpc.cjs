// Essai de Mon PC (bêta 47) dans la vraie appli, sous Linux : le canal pc:state répond, la rubrique s'affiche.
// Sous Linux, Windows n'est pas lu (unsupported) : seuls les écrans d'Electron reviennent. Le reste se vérifie sous Windows.
// Lancer : npm run build, puis xvfb-run -a node tools/essais-clips/t16-monpc.cjs [capture.png]
const { freshDirs, start, until, launcher } = require('./h.cjs')

let ok = 0, non = 0
const check = (cond, what) => { if (cond) { ok++; console.log('OK  ', what) } else { non++; console.log('NON ', what) } }

;(async () => {
  const dirs = freshDirs('t16')
  const { app, p, errs } = await start(dirs)
  try {
    await until(() => p.evaluate(() => typeof Settings !== 'undefined' && !!document.getElementById('sheet')), 30_000, 'page prête')
    const st = await launcher(p, 'pcState', false)
    check(st && typeof st.at === 'number', 'pcState répond')
    check(st.unsupported === true && st.gpus.length === 0, 'hors Windows : aucune carte lue, rien de lancé')
    check(Array.isArray(st.displays) && st.displays.length >= 1, `écrans d'Electron : ${st.displays.map((d) => `${d.name} ${d.width}×${d.height} ${d.hz} Hz`).join(', ')}`)
    check(st.displays.every((d) => d.low === false && d.maxHz === null), 'sans Windows, pas de fréquence max ni d’alerte')
    check(st.badge === '', 'sommaire vide')
    const again = await launcher(p, 'pcState', false)
    check(again.at === st.at, 'deuxième appel : gardé en mémoire')
    const fresh = await launcher(p, 'pcState', true)
    check(fresh.at >= st.at, 'Relire : nouvelle lecture')
    await launcher(p, 'pcOpenDisplaySettings')
    check(true, 'pcOpenDisplaySettings ne fait rien hors Windows, sans erreur')
    // Lot 2 : la mise à jour du pilote refuse hors Windows, sans rien lancer
    const ds = await launcher(p, 'pcDriverState')
    check(ds && ds.status === 'idle', 'pcDriverState : rien en cours')
    const up = await p.evaluate(() => window.launcher.pcDriverUpdate({}).then(() => 'ok', (e) => String(e.message || e)))
    check(/que sous Windows/.test(up), `pcDriverUpdate refuse hors Windows : ${up.slice(0, 90)}`)
    check(Array.isArray(st.journal), 'journal des pilotes présent (vide)')
    await p.evaluate(() => Settings.go('pc'))
    await until(() => p.evaluate(() => /Écrans/.test(document.getElementById('shBody')?.textContent || '')), 10_000, 'rubrique Mon PC')
    const txt = await p.evaluate(() => document.getElementById('shBody').textContent)
    check(/Lue seulement sous Windows/.test(txt), 'rubrique : la carte est lue seulement sous Windows')
    check(/Mon PC/.test(await p.evaluate(() => document.getElementById('shNav').textContent)), 'sommaire : Mon PC')
    if (process.argv[2]) await p.screenshot({ path: process.argv[2] })
    check(errs.length === 0, `aucune erreur de page${errs.length ? ' : ' + errs[0] : ''}`)
  } finally {
    await app.close().catch(() => {})
  }
  console.log(`\n${ok} OK / ${non} NON`)
  process.exit(non ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
