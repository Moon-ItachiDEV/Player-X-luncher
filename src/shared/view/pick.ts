// Choix de l'accueil : jeu à la une, liste « À reprendre », ordre du carrousel, succès et dernier match montrés.
// Module pur, sans React : testé sous Node seul (npm run test:home).
import { cleanName } from '../text'
import type { AchievementGame, AchievementsOverview, Bf6Recap, Bf6RecapState, Cs2Recap, Cs2State, Game, Store } from '../types'

const collator = new Intl.Collator('fr', {
  sensitivity: 'base',
  numeric: true
})
export const byName = (a: Game, b: Game): number => collator.compare(cleanName(a.name), cleanName(b.name))
/** Jeux en cours d'abord, puis la dernière partie la plus récente. */
export const byRecent = (a: Game, b: Game): number => Number(!!b.running) - Number(!!a.running) || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
const hasArt = (g: Game): boolean => !!(g.heroUrl || g.coverUrl)

/** Jeu à la une : celui qui tourne, sinon la dernière partie, sinon un favori (puis un jeu) avec une image. */
export function pickHero(games: Game[]): Game | null {
  // Plusieurs jeux en cours : le dernier démarré.
  let running: Game | null = null
  for (const g of games) if (g.running && (!running || (g.runningSince ?? 0) > (running.runningSince ?? 0))) running = g
  if (running) return running
  let recent: Game | null = null
  for (const g of games) if (g.lastPlayed && (!recent || g.lastPlayed > (recent.lastPlayed ?? 0))) recent = g
  return recent ?? games.find((g) => g.favorite && hasArt(g)) ?? games.find(hasArt) ?? games[0] ?? null
}

/** Lignes de « À reprendre », à droite du jeu à la une. */
export const RESUME_MAX = 4

/**
 * « À reprendre » : les dernières parties (le jeu à la une compris) ; sans historique, les favoris puis les jeux qui ont
 * une image. Le jeu à la une y est toujours : c'est la ligne surlignée.
 */
export function resumeList(games: Game[], hero: Game | null): { list: Game[]; resumed: boolean } {
  const played = games.filter((g) => g.lastPlayed || g.running).sort(byRecent)
  const resumed = played.length > 0
  let list = resumed ? played : [...games.filter((g) => g.favorite).sort(byName), ...games.filter((g) => !g.favorite && hasArt(g)).sort(byName)]
  list = list.slice(0, RESUME_MAX)
  if (hero && !list.some((g) => g.id === hero.id)) list = [hero, ...list.slice(0, RESUME_MAX - 1)]
  return { list, resumed }
}

/** Jeux du carrousel « Ta bibliothèque ». */
export const SHELF_MAX = 24

/** Carrousel : en cours et dernières parties d'abord, puis les favoris, puis les autres par nom. */
export function shelfList(games: Game[], store: Store | 'all'): Game[] {
  const pool = store === 'all' ? games : games.filter((g) => g.store === store)
  const played = pool.filter((g) => g.lastPlayed || g.running).sort(byRecent)
  const rest = pool.filter((g) => !g.lastPlayed && !g.running)
  const favs = rest.filter((g) => g.favorite).sort(byName)
  const others = rest.filter((g) => !g.favorite).sort(byName)
  return [...played, ...favs, ...others].slice(0, SHELF_MAX)
}

const STORE_ORDER: Store[] = ['steam', 'epic', 'ea', 'gog']

/** Stores présents dans la bibliothèque, dans l'ordre Steam, Epic, EA. */
export function storesOf(games: Game[]): Store[] {
  const seen = new Set(games.map((g) => g.store))
  return STORE_ORDER.filter((s) => seen.has(s))
}

/** Barres « Tes succès ». */
export const ACH_MAX = 3

/** Succès d'un jeu dans le relevé (seulement Steam), ou null. */
export function achievementsOf(o: AchievementsOverview | null, gameId: string): AchievementGame | null {
  if (!o || (o.state !== 'ready' && o.state !== 'scanning')) return null
  return o.games.find((g) => g.gameId === gameId && g.total > 0) ?? null
}

export type LastMatch = { kind: 'cs2'; recap: Cs2Recap } | { kind: 'bf6'; recap: Bf6Recap }

/**
 * « Dernier match » : le bilan le plus récent, Counter-Strike 2 ou Battlefield 6, seulement un vrai (jamais un
 * exemple) et seulement si son réglage est activé. null : rien à montrer, l'encart est masqué.
 */
export function latestMatch(cs2: Pick<Cs2State, 'enabled' | 'recaps'> | null, bf6: Pick<Bf6RecapState, 'enabled' | 'recaps'> | null): LastMatch | null {
  const c = cs2?.enabled ? cs2.recaps.find((r) => !r.sample) : undefined
  const b = bf6?.enabled ? bf6.recaps.find((r) => !r.sample) : undefined
  if (c && (!b || c.endedAt >= b.endedAt)) return { kind: 'cs2', recap: c }
  if (b) return { kind: 'bf6', recap: b }
  return null
}
