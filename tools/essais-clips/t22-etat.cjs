// L'état de la capture que voient les pages, aux endroits qu'aucun autre scénario ne regarde : le raccourci déjà pris par un
// autre programme, puis un autre raccourci choisi ; un clip qui ne peut pas s'écrire (le dossier des clips remplacé par un
// fichier), ce que la page en voit, et ce qui l'efface (une capture qui repart, un clip écrit) ; les fragments jetés quand
// la taille de l'image change ; le rythme de la dernière partie, gardé dans la base et relu après une relance de l'appli.
// Le « programme qui a déjà le raccourci » est l'appli elle-même : le scénario prend Alt+C dans son processus principal
// avant le début de la partie, et l'appli le trouve alors pris.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, freshDirs, fs, path } = H

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined && !ok ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
const note = (s) => console.log(`    ${s}`)
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }
const TAKEN = 'Le raccourci Alt+C est déjà pris : choisis-en un autre.'
const FAILED = 'Un clip n’a pas pu être écrit : voir le journal.'

;(async () => {
  const dirs = freshDirs('t22')
  let s
  const L = (...a) => launcher(s.p, ...a)
  const info = () => test(s.app, 'info')
  const state = () => L('clipsState')
  const journal = async () => { await L('clipsLogTail'); return fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^\S+ /, '')) }
  const mark = async () => (await journal()).length
  const since = async (m) => (await journal()).slice(m - 1)
  const ready = async () => until(() => s.app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
  let folder = '', moved = ''
  try {
    s = await start(dirs, ENV)
    await ready()
    await L('clipsSaveSettings', { capture: 'chrome', before: 4, after: 1, merge: 0 })

    // ===== 1. le raccourci déjà pris, puis un autre raccourci
    const took = await s.app.evaluate(({ globalShortcut }) => globalShortcut.register('Alt+C', () => {}))
    check('le scénario prend Alt+C avant la partie', took === true)
    await simRunning(s.app, true)
    const st1 = await until(async () => { const st = await state(); return st.status === 'recording' && (st.bufferSeconds || 0) >= 2 ? st : null }, 40000, 'tampon', 300)
    const i1 = await info()
    check('raccourci déjà pris : la page le voit, et l’appli ne le tient pas', (st1.error || '').includes(TAKEN) && i1.hotkey === null && i1.hotkeyRegistered === false, { st1, hotkey: i1.hotkey })
    check('… et le journal le dit', (await journal()).includes(TAKEN))
    await s.app.evaluate(({ globalShortcut }) => globalShortcut.unregister('Alt+C'))
    await L('clipsSaveSettings', { hotkey: 'Alt+K' })
    const st2 = await state(), i2 = await info()
    check('un autre raccourci choisi en pleine partie : il est pris, et la page ne voit plus d’erreur', !st2.error && i2.hotkey === 'Alt+K' && i2.hotkeyRegistered === true, { st2, hotkey: i2.hotkey })

    // ===== 2. un clip qui ne peut pas s'écrire
    folder = i2.folder
    moved = `${folder}.vrai`
    fs.mkdirSync(folder, { recursive: true })
    fs.renameSync(folder, moved)
    fs.writeFileSync(folder, 'pas un dossier')
    let m = await mark()
    await test(s.app, 'saveNow')
    const st3 = await until(async () => { const st = await state(); return (st.error || '').includes(FAILED) ? st : null }, 30000, 'le clip impossible vu par la page', 300)
    const j3 = await since(m)
    check('un clip qui ne peut pas s’écrire : le journal le dit, la page le voit', j3.some((l) => /^Clip \w+ impossible : /.test(l)) && st3.status === 'recording', { j3, st3 })
    // Une capture qui repart efface ce problème : il ne concerne pas la nouvelle.
    const rec3 = (await info()).recorder
    await test(s.app, 'command', 'stop-recorder')
    const st4 = await until(async () => { const i = await info(), st = await state(); return i.recorder && i.recorder !== rec3 && st.status === 'recording' && !st.error ? st : null }, 30000, 'la capture repart sans le problème', 300)
    check('… la capture qui repart efface ce problème', !st4.error, st4)
    // Le problème revient avec un autre clip impossible, puis un clip écrit l'efface.
    await until(async () => ((await state()).bufferSeconds || 0) >= 2, 30000, 'tampon après la relance', 300)
    await test(s.app, 'saveNow')
    await until(async () => (((await state()).error) || '').includes(FAILED), 30000, 'le second clip impossible', 300)
    fs.unlinkSync(folder)
    fs.renameSync(moved, folder)
    moved = ''
    m = await mark()
    await sleep(1500)
    await test(s.app, 'saveNow')
    await until(async () => (await L('clipsList')).length >= 1, 30000, 'un clip écrit')
    const st5 = await state(), j5 = await since(m)
    check('… et un clip écrit l’efface aussi', !st5.error && j5.some((l) => /^Clip \w+ écrit : /.test(l)), { st5, j5 })

    // ===== 3. la taille de l'image change : les fragments filmés juste avant (peut-être mélangés) quittent le tampon
    // La page voit le changement à son tour de garde (toutes les 500 ms) et dit à l'appli de jeter ce que l'enregistreur a
    // filmé depuis 700 ms avant ce constat. L'heure du constat est celle de sa ligne au journal.
    await until(async () => ((await state()).bufferSeconds || 0) >= 3, 30000, 'tampon avant le changement de taille', 300)
    const recR = (await info()).recorder
    await test(s.app, 'command', 'resize', { width: 800, height: 450 })
    await until(async () => { const i = await info(); return i.recorder && i.recorder !== recR ? i.recorder : null }, 15000, 'relance après le changement de taille', 200)
    await L('clipsLogTail')
    const raw = fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8').split('\n').filter((l) => / Résolution changée : /.test(l)).pop()
    const seenAt = raw ? Date.parse(raw.split(' ')[0]) : NaN
    await sleep(500)
    const oldFrags = (await info()).list.filter((f) => f.recId === recR)
    const lastStart = oldFrags.length ? Math.max(...oldFrags.map((f) => f.startWall)) : null
    note(`taille changée : vue à ${raw ? raw.split(' ')[0] : '?'} ; ${oldFrags.length} fragments gardés de l'ancien enregistreur, le dernier commencé ${lastStart === null ? '?' : Math.round(seenAt - lastStart)} ms avant`)
    check('la taille de l’image change : l’ancien enregistreur garde ses fragments d’avant, sans ceux des 700 ms d’avant le constat', Number.isFinite(seenAt) && oldFrags.length > 0 && lastStart < seenAt - 700 + 50, { raw, oldFrags: oldFrags.length, avant: lastStart === null ? null : seenAt - lastStart })

    // ===== 4. le rythme de la dernière partie, relu après une relance
    await simRunning(s.app, false)
    const g1 = await until(async () => { const st = await state(); return st.status === 'idle' && st.lastGame ? st.lastGame : null }, 30000, 'le rythme de la partie', 300)
    check('fin de partie : son rythme est donné à la page (1 clip)', g1.clips === 1 && g1.at > 0, g1)
    await s.app.close()
    s = await start(dirs, ENV)
    await ready()
    const g2 = await until(async () => (await state()).lastGame || null, 15000, 'le rythme après la relance', 300).catch(() => null)
    check('appli relancée : le rythme de la dernière partie est relu de la base, le même', !!g2 && JSON.stringify(g2) === JSON.stringify(g1), { g1, g2 })
    check('pas d’erreur dans la page', s.errs.length === 0, s.errs.slice(0, 3))
  } catch (e) { fail++; console.log('ECHEC', String(e.message || e).split('\n')[0]) } finally {
    try { if (moved) { fs.rmSync(folder, { force: true }); fs.renameSync(moved, folder) } } catch { /* rien à remettre */ }
    console.log(`\n${pass} OK, ${fail} NON`)
    if (s) await s.app.close().catch(() => {})
    process.exit(fail ? 1 : 0)
  }
})()
