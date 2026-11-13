// Tests du bilan de session Battlefield 6 (npm run test:bf6) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Bf6Row, Bf6Stats } from '@shared/types'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { recapLine, sessionNumbers } from './bf6Diff.ts'

function stats(over: Partial<Bf6Stats> = {}): Bf6Stats {
  return {
    account: { name: 'Breezy', platform: 'ea', personaId: '1' },
    kills: 1000,
    deaths: 800,
    killDeath: 1.25,
    killsPerMinute: 0.6,
    wins: 60,
    losses: 50,
    winPercent: 54.5,
    accuracy: 18,
    headshots: 22,
    assists: 300,
    revives: 120,
    matches: 110,
    secondsPlayed: 100_000,
    weapons: [],
    vehicles: [],
    classes: [],
    modes: [],
    maps: [],
    ...over
  }
}

const row = (name: string, v: Partial<Bf6Row> = {}, id = name): Bf6Row => ({ id, name, ...v })

test('rien n’a bougé : pas encore de bilan', () => {
  assert.equal(sessionNumbers(stats(), stats()), null)
})

test('un compteur principal recule : autre compte ou remise à zéro, pas de bilan', () => {
  assert.equal(sessionNumbers(stats(), stats({ kills: 999, deaths: 810, matches: 111 })), null)
  assert.equal(sessionNumbers(stats(), stats({ kills: 1020, matches: 109 })), null)
})

test('une session complète : totaux, K/D, élim. par minute, moyennes d’avant', () => {
  const n = sessionNumbers(
    stats(),
    stats({ kills: 1023, deaths: 815, wins: 62, losses: 51, matches: 113, assists: 309, revives: 124, secondsPlayed: 103_240, killDeath: 1.26 })
  )
  assert.ok(n)
  assert.equal(n.kills, 23)
  assert.equal(n.deaths, 15)
  assert.equal(n.matches, 3)
  assert.equal(n.wins, 2)
  assert.equal(n.losses, 1)
  assert.equal(n.assists, 9)
  assert.equal(n.revives, 4)
  assert.equal(n.secondsPlayed, 3240)
  assert.ok(Math.abs(n.killDeath - 23 / 15) < 1e-9)
  assert.ok(Math.abs(n.killsPerMinute - 23 / 54) < 1e-9)
  // Les moyennes sont celles d'avant la session.
  assert.deepEqual(n.average, { killDeath: 1.25, killsPerMinute: 0.6, winPercent: 54.5 })
})

test('sans mort : K/D = éliminations ; sans temps de jeu relevé : 0 élim. par minute', () => {
  const n = sessionNumbers(stats(), stats({ kills: 1004 }))
  assert.ok(n)
  assert.equal(n.killDeath, 4)
  assert.equal(n.killsPerMinute, 0)
})

test('compteurs secondaires qui reculent un peu : ramenés à zéro, le bilan reste', () => {
  const n = sessionNumbers(stats(), stats({ kills: 1005, deaths: 802, assists: 299, secondsPlayed: 99_990 }))
  assert.ok(n)
  assert.equal(n.assists, 0)
  assert.equal(n.secondsPlayed, 0)
  assert.equal(n.kills, 5)
})

test('arme de la session : le plus d’éliminations, même une arme jamais utilisée avant', () => {
  const before = stats({ weapons: [row('M4A1', { kills: 500, image: 'https://img/m4.png' }), row('SV-98', { kills: 40 })] })
  const after = stats({
    kills: 1015,
    weapons: [row('M4A1', { kills: 504, image: 'https://img/m4.png' }), row('SV-98', { kills: 40 }), row('KTS100 MK8', { kills: 11, image: 'https://img/kts.png' })]
  })
  const n = sessionNumbers(before, after)
  assert.deepEqual(n?.weapon, { name: 'KTS100 MK8', image: 'https://img/kts.png', kills: 11 })
})

test('lignes rapprochées par nom (casse, espaces, id qui change) et noms en double additionnés', () => {
  const before = stats({ weapons: [row('M4A1', { kills: 500 }, '0'), row('ES 5.7', { kills: 10 }, '7'), row('ES 5.7', { kills: 5 }, '8')] })
  const after = stats({ kills: 1010, weapons: [row('m4a1 ', { kills: 503 }, '3'), row('ES 5.7', { kills: 14 }, '1'), row('ES 5.7', { kills: 8 }, '2')] })
  const n = sessionNumbers(before, after)
  assert.equal(n?.weapon?.name, 'ES 5.7')
  assert.equal(n?.weapon?.kills, 7)
})

test('classe la plus jouée : au temps passé, puis aux éliminations ; la ligne « All » est ignorée', () => {
  const before = stats({
    classes: [row('All', { kills: 1000, secondsPlayed: 90_000 }), row('Assaut', { kills: 600, secondsPlayed: 50_000 }), row('Soutien', { kills: 300, secondsPlayed: 30_000 })]
  })
  const after = stats({
    kills: 1012,
    classes: [row('All', { kills: 1012, secondsPlayed: 93_000 }), row('Assaut', { kills: 610, secondsPlayed: 51_000 }), row('Soutien', { kills: 302, secondsPlayed: 32_000 })]
  })
  assert.deepEqual(sessionNumbers(before, after)?.role, { name: 'Soutien', kills: 2, seconds: 2000 })

  const noTime = stats({ kills: 1012, classes: [row('Assaut', { kills: 603 }), row('Soutien', { kills: 309 })] })
  assert.deepEqual(sessionNumbers(stats({ classes: [row('Assaut', { kills: 600 }), row('Soutien', { kills: 300 })] }), noTime)?.role, {
    name: 'Soutien',
    kills: 9,
    seconds: 0
  })
})

test('éliminations en véhicule additionnées, jamais plus que le total', () => {
  const before = stats({ vehicles: [row('M1A2', { kills: 30 }), row('AH-64', { kills: 12 })] })
  const after = stats({ kills: 1006, vehicles: [row('M1A2', { kills: 34 }), row('AH-64', { kills: 14 })] })
  assert.equal(sessionNumbers(before, after)?.vehicleKills, 6)
  const odd = stats({ kills: 1003, vehicles: [row('M1A2', { kills: 34 }), row('AH-64', { kills: 14 })] })
  assert.equal(sessionNumbers(before, odd)?.vehicleKills, 3)
})

test('cartes et modes joués : les plus joués d’abord, sans la ligne « All », 8 au plus', () => {
  const names = ['Siège du Caire', 'Empire State', 'Pic de la Libération', 'Pont de Manhattan', 'Offensive ibérique', 'Mirak Valley']
  const before = stats({
    maps: [row('All', { matches: 110, wins: 60 }), ...names.map((n) => row(n, { matches: 10, wins: 5, image: `https://img/${n.length}.jpg` }))],
    modes: [row('Conquête', { matches: 80, wins: 40 }), row('Percée', { matches: 30, wins: 20 })]
  })
  const after = stats({
    kills: 1030,
    matches: 117,
    wins: 64,
    losses: 53,
    maps: [
      row('All', { matches: 117, wins: 64 }),
      ...names.map((n, i) => row(n, { matches: 10 + (i === 1 ? 2 : 1), wins: 5 + (i === 1 ? 2 : i % 2), image: `https://img/${n.length}.jpg` }))
    ],
    modes: [row('Conquête', { matches: 84, wins: 42 }), row('Percée', { matches: 33, wins: 22 })]
  })
  const n = sessionNumbers(before, after)
  assert.ok(n)
  assert.equal(n.maps.length, 6)
  assert.equal(n.maps[0].name, 'Empire State')
  assert.deepEqual(n.maps[0], { name: 'Empire State', image: 'https://img/12.jpg', matches: 2, wins: 2 })
  assert.ok(n.maps.every((m) => m.name !== 'All'))
  assert.deepEqual(
    n.modes.map((m) => [m.name, m.matches, m.wins]),
    [
      ['Conquête', 4, 2],
      ['Percée', 3, 2]
    ]
  )
})

test('victoires d’une carte bornées à ses parties (lecture décalée du service)', () => {
  const before = stats({ maps: [row('Empire State', { matches: 10, wins: 5 })] })
  const after = stats({ kills: 1002, matches: 111, maps: [row('Empire State', { matches: 11, wins: 7 })] })
  assert.deepEqual(sessionNumbers(before, after)?.maps, [{ name: 'Empire State', matches: 1, wins: 1 }])
})

test('texte de la notification : pluriels à la française, chiffres formatés', () => {
  assert.equal(recapLine({ kills: 23, killDeath: 23 / 15, matches: 3, wins: 2, secondsPlayed: 3240 }), '23 éliminations · K/D 1,53 · 2 victoires sur 3 parties')
  assert.equal(recapLine({ kills: 1, killDeath: 0.5, matches: 1, wins: 0, secondsPlayed: 600 }), '1 élimination · K/D 0,50 · 0 victoire sur 1 partie')
  // Aucune partie terminée comptée : le temps en partie à la place.
  assert.equal(recapLine({ kills: 0, killDeath: 0, matches: 0, wins: 0, secondsPlayed: 754 }), '0 élimination · K/D 0,00 · 13 min en partie')
  assert.equal(recapLine({ kills: 4, killDeath: 4, matches: 0, wins: 0, secondsPlayed: 20 }), '4 éliminations · K/D 4,00')
})
