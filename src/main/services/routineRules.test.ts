// Tests des règles des routines (npm run test:routines) : appli venue du sélecteur, liens limités, cmd.exe protégé.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { appKey, batArgs, cleanRoutine, cleanStep, isRoutineLink, savedApps } from './routineRules.ts'

const OK = new Set([appKey('C:\\Jeux\\Discord.exe'), appKey('D:/Outils/demarrer.bat')])

test('une appli doit venir du sélecteur (ou d’une routine déjà enregistrée)', () => {
  assert.equal(cleanStep({ kind: 'app', value: 'C:\\Jeux\\Discord.exe' }, OK)?.value, 'C:\\Jeux\\Discord.exe')
  assert.equal(cleanStep({ kind: 'app', value: 'c:/jeux/discord.EXE' }, OK)?.kind, 'app')
  assert.equal(cleanStep({ kind: 'app', value: 'C:\\Windows\\System32\\cmd.exe' }, OK), null)
  assert.equal(cleanStep({ kind: 'app', value: '\\\\pirate\\partage\\x.exe' }, OK), null)
  assert.equal(cleanStep({ kind: 'app', value: 'relatif.exe' }, new Set([appKey('relatif.exe')])), null)
  assert.equal(cleanStep({ kind: 'app', value: 'C:\\a.txt' }, new Set([appKey('C:\\a.txt')])), null)
})

test('les autres étapes gardent leurs règles', () => {
  assert.equal(cleanStep({ kind: 'close', value: 'chrome.exe', force: true }, OK)?.force, true)
  assert.equal(cleanStep({ kind: 'close', value: '..\\x.exe' }, OK), null)
  assert.equal(cleanStep({ kind: 'wait', value: '200' }, OK), null)
  assert.equal(cleanStep({ kind: 'wait', value: '4.6' }, OK)?.value, '5')
  assert.equal(cleanStep({ kind: 'nope' }, OK), null)
})

test('liens : https libre, steam et discord sans arguments de lancement', () => {
  assert.ok(isRoutineLink('https://www.twitch.tv/x?y=1'))
  assert.ok(isRoutineLink('steam://rungameid/730'))
  assert.ok(isRoutineLink('steam://open/friends'))
  assert.ok(isRoutineLink('discord://-/channels/123/456'))
  assert.equal(isRoutineLink('steam://run/730//-console +exec x'), false)
  assert.equal(isRoutineLink('steam://run/730//-novid'), false)
  assert.equal(isRoutineLink('https://a.b/%2e%2e'), false)
  assert.equal(isRoutineLink('file:///C:/x.exe'), false)
  assert.equal(isRoutineLink('discord://x?y=1'), false)
})

test('une routine garde toujours une étape « lancer le jeu »', () => {
  const r = cleanRoutine({ name: 'Soir', gameId: 'steam:730', steps: [{ kind: 'app', value: 'C:\\x.exe' }] }, OK)
  assert.deepEqual(r?.steps.map((s) => s.kind), ['game'])
  assert.equal(cleanRoutine({ name: '', gameId: 'x', steps: [] }, OK), null)
})

test('les applis des routines enregistrées restent valables', () => {
  const saved = savedApps([{ id: 'r', name: 'n', gameId: 'g', trigger: 'launch', steps: [{ id: 's', kind: 'app', value: 'E:\\Old\\Tool.exe', on: true }] }])
  assert.equal(cleanStep({ kind: 'app', value: 'e:\\old\\tool.exe' }, saved)?.kind, 'app')
})

test('cmd.exe reçoit le chemin entre guillemets, % refusé', () => {
  assert.deepEqual(batArgs('C:\\a&b\\x.bat'), ['/d', '/s', '/c', '""C:\\a&b\\x.bat""'])
  assert.equal(batArgs('C:\\%PATH%\\x.bat'), null)
})
