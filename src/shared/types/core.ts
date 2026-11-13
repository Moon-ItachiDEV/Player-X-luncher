// Types partagés : bibliothèque, lancements, amis, comptes, réglages.

export type Store = 'steam' | 'epic' | 'ea' | 'gog'

/** D'où vient la dernière partie d'un jeu. */
export type PlayedSource = 'launch' | 'session' | 'steam'

export interface Game {
  id: string // `${store}:${storeId}`
  store: Store
  storeId: string
  name: string
  installDir?: string
  /** Exécutable de secours quand le store ne fournit pas d'identifiant de lancement. */
  exePath?: string
  /** Bêta 43 (GOG) : arguments et dossier de travail de l'exécutable, tels que le jeu les déclare. */
  launchArgs?: string[]
  workDir?: string
  coverUrl?: string
  heroUrl?: string
  /** Logo du jeu (catalogue Steam), affiché à la place du titre sur le visuel de la fiche ; le titre revient s'il ne charge pas. */
  logoUrl?: string
  /** Tags Steam du jeu (noms anglais, les plus votés d'abord) : le style des boutons de l'accueil s'en sert. Pas gardés dans la table des jeux. */
  tags?: string[]
  /** Dernière partie : la plus récente entre le dernier lancement depuis Player X, la dernière fois où Player X l'a vu tourner, et Steam. */
  lastPlayed?: number
  /** D'où vient `lastPlayed`. */
  lastPlayedSource?: PlayedSource
  /** Nombre de lancements depuis Player X. */
  launches?: number
  favorite?: boolean
  /** Temps de jeu en minutes : compteur Steam pour les jeux Steam, sinon mesuré par Player X. */
  playtime?: number
  playtimeSource?: 'steam' | 'local'
  /** Le jeu tourne en ce moment sur ce PC. */
  running?: boolean
  /** Début de la partie en cours (premier relevé qui l'a vu), quand `running`. */
  runningSince?: number
  /** Patch publié sur Steam ces 7 derniers jours et pas encore vu dans la fiche : badge « Nouveau patch ». */
  newPatch?: { id: string; title: string; at: number }
  /** Dernières notes de patch publiées sur Steam (date de publication, pas celle du téléchargement), quel que soit leur âge et même déjà vues. Absent si les actus sont coupées, sans page Steam, ou si aucune des dernières annonces n'est un patch. */
  lastPatch?: { id: string; title: string; at: number }
  /** Jeu du compte Steam qui n'est pas installé sur ce PC : « Installer » à la place de « Jouer ». */
  notInstalled?: boolean
}

export type FriendPlatform = 'steam' | 'discord' | 'psn'
export type FriendStatus = 'in-game' | 'online' | 'away' | 'offline'

export interface Friend {
  id: string // `${platform}:${platformId}`
  platform: FriendPlatform
  name: string
  avatarUrl?: string
  status: FriendStatus
  game?: string
  device?: string
  /** Présence illisible cette fois-ci (PSN) : le statut affiché n'est pas fiable. */
  presenceUnknown?: boolean
  /** Ami depuis (ms) : Steam seulement (`friend_since` de GetFriendList). */
  since?: number
  /** Dernière déconnexion (ms) : Steam seulement (`lastlogoff`), quand le profil la montre. */
  lastSeen?: number
  /** Discord : le salon vocal où se trouve le membre (widget du serveur), et s'il a coupé son micro ou son casque. */
  voice?: { channelId: string; muted?: boolean; deafened?: boolean }
  /** Steam : on peut le rejoindre (serveur ou salon de jeu visible). L'adresse est faite dans le processus principal. */
  joinable?: boolean
}

/** Un jeu du profil Steam d'un ami. Heures en minutes. */
export interface SteamFriendGame {
  appId: number
  name?: string
  minutes: number
  /** Les 2 dernières semaines (GetRecentlyPlayedGames). */
  recentMinutes?: number
}

/** Profil Steam d'un ami : seulement ce que Steam rend public. Rien d'inventé : un champ absent n'est pas affiché. */
export interface SteamFriendProfile {
  steamId: string
  level?: number
  /** Nombre de jeux et heures totales : profil aux détails de jeu publics seulement. */
  gameCount?: number
  totalMinutes?: number
  games?: SteamFriendGame[]
  recent?: SteamFriendGame[]
  /** Fond de profil et cadre d'avatar équipés (IPlayerService/GetProfileItemsEquipped, non documenté). */
  background?: string
  backgroundVideo?: string
  avatarFrame?: string
  /** Avatar animé équipé (GetProfileItemsEquipped). */
  avatarAnimated?: string
  /** Avatar en grand (184 px). */
  avatarFull?: string
  /** Progression du niveau, de 0 à 1 (GetBadges). */
  levelProgress?: number
  badgeCount?: number
  /** Nombre d'amis : liste d'amis publique seulement. */
  friendCount?: number
  /** Pays (code ISO à 2 lettres) et date de création du compte (ms), seulement s'ils sont publics. */
  country?: string
  memberSince?: number
  /** Profil privé ou amis seulement : Steam n'a rien donné sur ses jeux. */
  gamesHidden?: boolean
}

export interface Account {
  platform: FriendPlatform
  id: string
  name: string
  avatarUrl?: string
}

export interface Settings {
  steamApiKey: string
  discordClientId: string
  discordClientSecret: string
  /** Serveur Discord dont le widget est activé : affiche ses membres en ligne. */
  discordGuildId: string
  /** Jeton NPSSO PlayStation (non officiel). */
  psnNpsso: string
  demoMode: boolean
  /** Alertes quand un ami Steam ou PlayStation se connecte (`all`) ou seulement quand il lance un jeu (`games`). */
  friendAlerts: FriendAlertMode
  /** Amis à surveiller (« Préviens-moi quand il lance un jeu ») : alerte même si les alertes sont coupées. */
  friendWatch: string[]
  /** Quand un jeu lancé depuis Player X démarre : Player X reste ouvert derrière (`stay`) ou se réduit (`minimize`). */
  launchWindow: LaunchWindowMode
  /** Actus des jeux : annonces officielles publiées sur Steam dans la fiche, et badge « Nouveau patch ». */
  gameNews: boolean
  /** La croix range Player X dans la zone de notification (près de l'horloge) au lieu de le fermer. */
  closeToTray: boolean
  /** Lancé caché dans la zone de notification à l'ouverture de la session Windows. */
  startWithWindows: boolean
  /** Bilan de session Battlefield 6 : tes stats relevées au lancement du jeu, puis comparées après la partie. */
  bf6Recap: boolean
  /** Counter-Strike 2 : ton match en direct et son bilan, envoyés par le jeu lui-même (Game State Integration de Valve). */
  cs2Live: boolean
  /** À la fermeture de CS2, Player X s'ouvre de lui-même sur le dernier bilan (sinon une notification Windows). */
  cs2RecapOpen: boolean
  /** Overlay CS2 (bêta) : coupé, ou un des trois styles à essayer en jeu. Proposé seulement sur le canal Bêta. */
  cs2Overlay: Cs2OverlayStyle
  /** Raccourci global qui masque ou réaffiche l'overlay (accélérateur Electron, « Alt+X » par défaut ; voir shared/hotkey.ts). */
  overlayHotkey: string
  /** Ton pseudo dans Player X (Profil › Modifier) : passe avant celui de Steam. '' : celui du compte principal. */
  profileName: string
  /** Ta photo (data URL WebP 256 × 256, recadrée dans l'interface) : passe avant celle de Steam. '' : celle du compte. */
  profileAvatar: string
  /** Prêt à jouer : une alerte quand Steam a fini de télécharger la mise à jour (ou l'installation) d'un jeu. */
  gameReadyAlert: boolean
}

/** `a` : façon Apple (matériaux, ressorts, sheet) ; `b` : verre ; `c` : finition du style Player X. */
export type Cs2OverlayStyle = 'off' | 'a' | 'b' | 'c'

/** Ce que l'overlay doit faire : son style, masqué par son raccourci, ou un aperçu en cours (chiffres d'exemple). */
export interface Cs2OverlayConfig {
  style: Cs2OverlayStyle
  hidden: boolean
  /** Le raccourci choisi (« Alt+X »), pour l'afficher dans l'aperçu. */
  hotkey: string
  /** Aperçu lancé depuis Paramètres : l'overlay passe ses pièces avec des chiffres d'exemple. */
  previewAt?: number
}

/** Démarrage avec Windows : `unavailable` hors de la version installée sur Windows, `blocked` si Windows l'a désactivé (Gestionnaire des tâches). */
export type StartupState = 'on' | 'off' | 'blocked' | 'unavailable'

export type FriendAlertMode = 'all' | 'games' | 'off'
export type LaunchWindowMode = 'stay' | 'minimize'

/** Un ami vient de se connecter ou de lancer un jeu. */
/** Succès rare (moins de 15 % des joueurs) débloqué depuis le relevé précédent. */
export interface RareUnlock {
  /** `steam:<appid>` */
  gameId: string
  gameName: string
  id: string
  name: string
  percent: number
}

export interface FriendAlert {
  key: string
  friend: Friend
  kind: 'online' | 'in-game'
  at: number
  /** Alerte d'essai (Paramètres) ou du mode démo. */
  sample?: boolean
}

export interface FriendsResult {
  friends: Friend[]
  errors: Partial<Record<FriendPlatform, string>>
  /** Plateformes interrogées (compte relié ou serveur configuré). */
  queried?: FriendPlatform[]
  /** Membres du serveur Discord masqués (bots connus, « Masquer »). */
  hidden?: HiddenMember[]
  /** Nom du serveur Discord, tel que le donne son widget. */
  discordServer?: string
  /** Salons vocaux publics du serveur Discord (ceux que @everyone voit), dans l'ordre du serveur. */
  discordChannels?: DiscordChannel[]
}

/** Salon vocal d'un serveur Discord, d'après son widget. */
export interface DiscordChannel {
  id: string
  name: string
}

/** Membre d'un serveur Discord retiré des listes : bot connu, ou masqué avec « Masquer ». */
export interface HiddenMember {
  name: string
  reason: 'bot' | 'user'
  /** Présent dans le widget lors de la dernière récupération. */
  online: boolean
  avatarUrl?: string
}

export interface ScanReport {
  store: Store
  found: number
  /** Dossiers et sources examinés, pour comprendre un scan vide. */
  checked: string[]
  error?: string
  /** Le store n'a pas l'air installé sur ce PC : ni dossier ni réglage trouvé, et aucun jeu. */
  absent?: boolean
}
