// Tests du rythme réel des clips (npm run test:clips) : images par seconde d'un clip, seuil, bilan d'une partie, textes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { cleanGamePace, cleanPace, gamePace, gamePaceAlert, gamePaceLine, isSlow, paceLog, paceNote, paceOf, rateBetween, slowUnder, type ClipPace } from './clipPace.ts'

/** Les instants d'images régulières : `fps` images par seconde de `from` à `to` secondes. */
const frames = (fps: number, from: number, to: number): number[] => {
  const out: number[] = []
  for (let i = 0; from + i / fps < to - 1e-9; i++) out.push(from + i / fps)
  return out
}

test('le seuil : 50 pour une capture à 60 images/s, 25 pour une capture à 30', () => {
  assert.equal(slowUnder(60), 50)
  assert.equal(slowUnder(30), 25)
})

test('un clip régulier : 60 images/s, et les deux secondes les plus lentes valent la moyenne', () => {
  assert.deepEqual(paceOf(frames(60, 0, 25), 25, 60), { fps: 60, low: 60, wanted: 60 })
  assert.deepEqual(paceOf(frames(30, 0, 25), 25, 30), { fps: 30, low: 30, wanted: 30 })
  // Les instants ne partent pas de zéro (horloge du flux) et arrivent dans le désordre : même résultat.
  const shuffled = frames(60, 812.4, 837.4).reverse()
  assert.deepEqual(paceOf(shuffled, 25, 60), { fps: 60, low: 60, wanted: 60 })
  assert.equal(shuffled[0] > shuffled[1], true, 'la liste donnée n’est pas triée à la place de l’appelant')
})

test('un clip filmé à 46 images/s : lent, avec sa note', () => {
  const p = paceOf(frames(46, 0, 25), 25, 60)!
  assert.equal(p.fps, 46)
  assert.equal(isSlow(p), true)
  assert.equal(paceNote(p), 'Filmé à 46 images/s')
  // 49,6 : sous le seuil, et la note ne dit pas « 50 ».
  assert.equal(paceNote({ fps: 49.6, low: 40, wanted: 60 }), 'Filmé à 49 images/s')
  // Pile au seuil : rien à dire.
  assert.equal(isSlow({ fps: 50, low: 50, wanted: 60 }), false)
  assert.equal(paceNote({ fps: 50, low: 50, wanted: 60 }), null)
  // Qualité légère : le seuil suit la cadence demandée.
  assert.equal(paceNote({ fps: 29.8, low: 28, wanted: 30 }), null)
  assert.equal(paceNote({ fps: 24.2, low: 20, wanted: 30 }), 'Filmé à 24 images/s')
  assert.equal(paceNote(undefined), null)
  assert.equal(isSlow(null), false)
})

test('un arrêt bref : la moyenne reste bonne, pas de note, le journal garde le passage le plus lent', () => {
  // 25 s à 60 images/s, sauf un arrêt de 1,5 s (de 10 à 11,5 s).
  const p = paceOf([...frames(60, 0, 10), ...frames(60, 11.5, 25)], 25, 60)!
  assert.equal(p.fps, 56.4)
  assert.equal(p.low, 15)
  assert.equal(isSlow(p), false)
  assert.equal(paceNote(p), null)
  assert.equal(paceLog(p), '56,4 images/s (2 s les plus lentes : 15)')
  assert.equal(paceLog(undefined), 'rythme inconnu')
})

test('un long trou sans image : la tranche vide compte zéro', () => {
  const p = paceOf([...frames(60, 0, 4), ...frames(60, 10, 12)], 12, 60)!
  assert.equal(p.fps, 30)
  assert.equal(p.low, 0)
  assert.equal(isSlow(p), true)
})

test('trop court ou trop peu d’images : pas de rythme', () => {
  assert.equal(paceOf(frames(60, 0, 0.9), 0.9, 60), null)
  assert.equal(paceOf([0.5], 10, 60), null)
  assert.equal(paceOf([], 10, 60), null)
  assert.equal(paceOf(frames(60, 0, 10), Number.NaN, 60), null)
  assert.equal(paceOf(frames(60, 0, 10), 10, 0), null)
  // Des valeurs impossibles dans la liste sont ignorées.
  assert.deepEqual(paceOf([Number.NaN, ...frames(60, 0, 10), Number.POSITIVE_INFINITY], 10, 60), { fps: 60, low: 60, wanted: 60 })
  // Moins de deux secondes : pas de tranche entière, le passage le plus lent vaut la moyenne.
  assert.deepEqual(paceOf(frames(60, 0, 1.5), 1.5, 60), { fps: 60, low: 60, wanted: 60 })
})

test('un rythme relu dans la base : vérifié', () => {
  assert.deepEqual(cleanPace({ fps: 58.2, low: 41, wanted: 60, autre: 1 }), { fps: 58.2, low: 41, wanted: 60 })
  for (const bad of [null, 'x', {}, { fps: '58', low: 41, wanted: 60 }, { fps: -1, low: 0, wanted: 60 }, { fps: 58, low: 41, wanted: 0 }, { fps: 5000, low: 41, wanted: 60 }, { fps: Number.NaN, low: 1, wanted: 60 }]) {
    assert.equal(cleanPace(bad), undefined)
  }
})

const clip = (fps: number, durationS: number, wanted = 60): { pace: ClipPace; durationS: number } => ({ pace: { fps, low: fps, wanted }, durationS })

test('une partie : la moyenne pèse chaque clip selon sa durée, et compte les clips lents', () => {
  const g = gamePace([clip(60, 30), clip(40, 10), { durationS: 25 }], 'Counter-Strike 2', 1_700_000_000_000)
  assert.deepEqual(g, { at: 1_700_000_000_000, game: 'Counter-Strike 2', clips: 2, slow: 1, fps: 55, wanted: 60 })
  assert.equal(gamePaceLine(g), 'Dernière partie : 1 clip sur 2 sous 50 images/s.')
  assert.equal(gamePaceAlert(g), 'Partie finie : 1 clip sur 2 sous 50 images/s.')
  const many = gamePace([clip(41, 25), clip(44, 25), clip(59, 25)], 'Battlefield 6', 5)
  assert.equal(gamePaceAlert(many), 'Partie finie : 2 clips sur 3 sous 50 images/s.')
})

test('une partie sans clip lent : une ligne dans Paramètres, aucun message', () => {
  const g = gamePace([clip(58.4, 25), clip(59.2, 25)], 'Counter-Strike 2', 9)
  assert.equal(g.slow, 0)
  assert.equal(gamePaceLine(g), 'Dernière partie : 59 images/s dans tes clips.')
  assert.equal(gamePaceAlert(g), null)
})

test('une partie sans clip au rythme connu : rien à afficher', () => {
  const g = gamePace([{ durationS: 25 }], 'Counter-Strike 2', 9)
  assert.deepEqual(g, { at: 9, game: 'Counter-Strike 2', clips: 0, slow: 0, fps: 0, wanted: 60 })
  assert.equal(gamePaceLine(g), null)
  assert.equal(gamePaceAlert(g), null)
  assert.equal(gamePaceLine(undefined), null)
  assert.equal(gamePaceAlert(null), null)
})

test('une partie en qualité légère : le seuil est 25', () => {
  const g = gamePace([clip(22, 25, 30), clip(29, 25, 30), clip(30, 25, 30)], 'Counter-Strike 2', 9)
  assert.equal(g.wanted, 30)
  assert.equal(g.slow, 1)
  assert.equal(gamePaceLine(g), 'Dernière partie : 1 clip sur 3 sous 25 images/s.')
})

test('le bilan d’une partie relu dans la base : vérifié', () => {
  const g = { at: 1_700_000_000_000, game: 'Counter-Strike 2', clips: 4, slow: 1, fps: 55.5, wanted: 60 }
  assert.deepEqual(cleanGamePace({ ...g, autre: true }), g)
  for (const bad of [null, [], { ...g, at: 0 }, { ...g, game: 5 }, { ...g, slow: 9 }, { ...g, clips: -1 }, { ...g, wanted: 0 }, { ...g, fps: 'x' }]) {
    assert.equal(cleanGamePace(bad), undefined)
  }
})

test('le rythme entre deux relevés du moteur', () => {
  assert.equal(rateBetween({ frames: 600, at: 10_000 }, { frames: 1180, at: 20_000 }), 58)
  assert.equal(rateBetween({ frames: 600, at: 10_000 }, { frames: 600, at: 20_000 }), 0)
  // Pas de relevé d'avant, relevés trop proches, compteur reparti de zéro.
  assert.equal(rateBetween(null, { frames: 600, at: 10_000 }), null)
  assert.equal(rateBetween({ frames: 600, at: 10_000 }, { frames: 640, at: 10_500 }), null)
  assert.equal(rateBetween({ frames: 600, at: 10_000 }, { frames: 12, at: 20_000 }), null)
})
