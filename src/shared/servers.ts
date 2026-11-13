// Serveurs : état des services de Counter-Strike 2 selon Valve, et joueurs en jeu sur Steam.
// Module pur, sans Electron : lecture des réponses (processus principal, services/servers.ts) et libellés (interface).
// Testé sous Node seul (npm run test:ready).
import type { Cs2Servers } from './types'

const text = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase().slice(0, 32) : '')
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined)

/**
 * Réponse de `ICSGOServers_730/GetGameServersStatus/v1` : `result.services` (SessionsLogon…), `result.matchmaking`
 * (scheduler, online_players, searching_players, search_seconds_avg) et `result.datacenters` (nom → capacity, load).
 * null si la réponse n'a pas cette forme.
 */
export function parseCs2Servers(raw: unknown, at: number): Cs2Servers | null {
  const r = (raw as { result?: Record<string, unknown> } | null)?.result
  if (!r || typeof r !== 'object') return null
  const services = (r.services ?? {}) as Record<string, unknown>
  const mm = (r.matchmaking ?? {}) as Record<string, unknown>
  const matchmaking = text(mm.scheduler)
  const logon = text(services.SessionsLogon)
  if (!matchmaking && !logon) return null
  const dcs = r.datacenters && typeof r.datacenters === 'object' ? (r.datacenters as Record<string, unknown>) : {}
  const europe = Object.entries(dcs)
    .filter(([name]) => /^EU\b|europe|spain|poland|netherlands|germany|france|sweden|finland|austria|united kingdom|stockholm|vienna|frankfurt|luxembourg|madrid|paris|warsaw|amsterdam|london|helsinki/i.test(name))
    .map(([name, v]) => ({ name: name.slice(0, 40), load: text((v as Record<string, unknown> | null)?.load) }))
    .filter((d) => d.load)
    .slice(0, 8)
  const searchSeconds = count(mm.search_seconds_avg)
  const searching = count(mm.searching_players)
  const online = count(mm.online_players)
  return {
    at,
    matchmaking: matchmaking || 'unknown',
    logon: logon || 'unknown',
    ...(searchSeconds !== undefined ? { searchSeconds } : {}),
    ...(searching !== undefined ? { searching } : {}),
    ...(online !== undefined ? { online } : {}),
    europe
  }
}

/** Réponse de `ISteamUserStats/GetNumberOfCurrentPlayers/v1` (`response.player_count`, `response.result` 1). */
export function parsePlayerCount(raw: unknown): number | null {
  const r = (raw as { response?: { player_count?: unknown; result?: unknown } } | null)?.response
  if (!r || (r.result !== undefined && r.result !== 1)) return null
  return count(r.player_count) ?? null
}

/** Ce que dit Valve, en français. */
const STATE_FR: Record<string, string> = {
  normal: 'normal',
  delayed: 'ralenti',
  surge: 'très demandé',
  offline: 'hors ligne',
  idle: 'au repos',
  critical: 'en difficulté'
}

export function stateFr(state: string): string {
  return STATE_FR[state] ?? state
}

/** Le matchmaking et la connexion marchent (ce que Valve appelle `normal`). */
export function serversOk(s: Cs2Servers): boolean {
  return s.matchmaking === 'normal' && (s.logon === 'normal' || s.logon === 'unknown')
}

/** « ~45 s », « ~2 min », « ~12 min » : temps d'attente moyen arrondi. */
export function waitLabel(seconds: number): string {
  if (seconds < 90) return `~${Math.max(5, Math.round(seconds / 5) * 5)} s`
  return `~${Math.round(seconds / 60)} min`
}

/**
 * Pastille courte : « Matchmaking OK · ~2 min d'attente », « Matchmaking ralenti », « Connexion à Steam hors ligne ».
 * La connexion passe avant le matchmaking : sans elle, rien ne marche.
 */
export function serversLabel(s: Cs2Servers): string {
  if (s.logon !== 'normal' && s.logon !== 'unknown') return `Connexion à Steam ${stateFr(s.logon)}`
  if (s.matchmaking !== 'normal') return `Matchmaking ${stateFr(s.matchmaking)}`
  return s.searchSeconds ? `Matchmaking OK · ${waitLabel(s.searchSeconds)} d'attente` : 'Matchmaking OK'
}

const LOAD_FR: Record<string, string> = { idle: 'au repos', low: 'faible', medium: 'moyenne', high: 'forte', full: 'pleine' }

/** Charge d'un datacenter, en français. */
export function loadFr(load: string): string {
  return LOAD_FR[load] ?? load
}

const playersFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

/** « 312 000 », « 1,2 M » (au-delà d'un million). */
export function formatPlayers(n: number): string {
  if (n >= 1_000_000) return `${String(Math.round(n / 100_000) / 10).replace('.', ',')} M`
  return playersFmt.format(n)
}
