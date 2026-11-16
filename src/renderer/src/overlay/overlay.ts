// Overlay CS2 (bêta) : la page de la fenêtre transparente posée par-dessus le jeu (main/services/cs2Overlay.ts).
// Elle suit le match tout seul : temps d'achat, pastille pendant le round, mi-temps, fin du match. 0.6.2 (test) : trois
// styles au choix, Étendard, Viseur et Régie (trois.ts), plus l'actuel (le blason, classe .ov-c) pour comparer. Rien ne se clique : la souris
// et le clavier restent au jeu ; son raccourci (Alt+X par défaut, réglable dans Paramètres › Overlay) le masque.
// Pont : window.pxOverlay (preload/overlay.ts), les seuls envois cs2:* dont la page a besoin.
import { formatKd, killDeath, mapLabel, modeLabel, RESULT_LABEL } from '@shared/cs2'
import { DEFAULT_OVERLAY_HOTKEY, hotkeyText } from '@shared/hotkey'
import type { Cs2Live, Cs2OverlayConfig, Cs2OverlayMoment, Cs2OverlayPlace, Cs2OverlayStyle, Cs2OverlayThree, Cs2Recap, Cs2Round } from '@shared/types'
import { h, patch, s } from './dom'
import { startEditor } from './editeur'
import { isThree, THREE, threeHtml, threeKey } from './trois'
import { END_MS, endSecondsLeft, pickView } from './view'

/** Les maquettes sont dessinées sur un écran de 1080 px de haut : l'overlay suit la hauteur de l'écran. */
const DESIGN_H = 1080
/**
 * Trois styles de la 0.6.2 : l'overlay suit la hauteur de l'écran, mais moins vite que le HUD de CS2 (puissance 0,8) :
 * en 4K il prend un peu moins de place qu'en 1080p. Normale = 84 % de la maquette d'origine, jugée trop grosse.
 * Ses positions, elles, suivent le HUD (--p) : il reste collé au radar, au fil des élim. et aux munitions.
 */
const SIZE = { s: 0.72, n: 0.84, l: 1 } as const
/** Un triplé (ou mieux) vient de tomber : le gros bandeau de la Régie reste 2,6 s. */
const FRESH_MS = 2_600

const int = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const other = (side: 'CT' | 'T'): 'CT' | 'T' => (side === 'CT' ? 'T' : 'CT')
const kda = (l: Pick<Cs2Live, 'kills' | 'deaths' | 'assists'>): string => `${l.kills}/${l.deaths}/${l.assists}`
const pctOf = (n?: number): string => (n === undefined ? '–' : `${n}\u00a0%`)
const escHtml = (v: string): string => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function startOverlay(host: HTMLElement): void {
  const api = window.pxOverlay
  let cfg: Cs2OverlayConfig = { style: 'off', hidden: false, hotkey: DEFAULT_OVERLAY_HOTKEY }
  let live: Cs2Live | null = null
  let end: Cs2Recap | null = null
  let now = Date.now()
  let scale = window.innerHeight / DESIGN_H
  let endTimer: ReturnType<typeof setTimeout> | undefined
  let tick: ReturnType<typeof setInterval> | undefined
  // Argent du début des achats (le conseil ne bouge pas pendant que tu achètes), et le dernier cran d'élim. du round.
  let buyRound = -1
  let buyMax: number | undefined
  let killRound = -1
  let killK = 0
  let killAt = 0
  let freshTimer: ReturnType<typeof setTimeout> | undefined
  let key3 = ''
  let html3 = ''
  // Réglage en plein écran : style et moment montrés (on en change sans quitter), place provisoire pendant un geste.
  let ed: { style: Cs2OverlayThree; moment: Cs2OverlayMoment } | null = null
  let edShow: Cs2OverlayPlace | null = null
  let stopEditor: (() => void) | null = null
  const edKey = (): string => `${ed!.style}.${ed!.moment}`

  const render = (): void => {
    // Pendant le réglage, le style et le moment sont ceux de la barre du haut.
    const c: Cs2OverlayConfig = ed ? { ...cfg, style: ed.style, edit: { ...ed } } : cfg
    const view = pickView(c, live, end, now)
    const style = c.style
    // Aperçu et réglage : l'overlay se montre sur Dust II en plein écran (overlay.css), pas sur le bureau.
    document.documentElement.classList.toggle('ov-prev', (cfg.previewAt !== undefined || !!ed) && !!view)
    document.documentElement.classList.toggle('ov-edit', !!ed)
    if (!view || !isThree(style)) {
      key3 = ''
      if (host.firstElementChild?.classList.contains('ov3')) host.replaceChildren()
    }
    if (!view) return patch(host, [])
    if (isThree(style)) {
      const t = Date.now()
      if (view.kind === 'buy') {
        if (view.live.round !== buyRound) {
          buyRound = view.live.round
          buyMax = view.live.money
        } else if (view.live.money !== undefined) buyMax = Math.max(buyMax ?? 0, view.live.money)
      }
      if (view.kind === 'pill') {
        const k = view.live.roundKills
        if (view.live.round !== killRound) {
          killRound = view.live.round
          killK = k
          killAt = k >= 3 ? t : 0
        } else if (k > killK) {
          killK = k
          killAt = t
        } else killK = k
      }
      // Réglage : le gros bandeau d'un triplé reste affiché, c'est le plus grand bloc du moment « en round ».
      const fresh = view.kind === 'pill' && view.live.roundKills >= 3 && (!!ed || t - killAt < FRESH_MS)
      clearTimeout(freshTimer)
      if (fresh && !ed) freshTimer = setTimeout(render, FRESH_MS - (t - killAt) + 20)
      const html =
        threeHtml(style, view, {
          budget: view.kind === 'buy' && buyRound === view.live.round ? buyMax : undefined,
          fresh,
          endLeft: view.kind === 'end' ? endSecondsLeft(c, view.recap, now) : 0
        }) +
        (cfg.previewAt !== undefined && !ed ? `<span class="ov-sample">Aperçu · chiffres d’exemple · ${escHtml(hotkeyText(cfg.hotkey))} pour masquer</span>` : '')
      const hk = window.innerHeight / DESIGN_H
      // Place choisie (part de l'écran) : convertie en pixels de la page, qui est mise à l'échelle par zoom. L'échelle du
      // bloc s'ajoute à la taille générale ; ses positions restent collées au HUD (--p compense le zoom).
      const [px, py, pk = 1] = (ed && edShow) || cfg.pos?.[`${style}.${view.kind}`] || [0, 0]
      const ok = Math.pow(hk, 0.8) * SIZE[cfg.size ?? 'n'] * pk
      const cls = `ov-root ov3 ${THREE[style]}`
      const css = `zoom: ${ok.toFixed(4)}; --p: ${(hk / ok).toFixed(4)}; --dx: ${((px * window.innerWidth) / ok).toFixed(1)}px; --dy: ${((py * window.innerHeight) / ok).toFixed(1)}px;`
      const key = threeKey(style, view)
      let root = host.firstElementChild as HTMLElement | null
      if (!root || key !== key3 || !root.classList.contains('ov3')) {
        root = document.createElement('div')
        root.setAttribute('aria-hidden', 'true')
        root.className = cls
        root.setAttribute('style', css)
        root.innerHTML = html
        host.replaceChildren(root)
      } else {
        if (root.getAttribute('style') !== css) root.setAttribute('style', css)
        if (html !== html3) {
          root.className = `${cls} ov3-still`
          root.innerHTML = html
        }
      }
      key3 = key
      html3 = html
      return
    }
    const card =
      view.kind === 'end'
        ? endCard(view.recap, style, endSecondsLeft(cfg, view.recap, now))
        : view.kind === 'buy'
          ? buy(view.live, style)
          : view.kind === 'pill'
            ? pill(view.live, style)
            : half(view.live, style)
    const root = h(
      'div',
      { class: `ov-root ov-${style}`, 'aria-hidden': 'true', style: `zoom: ${scale};` },
      card,
      cfg.previewAt !== undefined && h('span', { class: 'ov-sample' }, 'Aperçu · chiffres d’exemple · ', hotkeyText(cfg.hotkey), ' pour masquer')
    )
    patch(host, [root])
  }

  // Horloge : l'aperçu avance et le bilan se replie tout seul.
  const syncTick = (): void => {
    const ticking = cfg.previewAt !== undefined || !!end
    if (ticking && !tick)
      tick = setInterval(() => {
        now = Date.now()
        render()
      }, 250)
    else if (!ticking && tick) {
      clearInterval(tick)
      tick = undefined
    }
  }

  const setCfg = (c: Cs2OverlayConfig): void => {
    cfg = c
    syncEdit()
    syncTick()
    render()
  }

  // Réglage en plein écran : la barre et le cadre s'ouvrent avec lui, se ferment à sa fin (Terminé, Échap).
  const syncEdit = (): void => {
    if (cfg.edit && !stopEditor) {
      ed = { ...cfg.edit }
      edShow = null
      stopEditor = startEditor(
        {
          now: () => ({ style: ed!.style, moment: ed!.moment, place: cfg.pos?.[edKey()] ?? [0, 0] }),
          show: (p) => {
            edShow = p
            render()
          },
          keep: (p) => {
            edShow = null
            // Gardée tout de suite à l'écran ; le processus principal renvoie la place nettoyée (bornes, arrondis).
            const pos = { ...(cfg.pos ?? {}) }
            if (p) pos[edKey()] = p
            else delete pos[edKey()]
            cfg = { ...cfg, pos }
            render()
            void api.cs2OverlayPlace(edKey(), p).catch(() => {})
          },
          setStyle: (st) => {
            ed!.style = st
            edShow = null
            render()
            void api.cs2OverlayEditStyle(st).catch(() => {})
          },
          setMoment: (m) => {
            ed!.moment = m
            edShow = null
            render()
          },
          end: () => void api.cs2OverlayEditEnd().catch(() => {})
        },
        () => host.firstElementChild
      )
    } else if (!cfg.edit && stopEditor) {
      stopEditor()
      stopEditor = null
      ed = null
      edShow = null
    }
  }
  const setLive = (l: Cs2Live | null): void => {
    live = l
    render()
  }
  // Bilan replié : on l'oublie, l'horloge s'arrête.
  const setEnd = (r: Cs2Recap | null): void => {
    if (r === end) return
    end = r
    clearTimeout(endTimer)
    if (r) endTimer = setTimeout(() => setEnd(null), Math.max(0, END_MS - (Date.now() - r.endedAt)))
    syncTick()
    render()
  }

  render()
  // Peint une première fois (transparent) : la fenêtre peut s'afficher sans éclair de fond.
  requestAnimationFrame(() => requestAnimationFrame(() => void api.cs2OverlayReady().catch(() => {})))
  api.cs2OverlayConfig().then(setCfg).catch(() => {})
  api
    .cs2State()
    .then((st) => setLive(st.live))
    .catch(() => {})
  api.onCs2OverlayConfig(setCfg)
  api.onCs2Live(setLive)
  // Bilan de fin de match (affiché en jeu même quand la fenêtre de Player X est cachée).
  api.onCs2Recap(({ recap, reason }) => {
    if (reason !== 'open' && Date.now() - recap.endedAt < END_MS) setEnd(recap)
  })
  window.addEventListener('resize', () => {
    scale = window.innerHeight / DESIGN_H
    render()
  })
}

// ---------- pièces ----------
// Les textes mêlés de valeurs sont passés en morceaux ('Round ', 8, ' · temps d’achat') : un nœud de texte par morceau,
// comme la page React d'avant. Chromium mesure le texte nœud par nœud : en un seul bloc, les largeurs bougeaient d'un
// centième de pixel et tout ce qui suit se décalait.

function strip(rounds: Cs2Round[], style: Cs2OverlayStyle, upcoming = 0): HTMLElement {
  return h(
    'ol',
    { class: 'ov-strip' },
    ...rounds.map((r, i) => {
      const prev = rounds[i - 1]
      const swap = !!prev?.side && !!r.side && prev.side !== r.side
      const tone = !r.side ? 'is-unknown' : r.side === r.winner ? 'is-won' : 'is-lost'
      return h(
        'li',
        { key: `r${r.n}`, class: `ov-r ${tone}${swap ? ' is-swap' : ''}` },
        style === 'c' && tone === 'is-won' && glyph('M20 6L9 17l-5-5'),
        style === 'c' && tone === 'is-lost' && glyph('M18 6L6 18M6 6l12 12')
      )
    }),
    ...Array.from({ length: upcoming }, (_, i) => h('li', { key: `u${i}`, class: 'ov-r is-next' }))
  )
}

/** Le petit écu du logo (blason carmin), en tête des cartes du style Player X. Même dessin que LOGO_32 (v3ui/constants.js). */
function mark(): SVGElement {
  const bz = 'url(#ov-bz)'
  return s(
    'svg',
    { class: 'ov-mark', viewBox: '10 1 100 118', 'aria-hidden': 'true' },
    s(
      'defs',
      null,
      s('linearGradient', { id: 'ov-bz', x1: 0, y1: 1, x2: 0, y2: 0 }, s('stop', { offset: 0, 'stop-color': '#e8264f' }), s('stop', { offset: 1, 'stop-color': '#c4123a' }))
    ),
    s('path', { d: 'M60 7 L104 22 V58 C104 84 86 101 60 113 C34 101 16 84 16 58 V22 Z', fill: '#140709', stroke: bz, 'stroke-width': 6, 'stroke-linejoin': 'round' }),
    s('polyline', { points: '36,80 60,58 84,80', fill: 'none', stroke: bz, 'stroke-width': 11 }),
    s('polyline', { points: '40,56 60,38 80,56', fill: 'none', stroke: bz, 'stroke-width': 9, 'stroke-opacity': 0.7 }),
    s('polygon', { points: '60,22 64,30 60,34 56,30', fill: '#ffffff' })
  )
}

function glyph(d: string): SVGElement {
  return s(
    'svg',
    { width: 12, height: 12, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  )
}

function score(live: Cs2Live): HTMLElement | null {
  if (!live.score || !live.side) return null
  return h(
    'div',
    { class: 'ov-score' },
    h('span', { class: 'ov-score-side' }, h('span', { class: `ov-side is-${live.side.toLowerCase()}` }, 'Ton camp · ', live.side), h('b', null, live.score.us)),
    h('span', { class: 'ov-dash' }, '–'),
    h('span', { class: 'ov-score-side is-them' }, h('span', { class: `ov-side is-${other(live.side).toLowerCase()}` }, other(live.side)), h('b', null, live.score.them))
  )
}

function stats(items: [string, string][]): HTMLElement {
  return h(
    'dl',
    { class: 'ov-stats', style: `grid-template-columns: repeat(${items.length}, minmax(0, 1fr));` },
    ...items.map(([k, v]) => h('div', { key: k, class: 'ov-stat' }, h('dt', null, k), h('dd', null, v)))
  )
}

function buy(live: Cs2Live, style: Cs2OverlayStyle): HTMLElement {
  return h(
    'section',
    { key: `buy-${live.round}`, class: 'ov-card ov-buy ov-enter' },
    h('div', { class: 'ov-head ov-s1' }, style === 'c' && mark(), h('span', { class: 'ov-title' }, 'Round ', live.round, ' · temps d’achat'), h('span', { class: 'ov-sub' }, mapLabel(live.map))),
    h(
      'div',
      { class: 'ov-row ov-s2' },
      score(live),
      live.money !== undefined && h('span', { class: 'ov-money' }, h('span', { class: 'ov-k' }, 'Ton argent'), h('b', null, int.format(live.money), '\u00a0$'))
    ),
    live.rounds.length > 0 && h('div', { class: 'ov-s3' }, strip(live.rounds, style, 1)),
    h(
      'div',
      { class: 'ov-s4' },
      stats([
        ['K/D/A', kda(live)],
        ['ADR', live.adr === undefined ? '–' : String(live.adr)],
        ['HS', pctOf(live.hsPct)]
      ])
    )
  )
}

function pill(live: Cs2Live, style: Cs2OverlayStyle): HTMLElement {
  return h(
    'div',
    { key: 'pill', class: 'ov-card ov-pill ov-enter' },
    style === 'c' && mark(),
    h('b', { class: 'ov-pill-kda' }, kda(live)),
    h('span', { class: 'ov-pill-sep' }),
    h('span', null, 'ADR ', h('b', null, live.adr === undefined ? '–' : live.adr)),
    h('span', { class: live.roundKills ? 'ov-pill-hot' : null }, 'Ce round ', h('b', null, live.roundKills, '\u00a0élim.'))
  )
}

function half(live: Cs2Live, style: Cs2OverlayStyle): HTMLElement {
  // Pendant la mi-temps, CS2 peut déjà donner le camp de la suite : le camp joué est celui du dernier round,
  // et le score (compté pour le camp actuel) est retourné si le camp a déjà changé.
  const played = live.rounds.at(-1)?.side ?? live.side
  const flipped = !!played && !!live.side && played !== live.side
  const sc = live.score && flipped ? { us: live.score.them, them: live.score.us } : live.score
  const lead = !sc ? 'Mi-temps' : sc.us > sc.them ? 'Devant' : sc.us < sc.them ? 'Derrière' : 'À égalité'
  return h(
    'section',
    { key: 'half', class: 'ov-card ov-buy ov-enter' },
    h('div', { class: 'ov-head ov-s1' }, style === 'c' && mark(), h('span', { class: 'ov-title' }, 'Mi-temps · ', mapLabel(live.map))),
    h('div', { class: 'ov-lead ov-s2' }, h('b', null, lead), sc && h('span', null, sc.us, '–', sc.them)),
    played && h('p', { class: 'ov-line ov-s2' }, 'Tu passes ', h('b', null, other(played)), ' après la mi-temps.'),
    live.rounds.length > 0 && h('div', { class: 'ov-s3' }, strip(live.rounds, style)),
    h(
      'div',
      { class: 'ov-s4' },
      stats([
        ['K/D/A', kda(live)],
        ['K/D', formatKd(killDeath(live))],
        ['ADR', live.adr === undefined ? '–' : String(live.adr)],
        ['HS', pctOf(live.hsPct)]
      ])
    )
  )
}

function endCard(r: Cs2Recap, style: Cs2OverlayStyle, left: number): HTMLElement {
  const adr = r.hasRounds && r.roundsTracked > 0 ? int.format(r.damage / r.roundsTracked) : '–'
  const hs = r.trackedKills > 0 ? pctOf(Math.round((r.headshots / r.trackedKills) * 100)) : '–'
  const multi = [r.multi.k3 && `${r.multi.k3}\u00a0×\u00a03K`, r.multi.k4 && `${r.multi.k4}\u00a0×\u00a04K`, r.multi.k5 && `${r.multi.k5}\u00a0ace`].filter(Boolean).join(' · ')
  return h(
    'section',
    { key: `end-${r.id}`, class: 'ov-card ov-end ov-enter' },
    h(
      'div',
      { class: 'ov-end-top ov-s1' },
      style === 'c' && mark(),
      h('span', { class: 'ov-kicker' }, 'Bilan de match · ', modeLabel(r.mode), r.sample ? ' · exemple' : ''),
      h('span', { class: 'ov-sub' }, 'se replie dans ', left, '\u00a0s')
    ),
    h(
      'div',
      { class: 'ov-end-title ov-s1' },
      h('b', null, mapLabel(r.map)),
      h('b', { class: `ov-res is-${r.result}` }, RESULT_LABEL[r.result]),
      r.score && r.result !== 'left' && h('span', null, r.score.us, '–', r.score.them)
    ),
    h(
      'div',
      { class: 'ov-s2' },
      stats([
        ['K/D', formatKd(killDeath(r))],
        ['K/D/A', kda(r)],
        ['ADR', adr],
        ['HS', hs]
      ])
    ),
    r.rounds.length > 0 && h('div', { class: 'ov-s3' }, strip(r.rounds, style)),
    h(
      'p',
      { class: 'ov-line ov-s4' },
      r.best ? `Meilleur round : le ${r.best.n}e, ${r.best.kills}\u00a0élim.` : `${r.mvps}\u00a0MVP`,
      multi && ` · ${multi}`,
      r.best && ` · ${r.mvps}\u00a0MVP`
    )
  )
}
