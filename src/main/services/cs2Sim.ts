// Simulateur de Counter-Strike 2 pour le développement (PX_CS2_SIM) : sans Windows ni le jeu, il poste au serveur local
// les mêmes envois que CS2 (Game State Integration), jeton compris. Chargé seulement quand l'appli n'est pas installée
// (import dynamique), jamais livré dans l'installeur.
// PX_CS2_SIM=auto : un match compétitif 13–9 sur Mirage (7–5 à la mi-temps), un round toutes les 1,6 s, puis retour au menu et fermeture du jeu.
// PX_CS2_SIM=live : le même match, arrêté au round 17 (pour les captures de la carte « En match »).
// PX_CS2_SIM=manual : globalThis.pxCs2Sim.post(envoi) / .running(true|false) / .play(), pour les tests.
import { cs2SimEndpoint, simulateCs2Running } from './cs2Live'

const ME = '76561198000000001'
const MATE = '76561198000000002'
const ROUND_MS = 1_600

type Side = 'CT' | 'T'

/** Le match joué : vainqueur, façon de gagner, et ce que tu fais (élim., dont headshots, dégâts, mort ou pas). */
const SCRIPT: [winner: 'ct' | 't', how: string, kills: number, hs: number, dmg: number, died: boolean][] = [
  ['ct', 'elimination', 1, 1, 100, false],
  ['ct', 'elimination', 2, 1, 187, false],
  ['t', 'elimination', 0, 0, 34, true],
  ['ct', 'elimination', 3, 2, 296, false],
  ['ct', 'time', 1, 0, 112, false],
  ['ct', 'elimination', 2, 1, 205, true],
  ['ct', 'defuse', 1, 1, 96, false],
  ['t', 'bomb', 0, 0, 58, true],
  ['t', 'elimination', 1, 0, 120, true],
  ['t', 'elimination', 2, 1, 174, true],
  ['t', 'elimination', 0, 0, 12, true],
  ['ct', 'elimination', 1, 0, 88, false],
  // Mi-temps : tu passes T.
  ['ct', 'elimination', 0, 0, 40, true],
  ['t', 'elimination', 4, 2, 312, false],
  ['t', 'bomb', 2, 1, 190, false],
  ['t', 'elimination', 1, 1, 100, false],
  ['t', 'elimination', 1, 0, 76, true],
  ['ct', 'elimination', 0, 0, 22, true],
  ['t', 'bomb', 3, 2, 254, false],
  ['ct', 'time', 0, 0, 15, true],
  ['ct', 'elimination', 1, 0, 93, true],
  ['t', 'elimination', 1, 0, 108, false]
]

let endpoint: { port: number; token: string } | null = null

async function post(body: Record<string, unknown>): Promise<void> {
  if (!endpoint) return
  try {
    await fetch(`http://127.0.0.1:${endpoint.port}/cs2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, auth: { token: endpoint.token } })
    })
  } catch (e) {
    console.warn('[cs2-sim]', e)
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Me {
  side: Side
  kills: number
  deaths: number
  assists: number
  mvps: number
  points: number
  rk: number
  rhs: number
  rdmg: number
  health: number
  money: number
  spectating: boolean
}

function payload(map: Record<string, unknown> | null, roundPhase: string, me: Me): Record<string, unknown> {
  return {
    provider: { name: 'Counter-Strike: Global Offensive', appid: 730, version: 14100, steamid: ME, timestamp: Math.floor(Date.now() / 1000) },
    ...(map ? { map, round: { phase: roundPhase } } : {}),
    player: {
      steamid: me.spectating ? MATE : ME,
      name: me.spectating ? 'Rook' : 'Breezy',
      team: me.side,
      activity: map ? 'playing' : 'menu',
      state: { health: me.spectating ? 74 : me.health, armor: 100, helmet: true, money: me.money, round_kills: me.rk, round_killhs: me.rhs, round_totaldmg: me.rdmg },
      match_stats: { kills: me.kills, assists: me.assists, deaths: me.deaths, mvps: me.mvps, score: me.points }
    }
  }
}

/** Le match du script. `stopAt` : s'arrête pendant ce round et envoie un battement toutes les 2 s (captures). */
async function play(stopAt?: number): Promise<void> {
  const me: Me = { side: 'CT', kills: 0, deaths: 0, assists: 0, mvps: 0, points: 0, rk: 0, rhs: 0, rdmg: 0, health: 100, money: 800, spectating: false }
  const score = { ct: 0, t: 0 }
  const wins: Record<string, string> = {}
  const map = (phase: string, done: number): Record<string, unknown> => ({
    mode: 'competitive',
    name: 'de_mirage',
    phase,
    round: done,
    team_ct: { score: score.ct },
    team_t: { score: score.t },
    round_wins: { ...wins }
  })
  // Échauffement : ce qui s'y passe ne compte pas.
  await post(payload(map('warmup', 0), 'live', { ...me, kills: 6, rk: 6, rdmg: 600 }))
  await wait(2_000)
  for (let i = 0; i < SCRIPT.length; i++) {
    const [winner, how, k, hs, dmg, died] = SCRIPT[i]
    if (i === 12) {
      await post(payload(map('intermission', i), 'over', me))
      await wait(ROUND_MS / 2)
      me.side = 'T'
      ;[score.ct, score.t] = [score.t, score.ct]
    }
    Object.assign(me, { rk: 0, rhs: 0, rdmg: 0, health: 100, spectating: false, money: Math.min(16_000, me.money + 2_700) })
    await post(payload(map('live', i), 'freezetime', me))
    await wait(ROUND_MS / 4)
    await post(payload(map('live', i), 'live', me))
    if (stopAt === i + 1) {
      // En plein round : 2 éliminations, l'argent dépensé, puis on reste là.
      Object.assign(me, { rk: 2, rhs: 1, rdmg: 187, kills: me.kills + 2, health: 64, money: 3_450, points: me.points + 4 })
      for (;;) {
        await post(payload(map('live', i), 'live', me))
        await wait(2_000)
      }
    }
    await wait(ROUND_MS / 4)
    Object.assign(me, { rk: k, rhs: hs, rdmg: dmg, kills: me.kills + k, points: me.points + k * 2, money: Math.max(0, me.money - 2_900) })
    if (i % 5 === 3) me.assists++
    if (died) Object.assign(me, { deaths: me.deaths + 1, health: 0 })
    await post(payload(map('live', i), 'live', me))
    // Mort : CS2 envoie le coéquipier regardé.
    if (died) await post(payload(map('live', i), 'live', { ...me, spectating: true, kills: 31 }))
    const mySide = me.side.toLowerCase()
    if (winner === mySide && k >= 2) me.mvps++
    score[winner]++
    wins[String(i + 1)] = `${winner}_win_${how}`
    await wait(ROUND_MS / 4)
    const last = i === SCRIPT.length - 1
    await post(payload(map(last ? 'gameover' : 'live', i + 1), 'over', me))
    await wait(ROUND_MS / 4)
  }
  await wait(3_000)
  // Retour au menu.
  await post(payload(null, '', me))
}

export function startCs2Sim(mode: string): void {
  void cs2SimEndpoint().then((ep) => {
    endpoint = ep
    if (!ep) return console.warn('[cs2-sim] pas de serveur local')
    ;(globalThis as { pxCs2Sim?: unknown }).pxCs2Sim = { post, running: simulateCs2Running, play }
    if (mode === 'manual') return
    setTimeout(async () => {
      simulateCs2Running(true)
      await play(mode === 'live' ? 17 : undefined)
      await wait(4_000)
      simulateCs2Running(false)
    }, 3_000)
  })
}
