// Tests des paliers et des durées du lancement (npm run test:launch) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LaunchStatus } from '../launch'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import * as P from './launchPhase.ts'

const T0 = 1_760_000_000_000
const status = (o: Partial<LaunchStatus>): LaunchStatus => ({
  launchId: 'l1',
  gameId: 'g1',
  route: 'steam',
  phase: 'sending',
  detect: 'fast',
  via: 'play',
  rev: 1,
  clickAt: T0,
  ...o
})

test('paliers exactement à 5 s, 15 s et 90 s', () => {
  const sending = status({})
  assert.equal(P.bucket(sending, T0 + 4_999), 'sending')
  assert.equal(P.bucket(sending, T0 + 5_000), 'stalled')
  // L'attente compte depuis la transmission, pas depuis le clic.
  const waiting = status({ phase: 'waiting', handedAt: T0 + 2_000 })
  assert.equal(P.bucket(waiting, T0 + 2_000 + 14_999), 'relais')
  assert.equal(P.bucket(waiting, T0 + 2_000 + 15_000), 'waiting')
  assert.equal(P.bucket(waiting, T0 + 2_000 + 89_999), 'waiting')
  assert.equal(P.bucket(waiting, T0 + 2_000 + 90_000), 'slow')
  assert.equal(P.bucket(status({ phase: 'running' }), T0), 'running')
})

test('réveil au prochain palier', () => {
  assert.equal(P.nextBucketAt(status({}), T0), T0 + 5_000)
  assert.equal(P.nextBucketAt(status({}), T0 + 5_000), Infinity)
  const waiting = status({ phase: 'waiting', handedAt: T0 })
  assert.equal(P.nextBucketAt(waiting, T0 + 1), T0 + 15_000)
  assert.equal(P.nextBucketAt(waiting, T0 + 15_000), T0 + 90_000)
  assert.equal(P.nextBucketAt(waiting, T0 + 90_000), Infinity)
  assert.equal(P.nextBucketAt(status({ phase: 'failed' }), T0), Infinity)
})

test('compteur « m:ss » et « Détecté après »', () => {
  assert.equal(P.COUNTER_FROM_MS, 3_000)
  assert.equal(P.fmtElapsed(0), '0:00')
  assert.equal(P.fmtElapsed(7_900), '0:07')
  assert.equal(P.fmtElapsed(161_000), '2:41')
  assert.equal(P.fmtElapsed(725_000), '12:05')
  // Espaces insécables : « 24 s » ne se coupe jamais en fin de ligne.
  const nb = (s: string): string => s.replace(/ /g, '\u00a0')
  assert.equal(P.fmtDetected(24_400), nb('24 s'))
  assert.equal(P.fmtDetected(300), nb('1 s'))
  assert.equal(P.fmtDetected(72_000), nb('1 min 12'))
  assert.equal(P.fmtDetected(180_000), nb('3 min'))
})

test('boutons : « Lancement… » au moins 600 ms, puis attente, en jeu, démo', () => {
  const rec = (phase: LaunchStatus['phase'], o: { demo?: boolean; checking?: boolean } = {}): P.PlayRecord => ({
    checking: !!o.checking,
    clickedAt: T0,
    status: { phase, ...(o.demo ? { demo: true as const } : {}) }
  })
  assert.equal(P.LABEL_MIN_MS, 600)
  assert.equal(P.playStateOf(false, null, T0), 'idle')
  assert.equal(P.playStateOf(false, rec('sending'), T0 + 10_000), 'sending')
  assert.equal(P.playStateOf(false, rec('waiting'), T0 + 599), 'sending')
  assert.equal(P.playStateOf(false, rec('waiting'), T0 + 600), 'pending')
  assert.equal(P.playStateOf(false, rec('relay'), T0 + 5_000), 'pending')
  assert.equal(P.playStateOf(false, rec('running'), T0 + 5_000), 'running')
  assert.equal(P.playStateOf(true, null, T0), 'running')
  assert.equal(P.playStateOf(true, rec('failed'), T0 + 5_000), 'running')
  assert.equal(P.playStateOf(true, rec('sending', { checking: true }), T0), 'checking')
  // « Relancer quand même » sur un jeu qui tourne : les boutons disent l'envoi, pas « En jeu ».
  assert.equal(P.playStateOf(true, rec('sending'), T0 + 100), 'sending')
  assert.equal(P.playStateOf(false, rec('running', { demo: true }), T0 + 7_000), 'demo-running')
  assert.equal(P.playStateOf(false, rec('ended', { demo: true }), T0 + 31_000), 'idle')
  assert.equal(P.playStateOf(false, rec('failed'), T0 + 5_000), 'idle')
})

test('temps d’affichage compté seulement fenêtre active', () => {
  assert.equal(P.CARD_ACTIVE_MS.running, 4_000)
  assert.equal(P.CARD_ACTIVE_MS.failed, 10_000)
  assert.equal(P.CARD_ACTIVE_MS['early-exit'], 10_000)
  assert.equal(P.CARD_ACTIVE_MS.already, 8_000)
  assert.equal(P.CARD_ACTIVE_MS['gave-up'], 8_000)
  assert.equal(P.CARD_ACTIVE_MS.untracked, 6_000)
  assert.equal(P.CARD_ACTIVE_MS.resent, 6_000)
  assert.equal(P.CARD_ACTIVE_MS.waiting, undefined)
  const c = new P.ActiveClock(4_000)
  assert.equal(c.remaining(T0), 4_000)
  c.resume(T0)
  assert.equal(c.remaining(T0 + 1_000), 3_000)
  c.pause(T0 + 1_000)
  // Fenêtre en arrière-plan une heure : rien n'est compté.
  assert.equal(c.remaining(T0 + 3_600_000), 3_000)
  c.resume(T0 + 3_600_000)
  c.resume(T0 + 3_601_000) // deux reprises de suite : la première compte
  assert.equal(c.remaining(T0 + 3_602_000), 1_000)
  c.pause(T0 + 3_602_000)
  c.pause(T0 + 3_700_000)
  assert.equal(c.remaining(T0 + 3_800_000), 1_000)
  c.resume(T0 + 3_800_000)
  assert.equal(c.remaining(T0 + 3_900_000), 0)
})

test('plafond de 10 min et mise à feu une fois par 10 min', () => {
  assert.equal(P.CARD_CAP_MS, 600_000)
  assert.equal(P.STAGE_REPEAT_MS, 600_000)
  assert.ok(P.isPending('sending') && P.isPending('waiting') && P.isPending('relay'))
  assert.ok(!P.isPending('running') && !P.isPending('failed'))
  assert.equal(P.hasCard(status({ phase: 'ended' })), false)
  assert.equal(P.hasCard(status({ phase: 'gave-up', silent: true })), false)
  assert.equal(P.hasCard(status({ phase: 'failed' })), true)
})

test('date gelée : seulement tant que le jeu n’a pas été vu (un relais ne la regèle pas)', () => {
  const rec = (o: Partial<LaunchStatus>, checking = false): { checking: boolean; status: LaunchStatus } => ({ checking, status: status(o) })
  assert.equal(P.freezesDate(rec({ phase: 'sending' })), true)
  assert.equal(P.freezesDate(rec({ phase: 'waiting', handedAt: T0 })), true)
  assert.equal(P.freezesDate(rec({ phase: 'running', detectedAt: T0 + 5_000 }, true)), false)
  assert.equal(P.freezesDate(rec({ phase: 'sending' }, true)), true) // vérification d'un jeu qui semblait tourner
  assert.equal(P.freezesDate(rec({ phase: 'running', detectedAt: T0 + 5_000 })), false)
  // Steam → EA app : le premier programme se ferme, le relais garde detectedAt.
  assert.equal(P.freezesDate(rec({ phase: 'relay', detectedAt: T0 + 5_000, goneAt: T0 + 9_000 })), false)
  assert.equal(P.freezesDate(rec({ phase: 'failed' })), false)
})

test('nouveau lancement : les cartes terminées du même jeu se ferment, pas les autres', () => {
  const rec = (gameId: string, phase: LaunchStatus['phase'], o: { cardDone?: boolean; checking?: boolean } = {}) => ({
    gameId,
    checking: !!o.checking,
    cardDone: !!o.cardDone,
    status: status({ gameId, phase })
  })
  const all = {
    a: rec('g1', 'failed'),
    b: rec('g1', 'early-exit', { cardDone: true }),
    c: rec('g1', 'waiting'),
    d: rec('g2', 'failed'),
    e: rec('g1', 'already'),
    f: rec('g1', 'sending', { checking: true })
  }
  const out = P.closeFinishedCards(all, 'g1')
  assert.equal(out.a.cardDone, true)
  assert.equal(out.e.cardDone, true)
  assert.equal(out.b, all.b) // déjà fermée : même objet
  assert.equal(out.c, all.c) // encore en attente : elle garde sa carte
  assert.equal(out.d, all.d) // autre jeu
  assert.equal(out.f, all.f)
  assert.equal(all.a.cardDone, false) // rien n'est modifié en place
  const quiet = { d: rec('g2', 'failed') }
  assert.equal(P.closeFinishedCards(quiet, 'g1'), quiet)
})
