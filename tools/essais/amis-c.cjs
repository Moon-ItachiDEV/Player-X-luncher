// Page Amis, disposition « Portraits » et choix de la disposition : vraie fenêtre, mode démo, 1600×940 puis 1280×720.
// Chaque contrôle est une vraie assertion ; un échec ou une erreur de page termine le processus avec un code non nul.
const { start, shot, go } = require('./h.cjs')
const ok = (c, m) => { if (!c) throw new Error('ÉCHEC : ' + m); console.log('ok  ', m) }
const resize = async (app, p, w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]); await p.waitForTimeout(1800) }
const redraw = async (p, fn, arg) => { await p.evaluate(fn, arg); await p.evaluate(() => Pages.refresh('friends')); await p.waitForTimeout(900) }
const SAVE = `window.__bk = { f: FRIENDS.map((x) => ({ ...x })), v: VOICE.map((x) => ({ ...x })) }`
const RESTORE = () => { FRIENDS.splice(0, FRIENDS.length, ...window.__bk.f.map((x) => ({ ...x }))); VOICE.splice(0, VOICE.length, ...window.__bk.v.map((x) => ({ ...x }))) }
const fake = (id, n, o = {}) => ({ id, n, hue: (id.length * 53) % 360, avatar: null, st: 'offline', on: 'Steam', member: false, game: null, gameName: null, activity: null, device: null, seen: '', since: '', voice: null, voiceId: null, join: false, raw: { id, platform: 'steam', lastSeen: Date.now() }, ...o })
const ST = { tactique: ['#d89c79', '#130c05', 50], stade: ['#3ddc84', '#06140b', 54], neon: ['#ff2bd6', '#1a0013', 52], epique: ['#c9a14a', '#140d02', 56], pop: ['#ff9a1f', '#2a1500', 54], vitesse: ['#4fa3ff', '#04101f', 52], frisson: ['#c0392b', '#fff', 52] }
const hero = (p) => p.evaluate(() => ({ name: document.querySelector('.am-c-name')?.title, eye: document.querySelector('.am-c-hero .am-c-eye')?.textContent, main: document.querySelector('.am-c-cta .gs-btn')?.textContent.trim().replace(/\s+/g, ' ') || null, sel: S.friend }))

// Rien de la page sous la barre du bas, et la page elle-même ne défile pas
const fit = (p) => p.evaluate(() => {
  const barTop = document.querySelector('#bar').getBoundingClientRect().top
  const els = [...document.querySelectorAll('.am-c-card, .am-c-hero, .am-c-duo, .am-c-shelf, .am-c-fil button, .am-c-voice, .am-tools > *, .am-c-hero .gs-btn')].filter((e) => !e.hidden && e.offsetParent !== null || e.matches('.am-c-card'))
  const under = els.filter((e) => e.getBoundingClientRect().bottom > barTop + 1).map((e) => e.className.toString().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().bottom))
  const sc = document.querySelector('#sc-friends'), shelf = document.querySelector('.am-c-shelf').getBoundingClientRect()
  const h = document.querySelector('.am-c-hero').getBoundingClientRect(), d = document.querySelector('.am-c-duo')?.getBoundingClientRect()
  const box = document.querySelector('.am-c').getBoundingClientRect()
  const outside = [...document.querySelectorAll('.am-c-hero, .am-c-hero > *, .am-c-hero .am-c-cta > *, .am-c-duo, .am-c-voice, .am-c-chip, .am-c-notes, .am-c-note, .am-c-shelf, .am-c-fil, .am-tools, .am-tools > *')].filter((e) => e.offsetParent !== null).filter((e) => { const r = e.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > barTop + 1 }).map((e) => e.className.toString().slice(0, 24))
  return { barTop: Math.round(barTop), under, outside, docScroll: document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1, scScroll: sc.scrollHeight > sc.clientHeight + 1 || sc.scrollWidth > sc.clientWidth + 1, heroOver: h.bottom > shelf.top + 1, duoOver: d ? d.bottom > shelf.top + 1 : false, heroInner: (() => { const e = document.querySelector('.am-c-hero'); return e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2 })() }
})
const fitOk = async (p, t) => { const r = await fit(p); ok(r.under.length === 0 && r.outside.length === 0 && !r.docScroll && !r.scScroll && !r.heroOver && !r.duoOver && !r.heroInner, `${t} : rien sous la barre (haut de barre ${r.barTop}), la page ne défile pas, héros et panneau au-dessus de l’étagère, héros sans rognure (${JSON.stringify(r)})`) }

;(async () => {
  const { app, p, errs } = await start({ name: 'amisc' })
  let fail = null
  try {
    await p.evaluate(() => localStorage.removeItem('pxv3-amis')); await p.reload(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(8000)
    await go(p, 'friends'); await p.waitForTimeout(1500)
    // ---- le choix de la disposition
    let sw = await p.evaluate(() => ({ a: document.querySelector('[data-lay=a]').getAttribute('aria-pressed'), c: document.querySelector('[data-lay=c]').getAttribute('aria-pressed'), key: localStorage.getItem('pxv3-amis'), page: !!document.querySelector('.am-page:not(.am-solo)') }))
    ok(sw.a === 'true' && sw.c === 'false' && sw.page && sw.key !== 'c', `défaut : Escouades (aria-pressed a=${sw.a} c=${sw.c}, stockage ${sw.key})`)
    await p.fill('#frQ', 'pi'); await p.waitForTimeout(300)
    const pix = await p.evaluate(() => { const b = document.querySelector('.am-mini[data-id]:not([hidden])'); b.click(); return { id: b.dataset.id, n: b.querySelector('b').textContent } })
    await p.waitForTimeout(700)
    await p.click('[data-lay=c]'); await p.waitForTimeout(1500)
    sw = await p.evaluate(() => ({ a: document.querySelector('[data-lay=a]').getAttribute('aria-pressed'), c: document.querySelector('[data-lay=c]').getAttribute('aria-pressed'), key: localStorage.getItem('pxv3-amis'), q: document.querySelector('#frQ').value, sel: S.friend, focus: document.activeElement.dataset.lay, portraits: !!document.querySelector('.am-c') }))
    ok(sw.c === 'true' && sw.a === 'false' && sw.key === 'c' && sw.portraits, `bascule vers Portraits : aria-pressed, stockage « ${sw.key} »`)
    ok(sw.q === 'pi' && sw.sel === pix.id && sw.focus === 'c', `Portraits : recherche « ${sw.q} », sélection ${sw.sel} et focus sur le choix gardés`)
    const h0 = await hero(p)
    ok(h0.name === pix.n, `Portraits : le héros montre l’ami choisi (${h0.name})`)
    await p.click('[data-lay=a]'); await p.waitForTimeout(1500)
    sw = await p.evaluate(() => ({ a: document.querySelector('[data-lay=a]').getAttribute('aria-pressed'), key: localStorage.getItem('pxv3-amis'), q: document.querySelector('#frQ').value, sel: S.friend, focus: document.activeElement.dataset.lay, dossier: document.querySelector('.am-ds-nm h2')?.textContent }))
    ok(sw.a === 'true' && sw.key === 'a' && sw.q === 'pi' && sw.sel === pix.id && sw.focus === 'a' && sw.dossier === pix.n, `retour à Escouades : stockage « ${sw.key} », recherche, sélection (${sw.dossier}) et focus gardés`)
    await p.fill('#frQ', ''); await p.waitForTimeout(300)
    // ---- le choix survit à un rechargement ; une valeur inconnue retombe sur Escouades
    await p.click('[data-lay=c]'); await p.waitForTimeout(800)
    await p.reload(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(9000)
    await go(p, 'friends'); await p.waitForTimeout(1500)
    ok(await p.evaluate(() => !!document.querySelector('.am-c') && document.querySelector('[data-lay=c]').getAttribute('aria-pressed') === 'true'), 'après rechargement de l’appli : Portraits toujours choisi')
    await p.evaluate(() => localStorage.setItem('pxv3-amis', 'zzz'))
    await p.reload(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(9000)
    await go(p, 'friends'); await p.waitForTimeout(1500)
    ok(await p.evaluate(() => !!document.querySelector('.am-page') && !document.querySelector('.am-c') && document.querySelector('[data-lay=a]').getAttribute('aria-pressed') === 'true'), 'valeur stockée inconnue : retombe sur Escouades')
    await p.click('[data-lay=c]'); await p.waitForTimeout(1500)
    await p.evaluate(SAVE); await p.evaluate(`window.__fake = ${fake.toString()}`)

    for (const [w, h] of [[1600, 940], [1280, 720]]) {
      const t = String(w)
      await resize(app, p, w, h)
      await redraw(p, () => { S.friend = FRIENDS.find((f) => f.st === 'game' && !f.member).id })
      await shot(p, `amis-c-${t}-1-soiree`)
      await fitOk(p, `${t} soirée`)
      const st = await p.evaluate(() => ({ cards: document.querySelectorAll('.am-c-card').length, friends: FRIENDS.length, groups: [...document.querySelectorAll('.am-c-gh span')].map((x) => x.textContent), pressed: document.querySelectorAll('.am-c-card[aria-pressed=true]').length, rooms: VOICE.length, chips: document.querySelectorAll('.am-c-chip').length, chipIds: [...document.querySelectorAll('.am-c-chip')].map((c) => c.dataset.voice), roomIds: VOICE.slice(0, 2).map((r) => r.id), more: !!document.querySelector('.am-c-more') }))
      console.log(JSON.stringify(st))
      ok(st.cards === st.friends && st.pressed === 1, `${t} : ${st.cards} cartes pour ${st.friends} amis, une seule sélectionnée`)
      ok(st.rooms > 0 && st.chips === Math.min(2, st.rooms) && st.chipIds.join() === st.roomIds.join(), `${t} : une pastille par salon vocal (${st.chips}/${st.rooms}), chacune ouvre son salon (data-voice)`)
      // le bouton principal et le héros
      const hh = await hero(p)
      ok(/^Lancer /.test(hh.main || ''), `${t} : ami en jeu -> bouton principal « ${hh.main} » (.gs-btn)`)
      const btn = await p.evaluate(() => { const b = document.querySelector('.am-c-cta .gs-btn'); return { h: Math.round(b.getBoundingClientRect().height), gs: !!b.closest('[data-gs]') } })
      ok(btn.h === 44 && !btn.gs, `${t} : sans style de jeu, pastille neutre de 44 px (${btn.h})`)
      // clic sur une carte
      const other = await p.evaluate(() => { const cs = [...document.querySelectorAll('.am-c-card')]; const c = cs.find((x) => x.dataset.id !== S.friend && x.querySelector('b').textContent === 'Pixel') || cs.find((x) => x.dataset.id !== S.friend); c.click(); return { id: c.dataset.id, n: c.title } })
      await p.waitForTimeout(900)
      const h1 = await hero(p)
      const pr = await p.evaluate(() => ({ pressed: [...document.querySelectorAll('.am-c-card[aria-pressed=true]')].map((c) => c.dataset.id), panel: document.querySelector('.am-c-duo')?.textContent.slice(0, 40) || '(aucun)' }))
      ok(h1.name === other.n && h1.name !== hh.name && pr.pressed.join() === other.id, `${t} : clic sur la carte ${other.n} -> héros « ${h1.name} » (avant « ${hh.name} »), panneau « ${pr.panel} »`)
      await shot(p, `amis-c-${t}-2-carte`)
      ok(/^Écrire$/.test(h1.main || ''), `${t} : ami Steam hors jeu -> bouton principal « ${h1.main} »`)
      // membre en vocal sans jeu : « Ouvrir le salon », panneau avec les gens du salon
      const mem = await p.evaluate(() => { const f = FRIENDS.find((x) => x.member && x.st !== 'game' && x.voiceId); document.querySelector(`.am-c-card[data-id="${f.id}"]`).click(); return f.n })
      await p.waitForTimeout(900)
      const hm = await hero(p), room = await p.evaluate(() => [...document.querySelectorAll('.am-c-duo .am-mini')].length)
      ok(hm.main === 'Ouvrir le salon' && room >= 2, `${t} : membre en vocal (${mem}) -> « ${hm.main} », ${room} personnes du salon listées dans le panneau`)
      const click2 = await p.evaluate(() => { const m = [...document.querySelectorAll('.am-c-duo .am-mini')].find((x) => x.dataset.id !== S.friend); m.click(); return m.dataset.id })
      await p.waitForTimeout(900)
      ok((await hero(p)).sel === click2, `${t} : clic sur une personne du salon dans le panneau -> elle est sélectionnée`)
      // ami rejoignable
      await redraw(p, () => { const f = FRIENDS.find((x) => x.st === 'game' && !x.member); f.join = true; S.friend = f.id })
      const hj = await hero(p)
      ok(hj.main === 'Rejoindre sa partie', `${t} : ami rejoignable -> « ${hj.main} »`)
      await p.evaluate(RESTORE)
      // flèches
      await redraw(p, () => { S.friend = FRIENDS.find((f) => f.st === 'game').id })
      await p.evaluate(() => document.querySelector('.am-c-card.on').focus())
      const order = await p.evaluate(() => [...document.querySelectorAll('.am-c-card')].map((c) => c.dataset.id))
      const i0 = order.indexOf(await p.evaluate(() => S.friend))
      await p.keyboard.press('ArrowRight'); await p.waitForTimeout(700)
      const r1 = await p.evaluate(() => ({ sel: S.friend, focus: document.activeElement.dataset.id, h: document.querySelector('.am-c-name').title }))
      ok(r1.sel === order[i0 + 1] && r1.focus === r1.sel, `${t} : flèche droite -> sélection suivante (${r1.h}), focus gardé sur la carte ${JSON.stringify({ r1, i0, next: order[i0 + 1] })}`)
      await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(700)
      const r2 = await p.evaluate(() => ({ sel: S.friend, focus: document.activeElement.dataset.id }))
      ok(r2.sel === order[i0] && r2.focus === r2.sel, `${t} : flèche gauche -> retour à la carte précédente`)
      // filtres
      for (const [k, label] of [['', 'Tous'], ['game', 'En jeu'], ['on', 'En ligne'], ['mem', 'Serveur'], ['off', 'Hors ligne']]) {
        await p.click(`[data-fil="${k}"]`); await p.waitForTimeout(500)
        const f = await p.evaluate(() => ({ txt: document.querySelector('[data-fil][aria-pressed=true]').textContent, cards: document.querySelectorAll('.am-c-g:not([hidden]) .am-c-card:not([hidden])').length, pressed: document.querySelectorAll('[data-fil][aria-pressed=true]').length }))
        // les nombres attendus sont recalculés à partir de FRIENDS, pas lus sur la pastille
        const n = await p.evaluate((k) => ({ '': FRIENDS.length, game: FRIENDS.filter((f) => f.st === 'game').length, on: FRIENDS.filter((f) => !f.member && (f.st === 'online' || f.st === 'away')).length, mem: FRIENDS.filter((f) => f.member && f.st !== 'game').length, off: FRIENDS.filter((f) => !f.member && f.st === 'offline').length }[k]), k)
        const lab = k ? +f.txt.match(/(\d+)$/)[1] : n
        ok(f.cards === n && lab === n && f.pressed === 1 && f.txt.startsWith(label), `${t} : filtre « ${f.txt} » -> ${f.cards} cartes, pastille ${lab}, attendu ${n} (calculé sur FRIENDS)`)
      }
      await p.click('[data-fil=""]'); await p.waitForTimeout(400)
      // recherche
      const tot = await p.evaluate(() => document.querySelectorAll('.am-c-g:not([hidden]) .am-c-card:not([hidden])').length)
      await p.fill('#frQ', 'ka'); await p.waitForTimeout(500)
      const s1 = await p.evaluate(() => ({ vis: [...document.querySelectorAll('.am-c-card:not([hidden])')].map((c) => c.dataset.n), hid: document.querySelectorAll('.am-c-card[hidden]').length, groups: [...document.querySelectorAll('.am-c-g')].map((g) => ({ hidden: g.hidden, vis: g.querySelectorAll('.am-c-card:not([hidden])').length })) }))
      ok(s1.vis.length > 0 && s1.vis.length < tot && s1.vis.every((n) => n.includes('ka')) && s1.groups.every((g) => g.hidden === (g.vis === 0)) && s1.groups.some((g) => g.hidden), `${t} : recherche « ka » ${tot} -> ${s1.vis.length} cartes, groupes vides cachés (${s1.groups.filter((g) => g.hidden).length})`)
      await shot(p, `amis-c-${t}-3-recherche`)
      await p.fill('#frQ', 'zzzzqq'); await p.waitForTimeout(400)
      ok(await p.evaluate(() => !document.querySelector('#frNone').hidden && document.querySelectorAll('.am-c-g:not([hidden])').length === 0), `${t} : aucun résultat -> message et tous les groupes cachés`)
      await p.fill('#frQ', ''); await p.waitForTimeout(300)

      // soirée calme : « En jeu 0 » -> « Personne ici pour l’instant. »
      await redraw(p, () => { FRIENDS.forEach((f) => { if (f.st === 'game') { f.st = 'online'; f.join = false; f.game = null; f.gameName = null } }) })
      await p.click('[data-fil=game]'); await p.waitForTimeout(500)
      const z = await p.evaluate(() => ({ txt: document.querySelector('[data-fil=game]').textContent, msg: document.querySelector('.am-c-0')?.textContent, cards: document.querySelectorAll('.am-c-g:not([hidden]) .am-c-card:not([hidden])').length }))
      ok(z.txt === 'En jeu 0' && z.msg === 'Personne ici pour l’instant.' && z.cards === 0, `${t} : calme, filtre « ${z.txt} » -> « ${z.msg} »`)
      await p.click('[data-fil=""]'); await p.waitForTimeout(500)
      await shot(p, `amis-c-${t}-4-calme`); await fitOk(p, `${t} calme`)
      await p.evaluate(RESTORE)

      // nom de 41 caractères
      await redraw(p, () => { const f = FRIENDS.find((x) => x.st === 'game' && !x.member); S.friend = f.id; f.n = 'Pierre-Alexandre_de_la_Tour_d_Auvergne_93'; f.avatar = null })
      const L = await p.evaluate(() => { const n = document.querySelector('.am-c-name'), c = document.querySelector('.am-c-card.on b'); return { title: n.title, len: n.title.length, over: n.scrollWidth > n.clientWidth + 1, hero: document.querySelector('.am-c-hero').scrollWidth > document.querySelector('.am-c-hero').clientWidth + 2, cardTitle: document.querySelector('.am-c-card.on').title, cardCut: c.scrollWidth > c.clientWidth } })
      ok(L.len === 41 && L.cardTitle === L.title && L.cardCut && L.over && !L.hero, `${t} : nom de 41 caractères : title posé, nom et carte coupés par ellipsis (L.over=${L.over}), héros sans débordement`)
      await shot(p, `amis-c-${t}-5-nom-long`); await fitOk(p, `${t} nom long`)
      await p.evaluate(RESTORE)

      // 60 hors ligne + 20 en ligne + 20 membres
      await redraw(p, () => {
        for (let i = 0; i < 60; i++) FRIENDS.push(window.__fake('off' + i, 'Ami hors ligne ' + (i + 1), { seen: 'Vu il y a ' + (i + 1) + ' h', raw: { id: 'off' + i, platform: 'steam', lastSeen: Date.now() - (i + 1) * 3600000 } }))
        for (let i = 0; i < 20; i++) FRIENDS.push(window.__fake('on' + i, 'Ami en ligne ' + (i + 1), { st: 'online' }))
        for (let i = 0; i < 20; i++) FRIENDS.push(window.__fake('mb' + i, 'Membre ' + (i + 1), { st: 'online', member: true, on: 'Discord', raw: { id: 'mb' + i, platform: 'discord' } }))
        S.friend = 'off59'
      })
      const sh = await p.evaluate(() => { const r = document.querySelector('#cRow'), c = document.querySelector('.am-c-card.on'), rr = r.getBoundingClientRect(), cr = c.getBoundingClientRect(); return { scrolls: r.scrollWidth > r.clientWidth + 50, x: r.scrollLeft, vis: cr.left >= rr.left - 1 && cr.right <= rr.right + 1, cards: document.querySelectorAll('.am-c-card').length, sel: c.title } })
      ok(sh.scrolls && sh.vis && sh.cards >= 100, `${t} : ${sh.cards} cartes, l’étagère défile (scrollLeft ${Math.round(sh.x)}), la carte choisie (${sh.sel}) est visible`)
      await p.evaluate(() => { document.querySelector('#cRow').scrollLeft = 0 }); await p.waitForTimeout(200)
      const rb = await p.evaluate(() => { const r = document.querySelector('#cRow').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
      await p.mouse.move(rb[0], rb[1]); await p.mouse.wheel(0, 500); await p.waitForTimeout(500)
      const wh = await p.evaluate(() => ({ x: document.querySelector('#cRow').scrollLeft, docY: document.scrollingElement.scrollTop, moved: ['#sc-friends', '.am-c', '.am-c-stage', '.am-c-hero'].map((q) => document.querySelector(q)).some((e) => e.scrollTop !== 0 || e.scrollLeft !== 0) }))
      ok(wh.x > 100 && wh.docY === 0 && !wh.moved, `${t} : la molette verticale fait défiler l’étagère de côté (scrollLeft ${Math.round(wh.x)}), la page, la scène et le héros ne bougent pas`)
      await fitOk(p, `${t} après la molette`)
      // le défilement est gardé quand on change de sélection (relecture)
      const kept = await p.evaluate(() => { const x = document.querySelector('#cRow').scrollLeft; Pages.refresh('friends'); return x })
      await p.waitForTimeout(800)
      const kept2 = await p.evaluate(() => document.querySelector('#cRow').scrollLeft)
      ok(Math.abs(kept - kept2) <= 2, `${t} : position de l’étagère gardée après relecture (${Math.round(kept)} -> ${Math.round(kept2)})`)
      await shot(p, `amis-c-${t}-6-120-cartes`); await fitOk(p, `${t} 120 cartes`)
      await p.evaluate(RESTORE)

      // profil Steam simulé, public puis privé
      const info = await p.evaluate(async () => {
        const gs = GAMES.filter((g) => /^steam:\d+$/.test(g.rid || '')).slice(0, 10)
        const f = FRIENDS.find((x) => x.st === 'game' && !x.member), id = 'steam:76561198000000042'
        f.id = id; f.raw = { ...f.raw, id, platform: 'steam' }; S.friend = id
        window.__prof = { level: 42, levelProgress: .64, gameCount: 213, totalMinutes: 4870 * 60, badgeCount: 38, friendCount: 96, country: 'FR', memberSince: Date.parse('2014-05-01'), background: null, avatarFull: null,
          games: gs.map((g, i) => ({ appId: +g.rid.split(':')[1], name: g.name, minutes: (i + 1) * 5400 })), recent: gs.slice(0, 2).map((g) => ({ appId: +g.rid.split(':')[1], name: g.name, recentMinutes: 600 })) }
        window.__rf = window.__rf || Real.friendProfile; window.__rc = window.__rc || Real.cachedProfile
        Real.friendProfile = async () => window.__prof; Real.cachedProfile = () => window.__prof
        return { n: gs.length }
      })
      await p.evaluate(() => Pages.refresh('friends')); await p.waitForTimeout(1500)
      const sp = await p.evaluate(() => ({ pills: [...document.querySelectorAll('.am-c-pill')].map((x) => x.textContent.trim().replace(/\s+/g, ' ')), meta: document.querySelector('.am-c-meta')?.textContent, title: document.querySelector('.am-c-duo .am-c-eye')?.textContent, duel: document.querySelectorAll('.am-c-duo .am-du').length, more: document.querySelector('#fcCom')?.textContent, rec: document.querySelectorAll('.am-c-duo .am-rec li').length }))
      ok(sp.pills.some((x) => /Niveau 42/.test(x)) && sp.pills.some((x) => /213 jeux/.test(x)) && sp.pills.some((x) => /4 ?870 h de jeu/.test(x)) && sp.pills.some((x) => /38 badges/.test(x)) && /France · Membre depuis 2014/.test(sp.meta) && sp.title === 'Vous deux' && sp.duel === 3 && sp.more === `Voir les ${info.n} jeux en commun` && sp.rec === 2, `${t} : profil public -> pastilles ${sp.pills.join(' | ')}, « ${sp.title} », 3 jeux en commun puis « ${sp.more} », 2 récents`)
      await p.click('#fcCom'); await p.waitForTimeout(500)
      ok((await p.evaluate(() => document.querySelectorAll('.am-c-duo .am-du').length)) === Math.min(8, info.n), `${t} : le lien déplie ${Math.min(8, info.n)} jeux en commun`)
      await shot(p, `amis-c-${t}-7-profil-public`); await fitOk(p, `${t} profil public`)
      await p.evaluate(() => { window.__prof = { ...window.__prof, avatarFull: 'data:image/png;base64,AAAA', avatarFrame: 'data:image/png;base64,AAAA' }; Pages.refresh('friends') }); await p.waitForTimeout(1500)
      ok(await p.evaluate(() => !document.querySelector('.am-c-id .am-ds-img') && !!document.querySelector('.am-c-id .am-ds-av .av') && (!document.querySelector('.am-ds-fr') || getComputedStyle(document.querySelector('.am-ds-fr')).display === 'none')), `${t} : avatar illisible -> initiales, cadre masqué`)
      await p.evaluate(() => { window.__prof = { gamesHidden: true, country: 'FR' }; Pages.refresh('friends') }); await p.waitForTimeout(1500)
      const pv = await p.evaluate(() => ({ note: [...document.querySelectorAll('.am-c-duo .am-note')].map((x) => x.textContent), pills: document.querySelectorAll('.am-c-pill').length, duel: document.querySelectorAll('.am-c-duo .am-du').length, title: document.querySelector('.am-c-duo .am-c-eye')?.textContent }))
      ok(pv.note.includes('Son profil Steam est privé : ses jeux et ses heures ne sont pas visibles.') && pv.pills === 0 && pv.duel === 0 && pv.title === 'Ce qu’on sait', `${t} : profil privé -> note, aucune pastille, aucun jeu en commun, titre « ${pv.title} »`)
      await shot(p, `amis-c-${t}-8-profil-prive`)
      await p.evaluate(() => { Real.friendProfile = window.__rf; Real.cachedProfile = window.__rc })
      await p.evaluate(RESTORE); await redraw(p, () => {})

      // les 7 styles : le bouton principal du héros prend la forme du bouton « Jouer » de l'accueil
      await redraw(p, () => { S.friend = FRIENDS.find((f) => f.st === 'game' && !f.member).id })
      for (const [st, [acc, on, hgt]] of Object.entries(ST)) {
        await p.evaluate(([st, acc, on]) => { const r = document.querySelector('.am-c'); r.dataset.gs = st; r.style.setProperty('--gs-acc', acc); r.style.setProperty('--gs-on', on) }, [st, acc, on])
        await p.waitForTimeout(250)
        const b = await p.evaluate(() => { const e = document.querySelector('.am-c-cta .gs-btn'); const r = e.getBoundingClientRect(); return { h: Math.round(r.height), host: e.closest('[data-gs]')?.dataset.gs } })
        ok(b.h === hgt && b.host === st, `${t} : style ${st} -> bouton principal ${b.h} px (attendu ${hgt})`)
        if (st === 'tactique' || st === 'stade') { await shot(p, `amis-c-${t}-9-style-${st}`); await fitOk(p, `${t} style ${st}`) }
      }
      await redraw(p, () => {})

      // état vide
      await p.evaluate(RESTORE)
      await redraw(p, () => { FRIENDS.splice(0, FRIENDS.length); VOICE.splice(0, VOICE.length) })
      const e = await p.evaluate(() => ({ empty: !!document.querySelector('.am-solo .empty'), btn: document.querySelector('#frAcc')?.className, h: document.querySelector('#frAcc')?.getBoundingClientRect().height, sw: !!document.querySelector('[data-lay]') }))
      ok(e.empty && e.btn === 'gs-btn' && e.h === 44 && !e.sw, `${t} : état vide partagé (bouton neutre 44 px, pas de choix de disposition sans ami)`)
      await shot(p, `amis-c-${t}-10-vide`)
      await p.evaluate(RESTORE); await redraw(p, () => {})
    }
  } catch (e) { fail = e; console.log(e.message.split('\n').slice(0, 4).join(' ')) }
  console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  await app.close()
  if (fail || errs.length) process.exit(1)
})()
