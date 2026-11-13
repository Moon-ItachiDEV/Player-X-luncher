// Overlay CS2 : quelle pièce montrer, à quel moment. Sans DOM (testé par view.test.ts) ; overlay.ts la dessine.
import type { Cs2Live, Cs2OverlayConfig, Cs2Recap } from '@shared/types'

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

export function sampleLive(phase: 'buy' | 'pill' | 'half'): Cs2Live {
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

/** Les quatre pièces, 6 s chacune, puis rien. */
export function previewView(at: number, now: number): View {
  const t = now - at
  if (t < 6_000) return { kind: 'buy', live: sampleLive('buy') }
  if (t < 12_000) return { kind: 'pill', live: sampleLive('pill') }
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

/** Ce que l'overlay montre : rien s'il est coupé ou masqué, l'aperçu s'il tourne, sinon le match. */
export function pickView(cfg: Cs2OverlayConfig, live: Cs2Live | null, end: Cs2Recap | null, now: number): View {
  if (cfg.style === 'off' || cfg.hidden) return null
  return cfg.previewAt !== undefined ? previewView(cfg.previewAt, now) : liveView(live, end, now)
}

/** Secondes avant que le bilan se replie (20 au plus) ; dans l'aperçu, le bilan commence à 18 s. */
export function endSecondsLeft(cfg: Cs2OverlayConfig, recap: Cs2Recap, now: number): number {
  const from = cfg.previewAt !== undefined ? cfg.previewAt + 18_000 : recap.endedAt
  return Math.min(20, Math.max(0, Math.ceil((END_MS - (now - from)) / 1000)))
}
