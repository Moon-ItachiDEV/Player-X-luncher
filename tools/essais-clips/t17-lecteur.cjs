// Le lecteur de clips : ouvrir un autre clip pendant que le lecteur se ferme.
// La fermeture vide le lecteur dans une transition de vue, donc un peu plus tard. Si un autre clip est ouvert entre-temps
// (Clips.open : depuis la fiche d'un jeu, un message, le bilan), la fin de la fermeture ne doit pas vider le nouveau lecteur.
// Pour l'essayer à coup sûr, on fige le processus graphique 1,4 s (SIGSTOP) : la fermeture finit alors après l'ouverture,
// comme sur une machine chargée. Sous Linux seulement, comme les autres scénarios.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, freshDirs, execFileSync } = H

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }

;(async () => {
  const dirs = freshDirs('t17')
  const { app, p, errs } = await start(dirs, ENV)
  const L = (...a) => launcher(p, ...a)
  // Ce que montre le lecteur, et si c'est bien le clip demandé (sa vidéo, pas seulement « un lecteur est ouvert »)
  const state = (id) => p.evaluate((id) => {
    const c = CLIPS.find((x) => x.id === id), v = document.getElementById('cpVid')
    return { ouvert: Clips.isOpen(), bouton: !!document.getElementById('cpShare'), cache: document.getElementById('cp').hidden, bonClip: !!c && !!v && v.getAttribute('src') === c.videoUrl }
  }, id)
  const good = (s) => s.ouvert && s.bouton && !s.cache && s.bonClip
  const vtOver = () => until(() => p.evaluate(() => !document.documentElement.matches(':active-view-transition')), 20000, 'fin de la transition', 50)
  const opened = () => until(() => p.evaluate(() => !!document.getElementById('cpShare') && Clips.isOpen()), 15000, 'lecteur ouvert', 100)
  try {
    await p.evaluate(() => { localStorage.setItem('pxv3-setup', '1') }); await p.reload(); await p.waitForLoadState('domcontentloaded'); await sleep(6000)
    await L('clipsSaveSettings', { enabled: true, before: 6, after: 2, merge: 3, quality: 'light' })
    await simRunning(app, true)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 8, 40000, 'tampon', 500)
    await test(app, 'saveNow'); await sleep(5000); await test(app, 'saveNow')
    const clips = await until(async () => { const l = (await L('clipsList')).filter((c) => c.kind !== 'film'); return l.length >= 2 ? l : null }, 45000, '2 clips')
    await simRunning(app, false); await sleep(3000)
    check('deux clips gardés', clips.length >= 2, clips.length)
    const [a, b] = clips
    await p.evaluate(() => go('clips')); await sleep(2500)

    // ----- le cas ordinaire : la fermeture finit avant l'ouverture
    await p.evaluate((id) => Clips.open(id), a.id); await opened(); await sleep(400); await vtOver(); await sleep(600)
    await p.evaluate(() => Clips.close()); await vtOver(); await sleep(300)
    await p.evaluate((id) => Clips.open(id), b.id); await opened(); await sleep(400); await vtOver(); await sleep(600)
    const s1 = await state(b.id)
    check('fermer, attendre, ouvrir un autre clip : le lecteur montre ce clip', good(s1), s1)

    // ----- la fermeture lente : elle finit après l'ouverture du clip suivant
    const gpu = execFileSync('pgrep', ['-f', `type=gpu-process.*user-data-dir=${dirs.userData}`]).toString().trim().split('\n').filter(Boolean).map(Number)
    if (!check('processus graphique trouvé', gpu.length === 1, gpu.length)) throw new Error('sans le processus graphique, la fermeture lente ne peut pas être essayée')
    // Le processus graphique est figé AVANT la fermeture : la page reste libre (ses minuteries tournent), mais la transition
    // ne peut pas prendre son image, donc la fin de la fermeture attend le dégel. L'ordre est sûr : fermer, ouvrir, puis vider.
    for (const pid of gpu) process.kill(pid, 'SIGSTOP')
    try {
      await p.evaluate(() => { window.__seen = []; const t0 = performance.now(), cp = document.getElementById('cp'); new MutationObserver(() => window.__seen.push([Math.round(performance.now() - t0), cp.hidden ? 'caché' : 'visible', !!document.getElementById('cpShare')])).observe(cp, { attributes: true, childList: true }); Clips.close() })
      await sleep(500)
      await p.evaluate((id) => Clips.open(id), a.id)
      await sleep(900)
    } finally { for (const pid of gpu) process.kill(pid, 'SIGCONT') }
    await sleep(4000); await vtOver()
    const s2 = await state(a.id), seen = await p.evaluate(() => window.__seen)
    console.log('    ce que le lecteur a vécu (ms depuis la fermeture) :', JSON.stringify(seen))
    // Le premier changement vu est l'ouverture du clip suivant : la fermeture n'avait donc pas encore vidé le lecteur.
    // Sinon l'essai n'a pas créé la situation, et il ne prouve rien : on le dit.
    check('la fermeture n’avait pas fini quand le clip suivant s’est ouvert', seen.length > 0 && seen[0][1] === 'visible' && seen[0][2] === true, seen[0])
    check('ouvrir un autre clip pendant une fermeture lente : le nouveau lecteur reste, avec ce clip', good(s2), s2)
    check('pas d’erreur dans la page', errs.length === 0, errs.slice(0, 3))
  } catch (e) { fail++; console.log('ECHEC', String(e.message || e).split('\n')[0]) } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    await Promise.race([app.close().catch(() => {}), sleep(12000)])
    process.exit(fail ? 1 : 0)
  }
})()
