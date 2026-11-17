// Page Amis « Escouades » : la vraie fenêtre en mode démo, 1600×940 puis 1280×720. Chaque contrôle est une vraie assertion :
// la moindre erreur de page ou le moindre échec termine le processus avec un code non nul.
const { start, shot, go } = require('./h.cjs')
const ok = (c, m) => { if (!c) throw new Error('ÉCHEC : ' + m); console.log('ok  ', m) }
const resize = async (app, p, w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]); await p.waitForTimeout(1800) }
const redraw = async (p, fn) => { await p.evaluate(fn); await p.evaluate(() => Pages.refresh('friends')); await p.waitForTimeout(900) }
const SAVE = `window.__bk = { f: FRIENDS.map((x) => ({ ...x })), v: VOICE.map((x) => ({ ...x })) }`
const RESTORE = () => { FRIENDS.splice(0, FRIENDS.length, ...window.__bk.f.map((x) => ({ ...x }))); VOICE.splice(0, VOICE.length, ...window.__bk.v.map((x) => ({ ...x }))) }
const fake = (id, n, o = {}) => ({ id, n, hue: (id.length * 53) % 360, avatar: null, st: 'offline', on: 'Steam', member: false, game: null, gameName: null, activity: null, device: null, seen: '', since: '', voice: null, voiceId: null, join: false, raw: { platform: 'steam', lastSeen: Date.now() }, ...o })

// Aucun avatar de repli de la page n'est rose : la teinte (haut et bas du dégradé) reste dans 20..250
const hueAvatars = async (p, t) => {
  const r = await p.evaluate(() => {
    const H = (rgb) => { const [r, g, b] = rgb.map((x) => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return -1; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return h < 0 ? h + 360 : h }
    const av = [...document.querySelectorAll('#sc-friends .av')]
    const hs = av.map((e) => (getComputedStyle(e).backgroundImage.match(/rgb\((\d+), (\d+), (\d+)\)/g) || []).map((x) => H(x.match(/\d+/g).map(Number))))
    return { hs: hs.map((h) => h.join('/')), n: av.length, bad: hs.filter((h) => h.length < 2 || h.some((x) => x < 19 || x > 251)).length, zones: [...new Set(av.map((e) => e.closest('.am-sq-p, .am-bc, .am-calm, .am-ds, .am-stk, .am-c-chip, .am-c-duo')?.className.toString().split(' ')[0]))].join(',') }
  })
  console.log(JSON.stringify(r.hs)); ok(r.n > 0 && r.bad === 0, `${t} : ${r.n} avatars de repli (${r.zones}), teinte du dégradé dans 20..250 (hors bande : ${r.bad})`)
}
async function pass(p, app, w, h) {
  const t = `${w}`
  await resize(app, p, w, h)
  await go(p, 'friends'); await p.waitForTimeout(1500); await shot(p, `amis-${t}-1-soiree`)
  const st = await p.evaluate(() => {
    const lanes = [...document.querySelectorAll('.am-sq:not(.am-calm)')]
    return {
      friends: FRIENDS.length, inGame: FRIENDS.filter((f) => f.st === 'game').length, lanes: lanes.length,
      // ce que chaque rangée doit montrer, calculé depuis les données, et ce qu'elle montre
      laneInfo: lanes.map((l) => {
        const g = l.dataset.lane ? G(l.dataset.lane) : null
        const list = FRIENDS.filter((f) => f.st === 'game' && (f.gameName || '?') === l.querySelector('h2').title)
        const j = list.find((f) => f.join), dev = list.find((f) => f.device)
        const want = j ? 'Rejoindre ' + j.n : g && g.installed ? 'Lancer ' + g.short : dev ? 'Il joue sur ' + dev.device : ''
        const b = l.querySelector('.gs-btn'), d = l.querySelector('.am-dev')
        const got = b ? b.textContent.trim().replace(/\s+/g, ' ') : d ? d.textContent.trim() : ''
        return { want, got, players: l.querySelectorAll('.am-pl').length, expectPlayers: list.length, nBtn: l.querySelectorAll('.gs-btn').length, gs: l.dataset.gs || 'neutre', h: b ? Math.round(b.getBoundingClientRect().height) : 0, title: l.querySelector('h2').textContent }
      }),
      title: document.querySelector('.am-title').textContent, h1: document.querySelector('h1.am-title').outerHTML,
      cols: [...document.querySelectorAll('.am-bh span')].map((x) => x.textContent), dossier: document.querySelector('.am-ds-nm h2')?.textContent,
      cut: [...document.querySelectorAll('.am-pt small span, .am-pt b')].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent),
      plMax: Math.max(...[...document.querySelectorAll('.am-sq-p .am-pl')].map((x) => x.getBoundingClientRect().width))
    }
  })
  console.log(JSON.stringify(st))
  ok(st.friends > 0 && st.lanes > 0 && st.lanes === new Set(st.laneInfo.map((l) => l.title)).size, `${t} : ${st.lanes} rangées pour ${st.inGame} en jeu`)
  ok(st.laneInfo.every((l) => l.got === l.want && l.nBtn <= 1 && l.players === l.expectPlayers), `${t} : chaque rangée montre son action attendue (${st.laneInfo.map((l) => l.got || 'rien').join(' | ')}) et ses joueurs`)
  ok(st.laneInfo.filter((l) => l.nBtn).every((l) => (l.gs === 'neutre' ? l.h === 44 : l.h >= 50)), `${t} : bouton neutre à 44 px ou stylé (data-gs)`)
  ok(!/en jeu\d/.test(st.title) && !/<span|role=/.test(st.h1), `${t} : le h1 ne contient pas la ligne de sous-titre (« ${st.title} »)`)
  ok(st.cut.length === 0 && st.plMax <= 301, `${t} : aucune ligne de joueur coupée (largeur max ${Math.round(st.plMax)} px, coupées : ${st.cut.join(',') || 'aucune'})`)
  // clic sur un joueur : la fiche change
  const cur = await p.evaluate(() => document.querySelector('.am-ds-nm h2')?.textContent)
  const other = await p.evaluate((c) => { const b = [...document.querySelectorAll('.am-pl')].find((x) => x.querySelector('b').textContent !== c); b.click(); return b.querySelector('b').textContent }, cur)
  await p.waitForTimeout(900)
  const after = await p.evaluate(() => ({ h: document.querySelector('.am-ds-nm h2')?.textContent, pressed: [...document.querySelectorAll('[aria-pressed=true][data-id]')].map((x) => x.dataset.id) }))
  ok(after.h === other && cur !== other, `${t} : clic sur ${other}, la fiche passe de ${cur} à ${after.h}`)
  ok(after.pressed.length === 1, `${t} : un seul joueur aria-pressed (${after.pressed})`)
  await shot(p, `amis-${t}-2-fiche`)
  await hueAvatars(p, `${t} soirée et dossier`)
  // recherche
  const total = await p.evaluate(() => document.querySelectorAll('[data-n]:not([hidden])').length)
  await p.fill('#frQ', other.slice(0, 3).toLowerCase()); await p.waitForTimeout(500)
  const f1 = await p.evaluate(() => ({ vis: [...document.querySelectorAll('[data-n]:not([hidden])')].map((x) => x.dataset.n) }))
  ok(f1.vis.length > 0 && f1.vis.length < total && f1.vis.every((n) => n.includes(other.slice(0, 3).toLowerCase())), `${t} : recherche « ${other.slice(0, 3)} » ${total} -> ${f1.vis.length} visibles`)
  await shot(p, `amis-${t}-3-recherche`)
  await p.fill('#frQ', 'zzzzqq'); await p.waitForTimeout(400)
  const f2 = await p.evaluate(() => ({ none: !document.querySelector('#frNone').hidden, sq: document.querySelectorAll('.am-sq:not([hidden])').length, bc: document.querySelectorAll('.am-bc:not([hidden])').length }))
  ok(f2.none && f2.sq === 0 && f2.bc === 0, `${t} : aucun résultat, rangées et colonnes cachées`)
  await shot(p, `amis-${t}-4-aucun`)
  await p.click('#frClr'); await p.waitForTimeout(400)
  ok(await p.evaluate(() => document.querySelector('#frQ') === document.activeElement && document.querySelector('#frQ').value === ''), `${t} : « Effacer la recherche » vide et redonne le focus`)
  // clavier
  await p.evaluate(() => document.querySelector('#frQ')?.focus())
  const seen = new Set()
  for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); seen.add(await p.evaluate(() => { const e = document.activeElement; return e.classList[0] || e.tagName })) }
  console.log('tab a visité', [...seen].join(','))
  ok(['am-ic', 'am-pl', 'gs-btn', 'am-lk', 'am-mini'].every((c) => seen.has(c)), `${t} : Tab atteint refresh, joueurs, boutons, liens, colonnes`)
  await p.evaluate(() => document.querySelector('.am-ds .gs-btn')?.focus()); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); await p.waitForTimeout(200); await shot(p, `amis-${t}-6-focus`)
  const ring = await p.evaluate(() => { const c = getComputedStyle(document.activeElement); return { o: c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor, off: c.outlineOffset } })
  ok(/solid 2px rgb\(255, 255, 255\)/.test(ring.o) && ring.off === '3px', `${t} : focus visible du .gs-btn (${ring.o}, décalage ${ring.off})`)
}

const caps = (p) => p.evaluate(() => ({
  rows: (() => { const r = {}; document.querySelectorAll('.am-bc').forEach((c) => { r[c.querySelector('.am-bh span').textContent] = { rows: c.querySelectorAll('.am-mini:not([hidden])').length, link: c.querySelector('[data-act=cap]')?.textContent || null, linkHidden: c.querySelector('[data-act=cap]')?.hidden } }); return r })()
}))

;(async () => {
  const { app, p, errs } = await start({ name: 'amis' })
  let fail = null
  try {
    await pass(p, app, 1600, 940)
    await pass(p, app, 1280, 720)
    await p.evaluate(SAVE); await p.evaluate(`window.__fake = ${fake.toString()}`)
    for (const [w, h] of [[1600, 940], [1280, 720]]) {
      await resize(app, p, w, h)
      // calme
      await redraw(p, () => { FRIENDS.forEach((f) => { if (f.st === 'game') { f.st = 'online'; f.join = false; f.game = null; f.gameName = null } }) })
      const c = await p.evaluate(() => ({ calm: !!document.querySelector('.am-calm'), t: document.querySelector('.am-title').textContent, banner: document.querySelector('.am-calm h2').textContent, big: document.querySelectorAll('.am-calm .am-pl').length, online: FRIENDS.filter((f) => !f.member && (f.st === 'online' || f.st === 'away')).length }))
      console.log(JSON.stringify(c)); ok(c.calm && /^Soirée calme/.test(c.t) && c.big === c.online, `${w} : état calme forcé (${c.big} amis en gros boutons)`)
      await shot(p, `amis-${w}-7-calme`)
      await hueAvatars(p, `${w} calme`)
      if (w === 1600) {
        // alerte : la phrase du bandeau suit tout de suite, la sélection reste
        const A = await p.evaluate(() => { const b = [...document.querySelectorAll('.am-calm .am-pl')].find((x) => /^steam:/.test(x.dataset.id)); b.click(); return { id: b.dataset.id, n: b.querySelector('b').textContent } })
        await p.waitForTimeout(700)
        const before = await p.evaluate(() => document.querySelector('.am-calm-p').textContent)
        await p.click('#fcWatch'); await p.waitForTimeout(900)
        const w1 = await p.evaluate(() => ({ txt: document.querySelector('.am-calm-p').textContent, sel: document.querySelector('.am-ds-nm h2').textContent, pressed: document.querySelector('#fcWatch').getAttribute('aria-pressed'), y: document.querySelector('.am-main').scrollTop }))
        ok(before.startsWith('Choisis') && w1.txt === `Tu seras prévenu dès que ${A.n} lance un jeu.` && w1.sel === A.n && w1.pressed === 'true', `alerte : phrase du bandeau mise à jour tout de suite (« ${w1.txt} »), sélection gardée`)
        await p.click('#fcWatch'); await p.waitForTimeout(900)
        ok((await p.evaluate(() => document.querySelector('.am-calm-p').textContent)) === before, 'alerte retirée : la phrase du bandeau revient')
        // on change d'ami pendant que l'alerte s'enregistre : la fiche ne doit pas repasser sur l'ancien
        const B = await p.evaluate(() => {
          const bs = [...document.querySelectorAll('.am-calm .am-pl')]; const cur = document.querySelector('.am-ds-nm h2').textContent
          const o = bs.find((x) => x.querySelector('b').textContent !== cur)
          document.querySelector('#fcWatch').click(); o.click(); return o.querySelector('b').textContent
        })
        await p.waitForTimeout(1500)
        ok((await p.evaluate(() => document.querySelector('.am-ds-nm h2').textContent)) === B, `alerte : un clic sur ${B} pendant l'enregistrement garde sa fiche`)
        await p.evaluate(async (id) => { await Real.setWatch(id, false) }, A.id)
        await p.evaluate(async () => { for (const f of FRIENDS) if (Real.watched(f.id)) await Real.setWatch(f.id, false) })
      }
      await p.evaluate(RESTORE)
      // nom long
      await redraw(p, () => { const f = FRIENDS.find((x) => x.st === 'game'); S.friend = f.id; f.n = 'Pierre-Alexandre_de_la_Tour_d_Auvergne_93'; f.avatar = null })
      const L = await p.evaluate(() => { const nodes = [...document.querySelectorAll('.am-pl b, .am-ds-nm h2')].filter((b) => b.textContent.length === 41); return { n: nodes.length, titled: nodes.every((b) => b.title === b.textContent), clipped: nodes.every((b) => b.scrollWidth > b.clientWidth), pageW: document.querySelector('.am-page').scrollWidth <= document.querySelector('.am-page').clientWidth + 1, mainX: document.querySelector('.am-main').scrollWidth <= document.querySelector('.am-main').clientWidth + 1 } })
      ok(L.n >= 2 && L.titled && L.clipped && L.pageW && L.mainX, `${w} : nom de 41 caractères coupé avec title, sans élargir la page`)
      await shot(p, `amis-${w}-8-nom-long`)
      await p.evaluate(RESTORE)
      // grandes listes : 60 hors ligne, 20 en ligne, 20 membres
      await redraw(p, () => {
        for (let i = 0; i < 60; i++) FRIENDS.push(window.__fake('off' + i, 'Ami hors ligne ' + (i + 1), { seen: 'Vu il y a ' + (i + 1) + ' h', raw: { platform: 'steam', lastSeen: Date.now() - (i + 1) * 3600000 } }))
        for (let i = 0; i < 20; i++) FRIENDS.push(window.__fake('on' + i, 'Ami en ligne ' + (i + 1), { st: 'online' }))
        for (let i = 0; i < 20; i++) FRIENDS.push(window.__fake('mb' + i, 'Membre ' + (i + 1), { st: 'online', member: true, on: 'Discord', raw: { platform: 'discord' } }))
      })
      const rowsOf = async () => (await caps(p)).rows
      const nOffCap = 3
      let r = await rowsOf()
      const kOn = Object.keys(r).find((k) => k === 'En ligne'), kMb = Object.keys(r).find((k) => /^Serveur/.test(k)), kOff = 'Hors ligne'
      ok(r[kOn].rows === 8 && r[kOn].link === 'Voir les 23 en ligne' && r[kMb].rows === 8 && /^Voir les \d+ membres$/.test(r[kMb].link) && r[kOff].rows === nOffCap && /^Voir les 63 hors ligne$/.test(r[kOff].link), `${w} : colonnes plafonnées (En ligne ${r[kOn].rows} « ${r[kOn].link} », Serveur ${r[kMb].rows} « ${r[kMb].link} », Hors ligne ${r[kOff].rows} « ${r[kOff].link} »)`)
      for (const [k, tot] of [[kOn, 23], [kMb, +r[kMb].link.match(/\d+/)[0]], [kOff, 63]]) {
        const sel = `.am-bc:has(.am-bh span:text-is("${k}")) [data-act=cap]`
        await p.click(sel); await p.waitForTimeout(300)
        const o = (await rowsOf())[k]
        ok(o.rows === tot && o.link === 'Réduire', `${w} : « ${k} » ouvert, ${o.rows} lignes, lien « ${o.link} »`)
        await p.click(sel); await p.waitForTimeout(300)
        const c2 = (await rowsOf())[k]
        ok(c2.rows === r[k].rows && c2.link === r[k].link, `${w} : « ${k} » réduit, ${c2.rows} lignes, lien « ${c2.link} »`)
      }
      // la recherche ouvre tout
      await p.fill('#frQ', 'ami hors ligne 6'); await p.waitForTimeout(400)
      const sres = await p.evaluate(() => ({ off: document.querySelectorAll('.am-mini.off:not([hidden])').length, links: [...document.querySelectorAll('[data-act=cap]')].every((l) => l.hidden) }))
      ok(sres.off === 2 && sres.links, `${w} : la recherche « ami hors ligne 6 » ouvre les hors ligne au-delà du plafond (${sres.off} visibles) et cache les liens`)
      await p.fill('#frQ', ''); await p.waitForTimeout(300)
      await p.click('.am-bc:has(.am-bh span:text-is("Hors ligne")) [data-act=cap]'); await p.waitForTimeout(300)
      await p.evaluate(() => { const m = document.querySelector('.am-main'); m.scrollTop = m.scrollHeight }); await p.waitForTimeout(400); await shot(p, `amis-${w}-9-60-hors-ligne`)
      await p.click('.am-bc:has(.am-bh span:text-is("Hors ligne")) [data-act=cap]'); await p.waitForTimeout(300)
      await p.evaluate(RESTORE)
      await redraw(p, () => { FRIENDS.splice(0, FRIENDS.length); VOICE.splice(0, VOICE.length) })
      const e = await p.evaluate(() => ({ empty: !!document.querySelector('.am-solo .empty'), btn: document.querySelector('#frAcc')?.className, bg: getComputedStyle(document.querySelector('#frAcc')).backgroundImage, h: document.querySelector('#frAcc').getBoundingClientRect().height }))
      ok(e.empty && e.btn === 'gs-btn' && e.bg === 'none' && e.h === 44, `${w} : état vide, bouton neutre 44 px sans dégradé`)
      await shot(p, `amis-${w}-10-vide`)
      await p.evaluate(RESTORE); await redraw(p, () => {})
    }

    // Fiche avec un vrai profil Steam (simulé : la démo n'en a jamais)
    await p.evaluate(RESTORE); await resize(app, p, 1600, 940)
    const info = await p.evaluate(async () => {
      const gs = GAMES.filter((g) => /^steam:\d+$/.test(g.rid || '')).slice(0, 10)
      const f = FRIENDS.find((x) => x.st === 'game' && !x.member)
      const id = 'steam:76561198000000042'
      f.id = id; f.raw = { ...f.raw, id, platform: 'steam' }; S.friend = id
      window.__prof = { level: 42, levelProgress: .64, gameCount: 213, totalMinutes: 4870 * 60, badgeCount: 38, friendCount: 96, country: 'FR', memberSince: Date.parse('2014-05-01'), background: null, avatarFull: null,
        games: gs.map((g, i) => ({ appId: +g.rid.split(':')[1], name: g.name, minutes: (i + 1) * 5400 })), recent: gs.slice(0, 2).map((g) => ({ appId: +g.rid.split(':')[1], name: g.name, recentMinutes: 600 })) }
      Real.friendProfile = async () => window.__prof; Real.cachedProfile = () => window.__prof
      return { steamGames: gs.length, id, other: FRIENDS.find((x) => x.id !== id && x.st === 'game').id }
    })
    await p.evaluate(() => Pages.refresh('friends')); await p.waitForTimeout(1500)
    const d1 = await p.evaluate(() => ({ lv: !!document.querySelector('.am-ds-lv'), kpi: [...document.querySelectorAll('.am-ds-k dt')].map((x) => x.textContent), common: document.querySelectorAll('.am-du').length, more: document.querySelector('#fcCom')?.textContent, rec: document.querySelectorAll('.am-rec li').length }))
    ok(d1.lv && d1.kpi.includes('Heures de jeu') && d1.common === 3 && d1.more === `Voir les ${info.steamGames} jeux en commun` && d1.rec === 2, `fiche Steam : niveau, chiffres, 3 jeux en commun, lien « ${d1.more} »`)
    await shot(p, 'amis-1600-12-fiche-steam')
    await p.click('#fcCom'); await p.waitForTimeout(500)
    const d2 = await p.evaluate(() => ({ common: document.querySelectorAll('.am-du').length, more: document.querySelector('#fcCom')?.textContent, focus: document.activeElement.id }))
    ok(d2.common === Math.min(8, info.steamGames) && d2.more === 'Réduire' && d2.focus === 'fcCom', `fiche Steam : le lien déplie ${d2.common} jeux (attendu ${Math.min(8, info.steamGames)}), focus gardé (${d2.focus})`)
    // item : le défilement de la fiche survit à une relecture des amis
    await p.evaluate(() => { document.querySelector('.am-ds-sc').scrollTop = 250 }); await p.waitForTimeout(300)
    const y0 = await p.evaluate(() => document.querySelector('.am-ds-sc').scrollTop)
    await p.evaluate(() => Pages.refresh('friends')); await p.waitForTimeout(1200)
    const y1 = await p.evaluate(() => document.querySelector('.am-ds-sc').scrollTop)
    ok(y0 > 0 && Math.abs(y1 - y0) <= 2, `fiche : défilement gardé après relecture (${y0} -> ${y1})`)
    await shot(p, 'amis-1600-13-fiche-steam-bas')
    // item 5 : « jeux en commun » replié dès que la fiche change, par n'importe quel chemin
    await p.evaluate((o) => { S.friend = o; Pages.enter('friends') }, info.other); await p.waitForTimeout(900)
    await p.evaluate((id) => { S.friend = id; Pages.enter('friends') }, info.id); await p.waitForTimeout(1200)
    const d5 = await p.evaluate(() => ({ common: document.querySelectorAll('.am-du').length, more: document.querySelector('#fcCom')?.textContent }))
    ok(d5.common === 3 && /^Voir les/.test(d5.more), `fiche : « jeux en commun » replié après un changement d'ami hors clic (${d5.common} jeux, « ${d5.more} »)`)
    // item 3 : avatar et cadre illisibles
    await p.evaluate(() => { window.__prof = { ...window.__prof, avatarFull: 'data:image/png;base64,AAAA', avatarFrame: 'data:image/png;base64,AAAA' }; Pages.refresh('friends') }); await p.waitForTimeout(1500)
    const d6 = await p.evaluate(() => ({ img: !!document.querySelector('.am-ds-img'), ini: document.querySelector('.am-ds-av .av')?.textContent.trim(), name: document.querySelector('.am-ds-nm h2').textContent, fr: document.querySelector('.am-ds-fr') ? getComputedStyle(document.querySelector('.am-ds-fr')).display : 'absent' }))
    ok(!d6.img && d6.ini === d6.name[0] && (d6.fr === 'none' || d6.fr === 'absent'), `fiche : avatar illisible -> initiales « ${d6.ini} », cadre illisible -> ${d6.fr}`)
    await shot(p, 'amis-1600-14-avatar-illisible')
    // profil privé
    await p.evaluate(() => { window.__prof = { gamesHidden: true, country: 'FR' }; Pages.refresh('friends') }); await p.waitForTimeout(1500)
    const d3 = await p.evaluate(() => ({ priv: [...document.querySelectorAll('.am-note')].map((x) => x.textContent), lv: !!document.querySelector('.am-ds-lv'), kpi: [...document.querySelectorAll('.am-ds-k dt')].map((x) => x.textContent), common: document.querySelectorAll('.am-du').length, rec: document.querySelectorAll('.am-rec li').length }))
    ok(d3.priv.includes('Son profil Steam est privé : ses jeux et ses heures ne sont pas visibles.') && !d3.lv && !d3.kpi.includes('Heures de jeu') && !d3.kpi.includes('Jeux') && d3.common === 0 && d3.rec === 0, `profil privé : note affichée, ni niveau, ni heures, ni jeux en commun (${d3.kpi.join(',')})`)
    await p.evaluate(RESTORE); await redraw(p, () => {})

    // Styles du jeu : comparaison avec le bouton « Jouer » de l'accueil, ::after compris
    const cmp = await p.evaluate(() => {
      const props = ['height', 'borderTopLeftRadius', 'borderBottomRightRadius', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform', 'minWidth', 'backgroundColor', 'backgroundImage', 'color', 'clipPath', 'boxShadow', 'transform', 'paddingLeft', 'marginLeft', 'overflow']
      const pseudo = ['content', 'top', 'right', 'bottom', 'left', 'width', 'height', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'backgroundColor', 'opacity', 'display', 'rotate']
      const out = {}, after = {}
      for (const st of ['tactique', 'stade', 'neon', 'epique', 'pop', 'vitesse', 'frisson']) {
        const host = document.createElement('div'); host.className = 'v-play'; host.dataset.gs = st; host.style.cssText = '--gs-acc:#d89c79;--gs-on:#130c05;position:fixed;left:0;top:0;z-index:-1'
        host.innerHTML = '<div class="ht-acts"><button class="play-btn"><span class="pb-in"><svg class="ic"></svg><span>Jouer</span></span></button></div><div class="am-t"><button class="gs-btn"><span class="gs-in"><svg class="ic"></svg><span>Jouer</span></span></button></div>'
        document.body.append(host)
        const A = host.querySelector('.play-btn'), B = host.querySelector('.gs-btn')
        const a = getComputedStyle(A), b = getComputedStyle(B)
        out[st] = props.filter((k) => a[k] !== b[k]).map((k) => `${k}: home=${a[k]} | gs=${b[k]}`)
        const ia = getComputedStyle(A.querySelector('.ic')), ib = getComputedStyle(B.querySelector('.ic'))
        if (ia.width !== ib.width) out[st].push(`icône ${ia.width} | ${ib.width}`)
        after[st] = {}
        for (const ps of ['::before', '::after']) { const pa = getComputedStyle(A, ps), pb = getComputedStyle(B, ps); after[st][ps] = pseudo.filter((k) => pa[k] !== pb[k]).map((k) => `${ps} ${k}: home=${pa[k]} | gs=${pb[k]}`) }
        if (st === 'tactique') { const pb = getComputedStyle(B, '::after'); after.tactiqueBox = { content: pb.content, top: pb.top, left: pb.left, right: pb.right, bottom: pb.bottom, border: pb.borderTopWidth + ' ' + pb.borderTopStyle } }
        host.remove()
      }
      return { out, after }
    })
    console.log('::after de tactique :', JSON.stringify(cmp.after.tactiqueBox))
    for (const st of Object.keys(cmp.out)) ok(cmp.out[st].length === 0 && cmp.after[st]['::before'].length === 0 && cmp.after[st]['::after'].length === 0, `.gs-btn = bouton Jouer de l'accueil, style ${st} : 0 écart (${cmp.out[st].concat(cmp.after[st]['::before'], cmp.after[st]['::after']).join(' ; ') || 'aucun'})`)
    const tb = cmp.after.tactiqueBox
    ok(tb.content === '""' && tb.top === '-7px' && tb.left === '-7px' && tb.right === '-7px' && tb.bottom === '-7px' && /^1(\.5)?px solid/.test(tb.border), `tactique : ::after = crochets (contenu, inset -7px, bordure 1,5 px, arrondie à 1 px à ce zoom) : ${JSON.stringify(tb)}`)

    // styles forcés dans les rangées et la fiche, puis survol réel
    await resize(app, p, 1600, 940)
    await redraw(p, () => { S.friend = FRIENDS.find((f) => f.n === 'Rook').id })
    const acc = { tactique: ['#d89c79', '#130c05'], stade: ['#3ddc84', '#06140b'], neon: ['#ff2bd6', '#1a0013'], epique: ['#c9a14a', '#140d02'], pop: ['#ff9a1f', '#2a1500'], vitesse: ['#4fa3ff', '#04101f'], frisson: ['#c0392b', '#fff'] }
    for (const [k, ls, ds] of [['a', ['tactique', 'stade', 'neon'], 'epique'], ['b', ['pop', 'vitesse', 'frisson'], 'tactique']]) {
      await p.evaluate(([ls, ds, acc]) => {
        const paint = (el, st) => { el.dataset.gs = st; el.style.setProperty('--gs-acc', acc[st][0]); el.style.setProperty('--gs-on', acc[st][1]) }
        document.querySelectorAll('[data-lane]').forEach((l, i) => paint(l, ls[i]))
        paint(document.querySelector('.am-ds'), ds)
      }, [ls, ds, acc])
      await p.waitForTimeout(900); await shot(p, `amis-1600-11-styles-${k}`)
      const hs = await p.evaluate(() => [...document.querySelectorAll('.am-sq .gs-btn, .am-ds .gs-btn')].map((b) => `${b.closest('[data-gs]').dataset.gs}:${Math.round(b.getBoundingClientRect().height)}x${Math.round(b.getBoundingClientRect().width)}`))
      console.log('boutons stylés', hs.join(' '))
      const clip = await p.evaluate(() => { const m = document.querySelector('.am-main'); return { overflowMain: m.scrollWidth > m.clientWidth + 1, dsOver: document.querySelector('.am-ds-sc').scrollWidth > document.querySelector('.am-ds-sc').clientWidth + 1 } })
      ok(!clip.overflowMain && !clip.dsOver, `styles ${ls.join('/')} + ${ds} : pas de débordement horizontal`)
    }
    // survol : fond du bouton tactique (rangée 1) et stade (rangée 2) ; on repeint tactique/stade d'abord
    await p.evaluate(([acc]) => {
      const paint = (el, st) => { el.dataset.gs = st; el.style.setProperty('--gs-acc', acc[st][0]); el.style.setProperty('--gs-on', acc[st][1]) }
      const l = document.querySelectorAll('[data-lane]'); paint(l[0], 'tactique'); paint(l[1], 'stade')
    }, [acc])
    await p.mouse.move(5, 5); await p.waitForTimeout(600)
    const bgOf = (i) => p.evaluate((i) => { const b = document.querySelectorAll('[data-lane]')[i].querySelector('.gs-btn'); const c = getComputedStyle(b); return { bg: c.backgroundColor, sh: c.boxShadow } }, i)
    const t0 = await bgOf(0), s0 = await bgOf(1)
    const box = async (i) => p.evaluate((i) => { const r = document.querySelectorAll('[data-lane]')[i].querySelector('.gs-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }, i)
    let [x, y] = await box(0); await p.mouse.move(x, y); await p.waitForTimeout(700); const t1 = await bgOf(0)
    ;[x, y] = await box(1); await p.mouse.move(x, y); await p.waitForTimeout(700); const s1 = await bgOf(1)
    ok(t0.bg !== t1.bg && t1.bg === 'rgb(216, 156, 121)', `tactique : fond au survol ${t0.bg} -> ${t1.bg} (accent)`)
    ok(s1.bg === 'rgb(61, 220, 132)' && s0.sh !== s1.sh, `stade : fond ${s1.bg} (accent) et ombre ${s0.sh} -> ${s1.sh} au survol`)
    await p.mouse.move(5, 5)

    // réglage « style du jeu » : couper le caméléon repeint la page Amis visible
    await p.evaluate(() => { GameStyle.set(false) }); await p.waitForTimeout(600)
    const off = await p.evaluate(() => ({ lanes: [...document.querySelectorAll('[data-lane]')].map((l) => l.dataset.gs || 'neutre'), ds: document.querySelector('.am-ds').dataset.gs || 'neutre' }))
    await p.evaluate(() => { GameStyle.set(true) }); await p.waitForTimeout(800)
    ok(off.lanes.every((s) => s === 'neutre') && off.ds === 'neutre', `GameStyle.set(false) : rangées et fiche repeintes en neutre (${off.lanes.join(',')} / ${off.ds})`)
    await redraw(p, () => {})
  } catch (e) { fail = e; console.log(e.message.split('\n').slice(0, 3).join(' ')) }
  console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  await app.close()
  if (fail || errs.length) process.exit(1)
})()
