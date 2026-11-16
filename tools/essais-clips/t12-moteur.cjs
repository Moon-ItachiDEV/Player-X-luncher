// Le moteur vidéo (FFmpeg) : état, essai sur un vrai clip, refus pendant une partie, arrêt, rapport sans chemin, ménage.
// Sous Linux, c'est le ffmpeg de la machine qui joue le rôle du moteur (PX_FFMPEG) et libx264 celui d'un encodeur qui marche
// (PX_FFMPEG_ENCODER) : le moteur Windows livré, lui, n'est jamais lancé ici. Sa vérification (fichier présent, empreinte) se
// fait sur le vrai fichier de vendor/ffmpeg, s'il est là.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simPost, simRunning, payload, freshDirs, listDir, fs, path, ROOT } = H
const os = require('os'), { execFileSync } = require('child_process')

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`) }
const FF = process.env.PX_T12_FFMPEG || '/usr/local/bin/ffmpeg'
const leftovers = () => listDir(os.tmpdir()).filter((n) => n.startsWith('px-moteur-'))
const ffmpegRunning = () => { try { return execFileSync('pgrep', ['-f', 'px-moteur-'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length } catch { return 0 } }

async function partA() {
  console.log('--- A. Le moteur de la machine : un vrai essai, sur un vrai clip')
  const dirs = freshDirs('t12a')
  const { app, p, errs } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360', PX_FFMPEG: FF, PX_FFMPEG_ENCODER: 'libx264' })
  const L = (...a) => launcher(p, ...a)
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    const before = leftovers()
    const e0 = await L('editEngine')
    check('état avant tout essai : prêt, version lue, pas d’essai', e0.status === 'ready' && /^\d+\.\d+/.test(e0.version) && e0.testing === false && !e0.test && !e0.report, e0)
    // Un vrai clip, fabriqué par le vrai moteur d'enregistrement
    await L('clipsSaveSettings', { before: 6, after: 2, merge: 3 })
    await simRunning(app, true)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 9, 30000, 'tampon', 500)
    await simPost(app, payload({ round: 1, phase: 'freezetime', ct: 1, t: 0 }))
    await simPost(app, payload({ round: 1, phase: 'live', ct: 1, t: 0 }))
    await simPost(app, payload({ round: 1, kills: 1, rk: 1, rhs: 1, ct: 1, t: 0 }))
    const clip = (await until(async () => { const l = await L('clipsList'); return l.length ? l : null }, 30000, 'un clip'))[0]
    check('un clip existe', clip.durationS >= 5 && clip.width === 640 && clip.height === 360, { d: clip.durationS, w: clip.width, h: clip.height })
    // Pendant la partie : refus, et rien ne tourne
    const refused = await L('editEngineTest').then(() => null, (e) => String(e.message || e))
    check('refus pendant qu’un jeu tourne', /Un jeu tourne/.test(refused || ''), refused)
    check('après le refus : pas d’essai enregistré, pas de dossier laissé', !(await L('editEngine')).test && leftovers().length === before.length)
    await simRunning(app, false)
    await until(async () => (await L('clipsState')).status !== 'recording', 20000, 'fin de la partie', 300)
    // L'essai
    await p.evaluate(() => { window.__steps = []; window.launcher.onEditEngineStep((s) => window.__steps.push(s)) })
    const t0 = Date.now()
    const e1 = await L('editEngineTest')
    const took = (Date.now() - t0) / 1000
    const steps = await p.evaluate(() => window.__steps)
    const t = e1.test
    console.log('    essai en', took.toFixed(1), 's :', JSON.stringify(t.encoders.map((e) => [e.id, e.ok, e.seconds ? +e.seconds.toFixed(2) : e.error])))
    check('l’état rendu dit que l’essai est fini', e1.status === 'ready' && e1.testing === false && !!t)
    check('6 encodeurs essayés, dans l’ordre', t.encoders.map((e) => e.id).join() === 'h264_nvenc,h264_amf,h264_qsv,h264_mf,libopenh264,libx264', t.encoders.map((e) => e.id))
    const by = Object.fromEntries(t.encoders.map((e) => [e.id, e]))
    check('carte NVIDIA et puce Intel : citées par ce ffmpeg, mais sans matériel ici', by.h264_nvenc.ok === false && by.h264_qsv.ok === false && !!by.h264_nvenc.error && by.h264_nvenc.error !== 'absent de ce moteur', [by.h264_nvenc.error, by.h264_qsv.error])
    check('AMD, Windows et OpenH264 : absents de ce ffmpeg, dit tel quel', ['h264_amf', 'h264_mf', 'libopenh264'].every((k) => by[k].ok === false && by[k].error === 'absent de ce moteur'))
    check('l’encodeur d’essai marche, avec une vraie durée', by.libx264.ok === true && by.libx264.seconds > 0.5 && by.libx264.seconds < 30, by.libx264.seconds)
    check('choisi : le seul qui marche', t.best === 'libx264', t.best)
    // L'essai sur le clip passe par les commandes d'un film (un plan, puis l'assemblage), sur 20 s au plus : ici tout le clip.
    check('le dernier clip est passé dans le moteur, par le chemin d’un film', t.clip && t.clip.ok === true && t.clip.seconds > 0.1 && t.clip.width === 640 && t.clip.height === 360 && t.clip.audio === true && Math.abs(t.clip.sampleS - Math.floor(clip.durationS * 10) / 10) < 1e-6 && t.clip.sampleS > 5 && t.clip.sampleS <= 20, t.clip)
    check('avancement : une étape par encodeur, puis le clip', steps.length === 7 && steps.every((s, i) => s.index === i + 1 && s.total === 7) && steps[6].what === 'clip' && steps[0].what === 'h264_nvenc', steps.map((s) => s.what))
    // Le rapport : complet, et sans rien qui dise où sont les fichiers
    const folder = (await L('clipsGetSettings')).folder
    const rep = e1.report || ''
    console.log(rep.split('\n').map((l) => '    | ' + l).join('\n'))
    check('rapport : toutes les lignes', /essai du moteur vidéo du \d\d\/\d\d\/\d{4} à \d\d h \d\d/.test(rep) && /Moteur : FFmpeg \d/.test(rep) && /PC : /.test(rep) && / cœurs logiques · /.test(rep) && /- libx264 : marche \(\d+,\d\d s\)/.test(rep) && /Choisi : libx264/.test(rep) && /Dernier clip \(640 × 360, avec le son\) : \d+,\d s de film en \d+,\d\d s \(×\d+,\d\)$/.test(rep) && !/Dernier film/.test(rep), rep.split('\n').length)
    const secrets = [dirs.base, dirs.home, dirs.userData, folder, os.tmpdir() + '/px-moteur', os.homedir(), os.userInfo().username + '/'].filter((x) => x && x.length > 4)
    check('rapport et erreurs : aucun chemin de ce PC', !secrets.some((x) => JSON.stringify(e1).includes(x)), secrets.filter((x) => JSON.stringify(e1).includes(x)))
    check('ménage : pas de dossier d’essai laissé, pas de ffmpeg qui traîne', leftovers().length === before.length && ffmpegRunning() === 0, { dirs: leftovers(), ff: ffmpegRunning() })
    check('le clip n’a pas bougé', (await L('clipsList'))[0].sizeBytes === clip.sizeBytes && fs.existsSync(path.join(folder, listDir(folder).find((n) => n.endsWith('.mp4')))))
    // Relu depuis la base
    const e2 = await L('editEngine')
    check('l’essai est gardé et relu tel quel', JSON.stringify(e2.test) === JSON.stringify(t) && e2.report === rep)
    // Arrêt en cours d'essai : rien n'est enregistré à la place
    const pending = L('editEngineTest').then(() => 'fini', (e) => String(e.message || e))
    await sleep(1500)
    const during = await L('editEngine')
    await L('editEngineStop')
    const end = await pending
    check('pendant l’essai, l’état le dit', during.testing === true)
    check('arrêt : l’essai s’arrête et le dit', /Essai arrêté/.test(end), end)
    await sleep(500)
    const e3 = await L('editEngine')
    check('après l’arrêt : l’ancien essai est toujours là, plus rien ne tourne, rien de laissé', e3.testing === false && e3.test && e3.test.at === t.at && leftovers().length === before.length && ffmpegRunning() === 0, { dirs: leftovers(), ff: ffmpegRunning() })
    // Deux demandes en même temps : un seul essai
    const [a, b] = await Promise.all([L('editEngineTest'), L('editEngineTest')])
    check('deux demandes à la fois : un seul essai, le même résultat', a.test.at === b.test.at && a.test.at > t.at)
    // La page ne peut rien glisser dans la commande : les canaux ne prennent aucun argument
    const inj = await p.evaluate(() => window.launcher.editEngineTest.length + window.launcher.editEngine.length)
    check('les appels de la page ne prennent aucun argument', inj === 0)
  } catch (e) { fail++; console.log('ECHEC A', e.message.split('\n')[0]) } finally { await app.close().catch(() => {}) }
  check('A : aucune erreur dans la page', errs.length === 0, errs.slice(0, 3))
}

async function partB() {
  console.log('--- B. Le fichier livré : présent, intact, modifié, absent (sans jamais le lancer)')
  const exe = path.join(ROOT, 'vendor/ffmpeg/ffmpeg.exe'), aside = exe + '.vrai'
  if (!fs.existsSync(exe)) { console.log('    vendor/ffmpeg/ffmpeg.exe absent : partie B sautée (node scripts/fetch-ffmpeg.mjs)'); return }
  const size = fs.statSync(exe).size
  const dirs = freshDirs('t12b')
  const { app, p, errs } = await start(dirs, { PX_FFMPEG: '', PX_FFMPEG_ENCODER: '' })
  const L = (...a) => launcher(p, ...a)
  try {
    const t0 = Date.now()
    const e0 = await L('editEngine')
    const first = Date.now() - t0
    check('le vrai fichier : prêt, version de la fiche, empreinte vérifiée', e0.status === 'ready' && e0.version === '9.0.2' && !e0.test, e0)
    const t1 = Date.now(); await L('editEngine'); const second = Date.now() - t1
    console.log(`    empreinte de ${(size / 1e6).toFixed(1)} Mo : ${first} ms la première fois, ${second} ms ensuite`)
    check('l’empreinte n’est calculée qu’une fois', second < first && second < 200, { first, second })
    // Sous Linux, le programme Windows n'est pas lancé : l'essai le dit, sans erreur
    const e1 = await L('editEngineTest')
    check('hors Windows : pas de lancement, un résultat clair', e1.test && e1.test.best === null && e1.test.encoders.length === 1 && e1.test.encoders[0].id === 'demarrage' && /fait pour Windows/.test(e1.test.encoders[0].error || ''), e1.test)
    check('et le rapport le dit', /- demarrage : non \(ce moteur est fait pour Windows\)\nChoisi : aucun/.test(e1.report || ''), e1.report)
    fs.renameSync(exe, aside)
    try {
      check('fichier absent : dit absent', (await L('editEngine')).status === 'missing')
      const miss = await L('editEngineTest').then(() => null, (e) => String(e.message || e))
      check('essai refusé, avec quoi faire', /Le moteur vidéo manque\. Réinstalle/.test(miss || ''), miss)
      fs.writeFileSync(exe, 'pas le moteur')
      check('autre taille : dit modifié', (await L('editEngine')).status === 'damaged')
      // Même taille, autre contenu : seule l'empreinte le voit
      fs.rmSync(exe); const fd = fs.openSync(exe, 'w'); fs.ftruncateSync(fd, size); fs.closeSync(fd)
      const eD = await L('editEngine')
      check('même taille, autre contenu : dit modifié', eD.status === 'damaged' && !eD.test, eD.status)
      const dmg = await L('editEngineTest').then(() => null, (e) => String(e.message || e))
      check('essai refusé sur un fichier modifié', /a été modifié depuis l’installation/.test(dmg || ''), dmg)
    } finally {
      fs.rmSync(exe, { force: true }); fs.renameSync(aside, exe)
    }
    const back = await L('editEngine')
    check('fichier remis : prêt de nouveau, et l’essai d’avant est relu', back.status === 'ready' && !!back.test, back.status)
  } catch (e) { fail++; console.log('ECHEC B', e.message.split('\n')[0]) } finally {
    if (fs.existsSync(aside)) { fs.rmSync(exe, { force: true }); fs.renameSync(aside, exe) }
    await app.close().catch(() => {})
  }
  check('B : aucune erreur dans la page', errs.length === 0, errs.slice(0, 3))
}

;(async () => {
  await partA()
  await partB()
  console.log(`\n${pass} réussis, ${fail} ratés`)
  process.exit(fail ? 1 : 0)
})()
