// Tests de « qui est là » sur l'accueil (npm run test:home) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Friend, Game } from '../types'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { aroundLabel, playersLabel, playersOf, whoIsAround } from './around.ts'

const game = (name: string): Game => ({ id: `steam:${name}`, store: 'steam', storeId: name, name })
const ELDEN = game('ELDEN RING')
let n = 0
const f = (platform: Friend['platform'], name: string, status: Friend['status'], extra: Partial<Friend> = {}): Friend => ({
  id: `${platform}:${++n}`,
  platform,
  name,
  status,
  ...extra
})

test('personne en ligne : null', () => {
  assert.equal(whoIsAround(ELDEN, []), null)
  assert.equal(whoIsAround(ELDEN, [f('steam', 'A', 'offline'), f('psn', 'B', 'offline')]), null)
})

test('hors ligne et présence PSN illisible exclus, absents comptés', () => {
  const a = whoIsAround(ELDEN, [f('steam', 'Draxx', 'away'), f('steam', 'Orbit', 'offline'), f('psn', 'Kenji', 'online', { presenceUnknown: true }), f('psn', 'Okami', 'online')])
  assert.ok(a)
  assert.deepEqual(
    a.people.map((p) => p.name),
    ['Okami', 'Draxx']
  )
  assert.equal(a.kind, 'friends')
  assert.equal(a.here.size, 0)
  assert.equal(aroundLabel(a), '2 amis en ligne')
})

test('membres Discord : exclus à côté de vrais amis, sauf sur ce jeu', () => {
  const list = [f('steam', 'Pixel', 'online'), f('discord', 'Mira', 'online'), f('discord', 'Lunaa', 'in-game', { game: 'Valorant' }), f('discord', 'Sol', 'in-game', { game: 'ELDEN RING' })]
  const a = whoIsAround(ELDEN, list)
  assert.ok(a)
  assert.deepEqual(
    a.people.map((p) => p.name),
    ['Sol', 'Pixel']
  )
  assert.equal(a.kind, 'friends')
  assert.equal(aroundLabel(a), '1 ami et 1 membre du serveur en ligne, dont 1 sur ce jeu')
})

test('seulement un serveur Discord : « membres du serveur »', () => {
  const a = whoIsAround(ELDEN, [f('discord', 'Mira', 'online'), f('discord', 'Lunaa', 'in-game', { game: 'Valorant' }), f('discord', 'Zed', 'away')])
  assert.ok(a)
  assert.equal(a.kind, 'members')
  assert.equal(a.people.length, 3)
  assert.equal(aroundLabel(a), '3 membres du serveur en ligne')
})

test('vrais amis tous hors ligne et un membre sur ce jeu : « membres », une personne', () => {
  const a = whoIsAround(ELDEN, [f('steam', 'Orbit', 'offline'), f('discord', 'Mira', 'online'), f('discord', 'Sol', 'in-game', { game: 'ELDEN RING' })])
  assert.ok(a)
  assert.equal(a.kind, 'members')
  assert.deepEqual(
    a.people.map((p) => p.name),
    ['Sol']
  )
  assert.equal(aroundLabel(a), '1 membre du serveur en ligne, dont 1 sur ce jeu')
})

test('ordre : sur ce jeu, en jeu ailleurs, en ligne, absents, puis par nom', () => {
  const list = [
    f('steam', 'zoé', 'away'),
    f('steam', 'Bob', 'online'),
    f('psn', 'Ana', 'online'),
    f('steam', 'Rook', 'in-game', { game: 'Counter-Strike 2' }),
    f('steam', 'Valkyr', 'in-game', { game: 'ELDEN RING' }),
    f('steam', 'NeoKai', 'in-game', { game: 'ELDEN RING' }),
    f('steam', 'Émile', 'away')
  ]
  const a = whoIsAround(ELDEN, list)
  assert.ok(a)
  assert.deepEqual(
    a.people.map((p) => p.name),
    ['NeoKai', 'Valkyr', 'Rook', 'Ana', 'Bob', 'Émile', 'zoé']
  )
  assert.equal(aroundLabel(a), '7 amis en ligne, dont 2 sur ce jeu')
  assert.deepEqual(
    [...a.here].sort(),
    list
      .filter((p) => p.game === 'ELDEN RING')
      .map((p) => p.id)
      .sort()
  )
})

test('le jeu se reconnaît malgré ™ et la ponctuation', () => {
  const fc = game('EA SPORTS FC™ 27')
  const a = whoIsAround(fc, [f('psn', 'ShadowFox_93', 'in-game', { game: 'EA SPORTS FC 27', device: 'PS5' })])
  assert.ok(a)
  assert.equal(a.here.size, 1)
  assert.equal(playersOf(fc, a.people).length, 1)
})

test('libellés au singulier et au pluriel', () => {
  const one = whoIsAround(ELDEN, [f('steam', 'Pixel', 'online')])
  assert.ok(one)
  assert.equal(aroundLabel(one), '1 ami en ligne')
  const mixed = whoIsAround(ELDEN, [
    ...['A', 'B', 'C', 'D', 'E', 'F'].map((x) => f('steam', x, 'online')),
    f('discord', 'Sol', 'in-game', { game: 'ELDEN RING' }),
    f('steam', 'G', 'in-game', { game: 'ELDEN RING' })
  ])
  assert.ok(mixed)
  assert.equal(aroundLabel(mixed), '7 amis et 1 membre du serveur en ligne, dont 2 sur ce jeu')
  const p1 = f('steam', 'Rook', 'in-game', { game: 'Counter-Strike 2' })
  const p2 = f('steam', 'Ace', 'in-game', { game: 'Counter-Strike 2' })
  const m1 = f('discord', 'Sol', 'in-game', { game: 'Counter-Strike 2' })
  assert.equal(playersLabel([p1]), '1 ami en jeu')
  assert.equal(playersLabel([p1, p2]), '2 amis en jeu')
  assert.equal(playersLabel([p1, m1]), '1 ami et 1 membre du serveur en jeu')
  assert.equal(playersLabel([m1]), '1 membre du serveur en jeu')
})
