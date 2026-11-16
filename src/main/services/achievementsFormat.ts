// Lecture des réponses Steam sur les succès, et résumés pour la page Trophées.
// Module pur, sans import d'Electron : testé sous Node seul (npm run test:achievements).
import type { Achievement, AchievementGame, AchievementPick, AchievementsOverview } from '@shared/types'

/** Un succès tel que le joueur le voit (GetPlayerAchievements). */
export interface PlayerAch {
  id: string
  achieved: boolean
  /** Secondes ; 0 : date inconnue (très vieux déblocages). */
  unlocktime: number
  name?: string
  description?: string
}

/** Un succès tel que le jeu le décrit (GetSchemaForGame). */
export interface SchemaAch {
  id: string
  name: string
  description?: string
  hidden: boolean
  icon?: string
  iconGray?: string
}

export type PlayerResult =
  | { kind: 'ok'; list: PlayerAch[] }
  /** Détails des jeux privés sur le profil Steam. */
  | { kind: 'private' }
  /** Le jeu n'a pas de succès. */
  | { kind: 'none' }
  /** Clé Web API refusée. */
  | { kind: 'key' }
  | { kind: 'error' }

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const httpsUrl = (v: unknown): string | undefined => {
  const s = str(v, 500)
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : undefined
}

/**
 * Réponse de ISteamUserStats/GetPlayerAchievements. Steam répond 403 « Profile is not public » pour un profil privé,
 * 400 « Requested app has no stats » pour un jeu sans succès, et 403 sans JSON pour une clé refusée.
 */
export function parsePlayer(status: number, body: unknown): PlayerResult {
  const ps = (body as { playerstats?: { success?: unknown; error?: unknown; achievements?: unknown } } | null)?.playerstats
  const error = str(ps?.error)
  if (/not public/i.test(error)) return { kind: 'private' }
  if (/no stats/i.test(error)) return { kind: 'none' }
  if (!ps) return status === 401 || status === 403 ? { kind: 'key' } : { kind: 'error' }
  if (status < 200 || status >= 300 || ps.success === false) return { kind: 'error' }
  if (!Array.isArray(ps.achievements)) return { kind: 'none' }
  const list: PlayerAch[] = []
  for (const a of ps.achievements as Record<string, unknown>[]) {
    const id = str(a?.apiname, 200)
    if (!id) continue
    const t = typeof a.unlocktime === 'number' && Number.isFinite(a.unlocktime) && a.unlocktime > 0 ? Math.round(a.unlocktime) : 0
    const name = str(a.name, 200)
    const description = str(a.description)
    list.push({ id, achieved: a.achieved === 1 || a.achieved === true, unlocktime: t, ...(name ? { name } : {}), ...(description ? { description } : {}) })
  }
  return list.length ? { kind: 'ok', list } : { kind: 'none' }
}

/** Réponse de ISteamUserStats/GetSchemaForGame : noms, descriptions, icônes, succès cachés. */
export function parseSchema(body: unknown): SchemaAch[] {
  const list = (body as { game?: { availableGameStats?: { achievements?: unknown } } } | null)?.game?.availableGameStats?.achievements
  if (!Array.isArray(list)) return []
  const out: SchemaAch[] = []
  for (const a of list as Record<string, unknown>[]) {
    const id = str(a?.name, 200)
    if (!id) continue
    const description = str(a.description)
    const icon = httpsUrl(a.icon)
    const iconGray = httpsUrl(a.icongray)
    out.push({
      id,
      name: str(a.displayName, 200) || id,
      hidden: a.hidden === 1 || a.hidden === true,
      ...(description ? { description } : {}),
      ...(icon ? { icon } : {}),
      ...(iconGray ? { iconGray } : {})
    })
  }
  return out
}

/** Réponse de GetGlobalAchievementPercentagesForApp v2 : succès → % des joueurs (Steam l'envoie en nombre ou en texte). */
export function parseGlobal(body: unknown): Record<string, number> {
  const list = (body as { achievementpercentages?: { achievements?: unknown } } | null)?.achievementpercentages?.achievements
  const out: Record<string, number> = {}
  if (!Array.isArray(list)) return out
  for (const a of list as Record<string, unknown>[]) {
    const id = str(a?.name, 200)
    const p = typeof a?.percent === 'number' ? a.percent : typeof a?.percent === 'string' ? parseFloat(a.percent) : NaN
    if (id && Number.isFinite(p)) out[id] = Math.min(100, Math.max(0, p))
  }
  return out
}

/** Réponse de IPlayerService/GetBadges : niveau Steam et badges. */
export function parseBadges(body: unknown): AchievementsOverview['level'] | undefined {
  const r = (body as { response?: Record<string, unknown> } | null)?.response
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
  if (!r || typeof r.player_level !== 'number') return undefined
  const xp = n(r.player_xp)
  const start = n(r.player_xp_needed_current_level)
  const toNext = n(r.player_xp_needed_to_level_up)
  return {
    level: n(r.player_level),
    badges: Array.isArray(r.badges) ? r.badges.length : 0,
    xp,
    xpInLevel: Math.max(0, xp - start),
    xpForLevel: Math.max(0, xp - start) + toNext
  }
}

/**
 * La liste du joueur, dans l'ordre du jeu, avec icônes et rareté. Sans schéma (Steam indisponible), on garde
 * les noms donnés avec la liste du joueur. Un succès du schéma absent chez le joueur compte comme pas débloqué.
 */
export function mergeAchievements(player: PlayerAch[], schema: SchemaAch[], global: Record<string, number>): Achievement[] {
  const mine = new Map(player.map((a) => [a.id, a]))
  const base: SchemaAch[] = schema.length
    ? schema
    : player.map((a) => ({ id: a.id, name: a.name || a.id, hidden: false, ...(a.description ? { description: a.description } : {}) }))
  return base.map((s) => {
    const p = mine.get(s.id)
    const description = s.description || p?.description
    const percent = global[s.id]
    return {
      id: s.id,
      name: s.name,
      hidden: s.hidden,
      ...(description ? { description } : {}),
      ...(s.icon ? { icon: s.icon } : {}),
      ...(s.iconGray ? { iconGray: s.iconGray } : {}),
      ...(p?.achieved ? { unlockedAt: p.unlocktime * 1000 } : {}),
      ...(percent !== undefined ? { percent } : {})
    }
  })
}

export const isUnlocked = (a: Achievement): boolean => a.unlockedAt !== undefined

/** Rare : moins de 15 % des joueurs (même seuil que l'étiquette « Rare » de l'interface). */
export const RARE_PERCENT = 15

/** Succès rares débloqués après `since` (date du relevé précédent), les plus rares d'abord. */
export function freshRare(list: Achievement[], since: number): Achievement[] {
  return list
    .filter((a) => a.unlockedAt !== undefined && a.unlockedAt > since && a.percent !== undefined && a.percent < RARE_PERCENT)
    .sort((a, b) => a.percent! - b.percent!)
}

/** Ce que la page Trophées garde d'un jeu. */
export interface GameSummary {
  /** Date du relevé. */
  at: number
  /** Temps de jeu Steam au moment du relevé : s'il a bougé, le jeu est relu. */
  minutes: number
  name: string
  total: number
  unlocked: number
  lastAt?: number
  /** Quelques succès débloqués : les plus récents et les plus rares. */
  picks: Achievement[]
}

const PICKS = 4

const byRecent = (a: Achievement, b: Achievement): number => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0)
const byRarity = (a: Achievement, b: Achievement): number => (a.percent ?? 101) - (b.percent ?? 101) || byRecent(a, b)

export function summarize(list: Achievement[], name: string, minutes: number, at: number): GameSummary {
  const done = list.filter(isUnlocked)
  const recent = [...done].sort(byRecent).slice(0, PICKS)
  const rare = [...done]
    .filter((a) => a.percent !== undefined)
    .sort(byRarity)
    .slice(0, PICKS)
  const picks = [...new Map([...recent, ...rare].map((a) => [a.id, a])).values()]
  const lastAt = recent[0]?.unlockedAt
  return { at, minutes, name, total: list.length, unlocked: done.length, ...(lastAt ? { lastAt } : {}), picks }
}

const LIST_MAX = 12

/** Totaux de la page Trophées, à partir des résumés par jeu (appid → résumé). */
export function buildOverview(
  games: Record<string, GameSummary>,
  extra: Pick<AchievementsOverview, 'state' | 'progress' | 'level' | 'updatedAt'>
): AchievementsOverview {
  const withAch = Object.entries(games).filter(([, g]) => g.total > 0)
  const list: AchievementGame[] = withAch.map(([appId, g]) => ({
    gameId: `steam:${appId}`,
    name: g.name,
    unlocked: g.unlocked,
    total: g.total,
    ...(g.lastAt ? { lastAt: g.lastAt } : {})
  }))
  const picks: AchievementPick[] = withAch.flatMap(([appId, g]) =>
    g.picks.filter(isUnlocked).map((a) => ({ ...a, unlockedAt: a.unlockedAt ?? 0, gameId: `steam:${appId}`, gameName: g.name }))
  )
  const started = list.filter((g) => g.unlocked > 0)
  return {
    ...extra,
    games: list,
    recent: picks
      .filter((a) => a.unlockedAt > 0)
      .sort(byRecent)
      .slice(0, LIST_MAX),
    rarest: picks
      .filter((a) => a.percent !== undefined)
      .sort(byRarity)
      .slice(0, LIST_MAX),
    unlocked: list.reduce((n, g) => n + g.unlocked, 0),
    total: list.reduce((n, g) => n + g.total, 0),
    perfect: list.filter((g) => g.unlocked === g.total).length,
    average: started.length ? Math.round((started.reduce((n, g) => n + g.unlocked / g.total, 0) / started.length) * 100) : 0
  }
}
