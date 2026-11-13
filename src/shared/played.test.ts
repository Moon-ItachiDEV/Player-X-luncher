// Tests de la dernière partie (npm run test:played) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { cardMeta, hasPlayed, lastPlayedOf, playedBadge, playedOn } from './played.ts'

// Dates locales : les tests ne dépendent pas du fuseau horaire de la machine.
const NOW = new Date(2026, 9, 21, 22, 0).getTime()
const H = 3600_000

test('aucune date : rien', () => {
  assert.equal(lastPlayedOf({}, NOW), null)
  assert.equal(lastPlayedOf({ launch: undefined, steam: undefined }, NOW), null)
})

test('la plus récente gagne ; un lancement depuis Player X ne cède jamais devant une date Steam plus ancienne', () => {
  assert.deepEqual(lastPlayedOf({ launch: NOW - 5 * 60_000, steam: NOW - 72 * H }, NOW), { at: NOW - 5 * 60_000, source: 'launch' })
  assert.deepEqual(lastPlayedOf({ launch: NOW - 72 * H, steam: NOW - 3 * H }, NOW), { at: NOW - 3 * H, source: 'steam' })
  assert.deepEqual(lastPlayedOf({ launch: NOW - 3 * H, session: NOW - H }, NOW), { at: NOW - H, source: 'session' })
})

test('égalité : lancement, puis partie vue, puis Steam', () => {
  assert.equal(lastPlayedOf({ steam: NOW - H, session: NOW - H, launch: NOW - H }, NOW)?.source, 'launch')
  assert.equal(lastPlayedOf({ steam: NOW - H, session: NOW - H }, NOW)?.source, 'session')
})

test('dates invalides ignorées, léger décalage d’horloge ramené à maintenant', () => {
  for (const v of [0, -1, NaN, Infinity, 1_700_000_000, NOW + 2 * 24 * H]) assert.equal(lastPlayedOf({ steam: v }, NOW), null, String(v))
  // Une date invalide n'empêche pas une autre source valide.
  assert.deepEqual(lastPlayedOf({ steam: NOW + 2 * 24 * H, launch: NOW - 2 * H }, NOW), { at: NOW - 2 * H, source: 'launch' })
  assert.deepEqual(lastPlayedOf({ steam: NOW + 5 * 60_000 }, NOW), { at: NOW, source: 'steam' })
  assert.equal(lastPlayedOf({ steam: 1_700_000_000 * 1000 }, NOW)?.source, 'steam')
})

test('playedOn : « Lancé » seulement depuis Player X, l’année hors de l’année en cours', () => {
  assert.equal(playedOn(new Date(2026, 9, 21, 20, 10).getTime(), 'launch', NOW), "Lancé aujourd'hui · 20:10")
  assert.equal(playedOn(new Date(2026, 9, 20, 18, 5).getTime(), 'steam', NOW), 'Joué hier · 18:05')
  assert.equal(playedOn(new Date(2026, 9, 12, 14, 0).getTime(), 'session', NOW), 'Joué le 12 oct. · 14:00')
  assert.equal(playedOn(new Date(2019, 2, 3, 9, 0).getTime(), 'steam', NOW), 'Joué le 3 mars 2019')
  assert.equal(playedOn(new Date(2026, 9, 20, 18, 5).getTime(), undefined, NOW), 'Joué hier · 18:05')
})

test('pastille : en cours, il y a…, ou rien', () => {
  assert.equal(playedBadge({ lastPlayed: undefined }, NOW), null)
  assert.equal(playedBadge({ running: true, lastPlayed: NOW - H }, NOW), 'En cours')
  assert.equal(playedBadge({ lastPlayed: NOW - 2 * H }, NOW), 'Il y a 2 h')
})

test('déjà joué et méta des jaquettes : jamais « jamais lancé » à côté d’un temps de jeu', () => {
  assert.equal(hasPlayed({}), false)
  assert.equal(hasPlayed({ playtime: 540 }), true)
  assert.equal(hasPlayed({ launches: 3 }), true)
  assert.equal(hasPlayed({ lastPlayed: NOW - H }), true)
  // Rien de connu : jamais « Pas encore joué » (le jeu a pu être joué avant Player X ou sans clé Steam Web API).
  assert.equal(cardMeta({}, NOW), 'Aucune partie connue')
  assert.equal(cardMeta({ playtime: 540 }, NOW), '9 h')
  assert.equal(cardMeta({ playtime: 540, lastPlayed: NOW - 2 * H }, NOW), '9 h · il y a 2 h')
  assert.equal(cardMeta({ lastPlayed: NOW - 2 * H }, NOW), 'Il y a 2 h')
  assert.equal(cardMeta({ running: true, playtime: 2_745 }, NOW), 'En jeu · 45 h 45')
  assert.equal(cardMeta({ notInstalled: true, playtime: 3_120 }, NOW), 'Pas installé · 52 h')
})
