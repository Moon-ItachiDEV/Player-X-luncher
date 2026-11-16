// Tests des stats à vie de CS2 (npm run test:cs2stats) : lanceur intégré à Node, aucune dépendance.
// Toutes les réponses de Steam ci-dessous sont des FIXTURES (chiffres fictifs), aucune n'est une vraie réponse.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { addPoint, deltaOf, headshotPct, hoursOf, kdOf, lifetimeOf, mapWinPct, matchWinPct, MAX_POINTS, readUserStats, weaponBase, weaponKind, weaponLabel } from './cs2Lifetime.ts'
// @ts-ignore TS5097
import { mapSummaries } from './cs2.ts'
// @ts-ignore TS5097
import { FIXTURE_KEY_REFUSED, FIXTURE_PRIVATE, fixtureHistory, fixtureText } from '../main/services/cs2LifetimeSim.ts'
import type { Cs2LifetimePoint, Cs2Recap } from './types'

const DAY = 86_400_000
// Dates locales : les tests ne dépendent pas du fuseau horaire de la machine.
const NOW = new Date(2026, 9, 25, 20, 0).getTime()

/** FIXTURE : réponse minimale de Steam à partir de couples nom / valeur. */
const fixture = (stats: Record<string, unknown>): string =>
  JSON.stringify({ playerstats: { steamID: '76561198000000001', gameName: 'ValveTestApp260', stats: Object.entries(stats).map(([name, value]) => ({ name, value })) } })

function okValues(text: string): Record<string, number> {
  const r = readUserStats(200, text)
  assert.equal(r.kind, 'ok')
  return (r as { values: Record<string, number> }).values
}

// ---------- lecture de la réponse ----------

test('réponse complète (fixture) : les champs numériques sont lus, les autres ignorés', () => {
  const v = okValues(fixtureText())
  assert.equal(v.total_kills, 48_213)
  assert.equal(v.total_kills_ak47, 14_212)
  // Nom avec des points : pas un champ de stats qu'on sait lire.
  assert.equal(Object.keys(v).some((k) => k.includes('.')), false)
})

test('valeurs bancales ignorées, nombres écrits en texte acceptés', () => {
  const v = okValues(fixture({ total_kills: '120', total_deaths: -3, total_mvps: 'beaucoup', total_wins: null, total_time_played: 3600.5 }))
  assert.deepEqual(v, { total_kills: 120, total_time_played: 3600.5 })
})

test('profil privé, clé refusée, aucune stat, panne', () => {
  assert.equal(readUserStats(200, FIXTURE_PRIVATE).kind, 'private')
  assert.equal(readUserStats(403, '').kind, 'private')
  assert.equal(readUserStats(403, FIXTURE_KEY_REFUSED).kind, 'key')
  assert.equal(readUserStats(401, '').kind, 'key')
  assert.equal(readUserStats(400, JSON.stringify({ playerstats: { error: 'Requested app has no stats' } })).kind, 'none')
  assert.equal(readUserStats(200, fixture({})).kind, 'none')
  assert.equal(readUserStats(200, JSON.stringify({ playerstats: {} })).kind, 'none')
  assert.deepEqual(readUserStats(500, '<html>Internal Server Error</html>'), { kind: 'error', status: 500 })
  assert.deepEqual(readUserStats(200, 'pas du JSON'), { kind: 'error', status: 200 })
})

// ---------- totaux, armes, cartes ----------

test('totaux : seulement ce que Steam a envoyé', () => {
  const s = lifetimeOf(okValues(fixture({ total_kills: 100, total_deaths: 80, total_time_played: 7200 })))
  assert.equal(kdOf(s.totals), 1.25)
  assert.equal(hoursOf(s.totals), 2)
  // Pas de headshots ni de matchs dans la réponse : pas de pourcentage inventé.
  assert.equal(headshotPct(s.totals), null)
  assert.equal(matchWinPct(s.totals), null)
  assert.deepEqual(s.totals, { kills: 100, deaths: 80, timePlayed: 7200 })
})

test('calculs à partir de la fixture', () => {
  const s = lifetimeOf(okValues(fixtureText()))
  assert.equal(s.totals.headshots, 21_870)
  assert.equal(s.totals.roundsWon, 31_540)
  assert.ok(Math.abs(kdOf(s.totals)! - 48_213 / 41_870) < 1e-9)
  assert.ok(Math.abs(headshotPct(s.totals)! - (21_870 / 48_213) * 100) < 1e-9)
  assert.ok(Math.abs(matchWinPct(s.totals)! - (1_548 / 2_870) * 100) < 1e-9)
  assert.equal(hoursOf(s.totals), 920)
})

test('K/D sans mort : le nombre d’éliminations ; pourcentages impossibles écartés', () => {
  assert.equal(kdOf({ kills: 12, deaths: 0 }), 12)
  assert.equal(kdOf({ kills: 12 }), null)
  assert.equal(headshotPct({ kills: 0, headshots: 0 }), null)
  assert.equal(headshotPct({ kills: 10, headshots: 11 }), null)
  assert.equal(matchWinPct({ matchesWon: 5, matchesPlayed: 4 }), null)
})

test('armes : les compteurs qui ne sont pas des armes sont écartés, une arme inconnue garde son nom technique', () => {
  const s = lifetimeOf(okValues(fixtureText()))
  const ids = s.weapons.map((w) => w.id)
  for (const not of ['headshot', 'enemy_weapon', 'enemy_blinded', 'knife_fight', 'against_zoomed_sniper', 'mystery_bonus']) assert.equal(ids.includes(not), false, not)
  // Triées par éliminations.
  assert.deepEqual(ids.slice(0, 3), ['ak47', 'm4a1', 'awp'])
  assert.ok(ids.includes('futuregun_mk2'))
  assert.equal(weaponLabel('futuregun_mk2'), 'FUTUREGUN MK2')
  assert.equal(weaponKind('futuregun_mk2'), 'other')
  assert.equal(weaponLabel('ak47'), 'AK-47')
  assert.equal(weaponKind('awp'), 'sniper')
  // Arme sans élimination : absente.
  assert.equal(lifetimeOf(okValues(fixture({ total_kills_awp: 0, total_kills_ak47: 3 }))).weapons.length, 1)
})

test('arme comptée avec une autre : double nom, sauf si Steam envoie la variante à part', () => {
  assert.equal(weaponLabel('m4a1'), 'M4A4 / M4A1-S')
  assert.equal(weaponLabel('m4a1', new Set(['m4a1', 'm4a1_silencer'])), 'M4A4')
  assert.equal(weaponLabel('m4a1_silencer'), 'M4A1-S')
})

test('part des armes : jamais plus de 100 %', () => {
  const s = lifetimeOf(okValues(fixture({ total_kills: 10, total_kills_ak47: 8, total_kills_awp: 6 })))
  assert.equal(weaponBase(s), 14)
  const t = lifetimeOf(okValues(fixture({ total_kills: 100, total_kills_ak47: 8 })))
  assert.equal(weaponBase(t), 100)
})

test('cartes : rounds gagnés et joués, taux, cartes jamais jouées écartées', () => {
  const s = lifetimeOf(okValues(fixtureText()))
  assert.equal(s.maps[0].id, 'de_dust2')
  assert.deepEqual(s.maps[0], { id: 'de_dust2', roundsWon: 6_120, rounds: 11_470 })
  assert.equal(s.maps.some((m) => m.id === 'de_lake'), false)
  assert.ok(Math.abs(mapWinPct(s.maps[0])! - (6_120 / 11_470) * 100) < 1e-9)
  // Un seul des deux compteurs : la carte reste, sans taux.
  const one = lifetimeOf(okValues(fixture({ total_wins_map_de_anubis: 12 }))).maps
  assert.deepEqual(one, [{ id: 'de_anubis', roundsWon: 12 }])
  assert.equal(mapWinPct(one[0]), null)
})

// ---------- relevés ----------

const pt = (at: number, kills: number, deaths: number, extra: Partial<Cs2LifetimePoint> = {}): Cs2LifetimePoint => ({ at, kills, deaths, ...extra })

test('relevés : un par jour (le plus récent), triés, 400 au plus', () => {
  let h: Cs2LifetimePoint[] = []
  h = addPoint(h, pt(NOW - DAY, 10, 10))
  h = addPoint(h, pt(NOW - 2 * 3600_000, 20, 15))
  h = addPoint(h, pt(NOW, 25, 18))
  assert.equal(h.length, 2)
  assert.equal(h[1].kills, 25)
  let many: Cs2LifetimePoint[] = []
  for (let i = 500; i > 0; i--) many = addPoint(many, pt(NOW - i * DAY, i, i))
  assert.equal(many.length, MAX_POINTS)
  assert.ok(many[0].at < many.at(-1)!.at)
})

test('écarts sur 7 jours : dernier relevé moins le relevé d’il y a 7 jours', () => {
  const h = [
    pt(NOW - 12 * DAY, 90, 95),
    pt(NOW - 7 * DAY - 3600_000, 100, 100, { matchesPlayed: 50, matchesWon: 20 }),
    pt(NOW - 3 * DAY, 130, 120),
    pt(NOW, 160, 130, { matchesPlayed: 56, matchesWon: 24 })
  ]
  const d = deltaOf(h, 7, NOW)!
  assert.equal(d.kills, 60)
  assert.equal(d.deaths, 30)
  assert.equal(d.kd, 2)
  assert.equal(d.matchesPlayed, 6)
  assert.equal(d.matchesWon, 4)
  assert.equal(d.days, 7)
  // 30 jours : tout l'historique.
  assert.equal(deltaOf(h, 30, NOW)!.kills, 70)
  assert.equal(deltaOf(h, 30, NOW)!.days, 12)
  // Relevés commencés il y a 3 jours : l'écart couvre 3 jours, pas 7.
  assert.equal(deltaOf(h.slice(2), 7, NOW)!.days, 3)
})

test('écarts : rien avec un seul jour de relevés, rien d’inventé pour un champ absent ou qui recule', () => {
  assert.equal(deltaOf([pt(NOW, 10, 10)], 7, NOW), null)
  assert.equal(deltaOf([pt(NOW - 3600_000, 10, 10), pt(NOW, 12, 10)], 7, NOW), null)
  const d = deltaOf([pt(NOW - 2 * DAY, 10, 10, { mvps: 4 }), pt(NOW, 8, 12)], 7, NOW)!
  assert.equal(d.kills, undefined)
  assert.equal(d.deaths, 2)
  assert.equal(d.mvps, undefined)
  assert.equal(d.kd, null)
})

test('écarts : un relevé trop ancien ne sert pas de départ (longue pause)', () => {
  const h = [pt(NOW - 60 * DAY, 10, 10), pt(NOW - DAY, 50, 40), pt(NOW, 60, 45)]
  assert.equal(deltaOf(h, 7, NOW)!.kills, 10)
})

test('relevés fictifs du simulateur (fixture) : ils mènent aux totaux, et donnent une semaine', () => {
  const s = lifetimeOf(okValues(fixtureText()))
  const h = fixtureHistory(s, NOW)
  assert.equal(h.length, 30)
  assert.equal(h.at(-1)!.kills, s.totals.kills)
  for (let i = 1; i < h.length; i++) assert.ok(h[i].kills! >= h[i - 1].kills!)
  const d = deltaOf(h, 7, NOW)!
  assert.ok(d.kills! > 0 && d.matchesPlayed! > 0)
})

// ---------- matchs suivis par carte ----------

const recap = (id: string, map: string, result: Cs2Recap['result'], kills: number, deaths: number, damage: number, rounds: number, endedAt: number, extra: Partial<Cs2Recap> = {}): Cs2Recap => ({
  id,
  steamId: '76561198000000001',
  map,
  mode: 'competitive',
  startedAt: endedAt - 40 * 60_000,
  endedAt,
  result,
  kills,
  deaths,
  assists: 0,
  mvps: 0,
  points: 0,
  headshots: 0,
  damage,
  trackedKills: kills,
  roundsTracked: rounds,
  multi: { k3: 0, k4: 0, k5: 0 },
  rounds: [],
  hasRounds: rounds > 0,
  ...extra
})

test('matchs suivis par carte : matchs, V/D, K/D, ADR ; exemples ignorés', () => {
  const list = mapSummaries([
    recap('a', 'de_mirage', 'win', 20, 10, 2200, 22, NOW),
    recap('b', 'de_mirage', 'loss', 10, 20, 1800, 20, NOW - DAY),
    recap('c', 'de_dust2', 'win', 15, 15, 0, 0, NOW - 2 * DAY, { mode: 'deathmatch' }),
    recap('d', 'de_nuke', 'win', 99, 1, 9999, 10, NOW, { sample: true })
  ])
  assert.deepEqual(
    list.map((m) => [m.map, m.matches, m.wins, m.losses]),
    [
      ['de_mirage', 2, 1, 1],
      ['de_dust2', 1, 1, 0]
    ]
  )
  assert.equal(list[0].kd, 1)
  assert.equal(list[0].adr, 4000 / 42)
  assert.equal(list[1].adr, null)
})
