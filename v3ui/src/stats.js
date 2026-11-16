// Stats : le Cockpit. Un écran par jeu (CS2, Battlefield 6), huit tuiles, et tout ce qui se clique ouvre son détail dans un volet à droite.
// Battlefield 6 : le service de stats gametools.network, avec ton pseudo EA. Counter-Strike 2 : tes bilans de match et les totaux de Valve.
// Les calculs sont dans Shared.statsCockpit (testés) ; ici, seulement l'affichage, les états vides et les volets. Les loadouts vivent dans le module Loadouts, plus bas.
const StatsPage = (() => {
  const T = Shared.text, L = Shared.cs2Lifetime, C = Shared.statsCockpit, CS = Shared.cs2
  const HAS = ['bf6', 'cs2'], MAX_RAIL = 4
  const PLAT = { ea: 'EA', pc: 'PC', steam: 'Steam', psn: 'PlayStation', xbox: 'Xbox' }
  const PERIOD = { d7: '7 jours', d30: '30 jours', all: 'Tout' }
  const PSHORT = { d7: '7 j', d30: '30 j', all: 'Tout' }
  const DAY = 864e5
  const LIFE_FIX = { 'no-account': 'Connecter Steam', 'no-key': 'Ajouter la clé', 'key-refused': 'Vérifier la clé', private: 'Voir mes comptes' }
  const CS_MAPS = ['ancient', 'anubis', 'dust2', 'inferno', 'mirage', 'nuke', 'overpass', 'train', 'vertigo']
  const SAMPLE = 'Chiffres d’exemple'
  const THIN = 'Pas encore assez de rounds suivis.'

  /* ---------- Petits outils ---------- */
  const isNum = (n) => typeof n === 'number' && Number.isFinite(n)
  const nf = (n, d = 0) => (isNum(n) ? fr(n, d) : '–')
  const pc = (n) => (isNum(n) ? `${fr(Math.round(n))} %` : '–')
  const pl = (n, s, p) => `${fr(n)} ${n > 1 ? (p || s + 's') : s}`
  const dayFr = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
  const dayLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const roll = (arr, k) => arr.map((_, i) => { const s = arr.slice(Math.max(0, i - k + 1), i + 1).filter(isNum); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null })
  const op = (t) => `data-open="${esc(t)}" role="button" tabindex="0"`
  const ago = (t) => T.timeAgo(t)
  const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
  const mapName = (id) => CS.mapLabel(id)
  const csImg = (map) => { const k = String(map).replace(/^(de|cs|ar)_/, ''); if (CS_MAPS.includes(k)) return A('cs_' + k); const g = Real.statGame('cs2'); return A(g.hero || g.cover) }
  const bfHero = () => { const g = Real.statGame('bf6'); return A(g.hero || g.cover) }
  const dec = (n) => (isNum(n) ? n : null)
  const sampleOf = (r) => r?.sample === true

  /* ---------- État ---------- */
  // sheet : la pile des volets ; data : ce qui est lu pour chaque jeu ; ready : la lecture est finie (réussie ou non)
  const K = { g: null, period: 'all', sheet: [], vf: 'all', data: { cs2: null, bf6: null }, ready: { cs2: false, bf6: false }, busy: false, opener: null, openerSel: null, tk: { cs2: 0, bf6: 0 }, fromAt: false, anim: false, atSnap: null, flash: null, tok: 0, hostMade: false }
  const gamesOf = () => HAS.map((id) => Real.statGame(id)).sort((a, b) => (b.raw?.lastPlayed || 0) - (a.raw?.lastPlayed || 0))
  const linked = (g) => g !== 'bf6' || !!Real.st.tracked?.me
  const steamId = () => (Real.st.accounts || []).find((a) => a.platform === 'steam')?.id || null
  const hasBoard = () => typeof Board !== 'undefined' && typeof Board.rows === 'function'
  const cs = () => K.data.cs2?.views[K.period] || K.data.cs2?.views.all
  const bf = () => K.data.bf6?.agg
  const secEl = () => $('.v-stats')
  const scEl = () => $('#sc-stats')
  let token = 0
  function railOf(all, cur) {
    if (all.length <= MAX_RAIL) return all
    const r = all.slice(0, MAX_RAIL - 1)
    if (!r.some((x) => x.id === cur.id)) r[r.length - 1] = cur
    return r
  }

  /* ---------- Lecture des données ---------- */
  async function loadCs2(refresh) {
    const tk = ++K.tk.cs2
    const [st, life] = await Promise.all([
      API.cs2State().catch(() => null),
      API.cs2Lifetime(refresh === true).catch((e) => ({ ok: false, reason: 'error', message: errText(e) }))
    ])
    if (tk !== K.tk.cs2) return
    if (st) Real.st.cs2 = st
    const all = st?.recaps || [], own = C.cs2Own(all, steamId())
    // Rien de vrai mais des exemples (mode démo) : on les montre, avec leur étiquette
    const sampleOnly = !own.length && all.length > 0 && all.every(sampleOf)
    const list = own.length ? own : sampleOnly ? all : []
    const now = Date.now()
    K.data.cs2 = { st, enabled: st ? !!st.enabled : true, recaps: list, sampleOnly, life, views: C.cs2Views(list, now), now, read: now }
  }
  async function loadBf6(refresh) {
    const me = Real.st.tracked?.me, tk = ++K.tk.bf6
    if (!me) { K.data.bf6 = null; return }
    // Une lecture qui revient après un changement de compte, ou après une lecture plus récente, ne doit rien écrire
    const stale = () => tk !== K.tk.bf6 || !Real.st.tracked?.me || bf6Key(Real.st.tracked.me) !== bf6Key(me)
    let snap = null, msg = ''
    try { snap = await API.bf6Stats(me, refresh === true) } catch (e) { msg = errText(e) }
    const [hist, rec] = await Promise.all([API.bf6History(me).catch(() => []), API.bf6Recaps().catch(() => null)])
    if (stale()) return
    // Les bilans de ton compte seulement : plateforme et pseudo (sans tenir compte des majuscules)
    const mine = (r) => r.account && r.account.platform === me.platform && same(r.account.name, me.name)
    const all = rec?.recaps || [], real = all.filter((r) => !sampleOf(r) && mine(r)), sampleOnly = !real.length && !all.some((r) => !sampleOf(r)) && all.length > 0
    const recaps = real.length ? real : sampleOnly ? all : []
    const now = Date.now()
    if (!snap) { K.data.bf6 = { fail: msg || 'Le service de stats ne répond pas. Réessaie dans quelques minutes.', me, recapState: rec, recaps, sampleOnly, now }; return }
    const agg = C.bf6Agg(snap.stats, hist || [], recaps, { now })
    // Ce que le service n'a pas vérifié : un chiffre qui ne tient pas la route reste hors de la page
    const st = snap.stats
    agg.hsOk = isNum(st.headshots) && st.headshots > 0 && st.headshots <= st.kills
    agg.accOk = isNum(agg.accuracy) && agg.accuracy > 0 && agg.accuracy <= 100
    agg.weapons.forEach((w) => { if (!(isNum(w.hsPct) && w.hsPct > 0 && w.hsPct <= 100)) w.hsPct = null; if (!(isNum(w.accuracy) && w.accuracy > 0 && w.accuracy <= 100)) w.accuracy = null })
    agg.classes.forEach((c) => { if (!(isNum(c.kd) && c.kd > 0)) c.kd = null })
    agg.byTime = agg.classes.some((c) => isNum(c.seconds) && c.seconds > 0)
    K.data.bf6 = { snap, agg, me, recaps, recapState: rec, sampleOnly, now, history: hist || [], stats: st }
    const imgs = (st.weapons || []).filter((w) => w.image && w.name)
    if (imgs.length) Loadouts.feed(imgs)
  }
  function ensure(g, refresh) {
    const me = ++K.tok
    const run = g === 'cs2' ? loadCs2(refresh) : loadBf6(refresh)
    return run.catch((e) => { console.error(e) }).then(() => { K.ready[g] = true; if (me === K.tok && K.g === g && S.view === 'stats') paintAll() })
  }
  // Relire pour de vrai : Steam, le service Battlefield, et chaque joueur du classement
  async function refresh() {
    if (K.busy) return
    K.busy = true; paintHead()
    const g = K.g
    try {
      if (g === 'bf6' && linked('bf6') && hasBoard() && typeof Board.reread === 'function') { await loadBf6(true); await Board.reread().catch(() => {}) }
      else if (g === 'cs2') await loadCs2(true)
      else await loadBf6(true)
    } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 4000 }) }
    K.busy = false; K.ready[g] = true
    if (K.g === g) paintAll()
  }

  /* ---------- Comparaisons (les règles de REGLES.md) ---------- */
  // Matchs avec un résultat : c'est eux qui servent aux minimums
  const rk = (m) => m.ranked ?? 0
  function cmpCs2() {
    const D = K.data.cs2; if (!D) return null
    if (K.period === 'all') {
      const t = D.views.all.trend; if (!t) return null
      const pick = (k) => ({ winPct: t.winPct[k], kd: t.kd[k], adr: t.adr[k], hsPct: t.hsPct[k] })
      return { now: pick('now'), before: pick('before'), what: `tes ${t.n.now} derniers matchs`, arrows: `Les flèches comparent tes ${t.n.now} derniers matchs aux ${t.n.before} d’avant.` }
    }
    const now = D.views[K.period], bef = D.views[K.period === 'd7' ? 'p7' : 'p30']
    if (!now || !bef || now.ranked < 5 || bef.ranked < 5) return null
    const pick = (x) => ({ winPct: x.winPct, kd: x.kdRounds, adr: x.adr, hsPct: x.hsPct })
    return { now: pick(now), before: pick(bef), what: `tes ${PERIOD[K.period]}`, arrows: `Les flèches comparent avec les ${PERIOD[K.period]} d’avant.` }
  }
  // La meilleure carte : assez de matchs avec un résultat, 50 % au moins. « À travailler » : une carte perdante, 10 points sous la meilleure.
  function bestWorst(maps, min = 5) {
    const ok = maps.filter((m) => rk(m) >= min && m.winPct != null)
    if (!ok.length) return {}
    const s = [...ok].sort((a, b) => b.winPct - a.winPct), best = s[0].winPct >= 50 ? s[0] : undefined, w = s.at(-1)
    return { best, worst: best && s.length > 1 && w.winPct < 50 && s[0].winPct - w.winPct >= 10 ? w : undefined }
  }
  const minMap = () => (K.period === 'd7' ? 3 : 5)
  // Le meilleur jour : seulement si au moins deux jours ont 3 matchs ou plus
  const topDay = (wd) => { const ok = wd.map((d, i) => [d, i]).filter(([d]) => d.winPct != null && d.matches >= 3); return ok.length < 2 ? -1 : ok.sort((a, b) => b[0].winPct - a[0].winPct)[0][1] }
  const adrOf = (r) => (r.hasRounds && r.roundsTracked ? Math.round(r.damage / r.roundsTracked) : null)
  const hsOf = (r) => (r.trackedKills ? Math.round(r.headshots / r.trackedKills * 100) : null)
  const recapById = (id) => K.data.cs2?.recaps.find((r) => r.id === id)

  /* ---------- Pièces de dessin ---------- */
  function delta(now, before, d = 0, unit = '') {
    if (!isNum(now) || !isNum(before)) return ''
    const v = now - before, flat = Math.abs(v) < Math.pow(10, -d) / 2
    if (flat) return '<span class="k-dl is-flat">stable</span>'
    return `<span class="k-dl ${v > 0 ? 'up' : 'down'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${v > 0 ? 'M12 5l7 12H5z' : 'M12 19L5 7h14z'}"/></svg>${v > 0 ? '+' : '−'}${fr(Math.abs(v), d)}${unit}</span>`
  }
  // Une courbe fine : 2 px, le dernier point marqué. Les nombres, eux, restent à côté en texte.
  function spark(vals, w = 120, h = 32) {
    const v = vals.filter(isNum); if (v.length < 2) return ''
    const lo = Math.min(...v), hi = Math.max(...v), sp = hi - lo || 1
    const pts = v.map((n, i) => [2 + i * (w - 6) / (v.length - 1), h - 3 - (n - lo) / sp * (h - 6)])
    const d = pts.map(([a, b], i) => (i ? 'L' : 'M') + a.toFixed(1) + ',' + b.toFixed(1)).join(' '), [lx, ly] = pts.at(-1)
    return `<svg class="k-sp" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--ck-a)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/><circle cx="${lx}" cy="${ly}" r="3" fill="var(--ck-a)" stroke="var(--ink)" stroke-width="2"/></svg>`
  }
  const bar = (p, cls = '') => `<span class="k-bar ${cls}"><i style="width:${clamp(isNum(p) ? p : 0, 0, 100)}%"></i></span>`
  const th = (label, link, open) => `<div class="k-h"><span class="k-kick">${label}</span>${link && open ? `<button class="k-more" data-open="${esc(open)}">${link}${ic('chev')}</button>` : ''}</div>`
  const note = (t) => `<p class="k-note">${t}</p>`
  const say = (t) => `<p class="k-say">${t}</p>`
  const act = (id, label, v = '', cls = '') => `<button class="k-b ${cls}" data-act="${id}"${v !== '' ? ` data-v="${esc(v)}"` : ''}>${label}</button>`
  const imgOf = (url, cls) => `<span class="gw">${url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" draggable="false" data-fb="done">` : ''}</span>`
  const KIND = (n) => { const x = T.norm(String(n)); return x.includes('assau') ? 'assault' : x.includes('ingen') || x.includes('engin') ? 'engineer' : x.includes('soutien') || x.includes('support') ? 'support' : x.includes('eclair') || x.includes('recon') ? 'recon' : null }
  const classOf = (name) => { const k = KIND(name); return { name: (k && CLASS[k]?.n) || name, c: (k && CLASS[k]?.c) || 'var(--t3)' } }
  const loOf = (w) => BUILDS.filter((x) => same(x.w, w)).sort((a, b) => ['S', 'A', 'B', 'C'].indexOf(a.tier || 'Z') - ['S', 'A', 'B', 'C'].indexOf(b.tier || 'Z'))
  const tierOf = (w) => { const b = loOf(w)[0]; return b?.tier ? Loadouts.tierTag(b.tier) : '' }
  const skel = (b) => { b.innerHTML = `<div class="sp-sk" aria-busy="true"><span class="sr-only" role="status">Lecture de tes stats</span><div class="sp-big" aria-hidden="true">${[0, 1, 2, 3].map(() => '<div class="sp-n"><i></i><i></i></div>').join('')}</div><i class="sp-skc" aria-hidden="true"></i></div>` }
  const emptyCard = (title, text, btns = '', cls = '') => `<div class="k-empty ${cls}"><span class="k-empty-x">${xm()}</span><h2>${title}</h2><p>${text}</p>${btns ? `<div class="k-empty-a">${btns}</div>` : ''}</div>`

  /* ---------- Cockpit : Counter-Strike 2 ---------- */
  const tile = (w, inner, open = '', extra = '') => `<section class="t k-${w} ${extra}"${open ? ` data-open="${esc(open)}"` : ''}>${inner}</section>`
  const matchTip = (m) => `${mapName(m.map)}, ${CS.RESULT_LABEL[m.result]}${m.score ? ` ${m.score.us}–${m.score.them}` : ''} : ${m.kills}/${m.deaths}, K/D ${nf(m.kd, 2)}${isNum(m.adr) ? `, ADR ${nf(m.adr)}` : ''}, ${dayFr.format(m.at)}`
  const sub = (c) => (K.period === 'all' ? 'tous tes matchs' : PERIOD[K.period])

  function tForme(c) {
    const ranked = c.series.filter((m) => ['win', 'loss', 'tie'].includes(m.result)), last20 = ranked.slice(-20), LT = { win: 'W', loss: 'L', tie: 'T' }
    const st = c.streak?.n >= 2 ? `<span class="k-streak ${c.streak.type === 'W' ? '' : 'cold'}">${c.streak.type === 'W' ? xm() : ''}${c.streak.n} ${c.streak.type === 'W' ? 'victoires' : 'défaites'} de suite</span>`
      : c.bestMatch ? `<span class="k-streak cold">Ton meilleur match : ${c.bestMatch.kills}/${c.bestMatch.deaths} sur ${esc(mapName(c.bestMatch.map))}</span>` : ''
    const head = th(`Ta forme · ${sub(c)}`, 'Tous les matchs', 'matches')
    if (!ranked.length) return tile('c5', `${head}${say('Aucun match avec un résultat sur cette période. Les modes sans équipes (match à mort) n’ont ni victoire ni défaite.')}`)
    return tile('c5', `${head}<div class="k-fm"><div class="k-fn"><b class="big num">${nf(Math.round(c.winPct))}<small>%</small></b><span>de victoires · ${c.wins} V, ${c.losses} D${c.ties ? `, ${c.ties} N` : ''}</span></div>
      <div class="k-fr">${st}<div class="k-f20" role="group" aria-label="Tes ${last20.length} derniers matchs">${last20.map((m) => `<button class="k-sq ${LT[m.result]}" data-open="match:${esc(m.id)}" data-tip="${esc(matchTip(m))}" aria-label="${esc(matchTip(m))}"></button>`).join('')}</div>
      <span class="k-cap">Tes ${last20.length} derniers matchs. Plein : gagné. Le dernier est à droite. Clique un carré : le match s’ouvre.</span></div></div>`)
  }
  function tNiveau(c, cmp) {
    const ranked = c.series.filter((m) => ['win', 'loss', 'tie'].includes(m.result)), rb = ranked.filter((m) => isNum(m.adr)), curve = rb.length > 1 ? rb : ranked
    // Le K/D : celui des rounds suivis, sinon celui des totaux de match (les modes sans résultat, comme le match à mort, restent dehors)
    const dsum = ranked.reduce((n, m) => n + m.deaths, 0), kd = isNum(c.kdRounds) ? c.kdRounds : dsum > 0 ? ranked.reduce((n, m) => n + m.kills, 0) / dsum : null
    const cell = (l, v, d, unit, key, dk) => `<button class="k-kc" data-open="kpi:${key}"><span class="l">${l}</span><b class="big num">${nf(v, d)}${unit ? `<small>${unit}</small>` : ''}</b><span class="s">${cmp ? delta(cmp.now[key], cmp.before[key], dk ?? d, unit === '%' ? ' pt' : '') : '<em></em>'}${spark(roll(curve.map((m) => m[key]), 5).slice(-24), 96, 32)}</span></button>`
    const plain = (l, v, d, sub) => `<div class="k-kc"><span class="l">${l}</span><b class="big num">${nf(v, d)}</b><span class="s"><em>${sub}</em></span></div>`
    const cells = [isNum(c.kdRounds) ? cell('K/D', c.kdRounds, 2, '', 'kd', 2) : isNum(kd) && plain('K/D', kd, 2, 'sur tes matchs, sans les rounds'), isNum(c.adr) && cell('Dégâts par round (ADR)', c.adr, 0, '', 'adr', 0), isNum(c.hsPct) && c.adr != null && cell('Headshots', c.hsPct, 0, '%', 'hsPct', 0),
      isNum(c.kpr) && `<button class="k-kc" data-open="rounds"><span class="l">Kills par round</span><b class="big num">${nf(c.kpr, 2)}</b><span class="s"><em>${pc(c.roundsWithKill)} de tes rounds avec un kill</em></span></button>`].filter(Boolean)
    const noRounds = !isNum(c.adr) && !isNum(c.kpr)
    if (noRounds && c.n > 0) { cells.push(plain('Éliminations par match', c.kills / c.n, 1, `${fr(c.kills)} sur ${pl(c.n, 'match', 'matchs')}`)); if (c.mvps > 0) cells.push(plain('MVP par match', c.mvps / c.n, 1, `${fr(c.mvps)} en tout`)) }
    if (!cells.length) return tile('c7', `${th('Ton niveau en match')}${say(THIN)}`)
    return tile('c7', `${th('Ton niveau en match')}<div class="k-kp">${cells.join('')}</div>
      <p class="k-foot">${noRounds ? 'Pas encore de round suivi : l’ADR, les headshots et les kills par round arrivent avec les rounds que Player X suit.' : `${cmp ? cmp.arrows : 'Pas assez de matchs avant pour comparer.'} Les courbes suivent tes 24 derniers matchs. K/D hors match à mort. Clique un chiffre : sa courbe s’ouvre.`}</p>`)
  }
  function tCotes(c) {
    const ct = c.sides.CT, te = c.sides.T
    if (!ct.rounds && !te.rounds) return tile('c4', `${th('Tes côtés')}${say(THIN)}`)
    const gap = isNum(ct.winPct) && isNum(te.winPct) ? ct.winPct - te.winPct : null, enough = ct.rounds >= 20 && te.rounds >= 20
    const word = !enough || gap == null ? 'Pas encore assez de rounds de chaque côté pour les comparer (20 au moins).'
      : Math.abs(gap) < 3 ? 'Tes deux côtés se valent.'
      : Math.abs(gap) < 8 ? `Tu gagnes un peu plus de rounds côté ${gap > 0 ? 'CT' : 'T'} : <b>${fr(Math.abs(Math.round(gap)))} points d’écart</b>.`
      : `Tu gagnes plus de rounds côté ${gap > 0 ? 'CT' : 'T'} : <b>${fr(Math.abs(Math.round(gap)))} points d’écart</b>. Côté à travailler : ${gap > 0 ? 'T' : 'CT'}.`
    const side = (n, s, col) => `<div style="--c:${col}"><span class="who"><i></i>${n}</span><b class="big num">${isNum(s.winPct) ? nf(Math.round(s.winPct)) : '–'}<small>%</small></b><span class="br"><i style="width:${s.winPct || 0}%"></i></span><span class="m">de rounds gagnés · ${nf(s.kpr, 2)} kill/round</span></div>`
    return tile('c4', `${th('Tes côtés', 'Carte par carte', 'sides')}<div class="k-sd">${side('Antiterroristes', ct, 'var(--ct)')}${side('Terroristes', te, 'var(--te)')}</div>${say(word)}`, 'sides')
  }
  function tCartes(c) {
    const { best, worst } = bestWorst(c.maps, minMap()), maps = c.maps.filter((m) => rk(m) > 0).slice(0, 5)
    if (!maps.length) return tile('c5', `${th('Tes cartes · tes matchs', 'Toutes', 'maps')}${say('Aucun match avec un résultat sur cette période.')}`)
    return tile('c5', `${th('Tes cartes · tes matchs', 'Toutes', 'maps')}<div class="k-colh" style="grid-template-columns:52px minmax(0,1fr) 150px 44px 40px"><span></span><span></span><span style="text-align:left">Victoires</span><span></span><span>K/D</span></div>
      <ul class="k-rw k-maps">${maps.map((m) => `<li class="${rk(m) < 3 ? 'few' : ''}" ${op('map:' + m.id)}><img class="th" src="${esc(csImg(m.id))}" alt="" loading="lazy"><span class="nm">${esc(mapName(m.id))}<small>${pl(rk(m), 'match', 'matchs')}</small>${m === best ? '<em>Ta meilleure</em>' : m === worst ? '<em class="lo">À travailler</em>' : ''}</span>${bar(m.winPct, 'h')}<span class="kv num">${pc(m.winPct)}</span><span class="kv2 num">${nf(m.kdRounds, 2)}</span></li>`).join('')}</ul>`)
  }
  function tRounds(c) {
    const mc = c.multi
    if (!isNum(c.roundsWithKill)) return tile('c3', `${th('Tes rounds', 'Détail', 'rounds')}${say(THIN)}`, 'rounds')
    const pist = c.pistol.played > 0
    return tile('c3', `${th('Tes rounds', 'Détail', 'rounds')}<div class="k-rd">
      ${pist ? `<div class="ln"><span>Rounds pistolet gagnés</span><b class="big num">${pc(c.pistol.winPct)}</b><small>${c.pistol.won} sur ${c.pistol.played}</small>${bar(c.pistol.winPct)}</div>` : ''}
      <div class="ln"><span>Rounds avec un kill</span><b class="big num">${pc(c.roundsWithKill)}</b>${bar(c.roundsWithKill)}</div>
      <div class="k-mk"><span><b class="big num">${mc.k3}</b><em>${xm()}3 kills</em></span><span><b class="big num">${mc.k4}</b><em>${xm()}4 kills</em></span><span><b class="big num">${mc.k5}</b><em>Ace</em></span></div></div>`, 'rounds')
  }
  // La frise des rounds : une colonne par round, un X par kill, un trait plein si le round est gagné
  function roundStrip(r, cls = '') {
    if (!r?.rounds?.length) return ''
    return `<div class="k-rs ${cls}" role="img" aria-label="${r.rounds.length} rounds : un X par kill, un trait plein pour un round gagné">${r.rounds.map((x) => `<span class="c"><span class="x">${Array.from({ length: x.kills || 0 }, () => xm()).join('')}</span><i class="${x.side ? (x.winner === x.side ? 'w' : 'l') : ''}"></i></span>`).join('')}</div>`
  }
  const canStory = (g) => (g === 'cs2' ? typeof Recap !== 'undefined' && typeof Recap.openCs2 === 'function' : typeof Recap !== 'undefined' && typeof Recap.openBf6 === 'function')
  function tDernier(D) {
    const last = D.recaps.find((r) => r.hasRounds) || D.recaps[0]
    if (!last) return ''
    const adr = adrOf(last), hs = hsOf(last), won = last.result === 'win'
    const nm = CS.RESULT_LABEL[last.result]
    return tile('c5', `<img class="bg" src="${esc(csImg(last.map))}" alt=""><div class="k-lm"><div><div class="k-h"><span class="k-kick">Dernier match · ${ago(last.endedAt)}</span><button class="k-more" data-open="match:${esc(last.id)}">Détail${ic('chev')}</button></div>
      <div class="k-lt"><b class="big num ${won ? 'w' : ''}">${esc(nm)} ${last.score && last.result !== 'left' ? `${last.score.us}–${last.score.them}` : ''}</b><span>${esc(mapName(last.map))}, ${esc(CS.modeLabel(last.mode))}</span></div></div>
      ${roundStrip(last)}
      <div class="k-ls"><div><b class="big num">${last.kills}/${last.deaths}/${last.assists}</b><span>K/D/A</span></div>${isNum(adr) ? `<div><b class="big num">${adr}</b><span>ADR</span></div>` : `<div><b class="big num">${last.mvps}</b><span>MVP</span></div>`}${isNum(hs) ? `<div><b class="big num">${hs} %</b><span>Headshots</span></div>` : ''}${canStory('cs2') ? act('story', 'Ouvrir le bilan', 'match:' + last.id, 'is-key') : ''}</div></div>`, `match:${last.id}`, 'k-lmt')
  }
  function tArmes(D) {
    const res = D.life, head = th('Tes armes · à vie, Steam', res.ok ? 'Toutes' : '', 'weapons')
    if (!res.ok) return tile('c4', `${th('Tes armes · à vie, Steam')}<div class="k-na"><b>Totaux de Counter-Strike 2 indisponibles</b><span>${esc(res.message || 'Steam ne répond pas pour le moment.')}</span>${LIFE_FIX[res.reason] ? act('fix', LIFE_FIX[res.reason]) : res.reason === 'demo' ? '' : act('retry', ic('refresh') + 'Réessayer')}</div>`)
    const ws = res.stats.weapons, ids = new Set(ws.map((w) => w.id)), base = L.weaponBase(res.stats) || 1, t = res.stats.totals
    if (!ws.length) return tile('c4', `${head}${say('Steam n’a encore rien compté pour ce compte.')}${res.sample ? `<p class="demo">${SAMPLE}</p>` : ''}`)
    const bits = [isNum(L.hoursOf(t)) && `${fr(Math.round(L.hoursOf(t)))} h`, isNum(t.kills) && `${fr(t.kills)} éliminations`, isNum(t.mvps) && `${fr(t.mvps)} MVP`].filter(Boolean)
    return tile('c4', `${head}<ul class="k-rw k-wp">${ws.slice(0, 5).map((w) => `<li ${op('weapons')}><span class="nm">${esc(L.weaponLabel(w.id, ids))}</span>${bar(w.kills / ws[0].kills * 100)}<span class="kv num">${fr(w.kills)}</span><span class="kv2 num">${fr(w.kills / base * 100, 1)} %</span></li>`).join('')}</ul>
      <p class="k-foot">${bits.length ? `À vie : ${bits.join(', ')}.` : ''}${res.sample ? ` <span class="k-sample">${SAMPLE}</span>` : ''}${res.stale ? ' Derniers totaux connus.' : ''}</p>`)
  }
  const DN = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'], DL = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
  function tQuand(c) {
    const wd = c.weekdays, dp = c.dayparts
    if (wd.every((d) => d.winPct == null)) return tile('c3', `${th('Quand tu gagnes', 'Détail', 'days')}${say('Pas encore de match avec un résultat à ranger par jour.')}`, 'days')
    const mx = Math.max(...wd.map((d) => d.winPct ?? 0), 1), top = topDay(wd)
    return tile('c3', `${th('Quand tu gagnes', 'Détail', 'days')}<div class="k-wk">${wd.map((d, i) => `<div class="${d.winPct == null ? 'none' : i === top ? 'top' : d.matches < 3 ? 'few' : ''}" data-tip="${esc(`${DN[i]} : ${d.winPct != null ? `${pl(d.matches, 'match', 'matchs')}, ${pc(d.winPct)} de victoires` : 'aucun match avec un résultat'}`)}"><em class="num">${d.winPct != null ? Math.round(d.winPct) : '–'}</em><i style="height:${d.winPct != null ? Math.max(4, d.winPct / mx * 78) : 2}px"></i><span>${DL[i]}</span></div>`).join('')}</div>
      <p class="k-foot">% de victoires par jour.${dp.soir.matches ? ` Le soir : ${pc(dp.soir.winPct)}.` : ''}${dp.nuit.matches ? ` La nuit : ${pc(dp.nuit.winPct)}.` : ''}</p>`, 'days')
  }
  function cs2Body() {
    const D = K.data.cs2, c = cs(), cmp = cmpCs2()
    const lt = tArmes(D)
    if (!D.recaps.length) {
      const off = !D.enabled
      return `<div class="k-grid is-solo">${emptyCard(off ? 'Le suivi de Counter-Strike 2 est coupé' : 'Aucun match pour l’instant', off ? 'Active-le pour garder le score et le bilan de chaque match.' : 'Joue un match de Counter-Strike 2 : son bilan arrive ici tout seul.', off ? act('settings', 'Ouvrir les réglages', '', 'is-key') : '')}${lt}</div>`
    }
    if (!c.n) return `<div class="k-grid is-solo">${emptyCard(`Aucun match sur ${PERIOD[K.period]}`, 'Player X ne t’a pas vu jouer à Counter-Strike 2 sur cette période.', `<button class="k-b is-key" data-period="all">Voir tout</button>`)}${lt}</div>`
    return `<div class="k-grid">${tForme(c)}${tNiveau(c, cmp)}${tCotes(c)}${tCartes(c)}${tRounds(c)}${tDernier(D)}${lt}${tQuand(c)}</div>`
  }

  /* ---------- Cockpit : Battlefield 6 ---------- */
  const bfSeries = (b, key) => b.series.filter((p) => isNum(p[key]) && p.at >= (K.data.bf6.now - 30 * DAY))
  const periodDelta = (b) => (K.period === 'all' ? null : b.deltas[K.period])
  function tDepuis(b) {
    const d = periodDelta(b), nd = d ? `${d.days} jour${d.days > 1 ? 's' : ''}` : ''
    if (K.period !== 'all' && !(d && isNum(d.kd))) {
      return tile('c5', `${th(`Tes ${PERIOD[K.period]}`, 'Tes sessions', 'sessions')}<div class="k-pd"><div class="k-pdn" ${op('bkpi:kd')}><b class="big num">${nf(b.kd, 2)}</b><span>K/D à vie</span></div><div class="k-pdr"><p class="k-say">Pas encore assez de relevés sur ${PERIOD[K.period]}. Player X en garde un par jour : il en faut deux, à des jours différents.</p><button class="k-b" data-period="all">Voir tout</button></div></div>`)
    }
    const rows = (d ? [isNum(d.kills) && [`+${fr(d.kills)}`, 'éliminations'], isNum(d.matches) && [fr(d.matches), 'parties'], isNum(d.winPct) && [pc(d.winPct), 'de victoires'], isNum(d.hours) && [`${fr(d.hours, 0)} h`, 'en partie']]
      : [[fr(b.kills), 'éliminations'], [fr(b.matches), 'parties'], b.wins + b.losses > 0 && isNum(b.winPct) && [pc(b.winPct), 'de victoires'], [`${fr(b.hours, 0)} h`, 'en partie']]).filter(Boolean)
    return tile('c5', `${th(d ? `Tes ${PERIOD[K.period]} · relevés sur ${nd}` : 'Depuis le début', 'Tes sessions', 'sessions')}<div class="k-pd"><div class="k-pdn" ${op('bkpi:kd')}><b class="big num">${nf(d ? d.kd : b.kd, 2)}</b><span>K/D ${d ? `sur ${nd}` : 'à vie'}</span>${d ? `<span class="k-cmp">à vie ${nf(b.kd, 2)} ${delta(d.kd, b.kd, 2)}</span>` : ''}</div>
      <div class="k-pdr">${rows.map(([v, l]) => `<div><b class="big num">${v}</b><span>${l}</span></div>`).join('')}</div></div>`)
  }
  function bfCells(b) {
    const cells = [{ k: 'kd', l: 'K/D', v: b.kd, d: 2 }, { k: 'kpm', l: 'Élim. par minute', v: b.kpm > 0 ? b.kpm : null, d: 2 }, { k: 'winPct', l: 'Victoires', v: b.wins + b.losses > 0 ? b.winPct : null, d: 0, u: '%' }]
    if (b.hsOk) cells.push({ k: 'hsPct', l: 'Headshots', v: b.hsPct, d: 0, u: '%' })
    if (b.accOk) cells.push({ k: 'accuracy', l: 'Précision', v: b.accuracy, d: 1, u: '%' })
    if (isNum(b.assists) && b.assists > 0) cells.push({ k: 'assists', l: 'Assistances', v: b.assists, d: 0 })
    return cells.filter((c) => isNum(c.v)).slice(0, 5)
  }
  function tNiveauBf(b) {
    const cells = bfCells(b)
    const cell = (c) => { const sk = c.k === 'kd' ? 'kdLife' : c.k, vals = ['kd', 'kpm', 'winPct', 'accuracy'].includes(c.k) ? bfSeries(b, sk).map((p) => p[sk]) : []; return `<button class="k-kc" data-open="bkpi:${c.k}"><span class="l">${c.l}</span><b class="big num">${nf(c.v, c.d)}${c.u ? `<small>${c.u}</small>` : ''}</b><span class="s"><em></em>${spark(c.k === 'kd' ? vals : roll(vals, 4), 96, 32)}</span></button>` }
    const pm = b.perMatch
    return tile('c7', `${th('Ton niveau · à vie')}<div class="k-kp">${cells.map(cell).join('')}</div>
      <p class="k-foot">Les courbes suivent tes relevés des 30 derniers jours.${isNum(pm.kills) ? ` Par partie : ${nf(pm.kills, 1)} éliminations${isNum(pm.revives) && pm.revives > 0 ? `, ${nf(pm.revives, 1)} réanimations` : ''}.` : ''}</p>`)
  }
  function tClasses(b) {
    const cl = b.classes.slice().sort((x, y) => (y.sharePct || 0) - (x.sharePct || 0)).filter((c) => isNum(c.sharePct))
    if (!cl.length) return tile('c4', `${th('Tes classes · à vie')}${say('Le service de stats n’a encore rien compté par classe.')}`)
    const anyKd = cl.some((c) => isNum(c.kd))
    return tile('c4', `${th('Tes classes · à vie', 'Détail', `class:${cl[0].name}`)}<div class="k-colh" style="grid-template-columns:12px minmax(0,1fr) 120px 44px${anyKd ? ' 44px' : ''}"><span></span><span></span><span style="text-align:left">${b.byTime ? 'Temps de jeu' : 'Part des éliminations'}</span><span></span>${anyKd ? '<span>K/D</span>' : ''}</div>
      <ul class="k-rw k-cl ${anyKd ? '' : 'no-kd'}">${cl.map((c) => { const o = classOf(c.name); return `<li ${op('class:' + c.name)}><i class="dot" style="background:${o.c}"></i><span class="nm">${esc(o.name)}</span>${bar(c.sharePct)}<span class="kv num">${pc(c.sharePct)}</span>${anyKd ? `<span class="kv2 num">${isNum(c.kd) ? nf(c.kd, 2) : ''}</span>` : ''}</li>` }).join('')}</ul>`)
  }
  const hsCol = (b) => b.weapons.some((w) => isNum(w.hsPct))
  function tArsenal(b) {
    const ws = b.weapons.slice(0, 4), hs = hsCol(b)
    if (!ws.length) return tile('c5', `${th('Ton arsenal · à vie')}${say('Le service de stats n’a encore rien compté par arme.')}`)
    return tile('c5', `${th('Ton arsenal · à vie', 'Toutes les armes', 'arsenal')}<div class="k-colh" style="grid-template-columns:92px minmax(0,1fr) 62px 62px 56px"><span></span><span></span><span>Élim.</span><span>Précision</span><span>${hs ? 'Têtes' : 'Élim./min'}</span></div>
      <ul class="k-rw k-aw">${ws.map((w) => `<li ${op('weapon:' + w.name)}>${imgOf(w.image, 'gun')}<span class="nm">${esc(w.name)}${tierOf(w.name)}</span><span class="kv num">${fr(w.kills)}</span><span class="kv2 num">${isNum(w.accuracy) ? nf(w.accuracy, 1) + ' %' : ''}</span><span class="kv2 num">${hs ? (isNum(w.hsPct) ? pc(w.hsPct) : '') : nf(w.kpm, 2)}</span></li>`).join('')}</ul>`)
  }
  function tVehicules(b) {
    const vs = b.vehicles.slice(0, 4), vmax = vs[0]?.kills || 1
    if (!vs.length) return tile('c3', `${th('Tes véhicules · à vie')}${say('Aucun véhicule compté pour l’instant.')}`)
    return tile('c3', `${th('Tes véhicules · à vie', 'Tous', 'vehicles')}<ul class="k-rw k-vh">${vs.map((v) => `<li><span class="nm">${esc(v.name)}</span>${bar(v.kills / vmax * 100)}<span class="kv num">${fr(v.kills)}</span></li>`).join('')}</ul>${isNum(b.vehicleKillPct) ? `<p class="k-foot">${pc(b.vehicleKillPct)} de tes éliminations se font en véhicule.</p>` : ''}`, 'vehicles')
  }
  function tSession(D) {
    const b = D.agg, s0 = b.sessions[0], r0 = D.recaps[0]
    if (!s0 || !r0) {
      const rs = D.recapState
      const t = rs && !rs.enabled ? ['Le bilan de Battlefield 6 est coupé', 'Active-le pour comparer tes stats avant et après chaque session.', act('settings', 'Ouvrir les réglages')] : rs?.pending ? ['Bilan en préparation', 'Le service de stats met parfois quelques minutes à compter tes dernières parties.', ''] : ['Aucune session pour l’instant', 'Joue à Battlefield 6 avec ton profil relié : le bilan arrive ici après la partie.', '']
      return tile('c5', `${th('Dernière session')}<div class="k-na"><b>${t[0]}</b><span>${t[1]}</span>${t[2]}</div>`)
    }
    const img = r0.maps?.[0]?.image || bfHero()
    return tile('c5', `<img class="bg" src="${esc(img)}" alt="" data-fb="done"><div class="k-lm"><div><div class="k-h"><span class="k-kick">Dernière session · ${ago(r0.endedAt)}</span><button class="k-more" data-open="session:${esc(s0.id)}">Détail${ic('chev')}</button></div>
      <div class="k-lt"><b class="big num ${s0.wins >= s0.losses && s0.wins > 0 ? 'w' : ''}">${pl(s0.wins, 'victoire')}, ${pl(s0.losses, 'défaite')}</b></div><span class="k-lsub">${pl(s0.matches, 'partie')} en ${fr(Math.round(s0.minutes))} min${s0.maps.length ? ` · ${esc(s0.maps.slice(0, 2).join(', '))}` : ''}${D.sampleOnly ? ` · ${SAMPLE}` : ''}</span></div>
      <div class="k-ls"><div><b class="big num">${nf(s0.kd, 2)}</b><span>K/D ${isNum(s0.kdVsAvg) ? delta(s0.kd, s0.kd - s0.kdVsAvg, 2) : ''}</span></div><div><b class="big num">${s0.kills}/${s0.deaths}</b><span>Élim. / morts</span></div>${s0.weapon ? `<div><b class="big num">${esc(s0.weapon)}</b><span>Ton arme</span></div>` : ''}${canStory('bf6') ? act('story', 'Ouvrir le bilan', 'session:' + s0.id, 'is-key') : ''}</div></div>`, `session:${s0.id}`, 'k-lmt')
  }
  function tCartesBf(b) {
    const ms = b.maps.filter((m) => isNum(m.winPct)).slice(0, 5)
    if (!ms.length) return tile('c4', `${th('Tes cartes · à vie', 'Cartes et modes', 'bfmaps')}${say('Le service de stats n’a encore rien compté par carte.')}`, 'bfmaps')
    const best = b.bestMap, worst = b.worstMap
    return tile('c4', `${th('Tes cartes · à vie', 'Cartes et modes', 'bfmaps')}<ul class="k-rw k-bm">${ms.map((m) => `<li ${op('bfmaps')}><span class="nm">${esc(m.name)}${best && m.name === best.name ? '<em>Ta meilleure</em>' : worst && m.name === worst.name ? '<em class="lo">À travailler</em>' : ''}</span>${bar(m.winPct, 'h')}<span class="kv num">${pc(m.winPct)}</span></li>`).join('')}</ul><p class="k-foot">% de victoires. Le trait marque 50 %.</p>`)
  }
  // Board.rows() lève pendant les instants entre Board.reset() et la fin de sa relecture (la table est vide) : la tuile attend le prochain signal du classement
  function boardRows() { try { return hasBoard() ? Board.rows() : null } catch (e) { return null } }
  function tClassement() {
    const R = boardRows()
    if (!R) return tile('c3', `${th('Classement')}${say('Le classement n’est pas disponible pour l’instant.')}`)
    const list = R.list || [], me = list.find((p) => p.me)
    if (list.length < 2) return tile('c3', `${th('Classement · ' + esc(R.metric?.l || 'K/D'))}<div class="k-na"><b>Personne à battre pour l’instant</b><span>Suis un joueur avec son pseudo EA : vous êtes classés sur les mêmes chiffres.</span><button class="k-b is-key" data-open="follow">${ic('plus')}Suivre un joueur</button></div>`)
    let shown = list.slice(0, 5)
    if (me && !shown.includes(me)) shown = [...list.slice(0, 4), me]
    const mx = Math.max(...list.map((p) => (isNum(p.value) ? p.value : 0)), 1)
    return tile('c3', `${th('Classement · ' + esc(R.metric?.l || 'K/D'), 'Ouvrir', 'board')}<ul class="k-rw k-bd">${shown.map((p) => `<li class="${p.me ? 'me' : ''}" ${op(p.me ? 'board' : 'rival:' + p.key)}><span class="kv2 num" style="text-align:left">${isNum(p.rank) ? p.rank : '–'}</span><span class="nm">${esc(p.name)}${p.me ? '<small>toi</small>' : ''}</span>${bar(isNum(p.value) ? p.value / mx * 100 : 0)}<span class="kv num">${p.loading ? '…' : p.error ? '–' : esc(p.text ?? '')}</span></li>`).join('')}</ul>`)
  }
  function bf6Body() {
    const D = K.data.bf6
    if (!D) return ''
    if (D.fail) return `<div class="k-grid is-solo">${emptyCard('Stats indisponibles', esc(D.fail), act('retry', ic('refresh') + 'Réessayer'))}</div>`
    const b = D.agg
    return `<div class="k-grid">${tDepuis(b)}${tNiveauBf(b)}${tClasses(b)}${tArsenal(b)}${tVehicules(b)}${tSession(D)}${tCartesBf(b)}${tClassement()}</div>`
  }
  /* ---------- BF6 pas relié : la carte de liaison, et à côté ce qu'elle débloque ---------- */
  const UNLOCK = [['Ton Cockpit', 'Ton K/D, tes victoires, tes classes, tes armes et l’évolution de tes chiffres, relevés sur ton profil.'], ['Tes sessions', 'Un bilan après chaque partie : ton K/D du jour contre ta moyenne.'], ['Classement', 'Toi face aux joueurs que tu suis, sur les mêmes chiffres.']]
  function linkCard(b) {
    const g = Real.statGame('bf6')
    b.innerHTML = `<section class="sp-link"><div class="sp-link-t"><h2>Relie ton profil Battlefield 6</h2><p>Entre ton pseudo EA, celui affiché en jeu. Player X retrouve ton compte, même si tu joues sur Steam, PlayStation ou Xbox.</p><div id="spSearch"></div></div>${g.cover ? `<span class="sp-link-c" data-name="${esc(g.name)}"><img src="${esc(A(g.cover))}" alt=""></span>` : ''}</section>`
    PlayerSearch.mount($('#spSearch', b), { action: 'C’est moi', importPx: true, exclude: [], autofocus: true, onPick: async (a) => {
      try { Real.st.tracked = await API.bf6SetTracked({ me: a, rivals: Real.st.tracked?.rivals || [] }) } catch (e) { return toast(`Ton profil n’a pas pu être relié. ${esc(errText(e))}`, { tone: 'warn', ms: 6000 }) }
      Board.reset(); K.data.bf6 = null; K.ready.bf6 = false; render(); toast(`${ic('check')} Profil relié : ${esc(a.name)}`, { ms: 3200 })
    } })
  }
  function unlinked(b) {
    b.innerHTML = `<div class="sp-ux"><div id="spLk"></div><aside class="sp-unl" aria-labelledby="spUnlH"><h2 id="spUnlH">Ce que tu débloques</h2><ul>${UNLOCK.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ul></aside></div>`
    linkCard($('#spLk', b))
  }
  // État de liaison pas encore lu : un squelette, puis le bon écran
  function waitLink(b) {
    skel(b)
    API.bf6GetTracked().then((t) => { if (Real.st.tracked === undefined) Real.st.tracked = t; if (S.view === 'stats' && K.g === 'bf6' && b.isConnected) render() })
      .catch(() => { if (b.isConnected) b.innerHTML = emptyCard('Stats indisponibles', 'Player X n’a pas pu lire ton profil Battlefield 6. Réessaie dans un instant.', act('retry', ic('refresh') + 'Réessayer')) })
  }

  /* ---------- La page : l'en-tête, le corps, la pile de volets ---------- */
  const dataOk = (g) => {
    const D = K.data[g]; if (!D) return false
    if (g === 'bf6') { const me = Real.st.tracked?.me; return !!me && !!D.me && bf6Key(D.me) === bf6Key(me) }
    return true
  }
  function srcText() {
    const g = K.g, D = K.data[g]
    if (g === 'cs2') {
      if (!D) return ''
      const bits = ['Tes matchs, relevés par Player X']
      if (D.life.ok) bits.push(`Steam relu ${ago(D.life.fetchedAt)}`)
      return esc(bits.join(' · ')) + (D.life.ok && D.life.stale ? ` <span class="k-warn" data-tip="${esc(D.life.stale)}" tabindex="0">${ic('warn')}Chiffres gardés</span>` : '')
    }
    if (!D?.snap) return D?.fail ? `<span class="k-warn">${ic('warn')}Le service de stats ne répond pas</span>` : ''
    const m = Real.st.tracked.me, s = D.snap
    return `${esc(s.stats.account.name || m.name)}, ${esc(PLAT[m.platform] || m.platform)}, relu ${esc(ago(s.fetchedAt))}${s.stale ? ` <span class="k-warn" data-tip="${esc(s.stale)}" tabindex="0">${ic('warn')}Chiffres gardés</span>` : ''}`
  }
  function paintHead() {
    const box = $('#ckHR'); if (!box) return
    const g = K.g, D = K.data[g], okData = dataOk(g) && (g === 'cs2' ? D.recaps.length > 0 : !!D.agg)
    const acts = g === 'cs2' ? (dataOk(g) && D.recaps.length ? '<button class="k-b" data-open="matches">Tous les matchs</button>' : '')
      : `<button class="k-b" data-open="loadouts">Loadouts</button>${linked('bf6') && hasBoard() ? '<button class="k-b" data-open="board">Classement</button>' : ''}`
    const seg = okData ? `<div class="k-seg" role="group" aria-label="Période">${Object.keys(PERIOD).map((k) => `<button data-period="${k}" aria-pressed="${K.period === k}" aria-label="${PERIOD[k]}"><span class="pl">${PERIOD[k]}</span><span class="ps">${PSHORT[k]}</span></button>`).join('')}</div>` : ''
    const ex = g === 'cs2' && dataOk(g) && D.sampleOnly ? `<span class="k-ex">${SAMPLE}</span>` : ''
    const canRef = dataOk(g) && (g === 'cs2' || linked('bf6'))
    box.innerHTML = `${ex}${acts}${seg}<span class="k-src">${dataOk(g) ? srcText() : ''}</span>${canRef ? `<button class="k-b k-ic" data-act="refresh" aria-label="Relire mes stats" data-tip="Relire mes stats" data-tip-b data-tip-r ${K.busy ? 'aria-busy="true"' : ''}>${ic('refresh')}</button>` : ''}`
  }
  function paintBody() {
    const b = $('#ckBody'); if (!b) return
    const g = K.g
    if (g === 'bf6') {
      if (Real.st.tracked === undefined) return waitLink(b)
      if (!Real.st.tracked?.me) { if (!$('.sp-ux', b)) unlinked(b); return }
    }
    if (!dataOk(g)) { skel(b); return }
    b.innerHTML = g === 'cs2' ? cs2Body() : bf6Body()
  }
  function paintAll() {
    if (S.view !== 'stats' || !scEl()?.querySelector('.ck')) return
    paintHead(); paintBody(); if (K.sheet.length && !['follow', 'atelier'].includes(K.sheet.at(-1))) paintSheets()
  }
  function styleHost(g) {
    const sec = secEl(); if (!sec) return
    const s = GameStyle.now(g)
    if (s) GameStyle.paint(sec, s); else GameStyle.of(g).then((r) => { if (K.g === g.id && sec.isConnected) GameStyle.paint(sec, r) }).catch(() => {})
  }
  // Le clic au-dehors de « Tous tes jeux » : un seul écouteur, retiré à la fermeture, au rendu suivant ou quand la liste a quitté la page
  let awayAc = null
  function render() {
    awayAc?.abort(); awayAc = null
    const all = gamesOf(), cur = all.find((x) => x.id === S.statsGame) || all[0]
    S.statsGame = cur.id
    const g = cur.id, sc = scEl()
    Fluid.game(cur); Bar.syncGame()
    if (K.g !== g) { K.g = g; K.sheet = []; K.vf = 'all' }
    setup(sc); styleHost(cur)
    syncAtelier(); consumeTab(g)
    const rail = railOf(all, cur), rest = all.length - rail.length
    sc.innerHTML = `<div class="ck" data-g="${g}"><header class="k-head">
        <div class="sp-pickw"><div class="sp-pick">
          <div class="sp-rail" role="tablist" aria-label="Jeu">${rail.map((x) => `<button class="sp-g" role="tab" data-g="${x.id}" data-name="${esc(x.name)}" aria-selected="${x.id === cur.id}" aria-label="${esc(x.name)}" data-tip="${esc(x.name)}" data-tip-b data-tip-l><img src="${esc(A(x.cover))}" alt="" draggable="false"></button>`).join('')}</div>
          ${rest > 0 ? `<button class="sp-more num" id="spMore" aria-expanded="false" aria-controls="spAll" aria-label="Voir tous tes jeux, ${all.length} en tout" data-tip="Tous tes jeux" data-tip-b data-tip-l>+${rest}</button>
          <div class="sp-all" id="spAll" role="dialog" aria-label="Tous tes jeux" hidden>
            ${all.length >= 8 ? `<label class="sp-q" for="spQ">${ic('search')}<span>Rechercher un jeu</span><input id="spQ" type="search" autocomplete="off" spellcheck="false" placeholder=" "></label>` : ''}
            <div class="sp-list" id="spList"></div>
          </div>` : ''}
        </div></div>
        <h1 class="k-title">${esc(cur.name)}</h1><span class="k-spc"></span><div class="k-hr" id="ckHR"></div></header>
      <div class="k-body" id="ckBody"></div></div>`
    const pick = (id) => { if (S.statsGame === id) return; S.statsGame = id; S.statsTab = 'overview'; vt(render) }
    $$('.sp-g', sc).forEach((b) => b.onclick = () => pick(b.dataset.g))
    if (rest > 0) allGames(sc, all, cur, pick)
    if (g === 'bf6' && Real.st.tracked?.me) Board.ensure()
    paintHead(); paintBody(); paintSheets()
    ensure(g)
  }
  // Toute la liste : tout se retrouve, même à 50 jeux, et la jaquette choisie rejoint la rangée
  function allGames(sc, all, cur, pick) {
    const btn = $('#spMore', sc), box = $('#spAll', sc), list = $('#spList', sc), q = $('#spQ', sc)
    const row = (x) => `<button class="sp-li" data-g="${x.id}" data-name="${esc(x.name)}" ${x.id === cur.id ? 'aria-current="true"' : ''}><img src="${esc(A(x.cover))}" alt="" draggable="false" loading="lazy"><span><b>${esc(x.name)}</b><span>${!linked(x.id) ? 'Relie ton compte pour voir tes stats' : x.time ? `${esc(x.time)} de jeu` : 'Pas encore joué'}</span></span>${x.id === cur.id ? ic('check') : ''}</button>`
    const paint = () => {
      const t = q ? q.value.trim().toLowerCase() : '', shown = all.filter((x) => x.name.toLowerCase().includes(t))
      const on = shown.filter((x) => linked(x.id)), off = shown.filter((x) => !linked(x.id))
      const grp = (t, xs) => (xs.length ? `<p class="sp-gh">${t}</p>${xs.map(row).join('')}` : '')
      list.innerHTML = shown.length ? (off.length ? grp('Reliés', on) + grp('À relier', off) : shown.map(row).join('')) : `<div class="sp-none"><p>Aucun jeu ne contient « ${esc(q.value)} ».</p><button class="btn sm" id="spClr">Effacer la recherche</button></div>`
      $$('.sp-li', list).forEach((b) => b.onclick = () => { shut(); pick(b.dataset.g) })
      $('#spClr', list)?.addEventListener('click', () => { q.value = ''; paint(); q.focus() })
    }
    const away = (e) => { if (!box.isConnected) { awayAc?.abort(); awayAc = null; return } if (!e.target.closest('#spAll,#spMore')) shut(false) }
    function shut(giveBack = true) { if (box.hidden) return; box.hidden = true; btn.setAttribute('aria-expanded', 'false'); awayAc?.abort(); awayAc = null; if (giveBack) btn.focus() }
    btn.onclick = () => {
      if (!box.hidden) return shut()
      box.hidden = false; btn.setAttribute('aria-expanded', 'true'); if (q) q.value = ''; paint()
      ;(q || $('.sp-li', list))?.focus(); awayAc?.abort(); awayAc = new AbortController(); document.addEventListener('pointerdown', away, { capture: true, signal: awayAc.signal })
    }
    q?.addEventListener('input', paint)
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); shut(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = [...(q ? [q] : []), ...$$('.sp-li', list)], i = items.indexOf(document.activeElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
    })
  }

  /* ---------- Entrées d'ailleurs : S.statsTab, l'atelier ---------- */
  function syncAtelier() {
    if (S.atelier) { if (!K.sheet.includes('atelier')) { K.atSnap = JSON.stringify(BUILDS); K.sheet.push('atelier'); K.anim = true } return }
    if (!K.sheet.includes('atelier')) return
    K.sheet = K.sheet.filter((t) => t !== 'atelier'); K.atT = null; K.fromAt = true
    // Enregistré : on revient sur l'arme du loadout, et la carte s'allume un instant
    const was = JSON.parse(K.atSnap || '[]'), hit = BUILDS.find((b) => { const p = was.find((x) => x.id === b.id); return !p || JSON.stringify(p) !== JSON.stringify(b) })
    if (hit) { K.sheet = ['loadouts', `weapon:${hit.w}`]; K.flash = hit.id; S.loWeapon = hit.w }
    K.anim = false
  }
  // Une entrée d'ailleurs (page Loadouts, palette, accueil) REMPLACE la pile ; sans demande, la pile reste comme elle est.
  // Au retour de l'atelier, S.statsTab et S.loWeapon sont ceux de l'atelier : syncAtelier a déjà rangé la pile.
  function consumeTab(g) {
    if (S.atelier) return
    const t = S.statsTab, w = S.loWeapon, back = K.fromAt
    S.statsTab = 'overview'; S.loWeapon = null; K.fromAt = false
    if (back) return
    let to = null
    if (t === 'loadouts' && g === 'bf6') to = w && BUILDS.some((b) => b.w === w) ? ['loadouts', `weapon:${w}`] : ['loadouts']
    else if (t === 'board' && g === 'bf6' && linked('bf6') && hasBoard()) to = ['board']
    else if (t === 'matches' && g === 'cs2') to = ['matches']
    if (to) { K.sheet = to; K.anim = true; K.opener = null; K.openerSel = null }
  }
  // La page Stats est quittée, ou rouverte depuis la palette : le Cockpit repart sans volet. L'atelier garde son propre état.
  function reset() {
    if (S.atelier) return
    K.sheet = []; K.anim = false; K.opener = null; K.openerSel = null; K.had = false; K.vf = 'all'; K.flash = null; K.fromAt = false
    trap(false)
    const lay = layer(); if (lay) { lay.replaceChildren(); lay.hidden = true }
  }

  /* ---------- Les volets : le détail de chaque chiffre, à droite, sans quitter la page ---------- */
  const V = {}
  const vNum = (v, l, sub = '', open = '') => `<${open ? 'button' : 'div'} class="k-bc" ${open ? `data-open="${esc(open)}"` : ''}><b class="big num">${v}</b><span>${l}</span>${sub ? `<em>${sub}</em>` : ''}</${open ? 'button' : 'div'}>`
  const vNums = (...a) => { const l = a.filter(Boolean); return l.length ? `<div class="k-band">${l.join('')}</div>` : '' }
  const vSec = (t, html, nt = '', link = '', open = '') => `<section class="k-vs"><div class="k-h"><span class="k-kick">${t}</span>${link ? `<button class="k-more" data-open="${esc(open)}">${link}${ic('chev')}</button>` : ''}</div>${html}${nt ? `<p class="k-foot">${nt}</p>` : ''}</section>`
  const vArt = (img, kick, title, subt, cls = '') => `<div class="k-art ${cls}"><img src="${esc(img)}" alt="" data-fb="done"><div><span class="k-kick">${kick}</span><b class="big">${title}</b><span>${subt}</span></div></div>`
  const vActs = (...a) => `<div class="k-acts">${a.filter(Boolean).join('')}</div>`
  const vRow = (open, cols, cells, cls = '') => `<li class="k-vr ${cls}" ${open ? op(open) : ''} style="grid-template-columns:${cols}${open ? ' 16px' : ''}">${cells}${open ? ic('chev') : ''}</li>`
  const vList = (rows, cls = '') => `<ul class="k-vl ${cls}">${rows.join('')}</ul>`
  const vColh = (cols, labels) => `<div class="k-colh k-vcolh" style="grid-template-columns:${cols} 16px">${labels.map((l, i) => `<span${i === 0 || l === '<' ? ' style="text-align:left"' : ''}>${l === '<' ? '' : l}</span>`).join('')}<span></span></div>`
  const vBig = (v, unit, text) => `<div class="k-big"><b class="big num">${v}${unit ? `<small>${unit}</small>` : ''}</b><span>${text}</span></div>`
  const vEmpty = (t, s) => `<div class="k-vempty"><b>${t}</b><span>${s}</span></div>`
  const pLabel = () => (K.period === 'all' ? 'tous tes matchs' : PERIOD[K.period])
  const thumb = (url) => `<img class="th" src="${esc(url)}" alt="" loading="lazy">`

  // La courbe d'un volet : une ligne fine lissée, un point par valeur, l'infobulle de l'appli sur chaque point
  function chartHTML(raw, labels, d, unit, smooth) {
    const vals = smooth > 1 ? roll(raw, smooth) : raw, ok = vals.filter(isNum)
    if (ok.length < 2) return ''
    const W = 628, H = 130, P = 10, lo0 = Math.min(...ok), hi0 = Math.max(...ok), span = Math.max(hi0 - lo0, Math.abs(hi0) * .04, .01), lo = lo0 - span * .15, hi = hi0 + span * .15
    const x = (i) => P + i * (W - 2 * P) / (vals.length - 1), y = (n) => H - P - (n - lo) / (hi - lo) * (H - 2 * P)
    const pts = vals.map((n, i) => (isNum(n) ? [x(i), y(n)] : null))
    const path = pts.map((p, i) => (p ? `${pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : '')).join(' ')
    const u = unit === '%' ? ' %' : ''
    return `<div class="k-ch"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="M${P},${y(hi0).toFixed(1)}H${W - P}M${P},${y(lo0).toFixed(1)}H${W - P}" stroke="var(--hair)" stroke-width="1" fill="none" vector-effect="non-scaling-stroke"/><path d="${path}" fill="none" stroke="var(--ck-a)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
      <span class="k-yl" style="top:${(y(hi0) / H * 100).toFixed(1)}%">${fr(hi0, d)}${u}</span><span class="k-yl" style="top:${(y(lo0) / H * 100).toFixed(1)}%">${fr(lo0, d)}${u}</span>
      ${pts.map((p, i) => (p ? `<i class="k-pt ${i === pts.length - 1 ? 'last' : ''}" style="left:${(p[0] / W * 100).toFixed(2)}%;top:${(p[1] / H * 100).toFixed(2)}%" tabindex="0" data-tip="${esc(`${labels[i]} : ${isNum(raw[i]) ? fr(raw[i], d) + u : '–'}${smooth > 1 ? ` (moyenne lissée ${fr(vals[i], d)}${u})` : ''}`)}"></i>` : '')).join('')}</div>
      <div class="k-chx"><span>${esc(labels[0])}</span><span>${esc(labels.at(-1))}</span></div>`
  }

  /* ---------- Counter-Strike 2 ---------- */
  const csMatchRow = (m) => vRow(`match:${m.id}`, '56px minmax(0,1fr) 104px 62px 46px',
    `${thumb(csImg(m.map))}<span class="nm">${esc(mapName(m.map))}<small>${esc(CS.modeLabel(m.mode))}, ${esc(ago(m.at))}</small></span><span class="res ${m.result === 'win' ? 'w' : ''}">${esc(CS.RESULT_LABEL[m.result])}${m.score && m.result !== 'left' ? ` ${m.score.us}–${m.score.them}` : ''}</span><span class="kv num">${m.kills}/${m.deaths}</span><span class="kv2 num">${isNum(m.adr) ? fr(m.adr) : '–'}</span>`)
  const csListHead = vColh('56px minmax(0,1fr) 104px 62px 46px', ['<', '<', 'Résultat', 'K/D', 'ADR'])

  V.match = (id) => {
    const r = recapById(id); if (!r) return null
    const adr = adrOf(r), hs = hsOf(r), clips = clipsOfMatch(r), multi = [[r.multi?.k3, '3 kills'], [r.multi?.k4, '4 kills'], [r.multi?.k5, 'Ace']].filter(([n]) => n)
    const inMaps = K.data.cs2.views.all.maps.some((m) => m.id === r.map)
    return { crumb: 'Match', title: `${mapName(r.map)}, ${dayFr.format(r.startedAt)}`, html: `
      ${vArt(csImg(r.map), `${esc(CS.modeLabel(r.mode))} · ${esc(dayLong.format(r.startedAt))}`, `<i class="${r.result === 'win' ? 'w' : ''}">${esc(CS.RESULT_LABEL[r.result])}${r.score && r.result !== 'left' ? ` ${r.score.us}–${r.score.them}` : ''}</i>`, esc(mapName(r.map)))}
      ${vNums(vNum(`${r.kills}/${r.deaths}/${r.assists}`, 'K/D/A'), vNum(nf(CS.killDeath(r), 2), 'K/D'), isNum(adr) && vNum(adr, 'Dégâts par round'), isNum(hs) && vNum(hs + '<small>%</small>', 'Headshots'), vNum(r.mvps, 'MVP'))}
      ${vSec('Tes rounds', r.hasRounds && r.rounds.length ? roundStrip(r, 'lg') : note(r.hasRounds ? 'Player X n’a pas suivi les rounds de ce match.' : 'Ce mode n’a pas de rounds : pas de frise.'), r.hasRounds && r.rounds.length ? 'Une colonne par round. Un X par kill. Trait plein : round gagné.' : '')}
      ${r.hasRounds && (r.best || multi.length) ? vSec('Tes temps forts', vList([r.best ? vRow('', 'minmax(0,1fr) auto', `<span class="nm">Ton meilleur round</span><span class="kv num">Round ${r.best.n} : ${pl(r.best.kills, 'kill')}, ${fr(r.best.damage)} dégâts</span>`) : '', multi.length ? vRow('', 'minmax(0,1fr) auto', `<span class="nm">Rounds à plusieurs kills</span><span class="kv num">${multi.map(([n, l]) => `${n} × ${l}`).join(', ')}</span>`) : ''].filter(Boolean))) : ''}
      ${r.partial ? note('Match rejoint en cours : seuls les rounds suivis comptent.') : ''}${sampleOf(r) ? `<p class="demo">${SAMPLE}</p>` : ''}
      ${vActs(canStory('cs2') && act('story', 'Bilan complet', 'match:' + r.id, 'is-key'), clips.length ? `<button class="k-b" data-open="clips:${esc(r.id)}">${pl(clips.length, 'clip')} de ce match</button>` : '', inMaps && `<button class="k-b" data-open="map:${esc(r.map)}">${esc(mapName(r.map))}</button>`)}` }
  }
  V.matches = () => {
    const all = cs().series.slice().reverse(), modes = [...new Set(all.map((m) => m.mode))]
    if (!modes.includes(K.vf)) K.vf = 'all'
    const list = all.filter((m) => K.vf === 'all' || m.mode === K.vf)
    return { crumb: 'Counter-Strike 2', title: 'Tous tes matchs', html: `
      <div class="k-flt" role="group" aria-label="Mode">${[['all', 'Tout'], ...modes.map((k) => [k, CS.modeLabel(k)])].map(([k, l]) => `<button class="${K.vf === k ? 'on' : ''}" data-act="vf" data-v="${esc(k)}" aria-pressed="${K.vf === k}">${esc(l)}</button>`).join('')}<em>${pl(list.length, 'match', 'matchs')} · ${pLabel()}</em></div>
      ${list.length ? `${csListHead}${vList(list.map(csMatchRow))}` : vEmpty('Aucun match', 'Aucun match dans ce mode sur cette période.')}` }
  }
  V.map = (id) => {
    const c0 = cs(), inP = c0.maps.find((x) => x.id === id), c = inP ? c0 : K.data.cs2.views.all, m = c.maps.find((x) => x.id === id); if (!m) return null
    const lab = c === c0 ? pLabel() : 'tous tes matchs', { best, worst } = bestWorst(c.maps, c === c0 ? minMap() : 5), list = c.series.filter((x) => x.map === id).reverse()
    const side = (n, s, col) => `<div style="--c:${col}"><span class="who"><i></i>${n}</span><b class="big num">${isNum(s.winPct) ? fr(Math.round(s.winPct)) : '–'}<small>%</small></b><span class="br"><i style="width:${s.winPct || 0}%"></i></span><span class="m">${s.won} rounds gagnés sur ${s.rounds}</span></div>`
    const hasSides = m.ct.rounds + m.t.rounds > 0
    return { crumb: 'Carte', title: mapName(id), html: `
      ${vArt(csImg(id), `Carte · ${lab}`, esc(mapName(id)), `${m.wins} V, ${m.losses} D${m.ties ? `, ${m.ties} N` : ''}${m === best ? ' · ta meilleure carte' : m === worst ? ' · à travailler' : ''}`)}
      ${vNums(isNum(m.winPct) && vNum(fr(Math.round(m.winPct)) + '<small>%</small>', 'Victoires'), isNum(m.kdRounds) && vNum(fr(m.kdRounds, 2), 'K/D'), isNum(m.adr) && vNum(fr(m.adr), 'Dégâts par round'), isNum(m.hsPct) && vNum(fr(m.hsPct) + '<small>%</small>', 'Headshots'))}
      ${vSec('Tes côtés sur cette carte', hasSides ? `<div class="k-sd is-vl">${side('Antiterroristes', m.ct, 'var(--ct)')}${side('Terroristes', m.t, 'var(--te)')}</div>` : note(THIN), hasSides && (m.ct.rounds < 20 || m.t.rounds < 20) ? 'Moins de 20 rounds d’un côté : à lire avec prudence.' : '')}
      ${vSec(`Tes matchs sur ${esc(mapName(id))}`, csListHead + vList(list.map(csMatchRow)))}` }
  }
  V.maps = () => {
    const c = cs(), { best, worst } = bestWorst(c.maps, minMap()), ms = c.maps.filter((m) => rk(m) > 0)
    return { crumb: 'Counter-Strike 2', title: 'Toutes tes cartes', html: `
      ${ms.length ? `${vColh('56px minmax(0,1fr) 150px 46px 44px', ['<', '<', 'Victoires', '<', 'K/D'])}${vList(ms.map((m) => vRow(`map:${m.id}`, '56px minmax(0,1fr) 150px 46px 44px', `${thumb(csImg(m.id))}<span class="nm">${esc(mapName(m.id))}<small>${pl(rk(m), 'match', 'matchs')}</small>${m === best ? '<em>Ta meilleure</em>' : m === worst ? '<em class="lo">À travailler</em>' : ''}</span>${bar(m.winPct, 'h')}<span class="kv num">${pc(m.winPct)}</span><span class="kv2 num">${nf(m.kdRounds, 2)}</span>`, rk(m) < 3 ? 'few' : '')))}` : vEmpty('Aucune carte', 'Aucun match avec un résultat sur cette période.')}
      <p class="k-foot">D’après tes matchs suivis par Player X, sur ${pLabel()}. Le trait marque 50 %. Les lignes pâles ont moins de 3 matchs.</p>` }
  }
  const KPI = { kd: ['K/D', 2, '', 'kdRounds'], adr: ['Dégâts par round', 0, '', 'adr'], hsPct: ['Headshots', 0, '%', 'hsPct'] }
  V.kpi = (key) => {
    const [label, d, unit, field] = KPI[key] || []; if (!label) return null
    const c = cs(), cmp = cmpCs2(), rb = c.series.filter((m) => isNum(m.adr) && isNum(m[key])), top = rb.slice().sort((a, b) => b[key] - a[key]), u = unit ? `<small>${unit}</small>` : ''
    if (!isNum(c[field])) return { crumb: 'Ton niveau', title: label, html: `<p class="k-say">${THIN}</p>` }
    const maps = c.maps.filter((m) => rk(m) >= 3 && isNum(m[field])).sort((a, b) => b[field] - a[field])
    return { crumb: 'Ton niveau', title: label, html: `
      ${vBig(fr(c[field], d), unit, `${label} sur ${pLabel()}${key === 'kd' ? ', hors match à mort' : ''}<br>${cmp && isNum(cmp.now[key]) && isNum(cmp.before[key]) ? `${delta(cmp.now[key], cmp.before[key], d, unit ? ' pt' : '')} ${cmp.what} : ${fr(cmp.now[key], d)}${unit ? ' ' + unit : ''}, avant : ${fr(cmp.before[key], d)}${unit ? ' ' + unit : ''}` : 'Pas assez de matchs avant pour comparer.'}`)}
      ${rb.length > 1 ? vSec('Match après match', `<div class="k-chw">${chartHTML(rb.map((m) => m[key]), rb.map((m) => dayFr.format(m.at)), d, unit, 5)}</div>`, 'La courbe lisse sur 5 matchs. Passe sur un point : le match.') : ''}
      ${top.length > 1 ? vSec('Tes extrêmes', vList([[top[0], 'Ton meilleur match'], [top.at(-1), 'Ton moins bon']].map(([m, l]) => vRow(`match:${m.id}`, '56px minmax(0,1fr) auto', `${thumb(csImg(m.map))}<span class="nm">${l}<small>${esc(mapName(m.map))}, ${dayFr.format(m.at)}</small></span><span class="kv num">${fr(m[key], d)}${unit ? ' ' + unit : ''}</span>`)))) : ''}
      ${maps.length ? vSec('Par carte', vList(maps.map((m) => vRow(`map:${m.id}`, '56px minmax(0,1fr) auto', `${thumb(csImg(m.id))}<span class="nm">${esc(mapName(m.id))}<small>${pl(rk(m), 'match', 'matchs')}</small></span><span class="kv num">${fr(m[field], d)}${unit ? ' ' + unit : ''}</span>`))), 'Les cartes avec au moins 3 matchs.') : ''}` }
  }
  V.sides = () => {
    const c = cs(), ct = c.sides.CT, te = c.sides.T
    if (!ct.rounds && !te.rounds) return { crumb: 'Counter-Strike 2', title: 'Tes côtés', html: `<p class="k-say">${THIN}</p>` }
    const side = (n, s, col) => `<div style="--c:${col}"><span class="who"><i></i>${n}</span><b class="big num">${isNum(s.winPct) ? fr(Math.round(s.winPct)) : '–'}<small>%</small></b><span class="br"><i style="width:${s.winPct || 0}%"></i></span><span class="m">${fr(s.won)} rounds gagnés sur ${fr(s.rounds)} · ${nf(s.kpr, 2)} kill/round</span></div>`
    const mini = (p, col) => `<span class="k-bar h" style="--c:${col}"><i style="width:${clamp(p || 0, 0, 100)}%;background:${col}"></i></span>`
    const ms = c.maps.filter((m) => m.ct.rounds + m.t.rounds > 0)
    return { crumb: 'Counter-Strike 2', title: 'Tes côtés', html: `
      <div class="k-sd is-vl">${side('Antiterroristes', ct, 'var(--ct)')}${side('Terroristes', te, 'var(--te)')}</div>
      ${ms.length ? vSec('Carte par carte', vColh('minmax(0,1fr) 110px 44px 110px 44px', ['<', 'CT', '<', 'T', '<']) + vList(ms.map((m) => vRow(`map:${m.id}`, 'minmax(0,1fr) 110px 44px 110px 44px', `<span class="nm">${esc(mapName(m.id))}<small>${fr(m.ct.rounds + m.t.rounds)} rounds</small></span>${mini(m.ct.winPct, 'var(--ct)')}<span class="kv num">${pc(m.ct.winPct)}</span>${mini(m.t.winPct, 'var(--te)')}<span class="kv num">${pc(m.t.winPct)}</span>`, m.ct.rounds < 20 || m.t.rounds < 20 ? 'few' : ''))), '% de rounds gagnés de chaque côté. Les lignes pâles ont moins de 20 rounds d’un côté.') : ''}` }
  }
  V.rounds = () => {
    const c = cs(), E = [['elimination', 'Élimination'], ['bomb', 'Bombe'], ['defuse', 'Désamorçage'], ['time', 'Temps écoulé']], br = c.bestRound
    if (!isNum(c.roundsWithKill)) return { crumb: 'Counter-Strike 2', title: 'Tes rounds', html: `<p class="k-say">${THIN}</p>` }
    const tot = E.reduce((n, [k]) => n + c.ends.won[k] + c.ends.lost[k], 0) || 1
    return { crumb: 'Counter-Strike 2', title: 'Tes rounds', html: `
      ${vNums(c.pistol.played > 0 && vNum(pc(c.pistol.winPct), 'Rounds pistolet gagnés', `${c.pistol.won} sur ${c.pistol.played}`), vNum(pc(c.roundsWithKill), 'Rounds avec un kill'), vNum(nf(c.kpr, 2), 'Kills par round'))}
      ${vSec('Rounds à plusieurs kills', `<div class="k-mk is-vl"><span><b class="big num">${c.multi.k3}</b><em>${xm()}3 kills</em></span><span><b class="big num">${c.multi.k4}</b><em>${xm()}4 kills</em></span><span><b class="big num">${c.multi.k5}</b><em>Ace</em></span></div>${br ? `<div style="margin-top:8px">${vList([vRow(`match:${br.id}`, '56px minmax(0,1fr) auto', `${thumb(csImg(br.map))}<span class="nm">Ton meilleur round<small>${esc(mapName(br.map))}, ${dayFr.format(br.at)}, round ${br.n}</small></span><span class="kv num">${pl(br.kills, 'kill')}, ${fr(br.damage)} dégâts</span>`)])}</div>` : ''}`)}
      ${vSec('Comment tes rounds se finissent', vList(E.map(([k, l]) => vRow('', '130px minmax(0,1fr) 150px', `<span class="nm">${l}</span><span class="k-split"><i style="flex:${c.ends.won[k]}"></i><s style="flex:${c.ends.lost[k]}"></s><u style="flex:${Math.max(0, tot / 2.2 - c.ends.won[k] - c.ends.lost[k])}"></u></span><span class="kv2 num"><b>${fr(c.ends.won[k])}</b> gagnés, ${fr(c.ends.lost[k])} perdus</span>`))), 'En couleur : les rounds gagnés de cette façon. En gris : les rounds perdus.')}` }
  }
  V.weapons = () => {
    const res = K.data.cs2.life
    if (!res.ok) return { crumb: 'Counter-Strike 2', title: 'Tes armes', html: `<div class="k-na is-vl"><b>Totaux de Counter-Strike 2 indisponibles</b><span>${esc(res.message || 'Steam ne répond pas pour le moment.')}</span>${LIFE_FIX[res.reason] ? act('fix', LIFE_FIX[res.reason], '', 'is-key') : res.reason === 'demo' ? '' : act('retry', ic('refresh') + 'Réessayer')}</div>` }
    const ws = res.stats.weapons, ids = new Set(ws.map((w) => w.id)), base = L.weaponBase(res.stats) || 1, t = res.stats.totals, hs = L.headshotPct(t), hrs = L.hoursOf(t)
    return { crumb: 'Counter-Strike 2', title: 'Tes armes', html: `
      ${vNums(isNum(hrs) && vNum(fr(Math.round(hrs)) + '<small>h</small>', 'En jeu, à vie'), isNum(t.kills) && vNum(fr(t.kills), 'Éliminations'), isNum(hs) && vNum(pc(hs), 'Headshots'), isNum(t.mvps) && vNum(fr(t.mvps), 'MVP'))}
      ${ws.length ? vList(ws.slice(0, 30).map((x, i) => vRow('', '22px minmax(0,1fr) 190px 64px 52px', `<span class="kv2 num" style="text-align:left">${i + 1}</span><span class="nm">${esc(L.weaponLabel(x.id, ids))}</span>${bar(x.kills / ws[0].kills * 100)}<span class="kv num">${fr(x.kills)}</span><span class="kv2 num">${fr(x.kills / base * 100, 1)} %</span>`))) : vEmpty('Aucune arme', 'Steam n’a encore rien compté pour ce compte.')}
      <p class="k-foot">À vie, d’après ton profil Steam. Ces totaux comptent aussi tes années CS:GO.${res.sample ? ` <span class="k-sample">${SAMPLE}</span>` : ''}${res.stale ? ' Derniers totaux connus.' : ''}</p>` }
  }
  V.days = () => {
    const c = cs(), top = topDay(c.weekdays), mx = Math.max(...c.weekdays.map((d) => d.winPct ?? 0), 1), dp = c.dayparts
    const P = [['matin', 'Le matin', '6 h à midi'], ['aprem', 'L’après-midi', 'midi à 18 h'], ['soir', 'Le soir', '18 h à minuit'], ['nuit', 'La nuit', 'minuit à 6 h']]
    if (c.weekdays.every((d) => d.winPct == null)) return { crumb: 'Counter-Strike 2', title: 'Quand tu gagnes', html: `<p class="k-say">Pas encore de match avec un résultat à ranger par jour.</p>` }
    return { crumb: 'Counter-Strike 2', title: 'Quand tu gagnes', html: `
      ${vSec('Par jour', `<div class="k-wk is-vl">${c.weekdays.map((d, i) => `<div class="${d.winPct == null ? 'none' : i === top ? 'top' : d.matches < 3 ? 'few' : ''}${d.winPct != null && d.matches < 3 && i !== top ? '' : ''}"><em class="num">${d.winPct != null ? Math.round(d.winPct) + ' %' : '–'}</em><i style="height:${d.winPct != null ? Math.max(4, d.winPct / mx * 120) : 2}px"></i><span>${DN[i].slice(0, 3)}.</span><small>${d.matches ? pl(d.matches, 'match', 'matchs') : ''}</small></div>`).join('')}</div>`, (top >= 0 ? `Ton meilleur jour : ${DN[top].toLowerCase()}.` : 'Pas assez de matchs pour désigner un meilleur jour (2 jours avec 3 matchs au moins).') + ' Les jours pâles ont moins de 3 matchs : à lire avec prudence.')}
      ${vSec('Par moment de la journée', vList(P.map(([k, l, hh]) => vRow('', 'minmax(0,1fr) 150px 54px 70px', `<span class="nm">${l}<small>${hh} · ${dp[k].matches ? pl(dp[k].matches, 'match', 'matchs') : 'aucun match'}</small></span>${bar(dp[k].winPct, 'h')}<span class="kv num">${pc(dp[k].winPct)}</span><span class="kv2 num">${isNum(dp[k].kd) ? 'K/D ' + fr(dp[k].kd, 2) : ''}</span>`, dp[k].matches < 5 ? 'few' : ''))), 'Les lignes pâles ont moins de 5 matchs.')}` }
  }
  /* ---------- Les clips d'un match : ceux que Player X a gardés entre le début et la fin ---------- */
  const clipsOfMatch = (r) => Clips.between(Real.statGame('cs2').rid, r.startedAt, r.endedAt)
  V.clips = (id) => {
    const r = recapById(id); if (!r) return null
    const list = clipsOfMatch(r)
    if (!list.length) return null
    return { crumb: 'Match', title: `Clips, ${mapName(r.map)} du ${dayFr.format(r.startedAt)}`, html: `
      <div class="k-clips ct-grid">${list.map((c) => `<div class="k-clip">${Clips.tileHTML(c)}<button class="k-b sm" data-act="clip-copy" data-v="${esc(c.id)}">${ic('copy')}<span>Copier pour Discord</span></button></div>`).join('')}</div>
      <p class="k-foot">Ce sont les clips enregistrés entre le début et la fin de ce match. Tous tes clips restent dans la page Clips.</p>`,
    after: (p) => $$('.ct-tile', p).forEach((t) => { t.onclick = () => Clips.open(t.dataset.id) }) }
  }

  /* ---------- Battlefield 6 : les volets ---------- */
  const bfThumb = (m) => (m.image ? thumb(m.image) : '<span></span>')
  const BK = { kd: ['K/D', 2, '', 'kdLife'], kpm: ['Éliminations par minute', 2, '', 'kpm'], winPct: ['Victoires', 0, '%', 'winPct'], hsPct: ['Headshots', 0, '%', null], accuracy: ['Précision', 1, '%', 'accuracy'], assists: ['Assistances', 0, '', null] }
  const wRow = (w, third, fourth) => vRow(`weapon:${w.name}`, '92px minmax(0,1fr) 62px 62px 56px', `${imgOf(w.image, 'gun')}<span class="nm">${esc(w.name)}${tierOf(w.name)}</span><span class="kv num">${third}</span><span class="kv2 num">${fourth[0]}</span><span class="kv2 num">${fourth[1]}</span>`)
  const wHead = (a, b2, c) => vColh('92px minmax(0,1fr) 62px 62px 56px', ['<', '<', a, b2, c])
  V.bkpi = (key) => {
    const b = bf(), def = BK[key]; if (!b || !def) return null
    const [label, d, unit, sk] = def, val = b[key]
    if (!isNum(val) || (key === 'winPct' && !(b.wins + b.losses > 0)) || (key === 'kpm' && !(val > 0))) return { crumb: 'Ton niveau', title: label, html: say('Le service de stats n’a pas encore ce chiffre pour ton profil.') }
    const pts = sk ? b.series.filter((p) => isNum(p[sk])) : [], u = unit ? `<small>${unit}</small>` : ''
    const dl = b.deltas.d30 && key === 'kd' && isNum(b.deltas.d30.kd) ? `${delta(b.deltas.d30.kd, val, 2)} sur ${b.deltas.d30.days} jours` : ''
    let more = ''
    if (key === 'kd' || key === 'kpm') {
      const cl = b.classes.filter((c) => isNum(key === 'kd' ? c.kd : c.kpm))
      more = cl.length ? vSec('Par classe', vList(cl.map((c) => { const o = classOf(c.name); return vRow(`class:${c.name}`, '12px minmax(0,1fr) 60px', `<i class="dot" style="background:${o.c}"></i><span class="nm">${esc(o.name)}</span><span class="kv num">${nf(key === 'kd' ? c.kd : c.kpm, 2)}</span>`) }))) : ''
    } else if (key === 'hsPct' || key === 'accuracy') {
      const f = key === 'hsPct' ? 'hsPct' : 'accuracy', ws = b.weapons.filter((w) => isNum(w[f])).slice(0, 8)
      more = ws.length ? vSec('Par arme', wHead('Élim.', label, '') + vList(ws.map((w) => wRow(w, fr(w.kills), [nf(w[f], f === 'hsPct' ? 0 : 1) + ' %', ''])))) : ''
    } else if (key === 'winPct') {
      const ms = b.maps.filter((m) => isNum(m.winPct)).slice(0, 6)
      more = ms.length ? vSec('Par carte', vList(ms.map((m) => vRow('bfmaps', '56px minmax(0,1fr) 120px 46px', `${bfThumb(m)}<span class="nm">${esc(m.name)}<small>${pl(m.matches, 'partie')}</small></span>${bar(m.winPct, 'h')}<span class="kv num">${pc(m.winPct)}</span>`)))) : ''
    }
    return { crumb: 'Ton niveau', title: label, html: `
      ${vBig(fr(val, d), unit, `${label} à vie${dl ? `<br>${dl}` : ''}`)}
      ${pts.length > 1 ? vSec('Tes relevés', `<div class="k-chw">${chartHTML(pts.map((p) => p[sk]), pts.map((p) => dayFr.format(p.at)), d, unit, key === 'kd' ? 1 : 4)}</div>`, 'Un relevé par jour, sur les 30 derniers jours. Passe sur un point : le jour.') : ''}
      ${more}` }
  }
  V.arsenal = () => {
    const b = bf(), ws = b.weapons, hs = hsCol(b)
    if (!ws.length) return { crumb: 'Battlefield 6', title: 'Ton arsenal', html: vEmpty('Aucune arme', 'Le service de stats n’a encore rien compté par arme.') }
    return { crumb: 'Battlefield 6', title: 'Ton arsenal', html: `
      ${wHead('Élim.', 'Précision', hs ? 'Têtes' : 'Élim./min')}${vList(ws.slice(0, 40).map((w) => wRow(w, fr(w.kills), [isNum(w.accuracy) ? nf(w.accuracy, 1) + ' %' : '', hs ? (isNum(w.hsPct) ? pc(w.hsPct) : '') : nf(w.kpm, 2)])))}
      <p class="k-foot">À vie, d’après ton profil. Le rang à côté d’une arme est celui de ton meilleur loadout.</p>` }
  }
  V.weapon = (name) => {
    const b = bf(), ws = b ? b.weapons : [], i = ws.findIndex((w) => same(w.name, name)), w = i >= 0 ? ws[i] : null, lo = loOf(name)
    if (!w && !lo.length) return null
    const shown = w ? w.name : lo[0].w, ex = { w: shown, img: lo[0]?.img, cat: lo[0]?.cat }
    const bits = w ? [isNum(w.sharePct) && `${nf(w.sharePct, 1)} % de tes éliminations`, isNum(w.hours) && w.hours > 0 && `${nf(w.hours, 1)} h en main`].filter(Boolean) : []
    return { crumb: 'Arme', title: shown, html: `
      <div class="k-gun">${Loadouts.art(ex)}<div><span class="k-kick">${w ? `Arme n°${i + 1} de ton arsenal · à vie` : 'Arme de tes loadouts'}</span><b class="big">${esc(shown)}</b><span>${bits.length ? bits.join(', ') : esc(Loadouts.catPl(lo[0]?.cat))}</span></div></div>
      ${w ? vNums(vNum(fr(w.kills), 'Éliminations'), isNum(w.accuracy) && vNum(nf(w.accuracy, 1) + '<small>%</small>', 'Précision'), isNum(w.hsPct) && vNum(fr(Math.round(w.hsPct)) + '<small>%</small>', 'À la tête'), isNum(w.kpm) && vNum(nf(w.kpm, 2), 'Élim./min')) : ''}
      ${vSec(`Tes loadouts pour ${esc(shown)}`, lo.length ? Loadouts.weaponHTML(shown) : note('Pas encore de loadout pour cette arme.'), '', lo.length ? 'Tous les loadouts' : '', 'loadouts')}
      ${vActs(`<button class="k-b is-key" data-open="atelier:new:${esc(shown)}">${ic('plus')}<span class="ell">Nouveau loadout ${esc(shown)}</span></button>`, w && `<button class="k-b" data-open="arsenal">Tout l’arsenal</button>`)}`,
    after: (p) => Loadouts.bind(p, () => paintSheets()) }
  }
  V.class = (name) => {
    const b = bf(), cl = b.classes.filter((c) => isNum(c.sharePct)).sort((x, y) => (y.sharePct || 0) - (x.sharePct || 0)), c = cl.find((x) => same(x.name, name)); if (!c) return null
    const o = classOf(c.name), hrs = isNum(c.seconds) && c.seconds > 0 ? c.seconds / 3600 : null
    return { crumb: 'Tes classes', title: o.name, html: `
      ${vNums(vNum(pc(c.sharePct), b.byTime ? 'Du temps de jeu' : 'Des éliminations'), isNum(c.kd) && vNum(nf(c.kd, 2), 'K/D'), isNum(c.kills) && vNum(fr(c.kills), 'Éliminations'), isNum(c.kpm) && vNum(nf(c.kpm, 2), 'Élim./min'), hrs && vNum(nf(hrs, 1) + '<small>h</small>', 'En jeu'))}
      ${vSec('Toutes tes classes', vList(cl.map((x) => { const q = classOf(x.name); return vRow(`class:${x.name}`, '12px minmax(0,1fr) 120px 46px 50px', `<i class="dot" style="background:${q.c}"></i><span class="nm">${esc(q.name)}</span>${bar(x.sharePct)}<span class="kv num">${pc(x.sharePct)}</span><span class="kv2 num">${isNum(x.kd) ? nf(x.kd, 2) : ''}</span>`, same(x.name, c.name) ? 'cur' : '') })), `Part ${b.byTime ? 'du temps de jeu' : 'des éliminations'} et K/D de chaque classe, à vie.`)}` }
  }
  V.vehicles = () => {
    const b = bf(), vs = b.vehicles, mx = vs[0]?.kills || 1
    if (!vs.length) return { crumb: 'Battlefield 6', title: 'Tes véhicules', html: vEmpty('Aucun véhicule', 'Le service de stats n’a encore rien compté en véhicule.') }
    return { crumb: 'Battlefield 6', title: 'Tes véhicules', html: `
      ${vNums(isNum(b.vehicleKillPct) && vNum(pc(b.vehicleKillPct), 'De tes éliminations en véhicule'), vNum(fr(vs.reduce((n, v) => n + v.kills, 0)), 'Éliminations en véhicule'))}
      ${vColh('minmax(0,1fr) 150px 62px 56px', ['<', '<', 'Élim.', 'Élim./min'])}${vList(vs.map((v) => vRow('', 'minmax(0,1fr) 150px 62px 56px', `<span class="nm">${esc(v.name)}</span>${bar(v.kills / mx * 100)}<span class="kv num">${fr(v.kills)}</span><span class="kv2 num">${nf(v.kpm, 2)}</span>`)))}
      <p class="k-foot">À vie, d’après ton profil.</p>` }
  }
  V.bfmaps = () => {
    const b = bf(), ms = b.maps.filter((m) => isNum(m.winPct)), md = b.modes.filter((m) => isNum(m.winPct))
    if (!ms.length && !md.length) return { crumb: 'Battlefield 6', title: 'Cartes et modes', html: vEmpty('Rien à montrer', 'Le service de stats n’a encore rien compté par carte ni par mode.') }
    const row = (m, cur) => vRow('', '56px minmax(0,1fr) 150px 46px', `${bfThumb(m)}<span class="nm">${esc(m.name)}<small>${pl(m.matches, 'partie')}</small>${cur === 'b' ? '<em>Ta meilleure</em>' : cur === 'w' ? '<em class="lo">À travailler</em>' : ''}</span>${bar(m.winPct, 'h')}<span class="kv num">${pc(m.winPct)}</span>`, m.matches < 5 ? 'few' : '')
    const best = b.bestMap, worst = b.worstMap
    return { crumb: 'Battlefield 6', title: 'Cartes et modes', html: `
      ${ms.length ? vSec('Tes cartes', vList(ms.map((m) => row(m, best && m.name === best.name ? 'b' : worst && m.name === worst.name ? 'w' : ''))), 'Les lignes pâles ont moins de 5 parties.') : ''}
      ${md.length ? vSec('Tes modes', vList(md.map((m) => row(m, ''))), '% de victoires, à vie. Le trait marque 50 %.') : ''}` }
  }
  const sessRow = (s) => vRow(`session:${s.id}`, 'minmax(0,1fr) 128px 54px 62px', `<span class="nm">${esc(dayFr.format(s.at))}<small>${esc(s.maps.slice(0, 2).join(', ') || pl(s.matches, 'partie'))}</small></span><span class="res ${s.wins >= s.losses && s.wins > 0 ? 'w' : ''}">${pl(s.wins, 'victoire')}, ${s.losses} D</span><span class="kv num">${nf(s.kd, 2)}</span><span class="kv2 num">${s.kills}/${s.deaths}</span>`)
  V.sessions = () => {
    const b = bf(), ss = b.sessions
    if (!ss.length) return { crumb: 'Battlefield 6', title: 'Tes sessions', html: vEmpty('Aucune session', 'Joue à Battlefield 6 avec ton profil relié : chaque session arrive ici après la partie.') }
    const ch = ss.slice().reverse().filter((s) => isNum(s.kd)), bs = b.bestSession
    return { crumb: 'Battlefield 6', title: 'Tes sessions', html: `
      ${bs ? vNums(vNum(nf(bs.kd, 2), 'K/D de ta meilleure session', esc(dayFr.format(bs.at))), vNum(fr(ss.length), pl(ss.length, 'session').replace(/^[\d  ]+/, ''), `${fr(ss.reduce((n, s) => n + s.matches, 0))} parties`)) : ''}
      ${ch.length > 1 ? vSec('K/D, session après session', `<div class="k-chw">${chartHTML(ch.map((s) => s.kd), ch.map((s) => dayFr.format(s.at)), 2, '', 1)}</div>`) : ''}
      ${vColh('minmax(0,1fr) 128px 54px 62px', ['<', '<', 'K/D', 'Élim./morts'])}${vList(ss.map(sessRow))}
      <p class="k-foot">Une session : les parties jouées entre deux relevés de ton profil.${K.data.bf6.sampleOnly ? ` <span class="k-sample">${SAMPLE}</span>` : ''}</p>` }
  }
  V.session = (id) => {
    const D = K.data.bf6, b = D.agg, s = b.sessions.find((x) => x.id === id); if (!s) return null
    const rec = D.recaps.find((r) => r.id === id), role = s.role ? classOf(s.role) : null
    return { crumb: 'Session', title: `Session du ${dayFr.format(s.at)}`, html: `
      ${vArt(s.maps.length && D.recaps.find((r) => r.id === id)?.maps?.[0]?.image || bfHero(), `Session · ${esc(dayLong.format(s.at))}`, `<i class="${s.wins >= s.losses && s.wins > 0 ? 'w' : ''}">${pl(s.wins, 'victoire')}, ${pl(s.losses, 'défaite')}</i>`, `${pl(s.matches, 'partie')} en ${fr(Math.round(s.minutes))} min${s.maps.length ? ` · ${esc(s.maps.join(', '))}` : ''}`)}
      ${vNums(isNum(s.kd) && vNum(nf(s.kd, 2), 'K/D', isNum(s.kdVsAvg) ? `${delta(s.kd, s.kd - s.kdVsAvg, 2)} contre ta moyenne` : ''), vNum(`${s.kills}/${s.deaths}`, 'Élim. / morts'), isNum(s.kpm) && vNum(nf(s.kpm, 2), 'Élim./min'))}
      ${s.weapon || role ? vSec('Ce que tu as joué', vList([s.weapon && vRow(`weapon:${s.weapon}`, 'minmax(0,1fr) auto', `<span class="nm">Ton arme</span><span class="kv num">${esc(s.weapon)}</span>`), role && vRow('', 'minmax(0,1fr) auto', `<span class="nm">Ta classe</span><span class="kv num">${esc(role.name)}</span>`)].filter(Boolean))) : ''}
      ${sampleOf(rec || {}) ? `<p class="demo">${SAMPLE}</p>` : ''}
      ${vActs(rec && canStory('bf6') && act('story', 'Ouvrir le bilan', 'session:' + s.id, 'is-key'), `<button class="k-b" data-open="sessions">Toutes les sessions</button>`)}` }
  }

  /* ---------- Classement, suivre un joueur, un rival ---------- */
  const BCOLS = '24px minmax(0,1fr) 54px 62px 62px 64px 16px'
  const bcell = (p, k, f) => (p.loading ? '…' : isNum(p[k]) ? f(p[k]) : '–')
  function noBoard(title) { return { crumb: 'Battlefield 6', title, html: vEmpty('Classement indisponible', 'Relie ton profil Battlefield 6 pour te comparer à d’autres joueurs.') } }
  V.board = () => {
    const R = boardRows(); if (!R || !R.me) return noBoard('Classement')
    const rows = R.list.map((p) => ({ r: p, d: Board.player(p.key) || {} }))
    return { crumb: 'Battlefield 6', title: 'Classement', html: `
      <div class="k-flt" role="group" aria-label="Critère">${R.metrics.map((m) => `<button class="${m.k === R.metric.k ? 'on' : ''}" data-act="metric" data-v="${esc(m.k)}" aria-pressed="${m.k === R.metric.k}">${esc(m.l)}</button>`).join('')}</div>
      ${R.line ? say(R.line) : ''}
      ${vColh(BCOLS.replace(' 16px', ''), ['<', '<', 'K/D', 'Élim./min', 'Victoires', 'Éliminations'])}
      ${vList(rows.map(({ r, d }, i) => `<li class="k-vr ${r.me ? 'me' : ''}" ${r.me ? '' : op('rival:' + r.key)} style="grid-template-columns:${BCOLS}"><span class="kv2 num" style="text-align:left">${isNum(r.rank) ? r.rank : '–'}</span><span class="nm">${esc(r.name)}${r.me ? '<small>toi</small>' : ''}${r.error ? '<small>stats indisponibles</small>' : ''}</span><span class="kv num ${R.metric.k === 'kd' ? 'lead' : ''}">${bcell(d, 'kd', (n) => fr(n, 2))}</span><span class="kv2 num">${bcell(d, 'kpm', (n) => fr(n, 2))}</span><span class="kv2 num">${bcell(d, 'win', (n) => fr(Math.round(n)) + ' %')}</span><span class="kv2 num">${bcell(d, 'kills', (n) => fr(n))}</span>${r.me ? '<span></span>' : ic('chev')}</li>`))}
      ${vActs(R.full ? '' : `<button class="k-b is-key" data-open="follow">${ic('plus')}Suivre un joueur</button>`)}
      <p class="k-foot">${R.full ? 'Tu suis 12 joueurs, le maximum : retire-en un pour en suivre un autre. ' : ''}Chiffres à vie, relus sur le même service de stats pour tout le monde. Clique un joueur pour te comparer à lui.${R.list.some((p) => p.stale) ? ' Certains chiffres sont les derniers connus.' : ''}</p>` }
  }
  V.follow = () => {
    const R = boardRows(); if (!R || !R.me) return noBoard('Suivre un joueur')
    return { crumb: 'Classement', title: 'Suivre un joueur', html: R.full
      ? vEmpty('Tu suis déjà 12 joueurs', 'C’est le maximum. Retire un joueur du classement pour en suivre un autre.')
      : `<p class="k-say">Entre le pseudo EA exact du joueur : tu seras classé avec lui sur les mêmes chiffres.</p><div id="flSearch"></div>`,
    after: (p) => {
      const box = $('#flSearch', p); if (!box) return
      PlayerSearch.mount(box, { action: 'Suivre', exclude: Board.keys(), autofocus: true, onPick: async (a) => {
        const r = await Board.follow(a)
        if (!r.ok) { toast(esc(r.msg || 'Le joueur n’a pas pu être suivi.'), { tone: 'warn', ms: 5000 }); return }
        toast(`${ic('check')} ${esc(a.name)} suivi`, { ms: 2400 })
        if (K.sheet.at(-1) === 'follow') { K.sheet.pop(); if (!K.sheet.length) K.sheet.push('board'); K.anim = true; paintSheets(); paintAll() }
      } })
    } }
  }
  V.rival = (key) => {
    const R = boardRows(); if (!R || !R.me) return noBoard('Classement')
    const pl2 = Board.player(key), me = Board.player(R.me); if (!pl2 || pl2.me || !me) return null
    const M = [['K/D', 'kd', 2, ''], ['Élim. par minute', 'kpm', 2, ''], ['Victoires', 'win', 0, ' %'], ['Éliminations', 'kills', 0, '']]
    const ok = !pl2.error && M.every(([, k]) => isNum(pl2[k]) && isNum(me[k]))
    const acts = vActs(`<button class="k-b is-key" data-open="board">Tout le classement</button>`, `<button class="k-b" data-act="unfollow" data-v="${esc(key)}">Ne plus suivre</button>`)
    if (!ok) return { crumb: 'Classement', title: `Toi contre ${pl2.name}`, html: `${vEmpty(pl2.error ? 'Stats indisponibles' : 'Chiffres en cours de lecture', pl2.error ? esc(pl2.error) : 'Les chiffres de ce joueur arrivent : réessaie dans un instant.')}${acts}` }
    const ahead = M.filter(([, k]) => me[k] > pl2[k]).length, behind = M.filter(([, k]) => me[k] < pl2[k]).length
    return { crumb: 'Classement', title: `Toi contre ${pl2.name}`, html: `
      <div class="k-big"><b class="big num">${ahead}<small>/4</small></b><span>${ahead > behind ? 'Tu es devant sur' : behind > ahead ? `${esc(pl2.name)} est devant sur` : 'Vous êtes à égalité sur'} ${ahead > behind ? pl(ahead, 'chiffre') : pl(Math.max(behind, ahead), 'chiffre')} sur 4.<br>À vie, d’après le même service de stats pour vous deux.</span></div>
      ${vColh('minmax(0,1fr) 110px 110px', ['<', 'Toi', esc(pl2.name)])}
      ${vList(M.map(([l, k, d, u]) => vRow('', 'minmax(0,1fr) 110px 110px', `<span class="nm">${l}</span><span class="kv num ${me[k] > pl2[k] ? 'lead' : ''}">${fr(me[k], d)}${u}</span><span class="kv num ${pl2[k] > me[k] ? 'lead' : ''}">${fr(pl2[k], d)}${u}</span>`)), 'vs2')}
      ${pl2.stale ? `<p class="k-foot">${esc(pl2.stale)}</p>` : ''}${acts}` }
  }
  V.loadouts = () => ({ crumb: 'Battlefield 6', title: 'Loadouts', html: Loadouts.listHTML(), after: (p) => Loadouts.bind(p, () => paintSheets()) })
  V.atelier = () => ({ crumb: 'Battlefield 6', title: 'Atelier de loadouts', wide: true, bare: true, html: '', host: true })

  /* ---------- Le moteur : la pile de volets ---------- */
  const CSK = new Set(['matches', 'match', 'maps', 'map', 'kpi', 'sides', 'rounds', 'weapons', 'days', 'clips'])
  const BFK = new Set(['loadouts', 'weapon', 'arsenal', 'class', 'vehicles', 'bfmaps', 'sessions', 'session', 'bkpi', 'board', 'follow', 'rival', 'atelier'])
  const FREE = new Set(['loadouts', 'weapon', 'board', 'follow', 'rival', 'atelier'])
  const split = (t) => { const i = String(t).indexOf(':'); return i < 0 ? [String(t), ''] : [t.slice(0, i), t.slice(i + 1)] }
  const loading = () => '<div class="sp-sk" aria-busy="true"><span class="sr-only" role="status">Lecture de tes stats</span><i class="sp-skc" aria-hidden="true"></i></div>'
  const layer = () => $('#ckLayer')
  function build(t) {
    const [kind, arg] = split(t), g = K.g
    if (!(g === 'cs2' ? CSK : BFK).has(kind)) return null
    if (g === 'bf6' && !linked('bf6') && kind !== 'loadouts' && kind !== 'weapon' && kind !== 'atelier') return null
    const D = K.data[g], game = g === 'cs2' ? 'Counter-Strike 2' : 'Battlefield 6'
    if (!FREE.has(kind)) {
      if (!D || !dataOk(g)) return K.ready[g] && !D ? { crumb: game, title: 'Détail', html: vEmpty('Stats indisponibles', 'Player X n’a pas pu lire tes stats. Réessaie dans un instant.') } : { crumb: game, title: 'Lecture de tes stats', html: loading() }
      if (g === 'bf6' && !D.agg) return { crumb: game, title: 'Détail', html: vEmpty('Stats indisponibles', esc(D.fail || 'Le service de stats ne répond pas.')) }
      if (g === 'cs2' && kind !== 'weapons' && !D.recaps.length) return null
    }
    const f = V[kind]
    try { return f ? f(arg) : null } catch (e) { console.error(e); return null }
  }
  // Ce qui a ouvert le volet : retrouvé par ses attributs, car la page dessous peut avoir été redessinée entre-temps
  const sigOf = (el) => (el ? { tag: el.tagName, cls: el.className, o: el.dataset?.open, a: el.dataset?.act, v: el.dataset?.v, id: el.id, p: el.dataset?.period } : null)
  function reOpener() {
    const o = K.opener; if (o?.isConnected) return o
    const g = K.openerSel, sc = scEl(); if (!g || !sc) return null
    const q = g.o != null ? `[data-open="${CSS.escape(g.o)}"]` : g.a ? `[data-act="${CSS.escape(g.a)}"]${g.v != null ? `[data-v="${CSS.escape(g.v)}"]` : ''}` : g.p ? `[data-period="${CSS.escape(g.p)}"]` : g.id ? `#${CSS.escape(g.id)}` : null
    if (!q) return null
    const list = [...sc.querySelectorAll(q)].filter((e) => e.matches('button,a,input,[tabindex]'))
    return list.find((e) => e.tagName === g.tag && e.className === g.cls) || list[0] || null
  }
  // Tant qu'un volet est ouvert, rien d'autre ne prend le focus : tout ce qui est hors du volet est inerte. Les commandes de la fenêtre, les messages et les fenêtres restent libres.
  const KEEP = '#ckLayer, #toasts, .t-ctrl, dialog, [data-modal], #pxMenu'
  function trap(on) {
    const modal = !!document.querySelector('[data-modal]:not([hidden])')
    $$('[data-ck-inert]').forEach((e) => { e.removeAttribute('data-ck-inert'); if (!(modal && e.parentElement?.id === 'win')) e.inert = false })
    if (!on) return
    const keeps = [...document.querySelectorAll(KEEP)]
    const walk = (node) => {
      for (const c of node.children) {
        if (c.inert || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(c.tagName) || keeps.includes(c)) continue
        if (keeps.some((k) => c.contains(k))) walk(c)
        else { c.inert = true; c.setAttribute('data-ck-inert', '') }
      }
    }
    walk(document.body)
  }
  function paintSheets() {
    const lay = layer(), sc = scEl(); if (!lay) return
    const t = K.sheet.at(-1)
    if (!t) {
      if (lay.firstChild) lay.replaceChildren()
      lay.hidden = true; trap(false)
      const back = K.had ? reOpener() : null
      K.opener = null; K.openerSel = null
      if (back) back.focus({ preventScroll: true })
      K.had = false
      return
    }
    const sp = build(t)
    if (!sp) { K.sheet.pop(); return paintSheets() }
    const old = $('.vl', lay)
    if (t === 'atelier' && old && old.dataset.t === 'atelier' && $('.at', old)) { K.anim = false; return }
    const keep = old && old.dataset.t === t && !K.anim ? $('.vl-s', old).scrollTop : 0, hadFocus = !!old && old.contains(document.activeElement)
    const depth = K.sheet.length
    const first = !K.had
    lay.hidden = false; K.had = true; if (first) trap(true)
    lay.innerHTML = `<div class="vl-scrim" data-act="shut"></div><section class="vl ${sp.wide ? 'wide' : ''} ${sp.bare ? 'bare' : ''} ${K.anim ? 'in' : ''}" role="dialog" aria-modal="true" aria-label="${esc(sp.title)}" tabindex="-1" data-t="${esc(t)}">
      <header class="vl-h">${depth > 1 ? `<button class="vl-back" data-act="back" aria-label="Retour" data-tip="Retour" data-tip-b>${ic('back')}</button>` : ''}<div class="vl-t"><span class="k-kick">${esc(sp.crumb || '')}</span><h2>${esc(sp.title)}</h2></div><span class="k-spc"></span><button class="vl-x" data-act="shut" aria-label="Fermer" data-tip="Fermer" data-tip-b data-tip-l>${ic('close')}</button></header>
      <div class="vl-s">${sp.html}</div></section>`
    const v = $('.vl', lay), body = $('.vl-s', v)
    if (keep) body.scrollTop = keep
    if (sp.host) Atelier.render(body)
    sp.after?.(body)
    if (K.anim || hadFocus) v.focus({ preventScroll: true })
    if (K.flash) {
      const box = $(`.lc-box[data-id="${K.flash}"]`, v)
      if (box) { box.classList.add('is-new'); box.scrollIntoView({ block: 'nearest' }); setTimeout(() => box.classList.remove('is-new'), 1400); $('[data-a=edit]', box)?.focus({ preventScroll: true }) }
      K.flash = null
    }
    K.anim = false
  }
  const kindOf = (t) => split(t)[0]
  function open(t) {
    t = String(t || '').trim()
    if (!t || !K.g || S.view !== 'stats' || !scEl()?.querySelector('.ck')) return
    const [kind, arg] = split(t)
    if (S.atelier) return
    if (kind === 'atelier') return openAtelier(arg)
    if (!(K.g === 'cs2' ? CSK : BFK).has(kind)) return
    const at = K.sheet.indexOf(t)
    if (at >= 0) K.sheet = K.sheet.slice(0, at + 1)
    else { if (!K.sheet.length) { const a = document.activeElement; K.opener = a && a !== document.body ? a : null; K.openerSel = sigOf(K.opener) }; K.sheet.push(t) }
    K.anim = true; paintSheets()
  }
  function openAtelier(arg) {
    const [k, id] = split(arg || 'new')
    if (k === 'edit') { const b = BUILDS.find((x) => x.id === id); if (!b) return; Atelier.edit(b) }
    else if (k === 'draft') Atelier.resume(id || null)
    else if (k === 'new' && id) { const b = BUILDS.find((x) => same(x.w, id)); Atelier.create({ w: b ? b.w : id, cat: b?.cat }, true) }
    else Atelier.create(null, true)
    // L'atelier annonce lui-même le repeint (en fondu) ; le volet n'attend pas ce fondu pour s'ouvrir
    if (S.atelier) { K.atT = `atelier:${arg || 'new'}`; syncAtelier(); K.anim = true; paintSheets() }
  }
  // Un volet de moins : le dernier ouvert. Rend vrai si quelque chose s'est fermé.
  function close() {
    if (!K.sheet.length) return false
    if (S.atelier) { leaveAtelier(); return true }
    K.sheet.pop(); K.anim = true; paintSheets(); return true
  }
  function leaveAtelier() { Atelier.leave(); syncAtelier(); K.anim = true; paintSheets() }
  function shut() {
    if (S.atelier) { leaveAtelier(); return }
    K.sheet = []; K.anim = false; paintSheets()
  }
  const setPeriod = (p) => {
    if (!PERIOD[p] || K.period === p) return
    K.period = p
    const had = document.activeElement?.dataset?.period
    paintHead(); paintBody(); if (K.sheet.length && !['follow', 'atelier'].includes(K.sheet.at(-1))) paintSheets()
    if (had) $(`#ckHR [data-period="${p}"]`)?.focus({ preventScroll: true })
  }
  const ACT = {
    refresh: () => refresh(),
    retry: () => { if (K.g === 'bf6' && Real.st.tracked === undefined) return render(); K.data[K.g] = null; K.ready[K.g] = false; paintBody(); ensure(K.g, true) },
    shut: () => shut(),
    back: () => close(),
    settings: () => Settings.open('general'),
    fix: () => Settings.open('accounts'),
    story: (v) => {
      const [k, id] = split(v)
      if (k === 'match') { const r = recapById(id); if (r && canStory('cs2')) Recap.openCs2(r) } else { const r = K.data.bf6?.recaps.find((x) => x.id === id); if (r && canStory('bf6')) Recap.openBf6(r) }
    },
    vf: (v) => { K.vf = v; paintSheets() },
    metric: (v) => { if (hasBoard()) Board.setMetric(v); paintSheets(); if (K.data.bf6?.agg) paintBody() },
    'clip-copy': (v, el) => { const c = CLIPS.find((x) => x.id === v); if (c) Clips.copy(c, el) },
    unfollow: (v) => { if (!hasBoard()) return; Board.unfollow(v); if (K.sheet.at(-1) === `rival:${v}`) K.sheet.pop(); K.anim = true; paintSheets(); if (K.data.bf6?.agg) paintBody() }
  }
  function onClick(e) {
    const el = e.target.closest?.('[data-act],[data-open],[data-period]'); if (!el) return
    if (el.dataset.act) { const f = ACT[el.dataset.act]; if (f) { e.preventDefault(); f(el.dataset.v ?? '', el) } return }
    if (el.dataset.period) { e.preventDefault(); setPeriod(el.dataset.period); return }
    if (el.dataset.open) { e.preventDefault(); open(el.dataset.open) }
  }
  function onKey(e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return
    const el = e.target.closest?.('[role="button"][data-open]'); if (!el || el !== e.target) return
    e.preventDefault(); open(el.dataset.open)
  }
  // Échap ferme le volet du dessus. L'atelier garde son propre Échap (il garde le brouillon), comme les fenêtres, le lecteur de clips et la fiche d'un jeu.
  function onEsc(e) {
    if (e.key !== 'Escape' || e.defaultPrevented || S.view !== 'stats' || !K.sheet.length || S.atelier || S.gameId) return
    if (Clips.isOpen() || document.querySelector('[data-modal]:not([hidden]), dialog[open], :popover-open')) return
    e.preventDefault(); e.stopPropagation(); close()
  }
  // Le classement change (relu, suivi, retiré, annulé) : la tuile et le volet suivent
  let bt = 0, keyBound = false, unsub = null
  function onBoard() {
    if (bt) return
    bt = requestAnimationFrame(() => {
      bt = 0
      if (S.view !== 'stats' || K.g !== 'bf6' || !scEl()?.querySelector('.ck')) return
      if (K.data.bf6?.agg && dataOk('bf6')) { const b = $('#ckBody'); if (b && $('.k-grid', b)) b.innerHTML = bf6Body() }
      const t = K.sheet.at(-1)
      if (t && ['board', 'rival'].includes(kindOf(t))) paintSheets()
    })
  }
  function setup(sc) {
    if (!sc.dataset.ck) { sc.dataset.ck = '1'; sc.addEventListener('click', onClick); sc.addEventListener('keydown', onKey) }
    let lay = layer()
    if (!lay || !lay.isConnected) { lay = h('<div class="vl-layer" id="ckLayer" hidden></div>'); secEl().append(lay); lay.addEventListener('click', onClick); lay.addEventListener('keydown', onKey) }
    if (!keyBound) { keyBound = true; document.addEventListener('keydown', onEsc, true) }
    if (!unsub && hasBoard() && typeof Board.onChange === 'function') unsub = Board.onChange(onBoard)
    Loadouts.setOnImg(() => { if (S.view === 'stats' && K.g === 'bf6') { const t = K.sheet.at(-1); if (t && ['loadouts', 'weapon'].includes(kindOf(t))) paintSheets() } })
  }
  return {
    render, open, close, setPeriod, reset, leave: reset,
    state: () => ({ g: K.g, period: K.period, sheet: K.sheet.map((t) => (t === 'atelier' && K.atT ? K.atT : t)), ready: !!K.g && ((K.g === 'bf6' && Real.st.tracked && !Real.st.tracked.me) || (!!K.data[K.g] && K.ready[K.g])) })
  }
})()

/* ---------- Loadouts : les cartes de build, leurs gestes, et les pièces que le volet « Loadouts » du Cockpit assemble ---------- */
const Loadouts = (() => {
  const SLOTS = ['optic', 'optic-accessory', 'muzzle', 'barrel', 'underbarrel', 'magazine', 'ammo', 'accessory', 'left-accessory', 'right-accessory', 'ergonomics']
  const TIERS = ['S', 'A', 'B', 'C']
  const CAT_PL = { 'Mitraillette': 'Mitraillettes', 'Fusil d’assaut': 'Fusils d’assaut', 'Mitrailleuse légère': 'Mitrailleuses légères', 'Fusil de précision': 'Fusils de précision', 'Carabine': 'Carabines', 'Fusil de tireur d’élite': 'Fusils de tireur d’élite', 'Fusil à pompe': 'Fusils à pompe', '': 'Sans catégorie' }
  const rank = (t) => { const i = TIERS.indexOf(t); return i < 0 ? 9 : i }
  const total = (x) => Object.values(x.parts).reduce((a, p) => a + (p[1] || 0), 0)
  const eq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
  const textOf = (d) => `${d.w}, ${d.name}${d.tier ? `, ${d.tier} tier` : ''} (${total(d)}/100)\n` + SLOTS.filter((s) => d.parts[s]).map((s) => `${SLOT[s]} : ${d.parts[s][0]}${d.parts[s][1] != null ? ` (${d.parts[s][1]})` : ''}`).join('\n')
  const groups = () => { const m = new Map(); BUILDS.forEach((x) => { if (!m.has(x.w)) m.set(x.w, { w: x.w, cat: x.cat, img: x.img, list: [] }); m.get(x.w).list.push(x) }); return [...m.values()].map((g) => ({ ...g, list: g.list.slice().sort((a, b) => rank(a.tier) - rank(b.tier)), best: g.list.map((x) => x.tier).sort((a, b) => rank(a) - rank(b))[0] })) }
  let cat = 'all', onImg = null
  // Les vraies images des armes, celles de l'arsenal (service de stats), dès que ton profil BF6 est relié.
  // Sinon, l'image gardée dans l'appli, puis le dessin.
  const wkey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const WIMG = new Map()
  let wimgAsked = false
  function feed(list) {
    let fresh = false
    ;(list || []).forEach((w) => { if (w.image && w.name && WIMG.get(wkey(w.name)) !== w.image) { WIMG.set(wkey(w.name), w.image); fresh = true } })
    if (fresh) onImg?.()
  }
  function loadWimg() {
    if (wimgAsked || !Real.st.tracked?.me) return
    wimgAsked = true
    API.bf6Stats(Real.st.tracked.me, false).then((snap) => feed(snap?.stats?.weapons)).catch(() => { wimgAsked = false })
  }
  function art(g) {
    const r = WIMG.get(wkey(g.w))
    if (r) return `<img src="${esc(r)}" alt="" draggable="false" data-fb="1">`
    if (g.img) return `<img src="${esc(A(g.img))}" alt="" draggable="false">`
    if (!$('#lwaDefs')) document.body.append(h(`<svg id="lwaDefs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${WEAPON_ART.DEFS_A}</defs></svg>`))
    return `<svg viewBox="0 0 512 256" aria-hidden="true">${g.cat === 'Fusil de précision' || g.cat === 'Fusil de tireur d’élite' ? WEAPON_ART.SNIPER_A : WEAPON_ART.RIFLE_A}</svg>`
  }
  const tierTag = (t, cls = '') => t ? `<span class="lc-tier is-${t} ${cls}">${t}</span>` : ''
  // Une arme : son image, son nom, son meilleur rang s'il y en a un, et le nombre de loadouts en petite pastille
  const tile = (g) => `<button class="lw" data-w="${esc(g.w)}" data-open="weapon:${esc(g.w)}" aria-label="${esc(g.w)}, ${g.list.length} loadout${g.list.length > 1 ? 's' : ''}${g.best ? `, meilleur ${g.best} tier` : ''}"><span class="lw-art">${art(g)}</span>${tierTag(g.best, 'lw-tier')}<span class="lw-t"><b>${esc(g.w)}</b></span><span class="lw-n num" aria-hidden="true">${g.list.length}</span><span class="lw-go">${ic('chev')}</span></button>`
  // Un brouillon pas encore enregistré : une carte en attente, pointillée, qui dit ce qu'il y a dedans. Un clic n'importe où la reprend.
  const draftCard = (d) => {
    const meta = [d.n ? `${d.n} accessoire${d.n > 1 ? 's' : ''}` : 'Aucun accessoire', d.n ? `${d.pts}/100` : '', `gardé ${d.when}`].filter(Boolean).join(', ')
    const on = Math.min(10, Math.round(d.pts / 10))
    return `<div class="lo-dc">
      <button class="lo-dc-main" data-dgo="${esc(d.id || '')}" aria-label="Reprendre ${esc(d.edit ? d.title : `le brouillon ${d.label}`)}">
        <span class="lo-dc-art">${d.w ? art({ img: d.img, cat: d.cat }) : ic('plus')}</span>
        <span class="lo-dc-t"><em>${d.edit ? 'Modification non enregistrée' : 'Brouillon'}</em><b>${esc(d.w || 'Arme pas encore choisie')}${d.name ? `<span>${esc(d.name)}</span>` : ''}</b><small>${esc(meta)}</small>${d.n ? `<i class="lc-hatch" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</i>` : ''}</span>
        <span class="lo-dc-go">Reprendre${ic('chev')}</span>
      </button>
      <button class="lo-dc-x" data-ddrop="${esc(d.id || '')}" aria-label="Jeter ce brouillon" data-tip="Jeter le brouillon" data-tip-r>${ic('trash')}</button>
    </div>`
  }
  const draftBar = () => { const l = Atelier.drafts(); return l.length ? `<div class="lo-drafts">${l.map(draftCard).join('')}</div>` : '' }
  // La liste des armes qui ont un loadout, par type d'arme. Les clics qui ouvrent une arme ou l'atelier passent par [data-open] (le Cockpit).
  function listHTML() {
    loadWimg()
    const G0 = groups(), cats = [...new Set(G0.map((g) => g.cat))]
    if (cat !== 'all' && !cats.includes(cat)) cat = 'all'
    if (!G0.length) {
      const dl = Atelier.drafts()
      const seed = `<button class="k-b" id="loSeed">Ajouter mes ${Real.templates().length} builds</button>`
      return dl.length
        ? `<div class="lo-empty lo-dempty"><h3>${dl.length > 1 ? 'Tes loadouts en cours t’attendent' : 'Ton premier loadout t’attend'}</h3><p>${dl.length > 1 ? 'Reprends-en un là où tu l’as laissé' : 'Reprends-le là où tu l’as laissé'}, ou commence-en un autre.</p><div class="lo-drafts">${dl.map(draftCard).join('')}</div><div class="at-e2"><button class="k-b is-key" id="loNew0" data-open="atelier:new">${ic('plus')}Créer un autre loadout</button>${seed}</div></div>`
        : `<div class="lo-empty"><h3>Aucun loadout pour l’instant</h3><p>Note ton premier build : tu le retrouves ici avant chaque partie.</p><div class="at-e2"><button class="k-b is-key" id="loNew0" data-open="atelier:new">${ic('plus')}Créer un loadout</button>${seed}</div></div>`
    }
    const shown = cats.filter((c) => cat === 'all' || c === cat)
    return `${draftBar()}<div class="lo-top"><div class="k-flt lo-cats" role="group" aria-label="Type d’arme"><button class="${cat === 'all' ? 'on' : ''}" data-c="all" aria-pressed="${cat === 'all'}">Toutes</button>${cats.map((c) => `<button class="${cat === c ? 'on' : ''}" data-c="${esc(c)}" aria-pressed="${cat === c}">${esc(CAT_PL[c] || c)}</button>`).join('')}</div><button class="k-b is-key" id="loNew" data-open="atelier:new">${ic('plus')}Créer un loadout</button></div>
      <div class="lo-all">${shown.flatMap((c) => G0.filter((g) => g.cat === c)).map(tile).join('')}</div>`
  }
  // Les cartes d'une arme, du meilleur rang au moins bon
  function weaponHTML(w) {
    const list = BUILDS.filter((x) => eq(x.w, w)).sort((a, b) => rank(a.tier) - rank(b.tier))
    return list.length ? `<div class="lo-grid">${list.map(cardBox).join('')}</div>` : ''
  }
  const cardBox = (x) => `<div class="lc-box" data-id="${x.id}">${cardHTML(x)}${actsHTML(x)}</div>`
  // La carte : petite image de l'arme, nom, points. Les stats du jeu quand l'arme est relevée. Puis les accessoires avec leurs points, rien d'autre.
  // C'est aussi elle que « Copier l'image » colle sur Discord : elle se suffit à elle-même.
  function cardHTML(d) {
    const tot = total(d), filled = SLOTS.filter((s) => d.parts[s]), st = typeof Atelier !== 'undefined' ? Atelier.statsHTML(d.w, d.parts) : ''
    return `<article class="lc ${tot > 100 ? 'over' : ''}">
      <header class="lc-h"><span class="lc-th">${art(d)}</span><div class="lc-ht"><h3>${tierTag(d.tier)}<span>${esc(d.name)}</span></h3><p class="lc-wn">${esc(d.w)}</p>${d.ctx ? `<p class="lc-cx">${esc(d.ctx)}</p>` : ''}</div><b class="lc-tot num">${tot}<small>/100</small></b></header>
      ${st}
      ${filled.length ? `<ol class="lc-rows">${filled.map((s) => { const p = d.parts[s]; return `<li title="${esc(SLOT[s])}"><b>${esc(p[0])}</b>${p[1] != null ? `<span class="num">${p[1]}</span>` : ''}</li>` }).join('')}</ol>` : '<p class="lc-none">Aucun accessoire pour l’instant.</p>'}
      ${d.notes ? `<p class="lc-notes">${esc(d.notes)}</p>` : ''}
      ${tot > 100 ? `<p class="lc-err">${ic('info')} ${tot - 100} points de trop : retire un accessoire.</p>` : ''}
    </article>`
  }
  const actsHTML = (d) => `<div class="lc-acts" role="group" aria-label="Actions du loadout ${esc(d.name)}"><button data-a="edit" class="lc-a1">Modifier</button><button data-a="share" aria-expanded="false">Partager${ic('chevd')}</button><button data-a="dup">Dupliquer</button><button data-a="del" class="is-del" aria-label="Supprimer ${esc(d.name)}" title="Supprimer">${ic('trash')}</button></div>`
  // La carte seule, telle qu'à l'écran, dans le presse-papiers : Ctrl V dans Discord
  async function copyCard(box) {
    box.classList.add('is-shot'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const c = $('.lc', box), r = c.getBoundingClientRect()
    try { await API.copyAreaImage({ x: r.left, y: r.top, width: r.width, height: r.height }); toast(`${ic('check')} Image de la carte copiée : Ctrl V dans Discord`, { ms: 2400 }) } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 4000 }) }
    box.classList.remove('is-shot')
  }
  // Les gestes : host est le volet, refresh le repeint (le Cockpit rend la liste ou l'arme à nouveau)
  function bind(host, refresh) {
    $$('[data-c]', host).forEach((x) => x.onclick = () => { cat = x.dataset.c; refresh() })
    $$('[data-dgo]', host).forEach((b) => b.onclick = () => Atelier.resume(b.dataset.dgo || null))
    $$('[data-ddrop]', host).forEach((b) => b.onclick = () => {
      const id = b.dataset.ddrop || null, d = Atelier.drafts().find((x) => x.id === id)
      confirmDel({ title: `Jeter le brouillon « ${esc(d?.label || '')} » ?`, text: 'Ce que tu as saisi disparaît. Tes loadouts enregistrés ne changent pas.', verb: 'Jeter le brouillon', onOk: () => { Atelier.dropDraft(id); refresh() } })
    })
    const seed = $('#loSeed', host)
    if (seed) seed.onclick = async (e) => { e.currentTarget.setAttribute('aria-busy', 'true'); try { await Real.addTemplates(); refresh(); toast(`${ic('check')} Tes ${Real.templates().length} builds sont dans ton carnet`, { ms: 2200 }) } catch (x) { toast(esc(errText(x)), { tone: 'warn', ms: 4000 }); refresh() } }
    // Plusieurs loadouts : seule la meilleure valeur de chaque stat reste en blanc, les autres s'effacent un peu
    $$('.lo-grid', host).forEach((grid) => { if ($$('.lc-box', grid).length > 1) ['ctl', 'acc', 'mob', 'hip'].forEach((k) => { const els = $$(`.lc-st [data-k="${k}"]`, grid), vals = els.map((x) => +x.dataset.v), max = Math.max(...vals); if (vals.some((v) => v !== max)) els.forEach((x) => x.classList.toggle('dim', +x.dataset.v !== max)) }) })
    $$('.lc-box', host).forEach((box) => {
      const d = BUILDS.find((x) => x.id === box.dataset.id); if (!d) return
      $('[data-a=edit]', box).onclick = () => Atelier.edit(d)
      $('.lc', box).ondblclick = () => Atelier.edit(d)
      $('[data-a=share]', box).onclick = (e) => menuAt(e.currentTarget, [
        ['copy', 'Copier l’image', () => copyCard(box)],
        ['chat', 'Copier le texte', async () => { try { await navigator.clipboard.writeText(textOf(d)); toast(`${ic('check')} Texte du loadout copié`, { ms: 2000 }) } catch { toast('Le texte n’a pas pu être copié. Réessaie.', { tone: 'warn', ms: 3000 }) } }]
      ])
      $('[data-a=dup]', box).onclick = async () => { const c = JSON.parse(JSON.stringify(d)); delete c.id; c.name = `${d.name} (copie)`.slice(0, 40); try { await Real.saveLoadout(c); refresh(); toast(`${ic('copy')} « ${esc(d.name)} » dupliqué`, { ms: 1800 }) } catch (x) { toast(esc(errText(x)), { tone: 'warn', ms: 4000 }) } }
      $('[data-a=del]', box).onclick = () => confirmDel({ title: `Supprimer « ${esc(d.name)} » ?`, text: `Le loadout ${esc(d.w)} disparaît de ta liste. Ton arme dans le jeu ne change pas.`, verb: 'Supprimer le loadout', onOk: async () => { try { await Real.deleteLoadout(d.id) } catch (x) { return toast(esc(errText(x)), { tone: 'warn', ms: 4000 }) } Atelier.dropDraft(d.id); if (!BUILDS.some((x) => x.w === d.w)) S.loWeapon = null; refresh(); toast(`${ic('trash')} Loadout « ${esc(d.name)} » supprimé`, { ms: 2200 }) } })
    })
  }
  return { feed, tierTag, art, listHTML, weaponHTML, bind, setOnImg: (f) => { onImg = f }, tiles: () => { loadWimg(); return groups().map(tile).join('') }, SLOTS, total, cardHTML, catPl: (c) => CAT_PL[c] || c || CAT_PL[''], seed: () => Real.templateBuilds() }
})()
