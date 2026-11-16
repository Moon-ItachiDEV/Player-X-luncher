// Où en est un lancement, côté interface : les paliers de texte qui dépendent du temps passé (jamais de la
// progression du jeu, que Player X ne connaît pas) et les durées d'affichage de la carte. Sans React ni DOM (tests).
import type { LaunchPhase, LaunchStatus } from '../launch'

/** Le lien n'est toujours pas transmis : le texte le dit. */
export const STALLED_MS = 5_000
/** Juste après l'envoi : le store peut ouvrir sa propre fenêtre. */
export const RELAIS_MS = 15_000
/** Au-delà : « Toujours en attente ». */
export const SLOW_MS = 90_000
/** « Lancement… » reste au moins ce temps sur les boutons : pas de libellé qui clignote. */
export const LABEL_MIN_MS = 600
/** Le compteur de la carte s'affiche à partir de 3 s. */
export const COUNTER_FROM_MS = 3_000
/** Carte jamais revue (tu es resté dans le jeu) : retirée sans bruit 10 min après son dernier changement. */
export const CARD_CAP_MS = 600_000
/** Le même jeu ne rejoue pas la mise à feu avant 10 min. */
export const STAGE_REPEAT_MS = 600_000

/** Temps d'affichage d'une carte terminée, compté seulement quand la fenêtre est au premier plan. */
export const CARD_ACTIVE_MS: Partial<Record<LaunchPhase, number>> = {
  running: 4_000,
  failed: 10_000,
  'early-exit': 10_000,
  already: 8_000,
  'gave-up': 8_000,
  untracked: 6_000,
  resent: 6_000
}

/** Phases où l'on attend encore quelque chose du lancement. */
export const PENDING_PHASES: ReadonlySet<LaunchPhase> = new Set(['sending', 'waiting', 'relay'])
export const isPending = (phase: LaunchPhase): boolean => PENDING_PHASES.has(phase)

/** Ce que la carte et la date gelée savent d'un lancement (LaunchView, sans dépendre du store). */
export interface CardRecord {
  gameId: string
  checking: boolean
  cardDone: boolean
  status: Pick<LaunchStatus, 'phase' | 'detectedAt'>
}

/**
 * La date de dernier lancement du jeu reste celle d'avant le clic : seulement tant qu'il n'a pas été vu. Un relais
 * (déjà détecté une fois) ne la regèle pas : la date fraîche est déjà affichée, les listes ne bougent pas deux fois.
 */
export const freezesDate = (v: Pick<CardRecord, 'checking' | 'status'>): boolean =>
  (v.checking || isPending(v.status.phase)) && v.status.detectedAt === undefined

/**
 * Nouveau lancement d'un jeu : ses cartes terminées encore ouvertes (échec, jeu fermé, déjà en jeu…) se ferment,
 * sinon l'ancienne reviendrait quand la nouvelle part. Rend `all` tel quel s'il n'y a rien à fermer.
 */
export function closeFinishedCards<T extends CardRecord>(all: Record<string, T>, gameId: string): Record<string, T> {
  let out = all
  for (const [id, v] of Object.entries(all)) {
    if (v.gameId !== gameId || v.cardDone || v.checking || isPending(v.status.phase)) continue
    if (out === all) out = { ...all }
    out[id] = { ...v, cardDone: true }
  }
  return out
}

/** Phases sans carte : rien à dire de plus. */
const NO_CARD: ReadonlySet<LaunchPhase> = new Set(['ended', 'cancelled'])
export const hasCard = (s: LaunchStatus): boolean => !NO_CARD.has(s.phase) && !s.silent && !(s.demo && s.phase === 'ended')

export type Bucket =
  | 'sending'
  | 'stalled'
  | 'relais'
  | 'waiting'
  | 'slow'
  | Exclude<LaunchPhase, 'sending' | 'waiting'>

/** Palier de texte d'un lancement à l'instant `now` (horloge du processus principal, même machine). */
export function bucket(s: LaunchStatus, now: number): Bucket {
  if (s.phase === 'sending') return now - s.clickAt >= STALLED_MS ? 'stalled' : 'sending'
  if (s.phase === 'waiting') {
    const since = now - (s.handedAt ?? s.clickAt)
    return since >= SLOW_MS ? 'slow' : since >= RELAIS_MS ? 'waiting' : 'relais'
  }
  return s.phase
}

/** Prochain changement de palier (pour réveiller l'affichage), ou Infinity. */
export function nextBucketAt(s: LaunchStatus, now: number): number {
  if (s.phase === 'sending') return s.clickAt + STALLED_MS > now ? s.clickAt + STALLED_MS : Infinity
  if (s.phase !== 'waiting') return Infinity
  const from = s.handedAt ?? s.clickAt
  for (const at of [from + RELAIS_MS, from + SLOW_MS]) if (at > now) return at
  return Infinity
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Compteur de la carte : « 0:07 », « 2:41 », « 12:05 ». */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`
}

const NB = ' '

/** « Détecté après 24 s », « 1 min 12 », « 3 min ». */
export function fmtDetected(ms: number): string {
  // Jamais « 0 s » : moins d'une seconde se lit « 1 s ».
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}${NB}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m}${NB}min${NB}${pad2(r)}` : `${m}${NB}min`
}

/**
 * Temps d'affichage compté seulement quand la fenêtre est au premier plan (et que la carte n'est ni survolée ni
 * focalisée). `pause` et `resume` peuvent être appelés plusieurs fois de suite.
 */
export class ActiveClock {
  readonly budget: number
  private spent = 0
  private since: number | null = null

  constructor(budget: number) {
    this.budget = budget
  }

  resume(now: number): void {
    if (this.since === null) this.since = now
  }

  pause(now: number): void {
    if (this.since === null) return
    this.spent += now - this.since
    this.since = null
  }

  get running(): boolean {
    return this.since !== null
  }

  /** Temps encore à afficher (0 : la carte part). */
  remaining(now: number): number {
    const spent = this.spent + (this.since === null ? 0 : now - this.since)
    return Math.max(0, this.budget - spent)
  }
}

/** État des boutons Jouer d'un jeu (les textes : copy.ts playCopy). */
export type PlayState = 'idle' | 'sending' | 'checking' | 'pending' | 'running' | 'demo-running'

/** Ce que les boutons savent d'un lancement (LaunchView, sans dépendre du store). */
export interface PlayRecord {
  checking: boolean
  clickedAt: number
  status: Pick<LaunchStatus, 'phase' | 'demo'>
}

/**
 * En jeu si la bibliothèque le dit ou si un vrai lancement l'a vu ; « Lancement… » au moins 600 ms après le clic
 * (pas de libellé qui clignote) ; « En attente… » pendant l'attente ou un relais.
 */
export function playStateOf(running: boolean, v: PlayRecord | null, now: number): PlayState {
  if (v?.checking) return 'checking'
  const ph = v?.status.phase
  const demo = !!v?.status.demo
  if (v && ph) {
    const young = now - v.clickedAt < LABEL_MIN_MS
    if (ph === 'sending' || (young && (ph === 'waiting' || ph === 'relay' || ph === 'running'))) return 'sending'
    if (ph === 'waiting' || ph === 'relay') return 'pending'
  }
  if (running || (ph === 'running' && !demo)) return 'running'
  if (demo && ph === 'running') return 'demo-running'
  return 'idle'
}
