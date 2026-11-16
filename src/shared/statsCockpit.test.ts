// Tests des agrégats de la page Stats (statsCockpit.ts). Lanceur intégré à Node, aucune dépendance :
// node --import ./scripts/test-resolve.mjs --experimental-strip-types --test src/shared/statsCockpit.test.ts
// Hand-written tiny inputs; every expected value is worked out in the comment above the assertion.
import test from 'node:test'
import assert from 'node:assert/strict'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { bf6Agg, cs2Agg, cs2Own, cs2Views } from './statsCockpit.ts'
import type { Bf6AggPoint, Bf6AggStats } from './statsCockpit'
import type { Cs2Recap, Cs2Round, Cs2Side } from './types'

// Local-time rules (weekdays, dayparts, same-day rule) depend on the TZ: fix it before any Date is used
// (the module reads no Date when it loads).
process.env.TZ = 'UTC'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 15, 12, 0) // Sunday 15 Nov 2026, 12:00 UTC
const near = (a: number | null, b: number, eps = 1e-9): void => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} != ${b}`)

let seq = 0
/** A minimal recap. startedAt defaults to a strictly increasing date. */
function rc(o: Partial<Cs2Recap> = {}): Cs2Recap {
  seq++
  const startedAt = o.startedAt ?? NOW - 100 * DAY + seq * 3_600_000
  return {
    id: `cs2-${seq}`, steamId: '1', map: 'de_mirage', mode: 'competitive', startedAt, endedAt: startedAt + 40 * 60_000,
    result: 'win', kills: 0, deaths: 0, assists: 0, mvps: 0, points: 0, headshots: 0, damage: 0, trackedKills: 0, roundsTracked: 0,
    multi: { k3: 0, k4: 0, k5: 0 }, rounds: [], hasRounds: true, ...o
  }
}
const rd = (n: number, side: Cs2Side, winner: Cs2Side, end = 'elimination', kills?: number): Cs2Round => ({ n, side, winner, end: end as Cs2Round['end'], ...(kills === undefined ? {} : { kills }) })

test('empty input: every ratio is null, not 0 or NaN', () => {
  const a = cs2Agg([], { now: NOW })
  assert.equal(a.n, 0)
  for (const k of ['winPct', 'kd', 'adr', 'hsPct', 'kpr', 'bestRound', 'bestMatch', 'trend', 'roundsWithKill'] as const) assert.equal(a[k], null, k)
  assert.deepEqual(a.streak, { type: null, n: 0 })
  assert.deepEqual(a.form, [])
  assert.deepEqual(a.series, [])
  assert.equal(a.sides.CT.winPct, null)
  assert.equal(a.sides.T.kpr, null)
  assert.equal(a.pistol.winPct, null)
  assert.equal(a.weekdays.length, 7)
  assert.ok(a.weekdays.every((d) => d.matches === 0 && d.winPct === null))
  assert.equal(a.dayparts.soir.kd, null)
  assert.equal(a.dayparts.soir.winPct, null)
  assert.deepEqual(a.maps, [])
  assert.equal(JSON.stringify(a).includes('NaN'), false)

  const e = bf6Agg(
    { kills: 0, deaths: 0, killDeath: 0, killsPerMinute: 0, wins: 0, losses: 0, winPercent: 0, accuracy: 0, headshots: 0, assists: 0, revives: 0, matches: 0, secondsPlayed: 0, weapons: [], vehicles: [], classes: [], modes: [], maps: [] },
    [], [], { now: NOW }
  )
  assert.equal(e.hsPct, null)
  assert.equal(e.vehicleKillPct, null)
  assert.equal(e.perMatch.kills, null)
  assert.equal(e.perMatch.minutes, null)
  assert.equal(e.bestMap, null)
  assert.equal(e.worstMap, null)
  assert.deepEqual(e.deltas, { d7: null, d30: null })
  assert.equal(e.bestSession, null)
})

test('K/D without deaths is the kill count; ADR and HS% use only their own denominators', () => {
  // A: 30 kills 0 death. adr: 1600 dmg / 20 rounds. B: partial, 800 dmg / 10 rounds. C: deathmatch (hasRounds false), ignored by ADR.
  // adr = (1600 + 800) / (20 + 10) = 80. kd = 30+20+40 = 90 kills / 10 deaths = 9. hs = (10 + 4) / (20 + 10) = 46.666...
  const a = cs2Agg([
    rc({ kills: 30, deaths: 0, damage: 1600, roundsTracked: 20, headshots: 10, trackedKills: 20 }),
    rc({ kills: 20, deaths: 10, damage: 800, roundsTracked: 10, headshots: 4, trackedKills: 10, partial: true }),
    rc({ kills: 40, deaths: 0, hasRounds: false, mode: 'deathmatch', result: 'done', damage: 999, roundsTracked: 0 })
  ], { now: NOW })
  near(a.adr, 80)
  near(a.kd, 9)
  near(a.hsPct, (14 / 30) * 100)
  assert.equal(a.other, 1)
  // only deathmatch: no ADR, no HS%
  const dm = cs2Agg([rc({ kills: 40, deaths: 20, hasRounds: false, mode: 'deathmatch', result: 'done' })], { now: NOW })
  assert.equal(dm.adr, null)
  assert.equal(dm.hsPct, null)
  assert.equal(dm.winPct, null) // no win/loss/tie
  assert.equal(dm.bestMatch, null) // hasRounds false
  near(dm.kd, 2)
})

test('pistol rounds: 1 and 13 in competitive/premier, 1 and 9 in wingman, only rounds having a side', () => {
  const comp = rc({
    mode: 'competitive',
    // n=1 CT wins (won, pistol) ; n=2 not pistol ; n=9 not pistol in competitive ; n=13 T side, CT wins (lost, pistol) ;
    // n=13 without side: ignored
    rounds: [rd(1, 'CT', 'CT'), rd(2, 'CT', 'T'), rd(9, 'T', 'T'), rd(13, 'T', 'CT'), { n: 13, winner: 'CT', end: 'elimination' }]
  })
  const wing = rc({
    mode: 'scrimcomp2v2',
    // n=1 won (pistol) ; n=9 lost (pistol) ; n=13 won but not a pistol in wingman ; n=8 not a pistol
    rounds: [rd(1, 'CT', 'CT'), rd(9, 'T', 'CT'), rd(13, 'T', 'T'), rd(8, 'CT', 'CT')]
  })
  const casual = rc({ mode: 'casual', rounds: [rd(1, 'CT', 'CT'), rd(13, 'T', 'T')] }) // no pistol rule for this mode
  const prem = rc({ mode: 'premier', rounds: [rd(13, 'CT', 'CT')] }) // premier: 13 is a pistol, won
  assert.deepEqual(cs2Agg([comp], { now: NOW }).pistol, { played: 2, won: 1, winPct: 50 })
  assert.deepEqual(cs2Agg([wing], { now: NOW }).pistol, { played: 2, won: 1, winPct: 50 })
  assert.deepEqual(cs2Agg([casual], { now: NOW }).pistol, { played: 0, won: 0, winPct: null })
  assert.deepEqual(cs2Agg([prem], { now: NOW }).pistol, { played: 1, won: 1, winPct: 100 })
  // all together: played 2 + 2 + 0 + 1 = 5, won 1 + 1 + 0 + 1 = 3 -> 60 %
  assert.deepEqual(cs2Agg([comp, wing, casual, prem], { now: NOW }).pistol, { played: 5, won: 3, winPct: 60 })
})

test('sides, kills per round, rounds with a kill and round endings', () => {
  const r = rc({
    rounds: [
      rd(1, 'CT', 'CT', 'elimination', 2), // CT won, 2 kills
      rd(2, 'CT', 'T', 'bomb', 0), // CT lost to a bomb
      rd(3, 'T', 'T', 'bomb', 1), // T won (bomb), 1 kill
      rd(4, 'T', 'CT', 'defuse', 0), // T lost to a defuse
      rd(5, 'T', 'CT', 'time', 3), // T lost on time, 3 kills
      { n: 6, winner: 'T', end: 'elimination' }, // not tracked: ignored everywhere
      rd(7, 'CT', 'CT', 'weird', 0) // unknown ending -> 'other', CT won
    ]
  })
  const a = cs2Agg([r], { now: NOW })
  // CT: rounds 1, 2, 7 -> 3 rounds, won 2 (1 and 7), kills 2 -> 66.67 %, kpr 0.6667
  assert.equal(a.sides.CT.rounds, 3)
  assert.equal(a.sides.CT.won, 2)
  assert.equal(a.sides.CT.kills, 2)
  near(a.sides.CT.winPct, 200 / 3)
  near(a.sides.CT.kpr, 2 / 3)
  // T: rounds 3, 4, 5 -> 3 rounds, won 1, kills 4 -> 33.33 %, kpr 1.3333
  assert.equal(a.sides.T.rounds, 3)
  assert.equal(a.sides.T.won, 1)
  assert.equal(a.sides.T.kills, 4)
  near(a.sides.T.winPct, 100 / 3)
  near(a.sides.T.kpr, 4 / 3)
  // 6 tracked rounds, 6 kills -> kpr 1 ; rounds with kill: 1, 3, 5 -> 3 / 6 = 50 %
  near(a.kpr, 1)
  near(a.roundsWithKill, 50)
  // won: elimination (r1), bomb (r3), other (r7). lost: bomb (r2), defuse (r4), time (r5)
  assert.deepEqual(a.ends.won, { elimination: 1, bomb: 1, defuse: 0, time: 0, hostage: 0, other: 1 })
  assert.deepEqual(a.ends.lost, { elimination: 0, bomb: 1, defuse: 1, time: 1, hostage: 0, other: 0 })
  // per map copy of the sides
  assert.deepEqual(a.maps[0].ct, { rounds: 3, won: 2, winPct: (2 / 3) * 100 })
})

test('streak counts from the newest match; a tie or an other result breaks it; form is oldest -> newest', () => {
  const t0 = NOW - 10 * DAY
  const mk = (i: number, result: Cs2Recap['result']) => rc({ startedAt: t0 + i * 3_600_000, result })
  // chronological: loss, win, tie, win, win -> newest first given to the function
  const list = [mk(4, 'win'), mk(3, 'win'), mk(2, 'tie'), mk(1, 'win'), mk(0, 'loss')]
  const a = cs2Agg(list, { now: NOW })
  assert.deepEqual(a.form, ['L', 'W', 'T', 'W', 'W'])
  assert.deepEqual(a.streak, { type: 'W', n: 2 }) // stopped by the tie
  assert.equal(a.wins, 3); assert.equal(a.losses, 1); assert.equal(a.ties, 1)
  near(a.winPct, 60) // 3 / (3 + 1 + 1)
  // newest is a tie -> no streak
  assert.deepEqual(cs2Agg([mk(5, 'tie'), ...list], { now: NOW }).streak, { type: null, n: 0 })
  // newest is a loss, then another loss, then a win -> L2 ; 'left' shows as '-'
  const b = cs2Agg([mk(3, 'loss'), mk(2, 'loss'), mk(1, 'win'), mk(0, 'left')], { now: NOW })
  assert.deepEqual(b.streak, { type: 'L', n: 2 })
  assert.deepEqual(b.form, ['-', 'W', 'L', 'L'])
  assert.equal(b.other, 1)
  near(b.winPct, 100 / 3) // 1 / (1 + 2 + 0): `left` is not in the denominator
  // 25 wins: form keeps the last 20, the streak counts them all
  const many = Array.from({ length: 25 }, (_, i) => mk(24 - i, 'win'))
  const c = cs2Agg(many, { now: NOW })
  assert.equal(c.form.length, 20)
  assert.equal(c.streak.n, 25)
  // the input order does not matter
  assert.deepEqual(cs2Agg([...list].reverse(), { now: NOW }).form, ['L', 'W', 'T', 'W', 'W'])
})

test('trend: null unless both groups have at least 5 matches with a result; deathmatch and left matches are ignored', () => {
  const t0 = NOW - 20 * DAY
  // chronological index i; the newest 10 are i = k-10..k-1
  const build = (count: number, nowGroup = 10): Cs2Recap[] => {
    const list: Cs2Recap[] = []
    for (let i = 0; i < count; i++) {
      const isNow = i >= count - nowGroup
      // newest group: 10 kills / 5 deaths, 800 dmg over 10 rounds, 4 hs of 10, win.
      // older group: 6 kills / 6 deaths, 500 dmg over 10 rounds, 1 hs of 10, win for even i (3 of 6) else loss.
      list.push(rc(isNow
        ? { startedAt: t0 + i * 3_600_000, kills: 10, deaths: 5, damage: 800, roundsTracked: 10, headshots: 4, trackedKills: 10, result: 'win' }
        : { startedAt: t0 + i * 3_600_000, kills: 6, deaths: 6, damage: 500, roundsTracked: 10, headshots: 1, trackedKills: 10, result: i % 2 === 0 ? 'win' : 'loss' }))
    }
    // a deathmatch newer than everything must not shift the groups
    list.push(rc({ startedAt: t0 + 999 * 3_600_000, hasRounds: false, mode: 'deathmatch', result: 'done', kills: 50, deaths: 1 }))
    return list.reverse()
  }
  assert.equal(cs2Agg(build(11), { now: NOW + 30 * DAY }).trend, null) // before-group has 1
  assert.equal(cs2Agg(build(14), { now: NOW + 30 * DAY }).trend, null) // 4 < 5
  assert.deepEqual(cs2Agg(build(15), { now: NOW + 30 * DAY }).trend!.n, { now: 10, before: 5 }) // 5 per side is enough
  const t = cs2Agg(build(16), { now: NOW + 30 * DAY }).trend! // 10 vs 6
  assert.deepEqual(t.n, { now: 10, before: 6 })
  near(t.adr.now, 80); near(t.adr.before, 50) // 800/10 ; 500/10
  near(t.kd.now, 2); near(t.kd.before, 1) // 10/5 ; 6/6
  near(t.hsPct.now, 40); near(t.hsPct.before, 10) // 4/10 ; 1/10
  near(t.winPct.now, 100)
  // older six are i = 0..5 -> wins at 0, 2, 4 = 3 of 6 -> 50 %
  near(t.winPct.before, 50)
  // only 10 matches: the before-group is empty
  assert.equal(cs2Agg(build(10), { now: NOW + 30 * DAY }).trend, null)
})

test('weekdays and dayparts count matches with a result only (no deathmatch, no left match, no K/D from them)', () => {
  const at = (h: number, result: Cs2Recap['result'], kills: number, deaths: number) => rc({ startedAt: Date.UTC(2026, 10, 16, h, 0), endedAt: Date.UTC(2026, 10, 16, h, 30), result, kills, deaths })
  const a = cs2Agg([at(13, 'win', 10, 5), at(14, 'done', 40, 1), at(15, 'left', 3, 3)], { now: NOW + 5 * DAY })
  assert.deepEqual(a.weekdays[0], { matches: 1, wins: 1, winPct: 100 })
  assert.deepEqual(a.dayparts.aprem, { matches: 1, wins: 1, winPct: 100, kd: 2 })
})

test('BF6 best map needs 50 %, worst map needs a best and a losing map 10 points under it', () => {
  const m = (name: string, matches: number, winPercent: number) => ({ id: name, name, matches, wins: Math.round(matches * winPercent / 100), winPercent })
  const r = (maps: ReturnType<typeof m>[]) => bf6Agg(baseStats({ maps }), [], [], { now: NOW })
  const a = r([m('A', 10, 30), m('B', 10, 20)])
  assert.equal(a.bestMap, null); assert.equal(a.worstMap, null) // nothing reaches 50 %: no best, so no worst
  const b = r([m('A', 10, 70), m('B', 10, 65)])
  assert.equal(b.bestMap!.name, 'A'); assert.equal(b.worstMap, null) // 65 % is not a losing map
  const c = r([m('A', 10, 70), m('B', 10, 40)])
  assert.equal(c.worstMap!.name, 'B')
  const d = r([m('A', 10, 52), m('B', 10, 45)])
  assert.equal(d.worstMap, null) // under 10 points apart
})

test('days window: endedAt >= now - days * 86400000 (boundary included, one ms earlier excluded)', () => {
  const at = (endedAt: number) => rc({ startedAt: endedAt - 1000, endedAt })
  const list = [at(NOW - 1 * DAY), at(NOW - 7 * DAY), at(NOW - 7 * DAY - 1), at(NOW - 29 * DAY), at(NOW - 30 * DAY - 1)]
  assert.equal(cs2Agg(list, { now: NOW }).n, 5) // days 0 = all
  assert.equal(cs2Agg(list, { now: NOW, days: 7 }).n, 2) // -1 d and exactly -7 d
  assert.equal(cs2Agg(list, { now: NOW, days: 30 }).n, 4) // all but the one 30 d + 1 ms ago
  assert.throws(() => cs2Agg(list, { days: 7 }), TypeError)
})

test('weekdays (Monday first) and dayparts use the local start time', () => {
  // 2026-11-16 is a Monday (the 15th is a Sunday, see NOW). TZ is UTC in this file.
  const at = (d: number, h: number, m: number, result: Cs2Recap['result'], kills: number, deaths: number) => rc({ startedAt: Date.UTC(2026, 10, d, h, m), endedAt: Date.UTC(2026, 10, d, h, m + 30), result, kills, deaths })
  const list = [
    at(16, 5, 59, 'win', 10, 5), // Monday, nuit (0-6)
    at(16, 6, 0, 'loss', 4, 8), // Monday, matin (starts at 6)
    at(15, 12, 0, 'win', 20, 10), // Sunday, aprem (starts at 12)
    at(15, 17, 59, 'tie', 0, 0), // Sunday, aprem
    at(15, 18, 0, 'win', 15, 5), // Sunday, soir (starts at 18)
    at(15, 23, 59, 'loss', 5, 5) // Sunday, soir
  ]
  const a = cs2Agg(list, { now: NOW + 5 * DAY })
  assert.deepEqual(a.weekdays[0], { matches: 2, wins: 1, winPct: 50 }) // Monday: win + loss
  assert.deepEqual(a.weekdays[6], { matches: 4, wins: 2, winPct: 50 }) // Sunday: 2 wins, 1 tie, 1 loss -> 2/4
  assert.deepEqual(a.weekdays[1], { matches: 0, wins: 0, winPct: null })
  assert.deepEqual(a.dayparts.nuit, { matches: 1, wins: 1, winPct: 100, kd: 2 })
  assert.deepEqual(a.dayparts.matin, { matches: 1, wins: 0, winPct: 0, kd: 0.5 })
  assert.equal(a.dayparts.aprem.matches, 2)
  near(a.dayparts.aprem.winPct, 50) // win + tie -> 1 / 2
  near(a.dayparts.aprem.kd, 2) // 20 / 10
  near(a.dayparts.soir.kd, 2) // 20 / 10
  near(a.dayparts.soir.winPct, 50)
})

test('maps, modes, best round and best match', () => {
  const list = [
    rc({ map: 'de_nuke', mode: 'competitive', result: 'loss', kills: 10, deaths: 20, best: { n: 5, kills: 4, damage: 300 } }),
    rc({ map: 'de_mirage', mode: 'premier', result: 'win', kills: 25, deaths: 10, best: { n: 9, kills: 4, damage: 350 } }),
    rc({ map: 'de_mirage', mode: 'competitive', result: 'win', kills: 22, deaths: 11, best: { n: 2, kills: 3, damage: 400 } }),
    rc({ map: 'de_mirage', mode: 'competitive', result: 'tie', kills: 18, deaths: 18 }),
    rc({ map: 'de_nuke', mode: 'deathmatch', hasRounds: false, result: 'done', kills: 60, deaths: 30 })
  ].reverse().map((r, i, arr) => ({ ...r, startedAt: NOW - 50 * DAY + (arr.length - i) * 3_600_000, endedAt: NOW - 50 * DAY + (arr.length - i) * 3_600_000 + 1 }))
  // the list above is "newest first" after the reverse + re-dating; rebuild expectations from the objects
  const a = cs2Agg(list, { now: NOW })
  const { bestRound, bestMatch } = a as { bestRound: NonNullable<typeof a.bestRound>; bestMatch: NonNullable<typeof a.bestMatch> }
  assert.equal(a.maps[0].id, 'de_mirage') // 3 matches before de_nuke's 2
  const mirage = a.maps[0]
  assert.equal(mirage.matches, 3); assert.equal(mirage.wins, 2); assert.equal(mirage.ties, 1)
  near(mirage.winPct, (2 / 3) * 100) // 2 / (2 + 0 + 1)
  assert.equal(mirage.kills, 65); assert.equal(mirage.deaths, 39)
  near(mirage.kd, 65 / 39)
  const nuke = a.maps[1]
  assert.equal(nuke.matches, 2); assert.equal(nuke.wins, 0)
  near(nuke.winPct, 0) // 0 / (0 + 1 + 0)
  assert.equal(nuke.kills, 70)
  assert.deepEqual(a.modes.map((m) => [m.mode, m.matches]), [['competitive', 3], ['deathmatch', 1], ['premier', 1]])
  // best round: 4 kills / 350 dmg beats 4 kills / 300 dmg; 3 kills / 400 loses on kills
  assert.equal(bestRound.kills, 4); assert.equal(bestRound.damage, 350); assert.equal(bestRound.map, 'de_mirage'); assert.equal(bestRound.n, 9)
  // best match: 25 kills (the 60-kill deathmatch is not round-based)
  assert.equal(bestMatch.kills, 25); assert.equal(bestMatch.map, 'de_mirage'); near(bestMatch.kd, 2.5)
  assert.equal(bestMatch.adr, null) // roundsTracked 0 in this fixture
})

test('BF6 deltas: window start may be a point just before the window; a total that goes down is ignored', () => {
  const pt = (daysAgo: number, kills: number, deaths: number, wins: number, losses: number, matches: number, secondsPlayed: number): Bf6AggPoint => ({ at: NOW - daysAgo * DAY, kills, deaths, wins, losses, matches, secondsPlayed, killsPerMinute: 1, accuracy: 20 })
  const history: Bf6AggPoint[] = [
    pt(35, 1000, 500, 50, 40, 90, 36000), // A: 35 d ago: within [45, 30[ -> may start the 30-day window
    pt(20, 1100, 540, 54, 42, 96, 39600), // B
    pt(8, 1180, 590, 58, 45, 103, 43200), // C: 8 d ago: just before the 7-day window; allowed start if it is within max(2, 7/2) = 3.5 d before it (>= 10.5 d ago)
    pt(3, 1250, 585, 61, 47, 108, 46800), // D: deaths 585 < C's 590 (an intermediate point: only the first and last points of the window count)
    pt(0, 1300, 640, 64, 49, 113, 50400) // E: now
  ]
  const stats = { kills: 1300, deaths: 640, killDeath: 2.03, killsPerMinute: 1.5, wins: 64, losses: 49, winPercent: 56.6, accuracy: 20, headshots: 100, assists: 0, revives: 0, matches: 113, secondsPlayed: 50400, weapons: [], vehicles: [], classes: [], modes: [], maps: [] }
  const agg = bf6Agg(stats, history, [], { now: NOW })
  const deltas = { d7: agg.deltas.d7!, d30: agg.deltas.d30! }
  // d7: points inside = D, E ; start = C (8 d ago). C -> E: kills 120, deaths 50, matches 10, wins 6, losses 4, 7200 s = 2 h
  assert.equal(deltas.d7.kills, 120); assert.equal(deltas.d7.deaths, 50); assert.equal(deltas.d7.matches, 10)
  assert.equal(deltas.d7.wins, 6); assert.equal(deltas.d7.losses, 4); near(deltas.d7.hours, 2)
  near(deltas.d7.kd, 2.4); near(deltas.d7.winPct, 60); near(deltas.d7.kpm, 1) // 120 kills / 120 min
  assert.equal(deltas.d7.days, 8)
  // d30: B, C, D, E inside + A before (35 d ago is within 15 d before the window start). A -> E
  assert.equal(deltas.d30.kills, 300); assert.equal(deltas.d30.deaths, 140); assert.equal(deltas.d30.matches, 23)
  assert.equal(deltas.d30.wins, 14); assert.equal(deltas.d30.losses, 9); near(deltas.d30.hours, 4)
  near(deltas.d30.kd, 300 / 140); near(deltas.d30.winPct, (14 / 23) * 100); near(deltas.d30.kpm, 300 / 240)
  assert.equal(deltas.d30.days, 35)

  // A start that is too old (> max(2, days/2) days before the window) is not used: only one point inside -> null.
  const old = [pt(20, 10, 5, 1, 1, 2, 600), pt(1, 20, 10, 2, 2, 4, 1200)]
  assert.equal(bf6Agg(stats, old, [], { now: NOW }).deltas.d7, null) // 1 point in the window, the one 20 d ago is too old
  // only one point, or two points on the same local day -> null
  assert.equal(bf6Agg(stats, [pt(0, 1, 1, 1, 1, 1, 60)], [], { now: NOW }).deltas.d30, null)
  const sameDay = [{ ...pt(0, 1, 1, 1, 1, 1, 60), at: NOW - 3_600_000 }, pt(0, 2, 2, 2, 2, 2, 120)]
  assert.equal(bf6Agg(stats, sameDay, [], { now: NOW }).deltas.d7, null)

  // A total that goes down is ignored: deaths 300 -> 290, everything else grows. P is 6 d ago, Q is 1 d ago.
  const down = [
    { at: NOW - 6 * DAY, kills: 500, deaths: 300, wins: 10, losses: 8, matches: 18, secondsPlayed: 1000, killsPerMinute: 1, accuracy: 20 },
    { at: NOW - 1 * DAY, kills: 560, deaths: 290, wins: 13, losses: 8, matches: 21, secondsPlayed: 4600, killsPerMinute: 1, accuracy: 20 }
  ]
  const d = bf6Agg(stats, down, [], { now: NOW }).deltas.d7!
  assert.equal(d.deaths, null) // went down
  assert.equal(d.kd, null) // so no K/D
  assert.equal(d.kills, 60); assert.equal(d.matches, 3); assert.equal(d.wins, 3); assert.equal(d.losses, 0)
  near(d.winPct, 100) // 3 / (3 + 0)
  near(d.hours, 1) // 3600 s
  near(d.kpm, 1) // 60 kills / 60 min
  assert.equal(d.days, 5)
})

test('BF6 series: one entry per pair of points; no play means null period ratios', () => {
  const p = (day: number, kills: number, deaths: number, wins: number, losses: number, matches: number, secondsPlayed: number, accuracy: number): Bf6AggPoint => ({ at: NOW - (10 - day) * DAY, kills, deaths, wins, losses, matches, secondsPlayed, killsPerMinute: 0, accuracy })
  const history = [p(0, 100, 50, 5, 5, 10, 6000, 20), p(1, 130, 60, 7, 6, 13, 7800, 20.5), p(2, 130, 60, 7, 6, 13, 7800, 20.5)]
  const s = bf6Agg({ kills: 130, deaths: 60, killDeath: 2, killsPerMinute: 1, wins: 7, losses: 6, winPercent: 54, accuracy: 20, headshots: 1, assists: 0, revives: 0, matches: 13, secondsPlayed: 7800, weapons: [], vehicles: [], classes: [], modes: [], maps: [] }, history, [], { now: NOW }).series
  assert.equal(s.length, 2)
  // pair 1: +30 kills, +10 deaths, +1800 s (30 min), +2 wins, +1 loss, +3 matches
  near(s[0].kd, 3); near(s[0].kdLife, 130 / 60); near(s[0].kpm, 1); near(s[0].winPct, (2 / 3) * 100)
  assert.equal(s[0].matches, 3); assert.equal(s[0].accuracy, 20.5); assert.equal(s[0].at, history[1].at)
  // pair 2: nothing played
  assert.equal(s[1].kd, null); assert.equal(s[1].kpm, null); assert.equal(s[1].winPct, null); assert.equal(s[1].matches, 0)
  near(s[1].kdLife, 130 / 60)
})

test('BF6 modes: total rows and "Official" dropped, duplicate names merged with a weighted win %', () => {
  const stats = baseStats({
    modes: [
      { id: 'a', name: 'Conquête', matches: 100, wins: 60, winPercent: 60 },
      { id: 'b', name: 'Percée', matches: 10, wins: 5, winPercent: 50 },
      { id: 'c', name: 'Conquête', matches: 50, wins: 20, winPercent: 40 },
      { id: 'd', name: 'Official', matches: 160, wins: 85, winPercent: 53 },
      { id: 'e', name: 'Total', matches: 160 }
    ]
  })
  const { modes } = bf6Agg(stats, [], [], { now: NOW })
  assert.equal(modes.length, 2)
  // Conquête: 100 + 50 = 150 matches, 60 + 20 = 80 wins, win % = (60 * 100 + 40 * 50) / 150 = 53.333...
  assert.equal(modes[0].name, 'Conquête'); assert.equal(modes[0].matches, 150); assert.equal(modes[0].wins, 80)
  near(modes[0].winPct, 8000 / 150)
  assert.equal(modes[1].name, 'Percée'); near(modes[1].winPct, 50)
})

test('BF6 classes: total row excluded, share by seconds played, fallback on kills', () => {
  const withSecs = baseStats({
    classes: [
      { id: 't', name: 'Tous', kills: 500, secondsPlayed: 1000 },
      { id: 'a', name: 'Assaut', kills: 300, deaths: 100, killDeath: 3, kpm: 1.5, secondsPlayed: 600 },
      { id: 's', name: 'Soutien', kills: 200, deaths: 100, secondsPlayed: 400 },
      { id: 'y', name: 'TOUTES', kills: 1, secondsPlayed: 5 }
    ]
  })
  const c = bf6Agg(withSecs, [], [], { now: NOW }).classes
  assert.deepEqual(c.map((x) => x.name), ['Assaut', 'Soutien']) // "Tous" and "TOUTES" dropped (case-insensitive)
  near(c[0].sharePct, 60); near(c[1].sharePct, 40) // 600 / 1000 ; 400 / 1000
  near(c[0].kd, 3); near(c[0].kpm, 1.5)
  near(c[1].kd, 2) // killDeath missing: 200 / 100
  near(c[1].kpm, 200 / (400 / 60)) // kpm missing: 200 kills / 6.667 min = 30
  // no seconds at all: share of kills (30 / 40 = 75 %)
  const noSecs = baseStats({ classes: [{ id: 'a', name: 'A', kills: 30 }, { id: 'b', name: 'B', kills: 10 }, { id: 't', name: 'All', kills: 40 }] })
  const d = bf6Agg(noSecs, [], [], { now: NOW }).classes
  near(d[0].sharePct, 75); near(d[1].sharePct, 25)
})

test('BF6 weapons, vehicles, best and worst map, sessions', () => {
  const stats = baseStats({
    kills: 1000, deaths: 500, headshots: 250, matches: 10, secondsPlayed: 36000,
    weapons: [
      { id: 'w2', name: 'B', kills: 30, headshots: 15, secondsPlayed: 1800, accuracy: 18 },
      { id: 'w1', name: 'A', kills: 60, deaths: 30, headshots: 30, secondsPlayed: 3600 },
      { id: 'w3', name: 'C', kills: 10, kpm: 0.5 }
    ],
    vehicles: [{ id: 'v1', name: 'Tank', kills: 20, secondsPlayed: 1200 }, { id: 'v2', name: 'Jet', kills: 30, kpm: 2 }],
    maps: [
      { id: '1', name: 'Alpha', matches: 10, wins: 7, winPercent: 70 },
      { id: '2', name: 'Beta', matches: 5, wins: 1, winPercent: 20 },
      { id: '3', name: 'Gamma', matches: 4, wins: 4, winPercent: 100 } // fewer than 5 matches: not ranked
    ]
  })
  const recaps = [
    { id: 'r2', startedAt: NOW - DAY, endedAt: NOW, kills: 20, deaths: 10, matches: 1, wins: 1, losses: 0, secondsPlayed: 1800, killDeath: 9, killsPerMinute: 0.67, average: { killDeath: 1.8 }, weapon: { name: 'A' }, role: { name: 'Assaut' }, maps: [{ name: 'Alpha' }] },
    { id: 'r1', startedAt: NOW - 3 * DAY, endedAt: NOW - 3 * DAY + 1, kills: 50, deaths: 20, matches: 3, wins: 2, losses: 1, secondsPlayed: 6000, killDeath: 2.5, killsPerMinute: 0.5, average: { killDeath: 1.8 }, maps: [{ name: 'Beta' }, { name: 'Alpha' }] }
  ]
  const a = bf6Agg(stats, [], recaps, { now: NOW })
  assert.deepEqual(a.weapons.map((w) => w.name), ['A', 'B', 'C']) // by kills desc
  near(a.weapons[0].sharePct, 60) // 60 / (60 + 30 + 10)
  near(a.weapons[0].kd, 2) // 60 / 30
  near(a.weapons[0].hsPct, 50); near(a.weapons[0].hours, 1); near(a.weapons[0].kpm, 1) // 60 kills / 60 min
  assert.equal(a.weapons[1].kd, null) // no deaths field
  near(a.weapons[1].kpm, 1) // 30 / 30 min
  near(a.weapons[2].kpm, 0.5); assert.equal(a.weapons[2].hsPct, null)
  assert.deepEqual(a.vehicles.map((v) => v.name), ['Jet', 'Tank'])
  near(a.vehicleKillPct, 5) // (20 + 30) / 1000 kills
  assert.equal(a.bestMap!.name, 'Alpha'); assert.equal(a.worstMap!.name, 'Beta')
  // sessions: newest first, kd - average
  assert.deepEqual(a.sessions.map((s) => s.id), ['r2', 'r1'])
  near(a.sessions[0].kdVsAvg, 9 - 1.8); near(a.sessions[0].minutes, 30)
  assert.equal(a.sessions[0].weapon, 'A'); assert.equal(a.sessions[1].weapon, null); assert.deepEqual(a.sessions[1].maps, ['Beta', 'Alpha'])
  // best session needs >= 2 matches: r2 (kd 9, 1 match) is out, r1 wins
  assert.equal(a.bestSession!.id, 'r1')
  // fewer than 5 matches everywhere: no best/worst map
  assert.equal(bf6Agg(baseStats({ maps: [{ id: '1', name: 'X', matches: 4, wins: 2, winPercent: 50 }] }), [], [], { now: NOW }).bestMap, null)
  // only one ranked map: a best, but no worst (it would be the same map)
  const one = bf6Agg(baseStats({ maps: [{ id: '1', name: 'X', matches: 6, wins: 3, winPercent: 50 }] }), [], [], { now: NOW })
  assert.equal(one.bestMap!.name, 'X'); assert.equal(one.worstMap, null)
})

function baseStats(o: Partial<Bf6AggStats> = {}): Bf6AggStats {
  return { kills: 100, deaths: 50, killDeath: 2, killsPerMinute: 1, wins: 5, losses: 5, winPercent: 50, accuracy: 20, headshots: 10, assists: 0, revives: 0, matches: 10, secondsPlayed: 6000, weapons: [], vehicles: [], classes: [], modes: [], maps: [], ...o }
}

test('cs2Own: keeps the recaps of the current account, always drops samples', () => {
  const mine = rc({ steamId: 'A' })
  const other = rc({ steamId: 'B' })
  const sample = rc({ steamId: 'A', sample: true })
  const noSteam = rc({ steamId: '' })
  assert.deepEqual(cs2Own([mine, other, sample, noSteam], 'A').map((r) => r.id), [mine.id])
  // no steamId given (empty, undefined, null): every account is kept, but samples are still dropped
  const ids = [mine.id, other.id, noSteam.id]
  assert.deepEqual(cs2Own([mine, other, sample, noSteam], '').map((r) => r.id), ids)
  assert.deepEqual(cs2Own([mine, other, sample, noSteam]).map((r) => r.id), ids)
  assert.deepEqual(cs2Own([mine, other, sample, noSteam], null).map((r) => r.id), ids)
  // `sample: false` is a real recap; the input is not modified
  const real = rc({ steamId: 'A', sample: false })
  const input = [real, sample]
  assert.deepEqual(cs2Own(input, 'A'), [real])
  assert.equal(input.length, 2)
  assert.deepEqual(cs2Own([], 'A'), [])
})

test('cs2Views: all, 30 and 7 days, and the same windows one period earlier', () => {
  const at = (daysAgo: number, kills: number) => rc({ startedAt: NOW - daysAgo * DAY - 1000, endedAt: NOW - daysAgo * DAY, kills, deaths: 1 })
  // ended 2 d ago (in d7, d30), 10 d ago (d30), 20 d ago (d30), 40 d ago (p30 only), 50 d ago (p30 only)
  const list = [at(2, 1), at(10, 2), at(20, 3), at(40, 4), at(50, 5)]
  const v = cs2Views(list, NOW)
  assert.deepEqual(Object.keys(v), ['all', 'd30', 'd7', 'p30', 'p7'])
  assert.equal(v.all.n, 5)
  assert.equal(v.d30.n, 3)
  assert.equal(v.d7.n, 1)
  // p30: endedAt < NOW - 30 d (the 40 and 50 d ones), window [NOW - 60 d, NOW - 30 d]: both
  assert.equal(v.p30.n, 2)
  assert.equal(v.p30.kills, 9)
  // p7: endedAt < NOW - 7 d (10, 20, 40, 50 d ago), window [NOW - 14 d, NOW - 7 d]: only the 10 d one
  assert.equal(v.p7.n, 1)
  assert.equal(v.p7.kills, 2)
  // the views are exactly cs2Agg with the matching options
  assert.deepEqual(v.d30, cs2Agg(list, { now: NOW, days: 30 }))
  assert.deepEqual(v.p7, cs2Agg(list.filter((r) => r.endedAt < NOW - 7 * DAY), { now: NOW - 7 * DAY, days: 7 }))
})

test('cs2Views: empty list gives five empty aggregates, a boundary match is in the window but not in the period before', () => {
  const v = cs2Views([], NOW)
  for (const k of ['all', 'd30', 'd7', 'p30', 'p7'] as const) {
    assert.equal(v[k].n, 0, k)
    assert.equal(v[k].winPct, null, k)
  }
  // endedAt exactly NOW - 7 d: in d7 (>=), not in p7 (< is strict)
  const edge = rc({ endedAt: NOW - 7 * DAY, startedAt: NOW - 7 * DAY - 1000 })
  const e = cs2Views([edge], NOW)
  assert.equal(e.d7.n, 1)
  assert.equal(e.p7.n, 0)
  assert.equal(e.p30.n, 0)
})

test('cs2Own then cs2Views: the usual pipeline ignores samples and other accounts', () => {
  const mk = (steamId: string, daysAgo: number, extra: Partial<Cs2Recap> = {}) => rc({ steamId, startedAt: NOW - daysAgo * DAY - 1000, endedAt: NOW - daysAgo * DAY, kills: 10, deaths: 5, ...extra })
  const list = [mk('A', 1), mk('B', 1), mk('A', 2, { sample: true }), mk('A', 3)]
  const v = cs2Views(cs2Own(list, 'A'), NOW)
  assert.equal(v.all.n, 2)
  assert.equal(v.d7.n, 2)
  near(v.all.kd, 2)
})
