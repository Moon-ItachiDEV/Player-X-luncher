// Tests du tri des échecs d'un récepteur (npm test) : ce qui va dans le journal, ce qui reste un refus pour la personne.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-ignore TS5097
import { UserError } from './errors.ts'
// @ts-ignore TS5097
import { unexpectedFailure } from './ipcRules.ts'

test('un refus écrit pour la personne ne va pas dans le journal', () => {
  assert.equal(unexpectedFailure(new UserError('Le moteur vidéo manque.')), false)
  assert.equal(unexpectedFailure(new Error('Jeu introuvable.')), false)
  class Stopped extends Error {}
  assert.equal(unexpectedFailure(new Stopped('Film arrêté.')), false)
})

test('une erreur du langage est une panne : elle va dans le journal', () => {
  const bug = (fn: () => unknown): unknown => {
    try {
      fn()
    } catch (e) {
      return e
    }
    return null
  }
  assert.equal(unexpectedFailure(bug(() => (undefined as unknown as { x: { y: number } }).x.y)), true)
  assert.equal(unexpectedFailure(bug(() => (null as unknown as () => void)())), true)
  assert.equal(unexpectedFailure(bug(() => new Array(-1))), true)
  assert.equal(unexpectedFailure(bug(() => JSON.parse('{'))), true)
})

test('une erreur du système (elle porte un code) est une panne', () => {
  const e = bugOf(() => readFileSync('/dossier/qui/n-existe/pas'))
  assert.equal((e as { code?: string }).code, 'ENOENT')
  assert.equal(unexpectedFailure(e), true)
})

test('une valeur qui n’est pas une erreur (throw "texte") est une panne', () => {
  assert.equal(unexpectedFailure('oups'), true)
  assert.equal(unexpectedFailure(undefined), true)
  assert.equal(unexpectedFailure({ message: 'faux' }), true)
})

test('une erreur technique externe sans code (DOMException, réseau, SQLite, HTTP 5xx) est une panne, mais un UserError reste un refus', () => {
  assert.equal(unexpectedFailure(new DOMException('The operation was aborted.', 'AbortError')), true)
  assert.equal(unexpectedFailure(new AggregateError([new Error('x')], 'All promises were rejected')), true)
  assert.equal(unexpectedFailure(new Error('fetch failed')), true)
  assert.equal(unexpectedFailure(new Error('net::ERR_CONNECTION_REFUSED')), true)
  assert.equal(unexpectedFailure(new Error('SQLITE_CORRUPT: database disk image is malformed')), true)
  assert.equal(unexpectedFailure(new Error('Request failed with status code 502')), true)
  assert.equal(unexpectedFailure(new Error('Steam API HTTP 503')), true)
  assert.equal(unexpectedFailure(new UserError('Steam répond HTTP 503 pour l’instant.')), false)
})

function bugOf(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return null
}
