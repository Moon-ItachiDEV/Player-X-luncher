// Tests de la géométrie d'un film (npm run test:edit) : pas, ralentis, coupes sur les temps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { anchorOffset, filmPieces, fitShot, frameStep, moveItem, shotLength, shotParts, slowHalf, snapToGrid, tempoApply, tempoBpm, tempoDouble, tempoHalf, tempoShiftHalf, timeline, unitOf, PLAIN_UNIT, type ShotSpec } from './editShots.ts'

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

// ---------- corriger le tempo ----------
const grid = (n: number, bpm = 120, from = 0.3) => Array.from({ length: n }, (_, i) => Math.round((from + (i * 60) / bpm) * 10000) / 10000)

test('tempo ×2 : un temps au milieu de chaque intervalle, les anciens temps restent', () => {
  const g = grid(5)
  const d = tempoDouble(g)
  assert.equal(d.length, 10)
  assert.deepEqual(d.filter((_, i) => i % 2 === 0), g)
  near(d[1], g[0] + 0.25)
  near(d[9], g[4] + 0.25)
})

test('tempo ÷2 : un temps sur deux ; ×2 puis ÷2 redonne la grille', () => {
  const g = grid(9)
  assert.deepEqual(tempoHalf(g), [g[0], g[2], g[4], g[6], g[8]])
  assert.deepEqual(tempoHalf(tempoDouble(g)), g)
})

test('décaler d’un demi-temps : chaque temps avance d’un demi-intervalle local', () => {
  const g = [1, 1.5, 2.1, 2.7]
  const s = tempoShiftHalf(g)
  near(s[0], 1.25); near(s[1], 1.8); near(s[2], 2.4); near(s[3], 3)
  assert.deepEqual(tempoShiftHalf([2]), [2])
  assert.deepEqual(tempoDouble([2]), [2])
})

test('tempo : bornes 40-250, comme unitOf', () => {
  assert.equal(tempoBpm(128, 2), null)
  assert.equal(tempoBpm(128, 0.5), 64)
  assert.equal(tempoBpm(125, 2), 250)
  assert.equal(tempoBpm(80, 0.5), 40)
  assert.equal(tempoBpm(79, 0.5), null)
  assert.equal(tempoBpm(null, 1), null)
  assert.equal(tempoApply(grid(4), 200, 2, false), null)
  const ok = tempoApply(grid(4, 90), 90, 2, false)!
  assert.equal(ok.bpm, 180)
  assert.equal(ok.grid.length, 8)
})

test('tempoApply : ×2 puis retour à 1 et décalage fait puis défait redonnent la grille d’origine', () => {
  const g0 = grid(16, 100)
  const x2 = tempoApply(g0, 100, 2, false)!
  const back = tempoApply(g0, 100, 1, false)!
  assert.deepEqual(back.grid, g0)
  assert.equal(back.bpm, 100)
  assert.notDeepEqual(x2.grid, g0)
  const sh = tempoApply(g0, 100, 1, true)!
  assert.notDeepEqual(sh.grid, g0)
  assert.deepEqual(tempoApply(g0, 100, 1, false)!.grid, g0)
  // Décalage sur ×2 : intervalles de 0,3 s, tous avancés de 0,15 s
  const both = tempoApply(g0, 100, 2, true)!
  near(both.grid[0], g0[0] + 0.15)
  assert.equal(both.bpm, 200)
})

test('filmPieces (déplacé dans editShots) : mêmes morceaux, frameStep 3 à 60 images/s', () => {
  assert.equal(frameStep(60), 3)
  const u = unitOf(128)
  const p = filmPieces([spec({ slow: true }), spec({ clipId: 'b' })], u, 60)
  assert.equal(p.length, 4)
  assert.ok(p.every((x) => x.frames % 3 === 0))
  assert.equal(p[1].speed, 0.5)
})

test('clip court sur tempo lent : garde un pas si le clip le permet, zéro seulement si le clip est plus court qu’un pas', () => {
  // 40 BPM -> pas de 1,5 s ; clip de 2 s avec kill à 1 s (ni 1,5 s avant ni 1,5 s après).
  const u = unitOf(40)
  near(u, 1.5)
  const kept = fitShot(spec({ anchorS: 1, lead: 2, tail: 2, slow: false }), 2, u)
  near(shotLength(kept, u), u)
  const parts = shotParts(kept, u)
  assert.equal(parts.length, 1)
  assert.ok(parts[0].fromS >= 0 && parts[0].toS <= 2)
  // Clip de 0,8 s : impossible d'y loger un pas de 1,5 s -> durée 0 (filtré ensuite par le planificateur).
  const impossible = fitShot(spec({ anchorS: 0.4, lead: 1, tail: 1, slow: false }), 0.8, u)
  assert.equal(shotLength(impossible, u), 0)
})

