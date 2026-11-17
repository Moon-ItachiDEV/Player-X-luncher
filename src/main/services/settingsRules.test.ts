// Tests des règles des réglages (npm run test:security) : ce que la page peut changer, ce qu'elle voit des secrets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { cleanPatch, defaults, publicSettings } from './settingsRules.ts'

test('seuls les réglages connus, du bon type, passent', () => {
  const c = cleanPatch({ gameNews: false, launchWindow: 'minimize', friendAlerts: 'nope', bogus: 1, closeToTray: 'oui', cs2Overlay: 'b' })
  // 'b' (Verre) n'existe plus depuis la 0.6.1 : il devient le style Player X
  assert.deepEqual(c, { gameNews: false, launchWindow: 'minimize', cs2Overlay: 'c' })
})

test('overlay CS2 : les trois styles de la 0.6.2 et la taille passent, le reste non', () => {
  for (const s of ['etendard', 'viseur', 'regie', 'c', 'off']) assert.equal(cleanPatch({ cs2Overlay: s }).cs2Overlay, s)
  assert.equal(cleanPatch({ cs2Overlay: 'apple' }).cs2Overlay, undefined)
  for (const z of ['s', 'n', 'l']) assert.equal(cleanPatch({ overlaySize: z }).overlaySize, z)
  assert.equal(cleanPatch({ overlaySize: 'xl' }).overlaySize, undefined)
  assert.equal(defaults().overlaySize, 'n')
})

test('overlay CS2 : la place des blocs, par style et par moment, bornée à un écran', () => {
  const pos = cleanPatch({ overlayPos: { 'regie.half': [0.2, -0.1], 'etendard.end': [3, -2], 'c.buy': [0.1, 0.1], 'viseur.pill': [0.1], 'viseur.buy': ['a', 1], 'viseur.end': [0.12345, 0] } }).overlayPos
  assert.deepEqual(pos, { 'regie.half': [0.2, -0.1], 'etendard.end': [1, -1], 'viseur.end': [0.123, 0] })
  assert.equal(cleanPatch({ overlayPos: [1, 2] }).overlayPos, undefined)
  assert.deepEqual(defaults().overlayPos, {})
  // Échelle choisie en plein écran : bornée de 0,5 à 1,6, oubliée quand elle vaut 1.
  const sc = cleanPatch({ overlayPos: { 'regie.buy': [0, 0, 1.234], 'regie.end': [0, 0, 9], 'viseur.half': [0.1, 0, 1], 'viseur.buy': [0, 0, 'x'], 'etendard.pill': [0, 0, 1, 2] } }).overlayPos
  assert.deepEqual(sc, { 'regie.buy': [0, 0, 1.23], 'regie.end': [0, 0, 1.6], 'viseur.half': [0.1, 0] })
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
