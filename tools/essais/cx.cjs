// Essai 0.6.2 : la page Clips refaite (Viseur par défaut, Régie en option), dans la vraie fenêtre en mode démo.
// Rien n'est inventé dans l'appli : l'essai pose lui-même, dans la page, des clips d'exemple (vignettes dessinées sur un canvas, aucune vidéo)
// et des jaquettes dessinées, pour voir la page pleine. Captures : tools/essais/shots/cx-*.png (1600 × 940 et 1280 × 720).
// Un profil neuf à chaque passage (le réglage « Style de la page Clips » doit partir de sa valeur par défaut) : SUF=<x> pour le garder.
process.env.SUF = process.env.SUF || '-' + Date.now().toString(36)
const { start, shot, settle, OUT } = require('./h.cjs')
// Chaque capture vient de ce passage : on efface les anciennes
const fs = require('fs')
fs.mkdirSync(OUT, { recursive: true })
fs.readdirSync(OUT).filter((f) => /^cx-.*\.png$/.test(f)).forEach((f) => fs.unlinkSync(require('path').join(OUT, f)))
const ok = (c, m) => console.log(c ? 'OK' : 'NON', m)
let fails = 0
const check = (c, m, diag) => { if (!c) fails++; ok(c, m); if (!c && diag) console.log('   détail :', JSON.stringify(diag)) }

// Dans la page : des jaquettes, des clips d'exemple (3 parties + un film), un jeu qui tourne
const PREP = () => {
  const draw = (w, h, a, b, txt) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(255,255,255,.16)'; for (let i = 0; i < 9; i++) x.fillRect((i * 97) % w, (i * 53) % h, w / 3, 6); x.fillStyle = 'rgba(255,255,255,.55)'; x.font = `700 ${Math.round(h / 7)}px sans-serif`; x.fillText(txt, w * .08, h * .86); return c.toDataURL('image/jpeg', .8) }
  const pals = [['#7a5a2e', '#1d1a22'], ['#1c4a6e', '#101826'], ['#6a1b2b', '#1a0d12'], ['#2d5b3a', '#0e1812'], ['#5b3a7a', '#15101c'], ['#7a6a2e', '#201a10']]
  GAMES.filter((g) => g.installed && !g.hidden).slice(0, 6).forEach((g, i) => { const u = draw(300, 450, pals[i][0], pals[i][1], g.name.slice(0, 6)); g.cover = u; if (g.raw) g.raw.coverUrl = u; if (i === 3) g.heroWide = draw(1280, 720, '#9a7a4a', '#2a1e14', g.name) })
  const cs = GAMES.find((g) => g.id === 'cs2'), bf = GAMES.find((g) => g.id === 'bf6')
  const now = Date.now(), H = 3600e3
  let n = 0
  const clip = (g, title, s, at, x = {}) => ({ id: 'c' + (++n), gameId: g.rid, gameName: g.name, kind: x.kind || 'kill', title, kills: x.kills ?? 1, headshots: 0, at, durationS: x.d || 25, sizeBytes: 63e6, width: 1920, height: 1080, pinned: !!x.pin, sessionId: s, round: x.round, map: x.map, mode: x.map ? 'competitive' : undefined, score: x.score, videoUrl: 'pxclip://video/x' + n, thumbUrl: draw(640, 360, pals[n % 6][0], pals[n % 6][1], title.slice(0, 14)), ...x.more })
  window.__cx = { cs, bf, now, H, clip }
  window.__fake = () => [
    clip(cs, 'Triple à l’AK-47', 's-mir', now - 2 * H, { round: 14, kills: 3, map: 'de_mirage', score: { us: 13, them: 9 }, pin: true }),
    clip(cs, 'ACE', 's-mir', now - 2 * H - 60e3, { round: 17, kills: 5, map: 'de_mirage', score: { us: 13, them: 9 }, pin: true }),
    clip(cs, 'Kill au Desert Eagle', 's-mir', now - 2 * H - 120e3, { round: 3, map: 'de_mirage', score: { us: 13, them: 9 } }),
    clip(cs, 'Doublé à l’AWP', 's-mir', now - 2 * H - 180e3, { round: 9, kills: 2, map: 'de_mirage', score: { us: 13, them: 9 } }),
    clip(cs, 'Film du match', 's-mir', now - 2 * H + 600e3, { kind: 'film', kills: 0, d: 96 }),
    clip(bf, '21 h 42', 's-bf', now - 20 * H, { kind: 'manual', kills: 0 }), clip(bf, '21 h 17', 's-bf', now - 20 * H - 600e3, { kind: 'manual', kills: 0 }),
    clip(cs, 'Triple à la M4A4', 's-inf', now - 72 * H, { round: 8, kills: 3, map: 'de_inferno', score: { us: 9, them: 13 } }),
    clip(cs, 'Film seul', 'film-zz', now - 80 * H, { kind: 'film', kills: 0, d: 60 })
  ]
}
const SET = async (p, { clips, cfg, live, session, style, cs2Live } = {}) => {
  await p.evaluate(async ({ clips, cfg, live, session, style, cs2Live }) => {
    if (!window.__cx) (0, eval)('(' + window.__PREP + ')()')
    if (clips !== undefined) CLIPS = clips ? window.__fake() : []
    if (cfg) Real.clipsCfg = { ...Real.clipsCfg, ...cfg }
    if (live !== undefined) Real.clipsLive = live
    S.session = session ? { game: 'cs2', phase: 'game', since: Date.now() - 600e3 } : null
    if (style) Clips.setStyle(style)
    if (cs2Live !== undefined) Real.st.settings = { ...Real.st.settings, cs2Live }
    Real.emit('games')
    if (S.view !== 'clips') go('clips')
  }, { clips, cfg, live, session, style, cs2Live })
  await settle(p, 900)
}


const q = (p, f, ...a) => p.evaluate(f, ...a)
;(async () => {
  const { app, p, errs } = await start({ name: 'cx' })
  const size = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h])
  const wait = (ms = 400) => p.waitForTimeout(ms)
  try {
    await p.evaluate((src) => { window.__PREP = src }, PREP.toString())
    await p.evaluate(() => (0, eval)('(' + window.__PREP + ')()'))
    const shots = async (tag) => { await size(1600, 940); await settle(p, 700); await shot(p, `cx-${tag}-1600`); await size(1280, 720); await settle(p, 700); await shot(p, `cx-${tag}-1280`); await size(1600, 940); await settle(p, 500) }
    const inWin = async (sel) => q(p, (sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }, sel)

    // ---- 1. Réglage par défaut, état de départ
    check(await q(p, () => Clips.style() === 'b'), 'Viseur par défaut (Clips.style())')
    await SET(p, { clips: false, cfg: { enabled: true }, live: { status: 'idle' } })
    check(await q(p, () => !!document.querySelector('#cxRoot.cx-b.cx-full')), 'sans clip : le viseur prend toute la page')
    check(await q(p, () => !document.querySelector('#clPlay, #gbPlay, .rx, #rx, #clStore, .pg-head')), 'aucun #clPlay, #gbPlay, .rx, #clStore ni en-tête « Clips » sur la page')
    check(await q(p, () => document.querySelectorAll('video').length === 0), 'aucune <video> à l’ouverture de la page')
    check(await q(p, () => /Caméra prête/.test(document.querySelector('.cx-tt').textContent) && /Elle démarre toute seule avec ton jeu\./.test(document.querySelector('.cx-lead').textContent)), 'titre « Caméra prête » et sa phrase')
    check(await q(p, () => document.querySelectorAll('.cx-deck .cx-tile').length === 4 && !!document.querySelector('.cx-side .sw')), 'quatre grandes touches et la liste Son du PC / Micro')
    check(await q(p, () => !!document.querySelector('.cx-tt .sw[role=switch][aria-label="Caméra"]')), 'l’interrupteur est un switch nommé « Caméra »')
    check(await q(p, () => document.querySelectorAll('.cx-wall > div').length === 10 && document.querySelectorAll('.cx-wall img').length > 0), 'le mur de jaquettes est là (10 colonnes ; une image qui ne charge pas, hors ligne, s’enlève)')
    check(await q(p, () => [...document.querySelectorAll('.cx-wall img')].every((i) => i.loading === 'lazy' && i.decoding === 'async')), 'jaquettes du mur en lazy + async')
    // Moins de 4 vraies jaquettes : pas de mur
    await q(p, () => { window.__covers = GAMES.map((g) => g.cover); GAMES.forEach((g, i) => { if (i > 1) g.cover = 'data:image/svg+xml;charset=utf8,x' }); Real.emit('games') }); await settle(p, 500)
    check(await q(p, () => !document.querySelector('.cx-wall') && !!document.querySelector('.cx-pic.cx-plain')), 'moins de 4 vraies jaquettes : pas de mur, écran uni avec la lueur')
    await shots('b-vide-sans-mur')
    await q(p, () => { GAMES.forEach((g, i) => { g.cover = window.__covers[i] }); Real.emit('games') }); await settle(p, 400)
    await shots('b-vide')

    // ---- 2. Interrupteur : la caméra se coupe, la barre du bas suit, et revient
    await p.click('.cx-tt .sw'); await wait(900)
    check(await q(p, () => Real.clipsCfg.enabled === false && document.querySelector('#bRec').getAttribute('aria-pressed') === 'false' && /Caméra coupée/.test(document.querySelector('.cx-tt').textContent)), 'l’interrupteur coupe la caméra, la barre du bas suit, le titre change')
    check(await q(p, () => !!document.querySelector('.cx-deck.cx-inert[inert]')), 'coupé : les réglages sont estompés et inertes')
    await shots('b-vide-coupe')
    await p.click('.cx-tt .sw'); await wait(900)
    check(await q(p, () => Real.clipsCfg.enabled === true && document.querySelector('#bRec').getAttribute('aria-pressed') === 'true' && /Caméra prête/.test(document.querySelector('.cx-tt').textContent)), 'l’interrupteur rallume la caméra, la barre du bas suit')
    // La barre du bas coupe, la page suit (sur place)
    await p.click('#bRec'); await wait(900)
    check(await q(p, () => Real.clipsCfg.enabled === false && /Caméra coupée/.test(document.querySelector('.cx-tt').textContent) && document.querySelector('.cx-tt .sw').getAttribute('aria-checked') === 'false'), 'la barre du bas coupe : la page suit')
    await p.click('#bRec'); await wait(900)
    check(await q(p, () => Real.clipsCfg.enabled === true && document.querySelector('.cx-tt .sw').getAttribute('aria-checked') === 'true'), 'la barre du bas rallume : la page suit')

    // ---- 3. Bulles du Viseur sans clip : ouvrir, focus dedans, Échap ferme et rend le focus, une seule à la fois
    for (const id of ['dur', 'qual', 'trig', 'more']) {
      await p.click(`[data-pop="${id}"]`); await wait(250)
      const st = await q(p, (id) => ({ ex: document.querySelector(`[data-pop="${id}"]`).getAttribute('aria-expanded'), pops: document.querySelectorAll('.cx-pop').length, foc: !!document.activeElement.closest('.cx-pop'), inView: true }), id)
      check(st.ex === 'true' && st.pops === 1 && st.foc, `bulle « ${id} » : ouverte (aria-expanded), seule, le focus entre dedans`)
      check(await inWin('.cx-pop'), `bulle « ${id} » : tient dans la fenêtre`)
      if (id === 'dur') await shot(p, 'cx-b-vide-pop-dur')
      if (id === 'trig') await shot(p, 'cx-b-vide-pop-trig')
      await p.keyboard.press('Escape'); await wait(250)
      const af = await q(p, (id) => ({ ex: document.querySelector(`[data-pop="${id}"]`).getAttribute('aria-expanded'), pops: document.querySelectorAll('.cx-pop').length, foc: document.activeElement === document.querySelector(`[data-pop="${id}"]`), view: S.view, modal: !!document.querySelector('[data-modal]:not([hidden])') }), id)
      check(af.ex === 'false' && af.pops === 0 && af.foc && af.view === 'clips' && !af.modal, `bulle « ${id} » : Échap la ferme, rend le focus au bouton, ne quitte pas la page`)
    }
    await p.click('[data-pop="dur"]'); await wait(200); await p.click('[data-pop="qual"]'); await wait(200)
    check(await q(p, () => document.querySelectorAll('.cx-pop').length === 1 && document.querySelector('.cx-pop').dataset.popFor === 'qual'), 'une seule bulle ouverte : ouvrir « qual » ferme « dur »')
    await p.mouse.click(700, 300); await wait(250)
    check(await q(p, () => document.querySelectorAll('.cx-pop').length === 0 && document.querySelector('[data-pop=qual]').getAttribute('aria-expanded') === 'false' && document.activeElement === document.querySelector('[data-pop=qual]')), 'clic dehors : la bulle se ferme et le focus revient au bouton')
    // Tab circule dans la bulle
    await p.click('[data-pop="trig"]'); await wait(200)
    const f1 = await q(p, () => document.activeElement.dataset.fk); await p.keyboard.press('Tab'); const f2 = await q(p, () => document.activeElement.dataset.fk)
    check(f1 && f2 && f1 !== f2, `Tab circule dans la bulle (${f1} puis ${f2})`)
    await p.keyboard.press('Escape'); await wait(200)

    // ---- 4. Un curseur de durée : le texte change, la valeur est enregistrée ; les Paramètres montrent la même chose
    await p.click('[data-pop="dur"]'); await wait(250)
    const b0 = await q(p, () => Real.clipsCfg.before)
    await p.focus('.cx-pop input[data-r=before]'); for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowRight'); await wait(250) }
    const t1 = await q(p, () => ({ v: document.querySelector('.cx-pop [data-val=before]').textContent, cfg: Real.clipsCfg.before, tile: document.querySelector('[data-pop=dur] .val').textContent, res: document.querySelector('.cx-pop [data-res]').textContent, foc: document.activeElement?.dataset?.fk, open: !!document.querySelector('.cx-pop') }))
    check(t1.cfg === b0 + 3 && t1.v === `${b0 + 3} s` && t1.tile === `${b0 + 3 + 5} s` && /par clip, environ \d+ Mo/.test(t1.res), `curseur « Avant » : ${t1.v}, tuile ${t1.tile}, valeur enregistrée ${t1.cfg}, ${t1.res}`)
    check(t1.foc === 'r-before' && t1.open, 'après l’enregistrement, la bulle reste ouverte et le focus reste sur le curseur')
    await shot(p, 'cx-b-vide-pop-dur-23')
    await p.keyboard.press('Escape'); await wait(200)
    await q(p, () => Settings.open('rec')); await wait(900)
    check(await q(p, (b) => document.querySelector('#rBefore').value === String(b), b0 + 3), 'Paramètres > Enregistrement : le curseur « Avant » montre la même valeur')
    // Style de la page Clips : dans les Paramètres, avec la recherche
    check(await q(p, () => !!document.querySelector('#r-cstyle .seg') && Settings.index().some((x) => x[1] === 'r-cstyle')), 'Paramètres : la ligne « Style de la page Clips » existe et est dans la recherche')
    // Qualité changée dans les Paramètres : la page la montre
    await p.click('#r-qual [data-q="high"]'); await wait(700)
    await q(p, () => Settings.close()); await wait(700)
    check(await q(p, () => /Haute/.test(document.querySelector('[data-pop=qual] .val').textContent) && Real.clipsCfg.quality === 'high'), 'qualité changée dans Paramètres : la page la montre')
    // Qualité changée sur la page : les Paramètres la montrent
    await p.click('[data-pop="qual"]'); await wait(250)
    await p.keyboard.press('ArrowLeft'); await wait(500)
    check(await q(p, () => Real.clipsCfg.quality === 'balanced' && !!document.querySelector('.cx-pop .cx-seg [aria-checked=true][data-q=balanced]')), 'flèche gauche sur le contrôle de qualité : Équilibrée, la bulle reste ouverte', await q(p, () => ({ q: Real.clipsCfg.quality, pop: !!document.querySelector('.cx-pop'), foc: document.activeElement?.outerHTML?.slice(0, 120), checked: [...document.querySelectorAll('.cx-seg [aria-checked=true]')].map((b) => b.dataset.q) })))
    await shot(p, 'cx-b-vide-pop-qual')
    await p.keyboard.press('Escape'); await wait(200)
    await q(p, () => Settings.open('rec')); await wait(900)
    check(await q(p, () => document.querySelector('#r-qual [aria-checked=true]').dataset.q === 'balanced'), 'qualité changée sur la page : Paramètres la montre')
    // Le style de la page : Régie, puis retour
    await p.click('#r-cstyle [data-v="a"]'); await wait(500)
    check(await q(p, () => Clips.style() === 'a' && localStorage.getItem('pxv3-clips-style') === 'a'), 'réglage « Style de la page Clips » : Régie enregistré')
    await q(p, () => Settings.close()); await settle(p, 700)
    check(await q(p, () => !!document.querySelector('#cxRoot.cx-a') && !!document.querySelector('.cx-con') && getComputedStyle(document.querySelector('.cx-con')).width.startsWith('384')), 'la page est en Régie (régie de 384 px)')
    await q(p, () => Settings.open('rec')); await wait(900)
    await p.click('#r-cstyle [data-v="b"]'); await wait(500)
    await q(p, () => Settings.close()); await settle(p, 700)
    check(await q(p, () => Clips.style() === 'b' && !!document.querySelector('#cxRoot.cx-b')), 'retour au Viseur')
    // Une autre valeur que a ou b = b
    // La page lit le réglage au chargement : on pose une valeur inconnue, on recharge, et on regarde ce que la page dessine vraiment
    await q(p, () => { localStorage.setItem('pxv3-clips-style', 'zzz') })
    await p.reload(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(9000)
    await p.evaluate((src) => { window.__PREP = src }, PREP.toString())
    await SET(p, { clips: false, cfg: { enabled: true }, live: { status: 'idle' } })
    check(await q(p, () => localStorage.getItem('pxv3-clips-style') === 'zzz' && Clips.style() === 'b' && !!document.querySelector('#cxRoot.cx-b') && !document.querySelector('#cxRoot.cx-a')), 'valeur inconnue (zzz) dans localStorage, après rechargement : la page dessine le Viseur et Clips.style() rend « b »', await q(p, () => ({ ls: localStorage.getItem('pxv3-clips-style'), st: Clips.style(), root: document.querySelector('#cxRoot')?.className })))
    await q(p, () => { localStorage.setItem('pxv3-clips-style', 'b') })

    // ---- 5. Le raccourci se change sur place, depuis la page
    await p.click('.cx-tile-k .kc'); await wait(250)
    check(await q(p, () => !!document.querySelector('.cx-tile-k .kc.wait')), 'clic sur la touche Raccourci : la capture est en attente, sur place')
    await p.keyboard.press('Alt+KeyV'); await wait(900)
    const hk = await q(p, () => ({ hk: Real.clipsCfg.hotkey, txt: document.querySelector('.cx-tile-k .kc')?.textContent, wait: !!document.querySelector('.kc.wait') }))
    check(/Alt\+V/i.test(hk.hk) && !hk.wait, `raccourci changé sur place : ${hk.hk} (${hk.txt})`)
    await p.click('.cx-tile-k .kc'); await wait(250); await p.keyboard.press('Escape'); await wait(250)
    check(await q(p, () => !document.querySelector('.kc.wait') && S.view === 'clips'), 'Échap annule la capture du raccourci sans quitter la page')
    await p.click('.cx-tile-k .kc'); await wait(250); await p.keyboard.press('Alt+KeyC'); await wait(900)
    check(await q(p, () => /Alt\+C/i.test(Real.clipsCfg.hotkey)), 'raccourci remis sur Alt + C')

    // ---- 6. La page suit l’enregistrement d’où qu’il change, sans fermer la bulle ni voler le focus
    await p.click('[data-pop="more"]'); await wait(250)
    await q(p, () => Real.saveClips({ mic: true })); await wait(700)
    check(await q(p, () => document.querySelectorAll('.cx-pop').length === 1 && document.querySelector('.cx-side [data-sw=mic]').getAttribute('aria-checked') === 'true' && !!document.activeElement.closest('.cx-pop')), 'un changement venu d’ailleurs : la bulle reste ouverte, le focus reste dedans, la page est à jour', await q(p, () => ({ pops: document.querySelectorAll('.cx-pop').length, mic: document.querySelector('.cx-side [data-sw=mic]')?.getAttribute('aria-checked'), foc: document.activeElement?.outerHTML?.slice(0, 100), cfgmic: Real.clipsCfg.mic })))
    await q(p, () => Real.saveClips({ mic: false })); await wait(500)
    await p.keyboard.press('Escape'); await wait(200)
    // Glisser un curseur pendant qu’un changement arrive d’ailleurs : l’élément ne bouge pas
    await p.click('[data-pop="dur"]'); await wait(250)
    const box = await p.locator('.cx-pop input[data-r=after]').boundingBox()
    await p.mouse.move(box.x + 20, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 5 })
    await q(p, () => { window.__inp = document.querySelector('.cx-pop input[data-r=after]'); Real.saveClips({ mic: true }) }); await wait(700)
    const same = await q(p, () => window.__inp === document.querySelector('.cx-pop input[data-r=after]') && window.__inp.isConnected)
    await p.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 4 }); await p.mouse.up(); await wait(700)
    const aft = await q(p, () => Real.clipsCfg.after)
    check(same && aft > 5, `un curseur en cours de glissement n’est pas cassé par un changement venu d’ailleurs (Après = ${aft} s)`)
    await q(p, () => Real.saveClips({ mic: false, after: 5, before: 20 })); await wait(500)
    await p.keyboard.press('Escape'); await wait(200)

    // ---- 7. Avec des clips : le bandeau, la liste, les filtres, les films
    await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'idle' } }); await p.mouse.move(800, 20)
    check(await q(p, () => !!document.querySelector('#cxRoot.cx-b:not(.cx-full) .cx-band') && document.querySelector('.cx-band').getBoundingClientRect().height < 340), 'avec des clips : un bandeau viseur de ~320 px en haut')
    check(await q(p, () => /Dernier clip, /.test(document.querySelector('.cx-kick').textContent) && document.querySelector('.cx-title').textContent === 'Triple à l’AK-47'), '« Dernier clip, … » et le titre du dernier clip (pas un film)')
    check(await q(p, () => !!document.querySelector('.cx-band .ht-acts .play-btn') && !!document.querySelector('.cx-band .ht-acts .dk-b') && document.querySelectorAll('video').length === 0), '« Regarder » et « Copier pour Discord » dans .ht-acts ; aucune vidéo qui joue', await q(p, () => ({ w: !!document.querySelector('.cx-band .ht-acts .play-btn'), c: !!document.querySelector('.cx-band .ht-acts .dk-b'), v: [...document.querySelectorAll('video')].map((v) => v.className + ':' + v.closest('[id]')?.id) })))
    check(await q(p, () => !!document.querySelector('.cx-band[data-gs]')), 'le bandeau prend le style caméléon du jeu du clip (data-gs)')
    check(await q(p, () => [...document.querySelectorAll('.cl-bar .pill')].map((b) => b.textContent).join('|') === 'Tout|Favoris|Films|Counter-Strike|Battlefield 6'), 'filtres : Tout, Favoris, Films, puis les jeux (plus de « 3 kills », « Headshots »)')
    check(await q(p, () => !document.querySelector('.srch, [data-search]') && !!document.querySelector('#clSel.cx-lnk') && !!document.querySelector('.cm-go.cx-lnk')), 'bouton de recherche retiré ; « Sélectionner » et « Monter un film » sont des liens sans cadre')
    check(await q(p, () => { const t = [...document.querySelectorAll('.cx-lib section.cm')].map((s) => [s.querySelector('h2').textContent, [...s.querySelectorAll('.ct-t b')].map((b) => b.textContent)]); window.__groups = t; return t[0][0] === 'Mirage' && t[0][1].slice(-1)[0] === 'Film du match' && t.slice(-1)[0][0] === 'Films' && t.slice(-1)[0][1].join() === 'Film seul' }), 'un film se range à la fin du groupe de sa partie ; le film sans partie est dans « Films », en dernier')
    check(await q(p, () => document.querySelectorAll('.ct-tile').length === 9), 'aucun clip ni film ne disparaît (9 vignettes)')
    check(await q(p, () => { const f = getComputedStyle(document.querySelector('.cx-lib .ct-frame')); return f.borderRadius === '16px' && getComputedStyle(document.querySelector('.cx-lib .cm-t h2')).fontSize === '22px' }), 'vignettes de rayon 16, titres de groupe de 22 px')
    await shots('b-clips')
    // Bulles avec des clips
    for (const id of ['dur', 'qual', 'more']) {
      await p.click(`[data-pop="${id}"]`); await wait(250)
      check(await q(p, (id) => document.querySelectorAll('.cx-pop').length === 1 && document.querySelector(`[data-pop="${id}"]`).getAttribute('aria-expanded') === 'true' && !!document.activeElement.closest('.cx-pop'), id), `avec des clips, bulle « ${id} » : ouverte, focus dedans`)
      check(await inWin('.cx-pop'), `avec des clips, bulle « ${id} » : tient dans la fenêtre`)
      check(await q(p, () => { const r = document.querySelector('.cx-pop').getBoundingClientRect(); return [[.5, .96], [.96, .96], [.5, .5]].every(([x, y]) => !!document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)?.closest('.cx-pop')) }), `bulle « ${id} » non coupée par le bandeau (le bas de la bulle reçoit le pointeur)`)
      if (id === 'dur') await shot(p, 'cx-b-clips-pop-dur'); if (id === 'more') await shot(p, 'cx-b-clips-pop-more')
      await p.keyboard.press('Escape'); await wait(200)
      check(await q(p, (id) => document.activeElement === document.querySelector(`[data-pop="${id}"]`) && S.view === 'clips', id), `avec des clips, bulle « ${id} » : Échap rend le focus`)
    }
    await size(1280, 720); await settle(p, 600)
    for (const id of ['more', 'qual']) { await p.click(`[data-pop="${id}"]`); await wait(250); check(await inWin('.cx-pop'), `1280 × 720 : bulle « ${id} » tient dans la fenêtre`); if (id === 'more') await shot(p, 'cx-b-clips-pop-more-1280'); await p.keyboard.press('Escape'); await wait(150) }
    await size(1600, 940); await settle(p, 500)
    // Filtre Films
    await p.click('.pill[data-f=film]'); await wait(300)
    check(await q(p, () => document.querySelectorAll('.ct-tile').length === 2 && S.clipFilter === 'film'), 'filtre « Films » : les deux films')
    await p.click('.pill[data-f=star]'); await wait(300)
    check(await q(p, () => document.querySelectorAll('.ct-tile').length === 2 && S.clipFilter === 'star'), 'filtre « Favoris » : les deux clips en favori')
    await q(p, () => { CLIPS.forEach((c) => { c.pinned = false }); Clips.onEnter() }); await wait(300)
    check(await q(p, () => document.querySelectorAll('.ct-tile').length === 0 && !!document.querySelector('.empty #clReset')), 'filtre vide : le message et « Effacer le filtre »')
    await p.click('#clReset'); await wait(300)
    check(await q(p, () => S.clipFilter === 'all' && document.querySelectorAll('.ct-tile').length === 9), 'effacer le filtre')
    // Sélectionner
    await p.click('#clSel'); await wait(300)
    check(await q(p, () => !!document.querySelector('#clSelN') && document.querySelectorAll('.ct-tile.is-pick').length === 9), 'Sélectionner : le mode de choix marche')
    await p.click('.ct-tile'); await wait(200)
    check(await q(p, () => document.querySelector('#clSelN').textContent === '1 choisi'), 'un clip choisi')
    await p.click('#clSelEnd'); await wait(300)
    // Le lecteur s'ouvre depuis une vignette et depuis « Regarder »
    await p.click('.cx-band .ht-acts .play-btn'); await settle(p, 1200)
    check(await q(p, () => Clips.isOpen() && !!document.querySelector('#cpVid')), '« Regarder » ouvre le lecteur')
    await p.keyboard.press('Escape'); await settle(p, 900)
    check(await q(p, () => !Clips.isOpen() && !!document.querySelector('#cxRoot')), 'Échap ferme le lecteur : la page revient')
    await p.click('.ct-tile'); await settle(p, 1200)
    check(await q(p, () => Clips.isOpen()), 'une vignette ouvre le lecteur')
    await q(p, () => Clips.close()); await settle(p, 900)

    // ---- 8. En partie : N clips dans cette partie, ou « Le prochain clip arrive ici »
    await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'recording', game: 'Counter-Strike 2' }, session: true })
    check(await q(p, () => /Le prochain clip arrive ici/.test(document.querySelector('.cx-title').textContent) && !document.querySelector('.cx-band .ht-acts') && /Counter-Strike 2/.test(document.querySelector('.cx-kick').textContent)), 'en partie, aucun clip dans cette partie : « Le prochain clip arrive ici », sans bouton')
    await q(p, () => { const c = window.__cx; CLIPS = [window.__cx.clip(c.cs, 'Doublé à la M4A1-S', 's-live', Date.now() - 120e3, { round: 6, kills: 2, map: 'de_dust2' }), window.__cx.clip(c.cs, 'Kill à l’AWP', 's-live', Date.now() - 60e3, { round: 4, map: 'de_dust2' }), ...window.__fake()]; Real.emit('games'); Clips.onEnter() }); await settle(p, 800)
    check(await q(p, () => /2 clips dans cette partie/.test(document.querySelector('.cx-title').textContent) && /Regarder le dernier/.test(document.querySelector('.cx-band .play-btn').textContent) && /Dust II/.test(document.querySelector('.cx-kick').textContent)), 'en partie : « <jeu>, <carte> », « 2 clips dans cette partie », « Regarder le dernier »')
    check(await q(p, () => /Enregistre/.test(document.querySelector('.cx-st').textContent) && !!document.querySelector('.cx-live .cx-wait')), 'pastille « Enregistre » et groupe de la partie en cours avec « Le prochain arrive ici »')
    await shots('b-rec')
    // ---- 9. En panne
    await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'error', error: 'Le moteur vidéo ne répond pas. Nouvel essai dans 5 s.' } })
    check(await q(p, () => /Le moteur vidéo ne répond pas/.test(document.querySelector('.cx-band').textContent) && /Copier le journal/.test(document.querySelector('.cx-band .cx-pill').textContent) && /En panne/.test(document.querySelector('.cx-st').textContent)), 'en panne : la phrase du moteur telle quelle, « Copier le journal », pastille « En panne »')
    await shot(p, 'cx-b-panne')
    await SET(p, { clips: false, cfg: { enabled: true }, live: { status: 'error', error: 'Le moteur vidéo ne répond pas. Nouvel essai dans 5 s.' } })
    check(await q(p, () => /Caméra en panne/.test(document.querySelector('.cx-tt').textContent) && !!document.querySelector('.cx-acts .cx-pill[data-act=log]') && !!document.querySelector('.cx-acts [data-act=all]')), 'sans clip, en panne : titre, phrase, « Copier le journal » et « Tous les réglages »')
    await shot(p, 'cx-b-vide-panne')
    // ---- 10. CS2 absent ou suivi coupé ; moteur muet ; jeu neutre
    await SET(p, { clips: false, cfg: { enabled: true }, live: { status: 'idle' }, cs2Live: false })
    check(await q(p, () => /Suivi coupé/.test(document.querySelector('.cx-deck').textContent)), 'suivi des matchs coupé : la tuile le dit')
    await p.click('[data-pop=trig]'); await wait(250)
    check(await q(p, () => /Le suivi des matchs est coupé : seul le raccourci garde un clip\./.test(document.querySelector('.cx-pop').textContent) && !!document.querySelector('.cx-pop [data-act=live]') && !!document.querySelector('.cx-pop .pills[inert]')), 'bulle CS2 : la phrase de Paramètres, « Activer le suivi », pastilles inertes')
    await shot(p, 'cx-b-vide-suivi-coupe')
    await p.click('.cx-pop [data-act=live]'); await wait(900)
    check(await q(p, () => Real.st.settings.cs2Live !== false && !/Suivi coupé/.test(document.querySelector('.cx-deck').textContent)), '« Activer le suivi » rallume le suivi')
    await p.keyboard.press('Escape'); await wait(200)
    await q(p, () => { window.__cs2 = GAMES.find((g) => g.id === 'cs2').installed; GAMES.find((g) => g.id === 'cs2').installed = false; Real.emit('games') }); await settle(p, 500)
    check(await q(p, () => document.querySelectorAll('.cx-deck .cx-tile').length === 3 && !/Counter-Strike 2/.test(document.querySelector('.cx-deck').textContent)), 'CS2 pas installé : la tuile Counter-Strike 2 disparaît')
    await q(p, () => { GAMES.find((g) => g.id === 'cs2').installed = window.__cs2; Real.emit('games') }); await settle(p, 400)
    await q(p, () => { window.__cfg = Real.clipsCfg; Real.clipsCfg = null; Clips.onEnter() }); await settle(p, 500)
    check(await q(p, () => /Enregistrement indisponible/.test(document.querySelector('#cxRoot').textContent) && !!document.querySelector('[data-act=retry]') && !document.querySelector('.cx-deck, #cxRoot .sw')), 'moteur muet : « Enregistrement indisponible » et « Réessayer », aucun réglage')
    await p.click('[data-act=retry]'); await wait(900)
    check(await q(p, () => !!Real.clipsCfg && !!document.querySelector('.cx-deck')), '« Réessayer » recharge les réglages et redessine')
    // Boutons au style du jeu coupé : pastille de verre plate
    await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'idle' } })
    // Le test « pas de relief » doit pouvoir échouer : on le passe d'abord sur un vrai bouton rouge à relief de l'appli (classe .btn.rose, qui porte --key)
    const RELIEF = () => { const b = document.querySelector('.cx-band .play-btn'); const t = document.createElement('button'); t.className = 'btn rose'; t.textContent = 'x'; document.body.appendChild(t); const rel = (e) => { const c = getComputedStyle(e); return /rgb\(236, 48, 88\)/.test(c.backgroundImage) || /0px -2px 0px 0px inset/.test(c.boxShadow) }; const ctl = rel(t), cs = getComputedStyle(t), info = { bg: cs.backgroundImage.slice(0, 90), sh: cs.boxShadow.slice(0, 120) }; t.remove(); return { ctl, info, now: rel(b) } }
    const rel0 = await q(p, RELIEF)
    check(rel0.ctl === true, 'contrôle du test « relief » : sur un vrai bouton .btn.rose il dit « relief »', rel0.info)
    await q(p, () => GameStyle.set(false)); await wait(700)
    const rel1 = await q(p, RELIEF)
    check(rel1.ctl === true && rel1.now === false, 'sans style du jeu : « Regarder » n’est pas l’îlot rouge à relief (ni fond rgb(236, 48, 88), ni ombre 0px -2px 0px 0px inset)', rel1)
    check(await q(p, () => { const h = document.querySelector('.cx-band'); const b = document.querySelector('.cx-band .play-btn'); const cs = getComputedStyle(b); return !h.dataset.gs && cs.height === '44px' && parseFloat(cs.borderRadius) >= 22 }), 'sans style du jeu : « Regarder » est une pastille de verre plate de 44 px')
    check(await q(p, () => getComputedStyle(document.querySelector('.cx-band .play-btn')).backgroundColor === 'rgba(255, 255, 255, 0.08)'), 'pastille de verre : fond rgba(255,255,255,.08)')
    await shot(p, 'cx-b-clips-neutre')
    await q(p, () => GameStyle.set(true)); await wait(500)
    // B, avec clips, caméra coupée : captures à 1600 × 940 et 1280 × 720
    await SET(p, { clips: true, cfg: { enabled: false }, live: { status: 'off' } })
    check(await q(p, () => !!document.querySelector('.cx-band') && !!document.querySelector('.cx-top .cx-inert[inert], .cx-top [inert]')), 'avec des clips, caméra coupée : le bandeau est là, ses réglages sont inertes')
    await shots('b-clips-coupe')
    await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'idle' } })
    await q(p, () => GameStyle.set(false)); await wait(500)
    await q(p, () => GameStyle.set(true)); await wait(900)
    check(await q(p, () => !!document.querySelector('.cx-band[data-gs]')), 'réglage rallumé : le style du jeu revient')

    // ---- 11. La fiche d'un jeu, onglet Clips : plus de « Lancer »
    await SET(p, { clips: false, cfg: { enabled: true }, live: { status: 'idle' } })
    await q(p, () => Pages.openGame('cs2', null, { tab: 'clips' })); await settle(p, 1200)
    check(await q(p, () => !document.querySelector('#gbPlay') && /Pas encore de clip sur ce jeu/.test(document.querySelector('.gp-body, #gameBody, .v-game')?.textContent || document.body.textContent)), 'fiche d’un jeu, onglet Clips : plus de bouton « Lancer »')
    await q(p, () => Real.saveClips({ enabled: false })); await settle(p, 900)
    await q(p, () => Pages.openGame('cs2', null, { tab: 'clips' })); await settle(p, 900)
    check(await q(p, () => /La caméra est coupée\./.test(document.body.textContent) && !!document.querySelector('#gbOn')), 'caméra coupée : « La caméra est coupée. » et « Allumer la caméra »')
    await shot(p, 'cx-fiche-clips-coupe')
    await p.click('#gbOn'); await wait(1200)
    check(await q(p, () => Real.clipsCfg.enabled === true && !document.querySelector('#gbOn')), '« Allumer la caméra » rallume (la fiche se met à jour)')
    await q(p, () => Pages.closeGame()); await settle(p, 800)

    // ---- 12. Régie
    for (const st of [['a', 'vide'], ['a', 'vide-coupe'], ['a', 'clips'], ['a', 'rec'], ['a', 'off']]) {
      const [s0, k] = st
      if (k === 'vide') await SET(p, { clips: false, style: 'a', cfg: { enabled: true }, live: { status: 'idle' } })
      if (k === 'vide-coupe') await SET(p, { clips: false, cfg: { enabled: false }, live: { status: 'off' } })
      if (k === 'clips') await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'idle' } })
      if (k === 'rec') await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'recording', game: 'Counter-Strike 2' }, session: true })
      if (k === 'off') await SET(p, { clips: true, cfg: { enabled: false }, live: { status: 'off' } })
      if (k === 'vide') {
        check(await q(p, () => !!document.querySelector('#cxRoot.cx-a') && /Aucun clip/.test(document.querySelector('.cx-empty h1').textContent) && /Joue, ils arriveront ici\./.test(document.querySelector('.cx-empty').textContent) && /Un kill sur Counter-Strike 2, ou Alt \+ C dans n’importe quel jeu\./.test(document.querySelector('.cx-borncard').textContent) && document.querySelectorAll('.cx-ghost').length === 4), 'Régie sans clip : « Aucun clip », le dessin « ce qu’un clip garde », 4 emplacements vides')
        const x0 = await q(p, () => document.querySelector('.cx-born .c').style.width)
        await p.focus('.cx-body input[data-r=before]'); for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await wait(250) }
        const x1 = await q(p, () => ({ w: document.querySelector('.cx-born .c').style.width, l: document.querySelector('.cx-born').textContent, cfg: Real.clipsCfg.before }))
        check(x0 !== x1.w && x1.l.includes(`${x1.cfg} s avant`), `Régie : le dessin suit le curseur (${x1.l})`)
        await q(p, () => Real.saveClips({ before: 20 })); await wait(500)
        check(await q(p, () => !!document.querySelector('.cx-master .sw[role=switch]') && !!document.querySelector('.cx-seg[role=radiogroup]') && document.querySelectorAll('.cx-seg [role=radio]').length === 3), 'Régie : interrupteur, groupe de 3 boutons radio pour la qualité')
        await p.focus('.cx-seg [aria-checked=true]'); await p.keyboard.press('ArrowRight'); await wait(600)
        check(await q(p, () => Real.clipsCfg.quality === 'high'), 'Régie : les flèches changent la qualité (comme dans Paramètres)')
        await q(p, () => Real.saveClips({ quality: 'balanced' })); await wait(400)
      }
      if (k === 'vide-coupe') check(await q(p, () => /La caméra est coupée\./.test(document.querySelector('.cx-empty').textContent) && !!document.querySelector('.cx-empty [data-act=on]') && !document.querySelector('.cx-borncard')), 'Régie coupée sans clip : « La caméra est coupée. » et « Allumer la caméra »')
      if (k === 'clips') check(await q(p, () => document.querySelector('.cx-rlib .cx-lib') && getComputedStyle(document.querySelector('.cx-rlib .ct-grid')).gridTemplateColumns.split(' ').length === 3), 'Régie avec des clips : filtres et liste, 3 vignettes par rangée')
      if (k === 'rec') check(await q(p, () => /Enregistre/.test(document.querySelector('.cx-master').textContent)), 'Régie en partie : « Enregistre » dans l’en-tête')
      await shots(`a-${k}`)
      if (k === 'clips') { await size(1280, 720); await settle(p, 600); check(await q(p, () => getComputedStyle(document.querySelector('.cx-rlib .ct-grid')).gridTemplateColumns.split(' ').length === 2 && getComputedStyle(document.querySelector('.cx-con')).width.startsWith('340')), '1280 × 720 : régie de ~340 px, 2 vignettes par rangée'); await size(1600, 940); await settle(p, 500) }
    }
    await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'error', error: 'Le moteur vidéo ne répond pas.' } })
    check(await q(p, () => /Le moteur vidéo ne répond pas\./.test(document.querySelector('.cx-master').parentElement.textContent) && !!document.querySelector('.cx-con [data-act=log]')), 'Régie en panne : la phrase du moteur et « Copier le journal »')
    await q(p, () => Clips.setStyle('b')); await settle(p, 500)

    // ---- 13. Mouvement réduit : rien ne bouge
    await p.emulateMedia({ reducedMotion: 'reduce' }); await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'recording', game: 'Counter-Strike 2' }, session: true }); await wait(600)
    check(await q(p, () => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('#cxRoot')).length === 0), 'mouvement réduit : aucune animation en cours sur la page')
    await p.emulateMedia({ reducedMotion: 'no-preference' })

    // ---- 14. Quitter la page puis y revenir : rien ne reste ouvert
    await p.click('[data-pop="dur"]'); await wait(200)
    await q(p, () => go('lib')); await settle(p, 700); await q(p, () => go('clips')); await settle(p, 900)
    check(await q(p, () => document.querySelectorAll('.cx-pop').length === 0), 'on quitte la page puis on y revient : aucune bulle ouverte')

    // ---- 15. Corrections de revue : capture de raccourci, bulles, titres absents, qualité inconnue, lecteur
    const hk0 = await q(p, () => Real.clipsCfg.hotkey)
    const restoreHk = async () => { await q(p, async (h) => { await Real.saveClips({ hotkey: h }) }, hk0); await wait(500) }
    await q(p, () => GameStyle.set(true)); await SET(p, { clips: false, cfg: { enabled: true }, live: { status: 'idle' } })
    check(await q(p, () => typeof document.body.checkVisibility === 'function'), 'Electron : document.body.checkVisibility existe')
    // (1) Paramètres > Raccourcis, clic sur « Clipper à la main », fermeture, autre page, saisie
    await q(p, () => Settings.open('keys')); await wait(900)
    await p.click('#sheet .kc[data-key=clip]'); await wait(250)
    check(await q(p, () => !!document.querySelector('#sheet .kc.wait')), 'raccourcis : « Clipper à la main » attend une touche')
    await p.click('#shX'); await wait(700)
    await q(p, () => go('lib')); await settle(p, 800)
    const inp = await q(p, () => { const v = [...document.querySelectorAll('input:not([type=range]):not([type=checkbox]):not([type=hidden])')].find((i) => i.checkVisibility?.() && !i.disabled); if (v) { v.focus(); return 'réel' } const t = document.createElement('input'); t.id = '__ti'; t.style.cssText = 'position:fixed;left:20px;top:20px;z-index:99999'; document.body.appendChild(t); t.focus(); return 'ajouté' })
    await p.keyboard.type('ab', { delay: 40 }); await wait(150)
    const v1 = await q(p, () => ({ v: document.activeElement?.value, tag: document.activeElement?.tagName }))
    await p.keyboard.press('Control+Shift+J'); await wait(700)
    const a1 = await q(p, () => ({ hk: Real.clipsCfg.hotkey, wait: document.querySelectorAll('.kc.wait').length }))
    check(v1.v === 'ab', `capture abandonnée à la fermeture : la saisie « ab » arrive dans le champ (${inp}, valeur « ${v1.v} »)`, v1)
    check(a1.hk === hk0 && a1.wait === 0, `capture abandonnée à la fermeture : Ctrl+Maj+J ne change pas le raccourci (${a1.hk}), aucun .kc.wait`, a1)
    await q(p, () => { document.getElementById('__ti')?.remove() }); await restoreHk()
    // (1 bis) le bouton resté « en attente » est restauré par cancelKey (texte et libellé)
    await q(p, () => Settings.open('keys')); await wait(900)
    await p.click('#sheet .kc[data-key=clip]'); await wait(200)
    await q(p, () => Settings.cancelKey())
    check(await q(p, () => { const b = document.querySelector('#sheet .kc[data-key=clip]'); return !document.querySelector('.kc.wait') && !/Appuie/.test(b.textContent) && /Clipper à la main : /.test(b.getAttribute('aria-label')) }), 'cancelKey() : le bouton retrouve ses touches et son libellé')
    await q(p, () => Settings.close()); await wait(700); await q(p, () => go('clips')); await settle(p, 800)
    // (2) feuille ouverte par-dessus Clips : un redessin de la page ne tue pas la capture des Paramètres
    await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'idle' } })
    await q(p, () => Settings.open('keys')); await wait(900)
    await p.click('#sheet .kc[data-key=clip]'); await wait(250)
    await q(p, () => Clips.onEnter()); await wait(600)
    check(await q(p, () => !!document.querySelector('#sheet .kc.wait')), 'feuille ouverte sur Clips, un redessin de la page : la capture des Paramètres est toujours là')
    await p.keyboard.press('Alt+KeyV'); await wait(900)
    const a2 = await q(p, () => Real.clipsCfg.hotkey)
    check(/Alt\+V/i.test(a2), `… et la combinaison suivante change le raccourci (${a2})`)
    await q(p, () => Settings.close()); await wait(700); await restoreHk()
    // (3) capture lancée sur la page Clips, puis « Regarder » : le lecteur ne la garde pas
    await q(p, () => Clips.onEnter()); await settle(p, 700)
    await p.click('.cx-top .kc'); await wait(250)
    check(await q(p, () => !!document.querySelector('.cx-top .kc.wait')), 'page Clips : la pastille raccourci attend une touche')
    await p.click('.cx-band .ht-acts .play-btn'); await settle(p, 1400)
    check(await q(p, () => Clips.isOpen() && !document.querySelector('.kc.wait')), 'ouvrir le lecteur abandonne la capture (aucun .kc.wait)')
    await p.keyboard.press('Control+Shift+J'); await wait(700)
    check(await q(p, (h) => Real.clipsCfg.hotkey === h, hk0), 'dans le lecteur, Ctrl+Maj+J ne change pas le raccourci')
    // Le lecteur : « Copier pour Discord » est la pastille de verre plate
    const sh = await q(p, () => { const b = document.querySelector('#cpShare'), c = getComputedStyle(b), r = b.getBoundingClientRect(), side = document.querySelector('.cp-side').getBoundingClientRect(); return { cls: b.className, h: c.height, rad: c.borderTopLeftRadius, bg: c.backgroundColor, bgi: c.backgroundImage, shadow: c.boxShadow, font: c.fontWeight + ' ' + c.fontSize, family: c.fontFamily.slice(0, 20), txt: b.textContent.trim(), icon: !!b.querySelector('.ic'), span: !!document.querySelector('#cpShare span'), left: Math.round(r.left - side.left), right: Math.round(side.right - r.right), inView: r.right <= innerWidth && r.bottom <= innerHeight } })
    check(sh.h === '44px' && parseFloat(sh.rad) >= 22 && sh.bg === 'rgba(255, 255, 255, 0.08)' && sh.bgi === 'none' && /rgba\(255, 255, 255, 0\.12\) 0px 0px 0px 1px inset/.test(sh.shadow) && !/rose|btn/.test(sh.cls) && sh.font === '500 15px' && /Copier pour Discord/.test(sh.txt) && sh.icon && sh.span && sh.inView, 'lecteur : « Copier pour Discord » est la pastille de verre plate (44 px, rayon 999, fond .08, liseré .12, Archivo 500 15 px, icône et libellé gardés)', sh)
    check(Math.abs(sh.left - sh.right) <= 1, `lecteur : la pastille est centrée dans la colonne (marges ${sh.left} et ${sh.right} px)`)
    check(await q(p, () => { const b = document.querySelector('#cpShare'); b.setAttribute('aria-busy', 'true'); const o = parseFloat(getComputedStyle(b).opacity); b.removeAttribute('aria-busy'); return o < 1 }), 'lecteur : aria-busy estompe la pastille')
    const rel2 = await q(p, () => { const c = getComputedStyle(document.querySelector('#cpShare')); return /rgb\(236, 48, 88\)/.test(c.backgroundImage) || /0px -2px 0px 0px inset/.test(c.boxShadow) })
    check(rel2 === false, 'lecteur : « Copier pour Discord » n’est pas l’îlot rouge à relief')
    await shot(p, 'cx-b-lecteur-discord')
    await q(p, () => Clips.close()); await settle(p, 900); await restoreHk()
    check(await q(p, () => !!document.querySelector('#cxRoot') && !Clips.isOpen()), 'lecteur fermé : la page revient')
    // (4) caméra coupée pendant qu'une bulle de réglage est ouverte : plus de bulle, le focus ne se perd pas
    for (const [lab, withClips] of [['avec des clips', true], ['sans clip', false]]) {
      await SET(p, { clips: withClips, cfg: { enabled: true }, live: { status: 'idle' } })
      await p.click('[data-pop="dur"]'); await wait(300)
      await q(p, () => Real.saveClips({ enabled: false })); await wait(900)
      const o = await q(p, () => ({ pops: document.querySelectorAll('.cx-pop').length, ex: document.querySelector('[data-pop=dur]')?.getAttribute('aria-expanded'), foc: document.activeElement?.dataset?.fk || document.activeElement?.tagName, body: document.activeElement === document.body }))
      check(o.pops === 0 && o.ex === 'false' && !o.body && o.foc === 'sw-en', `${lab} : la caméra se coupe pendant que « Durée » est ouverte : plus de bulle, le focus passe à l’interrupteur (${o.foc})`, o)
      await q(p, () => Real.saveClips({ enabled: true })); await wait(800)
    }
    // … sauf « Plus de réglages », qui reste utilisable coupé
    await SET(p, { clips: true, cfg: { enabled: true }, live: { status: 'idle' } })
    await p.click('[data-pop="more"]'); await wait(300)
    await q(p, () => Real.saveClips({ enabled: false })); await wait(900)
    check(await q(p, () => document.querySelectorAll('.cx-pop[data-pop-for=more]').length === 1), 'caméra coupée : la bulle « Plus de réglages » reste ouverte')
    await p.keyboard.press('Escape'); await wait(200)
    await q(p, () => Real.saveClips({ enabled: true })); await wait(800)
    // (5) bulle « trig » ouverte sans clip, puis des clips arrivent : la bulle n'existe plus, Échap n'est pas avalé
    await SET(p, { clips: false, cfg: { enabled: true }, live: { status: 'idle' } })
    await p.click('[data-pop="trig"]'); await wait(300)
    await q(p, () => { window.__esc = null; document.body.addEventListener('keydown', window.__escL = (e) => { if (e.key === 'Escape') window.__esc = { prevented: e.defaultPrevented } }) })
    await q(p, () => { CLIPS = window.__fake(); Real.emit('games') }); await settle(p, 900)
    check(await q(p, () => !!document.querySelector('.cx-band') && !document.querySelector('[data-pw=trig]') && document.querySelectorAll('.cx-pop').length === 0), 'les clips arrivent : la mise en page change, la bulle « trig » a disparu')
    await p.keyboard.press('Escape'); await wait(300)
    const e5 = await q(p, () => { document.body.removeEventListener('keydown', window.__escL); return window.__esc })
    check(!!e5 && e5.prevented === false, 'l’état de la bulle est remis à zéro : Échap n’est pas avalé (il arrive jusqu’au reste de la page)', e5)
    // (7) données douteuses : clip sans titre, qualité inconnue
    for (const [lab, withClips] of [['avec des clips', true], ['sans clip', false]]) {
      await SET(p, { clips: withClips, cfg: { enabled: true }, live: { status: 'idle' } })
      const r7 = await q(p, async () => {
        const out = { err: null }
        try {
          if (CLIPS.length) CLIPS.forEach((c) => { c.title = undefined }); const q0 = Real.clipsCfg.quality; Real.clipsCfg.quality = 'zzz'
          Clips.onEnter()
          out.q = document.querySelector('[data-pop=qual]')?.textContent.replace(/\s+/g, ' ').trim()
          document.querySelector('[data-pop=qual]')?.click(); await new Promise((r) => setTimeout(r, 300))
          out.pop = !!document.querySelector('.cx-pop[data-pop-for=qual]'); document.querySelector('[data-pop=qual]')?.click()
          out.kick = document.querySelector('.cx-title')?.textContent; out.tile = document.querySelector('.ct-tile b')?.textContent; out.aria = document.querySelector('.ct-tile')?.getAttribute('aria-label')
          Real.clipsCfg.quality = q0
        } catch (e) { out.err = String(e && e.message || e); Real.clipsCfg.quality = 'balanced' }
        return out
      })
      check(!r7.err && /équilibrée|Équilibrée/.test(r7.q || '') && r7.pop, `${lab} : une qualité inconnue ne casse pas la page (repli sur Équilibrée : « ${r7.q} »)`, r7)
      if (withClips) check(r7.kick === 'Clip' && r7.tile === 'Clip' && /^Clip, \d+ secondes$/.test(r7.aria || ''), `un clip sans titre s’appelle « Clip » (bandeau « ${r7.kick} », vignette « ${r7.tile} », libellé « ${r7.aria} »)`, r7)
      await SET(p, { clips: withClips, cfg: { enabled: true }, live: { status: 'idle' } })
    }
    // (9) moteur muet : la ligne « Style de la page Clips » reste dans Paramètres
    await q(p, () => { window.__cfg9 = Real.clipsCfg; Real.clipsCfg = null; Settings.go('rec', 'r-cstyle') }); await wait(900)
    check(await q(p, () => !!document.querySelector('#sheet #r-cstyle .seg') && !!document.querySelector('#rRetry')), 'moteur muet : « Enregistrement indisponible » et la ligne « Style de la page Clips » dans Paramètres')
    await q(p, () => { Settings.close(); Real.clipsCfg = window.__cfg9 }); await wait(700)
    check(await q(p, (h) => Real.clipsCfg.hotkey === h && Real.clipsCfg.enabled === true, hk0), 'réglages remis comme au départ (raccourci, caméra allumée)')

    check(errs.length === 0, `0 erreur de page (${errs.length})`)
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { fails++; console.log('ECHEC', e.message.split('\n')[0]); console.log(errs.slice(0, 20).join('\n')) }
  console.log(fails ? `RESULTAT : ${fails} NON` : 'RESULTAT : tout est OK')
  await app.close()
  process.exit(fails ? 1 : 0)
})()
