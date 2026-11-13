// Les événements d'un clip : chaque kill est noté à sa seconde dans le fichier. La source d'essai peint l'heure dans l'image :
// l'image lue à la seconde notée doit montrer l'heure du kill. Vérifie aussi le clip manuel et le clip coupé.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simPost, simRunning, payload, clockAt, freshDirs, listDir, fs, path } = H

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`) }

;(async () => {
  const dirs = freshDirs('t13')
  const { app, p, errs } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' })
  const L = (...a) => launcher(p, ...a)
  const waitClips = (n, ms = 40000) => until(async () => { const l = await L('clipsList'); return l.length >= n ? l : null }, ms, `${n} clip(s)`)
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await L('clipsSaveSettings', { before: 6, after: 2, merge: 4 })
    await simRunning(app, true)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 10, 30000, 'tampon', 500)
    const folder = (await L('clipsGetSettings')).folder
    const fileOf = (c) => path.join(folder, listDir(folder).find((n) => n.endsWith('.mp4') && n.includes(c.title.replace(/[^\wÀ-ÿ ]/g, '').slice(0, 12))) || '')
    // --- trois kills fusionnés : 0 s, +2,2 s, +3,9 s
    await simPost(app, payload({ round: 1, phase: 'freezetime', ct: 1, t: 0 }))
    await simPost(app, payload({ round: 1, phase: 'live', ct: 1, t: 0 }))
    const k = []
    k.push(Date.now()); await simPost(app, payload({ round: 1, kills: 1, rk: 1, rhs: 1, ct: 1, t: 0 }))
    await sleep(2200)
    k.push(Date.now()); await simPost(app, payload({ round: 1, kills: 2, rk: 2, rhs: 1, ct: 1, t: 0 }))
    await sleep(1700)
    k.push(Date.now()); await simPost(app, payload({ round: 1, kills: 3, rk: 3, rhs: 2, ct: 1, t: 0 }))
    let list = await waitClips(1)
    const triple = list[0]
    check('le clip fusionné note ses 3 kills', Array.isArray(triple.events) && triple.events.length === 3 && triple.kills === 3, triple.events)
    check('dans l’ordre, tous dans le fichier', triple.events.every((e, i, a) => e.t >= 0 && e.t <= triple.durationS && (i === 0 || e.t > a[i - 1].t)), { d: triple.durationS, t: triple.events.map((e) => e.t) })
    check('genres et compteurs de chaque kill', triple.events.map((e) => `${e.kind}:${e.kills}:${e.headshots}`).join() === 'hs:1:1,kill:1:0,multi:1:1', triple.events.map((e) => `${e.kind}:${e.kills}:${e.headshots}`))
    const f1 = fileOf(triple)
    // L'image à la seconde notée montre l'heure du kill (à une image et au délai de capture près)
    const gaps = triple.events.map((e, i) => clockAt(f1, e.t, 640, 360) - k[i])
    check('l’image à la seconde notée est celle du kill (écart sous 150 ms)', gaps.every((g) => Math.abs(g) <= 150), gaps)
    check('écarts entre kills gardés (2,2 s puis 1,7 s)', Math.abs(triple.events[1].t - triple.events[0].t - (k[1] - k[0]) / 1000) < 0.06 && Math.abs(triple.events[2].t - triple.events[1].t - (k[2] - k[1]) / 1000) < 0.06, triple.events.map((e) => e.t))
    // --- clip manuel : un événement, à l'appui
    await sleep(5000)
    const m0 = Date.now()
    await test(app, 'saveNow')
    list = await waitClips(2)
    const manual = list.find((c) => c.kind === 'manual')
    check('clip manuel : un événement « manual »', manual && manual.events.length === 1 && manual.events[0].kind === 'manual', manual && manual.events)
    const fm = path.join(folder, listDir(folder).find((n) => n.endsWith('.mp4') && /Clip manuel/.test(n)))
    const gm = clockAt(fm, manual.events[0].t, 640, 360) - m0
    check('clip manuel : l’image à la seconde notée est celle de l’appui (écart sous 250 ms)', Math.abs(gm) <= 250, gm)
    // --- clip coupé : les événements suivent
    const from = Math.max(0, triple.events[1].t - 0.6), to = triple.durationS
    const cut = await L('clipsTrim', triple.id, from, to)
    check('clip coupé : c’est un nouveau clip, l’ancien garde ses 3 événements', cut.id !== triple.id && (await L('clipsList')).find((c) => c.id === triple.id).events.length === 3)
    const kept = cut.events || []
    check('clip coupé : il garde les kills de sa partie', kept.length >= 2 && kept.length <= 3 && kept.every((e) => e.t >= 0 && e.t <= cut.durationS), { d: cut.durationS, e: kept })
    const fc = path.join(folder, listDir(folder).find((n) => n.endsWith('.mp4') && /coupé/.test(n)))
    const tail = kept.slice(-2).map((e, i) => clockAt(fc, e.t, 640, 360) - k[1 + i])
    check('clip coupé : l’image à la seconde notée est toujours celle du kill', tail.every((g) => Math.abs(g) <= 150), tail)
    // --- l'essai du moteur et la page ne voient rien de plus que la fiche publique
    check('la fiche publique ne donne aucun chemin', (await L('clipsList')).every((c) => !('file' in c) && !JSON.stringify(c).includes(folder)))
    await simRunning(app, false)
  } catch (e) { fail++; console.log('ECHEC', e.message.split('\n')[0]) } finally { await app.close().catch(() => {}) }
  check('aucune erreur dans la page', errs.length === 0, errs.slice(0, 3))
  console.log(`\n${pass} réussis, ${fail} ratés`)
  process.exit(fail ? 1 : 0)
})()
