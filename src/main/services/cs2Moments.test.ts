// Tests de la détection des moments de CS2 (npm run test:clips) : ce qui déclenche un clip, et surtout ce qui n'en déclenche pas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readPayload } from './cs2Match'
import { NO_MOMENTS, stepMoments, type Cs2Moment, type MomentsState } from './cs2Moments'

const ME = '76561198000000001'
const MATE = '76561198000000002'

interface P {
  map?: string
  mode?: string
  mapPhase?: string
  round?: number
  phase?: string
  kills?: number
  deaths?: number
  rk?: number
  rhs?: number
  health?: number
  steam?: string
  team?: string
  ct?: number
  t?: number
  noMap?: boolean
}

function payload(p: P): unknown {
  return {
    provider: { appid: 730, steamid: ME },
    ...(p.noMap
      ? {}
      : {
          map: { name: p.map ?? 'de_mirage', mode: p.mode ?? 'competitive', phase: p.mapPhase ?? 'live', round: p.round ?? 0, team_ct: { score: p.ct ?? 0 }, team_t: { score: p.t ?? 0 } },
          round: { phase: p.phase ?? 'live' }
        }),
    player: {
      steamid: p.steam ?? ME,
      team: p.team ?? 'CT',
      state: { health: p.health ?? 100, money: 800, round_kills: p.rk ?? 0, round_killhs: p.rhs ?? 0, round_totaldmg: 0 },
      match_stats: { kills: p.kills ?? 0, deaths: p.deaths ?? 0, assists: 0, mvps: 0, score: 0 }
    }
  }
}

/** Applique une suite d'envois, rend tous les moments. */
function run(list: P[], from: MomentsState = NO_MOMENTS): { moments: Cs2Moment[]; state: MomentsState } {
  let state = from
  const moments: Cs2Moment[] = []
  list.forEach((p, i) => {
    const snap = readPayload(payload(p))
    assert.ok(snap)
    const r = stepMoments(state, snap, 1000 + i)
    state = r.state
    moments.push(...r.moments)
  })
  return { moments, state }
}

const start: P[] = [
  { phase: 'freezetime', round: 3, kills: 4 },
  { phase: 'live', round: 3, kills: 4 }
]

test('élimination : +1 sur les deux compteurs, un seul moment', () => {
  const { moments } = run([...start, { round: 3, kills: 5, rk: 1 }])
  assert.equal(moments.length, 1)
  const m = moments[0]
  assert.equal(m.kind, 'kill')
  assert.equal(m.kills, 1)
  assert.equal(m.headshots, 0)
  assert.equal(m.roundKills, 1)
  assert.equal(m.map, 'de_mirage')
  assert.equal(m.mode, 'competitive')
  assert.equal(m.round, 4)
  assert.equal(m.at, 1002)
})

test('élimination : un compteur peut arriver un envoi après l’autre, elle ne compte qu’une fois', () => {
  const a = run([...start, { round: 3, kills: 5, rk: 0 }, { round: 3, kills: 5, rk: 1 }]).moments
  assert.deepEqual(a.map((m) => m.kills), [1])
  const b = run([...start, { round: 3, kills: 4, rk: 1 }, { round: 3, kills: 5, rk: 1 }]).moments
  assert.deepEqual(b.map((m) => m.kills), [1])
})

test('headshot : vu avec l’élimination, ou un envoi plus tard', () => {
  const together = run([...start, { round: 3, kills: 5, rk: 1, rhs: 1 }]).moments
  assert.deepEqual(together.map((m) => [m.kind, m.kills, m.headshots]), [['hs', 1, 1]])
  const later = run([...start, { round: 3, kills: 5, rk: 1 }, { round: 3, kills: 5, rk: 1, rhs: 1 }]).moments
  assert.deepEqual(later.map((m) => [m.kind, m.kills, m.headshots]), [['kill', 1, 0], ['hs', 0, 1]])
})

test('multi-kill : à partir de 3 dans le round ; ace à 5, même arrivés d’un coup', () => {
  const m = run([...start, { round: 3, kills: 5, rk: 1 }, { round: 3, kills: 6, rk: 2 }, { round: 3, kills: 7, rk: 3 }, { round: 3, kills: 8, rk: 4 }, { round: 3, kills: 9, rk: 5 }]).moments
  assert.deepEqual(m.map((x) => [x.kind, x.roundKills]), [['kill', 1], ['kill', 2], ['multi', 3], ['multi', 4], ['ace', 5]])
  const burst = run([...start, { round: 3, kills: 8, rk: 4, rhs: 2 }]).moments
  assert.deepEqual(burst.map((x) => [x.kind, x.kills, x.headshots]), [['multi', 4, 2]])
  const ace = run([...start, { round: 3, kills: 9, rk: 5 }]).moments
  assert.deepEqual(ace.map((x) => [x.kind, x.kills]), [['ace', 5]])
})

test('match à mort : pas de multi-kill ni d’ace, le compteur du match suffit', () => {
  const dm: P[] = [{ mode: 'deathmatch', kills: 10, rk: 0 }, { mode: 'deathmatch', kills: 11, rk: 1 }, { mode: 'deathmatch', kills: 12, rk: 2 }, { mode: 'deathmatch', kills: 13, rk: 3 }, { mode: 'deathmatch', kills: 14, rk: 0, deaths: 1 }, { mode: 'deathmatch', kills: 15, rk: 1, deaths: 1 }]
  const m = run(dm).moments
  assert.deepEqual(m.filter((x) => x.kind !== 'death').map((x) => [x.kind, x.kills]), [['kill', 1], ['kill', 1], ['kill', 1], ['kill', 1], ['kill', 1]])
})

test('échauffement : rien ne compte, et sa fin remet les compteurs à zéro sans clip', () => {
  const warm: P[] = [
    { mapPhase: 'warmup', kills: 0, rk: 0 },
    { mapPhase: 'warmup', kills: 6, rk: 6, rhs: 3 },
    { mapPhase: 'warmup', kills: 6, rk: 6, health: 0, deaths: 2 }
  ]
  assert.equal(run(warm).moments.length, 0)
  // Sortie de l'échauffement sans temps d'achat vu : le zéro n'annonce rien, la vraie élimination si.
  const m = run([...warm, { kills: 0, rk: 0 }, { kills: 1, rk: 1 }]).moments
  assert.deepEqual(m.map((x) => x.kills), [1])
})

test('premier envoi vu en pleine partie : référence, pas de clip', () => {
  assert.equal(run([{ round: 8, kills: 12, rk: 2, rhs: 1 }]).moments.length, 0)
  const m = run([{ round: 8, kills: 12, rk: 2, rhs: 1 }, { round: 8, kills: 13, rk: 3, rhs: 1 }]).moments
  assert.deepEqual(m.map((x) => [x.kind, x.kills]), [['multi', 1]])
})

test('changement de round : les compteurs remis à zéro n’annoncent rien, même en retard', () => {
  const sequence: P[] = [
    ...start,
    { round: 3, kills: 7, rk: 3 },
    // Fin de round : map.round passe au suivant, round_kills ne change pas.
    { round: 4, phase: 'over', kills: 7, rk: 3 },
    // Temps d'achat : pas encore remis à zéro, puis remis à zéro.
    { round: 4, phase: 'freezetime', kills: 7, rk: 3 },
    { round: 4, phase: 'freezetime', kills: 7, rk: 0 },
    { round: 4, phase: 'live', kills: 7, rk: 0 },
    { round: 4, phase: 'live', kills: 8, rk: 1 }
  ]
  const m = run(sequence).moments
  assert.deepEqual(m.map((x) => [x.kind, x.kills, x.round]), [['multi', 3, 4], ['kill', 1, 5]])
})

test('une élimination juste après la fin du round compte encore', () => {
  const m = run([...start, { round: 4, phase: 'over', kills: 4, rk: 0 }, { round: 4, phase: 'over', kills: 5, rk: 1 }]).moments
  assert.deepEqual(m.map((x) => x.kills), [1])
})

test('tir sur un coéquipier : pas de clip, et l’élimination suivante compte', () => {
  const m = run([...start, { round: 3, kills: 5, rk: 1 }, { round: 3, kills: 4, rk: 0 }, { round: 3, kills: 5, rk: 1 }]).moments
  assert.deepEqual(m.map((x) => x.kills), [1, 1])
})

test('joueur observé (mort, spectateur) : ses chiffres ne comptent jamais', () => {
  const m = run([...start, { round: 3, kills: 31, rk: 4, steam: MATE }, { round: 3, kills: 32, rk: 5, steam: MATE }]).moments
  assert.equal(m.filter((x) => x.kind !== 'death').length, 0)
  // Spectateur du début à la fin : rien du tout.
  assert.equal(run([{ round: 3, kills: 31, steam: MATE }, { round: 3, kills: 35, rk: 5, steam: MATE }]).moments.length, 0)
})

test('retour après une mort, round suivant déjà commencé : nouvelle référence', () => {
  const m = run([...start, { round: 3, kills: 5, rk: 1, health: 0, deaths: 1 }, { round: 3, kills: 31, steam: MATE }, { round: 4, phase: 'live', kills: 6, rk: 0, deaths: 1 }]).moments
  assert.deepEqual(m.map((x) => x.kind), ['kill', 'death'])
})

test('mort : une seule fois, quel que soit le signal', () => {
  const byHealth = run([...start, { round: 3, kills: 4, health: 0 }, { round: 3, kills: 4, health: 0, deaths: 1 }, { round: 3, kills: 31, steam: MATE }]).moments
  assert.deepEqual(byHealth.map((x) => x.kind), ['death'])
  const byCounter = run([...start, { round: 3, kills: 4, deaths: 1, health: 0 }]).moments
  assert.deepEqual(byCounter.map((x) => x.kind), ['death'])
  // La caméra part sur un coéquipier sans envoi « 0 point de vie » entre les deux.
  const byCamera = run([...start, { round: 3, kills: 31, steam: MATE }, { round: 3, kills: 32, steam: MATE }]).moments
  assert.deepEqual(byCamera.map((x) => x.kind), ['death'])
  // Rien en fin de round ni pendant le temps d'achat.
  const quiet = run([{ round: 3, phase: 'freezetime', kills: 4 }, { round: 3, phase: 'freezetime', kills: 31, steam: MATE }]).moments
  assert.equal(quiet.length, 0)
})

test('élimination et mort dans le même envoi : les deux moments', () => {
  const m = run([...start, { round: 3, kills: 5, rk: 1, deaths: 1, health: 0 }]).moments
  assert.deepEqual(m.map((x) => x.kind), ['kill', 'death'])
})

test('score : le tien d’abord, selon ton camp', () => {
  assert.deepEqual(run([...start.map((p) => ({ ...p, ct: 2, t: 1 })), { round: 3, kills: 5, rk: 1, ct: 2, t: 1 }]).moments[0].score, { us: 2, them: 1 })
  const asT: P[] = [
    { phase: 'freezetime', round: 3, team: 'T', ct: 2, t: 1 },
    { round: 3, kills: 1, rk: 1, team: 'T', ct: 2, t: 1 }
  ]
  assert.deepEqual(run(asT).moments[0].score, { us: 1, them: 2 })
})

test('autre match, retour au menu : rien ne se mélange', () => {
  const first = run([...start, { round: 3, kills: 5, rk: 1 }])
  const other = run([{ map: 'de_nuke', round: 0, kills: 9, rk: 2 }, { map: 'de_nuke', round: 0, kills: 10, rk: 3 }], first.state).moments
  assert.deepEqual(other.map((x) => [x.kind, x.kills, x.map]), [['multi', 1, 'de_nuke']])
  const menu = run([{ noMap: true }, { round: 3, kills: 5, rk: 1 }], first.state).moments
  assert.equal(menu.length, 0)
})

test('rejoue le match du simulateur : 27 éliminations, 13 headshots, 1 quadruple, 2 triples, jamais l’échauffement', () => {
  const SCRIPT: [number, number, boolean][] = [
    [1, 1, false], [2, 1, false], [0, 0, true], [3, 2, false], [1, 0, false], [2, 1, true], [1, 1, false], [0, 0, true], [1, 0, true], [2, 1, true], [0, 0, true], [1, 0, false],
    [0, 0, true], [4, 2, false], [2, 1, false], [1, 1, false], [1, 0, true], [0, 0, true], [3, 2, false], [0, 0, true], [1, 0, true], [1, 0, false]
  ]
  const list: P[] = [{ mapPhase: 'warmup', kills: 6, rk: 6, rhs: 0 }]
  let kills = 0
  let deaths = 0
  SCRIPT.forEach(([k, hs, died], i) => {
    list.push({ round: i, phase: 'freezetime', kills, deaths }, { round: i, phase: 'live', kills, deaths })
    kills += k
    if (died) deaths++
    list.push({ round: i, phase: 'live', kills, deaths, rk: k, rhs: hs, health: died ? 0 : 100 })
    if (died) list.push({ round: i, phase: 'live', kills: 31, deaths: 0, rk: 2, steam: MATE })
    list.push({ round: i + 1, phase: 'over', kills, deaths, rk: k, rhs: hs, health: died ? 0 : 100 })
  })
  const { moments } = run(list)
  const shots = moments.filter((m) => m.kind !== 'death')
  assert.equal(shots.reduce((n, m) => n + m.kills, 0), 27)
  assert.equal(shots.reduce((n, m) => n + m.headshots, 0), 13)
  assert.equal(shots.filter((m) => m.kind === 'multi').length, 3)
  assert.equal(shots.filter((m) => m.kind === 'ace').length, 0)
  assert.equal(moments.filter((m) => m.kind === 'death').length, 11)
})
