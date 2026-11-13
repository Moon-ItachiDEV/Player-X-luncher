// Actus et notes de patch de la fiche d'un jeu : les annonces officielles publiées sur Steam, lues par le vrai service de Player X.
const NewsView = (() => {
  const WEEK = 7 * 864e5
  const DOWN = 'Steam ne répond pas pour le moment. Réessaie dans quelques minutes.'
  const steamPage = (appId) => `https://store.steampowered.com/news/app/${appId}`
  const out = (href, html, cls = 'btn sm') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`
  const dateFr = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  function ago(t) {
    const m = Math.max(1, Math.round((Date.now() - t) / 6e4))
    if (m < 60) return `Il y a ${m} min`
    const hrs = Math.round(m / 60); if (hrs < 24) return `Il y a ${hrs} h`
    const d = Math.round(hrs / 24); if (d === 1) return 'Hier'; if (d < 31) return `Il y a ${d} jours`
    const mo = Math.round(d / 30.4); if (mo < 12) return `Il y a ${mo} mois`
    const y = Math.round(d / 365); return `Il y a ${y} an${y > 1 ? 's' : ''}`
  }
  let host = null, game = null, since = 0, filter = 'all', token = 0, skelT = 0
  const store = {}

  /* Vu dans la fiche : le badge « Nouveau patch » part, chez le vrai service aussi */
  function markSeen(g, posts) {
    if (!posts[0] || g.seenUpTo >= posts[0].date) return
    g.seenUpTo = posts[0].date
    API.markNewsSeen(g.rid, posts[0].date).catch(() => {})
  }

  /* L'onglet */
  const fallbackArt = (g) => A(g.hero || g.cover)
  const isNew = (p) => p.date > since && Date.now() - p.date < WEEK
  const shown = () => { const all = store[game.id]?.posts || []; return filter === 'patch' ? all.filter((p) => p.patch) : all }
  function row(p, i) {
    const when = ago(p.date), fresh = isNew(p)
    return `<li><button class="nw-i" data-i="${i}" aria-label="${esc(`${p.patch ? 'Patch : ' : ''}${p.title}, ${when.toLowerCase()}${fresh ? ', nouveau' : ''}`)}">
      <span class="nw-th"><img src="${esc(p.image || fallbackArt(game))}" alt="" data-fb="done" loading="lazy" decoding="async" draggable="false"></span>
      <span class="nw-t"><span class="nw-m">${p.patch ? '<b>Patch</b>' : ''}<span>${when}</span>${fresh ? '<em>Nouveau</em>' : ''}</span><span class="nw-h">${esc(p.title)}</span>${p.excerpt ? `<span class="nw-x">${esc(p.excerpt)}</span>` : ''}</span>
      ${ic('chev')}
    </button></li>`
  }
  function eventRow(e, on) {
    const E = Shared.events, when = E.eventWhen(e, Date.now())
    return `<div class="gb-ev"><span class="gb-ev-i">${ic('bolt')}</span><div><b>${esc(e.title)}</b><span>${esc(E.eventLabel(e.type))}, ${esc(when.text)}. ${esc(E.eventDates(e))}</span></div>${when.live ? out(e.url, `Voir sur Steam${ic('link')}`) : `<button class="btn sm" data-rem="${esc(e.id)}" aria-pressed="${on}">${on ? `${ic('check')}Tu seras prévenu` : 'Me prévenir'}</button>`}</div>`
  }
  function paint() {
    if (!host?.isConnected) return
    const st = store[game.id], patches = st.posts.filter((p) => p.patch).length
    const both = patches > 0 && patches < st.posts.length
    if (!both) filter = 'all'
    const list = shown()
    host.innerHTML = `<div class="nw">
      ${st.events.map((e) => eventRow(e, st.reminders.includes(e.id))).join('')}
      <div class="nw-top"><p>Les annonces officielles sur Steam, en français quand l’éditeur les a traduites.</p>
        ${both ? `<div class="seg" role="radiogroup" aria-label="Annonces affichées">${[['all', 'Tout'], ['patch', `Notes de patch (${patches})`]].map(([k, l]) => `<button role="radio" data-v="${k}" aria-checked="${filter === k}" tabindex="${filter === k ? 0 : -1}">${l}</button>`).join('')}</div>` : ''}</div>
      ${list.length ? `<ul class="nw-list">${list.map(row).join('')}</ul>` : `<div class="empty nw-empty"><h2>Aucune annonce officielle pour le moment</h2><p>Dès que l’éditeur publie une annonce ou un patch sur Steam, tu le lis ici.</p>${out(steamPage(st.appId), `Ouvrir la page du jeu sur Steam${ic('link')}`)}</div>`}
      ${list.length ? `<p class="nw-all">${out(steamPage(st.appId), `Voir toutes les actus sur Steam${ic('link')}`)}</p>` : ''}
    </div>`
    $$('.nw-i', host).forEach((b) => b.onclick = () => openReader(+b.dataset.i))
    $$('[role=radio]', host).forEach((b, i, l) => {
      b.onclick = () => { filter = b.dataset.v; paint(); $('.seg [aria-checked=true]', host)?.focus({ preventScroll: true }) }
      b.onkeydown = (e) => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); l[(i + d + l.length) % l.length].click() } }
    })
    $$('[data-rem]', host).forEach((b) => b.onclick = async () => {
      const on = b.getAttribute('aria-pressed') !== 'true', id = b.dataset.rem
      st.reminders = await API.setEventReminder(game.rid, id, on)
      paint(); $(`[data-rem="${id}"]`, host)?.focus({ preventScroll: true })
      if (on) toast(`${ic('check')} Player X te préviendra quand l’événement commence`, { ms: 2400 })
    })
    // Une image qui ne se charge pas laisse la place à celle du jeu
    $$('.nw-th img', host).forEach((im) => { im.addEventListener('error', () => { const fb = fallbackArt(game); im.src = im.dataset.tried || im.src === fb ? Real.coverPh(game.name) : fb; im.dataset.tried = '1' }) })
    markSeen(game, st.posts)
  }
  const skeleton = () => { host.innerHTML = `<div class="nw" aria-busy="true"><span class="sr-only" role="status">Chargement des actus</span><ul class="nw-list" aria-hidden="true">${[0, 1, 2].map(() => '<li class="nw-i nw-sk"><span class="nw-th"></span><span class="nw-t"><i style="width:24%"></i><i style="width:72%;height:16px"></i><i style="width:92%"></i></span></li>').join('')}</ul></div>` }
  function failed(msg, appId) {
    host.innerHTML = `<div class="nw"><div class="empty nw-empty"><h2>Actus indisponibles</h2><p>${esc(msg)}</p><div class="at-e2"><button class="btn sm" id="nwRetry">${ic('refresh')}Réessayer</button>${appId ? out(steamPage(appId), `Lire sur Steam${ic('link')}`) : ''}</div></div></div>`
    $('#nwRetry', host).onclick = () => load(game, true)
  }
  async function load(g, refresh) {
    const me = ++token
    clearTimeout(skelT); skelT = setTimeout(() => { if (me === token && host?.isConnected) skeleton() }, 100)
    let news = null, ev = null, msg = DOWN
    try {
      ;[news, ev] = await Promise.all([API.getGameNews(g.rid, refresh), API.getGameEvents(g.rid).catch(() => null)])
    } catch (e) { console.error(e); if (e?.message) msg = String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }
    if (me !== token) return
    clearTimeout(skelT)
    if (!host?.isConnected) return
    if (!news) return failed(msg, g.raw.store === 'steam' ? g.raw.storeId : null)
    if (!news.appId) { host.innerHTML = '<div class="empty nw-empty"><h2>Pas d’actus pour ce jeu</h2><p>Player X lit les annonces publiées sur Steam, et ce jeu n’y a pas de page.</p></div>'; return }
    since = news.seenAt || 0
    store[g.id] = { appId: news.appId, posts: news.posts, events: ev?.events || [], reminders: ev?.reminders || [], since }
    paint()
  }
  function render(g, box) {
    host = box; game = g; filter = 'all'; token++
    clearTimeout(skelT)
    if (store[g.id]) { since = store[g.id].since; paint() } else load(g, false)
  }

  /* Le lecteur : une annonce en entier, sans quitter la fiche. Tout le texte passe par esc(). */
  let el = null, cur = 0, list = []
  const safe = (u) => /^https:\/\//i.test(String(u || ''))
  function spans(a = []) {
    return a.map((s) => {
      let t = esc(s.text)
      if (s.strike) t = `<s>${t}</s>`
      if (s.underline) t = `<u>${t}</u>`
      if (s.italic) t = `<em>${t}</em>`
      if (s.bold) t = `<strong>${t}</strong>`
      if (!safe(s.href)) return t
      // Une adresse collée telle quelle devient une petite pastille avec le nom du site
      const bare = /^https?:\/\//i.test(String(s.text || '').trim())
      let host = ''
      try { host = new URL(s.href).hostname.replace(/^www\./, '') } catch { host = '' }
      return bare && host ? `<a class="nr-ln" href="${esc(s.href)}" title="${esc(s.href)}" target="_blank" rel="noopener noreferrer">${esc(host)}${ic('link')}</a>` : `<a href="${esc(s.href)}" title="${esc(s.href)}" target="_blank" rel="noopener noreferrer">${t}</a>`
    }).join('')
  }
  // Les titres que l'éditeur écrit en capitales soulignées (« NOTES DU DÉVELOPPEUR : ») deviennent de vrais titres, en minuscules
  const KEEP = new Set(['PC', 'DLSS', 'FSR', 'XESS', 'RTX', 'GTX', 'EGS', 'HDR', 'FPS', 'UI', 'DLC', 'PS5', 'PS4', 'XBOX', 'NVIDIA', 'AMD', 'INTEL', 'EA', 'BF6', 'CS2', 'MVP', 'PVP', 'PVE', 'XP', 'FAQ', 'API', 'CPU', 'GPU', 'VR'])
  const shout = (t) => t.length >= 4 && t.length <= 90 && t === t.toUpperCase() && /[A-ZÀ-Ý]{3}/.test(t)
  const calm = (t) => {
    const w = t.replace(/\s*:\s*$/, '').toLowerCase().split(/(\s+)/).map((x) => (KEEP.has(x.toUpperCase().replace(/[^A-Z0-9]/g, '')) ? x.toUpperCase() : x)).join('')
    return w.charAt(0).toUpperCase() + w.slice(1)
  }
  const plain = (a = []) => a.map((s) => s.text || '').join('').trim()
  function block(b) {
    if (b.type === 'heading') { const T = ['h3', 'h4', 'h5'][b.level - 1] || 'h5'; const t = plain(b.spans); return shout(t) ? `<${T}>${esc(calm(t))}</${T}>` : `<${T}>${spans(b.spans)}</${T}>` }
    if (b.type === 'paragraph') {
      const t = plain(b.spans)
      if (shout(t) && (b.spans || []).every((s) => s.bold || s.underline || !String(s.text || '').trim()) && !(b.spans || []).some((s) => s.href)) return `<h3>${esc(calm(t))}</h3>`
      return `<p>${spans(b.spans)}</p>`
    }
    if (b.type === 'quote') return `<blockquote>${spans(b.spans)}</blockquote>`
    if (b.type === 'rule') return '<hr>'
    if (b.type === 'image') return safe(b.src) ? `<img class="nr-img" src="${esc(b.src)}" alt="" data-fb="1" loading="lazy" decoding="async" draggable="false">` : ''
    if (b.type === 'video') return safe(b.url) ? out(b.url, `${ic('play')}Voir la vidéo sur YouTube`, 'btn sm nr-vid') : ''
    if (b.type === 'list') {
      let n = 0
      const T = b.ordered ? 'ol' : 'ul'
      return `<${T}>${b.items.map((it) => `<li style="--d:${Math.min(+it.depth || 0, 4)}" data-n="${b.ordered && !it.depth ? `${++n}.` : '•'}">${spans(it.spans)}</li>`).join('')}</${T}>`
    }
    return ''
  }
  function paintReader() {
    const p = list[cur], body = $('#nrBody', el)
    $('#nrN', el).textContent = `${cur + 1} sur ${list.length}`
    $('#nrPrev', el).setAttribute('aria-disabled', cur === 0)
    $('#nrNext', el).setAttribute('aria-disabled', cur === list.length - 1)
    $('#nrOut', el).href = p.url
    // En haut, l'image de l'annonce en grand (sinon l'image du jeu), le titre posé dessus ; la même image n'est pas répétée dans le texte
    const cover = p.image ? p.image : fallbackArt(game)
    const blocks = p.blocks.filter((b, i) => !(i < 2 && b.type === 'image' && p.image && b.src === p.image))
    const next = list[cur + 1]
    body.innerHTML = `<article class="nr-a">
      <div class="nr-hero"><img src="${esc(cover)}" alt="" draggable="false"><div class="nr-ht">
        <p class="nr-m">${p.patch ? '<b>Patch</b>' : '<b>Annonce</b>'}<span>${dateFr.format(p.date)}</span>${p.author ? `<span>${esc(p.author)}</span>` : ''}</p>
        <h2 id="nrT">${esc(p.title)}</h2></div></div>
      <div class="nr-txt">${blocks.map(block).join('') || '<p>Cette annonce n’a pas de texte : ouvre-la sur Steam pour la voir en entier.</p>'}</div>
      <footer class="nr-f">${out(p.url, `Lire sur Steam${ic('link')}`, 'btn sm')}${next ? `<button class="nr-nx" id="nrNx"><span>Annonce suivante</span><b>${esc(next.title)}</b>${ic('chev')}</button>` : ''}</footer>
    </article>`
    $$('.nr-img', body).forEach((im) => im.addEventListener('error', () => im.remove(), { once: true }))
    $('.nr-hero img', body).addEventListener('error', (e) => { e.currentTarget.src = fallbackArt(game) }, { once: true })
    $('#nrNx', body)?.addEventListener('click', () => { cur++; paintReader() })
    el.classList.remove('scrolled')
    body.scrollTop = 0
  }
  function mount(w) {
    el = h(`<div id="nr" hidden data-modal><div class="nr-scrim" id="nrS"></div><section class="nr" role="dialog" aria-modal="true" aria-labelledby="nrT">
      <header class="nr-bar"><span class="nr-g" id="nrG"></span><span class="nr-n num" id="nrN"></span>
        <button class="btn sm icon" id="nrPrev" aria-label="Annonce précédente" data-tip="Précédente, flèche gauche" data-tip-b>${ic('back')}</button>
        <button class="btn sm icon" id="nrNext" aria-label="Annonce suivante" data-tip="Suivante, flèche droite" data-tip-b>${ic('chev')}</button>
        <a class="btn sm icon" id="nrOut" href="#" target="_blank" rel="noopener noreferrer" aria-label="Lire sur Steam" data-tip="Lire sur Steam" data-tip-b>${ic('link')}</a>
        <button class="btn sm icon" id="nrX" aria-label="Fermer" data-tip="Fermer, Échap" data-tip-b data-tip-r>${ic('close')}</button></header>
      <div class="nr-body" id="nrBody" tabindex="-1"></div></section></div>`)
    w.append(el)
    $('#nrS', el).onclick = close; $('#nrX', el).onclick = close
    // La barre devient opaque dès qu'on lit sous l'image
    $('#nrBody', el).addEventListener('scroll', (e) => el.classList.toggle('scrolled', e.currentTarget.scrollTop > 220), { passive: true })
    const step = (d) => { const n = cur + d; if (n < 0 || n >= list.length) return; cur = n; paintReader() }
    $('#nrPrev', el).onclick = () => step(-1); $('#nrNext', el).onclick = () => step(1)
    document.addEventListener('keydown', (e) => {
      if (el.hidden) return
      if (e.key === 'Escape') { e.preventDefault(); close() } else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1)
    })
  }
  function openReader(i) {
    list = shown(); cur = i
    $('#nrG', el).innerHTML = `<img src="${esc(A(game.cover))}" alt=""><span>${esc(game.name)}</span>`
    paintReader()
    el.hidden = false; void el.offsetWidth; el.classList.add('on')
    $('#nrBody', el).focus({ preventScroll: true })
  }
  function close() {
    if (!el || el.hidden || !el.classList.contains('on')) return
    el.classList.remove('on')
    // Le focus revient au tour suivant, une fois la fiche redevenue active
    setTimeout(() => { el.hidden = true; const r = $(`.nw-i[data-i="${cur}"]`, host); setTimeout(() => r?.focus(), 0) }, 200)
  }
  return { mount, render }
})()
