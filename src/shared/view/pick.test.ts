// Tests des choix de l'accueil (npm run test:home) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AchievementsOverview, Bf6Recap, Cs2Recap, Game } from '../types'
// @ts-ignore TS5097
import { achievementsOf, latestMatch, pickHero, resumeList, shelfList, storesOf } from './pick.ts'

const g = (name: string, extra: Partial<Game> = {}): Game => ({
  id: `steam:${name}`,
  store: 'steam',
  storeId: name,
  name,
  ...extra
})

test('à la une : le jeu en cours, sinon la dernière partie, sinon un favori avec une image', () => {
  const a = g('A', { lastPlayed: 100 })
  const b = g('B', { lastPlayed: 300 })
  const c = g('C', { running: true, runningSince: 5 })
  assert.equal(pickHero([a, b, c])?.name, 'C')
  assert.equal(pickHero([a, b])?.name, 'B')
  assert.equal(pickHero([g('X'), g('Y', { favorite: true, coverUrl: 'y.jpg' })])?.name, 'Y')
  assert.equal(pickHero([]), null)
})

test('« À reprendre » : dernières parties, jeu à la une compris, au plus 4', () => {
  const games = ['A', 'B', 'C', 'D', 'E'].map((n, i) => g(n, { lastPlayed: (i + 1) * 100 }))
  const hero = pickHero(games)
  const { list, resumed } = resumeList(games, hero)
  assert.equal(resumed, true)
  assert.deepEqual(
    list.map((x) => x.name),
    ['E', 'D', 'C', 'B']
  )
  // Un jeu mis à la une hors de la liste y entre en tête.
  const forced = resumeList(games, games[0])
  assert.deepEqual(
    forced.list.map((x) => x.name),
    ['A', 'E', 'D', 'C']
  )
})

test('« À reprendre » sans historique : favoris, puis jeux avec image', () => {
  const games = [g('Zed', { coverUrl: 'z' }), g('Bob'), g('Ana', { favorite: true })]
  const { list, resumed } = resumeList(games, pickHero(games))
  assert.equal(resumed, false)
  assert.deepEqual(
    list.map((x) => x.name),
    ['Ana', 'Zed']
  )
})

test('carrousel : récents, favoris, puis par nom ; filtre de store', () => {
  const games = [g('b'), g('a'), g('fav', { favorite: true }), g('old', { lastPlayed: 1 }), g('new', { lastPlayed: 2 }), g('epic', { store: 'epic' })]
  assert.deepEqual(
    shelfList(games, 'all').map((x) => x.name),
    ['new', 'old', 'fav', 'a', 'b', 'epic']
  )
  assert.deepEqual(
    shelfList(games, 'epic').map((x) => x.name),
    ['epic']
  )
  assert.deepEqual(storesOf(games), ['steam', 'epic'])
})

const overview = (games: AchievementsOverview['games'], state: AchievementsOverview['state'] = 'ready'): AchievementsOverview => ({
  state,
  games,
  recent: [],
  rarest: [],
  unlocked: 0,
  total: 0,
  perfect: 0,
  average: 0,
  updatedAt: 1
})

test('succès du jeu à la une : son relevé, sinon rien', () => {
  const o = overview([
    { gameId: 'steam:1', name: 'Un', unlocked: 3, total: 10, lastAt: 50 },
    { gameId: 'steam:2', name: 'Deux', unlocked: 0, total: 10 },
    { gameId: 'steam:3', name: 'Trois', unlocked: 9, total: 10, lastAt: 90 },
    { gameId: 'steam:4', name: 'Quatre', unlocked: 1, total: 4 },
    { gameId: 'steam:5', name: 'Cinq', unlocked: 2, total: 2, lastAt: 10 }
  ])
  assert.equal(achievementsOf(o, 'steam:3')?.unlocked, 9)
  assert.equal(achievementsOf(o, 'steam:9'), null)
  assert.equal(achievementsOf(null, 'steam:3'), null)
})

const cs2 = (endedAt: number, extra: Partial<Cs2Recap> = {}): Cs2Recap =>
  ({
    id: `c${endedAt}`,
    endedAt,
    kills: 1,
    deaths: 1,
    mvps: 0,
    result: 'win',
    ...extra
  }) as Cs2Recap
const bf6 = (endedAt: number, extra: Partial<Bf6Recap> = {}): Bf6Recap => ({ id: `b${endedAt}`, endedAt, ...extra }) as Bf6Recap

test('dernier match : le plus récent des vrais bilans, réglages activés seulement', () => {
  assert.equal(latestMatch(null, null), null)
  assert.equal(latestMatch({ enabled: true, recaps: [] }, { enabled: true, recaps: [] }), null)
  assert.equal(latestMatch({ enabled: true, recaps: [cs2(200)] }, { enabled: true, recaps: [bf6(100)] })?.kind, 'cs2')
  assert.equal(latestMatch({ enabled: true, recaps: [cs2(100)] }, { enabled: true, recaps: [bf6(200)] })?.kind, 'bf6')
  assert.equal(latestMatch({ enabled: false, recaps: [cs2(300)] }, { enabled: true, recaps: [bf6(200)] })?.kind, 'bf6')
  assert.equal(latestMatch({ enabled: true, recaps: [cs2(300, { sample: true })] }, null), null)
})
