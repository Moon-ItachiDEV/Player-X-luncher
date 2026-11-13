// Boutons caméléon : l'accueil prend le style et la couleur du jeu affiché.
// Rien n'est réglé jeu par jeu : on lit la jaquette (couleur dominante, lumière, contraste…) et les tags Steam du jeu.
// Module pur, sans DOM : testé sous Node seul (npm run test:home).

export type GameStyleKey = 'neon' | 'stade' | 'epique' | 'pop' | 'vitesse' | 'frisson' | 'tactique' | 'neutre'

/** Ce que la jaquette montre, chaque valeur entre 0 et 1 (sauf `hue`, en degrés). */
export interface CoverFeatures {
  /** Accent lisible sur le fond sombre de l'appli, tiré de la couleur vive dominante. */
  accent: string
  /** Teinte de la couleur vive dominante. */
  hue: number
  /** Saturation de cette couleur dominante. */
  hueSat: number
  light: number
  sat: number
  contrast: number
  /** Densité de bords (textures, traits). */
  edges: number
  /** Part de vert franc (pelouse, terrain). */
  green: number
  /** Part de tons chauds sombres (or, braise, cuir). */
  warm: number
  /** Poids de la couleur dominante parmi les couleurs vives : haut = une seule couleur domine. */
  focus: number
}

export interface GameStyle {
  style: GameStyleKey
  accent: string
  /** Texte posé sur l'accent : sombre sur un accent clair, blanc sinon. */
  onAccent: string
  scores: Record<Exclude<GameStyleKey, 'neutre'>, number>
}

type Scored = Exclude<GameStyleKey, 'neutre'>
const KEYS: Scored[] = ['neon', 'stade', 'epique', 'pop', 'vitesse', 'frisson', 'tactique']

/** Mots génériques des tags Steam (en anglais, comme l'API les donne), jamais des noms de jeux. */
const TAG_WORDS: Record<Scored, string[]> = {
  neon: ['cyberpunk', 'sci-fi', 'futuristic', 'space', 'robots', 'hacking', 'mechs', 'transhumanism', 'dystopian'],
  stade: ['sports', 'football (soccer)', 'soccer', 'football (american)', 'basketball', 'tennis', 'hockey', 'golf', 'baseball', 'skateboarding', 'boxing', 'wrestling'],
  epique: ['rpg', 'fantasy', 'dark fantasy', 'souls-like', 'medieval', 'mythology', 'action rpg', 'magic', 'dragons'],
  pop: ['anime', 'cute', 'colorful', 'cartoon', 'cartoony', 'jrpg', 'family friendly', 'platformer', '3d fighting', '2d fighting', 'fighting', 'arena fighter'],
  vitesse: ['racing', 'driving', 'automobile sim', 'motorbike', 'motocross', 'offroad'],
  frisson: ['horror', 'survival horror', 'psychological horror', 'zombies', 'gore', 'lovecraftian', 'thriller'],
  tactique: ['fps', 'shooter', 'tactical', 'military', 'war', 'competitive', 'pvp', 'hero shooter', 'battle royale', 'extraction shooter', 'realistic', 'strategy']
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const tri = (v: number, a: number, b: number, c: number): number => (v <= a || v >= c ? 0 : v < b ? (v - a) / (b - a) : (c - v) / (c - b))
const hueNear = (h: number, c: number, w: number): number => {
  const d = Math.min(Math.abs(h - c), 360 - Math.abs(h - c))
  return Math.max(0, 1 - d / w)
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

export function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** Luminance relative (WCAG) d'une couleur #rrggbb. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** Lit une petite image RGBA (60 × 90 suffit). */
export function coverFeatures(data: ArrayLike<number>, w: number, h: number): CoverFeatures {
  const n = w * h
  const bins = new Array<number>(24).fill(0)
  const binS = new Array<number>(24).fill(0)
  const binL = new Array<number>(24).fill(0)
  const ls = new Float32Array(n)
  let L = 0
  let L2 = 0
  let S = 0
  let green = 0
  let warm = 0
  let edge = 0
  for (let i = 0; i < n; i++) {
    const [hu, s, l] = rgbToHsl(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    ls[i] = l
    L += l
    L2 += l * l
    S += s
    if (hu > 75 && hu < 165 && s > 0.25 && l > 0.15) green++
    if (hu > 15 && hu < 55 && s > 0.2 && l < 0.55) warm++
    // Les couleurs vives et visibles pèsent : un fond gris ou noir ne vole pas l'accent
    const wt = s * s * (1 - Math.abs(l - 0.5) * 1.6)
    if (wt > 0) {
      const b = Math.floor(hu / 15) % 24
      bins[b] += wt
      binS[b] += s * wt
      binL[b] += l * wt
    }
  }
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x
    edge += Math.abs(ls[i] - ls[i + 1]) + Math.abs(ls[i] - ls[i + w])
  }
  L /= n || 1
  S /= n || 1
  let top = 0
  for (let b = 1; b < 24; b++) if (bins[b] > bins[top]) top = b
  const tot = bins.reduce((a, b) => a + b, 0)
  const has = bins[top] > 0
  const hue = has ? top * 15 + 7.5 : 340
  const hueSat = has ? binS[top] / bins[top] : 0
  const topL = has ? binL[top] / bins[top] : 0.55
  return {
    // Saturé, jamais trop sombre ni délavé : l'accent reste lisible sur le fond de l'accueil
    accent: has ? hslToHex(hue, Math.max(0.55, Math.min(0.95, hueSat + 0.1)), Math.max(0.52, Math.min(0.66, topL + 0.06))) : '#ff5c86',
    hue,
    hueSat,
    light: L,
    sat: S,
    contrast: Math.sqrt(Math.max(0, L2 / (n || 1) - L * L)),
    edges: (edge / ((n || 1) * 2)) * 4,
    green: green / (n || 1),
    warm: warm / (n || 1),
    focus: tot ? bins[top] / tot : 0
  }
}

export function imageScores(f: CoverFeatures): Record<Scored, number> {
  const vivid = Math.min(1, f.hueSat * 1.2)
  return {
    neon: clamp01(vivid * Math.max(hueNear(f.hue, 58, 25), hueNear(f.hue, 185, 30), hueNear(f.hue, 305, 30)) * (0.6 + f.contrast * 1.4) * (f.focus > 0.35 ? 1 : 0.7)),
    stade: clamp01(f.green * 2.6 * (f.light > 0.25 ? 1 : 0.5)),
    epique: clamp01(f.warm * 2.2 * (f.light < 0.42 ? 1 : 0.5) * (f.sat < 0.6 ? 1 : 0.6)),
    // Clair et coloré, ou beaucoup de couleurs vives différentes même sur fond sombre
    pop: clamp01(Math.max(tri(f.light, 0.4, 0.68, 0.95) * Math.min(1, f.sat * 1.6) * (1 - f.focus * 0.5), (f.sat - 0.3) * 2.2 * (1 - f.focus))),
    vitesse: clamp01(vivid * hueNear(f.hue, 5, 28) * (0.5 + f.edges * 2.2)),
    frisson: clamp01(tri(f.light, 0, 0.1, 0.26) * (1 - f.sat * 1.6) * 1.3),
    tactique: clamp01(tri(f.sat, 0, 0.16, 0.4) * tri(f.light, 0.12, 0.32, 0.55))
  }
}

/** Les premiers tags (les plus votés sur Steam) comptent plus que les suivants. */
export function tagScores(tags: readonly string[]): Record<Scored, number> {
  const t = tags.map((x) => x.toLowerCase().trim())
  const out = {} as Record<Scored, number>
  for (const k of KEYS) {
    let s = 0
    t.forEach((tag, i) => {
      if (TAG_WORDS[k].includes(tag)) s += i < 3 ? 0.6 : i < 8 ? 0.35 : 0.2
    })
    out[k] = Math.min(1, s)
  }
  return out
}

/** Sous ce score, aucun style ne ressort assez : le style neutre. */
export const MIN_SCORE = 0.22

/**
 * Le style du jeu. Sans tags, l'image seule décide ; sans image (jaquette illisible), les tags seuls.
 * Rien des deux : neutre, avec l'accent par défaut.
 */
export function decideStyle(f: CoverFeatures | null, tags: readonly string[] = []): GameStyle {
  const im = f ? imageScores(f) : null
  const tg = tags.length ? tagScores(tags) : null
  const scores = {} as Record<Scored, number>
  for (const k of KEYS) scores[k] = im && tg ? tg[k] * 0.62 + im[k] * 0.38 : (tg?.[k] ?? im?.[k] ?? 0)
  let style: GameStyleKey = 'neutre'
  let best = MIN_SCORE
  for (const k of KEYS) if (scores[k] > best) {
    style = k
    best = scores[k]
  }
  const accent = f?.accent ?? '#ff5c86'
  return { style, accent, onAccent: luminance(accent) > 0.36 ? '#120d10' : '#ffffff', scores }
}
