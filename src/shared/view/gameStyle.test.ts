// Tests des boutons caméléon (npm run test:home) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { coverFeatures, decideStyle, luminance, tagScores } from './gameStyle.ts'

const W = 60
const H = 90
/** Une jaquette synthétique : chaque pixel est donné par une fonction (x, y) → [r, g, b]. */
function cover(px: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = px(x, y)
    const i = (y * W + x) * 4
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
    d[i + 3] = 255
  }
  return d
}
const style = (px: (x: number, y: number) => [number, number, number], tags: string[] = []) => decideStyle(coverFeatures(cover(px), W, H), tags)

test('jaune vif barré de noir : néon, accent jaune et texte sombre dessus', () => {
  const s = style((x, y) => ((x + y) % 14 < 4 ? [15, 15, 15] : [242, 230, 0]))
  assert.equal(s.style, 'neon')
  assert.ok(luminance(s.accent) > 0.5, s.accent)
  assert.equal(s.onAccent, '#120d10')
})

test('pelouse rayée sous un ciel : stade', () => {
  const s = style((x, y) => (y < 30 ? [45, 111, 224] : Math.floor(y / 8) % 2 ? [46, 158, 62] : [56, 178, 74]))
  assert.equal(s.style, 'stade')
})

test('presque noir et terne : frisson', () => {
  assert.equal(style(() => [10, 12, 10]).style, 'frisson')
})

test('gris olive moyen : tactique', () => {
  assert.equal(style(() => [93, 99, 85]).style, 'tactique')
})

test('les tags Steam l’emportent sur une image ambiguë', () => {
  const muted = (): [number, number, number] => [93, 99, 85]
  assert.equal(style(muted, ['Sports', 'Football (Soccer)', 'Simulation']).style, 'stade')
  assert.equal(style(muted, ['Anime', '3D Fighting', 'Action']).style, 'pop')
})

test('tags seuls, sans image lisible', () => {
  assert.equal(decideStyle(null, ['FPS', 'Shooter', 'Multiplayer']).style, 'tactique')
  assert.equal(decideStyle(null, ['Racing', 'Driving']).style, 'vitesse')
})

test('rien de lisible : neutre avec l’accent rose de l’appli', () => {
  const s = decideStyle(null, ['Indie', 'Casual Puzzle'])
  assert.equal(s.style, 'neutre')
  assert.equal(s.accent, '#ff5c86')
})

test('un accent tiré d’une jaquette sombre reste lisible (jamais trop sombre)', () => {
  const f = coverFeatures(cover((x) => (x < 20 ? [60, 0, 90] : [5, 5, 8])), W, H)
  assert.ok(luminance(f.accent) > 0.08, f.accent)
})

test('les tags ignorent la casse et les premiers comptent plus', () => {
  const a = tagScores(['HORROR', 'Indie'])
  const b = tagScores(['Indie', 'Casual', 'Puzzle', 'Atmospheric', 'Story Rich', 'Singleplayer', '2D', 'Pixel Graphics', 'Horror'])
  assert.ok(a.frisson > b.frisson)
})
