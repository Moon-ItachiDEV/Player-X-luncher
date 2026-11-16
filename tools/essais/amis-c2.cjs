// Page Amis, disposition « Portraits » (suite) : comptes en erreur, teintes sans rose, sélection sans refaire la page, focus, accessibilité,
// cas limites (console, jeu absent de la bibliothèque, profil privé avec niveau, bascule pendant un chargement, stockage qui échoue, mouvement réduit).
// Vraie fenêtre, mode démo. Chaque contrôle est une vraie assertion ; un échec ou une erreur de page termine le processus avec un code non nul.
// Ce qu'on force à la main : les données (FRIENDS / VOICE / Real.st.friendsRes.errors), les profils Steam (Real.friendProfile / cachedProfile surchargés),
// Real.setWatch (retardé) ; window.launcher est figé, donc les ouvertures de salon Discord ne sont pas observées.
const { start, shot, go } = require('./h.cjs')
const ok = (c, m) => { if (!c) throw new Error('ÉCHEC : ' + m); console.log('ok  ', m) }
const resize = async (app, p, w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]); await p.waitForTimeout(1500) }
const redraw = async (p, fn, arg) => { await p.evaluate(fn, arg); await p.evaluate(() => Pages.refresh('friends')); await p.waitForTimeout(800) }
const SAVE = `window.__bk = { f: FRIENDS.map((x) => ({ ...x })), v: VOICE.map((x) => ({ ...x })), e: Real.st.friendsRes.errors }`
const RESTORE = () => { FRIENDS.splice(0, FRIENDS.length, ...window.__bk.f.map((x) => ({ ...x }))); VOICE.splice(0, VOICE.length, ...window.__bk.v.map((x) => ({ ...x }))); Real.st.friendsRes.errors = window.__bk.e }
const fake = (id, n, o = {}) => ({ id, n, hue: Shared.text.hue(n), avatar: null, st: 'offline', on: 'Steam', member: false, game: null, gameName: null, activity: null, device: null, seen: '', since: '', voice: null, voiceId: null, join: false, raw: { id, platform: 'steam', lastSeen: Date.now() }, ...o })
const PROF = (p) => p.evaluate(() => {
  const gs = GAMES.filter((g) => /^steam:\d+$/.test(g.rid || '')).slice(0, 10)
  window.__prof = { level: 42, levelProgress: .64, gameCount: 213, totalMinutes: 4870 * 60, badgeCount: 38, friendCount: 96, country: 'FR', memberSince: Date.parse('2014-05-01'), background: null, avatarFull: null,
    games: gs.map((g, i) => ({ appId: +g.rid.split(':')[1], name: g.name, minutes: (i + 1) * 5400 })), recent: gs.slice(0, 2).map((g) => ({ appId: +g.rid.split(':')[1], name: g.name, recentMinutes: 600 })) }
  window.__rf = window.__rf || Real.friendProfile; window.__rc = window.__rc || Real.cachedProfile
  Real.friendProfile = async () => window.__prof; Real.cachedProfile = () => window.__prof
})
const NOPROF = (p) => p.evaluate(() => { if (window.__rf) { Real.friendProfile = window.__rf; Real.cachedProfile = window.__rc } })
const hueFn = `(rgb) => { const [r, g, b] = rgb.map((x) => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return -1; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return h < 0 ? h + 360 : h }`

;(async () => {
  const { app, p, errs } = await start({ name: 'amisd' })
  let fail = null
  try {
    await p.evaluate(() => localStorage.setItem('pxv3-amis', 'c')); await p.reload(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(8000)
    await go(p, 'friends'); await p.waitForTimeout(1500)
    ok(await p.evaluate(() => !!document.querySelector('.am-c')), 'Portraits affiché')
    await p.evaluate(SAVE); await p.evaluate(`window.__fake = ${fake.toString()}`)

    // ---------- A. comptes en erreur : dans le flux, rien de rogné ni de recouvert
    const geo = () => p.evaluate(() => {
      const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } }
      const hit = (a, b) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5
      const hero = document.querySelector('.am-c-hero'), hb = R(hero), shelf = R(document.querySelector('.am-c-shelf'))
      const cta = [...hero.querySelectorAll('.am-c-cta > *')]
      const inside = cta.every((k) => { const r = R(k); return r.l >= hb.l - 1 && r.r <= hb.r + 1 && r.t >= hb.t - 1 && r.b <= hb.b + 1 && r.b <= shelf.t })
      const chips = [...document.querySelectorAll('.am-c-chip')].map(R)
      const others = [...document.querySelectorAll('.am-c-notes, .am-c-note, .am-c-duo, .am-c-hero > *')].filter((e) => e.offsetParent !== null).map(R)
      const notes = [...document.querySelectorAll('.am-c-note')]
      const cs = (q, k) => getComputedStyle(document.querySelector(q))[k]
      return { notes: notes.length, noteVisible: notes.every((n) => n.getBoundingClientRect().height > 20 && n.offsetParent !== null), pos: document.querySelector('.am-c-notes') ? cs('.am-c-notes', 'position') : null,
        nm: document.querySelector('.am-c-nm')?.textContent || null, chips: chips.length, covered: chips.some((c) => others.some((o) => hit(c, o))), inside, cta: cta.length, mainBtn: !!document.querySelector('.am-c-cta .gs-btn'),
        pills: !!document.querySelector('.am-c-pills') && cs('.am-c-pills', 'display') !== 'none', meta: !!document.querySelector('.am-c-meta') && cs('.am-c-meta', 'display') !== 'none', nameSize: cs('.am-c-name', 'fontSize'),
        heroScrolled: hero.scrollTop !== 0 || hero.scrollLeft !== 0, heroClip: hero.scrollHeight > hero.clientHeight + 2, stage: Math.round(R(document.querySelector('.am-c-stage')).b - R(document.querySelector('.am-c-stage')).t) }
    })
    await PROF(p)
    for (const [w, h] of [[1600, 940], [1280, 720]]) {
      const t = String(w)
      await resize(app, p, w, h)
      for (const [nErr, errs3] of [[2, { steam: 'Clé Steam refusée par le serveur', discord: 'Discord ne répond pas pour le moment' }], [3, { steam: 'Clé Steam refusée par le serveur', discord: 'Discord ne répond pas pour le moment', psn: 'PlayStation : jeton expiré' }]]) {
        await redraw(p, (e) => { Real.st.friendsRes.errors = e; S.friend = FRIENDS.find((f) => f.st === 'game' && !f.member).id; window.__fakeSteam = true }, errs3)
        // le héros est celui d'un ami Steam avec profil public : pastilles, infos, bouton principal et liens
        await p.evaluate(() => { const f = FRIENDS.find((x) => x.st === 'game' && !x.member); f.id = 'steam:76561198000000042'; f.raw = { ...f.raw, id: f.id, platform: 'steam' }; S.friend = f.id }); await p.evaluate(() => Pages.refresh('friends')); await p.waitForTimeout(1200)
        const g = await geo()
        console.log(JSON.stringify(g))
        ok(g.notes === 2 && g.noteVisible && (g.pos === 'relative' || g.pos === 'static'), `${t} ${nErr} erreurs : ${g.notes} lignes de compte visibles, dans le flux (position ${g.pos})`)
        ok(nErr === 2 ? g.nm === null : /^\+1 autre compte en erreur$/.test(g.nm), `${t} ${nErr} erreurs : « ${g.nm || 'pas de +N'} » (deux lignes au plus, puis +N)`)
        ok(g.chips > 0 && !g.covered, `${t} ${nErr} erreurs : ${g.chips} pastilles vocales, aucune recouverte (pas de chevauchement avec comptes, héros ni panneau)`)
        ok(g.mainBtn && g.inside && !g.heroScrolled && !g.heroClip, `${t} ${nErr} erreurs : bouton principal et ${g.cta} liens entiers dans le héros et au-dessus de l’étagère (scène ${g.stage} px, pastilles ${g.pills ? 'gardées' : 'retirées'}, infos ${g.meta ? 'gardées' : 'retirées'}, nom ${g.nameSize})`)
        await fitOk(p, `${t} ${nErr} erreurs`)
        if (nErr === 3) await shot(p, `amis-c-${t}-11-erreurs`)
      }
      ok(await p.evaluate(() => { const bad = document.querySelector('[data-fix]'); return !!bad && bad.textContent === 'Voir mes comptes' }), `${t} : action « Voir mes comptes » présente`)
      await p.evaluate(RESTORE); await redraw(p, () => {})
    }
    await NOPROF(p)

    // ---------- B. teintes : jamais de rose
    await resize(app, p, 1600, 940)
    const mag = await p.evaluate(() => { const o = []; for (let i = 0; o.length < 2 && i < 2000; i++) { const h = Shared.text.hue('Gen' + i); if (h >= 295 && h <= 345) o.push('Gen' + i) } return o })
    const raw = await p.evaluate((names) => Object.fromEntries(['Rook', 'Sora', 'Lunaa', ...names].map((n) => [n, Shared.text.hue(n)])), mag)
    console.log(JSON.stringify(raw))
    // Depuis la 0.7.0, Shared.text.hue ne donne plus de rose (285 à 345 ramenés dans 0 à 250) : aucun nom ne tombe plus dans la bande magenta
    ok(mag.length === 0 && Object.values(raw).every((h) => h < 285 || h > 345), 'Shared.text.hue ne donne plus de rose : aucun nom sur 2000 dans 295..345, ni Rook, Sora, Lunaa (' + JSON.stringify(raw) + ')')
    await redraw(p, (names) => { names.forEach((n, i) => FRIENDS.push(window.__fake('mag' + i, n, { st: 'online' }))); S.friend = FRIENDS.find((f) => f.n === 'Rook').id }, mag)
    const hues = await p.evaluate(`(() => { const H = ${hueFn}; const names = ['Rook', 'Sora', 'Lunaa', ...${JSON.stringify(mag)}]
      const tile = (c) => (getComputedStyle(c).backgroundImage.match(/rgb\\((\\d+), (\\d+), (\\d+)\\)/g) || []).map((x) => H(x.match(/\\d+/g).map(Number)))
      const cards = names.map((n) => document.querySelector('.am-c-card[title="' + n + '"]')).filter(Boolean)
      const av = [...document.querySelectorAll('.am-c-id .av, .am-c-chip .av, .am-c-duo .av')].map((e) => ({ k: e.closest('.am-c-chip') ? 'puce' : e.closest('.am-c-duo') ? 'panneau' : 'héros', h: tile(e) }))
      const bgNo = document.querySelector('.am-c-bg.no'), bg = bgNo ? getComputedStyle(bgNo).backgroundImage : ''
      return { cards: cards.map((c) => ({ n: c.title, h: tile(c) })), av, bg, shared: (() => { const h = Shared.text.hue('Rook'); return document.createElement('div').innerHTML = avatar('Rook', 28).match(/--h:(\\d+)/)[1] == h })() } })()`)
    console.log(JSON.stringify({ cards: hues.cards, av: hues.av.map((a) => a.k + ':' + a.h) }))
    const inBand = (h) => h >= 19 && h <= 251
    ok(hues.cards.length === 3 + mag.length && hues.cards.every((c) => c.h.length === 2 && c.h.every(inBand)), 'cartes Rook, Sora, Lunaa : teinte (haut et bas du dégradé) dans 20..250 ' + JSON.stringify(hues.cards.map((c) => c.n + ':' + c.h.join('/'))))
    ok(hues.av.length > 0 && hues.av.every((a) => a.h.length === 2 && a.h.every(inBand)), 'avatars de repli du héros, des pastilles et du panneau dans 20..250 (' + hues.av.map((a) => a.k).join(',') + ')')
    ok(hues.shared, 'l’aide avatar() partagée est inchangée (teinte brute de Shared.text.hue)')
    await shot(p, 'amis-c-1600-12-teintes')

    // ---------- C. sélection sans refaire la page, flèches, tabulation, accessibilité
    await redraw(p, () => { for (let i = 0; i < 45; i++) FRIENDS.push(window.__fake('o' + i, 'Hors ligne ' + String(i + 10), { raw: { id: 'o' + i, platform: 'steam', lastSeen: Date.now() - (i + 1) * 3600000 } })); S.friend = FRIENDS.find((f) => f.st === 'game').id })
    await p.evaluate(() => { window.__root = document.querySelector('.am-c'); window.__row = document.querySelector('#cRow'); window.__sw = document.querySelector('[data-lay=c]'); window.__fil = document.querySelector('[data-fil=on]'); window.__cnt = 0; window.__o = window.__o || Real.friendProfile; Real.friendProfile = (id) => { window.__cnt++; return window.__o(id) } })
    const c0 = await p.evaluate(() => { const c = [...document.querySelectorAll('.am-c-card')].find((x) => x.dataset.id !== S.friend && x.dataset.id.startsWith('o')); c.focus(); return c.dataset.id })
    await p.click(`.am-c-card[data-id="${c0}"]`); await p.waitForTimeout(500)
    const k1 = await p.evaluate(() => ({ same: document.querySelector('.am-c') === window.__root && document.querySelector('#cRow') === window.__row && document.querySelector('[data-lay=c]') === window.__sw, sel: S.friend, name: document.querySelector('.am-c-name').title, pressed: [...document.querySelectorAll('.am-c-card[aria-pressed=true]')].map((c) => c.dataset.id), focus: document.activeElement.dataset.id, tabs: [...document.querySelectorAll('.am-c-card[tabindex="0"]')].map((c) => c.dataset.id) }))
    ok(k1.same && k1.sel === c0 && k1.pressed.join() === c0 && k1.focus === c0 && k1.tabs.join() === c0, `clic sur une carte : même racine, même étagère, même sélecteur (page non refaite) ; héros « ${k1.name} », une seule carte pressée, focus gardé, un seul arrêt de tabulation`)
    const nobg = await p.evaluate(() => { const e = document.querySelector('.am-c-bg'), s = e.querySelector('svg'); return { no: e.classList.contains('no'), img: getComputedStyle(e).backgroundImage, stroke: s ? getComputedStyle(s).stroke : '' } })
    const ROSE = /(232[, ]+38[, ]+79|0\.9098\d* 0\.1490\d* 0\.3098)/
    ok(nobg.no && ROSE.test(nobg.img) && !/163[, ]+18[, ]+63/.test(nobg.img) && ROSE.test(nobg.stroke), `ami sans jeu ni fond de profil : blason, dégradé et trait en --rose (${nobg.img.slice(0, 80)} | trait ${nobg.stroke})`)
    await p.click('[data-fil=on]'); await p.waitForTimeout(300)
    ok(await p.evaluate(() => document.activeElement === window.__fil && document.querySelector('.am-c') === window.__root), 'clic sur un filtre : focus gardé sur le filtre, page non refaite')
    await p.click('[data-fil=""]'); await p.waitForTimeout(300)
    // 30 flèches maintenues
    await p.evaluate(() => { const first = document.querySelector('.am-c-card'); first.focus(); first.click(); window.__cnt = 0 }); await p.waitForTimeout(300)
    const order = await p.evaluate(() => [...document.querySelectorAll('.am-c-card')].map((c) => c.dataset.id))
    await p.evaluate(() => { window.__cnt = 0 })
    const t0 = Date.now()
    for (let i = 0; i < 30; i++) await p.keyboard.press('ArrowRight')
    const dt = Date.now() - t0
    await p.waitForTimeout(700)
    const a30 = await p.evaluate(() => ({ same: document.querySelector('.am-c') === window.__root && document.querySelector('#cRow') === window.__row, sel: S.friend, focus: document.activeElement.dataset.id, cnt: window.__cnt, vis: (() => { const r = window.__row.getBoundingClientRect(), c = document.activeElement.getBoundingClientRect(); return c.left >= r.left - 1 && c.right <= r.right + 1 })() }))
    ok(a30.same && a30.sel === order[30] && a30.focus === a30.sel && a30.vis, `30 flèches droite en ${dt} ms : même racine, sélection sur la 31e carte, focus dessus, carte visible`)
    ok(a30.cnt <= 2, `30 flèches : ${a30.cnt} demande(s) de profil au plus (attendu <= 2)`)
    await p.keyboard.press('Home'); await p.waitForTimeout(400)
    ok(await p.evaluate((f) => S.friend === f && document.activeElement.dataset.id === f, order[0]), 'Début : première carte, sélection et focus')
    await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(400)
    ok(await p.evaluate((f) => S.friend === f && document.activeElement.dataset.id === f, order[0]), 'Flèche gauche sur la première carte : on reste dessus')
    await p.keyboard.press('End'); await p.waitForTimeout(500)
    ok(await p.evaluate((f) => S.friend === f && document.activeElement.dataset.id === f, order[order.length - 1]), 'Fin : dernière carte, sélection et focus')
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300)
    ok(await p.evaluate((f) => S.friend === f, order[order.length - 1]), 'Flèche droite sur la dernière carte : on reste dessus')
    // accessibilité
    const ax = await p.evaluate(() => {
      const c = document.querySelector('.am-c-card'), g = document.querySelector('.am-c-g'), v = document.querySelector('.am-c-voice'), h1 = document.querySelector('.am-c .am-c-h1')
      const r = h1?.getBoundingClientRect()
      return { h1: h1?.textContent, h1small: r && r.width <= 2 && r.height <= 2, cardLabel: c.getAttribute('aria-label'), cardName: c.title, pressed: c.getAttribute('aria-pressed'), grp: g.getAttribute('role'), lab: document.getElementById(g.getAttribute('aria-labelledby'))?.textContent, voice: v ? v.getAttribute('role') + '|' + v.getAttribute('aria-label') : null, tabs: document.querySelectorAll('.am-c-card[tabindex="0"]').length, groups: [...document.querySelectorAll('.am-c-g')].every((x) => x.getAttribute('role') === 'group' && document.getElementById(x.getAttribute('aria-labelledby'))?.textContent) }
    })
    ok(ax.h1 === 'Amis' && ax.h1small, `h1 « Amis » masqué visuellement (${ax.h1})`)
    ok(ax.cardLabel.startsWith(ax.cardName + ', ') && ['true', 'false'].includes(ax.pressed), `nom accessible d’une carte « ${ax.cardLabel} » avec aria-pressed`)
    ok(ax.groups && ax.lab, `chaque groupe : role=group étiqueté par son titre (« ${ax.lab} »)`)
    ok(ax.voice === 'group|Salons vocaux' && ax.tabs === 1, `pastilles vocales : ${ax.voice} ; l’étagère n’a qu’un seul arrêt de tabulation (${ax.tabs})`)
    await p.evaluate(() => { document.querySelector('[data-fil=game]').focus() }); await p.keyboard.press('Tab'); await p.keyboard.press('Tab')
    // ---------- D. focus : personne du salon, bascule de suivi
    await p.evaluate(RESTORE); await p.evaluate(() => { Real.friendProfile = window.__o })
    await redraw(p, () => { const f = FRIENDS.find((x) => x.member && x.st !== 'game' && x.voiceId); S.friend = f.id })
    const room = await p.evaluate(() => [...document.querySelectorAll('.am-c-duo .am-mini')].map((m) => m.dataset.id))
    const target = await p.evaluate(() => { const m = [...document.querySelectorAll('.am-c-duo .am-mini')].find((x) => x.dataset.id !== S.friend); return m.dataset.id })
    await p.click(`.am-c-duo .am-mini[data-id="${target}"]`); await p.waitForTimeout(600)
    const fp = await p.evaluate(() => ({ sel: S.friend, inDuo: !!document.activeElement.closest('.am-c-duo'), id: document.activeElement.dataset?.id, same: true }))
    ok(fp.sel === target && fp.inDuo && fp.id === target, `clic sur une personne du salon (${room.length} dans le salon) : sélectionnée, le focus reste sur elle dans le panneau`)
    await p.evaluate(() => { const f = FRIENDS.find((x) => x.st === 'game' && !x.member); S.friend = f.id }); await p.evaluate(() => Pages.refresh('friends')); await p.waitForTimeout(700)
    const w0 = await p.evaluate(() => document.querySelector('#fcWatch')?.getAttribute('aria-pressed'))
    await p.click('#fcWatch'); await p.waitForTimeout(900)
    const w1 = await p.evaluate(() => ({ focus: document.activeElement.id, pressed: document.querySelector('#fcWatch')?.getAttribute('aria-pressed') }))
    ok(w0 !== undefined && w1.focus === 'fcWatch' && w1.pressed !== w0, `bascule de suivi : le focus reste sur le lien (aria-pressed ${w0} -> ${w1.pressed})`)
    await p.click('#fcWatch'); await p.waitForTimeout(700)
    // la bascule qui finit après un changement de disposition peint la disposition active
    await p.evaluate(() => { window.__sw0 = Real.setWatch; Real.setWatch = () => new Promise((r) => setTimeout(r, 900)) })
    await p.click('#fcWatch'); await p.click('[data-lay=a]'); await p.waitForTimeout(1600)
    const lateA = await p.evaluate(() => ({ a: !!document.querySelector('#frCard .am-ds'), hero: !!document.querySelector('.am-c-hero, .am-c-duo, #cBg'), pressed: document.querySelector('[data-lay=a]').getAttribute('aria-pressed') }))
    ok(lateA.a && !lateA.hero && lateA.pressed === 'true', 'bascule de suivi terminée après un passage à Escouades : la fiche Escouades est repeinte, aucun reste de Portraits')
    await p.evaluate(() => { Real.setWatch = window.__sw0 }); await p.click('[data-lay=c]'); await p.waitForTimeout(1200)

    // ---------- E. cas limites
    // console en jeu, jeu hors bibliothèque, membre masqué
    await redraw(p, () => {
      FRIENDS.push(window.__fake('psn:1', 'Console_Kid', { st: 'game', on: 'PlayStation', gameName: 'Astro Bot', device: 'PS5', raw: { id: 'psn:1', platform: 'psn' } }))
      FRIENDS.push(window.__fake('steam:76561198000000099', 'Inconnu_Jeu', { st: 'game', game: 'jeu-hors-bibliotheque', gameName: 'Jeu Hors Bibliothèque' }))
      S.friend = 'psn:1'
    })
    const psn = await p.evaluate(() => ({ eye: document.querySelector('.am-c-hero .am-c-eye')?.textContent, main: document.querySelector('.am-c-cta .gs-btn')?.textContent.trim() || null, links: [...document.querySelectorAll('.am-c-cta .am-lk')].map((x) => x.textContent.trim()), note: document.querySelector('.am-c-duo .am-note')?.textContent, card: document.querySelector('.am-c-card.on .am-c-t small')?.textContent }))
    ok(/En jeu · Astro Bot/.test(psn.eye) && psn.main === null && psn.links.some((l) => /Préviens-moi|prévenu/.test(l)) && /PlayStation ne donne/.test(psn.note) && psn.card === 'PS5', `ami console en jeu : « ${psn.eye} », pas de bouton principal, suivi possible, note PlayStation, carte « ${psn.card} »`)
    await shot(p, 'amis-c-1600-13-console')
    await redraw(p, () => { S.friend = 'steam:76561198000000099' })
    const inc = await p.evaluate(() => ({ eye: document.querySelector('.am-c-hero .am-c-eye')?.textContent, main: document.querySelector('.am-c-cta .gs-btn')?.textContent.trim(), grp: [...document.querySelectorAll('.am-c-gh span')].map((x) => x.textContent).find((x) => /Hors Biblio/.test(x)) }))
    ok(/En jeu · Jeu Hors Bibliothèque/.test(inc.eye) && inc.main === 'Écrire' && !!inc.grp, `jeu absent de la bibliothèque : héros « ${inc.eye} », bouton « ${inc.main} », groupe « ${inc.grp} », aucune erreur de page`)
    await p.evaluate(RESTORE)
    await redraw(p, () => { S.friend = FRIENDS.find((x) => x.member && x.st !== 'game' && x.voiceId).id })
    const hid = await p.evaluate(() => ({ id: S.friend, n: FRIENDS.find((x) => x.id === S.friend).n, hasBtn: !!document.querySelector('#fcHide') }))
    ok(hid.hasBtn, `membre ${hid.n} : « Masquer ce membre » présent`)
    await p.click('#fcHide'); await p.waitForTimeout(1800)
    const after = await p.evaluate((n) => ({ card: !![...document.querySelectorAll('.am-c-card')].find((c) => c.title === n), sel: S.friend, hero: document.querySelector('.am-c-name')?.title, toast: /masqué de la liste/.test(document.body.textContent), grid: document.querySelectorAll('.am-c-card').length }), hid.n)
    console.log(JSON.stringify(after))
    ok(!after.card && after.sel !== hid.id && after.toast && !!after.hero, `membre masqué : sa carte disparaît, le héros passe à « ${after.hero} », message d’annulation affiché`)
    await p.evaluate((n) => window.launcher.setMemberHidden(n, false).then((r) => Real.applyFriends(r)), hid.n); await p.waitForTimeout(800)
    await p.evaluate(RESTORE); await redraw(p, () => {})

    // profil privé qui garde un niveau
    await p.evaluate(() => { const f = FRIENDS.find((x) => x.st === 'game' && !x.member); f.id = 'steam:76561198000000042'; f.raw = { ...f.raw, id: f.id, platform: 'steam' }; S.friend = f.id })
    await PROF(p)
    await p.evaluate(() => { window.__prof = { ...window.__prof, gamesHidden: true, level: 17, levelProgress: .3 }; Pages.refresh('friends') }); await p.waitForTimeout(1200)
    const pv = await p.evaluate(() => ({ pills: [...document.querySelectorAll('.am-c-pill')].map((x) => x.textContent.trim().replace(/\s+/g, ' ')), duel: document.querySelectorAll('.am-c-duo .am-du').length, rec: document.querySelectorAll('.am-c-duo .am-rec li').length, txt: document.querySelector('.am-c-hero').textContent + document.querySelector('.am-c-duo').textContent }))
    ok(pv.pills.some((x) => /Niveau 17/.test(x)) && !pv.pills.some((x) => /jeux|de jeu|badges/.test(x)) && pv.duel === 0 && pv.rec === 0 && !/213|4 ?870|\b38\b/.test(pv.txt), `profil privé avec niveau : pastilles « ${pv.pills.join(' | ')} » (niveau gardé ; ni heures, ni nombre de jeux, ni badges, ni jeux en commun)`)
    // bascule pendant un chargement : pas de peinture périmée dans l'autre disposition
    await p.evaluate(() => { window.__prof = { level: 42, levelProgress: .64, gameCount: 213, totalMinutes: 4870 * 60, badgeCount: 38, country: 'FR', games: [], recent: [] }; Real.cachedProfile = () => undefined; Real.friendProfile = () => new Promise((r) => setTimeout(() => r(window.__prof), 1300)); Pages.refresh('friends') })
    await p.waitForTimeout(500)
    ok(await p.evaluate(() => !!document.querySelector('.am-c-duo .am-ds-load')), 'profil en chargement : squelette dans le panneau')
    await p.click('[data-lay=a]'); await p.waitForTimeout(2200)
    const st = await p.evaluate(() => ({ ds: !!document.querySelector('#frCard .am-ds'), c: !!document.querySelector('.am-c-hero, .am-c-duo, .am-c-bg'), lv: document.querySelector('.am-ds-lv')?.textContent.trim(), load: !!document.querySelector('.am-ds-load') }))
    ok(st.ds && !st.c && /42/.test(st.lv || '') && !st.load, `bascule vers Escouades pendant le chargement : seul le dossier est peint (niveau « ${st.lv} »), rien de Portraits`)
    await p.click('[data-lay=c]'); await p.waitForTimeout(1500)
    ok(await p.evaluate(() => !!document.querySelector('.am-c-hero') && !document.querySelector('#frCard .am-ds') && /42/.test(document.querySelector('.am-c-pills')?.textContent || '')), 'retour à Portraits : héros avec le niveau, rien d’Escouades')
    await NOPROF(p)
    await p.evaluate(RESTORE); await redraw(p, () => {})

    // le défilement du panneau est gardé par ami ET par disposition
    await resize(app, p, 1280, 720)
    await p.evaluate(() => { const gs = GAMES.filter((g) => /^steam:\d+$/.test(g.rid || '')).slice(0, 12); const f = FRIENDS.find((x) => x.st === 'game' && !x.member), f2 = FRIENDS.find((x) => x.st === 'online' && !x.member); f.id = 'steam:76561198000000042'; f.raw = { ...f.raw, id: f.id, platform: 'steam' }; f2.id = 'steam:76561198000000043'; f2.raw = { ...f2.raw, id: f2.id, platform: 'steam' }; S.friend = f.id
      window.__prof = { level: 42, gameCount: 213, totalMinutes: 4870 * 60, badgeCount: 38, country: 'FR', memberSince: Date.parse('2014-05-01'), games: gs.map((g, i) => ({ appId: +g.rid.split(':')[1], name: g.name, minutes: (i + 1) * 5400 })), recent: gs.slice(0, 2).map((g) => ({ appId: +g.rid.split(':')[1], name: g.name, recentMinutes: 600 })) } })
    await PROF(p)
    await p.evaluate(() => { Real.friendProfile = async () => window.__prof; Real.cachedProfile = () => window.__prof; Pages.refresh('friends') }); await p.waitForTimeout(1200)
    await p.click('#fcCom'); await p.waitForTimeout(400)
    const scr = await p.evaluate(() => { const d = document.querySelector('.am-c-duo'); d.scrollTop = 90; return { max: d.scrollHeight - d.clientHeight, y: d.scrollTop } })
    ok(scr.max > 90 && scr.y >= 89, `panneau scrollable (max ${scr.max}) : 90 px`)
    await p.evaluate(() => { const c = document.querySelector('.am-c-card[data-id="steam:76561198000000043"]'); c.click() }); await p.waitForTimeout(500)
    const y2 = await p.evaluate(() => document.querySelector('.am-c-duo')?.scrollTop || 0)
    await p.evaluate(() => { document.querySelector('.am-c-card[data-id="steam:76561198000000042"]').click() }); await p.waitForTimeout(500)
    const y3 = await p.evaluate(() => document.querySelector('.am-c-duo').scrollTop)
    ok(y2 === 0 && Math.abs(y3 - 90) <= 2, `défilement du panneau gardé par ami : autre ami ${y2}, retour sur le premier ${Math.round(y3)} (attendu 90)`)
    await p.click('[data-lay=a]'); await p.waitForTimeout(1200)
    const ya = await p.evaluate(() => { const d = document.querySelector('.am-ds-sc'); const m = d.scrollHeight - d.clientHeight; d.scrollTop = Math.min(30, m); return { m, y: d.scrollTop, start: 0 } })
    await p.click('[data-lay=c]'); await p.waitForTimeout(1200)
    const yc = await p.evaluate(() => document.querySelector('.am-c-duo')?.scrollTop || 0)
    ok(Math.abs(yc - 90) <= 2, `retour à Portraits : le panneau retrouve 90 (${Math.round(yc)}), pas le défilement du dossier (${Math.round(ya.y)}, max ${Math.round(ya.m)})`)
    await p.click('[data-lay=a]'); await p.waitForTimeout(1200)
    const yb = await p.evaluate(() => document.querySelector('.am-ds-sc').scrollTop)
    ok(Math.abs(yb - ya.y) <= 2, `retour à Escouades : le dossier retrouve son défilement (${Math.round(yb)} pour ${Math.round(ya.y)})`)
    await p.click('[data-lay=c]'); await p.waitForTimeout(1000)
    await NOPROF(p); await p.evaluate(RESTORE); await redraw(p, () => {})

    // l'étagère rétrécit : le défilement gardé est ramené, le premier groupe n'est jamais coupé
    await resize(app, p, 1600, 940)
    await redraw(p, () => { for (let i = 0; i < 80; i++) FRIENDS.push(window.__fake('z' + i, 'Zed ' + i, { raw: { id: 'z' + i, platform: 'steam', lastSeen: 1 } })) })
    await p.evaluate(() => { const r = document.querySelector('#cRow'); r.scrollLeft = r.scrollWidth })
    await p.waitForTimeout(300)
    await redraw(p, () => { for (let i = FRIENDS.length - 1; i >= 0; i--) if (FRIENDS[i].id.startsWith('z')) FRIENDS.splice(i, 1); FRIENDS.splice(5) })
    const clamp = await p.evaluate(() => { const r = document.querySelector('#cRow'), g = document.querySelector('.am-c-g:not([hidden])'); return { x: r.scrollLeft, max: r.scrollWidth - r.clientWidth, first: Math.round(g.getBoundingClientRect().left - r.getBoundingClientRect().left) } })
    ok(clamp.x <= Math.max(0, clamp.max) + 1 && clamp.x === 0 && clamp.first >= 0, `liste raccourcie : scrollLeft ${Math.round(clamp.x)} <= ${Math.round(clamp.max)}, premier groupe à ${clamp.first} px du bord (pas coupé)`)
    await p.evaluate(RESTORE); await redraw(p, () => {})

    // le stockage échoue : le choix marche pour la session
    await p.evaluate(() => { window.__si = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('quota') } })
    await p.click('[data-lay=a]'); await p.waitForTimeout(1000)
    const ls1 = await p.evaluate(() => ({ a: document.querySelector('[data-lay=a]').getAttribute('aria-pressed'), page: !!document.querySelector('.am-page') && !document.querySelector('.am-c') }))
    await p.click('[data-lay=c]'); await p.waitForTimeout(1000)
    const ls2 = await p.evaluate(() => ({ c: document.querySelector('[data-lay=c]').getAttribute('aria-pressed'), page: !!document.querySelector('.am-c') }))
    await p.evaluate(() => { Storage.prototype.setItem = window.__si })
    ok(ls1.a === 'true' && ls1.page && ls2.c === 'true' && ls2.page, 'localStorage.setItem qui lève : le choix de disposition marche quand même pour la session, sans erreur de page')

    // mouvement réduit : pas de décalage au survol
    await p.emulateMedia({ reducedMotion: 'reduce' })
    const hv = async () => { const c = await p.evaluateHandle(() => [...document.querySelectorAll('.am-c-card:not(.on)')].find((x) => !x.hidden)); await c.asElement().hover(); await p.waitForTimeout(500); return c.asElement().evaluate((e) => ({ t: getComputedStyle(e).translate, d: getComputedStyle(e).transitionProperty, hover: e.matches(':hover') })) }
    const rm = await hv()
    ok(rm.hover && rm.t === 'none' && !/translate|width|height|all/.test(rm.d), `mouvement réduit : au survol, translate ${rm.t}, propriétés animées « ${rm.d} » (ni translate, ni largeur, ni hauteur)`)
    await p.emulateMedia({ reducedMotion: 'no-preference' }); await p.mouse.move(5, 5)
    const nm = await hv()
    ok(nm.hover && nm.t !== 'none' && nm.t !== '0px', `mouvement normal : la carte se soulève au survol (translate ${nm.t}) — preuve que le test voit la différence`)
    await p.mouse.move(5, 5)
  } catch (e) { fail = e; console.log(e.message.split('\n').slice(0, 5).join(' ')) }
  console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  await app.close()
  if (fail || errs.length) process.exit(1)
})()

// Rien de la page sous la barre du bas, rien qui dépasse de la boîte de la page
async function fitOk(p, t) {
  const r = await p.evaluate(() => {
    const barTop = document.querySelector('#bar').getBoundingClientRect().top, box = document.querySelector('.am-c').getBoundingClientRect()
    const els = [...document.querySelectorAll('.am-c-hero, .am-c-hero > *, .am-c-hero .am-c-cta > *, .am-c-duo, .am-c-voice, .am-c-chip, .am-c-notes, .am-c-note, .am-c-shelf, .am-c-fil, .am-tools, .am-tools > *')].filter((e) => e.offsetParent !== null)
    const out = els.filter((e) => { const r = e.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > barTop + 1 }).map((e) => e.className.toString().slice(0, 24))
    const shelf = document.querySelector('.am-c-shelf').getBoundingClientRect(), h = document.querySelector('.am-c-hero').getBoundingClientRect()
    return { out, heroOver: h.bottom > shelf.top + 1, doc: document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1 }
  })
  ok(r.out.length === 0 && !r.heroOver && !r.doc, `${t} : rien ne dépasse de la boîte de la page, rien sous la barre, héros au-dessus de l’étagère (${JSON.stringify(r)})`)
}
