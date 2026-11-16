// Overlay CS2 : quelle pièce montrer, à quel moment. Sans DOM (testé par view.test.ts) ; overlay.ts la dessine.
import type { Cs2Live, Cs2OverlayConfig, Cs2OverlayMoment, Cs2Recap, Cs2Round } from '@shared/types'

/** Fin du match : le bilan reste 20 s, puis se replie. */
export const END_MS = 20_000

export type View = { kind: 'buy' | 'pill' | 'half'; live: Cs2Live } | { kind: 'end'; recap: Cs2Recap } | null

// ---------- aperçu (chiffres d'exemple) ----------

/** Exemple : chiffres fictifs, toujours présentés comme tels. Un match compétitif 13–9 sur Dust II. */
export function sampleCs2Recap(): Cs2Recap {
  const endedAt = Date.now() - 2 * 60_000
  const script: [string, number][] = [
    ['ct_win_elimination', 1],
    ['ct_win_elimination', 2],
    ['t_win_elimination', 0],
    ['ct_win_elimination', 3],
    ['ct_win_time', 1],
    ['ct_win_elimination', 2],
    ['ct_win_defuse', 1],
    ['t_win_bomb', 0],
    ['t_win_elimination', 1],
    ['t_win_elimination', 2],
    ['t_win_elimination', 0],
    ['ct_win_elimination', 1],
    ['ct_win_elimination', 0],
    ['t_win_elimination', 4],
    ['t_win_bomb', 2],
    ['t_win_elimination', 1],
    ['t_win_elimination', 1],
    ['ct_win_elimination', 0],
    ['t_win_bomb', 3],
    ['ct_win_time', 0],
    ['ct_win_elimination', 1],
    ['t_win_elimination', 1]
  ]
  return {
    id: 'cs2-sample',
    sample: true,
    steamId: '0',
    map: 'de_dust2',
    mode: 'competitive',
    startedAt: endedAt - 48 * 60_000,
    endedAt,
    result: 'win',
    score: { us: 13, them: 9 },
    kills: 27,
    deaths: 14,
    assists: 5,
    mvps: 4,
    points: 61,
    headshots: 12,
    damage: 2_380,
    trackedKills: 27,
    roundsTracked: 22,
    multi: { k3: 2, k4: 1, k5: 0 },
    best: { n: 14, kills: 4, damage: 312 },
    rounds: script.map(([code, kills], i) => {
      const side = i < 12 ? 'CT' : 'T'
      return { n: i + 1, winner: code.startsWith('ct_') ? 'CT' : 'T', end: code.includes('bomb') ? 'bomb' : code.includes('defuse') ? 'defuse' : code.includes('time') ? 'time' : 'elimination', side, kills }
    }),
    hasRounds: true
  }
}

/** `pill3` : la même pastille au même round, après un triplé (l'aperçu montre le logo qui compte les élim.). */
export function sampleLive(phase: 'buy' | 'pill' | 'pill3' | 'half'): Cs2Live {
  if (phase === 'pill3') return { ...sampleLive('pill'), kills: 11, roundKills: 3 }
  const r = sampleCs2Recap()
  const done = phase === 'half' ? 12 : 7
  const rounds = r.rounds.slice(0, done)
  const us = rounds.filter((x) => x.side === x.winner).length
  return {
    map: 'de_dust2',
    mode: 'competitive',
    phase: phase === 'half' ? 'intermission' : 'live',
    roundPhase: phase === 'buy' ? 'freezetime' : phase === 'half' ? 'over' : 'live',
    round: phase === 'half' ? 12 : 8,
    rounds,
    side: 'CT',
    score: { us, them: done - us },
    kills: phase === 'half' ? 14 : 9,
    deaths: phase === 'half' ? 9 : 5,
    assists: phase === 'half' ? 3 : 2,
    mvps: 2,
    points: 24,
    health: 100,
    money: 4250,
    roundKills: phase === 'pill' ? 1 : 0,
    adr: phase === 'half' ? 88 : 92,
    hsPct: phase === 'half' ? 46 : 44,
    startedAt: Date.now() - 20 * 60_000
  }
}

/** Les quatre pièces, 6 s chacune, puis rien. La pastille passe d'une élim. à trois (un triplé) à mi-chemin. */
export function previewView(at: number, now: number): View {
  const t = now - at
  if (t < 6_000) return { kind: 'buy', live: sampleLive('buy') }
  if (t < 9_000) return { kind: 'pill', live: sampleLive('pill') }
  if (t < 12_000) return { kind: 'pill', live: sampleLive('pill3') }
  if (t < 18_000) return { kind: 'half', live: sampleLive('half') }
  if (t < 24_000) return { kind: 'end', recap: sampleCs2Recap() }
  return null
}

// ---------- ce que montre le vrai match ----------

export function liveView(live: Cs2Live | null, end: Cs2Recap | null, now: number): View {
  if (end && now - end.endedAt < END_MS && (!live || live.phase === 'gameover')) return { kind: 'end', recap: end }
  if (!live) return null
  if (live.phase === 'intermission') return { kind: 'half', live }
  if (live.phase !== 'live') return null
  if (live.roundPhase === 'freezetime') return { kind: 'buy', live }
  return { kind: 'pill', live }
}

/** Réglage en plein écran : le moment choisi, avec les chiffres d'exemple (en round : après un triplé, le plus grand). */
export function editView(moment: Cs2OverlayMoment): View {
  if (moment === 'end') return { kind: 'end', recap: sampleCs2Recap() }
  return { kind: moment, live: sampleLive(moment === 'pill' ? 'pill3' : moment) } as View
}

/** Ce que l'overlay montre : rien s'il est coupé ou masqué, le réglage ou l'aperçu s'il tourne, sinon le match. */
export function pickView(cfg: Cs2OverlayConfig, live: Cs2Live | null, end: Cs2Recap | null, now: number): View {
  if (cfg.edit) return editView(cfg.edit.moment)
  if (cfg.style === 'off' || cfg.hidden) return null
  return cfg.previewAt !== undefined ? previewView(cfg.previewAt, now) : liveView(live, end, now)
}

/** Secondes avant que le bilan se replie (20 au plus) ; dans l'aperçu, le bilan commence à 18 s. */
export function endSecondsLeft(cfg: Cs2OverlayConfig, recap: Cs2Recap, now: number): number {
  if (cfg.edit) return 20
  const from = cfg.previewAt !== undefined ? cfg.previewAt + 18_000 : recap.endedAt
  return Math.min(20, Math.max(0, Math.ceil((END_MS - (now - from)) / 1000)))
}

// ---------- argent (temps d'achat) ----------

/** Achat complet : CT 4 300 $ (M4 2 900 + gilet et casque 1 000 + kit 400), T 3 700 $ (AK 2 700 + gilet et casque 1 000). */
export const FULL_BUY = { CT: 4300, T: 3700 } as const
/** Sous 2 000 $, on ne force pas : éco. */
export const FORCE_MIN = 2000

export interface BuyAdvice {
  kind: 'full' | 'almost' | 'force' | 'eco'
  title: string
  detail: string
}

/** Ce que permet l'argent du début du temps d'achat (pas celui qui reste après tes achats). */
export function buyAdvice(money: number, side: 'CT' | 'T'): BuyAdvice {
  const full = FULL_BUY[side]
  if (money >= full) return { kind: 'full', title: 'Achat complet', detail: side === 'CT' ? 'fusil, gilet, casque et kit' : 'fusil, gilet et casque' }
  if (money >= FORCE_MIN) {
    const miss = full - money
    if (miss <= 400) return { kind: 'almost', title: 'Presque complet', detail: `il manque ${miss}\u00a0$ pour ${side === 'CT' ? 'le kit' : 'le casque'}` }
    return { kind: 'force', title: 'Force', detail: 'arme légère et gilet' }
  }
  return { kind: 'eco', title: 'Éco', detail: 'garde ton argent pour le round suivant' }
}

/** Les rounds 12 et 24 finissent une mi-temps : l'argent repart de zéro, pas de « round suivant » à annoncer. */
const LAST_OF_HALF = 12

/**
 * Le bonus de défaite le plus bas possible au prochain round, si celui-ci est perdu : 1 400 $, plus 500 $ par défaite
 * d'affilée juste avant (jusqu'à 3 400 $). CS2 ne remet pas son compteur à zéro après une victoire (il le baisse d'un cran),
 * donc compter seulement la série en cours donne toujours un minimum. Rien en fin de mi-temps ni en prolongation.
 */
export function lossBonusMin(rounds: Cs2Round[], round: number): number | null {
  if (round % LAST_OF_HALF === 0 || round > 2 * LAST_OF_HALF) return null
  const halfStart = round > LAST_OF_HALF ? LAST_OF_HALF + 1 : 1
  let streak = 0
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i]
    if (r.n < halfStart || !r.side || r.winner === r.side) break
    streak++
  }
  return Math.min(3400, 1400 + 500 * streak)
}
