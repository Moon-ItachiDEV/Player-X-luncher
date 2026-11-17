// Agrégats purs pour la page Stats (port de maquette/data/agg.mjs). Pas de Date.now() ni d'E/S : on passe `now`.
// Every ratio is null (never 0 or NaN) when its denominator is 0. Percentages are 0..100 floats, not rounded.
// Local time (weekdays, dayparts, "same day" rule of the BF6 deltas) follows the TZ of the process, like the app.
import type { Bf6Point, Bf6Row, Bf6Stats, Cs2Recap, Cs2Result, Cs2Round, Cs2Side } from './types'

// ---------------------------------------------------------------------------------------------------------------
// Input types: the real app types, or a minimal structural interface with just the fields that are read.

/** The CS2 recap fields read here (a real `Cs2Recap` fits). */
export type Cs2AggRecap = Pick<
  Cs2Recap,
  'id' | 'map' | 'mode' | 'startedAt' | 'endedAt' | 'result' | 'kills' | 'deaths' | 'assists' | 'mvps' | 'headshots' | 'damage' |
  'trackedKills' | 'roundsTracked' | 'multi' | 'rounds' | 'hasRounds'
> & Partial<Pick<Cs2Recap, 'score' | 'best'>>

/** BF6 totals read here: `Bf6Stats` without the account fields (a real `Bf6Stats` fits). */
export type Bf6AggStats = Omit<Bf6Stats, 'account' | 'avatarUrl' | 'bestClass'>

/** BF6 history point (a real `Bf6Point` fits). */
export type Bf6AggPoint = Bf6Point

/** The BF6 session recap fields read here (a real `Bf6Recap` fits). */
export interface Bf6AggRecap {
  id: string
  startedAt: number
  kills: number
  deaths: number
  matches: number
  wins: number
  losses: number
  secondsPlayed: number
  killDeath: number
  killsPerMinute: number
  average?: { killDeath: number }
  weapon?: { name: string }
  role?: { name: string }
  maps?: { name: string }[]
}

export interface Cs2AggOptions {
  now?: number
  /** 0: everything; otherwise endedAt >= now - days * 86400000. */
  days?: number
}

// ---------------------------------------------------------------------------------------------------------------
// Output types

export interface Cs2Streak {
  type: 'W' | 'L' | null
  n: number
}

export type Cs2FormLetter = 'W' | 'L' | 'T' | '-'

export interface Cs2Multi {
  k3: number
  k4: number
  k5: number
}

export interface Cs2BestRound {
  kills: number
  damage: number
  n: number
  map: string
  at: number
  id: string
}

export interface Cs2BestMatch {
  id: string
  map: string
  at: number
  kills: number
  deaths: number
  kd: number | null
  adr: number | null
  score: { us: number; them: number } | null
  result: Cs2Result
}

export interface Cs2SideOut {
  rounds: number
  won: number
  kills: number
  winPct: number | null
  kpr: number | null
}

export interface Cs2SideMini {
  rounds: number
  won: number
  winPct: number | null
}

export type Cs2EndCounts = Record<'elimination' | 'bomb' | 'defuse' | 'time' | 'hostage' | 'other', number>

export interface Cs2MapAgg {
  id: string
  matches: number
  wins: number
  losses: number
  ties: number
  winPct: number | null
  ranked: number
  kills: number
  deaths: number
  kd: number | null
  kdRounds: number | null
  adr: number | null
  hsPct: number | null
  ct: Cs2SideMini
  t: Cs2SideMini
}

export interface Cs2ModeAgg {
  mode: string
  matches: number
  wins: number
  winPct: number | null
}

export interface Cs2WeekdayAgg {
  matches: number
  wins: number
  winPct: number | null
}

export interface Cs2DaypartAgg {
  matches: number
  wins: number
  winPct: number | null
  kd: number | null
}

export interface Cs2TrendPair {
  now: number | null
  before: number | null
}

export interface Cs2Trend {
  n: { now: number; before: number }
  adr: Cs2TrendPair
  kd: Cs2TrendPair
  hsPct: Cs2TrendPair
  winPct: Cs2TrendPair
}

export interface Cs2SeriesPoint {
  id: string
  at: number
  map: string
  mode: string
  result: Cs2Result
  score: { us: number; them: number } | null
  kills: number
  deaths: number
  kd: number | null
  adr: number | null
  hsPct: number | null
}

export interface Cs2Agg {
  n: number
  wins: number
  losses: number
  ties: number
  other: number
  winPct: number | null
  kills: number
  deaths: number
  assists: number
  mvps: number
  kd: number | null
  kdRounds: number | null
  ranked: number
  adr: number | null
  hsPct: number | null
  kpr: number | null
  form: Cs2FormLetter[]
  streak: Cs2Streak
  multi: Cs2Multi
  bestRound: Cs2BestRound | null
  bestMatch: Cs2BestMatch | null
  sides: { CT: Cs2SideOut; T: Cs2SideOut }
  pistol: { played: number; won: number; winPct: number | null }
  ends: { won: Cs2EndCounts; lost: Cs2EndCounts }
  roundsWithKill: number | null
  maps: Cs2MapAgg[]
  modes: Cs2ModeAgg[]
  weekdays: Cs2WeekdayAgg[]
  dayparts: { nuit: Cs2DaypartAgg; matin: Cs2DaypartAgg; aprem: Cs2DaypartAgg; soir: Cs2DaypartAgg }
  trend: Cs2Trend | null
  series: Cs2SeriesPoint[]
}

export interface Bf6PlaceAgg {
  name: string
  image: string | undefined
  matches: number
  wins: number
  winPct: number | null
}

export interface Bf6ClassAgg {
  name: string
  kills: number | null
  kd: number | null
  kpm: number | null
  seconds: number | null
  sharePct: number | null
}

export interface Bf6WeaponAgg {
  name: string
  image: string | undefined
  kills: number
  kd: number | null
  kpm: number | null
  accuracy: number | null
  hsPct: number | null
  hours: number | null
  sharePct: number | null
}

export interface Bf6VehicleAgg {
  name: string
  image: string | undefined
  kills: number
  kpm: number | null
  hours: number | null
}

export interface Bf6PickedMap {
  name: string
  image: string | undefined
  matches: number
  winPct: number | null
}

export interface Bf6Delta {
  days: number
  kills: number | null
  deaths: number | null
  matches: number | null
  wins: number | null
  losses: number | null
  hours: number | null
  kd: number | null
  winPct: number | null
  kpm: number | null
}

export interface Bf6SeriesPoint {
  at: number
  kd: number | null
  kdLife: number | null
  kpm: number | null
  winPct: number | null
  accuracy: number | null
  matches: number | null
}

export interface Bf6SessionAgg {
  id: string
  at: number
  minutes: number
  matches: number
  wins: number
  losses: number
  kills: number
  deaths: number
  kd: number | null
  kpm: number | null
  kdVsAvg: number | null
  weapon: string | null
  role: string | null
  maps: string[]
}

export interface Bf6Agg {
  kd: number | null
  kpm: number | null
  winPct: number | null
  kills: number
  deaths: number
  wins: number
  losses: number
  matches: number
  hours: number
  hsPct: number | null
  accuracy: number
  assists: number
  revives: number
  perMatch: {
    kills: number | null
    deaths: number | null
    assists: number | null
    revives: number | null
    minutes: number | null
  }
  classes: Bf6ClassAgg[]
  weapons: Bf6WeaponAgg[]
  vehicles: Bf6VehicleAgg[]
  vehicleKillPct: number | null
  maps: Bf6PlaceAgg[]
  modes: Bf6PlaceAgg[]
  bestMap: Bf6PickedMap | null
  worstMap: Bf6PickedMap | null
  deltas: { d7: Bf6Delta | null; d30: Bf6Delta | null }
  series: Bf6SeriesPoint[]
  sessions: Bf6SessionAgg[]
  bestSession: Bf6SessionAgg | null
}

/** The five CS2 views of the Stats page. p30 / p7: the same window, one period earlier. */
export interface Cs2Views {
  all: Cs2Agg
  d30: Cs2Agg
  d7: Cs2Agg
  p30: Cs2Agg
  p7: Cs2Agg
}

// ---------------------------------------------------------------------------------------------------------------

const DAY = 86_400_000
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** a / b, or null when b is not > 0. */
const div = (a: unknown, b: unknown): number | null => (isNum(a) && isNum(b) && b > 0 ? a / b : null)
/** a / b * 100, or null. */
const pct = (a: unknown, b: unknown): number | null => (isNum(a) && isNum(b) && b > 0 ? (a / b) * 100 : null)
/** K/D: kills when no death (scoreboard rule). null when there is nothing counted. */
function kdOf(kills: number, deaths: number): number
function kdOf(kills: number, deaths: number, count: number): number | null
function kdOf(kills: number, deaths: number, count = 1): number | null {
  return count > 0 ? (deaths > 0 ? kills / deaths : kills) : null
}
const dayKey = (t: number): string => new Date(t).toDateString()
const hasSide = (r: Cs2Round): r is Cs2Round & { side: Cs2Side } => r.side === 'CT' || r.side === 'T'

const END_KEYS = ['elimination', 'bomb', 'defuse', 'time', 'hostage', 'other'] as const
const emptyEnds = (): Cs2EndCounts => Object.fromEntries(END_KEYS.map((k) => [k, 0])) as Cs2EndCounts
/** Pistol rounds (first of each half) by mode. Other modes have none counted. */
const PISTOL_ROUNDS: Record<string, number[]> = { competitive: [1, 13], premier: [1, 13], scrimcomp2v2: [1, 9] }

interface Tally {
  matches: number
  wins: number
  losses: number
  ties: number
}
/** Counter of matches with a W/L/T outcome. */
const tally = (): Tally => ({ matches: 0, wins: 0, losses: 0, ties: 0 })
function addResult(t: Tally, result: Cs2Result): void {
  t.matches++
  if (result === 'win') t.wins++
  else if (result === 'loss') t.losses++
  else if (result === 'tie') t.ties++
}
const winPctOf = (t: Tally): number | null => pct(t.wins, t.wins + t.losses + t.ties)

/** Stats of a group of matches (used by the trend). */
function groupStats(g: Cs2AggRecap[]): { adr: number | null; kd: number | null; hsPct: number | null; winPct: number | null; ranked: number } {
  let kills = 0, deaths = 0, hs = 0, tk = 0, dmg = 0, rt = 0
  const t = tally()
  for (const r of g) {
    kills += r.kills
    deaths += r.deaths
    hs += r.headshots
    tk += r.trackedKills
    addResult(t, r.result)
    if (r.hasRounds && r.roundsTracked > 0) {
      dmg += r.damage
      rt += r.roundsTracked
    }
  }
  return { adr: div(dmg, rt), kd: kdOf(kills, deaths, g.length), hsPct: pct(hs, tk), winPct: winPctOf(t), ranked: t.wins + t.losses + t.ties }
}

interface MapAcc extends Tally {
  id: string
  kills: number
  deaths: number
  rKills: number
  rDeaths: number
  rCount: number
  dmg: number
  dmgRounds: number
  hs: number
  tk: number
  ct: { rounds: number; won: number }
  t: { rounds: number; won: number }
}
interface DayAcc extends Tally {
  kills: number
  deaths: number
}

/**
 * Counter-Strike 2 aggregates from stored recaps.
 * @param recaps newest first
 * @param opts days = 0: everything; otherwise endedAt >= now - days * 86400000
 */
export function cs2Agg(recaps: readonly Cs2AggRecap[], { now, days = 0 }: Cs2AggOptions = {}): Cs2Agg {
  let list: Cs2AggRecap[] = Array.isArray(recaps) ? recaps.filter(Boolean) : []
  if (days > 0) {
    if (!isNum(now)) throw new TypeError('cs2Agg: `now` is required when `days` > 0')
    const since = now - days * DAY
    list = list.filter((r) => r.endedAt >= since)
  }
  // Newest first whatever the caller gave (stable for equal dates).
  list = [...list].sort((a, b) => b.startedAt - a.startedAt)

  const n = list.length
  const total = tally()
  let other = 0
  let kills = 0, deaths = 0, assists = 0, mvps = 0
  // K/D of round-based matches only: a deathmatch K/D would drown the competitive one.
  let rKills = 0, rDeaths = 0, rCount = 0
  let dmg = 0, dmgRounds = 0, hs = 0, trackedKills = 0
  const multi: Cs2Multi = { k3: 0, k4: 0, k5: 0 }
  let bestRound: Cs2BestRound | null = null
  let bestMatch: Cs2BestMatch | null = null
  const sides = { CT: { rounds: 0, won: 0, kills: 0 }, T: { rounds: 0, won: 0, kills: 0 } }
  const pistol = { played: 0, won: 0 }
  const ends = { won: emptyEnds(), lost: emptyEnds() }
  let sideRounds = 0, sideKills = 0, roundsWithKill = 0
  const mapAcc = new Map<string, MapAcc>()
  const modeAcc = new Map<string, Tally & { mode: string }>()
  const weekdayAcc = Array.from({ length: 7 }, tally)
  const dayAcc: Record<'nuit' | 'matin' | 'aprem' | 'soir', DayAcc> = {
    nuit: { ...tally(), kills: 0, deaths: 0 },
    matin: { ...tally(), kills: 0, deaths: 0 },
    aprem: { ...tally(), kills: 0, deaths: 0 },
    soir: { ...tally(), kills: 0, deaths: 0 }
  }

  for (const r of list) {
    addResult(total, r.result)
    if (r.result === 'left' || r.result === 'done') other++
    kills += r.kills
    deaths += r.deaths
    assists += r.assists
    mvps += r.mvps
    hs += r.headshots
    trackedKills += r.trackedKills
    const hasAdr = r.hasRounds && r.roundsTracked > 0
    if (hasAdr) {
      dmg += r.damage
      dmgRounds += r.roundsTracked
    }
    if (r.hasRounds) {
      rKills += r.kills
      rDeaths += r.deaths
      rCount++
    }
    multi.k3 += r.multi?.k3 ?? 0
    multi.k4 += r.multi?.k4 ?? 0
    multi.k5 += r.multi?.k5 ?? 0

    if (r.best && (!bestRound || r.best.kills > bestRound.kills || (r.best.kills === bestRound.kills && r.best.damage > bestRound.damage))) {
      bestRound = { kills: r.best.kills, damage: r.best.damage, n: r.best.n, map: r.map, at: r.startedAt, id: r.id }
    }
    if (r.hasRounds && (!bestMatch || r.kills > bestMatch.kills || (r.kills === bestMatch.kills && kdOf(r.kills, r.deaths) > (bestMatch.kd as number)))) {
      bestMatch = {
        id: r.id, map: r.map, at: r.startedAt, kills: r.kills, deaths: r.deaths, kd: kdOf(r.kills, r.deaths),
        adr: hasAdr ? r.damage / r.roundsTracked : null, score: r.score ?? null, result: r.result
      }
    }

    // Per-map and per-mode
    let m = mapAcc.get(r.map)
    if (!m) {
      m = { id: r.map, ...tally(), kills: 0, deaths: 0, rKills: 0, rDeaths: 0, rCount: 0, dmg: 0, dmgRounds: 0, hs: 0, tk: 0, ct: { rounds: 0, won: 0 }, t: { rounds: 0, won: 0 } }
      mapAcc.set(r.map, m)
    }
    addResult(m, r.result)
    m.kills += r.kills
    m.deaths += r.deaths
    if (r.hasRounds) {
      m.rKills += r.kills
      m.rDeaths += r.deaths
      m.rCount++
    }
    m.hs += r.headshots
    m.tk += r.trackedKills
    if (hasAdr) {
      m.dmg += r.damage
      m.dmgRounds += r.roundsTracked
    }
    let md = modeAcc.get(r.mode)
    if (!md) modeAcc.set(r.mode, (md = { mode: r.mode, ...tally() }))
    addResult(md, r.result)

    // Time of day (local)
    const d = new Date(r.startedAt)
    // Only matches with a result count here (no deathmatch, no left match): the minimums, the labels and the K/D all read the same count.
    if (r.result === 'win' || r.result === 'loss' || r.result === 'tie') {
      addResult(weekdayAcc[(d.getDay() + 6) % 7], r.result)
      const h = d.getHours()
      const dp = dayAcc[h < 6 ? 'nuit' : h < 12 ? 'matin' : h < 18 ? 'aprem' : 'soir']
      addResult(dp, r.result)
      dp.kills += r.kills
      dp.deaths += r.deaths
    }

    // Rounds that Player X saw (having `side`)
    const pr = PISTOL_ROUNDS[r.mode]
    for (const rd of r.rounds ?? []) {
      if (!hasSide(rd)) continue
      const k = rd.kills ?? 0
      const won = rd.winner === rd.side
      const s = sides[rd.side]
      s.rounds++
      if (won) s.won++
      s.kills += k
      sideRounds++
      sideKills += k
      if (k >= 1) roundsWithKill++
      const mm = rd.side === 'CT' ? m.ct : m.t
      mm.rounds++
      if (won) mm.won++
      if (pr && pr.includes(rd.n)) {
        pistol.played++
        if (won) pistol.won++
      }
      const key = (END_KEYS as readonly string[]).includes(rd.end) ? rd.end : 'other'
      ends[won ? 'won' : 'lost'][key]++
    }
  }

  const sideOut = (s: { rounds: number; won: number; kills: number }): Cs2SideOut => ({ rounds: s.rounds, won: s.won, kills: s.kills, winPct: pct(s.won, s.rounds), kpr: div(s.kills, s.rounds) })
  const sideMini = (s: { rounds: number; won: number }): Cs2SideMini => ({ rounds: s.rounds, won: s.won, winPct: pct(s.won, s.rounds) })

  const form = list.slice(0, 20).reverse().map((r): Cs2FormLetter => (r.result === 'win' ? 'W' : r.result === 'loss' ? 'L' : r.result === 'tie' ? 'T' : '-'))

  // The streak only looks at matches with an outcome: a deathmatch or a left match neither breaks nor starts it.
  const outcomes = list.filter((r) => r.result === 'win' || r.result === 'loss' || r.result === 'tie')
  const first = outcomes[0]
  const streak: Cs2Streak = { type: first?.result === 'win' ? 'W' : first?.result === 'loss' ? 'L' : null, n: 0 }
  if (streak.type) {
    const want = streak.type === 'W' ? 'win' : 'loss'
    for (const r of outcomes) {
      if (r.result !== want) break
      streak.n++
    }
  }

  // The last 10 matches with a result against the 10 before; 5 on each side at least (same threshold as the period comparison).
  const gNow = outcomes.slice(0, 10)
  const gBefore = outcomes.slice(10, 20)
  let trend: Cs2Trend | null = null
  if (gNow.length >= 5 && gBefore.length >= 5) {
    const a = groupStats(gNow)
    const b = groupStats(gBefore)
    trend = {
      n: { now: gNow.length, before: gBefore.length },
      adr: { now: a.adr, before: b.adr },
      kd: { now: a.kd, before: b.kd },
      hsPct: { now: a.hsPct, before: b.hsPct },
      winPct: { now: a.winPct, before: b.winPct }
    }
  }

  const dpOut = (t: DayAcc): Cs2DaypartAgg => ({ matches: t.matches, wins: t.wins, winPct: winPctOf(t), kd: kdOf(t.kills, t.deaths, t.matches) })

  return {
    n,
    wins: total.wins,
    losses: total.losses,
    ties: total.ties,
    other,
    winPct: winPctOf(total),
    kills,
    deaths,
    assists,
    mvps,
    kd: kdOf(kills, deaths, n),
    kdRounds: kdOf(rKills, rDeaths, rCount),
    ranked: total.wins + total.losses + total.ties,
    adr: div(dmg, dmgRounds),
    hsPct: pct(hs, trackedKills),
    kpr: div(sideKills, sideRounds),
    form,
    streak,
    multi,
    bestRound,
    bestMatch,
    sides: { CT: sideOut(sides.CT), T: sideOut(sides.T) },
    pistol: { played: pistol.played, won: pistol.won, winPct: pct(pistol.won, pistol.played) },
    ends,
    roundsWithKill: pct(roundsWithKill, sideRounds),
    maps: [...mapAcc.values()]
      .map((m): Cs2MapAgg => ({
        id: m.id, matches: m.matches, wins: m.wins, losses: m.losses, ties: m.ties, winPct: winPctOf(m),
        ranked: m.wins + m.losses + m.ties, kills: m.kills, deaths: m.deaths, kd: kdOf(m.kills, m.deaths, m.matches), kdRounds: kdOf(m.rKills, m.rDeaths, m.rCount), adr: div(m.dmg, m.dmgRounds), hsPct: pct(m.hs, m.tk),
        ct: sideMini(m.ct), t: sideMini(m.t)
      }))
      .sort((a, b) => b.matches - a.matches || a.id.localeCompare(b.id)),
    modes: [...modeAcc.values()]
      .map((m): Cs2ModeAgg => ({ mode: m.mode, matches: m.matches, wins: m.wins, winPct: winPctOf(m) }))
      .sort((a, b) => b.matches - a.matches || a.mode.localeCompare(b.mode)),
    weekdays: weekdayAcc.map((t): Cs2WeekdayAgg => ({ matches: t.matches, wins: t.wins, winPct: winPctOf(t) })),
    dayparts: { nuit: dpOut(dayAcc.nuit), matin: dpOut(dayAcc.matin), aprem: dpOut(dayAcc.aprem), soir: dpOut(dayAcc.soir) },
    trend,
    series: [...list].reverse().map((r): Cs2SeriesPoint => ({
      id: r.id, at: r.startedAt, map: r.map, mode: r.mode, result: r.result, score: r.score ?? null,
      kills: r.kills, deaths: r.deaths, kd: kdOf(r.kills, r.deaths),
      adr: r.hasRounds && r.roundsTracked > 0 ? r.damage / r.roundsTracked : null,
      hsPct: pct(r.headshots, r.trackedKills)
    }))
  }
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Recaps of the current account that are real: those of another `steamId` are dropped (when `steamId` is a
 * non-empty string; otherwise all are kept) and so are the samples (`sample === true`).
 */
export function cs2Own<T extends { steamId?: string; sample?: boolean }>(recaps: readonly T[], steamId?: string | null): T[] {
  const list: readonly T[] = Array.isArray(recaps) ? (recaps as readonly T[]) : []
  return list.filter((r) => r && r.sample !== true && !(typeof steamId === 'string' && steamId !== '' && r.steamId !== steamId))
}

/** The five CS2 views, as the sample generator builds `agg.cs2`: all, last 30 / 7 days, and the 30 / 7 days before. */
export function cs2Views(recaps: readonly Cs2AggRecap[], now: number): Cs2Views {
  return {
    all: cs2Agg(recaps, { now }),
    d30: cs2Agg(recaps, { now, days: 30 }),
    d7: cs2Agg(recaps, { now, days: 7 }),
    p30: cs2Agg(recaps.filter((r) => r.endedAt < now - 30 * DAY), { now: now - 30 * DAY, days: 30 }),
    p7: cs2Agg(recaps.filter((r) => r.endedAt < now - 7 * DAY), { now: now - 7 * DAY, days: 7 })
  }
}

// ---------------------------------------------------------------------------------------------------------------

const TOTAL_ROW = /^(all|tous|toutes|total)$/i

/** Merge rows with the same name: matches and wins add up, win % is weighted by matches. */
function mergePlaces(rows: readonly Bf6Row[] | undefined, dropNames: string[] = []): Bf6PlaceAgg[] {
  const acc = new Map<string, { name: string; image: string | undefined; matches: number; wins: number; weighted: number; known: number }>()
  for (const r of rows ?? []) {
    const name = String(r.name ?? '').trim()
    if (!name || TOTAL_ROW.test(name) || dropNames.includes(name)) continue
    const matches = isNum(r.matches) ? r.matches : 0
    const rate = isNum(r.winPercent) ? r.winPercent : isNum(r.wins) && matches > 0 ? (r.wins / matches) * 100 : null
    const wins = isNum(r.wins) ? r.wins : rate !== null ? (rate / 100) * matches : 0
    let a = acc.get(name)
    if (!a) acc.set(name, (a = { name, image: r.image, matches: 0, wins: 0, weighted: 0, known: 0 }))
    a.image ??= r.image
    a.matches += matches
    a.wins += wins
    if (rate !== null) {
      a.weighted += rate * matches
      a.known += matches
    }
  }
  return [...acc.values()]
    .map((a): Bf6PlaceAgg => ({ name: a.name, image: a.image, matches: a.matches, wins: a.wins, winPct: div(a.weighted, a.known) }))
    .sort((x, y) => y.matches - x.matches || x.name.localeCompare(y.name))
}

/** Difference between the last and the first point of the window (rule of deltaOf in cs2Lifetime.ts). */
function bf6Delta(history: Bf6AggPoint[], days: number, now: number): Bf6Delta | null {
  const since = now - days * DAY
  const inRange = history.filter((p) => p.at >= since && p.at <= now)
  const before = history.filter((p) => p.at < since && p.at >= since - Math.max(2, days / 2) * DAY).at(-1)
  const points = before ? [before, ...inRange] : inRange
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last || points.length < 2 || dayKey(first.at) === dayKey(last.at)) return null
  /** A total that goes down is ignored (null), not counted as negative. */
  const d = (k: keyof Bf6AggPoint): number | null => (isNum(first[k]) && isNum(last[k]) && last[k] >= first[k] ? last[k] - first[k] : null)
  const kills = d('kills'), deaths = d('deaths'), matches = d('matches'), wins = d('wins'), losses = d('losses'), secs = d('secondsPlayed')
  return {
    days: Math.max(1, Math.round((last.at - first.at) / DAY)),
    kills, deaths, matches, wins, losses,
    hours: secs === null ? null : secs / 3600,
    kd: kills !== null ? div(kills, deaths) : null,
    winPct: wins !== null && losses !== null ? pct(wins, wins + losses) : null,
    kpm: kills !== null && secs !== null ? div(kills, secs / 60) : null
  }
}

/**
 * Battlefield 6 aggregates.
 * @param stats
 * @param history oldest first
 * @param recaps newest first
 * @param opts `now` is required
 */
export function bf6Agg(stats: Bf6AggStats, history: readonly Bf6AggPoint[], recaps: readonly Bf6AggRecap[], { now }: { now: number }): Bf6Agg {
  if (!isNum(now)) throw new TypeError('bf6Agg: `now` is required')
  const s = stats
  const hist: Bf6AggPoint[] = (Array.isArray(history) ? (history as readonly Bf6AggPoint[]).filter((p) => p && isNum(p.at)) : []).sort((a, b) => a.at - b.at)
  const recs: Bf6AggRecap[] = Array.isArray(recaps) ? (recaps as readonly Bf6AggRecap[]).filter(Boolean) : []
  const matches = s.matches

  const classRows = (s.classes ?? []).filter((c) => !TOTAL_ROW.test(String(c.name ?? '').trim()))
  const classSecs = classRows.reduce((t, c) => t + (c.secondsPlayed ?? 0), 0)
  const classKills = classRows.reduce((t, c) => t + (c.kills ?? 0), 0)
  const byTime = classSecs > 0
  const classes = classRows.map((c): Bf6ClassAgg => ({
    name: c.name,
    kills: c.kills ?? null,
    kd: isNum(c.killDeath) ? c.killDeath : div(c.kills, c.deaths),
    kpm: isNum(c.kpm) ? c.kpm : div(c.kills, (c.secondsPlayed ?? 0) / 60),
    seconds: c.secondsPlayed ?? null,
    sharePct: byTime ? pct(c.secondsPlayed ?? 0, classSecs) : pct(c.kills ?? 0, classKills)
  }))

  const weaponRows = s.weapons ?? []
  const weaponKills = weaponRows.reduce((t, w) => t + (w.kills ?? 0), 0)
  const weapons = weaponRows
    .map((w): Bf6WeaponAgg => ({
      name: w.name,
      image: w.image,
      kills: w.kills ?? 0,
      kd: isNum(w.killDeath) ? w.killDeath : div(w.kills, w.deaths),
      kpm: isNum(w.kpm) ? w.kpm : div(w.kills, (w.secondsPlayed ?? 0) / 60),
      accuracy: isNum(w.accuracy) ? w.accuracy : null,
      hsPct: pct(w.headshots, w.kills),
      hours: isNum(w.secondsPlayed) ? w.secondsPlayed / 3600 : null,
      sharePct: pct(w.kills ?? 0, weaponKills)
    }))
    .sort((a, b) => b.kills - a.kills)

  const vehicleRows = s.vehicles ?? []
  const vehicleKills = vehicleRows.reduce((t, v) => t + (v.kills ?? 0), 0)
  const vehicles = vehicleRows
    .map((v): Bf6VehicleAgg => ({
      name: v.name,
      image: v.image,
      kills: v.kills ?? 0,
      kpm: isNum(v.kpm) ? v.kpm : div(v.kills, (v.secondsPlayed ?? 0) / 60),
      hours: isNum(v.secondsPlayed) ? v.secondsPlayed / 3600 : null
    }))
    .sort((a, b) => b.kills - a.kills)

  const maps = mergePlaces(s.maps)
  const modes = mergePlaces(s.modes, ['Official'])
  const ranked = maps.filter((m): m is Bf6PlaceAgg & { winPct: number } => m.matches >= 5 && m.winPct !== null)
  const pick = (m: Bf6PlaceAgg | undefined): Bf6PickedMap | null => (m ? { name: m.name, image: m.image, matches: m.matches, winPct: m.winPct } : null)
  // Best: 5+ matches and 50 % at least. Worst: only next to a best, a losing map at least 10 points under it.
  const top = ranked.length ? [...ranked].sort((a, b) => b.winPct - a.winPct || b.matches - a.matches)[0] : undefined
  const low = ranked.length > 1 ? [...ranked].sort((a, b) => a.winPct - b.winPct || b.matches - a.matches)[0] : undefined
  const bestMap = top && top.winPct >= 50 ? pick(top) : null
  const worstMap = top && bestMap && low && low !== top && low.winPct < 50 && top.winPct - low.winPct >= 10 ? pick(low) : null

  const series: Bf6SeriesPoint[] = []
  for (let i = 1; i < hist.length; i++) {
    const a = hist[i - 1]
    const b = hist[i]
    const dk = b.kills - a.kills, dd = b.deaths - a.deaths, dm = b.matches - a.matches
    const dw = b.wins - a.wins, dl = b.losses - a.losses, ds = b.secondsPlayed - a.secondsPlayed
    const ok = dk >= 0 && dd >= 0
    series.push({
      at: b.at,
      kd: ok ? div(dk, dd) : null,
      kdLife: div(b.kills, b.deaths),
      kpm: dk >= 0 && ds > 0 ? dk / (ds / 60) : null,
      winPct: dw >= 0 && dl >= 0 ? pct(dw, dw + dl) : null,
      accuracy: isNum(b.accuracy) ? b.accuracy : null,
      matches: dm >= 0 ? dm : null
    })
  }

  const sessions = recs
    .map((r): Bf6SessionAgg => {
      const kd = isNum(r.killDeath) ? r.killDeath : div(r.kills, r.deaths)
      return {
        id: r.id,
        at: r.startedAt,
        minutes: r.secondsPlayed / 60,
        matches: r.matches,
        wins: r.wins,
        losses: r.losses,
        kills: r.kills,
        deaths: r.deaths,
        kd,
        kpm: isNum(r.killsPerMinute) ? r.killsPerMinute : div(r.kills, r.secondsPlayed / 60),
        kdVsAvg: kd !== null && isNum(r.average?.killDeath) ? kd - r.average.killDeath : null,
        weapon: r.weapon?.name ?? null,
        role: r.role?.name ?? null,
        maps: (r.maps ?? []).map((m) => m.name)
      }
    })
    .sort((a, b) => b.at - a.at)
  const bestSession = sessions.filter((x) => x.matches >= 2 && x.kd !== null).sort((a, b) => (b.kd as number) - (a.kd as number) || b.at - a.at)[0] ?? null

  return {
    kd: isNum(s.killDeath) ? s.killDeath : div(s.kills, s.deaths),
    kpm: isNum(s.killsPerMinute) ? s.killsPerMinute : div(s.kills, s.secondsPlayed / 60),
    winPct: isNum(s.winPercent) ? s.winPercent : pct(s.wins, s.wins + s.losses),
    kills: s.kills,
    deaths: s.deaths,
    wins: s.wins,
    losses: s.losses,
    matches,
    hours: s.secondsPlayed / 3600,
    hsPct: pct(s.headshots, s.kills),
    accuracy: s.accuracy,
    assists: s.assists,
    revives: s.revives,
    perMatch: {
      kills: div(s.kills, matches),
      deaths: div(s.deaths, matches),
      assists: div(s.assists, matches),
      revives: div(s.revives, matches),
      minutes: div(s.secondsPlayed / 60, matches)
    },
    classes,
    weapons,
    vehicles,
    vehicleKillPct: pct(vehicleKills, s.kills),
    maps,
    modes,
    bestMap,
    worstMap,
    deltas: { d7: bf6Delta(hist, 7, now), d30: bf6Delta(hist, 30, now) },
    series,
    sessions,
    bestSession
  }
}
