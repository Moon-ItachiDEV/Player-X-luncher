// La géométrie d'un film, sans Electron ni fichier : partagée par l'éditeur (v3ui/src/edit.js, via window.Shared) et par la
// fabrication (main). Testé par editShots.test.ts.
//
// Un plan est ancré sur un instant de son clip (le kill, ou l'appui pour un clip gardé à la main). Il garde `lead` pas avant
// cet instant et `tail` pas après. Le pas vaut un temps de la musique quand le film en a une (0,5 s sinon). Avec un ralenti,
// un morceau de `2 × half` secondes autour de l'instant passe à vitesse 0,5 : il dure alors un pas de plus que sa longueur
// dans le clip × 2, soit exactement 2 pas avec la musique. Toutes les coupes tombent donc sur un temps, et chaque kill aussi.

/** Le pas sans musique, en secondes. */
export const PLAIN_UNIT = 0.5
/** Vitesse d'un ralenti. */
export const SLOW_SPEED = 0.5
/** Bornes d'un plan, en pas. */
export const LIMITS = { leadMin: 0, leadMax: 32, tailMin: 0, tailMax: 32 } as const
/** Un film : 48 plans et 10 minutes au plus. */
export const FILM_LIMITS = { shots: 48, seconds: 600 } as const
/** Le moteur ne fait pas de morceau plus court. */
export const MIN_PART_S = 0.05

export interface ShotSpec {
  clipId: string
  /** L'instant d'ancrage, en secondes dans le fichier du clip. */
  anchorS: number
  lead: number
  tail: number
  slow: boolean
}

/** Un morceau à fabriquer : de `fromS` à `toS` dans le clip, à cette vitesse. */
export interface ShotPart {
  fromS: number
  toS: number
  speed: number
}

/** Le pas du film : un temps de la musique (bpm), sinon 0,5 s. */
export function unitOf(bpm: number | null | undefined): number {
  return typeof bpm === 'number' && Number.isFinite(bpm) && bpm >= 40 && bpm <= 250 ? 60 / bpm : PLAIN_UNIT
}

/** Demi-longueur, dans le clip, du morceau ralenti : il dure alors 2 pas dans le film. */
export function slowHalf(unit: number): number {
  return unit / 2
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000

/**
 * Le plan, ramené à ce que son clip contient : on retire des pas avant ou après plutôt que de couper un pas en deux (les coupes
 * restent sur les temps). Un ralenti qui ne tient pas dans le clip est retiré.
 */
export function fitShot(s: ShotSpec, clipDurationS: number, unit: number): ShotSpec {
  const d = clipDurationS
  const k = Math.min(Math.max(0, s.anchorS), d)
  const lim = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : 0)))
  let lead = lim(s.lead, LIMITS.leadMin, LIMITS.leadMax)
  let tail = lim(s.tail, LIMITS.tailMin, LIMITS.tailMax)
  const h = slowHalf(unit)
  const slow = !!s.slow && k - h >= 0 && k + h <= d
  const pad = slow ? h : 0
  while (lead > 0 && k - pad - lead * unit < -1e-6) lead--
  while (tail > 0 && k + pad + tail * unit > d + 1e-6) tail--
  // Un plan sans rien : on garde au moins un pas, d'un côté ou de l'autre.
  if (!slow && lead === 0 && tail === 0) {
    if (k - unit >= -1e-6) lead = 1
    else if (k + unit <= d + 1e-6) tail = 1
  }
  return { clipId: s.clipId, anchorS: r4(k), lead, tail, slow }
}

/** Les morceaux d'un plan, dans l'ordre du film. */
export function shotParts(s: ShotSpec, unit: number): ShotPart[] {
  const k = s.anchorS
  const h = slowHalf(unit)
  const parts: ShotPart[] = []
  if (s.slow) {
    if (s.lead > 0) parts.push({ fromS: r4(k - h - s.lead * unit), toS: r4(k - h), speed: 1 })
    parts.push({ fromS: r4(k - h), toS: r4(k + h), speed: SLOW_SPEED })
    if (s.tail > 0) parts.push({ fromS: r4(k + h), toS: r4(k + h + s.tail * unit), speed: 1 })
  } else {
    // Sans ralenti, avant et après ne font qu'un morceau.
    parts.push({ fromS: r4(k - s.lead * unit), toS: r4(k + s.tail * unit), speed: 1 })
  }
  return parts.filter((p) => p.toS - p.fromS >= MIN_PART_S / 4)
}

/** Durée d'un plan dans le film, en secondes. */
export function shotLength(s: ShotSpec, unit: number): number {
  return (s.lead + s.tail) * unit + (s.slow ? (2 * slowHalf(unit)) / SLOW_SPEED : 0)
}

/** Où tombe l'instant d'ancrage dans le plan (secondes depuis son début). */
export function anchorOffset(s: ShotSpec, unit: number): number {
  return s.lead * unit + (s.slow ? slowHalf(unit) / SLOW_SPEED : 0)
}

/** Le film en pas : le début de chaque plan, l'instant de son kill, et la durée totale (secondes). */
export function timeline(shots: readonly ShotSpec[], unit: number): { starts: number[]; anchors: number[]; totalS: number } {
  const starts: number[] = []
  const anchors: number[] = []
  let t = 0
  for (const s of shots) {
    starts.push(r4(t))
    anchors.push(r4(t + anchorOffset(s, unit)))
    t += shotLength(s, unit)
  }
  return { starts, anchors, totalS: r4(t) }
}

/** Le premier temps de la grille à partir de `fromS` (début de la musique dans le film). */
export function snapToGrid(grid: readonly number[], fromS: number): number {
  for (const t of grid) if (t >= fromS - 1e-6) return t
  return grid.length ? grid[grid.length - 1] : 0
}

/** Déplace un élément d'une liste (pour l'ordre des plans). Rend une nouvelle liste. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list]
  if (from < 0 || from >= out.length) return out
  const [x] = out.splice(from, 1)
  out.splice(Math.min(Math.max(0, to), out.length), 0, x)
  return out
}
