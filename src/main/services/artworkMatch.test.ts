// Tests de la recherche du jeu Steam d'un jeu GOG, Epic ou EA (npm run test:launch).
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { MATCH_VERSION, NOT_FOUND_RETRY_MS, firstWithCover, looseIds, matchIds, pickExact, searchTerms, withoutEdition } from './artworkMatch.ts'

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

// 0.6.2 : la jaquette de The Witcher 3 (GOG) manquait toujours chez Breezydev
const W3 = { id: 292030, name: 'The Witcher® 3: Wild Hunt' }
const W3_GOTY = { id: 499450, name: 'The Witcher® 3: Wild Hunt - Game of the Year Edition' }
const W3_DLC = { id: 378648, name: 'The Witcher 3: Wild Hunt - Blood and Wine' }

test('même nom une fois l’édition retirée : tous les candidats, le nom exact d’abord, puis le jeu de base', () => {
  assert.deepEqual(matchIds([W3_DLC, W3, W3_GOTY], 'The Witcher 3: Wild Hunt - Game of the Year Edition'), ['499450', '292030'])
  assert.deepEqual(matchIds([W3_GOTY, W3], 'The Witcher 3: Wild Hunt - Complete Edition'), ['292030', '499450'])
  assert.deepEqual(matchIds([W3_GOTY, W3], 'The Witcher 3: Wild Hunt'), ['292030', '499450'])
  // Une édition qui est un autre jeu garde son nom exact en premier
  assert.deepEqual(matchIds([{ id: 1, name: 'Mafia' }, { id: 2, name: 'Mafia: Definitive Edition' }], 'Mafia: Definitive Edition'), ['2', '1'])
  assert.equal(pickExact([{ id: 7, name: 'DARK SOULS™: REMASTERED' }], 'Dark Souls Remastered'), '7')
})

test('mots d’édition sans tiret : retirés en dernier recours seulement', () => {
  assert.equal(withoutEdition('The Witcher 3 Wild Hunt Remastered'), 'The Witcher 3 Wild Hunt')
  assert.equal(withoutEdition('The Witcher 3: Wild Hunt GOTY'), 'The Witcher 3: Wild Hunt')
  assert.equal(withoutEdition('The Witcher 3: Wild Hunt Complete Edition Next-Gen'), 'The Witcher 3: Wild Hunt')
  assert.equal(withoutEdition('Gold'), 'Gold')
  assert.equal(withoutEdition('Cyberpunk 2077'), 'Cyberpunk 2077')
  assert.ok(searchTerms('The Witcher 3 Wild Hunt Remastered').includes('The Witcher 3 Wild Hunt'))
  assert.equal(pickExact([W3, W3_GOTY], 'The Witcher 3 Wild Hunt Remastered'), null)
  assert.deepEqual(looseIds([W3_DLC, W3_GOTY, W3], 'The Witcher 3 Wild Hunt Remastered'), ['292030', '499450'])
  assert.deepEqual(looseIds([W3, W3_GOTY], 'The Witcher 3: Wild Hunt GOTY'), ['292030', '499450'])
  // Un nom sans mot d'édition ne passe jamais par là
  assert.deepEqual(looseIds([W3], 'The Witcher 3: Wild Hunt'), [])
  assert.deepEqual(looseIds([{ id: 3, name: 'Cyberpunk' }], 'Cyberpunk 2077'), [])
})

test('jaquette : le premier candidat qui en a une, sinon le premier', () => {
  const art = new Set(['292030'])
  assert.equal(firstWithCover(['499450', '292030'], (id) => art.has(id)), '292030')
  assert.equal(firstWithCover(['499450', '1'], (id) => art.has(id)), '499450')
  assert.equal(firstWithCover([], () => true), null)
  assert.equal(MATCH_VERSION, 2)
})
