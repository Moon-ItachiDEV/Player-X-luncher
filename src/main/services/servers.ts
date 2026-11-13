// Serveurs : l'état de Counter-Strike 2 selon Valve (avec la clé Steam Web API de l'utilisateur) et les joueurs en jeu
// sur Steam pour n'importe quel jeu Steam (sans clé). Gardés 5 min ; l'interface ne les demande que quand elle les
// montre, fenêtre visible. Un échec ne montre rien (jamais de chiffres inventés ni d'ancienne lecture présentée comme actuelle).
import { net } from 'electron'
import { parseCs2Servers, parsePlayerCount } from '@shared/servers'
import type { Cs2Servers, Cs2ServersResult, SteamPlayers } from '@shared/types'
import { getSettings } from './settings'

const STATUS = 'https://api.steampowered.com/ICSGOServers_730/GetGameServersStatus/v1/'
const PLAYERS = 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/'
const MAX_AGE = 5 * 60_000
/** Après un échec, pas de nouvel essai avant 1 min (sauf `force`). */
const RETRY_MS = 60_000
const TIMEOUT_MS = 10_000
const PLAYERS_KEPT = 200

let cs2: { at: number; key: string; result: Cs2ServersResult } | null = null
let cs2Run: Promise<Cs2ServersResult> | null = null
const players = new Map<string, { at: number; value: SteamPlayers | null }>()
const playersRun = new Map<string, Promise<SteamPlayers | null>>()

/** Développement seulement (serversSim.ts) : chiffres d'exemple, marqués `sample`. */
let sim: { servers: () => Cs2Servers; players: (appId: string) => SteamPlayers | null } | null = null
export function simulateServers(s: NonNullable<typeof sim>): void {
  sim = s
}

async function fetchCs2(key: string): Promise<Cs2ServersResult> {
  let result: Cs2ServersResult
  try {
    const res = await net.fetch(`${STATUS}?key=${encodeURIComponent(key)}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status === 401 || res.status === 403) result = { ok: false, reason: 'key-refused' }
    else if (!res.ok) result = { ok: false, reason: 'offline' }
    else {
      const servers = parseCs2Servers(await res.json(), Date.now())
      result = servers ? { ok: true, servers } : { ok: false, reason: 'offline' }
    }
  } catch {
    result = { ok: false, reason: 'offline' }
  }
  cs2 = { at: Date.now(), key, result }
  return result
}

/** État des serveurs de CS2 : relu au plus toutes les 5 min (1 min après un échec), sauf `force`. */
export function getCs2Servers(force = false): Promise<Cs2ServersResult> {
  if (sim) return Promise.resolve({ ok: true, servers: sim.servers() })
  const key = getSettings().steamApiKey
  if (!key) return Promise.resolve({ ok: false, reason: 'no-key' })
  const c = cs2
  if (!force && c && c.key === key && Date.now() - c.at < (c.result.ok ? MAX_AGE : RETRY_MS)) return Promise.resolve(c.result)
  cs2Run ??= fetchCs2(key).finally(() => (cs2Run = null))
  return cs2Run
}

async function fetchPlayers(appId: string): Promise<SteamPlayers | null> {
  let value: SteamPlayers | null = null
  try {
    const res = await net.fetch(`${PLAYERS}?appid=${appId}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) {
      const n = parsePlayerCount(await res.json())
      if (n !== null) value = { count: n, at: Date.now() }
    }
  } catch {
    /* hors ligne : rien à montrer */
  }
  players.delete(appId)
  players.set(appId, { at: Date.now(), value })
  if (players.size > PLAYERS_KEPT) players.delete(players.keys().next().value as string)
  return value
}

/** Joueurs en jeu sur Steam pour cet appid, relus au plus toutes les 5 min (1 min après un échec). */
export function getSteamPlayers(appId: string): Promise<SteamPlayers | null> {
  if (!/^\d{1,10}$/.test(appId)) return Promise.resolve(null)
  if (sim) return Promise.resolve(sim.players(appId))
  const c = players.get(appId)
  if (c && Date.now() - c.at < (c.value ? MAX_AGE : RETRY_MS)) return Promise.resolve(c.value)
  let run = playersRun.get(appId)
  if (!run) {
    run = fetchPlayers(appId).finally(() => playersRun.delete(appId))
    playersRun.set(appId, run)
  }
  return run
}
