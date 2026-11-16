// Tests de la lecture des jeux GOG (npm run test:launch).
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { readGogInfo, readGogRegistry, splitArgs } from './gogInfo.ts'

const DIR = 'D:\\GOG Games\\Cyberpunk 2077'

test('fichier .info : la façon principale de lancer, chemin et dossier de travail complets', () => {
  const info = readGogInfo(JSON.stringify({ gameId: '1423049311', rootGameId: '1423049311', name: 'Cyberpunk 2077', playTasks: [
    { category: 'launcher', type: 'FileTask', path: 'REDprelauncher.exe' },
    { isPrimary: true, type: 'FileTask', path: 'bin/x64/Cyberpunk2077.exe', workingDir: 'bin/x64', arguments: '-skipStartScreen "--a b"' },
    { type: 'URLTask', link: 'https://example.invalid' }
  ] }), DIR)
  assert.deepEqual(info, { id: '1423049311', name: 'Cyberpunk 2077', task: { exe: `${DIR}\\bin\\x64\\Cyberpunk2077.exe`, cwd: `${DIR}\\bin\\x64`, args: ['-skipStartScreen', '--a b'] } })
})

test('fichier .info : sans façon principale, la première ; dossier de travail = celui de l’exécutable', () => {
  const info = readGogInfo('\uFEFF' + JSON.stringify({ gameId: 1207658924, name: 'Unreal Tournament', playTasks: [{ type: 'FileTask', path: 'System\\UnrealTournament.exe' }] }), DIR + '\\')
  assert.equal(info?.task.exe, `${DIR}\\System\\UnrealTournament.exe`)
  assert.equal(info?.task.cwd, `${DIR}\\System`)
})

test('fichier .info refusé : extension, illisible, sans exécutable', () => {
  assert.equal(readGogInfo(JSON.stringify({ gameId: '2', rootGameId: '1', name: 'DLC', playTasks: [{ isPrimary: true, type: 'FileTask', path: 'a.exe' }] }), DIR), null)
  assert.equal(readGogInfo('pas du json', DIR), null)
  assert.equal(readGogInfo(JSON.stringify({ gameId: '3', name: 'Doc', playTasks: [{ type: 'FileTask', path: 'manual.pdf' }] }), DIR), null)
})

test('registre : identifiant, nom et dossier de chaque jeu', () => {
  const out = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1423049311',
    '    gameName    REG_SZ    Cyberpunk 2077',
    '    path    REG_SZ    D:\\GOG Games\\Cyberpunk 2077\\',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924\\Extra',
    '    path    REG_SZ    C:\\ailleurs',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924',
    '    path    REG_SZ    C:\\GOG Games\\UT'
  ].join('\r\n')
  assert.deepEqual(readGogRegistry(out), [{ id: '1423049311', name: 'Cyberpunk 2077', dir: 'D:\\GOG Games\\Cyberpunk 2077' }, { id: '1207658924', name: '', dir: 'C:\\GOG Games\\UT' }])
  assert.deepEqual(splitArgs(''), [])
})
