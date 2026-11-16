// Counter-Strike 2 : stats à vie de Valve (Steam Web API, ISteamUserStats/GetUserStatsForGame, appid 730).
// Module pur, sans Electron ni React : lecture de la réponse, totaux, armes, cartes, relevés quotidiens et écarts.
// Partagé par le processus principal et l'interface, testé sous Node seul (npm run test:cs2stats).
//
// Les noms des champs viennent de CS:GO (total_kills, total_kills_ak47, total_wins_map_de_dust2…) : ils n'ont pas pu
// être vérifiés sur une vraie réponse de CS2. Tout est donc lu au cas par cas : un champ absent reste absent, un nom
// inconnu n'invente rien, et une arme inconnue garde son nom technique.
import type { Cs2Lifetime, Cs2LifetimePoint, Cs2LifetimeTotals, Cs2MapStat, Cs2WeaponStat } from './types'

// ---------- lecture de la réponse de Steam ----------

export type UserStatsRead =
  | { kind: 'ok'; values: Record<string, number> }
  /** Profil aux « Détails des jeux » privés. */
  | { kind: 'private' }
  /** Clé Web API refusée. */
  | { kind: 'key' }
  /** Aucune stat pour ce compte (jamais joué). */
  | { kind: 'none' }
  | { kind: 'error'; status: number }

/** Au-delà, la réponse n'est pas celle attendue (CS:GO en a quelques centaines). */
const MAX_FIELDS = 5000
const FIELD = /^[a-z0-9_]{1,100}$/i

/**
 * Réponse brute de GetUserStatsForGame (statut HTTP et texte) : `{ playerstats: { steamID, gameName, stats: [{ name, value }] } }`.
 * Steam répond 403 avec une page HTML qui parle de « key= » pour une clé refusée, et 403 (ou une erreur « not public »)
 * pour un profil privé.
 */
export function readUserStats(status: number, text: string): UserStatsRead {
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    /* page HTML (clé refusée, panne) */
  }
  const ps = (body as { playerstats?: { error?: unknown; stats?: unknown } } | null)?.playerstats
  const error = typeof ps?.error === 'string' ? ps.error : ''
  if (/not public/i.test(error)) return { kind: 'private' }
  if (/no stats/i.test(error)) return { kind: 'none' }
  if (status === 401 || ((status === 403 || status === 400) && /key=|api key|verify your key/i.test(text))) return { kind: 'key' }
  if (status === 403) return { kind: 'private' }
  if (status < 200 || status >= 300 || !ps) return { kind: 'error', status }
  if (!Array.isArray(ps.stats)) return { kind: 'none' }
  const values: Record<string, number> = {}
  let n = 0
  for (const s of ps.stats as unknown[]) {
    if (n >= MAX_FIELDS) break
    const name = (s as { name?: unknown } | null)?.name
    const raw = (s as { value?: unknown } | null)?.value
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN
    if (typeof name !== 'string' || !FIELD.test(name) || !Number.isFinite(value) || value < 0) continue
    values[name.toLowerCase()] = value
    n++
  }
  return n ? { kind: 'ok', values } : { kind: 'none' }
}

// ---------- totaux, armes, cartes ----------

/** Champ de nos totaux → nom du champ chez Valve. */
const TOTAL_FIELDS: Record<keyof Cs2LifetimeTotals, string> = {
  kills: 'total_kills',
  deaths: 'total_deaths',
  headshots: 'total_kills_headshot',
  timePlayed: 'total_time_played',
  plantedBombs: 'total_planted_bombs',
  defusedBombs: 'total_defused_bombs',
  roundsWon: 'total_wins',
  roundsPlayed: 'total_rounds_played',
  matchesWon: 'total_matches_won',
  matchesPlayed: 'total_matches_played',
  damage: 'total_damage_done',
  moneyEarned: 'total_money_earned',
  mvps: 'total_mvps'
}

export const TOTAL_KEYS = Object.keys(TOTAL_FIELDS) as (keyof Cs2LifetimeTotals)[]

/** `total_kills_*` qui ne sont pas des armes. */
const NOT_WEAPONS = new Set(['headshot', 'enemy_weapon', 'enemy_blinded', 'knife_fight', 'against_zoomed_sniper'])

export type WeaponKind = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'heavy' | 'gear' | 'other'

export const WEAPON_KIND_LABEL: Record<WeaponKind, string> = {
  pistol: 'Pistolets',
  smg: 'PM',
  rifle: 'Fusils',
  sniper: 'Précision',
  heavy: 'Lourdes',
  gear: 'Équipement',
  other: 'Autres'
}

/**
 * Armes connues : nom en clair et famille. Valve compte certaines armes ensemble (le compteur « m4a1 » vaut pour la
 * M4A4 et la M4A1-S) : le libellé le dit, sauf si la réponse a aussi un compteur à part pour la variante.
 */
const WEAPONS: Record<string, { label: string; kind: WeaponKind; shared?: string }> = {
  glock: { label: 'Glock-18', kind: 'pistol' },
  hkp2000: { label: 'P2000 / USP-S', kind: 'pistol', shared: 'usp_silencer' },
  usp_silencer: { label: 'USP-S', kind: 'pistol' },
  p250: { label: 'P250 / CZ75-Auto', kind: 'pistol', shared: 'cz75a' },
  cz75a: { label: 'CZ75-Auto', kind: 'pistol' },
  elite: { label: 'Dual Berettas', kind: 'pistol' },
  fiveseven: { label: 'Five-SeveN', kind: 'pistol' },
  tec9: { label: 'Tec-9', kind: 'pistol' },
  deagle: { label: 'Desert Eagle / R8', kind: 'pistol', shared: 'revolver' },
  revolver: { label: 'R8 Revolver', kind: 'pistol' },
  mac10: { label: 'MAC-10', kind: 'smg' },
  mp9: { label: 'MP9', kind: 'smg' },
  mp7: { label: 'MP7 / MP5-SD', kind: 'smg', shared: 'mp5sd' },
  mp5sd: { label: 'MP5-SD', kind: 'smg' },
  ump45: { label: 'UMP-45', kind: 'smg' },
  p90: { label: 'P90', kind: 'smg' },
  bizon: { label: 'PP-Bizon', kind: 'smg' },
  famas: { label: 'FAMAS', kind: 'rifle' },
  galilar: { label: 'Galil AR', kind: 'rifle' },
  ak47: { label: 'AK-47', kind: 'rifle' },
  m4a1: { label: 'M4A4 / M4A1-S', kind: 'rifle', shared: 'm4a1_silencer' },
  m4a1_silencer: { label: 'M4A1-S', kind: 'rifle' },
  aug: { label: 'AUG', kind: 'rifle' },
  sg556: { label: 'SG 553', kind: 'rifle' },
  ssg08: { label: 'SSG 08', kind: 'sniper' },
  awp: { label: 'AWP', kind: 'sniper' },
  scar20: { label: 'SCAR-20', kind: 'sniper' },
  g3sg1: { label: 'G3SG1', kind: 'sniper' },
  nova: { label: 'Nova', kind: 'heavy' },
  xm1014: { label: 'XM1014', kind: 'heavy' },
  mag7: { label: 'MAG-7', kind: 'heavy' },
  sawedoff: { label: 'Sawed-Off', kind: 'heavy' },
  negev: { label: 'Negev', kind: 'heavy' },
  m249: { label: 'M249', kind: 'heavy' },
  knife: { label: 'Couteau', kind: 'gear' },
  taser: { label: 'Zeus x27', kind: 'gear' },
  hegrenade: { label: 'Grenade HE', kind: 'gear' },
  molotov: { label: 'Molotov', kind: 'gear' },
  incgrenade: { label: 'Grenade incendiaire', kind: 'gear' },
  flashbang: { label: 'Grenade flash', kind: 'gear' },
  smokegrenade: { label: 'Fumigène', kind: 'gear' },
  decoy: { label: 'Leurre', kind: 'gear' },
  // Armes des anciens Counter-Strike, encore présentes dans certains comptes.
  tmp: { label: 'TMP', kind: 'smg' },
  mp5navy: { label: 'MP5', kind: 'smg' },
  p228: { label: 'P228', kind: 'pistol' },
  usp: { label: 'USP', kind: 'pistol' },
  scout: { label: 'Scout', kind: 'sniper' },
  sg550: { label: 'SG 550', kind: 'sniper' },
  sg552: { label: 'SG 552', kind: 'rifle' },
  galil: { label: 'Galil', kind: 'rifle' },
  m3: { label: 'M3', kind: 'heavy' }
}

/** Nom technique rendu lisible : « futuregun_mk2 » → « FUTUREGUN MK2 ». */
const technical = (id: string): string => id.replace(/_+/g, ' ').trim().toUpperCase() || id

/** Nom en clair d'une arme. `ids` : les armes de la même réponse (une variante comptée à part retire la double appellation). */
export function weaponLabel(id: string, ids?: ReadonlySet<string>): string {
  const w = WEAPONS[id]
  if (!w) return technical(id)
  if (w.shared && ids?.has(w.shared)) return w.label.split(' / ')[0]
  return w.label
}

export function weaponKind(id: string): WeaponKind {
  return WEAPONS[id]?.kind ?? 'other'
}

/** Les champs de Valve d'une réponse lue, rangés en totaux, armes et cartes. */
export function lifetimeOf(values: Record<string, number>): Cs2Lifetime {
  const totals: Cs2LifetimeTotals = {}
  for (const k of TOTAL_KEYS) {
    const v = values[TOTAL_FIELDS[k]]
    if (typeof v === 'number' && Number.isFinite(v)) totals[k] = v
  }

  const weapons: Cs2WeaponStat[] = []
  const maps = new Map<string, Cs2MapStat>()
  for (const [name, value] of Object.entries(values)) {
    const kill = /^total_kills_([a-z0-9_]+)$/.exec(name)
    if (kill) {
      const id = kill[1]
      if (NOT_WEAPONS.has(id) || /^(enemy|against)_/.test(id)) continue
      // Un nom inconnu n'est une arme que s'il a aussi des tirs ou des touches (sinon c'est un autre compteur).
      const known = id in WEAPONS || `total_shots_${id}` in values || `total_hits_${id}` in values
      if (known && value > 0) weapons.push({ id, kills: value })
      continue
    }
    const map = /^total_(wins|rounds)_map_([a-z0-9_]+)$/.exec(name)
    if (map) {
      const row = maps.get(map[2]) ?? { id: map[2] }
      if (map[1] === 'wins') row.roundsWon = value
      else row.rounds = value
      maps.set(map[2], row)
    }
  }
  weapons.sort((a, b) => b.kills - a.kills || a.id.localeCompare(b.id))
  const mapList = [...maps.values()]
    .filter((m) => (m.rounds ?? 0) > 0 || (m.roundsWon ?? 0) > 0)
    .sort((a, b) => (b.rounds ?? b.roundsWon ?? 0) - (a.rounds ?? a.roundsWon ?? 0) || a.id.localeCompare(b.id))
  return { totals, weapons, maps: mapList }
}

// ---------- chiffres calculés (null : pas de quoi les calculer) ----------

/** K/D : sans mort, le nombre d'éliminations (comme le tableau des scores). */
export function kdOf(t: Pick<Cs2LifetimeTotals, 'kills' | 'deaths'>): number | null {
  if (t.kills === undefined || t.deaths === undefined) return null
  return t.deaths > 0 ? t.kills / t.deaths : t.kills
}

/** Part des éliminations faites d'un tir à la tête, en %. */
export function headshotPct(t: Pick<Cs2LifetimeTotals, 'kills' | 'headshots'>): number | null {
  if (t.kills === undefined || t.headshots === undefined || t.kills <= 0 || t.headshots > t.kills) return null
  return (t.headshots / t.kills) * 100
}

/** Matchs gagnés sur matchs joués, en %. */
export function matchWinPct(t: Pick<Cs2LifetimeTotals, 'matchesWon' | 'matchesPlayed'>): number | null {
  if (t.matchesWon === undefined || t.matchesPlayed === undefined || t.matchesPlayed <= 0 || t.matchesWon > t.matchesPlayed) return null
  return (t.matchesWon / t.matchesPlayed) * 100
}

/** Rounds gagnés sur rounds joués d'une carte, en %. */
export function mapWinPct(m: Cs2MapStat): number | null {
  if (m.roundsWon === undefined || m.rounds === undefined || m.rounds <= 0 || m.roundsWon > m.rounds) return null
  return (m.roundsWon / m.rounds) * 100
}

export function hoursOf(t: Pick<Cs2LifetimeTotals, 'timePlayed'>): number | null {
  return t.timePlayed === undefined ? null : t.timePlayed / 3600
}

/**
 * Base de la « part du total » des armes : les éliminations à vie de Valve, ou la somme des armes si elle est plus
 * grande (certaines éliminations ne sont d'aucune arme listée : la part reste juste, jamais au-delà de 100 %).
 */
export function weaponBase(stats: Cs2Lifetime): number {
  const sum = stats.weapons.reduce((n, w) => n + w.kills, 0)
  return Math.max(sum, stats.totals.kills ?? 0)
}

// ---------- relevés quotidiens ----------

export const MAX_POINTS = 400
const DAY = 86_400_000

/** Jour local : le relevé du jour est remplacé par le plus récent. */
const dayOf = (t: number): string => new Date(t).toDateString()

export function pointOf(stats: Cs2Lifetime, at: number): Cs2LifetimePoint {
  return { at, ...stats.totals }
}

/** Ajoute un relevé : un seul par jour (le plus récent), du plus ancien au plus récent, 400 au plus. */
export function addPoint(history: Cs2LifetimePoint[], point: Cs2LifetimePoint, max = MAX_POINTS): Cs2LifetimePoint[] {
  const list = history.filter((p) => p && typeof p.at === 'number' && Number.isFinite(p.at) && dayOf(p.at) !== dayOf(point.at))
  list.push(point)
  list.sort((a, b) => a.at - b.at)
  return list.slice(-max)
}

/**
 * Relevés des `days` derniers jours. Le relevé juste avant la période sert de point de départ, s'il n'est pas trop
 * ancien (sinon « 7 jours » couvrirait des mois après une longue pause). Même règle que les relevés de Battlefield 6.
 */
export function inWindow(history: Cs2LifetimePoint[], days: number, now = Date.now()): Cs2LifetimePoint[] {
  const since = now - days * DAY
  const inRange = history.filter((p) => p.at >= since && p.at <= now)
  const before = history.filter((p) => p.at < since && p.at >= since - Math.max(2, days / 2) * DAY).at(-1)
  return before ? [before, ...inRange] : inRange
}

export type Cs2Delta = { [K in keyof Cs2LifetimeTotals]?: number } & {
  from: number
  to: number
  /** Jours entre le premier et le dernier relevé (arrondi). */
  days: number
  /** K/D sur la période seulement (null : aucune mort sur la période). */
  kd: number | null
}

/**
 * Ce que tu as fait entre le premier et le dernier relevé des `days` derniers jours. null : moins de deux relevés
 * (de deux jours différents). Un total qui recule (compte remis à zéro, réponse bancale) n'est pas compté.
 */
export function deltaOf(history: Cs2LifetimePoint[], days: number, now = Date.now()): Cs2Delta | null {
  const points = inWindow(history, days, now)
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last || points.length < 2 || dayOf(first.at) === dayOf(last.at)) return null
  const out: Cs2Delta = { from: first.at, to: last.at, days: Math.max(1, Math.round((last.at - first.at) / DAY)), kd: null }
  for (const k of TOTAL_KEYS) {
    const a = first[k]
    const b = last[k]
    if (typeof a === 'number' && typeof b === 'number' && b >= a) out[k] = b - a
  }
  if (out.kills !== undefined && out.deaths !== undefined && out.deaths > 0) out.kd = out.kills / out.deaths
  return out
}

/** Relevés lus depuis la base : seuls les relevés bien formés sont gardés. */
export function cleanHistory(v: unknown): Cs2LifetimePoint[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((p): p is Cs2LifetimePoint => !!p && typeof p === 'object' && typeof (p as Cs2LifetimePoint).at === 'number' && Number.isFinite((p as Cs2LifetimePoint).at))
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_POINTS)
}
