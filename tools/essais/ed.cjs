// Essai du lot A de l'éditeur de films, dans la vraie appli (Electron sous Xvfb), avec de vrais clips.
// Les clips viennent de la source d'essai (PX_CLIP_TEST_SOURCE) et du simulateur CS2 ; le moteur est le ffmpeg de la machine
// (PX_FFMPEG) avec libx264 ; la musique est un fichier fabriqué ici (un kick à 100 temps par minute) que PX_MUSIC_PICK donne à
// l'appli sans fenêtre de Windows. Rien n'est posé dans la page : tout passe par les vrais boutons et la vraie souris.
// Vérifie : ouverture, lecture qui avance, espace, tirer un bord (une seule annulation), Échap qui annule un glisser, glisser
// le repère, glisser un plan (ordre), la vidéo jamais rechargée par un réglage, Corriger ×2 puis ÷2 (grille identique), brouillon
// retrouvé après fermeture puis après relance de l'appli, clip supprimé (hachuré) et « Fabriquer » grisé, musique introuvable,
// aucun .btn.rose, le film fabriqué efface le brouillon. Captures : tools/essais/shots/ed-*.png (1600 × 940 et 1280 × 720).
// Lancer : xvfb-run -a node tools/essais/ed.cjs
const H = require('../essais-clips/h.cjs')
const { start, sleep, until, launcher, simPost, simRunning, payload, freshDirs, fs, path, execFileSync } = H
const SHOTS = path.resolve(__dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })
fs.readdirSync(SHOTS).filter((f) => /^ed-.*\.png$/.test(f)).forEach((f) => fs.unlinkSync(path.join(SHOTS, f)))

let pass = 0, fail = 0
const check = (c, m, diag) => { if (c) pass++; else fail++; console.log(c ? 'OK ' : 'NON', m); if (!c && diag !== undefined) console.log('   détail :', JSON.stringify(diag)) }

;(async () => {
  const dirs = freshDirs('ed')
  const FF = '/usr/bin/ffmpeg'
  const musicFile = path.join(dirs.base, 'nuit-blanche.mp3')
  // Un kick (60 Hz qui retombe) à 100 temps par minute, 60 s
  execFileSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*58*t)*exp(-9*mod(t,0.6))':d=60:s=44100", '-c:a', 'libmp3lame', '-b:a', '128k', musicFile])
  const ENV = { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360', PX_FFMPEG: FF, PX_FFMPEG_ENCODER: 'libx264', PX_MUSIC_PICK: musicFile }
  const boot = async () => {
    const r = await start(dirs, ENV)
    await r.p.evaluate(() => localStorage.setItem('pxv3-setup', '1'))
    await r.p.reload(); await r.p.waitForLoadState('domcontentloaded')
    await sleep(6000)
    await r.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 940))
    await sleep(800)
    return r
  }
  let { app, p, errs, proc } = await boot()
  const L = (n, ...a) => launcher(p, n, ...a)
  const q = (f, ...a) => p.evaluate(f, ...a)
  const size = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h])
  const shot = async (n) => { await sleep(250); await p.screenshot({ path: path.join(SHOTS, `ed-${n}.png`) }) }
  const both = async (n) => { await size(1600, 940); await sleep(900); await shot(`${n}-1600`); await size(1280, 720); await sleep(900); await shot(`${n}-1280`); await size(1600, 940); await sleep(700) }
  const probe = () => q(() => Editor.probe())
  // Les plans glissent pendant leur animation (left/width .25s). Sous Xvfb la page produit peu d'images : deux mesures égales ne
  // prouvent pas que la transition est finie. On attend la fin réelle des animations de la bande, puis deux images, puis on mesure.
  const box = (sel) => q(async (sel) => {
    const tr = document.querySelector('#edTrack')
    tr?.getBoundingClientRect()
    if (tr) await Promise.all(tr.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const r = document.querySelector(sel)?.getBoundingClientRect()
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } : null
  }, sel)
  let MARK = 0
  const undoLast = async () => { if ((await probe()).undo > MARK) { await q(() => document.querySelector('#edUndo').click()); await sleep(400) } }
  const drafts = () => q(() => JSON.parse(localStorage.getItem('pxv3-ed-drafts') || '[]'))
  const waitEd = async () => { await until(() => q(() => !!document.querySelector('#ed .ed-shot')), 20000, 'éditeur ouvert'); await sleep(900) }
  // La largeur d'un temps de la musique, en pixels, sur la bande
  const beatPx = () => q(() => { const pr = Editor.probe(), tb = document.querySelector('#edTb'), tot = Shared.editShots.timeline(pr.shots, pr.unit).totalS; return (tb.clientWidth / tot) * pr.unit })
  const goClips = async () => { await q(() => go('clips')); await sleep(1500) }
  const closeEd = async () => { await q(() => document.querySelector('#edBack').click()); await sleep(900) }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const dragTo = async (from, to, { steps = 8, hold = false } = {}) => {
    await p.mouse.move(from[0], from[1]); await p.mouse.down()
    for (let i = 1; i <= steps; i++) { await p.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps); await sleep(25) }
    if (!hold) await p.mouse.up()
  }
  try {
    // ---------- 0. de vrais clips ----------
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 20000, 'simulateur prêt')
    await L('clipsSaveSettings', { before: 6, after: 2, merge: 3 })
    await simRunning(app, true)
    await until(async () => ((await L('clipsState')).bufferSeconds || 0) >= 10, 60000, 'tampon', 500)
    const waitClips = (n) => until(async () => { const l = await L('clipsList'); return l.length >= n ? l : null }, 60000, `${n} clip(s)`)
    let rk = 0
    await simPost(app, payload({ round: 1, phase: 'freezetime', ct: 1, t: 0 })); await simPost(app, payload({ round: 1, phase: 'live', ct: 1, t: 0 }))
    await simPost(app, payload({ round: 1, kills: 1, rk: 1, rhs: 1, ct: 1, t: 0 })); await waitClips(1)
    for (const r of [2, 3]) {
      await sleep(4500)
      await simPost(app, payload({ round: r, phase: 'freezetime', kills: r - 1, ct: r, t: 0 })); await simPost(app, payload({ round: r, phase: 'live', kills: r - 1, ct: r, t: 0 }))
      await simPost(app, payload({ round: r, kills: r, rk: 1, rhs: 0, ct: r, t: 0 })); await waitClips(r)
      rk = r
    }
    await sleep(4500)
    await app.evaluate(() => globalThis.pxClipsTest.saveNow())
    const clips = await waitClips(4)
    await simRunning(app, false)
    await until(async () => (await L('clipsState')).status === 'idle', 15000, 'capture arrêtée')
    console.log('clips :', clips.map((c) => `${c.kind} ${c.durationS}s`).join(', '))
    await q(() => { window.__ls = 0; document.addEventListener('loadstart', () => { window.__ls++ }, true) })

    // ---------- 1. ouverture ----------
    await goClips()
    check(await q(() => !!document.querySelector('.cm-go.cx-lnk') && !document.querySelector('.cm-go.is-draft')), 'page Clips : « Monter un film » (aucun brouillon encore)')
    await q(() => document.querySelector('.cm-go').click()); await waitEd()
    let pr = await probe()
    check(pr && pr.shots.length >= 3, `l’éditeur s’ouvre avec les plans des clips (${pr?.shots.length} plans)`)
    check(await q(() => !!document.querySelector('#edPlay') && !!document.querySelector('#edTime') && !document.querySelector('#edPlayAll')), '#edPlay et #edTime présents, #edPlayAll disparu')
    check(await q(() => document.querySelectorAll('.ed-pic video').length === 2 && /\/video\//.test(document.querySelector('.ed-pic video.is-front')?.src || '')), 'deux <video> superposées, celle de devant lit un clip')
    check(await q(() => document.querySelectorAll('#ed .btn.rose, #ed [class*="rose"]').length === 0 && !document.querySelector('#ed .btn.rose')), 'aucun .btn.rose dans l’éditeur')
    check(await q(() => /Ton montage est gardé tout seul\./.test(document.querySelector('#edSum').textContent) && /^\d+ plans?, \d\d:\d\d\./.test(document.querySelector('#edSum').textContent)), 'sous-titre « N plans, 00:24. Ton montage est gardé tout seul. »', await q(() => document.querySelector('#edSum').textContent))
    check(await q(() => !!document.querySelector('.ed-rule') && !!document.querySelector('.ed-ph') && document.querySelectorAll('.ed-shot .ed-g').length >= 2), 'règle du temps, tête de lecture et poignées présentes')

    // ---------- 2. la musique ----------
    await q(() => document.querySelector('#edMusicBtn').click())
    await until(() => q(() => !!Editor.probe()?.music), 30000, 'musique choisie')
    await sleep(600)
    pr = await probe()
    console.log('musique :', JSON.stringify(pr.music))
    check(pr.music && pr.music.bpm > 90 && pr.music.bpm < 110, 'musique choisie, tempo trouvé vers 100', pr.music)
    const grid0 = (await L('editMusicList'))[0].grid
    const bpm0 = pr.music.bpm

    // ---------- 3. lecture, espace ----------
    await q(() => { window.__ls = 0 })
    await q(() => document.querySelector('#edPlay').click())
    await sleep(2800)
    pr = await probe()
    const v1 = await q(() => document.querySelector('.ed-pic video.is-front')?.currentTime)
    check(pr.playing && pr.t > 1.2, `la lecture avance (temps ${pr.t.toFixed(2)} s, horloge ${pr.useAud ? 'musique' : 'page'})`)
    console.log('   horloge maître :', pr.useAud ? 'l’élément audio de la musique' : 'performance.now (la musique n’a pas démarré dans cet environnement)')
    check(await q(() => /^00:0\d,\d \/ \d\d:\d\d$/.test(document.querySelector('#edTime').textContent.trim())), 'le temps « 00:02,5 / 00:24 » s’affiche', await q(() => document.querySelector('#edTime').textContent))
    await sleep(500)
    const v2 = await q(() => document.querySelector('.ed-pic video.is-front')?.currentTime)
    check(v2 > 0 && v2 !== v1, `la vidéo joue (${v1?.toFixed(2)} → ${v2?.toFixed(2)})`)
    await p.keyboard.press('Space'); await sleep(400)
    const t1 = (await probe()).t; await sleep(700); const t2 = (await probe()).t
    check(!(await probe()).playing && Math.abs(t2 - t1) < 0.02 && (await q(() => document.querySelector('#edPlay').getAttribute('aria-label'))) === 'Lecture', 'espace met en pause (le temps ne bouge plus)')
    await p.keyboard.press('Space'); await sleep(1200)
    check((await probe()).playing && (await probe()).t > t2, 'espace relance la lecture')
    await p.keyboard.press('Space'); await sleep(300)
    // Espace avec un interrupteur au focus : lecture/pause, jamais le clic du bouton
    await q(() => document.querySelector('#edSlow').focus())
    const slow0 = await q(() => document.querySelector('#edSlow').getAttribute('aria-checked'))
    await p.keyboard.press('Space'); await sleep(500); await p.keyboard.press('Space'); await sleep(300)
    check((await q(() => document.querySelector('#edSlow').getAttribute('aria-checked'))) === slow0, 'espace sur un interrupteur ne le bascule pas')
    check(await q(() => !!document.querySelector('#edVolM') && document.activeElement?.id !== 'edVolM'), 'curseurs de volume présents')
    // La règle : un clic va à ce temps
    const rule = await box('#edRule'), tbb = await box('#edTb')
    await p.mouse.click(tbb.x + tbb.w * 0.5, rule.y + 12); await sleep(500)
    pr = await probe()
    check(Math.abs(pr.t - (await q(() => Shared.editShots.timeline(Editor.probe().shots, Editor.probe().unit).totalS)) * 0.5) < 0.6, `un clic sur la règle va à ce temps (${pr.t.toFixed(1)} s)`)

    // ---------- 4. la vidéo n’est pas rechargée par un réglage ----------
    await p.mouse.click((await box('.ed-shot[data-i="1"]')).x + 30, (await box('.ed-shot[data-i="1"]')).cy); await sleep(600)
    pr = await probe()
    check(pr.sel === 1, 'un clic sur un plan le choisit')
    check(Math.abs(pr.t - (await q(() => Shared.editShots.timeline(Editor.probe().shots, Editor.probe().unit).starts[1]))) < 0.05, 'et place la tête à son début')
    const src0 = await q(() => document.querySelector('.ed-pic video.is-front').src)
    await q(() => { window.__ls = 0 })
    const sh1 = pr.shots[1]
    await q(() => document.querySelector('#edS-lead-p').click()); await sleep(500)
    await q(() => document.querySelector('#edS-tail-m').click()); await sleep(500)
    pr = await probe()
    check(pr.shots[1].lead === sh1.lead + 1 && pr.shots[1].tail === sh1.tail - 1, 'les boutons + (Avant) et − (Après) changent d’un temps', { avant: sh1, apres: pr.shots[1] })
    check((await q(() => window.__ls)) === 0 && (await q(() => document.querySelector('.ed-pic video.is-front').src)) === src0, `un réglage ne recharge pas la vidéo (0 chargement, même src)`, await q(() => window.__ls))
    await q(() => document.querySelector('#edUndo').click()); await sleep(300); await q(() => document.querySelector('#edUndo').click()); await sleep(400)
    check(same((await probe()).shots[1], sh1) && !!(await probe()).music, 'annuler deux fois ramène le plan (et la musique reste)')
    MARK = (await probe()).undo

    // ---------- 5. tirer un bord : lead +1, une seule entrée d’annulation ----------
    pr = await probe()
    const bp = await beatPx()
    const s1 = pr.shots[1], undo0 = pr.undo
    let hr = await box('.ed-shot.is-sel .ed-g.r')
    await dragTo([hr.cx, hr.cy], [hr.cx - bp * 1.1, hr.cy], { hold: true }); await sleep(300)
    check(await q(() => !!document.querySelector('.ed-bub') && /Après le kill : \d+ temps/.test(document.querySelector('.ed-bub').textContent) && !!document.querySelector('.ed-was')), 'pendant le glisser : bulle « Après le kill : N temps » et pointillé', await q(() => document.querySelector('.ed-bub')?.textContent))
    await p.keyboard.press('Escape'); await sleep(400); await p.mouse.up(); await sleep(300)
    pr = await probe()
    check(await q(() => !!document.querySelector('#ed')) && same(pr.shots[1], s1) && pr.undo === undo0, 'Échap pendant un glisser annule le geste, l’éditeur reste ouvert')
    hr = await box('.ed-shot.is-sel .ed-g.r')
    await dragTo([hr.cx, hr.cy], [hr.cx - bp * 1.1, hr.cy]); await sleep(500)
    pr = await probe()
    check(pr.shots[1].tail === s1.tail - 1 && pr.shots[1].lead === s1.lead, 'tirer le bord droit d’un temps vers la gauche : « Après » −1', { avant: s1, apres: pr.shots[1] })
    check(pr.undo === undo0 + 1, 'une seule entrée d’annulation pour tout le glisser', { avant: undo0, apres: pr.undo })
    await undoLast()
    check(same((await probe()).shots[1], s1) && (await probe()).undo === undo0, 'un seul « Annuler » défait le glisser')
    // Le bord gauche : « Avant » +1 en tirant vers la gauche
    let hl = await box('.ed-shot.is-sel .ed-g.l')
    await dragTo([hl.cx, hl.cy], [hl.cx - bp * 1.1, hl.cy]); await sleep(500)
    pr = await probe()
    check(pr.shots[1].lead === s1.lead + 1 && pr.shots[1].tail === s1.tail && pr.undo === undo0 + 1, 'tirer le bord gauche : « Avant » +1, une entrée', { avant: s1, apres: pr.shots[1] })
    await undoLast()

    // ---------- 6. le repère du kill ----------
    pr = await probe()
    const s2 = pr.shots[1]
    let kb = await box('.ed-shot.is-sel .ed-k')
    await dragTo([kb.cx, kb.cy], [kb.cx + bp * 1.0, kb.cy], { hold: true }); await sleep(300)
    check(await q(() => /à \d+,\d s du clip/.test(document.querySelector('.ed-bub')?.textContent || '') && /L’image à/.test(document.querySelector('#edTag')?.textContent || '')), 'pendant le glisser du repère : bulle et image du clip', await q(() => [document.querySelector('.ed-bub')?.textContent, document.querySelector('#edTag')?.textContent]))
    await p.mouse.up(); await sleep(500)
    pr = await probe()
    const u = pr.unit
    check(Math.abs(pr.shots[1].anchorS - (s2.anchorS + u)) < 0.01 && pr.shots[1].lead === s2.lead + 1 && pr.shots[1].tail === s2.tail - 1, `le repère avance d’un temps : ancre ${s2.anchorS} → ${pr.shots[1].anchorS}`, { avant: s2, apres: pr.shots[1] })
    await undoLast()
    check(same((await probe()).shots[1], s2), 'annuler remet le repère')

    // ---------- 7. glisser un plan : l’ordre change ----------
    pr = await probe()
    const order0 = pr.shots.map((s) => s.clipId + '@' + s.anchorS)
    const b2 = await box('.ed-shot[data-i="2"]'), b0 = await box('.ed-shot[data-i="0"]')
    await dragTo([b2.x + 30, b2.cy], [b0.x + 14, b2.cy], { hold: true, steps: 12 }); await sleep(300)
    check(await q(() => !!document.querySelector('.ed-fly') && !!document.querySelector('.ed-ins') && /Plan 3, en place 1/.test(document.querySelector('.ed-bub')?.textContent || '')), 'pendant le glisser d’un plan : plan qui vole, trait, bulle « Plan 3, en place 1 »', await q(() => document.querySelector('.ed-bub')?.textContent))
    await p.mouse.up(); await sleep(500)
    pr = await probe()
    const order1 = pr.shots.map((s) => s.clipId + '@' + s.anchorS)
    check(order1[0] === order0[2] && order1[1] === order0[0] && order1[2] === order0[1], 'le plan 3 passe en tête : l’ordre est changé', { order0, order1 })
    check(pr.sel === 0, 'et il reste le plan choisi')
    await undoLast()
    check(same((await probe()).shots.map((s) => s.clipId + '@' + s.anchorS), order0), 'annuler remet l’ordre')
    // Un clic sans bouger ne déplace rien
    const b3 = await box('.ed-shot[data-i="3"]')
    await p.mouse.click(b3.x + 30, b3.cy); await sleep(400)
    check(same((await probe()).shots.map((s) => s.clipId + '@' + s.anchorS), order0) && (await probe()).sel === 3, 'un clic sans bouger choisit le plan sans le déplacer')

    // ---------- 8. « Ajouter » : plus de .btn.rose ----------
    await q(() => document.querySelector('#edAdd').click()); await sleep(900)
    const dlg = await q(() => { const d = document.querySelector('dialog.ed-add'); return d ? { rose: d.querySelectorAll('.btn.rose').length, ok: d.querySelector('#edAddOk')?.className } : null })
    check(dlg === null ? true : dlg.rose === 0 && dlg.ok === 'ed-pill', 'dialogue « Ajouter » : pastille de verre, aucun .btn.rose (ou « Tous tes clips sont déjà dans ce film »)', dlg)
    if (dlg) { await q(() => document.querySelector('#edAddNo').click()); await sleep(500) }

    // ---------- 9. corriger le tempo ----------
    await q(() => document.querySelector('.ed-shot[data-i="1"]').click())
    await p.mouse.click((await box('.ed-shot[data-i="1"]')).x + 30, (await box('.ed-shot[data-i="1"]')).cy); await sleep(400)
    await q(() => { const t = document.querySelector('[data-tab="mus"]'); if (t && t.offsetParent) t.click() })
    check(await q(() => /Corriger/.test(document.querySelector('#edTempoOpen')?.textContent || '') && /BPM/.test(document.querySelector('.ed-tempo')?.textContent || '')), 'section Musique : « 100 BPM · Corriger »', await q(() => document.querySelector('.ed-tempo')?.textContent))
    await q(() => document.querySelector('#edTempoOpen').click()); await sleep(500)
    check(await q(() => /Corriger le tempo/.test(document.querySelector('.ed-s-mus h2').textContent) && /Écouter les temps/.test(document.querySelector('.ed-s-mus').textContent) && /Décaler d’un demi-temps/.test(document.querySelector('.ed-s-mus').textContent) && !!document.querySelector('#edTfDiv') && !!document.querySelector('#edTfMul') && /Terminé/.test(document.querySelector('#edTempoEnd').textContent)), 'panneau « Corriger le tempo » : écouter, ÷2 / ×2, décaler, Terminé')
    check(await q(() => document.querySelectorAll('.ed-rule.is-beats i').length > 10), 'les temps sont dessinés sur la règle')
    const start0 = (await probe()).project.music.startS
    const shotsBefore = (await probe()).shots.map((s) => s.lead * 1 + s.tail * 1)
    const undoT0 = (await probe()).undo
    await q(() => document.querySelector('#edTfMul').click()); await sleep(900)
    let m1 = (await L('editMusicList'))[0]
    pr = await probe()
    check(m1.factor === 2 && Math.abs(m1.bpm - bpm0 * 2) < 0.01 && m1.grid.length >= grid0.length * 2 - 1 && pr.music.bpm === m1.bpm, `×2 : ${Math.round(bpm0)} → ${Math.round(m1.bpm)} BPM, grille doublée (${grid0.length} → ${m1.grid.length})`)
    check(pr.undo === undoT0 + 1, 'une entrée d’annulation par clic')
    check(Math.abs(pr.unit - 60 / m1.bpm) < 1e-9, 'le pas du film suit le nouveau tempo')
    await q(() => document.querySelector('#edTfDiv').click()); await sleep(900)
    const m2 = (await L('editMusicList'))[0]
    check(m2.factor === 1 && same(m2.grid, grid0) && m2.bpm === bpm0, '÷2 après ×2 : la grille est identique à celle d’origine', { n: m2.grid.length, n0: grid0.length })
    await q(() => document.querySelector('#edHalf').click()); await sleep(900)
    const m3 = (await L('editMusicList'))[0]
    check(m3.half === true && !same(m3.grid, grid0) && Math.abs(m3.grid[0] - (grid0[0] + (grid0[1] - grid0[0]) / 2)) < 1e-3, 'décaler d’un demi-temps : chaque temps avance d’un demi-temps')
    await q(() => document.querySelector('#edHalf').click()); await sleep(900)
    check(same((await L('editMusicList'))[0].grid, grid0), 'refaire le switch revient à la grille d’avant')
    check((await probe()).project.music.startS === start0, 'décalage on puis off : le début de la musique est identique', { avant: start0, apres: (await probe()).project.music.startS })
    await q(() => document.querySelector('#edHalf').click()); await sleep(900); await q(() => document.querySelector('#edHalf').click()); await sleep(900)
    check((await probe()).project.music.startS === start0, 'et après un second aller-retour (plus de dérive d’un temps)', (await probe()).project.music.startS)
    await q(() => document.querySelector('#edTfMul').click()); await sleep(900)
    await q(() => document.querySelector('#edUndo').click()); await sleep(1200)
    check((await L('editMusicList'))[0].factor === 1 && (await probe()).music.factor === 1, 'annuler un ×2 réapplique le tempo d’avant (côté processus principal aussi)')
    await q(() => document.querySelector('#edTfDiv').click()); await sleep(900)
    check(await q(() => document.querySelector('#edTfDiv').disabled === true && document.querySelector('#edTfMul').disabled === false), '÷2 appliqué : ÷2 grisé (le tempo tomberait sous 40 ou le facteur est au bout), ×2 permis')
    await q(() => document.querySelector('#edTfMul').click()); await sleep(900)
    check(same((await L('editMusicList'))[0].grid, grid0), 'retour à 1 : grille d’origine')
    check((await probe()).project.music.startS === start0, '÷2 puis retour à 1 : le début de la musique est identique', { avant: start0, apres: (await probe()).project.music.startS })
    // « Écouter les temps » : le switch lance la lecture, les points s’allument
    await q(() => document.querySelector('#edClick').click()); await sleep(1800)
    check(await q(() => document.querySelector('#edClick').getAttribute('aria-checked') === 'true' && Editor.probe().playing && !!document.querySelector('.ed-dots i.on')), 'écouter les temps : lecture lancée, un point de la mesure allumé', await q(() => Editor.probe().playing))
    await q(() => document.querySelector('#edPlay').click()); await sleep(300)

    // ---------- 10. captures (1600 × 940 et 1280 × 720) ----------
    await p.mouse.click((await box('.ed-shot[data-i="2"]')).x + 30, (await box('.ed-shot[data-i="2"]')).cy); await sleep(500)
    await q(() => document.querySelector('#edTempoEnd')?.click()); await sleep(400)
    await q(() => { const s = document.querySelector('#edSlow'); if (s.getAttribute('aria-checked') !== 'true') s.click() }); await sleep(500)
    const tl = await q(() => { const pr = Editor.probe(); return Shared.editShots.timeline(pr.shots, pr.unit) })
    const ruleB = await box('#edRule'), tbB = await box('#edTb')
    await p.mouse.click(tbB.x + tbB.w * ((tl.starts[2] + 3.2) / tl.totalS), ruleB.y + 12); await sleep(900)
    await both('lecture')
    // Les gestes figés, avec la souris tenue
    await p.mouse.click((await box('.ed-shot[data-i="1"]')).x + 30, (await box('.ed-shot[data-i="1"]')).cy); await sleep(400)
    const bp2 = await beatPx()
    hr = await box('.ed-shot.is-sel .ed-g.r')
    await dragTo([hr.cx, hr.cy], [hr.cx - bp2 * 1.1, hr.cy], { hold: true }); await sleep(400)
    await shot('bord-1600')
    await p.keyboard.press('Escape'); await p.mouse.up(); await sleep(400)
    kb = await box('.ed-shot.is-sel .ed-k')
    await dragTo([kb.cx, kb.cy], [kb.cx + bp2 * 1.2, kb.cy], { hold: true }); await sleep(400)
    await shot('repere-1600')
    await p.keyboard.press('Escape'); await p.mouse.up(); await sleep(400)
    const c2 = await box('.ed-shot[data-i="2"]'), c0 = await box('.ed-shot[data-i="0"]')
    await dragTo([c2.x + 30, c2.cy], [c0.x + 14, c2.cy], { hold: true, steps: 12 }); await sleep(400)
    await shot('ordre-1600')
    await p.keyboard.press('Escape'); await p.mouse.up(); await sleep(400)
    check(await q(() => !!document.querySelector('#ed')), 'Échap pendant les glissers : l’éditeur reste ouvert')
    await q(() => document.querySelector('[data-tab="mus"]')?.click())
    await q(() => document.querySelector('#edTempoOpen')?.click()); await sleep(500)
    await both('tempo')
    await q(() => document.querySelector('#edTempoEnd')?.click()); await sleep(300)
    await size(1280, 720); await sleep(900)
    check(await q(() => getComputedStyle(document.querySelector('.ed-tabs')).display === 'flex'), '1280 × 720 : la colonne de droite passe en deux onglets Plan / Musique')
    check(await q(() => { const b = document.querySelector('#ed').getBoundingClientRect(), w = innerWidth, h = innerHeight; return [...document.querySelectorAll('#ed .ed-head, #ed .ed-body, #ed .ed-tl, #ed .ed-tr')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= w && r.top >= 0 && r.bottom <= h }) }), '1280 × 720 : tout tient dans la fenêtre')
    await q(() => document.querySelector('[data-tab="plan"]')?.click()); await sleep(400)
    await shot('petit-1280')
    await size(1600, 940); await sleep(900)
    check(await q(() => { const r = document.querySelector('#ed .ed-tl').getBoundingClientRect(); return r.bottom <= innerHeight - 90 }), '1600 × 940 : la bande est au-dessus de la barre du bas')

    // ---------- 11. brouillon : fermeture, réouverture ----------
    const keep = await probe()
    const keepOrder = keep.shots.map((s) => `${s.clipId}:${s.anchorS}:${s.lead}:${s.tail}:${s.slow}`)
    await closeEd()
    let dl = await drafts()
    check(dl.length === 1 && dl[0].groupKey && dl[0].project.shots.length === keep.shots.length && dl[0].musicId === keep.project.music.id && dl[0].unit > 0, 'fermer l’éditeur garde le brouillon (pxv3-ed-drafts : clé, groupe, plans, musique, pas)', dl.map((d) => Object.keys(d)))
    check(await q(() => { const b = document.querySelector('.cm-go.cx-lnk.is-draft'); return !!b && /^Reprendre le montage/.test(b.textContent) && /plans?, \d\d:\d\d/.test(b.textContent) }), 'page Clips : « Reprendre le montage · N plans, 00:24 » à la place de « Monter un film »', await q(() => document.querySelector('.cm-go')?.textContent))
    await shot('clips-1600')
    await q(() => document.querySelector('.cm-go.is-draft').click()); await waitEd()
    let re = await probe()
    check(same(re.shots.map((s) => `${s.clipId}:${s.anchorS}:${s.lead}:${s.tail}:${s.slow}`), keepOrder) && re.sel === keep.sel && re.music?.id === keep.music.id, 'Reprendre le montage : mêmes plans, même choix, même musique', { n: re.shots.length })
    check(!re.warn, 'aucun bandeau quand rien n’a changé')
    // Un changement, puis fermeture à froid (anti-rebond de 400 ms) : gardé aussi
    await q(() => document.querySelector('#edS-lead-p')?.click()); await sleep(600)
    const afterEdit = (await probe()).shots
    await closeEd()

    // ---------- 12. brouillon après relance de l’appli ----------
    await app.close().catch(() => {}); try { proc.kill('SIGKILL') } catch {}
    await sleep(1500)
    ;({ app, p, errs, proc } = await boot())
    await goClips()
    check(await q(() => !!document.querySelector('.cm-go.cx-lnk.is-draft')), 'après relance de l’appli : « Reprendre le montage » est toujours là')
    await q(() => document.querySelector('.cm-go.is-draft').click()); await waitEd()
    re = await probe()
    check(same(re.shots.map((s) => `${s.clipId}:${s.anchorS}:${s.lead}:${s.tail}`), afterEdit.map((s) => `${s.clipId}:${s.anchorS}:${s.lead}:${s.tail}`)) && !!re.music && !re.lost, 'après relance : les plans retouchés et la musique sont retrouvés', { n: re.shots.length })
    await closeEd()

    // ---------- 13. un clip supprimé, une musique introuvable ----------
    const victim = afterEdit[1].clipId
    await L('clipsDelete', victim); await sleep(1500)
    await goClips()
    await q(() => document.querySelector('.cm-go.is-draft').click()); await waitEd()
    re = await probe()
    check(await q(() => !!document.querySelector('.ed-warn') && /un clip a été supprimé/.test(document.querySelector('.ed-warn').textContent)), 'bandeau « un clip a été supprimé » à la réouverture', await q(() => document.querySelector('.ed-warn')?.textContent))
    check(await q(() => { const g = document.querySelector('.ed-shot.is-gone'); return !!g && /Clip supprimé/.test(g.textContent) && getComputedStyle(g).backgroundImage.includes('gradient') }), 'le plan du clip supprimé reste dans la bande, hachuré « Clip supprimé »')
    check(await q(() => document.querySelector('#edMake').getAttribute('aria-disabled') === 'true'), '« Fabriquer le film » est grisé')
    await q(() => document.querySelector('#edMake').click()); await sleep(500)
    check(await q(() => /Retire d’abord/.test(document.querySelector('#toasts')?.textContent || '')), 'et dit pourquoi quand on clique')
    await p.mouse.click((await box('.ed-shot.is-gone')).x + 30, (await box('.ed-shot.is-gone')).cy); await sleep(500)
    check(await q(() => /Le clip de ce plan a été supprimé de ton dossier/.test(document.querySelector('.ed-s-plan').textContent) && !!document.querySelector('#edDel') && !document.querySelector('#edS-lead-m')), 'panneau Plan d’un clip supprimé : texte et « Retirer ce plan »')
    check(await q(() => { const pic = document.querySelector('#edPic'); return pic.classList.contains('is-gone') && /Ce clip a été supprimé/.test(pic.textContent) }), 'l’aperçu dit « Ce clip a été supprimé »')
    // La musique : le fichier est déplacé
    await closeEd()
    fs.renameSync(musicFile, musicFile + '.parti')
    await q(() => document.querySelector('.cm-go.is-draft').click()); await waitEd()
    check(await q(() => !!document.querySelector('.ed-music.is-lost') && /introuvable/.test(document.querySelector('.ed-music.is-lost').textContent) && !!document.querySelector('#edFind') && !!document.querySelector('#edNoMus')), 'musique déplacée : « introuvable », « Retrouver le fichier », « Continuer sans musique »')
    check(await q(() => /la musique n’est plus à sa place/.test(document.querySelector('.ed-warn')?.textContent || '')), 'le bandeau le dit aussi', await q(() => document.querySelector('.ed-warn')?.textContent))
    await both('retour')
    // Retrouver le fichier : il revient, la musique est reprise (le sélecteur est l’essai PX_MUSIC_PICK)
    fs.renameSync(musicFile + '.parti', musicFile)
    await q(() => document.querySelector('#edFind').click()); await sleep(2500)
    re = await probe()
    check(!re.lost && !!re.music, 'Retrouver le fichier : la musique revient')
    // « Continuer sans musique »
    fs.renameSync(musicFile, musicFile + '.parti')
    await closeEd(); await q(() => document.querySelector('.cm-go.is-draft').click()); await waitEd()
    await q(() => document.querySelector('#edNoMus').click()); await sleep(600)
    re = await probe()
    check(!re.lost && !re.music && re.project.music === null && re.project.gameVolume === 1, '« Continuer sans musique » : plus de musique, plus d’alerte')
    // On retire le plan vide : « Fabriquer » se dégrise
    await p.mouse.click((await box('.ed-shot.is-gone')).x + 30, (await box('.ed-shot.is-gone')).cy); await sleep(400)
    await q(() => document.querySelector('#edDel').click()); await sleep(600)
    check(await q(() => document.querySelector('#edMake').getAttribute('aria-disabled') === 'false' && !document.querySelector('.ed-shot.is-gone')), 'plan vide retiré : « Fabriquer le film » est permis')

    // ---------- 14. fabriquer : le brouillon s’efface quand le film est prêt ----------
    fs.renameSync(musicFile + '.parti', musicFile)
    await q(() => document.querySelector('#edMake').click())
    await until(() => q(() => !document.querySelector('#ed')), 20000, 'éditeur fermé après « Fabriquer »')
    dl = await drafts()
    console.log('   brouillon pendant la fabrication :', dl.length, dl[0]?.making ? '(marqué en fabrication)' : '')
    const done = await until(async () => { const s = await L('editFilmState'); return s.status === 'done' || s.status === 'failed' ? s : null }, 240000, 'film prêt', 1000)
    check(done.status === 'done', `le film est fabriqué (${done.shots} plans, ${done.durationS} s)`, done)
    await sleep(1500)
    dl = await drafts()
    check(dl.length === 0, 'le film prêt efface le brouillon', dl.map((d) => d.key))
    await goClips()
    check(await q(() => !document.querySelector('.cm-go.is-draft')), '« Monter un film » est revenu sur le groupe')
    await shot('clips-apres-film')
    check(errs.length === 0, 'aucune erreur dans la page', errs.slice(0, 3))
  } catch (e) {
    fail++
    console.log('ÉCHEC', e)
    try { await p.screenshot({ path: path.join(SHOTS, 'ed-echec.png') }) } catch {}
  } finally {
    console.log(`\n${pass} OK, ${fail} NON`)
    await Promise.race([app.close(), sleep(10000)]).catch(() => {})
    try { proc.kill('SIGKILL') } catch {}
    process.exitCode = fail ? 1 : 0
  }
})()
