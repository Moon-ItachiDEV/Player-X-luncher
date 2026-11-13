// Tests de la recherche du jeu Steam d'un jeu GOG, Epic ou EA (npm run test:launch).
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { NOT_FOUND_RETRY_MS, pickExact, searchTerms } from './artworkMatch.ts'

test('mots cherchés : le nom nettoyé d’abord, puis plus souples, sans doublon', () => {
  assert.deepEqual(searchTerms('The Witcher 3: Wild Hunt - Game of the Year Edition'), ['The Witcher 3: Wild Hunt', 'The Witcher 3 Wild Hunt', 'The Witcher 3'])
  assert.deepEqual(searchTerms('Cyberpunk 2077'), ['Cyberpunk 2077'])
  assert.deepEqual(searchTerms('Battlefield™ 6'), ['Battlefield 6'])
  assert.ok(searchTerms('Marvel’s Spider-Man: Remastered').includes('Marvel s Spider-Man Remastered'))
})

test('résultat gardé : le nom exact seulement', () => {
  const items = [{ id: 1, name: 'The Witcher 3: Wild Hunt - Blood and Wine' }, { id: 292030, name: 'The Witcher® 3: Wild Hunt' }]
  assert.equal(pickExact(items, 'The Witcher 3: Wild Hunt - Game of the Year Edition'), '292030')
  assert.equal(pickExact(items.slice(0, 1), 'The Witcher 3: Wild Hunt'), null)
  assert.equal(pickExact([], 'x'), null)
  assert.equal(NOT_FOUND_RETRY_MS, 6 * 3600_000)
})
