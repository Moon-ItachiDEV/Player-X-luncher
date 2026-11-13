// Tests du suivi d'un match Counter-Strike 2 (npm run test:cs2) : lanceur intégré à Node, aucune dépendance.
// Chaque test rejoue des envois du jeu, tels que CS2 les poste (Game State Integration).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cs2RecapLine, longestStreak, mapLabel, modeLabel } from '@shared/cs2'
import { expire, liveOf, readPayload, recapOf, sameMatch, step, type MatchState, type Snapshot } from './cs2Match'

const ME = '76561198000000001'
const MATE = '76561198000000002'

interface P {
  map?: string | null
  mode?: string
  phase?: 'warmup' | 'live' | 'intermission' | 'gameover'
  round?: number
  ct?: number
  t?: number
  wins?: Record<string, string>
  rp?: 'freezetime' | 'live' | 'over'
  who?: string
  team?: 'CT' | 'T'
  kills?: number
  deaths?: number
  assists?: number
  mvps?: number
  score?: number
  rk?: number
  rhs?: number
  rdmg?: number
  health?: number
  money?: number
}

/** Un envoi de CS2, comme le jeu le poste. */
function body(p: P = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    provider: { name: 'Counter-Strike: Global Offensive', appid: 730, version: 14000, steamid: ME, timestamp: 1 },
    player: {
      steamid: p.who ?? ME,
      name: 'Breezy',
      team: p.team ?? 'CT',
      activity: 'playing',
      state: { health: p.health ?? 100, armor: 100, money: p.money ?? 800, round_kills: p.rk ?? 0, round_killhs: p.rhs ?? 0, round_totaldmg: p.rdmg ?? 0 },
      match_stats: { kills: p.kills ?? 0, assists: p.assists ?? 0, deaths: p.deaths ?? 0, mvps: p.mvps ?? 0, score: p.score ?? 0 }
    },
    round: { phase: p.rp ?? 'live' }
  }
  if (p.map !== null)
    out.map = {
      mode: p.mode ?? 'competitive',
      name: p.map ?? 'de_mirage',
      phase: p.phase ?? 'live',
      round: p.round ?? 0,
      team_ct: { score: p.ct ?? 0 },
      team_t: { score: p.t ?? 0 },
      round_wins: p.wins ?? {}
    }
  return out
}

const snap = (p: P = {}): Snapshot => {
  const s = readPayload(body(p))
  assert.ok(s, 'envoi refusé')
  return s
}

/** Rejoue une suite d'envois, une seconde d'écart, et renvoie le dernier état et les matchs terminés. */
function play(list: P[], from: MatchState | null = null, t0 = 1_000_000): { match: MatchState | null; ended: { match: MatchState; by: string }[]; t: number } {
  let match = from
  const ended: { match: MatchState; by: string }[] = []
  let t = t0
  for (const p of list) {
    t += 1000
    const r = step(match, snap(p), t)
    match = r.match
    if (r.ended) ended.push(r.ended)
  }
  return { match, ended, t }
}

/** Un round complet : achat, combat (avec les compteurs donnés), fin. `done` : rounds terminés avant ce round. */
function round(done: number, score: { ct: number; t: number }, winner: 'ct' | 't', how: string, me: Partial<P>, wins: Record<string, string>): P[] {
  const nextWins = { ...wins, [String(done + 1)]: `${winner}_win_${how}` }
  const after = { ct: score.ct + (winner === 'ct' ? 1 : 0), t: score.t + (winner === 't' ? 1 : 0) }
  return [
    { ...me, round: done, ...score, wins, rp: 'freezetime', rk: 0, rhs: 0, rdmg: 0 },
    { ...me, round: done, ...score, wins, rp: 'live', rk: 0, rhs: 0, rdmg: 0 },
    { ...me, round: done, ...score, wins, rp: 'live' },
    // map.round passe au suivant dans l'envoi de la fin du round.
    { ...me, round: done + 1, ...after, wins: nextWins, rp: 'over' }
  ]
}

// ---------- lecture ----------

test('envoi d’un autre jeu ou sans compte valide : refusé', () => {
  assert.equal(readPayload({ ...body(), provider: { appid: 570, steamid: ME } }), null)
  assert.equal(readPayload({ ...body(), provider: { appid: 730, steamid: 'abc' } }), null)
  assert.equal(readPayload('pas du json'), null)
  assert.equal(readPayload(null), null)
})

test('le joueur regardé (mort, spectateur) ne donne aucun chiffre', () => {
  const s = snap({ who: MATE, kills: 30, health: 80 })
  assert.equal(s.own, false)
  assert.equal(s.stats, undefined)
  assert.equal(s.state, undefined)
  assert.equal(s.team, undefined)
  assert.ok(s.map)
})

test('nombres en texte, négatifs ou absurdes : ramenés à des entiers raisonnables', () => {
  const b = body()
  ;(b.player as { match_stats: Record<string, unknown> }).match_stats = { kills: '12', deaths: -3, assists: 1e12, mvps: 'x', score: 2.6 }
  const s = readPayload(b)!
  assert.deepEqual(s.stats, { kills: 12, deaths: 0, assists: 1_000_000, mvps: 0, points: 3 })
})

test('au menu : pas de carte, donc pas de match', () => {
  const s = snap({ map: null })
  assert.equal(s.map, undefined)
  assert.deepEqual(step(null, s, 1), { match: null })
})

// ---------- un match complet ----------

/** Compétitif sur Mirage : échauffement, 3 rounds en CT, mi-temps, 2 rounds en T, fin 3–2 pour toi. */
function fullMatch(): P[] {
  const warm: P[] = [
    { phase: 'warmup', rp: 'live', kills: 9, rk: 9, rdmg: 900 },
    { phase: 'warmup', rp: 'live', kills: 11, rk: 11, rdmg: 1100 }
  ]
  let wins: Record<string, string> = {}
  const out: P[] = [...warm]
  const add = (list: P[]): void => {
    out.push(...list)
    wins = list[list.length - 1].wins!
  }
  // Round 1 : 3 éliminations dont 2 headshots, 280 dégâts, victoire CT.
  add(round(0, { ct: 0, t: 0 }, 'ct', 'elimination', { team: 'CT', kills: 3, rk: 3, rhs: 2, rdmg: 280, score: 7 }, wins))
  // Round 2 : mort tôt, puis CS2 envoie le coéquipier regardé (ses chiffres sont ignorés).
  out.push({ team: 'CT', round: 1, ct: 1, t: 0, wins, rp: 'freezetime', kills: 3, rk: 0 })
  out.push({ team: 'CT', round: 1, ct: 1, t: 0, wins, rp: 'live', kills: 3, deaths: 1, rk: 0, rdmg: 40, health: 0 })
  out.push({ who: MATE, team: 'CT', round: 1, ct: 1, t: 0, wins, rp: 'live', kills: 25, rk: 5, rhs: 5, rdmg: 500 })
  out.push({ who: MATE, team: 'CT', round: 2, ct: 1, t: 1, wins: (wins = { ...wins, 2: 't_win_bomb' }), rp: 'over', rk: 5 })
  // Round 3 : 4 éliminations, un tir sur un coéquipier fait reculer round_kills à 3 sans effacer la 4e.
  out.push({ team: 'CT', round: 2, ct: 1, t: 1, wins, rp: 'freezetime', kills: 3, deaths: 1, rk: 0 })
  out.push({ team: 'CT', round: 2, ct: 1, t: 1, wins, rp: 'live', kills: 7, deaths: 1, rk: 4, rhs: 1, rdmg: 400 })
  out.push({ team: 'CT', round: 2, ct: 1, t: 1, wins, rp: 'live', kills: 6, deaths: 1, rk: 3, rhs: 1, rdmg: 400 })
  out.push({ team: 'CT', round: 3, ct: 2, t: 1, wins: (wins = { ...wins, 3: 'ct_win_defuse' }), rp: 'over', kills: 6, deaths: 1, rk: 3, rhs: 1, rdmg: 400 })
  // Mi-temps : les camps s'échangent, les scores suivent les camps.
  out.push({ phase: 'intermission', team: 'CT', round: 3, ct: 2, t: 1, wins, rp: 'over', kills: 6, deaths: 1 })
  // Round 4 en T : le temps d'achat montre encore les compteurs du round d'avant (ignorés).
  out.push({ team: 'T', round: 3, ct: 1, t: 2, wins, rp: 'freezetime', kills: 6, deaths: 1, rk: 3, rhs: 1, rdmg: 400 })
  out.push({ team: 'T', round: 3, ct: 1, t: 2, wins, rp: 'live', kills: 6, deaths: 1, rk: 0, rdmg: 0 })
  out.push({ team: 'T', round: 3, ct: 1, t: 2, wins, rp: 'live', kills: 7, deaths: 1, rk: 1, rhs: 1, rdmg: 100, mvps: 1 })
  out.push({ team: 'T', round: 4, ct: 1, t: 3, wins: (wins = { ...wins, 4: 't_win_elimination' }), rp: 'over', kills: 7, deaths: 1, rk: 1, rhs: 1, rdmg: 100, mvps: 1 })
  // Round 5 en T : défaite au temps, puis fin du match.
  out.push({ team: 'T', round: 4, ct: 1, t: 3, wins, rp: 'freezetime', kills: 7, deaths: 1, mvps: 1 })
  out.push({ team: 'T', round: 4, ct: 1, t: 3, wins, rp: 'live', kills: 7, deaths: 2, rk: 0, rdmg: 60, mvps: 1, score: 20 })
  out.push({
    phase: 'gameover',
    team: 'T',
    round: 5,
    ct: 2,
    t: 3,
    wins: { ...wins, 5: 'ct_win_time' },
    rp: 'over',
    kills: 7,
    deaths: 2,
    assists: 2,
    rk: 0,
    rdmg: 60,
    mvps: 1,
    score: 21
  })
  return out
}

test('match complet : victoire 3–2 en finissant T, échauffement ignoré, rounds suivis', () => {
  const { match, ended } = play(fullMatch())
  assert.equal(match, null)
  assert.equal(ended.length, 1)
  assert.equal(ended[0].by, 'gameover')
  const r = recapOf(ended[0].match, 'gameover')!
  assert.equal(r.result, 'win')
  assert.deepEqual(r.score, { us: 3, them: 2 })
  assert.equal(r.map, 'de_mirage')
  assert.equal(r.kills, 7)
  assert.equal(r.deaths, 2)
  assert.equal(r.assists, 2)
  assert.equal(r.points, 21)
  assert.equal(r.partial, undefined)
  // Échauffement exclu : le match commence au premier envoi « live ».
  assert.ok(r.startedAt > ended[0].match.firstAt)
  assert.equal(r.roundsTracked, 5)
  // Rounds : 3 (2 HS), 0, 4 (1 HS), 1 (1 HS), 0. Le coéquipier regardé (5 élim.) ne compte pas.
  assert.equal(r.trackedKills, 8)
  assert.equal(r.headshots, 4)
  assert.equal(r.damage, 280 + 40 + 400 + 100 + 60)
  assert.deepEqual(r.multi, { k3: 1, k4: 1, k5: 0 })
  assert.deepEqual(r.best, { n: 3, kills: 4, damage: 400 })
  assert.deepEqual(
    r.rounds.map((x) => [x.n, x.winner, x.end, x.side, x.kills]),
    [
      [1, 'CT', 'elimination', 'CT', 3],
      [2, 'T', 'bomb', 'CT', 0],
      [3, 'CT', 'defuse', 'CT', 4],
      [4, 'T', 'elimination', 'T', 1],
      [5, 'CT', 'time', 'T', 0]
    ]
  )
  assert.equal(longestStreak(r.rounds), 2)
  assert.equal(cs2RecapLine(r), 'Victoire 3–2 sur Mirage · 7 élim. · K/D 3,50')
})

test('les envois de l’écran de fin qui suivent ne rouvrent pas de match', () => {
  const { t } = play(fullMatch())
  const again = step(null, snap({ phase: 'gameover', round: 5, ct: 2, t: 3 }), t + 1000)
  assert.deepEqual(again, { match: null })
})

test('défaite et égalité selon ton camp final', () => {
  const end = (team: 'CT' | 'T', ct: number, t: number): string => {
    const { ended } = play([
      { team, round: 0, rp: 'live', kills: 1, rk: 1, rdmg: 100 },
      { phase: 'gameover', team, round: ct + t, ct, t, rp: 'over', kills: 1 }
    ])
    return recapOf(ended[0].match, 'gameover')!.result
  }
  assert.equal(end('CT', 9, 13), 'loss')
  assert.equal(end('T', 9, 13), 'win')
  assert.equal(end('CT', 12, 12), 'tie')
})

// ---------- départs et coupures ----------

test('retour au menu en plein match : quitté, avec ce qui a été joué', () => {
  const { ended } = play([...round(0, { ct: 0, t: 0 }, 't', 'elimination', { kills: 2, rk: 2, rdmg: 150 }, {}), { map: null }])
  assert.equal(ended.length, 1)
  assert.equal(ended[0].by, 'left')
  const r = recapOf(ended[0].match, 'left')!
  assert.equal(r.result, 'left')
  assert.equal(r.kills, 2)
  assert.equal(cs2RecapLine(r), 'Quitté sur Mirage · 2 élim. · K/D 2,00')
})

test('quitté pendant l’échauffement : pas de bilan', () => {
  const { ended } = play([{ phase: 'warmup', kills: 5, rk: 5 }, { map: null }])
  assert.equal(ended.length, 1)
  assert.equal(recapOf(ended[0].match, 'left'), null)
})

test('plus aucun envoi : le match est quitté après le délai, pas avant', () => {
  const { match, t } = play([{ round: 2, ct: 1, t: 1, rp: 'live', kills: 2, rk: 1 }])
  assert.ok(match)
  assert.equal(expire(match, t + 30_000, 35_000).match, match)
  const r = expire(match, t + 36_000, 35_000)
  assert.equal(r.match, null)
  assert.equal(r.ended?.by, 'left')
})

test('nouvelle carte sans repasser par le menu : l’ancien match se termine, le nouveau commence', () => {
  const { match, ended } = play([
    { round: 3, ct: 2, t: 1, kills: 4, rk: 1 },
    { map: 'de_inferno', phase: 'warmup' }
  ])
  assert.equal(ended.length, 1)
  assert.equal(ended[0].match.map, 'de_mirage')
  assert.equal(match?.map, 'de_inferno')
  assert.equal(match?.live, false)
})

test('autre compte Steam sur le même PC : autre match', () => {
  const first = play([{ round: 1, kills: 1, rk: 1 }])
  const other = readPayload({ ...body({ round: 1 }), provider: { appid: 730, steamid: MATE }, player: { steamid: MATE } })!
  const r = step(first.match, other, first.t + 1000)
  assert.equal(r.ended?.match.steamId, ME)
  assert.equal(r.match?.steamId, MATE)
})

test('rejoint en cours de match : bilan partiel, rounds d’avant sans camp ni chiffres', () => {
  const wins = { 1: 't_win_elimination', 2: 'ct_win_elimination', 3: 't_win_bomb' }
  const { ended } = play([
    { team: 'T', round: 3, ct: 1, t: 2, wins, rp: 'live', kills: 6, deaths: 2, rk: 1, rhs: 1, rdmg: 90 },
    { phase: 'gameover', team: 'T', round: 4, ct: 1, t: 3, wins: { ...wins, 4: 't_win_elimination' }, rp: 'over', kills: 7, deaths: 2, rk: 2, rhs: 1, rdmg: 180 }
  ])
  const r = recapOf(ended[0].match, 'gameover')!
  assert.equal(r.partial, true)
  assert.equal(r.result, 'win')
  assert.equal(r.kills, 7)
  assert.equal(r.roundsTracked, 1)
  assert.equal(r.trackedKills, 2)
  assert.deepEqual(
    r.rounds.map((x) => x.side ?? null),
    [null, null, null, 'T']
  )
})

// ---------- modes ----------

test('match à mort : pas de rounds, ni score d’équipe, ni ADR', () => {
  const { ended } = play([
    { mode: 'deathmatch', round: 0, rp: 'live', kills: 10, deaths: 4, rk: 10, rhs: 6, rdmg: 1500 },
    { mode: 'deathmatch', phase: 'gameover', round: 0, rp: 'over', kills: 18, deaths: 9, rk: 18, rhs: 9, rdmg: 2600 }
  ])
  const r = recapOf(ended[0].match, 'gameover')!
  assert.equal(r.hasRounds, false)
  assert.equal(r.result, 'done')
  assert.equal(r.score, undefined)
  assert.equal(r.damage, 0)
  assert.equal(r.roundsTracked, 0)
  assert.equal(r.headshots, 9)
  assert.deepEqual(r.rounds, [])
  // Tout le match est un seul « round » : 18 éliminations ne font pas un ace.
  assert.deepEqual(r.multi, { k3: 0, k4: 0, k5: 0 })
  assert.equal(r.best, undefined)
})

// ---------- en direct ----------

test('en direct : round en cours, score de ton camp, rien du joueur regardé', () => {
  let { match } = play([{ team: 'T', round: 6, ct: 4, t: 2, rp: 'live', kills: 8, deaths: 3, rk: 2, health: 54, money: 3450 }])
  let live = liveOf(match)!
  assert.equal(live.round, 7)
  assert.deepEqual(live.score, { us: 2, them: 4 })
  assert.equal(live.roundKills, 2)
  assert.equal(live.health, 54)
  assert.equal(live.money, 3450)
  ;({ match } = play([{ who: MATE, team: 'T', round: 6, ct: 4, t: 2, rp: 'live', kills: 30, health: 100 }], match))
  live = liveOf(match)!
  assert.equal(live.kills, 8)
  assert.equal(live.health, undefined)
  assert.equal(live.money, undefined)
  assert.equal(liveOf(null), null)
})

test('l’état n’est jamais modifié sur place (il est gardé en base tel quel)', () => {
  const { match } = play([{ round: 1, kills: 1, rk: 1, rdmg: 50 }])
  const frozen = JSON.stringify(match)
  step(match, snap({ round: 2, rp: 'over', ct: 2, kills: 2, rk: 2, rdmg: 120 }), 9_999_999)
  assert.equal(JSON.stringify(match), frozen)
})

// ---------- libellés ----------

test('libellés des cartes et des modes', () => {
  assert.equal(mapLabel('de_dust2'), 'Dust II')
  assert.equal(mapLabel('workshop/123456/de_cbble_classic'), 'Cbble Classic')
  assert.equal(mapLabel('ar_pool_day'), 'Pool Day')
  assert.equal(modeLabel('scrimcomp2v2'), 'Wingman')
  assert.equal(modeLabel('competitive'), 'Compétitif')
  assert.equal(modeLabel('new_mode'), 'New Mode')
})

// ---------- cas limites (relecture) ----------

test('mi-temps : le camp donné pendant la pause ne recolore pas le round qui vient de finir', () => {
  const { ended } = play([
    { team: 'CT', round: 0, rp: 'live', kills: 1, rk: 1 },
    { team: 'CT', round: 1, ct: 1, wins: { 1: 'ct_win_elimination' }, rp: 'over', kills: 1, rk: 1 },
    // CS2 échange déjà les camps pendant la pause.
    { phase: 'intermission', team: 'T', round: 1, ct: 0, t: 1, wins: { 1: 'ct_win_elimination' }, rp: 'over', kills: 1 },
    { phase: 'gameover', team: 'T', round: 1, ct: 0, t: 1, wins: { 1: 'ct_win_elimination' }, rp: 'over', kills: 1 }
  ])
  const r = recapOf(ended[0].match, 'gameover')!
  assert.deepEqual(r.rounds.map((x) => [x.n, x.side]), [[1, 'CT']])
})

test('mort avant la mi-temps : ton camp suit celui du coéquipier regardé pendant la pause', () => {
  let { match } = play([{ team: 'CT', round: 11, ct: 6, t: 5, rp: 'live', kills: 9, rk: 0 }])
  ;({ match } = play([{ who: MATE, team: 'T', phase: 'intermission', round: 12, ct: 5, t: 7, rp: 'over' }], match))
  assert.equal(match?.side, 'T')
  assert.deepEqual(liveOf(match)?.score, { us: 7, them: 5 })
})

test('envoi sans phase de round : ses compteurs ne sont pas attribués au round suivant', () => {
  const b = body({ round: 1, ct: 1, rk: 3, rdmg: 300, kills: 3 })
  delete b.round
  const first = play([{ round: 0, rp: 'live', kills: 3, rk: 3, rdmg: 300 }, { round: 1, ct: 1, rp: 'over', kills: 3, rk: 3, rdmg: 300 }])
  const r = step(first.match, readPayload(b)!, first.t + 1000)
  const recap = recapOf(r.match!, 'left')!
  assert.equal(recap.trackedKills, 3)
  assert.equal(recap.damage, 300)
})

test('match regardé (démo, GOTV) : jamais « En match », jamais de bilan', () => {
  const { match, ended } = play([
    { who: MATE, round: 4, ct: 2, t: 2, rp: 'live' },
    { who: MATE, phase: 'gameover', round: 5, ct: 3, t: 2, rp: 'over' }
  ])
  assert.equal(match, null)
  assert.equal(liveOf(play([{ who: MATE, round: 4, rp: 'live' }]).match), null)
  assert.equal(recapOf(ended[0].match, 'gameover'), null)
})

test('CS2 revient après une coupure : même match si rien n’a reculé, et bilan partiel si des rounds ont manqué', () => {
  const { match } = play([{ round: 4, ct: 2, t: 2, rp: 'live', kills: 5, rk: 1 }])
  assert.ok(sameMatch(match!, snap({ round: 6, ct: 3, t: 3 })))
  assert.ok(!sameMatch(match!, snap({ round: 2 })))
  assert.ok(!sameMatch(match!, snap({ map: 'de_nuke', round: 6 })))
  assert.ok(!sameMatch(match!, snap({ map: null })))
  const back = step(match, snap({ round: 7, ct: 4, t: 3, rp: 'live', kills: 9, rk: 0 }), 9_000_000)
  assert.equal(back.match?.id, match!.id)
  assert.equal(back.match?.partial, true)
})

// ---------- overlay ----------

test('en direct pour l’overlay : phase du round, frise des rounds finis, ADR et HS % des rounds suivis', () => {
  let wins: Record<string, string> = {}
  const list: P[] = []
  const add = (part: P[]): void => {
    list.push(...part)
    wins = part[part.length - 1].wins!
  }
  add(round(0, { ct: 0, t: 0 }, 'ct', 'elimination', { team: 'CT', kills: 3, rk: 3, rhs: 2, rdmg: 280 }, wins))
  add(round(1, { ct: 1, t: 0 }, 't', 'bomb', { team: 'CT', kills: 3, deaths: 1, rk: 0, rdmg: 40 }, wins))
  list.push({ team: 'CT', round: 2, ct: 1, t: 1, wins, rp: 'freezetime', kills: 3, deaths: 1, rk: 0, money: 2900 })
  const live = liveOf(play(list).match)!
  assert.equal(live.roundPhase, 'freezetime')
  assert.equal(live.round, 3)
  assert.deepEqual(
    live.rounds.map((r) => [r.n, r.winner, r.side, r.kills]),
    [
      [1, 'CT', 'CT', 3],
      [2, 'T', 'CT', 0]
    ]
  )
  assert.equal(live.adr, 160)
  assert.equal(live.hsPct, 67)
  assert.equal(live.money, 2900)
})
