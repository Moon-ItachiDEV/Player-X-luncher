// Tests de Mes loadouts (npm run test:armory) : nettoyage, ajout, suppression, points et texte à copier.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { MAX_LOADOUTS, cleanLoadout, cleanLoadouts, loadoutPoints, loadoutText, suggestName, withLoadout, withoutLoadout } from './bf6Loadouts.ts'

const base = { id: 'l1', name: '  Rush   Conquête ', cls: 'assault', weapon: 'M433', parts: {}, updatedAt: 1 }

test('nettoyage : champs propres, accessoires valides, l’essentiel obligatoire', () => {
  const l = cleanLoadout({
    ...base,
    context: '  Percée ',
    parts: { muzzle: { name: ' Double-Port Brake ', pts: 10 }, barrel: { name: '16.5" Fluted', pts: 120 }, bogus: { name: 'x' }, ammo: { name: '' } },
    gadget1: 'Défibrillateur',
    gadget2: '   ',
    notes: ' Bien pour les couloirs \r\n',
    extra: 'ignoré'
  })
  assert.deepEqual(l, {
    id: 'l1',
    name: 'Rush Conquête',
    cls: 'assault',
    weapon: 'M433',
    context: 'Percée',
    parts: { muzzle: { name: 'Double-Port Brake', pts: 10 }, barrel: { name: '16.5" Fluted' } },
    gadget1: 'Défibrillateur',
    notes: 'Bien pour les couloirs',
    updatedAt: 1
  })
  assert.equal(cleanLoadout({ ...base, name: ' ' }), null)
  assert.equal(cleanLoadout({ ...base, weapon: '' }), null)
  assert.equal(cleanLoadout({ ...base, cls: 'pilot' }), null)
  assert.equal(cleanLoadout({ ...base, id: '../x' }), null)
  assert.equal(cleanLoadout(null), null)
})

test('liste : doublons écartés, plus récents d’abord, plafond', () => {
  const list = cleanLoadouts([base, { ...base, name: 'Copie' }, { ...base, id: 'l2', updatedAt: 5 }, 'x'])
  assert.deepEqual(
    list.map((l) => l.id),
    ['l2', 'l1']
  )
  assert.deepEqual(cleanLoadouts('nope'), [])
  const many = Array.from({ length: MAX_LOADOUTS + 5 }, (_, i) => ({ ...base, id: `l${i}`, updatedAt: i }))
  assert.equal(cleanLoadouts(many).length, MAX_LOADOUTS)
})

test('ajouter, remplacer, supprimer', () => {
  let list = withLoadout([], base, 10)
  assert.equal(list[0].updatedAt, 10)
  list = withLoadout(list, { ...base, id: 'l2', name: 'Défense' }, 20)
  list = withLoadout(list, { ...base, name: 'Rush 2' }, 30)
  assert.deepEqual(
    list.map((l) => `${l.id}:${l.name}`),
    ['l1:Rush 2', 'l2:Défense']
  )
  assert.throws(() => withLoadout(list, { ...base, weapon: ' ' }, 40), /arme principale/)
  const full = Array.from({ length: MAX_LOADOUTS }, (_, i) => cleanLoadout({ ...base, id: `f${i}` })!)
  assert.throws(() => withLoadout(full, { ...base, id: 'new' }, 1), /supprimes-en/)
  assert.equal(withLoadout(full, { ...base, id: 'f3' }, 1).length, MAX_LOADOUTS, 'remplacer reste permis')
  assert.deepEqual(
    withoutLoadout(list, 'l1').map((l) => l.id),
    ['l2']
  )
})

test('points et texte à copier', () => {
  const l = cleanLoadout({
    ...base,
    context: 'Conquête',
    parts: { optic: { name: 'Iron Sights', pts: 5 }, muzzle: { name: 'Double-Port Brake', pts: 10 }, barrel: { name: '16.5" Fluted', pts: 20 } },
    secondary: 'P18',
    gadget1: 'Lance-grenades',
    gadget2: 'Seringue',
    notes: 'Ligne 1\nLigne 2'
  })!
  assert.deepEqual(loadoutPoints(l), { total: 35, missing: 0, count: 3 })
  assert.equal(
    loadoutText(l),
    [
      'Rush Conquête · Assaut · Conquête',
      'M433',
      '  Optique : Iron Sights (5 pts)',
      '  Bouche : Double-Port Brake (10 pts)',
      '  Canon : 16.5" Fluted (20 pts)',
      '  Total : 35 / 100 pts',
      'Arme secondaire : P18',
      'Gadgets : Lance-grenades, Seringue',
      '',
      'Ligne 1\nLigne 2'
    ].join('\n')
  )
  const partial = cleanLoadout({ ...base, parts: { muzzle: { name: 'Brake' }, barrel: { name: 'Fluted', pts: 20 } } })!
  assert.deepEqual(loadoutPoints(partial), { total: 20, missing: 1, count: 2 })
  assert.ok(!loadoutText(partial).includes('Total'), 'pas de total quand des points manquent')
})

test('nom proposé', () => {
  const list = cleanLoadouts([
    { ...base, name: 'Assaut 1' },
    { ...base, id: 'l2', name: 'assaut 2' }
  ])
  assert.equal(suggestName(list, 'assault'), 'Assaut 3')
  assert.equal(suggestName(list, 'recon'), 'Éclaireur 1')
})

test('classement : S, A, B, C gardés, le reste ignoré', () => {
  // @ts-ignore TS5097
  assert.equal(cleanLoadout({ ...base, tier: 'S' })?.tier, 'S')
  assert.equal(cleanLoadout({ ...base, tier: 'Z' })?.tier, undefined)
})
