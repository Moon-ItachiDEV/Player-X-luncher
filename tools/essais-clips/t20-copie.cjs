// Copier un clip, aux bords. Trois clips filmés par l'appli (source d'essai 640 × 360), puis ce que le grand essai du
// partage (t15-partage) ne regarde pas : le fichier d'origine copié tel quel, quel que soit son poids ; un clip inconnu ;
// la limite du compte à l'octet près ; une limite d'essai hors bornes, et le réglage « Mon Discord » qui décide alors ; un
// clip trop long pour la limite, dit au journal ; le presse-papiers qui refuse, pour le clip lui-même comme pour une copie
// légère, et ce que la page dit alors ; le moteur vidéo absent ; un fichier qui n'est plus une vidéo ; un fichier disparu,
// ou remplacé par un dossier.
// Sous Linux, le vrai presse-papiers n'est pas touché : avec PX_CLIP_TEST_COPY=1 (développement seulement), l'appli note le
// fichier qu'elle y aurait mis, et l'essai le relit. Sans cette variable, elle répond que la copie a raté : c'est ce qui
// sert ici de presse-papiers qui refuse. Le presse-papiers de Windows (PowerShell) ne tourne jamais ici : il se vérifie sur
// un PC. La copie légère est fabriquée par le ffmpeg de la machine (PX_FFMPEG), avec libx264.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, freshDirs, listDir, fs, path } = H

let pass = 0, fail = 0
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined && !ok ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
const note = (s) => console.log(`    ${s}`)
const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360', PX_FFMPEG: process.env.PX_T20_FFMPEG || '/usr/bin/ffmpeg', PX_FFMPEG_ENCODER: 'libx264', PX_CLIP_TEST_COPY: '1' }
// Le message tel que la page le reçoit, sans ce qu'ajoutent Playwright et Electron devant.
const refusal = (promise) => promise.then(() => null, (e) => String(e.message || e).replace(/^page\.evaluate: (Error: )?/, '').replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
const setEnv = (app, k, v) => app.evaluate((_e, [k, v]) => { if (v === null) delete process.env[k]; else process.env[k] = v }, [k, v])
/** La limite (en Mo, 3 décimales) qui laisse ce débit, son compris, à ce clip : la règle de l'appli, refaite ici. */
const limitAt = (c, bps) => Math.floor((bps * Math.max(1, c.durationS)) / 8 / 0.94 / 1000) / 1000
/** Le plus long clip de 640 × 360 à 30 images/s qui tient sous cette limite : 680 kb/s pour l'image, 96 kb/s pour le son. */
const maxSAt = (limit) => Math.floor((limit * 0.94 * 8) / (680_000 + 96_000))

/** La page sans l'accueil du premier lancement, et un relevé de chaque message affiché. */
async function preparePage(app, p) {
  await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
  await p.evaluate(() => { try { localStorage.setItem('pxv3-setup', '1') } catch { /* */ } })
  await p.reload()
  await p.waitForLoadState('domcontentloaded')
  await until(() => p.evaluate(() => typeof Clips !== 'undefined' && typeof Settings !== 'undefined' && !!document.getElementById('toasts') && !!Real.clipsCfg).catch(() => false), 20000, 'page prête')
  await p.evaluate(() => {
    window.__toasts = []
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || !n.classList.contains('toast')) continue
        const a = n.querySelector('.toast-a')
        window.__toasts.push({ text: [...n.childNodes].filter((x) => x !== a).map((x) => x.textContent).join('').trim(), tone: n.className, action: a ? a.textContent : null })
      }
    }).observe(document.getElementById('toasts'), { childList: true })
  })
}
const toasts = (p) => p.evaluate(() => window.__toasts)
const waitToast = (p, re, from, ms) => until(async () => (await toasts(p)).slice(from).find((t) => re.test(t.text)), ms, `message ${re}`, 200)
const buttonText = (p) => p.evaluate(() => document.querySelector('#cpShare span')?.textContent)

;(async () => {
  const dirs = freshDirs('t20')
  const folder = path.join(dirs.home, 'Videos', 'Player X V3 Test'), root = path.join(dirs.userData, 'clips-share')
  let s
  const L = (...a) => launcher(s.p, ...a)
  /** Le fichier que l'appli dit avoir mis dans le presse-papiers (null : aucun depuis son lancement). */
  const copied = async () => (await test(s.app, 'info')).copied
  /** La limite d'essai, en Mo (null : aucune, le réglage décide). Rend la même limite en octets. */
  const useLimit = async (mb) => { await setEnv(s.app, 'PX_CLIP_TEST_SHARE_MB', mb === null ? null : String(mb)); return mb === null ? null : Math.round(mb * 1e6) }
  /** Le journal des clips, une fois écrit sur le disque (clipsLogTail attend qu'il le soit). */
  const journal = async () => { await L('clipsLogTail'); return fs.readFileSync(path.join(dirs.userData, 'logs', 'clips.log'), 'utf8').split('\n') }
  /** Les dossiers de copies légères de ce clip. */
  const copies = (id) => listDir(root).filter((n) => n.startsWith(`${id}-`))
  try {
    s = await start(dirs, ENV)
    await preparePage(s.app, s.p)
    // ----- trois clips, en qualité équilibrée : assez lourds pour qu'une limite basse demande une copie légère
    await L('clipsSaveSettings', { before: 6, after: 2, merge: 0, quality: 'balanced' })
    await simRunning(s.app, true)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 8, 40000, 'tampon', 500)
    let list = []
    for (let n = 1; n <= 3; n++) {
      await test(s.app, 'saveNow')
      list = await until(async () => { const l = await L('clipsList'); return l.length >= n ? l : null }, 45000, `${n} clip(s)`)
      await sleep(1200)
    }
    await simRunning(s.app, false)
    await until(async () => (await L('clipsState')).status !== 'recording', 20000, 'fin de la partie', 300)
    // La liste est rendue du plus récent au plus ancien
    const [c, b, a] = list
    check('lancement neuf : aucun fichier n’est noté comme copié', (await copied()) === null, await copied())

    // ----- 1. le fichier d'origine : tel quel, quel que soit son poids, même avec une limite minuscule
    await useLimit(0.001)
    const files = {}, oks = []
    for (const x of [a, b, c]) { oks.push(await L('clipsCopyFile', x.id)); files[x.id] = await copied() }
    const mp4s = listDir(folder).filter((n) => n.endsWith('.mp4')).map((n) => path.join(folder, n)).sort()
    const own = [a, b, c].map((x) => files[x.id])
    check('copier le fichier : chaque clip donne le sien, celui du dossier des clips, quel que soit son poids', oks.join() === 'true,true,true' && mp4s.length === 3 && [...own].sort().join() === mp4s.join() && [a, b, c].every((x) => fs.statSync(files[x.id]).size === x.sizeBytes), { oks, own, mp4s })
    const rate = (x) => (fs.statSync(files[x.id]).size * 8) / x.durationS
    note(`débit des clips : ${[a, b, c].map((x) => `${(rate(x) / 1e6).toFixed(2)} Mb/s`).join(', ')}`)
    check('les clips sont assez lourds pour demander une copie légère (plus de 1,3 Mb/s)', [a, b, c].every((x) => rate(x) > 1.3e6))
    const u1 = await L('clipsCopyFile', 'ffffffffffffffff'), u2 = await L('clipsCopyFile', { id: a.id }), u3 = await L('clipsCopyFile')
    check('copier le fichier d’un clip inconnu : false, et le presse-papiers ne change pas', u1 === false && u2 === false && u3 === false && (await copied()) === files[c.id], { u1, u2, u3, copied: await copied() })
    const u4 = await refusal(L('clipsShare', 'ffffffffffffffff'))
    check('copier pour Discord un clip inconnu : refusé en clair, et le presse-papiers ne change pas', u4 === 'Clip inconnu.' && (await copied()) === files[c.id], u4)

    // ----- 2. la limite du compte, à l'octet près
    const sizeA = fs.statSync(files[a.id]).size
    await useLimit(sizeA / 1e6)
    const e1 = await L('clipsShare', a.id)
    check('limite égale au poids du clip : le clip lui-même part, sans copie', e1.status === 'copied' && !e1.reduced && e1.sizeBytes === sizeA && e1.limitMb === sizeA / 1e6 && (await copied()) === files[a.id] && copies(a.id).length === 0, { e1, copies: copies(a.id) })
    await L('clipsCopyFile', b.id)
    const lim2 = await useLimit((sizeA - 1) / 1e6)
    const e2 = await L('clipsShare', a.id)
    const f2 = await copied()
    note(`un octet sous le poids du clip (${sizeA}) : ${e2.status}${e2.reduced ? `, copie de ${e2.sizeBytes} octets` : ''}`)
    check('un octet de moins : le clip lui-même ne part plus (une copie légère, ou rien)', e2.status === 'copied' ? !!e2.reduced && e2.sizeBytes <= lim2 && f2 === path.join(root, `${a.id}-${lim2}`, path.basename(files[a.id])) : ['too-long', 'unmade'].includes(e2.status) && f2 === files[b.id], { e2, f2 })

    // ----- 3. une limite d'essai hors bornes ne compte pas : le réglage « Mon Discord » décide
    await L('clipsSaveSettings', { discord: 'basic' })
    const got = []
    for (const v of ['500.001', '0', '-3', 'abc', '']) { await setEnv(s.app, 'PX_CLIP_TEST_SHARE_MB', v); got.push((await L('clipsShare', a.id)).limitMb) }
    check('limite d’essai hors bornes (plus de 500, zéro, négative, du texte, vide) : le réglage décide, 50 Mo', got.join() === '50,50,50,50,50', got)
    await useLimit(500)
    const t500 = await L('clipsShare', a.id)
    await useLimit(null)
    await L('clipsSaveSettings', { discord: 'nitro' })
    const tN = await L('clipsShare', b.id)
    await L('clipsSaveSettings', { discord: 'free' })
    const tF = await L('clipsShare', a.id)
    check('la limite d’essai va jusqu’à 500 Mo ; sans elle, le réglage : Nitro 500 Mo, Sans Nitro 20 Mo', t500.limitMb === 500 && t500.status === 'copied' && tN.limitMb === 500 && tN.status === 'copied' && !tN.reduced && tF.limitMb === 20 && tF.status === 'copied' && (await copied()) === files[a.id], { t500, tN, tF })
    check('… et le poids annoncé est celui du clip qui part', t500.sizeBytes === sizeA && tN.sizeBytes === fs.statSync(files[b.id]).size && tF.sizeBytes === sizeA, { t500, tN, tF })

    // ----- 4. trop long pour la limite : rien ne part, et le journal dit pourquoi
    const mbL = limitAt(b, 450_000), limL = await useLimit(mbL)
    const isLong = (l) => l.includes(`Copie pour Discord du clip ${b.id} : `) && l.includes('trop long pour')
    const before = (await journal()).filter(isLong).length
    const tl = await L('clipsShare', b.id)
    const said = (await journal()).filter(isLong)
    check('trop long pour la limite : rien ne part, la durée qui tient est donnée', tl.status === 'too-long' && tl.maxS === maxSAt(limL) && tl.limitMb === mbL && tl.sizeBytes === fs.statSync(files[b.id]).size && (await copied()) === files[a.id] && copies(b.id).length === 0, { tl, attendu: maxSAt(limL) })
    const m = said.length === 1 ? /: ([\d.]+) s, trop long pour ([\d.]+) Mo \(au plus (\d+) s\)\.$/.exec(said[0]) : null
    check('… et le journal dit la durée du clip, la limite et la durée qui tient', before === 0 && !!m && Math.abs(+m[1] - b.durationS) <= 0.6 && +m[2] === mbL && +m[3] === maxSAt(limL), said)

    // ----- 5. le presse-papiers refuse
    const mbC = limitAt(c, 1_000_000), limC = await useLimit(mbC)
    const made = await L('clipsShare', c.id)
    const fMade = await copied()
    check('une copie légère, pour la suite : fabriquée, sous la limite, et c’est elle qui part', made.status === 'copied' && !!made.reduced && made.sizeBytes <= limC && fMade === path.join(root, `${c.id}-${limC}`, path.basename(files[c.id])) && fs.statSync(fMade).size === made.sizeBytes, { made, fMade })
    await setEnv(s.app, 'PX_CLIP_TEST_COPY', null)
    const k1 = await L('clipsCopyFile', a.id)
    const k2 = await L('clipsShare', c.id)
    await useLimit(null)
    const k3 = await L('clipsShare', a.id)
    check('presse-papiers refusé : false pour le fichier, « failed » pour le clip lui-même comme pour la copie légère, rien n’est noté', k1 === false && JSON.stringify(k2) === '{"status":"failed"}' && JSON.stringify(k3) === '{"status":"failed"}' && (await copied()) === fMade, { k1, k2, k3, copied: await copied() })
    // La page : le lecteur ouvert sur le clip, le bouton « Copier pour Discord »
    await s.p.evaluate((x) => Clips.open(x), a.id)
    await until(() => s.p.evaluate(() => !!document.getElementById('cpShare') && Clips.isOpen()), 8000, 'lecteur ouvert', 150)
    await sleep(600)
    const from = (await toasts(s.p)).length
    await s.p.evaluate(() => document.getElementById('cpShare').click())
    const tk = await waitToast(s.p, /presse-papiers/, from, 8000).catch(() => null)
    check('… et la page le dit, sans rien promettre', !!tk && tk.text === 'Le clip n’a pas pu aller dans le presse-papiers. Ouvre le dossier et glisse le fichier dans Discord.' && /warn/.test(tk.tone) && (await buttonText(s.p)) === 'Copier pour Discord' && (await copied()) === fMade, { tk, bouton: await buttonText(s.p) })
    await s.p.evaluate(() => Clips.close())
    await setEnv(s.app, 'PX_CLIP_TEST_COPY', '1')
    check('le presse-papiers accepte de nouveau : le fichier est copié', (await L('clipsCopyFile', a.id)) === true && (await copied()) === files[a.id], await copied())

    // ----- 6. le moteur vidéo manque : pas de copie légère, et la raison est donnée
    await setEnv(s.app, 'PX_FFMPEG', path.join(dirs.base, 'absent', 'ffmpeg'))
    const mbE = limitAt(a, 1_000_000), limE = await useLimit(mbE)
    const en = await L('clipsShare', a.id)
    check('moteur vidéo absent : pas de copie légère, rien ne part, et la raison est « moteur »', en.status === 'unmade' && en.reason === 'engine' && en.limitMb === mbE && en.sizeBytes === sizeA && (await copied()) === files[a.id] && !fs.existsSync(path.join(root, `${a.id}-${limE}`)), en)
    await setEnv(s.app, 'PX_FFMPEG', ENV.PX_FFMPEG)

    // ----- 7. un fichier qui n'est plus une vidéo : pas de copie légère, dit au journal ; sous la limite, il part tel quel
    const sizeC = fs.statSync(files[c.id]).size
    fs.writeFileSync(files[c.id], Buffer.alloc(sizeC, 7))
    // Une limite qui n'a encore jamais servi à ce clip : aucune copie déjà faite ne peut resservir
    const mbG = Math.round(mbC * 1000 - 5) / 1000, limG = await useLimit(mbG)
    const g1 = await L('clipsShare', c.id)
    const bad = (await journal()).filter((l) => l.includes(`Copie pour Discord du clip ${c.id} impossible : fichier illisible`))
    check('fichier illisible : pas de copie légère, rien ne part, aucun reste', g1.status === 'unmade' && g1.reason === 'encode' && g1.limitMb === mbG && g1.sizeBytes === sizeC && (await copied()) === files[a.id] && !fs.existsSync(path.join(root, `${c.id}-${limG}`)), g1)
    check('… le journal le dit, sans aucun chemin du PC', bad.length === 1 && !bad.some((l) => l.includes(folder) || l.includes(dirs.base)), bad)
    await useLimit(null)
    const g2 = await L('clipsShare', c.id)
    check('… mais sous la limite du compte, ce fichier part tel quel : l’appli ne le relit pas', g2.status === 'copied' && !g2.reduced && g2.sizeBytes === sizeC && g2.limitMb === 20 && (await copied()) === files[c.id], g2)

    // ----- 8. le fichier a disparu, puis un dossier a pris sa place : refusé en clair
    fs.unlinkSync(files[b.id])
    const d1 = await refusal(L('clipsShare', b.id))
    fs.mkdirSync(files[b.id])
    const d2 = await refusal(L('clipsShare', b.id))
    fs.rmdirSync(files[b.id])
    check('fichier disparu : refusé en clair, et le presse-papiers ne change pas', d1 === 'Le fichier de ce clip a disparu.' && (await copied()) === files[c.id], d1)
    check('un dossier à la place du fichier : refusé pareil', d2 === 'Le fichier de ce clip a disparu.' && (await copied()) === files[c.id], d2)
    check('pas d’erreur dans la page', s.errs.length === 0, s.errs.slice(0, 3))
  } catch (e) { fail++; console.log('ECHEC', String(e.message || e).split('\n')[0]) } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    if (s) await s.app.close().catch(() => {})
    process.exit(fail ? 1 : 0)
  }
})()
