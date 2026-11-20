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

/** Les tempos que le montage accepte (en temps par minute) : hors de ces bornes, le pas retombe sur 0,5 s. */
export const BPM_MIN = 40
export const BPM_MAX = 250

/** Un tempo que unitOf prend au sérieux. */
export const bpmUsable = (bpm: number | null | undefined): bpm is number => typeof bpm === 'number' && Number.isFinite(bpm) && bpm >= BPM_MIN && bpm <= BPM_MAX

/** Le pas du film : un temps de la musique (bpm), sinon 0,5 s. */
export function unitOf(bpm: number | null | undefined): number {
  return bpmUsable(bpm) ? 60 / bpm : PLAIN_UNIT
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
  let k = Math.min(Math.max(0, s.anchorS), d)
  const lim = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : 0)))
  let lead = lim(s.lead, LIMITS.leadMin, LIMITS.leadMax)
  let tail = lim(s.tail, LIMITS.tailMin, LIMITS.tailMax)
  const h = slowHalf(unit)
  const slow = !!s.slow && k - h >= 0 && k + h <= d
  const pad = slow ? h : 0
  while (lead > 0 && k - pad - lead * unit < -1e-6) lead--
  while (tail > 0 && k + pad + tail * unit > d + 1e-6) tail--
  // Un plan sans rien : on garde au moins un pas, d'un côté ou de l'autre (si le clip contient un pas mais que le kill est
  // près du milieu d'un clip court, on décale l'ancre juste ce qu'il faut plutôt que de rendre un plan de durée nulle).
  if (!slow && lead === 0 && tail === 0) {
    if (k - unit >= -1e-6) lead = 1
    else if (k + unit <= d + 1e-6) tail = 1
    else if (d >= unit - 1e-6) {
      if (unit - k <= k - (d - unit)) {
        k = Math.min(d, unit)
        lead = 1
      } else {
        k = Math.max(0, d - unit)
        tail = 1
      }
    }
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

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/**
 * Le pas des durées, en images : un plan compte un multiple de ce pas, pour que sa durée tombe juste à la fois en images, en
 * échantillons de son et en microsecondes (3 images à 60 images/s : 50 ms). Les morceaux se suivent alors sans aucun arrondi.
 */
export function frameStep(fps: number): number {
  return fps / gcd(fps, 20)
}

/** Un morceau à fabriquer, avec son nombre d'images pris sur la ligne de temps du film. */
export interface FilmPiece {
  clipId: string
  inS: number
  outS: number
  speed: number
  frames: number
}

/**
 * Les morceaux d'un projet, avec leurs images : chaque fin de morceau est arrondie au pas des images sur la ligne de temps du
 * film entier (pas morceau par morceau). L'écart avec les temps de la musique reste sous un demi-pas (25 ms à 60 images/s)
 * et ne s'additionne jamais. Un morceau qui ne garderait aucun pas est laissé de côté.
 * L'aperçu de l'éditeur utilise la même liste que la fabrication : les coupes tombent aux mêmes endroits.
 */
export function filmPieces(shots: readonly ShotSpec[], unit: number, fps: number): FilmPiece[] {
  const step = frameStep(fps)
  const out: FilmPiece[] = []
  let t = 0
  let doneFrames = 0
  for (const s of shots) {
    for (const p of shotParts(s, unit)) {
      t += (p.toS - p.fromS) / p.speed
      const end = Math.round((t * fps) / step) * step
      const frames = end - doneFrames
      if (frames < step) continue
      doneFrames = end
      out.push({ clipId: s.clipId, inS: p.fromS, outS: p.toS, speed: p.speed, frames })
    }
  }
  return out
}

// ---------- corriger le tempo d'une musique ----------
// Le détecteur de temps trouve parfois le double ou la moitié du vrai tempo, ou tombe entre deux temps. Trois corrections, sur la
// grille (les temps, en secondes depuis le début du morceau). La correction se garde avec la grille d'origine : on ne recalcule
// jamais « à l'aveugle » depuis la grille déjà corrigée (tempoApply part toujours de la grille d'origine).

/** Tempo de la musique : ÷2, tel quel, ×2. */
export type TempoFactor = 0.5 | 1 | 2

/** Ajoute le milieu entre deux temps (le dernier temps reçoit un demi-temps après lui). */
export function tempoDouble(grid: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < grid.length; i++) {
    out.push(grid[i])
    const gap = i + 1 < grid.length ? grid[i + 1] - grid[i] : i > 0 ? grid[i] - grid[i - 1] : 0
    if (gap > 0) out.push(r4(grid[i] + gap / 2))
  }
  return out
}

/** Garde un temps sur deux (le premier, le troisième, etc.). */
export function tempoHalf(grid: readonly number[]): number[] {
  return grid.filter((_, i) => i % 2 === 0)
}

/** Avance chaque temps d'un demi-intervalle local (jusqu'au milieu de l'intervalle qui le suit). */
export function tempoShiftHalf(grid: readonly number[]): number[] {
  return grid.map((t, i) => {
    const gap = i + 1 < grid.length ? grid[i + 1] - t : i > 0 ? t - grid[i - 1] : 0
    return r4(t + gap / 2)
  })
}

/** Le tempo que donne ce facteur : null s'il sort des bornes du montage (alors on ne le propose pas). */
export function tempoBpm(bpm0: number | null | undefined, factor: TempoFactor): number | null {
  if (!bpmUsable(bpm0)) return null
  const bpm = Math.round(bpm0 * factor * 100) / 100
  return bpmUsable(bpm) ? bpm : null
}

/** La grille et le tempo d'une correction, calculés depuis la grille et le tempo d'origine. null : tempo hors bornes. */
export function tempoApply(grid0: readonly number[], bpm0: number | null, factor: TempoFactor, half: boolean): { grid: number[]; bpm: number } | null {
  const bpm = tempoBpm(bpm0, factor)
  if (bpm === null) return null
  let grid = factor === 2 ? tempoDouble(grid0) : factor === 0.5 ? tempoHalf(grid0) : [...grid0]
  if (half) grid = tempoShiftHalf(grid)
  return { grid, bpm }
}
