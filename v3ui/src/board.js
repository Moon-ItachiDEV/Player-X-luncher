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
  function mount(box, { action, exclude = [], onPick, autofocus, importPx }) {
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

// Classement Battlefield 6 : tes joueurs suivis, tous leurs chiffres, et une course pour le critère choisi.
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
  let ME = null, tracked = [], metric = 'kd', readAt = 0, busy = false, root = null, loaded = false, loadP = null
  const loading = new Set(), rows = new Map()
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
    loading.delete(k)
  }
  function repaintRow(k) { const tr = rows.get(k); if (tr && body()) flip(() => { tr.innerHTML = rowHtml(k); order() }); syncBadge() }
  // Lu une fois à l'ouverture des stats : le processus principal garde chaque joueur 10 min
  function ensure() {
    if (loadP || !setup()) return loadP
    ;[ME, ...tracked].forEach((k) => { if (!P[k].read && !P[k].error) loading.add(k) })
    loadP = (async () => { for (const k of [ME, ...tracked]) { if (loading.has(k)) { await readOne(k, false); repaintRow(k) } } readAt = Date.now(); loaded = true; syncBadge(); if (body()) paint() })()
    return loadP
  }
  const reset = () => { loadP = null; loaded = false; Object.keys(P).forEach((k) => delete P[k]); rows.clear(); loading.clear() }
  const cur = () => METRICS.find((m) => m.k === metric)
  const isRanked = (n) => !!P[n] && !loading.has(n) && !P[n].error && P[n].read
  const ranked = (m = cur()) => [ME, ...tracked].filter(isRanked).sort((a, b) => P[b][m.k] - P[a][m.k])
  const others = () => tracked.filter((n) => !isRanked(n))
  const body = () => root && root.isConnected ? $('#rkBody', root) : null
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h` }

  // Ta place au K/D : le badge de l'onglet et la ligne de la vue d'ensemble, comme dans la vraie appli
  function standing() {
    const m = METRICS[0], r = ranked(m)
    if (r.length < 2) return null
    const i = r.indexOf(ME); if (i < 0) return null
    const o = r[i > 0 ? i - 1 : 1]
    return { rank: i + 1, total: r.length, name: P[o].n, kd: fr(P[o].kd, 2), ahead: i > 0 }
  }
  const badge = () => { const s = standing(); return s ? ordinal(s.rank) : '' }
  const rankLine = () => { const s = standing(); return s ? `<strong>${ordinal(s.rank)}</strong> sur ${s.total}, ${s.ahead ? 'derrière' : 'devant'} ${esc(s.name)} (${s.kd})` : '' }
  const syncBadge = () => { const e = $('.sp-tabs [data-t=board] em'); if (e) e.textContent = badge() }

  /* Les lignes */
  const face = (k, size) => {
    const p = P[k], m = p.me ? Real.me() : null, img = m ? m.avatar : p.avatar, style = `--h:${p.me ? 338 : Shared.text.hue(p.n)};width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px`
    return `<span class="av ${p.me ? 'me' : ''}" style="${style}" aria-hidden="true">${img ? `<img src="${esc(img)}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block">` : esc((m?.name || p.n)[0].toUpperCase())}</span>`
  }
  const subOf = (n) => { const p = P[n]; return loading.has(n) || p.error ? esc(p.plat) : `${esc(p.plat)}, <span class="num">${fr(p.matches)}</span> match${p.matches > 1 ? 's' : ''}` }
  function rowHtml(n) {
    const p = P[n], wait = loading.has(n)
    const stale = p.stale && !wait ? `<span class="rk-st" tabindex="0" role="img" aria-label="${esc(p.stale)} Dernières stats connues." data-tip="Service indisponible : dernières stats connues">${ic('warn')}</span>` : ''
    const sub = subOf(n)
    const who = `<td class="rk-r num"></td><th scope="row" class="rk-who"><span class="rk-nm"><b>${esc(p.n)}</b>${p.me ? '<em>toi</em>' : ''}${stale}</span><span class="rk-sub">${sub}</span></th>`
    const out = p.me ? '<td></td>' : `<td class="rk-x"><button class="rk-rm" data-rm="${esc(n)}" aria-label="Retirer ${esc(p.n)} du classement" data-tip="Retirer" data-tip-r>${ic('close')}</button></td>`
    if (p.error && !wait) return `${who}<td colspan="${METRICS.length + 2}" class="rk-err"><span class="rk-err-in">${ic('warn')}<span>${esc(p.error || NOT_FOUND)}</span></span></td>${out}`
    const lane = `<td class="rk-lane"><div class="rk-tk" aria-hidden="true">${wait ? '' : `<i class="rk-ln"></i><span class="rk-hd">${face(n, 36)}</span>`}</div></td>`
    const vals = METRICS.map((m) => `<td class="rk-v num" data-m="${m.k}">${wait ? '<i class="rk-sk"></i>' : ''}</td>`).join('')
    return `${who}${lane}${vals}<td class="rk-g num">${wait ? '<i class="rk-sk"></i>' : ''}</td>${out}`
  }
  function makeRow(n) {
    const tr = document.createElement('tr'); tr.dataset.n = n
    if (P[n].me) tr.className = 'me'
    tr.innerHTML = rowHtml(n); rows.set(n, tr)
    return tr
  }

  /* Tout ce qui dépend du critère et de la liste */
  function paint() {
    const tb = body(); if (!tb) return
    const m = cur(), r = ranked(m), max = Math.max(...r.map((n) => P[n][m.k]), 1e-6), mine = isRanked(ME) ? P[ME][m.k] : 0
    tb.style.setProperty('--me', (mine / max).toFixed(4))
    $('#rkMax', root).textContent = m.f(max)
    $('#rkCap', root).textContent = `Joueurs classés par ${m.l}`
    r.forEach((n, i) => {
      const tr = rows.get(n), d = P[n][m.k] - mine
      tr.style.setProperty('--x', (P[n][m.k] / max).toFixed(4))
      $('.rk-r', tr).textContent = i + 1
      $$('.rk-v', tr).forEach((td) => { const x = METRICS.find((y) => y.k === td.dataset.m); td.textContent = x.f(P[n][x.k]); td.classList.toggle('on', x.k === m.k) })
      const g = $('.rk-g', tr)
      if (P[n].me) { g.textContent = '–'; g.className = 'rk-g num' } else {
        const s = m.d(Math.abs(d)), zero = !/[1-9]/.test(s)
        g.textContent = zero ? s : `${d > 0 ? '+' : '−'}${s}`
        g.className = `rk-g num ${d > 0 && !zero ? 'up' : ''}`
        g.setAttribute('aria-label', zero ? `À égalité avec toi` : `${s} ${d > 0 ? 'devant' : 'derrière'} toi`)
      }
    })
    others().forEach((n) => { const tr = rows.get(n); $('.rk-r', tr).textContent = '–'; $$('.rk-v', tr).forEach((td) => td.classList.toggle('on', td.dataset.m === m.k)) })
    $$('th[data-m]', root).forEach((th) => {
      const x = METRICS.find((y) => y.k === th.dataset.m), on = x.k === m.k, at = ranked(x).indexOf(ME), place = at < 0 ? '–' : ordinal(at + 1)
      th.classList.toggle('on', on)
      if (on) th.setAttribute('aria-sort', 'descending'); else th.removeAttribute('aria-sort')
      const b = $('.rk-s', th)
      b.innerHTML = `<b>${x.l}</b><span class="num">${on ? ic('chevd') : ''}${place}</span>`
      b.setAttribute('aria-label', at < 0 ? `Classer par ${x.l}.` : `Classer par ${x.l}. Tu es ${place}.`)
    })
    // Ta place, et ce qu'il faut pour gagner une place
    const i = r.indexOf(ME), up = r[i - 1], down = r[i + 1]
    if (!busy) $('#rkMeta', root).textContent = loaded ? `${tracked.length + 1} joueurs, mis à jour ${ago(readAt)}` : 'Lecture des joueurs, un par un…'
    syncBadge()
    if (r.length < 2 || i < 0) { $('#rkPlace', root).innerHTML = ''; $('#rkSay', root).innerHTML = `<p>${loaded ? 'Aucun autre joueur à classer pour l’instant.' : 'Lecture des joueurs en cours.'}</p>`; return }
    $('#rkPlace', root).innerHTML = `<b class="rk-big num">${ordinal(i + 1)}</b><span>sur ${r.length}</span>`
    const gap = (o) => { const d = Math.abs(P[o][m.k] - mine); return `<b class="num">${m.say(m.d(d), d)}</b>` }
    const tie = (o) => !/[1-9]/.test(m.d(Math.abs(P[o][m.k] - mine)))
    const first = up ? (tie(up) ? `À égalité avec <b>${esc(P[up].n)}</b> ${m.au}.` : `Il te manque ${gap(up)} pour passer <b>${esc(P[up].n)}</b>.`) : `Tu es devant tout le monde ${m.au}.`
    const second = down ? (tie(down) ? `${esc(P[down].n)} est à égalité avec toi.` : `${esc(P[down].n)} est à ${m.say(m.d(Math.abs(P[down][m.k] - mine)), Math.abs(P[down][m.k] - mine))} derrière toi.`) : 'Personne derrière toi pour l’instant.'
    $('#rkSay', root).innerHTML = `<p>${first}</p><p>${second}</p>`
  }
  function order() {
    const tb = body(); if (!tb) return
    ;[...ranked(), ...others()].forEach((n, i) => {
      const row = rows.get(n), at = tb.children[i] || null
      if (row === at) return
      // moveBefore garde le focus de la ligne déplacée, là où il existe
      if (tb.moveBefore && row.parentNode === tb) tb.moveBefore(row, at); else tb.insertBefore(row, at)
    })
    paint()
  }
  // Tout glisse depuis sa position réelle, même au milieu d'un mouvement : la ligne, le visage, le trait, ton repère
  const MOVE = { duration: 300, easing: 'cubic-bezier(.23,1,.32,1)' }
  const xOf = (el, pseudo) => parseFloat(getComputedStyle(el, pseudo).translate) || 0
  const scaleOf = (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a
  const snap = (r) => {
    const hd = $('.rk-hd', r), ln = $('.rk-ln', r), tk = $('.rk-tk', r)
    return { top: r.getBoundingClientRect().top, hd: hd ? xOf(hd) : 0, ln: ln ? scaleOf(ln) : 0, mine: tk ? xOf(tk, '::after') : null }
  }
  function flip(change) {
    const tb = body()
    if (!tb || reduced()) return change()
    const before = new Map([...tb.children].map((r) => [r, snap(r)]))
    change()
    const k = (tb.getBoundingClientRect().height / tb.offsetHeight) || 1
    ;[...tb.children].forEach((r) => {
      const was = before.get(r), hd = $('.rk-hd', r), ln = $('.rk-ln', r), tk = $('.rk-tk', r)
      if (!was) r.animate({ opacity: [0, 1] }, { duration: 200, easing: 'ease-out' })
      else {
        const dy = (was.top - r.getBoundingClientRect().top) / k
        if (Math.abs(dy) > .5) r.animate({ transform: [`translateY(${dy}px)`, 'none'] }, MOVE)
      }
      const from = was || { hd: 0, ln: 0, mine: null }
      if (hd) { const x = xOf(hd); if (Math.abs(x - from.hd) > .5) hd.animate({ translate: [`${from.hd}px 0`, `${x}px 0`] }, MOVE) }
      if (ln) { const s = scaleOf(ln); if (Math.abs(s - from.ln) > .002) ln.animate({ transform: [`scaleX(${from.ln})`, `scaleX(${s})`] }, MOVE) }
      if (tk && from.mine !== null) { const x = xOf(tk, '::after'); if (Math.abs(x - from.mine) > .5) tk.animate({ translate: [`${from.mine}px 0`, `${x}px 0`] }, { ...MOVE, pseudoElement: '::after' }) }
    })
  }
  // Départ de la course, une seule fois à l'ouverture de l'onglet
  function race(tb) {
    if (reduced()) return
    ;[...tb.children].forEach((r, i) => {
      const hd = $('.rk-hd', r), ln = $('.rk-ln', r), o = { ...MOVE, delay: Math.min(i * 30, 200), fill: 'backwards' }
      if (hd) hd.animate({ translate: ['0px 0', `${xOf(hd)}px 0`] }, o)
      if (ln) ln.animate({ transform: ['scaleX(0)', `scaleX(${scaleOf(ln)})`] }, o)
    })
  }

  /* Ajouter un joueur : le pseudo EA exact, comme la vraie recherche */
  const panel = () => `<div class="rk-add" id="rkAdd" role="dialog" aria-labelledby="rkAddT" hidden>
      <div class="rk-add-h"><h2 id="rkAddT">Ajouter un joueur</h2><button class="btn sm icon" id="rkAddX" aria-label="Fermer" data-tip="Fermer, Échap" data-tip-b data-tip-r>${ic('close')}</button></div>
      <form id="rkF"><label for="rkQ">Pseudo EA exact</label><div class="rk-q"><input id="rkQ" maxlength="64" spellcheck="false" autocomplete="off"><button class="btn sm rose" id="rkGo" type="submit">${ic('search')}Chercher</button></div></form>
      <ul class="rk-res" id="rkRes" aria-live="polite"></ul>
    </div>`
  // Le clic au-dehors ferme le panneau : l'écouteur part à la fermeture, à chaque rendu, ou dès que le panneau a quitté la page
  let outAc = null
  const unlisten = () => { outAc?.abort(); outAc = null }
  const outside = (e) => { const p = $('#rkAdd', root); if (!p || p.hidden || !p.isConnected) return unlisten(); if (!e.target.closest('#rkAdd,#rkAddBtn')) closePanel(false) }
  function openPanel() {
    if (tracked.length >= MAX) { toast(`${MAX} joueurs suivis au maximum : retires-en un pour en ajouter un autre.`, { ms: 4000 }); return }
    const p = $('#rkAdd', root); p.hidden = false; $('#rkAddBtn', root).setAttribute('aria-expanded', 'true')
    $('#rkQ', root).value = ''; $('#rkRes', root).innerHTML = ''; $('#rkQ', root).focus()
    unlisten(); outAc = new AbortController()
    document.addEventListener('pointerdown', outside, { capture: true, signal: outAc.signal })
  }
  function closePanel(giveBack = true) {
    const p = root && $('#rkAdd', root); unlisten()
    if (!p || p.hidden) return
    p.hidden = true; $('#rkAddBtn', root).setAttribute('aria-expanded', 'false')
    if (giveBack) $('#rkAddBtn', root).focus()
  }
  const search = (q) => PlayerSearch.run(q, $('#rkRes', root), $('#rkGo', root), { action: 'Ajouter', exclude: () => [ME, ...tracked], onPick: add, input: $('#rkQ', root) })
  async function add(acc) {
    const n = bf6Key(acc)
    if (tracked.length >= MAX || tracked.includes(n) || n === ME) return
    P[n] = newP(acc)
    closePanel(); tracked.push(n); loading.add(n); saveTracked().catch(() => {})
    if (!body()) render(root, false)
    else { const tr = makeRow(n); flip(() => { body().append(tr); paint() }) }
    $('#rkAddBtn', root)?.focus()
    await readOne(n, false)
    if (!tracked.includes(n) || !body()) { syncBadge(); return }
    flip(() => { rows.get(n).innerHTML = rowHtml(n); order() })
  }
  function remove(n) {
    const i = tracked.indexOf(n); if (i < 0) return
    const tr = rows.get(n), next = tr.nextElementSibling?.querySelector('.rk-rm') || tr.previousElementSibling?.querySelector('.rk-rm') || $('#rkAddBtn', root), name = P[n].n
    tracked.splice(i, 1); loading.delete(n); saveTracked().catch(() => {})
    if (!tracked.length) { render(root, false); $('#rkAddBtn', root)?.focus() } else { flip(() => { tr.remove(); rows.delete(n); order() }); next?.focus({ preventScroll: true }) }
    syncBadge()
    toast(`${esc(name)} retiré du classement`, { ms: 5000, action: { label: 'Annuler', fn: () => {
      if (tracked.includes(n) || tracked.length >= MAX) return
      tracked.splice(Math.min(i, tracked.length), 0, n); saveTracked().catch(() => {})
      if (!root?.isConnected || !$('.rk', root)) { syncBadge(); return }
      if (!body()) { render(root, false); return }
      const row = makeRow(n); flip(() => { body().append(row); order() })
    } } })
  }
  // Les joueurs se relisent un par un : le service limite les appels rapprochés
  async function refresh(btn) {
    if (busy) return
    busy = true; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true')
    const list = [ME, ...tracked]
    for (let i = 0; i < list.length; i++) {
      const n = list[i], tr = rows.get(n), meta = body() && $('#rkMeta', root)
      if (!meta) break
      meta.textContent = `Lecture de ${P[n].n}, ${i + 1} sur ${list.length}`
      tr?.classList.add('reading')
      await readOne(n, true)
      tr?.classList.remove('reading')
      if (tr && body()) tr.innerHTML = rowHtml(n)
    }
    busy = false; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy')
    readAt = Date.now(); loaded = true
    if (body()) flip(order)
  }

  /* La page */
  function solo(b) {
    const me = P[ME]
    b.innerHTML = `<div class="rk is-solo"><div class="rk-frame rk-solo">${face(ME, 56)}<div class="rk-solo-t">
        <h2>Personne à battre pour l’instant</h2>
        ${me.read ? `<p class="rk-solo-m">Tes chiffres à battre : <b class="num">${fr(me.kd, 2)}</b> de K/D, <b class="num">${fr(me.kpm, 2)}</b> élim./min et <b class="num">${fr(me.win)} %</b> de victoires.</p>` : ''}
        <p>Ajoute tes amis ou des joueurs croisés en partie avec leur pseudo EA. Player X vous classe au K/D, aux éliminations par minute, aux victoires, aux éliminations, aux réanimations et au temps de jeu.</p>
        <span class="rk-anchor"><button class="btn rose" id="rkAddBtn" aria-expanded="false" aria-controls="rkAdd">${ic('plus')}Ajouter un joueur</button>${panel()}</span>
      </div></div></div>`
    bindPanel()
  }
  function bindPanel() {
    $('#rkAddBtn', root).onclick = () => { const p = $('#rkAdd', root); p.hidden ? openPanel() : closePanel() }
    $('#rkAddX', root).onclick = () => closePanel()
    $('#rkF', root).onsubmit = (e) => { e.preventDefault(); search($('#rkQ', root).value.trim()) }
    const p = $('#rkAdd', root)
    p.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePanel() } })
  }
  function render(b, race0 = true) {
    root = b; rows.clear()
    unlisten()
    ensure()
    if (!tracked.length) { solo(b); loadP?.then(() => { if (root === b && b.isConnected && !tracked.length && $('.rk.is-solo', b) && !$('#rkAdd:not([hidden])', b)) solo(b) }); return }
    b.innerHTML = `<div class="rk">
      <header class="rk-head">
        <div class="rk-place" id="rkPlace"></div>
        <div class="rk-say" id="rkSay" aria-live="polite"></div>
        <div class="rk-tools">
          <div class="rk-btns"><button class="btn sm" id="rkRefresh">${ic('refresh')}Actualiser</button><span class="rk-anchor"><button class="btn sm" id="rkAddBtn" aria-expanded="false" aria-controls="rkAdd">${ic('plus')}Ajouter un joueur</button>${panel()}</span></div>
          <p class="rk-meta" id="rkMeta"></p>
        </div>
      </header>
      <div class="rk-frame"><table class="rk-t"><caption class="vh" id="rkCap"></caption>
        <colgroup><col class="c-r"><col class="c-w"><col>${METRICS.map(() => '<col class="c-v">').join('')}<col class="c-g"><col class="c-x"></colgroup>
        <thead><tr>
          <th scope="col" class="rk-hr"><span aria-hidden="true">#</span><span class="vh">Rang</span></th>
          <th scope="col" class="rk-hw">Joueur</th>
          <th scope="col" class="rk-ax"><span class="vh">Piste du critère choisi</span><span class="rk-ax-in" aria-hidden="true"><i>0</i><i id="rkMax"></i></span></th>
          ${METRICS.map((m) => `<th scope="col" class="rk-hv" data-m="${m.k}"><button class="rk-s"></button></th>`).join('')}
          <th scope="col" class="rk-hg">Écart avec toi</th>
          <th scope="col"><span class="vh">Retirer</span></th>
        </tr></thead>
        <tbody id="rkBody"></tbody>
      </table></div></div>`
    const tb = $('#rkBody', b)
    ;[ME, ...tracked].forEach((n) => tb.append(makeRow(n)))
    order()
    if (race0) race(tb)
    $$('.rk-s', b).forEach((s) => s.onclick = () => { const k = s.closest('th').dataset.m; if (k === metric) return; metric = k; try { localStorage.setItem(METRIC_KEY, k) } catch { /* gardé pour cette session */ } flip(order) })
    tb.addEventListener('click', (e) => { const r = e.target.closest('[data-rm]'); if (r) remove(r.dataset.rm) })
    $('#rkRefresh', b).onclick = (e) => refresh(e.currentTarget)
    bindPanel()
  }
  return { render, badge, rankLine, ensure, reset }
})()
