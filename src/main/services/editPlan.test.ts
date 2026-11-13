// Tests des règles du montage (npm run test:edit) : des clips aux plans d'un film « bout à bout ».
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { filmTitle, planShots, SHOT, type PlanClip } from './editPlan.ts'

const kill = (t: number, kind = 'kill') => ({ t, kind, kills: 1, headshots: kind === 'hs' ? 1 : 0 })
// Les fiches viennent de la base : les essais y mettent aussi des valeurs abîmées, d'où le type forcé.
const clip = (id: string, at: number, durationS: number, events?: unknown[], over: Record<string, unknown> = {}): PlanClip => ({ id, at, durationS, kind: 'kill', kills: 1, ...(events ? { events } : {}), ...over }) as PlanClip

test('un kill : 3 s avant, 1,2 s après', () => {
  const { shots, durationS } = planShots([clip('a', 1, 25, [kill(20)])], { after: 5 })
  assert.deepEqual(shots, [{ clipId: 'a', inS: 17, outS: 21.2 }])
  assert.equal(durationS, 4.2)
})

test('deux kills proches : un seul plan ; deux kills éloignés : deux plans', () => {
  // 2 s d'écart : les fenêtres se touchent.
  assert.deepEqual(planShots([clip('a', 1, 30, [kill(20), kill(22)])], { after: 5 }).shots, [{ clipId: 'a', inS: 17, outS: 23.2 }])
  // 4,7 s d'écart : 0,5 s entre les deux fenêtres, on ne coupe pas pour si peu.
  assert.deepEqual(planShots([clip('a', 1, 30, [kill(20), kill(24.7)])], { after: 5 }).shots, [{ clipId: 'a', inS: 17, outS: 25.9 }])
  // 6 s d'écart : deux plans.
  assert.deepEqual(planShots([clip('a', 1, 40, [kill(20), kill(26)])], { after: 5 }).shots, [
    { clipId: 'a', inS: 17, outS: 21.2 },
    { clipId: 'a', inS: 23, outS: 27.2 }
  ])
})

test('les plans ne sortent jamais du fichier, et un plan trop court est jeté', () => {
  assert.deepEqual(planShots([clip('a', 1, 10, [kill(1), kill(9.5)])], { after: 5 }).shots, [
    { clipId: 'a', inS: 0, outS: 2.2 },
    { clipId: 'a', inS: 6.5, outS: 10 }
  ])
  // Un événement noté au tout début d'un fichier très court : 0,8 s à garder, moins que le minimum.
  assert.equal(SHOT.min, 1)
  assert.deepEqual(planShots([clip('a', 1, 0.8, [kill(0)])], { after: 5 }).shots, [])
})

test('les clips se suivent dans l’ordre du match, quel que soit l’ordre reçu', () => {
  const { shots } = planShots([clip('tard', 3000, 25, [kill(20)]), clip('tot', 1000, 25, [kill(20)]), clip('milieu', 2000, 25, [kill(20)])], { after: 5 })
  assert.deepEqual(shots.map((s: { clipId: string }) => s.clipId), ['tot', 'milieu', 'tard'])
})

test('clip gardé à la main : ce qui vient de se passer, 8 s avant l’appui', () => {
  assert.deepEqual(planShots([clip('m', 1, 25, [{ t: 20, kind: 'manual', kills: 0, headshots: 0 }], { kind: 'manual', kills: 0 })], { after: 5 }).shots, [{ clipId: 'm', inS: 12, outS: 21 }])
})

test('une mort ne fait pas un plan, sauf si le clip n’a que ça', () => {
  assert.deepEqual(planShots([clip('a', 1, 40, [kill(10), { t: 30, kind: 'death', kills: 0, headshots: 0 }])], { after: 5 }).shots, [{ clipId: 'a', inS: 7, outS: 11.2 }])
  assert.deepEqual(planShots([clip('d', 1, 25, [{ t: 20, kind: 'death', kills: 0, headshots: 0 }], { kind: 'death', kills: 0 })], { after: 5 }).shots, [{ clipId: 'd', inS: 17, outS: 21.2 }])
})

test('clip d’avant la bêta 33 (sans événements) : le dernier kill se devine à « après » secondes de la fin', () => {
  // 25 s, réglage « après » de 5 s : le kill est vers 20 s.
  assert.deepEqual(planShots([clip('vieux', 1, 25)], { after: 5 }).shots, [{ clipId: 'vieux', inS: 17, outS: 21.2 }])
  // Un triple fusionné : 2,5 s de plus par kill avant le dernier.
  assert.deepEqual(planShots([clip('triple', 1, 30, undefined, { kind: 'multi', kills: 3 })], { after: 5 }).shots, [{ clipId: 'triple', inS: 17, outS: 26.2 }])
  // À la main : 8 s avant l'appui.
  assert.deepEqual(planShots([clip('main', 1, 25, undefined, { kind: 'manual', kills: 0 })], { after: 5 }).shots, [{ clipId: 'main', inS: 12, outS: 21 }])
  // Un réglage plus long que le clip ne donne pas de bornes négatives.
  assert.deepEqual(planShots([clip('court', 1, 6)], { after: 30 }).shots, [{ clipId: 'court', inS: 0, outS: 4.2 }])
})

test('un film n’est jamais remonté dans un film ; un clip sans durée est ignoré', () => {
  assert.deepEqual(planShots([clip('f', 1, 60, undefined, { kind: 'film' }), clip('zero', 2, 0, [kill(0)]), clip('nan', 3, Number.NaN, [kill(0)])], { after: 5 }).shots, [])
  assert.equal(planShots([], { after: 5 }).durationS, 0)
})

test('plus de 48 plans : les moins forts partent, l’ordre du match reste', () => {
  const many = Array.from({ length: 60 }, (_, i) => clip(`c${String(i).padStart(2, '0')}`, i, 25, [kill(20, i % 5 === 0 ? 'ace' : 'kill')], { kind: i % 5 === 0 ? 'ace' : 'kill' }))
  const { shots, durationS } = planShots(many, { after: 5 })
  assert.equal(shots.length, 48)
  const ids = shots.map((s: { clipId: string }) => s.clipId)
  assert.deepEqual(ids, [...ids].sort())
  // Les 12 aces sont tous gardés ; ce sont les 12 dernières éliminations simples qui partent.
  for (let i = 0; i < 60; i += 5) assert.ok(ids.includes(`c${String(i).padStart(2, '0')}`))
  assert.ok(!ids.includes('c59') && ids.includes('c01'))
  assert.equal(durationS, 201.6)
})

test('le nom du film : la carte si elle est la même partout, sinon le jeu, sinon « Film »', () => {
  const cs = (map?: string) => ({ gameName: 'Counter-Strike 2', ...(map ? { map } : {}) })
  assert.equal(filmTitle([cs('de_mirage'), cs('de_mirage')]), 'Film Mirage')
  assert.equal(filmTitle([cs('de_mirage'), cs('de_inferno')]), 'Film Counter-Strike 2')
  // Un clip sans carte (gardé à la main dans le menu) : la carte n'est plus la même partout.
  assert.equal(filmTitle([cs('de_mirage'), cs()]), 'Film Counter-Strike 2')
  assert.equal(filmTitle([{ gameName: 'Battlefield 6' }]), 'Film Battlefield 6')
  assert.equal(filmTitle([cs('de_mirage'), { gameName: 'Battlefield 6' }]), 'Film')
  assert.equal(filmTitle([]), 'Film')
  // Une carte de l'atelier garde un nom lisible, et le nom tient en 80 caractères.
  assert.equal(filmTitle([cs('workshop/123/de_ma_carte')]), 'Film Ma Carte')
  assert.equal(filmTitle([{ gameName: 'x'.repeat(200) }]).length, 80)
})

test('des événements abîmés ne cassent rien', () => {
  const { shots } = planShots([clip('a', 1, 25, [null, { t: 'x' }, kill(20), { t: Number.NaN, kind: 'kill' }] as unknown[])], { after: 5 })
  assert.deepEqual(shots, [{ clipId: 'a', inS: 17, outS: 21.2 }])
})

// ---------- bêta 35 : projet de montage ----------
// @ts-ignore TS5097
import { cleanProject, planProject, REPORT_LAG_S } from './editPlan.ts'
// @ts-ignore TS5097
import { timeline } from '../../shared/editShots.ts'

test('projet : un plan par kill, ancré 0,3 s avant l’annonce du jeu, couvert au pas près', () => {
  const u = 0.5
  const shots = planProject([clip('a', 1, 25, [kill(20)])], { after: 5, unit: u })
  assert.equal(shots.length, 1)
  assert.equal(shots[0].anchorS, 20 - REPORT_LAG_S)
  // 2,5 s avant : 5 pas ; 1,2 s après : 3 pas. Le seul plan est le dernier : il finit au ralenti.
  assert.deepEqual({ lead: shots[0].lead, tail: shots[0].tail, slow: shots[0].slow }, { lead: 5, tail: 3, slow: true })
})

test('projet : kills proches dans un plan, ancré sur le plus fort ; headshot au ralenti', () => {
  const u = 0.46875
  const shots = planProject([clip('a', 1, 40, [kill(10), kill(11.5, 'hs'), kill(30)]), clip('b', 2, 20, [kill(15)])], { after: 5, unit: u })
  assert.equal(shots.length, 3)
  assert.equal(shots[0].anchorS, 11.2)
  assert.equal(shots[0].slow, true)
  // Le plan couvre le premier kill : 1,5 s + 2,5 s avant l'ancre.
  assert.ok(shots[0].lead * u >= 4 - 1e-6)
  assert.equal(shots[1].slow, false)
  assert.equal(shots[2].clipId, 'b')
})

test('projet propre : plans revus contre leur clip, musique calée sur sa grille, volumes bornés', () => {
  const clips = new Map([['a', { durationS: 25 }]])
  const grid = Array.from({ length: 100 }, (_, i) => 0.25 + i * 0.5)
  const musics = new Map([['m1', { bpm: 120, grid, durationS: 50 }]])
  const p = cleanProject({ v: 2, shots: [{ clipId: 'a', anchorS: 20, lead: 99, tail: 3, slow: true }, { clipId: 'zz', anchorS: 1, lead: 1, tail: 1, slow: false }], music: { id: 'm1', startS: 3.1, volume: 7 }, gameVolume: -2 }, clips, musics)
  assert.equal(p.shots.length, 1)
  // 99 pas demandés : 32 au plus.
  assert.equal(p.shots[0].lead, 32)
  assert.deepEqual(p.music, { id: 'm1', startS: 3.25, volume: 1 })
  assert.equal(p.gameVolume, 0)
  assert.equal(p.unit, 0.5)
  assert.equal(p.durationS, timeline(p.shots, 0.5).totalS)
  assert.throws(() => cleanProject({ v: 2, shots: [], music: null, gameVolume: 1 }, clips, musics), /aucun plan/)
  assert.throws(() => cleanProject({ v: 2, shots: [{ clipId: 'a', anchorS: 2, lead: 1, tail: 1, slow: false }], music: { id: 'm9', startS: 0, volume: 1 }, gameVolume: 1 }, clips, musics), /plus disponible/)
  assert.throws(() => cleanProject({ v: 1, shots: [] }, clips, musics), /refusé/)
  assert.throws(() => cleanProject({ v: 2, shots: new Array(49).fill({ clipId: 'a', anchorS: 2, lead: 1, tail: 1, slow: false }), music: null, gameVolume: 1 }, clips, musics), /48 plans/)
})
