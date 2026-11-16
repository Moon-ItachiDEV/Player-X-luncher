// Tests des collections et des jeux masqués (npm run test:ready) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { cleanShelves, collectionName, withGameIn, withHidden, withNewCollection, withoutCollection, withRenamed } from './shelves.ts'

const empty = { collections: [], hidden: [] }

test('créer, renommer, supprimer ; noms propres et sans doublon', () => {
  let s = withNewCollection(empty, 'c0001', '  Avec   les potes ', 'steam:730')
  assert.deepEqual(s.collections, [{ id: 'c0001', name: 'Avec les potes', games: ['steam:730'] }])
  assert.throws(() => withNewCollection(s, 'c0002', 'avec les POTES'), /déjà/)
  assert.throws(() => withNewCollection(s, 'c0002', '   '), /nom/)
  s = withNewCollection(s, 'c0002', 'Solo')
  assert.throws(() => withRenamed(s, 'c0002', 'Avec les potes'), /déjà/)
  s = withRenamed(s, 'c0002', 'À finir')
  assert.equal(s.collections[1].name, 'À finir')
  s = withoutCollection(s, 'c0001')
  assert.deepEqual(
    s.collections.map((c) => c.name),
    ['À finir']
  )
  assert.equal(collectionName('x'.repeat(80)).length, 40)
})

test('ajouter et retirer un jeu ; jamais deux fois', () => {
  let s = withNewCollection(empty, 'c0001', 'Solo')
  s = withGameIn(s, 'c0001', 'ea:Origin.OFR.50.0005577', true)
  s = withGameIn(s, 'c0001', 'ea:Origin.OFR.50.0005577', true)
  assert.deepEqual(s.collections[0].games, ['ea:Origin.OFR.50.0005577'])
  s = withGameIn(s, 'c0001', 'ea:Origin.OFR.50.0005577', false)
  assert.deepEqual(s.collections[0].games, [])
  assert.throws(() => withGameIn(s, 'c0001', 'file:C:\\x.exe', true), /Jeu inconnu/)
  assert.throws(() => withGameIn(s, 'c9999', 'steam:730', true), /introuvable/)
})

test('masquer et réafficher', () => {
  let s = withHidden(empty, 'steam:570', true)
  s = withHidden(s, 'steam:570', true)
  assert.deepEqual(s.hidden, ['steam:570'])
  assert.deepEqual(withHidden(s, 'steam:570', false).hidden, [])
})

test('relu depuis la base : seulement ce qui est bien formé', () => {
  const s = cleanShelves({
    collections: [
      { id: 'c0001', name: 'Solo', games: ['steam:730', 'steam:730', 42, 'bad'] },
      { id: 'c0001', name: 'Doublon', games: [] },
      { id: 'x', name: 'Mauvais id', games: [] },
      { id: 'c0002', name: '', games: [] },
      null
    ],
    hidden: ['steam:570', 'nope']
  })
  assert.deepEqual(s, { collections: [{ id: 'c0001', name: 'Solo', games: ['steam:730'] }], hidden: ['steam:570'] })
  assert.deepEqual(cleanShelves(null), empty)
})
