// Tests des calculs des clips (npm run test:clips) : réglages, fenêtres, fusion, choix des fragments, rétention, noms de fichiers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canMerge,
  cleanClipSettings,
  cleanTitle,
  clipBaseName,
  clipEvents,
  clipKills,
  clipsToPurge,
  clipTitle,
  DEFAULT_CLIP_SETTINGS,
  keepFrom,
  MAX_CLIP_S,
  mergePending,
  openPending,
  parseRange,
  pickRecorder,
  restartDelayMs,
  safeFileName,
  selectFragments,
  trimEvents,
  withNeighbours,
  type BufferedFragment,
  type ClipMoment
} from './clipsPlan'

const W = { before: 20, after: 5, merge: 8 }
const GAME = { id: 'steam:730', name: 'Counter-Strike 2', sessionId: 's1' }
const T = 1_000_000

const moment = (over: Partial<ClipMoment> = {}): ClipMoment => ({ kind: 'kill', at: T, kills: 1, headshots: 0, roundKills: 1, ...over })

test('réglages : valeurs sûres par défaut, tout est vérifié', () => {
  assert.deepEqual(cleanClipSettings(undefined), DEFAULT_CLIP_SETTINGS)
  assert.deepEqual(cleanClipSettings('n’importe quoi'), DEFAULT_CLIP_SETTINGS)
  const s = cleanClipSettings({
    enabled: 'oui',
    before: 9999,
    after: -4,
    merge: 12.4,
    quality: 'ultra',
    triggers: { kill: false, death: 'oui' },
    hotkey: 'Alt+F4',
    limitGb: -1,
    games: 'cs2bf6',
    display: 12
  })
  assert.equal(s.enabled, true)
  assert.equal(s.before, 120)
  assert.equal(s.after, 0)
  assert.equal(s.merge, 12)
  assert.equal(s.quality, 'balanced')
  assert.deepEqual(s.triggers, { kill: false, hs: true, multi: true, ace: true, death: false })
  assert.equal(s.hotkey, 'Alt+C')
  assert.equal(s.limitGb, 0.001)
  assert.equal(s.games, 'cs2bf6')
  assert.equal(s.display, 12)
  // Un changement partiel garde le reste.
  const next = cleanClipSettings({ before: 30 }, { ...DEFAULT_CLIP_SETTINGS, quality: 'high', mic: true })
  assert.equal(next.before, 30)
  assert.equal(next.quality, 'high')
  assert.equal(next.mic, true)
  // Le compte Discord : sans Nitro par défaut, une valeur inconnue garde l'ancienne.
  assert.equal(s.discord, 'free')
  assert.equal(cleanClipSettings({ discord: 'basic' }).discord, 'basic')
  assert.equal(cleanClipSettings({ discord: 'nitro' }).discord, 'nitro')
  assert.equal(cleanClipSettings({ discord: 'boost' }, { ...DEFAULT_CLIP_SETTINGS, discord: 'nitro' }).discord, 'nitro')
  assert.equal(cleanClipSettings({ before: 30 }, { ...DEFAULT_CLIP_SETTINGS, discord: 'basic' }).discord, 'basic')
})

test('fenêtre : before + after autour de l’événement, on attend le plus long de after et merge', () => {
  const p = openPending('a', GAME, moment(), W)
  assert.equal(p.start, T - 20_000)
  assert.equal(p.end, T + 5_000)
  assert.equal(p.closeAt, T + 8_000)
  assert.equal(p.gameName, 'Counter-Strike 2')
  assert.equal(p.sessionId, 's1')
  assert.equal(openPending('b', GAME, moment(), { ...W, merge: 0 }).closeAt, T + 5_000)
})

test('fusion : prolonge le clip, cumule éliminations et headshots, le plus fort donne le titre', () => {
  let p = openPending('a', GAME, moment({ kills: 1, headshots: 1, kind: 'hs' }), W)
  const m2 = moment({ at: T + 7_000, kills: 1, roundKills: 2 })
  assert.equal(canMerge(p, GAME.id, m2, W), true)
  p = mergePending(p, m2, W)
  assert.equal(p.kills, 2)
  assert.equal(p.headshots, 1)
  assert.equal(p.kind, 'hs')
  assert.equal(p.end, T + 12_000)
  assert.equal(p.closeAt, T + 15_000)
  assert.equal(p.start, T - 20_000)
  const m3 = moment({ at: T + 9_000, kind: 'multi', kills: 1, roundKills: 3, map: 'de_mirage', round: 7 })
  p = mergePending(p, m3, W)
  assert.equal(p.kind, 'multi')
  assert.equal(p.kills, 3)
  assert.equal(p.peak, 3)
  assert.equal(p.map, 'de_mirage')
  assert.equal(p.round, 7)
  // Une mort ou un clip manuel n'enlève pas son titre à un clip.
  assert.equal(mergePending(p, moment({ at: T + 10_000, kind: 'death', kills: 0 }), W).kind, 'multi')
  assert.equal(mergePending(p, moment({ at: T + 10_000, kind: 'manual', kills: 0 }), W).kind, 'multi')
})

test('fusion : trop tard, autre jeu, réglée à 0 ou clip trop long : un nouveau clip', () => {
  const p = openPending('a', GAME, moment(), W)
  assert.equal(canMerge(p, GAME.id, moment({ at: T + 8_000 }), W), true)
  assert.equal(canMerge(p, GAME.id, moment({ at: T + 8_001 }), W), false)
  assert.equal(canMerge(p, 'steam:1', moment({ at: T + 1_000 }), W), false)
  assert.equal(canMerge(p, GAME.id, moment({ at: T + 1_000 }), { ...W, merge: 0 }), false)
  const long = { ...p, lastAt: T + (MAX_CLIP_S - 20) * 1000 }
  assert.equal(canMerge(long, GAME.id, moment({ at: long.lastAt + 1_000 }), W), false)
})

test('titres en français', () => {
  assert.equal(clipTitle('ace', 5, 2, 5), 'Ace')
  assert.equal(clipTitle('multi', 3, 1, 3), 'Triple')
  assert.equal(clipTitle('multi', 4, 1, 4), 'Quadruple')
  assert.equal(clipTitle('hs', 1, 1, 1), 'Headshot')
  assert.equal(clipTitle('hs', 2, 2, 2), 'Double headshot')
  assert.equal(clipTitle('hs', 2, 1, 2), 'Double')
  assert.equal(clipTitle('hs', 4, 1, 2), '4 éliminations')
  assert.equal(clipTitle('kill', 1, 0, 1), 'Élimination')
  assert.equal(clipTitle('kill', 2, 0, 1), 'Double')
  assert.equal(clipTitle('kill', 6, 0, 2), '6 éliminations')
  assert.equal(clipTitle('death', 0, 0, 0), 'Mort')
  assert.equal(clipTitle('manual', 0, 0, 0), 'Clip manuel')
})

test('un multi-kill déclenché à sa 3e élimination en compte 3', () => {
  assert.equal(clipKills({ kills: 1, peak: 3 }), 3)
  assert.equal(clipKills({ kills: 4, peak: 2 }), 4)
})

const frag = (recId: string, startS: number, endS: number, key = true): BufferedFragment => ({ recId, startWall: startS * 1000, endWall: endS * 1000, key })

test('fragments : part de la dernière image clé avant le début, s’arrête au dernier qui commence avant la fin', () => {
  const list = [frag('r', 0, 2), frag('r', 2, 4), frag('r', 4, 6), frag('r', 6, 8), frag('r', 8, 10)]
  assert.deepEqual(selectFragments(list, 3000, 7000).map((f) => f.startWall), [2000, 4000, 6000])
  assert.deepEqual(selectFragments(list, 2000, 4000).map((f) => f.startWall), [2000])
  // Tampon plus court que la fenêtre : on prend ce qu'il y a.
  assert.deepEqual(selectFragments(list, -5000, 3000).map((f) => f.startWall), [0, 2000])
  assert.deepEqual(selectFragments(list, 20_000, 25_000), [])
})

test('fragments : jamais un début sans image clé', () => {
  const list = [frag('r', 0, 2, false), frag('r', 2, 4), frag('r', 4, 6, false), frag('r', 6, 8)]
  assert.deepEqual(selectFragments(list, 5000, 7000).map((f) => f.startWall), [2000, 4000, 6000])
  assert.deepEqual(selectFragments(list, 0, 3000).map((f) => f.startWall), [2000])
  assert.deepEqual(selectFragments([frag('r', 0, 2, false)], 0, 3000), [])
})

test('voisins : un fragment de plus de chaque côté, s’il existe', () => {
  const all = [1, 2, 3, 4, 5]
  assert.deepEqual(withNeighbours(all, [2, 3]), [1, 2, 3, 4])
  assert.deepEqual(withNeighbours(all, [1]), [1, 2])
  assert.deepEqual(withNeighbours(all, [5]), [4, 5])
  assert.deepEqual(withNeighbours(all, []), [])
})

test('deux enregistreurs dans la fenêtre : jamais mélangés, celui du dernier événement d’abord', () => {
  const list = [frag('a', 0, 2), frag('a', 2, 4), frag('a', 4, 6), frag('b', 7, 9), frag('b', 9, 11)]
  assert.equal(pickRecorder(list, 0, 12_000, 8000), 'b')
  assert.equal(pickRecorder(list, 0, 12_000, 3000), 'a')
  // L'événement est dans le trou entre les deux : celui qui couvre le plus.
  assert.equal(pickRecorder(list, 0, 12_000, 6500), 'a')
  assert.equal(pickRecorder(list, 100_000, 120_000, 110_000), null)
})

test('tampon : garde before + after + marge, et tout ce qu’un clip en cours utilise', () => {
  assert.equal(keepFrom(T, W, []), T - 35_000)
  assert.equal(keepFrom(T, W, [T - 90_000, T - 50_000]), T - 90_000)
  assert.equal(keepFrom(T, W, [T - 1_000]), T - 35_000)
})

test('rétention : les plus vieux d’abord, jamais un épinglé ni le clip qui vient d’arriver', () => {
  const clips = [
    { id: 'a', at: 1, sizeBytes: 100, pinned: false },
    { id: 'b', at: 2, sizeBytes: 100, pinned: true },
    { id: 'c', at: 3, sizeBytes: 100, pinned: false },
    { id: 'd', at: 4, sizeBytes: 100, pinned: false }
  ]
  assert.deepEqual(clipsToPurge(clips, 400), [])
  assert.deepEqual(clipsToPurge(clips, 300), ['a'])
  assert.deepEqual(clipsToPurge(clips, 150), ['a', 'c', 'd'])
  assert.deepEqual(clipsToPurge(clips, 150, 'd'), ['a', 'c'])
  assert.deepEqual(clipsToPurge(clips, 0, 'd'), ['a', 'c'])
})

test('noms de fichiers : rien de ce que Windows refuse', () => {
  assert.equal(safeFileName('Battlefield™ 6: <test> / "x"?'), 'Battlefield™ 6 test x')
  assert.equal(safeFileName('  ... '), 'Clip')
  assert.equal(safeFileName('fin.  '), 'fin')
  assert.equal(safeFileName('CON'), '_CON')
  assert.equal(safeFileName('com1.mp4'), '_com1.mp4')
  const at = new Date(2026, 10, 3, 9, 4, 5).getTime()
  assert.equal(clipBaseName('Counter-Strike 2', at, 'Headshot'), 'Counter-Strike 2 2026-11-03 09-04-05 Headshot')
  assert.equal(clipBaseName('A:B', at, 'x/y'), 'A B 2026-11-03 09-04-05 x y')
  assert.ok(clipBaseName('j'.repeat(300), at, 't'.repeat(300)).length <= 150)
})

test('titre donné par le joueur : une ligne, 80 caractères, jamais vide', () => {
  assert.equal(cleanTitle('  Mon   clip\n'), 'Mon clip')
  assert.equal(cleanTitle('x'.repeat(200))!.length, 80)
  assert.equal(cleanTitle('   '), null)
  assert.equal(cleanTitle(12), null)
})

test('plages : réponses 206 pour l’avance rapide', () => {
  assert.equal(parseRange(null, 100), null)
  assert.equal(parseRange('n’importe quoi', 100), null)
  assert.equal(parseRange('bytes=0-1,5-6', 100), null)
  assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 })
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 })
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 })
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable')
  assert.equal(parseRange('bytes=20-10', 100), 'unsatisfiable')
  assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable')
  assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable')
})

test('relances : de plus en plus espacées, 30 s au plus', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 50].map(restartDelayMs), [1000, 2000, 4000, 8000, 15000, 30000, 30000])
})

test('événements : chaque kill garde son heure, puis sa seconde dans le fichier', () => {
  let p = openPending('a', GAME, moment({ kills: 1, headshots: 1, kind: 'hs' }), W)
  assert.deepEqual(p.events, [{ at: T, kind: 'hs', kills: 1, headshots: 1 }])
  p = mergePending(p, moment({ at: T + 2_400, kind: 'kill', kills: 1, headshots: 0 }), W)
  p = mergePending(p, moment({ at: T + 5_150, kind: 'multi', kills: 2, headshots: 1, roundKills: 4 }), W)
  assert.deepEqual(p.events.map((e) => e.at - T), [0, 2_400, 5_150])
  // Le fichier commence sur une image clé, 1,25 s avant la fenêtre demandée (20 s avant le premier kill).
  const startMs = p.start - 1_250
  const durationS = (p.end - startMs) / 1000
  assert.deepEqual(clipEvents(p.events, startMs, durationS), [
    { t: 21.25, kind: 'hs', kills: 1, headshots: 1 },
    { t: 23.65, kind: 'kill', kills: 1, headshots: 0 },
    { t: 26.4, kind: 'multi', kills: 2, headshots: 1 }
  ])
  // Jamais hors du fichier, toujours dans l'ordre.
  assert.deepEqual(clipEvents([{ at: T + 9_000, kind: 'kill', kills: 1, headshots: 0 }, { at: T - 500, kind: 'kill', kills: 1, headshots: 0 }], T, 5).map((e) => e.t), [0, 5])
  assert.deepEqual(clipEvents([], T, 5), [])
})

test('événements : une fusion ne grossit pas sans fin', () => {
  let p = openPending('a', GAME, moment(), { ...W, merge: 30 })
  for (let i = 1; i < 400; i++) p = mergePending(p, moment({ at: T + i * 10 }), { ...W, merge: 30 })
  assert.equal(p.events.length, 200)
  assert.equal(p.kills, 400)
})

test('événements d’un clip coupé : ceux qui restent, recalés sur le nouveau début', () => {
  const ev = [
    { t: 4, kind: 'kill' as const, kills: 1, headshots: 0 },
    { t: 20.5, kind: 'hs' as const, kills: 1, headshots: 1 },
    { t: 24, kind: 'kill' as const, kills: 1, headshots: 0 }
  ]
  assert.deepEqual(trimEvents(ev, 18, 4), [{ t: 2.5, kind: 'hs', kills: 1, headshots: 1 }])
  assert.deepEqual(trimEvents(ev, 18, 6), [{ t: 2.5, kind: 'hs', kills: 1, headshots: 1 }, { t: 6, kind: 'kill', kills: 1, headshots: 0 }])
  assert.deepEqual(trimEvents(ev, 30, 5), [])
  // Un clip d'avant la bêta 33 n'a pas d'événements : son clip coupé non plus.
  assert.equal(trimEvents(undefined, 18, 4), undefined)
})

test('rétention : un film ne compte pas dans la limite et ne part jamais tout seul', () => {
  const clips = [
    { id: 'film', at: 0, sizeBytes: 900, pinned: false, kind: 'film' },
    { id: 'a', at: 1, sizeBytes: 100, pinned: false, kind: 'kill' },
    { id: 'b', at: 2, sizeBytes: 100, pinned: false, kind: 'hs' }
  ]
  assert.deepEqual(clipsToPurge(clips, 200), [])
  assert.deepEqual(clipsToPurge(clips, 150), ['a'])
  assert.deepEqual(clipsToPurge(clips, 0), ['a', 'b'])
})
