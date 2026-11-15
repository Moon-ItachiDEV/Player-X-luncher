// La liste des clips, gardée d'une fois sur l'autre. Trois clips, puis un renommage, une épingle, une découpe et une
// suppression, avec une relance de l'appli après chacun : elle doit retrouver la même liste, les mêmes fichiers et les
// mêmes vignettes. Ensuite « ouvrir le dossier », pour un clip et pour le dossier entier, et ce qui abîme une liste : des
// fiches illisibles dans la base, le dossier des clips absent (disque débranché), un fichier supprimé à la main. Puis la
// limite de place : dépassée par un clip qui arrive, le plus vieux part ; une coupe faite au-delà de la limite reste. Pour
// finir, l'appli quitte pendant qu'une suppression traîne : elle doit attendre la fin de ce travail avant de s'arrêter. Et
// si les travaux durent plus que son attente (8 secondes), elle quitte quand même, puis redémarre avec ses clips.
// Rien ne s'ouvre sous Xvfb : l'essai répond à la place du système (shell.showItemInFolder et shell.openPath sont remplacés
// dans le processus principal) et note ce que l'appli lui a demandé. Sous Linux seulement, comme les autres scénarios.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, decodeCheck, freshDirs, listDir, fs, path } = H
const initSqlJs = require('sql.js')

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' }
const errs = []
const exited = (proc, ms) => new Promise((res) => { if (proc.exitCode !== null || proc.signalCode) return res(true); const t = setTimeout(() => res(false), ms); proc.once('exit', () => { clearTimeout(t); res(true) }) })

/** L'appli lancée. « Ouvrir le dossier » est remplacé : il note la demande et rend la réponse de l'essai. */
async function open(dirs) {
  const s = await start(dirs, ENV)
  s.p.on('pageerror', (e) => errs.push(String(e.message || e)))
  await until(() => s.app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
  await s.app.evaluate(({ shell }) => {
    const o = (globalThis.pxEssaiListe = { montres: [], ouverts: [], erreur: '' })
    shell.showItemInFolder = (f) => { o.montres.push(f) }
    shell.openPath = async (f) => { o.ouverts.push(f); return o.erreur }
  })
  await s.p.evaluate(() => { window.__c = 0; window.launcher.onClipsChanged(() => window.__c++) })
  return s
}
/** L'appli fermée pour de bon : sa base est écrite sur le disque quand le processus s'arrête. */
async function close(s) {
  if (s.proc.exitCode !== null || s.proc.signalCode) return
  await Promise.race([s.app.close().catch(() => {}), sleep(12000)])
  if (!(await exited(s.proc, 5000))) { try { s.proc.kill('SIGKILL') } catch {} }
}
/** La liste telle qu'elle est écrite dans la base (appli fermée). `change` peut la remplacer. Rend la liste lue. */
async function stored(dirs, change) {
  const SQL = await initSqlJs()
  const file = path.join(dirs.userData, 'launcher.db')
  const db = new SQL.Database(fs.readFileSync(file))
  try {
    const rows = db.exec("SELECT value FROM kv WHERE key = 'clipsIndex'")
    const list = rows.length ? JSON.parse(rows[0].values[0][0]) : null
    if (change) {
      db.run("UPDATE kv SET value = ? WHERE key = 'clipsIndex'", [JSON.stringify(change(list))])
      fs.writeFileSync(file, Buffer.from(db.export()))
    }
    return list
  } finally { db.close() }
}
const byId = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1))
const same = (a, b) => JSON.stringify(byId(a)) === JSON.stringify(byId(b))
/** Les identifiants, dans l'ordre de la liste. */
const ids = (list) => list.map((x) => x.id).join()
/** Les mêmes clips, quel que soit l'ordre (la base range ses fiches à sa façon). */
const sameIds = (list, wanted) => Array.isArray(list) && list.every((x) => x && typeof x.id === 'string') && list.map((x) => x.id).sort().join() === wanted.map((x) => x.id).sort().join()
const brief = (list) => list.map((c) => [c.id.slice(0, 4), c.title, c.pinned])

;(async () => {
  const dirs = freshDirs('t19')
  const folder = path.join(dirs.home, 'Videos', 'Player X V3 Test'), thumbsDir = path.join(dirs.userData, 'clips-thumbs')
  const mp4s = () => listDir(folder).filter((n) => n.endsWith('.mp4'))
  const thumbs = () => listDir(thumbsDir)
  const hasThumb = (clip) => thumbs().includes(`${clip.id}.jpg`)
  /** Le journal des clips, une fois écrit sur le disque (clipsLogTail attend qu'il le soit). */
  const journal = async () => { await L('clipsLogTail'); return fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8').split('\n') }
  const startedLine = async () => (await journal()).filter((l) => l.includes('Service démarré')).pop() || ''
  let s
  const L = (...a) => launcher(s.p, ...a)
  const noted = () => s.app.evaluate(() => globalThis.pxEssaiListe)
  const changes = () => s.p.evaluate(() => window.__c)
  /** Une action sur la liste doit prévenir la page (clips:changed) : rend vrai si elle l'a fait. */
  const told = async (action) => {
    const c0 = await changes()
    const result = await action()
    const ok = await until(async () => (await changes()) > c0, 3000, 'page prévenue').then(() => true, () => false)
    return { result, ok }
  }
  /** La page lit-elle encore ce clip et sa vignette par pxclip:// ? */
  const served = (clip) => s.p.evaluate(async ([v, t]) => {
    const video = await fetch(v, { headers: { Range: 'bytes=0-9' } }), thumb = await fetch(t)
    return { video: video.status, octets: (await video.arrayBuffer()).byteLength, vignette: thumb.status, type: thumb.headers.get('content-type') }
  }, [clip.videoUrl, clip.thumbUrl]).catch((e) => String(e))
  /** L'appli fermée puis rouverte : la liste juste avant, et la liste retrouvée. */
  const relaunch = async () => { const before = await L('clipsList'); await close(s); s = await open(dirs); return { before, after: await L('clipsList') } }
  /** Le jeu d'essai tourne, et le tampon a de quoi faire un clip. */
  const playing = async () => { await simRunning(s.app, true); await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 8, 40000, 'tampon', 500) }
  const stopped = async () => { await simRunning(s.app, false); await until(async () => (await L('clipsState')).status === 'idle', 10000, 'jeu fermé') }
  try {
    s = await open(dirs)
    // ----- trois clips
    await L('clipsSaveSettings', { before: 6, after: 2, merge: 0 })
    await playing()
    let list = []
    for (let n = 1; n <= 3; n++) {
      await test(s.app, 'saveNow')
      list = await until(async () => { const l = await L('clipsList'); return l.length >= n ? l : null }, 45000, `${n} clip(s)`)
      await sleep(1200)
    }
    await stopped()
    await until(() => list.every(hasThumb), 10000, 'vignettes').catch(() => null)
    // La liste est rendue du plus récent au plus ancien
    const [c, b, a] = list
    check('trois clips écrits, chacun avec son fichier et sa vignette', list.length === 3 && mp4s().length === 3 && list.every(hasThumb) && a.at < b.at && b.at < c.at, { fichiers: mp4s().length, vignettes: thumbs().length })
    check('la page reçoit des adresses pxclip://, jamais le chemin d’un fichier', list.every((x) => !('file' in x) && x.videoUrl === `pxclip://video/${x.id}` && x.thumbUrl === `pxclip://thumb/${x.id}`) && !JSON.stringify(list).includes(dirs.base), list.map((x) => [x.videoUrl, x.thumbUrl, Object.keys(x).includes('file')]))
    const k0 = await relaunch()
    check('après une relance : les trois clips sont retrouvés, avec leurs vignettes', same(k0.before, k0.after) && ids(k0.after) === [c.id, b.id, a.id].join() && k0.after.every(hasThumb), brief(k0.after))

    // ----- ce qui change la liste : renommer, épingler, découper, supprimer. Après chacun, l'appli est relancée.
    const r1 = await told(() => L('clipsRename', a.id, 'Ma belle action'))
    const fileA = path.join(folder, mp4s().find((n) => n.includes('Ma belle action')) || 'introuvable')
    check('renommer : le titre et le fichier changent, la page est prévenue', r1.result.title === 'Ma belle action' && fs.existsSync(fileA) && mp4s().length === 3 && r1.ok, { titre: r1.result.title, fichiers: mp4s(), prevenue: r1.ok })
    const k1 = await relaunch()
    const A1 = k1.after.find((x) => x.id === a.id)
    check('après une relance : le nouveau nom est gardé, avec son fichier', same(k1.before, k1.after) && k1.after.length === 3 && !!A1 && A1.title === 'Ma belle action' && fs.existsSync(fileA) && mp4s().length === 3, brief(k1.after))

    const r2 = await told(() => L('clipsPin', b.id, true))
    const off = await L('clipsPin', b.id, false), on = await L('clipsPin', b.id, true)
    check('épingler : le clip est épinglé, la page est prévenue ; l’épingle s’enlève et se remet', r2.result.pinned === true && r2.ok && off.pinned === false && on.pinned === true, { pinned: r2.result.pinned, prevenue: r2.ok, enlevee: off.pinned, remise: on.pinned })
    const k2 = await relaunch()
    check('après une relance : l’épingle est gardée', same(k2.before, k2.after) && k2.after.filter((x) => x.pinned).map((x) => x.id).join() === b.id, brief(k2.after))

    const r3 = await told(() => L('clipsTrim', a.id, 2.2, 5))
    const cut = r3.result
    const fileCut = path.join(folder, mp4s().find((n) => n.includes('(coupé)')) || 'introuvable')
    check('découper : un clip de plus, plus court, avec sa vignette ; l’original reste', cut.id !== a.id && cut.title === 'Ma belle action (coupé)' && cut.durationS < a.durationS && cut.pinned === false && decodeCheck(fileCut).ok && fs.existsSync(fileA) && hasThumb(cut) && r3.ok, { titre: cut.title, duree: cut.durationS, original: a.durationS, prevenue: r3.ok })
    const k3 = await relaunch()
    // Du plus récent au plus ancien : la coupe est rangée juste au-dessus de son original
    check('après une relance : la coupe est gardée, rangée juste au-dessus de son original', same(k3.before, k3.after) && ids(k3.after) === [c.id, b.id, cut.id, a.id].join() && fs.existsSync(fileCut) && hasThumb(cut), brief(k3.after))

    const four = mp4s().length
    const r4 = await told(() => L('clipsDelete', c.id))
    check('supprimer : le clip, son fichier et sa vignette partent, la page est prévenue', r4.result === true && four === 4 && mp4s().length === 3 && mp4s().includes(path.basename(fileA)) && mp4s().includes(path.basename(fileCut)) && !hasThumb(c) && r4.ok, { fichiers: mp4s(), prevenue: r4.ok })
    const before = await L('clipsList')
    const A = before.find((x) => x.id === a.id), B = before.find((x) => x.id === b.id)
    check('la liste après ces actions : le clip épinglé, la coupe, puis le clip renommé', ids(before) === [b.id, cut.id, a.id].join() && A.title === 'Ma belle action' && A.pinned === false && B.pinned === true, brief(before))
    const orphan = path.join(thumbsDir, 'ffffffffffffffff.jpg')
    fs.writeFileSync(orphan, 'vignette d’un clip qui n’existe plus')
    await close(s)
    const base1 = await stored(dirs)
    const rawA = (base1 || []).find((x) => x && x.id === a.id), rawB = (base1 || []).find((x) => x && x.id === b.id)
    check('dans la base : trois fiches, chacune avec son fichier ; le fichier renommé, l’épingle, et plus le clip supprimé', Array.isArray(base1) && base1.length === 3 && base1.every((x) => fs.existsSync(x.file)) && !!rawA && rawA.file === fileA && rawA.title === 'Ma belle action' && !!rawB && rawB.pinned === true && !base1.some((x) => x.id === c.id) && base1.some((x) => x.id === cut.id && x.file === fileCut), (base1 || []).map((x) => [x.id.slice(0, 4), x.title, x.pinned, path.basename(x.file)]))
    s = await open(dirs)
    const after = await L('clipsList')
    check('après une relance : exactement la même liste', same(before, after), brief(after))
    await until(() => !fs.existsSync(orphan), 8000, 'ménage du démarrage').catch(() => null)
    check('au démarrage : la vignette sans clip part, celles des trois clips restent', !fs.existsSync(orphan) && thumbs().length === 3 && after.every(hasThumb), thumbs())
    const sv = await served(after.find((x) => x.id === cut.id))
    check('après une relance : la page lit le clip et sa vignette', sv.video === 206 && sv.octets === 10 && sv.vignette === 200 && sv.type === 'image/jpeg', sv)
    const line1 = await startedLine()
    check('le journal dit le nombre de clips retrouvés', line1.includes('Service démarré : 3 clip(s).'), line1)

    // ----- ouvrir le dossier (rien ne s'ouvre ici : l'essai note ce que l'appli demande au système)
    await L('clipsOpenFolder', a.id)
    await L('clipsOpenFolder')
    const o1 = await noted()
    check('« ouvrir le dossier » d’un clip montre son fichier ; sans clip, ouvre le dossier des clips', o1.montres.length === 1 && o1.montres[0] === fileA && o1.ouverts.length === 1 && o1.ouverts[0] === folder, o1)
    const unknown = await L('clipsOpenFolder', 'deadbeefdeadbeef').then(() => null, (e) => String(e))
    await s.app.evaluate(() => { globalThis.pxEssaiListe.erreur = 'aucun gestionnaire de fichiers' })
    const refused = await L('clipsOpenFolder').then(() => null, (e) => String(e))
    const o2 = await noted()
    check('clip inconnu : rien n’est montré ; dossier impossible à ouvrir : la page reçoit l’erreur', /Clip inconnu/.test(unknown || '') && o2.montres.length === 1 && /Impossible d’ouvrir le dossier des clips/.test(refused || ''), { inconnu: unknown, refus: refused })

    // ----- des fiches illisibles dans la base : laissées de côté, les autres restent
    await close(s)
    await stored(dirs, (l) => [null, 'du texte', 42, { id: 'pas-un-identifiant', file: '/tmp/x.mp4', title: 'Faux' }, { id: '0123456789abcdef', title: 'Sans fichier' }, ...l, { file: '/tmp/y.mp4' }])
    s = await open(dirs)
    const after2 = await L('clipsList')
    const line2 = await startedLine()
    check('fiches illisibles dans la base : laissées de côté, les trois clips restent', same(after, after2) && line2.includes('Service démarré : 3 clip(s).'), { liste: brief(after2), journal: line2 })

    // ----- le dossier des clips absent (disque débranché) : rien n'est listé, rien n'est oublié
    const away = folder + ' (débranché)'
    fs.renameSync(folder, away)
    const none = await L('clipsList')
    fs.renameSync(away, folder)
    const back = await L('clipsList')
    check('dossier des clips absent : rien n’est listé, rien n’est oublié ; le dossier revenu, la liste revient', none.length === 0 && same(after, back), { absent: none.length, revenu: back.length })

    // ----- un fichier supprimé à la main : sa fiche part, et ce retrait est gardé
    fs.unlinkSync(path.join(folder, mp4s().find((n) => n !== path.basename(fileA) && n !== path.basename(fileCut))))
    const kept = await L('clipsList')
    await until(() => !hasThumb(b), 5000, 'vignette partie', 50).catch(() => null)
    check('fichier supprimé à la main : le clip quitte la liste, sa vignette part', ids(kept) === [cut.id, a.id].join() && !hasThumb(b) && thumbs().length === 2, brief(kept))
    await close(s)
    const base2 = await stored(dirs)
    check('dans la base : il reste deux fiches, toutes lisibles', sameIds(base2, kept) && base2.every((x) => /^[0-9a-f]{16}$/.test(x.id) && typeof x.file === 'string'), (base2 || []).map((x) => x && x.title))
    s = await open(dirs)
    const last = await L('clipsList')
    check('après une relance : les deux clips qui restent, tels quels', same(kept, last), brief(last))

    // ----- la limite de place dépassée par un clip qui arrive : le plus vieux part, pas le clip épinglé ni le nouveau
    // Le clip renommé est le plus vieux : il est épinglé. La limite laisse entrer les deux clips, pas un troisième.
    await L('clipsPin', a.id, true)
    const room = last.reduce((n, x) => n + x.sizeBytes, 0) + 300_000
    await L('clipsSaveSettings', { limitGb: room / 1024 ** 3 })
    await playing()
    await test(s.app, 'saveNow')
    const fresh = await until(async () => (await L('clipsList')).find((x) => x.id !== a.id && x.id !== cut.id), 30000, 'le nouveau clip')
    await until(() => !fs.existsSync(fileCut) && !hasThumb(cut), 5000, 'la coupe partie', 50).catch(() => null)
    await stopped()
    await until(() => hasThumb(fresh), 10000, 'vignette du nouveau clip').catch(() => null)
    const kept2 = await L('clipsList')
    const limitLines = (await journal()).filter((l) => l.includes('ancien(s) clip(s) supprimé(s)')).map((l) => l.replace(/^.*Limite de/, 'Limite de'))
    check('limite de place dépassée par un clip qui arrive : le plus vieux part avec son fichier et sa vignette, pas le clip épinglé ni le nouveau', ids(kept2) === [fresh.id, a.id].join() && !fs.existsSync(fileCut) && !hasThumb(cut) && mp4s().length === 2 && fresh.sizeBytes > 300_000 && limitLines.length === 1 && limitLines[0].includes(': 1 ancien(s) clip(s) supprimé(s).'), { liste: brief(kept2), fichiers: mp4s().length, journal: limitLines })
    await close(s)
    const base3 = await stored(dirs)
    check('dans la base : le clip que la limite a fait partir n’y est plus', sameIds(base3, kept2), (base3 || []).map((x) => x && x.title))
    s = await open(dirs)

    // ----- une coupe faite au-delà de la limite : elle reste (c'est le clip qui vient d'arriver), les clips épinglés aussi
    await L('clipsPin', fresh.id, true)
    await L('clipsSaveSettings', { limitGb: 0.001 })
    const r5 = await told(() => L('clipsTrim', fresh.id, 2.2, 5))
    const cut2 = r5.result
    const fileCut2 = path.join(folder, mp4s().find((n) => n.includes('(coupé)')) || 'introuvable')
    const kept3 = await L('clipsList')
    check('une coupe faite au-delà de la limite reste, sans épingle, avec son fichier et sa vignette ; les clips épinglés restent aussi', ids(kept3) === [cut2.id, fresh.id, a.id].join() && cut2.pinned === false && decodeCheck(fileCut2).ok && hasThumb(cut2) && mp4s().length === 3 && kept3.reduce((n, x) => n + x.sizeBytes, 0) > 0.001 * 1024 ** 3 && r5.ok, { liste: brief(kept3), fichiers: mp4s().length, prevenue: r5.ok })

    // ----- l'appli quitte pendant un travail sur un fichier : elle attend qu'il finisse
    // Un fichier prend la place du dossier des clips : la suppression d'un clip s'y reprend à cinq fois, pendant près d'une
    // seconde. La liste, elle, garde ses fiches : pour elle c'est un disque débranché, quel que soit le moment où la page la lit.
    fs.renameSync(folder, away); fs.writeFileSync(folder, '')
    s.p.evaluate((id) => { window.launcher.clipsDelete(id) }, a.id).catch(() => {})
    // La suppression a commencé quand la fiche n'est plus connue (« ouvrir le dossier » de ce clip est alors refusé).
    await until(async () => /Clip inconnu/.test(await L('clipsOpenFolder', a.id).then(() => '', (e) => String(e))), 3000, 'suppression commencée', 20)
    const t0 = Date.now()
    s.app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) }).catch(() => {})
    const gone = await exited(s.proc, 12000)
    const ms = Date.now() - t0
    fs.unlinkSync(folder); fs.renameSync(away, folder)
    const said = fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8').split('\n').filter((l) => l.includes(a.id) && /Suppression de|supprimé/.test(l)).map((l) => l.slice(25, 75))
    check('l’appli quitte pendant une suppression qui traîne : elle attend la fin, puis se ferme toute seule', gone && s.proc.exitCode === 0 && said.some((l) => l.includes(`Suppression de ${a.id}`)) && said.some((l) => l.includes(`Clip ${a.id} supprimé.`)) && !hasThumb(a), { fermee: gone, code: s.proc.exitCode, ms, journal: said, vignettes: thumbs().length })
    const base4 = gone ? await stored(dirs) : null
    check('dans la base : il reste la dernière coupe et son original', sameIds(base4, [cut2, fresh]), (base4 || []).map((x) => x && x.title))

    // ----- des travaux plus longs que l'attente de l'appli (8 secondes) : elle quitte quand même
    // Quatorze fiches de plus dans la base, chacune avec un petit fichier : quatorze suppressions qui traînent, plus de onze
    // secondes de travail à la suite. L'appli ne peut pas tout attendre.
    const model = (base4 || []).find((x) => x.id === fresh.id)
    const extra = Array.from({ length: 14 }, (_, i) => ({ ...model, id: `fa${i.toString(16).padStart(14, '0')}`, title: `Faux ${i + 1}`, at: model.at - 60000 - i, pinned: false, sizeBytes: 9, file: path.join(folder, `faux-${i + 1}.mp4`) }))
    for (const x of extra) fs.writeFileSync(x.file, 'faux clip')
    await stored(dirs, (l) => [...l, ...extra])
    s = await open(dirs)
    const many = await L('clipsList')
    fs.renameSync(folder, away); fs.writeFileSync(folder, '')
    s.p.evaluate((list) => { for (const id of list) window.launcher.clipsDelete(id) }, extra.map((x) => x.id)).catch(() => {})
    await until(async () => /Clip inconnu/.test(await L('clipsOpenFolder', extra[0].id).then(() => '', (e) => String(e))), 3000, 'suppressions commencées', 20)
    const t1 = Date.now()
    s.app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) }).catch(() => {})
    const gone2 = await exited(s.proc, 20000)
    const ms2 = Date.now() - t1
    fs.unlinkSync(folder); fs.renameSync(away, folder)
    const done = fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8').split('\n').filter((l) => /Clip fa[0-9a-f]{14} supprimé\./.test(l)).length
    // Elle a attendu (des suppressions ont fini pendant ce temps), mais pas tout (il en restait) : c'est la limite qui l'a fait partir.
    check('des suppressions plus longues que l’attente de l’appli : elle attend, puis quitte quand même, toute seule', many.length === 16 && gone2 && s.proc.exitCode === 0 && done >= 1 && done < 14, { clips: many.length, fermee: gone2, code: s.proc.exitCode, ms: ms2, suppressionsFinies: done })
    s = await open(dirs)
    const again = await L('clipsList')
    const real = (l) => l.filter((x) => x.id === cut2.id || x.id === fresh.id)
    check('après ce départ, l’appli redémarre et retrouve ses clips', same(real(kept3), real(again)) && real(again).length === 2 && again.length < 16, { clips: again.length, vrais: brief(real(again)) })
    check('pas d’erreur dans la page', errs.length === 0, errs.slice(0, 3))
  } catch (e) { fail++; console.log('ECHEC', String(e.message || e).split('\n')[0]) } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    if (s) await close(s)
    process.exit(fail ? 1 : 0)
  }
})()
