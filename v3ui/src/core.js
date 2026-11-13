// Outils communs
// L'appli remplit une vraie fenêtre Windows (shell.css)
document.documentElement.dataset.shell = ''
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const fmtTime = (s) => { s = Math.max(0, s | 0); const m = s / 60 | 0; return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }
const fr = (n, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })
// Le message d'une erreur venue du processus principal, sans la plomberie autour
const errText = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Une erreur est survenue. Réessaie.'
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const PATHS = {
  warn: '<path d="M12 4.5 3 19.500h18z"/><path d="M12 10.500v4M12 17v.1"/>',
  keys: '<rect x="3" y="6.5" width="18" height="11" rx="2.5"/><path d="M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17.5 10.5h.01M8 14h8"/>',
  play: '<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="2.6"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.2" fill="currentColor" stroke="none"/>',
  stack: '<rect x="8.5" y="3.5" width="11" height="14" rx="2"/><path d="M5 7v10.5A3 3 0 0 0 8 20.5h8"/>',
  lib: '<rect x="4" y="4" width="6.5" height="9.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6" rx="1.6"/><rect x="13.5" y="13" width="6.5" height="7" rx="1.6"/><rect x="4" y="16.5" width="6.5" height="3.5" rx="1.4"/>',
  clip: '<rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="m9.5 9.5 5 5m0-5-5 5"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M8 5v14M16 5v14M3.500 9.700H8M3.500 14.300H8M16 9.700h4.500M16 14.300h4.500"/>',
  stats: '<path d="M4 18.5 9.5 12l4 3.5L20 7"/><path d="M4 21h16" opacity=".45"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M3 19.5c.7-3 3-5 6-5s5.3 2 6 5"/><path d="M16 5.400a3.5 3.5 0 0 1 0 6.200M18.2 14.900c1.3.8 2.2 2.3 2.6 4.6"/>',
  bell: '<path d="M6.5 16V11a5.5 5.5 0 0 1 11 0v5l1.5 2h-14z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.500v2.200M12 18.300v2.200M3.5 12h2.200M18.3 12h2.200M6 6l1.6 1.600M16.4 16.4 18 18M18 6l-1.6 1.600M7.6 16.4 6 18"/>',
  star: '<path d="m12 4 2.4 5 5.5.8-4 3.9.9 5.500L12 16.6 7.2 19.200l.9-5.5-4-3.9 5.5-.8Z"/>',
  starf: '<path d="m12 4 2.4 5 5.5.8-4 3.9.9 5.500L12 16.6 7.2 19.200l.9-5.5-4-3.9 5.5-.8Z" fill="currentColor"/>',
  check: '<path d="m5 12.5 4.5 4.500L19 7.5"/>',
  close: '<path d="m6.5 6.5 11 11m0-11-11 11"/>',
  min: '<path d="M5 12h14"/>',
  max: '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/>',
  down: '<path d="M12 4.500v11M7 11l5 5 5-5M5 20h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.700l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.700l1-1"/>',
  chat: '<path d="M5 5.500h14a1.5 1.5 0 0 1 1.5 1.500v8.500A1.5 1.5 0 0 1 19 17H10l-4.5 3.500V17H5a1.5 1.5 0 0 1-1.5-1.500V7A1.5 1.5 0 0 1 5 5.500Z"/>',
  overlay: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><rect x="13" y="8" width="5" height="8" rx="1.2" fill="currentColor" stroke="none"/>',
  gun: '<path d="M3 9.500h14.500l3.5 1.500v2l-4.5.5-1 1h-3l-1.5 4.500H7L8.5 14H4.500L3 12.500Z"/>',
  chev: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  back: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  chevd: '<path d="m6 9.5 6 6 6-6"/>',
  queue: '<path d="M4 6.500h11M4 12h11M4 17.500h7"/><path d="M17.5 14v6l4-3Z" fill="currentColor"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 8.500V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.500a2 2 0 0 0 2 2h2.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.500h5V7M6.5 7l1 13h9l1-13"/>',
  cut: '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M8.5 8 20 18M8.5 16 20 6"/>',
  folder: '<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.500h4l2 2.500h8A1.5 1.5 0 0 1 20.5 9.500v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.500Z"/>',
  bolt: '<path d="M13.5 3.5 5.5 13.500H12l-1.5 7 8-10H12Z"/>',
  refresh: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.300L20 9.500M20 4.500v5h-5"/><path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.300L4 14.500M4 19.500v-5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  drag: '<circle cx="9" cy="6.5" r="1.1" fill="currentColor"/><circle cx="15" cy="6.5" r="1.1" fill="currentColor"/><circle cx="9" cy="12" r="1.1" fill="currentColor"/><circle cx="15" cy="12" r="1.1" fill="currentColor"/><circle cx="9" cy="17.5" r="1.1" fill="currentColor"/><circle cx="15" cy="17.5" r="1.1" fill="currentColor"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.500a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  trophy: '<path d="M7.5 4.500h9V10a4.5 4.5 0 0 1-9 0ZM7.5 6.500H4.500c0 3 1 4.5 3.3 5M16.5 6.500h3c0 3-1 4.5-3.3 5M12 14.500V18M8.5 20h7"/>',
  eye: '<path d="M2.5 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12Z"/><circle cx="12" cy="12" r="2.800"/>',
  edit: '<path d="M4.500 19.500h3.800L19 8.800a2.200 2.200 0 0 0-3.100-3.100L5.200 16.400Z"/><path d="m14.500 7 3 3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.500M12 7.700v.1"/>'
}
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[n] || ''}</svg>`
// Le X : le hitmarker du jeu et le bouton de la console. Il marque chaque moment sur la ligne.
const xm = (cls = '') => `<svg class="xm ${cls}" viewBox="0 0 12 12" aria-hidden="true"><path d="m1.3 1.3 3 3m6.4-3-3 3m-3.4 3.4-3 3m6.4-3 3 3"/></svg>`

let logoN = 0
// Logo final de la console, rendu avec ses crochets d'animation (écran, barre, P, X)
const logo = (cls = '') => { const n = 'L' + (++logoN); return `<span class="logo ${cls}">${LOGO_FULL.replaceAll('pxc-', n + '-')}</span>` }
const logoS = () => { const n = 'S' + (++logoN); return LOGO_32.replaceAll('pxc-', n + '-') }

// Ressort : une courbe linear() calculée (les transitions restent interruptibles)
function springEasing(stiffness = 170, damping = 19, mass = 1) {
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass)), wd = w0 * Math.sqrt(Math.max(0, 1 - z * z))
  const f = (t) => z < 1 ? 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)) : 1 - Math.exp(-w0 * t) * (1 + w0 * t)
  let T = .1; while (T < 4 && (Math.abs(1 - f(T)) > .002 || Math.abs(1 - f(T + .1)) > .002)) T += .05
  const stops = []; for (let i = 0; i <= 32; i++) stops.push(+f(T * i / 32).toFixed(3))
  return { css: `linear(${stops.join(',')})`, ms: Math.round(T * 1000) }
}
const SP = springEasing(170, 26); const SP_SOFT = springEasing(120, 22)
document.documentElement.style.setProperty('--spring', CSS.supports('transition-timing-function', 'linear(0,1)') ? SP.css : 'cubic-bezier(.2,.9,.25,1)')
document.documentElement.style.setProperty('--spring-ms', SP.ms + 'ms')
document.documentElement.style.setProperty('--spring-soft', CSS.supports('transition-timing-function', 'linear(0,1)') ? SP_SOFT.css : 'cubic-bezier(.2,.9,.25,1)')
document.documentElement.style.setProperty('--spring-soft-ms', SP_SOFT.ms + 'ms')

// Minuteries d'une scène : quitter la scène les annule toutes
const Sched = {
  sets: {},
  after(scene, ms, fn) { const id = setTimeout(fn, ms); (this.sets[scene] ??= []).push(id); return id },
  clear(scene) { (this.sets[scene] || []).forEach((id) => { clearTimeout(id); clearInterval(id) }); delete this.sets[scene] }
}

// État global
const S = {
  view: 'play', focus: 0, session: null,
  statsGame: 'bf6', statsTab: 'overview', libFilter: 'all', clipFilter: 'all', friend: null, gameId: null, gameTab: 'news'
}

// Transition de vue : l'élément partagé se transforme au lieu d'être remplacé
function vt(update, opts = {}) {
  if (!document.startViewTransition || reduced() || opts.skip) { update(); opts.done && opts.done(); return }
  const t = document.startViewTransition(() => { update() })
  t.ready.catch(() => {}); t.updateCallbackDone.catch((e) => console.error(e))
  t.finished.catch(() => {}).finally(() => { opts.done && opts.done() })
  return t
}

// Compteur à rouleaux (odometer)
function odo(el, value, d = 0, suffix = '') {
  const txt = fr(value, d)
  el.classList.add('odo')
  el.setAttribute('aria-label', txt + suffix)
  el.innerHTML = [...txt].map((c, i) => /\d/.test(c)
    ? `<span class="odo-c" style="--d:${c};--i:${i}"><span class="odo-s">${Array.from({ length: 10 }, (_, n) => `<i>${n}</i>`).join('')}</span></span>`
    : `<span class="odo-t">${c === ' ' || c === ' ' ? '&nbsp;' : c}</span>`).join('') + (suffix ? `<span class="odo-t odo-u">${suffix.replace(' ', '&nbsp;')}</span>` : '')
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')))
}


function toast(html, { tone = '', ms = 3200, action } = {}) {
  const box = $('#toasts'); if (!box) return
  const t = h(`<div class="toast ${tone}" role="status">${html}${action ? `<button class="toast-a">${action.label}</button>` : ''}</div>`)
  if (action) t.querySelector('.toast-a').onclick = () => { action.fn(); t.remove() }
  box.append(t)
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200) }, ms)
}

// Avant tout ce qui ne se rattrape pas : on nomme ce qui part, et le bouton sûr a le focus
function confirmDel({ title, text, verb, onOk }) {
  const d = h(`<dialog class="cf" aria-labelledby="cfT" closedby="any"><h2 id="cfT">${title}</h2><p>${text}</p><div class="cf-a"><button class="btn" id="cfNo" autofocus>Annuler</button><button class="btn danger" id="cfOk">${verb}</button></div></dialog>`)
  document.body.append(d)
  const end = () => setTimeout(() => d.remove(), 200)
  $('#cfNo', d).onclick = () => { d.close(); end() }
  $('#cfOk', d).onclick = () => { d.close(); end(); onOk() }
  d.addEventListener('keydown', (e) => e.stopPropagation())
  d.addEventListener('close', end)
  d.showModal()
}
// Un menu de quelques actions, sous son bouton (ou au-dessus quand il manque de place)
// Menu en îlot de verre. opts.at = {x, y} : s'ouvre au curseur (clic droit) ; opts.head : en-tête (jaquette et nom) ;
// une entrée ['sep'] trace un trait ; la première entrée avec opts.main est l'action principale, en rose.
function menuAt(btn, items, opts = {}) {
  $('#pxMenu')?.remove()
  const row = ([i, t], k) => (i === 'sep' ? '<hr>' : `<button data-k="${k}" class="${opts.main && k === 0 ? 'is-main' : ''}">${ic(i)}<span>${esc(t)}</span></button>`)
  const m = h(`<div id="pxMenu" class="mn" popover="auto">${opts.head || ''}${items.map(row).join('')}</div>`)
  document.body.append(m)
  btn.setAttribute('aria-expanded', 'true')
  m.addEventListener('toggle', (e) => { if (e.newState === 'closed') btn.setAttribute('aria-expanded', 'false') })
  m.showPopover()
  const H = m.offsetHeight, W = m.offsetWidth
  if (opts.at) {
    // Au curseur, retourné vers la gauche ou vers le haut s'il dépasserait de la fenêtre
    const right = opts.at.x + W + 8 < innerWidth, down = opts.at.y + H + 8 < innerHeight
    m.style.left = clamp(right ? opts.at.x + 2 : opts.at.x - W - 2, 8, innerWidth - W - 8) + 'px'
    m.style.top = clamp(down ? opts.at.y + 2 : opts.at.y - H - 2, 8, innerHeight - H - 8) + 'px'
    m.style.transformOrigin = `${right ? 0 : '100%'} ${down ? 0 : '100%'}`
  } else {
    const r = btn.getBoundingClientRect(), below = r.bottom + H + 10 < innerHeight
    m.style.left = clamp(r.left, 8, innerWidth - W - 8) + 'px'
    m.style.top = (below ? r.bottom + 6 : r.top - H - 6) + 'px'
    m.style.transformOrigin = (below ? '0 0' : '0 100%')
  }
  $$('button', m).forEach((b) => b.onclick = () => { m.hidePopover(); items[+b.dataset.k][2]() })
  m.querySelector('button').focus()
}

// Une infobulle attend 300 ms la première fois ; tant qu'on passe de l'une à l'autre, elles répondent tout de suite
let tipT = 0
document.addEventListener('pointerover', (e) => { if (e.target.closest?.('[data-tip]')) { clearTimeout(tipT); tipT = setTimeout(() => document.documentElement.classList.add('tip-fast'), 320) } })
document.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip]')) { clearTimeout(tipT); tipT = setTimeout(() => document.documentElement.classList.remove('tip-fast'), 500) } })

// Rendre le focus une fois la fenêtre vraiment fermée (le reste de l'appli n'est plus inerte qu'à ce moment-là)
const giveFocus = (e) => setTimeout(() => { if (e?.isConnected) e.focus({ preventScroll: true }) }, 0)

// Le champ de recherche visible des pages de liste : il ouvre la recherche de partout
const searchBtn = () => `<button class="srch" data-search>${ic('search')}<span>Rechercher</span><kbd class="kb">Ctrl K</kbd></button>`
document.addEventListener('click', (e) => { if (e.target.closest?.('[data-search]')) Palette.open() })
