// Tests de Jeux récents (npm run test:ready) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { launchArgOf, menuLabel, recentGames } from './recentGames.ts'

const g = (id: string, lastPlayed?: number, notInstalled?: boolean) => ({
  id,
  store: id.split(':')[0] as 'steam',
  storeId: id.split(':')[1],
  name: id,
  ...(lastPlayed ? { lastPlayed } : {}),
  ...(notInstalled ? { notInstalled } : {})
})

test('argument --launch : seulement un identifiant de jeu bien formé', () => {
  assert.equal(launchArgOf(['Player X.exe', '--launch=steam:730']), 'steam:730')
  assert.equal(launchArgOf(['x', '--launch=ea:Origin.OFR.50.0005577']), 'ea:Origin.OFR.50.0005577')
  assert.equal(launchArgOf(['x', '--launch=epic:Fortnite']), 'epic:Fortnite')
  assert.equal(launchArgOf(['x', '--hidden']), null)
  assert.equal(launchArgOf(['x', '--launch=']), null)
  assert.equal(launchArgOf(['x', '--launch=steam:730 --evil']), null)
  assert.equal(launchArgOf(['x', '--launch=file:C:\\x.exe']), null)
  assert.equal(launchArgOf(['x', '--launch="steam:730"']), null)
})

test('jeux récents : installés et déjà joués, du plus récent au plus ancien, 5 au plus', () => {
  const list = [g('steam:1', 10), g('steam:2', 50), g('steam:3'), g('steam:4', 30, true), g('epic:A', 40), g('steam:5', 20), g('steam:6', 5), g('steam:7', 60)]
  assert.deepEqual(
    recentGames(list).map((x) => x.id),
    ['steam:7', 'steam:2', 'epic:A', 'steam:5', 'steam:1']
  )
  assert.deepEqual(recentGames([]), [])
})

test('libellés de menu : « & » reste un « & »', () => {
  assert.equal(menuLabel('Tom & Jerry'), 'Tom && Jerry')
  assert.equal(menuLabel('ELDEN RING'), 'ELDEN RING')
})
