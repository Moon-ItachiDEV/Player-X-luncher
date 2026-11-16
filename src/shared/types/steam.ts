// Types partagés : Steam (jeux du compte, succès, Prêt à jouer, événements des jeux).
import type { Game } from './core'

// ---------- Jeux du compte Steam (installés ou non) ----------

/**
 * Pourquoi la liste des jeux Steam manque, ou `ready`.
 * `private` : les « détails des jeux » du profil Steam ne sont pas publics ; `key-refused` : clé Web API refusée par Steam.
 */
export type SteamLibraryState = 'ready' | 'loading' | 'no-account' | 'no-key' | 'key-refused' | 'private' | 'offline'

export interface SteamLibrary {
  state: SteamLibraryState
  /** Jeux du compte Steam qui ne sont pas installés sur ce PC, avec le temps de jeu et la dernière partie selon Steam. */
  notInstalled: Game[]
  /** Nombre de jeux du compte, installés ou non (0 tant que la liste manque). */
  owned: number
}

// ---------- Succès Steam ----------

export interface Achievement {
  /** Nom technique chez Steam (apiname), unique dans le jeu. */
  id: string
  name: string
  /** Absente pour certains succès cachés : Steam ne la donne qu'une fois le succès débloqué. */
  description?: string
  hidden: boolean
  /** Icône en couleur (débloqué) et en gris (pas encore). */
  icon?: string
  iconGray?: string
  /** Date du déblocage ; absente tant que le succès n'est pas débloqué. */
  unlockedAt?: number
  /** Part des joueurs Steam du jeu qui l'ont débloqué (0 à 100). */
  percent?: number
}

/**
 * Pourquoi un jeu n'a pas de liste de succès, ou `ready`.
 * `not-steam` : jeu Epic ou EA (pas d'API publique) ; `none` : le jeu n'a pas de succès ;
 * `private` : les « détails des jeux » du profil Steam ne sont pas publics ; `key-refused` : clé Web API refusée.
 */
export type AchievementsState = 'ready' | 'not-steam' | 'none' | 'no-account' | 'no-key' | 'key-refused' | 'private'

export interface GameAchievements {
  state: AchievementsState
  /** Dans l'ordre du jeu. */
  list: Achievement[]
  unlocked: number
  total: number
}

/** Un succès débloqué, avec son jeu (page Trophées). */
export interface AchievementPick extends Achievement {
  gameId: string
  gameName: string
  unlockedAt: number
}

/** Où en est un jeu (page Trophées). */
export interface AchievementGame {
  gameId: string
  name: string
  unlocked: number
  total: number
  /** Dernier déblocage. */
  lastAt?: number
}

export type AchievementsOverviewState = 'ready' | 'scanning' | 'no-account' | 'no-key' | 'key-refused' | 'private' | 'offline'

export interface AchievementsOverview {
  state: AchievementsOverviewState
  /** Pendant le premier relevé : jeux lus sur combien. */
  progress?: { done: number; total: number }
  /** Jeux qui ont des succès, débloqués ou non. */
  games: AchievementGame[]
  /** Derniers succès débloqués, tous jeux confondus (les plus récents d'abord). */
  recent: AchievementPick[]
  /** Succès débloqués les plus rares (les plus rares d'abord). */
  rarest: AchievementPick[]
  unlocked: number
  total: number
  /** Jeux terminés à 100 %. */
  perfect: number
  /** Moyenne de complétion des jeux commencés (au moins un succès), comme sur le profil Steam. */
  average: number
  /** Niveau Steam et badges (absent si Steam ne les donne pas). */
  level?: { level: number; badges: number; xp: number; xpInLevel: number; xpForLevel: number }
  /** Date du dernier relevé complet (0 : jamais). */
  updatedAt: number
}

// ---------- Prêt à jouer (mises à jour Steam) ----------

/**
 * Où en est Steam avec un jeu, d'après son manifeste local (`appmanifest_<appid>.acf`).
 * `queued` : une mise à jour attend ; `downloading` ; `paused` ; `installing` : Steam pose les fichiers téléchargés ;
 * `verifying` : vérification des fichiers.
 */
export type SteamUpdateKind = 'queued' | 'downloading' | 'paused' | 'installing' | 'verifying'

export interface SteamUpdate {
  kind: SteamUpdateKind
  /** Octets de l'étape en cours (téléchargement ou installation), quand Steam les connaît. */
  total?: number
  /** Octets déjà traités dans cette étape. */
  done?: number
  /** Premier téléchargement du jeu (pas encore entièrement installé), pas une mise à jour. */
  firstInstall?: boolean
}

/** appid Steam → état ; seulement les jeux qui attendent ou reçoivent quelque chose. Un jeu prêt n'y figure pas. */
export type SteamUpdates = Record<string, SteamUpdate>

/** Steam vient de finir la mise à jour (ou l'installation) d'un jeu. */
export interface GameReady {
  gameId: string
  name: string
  firstInstall: boolean
}

// ---------- Événements des jeux (liste d'événements de la page Steam du jeu) ----------

/**
 * Un événement daté publié par l'éditeur sur Steam : saison, bonus d'XP, défi, bêta, essai gratuit, diffusion…
 * `type` : le type d'événement de Steam (EProtoClanEventType : 22 bonus d'XP, 32 nouvelle saison…).
 */
export interface GameEvent {
  /** Identifiant de l'événement sur Steam (gid). */
  id: string
  title: string
  type: number
  /** Début (ms). */
  start: number
  /** Fin (ms), quand l'éditeur en donne une. */
  end?: number
  /** Page de l'événement sur Steam (https). */
  url: string
}

export interface GameEvents {
  /** Appid Steam du jeu ; null si le jeu n'a pas de page Steam. */
  appId: string | null
  /** En cours puis à venir, du plus proche au plus lointain. */
  events: GameEvent[]
  /** Événements pour lesquels « Me prévenir » est demandé. */
  reminders: string[]
}

/** Un événement suivi avec « Me prévenir » commence. */
export interface GameEventStarted {
  gameId: string
  gameName: string
  eventId: string
  title: string
  url: string
}
