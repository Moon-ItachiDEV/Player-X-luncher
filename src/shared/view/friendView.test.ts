// Tests de la page Amis (npm run test:friends) : dates en français, profil Steam, sélection par défaut.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Friend } from '../types'
import { classify, friendSinceLabel, lastSeenLabel, libraryIndex, pickDefault, steamProfileUrl } from './friendView'

const NOW = new Date(2026, 9, 25, 20, 0).getTime()
const friend = (id: string, status: Friend['status'], game?: string): Friend => ({ id, platform: id.startsWith('discord') ? 'discord' : 'steam', name: id, status, game })

test('ami depuis : mois et année en français, rien sans date', () => {
  assert.equal(friendSinceLabel(new Date(2025, 8, 14).getTime()), 'Ami depuis septembre 2025')
  assert.equal(friendSinceLabel(undefined), '')
})

test('vu pour la dernière fois : relatif sous un mois, date au-delà', () => {
  assert.equal(lastSeenLabel(NOW - 3 * 3600_000, NOW), 'Vu pour la dernière fois il y a 3 h')
  assert.equal(lastSeenLabel(new Date(2025, 2, 12).getTime(), NOW), 'Vu pour la dernière fois le 12 mars 2025')
  assert.equal(lastSeenLabel(undefined, NOW), '')
})

test('profil Steam : seulement avec un SteamID64', () => {
  assert.equal(steamProfileUrl(friend('steam:76561198000000001', 'online')), 'https://steamcommunity.com/profiles/76561198000000001')
  assert.equal(steamProfileUrl(friend('steam:1', 'online')), undefined)
  assert.equal(steamProfileUrl({ ...friend('psn:76561198000000001', 'online'), platform: 'psn' }), undefined)
})

test('choix par défaut : en jeu, sinon en ligne, sinon le premier', () => {
  const lib = libraryIndex([])
  const off = classify(friend('steam:a', 'offline'), lib)
  const on = classify(friend('steam:b', 'online'), lib)
  const play = classify(friend('steam:c', 'in-game', 'Hades'), lib)
  // Activité Discord hors bibliothèque : en ligne, pas en jeu.
  const spotify = classify(friend('discord:d', 'in-game', 'Spotify'), lib)
  assert.equal(spotify.status, 'online')
  assert.equal(pickDefault([off, on, play])?.friend.id, 'steam:c')
  assert.equal(pickDefault([off, on])?.friend.id, 'steam:b')
  assert.equal(pickDefault([off])?.friend.id, 'steam:a')
  assert.equal(pickDefault([]), undefined)
})
