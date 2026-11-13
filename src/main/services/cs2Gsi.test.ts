// Tests de la liaison avec Counter-Strike 2 (npm run test:cs2) : fichier de config et tri des requêtes du serveur local.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cfgText, GSI_PATH, isToken, MAX_BODY, refuse, tokenMatches } from './cs2Gsi'

const TOKEN = 'a'.repeat(20) + 'B_c-0123456789xyz'

test('le fichier de config : adresse locale, jeton, données utiles seulement, sans BOM', () => {
  const text = cfgText(47731, TOKEN)
  assert.ok(!text.startsWith('﻿'))
  assert.match(text, /"uri"\s+"http:\/\/127\.0\.0\.1:47731\/cs2"/)
  assert.match(text, new RegExp(`"token"\\s+"${TOKEN}"`))
  for (const key of ['provider', 'map', 'map_round_wins', 'round', 'player_id', 'player_state', 'player_match_stats']) assert.match(text, new RegExp(`"${key}"\\s+"1"`))
  // Ni armes, ni position, ni autres joueurs.
  assert.doesNotMatch(text, /player_weapons|player_position|allplayers/)
  // Accolades équilibrées : CS2 ignore un fichier mal formé sans rien dire.
  assert.equal((text.match(/\{/g) ?? []).length, (text.match(/\}/g) ?? []).length)
})

test('jeton : assez long, et rien qui casserait le fichier', () => {
  assert.ok(isToken(TOKEN))
  assert.ok(!isToken('court'))
  assert.ok(!isToken('a'.repeat(40) + '"'))
  assert.ok(!isToken(undefined))
})

test('requêtes refusées : autre méthode, autre chemin, page web, envoi trop gros', () => {
  const ok = { method: 'POST', url: GSI_PATH, headers: { 'content-type': 'application/json', 'content-length': '1200' } }
  assert.equal(refuse(ok), null)
  assert.equal(refuse({ ...ok, method: 'GET' }), 405)
  assert.equal(refuse({ ...ok, url: '/autre' }), 404)
  assert.equal(refuse({ ...ok, headers: { ...ok.headers, origin: 'https://exemple.com' } }), 403)
  assert.equal(refuse({ ...ok, headers: { ...ok.headers, 'sec-fetch-site': 'cross-site' } }), 403)
  assert.equal(refuse({ ...ok, headers: { 'content-length': String(MAX_BODY + 1) } }), 413)
})

test('jeton de l’envoi : seulement le bon', () => {
  assert.ok(tokenMatches({ auth: { token: TOKEN } }, TOKEN))
  assert.ok(!tokenMatches({ auth: { token: TOKEN.slice(1) } }, TOKEN))
  assert.ok(!tokenMatches({ auth: { token: TOKEN.toUpperCase() } }, TOKEN))
  assert.ok(!tokenMatches({}, TOKEN))
  assert.ok(!tokenMatches(null, TOKEN))
})
