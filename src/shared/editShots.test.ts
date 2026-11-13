// Tests de la géométrie d'un film (npm run test:edit) : pas, ralentis, coupes sur les temps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { anchorOffset, fitShot, moveItem, shotLength, shotParts, slowHalf, snapToGrid, timeline, unitOf, PLAIN_UNIT, type ShotSpec } from './editShots.ts'

const spec = (o: Partial<ShotSpec> = {}): ShotSpec => ({ clipId: 'a', anchorS: 20, lead: 6, tail: 3, slow: false, ...o })
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)

test('le pas : un temps de la musique, sinon 0,5 s', () => {
  near(unitOf(120), 0.5)
  near(unitOf(128), 0.46875)
  assert.equal(unitOf(null), PLAIN_UNIT)
  assert.equal(unitOf(Number.NaN), PLAIN_UNIT)
  assert.equal(unitOf(900), PLAIN_UNIT)
})

test('sans ralenti : un seul morceau, kill à `lead` pas du début', () => {
  const u = unitOf(128)
  const s = spec()
  assert.deepEqual(shotParts(s, u), [{ fromS: 17.1875, toS: 21.4063, speed: 1 }])
  near(shotLength(s, u), 9 * u)
  near(anchorOffset(s, u), 6 * u)
})

test('avec ralenti : trois morceaux, le ralenti dure 2 pas, le kill tombe sur un temps', () => {
  const u = unitOf(128)
  const s = spec({ slow: true })
  const p = shotParts(s, u)
  assert.equal(p.length, 3)
  assert.equal(p[1].speed, 0.5)
  near(p[1].toS - p[1].fromS, u)
  near(p[1].fromS, 20 - slowHalf(u))
  near(shotLength(s, u), 11 * u)
  // Le kill : 6 pas + la moitié du ralenti (1 pas dans le film) = 7 pas, un temps entier.
  near(anchorOffset(s, u) / u, 7)
  // Chaque morceau commence là où le précédent finit.
  near(p[0].toS, p[1].fromS); near(p[1].toS, p[2].fromS)
})

test('toutes les coupes et tous les kills tombent sur un temps', () => {
  const u = unitOf(140)
  const shots = [spec(), spec({ slow: true, lead: 4, tail: 2 }), spec({ lead: 3, tail: 5 }), spec({ slow: true, lead: 0, tail: 0 })]
  const { starts, anchors, totalS } = timeline(shots, u)
  for (const t of [...starts, ...anchors, totalS]) near((t / u) % 1 < 0.5 ? (t / u) % 1 : 1 - ((t / u) % 1), 0, 1e-3)
})

test('un plan qui déborde du clip perd des pas, jamais un morceau de pas', () => {
  const u = 0.5
  // Le kill à 1,2 s : 6 pas avant ne tiennent pas, il en reste 2.
  assert.deepEqual(fitShot(spec({ anchorS: 1.2 }), 25, u), { clipId: 'a', anchorS: 1.2, lead: 2, tail: 3, slow: false })
  // Le kill à 0,9 s de la fin : 1 pas après.
  assert.equal(fitShot(spec({ anchorS: 24.1 }), 25, u).tail, 1)
  // Ralenti impossible au tout début du clip : retiré.
  assert.equal(fitShot(spec({ anchorS: 0.1, slow: true }), 25, u).slow, false)
  // Valeurs abîmées : ramenées dans les bornes.
  const f = fitShot(spec({ lead: -4, tail: 999 }), 60, u)
  assert.equal(f.lead, 0); assert.equal(f.tail, 32)
  // Un plan vide garde un pas.
  assert.equal(fitShot(spec({ lead: 0, tail: 0 }), 25, u).lead, 1)
})

test('grille et ordre', () => {
  assert.equal(snapToGrid([0.2, 0.7, 1.2], 0.5), 0.7)
  assert.equal(snapToGrid([0.2, 0.7, 1.2], 0), 0.2)
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a'])
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
  assert.deepEqual(moveItem(['a', 'b'], 5, 0), ['a', 'b'])
})
