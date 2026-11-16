// Tests des logiciels Steam (npm run test:profile) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { hasName, KNOWN_SOFTWARE, parseAppListPage } from './steamApps.ts'

test('parseAppListPage : appids et page suivante', () => {
  const page = parseAppListPage({ response: { apps: [{ appid: 431960, name: 'Wallpaper Engine' }, { appid: 'x' }, { appid: -1 }], have_more_results: true, last_appid: 431960 } })
  assert.deepEqual(page, { ids: ['431960'], next: 431960 })
  assert.deepEqual(parseAppListPage({ response: { apps: [{ appid: 7 }] } }), { ids: ['7'], next: 0 })
})

test('parseAppListPage : réponse vide ou inattendue', () => {
  assert.deepEqual(parseAppListPage({ response: {} }), { ids: [], next: 0 })
  assert.equal(parseAppListPage({}), null)
  assert.equal(parseAppListPage(null), null)
  assert.equal(parseAppListPage({ response: { apps: 'non' } }), null)
})

test('hasName : les entrées sans nom sont écartées', () => {
  assert.equal(hasName('ELDEN RING'), true)
  assert.equal(hasName('7 Days to Die'), true)
  assert.equal(hasName(''), false)
  assert.equal(hasName('  ™ '), false)
  assert.equal(hasName(undefined), false)
})

test('Wallpaper Engine est un logiciel connu', () => {
  assert.ok(KNOWN_SOFTWARE.includes('431960'))
})
