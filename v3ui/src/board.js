// La recherche d'un joueur par pseudo EA : le même champ pour ton profil et pour le classement
const PLATFORM_FR = { ea: 'EA', pc: 'PC', steam: 'Steam', psn: 'PlayStation', xbox: 'Xbox' }
const bf6Key = (a) => `${a.platform}:${a.personaId ?? a.name.toLowerCase()}`
const PlayerSearch = (() => {
  const NONE = 'Aucun joueur trouvé avec ce pseudo exact. Vérifie l’orthographe, majuscules comprises. Si tu viens de chercher, réessaie dans 30 secondes.'
  async function run(q, res, go, { action, exclude, onPick, input }) {
    if (!q) { res.innerHTML = '<li class="rk-msg">Écris le pseudo EA du joueur.</li>'; input?.focus(); return }
    go.classList.add('is-busy'); go.setAttribute('aria-busy', 'true'); res.innerHTML = ''
    let list = null, msg = ''
    try { list = await API.bf6Search(q) } catch (e) { msg = errText(e) }
    go.classList.remove('is-busy'); go.removeAttribute('aria-busy')
    if (!res.isConnected) return
    if (!list) { res.innerHTML = `<li class="rk-msg">${esc(msg || 'Le service de stats ne répond pas. Réessaie dans quelques minutes.')}</li>`; return }
    if (!list.length) { res.innerHTML = `<li class="rk-msg">${NONE}</li>`; return }
    res.innerHTML = list.map((r, i) => { const taken = exclude().includes(bf6Key(r)); return `<li class="rk-rs"><span class="rk-rs-n"><b>${esc(r.name)}</b><span>${esc(PLATFORM_FR[r.platform] || r.platform)}</span></span><span class="num rk-rs-k">${r.kills === null ? 'Stats indisponibles' : `${fr(r.kills)} élimination${r.kills > 1 ? 's' : ''}`}</span>${taken ? '<span class="rk-rs-t">Déjà suivi</span>' : `<button class="btn sm" data-pick="${i}">${esc(action)}</button>`}</li>` }).join('')
    // Le choix part au service : le bouton attend la réponse, et un second clic ne refait rien
    $$('[data-pick]', res).forEach((b) => b.onclick = async () => { if (b.getAttribute('aria-busy')) return; b.setAttribute('aria-busy', 'true'); const r = list[+b.dataset.pick]; try { await onPick({ name: r.name, platform: r.platform, ...(r.personaId ? { personaId: r.personaId } : {}), ...(r.nucleusId ? { nucleusId: r.nucleusId } : {}) }) } finally { if (b.isConnected) b.removeAttribute('aria-busy') } })
  }
  let n = 0
  // importPx : ton profil Battlefield 6 déjà relié dans Player X sur ce PC se reprend en un clic (lecture seule de Player X).
  // Utile quand la recherche par pseudo ne répond pas : les identifiants EA de Player X évitent la recherche.
  function mount(box, { action, exclude = [], onPick, autofocus = false, importPx = false }) {
    const id = `psQ${++n}`
    box.innerHTML = `<form class="sf-search" novalidate><div class="at-f"><label for="${id}">Pseudo EA exact</label><div class="rk-q"><input class="at-i" id="${id}" maxlength="64" spellcheck="false" autocomplete="off"><button class="btn sm rose ps-go" type="submit">${ic('search')}Chercher le joueur</button></div></div></form><ul class="rk-res ps-res" aria-live="polite"></ul>`
    const input = $('input', box)
    $('form', box).onsubmit = (e) => { e.preventDefault(); run(input.value.trim(), $('.ps-res', box), $('.ps-go', box), { action, exclude: () => exclude, onPick, input }) }
    if (autofocus) setTimeout(() => input.focus({ preventScroll: true }), 0)
    if (importPx && API.bf6PlayerX) offerPx(box, onPick)
  }
  function offerPx(box, onPick) {
    API.bf6PlayerX().then((px) => {
      if (!px || !box.isConnected) return
      const row = h(`<div class="px-imp"><span><b>${esc(px.me.name)}</b> est déjà relié dans ${esc(px.from)}, sur ${esc(PLATFORM_FR[px.me.platform] || px.me.platform)}.</span><button type="button" class="btn sm rose">${ic('check')}Reprendre ce profil</button></div>`)
      box.prepend(row)
      $('button', row).onclick = async (e) => {
        const b = e.currentTarget; b.setAttribute('aria-busy', 'true')
        try { Real.st.tracked = await API.bf6ImportPlayerX(); onPick(Real.st.tracked.me) } catch (x) { b.removeAttribute('aria-busy'); toast(esc(errText(x)), { tone: 'warn', ms: 4000 }) }
      }
    }).catch(() => {})
  }
  return { mount, run }
})()

// Classement Battlefield 6 : tes joueurs suivis et leurs chiffres, pour la page Stats (le Cockpit).
// Les mêmes fonctions que la vraie appli : ajouter par pseudo EA, retirer, actualiser, écart avec toi, 12 joueurs au plus.
const Board = (() => {
  const MAX = 12, METRIC_KEY = 'pxv3-classement-critere'
  const NOT_FOUND = 'Aucune statistique Battlefield 6 pour ce joueur (pseudo introuvable ou profil privé).'
  const played = (m) => { const h = Math.floor(m / 60), r = Math.round(m % 60); return !h ? `${r} min` : r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h` }
  const ordinal = (n) => (n === 1 ? '1er' : `${n}e`)
  const METRICS = [
    { k: 'kd', l: 'K/D', f: (n) => fr(n, 2), d: (n) => fr(n, 2), say: (s) => `${s} de K/D`, au: 'au K/D' },
    { k: 'kpm', l: 'Élim./min', f: (n) => fr(n, 2), d: (n) => fr(n, 2), say: (s) => `${s} élim./min`, au: 'aux éliminations par minute' },
    { k: 'win', l: 'Victoires', f: (n) => `${fr(n)} %`, d: (n) => `${fr(n)} pt${n >= 2 ? 's' : ''}`, say: (s) => `${s} de victoires`, au: 'aux victoires' },
    { k: 'kills', l: 'Éliminations', f: (n) => fr(n), d: (n) => fr(n), say: (s, n) => `${s} élimination${n > 1 ? 's' : ''}`, au: 'aux éliminations' },
    { k: 'rev', l: 'Réanimations', f: (n) => fr(n), d: (n) => fr(n), say: (s, n) => `${s} réanimation${n > 1 ? 's' : ''}`, au: 'aux réanimations' },
    { k: 'time', l: 'Temps de jeu', f: played, d: played, say: (s) => `${s} de jeu`, au: 'au temps de jeu' }
  ]
  const P = {}
  let ME = null, tracked = [], metric = 'kd', readAt = 0, busy = false, loadP = null
  const loading = new Set(), subs = new Set()
  let reading = null
  // Les abonnés (onChange) sont prévenus une seule fois par rafale de changements
  let pend = false
  const notify = () => { if (pend || !subs.size) return; pend = true; queueMicrotask(() => { pend = false; subs.forEach((f) => { try { f() } catch { /* un abonné fautif ne bloque pas les autres */ } }) }) }
  try { const m = localStorage.getItem(METRIC_KEY); if (METRICS.some((x) => x.k === m)) metric = m } catch { /* stockage indisponible : le K/D */ }
  const newP = (a, me) => ({ n: a.name, acc: a, plat: PLATFORM_FR[a.platform] || a.platform, me: !!me, matches: 0, kd: 0, kpm: 0, win: 0, kills: 0, rev: 0, time: 0 })
  const setup = () => {
    const t = Real.st.tracked; if (!t?.me) { ME = null; tracked = []; return false }
    ME = bf6Key(t.me); P[ME] = P[ME] || newP(t.me, true)
    tracked = t.rivals.map((a) => { const k = bf6Key(a); P[k] = P[k] || newP(a); return k }).filter((k) => k !== ME)
    return true
  }
  const saveTracked = async () => { Real.st.tracked = await API.bf6SetTracked({ me: P[ME].acc, rivals: tracked.map((k) => P[k].acc) }) }
  const fill = (k, snap) => { const s = snap.stats; Object.assign(P[k], { kd: s.killDeath, kpm: s.killsPerMinute, win: s.winPercent, kills: s.kills, rev: s.revives, time: s.secondsPlayed / 60, matches: s.matches, avatar: s.avatarUrl || null, stale: snap.stale || null, error: null, read: true }) }
  // Un joueur à la fois : le service limite les appels rapprochés
  async function readOne(k, refresh) {
    try { fill(k, await API.bf6Stats(P[k].acc, refresh)) } catch (e) { P[k].error = errText(e) || NOT_FOUND }
    loading.delete(k); notify()
  }
  // Lu une fois à l'ouverture des stats : le processus principal garde chaque joueur 10 min
  function ensure() {
    if (loadP || !setup()) return loadP
    ;[ME, ...tracked].forEach((k) => { if (!P[k].read && !P[k].error) loading.add(k) })
    notify()
    loadP = (async () => { for (const k of [ME, ...tracked]) { if (loading.has(k)) await readOne(k, false) } readAt = Date.now(); notify() })()
    return loadP
  }
  const reset = () => { loadP = null; Object.keys(P).forEach((k) => delete P[k]); loading.clear(); notify() }
  const cur = () => METRICS.find((m) => m.k === metric)
  const isRanked = (n) => !!P[n] && !loading.has(n) && !P[n].error && P[n].read
  const ranked = (m = cur()) => [ME, ...tracked].filter(isRanked).sort((a, b) => P[b][m.k] - P[a][m.k])

  // Ta place au K/D : utilisée par la vue d'ensemble et les scénarios d'essai
  function standing(m = METRICS[0]) {
    const r = ranked(m)
    if (r.length < 2) return null
    const i = r.indexOf(ME); if (i < 0) return null
    const o = r[i > 0 ? i - 1 : 1]
    return { rank: i + 1, total: r.length, name: P[o].n, kd: m.f(P[o][m.k]), ahead: i > 0 }
  }
  const badge = () => { const s = standing(); return s ? ordinal(s.rank) : '' }
  const lineOf = (m) => { const s = standing(m); return s ? `<strong>${ordinal(s.rank)}</strong> sur ${s.total}, ${s.ahead ? 'derrière' : 'devant'} ${esc(s.name)} (${s.kd})` : '' }
  const rankLine = () => lineOf(METRICS[0])
  // Écart avec toi, signé (d : joueur moins toi)
  const gapOf = (d, m) => { const s = m.d(Math.abs(d)), zero = !/[1-9]/.test(s); return { s, zero, text: zero ? s : `${d > 0 ? '+' : '−'}${s}` } }

  const FULL = `${MAX} joueurs suivis au maximum : retires-en un pour en ajouter un autre.`
  const refusal = (acc) => { const n = bf6Key(acc); return n === ME ? 'C’est ton propre profil : tu es déjà dans le classement.' : tracked.includes(n) ? 'Déjà suivi.' : tracked.length >= MAX ? FULL : null }
  function remove(n) {
    const i = tracked.indexOf(n); if (i < 0) return Promise.resolve()
    const name = P[n].n
    tracked.splice(i, 1); loading.delete(n)
    const saved = saveTracked().catch(() => {})
    notify()
    toast(`${esc(name)} retiré du classement`, { ms: 5000, action: { label: 'Annuler', fn: () => {
      if (tracked.includes(n) || tracked.length >= MAX) return
      tracked.splice(Math.min(i, tracked.length), 0, n); saveTracked().catch(() => {})
      notify()
    } } })
    return saved
  }
  // Les joueurs se relisent un par un : le service limite les appels rapprochés
  async function refresh() {
    if (busy || (!ME && !setup())) return
    busy = true; notify()
    const list = [ME, ...tracked]
    for (const n of list) {
      reading = n; notify()
      await readOne(n, true)
      reading = null
    }
    busy = false; readAt = Date.now(); notify()
  }

  function setMetric(k) {
    if (k === metric || !METRICS.some((m) => m.k === k)) return
    metric = k; try { localStorage.setItem(METRIC_KEY, k) } catch { /* gardé pour cette session */ }
    notify()
  }
  // Après reset(), la table est vide alors que la liste reste : on la refait avant de lire
  const live = () => { if (!ME || !P[ME] || tracked.some((k) => !P[k])) setup() }
  function player(key) {
    live(); const p = P[key]; if (!p) return null
    const v = (k) => (p.read ? p[k] : null)
    return { key, name: p.n, plat: p.plat, me: p.me, acc: p.acc, kd: v('kd'), kpm: v('kpm'), win: v('win'), kills: v('kills'), rev: v('rev'), time: v('time'), matches: v('matches'), avatar: (p.me ? Real.me()?.avatar : p.avatar) || null, error: p.error || null, stale: p.stale || null, loading: loading.has(key) || reading === key }
  }
  function rowsOf(metricKey) {
    live()
    const m = METRICS.find((x) => x.k === metricKey) || cur(), r = ranked(m), mine = isRanked(ME) ? P[ME][m.k] : null
    const all = ME ? [ME, ...tracked] : [], rest = all.filter((n) => !r.includes(n))
    const list = [...r, ...rest].map((n) => {
      const p = P[n], ok = r.includes(n), at = ok ? r.indexOf(n) : -1
      return { key: n, name: p.n, plat: p.plat, me: n === ME, loading: loading.has(n) || reading === n, error: p.error || null, stale: !!p.stale, value: ok ? p[m.k] : null, text: ok ? m.f(p[m.k]) : '', rank: ok ? at + 1 : null, gap: ok && n !== ME && mine !== null ? gapOf(p[m.k] - mine, m).text : '' }
    })
    return { metric: { k: m.k, l: m.l }, metrics: METRICS.map((x) => ({ k: x.k, l: x.l })), me: ME, list, line: lineOf(m), readAt, max: MAX, full: tracked.length >= MAX }
  }
  // Suivre un joueur : les stats sont lues avant d'enregistrer. Ne lève jamais.
  async function follow(acc) {
    try {
      live(); if (!ME) return { ok: false, msg: 'Relie d’abord ton profil Battlefield 6.' }
      const no = refusal(acc); if (no) return { ok: false, msg: no }
      let snap; try { snap = await API.bf6Stats(acc, false) } catch (e) { return { ok: false, msg: errText(e) || NOT_FOUND } }
      const late = refusal(acc); if (late) return { ok: false, msg: late }
      const n = bf6Key(acc); P[n] = newP(acc); fill(n, snap); tracked.push(n)
      try { await saveTracked() } catch (e) { tracked.splice(tracked.indexOf(n), 1); delete P[n]; notify(); return { ok: false, msg: errText(e) || 'Le joueur n’a pas pu être enregistré.' } }
      notify()
      return { ok: true, key: n }
    } catch (e) { return { ok: false, msg: errText(e) || 'Le joueur n’a pas pu être suivi.' } }
  }
  const keys = () => { live(); return ME ? [ME, ...tracked] : [] }
  const onChange = (fn) => { subs.add(fn); return () => { subs.delete(fn) } }
  return { badge, rankLine, ensure, reset, rows: rowsOf, setMetric, player, follow, unfollow: remove, reread: () => refresh(), keys, onChange }
})()
