// Tests des serveurs (npm run test:ready) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { formatPlayers, parseCs2Servers, parsePlayerCount, serversLabel, serversOk, waitLabel } from './servers.ts'

/** Forme de la réponse de Valve (CS:GO puis CS2), raccourcie. */
const sample = {
  result: {
    app: { version: 2000431, timestamp: 1761800000, time: '06:12:00' },
    services: { SessionsLogon: 'normal', SteamCommunity: 'normal', IEconItems: 'normal', Leaderboards: 'normal' },
    datacenters: {
      'EU West': { capacity: 'full', load: 'low' },
      'EU East': { capacity: 'full', load: 'medium' },
      Spain: { capacity: 'full', load: 'idle' },
      'US Northeast': { capacity: 'full', load: 'high' }
    },
    matchmaking: { scheduler: 'normal', online_servers: 123456, online_players: 1234567, searching_players: 34567, search_seconds_avg: 121 }
  }
}

test('réponse complète : états, chiffres et datacenters européens seulement', () => {
  const s = parseCs2Servers(sample, 1000)
  assert.ok(s)
  assert.equal(s.matchmaking, 'normal')
  assert.equal(s.logon, 'normal')
  assert.equal(s.searchSeconds, 121)
  assert.equal(s.searching, 34567)
  assert.equal(s.online, 1234567)
  assert.deepEqual(
    s.europe.map((d) => d.name),
    ['EU West', 'EU East', 'Spain']
  )
  assert.equal(serversOk(s), true)
  assert.equal(serversLabel(s), "Matchmaking OK · ~2 min d'attente")
})

test('matchmaking ou connexion perturbés : la connexion passe avant', () => {
  const base = parseCs2Servers(sample, 0)!
  assert.equal(serversLabel({ ...base, matchmaking: 'delayed' }), 'Matchmaking ralenti')
  assert.equal(serversOk({ ...base, matchmaking: 'delayed' }), false)
  assert.equal(serversLabel({ ...base, matchmaking: 'delayed', logon: 'offline' }), 'Connexion à Steam hors ligne')
  assert.equal(serversLabel({ ...base, searchSeconds: undefined }), 'Matchmaking OK')
})

test('réponse inattendue : null, jamais de chiffres inventés', () => {
  assert.equal(parseCs2Servers(null, 0), null)
  assert.equal(parseCs2Servers({}, 0), null)
  assert.equal(parseCs2Servers({ result: { app: {} } }, 0), null)
  const partial = parseCs2Servers({ result: { matchmaking: { scheduler: 'normal', search_seconds_avg: 'x' } } }, 0)
  assert.ok(partial)
  assert.equal(partial.searchSeconds, undefined)
  assert.equal(partial.logon, 'unknown')
  assert.deepEqual(partial.europe, [])
})

test('temps d’attente arrondi', () => {
  assert.equal(waitLabel(12), '~10 s')
  assert.equal(waitLabel(2), '~5 s')
  assert.equal(waitLabel(60), '~60 s')
  assert.equal(waitLabel(121), '~2 min')
  assert.equal(waitLabel(700), '~12 min')
})

test('joueurs en jeu sur Steam', () => {
  assert.equal(parsePlayerCount({ response: { player_count: 312000, result: 1 } }), 312000)
  assert.equal(parsePlayerCount({ response: { result: 42 } }), null)
  assert.equal(parsePlayerCount({}), null)
  assert.equal(formatPlayers(312000), '312 000')
  assert.equal(formatPlayers(1_234_567), '1,2 M')
})
