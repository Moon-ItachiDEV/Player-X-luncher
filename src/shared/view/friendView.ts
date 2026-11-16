// Fonctions pures de la page Amis (testées par npm run test:friends) : classement, sélection par défaut, dates en français.
import { cleanName, norm, timeAgo } from '../text'
import type { Friend, FriendStatus, Game } from '../types'

/** Ami (ou membre Discord) classé pour l'affichage. */
export interface Entry {
  friend: Friend
  status: FriendStatus
  /** Jeu de la bibliothèque (ou nommé par Steam / PSN) quand il est en jeu. */
  game?: string
  /** Le jeu, s'il est dans la bibliothèque : son image et sa fiche. */
  lib?: Game
  /** Activité Discord qui ne correspond à aucun jeu de la bibliothèque. */
  activity?: string
}

const STATUS_RANK: Record<FriendStatus, number> = {
  'in-game': 0,
  online: 1,
  away: 2,
  offline: 3
}

export function libraryIndex(games: Game[]): Map<string, Game> {
  const map = new Map<string, Game>()
  for (const g of games) {
    const k = norm(g.name)
    if (k && !map.has(k)) map.set(k, g)
  }
  return map
}

/** Un membre Discord n'est « en jeu » que si son activité est un jeu de la bibliothèque (sinon Spotify, statut perso…). */
export function classify(friend: Friend, library: Map<string, Game>): Entry {
  if (friend.status !== 'in-game') return { friend, status: friend.status }
  if (!friend.game) return { friend, status: 'online' }
  const lib = library.get(norm(friend.game))
  if (friend.platform === 'discord' && !lib) return { friend, status: 'online', activity: friend.game }
  return {
    friend,
    status: 'in-game',
    game: cleanName(lib?.name ?? friend.game) || friend.game,
    lib
  }
}

/** Amis (Steam, PlayStation) vraiment en jeu, selon la même règle que la page Amis : la pastille du rail dit le même chiffre. */
export function countInGame(friends: Friend[], games: Game[]): number {
  const library = libraryIndex(games)
  return friends.filter((f) => f.platform !== 'discord' && classify(f, library).status === 'in-game').length
}

/** En jeu d'abord (regroupés par jeu), puis en ligne, absents, hors ligne ; par nom ensuite. */
export function byStatus(a: Entry, b: Entry): number {
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    (a.game ?? '').localeCompare(b.game ?? '', 'fr', { sensitivity: 'base' }) ||
    a.friend.name.localeCompare(b.friend.name, 'fr', { sensitivity: 'base' })
  )
}

/** Choix par défaut : le premier en jeu, sinon le premier en ligne, sinon le premier de la liste. */
export function pickDefault(entries: Entry[]): Entry | undefined {
  return entries.find((e) => e.status === 'in-game') ?? entries.find((e) => e.status === 'online') ?? entries[0]
}

const monthYear = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })
const dayMonthYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** « Ami depuis septembre 2025 » ; vide sans date. */
export function friendSinceLabel(since: number | undefined): string {
  return since ? `Ami depuis ${monthYear.format(since)}` : ''
}

/** « Vu pour la dernière fois il y a 3 h », puis « … le 12 mars 2025 » au-delà d'un mois ; vide sans date. */
export function lastSeenLabel(at: number | undefined, now = Date.now()): string {
  if (!at) return ''
  const label = now - at < 30 * 86_400_000 ? timeAgo(at, now) : `le ${dayMonthYear.format(at)}`
  return `Vu pour la dernière fois ${label}`
}

/** Profil Steam d'un ami, seulement avec un vrai SteamID64 (17 chiffres) : jamais en démo. */
export function steamProfileUrl(friend: Friend): string | undefined {
  if (friend.platform !== 'steam') return undefined
  const id = friend.id.slice('steam:'.length)
  return /^\d{17}$/.test(id) ? `https://steamcommunity.com/profiles/${id}` : undefined
}
