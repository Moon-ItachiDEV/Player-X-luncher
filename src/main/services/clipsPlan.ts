// Calculs des clips (fenêtres, fusion, choix des fragments, rétention, réglages, noms de fichiers) : module pur, sans
// Electron ni disque, testé par `npm run test:clips`. clips.ts fait les fenêtres, les fichiers et l'IPC.
import { isValidHotkey } from '@shared/hotkey'
import type { ClipEvent, ClipKind, ClipQuality, ClipSettings } from '@shared/types'

// ---------- réglages ----------

export const DEFAULT_HOTKEY = 'Alt+C'

export const DEFAULT_CLIP_SETTINGS: ClipSettings = {
  enabled: true,
  before: 20,
  after: 5,
  merge: 8,
  quality: 'balanced',
  triggers: { kill: true, hs: true, multi: true, ace: true, death: false },
  mic: false,
  gameAudio: true,
  hotkey: DEFAULT_HOTKEY,
  folder: '',
  limitGb: 20,
  games: 'all',
  display: 0,
  capture: 'engine',
  discord: 'free'
}

export interface QualityProfile {
  /** 0 : résolution de l'écran. */
  maxWidth: number
  maxHeight: number
  fps: number
  videoBps: number
  audioBps: number
}

export const QUALITY: Record<ClipQuality, QualityProfile> = {
  light: { maxWidth: 1920, maxHeight: 1080, fps: 30, videoBps: 10_000_000, audioBps: 128_000 },
  balanced: { maxWidth: 1920, maxHeight: 1080, fps: 60, videoBps: 20_000_000, audioBps: 160_000 },
  high: { maxWidth: 0, maxHeight: 0, fps: 60, videoBps: 40_000_000, audioBps: 192_000 }
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

/**
 * Réglages valables à partir de n'importe quoi (base, page) : chaque valeur est vérifiée, le reste garde sa valeur.
 * Un raccourci refusé garde l'ancien ; le dossier ne vient jamais de la page (voir clips.ts).
 */
export function cleanClipSettings(raw: unknown, base: ClipSettings = DEFAULT_CLIP_SETTINGS): ClipSettings {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const t = r.triggers && typeof r.triggers === 'object' && !Array.isArray(r.triggers) ? (r.triggers as Record<string, unknown>) : {}
  return {
    enabled: bool(r.enabled, base.enabled),
    before: clampInt(r.before, 5, 120, base.before),
    after: clampInt(r.after, 0, 30, base.after),
    merge: clampInt(r.merge, 0, 30, base.merge),
    quality: r.quality === 'light' || r.quality === 'balanced' || r.quality === 'high' ? r.quality : base.quality,
    triggers: {
      kill: bool(t.kill, base.triggers.kill),
      hs: bool(t.hs, base.triggers.hs),
      multi: bool(t.multi, base.triggers.multi),
      ace: bool(t.ace, base.triggers.ace),
      death: bool(t.death, base.triggers.death)
    },
    mic: bool(r.mic, base.mic),
    gameAudio: bool(r.gameAudio, base.gameAudio),
    hotkey: isValidHotkey(r.hotkey) ? r.hotkey : base.hotkey,
    folder: typeof r.folder === 'string' ? r.folder : base.folder,
    limitGb: typeof r.limitGb === 'number' && Number.isFinite(r.limitGb) ? Math.min(5000, Math.max(0.001, r.limitGb)) : base.limitGb,
    games: r.games === 'all' || r.games === 'cs2bf6' ? r.games : base.games,
    display: clampInt(r.display, 0, Number.MAX_SAFE_INTEGER, base.display),
    capture: r.capture === 'engine' || r.capture === 'chrome' ? r.capture : base.capture,
    discord: r.discord === 'free' || r.discord === 'basic' || r.discord === 'nitro' ? r.discord : base.discord
  }
}

// ---------- fenêtres et fusion ----------

/** Un clip ne dépasse pas 3 min : au-delà (match à mort), l'événement suivant ouvre un nouveau clip. */
export const MAX_CLIP_S = 180

export interface ClipMoment {
  kind: ClipKind
  at: number
  kills: number
  headshots: number
  roundKills?: number
  map?: string
  mode?: string
  round?: number
  score?: { us: number; them: number }
}

/** Clip en attente de ses dernières images. */
export interface PendingClip {
  id: string
  gameId: string
  gameName: string
  sessionId: string
  kind: ClipKind
  kills: number
  headshots: number
  /** Meilleur total d'éliminations dans un round. */
  peak: number
  /** Premier et dernier événement. */
  firstAt: number
  lastAt: number
  /** Fenêtre du clip (horloge du système, ms). */
  start: number
  end: number
  /** Plus rien à attendre après ce moment : plus de fusion possible et la fenêtre est passée. */
  closeAt: number
  /** Chaque événement du clip, à son heure (horloge du système, ms) : le montage coupe autour d'eux. */
  events: PendingEvent[]
  map?: string
  mode?: string
  round?: number
  score?: { us: number; them: number }
}

export interface PendingEvent {
  at: number
  kind: ClipKind
  kills: number
  headshots: number
}

/** Un clip de 3 min ne compte pas plus d'événements que ça (un par demi-seconde serait déjà 360). */
const MAX_EVENTS = 200
const eventOf = (m: ClipMoment): PendingEvent => ({ at: m.at, kind: m.kind, kills: m.kills, headshots: m.headshots })

export interface WindowSettings {
  before: number
  after: number
  merge: number
}

const closeOf = (lastAt: number, w: WindowSettings): number => lastAt + Math.max(w.after, w.merge) * 1000

export function openPending(id: string, game: { id: string; name: string; sessionId: string }, m: ClipMoment, w: WindowSettings): PendingClip {
  return {
    id,
    gameId: game.id,
    gameName: game.name,
    sessionId: game.sessionId,
    kind: m.kind,
    kills: m.kills,
    headshots: m.headshots,
    peak: m.roundKills ?? m.kills,
    firstAt: m.at,
    lastAt: m.at,
    start: m.at - w.before * 1000,
    end: m.at + w.after * 1000,
    closeAt: closeOf(m.at, w),
    events: [eventOf(m)],
    ...(m.map ? { map: m.map } : {}),
    ...(m.mode ? { mode: m.mode } : {}),
    ...(m.round !== undefined ? { round: m.round } : {}),
    ...(m.score ? { score: m.score } : {})
  }
}

/** Cet événement prolonge-t-il ce clip ? Pas plus loin que `merge` secondes après le dernier, ni au-delà de la durée maximale. */
export function canMerge(p: PendingClip, gameId: string, m: ClipMoment, w: WindowSettings): boolean {
  if (w.merge <= 0 || p.gameId !== gameId) return false
  if (m.at < p.lastAt || m.at - p.lastAt > w.merge * 1000) return false
  return m.at + w.after * 1000 - p.start <= MAX_CLIP_S * 1000
}

/** Rang d'un clip fusionné : le plus fort de ses événements donne son titre. */
const RANK: Record<ClipKind, number> = { ace: 5, multi: 4, hs: 3, kill: 2, manual: 1, death: 0 }

export function mergePending(p: PendingClip, m: ClipMoment, w: WindowSettings): PendingClip {
  const lastAt = Math.max(p.lastAt, m.at)
  return {
    ...p,
    kind: RANK[m.kind] > RANK[p.kind] ? m.kind : p.kind,
    kills: p.kills + m.kills,
    headshots: p.headshots + m.headshots,
    peak: Math.max(p.peak, m.roundKills ?? 0),
    lastAt,
    end: Math.max(p.end, m.at + w.after * 1000),
    closeAt: closeOf(lastAt, w),
    events: p.events.length < MAX_EVENTS ? [...p.events, eventOf(m)] : p.events,
    ...(m.map ? { map: m.map } : {}),
    ...(m.mode ? { mode: m.mode } : {}),
    ...(m.round !== undefined ? { round: m.round } : {}),
    ...(m.score ? { score: m.score } : {})
  }
}

const ms3 = (s: number): number => Math.round(s * 1000) / 1000

/**
 * Les événements d'un clip, en secondes depuis le début du fichier. `startMs` : l'heure du système de sa première image (le
 * fichier commence sur une image clé, souvent un peu avant la fenêtre demandée). Un événement hors du fichier est ramené au bord.
 */
export function clipEvents(events: readonly PendingEvent[], startMs: number, durationS: number): ClipEvent[] {
  return [...events]
    .sort((a, b) => a.at - b.at)
    .map((e) => ({ t: ms3(Math.min(Math.max(0, (e.at - startMs) / 1000), Math.max(0, durationS))), kind: e.kind, kills: e.kills, headshots: e.headshots }))
}

/**
 * Les événements d'un clip coupé : ceux qui restent dans la partie gardée ([fromS ; fromS + durationS], secondes de l'ancien
 * fichier), recalés sur le nouveau début. undefined : l'ancien clip n'en avait pas.
 */
export function trimEvents(events: readonly ClipEvent[] | undefined, fromS: number, durationS: number): ClipEvent[] | undefined {
  if (!Array.isArray(events)) return undefined
  return events.filter((e) => e.t >= fromS && e.t <= fromS + durationS).map((e) => ({ ...e, t: ms3(e.t - fromS) }))
}

/** Éliminations à afficher : un multi-kill déclenché à son 3e élimination en compte bien 3. */
export const clipKills = (p: Pick<PendingClip, 'kills' | 'peak'>): number => Math.max(p.kills, p.peak)

export function clipTitle(kind: ClipKind, kills: number, headshots: number, peak: number): string {
  switch (kind) {
    case 'ace':
      return 'Ace'
    case 'multi':
      return peak >= 4 ? 'Quadruple' : 'Triple'
    case 'hs':
      if (kills <= 1) return 'Headshot'
      if (kills === 2) return headshots >= 2 ? 'Double headshot' : 'Double'
      return `${kills} éliminations`
    case 'kill':
      if (kills <= 1) return 'Élimination'
      return kills === 2 ? 'Double' : `${kills} éliminations`
    case 'death':
      return 'Mort'
    case 'manual':
      return 'Clip manuel'
  }
}

// ---------- tampon ----------

/** Ce qu'il faut savoir d'un fragment gardé sur le disque. */
export interface BufferedFragment {
  recId: string
  /** Début et fin, sur l'horloge du système (ms). */
  startWall: number
  endWall: number
  key: boolean
}

/** Marge du tampon au-delà de before + after. */
export const BUFFER_MARGIN_S = 10

/** Les fragments finis avant ce moment peuvent partir : ni un nouvel événement, ni un clip en cours n'en ont besoin. */
export function keepFrom(now: number, w: Pick<WindowSettings, 'before' | 'after'>, inUseStarts: number[]): number {
  return Math.min(now - (w.before + w.after + BUFFER_MARGIN_S) * 1000, ...inUseStarts)
}

/**
 * L'enregistreur d'un clip : deux enregistreurs ont deux en-têtes, on ne les mélange jamais. Celui qui contient le dernier
 * événement, sinon celui qui couvre le plus de la fenêtre. null : rien dans la fenêtre.
 */
export function pickRecorder<T extends BufferedFragment>(frags: T[], start: number, end: number, focus: number): string | null {
  const overlap = new Map<string, number>()
  let holder: string | null = null
  for (const f of frags) {
    const o = Math.min(end, f.endWall) - Math.max(start, f.startWall)
    if (o <= 0) continue
    overlap.set(f.recId, (overlap.get(f.recId) ?? 0) + o)
    if (f.startWall <= focus && focus <= f.endWall) holder = f.recId
  }
  if (holder) return holder
  let best: string | null = null
  let bestO = 0
  for (const [id, o] of overlap)
    if (o > bestO) {
      best = id
      bestO = o
    }
  return best
}

/**
 * Fragments d'un même enregistreur pour la fenêtre, dans l'ordre : on part de la dernière image clé avant `start` (ou de la
 * première image clé de la fenêtre) et on va jusqu'au dernier fragment qui commence avant `end`.
 */
export function selectFragments<T extends BufferedFragment>(frags: T[], start: number, end: number): T[] {
  let first = -1
  for (let i = 0; i < frags.length; i++) {
    if (!frags[i].key) continue
    if (frags[i].startWall <= start) first = i
    else {
      if (first < 0 && frags[i].startWall < end) first = i
      break
    }
  }
  if (first < 0) return []
  const out: T[] = []
  for (let i = first; i < frags.length && frags[i].startWall < end; i++) out.push(frags[i])
  // Tout est fini avant la fenêtre : rien à en tirer.
  return out.some((f) => f.endWall > start) ? out : []
}

/**
 * Les fragments choisis et leurs voisins immédiats : le son et l'image d'un même instant ne tombent pas toujours dans le même
 * fragment. Rien de plus n'est écrit : la coupe garde les échantillons de la fenêtre, où qu'ils soient.
 */
export function withNeighbours<T>(all: T[], picked: T[]): T[] {
  if (!picked.length) return []
  const from = all.indexOf(picked[0])
  const to = all.indexOf(picked[picked.length - 1])
  return all.slice(Math.max(0, from - 1), to + 2)
}

// ---------- rétention ----------

export interface RetainedClip {
  id: string
  at: number
  sizeBytes: number
  pinned: boolean
  kind?: string
}

/**
 * Identifiants à supprimer pour repasser sous la limite : les plus vieux d'abord, jamais un épinglé ni `keepId`.
 * Un film n'est pas un clip : il ne compte pas dans la limite et ne part jamais tout seul.
 */
export function clipsToPurge<T extends RetainedClip>(all: T[], limitBytes: number, keepId?: string): string[] {
  const clips = all.filter((c) => c.kind !== 'film')
  let total = clips.reduce((n, c) => n + c.sizeBytes, 0)
  if (total <= limitBytes) return []
  const out: string[] = []
  for (const c of [...clips].sort((a, b) => a.at - b.at)) {
    if (total <= limitBytes) break
    if (c.pinned || c.id === keepId) continue
    out.push(c.id)
    total -= c.sizeBytes
  }
  return out
}

// ---------- noms de fichiers ----------

const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i

/** Sans ce que Windows refuse (caractères, nom réservé, point ou espace final). */
export function safeFileName(name: string, max = 150): string {
  const clean = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '')
  if (!clean) return 'Clip'
  return RESERVED_NAME.test(clean) ? `_${clean}` : clean
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** « Counter-Strike 2 2026-11-03 19-41-25 Headshot » (heure locale, sans extension). */
export function clipBaseName(gameName: string, at: number, title: string): string {
  const d = new Date(at)
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  return safeFileName(`${safeFileName(gameName, 80)} ${stamp} ${title}`)
}

/** Titre donné par le joueur : une ligne, 80 caractères. null : vide. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim()
  return t || null
}

// ---------- divers ----------

export const CLIP_ID = /^[0-9a-f]{16}$/

/** Attente avant de relancer un enregistreur arrêté : de plus en plus long, 30 s au plus. */
export function restartDelayMs(attempt: number): number {
  return [1000, 2000, 4000, 8000, 15000][attempt] ?? 30_000
}

/**
 * En-tête Range d'une requête : { start, end } inclus ; null : pas de plage valable à appliquer (tout le fichier) ;
 * 'unsatisfiable' : la plage sort du fichier (réponse 416).
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  if (size <= 0) return 'unsatisfiable'
  if (m[1] === '') {
    // Les n derniers octets.
    const n = Number(m[2])
    if (n === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  if (start >= size) return 'unsatisfiable'
  const end = m[2] === '' ? size - 1 : Math.min(size - 1, Number(m[2]))
  return end < start ? 'unsatisfiable' : { start, end }
}
