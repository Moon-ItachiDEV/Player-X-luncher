// Tests du protocole du suivi rapide (npm run test:launch) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { isValid, MAX_NAMES, newMatches, p95, parseSample, SCRIPT, tickLine, type Sample } from './launchWatchParse.ts'

const filler = (n: number): string => Array.from({ length: n }, (_, i) => `\t${100 + i}:svc${i}`).join('')
const sample = (procs: [number, string][], extra = ''): Sample => {
  const s = parseSample(`S${filler(21)}${procs.map(([pid, name]) => `\t${pid}:${name}`).join('')}${extra}\tC:10:52000000`)
  assert.ok(s)
  return s
}

test('SCRIPT : ne lit que le nom, l’id et la fenêtre des programmes', () => {
  // Assemblés ici : ces mots ne doivent apparaître nulle part dans src/main (contrôle par grep).
  for (const bad of ['.Path', '.Main' + 'Module', '.StartTime', 'Add' + '-Type', 'Encoded' + 'Command', 'ReadLine' + 'Async'])
    assert.equal(SCRIPT.includes(bad), false, bad)
  assert.ok(SCRIPT.includes('[Console]::In.ReadLine()'))
  assert.ok(SCRIPT.includes("PriorityClass='BelowNormal'"))
  for (const prop of ['$p.Id', '$p.ProcessName', '$p.MainWindowHandle']) assert.ok(SCRIPT.includes(prop), prop)
  // Fenêtre lue seulement pour les noms demandés (le -and court-circuite).
  assert.match(SCRIPT, /\$q\.w -contains \$p\.ProcessName -and \$p\.MainWindowHandle -ne 0/)
})

test('SCRIPT : compatible PowerShell 5.1 et sans guillemets doubles', () => {
  assert.equal(SCRIPT.includes('??'), false)
  assert.equal(/&&|\|\|/.test(SCRIPT), false)
  assert.equal(/\s\?\s/.test(SCRIPT), false)
  assert.equal(SCRIPT.includes('"'), false)
})

test('tickLine : requête vide → {}', () => {
  assert.equal(tickLine({}), '{}')
  assert.equal(tickLine({ w: [new Set()], s: [] }), '{}')
})

test('tickLine : minuscules, caractères de contrôle retirés, doublons fusionnés', () => {
  assert.deepEqual(JSON.parse(tickLine({ w: [['CS2', 'cs2', 'Bad\nName\u0007'], ['Élan']] })), { w: ['cs2', 'badname', 'élan'] })
})

test('tickLine : JSON en ASCII seul (page de code de la console)', () => {
  const line = tickLine({ w: [['Élan', 'ゲーム']] })
  assert.equal(/[^\x20-\x7e]/.test(line), false)
  assert.deepEqual(JSON.parse(line).w, ['élan', 'ゲーム'])
})

test('tickLine : au plus 64 noms par jeu', () => {
  const many = Array.from({ length: 100 }, (_, i) => `exe${i}`)
  const q = JSON.parse(tickLine({ w: [many, ['other']] }))
  assert.equal(q.w.length, MAX_NAMES + 1)
  assert.equal(q.w.at(-1), 'other')
})

test('tickLine : appids invalides écartés', () => {
  assert.deepEqual(JSON.parse(tickLine({ s: ['730', '730', 'abc', '', '12345678901', '1;rm', '1245620'] })), { s: ['730', '1245620'] })
})

test('parseSample : programmes, fenêtres, Steam et coût', () => {
  const s = parseSample('﻿S\t4:System\t8812:cs2\t9001:Élan Jeu\tW:8812\tR:730\tU:730:1\tU:570:0\tC:1234:56789012\r')
  assert.ok(s)
  assert.deepEqual(s.procs, [
    { pid: 4, name: 'System' },
    { pid: 8812, name: 'cs2' },
    { pid: 9001, name: 'Élan Jeu' }
  ])
  assert.deepEqual([...s.windows], [8812])
  assert.equal(s.runningAppId, '730')
  assert.deepEqual([...s.updating], [
    ['730', true],
    ['570', false]
  ])
  assert.equal(s.cpuMs, 1234)
  assert.equal(s.ws, 56789012)
})

test('parseSample : Steam sans jeu en cours (0 ou vide)', () => {
  assert.equal(parseSample('S\t4:System\tR:0')!.runningAppId, null)
  assert.equal(parseSample('S\t4:System\tR:')!.runningAppId, null)
})

test('parseSample : relevé vide, morceaux inconnus ignorés', () => {
  const s = parseSample('S')
  assert.ok(s)
  assert.equal(s.procs.length, 0)
  assert.equal(s.cpuMs, null)
  assert.equal(s.runningAppId, null)
  assert.equal(parseSample('S\tzz\tW:abc\t12:ok')!.procs.length, 1)
})

test('parseSample : ce qui n’est pas une réponse → null', () => {
  for (const bad of ['', 'Erreur : accès refusé', 'X\t1:a', ' S\t1:a', 'S1:a']) assert.equal(parseSample(bad), null, bad)
})

test('isValid : plus de 20 programmes', () => {
  assert.equal(isValid(parseSample(`S${filler(20)}`)!), false)
  assert.equal(isValid(parseSample(`S${filler(21)}`)!), true)
})

test('newMatches : seuls les PID absents du relevé d’avant le clic comptent', () => {
  const baseline = new Set([100, 101, 8812])
  // Le jeu tournait déjà avec ce PID : pas une nouvelle détection.
  assert.deepEqual(newMatches(sample([[8812, 'cs2']]), new Set(['cs2']), baseline), [])
  // Relance rapide après une fermeture précoce : nouveau PID, même nom → détecté.
  assert.deepEqual(newMatches(sample([[9020, 'CS2']]), new Set(['cs2']), baseline), [9020])
  // Autre nom : rien.
  assert.deepEqual(newMatches(sample([[9021, 'notepad']]), new Set(['cs2']), baseline), [])
  // Aucun relevé récent : toute correspondance est candidate (le relevé de confirmation tranche).
  assert.deepEqual(newMatches(sample([[8812, 'cs2']]), new Set(['cs2']), null), [8812])
})

test('p95 : rang le plus proche', () => {
  assert.equal(p95([]), 0)
  assert.equal(p95([7]), 7)
  assert.equal(p95(Array.from({ length: 20 }, (_, i) => i + 1)), 19)
  assert.equal(p95(Array.from({ length: 30 }, (_, i) => 30 - i)), 29)
  assert.equal(p95([5, 5, 5, 500]), 500)
})
