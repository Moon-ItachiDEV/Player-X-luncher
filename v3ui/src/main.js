// Démarrage
function go(v) {
  if (S.view === v && !S.gameId) return
  if (v !== 'stats') Atelier.away()
  S.gameId = null
  Views.show(v)
}
function openGame(id, from) { Pages.openGame(id, from) }

const Views = {
  host: null,
  show(v, opts = {}) {
    const change = () => {
      S.view = v; S.gameId = null
      $('#win').dataset.view = v
      $$('.v', this.host).forEach((e) => { e.hidden = e.dataset.v !== v })
      Pages.enter(v)
      Bar.setNav(v)
      Bar.syncGame(); Fluid.rest()
      if (v === 'play') { Play.refresh(); const g = Play.focused(); Fluid.game(g) }
          }
    vt(change, { skip: opts.skip, done: () => { const e = $(`.v[data-v=${v}]`, this.host); if (e && !e.contains(document.activeElement)) e.focus({ preventScroll: true }) } })
  }
}

// Revenir en arrière : Échap, Alt + flèche gauche ou le bouton Précédent de la souris. La couche du dessus part d'abord.
function goBack() {
  if (document.querySelector('[data-modal]:not([hidden]), dialog[open]')) return false
  if (Clips.isOpen()) { Clips.close(); return true }
  if (S.gameId) { Pages.closeGame(); return true }
  if (S.atelier && S.view === 'stats') { Atelier.leave(); return true }
  const all = S.view === 'stats' && !S.atelier && $('#loAll')
  if (all) { all.click(); return true }
  return false
}
// Les flèches dans une grille de jaquettes ou de clips : la case d'à côté, celle du dessus, celle du dessous
function gridMove(e) {
  const t = document.activeElement, grid = t?.closest?.('.lb-grid, .ct-grid'); if (!grid) return false
  const items = $$('.lb-t, .ct-tile', grid).filter((x) => x.offsetParent), i = items.indexOf(t); if (i < 0) return false
  const r = t.getBoundingClientRect(), cx = r.left + r.width / 2
  let next = null
  if (e.key === 'ArrowRight') next = items[i + 1]
  else if (e.key === 'ArrowLeft') next = items[i - 1]
  else {
    const down = e.key === 'ArrowDown', rows = items.filter((x) => { const q = x.getBoundingClientRect(); return down ? q.top > r.top + 4 : q.top < r.top - 4 })
    if (rows.length) {
      const rowTop = down ? Math.min(...rows.map((x) => x.getBoundingClientRect().top)) : Math.max(...rows.map((x) => x.getBoundingClientRect().top))
      next = rows.filter((x) => Math.abs(x.getBoundingClientRect().top - rowTop) < 4).sort((a, b) => { const p = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return Math.abs(p.left + p.width / 2 - cx) - Math.abs(q.left + q.width / 2 - cx) })[0]
    } else {
      // Bout de grille : la grille suivante (les jeux pas installés), ou la précédente
      const all = $$('.lb-grid, .ct-grid', grid.closest('.scroll') || document), gi = all.indexOf(grid), other = all[gi + (down ? 1 : -1)]
      if (other) next = $$('.lb-t, .ct-tile', other)[down ? 0 : $$('.lb-t, .ct-tile', other).length - 1]
    }
  }
  if (!next) return true
  e.preventDefault(); next.focus({ preventScroll: true })
  // Seule la page défile (scrollIntoView déplacerait aussi la fenêtre)
  const sc = next.closest('.scroll')
  if (sc) { const a = sc.getBoundingClientRect(), b = next.getBoundingClientRect(); if (b.top < a.top + 16) sc.scrollTop += b.top - a.top - 16; else if (b.bottom > a.bottom - 120) sc.scrollTop += b.bottom - a.bottom + 120 }
  return true
}

window.addEventListener('DOMContentLoaded', boot)
// Une action qui échoue sans que personne ne l'attende (enregistrer une routine, une collection…) : on le dit au lieu de se taire.
// Un message toutes les 8 s au plus, pour ne jamais noyer l'écran.
let lastRejectToast = 0
window.addEventListener('unhandledrejection', (ev) => {
  console.error(ev.reason)
  if (Date.now() - lastRejectToast < 8000) return
  lastRejectToast = Date.now()
  toast(`Ça n’a pas abouti : ${esc(errText(ev.reason))}`, { tone: 'warn', ms: 4200 })
})
if (document.readyState !== 'loading') boot()
let booted = false
async function boot() {
  if (booted) return; booted = true
  const win = $('#win')
  $('#stage').prepend(h('<div id="winSh" aria-hidden="true"></div>'))
  win.append(h('<canvas id="fluid" aria-hidden="true"></canvas>'), h('<div class="grain" aria-hidden="true"></div>'))
  win.append(h(`<header class="tbar"><button class="t-brand" id="tBrand" aria-label="Player X"><span class="mark">${logoS()}</span><span class="wm">${WORDMARK.replaceAll('pxc-', 'tb-')}</span></button><div class="t-ctrl" aria-hidden="true"><button tabindex="-1">${ic('min')}</button><button tabindex="-1">${ic('max')}</button><button tabindex="-1">${ic('close')}</button></div></header>`))
  const zone = (c) => h(`<div class="z ${c}" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`)
  win.append(zone('z-left'), zone('z-top'), zone('z-bot'))
  const views = h('<div id="views"></div>'); win.append(views); Views.host = views
  win.append(h('<div id="toasts" aria-live="polite"></div>'))
  // L'accueil n'attend pas : le fond et le logo tout de suite, et un mot si la lecture de tes jeux prend du temps
  Fluid.init($('#fluid')); Fluid.set(ROSE_PAL); Fluid.rest()
  const wait0 = setTimeout(() => win.append(h(`<div id="bootWait" role="status">${logo('il busy')}<p>Lecture de tes jeux…</p></div>`)), 300)
  let bootFailed = null
  try { await Real.init(); await Real.initExtras(); await Clips.boot() } catch (e) { console.error(e); bootFailed = e }
  clearTimeout(wait0); $('#bootWait')?.remove()
  Play.mount(views)
  Bar.mount(win)
  Pages.mount && Pages.mount(views)
  Live.mount(win)
  Story.mount(win)
  Settings.mount(win)
  NewsView.mount(win)
  // Lecture des jeux ratée au démarrage : on le dit, avec de quoi réessayer, au lieu d'un accueil vide sans explication
  if (bootFailed) toast(`Tes jeux n’ont pas pu être lus. ${esc(errText(bootFailed))}`, { tone: 'warn', ms: 20000, action: { label: 'Réessayer', fn: () => location.reload() } })
  Palette.mount(win)
  Install.mount(win)
  Recap.mount()
  const syncInert = () => { const kids = [...win.children], open = kids.filter((c) => c.matches('[data-modal]:not([hidden])')).pop(); kids.forEach((c) => { if (c.id !== 'toasts') c.inert = !!open && c !== open }) }
  new MutationObserver(syncInert).observe(win, { childList: true })
  new MutationObserver(syncInert).observe(win, { subtree: true, attributes: true, attributeFilter: ['hidden'] })
  Play.intro()
  Real.on('games', () => { Play.sync(); if (S.view === 'lib' && !S.gameId) Pages.refresh('lib'); if (S.gameId) Pages.syncSheet(); Bar.syncGame() })
  Real.on('friends', () => { Play.sync(); Bar.friendsCount(Shared.friendView.countInGame(Real.st.friendsRes.friends, [...Real.st.raw, ...Real.st.owned])); if (S.view === 'friends' && !S.gameId) Pages.refresh('friends') })
  Real.on('accounts', () => Bar.avatar()); Real.on('settings', () => Bar.avatar())
  Real.on('shelves', () => { if (S.view === 'lib' && !S.gameId) Pages.refresh('lib') })
  Real.startFriends()
  Setup.maybeOpen()
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); Palette.open(); return }
    if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); Settings.open(); return }
    // Ctrl 1 à 5 : les pages de la barre. e.code, pour que ça marche aussi en AZERTY (Ctrl & donne « & »)
    const pg = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^(Digit|Numpad)[1-5]$/.test(e.code) ? ['play', 'lib', 'clips', 'stats', 'friends'][+e.code.slice(-1) - 1] : null
    if (pg) { e.preventDefault(); if (document.querySelector('[data-modal]:not([hidden])')) return; if (Clips.isOpen()) Clips.close(); go(pg); return }
    if (e.key === 'F2') { e.preventDefault(); const m = Fluid.next(); toast(`Fond : ${m.t}. ${m.d}`, { ms: 1800 }); return }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')
    const modal = document.querySelector('[data-modal]:not([hidden])')
    // Ctrl F : « Chercher un réglage » marche aussi paramètres fermés
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !modal && !typing && !(S.atelier && S.view === 'stats')) { e.preventDefault(); Settings.find(); return }
    if ((e.altKey && e.key === 'ArrowLeft') || e.key === 'BrowserBack') { if (!typing && goBack()) e.preventDefault(); return }
    if (/^Arrow/.test(e.key) && !e.altKey && !e.ctrlKey && !typing && !modal && S.view !== 'play' && gridMove(e)) return
    if (S.view === 'play' && !S.session && !typing && !modal) Play.keys(e)
    if (e.key === 'Escape' && !e.defaultPrevented) { if (S.gameId && !modal) Pages.closeGame(); else if (Editor.isOpen() && !modal) Editor.close(); else if (Clips.isOpen() && !modal) Clips.close(); else if (S.atelier && S.view === 'stats' && !modal) Atelier.leave() }
    if (['ArrowLeft', 'ArrowRight'].includes(e.key) && document.activeElement?.getAttribute?.('role') === 'tab') {
      const t = document.activeElement, l = $$('[role=tab]', t.parentElement), n = l[(l.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1) + l.length) % l.length], g = n.dataset.g
      e.preventDefault(); n.focus(); n.click()
      if (g) setTimeout(() => $(`.sp-g[data-g=${g}]`)?.focus({ preventScroll: true }), 360)
    }
    if (e.key === ' ' && Clips.isOpen() && !typing && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); Clips.playerToggle() }
  })
  // Le bouton Précédent de la souris (bouton 4) : comme Échap
  document.addEventListener('mouseup', (e) => { if (e.button === 3 && goBack()) e.preventDefault() })
  $('#tBrand').onclick = () => go('play')
}
