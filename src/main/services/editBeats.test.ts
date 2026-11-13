// Tests des temps d'une musique (npm run test:edit) : kicks de synthèse à tempo connu.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { BEAT_RATE, detectBeats } from './editBeats.ts'

/** Un kick (sinus 60 Hz qui décroît) tous les 60/bpm s à partir de `phase`, plus un bruit faible. */
function kicks(bpm: number, phase: number, seconds: number, noise = 0.01, skipEvery = 0): Float32Array {
  const sr = BEAT_RATE
  const x = new Float32Array(Math.round(seconds * sr))
  let seed = 7
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
  for (let i = 0; i < x.length; i++) x[i] = noise * rnd()
  const p = 60 / bpm
  let n = 0
  for (let t = phase; t < seconds; t += p, n++) {
    if (skipEvery && n % skipEvery === skipEvery - 1) continue
    const i0 = Math.round(t * sr)
    for (let j = 0; j < sr * 0.15 && i0 + j < x.length; j++) x[i0 + j] += Math.sin((2 * Math.PI * 60 * j) / sr) * Math.exp(-j / (sr * 0.04))
  }
  return x
}

for (const [bpm, phase] of [[128, 0.25], [95, 0.6], [150, 0.1], [174, 0.33]] as const) {
  test(`${bpm} battements par minute : tempo et temps à 25 ms près`, () => {
    const r = detectBeats(kicks(bpm, phase, 40))
    assert.ok(r, 'pas de tempo')
    assert.ok(Math.abs(r.bpm - bpm) < 0.2, `tempo ${r.bpm}`)
    const p = 60 / bpm
    for (const t of r.grid.filter((g) => g > 1 && g < 39)) {
      const k = Math.round((t - phase) / p)
      // L'analyse voit la montée d'énergie, quelques ms après le début du kick.
      assert.ok(Math.abs(t - (phase + k * p)) < 0.025, `temps ${t} loin du kick ${phase + k * p}`)
    }
  })
}

test('quelques kicks manquants ne changent pas le tempo', () => {
  const r = detectBeats(kicks(128, 0.25, 40, 0.01, 7))
  assert.ok(r && Math.abs(r.bpm - 128) < 0.2, `tempo ${r?.bpm}`)
})

test('silence, bruit, trop court : pas de tempo', () => {
  assert.equal(detectBeats(new Float32Array(BEAT_RATE * 20)), null)
  assert.equal(detectBeats(kicks(128, 0.2, 0, 0.3)), null)
  assert.equal(detectBeats(new Float32Array(100)), null)
})
