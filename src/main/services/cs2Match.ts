// Suivi d'un match de Counter-Strike 2 à partir des envois du jeu (Game State Integration de Valve). Module pur, sans
// Electron ni base : testé par `npm run test:cs2`. cs2Live.ts reçoit les envois et garde l'état entre deux envois.
//
// Ce que CS2 envoie : l'état complet à chaque changement (et toutes les 10 s sans changement). En partie, seulement
// le joueur du PC. Mort, `player` devient le joueur regardé : ses chiffres sont ignorés (steamid ≠ provider.steamid).
// Par round, `player.state` donne round_kills, round_killhs et round_totaldmg, remis à zéro à chaque nouveau round.
import { CS2_APPID, modeHasRounds } from '@shared/cs2'
import type { Cs2Live, Cs2Recap, Cs2Round, Cs2RoundEnd, Cs2Side } from '@shared/types'

type MapPhase = Cs2Live['phase']
type RoundPhase = 'freezetime' | 'live' | 'over'

/** Un envoi de CS2, lu et vérifié. Les chiffres du joueur ne sont présents que s'ils sont les tiens (`own`). */
export interface Snapshot {
  steamId: string
  own: boolean
  map?: {
    name: string
    mode: string
    phase: MapPhase
    /** Rounds terminés. */
    round: number
    ct: number
    t: number
    /** « 1 » → « ct_win_elimination »… */
    roundWins: Record<string, string>
  }
  roundPhase?: RoundPhase
  team?: Cs2Side
  /** Mort : le camp du joueur regardé (un coéquipier en compétitif), pour suivre l'échange de camps à la mi-temps. */
  viewTeam?: Cs2Side
  stats?: { kills: number; deaths: number; assists: number; mvps: number; points: number }
  state?: { health: number; money: number; roundKills: number; roundHs: number; roundDmg: number }
}

/** Ce qui a été fait dans un round. `own` : au moins un envoi avec tes chiffres pendant ce round. */
export interface RoundAcc {
  n: number
  kills: number
  hs: number
  dmg: number
  own: boolean
}

/** Match suivi. Sérialisable : gardé en base pour reprendre si Player X redémarre pendant la partie. */
export interface MatchState {
  id: string
  steamId: string
  map: string
  mode: string
  /** Premier envoi de ce match. */
  firstAt: number
  /** Début du match (fin de l'échauffement), ou premier envoi pour un match rejoint en cours. */
  startedAt: number
  lastAt: number
  /** Le match avait déjà des rounds terminés au premier envoi. */
  partial: boolean
  /** Sorti de l'échauffement : un bilan est possible. */
  live: boolean
  /** Au moins un envoi avec tes chiffres : sinon c'est un match regardé (démo, GOTV), pas le tien. */
  sawOwn?: boolean
  phase: MapPhase
  /** Rounds terminés (map.round). */
  mapRound: number
  roundPhase?: RoundPhase
  side?: Cs2Side
  score: { ct: number; t: number }
  stats: { kills: number; deaths: number; assists: number; mvps: number; points: number }
  health?: number
  money?: number
  cur?: RoundAcc
  rounds: RoundAcc[]
  /** Ton camp à chaque round où Player X l'a vu. */
  sides: Record<string, Cs2Side>
  roundWins: Record<string, string>
}

export type EndReason = 'gameover' | 'left'

export interface StepResult {
  match: MatchState | null
  /** Match terminé par cet envoi : de quoi faire le bilan. */
  ended?: { match: MatchState; by: EndReason }
}

// ---------- lecture d'un envoi ----------

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)
/** Entier de 0 à 1 000 000 (CS2 envoie parfois des nombres en texte). */
const int = (v: unknown): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1_000_000, Math.max(0, Math.round(n))) : 0
}
const str = (v: unknown, max = 128): string => (typeof v === 'string' ? v.slice(0, max) : '')
const side = (v: unknown): Cs2Side | undefined => (v === 'CT' ? 'CT' : v === 'T' ? 'T' : undefined)
const MAP_PHASES: MapPhase[] = ['warmup', 'live', 'intermission', 'gameover']
const ROUND_PHASES: RoundPhase[] = ['freezetime', 'live', 'over']

/** Envoi de CS2 (le jeton est vérifié avant, par le serveur). null : pas un envoi de CS2 exploitable. */
export function readPayload(body: unknown): Snapshot | null {
  const root = obj(body)
  const provider = obj(root?.provider)
  if (!root || !provider || int(provider.appid) !== CS2_APPID) return null
  const steamId = str(provider.steamid, 32)
  if (!/^\d{5,20}$/.test(steamId)) return null
  const player = obj(root.player)
  const own = !!player && str(player.steamid, 32) === steamId
  const snap: Snapshot = { steamId, own }

  const map = obj(root.map)
  const name = str(map?.name)
  const phase = str(map?.phase) as MapPhase
  if (map && name && MAP_PHASES.includes(phase)) {
    const wins: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj(map.round_wins) ?? {}).slice(0, 64)) if (/^\d{1,2}$/.test(k) && typeof v === 'string') wins[k] = v.slice(0, 48)
    snap.map = {
      name,
      mode: str(map.mode, 48) || 'custom',
      phase,
      round: int(map.round),
      ct: int(obj(map.team_ct)?.score),
      t: int(obj(map.team_t)?.score),
      roundWins: wins
    }
  }
  const rp = str(obj(root.round)?.phase) as RoundPhase
  if (ROUND_PHASES.includes(rp)) snap.roundPhase = rp

  if (!own && player) snap.viewTeam = side(player.team)
  if (own && player) {
    snap.team = side(player.team)
    const ms = obj(player.match_stats)
    if (ms) snap.stats = { kills: int(ms.kills), deaths: int(ms.deaths), assists: int(ms.assists), mvps: int(ms.mvps), points: int(ms.score) }
    const st = obj(player.state)
    if (st)
      snap.state = {
        health: int(st.health),
        money: int(st.money),
        roundKills: int(st.round_kills),
        roundHs: int(st.round_killhs),
        roundDmg: int(st.round_totaldmg)
      }
  }
  return snap
}

// ---------- suivi ----------

function start(snap: Snapshot, now: number): MatchState | null {
  const m = snap.map
  // Écran de fin d'un match déjà bouclé (ou jamais vu) : rien à suivre.
  if (!m || m.phase === 'gameover') return null
  const live = m.phase !== 'warmup'
  return {
    id: `cs2-${now}`,
    steamId: snap.steamId,
    map: m.name,
    mode: m.mode,
    firstAt: now,
    startedAt: now,
    lastAt: now,
    partial: live && m.round > 0,
    live,
    phase: m.phase,
    mapRound: m.round,
    score: { ct: m.ct, t: m.t },
    stats: { kills: 0, deaths: 0, assists: 0, mvps: 0, points: 0 },
    rounds: [],
    sides: {},
    roundWins: {}
  }
}

/**
 * Round en cours. map.round compte les rounds terminés, et passe au suivant dans le même envoi que la fin du round :
 * pendant `over` (et la mi-temps, l'écran de fin), c'est encore le round qui vient de finir.
 */
function roundOf(m: MatchState): number {
  const ending = m.roundPhase === 'over' || m.phase === 'intermission' || m.phase === 'gameover'
  return Math.max(1, ending ? m.mapRound : m.mapRound + 1)
}

/** Un nouveau match ? Autre carte, autre mode, autre compte, échauffement après des rounds, ou compteur qui recule. */
export function sameMatch(m: MatchState, snap: Snapshot): boolean {
  return !!snap.map && !isOther(m, snap)
}

function isOther(m: MatchState, snap: Snapshot): boolean {
  const map = snap.map!
  return (
    snap.steamId !== m.steamId ||
    map.name !== m.map ||
    map.mode !== m.mode ||
    (m.live && map.phase === 'warmup') ||
    (m.live && map.round < m.mapRound)
  )
}

const rounds = (m: MatchState): RoundAcc[] => (m.cur ? [...m.rounds, m.cur] : m.rounds)

/** Applique un envoi. Les objets reçus ne sont jamais modifiés : le résultat est un nouvel état. */
export function step(prev: MatchState | null, snap: Snapshot, now: number): StepResult {
  // Retour au menu (plus de carte) : le match en cours est quitté.
  if (!snap.map) return prev ? { match: null, ended: { match: prev, by: 'left' } } : { match: null }
  if (prev && isOther(prev, snap)) {
    const next = step(null, snap, now)
    return { match: next.match, ended: { match: prev, by: 'left' } }
  }
  const base = prev ?? start(snap, now)
  if (!base) return { match: null }
  const map = snap.map
  const m: MatchState = {
    ...base,
    lastAt: now,
    phase: map.phase,
    mapRound: map.round,
    roundPhase: snap.roundPhase,
    score: { ct: map.ct, t: map.t },
    rounds: [...base.rounds],
    sides: { ...base.sides },
    roundWins: Object.keys(map.roundWins).length ? map.roundWins : base.roundWins,
    // Mort ou spectateur : ni tes points de vie ni ton argent (ceux du joueur regardé ne sont pas les tiens).
    health: snap.state?.health,
    money: snap.state?.money
  }
  // Des rounds sont passés sans envoi (Player X relancé, CS2 qui revient après une coupure) : bilan partiel.
  if (prev && m.live && map.round > prev.mapRound + 1) m.partial = true
  if (snap.own) m.sawOwn = true
  if (!m.live && map.phase !== 'warmup') {
    // Fin de l'échauffement : le match commence vraiment, les compteurs de l'échauffement sont remis à zéro par CS2.
    m.live = true
    m.startedAt = now
  }
  if (snap.team) m.side = snap.team
  // Mort pendant la mi-temps : le camp change aussi pour toi (celui du coéquipier regardé).
  else if (snap.viewTeam && m.sawOwn && (m.phase === 'intermission' || m.roundPhase === 'freezetime')) m.side = snap.viewTeam
  if (snap.stats && m.live) m.stats = snap.stats

  if (m.live) {
    const n = roundOf(m)
    if (m.cur && n > m.cur.n) {
      m.rounds.push(m.cur)
      m.cur = undefined
    }
    if (!m.cur || n === m.cur.n) {
      const cur: RoundAcc = m.cur ? { ...m.cur } : { n, kills: 0, hs: 0, dmg: 0, own: false }
      // Camp du round : seulement pendant le round lui-même (à la fin et à la mi-temps, CS2 peut déjà donner le suivant).
      const playing = m.roundPhase === 'freezetime' || m.roundPhase === 'live'
      if (snap.own && snap.team && playing && m.phase !== 'intermission') m.sides[String(n)] = snap.team
      // Pendant le temps d'achat, rien ne peut arriver : on ne lit pas les compteurs (parfois pas encore remis à zéro).
      // Sans phase de round dans l'envoi, on ne sait pas à quel round ils appartiennent : ignorés aussi.
      if (snap.own && snap.state && m.roundPhase !== undefined && m.roundPhase !== 'freezetime') {
        cur.own = true
        // Le plus haut vu : un tir sur un coéquipier fait reculer round_kills, il ne retire pas l'élimination d'avant.
        cur.kills = Math.max(cur.kills, snap.state.roundKills)
        cur.hs = Math.max(cur.hs, snap.state.roundHs)
        cur.dmg = Math.max(cur.dmg, snap.state.roundDmg)
      } else if (snap.own && m.roundPhase === 'freezetime') cur.own = true
      m.cur = cur
    }
  }

  if (map.phase === 'gameover') {
    if (m.cur) m.rounds.push(m.cur)
    m.cur = undefined
    return { match: null, ended: m.live ? { match: m, by: 'gameover' } : undefined }
  }
  return { match: m }
}

/** Plus aucun envoi depuis `timeoutMs` (jeu fermé, planté, réseau coupé) : le match est quitté. */
export function expire(m: MatchState | null, now: number, timeoutMs: number): StepResult {
  if (!m || now - m.lastAt < timeoutMs) return { match: m }
  return { match: null, ended: { match: m, by: 'left' } }
}

// ---------- bilan ----------

function endOf(code: string): Cs2RoundEnd {
  if (/elimination/.test(code)) return 'elimination'
  if (/bomb/.test(code)) return 'bomb'
  if (/defuse/.test(code)) return 'defuse'
  if (/time/.test(code)) return 'time'
  if (/rescue|hostage/.test(code)) return 'hostage'
  return 'other'
}

/** Frise des rounds terminés : vainqueur, façon de gagner, ton camp et tes éliminations quand Player X les a vus. */
function stripOf(m: MatchState, tracked: RoundAcc[]): Cs2Round[] {
  const byN = new Map(tracked.map((r) => [r.n, r]))
  return Object.entries(m.roundWins)
    .map(([k, code]) => ({ n: Number(k), code }))
    .filter((r) => r.n >= 1 && /^(ct|t)_/.test(r.code))
    .sort((a, b) => a.n - b.n)
    .map(({ n, code }) => {
      const r: Cs2Round = { n, winner: code.startsWith('ct_') ? 'CT' : 'T', end: endOf(code) }
      const s = m.sides[String(n)]
      if (s) r.side = s
      const t = byN.get(n)
      if (t) r.kills = t.kills
      return r
    })
}

/** Bilan d'un match terminé. null : rien à montrer (quitté pendant l'échauffement, aucun round joué). */
export function recapOf(m: MatchState, by: EndReason): Omit<Cs2Recap, 'seen' | 'sample'> | null {
  if (!m.live) return null
  const all = rounds(m)
  const tracked = all.filter((r) => r.own)
  const { kills, deaths, assists, mvps, points } = m.stats
  if (!tracked.length && kills + deaths + assists + points === 0) return null
  const hasRounds = modeHasRounds(m.mode)

  const us = m.side === 'CT' ? m.score.ct : m.side === 'T' ? m.score.t : undefined
  const them = m.side === 'CT' ? m.score.t : m.side === 'T' ? m.score.ct : undefined
  const score = hasRounds && us !== undefined && them !== undefined ? { us, them } : undefined
  const result: Cs2Recap['result'] =
    by === 'left' ? 'left' : !score ? 'done' : score.us > score.them ? 'win' : score.us < score.them ? 'loss' : 'tie'

  const strip = hasRounds ? stripOf(m, tracked) : []

  const best = tracked.reduce<RoundAcc | undefined>((b, r) => (r.kills > 0 && (!b || r.kills > b.kills || (r.kills === b.kills && r.dmg > b.dmg)) ? r : b), undefined)
  const sum = (f: (r: RoundAcc) => number): number => tracked.reduce((s, r) => s + f(r), 0)
  return {
    id: m.id,
    steamId: m.steamId,
    map: m.map,
    mode: m.mode,
    startedAt: m.startedAt,
    endedAt: m.lastAt,
    result,
    ...(score ? { score } : {}),
    kills,
    deaths,
    assists,
    mvps,
    points,
    headshots: sum((r) => Math.min(r.hs, r.kills)),
    damage: hasRounds ? sum((r) => r.dmg) : 0,
    trackedKills: sum((r) => r.kills),
    roundsTracked: hasRounds ? tracked.length : 0,
    // Sans rounds (match à mort), tout le match est un seul « round » : pas de 3K ni d'ace.
    multi: hasRounds
      ? {
          k3: tracked.filter((r) => r.kills === 3).length,
          k4: tracked.filter((r) => r.kills === 4).length,
          k5: tracked.filter((r) => r.kills >= 5).length
        }
      : { k3: 0, k4: 0, k5: 0 },
    ...(best && hasRounds ? { best: { n: best.n, kills: best.kills, damage: best.dmg } } : {}),
    rounds: strip,
    hasRounds,
    ...(m.partial ? { partial: true } : {})
  }
}

// ---------- match en direct ----------

export function liveOf(m: MatchState | null): Cs2Live | null {
  // Match regardé (démo, GOTV, spectateur) : pas « En match ».
  if (!m?.sawOwn) return null
  const n = roundOf(m)
  const us = m.side === 'CT' ? m.score.ct : m.score.t
  const them = m.side === 'CT' ? m.score.t : m.score.ct
  const hasRounds = modeHasRounds(m.mode)
  // Rounds terminés et suivis (celui en cours compte dès qu'il est fini).
  const done = m.rounds.filter((r) => r.own && r.n < n)
  const kills = done.reduce((s, r) => s + r.kills, 0)
  return {
    map: m.map,
    mode: m.mode,
    phase: m.phase,
    ...(m.roundPhase ? { roundPhase: m.roundPhase } : {}),
    round: n,
    rounds: hasRounds ? stripOf(m, m.rounds.filter((r) => r.own)) : [],
    ...(hasRounds && done.length ? { adr: Math.round(done.reduce((s, r) => s + r.dmg, 0) / done.length) } : {}),
    ...(kills ? { hsPct: Math.round((done.reduce((s, r) => s + Math.min(r.hs, r.kills), 0) / kills) * 100) } : {}),
    ...(m.side ? { side: m.side, score: { us, them } } : {}),
    ...m.stats,
    ...(m.health !== undefined ? { health: m.health } : {}),
    ...(m.money !== undefined ? { money: m.money } : {}),
    roundKills: m.live && m.cur?.n === n ? m.cur.kills : 0,
    startedAt: m.startedAt,
    ...(m.partial ? { partial: true } : {})
  }
}
