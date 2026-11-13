// Tests des règles des réglages (npm run test:security) : ce que la page peut changer, ce qu'elle voit des secrets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { cleanPatch, defaults, publicSettings } from './settingsRules.ts'

test('seuls les réglages connus, du bon type, passent', () => {
  const c = cleanPatch({ gameNews: false, launchWindow: 'minimize', friendAlerts: 'nope', bogus: 1, closeToTray: 'oui', cs2Overlay: 'b' })
  assert.deepEqual(c, { gameNews: false, launchWindow: 'minimize', cs2Overlay: 'b' })
})

test('le mode démo reste coupé hors développement', () => {
  assert.equal(cleanPatch({ demoMode: true }).demoMode, false)
  assert.equal(cleanPatch({ demoMode: true }, true).demoMode, true)
})

test('une valeur masquée ne remplace jamais le vrai secret ; texte trop long refusé', () => {
  assert.equal(cleanPatch({ steamApiKey: '••••••••ABCD' }).steamApiKey, undefined)
  assert.equal(cleanPatch({ steamApiKey: ' ABC ' }).steamApiKey, 'ABC')
  assert.equal(cleanPatch({ psnNpsso: 'x'.repeat(300) }).psnNpsso, undefined)
})

test('amis suivis : format vérifié, doublons retirés', () => {
  assert.deepEqual(cleanPatch({ friendWatch: ['steam:1', 'steam:1', 'psn:abc', 'x:1', 3] }).friendWatch, ['steam:1', 'psn:abc'])
})

test('l’interface ne voit que la fin des secrets', () => {
  const p = publicSettings({ ...defaults({}, 'win32'), steamApiKey: '0123456789ABCDEF', psnNpsso: '' })
  assert.equal(p.steamApiKey, '••••••••CDEF')
  assert.equal(p.psnNpsso, '')
})

test('version installée : pas de clé venue des variables d’environnement', () => {
  assert.equal(defaults({}).steamApiKey, '')
  assert.equal(defaults({ STEAM_API_KEY: 'k' }).steamApiKey, 'k')
  assert.equal(defaults({}, 'linux').closeToTray, false)
})
