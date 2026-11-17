// Tests des règles de la garde (npm run test:garde).
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { boxOf, crashAction, CRASH_WINDOW_MS, tellUnexpected, type BoxId } from './guardRules.ts'

test('crashAction : recharge, sauf si la page a déjà été rechargée il y a moins de 60 s', () => {
  const now = 1_000_000
  assert.equal(crashAction(now, null), 'reload')
  assert.equal(crashAction(now, now - 59_000), 'ask')
  assert.equal(crashAction(now, now - 61_000), 'reload')
  assert.equal(crashAction(now, now - CRASH_WINDOW_MS), 'reload')
})

test('tellUnexpected : prêt, pas déjà dit, et la personne regarde Player X', () => {
  assert.equal(tellUnexpected({ told: false, ready: true, focused: true }), true)
  assert.equal(tellUnexpected({ told: true, ready: true, focused: true }), false)
  assert.equal(tellUnexpected({ told: false, ready: false, focused: true }), false)
  assert.equal(tellUnexpected({ told: false, ready: true, focused: false }), false)
})

const IDS: BoxId[] = ['erreur', 'page', 'demarrage', 'base-secours', 'base-zero', 'base-partiel']
const DIR = 'C:\\Users\\Moi\\AppData\\Roaming\\Player X'

test('textes : jamais « V3 » ni « Test », le dossier est là quand il le faut', () => {
  for (const id of IDS) {
    const b = boxOf(id, { dataDir: DIR, reason: 'raison', kept: 1 })
    assert.equal(b.id, id)
    assert.ok(!/V3|Test/.test(`${b.message} ${b.detail} ${b.buttons.join(' ')}`), id)
    assert.ok(b.detail.includes(DIR), id)
  }
})

test('textes : les boutons', () => {
  const buttons = (id: BoxId) => boxOf(id, { dataDir: DIR }).buttons
  assert.deepEqual(buttons('erreur'), ['OK'])
  assert.deepEqual(buttons('page'), ['Recharger', 'Quitter Player X'])
  assert.deepEqual(buttons('demarrage'), ['Fermer', 'Ouvrir la page des versions'])
  assert.deepEqual(buttons('base-secours'), ['OK', 'Ouvrir le dossier'])
  assert.deepEqual(buttons('base-zero'), ['OK', 'Ouvrir le dossier'])
  assert.deepEqual(buttons('base-partiel'), ['OK', 'Ouvrir le dossier'])
})

test('textes : types et raison du démarrage', () => {
  assert.equal(boxOf('erreur', { dataDir: DIR }).type, 'error')
  assert.equal(boxOf('base-zero', { dataDir: DIR }).type, 'warning')
  assert.ok(boxOf('demarrage', { dataDir: DIR, reason: 'disque plein' }).detail.startsWith('disque plein\n\n'))
})

test('textes : raison vide, le détail ne commence pas par des lignes vides', () => {
  for (const reason of ['', undefined]) {
    const d = boxOf('demarrage', { dataDir: DIR, reason }).detail
    assert.ok(d.startsWith('Le détail est dans'), d)
    assert.ok(!d.includes('\n\n\n'))
    assert.ok(d.includes(DIR))
  }
})

test('textes : la phrase « gardé » suit le nombre de fichiers (rien, un, plusieurs)', () => {
  for (const id of ['base-secours', 'base-zero', 'base-partiel'] as BoxId[]) {
    assert.ok(!/gardé/.test(boxOf(id, { dataDir: DIR }).detail), id)
    assert.ok(!/gardé/.test(boxOf(id, { dataDir: DIR, kept: 0 }).detail), id)
    assert.ok(boxOf(id, { dataDir: DIR, kept: 1 }).detail.endsWith(`\n\nL’ancien fichier est gardé dans ${DIR}.`), id)
    assert.ok(boxOf(id, { dataDir: DIR, kept: 2 }).detail.endsWith(`\n\nLes anciens fichiers sont gardés dans ${DIR}.`), id)
  }
})

test('textes : base-partiel', () => {
  const b = boxOf('base-partiel', { dataDir: DIR })
  assert.equal(b.message, 'Player X n’a pas pu lire toute sa base.')
  assert.ok(b.detail.startsWith('Il a repris ce qui était encore lisible. Des jeux, des réglages ou des temps de jeu peuvent manquer.'))
})
