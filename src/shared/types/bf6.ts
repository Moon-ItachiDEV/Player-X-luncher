// Types partagés : Battlefield 6 (stats, suivi, bilans de session).

// ---------- Statistiques Battlefield 6 (gametools.network, non officiel) ----------

/** Plateforme d'un compte Battlefield, telle que l'attend gametools.network. */
export type Bf6Platform = 'ea' | 'pc' | 'steam' | 'psn' | 'xbox'

/** Un compte Battlefield 6 (le même pseudo peut exister sur plusieurs plateformes). */
export interface Bf6Account {
  name: string
  platform: Bf6Platform
  personaId?: string
  nucleusId?: string
}

/** Résultat d'une recherche de pseudo : le compte et ses éliminations quand elles ont pu être lues. */
export interface Bf6Match extends Bf6Account {
  kills: number | null
}

/** Une ligne de détail (arme, véhicule, classe, mode, carte). Les champs absents ne sont pas fournis par l'API. */
export interface Bf6Row {
  id: string
  name: string
  image?: string
  kills?: number
  deaths?: number
  killDeath?: number
  kpm?: number
  accuracy?: number
  headshots?: number
  matches?: number
  wins?: number
  winPercent?: number
  secondsPlayed?: number
}

export interface Bf6Stats {
  account: Bf6Account
  avatarUrl?: string
  kills: number
  deaths: number
  killDeath: number
  killsPerMinute: number
  wins: number
  losses: number
  /** En %, 0 à 100. */
  winPercent: number
  accuracy: number
  headshots: number
  assists: number
  revives: number
  matches: number
  secondsPlayed: number
  bestClass?: string
  weapons: Bf6Row[]
  vehicles: Bf6Row[]
  classes: Bf6Row[]
  modes: Bf6Row[]
  maps: Bf6Row[]
}

export interface Bf6Snapshot {
  stats: Bf6Stats
  fetchedAt: number
  /** Données gardées d'une lecture précédente (le service n'a pas répondu). */
  stale?: string
}

/** Visuels du jeu (catalogue Steam), chargés à l'exécution : rien n'est livré avec l'appli. */
export interface Bf6Art {
  heroUrl?: string
  coverUrl?: string
  logoUrl?: string
}

/** Relevé quotidien des totaux d'un compte, pour la courbe de progression (gardé sur ce PC). */
export interface Bf6Point {
  at: number
  kills: number
  deaths: number
  wins: number
  losses: number
  matches: number
  secondsPlayed: number
  killsPerMinute: number
  accuracy: number
}

/** Ton compte et les joueurs que tu suis pour le classement. */
export interface Bf6Tracked {
  me: Bf6Account | null
  rivals: Bf6Account[]
}

/** Une carte ou un mode joué pendant une session. */
export interface Bf6RecapPlace {
  name: string
  image?: string
  matches: number
  wins: number
}

/**
 * Bilan d'une session de Battlefield 6. gametools.network ne donne que des totaux : c'est la différence entre
 * tes stats relevées au lancement du jeu et celles relues après la partie. Gardé sur ce PC.
 */
export interface Bf6Recap {
  id: string
  account: { name: string; platform: Bf6Platform }
  /** Lancement et fermeture du jeu, vus par Player X. */
  startedAt: number
  endedAt: number
  /** Le jeu tournait déjà quand le suivi a commencé (ouverture de Player X) : seules les parties d'après comptent. */
  partial?: boolean
  kills: number
  deaths: number
  assists: number
  revives: number
  matches: number
  wins: number
  losses: number
  /** Temps passé en partie (hors menus), selon les stats du jeu. */
  secondsPlayed: number
  killDeath: number
  killsPerMinute: number
  /** Éliminations en véhicule (comprises dans `kills`). */
  vehicleKills: number
  /** Tes moyennes juste avant la session, pour la situer. */
  average: { killDeath: number; killsPerMinute: number; winPercent: number }
  /** L'arme avec le plus d'éliminations pendant la session. */
  weapon?: { name: string; image?: string; kills: number }
  /** La classe la plus jouée. */
  role?: { name: string; kills: number; seconds: number }
  /** Les plus jouées d'abord. */
  maps: Bf6RecapPlace[]
  modes: Bf6RecapPlace[]
  /** Déjà ouvert dans Player X. */
  seen?: boolean
  /** Exemple (Paramètres, Stats) : chiffres fictifs, jamais enregistrés. */
  sample?: boolean
}

export interface Bf6RecapState {
  /** Réglage « Bilan Battlefield 6 ». */
  enabled: boolean
  /** Session suivie : jeu en cours (sans `endedAt`), ou terminé et bilan pas encore prêt. */
  pending: { startedAt: number; endedAt?: number } | null
  /** Les plus récents d'abord. Vide en mode démo. */
  recaps: Bf6Recap[]
}

/** `ready` : bilan prêt, Player X au premier plan ; `open` : clic sur la notification Windows ; `updated` : chiffres complétés. */
export interface Bf6RecapEvent {
  recap: Bf6Recap
  reason: 'ready' | 'open' | 'updated'
}
