// Types partagés : serveurs et joueurs en jeu.

// ---------- Serveurs ----------

/**
 * État des services de Counter-Strike 2 selon Valve (`ICSGOServers_730/GetGameServersStatus`). Les états sont ceux
 * de Valve, en anglais : `normal`, `delayed`, `surge`, `offline`… (traduits par l'interface).
 */
export interface Cs2Servers {
  /** Moment du relevé (ms). */
  at: number
  /** Le matchmaking (`matchmaking.scheduler`). */
  matchmaking: string
  /** La connexion aux serveurs de Steam (`services.SessionsLogon`). */
  logon: string
  /** Temps moyen de recherche d'une partie, en secondes. */
  searchSeconds?: number
  /** Joueurs en recherche d'une partie. */
  searching?: number
  /** Joueurs en ligne sur CS2. */
  online?: number
  /** Datacenters européens : nom (« EU West »…), charge (`low`, `medium`, `high`, `full`, `idle`). */
  europe: { name: string; load: string }[]
  /** Chiffres d'exemple (simulateur de développement) : toujours présentés comme tels. */
  sample?: boolean
}

export type Cs2ServersResult = { ok: true; servers: Cs2Servers } | { ok: false; reason: 'no-key' | 'key-refused' | 'offline' }

/** Joueurs en jeu sur Steam en ce moment (`ISteamUserStats/GetNumberOfCurrentPlayers`) ; null si Steam ne répond pas. */
export interface SteamPlayers {
  count: number
  at: number
  sample?: boolean
}
