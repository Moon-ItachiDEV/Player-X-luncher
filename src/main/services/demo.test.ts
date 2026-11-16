// Tests des données du mode démo (npm run test:played) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { DEMO_FRIENDS, demoGames, demoNotInstalled } from './demo.ts'
// @ts-ignore TS5097
import { demoAchievements } from './achievementsDemo.ts'

const NOW = new Date(2026, 9, 21, 22, 0).getTime()

test('dernière partie : chaque jeu joué a une date et sa source, les trois sources sont là', () => {
  const games = demoGames(NOW)
  for (const g of games.filter((x) => (x.playtime ?? 0) > 0)) {
    assert.ok(g.lastPlayed && g.lastPlayed < NOW, g.name)
    assert.ok(g.lastPlayedSource, g.name)
  }
  assert.deepEqual([...new Set(games.map((g) => g.lastPlayedSource).filter(Boolean))].sort(), ['launch', 'session', 'steam'])
  // « Lancé » ne vaut que pour les jeux lancés depuis Player X : jamais de lancements avec une autre source.
  for (const g of games.filter((x) => x.lastPlayedSource && x.lastPlayedSource !== 'launch')) assert.equal(g.launches, 0, g.name)
  // Jeux sans aucune partie connue : l'état vide reste visible.
  for (const name of ['Alan Wake 2', 'EA SPORTS FC™ 27']) {
    const g = games.find((x) => x.name === name)
    assert.ok(g, name)
    assert.equal(g.lastPlayed, undefined, name)
    assert.equal(g.playtime, undefined, name)
  }
})

test('jeux non installés : leurs dates viennent de Steam', () => {
  const list = demoNotInstalled(NOW)
  assert.ok(list.some((g) => g.lastPlayed))
  for (const g of list) assert.equal(g.lastPlayedSource, g.lastPlayed ? 'steam' : undefined, g.name)
})

test('succès de démo : un jeu joué en a, un jeu jamais joué aucun, jamais débloqués après la dernière partie', () => {
  for (const g of [...demoGames(NOW), ...demoNotInstalled(NOW)]) {
    const a = demoAchievements(g, NOW)
    if (a.state !== 'ready') continue
    assert.equal(a.unlocked > 0, (g.playtime ?? 0) > 0, g.name)
    // Heure du déblocage fixée dans la journée (achievementsDemo.ts) : à moins de 12 h près.
    for (const x of a.list) if (x.unlockedAt) assert.ok(x.unlockedAt <= (g.lastPlayed ?? 0) + 12 * 3600_000, `${g.name} · ${x.name}`)
  }
})

test('amis de démo : identifiants uniques, un seul ami sur Counter-Strike 2', () => {
  assert.equal(new Set(DEMO_FRIENDS.map((f) => f.id)).size, DEMO_FRIENDS.length)
  const cs2 = DEMO_FRIENDS.filter((f) => f.platform !== 'discord' && f.status === 'in-game' && f.game === 'Counter-Strike 2')
  assert.equal(cs2.length, 1)
})
