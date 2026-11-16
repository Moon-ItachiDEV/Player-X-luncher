// Moments d'une partie de Counter-Strike 2, d'après les envois successifs du jeu (Game State Integration) : élimination,
// headshot, multi-kill, ace, mort. C'est ce qui déclenche un clip (clips.ts). Module pur, sans Electron : testé par
// `npm run test:clips`. Il part d'un envoi déjà lu par readPayload (cs2Match.ts).
//
// Ce qu'il faut savoir de ces envois :
// - `own` est faux quand `player` est un autre joueur (mort et caméra sur un coéquipier, spectateur, démo) : aucun clip.
// - round_kills, round_killhs : remis à zéro à chaque round, parfois seulement après le temps d'achat ; un tir sur un
//   coéquipier les fait reculer, comme match_stats.kills.
// - match_stats : remis à zéro à la fin de l'échauffement. Rien de ce qui se passe à l'échauffement ne compte.
// - Le premier envoi vu (Player X relancé en pleine partie, retour après une mort) sert de référence : il n'annonce rien.
import { modeHasRounds } from '@shared/cs2'
import type { Snapshot } from './cs2Match'

export type Cs2MomentKind = 'kill' | 'hs' | 'multi' | 'ace' | 'death'

export interface Cs2Moment {
  kind: Cs2MomentKind
  /** Nouvelles éliminations de cet envoi (0 : le headshot d'une élimination déjà annoncée, ou une mort). */
  kills: number
  /** Nouveaux headshots de cet envoi. */
  headshots: number
  /** Éliminations de ce round jusque-là. */
  roundKills: number
  at: number
  map: string
  mode: string
  round: number
  score?: { us: number; them: number }
}

export interface MomentsState {
  /** Compte, carte et mode suivis. */
  match: string
  /** Round où les compteurs ont été vus pour la dernière fois (0 : sans objet, mode sans rounds). */
  round: number
  /** Le dernier envoi était le tien : les compteurs ci-dessous sont à jour. */
  own: boolean
  /** Référence prise pendant l'échauffement : les compteurs repartent de zéro à sa fin. */
  warmup: boolean
  alive: boolean
  /** match_stats.kills au début du round. */
  killsBase: number
  deaths: number
  /** Éliminations et headshots déjà annoncés dans ce round. */
  credited: number
  creditedHs: number
}

export const NO_MOMENTS: MomentsState = { match: '', round: 0, own: false, warmup: false, alive: false, killsBase: 0, deaths: 0, credited: 0, creditedHs: 0 }

/** Round en cours : map.round compte les rounds terminés et passe au suivant dès la fin du round (phase « over »). */
function roundNumber(snap: Snapshot): number {
  const m = snap.map!
  const ending = snap.roundPhase === 'over' || m.phase === 'intermission' || m.phase === 'gameover'
  return Math.max(1, ending ? m.round : m.round + 1)
}

/** Compteurs de l'envoi pris comme référence : rien n'est annoncé jusqu'au prochain changement. */
function baseline(snap: Snapshot, match: string, round: number): MomentsState {
  const rk = snap.state?.roundKills ?? 0
  return {
    match,
    round,
    own: true,
    warmup: snap.map!.phase === 'warmup',
    alive: (snap.state?.health ?? 0) > 0,
    killsBase: snap.stats?.kills ?? 0,
    deaths: snap.stats?.deaths ?? 0,
    credited: rk,
    creditedHs: snap.state?.roundHs ?? 0
  }
}

function momentOf(kind: Cs2MomentKind, snap: Snapshot, now: number, kills: number, headshots: number, roundKills: number): Cs2Moment {
  const m = snap.map!
  const side = snap.team
  return {
    kind,
    kills,
    headshots,
    roundKills,
    at: now,
    map: m.name,
    mode: m.mode,
    round: roundNumber(snap),
    ...(side ? { score: side === 'CT' ? { us: m.ct, them: m.t } : { us: m.t, them: m.ct } } : {})
  }
}

/** Applique un envoi : le nouvel état, et ce qui vient de se passer (rien le plus souvent). */
export function stepMoments(prev: MomentsState, snap: Snapshot, now: number): { state: MomentsState; moments: Cs2Moment[] } {
  const m = snap.map
  // Au menu : on oublie tout.
  if (!m) return { state: NO_MOMENTS, moments: [] }
  const match = `${snap.steamId}|${m.name}|${m.mode}`
  const rounds = modeHasRounds(m.mode)
  const round = rounds ? roundNumber(snap) : 0

  if (!snap.own) {
    // La caméra passe sur un autre joueur en plein round, alors que tu étais en vie : tu viens de mourir.
    const died = prev.own && prev.alive && prev.match === match && m.phase !== 'warmup' && (snap.roundPhase === 'live' || snap.roundPhase === 'over')
    return {
      state: prev.match === match ? { ...prev, own: false, alive: died ? false : prev.alive } : NO_MOMENTS,
      moments: died ? [momentOf('death', snap, now, 0, 0, prev.credited)] : []
    }
  }
  // Tes chiffres : sans eux, on ne peut rien comparer.
  if (!snap.state || !snap.stats) return { state: prev, moments: [] }
  // Échauffement, temps d'achat, autre match, retour après une mort, round sauté : nouvelle référence.
  if (m.phase === 'warmup' || prev.warmup || snap.roundPhase === 'freezetime' || prev.match !== match || !prev.own || prev.round !== round) {
    return { state: baseline(snap, match, round), moments: [] }
  }

  const moments: Cs2Moment[] = []
  const next: MomentsState = { ...prev }

  // Éliminations : le plus haut des deux compteurs, un seul crédit même si l'un arrive un envoi après l'autre.
  const seen = Math.max(snap.state.roundKills, snap.stats.kills - prev.killsBase)
  const newKills = Math.max(0, seen - prev.credited)
  next.credited = seen
  const newHs = Math.max(0, snap.state.roundHs - prev.creditedHs)
  next.creditedHs = snap.state.roundHs
  if (newKills > 0 || newHs > 0) {
    const kind: Cs2MomentKind = rounds && newKills > 0 && seen >= 5 ? 'ace' : rounds && newKills > 0 && seen >= 3 ? 'multi' : newHs > 0 ? 'hs' : 'kill'
    moments.push(momentOf(kind, snap, now, newKills, newHs, seen))
  }

  // Mort : le compteur, ou la vie qui tombe à zéro.
  const died = snap.stats.deaths > prev.deaths || (prev.alive && snap.state.health === 0)
  if (died && prev.alive) moments.push(momentOf('death', snap, now, 0, 0, seen))
  next.deaths = snap.stats.deaths
  next.alive = snap.state.health > 0
  return { state: next, moments }
}
