// Réglage de l'overlay en plein écran (0.6.2) : lancé depuis Paramètres › Overlay › Position. La fenêtre de l'overlay
// montre Dust II et le vrai bloc du style choisi ; on le glisse, on change sa taille (coins, molette, + et −), on passe
// d'un style ou d'un moment à l'autre sans quitter, et Échap ou « Terminé » ferme tout de suite.
// Ce module ne fait que l'interface : overlay.ts dessine le bloc, le processus principal enregistre (cs2:overlay-place).
import type { Cs2OverlayMoment, Cs2OverlayPlace, Cs2OverlayThree } from '@shared/types'

export const ED_STYLES: [Cs2OverlayThree, string][] = [
  ['etendard', 'Étendard'],
  ['viseur', 'Viseur'],
  ['regie', 'Régie']
]
export const ED_MOMENTS: [Cs2OverlayMoment, string][] = [
  ['buy', 'Achat'],
  ['pill', 'En round'],
  ['half', 'Mi-temps'],
  ['end', 'Bilan']
]
/** Bornes de l'échelle d'un bloc (les mêmes que settingsRules.ts). */
const K_MIN = 0.5
const K_MAX = 1.6

export interface EditorHost {
  /** Style, moment et place du bloc montré. */
  now(): { style: Cs2OverlayThree; moment: Cs2OverlayMoment; place: Cs2OverlayPlace }
  /** Place provisoire pendant un geste (le bloc suit la souris), sans l'enregistrer. */
  show(place: Cs2OverlayPlace): void
  /** Place à garder ; null : la place d'origine. */
  keep(place: Cs2OverlayPlace | null): void
  setStyle(style: Cs2OverlayThree): void
  setMoment(moment: Cs2OverlayMoment): void
  end(): void
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000
const clampK = (k: number): number => Math.round(Math.min(K_MAX, Math.max(K_MIN, k)) * 100) / 100

/** Le rectangle du bloc dessiné : tout ce qui bouge avec lui (pas le voile ni l'éclair plein écran). */
function blockRect(root: Element | null): DOMRect | null {
  if (!root) return null
  let l = Infinity
  let t = Infinity
  let r = -Infinity
  let b = -Infinity
  for (const el of Array.from(root.children)) {
    if (el.matches('.vig, .flashw, .ov-sample')) continue
    for (const n of [el, ...Array.from(el.querySelectorAll('*'))]) {
      const q = n.getBoundingClientRect()
      if (q.width < 1 || q.height < 1) continue
      l = Math.min(l, q.left)
      t = Math.min(t, q.top)
      r = Math.max(r, q.right)
      b = Math.max(b, q.bottom)
    }
  }
  return l === Infinity ? null : new DOMRect(l, t, r - l, b - t)
}

export function startEditor(host: EditorHost, rootOf: () => Element | null): () => void {
  const bar = document.createElement('div')
  bar.className = 'ed-bar'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Place de l’overlay')
  const frame = document.createElement('div')
  frame.className = 'ed-frame'
  frame.tabIndex = 0
  frame.setAttribute('role', 'slider')
  frame.innerHTML = '<span class="ed-tag"></span><i data-c="nw"></i><i data-c="ne"></i><i data-c="sw"></i><i data-c="se"></i>'
  document.body.append(frame, bar)

  const seg = (name: string, items: [string, string][], cur: string): string =>
    `<div class="ed-seg" role="radiogroup" aria-label="${name}">${items
      .map(([k, l]) => `<button type="button" role="radio" data-${name === 'Style' ? 's' : 'm'}="${k}" aria-checked="${k === cur}">${l}</button>`)
      .join('')}</div>`

  let barKey = ''
  const paintBar = (): void => {
    const { style, moment, place } = host.now()
    const k = place[2] ?? 1
    const moved = place[0] !== 0 || place[1] !== 0 || k !== 1
    const key = `${style}|${moment}|${k}|${moved}`
    if (key === barKey) return
    barKey = key
    bar.innerHTML = `<div class="ed-row">
      <b class="ed-t">Place de l’overlay</b>
      ${seg('Style', ED_STYLES, style)}
      ${seg('Moment', ED_MOMENTS, moment)}
      <div class="ed-size" aria-label="Taille du bloc"><button type="button" data-k="-" aria-label="Plus petit">−</button><span>${Math.round(k * 100)} %</span><button type="button" data-k="+" aria-label="Plus grand">+</button></div>
      <button type="button" class="ed-btn" data-reset ${moved ? '' : 'disabled'}>Par défaut</button>
      <button type="button" class="ed-btn ed-done" data-done>Terminé</button>
    </div>
    <p class="ed-hint">Glisse le bloc · coins ou molette : taille · flèches : au pixel près · 1 à 4 : moment · Échap : fermer</p>`
  }

  // Geste en cours : déplacement ou taille, depuis la place du début.
  let gesture: { kind: 'move' | 'size'; x: number; y: number; from: Cs2OverlayPlace; rect: DOMRect; d0: number } | null = null
  let pending: Cs2OverlayPlace | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const W = (): number => window.innerWidth
  const H = (): number => window.innerHeight
  /** Garde le bloc dans l'écran : décalage borné d'après son rectangle au début du geste. */
  const fit = (from: Cs2OverlayPlace, rect: DOMRect, x: number, y: number): [number, number] => {
    const dx = Math.min(W() - rect.right, Math.max(-rect.left, (x - from[0]) * W()))
    const dy = Math.min(H() - rect.bottom, Math.max(-rect.top, (y - from[1]) * H()))
    return [r3(from[0] + dx / W()), r3(from[1] + dy / H())]
  }
  const showP = (p: Cs2OverlayPlace): void => {
    pending = p
    host.show(p)
  }
  const keepSoon = (p: Cs2OverlayPlace): void => {
    showP(p)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      host.keep(p)
      pending = null
    }, 300)
  }
  const cur = (): Cs2OverlayPlace => pending ?? host.now().place
  const scaleBy = (f: number): void => {
    const p = cur()
    keepSoon([p[0], p[1], clampK((p[2] ?? 1) * f)])
  }

  frame.addEventListener('pointerdown', (e) => {
    const rect = blockRect(rootOf())
    if (!rect) return
    e.preventDefault()
    frame.focus()
    frame.setPointerCapture(e.pointerId)
    const corner = (e.target as HTMLElement).dataset.c
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    gesture = { kind: corner ? 'size' : 'move', x: e.clientX, y: e.clientY, from: cur(), rect, d0: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)) }
    frame.classList.add(corner ? 'sizing' : 'moving')
  })
  frame.addEventListener('pointermove', (e) => {
    if (!gesture) return
    const g = gesture
    if (g.kind === 'move') {
      const [x, y] = fit(g.from, g.rect, g.from[0] + (e.clientX - g.x) / W(), g.from[1] + (e.clientY - g.y) / H())
      showP([x, y, g.from[2] ?? 1])
    } else {
      const cx = g.rect.left + g.rect.width / 2
      const cy = g.rect.top + g.rect.height / 2
      showP([g.from[0], g.from[1], clampK((g.from[2] ?? 1) * (Math.hypot(e.clientX - cx, e.clientY - cy) / g.d0))])
    }
  })
  const up = (): void => {
    if (!gesture) return
    gesture = null
    frame.classList.remove('moving', 'sizing')
    if (pending) {
      host.keep(pending)
      pending = null
    }
  }
  frame.addEventListener('pointerup', up)
  frame.addEventListener('pointercancel', up)
  window.addEventListener('wheel', onWheel, { passive: false })
  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    scaleBy(e.deltaY < 0 ? 1.05 : 1 / 1.05)
  }

  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (!b || b.disabled) return
    if (b.dataset.s) host.setStyle(b.dataset.s as Cs2OverlayThree)
    else if (b.dataset.m) host.setMoment(b.dataset.m as Cs2OverlayMoment)
    else if (b.dataset.k) scaleBy(b.dataset.k === '+' ? 1.05 : 1 / 1.05)
    else if (b.hasAttribute('data-reset')) {
      clearTimeout(saveTimer)
      pending = null
      host.keep(null)
    } else if (b.hasAttribute('data-done')) host.end()
  })

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || (e.key === 'Enter' && document.activeElement === frame)) {
      e.preventDefault()
      host.end()
      return
    }
    const n = Number(e.key)
    if (n >= 1 && n <= 4 && !e.ctrlKey && !e.altKey) {
      host.setMoment(ED_MOMENTS[n - 1][0])
      return
    }
    if (e.key === '+' || e.key === '=') return scaleBy(1.05)
    if (e.key === '-' || e.key === '_') return scaleBy(1 / 1.05)
    const st = e.shiftKey ? 0.02 : 0.002
    const m = ({ ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] } as Record<string, number[]>)[e.key]
    if (!m) return
    e.preventDefault()
    const rect = blockRect(rootOf())
    if (!rect) return
    const p = cur()
    const [x, y] = fit(p, rect, p[0] + m[0], p[1] + m[1])
    keepSoon([x, y, p[2] ?? 1])
  }
  window.addEventListener('keydown', onKey)

  // Le cadre suit le bloc (il se déroule, change de taille) ; la barre passe en bas si le bloc monte sous elle.
  let raf = 0
  const loop = (): void => {
    paintBar()
    const rect = blockRect(rootOf())
    frame.hidden = !rect
    if (rect) {
      Object.assign(frame.style, { left: `${rect.left - 6}px`, top: `${rect.top - 6}px`, width: `${rect.width + 12}px`, height: `${rect.height + 12}px` })
      const { moment, place } = host.now()
      const p = pending ?? place
      const tag = `${ED_MOMENTS.find(([k]) => k === moment)?.[1] ?? ''} · ${Math.round((p[2] ?? 1) * 100)} %`
      const t = frame.firstElementChild as HTMLElement
      if (t.textContent !== tag) t.textContent = tag
      frame.setAttribute('aria-label', `Bloc ${tag}`)
      const bh = bar.offsetHeight + 40
      const topFree = rect.top > bh
      const lowFree = rect.bottom < H() - bh
      const low = bar.classList.contains('low')
      if (!low && !topFree && lowFree) bar.classList.add('low')
      else if (low && !lowFree && topFree) bar.classList.remove('low')
    }
    raf = requestAnimationFrame(loop)
  }
  loop()
  frame.focus()

  return () => {
    cancelAnimationFrame(raf)
    clearTimeout(saveTimer)
    if (pending) host.keep(pending)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('wheel', onWheel)
    frame.remove()
    bar.remove()
  }
}
