// Les événements et l'écriture d'un clip, aux endroits qu'aucun autre scénario ne regarde : un appui pendant que la partie
// démarre (rien ne filme encore) ou s'arrête est refusé ; la vignette est prise à l'appui, pas au moment où le clip est
// écrit ; un clip appuyé pendant CS2 garde la carte, la manche et le score ; un clip s'écrit dès que ses images sont là,
// sans attendre le délai de grâce ; et quand plus aucune image n'arrive, il s'écrit quand même, après ce délai.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simPost, simRunning, payload, freshDirs, fs, path } = H

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined && !ok ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
const note = (s) => console.log(`    ${s}`)
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }

;(async () => {
  let s, dirs
  const L = (...a) => launcher(s.p, ...a)
  const info = () => test(s.app, 'info')
  const state = () => L('clipsState')
  const ready = () => until(() => s.app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
  const known = new Set()
  const nextClip = (what, ms = 40000) => until(async () => { const c = (await L('clipsList')).find((x) => !known.has(x.id)); if (c) known.add(c.id); return c }, ms, what, 100)
  /** Dans le processus principal, d'un seul tenant : la partie qui démarre ou s'arrête, puis un appui sur le raccourci. */
  const runningThenSave = (on) => s.app.evaluate((_e, v) => { globalThis.pxCs2Sim.running(v); return globalThis.pxClipsTest.saveNow() }, on)
  try {
    dirs = freshDirs('t26')
    s = await start(dirs, ENV)
    await ready()
    await L('clipsSaveSettings', { capture: 'chrome', quality: 'light', before: 5, after: 1, merge: 0 })

    // ===== 1. un appui pendant que la partie démarre : rien ne filme encore, il est refusé
    const early = await runningThenSave(true)
    const pend1 = (await info()).pendings.length
    check('un appui au tout début de la partie, avant la moindre image : refusé, aucun clip en attente', early === false && pend1 === 0, { early, pend1 })
    await until(async () => { const st = await state(); return st.status === 'recording' && (st.bufferSeconds || 0) >= 8 ? st : null }, 40000, 'tampon', 300)

    // ===== 2. un clip s'écrit dès que ses images sont là, sans attendre le délai de grâce (6 s)
    let t0 = Date.now()
    await test(s.app, 'saveNow')
    const c2 = await nextClip('un clip')
    const d2 = (Date.now() - t0) / 1000
    note(`clip écrit ${d2.toFixed(1)} s après l’appui (1 s « après » comprise)`)
    check('un clip s’écrit dès que ses images sont là : moins de 4,5 s après l’appui, pas après le délai de grâce', d2 < 4.5, { d2 })

    // ===== 3. la vignette est prise à l'appui, pas quand le clip est écrit
    await L('clipsSaveSettings', { after: 10 })
    t0 = Date.now()
    await test(s.app, 'saveNow')
    const id3 = (await info()).pendings[0]?.id
    const thumb = id3 && path.join(dirs.userData, 'clips-thumbs', `${id3}.jpg`)
    const tThumb = await until(() => (thumb && fs.existsSync(thumb) ? Date.now() : null), 15000, 'la vignette', 100).catch(() => null)
    const c3 = await nextClip('le clip à 10 s « après »')
    const tClip = Date.now()
    note(`vignette ${tThumb ? ((tThumb - t0) / 1000).toFixed(1) + ' s' : 'jamais'} après l’appui, clip écrit ${((tClip - t0) / 1000).toFixed(1)} s après`)
    check('la vignette est prise à l’appui, bien avant que le clip soit écrit', !!tThumb && tThumb - t0 < 5000 && c3.id === id3, { vignette: tThumb && tThumb - t0, clip: tClip - t0 })

    // ===== 4. un clip appuyé pendant CS2 garde la carte, la manche et le score
    await L('clipsSaveSettings', { after: 1 })
    await simPost(s.app, payload({ round: 4, phase: 'freezetime', ct: 3, t: 1 }))
    await simPost(s.app, payload({ round: 4, phase: 'live', ct: 3, t: 1 }))
    await sleep(500)
    await test(s.app, 'saveNow')
    const c4 = await nextClip('un clip appuyé pendant CS2')
    note(`clip appuyé pendant CS2 : ${JSON.stringify({ map: c4.map, mode: c4.mode, round: c4.round, score: c4.score })}`)
    check('un clip appuyé pendant CS2 garde la carte, le mode, la manche et le score', c4.map === 'de_mirage' && c4.mode === 'competitive' && typeof c4.round === 'number' && !!c4.score && c4.score.us === 3 && c4.score.them === 1, { map: c4.map, mode: c4.mode, round: c4.round, score: c4.score })

    // ===== 5. plus aucune image : le clip s'écrit quand même, après le délai de grâce
    await test(s.app, 'command', 'pause-video', true)
    await sleep(500)
    t0 = Date.now()
    await test(s.app, 'saveNow')
    const c5 = await nextClip('le clip sans nouvelles images', 40000)
    const d5 = (Date.now() - t0) / 1000
    note(`clip sans nouvelles images écrit ${d5.toFixed(1)} s après l’appui`)
    check('plus aucune image : le clip s’écrit quand même, après le délai de grâce (avant la relance de l’enregistreur à 15 s)', d5 >= 6 && d5 < 12 && !!c5, { d5 })
    await test(s.app, 'command', 'pause-video', false)

    // ===== 6. un appui pendant que la partie s'arrête : refusé
    await until(async () => { const st = await state(); return st.status === 'recording' && (st.bufferSeconds || 0) >= 3 ? st : null }, 40000, 'tampon avant la fin', 300)
    const late = await runningThenSave(false)
    await until(async () => (await state()).status === 'idle', 20000, 'fin de la partie', 300)
    await sleep(1000)
    const extra = (await L('clipsList')).filter((x) => !known.has(x.id))
    check('un appui pendant que la partie s’arrête : refusé, aucun clip de plus', late === false && extra.length === 0, { late, extra: extra.length })
    check('pas d’erreur dans la page', s.errs.length === 0, s.errs.slice(0, 3))
    void c2
  } catch (e) { fail++; console.log('ECHEC', String(e.message || e).split('\n')[0]) } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    if (s) await s.app.close().catch(() => {})
    process.exit(fail ? 1 : 0)
  }
})()
