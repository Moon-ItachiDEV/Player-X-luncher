// Tests des règles du journal des erreurs (npm test) : ce qui reste quand il est plein, et les erreurs qui se répètent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { createRepeatFilter, errorKey, keepRecent } from './crashLogRules.ts'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)
const text = (b: Uint8Array): string => new TextDecoder().decode(b)

test('journal plein : les lignes entières les plus récentes restent, la plus ancienne part', () => {
  const log = bytes('ligne 1\nligne 2\nligne 3\nligne 4\n')
  assert.equal(text(keepRecent(log, 20)), 'ligne 3\nligne 4\n')
  assert.equal(text(keepRecent(log, 16)), 'ligne 3\nligne 4\n')
  assert.equal(text(keepRecent(log, 15)), 'ligne 4\n')
  // Assez de place : rien ne change.
  assert.equal(keepRecent(log, 1000), log)
})

test('journal plein : jamais de coupe au milieu d’un caractère accentué', () => {
  const log = bytes('début\néèàç première\nété dernière\n')
  for (let keep = 1; keep < log.length; keep++) {
    const kept = text(keepRecent(log, keep))
    assert.ok(!kept.includes('�'), `caractère coupé avec ${keep} octets gardés`)
    assert.ok(kept === '' || kept.endsWith('\n'))
    assert.ok(log.length - keepRecent(log, keep).length >= log.length - keep)
  }
})

test('journal plein : une seule ligne plus longue que la place gardée ne laisse rien (la nouvelle ligne s’écrit seule)', () => {
  assert.equal(keepRecent(bytes('une très longue ligne sans fin\n'), 10).length, 0)
  assert.equal(keepRecent(bytes('pas de retour à la ligne du tout'), 10).length, 0)
})

test('une erreur qui se répète : écrite la première fois, puis une fois par période, avec le compte', () => {
  const seen = createRepeatFilter(600_000)
  assert.deepEqual(seen('a', 0), { write: true, skipped: 0 })
  assert.deepEqual(seen('a', 60_000), { write: false, skipped: 1 })
  assert.deepEqual(seen('a', 120_000), { write: false, skipped: 2 })
  // Une autre erreur n'est pas retenue par la première.
  assert.deepEqual(seen('b', 130_000), { write: true, skipped: 0 })
  // La période est passée : elle est réécrite, avec ce qui a été passé sous silence.
  assert.deepEqual(seen('a', 600_000), { write: true, skipped: 2 })
  assert.deepEqual(seen('a', 600_001), { write: false, skipped: 1 })
})

test('une erreur qui se répète : l’horloge qui recule ne bloque pas le journal', () => {
  const seen = createRepeatFilter(600_000)
  assert.equal(seen('a', 1_000_000).write, true)
  assert.equal(seen('a', 500).write, true)
})

test('une erreur qui se répète : la mémoire reste bornée, la plus ancienne sort', () => {
  const seen = createRepeatFilter(600_000, 3)
  for (const k of ['a', 'b', 'c', 'd']) assert.equal(seen(k, 0).write, true)
  // « a » est sortie de la mémoire : elle est écrite à nouveau ; « d », la plus récente, est encore retenue.
  assert.equal(seen('d', 1).write, false)
  assert.equal(seen('a', 1).write, true)
})

test('la même erreur se reconnaît à son endroit et à sa première ligne', () => {
  assert.equal(errorKey('cs2', 'TypeError: x\n    at a (file.js:1:1)'), errorKey('cs2', 'TypeError: x\n    at b (other.js:9:9)'))
  assert.notEqual(errorKey('cs2', 'TypeError: x'), errorKey('temps de jeu', 'TypeError: x'))
  assert.notEqual(errorKey('cs2', 'TypeError: x'), errorKey('cs2', 'TypeError: y'))
})
