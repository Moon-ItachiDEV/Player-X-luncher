// Règles de la copie « pour Discord » (bêta 46), sans Electron ni fichier : testé par sharePlan.test.ts (npm run test:clips).
//
// Discord refuse un fichier plus lourd que la limite du compte : 20 Mo sans Nitro, 50 Mo avec Nitro Basic, 500 Mo avec Nitro
// (FAQ officielle, relue le 13 novembre 2026). Un clip par défaut pèse environ 63 Mo (25 s à 20 Mb/s) : « Copier pour Discord »
// fabrique donc, quand il le faut, une copie plus légère à côté. Le clip d'origine n'est jamais touché.
//
// La règle : le poids visé donne un débit (limite moins 6 % de marge, divisée par la durée). Ce débit choisit la taille de
// l'image : la plus grande que ce débit montre encore proprement, d'abord à la cadence du clip, puis à 30 images/s. Un clip
// trop long pour tenir, même en petit, est refusé avec la durée maximale. Le poids obtenu est contrôlé après coup (clipsShare.ts).
import type { ClipDiscord } from '@shared/types'
import { pixelFormat } from './editCompile'

/** La limite d'envoi de chaque compte Discord, en Mo. */
export const DISCORD_MB: Record<ClipDiscord, number> = { free: 20, basic: 50, nitro: 500 }
/** En octets, au sens strict : un Mo compte un million d'octets (si Discord compte en Mio, la copie passe aussi). */
export const limitBytes = (d: ClipDiscord): number => DISCORD_MB[d] * 1_000_000
/** Marge sous la limite : un encodeur ne tombe jamais pile sur le débit demandé. */
export const SHARE_MARGIN = 0.06

/** Ce qu'il faut savoir du fichier à copier. */
export interface ShareSource {
  sizeBytes: number
  durationS: number
  width: number
  height: number
  /** Images par seconde réelles du fichier (images ÷ durée). */
  fps: number
  hasAudio: boolean
}

export interface ShareEncode {
  kind: 'encode'
  width: number
  height: number
  fps: number
  videoBps: number
  /** 0 : le clip n'a pas de son. */
  audioBps: number
}

/**
 * - original : le fichier passe déjà sous la limite, il se copie tel quel ;
 * - encode : une copie plus légère est à fabriquer ;
 * - too-long : même en petit, ce clip dépasse la limite (`maxS` : la durée la plus longue qui tient).
 */
export type SharePlan = { kind: 'original' } | ShareEncode | { kind: 'too-long'; maxS: number }

/** Les tailles d'image, de la plus grande à la plus petite (largeur × hauteur d'une image en 16:9). */
const BOXES: ReadonlyArray<readonly [number, number]> = [
  [2560, 1440],
  [1920, 1080],
  [1280, 720],
  [854, 480]
]

/**
 * Le débit sous lequel une image de jeu se dégrade trop, à 60 images/s, selon son nombre de points : 2,2 Mb/s en 480p,
 * 4,5 en 720p, 9 en 1080p, 16 en 1440p. Entre deux repères, en proportion. Ces seuils se règlent ici.
 */
const NEED: ReadonlyArray<readonly [number, number]> = [
  [854 * 480, 2_200_000],
  [1280 * 720, 4_500_000],
  [1920 * 1080, 9_000_000],
  [2560 * 1440, 16_000_000]
]
/** À 30 images/s, il faut un peu plus de la moitié du débit de 60. */
const HALF_RATE = 0.55
const AUDIO_BPS = 128_000
const AUDIO_SMALL_BPS = 96_000

const even = (x: number): number => Math.max(2, Math.round(x / 2) * 2)

/** L'image dans une boîte : même rapport, nombres pairs, pas d'agrandissement (à un point près). La boîte se tourne pour une image en hauteur. */
export function fitSize(width: number, height: number, boxW: number, boxH: number): { width: number; height: number } {
  const [bw, bh] = height > width ? [boxH, boxW] : [boxW, boxH]
  const f = Math.min(1, bw / width, bh / height)
  return { width: even(width * f), height: even(height * f) }
}

/** Le débit minimal de l'image pour cette taille et cette cadence (60 ou 30 images/s). */
export function needBps(width: number, height: number, fps: number): number {
  const px = width * height
  let bps: number
  if (px <= NEED[0][0]) bps = (NEED[0][1] * px) / NEED[0][0]
  else {
    // Au-delà du dernier repère (écran 4K, écran très large), la dernière pente continue.
    const at = NEED.findIndex(([p]) => px <= p)
    const i = at < 0 ? NEED.length - 1 : at
    const [p0, b0] = NEED[i - 1]
    const [p1, b1] = NEED[i]
    bps = b0 + ((px - p0) * (b1 - b0)) / (p1 - p0)
  }
  return Math.round((bps * (fps > 30 ? 1 : HALF_RATE)) / 1000) * 1000
}

interface Candidate {
  width: number
  height: number
  fps: number
  audioBps: number
}

/** Les copies possibles, de la meilleure à la plus légère : d'abord à la cadence du clip (jusqu'en 720p), puis à 30 images/s. */
function candidates(src: ShareSource): Candidate[] {
  // Un clip filmé à plus de 40 images/s est un clip à 60 (la capture en perd toujours quelques-unes).
  const top = src.fps > 40 ? 60 : 30
  const fit = (b: readonly [number, number]): { width: number; height: number } => fitSize(src.width, src.height, b[0], b[1])
  const list: Candidate[] = [
    { width: even(src.width), height: even(src.height), fps: top, audioBps: AUDIO_BPS },
    ...BOXES.slice(0, 3).map((b) => ({ ...fit(b), fps: top, audioBps: AUDIO_BPS })),
    { ...fit(BOXES[2]), fps: 30, audioBps: AUDIO_BPS },
    { ...fit(BOXES[3]), fps: 30, audioBps: AUDIO_SMALL_BPS }
  ]
  // Un petit clip (sous 854 × 480) garde sa taille jusqu'au bout : seul le son s'allège au dernier essai.
  const seen = new Set<string>()
  return list.filter((c) => {
    const key = `${c.width}x${c.height}@${c.fps}/${c.audioBps}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const valid = (src: ShareSource): boolean =>
  [src.sizeBytes, src.durationS, src.width, src.height, src.fps].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0) && src.width <= 16384 && src.height <= 16384

/** Que faire de ce fichier pour qu'il passe sous `limit` octets. */
export function sharePlan(src: ShareSource, limit: number): SharePlan {
  if (!(limit > 0)) throw new Error('Limite refusée.')
  if (typeof src.sizeBytes === 'number' && src.sizeBytes > 0 && src.sizeBytes <= limit) return { kind: 'original' }
  if (!valid(src)) throw new Error('Clip illisible.')
  // Les bits disponibles par seconde, tout compris (image et son). Un clip de moins d'une seconde compte pour une seconde.
  const bits = limit * (1 - SHARE_MARGIN) * 8
  const budget = bits / Math.max(1, src.durationS)
  const list = candidates(src)
  for (const c of list) {
    const audioBps = src.hasAudio ? c.audioBps : 0
    const need = needBps(c.width, c.height, c.fps)
    const videoBps = Math.floor((budget - audioBps) / 1000) * 1000
    // Au-delà du double du débit minimal, les bits en plus ne se voient pas : la copie sera simplement plus légère.
    if (videoBps >= need) return { kind: 'encode', width: c.width, height: c.height, fps: c.fps, videoBps: Math.min(videoBps, need * 2), audioBps }
  }
  const last = list[list.length - 1]
  const floor = needBps(last.width, last.height, last.fps) + (src.hasAudio ? last.audioBps : 0)
  return { kind: 'too-long', maxS: Math.floor(bits / floor) }
}

/**
 * Le second essai, quand la copie fabriquée dépasse quand même la limite : même image, débit plus bas d'au moins 10 %, et de
 * ce qu'il faut pour viser 3 % sous la limite d'après le poids obtenu.
 */
export function shareRetry(plan: ShareEncode, gotBytes: number, limit: number): ShareEncode {
  const factor = Math.min(0.9, (limit * 0.97) / Math.max(1, gotBytes))
  const total = (plan.videoBps + plan.audioBps) * factor
  return { ...plan, videoBps: Math.max(100_000, Math.floor((total - plan.audioBps) / 1000) * 1000) }
}

/** Un nom d'encodeur de ffmpeg : rien d'autre ne passe dans la ligne de commande. */
const ENCODER_NAME = /^[a-z0-9_]{3,24}$/
const HEAD = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y']

/**
 * La commande du moteur vidéo pour une copie : le clip relu, l'image mise à la cadence et à la taille voulues, encodée au
 * débit calculé (plafonné : `-maxrate`), le son en AAC. L'index du fichier est au début (lecture immédiate dans Discord).
 * Comme pour les films : arguments séparés, chemins derrière « -i » et en sortie seulement, avec « file: » ; jamais scale_d3d11.
 */
export function shareArgs(srcFile: string, plan: ShareEncode, encoder: string, outFile: string): string[] {
  if (!ENCODER_NAME.test(encoder)) throw new Error('Encodeur inconnu.')
  const { width: w, height: h, fps, videoBps, audioBps } = plan
  const whole = [w, h, fps, videoBps, audioBps].every((n) => Number.isInteger(n) && n >= 0)
  if (!whole || w < 2 || h < 2 || w % 2 || h % 2 || w > 7680 || h > 7680 || fps < 1 || fps > 120 || videoBps < 50_000 || (audioBps > 0 && audioBps < 32_000)) throw new Error('Copie refusée.')
  const audio = audioBps > 0
  return [
    ...HEAD,
    '-protocol_whitelist', 'file', '-i', `file:${srcFile}`,
    '-map', '0:v:0', ...(audio ? ['-map', '0:a:0'] : []),
    '-vf', `fps=${fps},scale=${w}:${h},setsar=1,format=${pixelFormat(encoder)}`,
    '-c:v', encoder, '-b:v', String(videoBps), '-maxrate', String(videoBps), '-bufsize', String(videoBps * 2), '-g', String(fps * 2), '-bf', '0',
    ...(audio ? ['-c:a', 'aac', '-b:a', String(audioBps), '-ar', '48000', '-ac', '2'] : ['-an']),
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats',
    '-f', 'mp4', `file:${outFile}`
  ]
}

/** Le moteur a une demi-minute pour démarrer, puis dix secondes par seconde de clip : au-delà, il est coupé. */
export const shareTimeoutMs = (durationS: number): number => 30_000 + Math.max(1, durationS) * 10_000

/** De 0 à 99 pendant la fabrication : 100 n'est annoncé que quand la copie est dans le presse-papiers. */
export function sharePercent(doneS: number, durationS: number): number {
  return durationS > 0 ? Math.min(99, Math.max(0, Math.floor((doneS / durationS) * 100))) : 0
}

/** Les encodeurs à essayer : celui qui a fabriqué la dernière copie d'abord, puis l'ordre des films. */
export function shareEncoders(order: readonly string[], last: unknown): string[] {
  const first = typeof last === 'string' && order.includes(last) ? [last] : []
  return [...new Set([...first, ...order])]
}
