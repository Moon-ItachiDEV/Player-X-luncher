// Les temps d'une musique, sans Electron ni fichier (testé par editBeats.test.ts). Repris du prototype du 9 novembre
// (fm-rd/poc/beats.mjs : tempo 127,999 pour 128, temps forts à 20 ms près sur une musique de synthèse).
// Le son arrive déjà décodé par le moteur : mono, passe-bas à 150 Hz (le kick), en nombres flottants.
// Énergie par fenêtre → hausses d'énergie → pics au-dessus d'un seuil local → tempo (médiane des écarts, ramenée entre 70 et
// 180 battements par minute) → grille régulière ajustée aux pics par moindres carrés.

export interface MusicBeats {
  bpm: number
  /** Les temps, en secondes depuis le début du morceau, à intervalle régulier. */
  grid: number[]
  durationS: number
  /** Nombre d'attaques trouvées : sous 8, pas de tempo fiable. */
  onsets: number
}

/** Fréquence du son décodé pour l'analyse. 11 025 Hz suffisent pour un passe-bas à 150 Hz. */
export const BEAT_RATE = 11025
const HOP = 128
const WIN = 512

/** null : pas assez d'attaques nettes pour trouver un tempo (morceau calme, parlé, silence). */
export function detectBeats(x: Float32Array, sr: number = BEAT_RATE): MusicBeats | null {
  const durationS = x.length / sr
  const n = Math.floor((x.length - WIN) / HOP)
  if (n < 16) return null
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < WIN; j++) {
      const v = x[i * HOP + j]
      s += v * v
    }
    env[i] = Math.log(1e-9 + s)
  }
  const flux = new Float32Array(n)
  for (let i = 1; i < n; i++) flux[i] = Math.max(0, env[i] - env[i - 1])
  // Somme glissante pour le seuil local (± 0,25 s).
  const half = Math.round((0.25 * sr) / HOP)
  const pre = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + flux[i]
  // Une attaque doit être forte : à moins de 26 dB du plus fort du morceau (le bruit de fond d'un passage calme n'en est pas une).
  let top = -Infinity
  for (let i = 0; i < n; i++) if (env[i] > top) top = env[i]
  const floor = top - 6
  const onsets: number[] = []
  for (let i = 1; i < n - 1; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n, i + half)
    const thr = (1.5 * (pre[b] - pre[a])) / (b - a) + 0.05
    if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && env[Math.min(n - 1, i + 2)] > floor) {
      const t = (i * HOP + WIN / 2) / sr
      if (!onsets.length || t - onsets[onsets.length - 1] > 0.2) onsets.push(t)
    }
  }
  if (onsets.length < 8) return null
  const iois = onsets
    .slice(1)
    .map((t, i) => t - onsets[i])
    .sort((p, q) => p - q)
  let period = iois[Math.floor(iois.length / 2)]
  if (!(period > 0)) return null
  while (60 / period < 70) period /= 2
  while (60 / period > 180) period *= 2
  // La phase la plus fréquente (attaques repliées sur une période) ; seules les attaques proches de cette grille comptent :
  // une attaque entre deux temps (contretemps, caisse claire) ne fait pas dériver le tempo.
  const BINS = 40
  const hist = new Array<number>(BINS).fill(0)
  const fold = (t: number): number => (((t / period) % 1) + 1) % 1
  for (const t of onsets) {
    const b = Math.floor(fold(t) * BINS) % BINS
    hist[b] += 1
    hist[(b + 1) % BINS] += 0.5
    hist[(b + BINS - 1) % BINS] += 0.5
  }
  const best = hist.indexOf(Math.max(...hist))
  // Première grille : cette phase et la période approchée (au pas d'analyse près, 11,6 ms : sur 100 temps, l'écart se cumule).
  // On l'ajuste donc d'abord sur les premières secondes, puis sur une plage de plus en plus longue.
  let phase = ((best + 0.5) / BINS) * period
  const t0 = onsets[0]
  let used = 0
  for (const span of [8, 16, 32, 64, Infinity]) {
    const near = onsets.filter((t) => {
      if (t - t0 > span) return false
      const d = fold(t - phase)
      return Math.min(d, 1 - d) < 0.12
    })
    if (near.length < 4) continue
    // Moindres carrés de t = phase + k × période, k = numéro du temps dans la grille actuelle.
    const ks = near.map((t) => Math.round((t - phase) / period))
    const mk = ks.reduce((p, q) => p + q, 0) / ks.length
    const mt = near.reduce((p, q) => p + q, 0) / near.length
    let num = 0
    let den = 0
    ks.forEach((k, i) => {
      num += (k - mk) * (near[i] - mt)
      den += (k - mk) ** 2
    })
    if (den > 0) period = num / den
    phase = mt - period * mk
    used = near.length
  }
  if (used < 8) return null
  const bpm = 60 / period
  if (!(bpm >= 60 && bpm <= 200)) return null
  const grid: number[] = []
  for (let t = phase - Math.floor(phase / period) * period; t < durationS; t += period) grid.push(Math.round(t * 10000) / 10000)
  return { bpm: Math.round(bpm * 1000) / 1000, grid, durationS: Math.round(durationS * 1000) / 1000, onsets: onsets.length }
}
