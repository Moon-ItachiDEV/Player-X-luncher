// Mises à jour : la carte « disponible » au centre, la capsule dans la barre du bas, les nouveautés après le redémarrage,
// et le bloc « Mises à jour » de Paramètres › À propos. L'état vient du processus principal (services/updater.ts) ;
// tout ce qui vient de maj.json passe par esc() : jamais de HTML venu d'ailleurs.
const Maj = (() => {
  const SHIELD = '<svg class="mj-shield" viewBox="10 1 100 118" aria-hidden="true"><path d="M60 7 L104 22 V58 C104 84 86 101 60 113 C34 101 16 84 16 58 V22 Z" fill="#140709" stroke="#e8264f" stroke-width="7" stroke-linejoin="round"/><polyline points="36,80 60,58 84,80" fill="none" stroke="#e8264f" stroke-width="11"/><polyline points="40,56 60,38 80,56" fill="none" stroke="#c4123a" stroke-width="9"/><polygon points="60,22 64,30 60,34 56,30" fill="#fff"/></svg>'
  const I = (d, c = '') => `<svg class="mj-ic ${c}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`
  const ICO = {
    dl: I('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    rs: I('<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"/>'),
    ok: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'mj-draw'),
    al: I('<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5M12 17.2v.1"/>'),
    xx: I('<path d="M6 6l12 12M18 6 6 18"/>'),
    pa: I('<path d="M9 6v12M15 6v12"/>')
  }
  const KIND = { nouveau: ['Nouveau', 'n'], ameliore: ['Amélioré', ''], corrige: ['Corrigé', ''] }
  // Là où une note peut renvoyer : une page de la barre, ou une section de Paramètres. Rien d'autre ne s'ouvre.
  const PAGES = { play: 'play', lib: 'lib', clips: 'clips', stats: 'stats', friends: 'friends' }
  const SECTIONS = ['home', 'rec', 'overlay', 'routine', 'keys', 'general', 'library', 'pc', 'accounts', 'edit', 'about']

  let st = null, host = null, capEl = null, dimEl = null, back = null, notesOpen = null, hiddenErr = '', capKey = '', raf = 0

  const mo = (b) => Math.round(b / 1048576)
  const speed = (b) => `${fr(b / 1048576, b < 10 * 1048576 ? 1 : 0)} Mo/s`
  const left = (s) => (s < 90 ? `${s} s` : `${Math.ceil(s / 60)} min`)
  const dateFr = (d) => {
    const t = new Date(d + 'T12:00:00'), n = new Date()
    if (isNaN(t)) return ''
    if (t.toDateString() === n.toDateString()) return 'aujourd’hui'
    return t.toLocaleDateString('fr-FR', t.getFullYear() === n.getFullYear() ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' })
  }
  const ago = (t) => {
    const m = Math.max(0, Math.round((Date.now() - t) / 60000))
    return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`
  }
  const act = (fn) => (...a) => Promise.resolve(fn(...a)).then((s) => s && apply(s)).catch((e) => toast(esc(errText(e)), { tone: 'warn', ms: 4000 }))
  const doDownload = act(() => API.majDownload()), doLater = act(() => API.majLater()), doCancel = act(() => API.majCancel())
  const doInstall = act(() => API.majInstall()), doInstallCancel = act(() => API.majInstallCancel()), doRetry = act(() => API.majRetry())
  const doSkip = act(() => API.majSkip()), doCheck = act(() => API.majCheck())

  function mount(win) {
    if (!API.majState) return
    host = win
    capEl = h('<div class="mj-cap mj-gl" role="status" hidden></div>')
    dimEl = h('<div class="mj-dim" data-modal hidden></div>')
    win.append(capEl, dimEl)
    dimEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onEscape() } })
    // La capsule suit le vide de la barre : elle se replace quand la barre change de taille ou de mode
    const bar = Bar.el()
    new ResizeObserver(place).observe(bar)
    new MutationObserver(place).observe(bar, { attributes: true, attributeFilter: ['class', 'data-mode'] })
    window.addEventListener('resize', place)
    API.onMajState(apply)
    API.majState().then(apply).catch(() => {})
    // Les nouveautés d'une version pas encore vue : un peu après l'ouverture, quand rien d'autre n'occupe l'écran
    API.majNotes(false).then((n) => { if (n.fresh && n.entries.length) later(() => openNotes(n), 1400) }).catch(() => {})
  }
  // Attend que l'écran soit libre (première ouverture, autre fenêtre) avant de montrer quelque chose
  function later(fn, ms, n = 0) {
    setTimeout(() => {
      if (document.querySelector('[data-modal]:not([hidden])') && n < 12) return later(fn, 2000, n + 1)
      fn()
    }, ms)
  }

  function apply(s) {
    st = s
    paintCap()
    paintCard()
    syncBlock()
  }

  /* ---------- la carte « disponible » ---------- */
  const cardOn = () => !!st && st.configured && st.status === 'available' && !st.blocked && !st.quiet
  function paintCard() {
    if (notesOpen) return
    const on = cardOn()
    if (!on) {
      if (dimEl.dataset.k === 'card') { dimEl.hidden = true; dimEl.dataset.k = ''; dimEl.innerHTML = ''; giveFocus(back) }
      return
    }
    if (dimEl.dataset.k === 'card') return
    back = document.activeElement
    const items = (st.notes || []).flatMap((e) => e.items).slice(0, 4)
    dimEl.dataset.k = 'card'
    dimEl.innerHTML = `<div class="mj-card mj-gl" role="dialog" aria-modal="true" aria-labelledby="mjT">
      <div class="mj-hd">${SHIELD}<div class="mj-ver" id="mjT">Player X ${esc(st.version)} est disponible</div><span class="mj-sp"></span>${st.size ? `<span class="mj-meta">${mo(st.size)} Mo</span>` : ''}</div>
      ${items.length ? `<span class="mj-ex">Nouveautés</span><ul class="mj-nv">${items.map((i) => `<li>${esc(i.title)}</li>`).join('')}</ul>` : ''}
      <div class="mj-two"><button class="mj-pill pri" id="mjGo">${ICO.dl}Mettre à jour</button><button class="mj-pill" id="mjLater">Plus tard</button></div>
      <span class="mj-hint">« Plus tard » : elle se fera quand tu fermes Player X.</span>
      <button class="mj-lnk mj-skip" id="mjSkip">Ignorer cette version</button></div>`
    dimEl.hidden = false
    $('#mjGo', dimEl).onclick = () => doDownload()
    $('#mjLater', dimEl).onclick = () => doLater()
    $('#mjSkip', dimEl).onclick = () => doSkip()
    $('#mjGo', dimEl).focus({ preventScroll: true })
  }
  function onEscape() { if (dimEl.dataset.k === 'card') doLater(); else if (notesOpen) closeNotes() }

  /* ---------- la capsule ---------- */
  function capKind(s) {
    if (!s || !s.configured) return null
    const quiet = s.quiet
    switch (s.status) {
      case 'downloading': return quiet ? null : 'dl'
      case 'verifying': return quiet ? null : 'verif'
      case 'ready': return quiet ? null : s.blocked ? 'jeu' : 'prete'
      case 'installing': return 'inst'
      case 'error': return quiet || hiddenErr === `${s.version}|${s.reason}` ? null : 'err'
      case 'available': return !quiet && s.blocked ? 'jeu' : null
      default: return null
    }
  }
  function paintCap() {
    const k = capKind(st)
    if (!k) { capKey = ''; capEl.hidden = true; capEl.innerHTML = ''; cancelAnimationFrame(raf); return }
    const key = `${k}|${st.version}|${st.status}|${st.reason || ''}`
    if (key !== capKey) {
      capKey = key
      capEl.className = `mj-cap mj-gl ${k === 'prete' ? 'good' : k === 'err' ? 'bad' : ''}`
      capEl.innerHTML = capHtml(k)
      bindCap(k)
      capEl.hidden = false
      place()
    }
    liveCap(k)
  }
  function capHtml(k) {
    const v = esc(st.version || '')
    if (k === 'dl') return `<span class="mj-fill"></span>${SHIELD}<b>Téléchargement de ${v}</b><span class="mj-sub num opt" data-f="sp"></span><span class="mj-sp"></span><span class="mj-sub num" data-f="mo"></span><span class="mj-pc num" data-f="pc">0 %</span><button class="mj-x" id="mjX" aria-label="Annuler le téléchargement">${ICO.xx}</button>`
    if (k === 'verif') return `<span class="mj-scan">${SHIELD}</span><b>Vérification du fichier</b><span class="mj-track"><i></i></span><span class="mj-sub">SHA-256</span><span style="width:6px"></span>`
    if (k === 'prete') return `<span class="mj-badge good">${ICO.ok}</span><b>${v} est prête</b><span class="mj-sub opt">10 à 20 s</span><span class="mj-sp"></span><button class="mj-pill sm pri" id="mjRs">${ICO.rs}Redémarrer</button><button class="mj-pill sm" id="mjLt">Plus tard</button>`
    if (k === 'inst') return `<span class="mj-cdw"><span class="mj-cd" data-f="cd"></span><span data-f="cdn">3</span></span><b>Installation de ${v}</b><span class="mj-sub opt">Player X se ferme et revient sur cette page</span><span class="mj-sp"></span><button class="mj-lnk" id="mjNo" style="margin-right:10px">Annuler</button>`
    if (k === 'err') return `<span class="mj-badge bad">${ICO.al}</span><b>Mise à jour bloquée</b><span class="mj-sub wrap">${esc(st.reason || '')}</span><span class="mj-sp"></span><button class="mj-pill sm pri" id="mjRt">${st.release ? 'Ouvrir la page' : 'Réessayer'}</button><button class="mj-x" id="mjX" aria-label="Fermer">${ICO.xx}</button>`
    return `<span class="mj-badge">${ICO.pa}</span><b>${v} ${st.status === 'ready' ? 'prête' : 'disponible'}</b><span class="mj-sub">Rien ne redémarre pendant ta partie ou un enregistrement</span><span class="mj-sp"></span><button class="mj-x" id="mjX" aria-label="Fermer">${ICO.xx}</button>`
  }
  function bindCap(k) {
    const b = (id, fn) => { const e = $('#' + id, capEl); if (e) e.onclick = fn }
    if (k === 'dl') b('mjX', () => doCancel())
    else if (k === 'prete') { b('mjRs', () => doInstall()); b('mjLt', () => doLater()) }
    else if (k === 'inst') b('mjNo', () => doInstallCancel())
    else if (k === 'err') { b('mjRt', () => (st.release ? API.majOpenRelease().catch(() => {}) : doRetry())); b('mjX', () => { hiddenErr = `${st.version}|${st.reason}`; paintCap() }) }
    else b('mjX', () => doLater())
  }
  // Ce qui bouge sans refaire la capsule : pourcentage, remplissage, vitesse, compte à rebours
  function liveCap(k) {
    const f = (n) => $(`[data-f=${n}]`, capEl)
    if (k === 'dl') {
      const p = st.total ? Math.min(100, (st.received || 0) / st.total * 100) : 0
      capEl.style.setProperty('--p', p + '%')
      f('pc').textContent = `${Math.floor(p)} %`
      f('mo').textContent = `${mo(st.received || 0)} / ${mo(st.total || 0)} Mo`
      f('sp').textContent = st.bytesPerSec ? `${speed(st.bytesPerSec)}${st.etaS ? ` · ${left(st.etaS)}` : ''}` : ''
    } else if (k === 'inst') {
      cancelAnimationFrame(raf)
      const tick = () => {
        const ms = Math.max(0, (st.endsAt || 0) - Date.now())
        f('cd')?.style.setProperty('--p', (reduced() ? 100 : ms / 30) + '%')
        const n = f('cdn'); if (n) n.textContent = Math.max(1, Math.ceil(ms / 1000))
        if (ms > 0 && st.status === 'installing') raf = requestAnimationFrame(tick)
      }
      tick()
    }
  }
  // Au milieu du vide de la barre ; si la barre est occupée (jeu lancé, routine) ou trop étroite, au-dessus d'elle
  function place() {
    if (!capEl || capEl.hidden) return
    const bar = Bar.el(), a = $('.b-tabs', bar), c = $('.b-right', bar)
    const x0 = bar.offsetLeft + a.offsetLeft + a.offsetWidth, x1 = bar.offsetLeft + c.offsetLeft
    const gap = x1 - x0, w = Math.min(540, gap - 32)
    const inline = bar.dataset.mode === 'idle' && bar.classList.contains('is-split') && w >= 340 && !bar.classList.contains('is-hidden')
    capEl.classList.toggle('up', !inline)
    if (!inline) { capEl.style.removeProperty('--mj-x'); capEl.style.removeProperty('--mj-w'); return }
    capEl.style.setProperty('--mj-w', w + 'px')
    capEl.style.setProperty('--mj-x', Math.round(x0 + (gap - w) / 2) + 'px')
  }

  /* ---------- les nouveautés ---------- */
  function openNotes(n) {
    if (!n.entries.length || notesOpen) return
    back = document.activeElement
    notesOpen = n
    const { entries, fresh, from, to } = n
    const sub = !fresh ? `Version installée : ${esc(to)}` : from ? `De la ${esc(from)} à la ${esc(to)} · ${entries.length} version${entries.length > 1 ? 's' : ''} que tu n’avais pas vues` : `Nouveautés de la ${esc(to)}`
    dimEl.dataset.k = 'notes'
    dimEl.innerHTML = `<div class="mj-cl mj-gl" role="dialog" aria-modal="true" aria-labelledby="mjT">
      <div class="mj-hd">${SHIELD}<div><div class="mj-ver" id="mjT">${fresh ? 'Player X est à jour' : 'Nouveautés de Player X'}</div><div class="mj-meta">${sub}</div></div><span class="mj-sp"></span><span class="mj-vb">${esc(to)}</span></div>
      <div class="mj-body">${entries.map((e) => `<div class="mj-vh">${esc(e.version)} <span class="mj-meta">${esc(dateFr(e.date))}</span></div>${e.items.map((i) => {
        const [lab, cls] = KIND[i.kind] || KIND.nouveau
        const ok = i.page && (PAGES[i.page] || (i.page.startsWith('set-') && SECTIONS.includes(i.page.slice(4))))
        return `<div class="mj-grp"><span class="mj-gk ${cls}">${lab}</span><div class="mj-it"><b>${esc(i.title)}</b><span>${esc(i.text)}</span></div>${ok ? `<button class="mj-lnk" data-page="${esc(i.page)}">Voir</button>` : '<span></span>'}</div>`
      }).join('')}`).join('')}</div>
      <div class="mj-ft"><button class="mj-pill pri" id="mjOk">${fresh ? 'C’est parti' : 'Fermer'}</button><span class="mj-sp"></span>${fresh ? '<span class="mj-meta">Ces notes ne s’affichent qu’une fois</span>' : ''}</div></div>`
    dimEl.hidden = false
    $('#mjOk', dimEl).onclick = () => closeNotes()
    $$('[data-page]', dimEl).forEach((b) => b.onclick = () => { const p = b.dataset.page; closeNotes(); setTimeout(() => goPage(p), 220) })
    $('#mjOk', dimEl).focus({ preventScroll: true })
  }
  function closeNotes() {
    if (!notesOpen) return
    if (notesOpen.fresh) API.majNotesSeen().catch(() => {})
    notesOpen = null
    dimEl.hidden = true; dimEl.dataset.k = ''; dimEl.innerHTML = ''
    giveFocus(back)
    paintCard()
  }
  function goPage(p) {
    if (PAGES[p]) return go(PAGES[p])
    const sec = p.startsWith('set-') ? p.slice(4) : ''
    if (SECTIONS.includes(sec)) Settings.open(sec)
  }
  const review = () => API.majNotes(true).then((n) => { if (n.entries.length) openNotes({ ...n, fresh: false }); else toast('Pas de nouveautés gardées pour cette version.', { ms: 2400 }) }).catch((e) => toast(esc(errText(e)), { tone: 'warn', ms: 4000 }))

  /* ---------- Paramètres › À propos ---------- */
  // Le texte de la ligne d'état, d'après l'état reçu
  function texts(s) {
    if (!s) return { t: 'Mises à jour', sub: '' }
    if (!s.configured) return { t: 'Mises à jour pas encore configurées', sub: 'Cette version ne peut pas encore se mettre à jour toute seule.' }
    const v = s.version || ''
    const checked = s.checkedAt ? `vérifié ${ago(s.checkedAt)}` : ''
    const quit = (Real.st.settings || {}).updateOnQuit !== false
    switch (s.status) {
      case 'checking': return { t: 'Vérification…', sub: '' }
      case 'available': return { t: `${v} est disponible`, sub: s.size ? `${mo(s.size)} Mo` : '' }
      case 'downloading': return { t: `Téléchargement de ${v}`, sub: s.total ? `${Math.floor((s.received || 0) / s.total * 100)} %` : '' }
      case 'verifying': return { t: `Vérification de ${v}`, sub: '' }
      case 'ready': return { t: `${v} est prête`, sub: quit ? 'Elle s’installe quand tu fermes Player X.' : 'Redémarre Player X pour l’installer.' }
      case 'installing': return { t: `Installation de ${v}`, sub: '' }
      case 'error': return { t: 'Mise à jour bloquée', sub: s.reason || '' }
      case 'uptodate': return { t: 'Player X est à jour', sub: checked }
      default: return { t: 'Pas encore vérifié', sub: '' }
    }
  }
  function syncBlock() {
    const r = $('#r-maj'); if (!r || !st) return
    const x = texts(st), busy = ['checking', 'downloading', 'verifying', 'installing'].includes(st.status)
    $('.sr-t b', r).textContent = x.t
    let sub = $('.sr-t span', r)
    if (!sub) { sub = document.createElement('span'); $('.sr-t', r).append(sub) }
    sub.textContent = st.checkError || x.sub
    sub.classList.toggle('err', !!st.checkError)
    const btn = $('#mjCheck'); if (btn) btn.disabled = busy
    $('#r-maj-quit')?.toggleAttribute('hidden', !st.configured)
    const sk = (Real.st.settings || {}).updateSkipped
    const row = $('#r-maj-skip')
    if (row) {
      row.hidden = !st.configured
      $('.sr-t b', row).textContent = sk ? `Version ignorée : ${sk}` : 'Version ignorée : aucune'
      $('#mjUnskip').disabled = !sk
    }
  }
  // Le bloc, dans les briques de Paramètres (row, group, sw viennent de settings.js)
  function block({ row, group, sw }) {
    const x = texts(st), sk = (Real.st.settings || {}).updateSkipped, on = (Real.st.settings || {}).updateOnQuit !== false
    return group('Mises à jour', `${row('r-maj', esc(x.t), esc(x.sub), `<button class="btn sm" id="mjCheck">Vérifier maintenant</button>`)}
      ${row('r-maj-quit', 'Installer à la fermeture de Player X', 'Jamais pendant une partie ou un enregistrement', sw('mjQuit', on, 'Installer à la fermeture de Player X'))}
      ${row('r-maj-skip', sk ? `Version ignorée : ${esc(sk)}` : 'Version ignorée : aucune', 'Si tu choisis « Ignorer cette version », elle apparaît ici', `<button class="btn sm" id="mjUnskip" ${sk ? '' : 'disabled'}>Ne plus ignorer</button>`)}
      ${row('r-maj-notes', 'Revoir les nouveautés', 'Celles de ta version et des précédentes', '<button class="btn sm" id="mjNotes">Voir</button>')}`)
  }
  function bind(b, { save }) {
    if (!b) return
    syncBlock()
    $('#mjCheck', b).onclick = () => doCheck()
    $('#mjNotes', b).onclick = () => review()
    const q = $('#mjQuit', b)
    if (q) q.onclick = () => { const v = q.getAttribute('aria-checked') !== 'true'; q.setAttribute('aria-checked', v); save({ updateOnQuit: v }).then(syncBlock) }
    $('#mjUnskip', b).onclick = () => save({ updateSkipped: null }).then(() => { syncBlock(); doCheck() })
  }

  return { mount, block, bind, review, state: () => st }
})()
