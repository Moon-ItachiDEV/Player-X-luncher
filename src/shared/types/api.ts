// Types partagés : le pont entre la page et le processus principal (window.launcher, window.pxOverlay).
import type { LaunchOpts, LaunchStatus } from '../launch'
import type { Bf6Account, Bf6Art, Bf6Match, Bf6Point, Bf6RecapEvent, Bf6RecapState, Bf6Snapshot, Bf6Tracked } from './bf6'
import type { Clip, ClipDisplay, ClipSettings, ClipsState } from './clips'
import type { Account, Cs2OverlayConfig, FriendAlert, FriendPlatform, FriendsResult, Game, RareUnlock, ScanReport, Settings, StartupState, SteamFriendProfile } from './core'
import type { Cs2LifetimeResult, Cs2Live, Cs2RecapEvent, Cs2State } from './cs2'
import type { CaptureTestResult, CaptureTestStep, EditEngine, EditEngineStep, EditMusic, EditProject, FilmState } from './edit'
import type { GameNews } from './news'
import type { Cs2ServersResult, SteamPlayers } from './servers'
import type { Shelves } from './shelves'
import type { GameAchievements, GameEventStarted, GameEvents, GameReady, SteamLibrary, SteamUpdates } from './steam'

export interface V3RoutineApi {
  getRoutines(): Promise<import('../routines').Routine[]>
  saveRoutines(list: unknown[]): Promise<import('../routines').Routine[]>
  chooseRoutineApp(): Promise<{ path: string; name: string } | null>
  runRoutine(id: string, launchId?: string): Promise<boolean>
  routineHotkeys(): Promise<Record<string, string>>
  onRoutineStatus(cb: (s: import('../routines').RoutineStatus) => void): () => void
}

export interface LauncherApi extends V3RoutineApi {
  getGames(refresh?: boolean): Promise<Game[]>
  /**
   * Lance un jeu. Ne rejette jamais pour un échec de lancement : la phase le dit (`failed`, `already`…).
   * Répond une fois le lien transmis par Windows ; les phases suivantes arrivent par onLaunchStatus.
   */
  launchGame(id: string, opts: LaunchOpts): Promise<LaunchStatus>
  /** « Ne plus attendre » : Player X arrête de suivre ce lancement (rien n'est fermé). */
  cancelLaunch(launchId: string): Promise<void>
  /** Lancements en cours et terminés depuis moins de 15 min (rechargement de l'interface). */
  listLaunches(): Promise<LaunchStatus[]>
  /** Chaque changement de phase d'un lancement. Renvoie la fonction de désabonnement. */
  onLaunchStatus(cb: (s: LaunchStatus) => void): () => void
  toggleFavorite(id: string): Promise<Game[]>
  /** Remplace d'un coup la liste des favoris (écran de démarrage). Renvoie la bibliothèque à jour. */
  setFavorites(ids: string[]): Promise<Game[]>
  getScanReport(): Promise<ScanReport[]>
  /** Prévient quand la bibliothèque change en arrière-plan (jaquettes récupérées…). Renvoie la fonction de désabonnement. */
  onGamesChanged(cb: () => void): () => void
  getFriends(): Promise<FriendsResult>
  /** Profil Steam d'un ami (niveau, jeux, fond) ; null en mode démo ou sans clé Steam. */
  getFriendProfile(friendId: string): Promise<SteamFriendProfile | null>
  /** Player X (la version GitHub) a des connexions enregistrées sur ce PC : son dossier, sinon null. */
  playerXConnections(): Promise<string | null>
  /** Reprend ses connexions (Discord, Steam, PlayStation) sans rien remplacer ici. Renvoie les services repris. */
  importPlayerXConnections(): Promise<string[]>
  /** Ouvre Steam : discussion avec l'ami, ou rejoindre sa partie. */
  friendSteam(action: 'message' | 'join', friendId: string): Promise<void>
  /** « Masquer » / « Afficher » un membre du serveur Discord ; renvoie la liste relue sans redemander à Discord. */
  setMemberHidden(name: string, hidden: boolean): Promise<FriendsResult>
  getAccounts(): Promise<Account[]>
  login(platform: 'steam' | 'discord'): Promise<Account>
  connectPsn(): Promise<Account>
  logout(platform: FriendPlatform): Promise<Account[]>
  getSettings(): Promise<Settings>
  saveSettings(settings: Partial<Settings>): Promise<Settings>
  openExternal(url: string): Promise<void>
  /** Ouvre le dossier d'installation d'un jeu (le chemin est retrouvé côté processus principal). */
  openGameFolder(id: string): Promise<void>
  /** Abandonne une connexion Steam/Discord en attente (libère le port de retour). */
  cancelLogin(): Promise<void>
  /** Cherche un pseudo Battlefield 6 sur toutes les plateformes. */
  bf6Search(name: string): Promise<Bf6Match[]>
  /** Stats d'un compte : gardées 10 min, sauf `refresh`. */
  bf6Stats(account: Bf6Account, refresh?: boolean): Promise<Bf6Snapshot>
  bf6Art(): Promise<Bf6Art>
  bf6GetTracked(): Promise<Bf6Tracked>
  /** Ton profil BF6 relié dans Player X sur ce PC (lecture seule), ou null. */
  bf6PlayerX(): Promise<{ from: string; me: Bf6Account } | null>
  /** Reprend ce profil et ses joueurs suivis. Rien n'est modifié dans Player X. */
  bf6ImportPlayerX(): Promise<Bf6Tracked>
  bf6SetTracked(tracked: Bf6Tracked): Promise<Bf6Tracked>
  /** Relevés quotidiens d'un compte suivi, du plus ancien au plus récent. */
  bf6History(account: Bf6Account): Promise<Bf6Point[]>
  /** Bilans de session et session en cours. */
  bf6Recaps(): Promise<Bf6RecapState>
  /** Bilan ouvert : il n'est plus proposé. */
  bf6RecapSeen(id: string): Promise<void>
  /** Bilan prêt, complété, ou à ouvrir (clic sur la notification Windows). Renvoie la fonction de désabonnement. */
  onBf6Recap(cb: (e: Bf6RecapEvent) => void): () => void
  /** Counter-Strike 2 : liaison avec le jeu, match en cours et bilans. */
  cs2State(): Promise<Cs2State>
  /** Bilan CS2 ouvert : il n'est plus proposé. */
  cs2RecapSeen(id: string): Promise<void>
  /** Match CS2 en cours (au plus une fois par seconde), ou null à sa fin. Renvoie la fonction de désabonnement. */
  onCs2Live(cb: (live: Cs2Live | null) => void): () => void
  /** Liaison ou liste des bilans changée : relire `cs2State()`. Renvoie la fonction de désabonnement. */
  onCs2State(cb: () => void): () => void
  /** Bilan CS2 prêt, ou à ouvrir (clic sur la notification Windows). Renvoie la fonction de désabonnement. */
  onCs2Recap(cb: (e: Cs2RecapEvent) => void): () => void
  /** Stats à vie de Valve (Steam Web API, avec ta clé) : gardées 1 h, sauf `force`. */
  cs2Lifetime(force?: boolean): Promise<Cs2LifetimeResult>
  /** Overlay CS2 (bêta) : réglages de la fenêtre de l'overlay. */
  cs2OverlayConfig(): Promise<Cs2OverlayConfig>
  /** Paramètres : montre l'overlay quelques secondes avec des chiffres d'exemple, même sans CS2. */
  cs2OverlayPreview(): Promise<void>
  /** Le raccourci est-il libre ? null si oui, sinon pourquoi (déjà pris par Windows ou une autre appli, refusé). */
  cs2OverlayHotkeyCheck(accel: string): Promise<string | null>
  /** Page de l'overlay peinte : la fenêtre peut s'afficher. */
  cs2OverlayReady(): Promise<void>
  onCs2OverlayConfig(cb: (c: Cs2OverlayConfig) => void): () => void
  /** Alertes d'amis à afficher dans la fenêtre (quand elle est au premier plan ; sinon Windows les affiche). */
  onFriendAlert(cb: (alerts: FriendAlert[]) => void): () => void
  /** Succès rares débloqués (relevés en arrière-plan), quand Player X est au premier plan. */
  onRareAchievements(cb: (list: RareUnlock[]) => void): () => void
  /** Clic sur une notification Windows : ouvrir le panneau d'amis. */
  onShowFriends(cb: () => void): () => void
  /** Envoie une alerte d'essai, dans la fenêtre et en notification Windows. */
  testFriendAlert(): Promise<void>
  /** Annonces officielles d'un jeu sur Steam (gardées 30 min, sauf `refresh`). */
  getGameNews(id: string, refresh?: boolean): Promise<GameNews>
  /** Les actus de ce jeu ont été vues dans sa fiche : son badge « Nouveau patch » disparaît. `upTo` : seulement jusqu'à cette date (une annonce lue). */
  markNewsSeen(id: string, upTo?: number): Promise<void>
  /** Jeux du compte Steam non installés sur ce PC (liste gardée 1 h, sauf `refresh`). */
  getSteamLibrary(refresh?: boolean): Promise<SteamLibrary>
  /** Ouvre l'installation d'un jeu Steam non installé ; il rejoint la bibliothèque une fois téléchargé. */
  installGame(id: string): Promise<void>
  /** Succès Steam d'un jeu, avec leur rareté (gardés 10 min, sauf `refresh`). */
  getAchievements(id: string, refresh?: boolean): Promise<GameAchievements>
  /** Page Trophées : tous les jeux Steam joués. Lance le relevé s'il a plus de 6 h (ou tout de suite avec `refresh`). */
  /** Démarrage avec Windows tel que Windows le voit (il peut l'avoir désactivé de son côté). */
  getStartupState(): Promise<StartupState>
  /** Prêt à jouer : mises à jour et téléchargements Steam en attente ou en cours (appid → état). */
  getSteamUpdates(): Promise<SteamUpdates>
  /** Chaque changement de ces états. Renvoie la fonction de désabonnement. */
  onSteamUpdates(cb: (u: SteamUpdates) => void): () => void
  /** Un jeu est prêt après sa mise à jour (fenêtre au premier plan, ou clic sur la notification Windows). */
  onGameReady(cb: (e: GameReady) => void): () => void
  /** Ouvre la page Téléchargements de Steam. `demo` : rien n'est ouvert. */
  openSteamDownloads(): Promise<'opened' | 'demo'>
  /** Ouvre un salon vocal du serveur Discord dans l'appli Discord (ou le site). `demo` : rien n'est ouvert. */
  openDiscordChannel(channelId: string): Promise<'opened' | 'demo'>
  /** Serveurs de CS2 selon Valve (avec ta clé Steam Web API) : gardés 5 min, sauf `force`. */
  cs2Servers(force?: boolean): Promise<Cs2ServersResult>
  /** Joueurs en jeu sur Steam pour un jeu Steam (gardé 5 min) ; null si Steam ne répond pas ou si ce n'est pas un jeu Steam. */
  steamPlayers(gameId: string): Promise<SteamPlayers | null>
  /** Événements en cours et à venir d'un jeu (page Steam du jeu, gardés 30 min). */
  getGameEvents(gameId: string): Promise<GameEvents>
  /** « Me prévenir » au début d'un événement (ou l'annule). Renvoie les événements suivis de ce jeu. */
  setEventReminder(gameId: string, eventId: string, on: boolean): Promise<string[]>
  /** Un événement suivi commence (fenêtre au premier plan, ou clic sur la notification Windows). */
  onEventStarted(cb: (e: GameEventStarted) => void): () => void
  /** Collections et jeux masqués. */
  getShelves(): Promise<Shelves>
  /** Crée une collection (avec un premier jeu, si donné). */
  createCollection(name: string, gameId?: string): Promise<Shelves>
  renameCollection(id: string, name: string): Promise<Shelves>
  deleteCollection(id: string): Promise<Shelves>
  /** Ajoute un jeu à une collection, ou l'en retire. */
  setInCollection(id: string, gameId: string, on: boolean): Promise<Shelves>
  /** Masque un jeu de l'Accueil et de la Bibliothèque, ou le réaffiche. */
  setGameHidden(gameId: string, hidden: boolean): Promise<Shelves>
  /** Mes loadouts Battlefield 6 (carnet gardé sur ce PC). */
  getBf6Loadouts(): Promise<import('../bf6Loadouts').Bf6Loadout[]>
  /** Enregistre un loadout (sans identifiant connu : un nouveau). Renvoie le carnet. */
  saveBf6Loadout(loadout: unknown): Promise<import('../bf6Loadouts').Bf6Loadout[]>
  deleteBf6Loadout(id: string): Promise<import('../bf6Loadouts').Bf6Loadout[]>
  /** Enregistre plusieurs loadouts d'un coup (les modèles), dans l'ordre donné. */
  saveBf6Loadouts(list: unknown[]): Promise<import('../bf6Loadouts').Bf6Loadout[]>
  /** « Mes armes » : armes apprises des loadouts enregistrés. */
  getMyBf6Weapons(): Promise<import('../bf6Workshop').MyWeapon[]>
  /** Copie dans le presse-papiers l'image de cette zone de la fenêtre (en pixels CSS). */
  copyAreaImage(rect: { x: number; y: number; width: number; height: number }): Promise<'copied'>
  /** Clips enregistrés, du plus récent au plus ancien (ceux dont le fichier a disparu sont retirés). */
  clipsList(): Promise<Clip[]>
  /** Supprime le fichier, la vignette et la fiche. false : identifiant inconnu. */
  clipsDelete(id: string): Promise<boolean>
  /** Change le titre et le nom du fichier. */
  clipsRename(id: string, name: string): Promise<Clip>
  clipsPin(id: string, on: boolean): Promise<Clip>
  /** Montre le fichier dans l'Explorateur ; sans identifiant, ouvre le dossier des clips. */
  clipsOpenFolder(id?: string): Promise<void>
  /** Copie le fichier dans le presse-papiers de Windows (à coller dans Discord). false ailleurs ou si l'identifiant est inconnu. */
  clipsCopyFile(id: string): Promise<boolean>
  /** Coupe le clip (début sur l'image clé précédente, sans réencodage) et remplace le fichier. */
  clipsTrim(id: string, startS: number, endS: number): Promise<Clip>
  clipsState(): Promise<ClipsState>
  /** Comme le raccourci : garde les `before` dernières secondes et les `after` suivantes. false : le tampon ne tourne pas. */
  clipsGetSettings(): Promise<ClipSettings>
  /** Applique un changement partiel (valeurs vérifiées) et renvoie les réglages. Rejette si le raccourci est refusé, avec la raison. */
  clipsSaveSettings(patch: Partial<ClipSettings>): Promise<ClipSettings>
  /** Fenêtre native de choix du dossier. null : annulé. */
  clipsChooseFolder(): Promise<ClipSettings | null>
  clipsDisplays(): Promise<ClipDisplay[]>
  /** Les 40 dernières lignes du journal (bouton « Copier le journal »). */
  clipsLogTail(): Promise<string>
  /** Un clip ajouté, changé ou supprimé. Renvoie la fonction de désabonnement. */
  onClipsChanged(cb: () => void): () => void
  /** Chaque changement d'état de la capture. Renvoie la fonction de désabonnement. */
  onClipsState(cb: (s: ClipsState) => void): () => void
  /** Le moteur vidéo livré avec l'appli : prêt ou non, et son dernier essai sur ce PC. */
  editEngine(): Promise<EditEngine>
  /** Essaie le moteur sur ce PC (quelques secondes par encodeur, puis le dernier clip) et renvoie l'état avec le résultat. */
  editEngineTest(): Promise<EditEngine>
  editEngineStop(): Promise<void>
  /** Ouvre le dossier du moteur : sa licence et l'adresse de ses sources. */
  editEngineFolder(): Promise<void>
  /** Avancement de l'essai en cours. Renvoie la fonction de désabonnement. */
  onEditEngineStep(cb: (s: EditEngineStep) => void): () => void
  /**
   * Fabrique un film : avec le projet de l'éditeur, ou avec des identifiants de clips mis bout à bout. Répond dès que le film est
   * lancé ; la suite arrive par onEditFilm. Refuse en clair si un jeu tourne ou si un film est déjà en cours.
   */
  editFilmStart(clipIdsOrProject: string[] | EditProject): Promise<FilmState>
  /** Les musiques déjà choisies (sans leur chemin). */
  editMusicList(): Promise<EditMusic[]>
  /** Fenêtre de Windows pour choisir une musique, puis recherche de ses temps. null : fenêtre fermée. */
  editMusicPick(): Promise<EditMusic | null>
  /** Oublie une musique (le fichier n'est pas touché). */
  editMusicForget(id: string): Promise<EditMusic[]>
  /** Le premier montage de ces clips, calé sur cette musique (ou sans). */
  editPlan(clipIds: string[], musicId: string | null): Promise<{ project: EditProject; skipped: number }>
  /** Essai « capture comme OBS » : 10 s pour revenir en jeu, puis 10 s par méthode, avec le moteur vidéo. */
  editCaptureTest(): Promise<CaptureTestResult>
  onEditCaptureStep(cb: (s: CaptureTestStep) => void): () => void
  editFilmState(): Promise<FilmState>
  /** Arrête le film en cours : rien n'est gardé. */
  editFilmStop(): Promise<void>
  /** Chaque changement d'état du film en cours (avancement, fin, arrêt, échec). Renvoie la fonction de désabonnement. */
  onEditFilm(cb: (s: FilmState) => void): () => void
  platform: string
  version: string
}

/**
 * Pont de la fenêtre de l'overlay CS2 (preload/overlay.ts, `window.pxOverlay`) : les seuls envois cs2:* dont sa page a
 * besoin (src/main/ipc.ts refuse de toute façon tout autre canal depuis cette fenêtre).
 */
export type OverlayApi = Pick<LauncherApi, 'cs2OverlayConfig' | 'cs2OverlayReady' | 'cs2State' | 'onCs2Live' | 'onCs2OverlayConfig' | 'onCs2Recap'>
