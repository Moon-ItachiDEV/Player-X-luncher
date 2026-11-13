import { join } from 'node:path'
import { app, BrowserWindow,   dialog, Menu, powerMonitor, screen, session, shell } from 'electron'
import type { LaunchStatus } from '@shared/launch'
import { lastPlayedOf, type PlayedDates } from '@shared/played'
import { CS2_GAME_ID } from '@shared/cs2'
import { hasName } from '@shared/steamApps'
import { cleanName, isBf6Name } from '@shared/text'
import type {   FriendsResult, Game } from '@shared/types'
import { logError } from './crashLog'
import * as db from './db'
import { appWindows, broadcast, mainWindow } from './windows'
import {  onRareUnlocks, startAchievementsWatcher } from './services/achievements'
import {  deliverRare, deliverReady } from './services/alerts'
import { applyArtwork, updateArtwork, withLogos } from './services/artwork'
import {   setBf6Running, startBf6Recaps } from './services/bf6Recap'
import {  startCs2LifetimeRecorder } from './services/cs2Lifetime'
import {    setCs2Running, startCs2Live, syncCs2 } from './services/cs2Live'
import { startClips, syncClipsRunning } from './services/clips'
import { closeCs2Overlay, startCs2Overlay } from './services/cs2Overlay'
import { DEMO_CHANNELS, DEMO_FRIENDS, DEMO_GAMES, DEMO_SERVER, demoGames, demoNotInstalled } from './services/demo'
import {   startEventReminders } from './services/events'
import {  handoff, launchTarget, scanAllGames } from './services/games'
import { createLaunches, sanitizeOpts, type LaunchDeps, type Launches, type LaunchWindow, type Timers } from './services/launches'
import { createWatcher } from './services/launchWatch'
import { newMatches } from './services/launchWatchParse'
import {   refreshNewsIndex, startNewsWatcher, withNews } from './services/news'
import { allowDemo,   getSettings } from './services/settings'
import { launchArgOf, recentGames } from './services/recentGames'
import {      startRoutines } from './services/routines'
import {         startBf6Recorder } from './services/stats'
import {  isSteamSoftware, ownedForNews, ownedSteamGame, startSteamLibrary } from './services/steamLibrary'
import { startSteamUpdates } from './services/steamUpdates'
import {
  exeNamesFor,
  isRunning,
  lastPollOk,
  matchedNames,
  nudgePlaytime,
  onPlaytimeChange,
  pollNow,
  runningSince,
  snapshotPids,
  startPlaytimeTracker,
  storeWasRunning,
  withPlaytime
} from './services/playtime'
import {
  applyInstallOptions,
  attachWindow,
  onHideToTray,
  setRecentGames,
  setTrayPlaying,
  showMainWindow,
  startHidden,
  startTray } from './services/tray'
import type { LaunchSim } from './launchSim'
import type { ChannelDeps } from './channels/deps'
import { registerAccountChannels } from './channels/account'
import { registerEditChannels } from './channels/edit'
import { registerFriendChannels } from './channels/friends'
import { registerLibraryChannels } from './channels/library'
import { registerPlayChannels } from './channels/play'

// .env : clés de développement seulement, jamais lu par la version installée.
// Bêta 37 : sous Windows, la capture d'écran passe par Windows.Graphics.Capture (celle d'OBS « capture Windows 10 ») au lieu
// de la copie de bureau DXGI, choix par défaut de Chromium. Mesuré en bêta 36 sur le PC de Breezydev (CS2, 2560 × 1440) :
// l'écran ne livrait que 27 à 50 images/s sur 60, aucune perdue ensuite. Fonction de Chromium désactivée par défaut
// (media/webrtc/webrtc_features.cc : AllowWgcScreenCapturer) ; sans effet ailleurs que sous Windows.
if (process.platform === 'win32') app.commandLine.appendSwitch('enable-features', 'AllowWgcScreenCapturer')

if (!app.isPackaged) {
  try {
    process.loadEnvFile(join(app.getAppPath(), '.env'))
  } catch {
    /* .env facultatif */
  }
}

// Mode démo (jeux et amis fictifs) : retiré de l'interface en 0.9.4-beta.6. Il ne reste que pour le développement
// (captures, essais) ; la version installée l'ignore, même s'il avait été activé avant.
allowDemo(!app.isPackaged)

/**
 * Taille au lancement : 1600 × 940, celle où l'accueil tient en entier sans défiler (choix de Breezydev, 25/10/2026),
 * réduite si l'écran est plus petit (zone de travail, barre des tâches comprise).
 */
function defaultSize(): { width: number; height: number } {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  return { width: Math.max(1024, Math.min(1600, width - 32)), height: Math.max(640, Math.min(940, height - 32)) }
}

function createWindow(): void {
  const win = new BrowserWindow({
    ...defaultSize(),
    // Lancée avec Windows : cachée près de l'horloge jusqu'au premier clic sur l'icône.
    show: !startHidden,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0c0a11',
    title: 'Player X V3 Test',
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    autoHideMenuBar: true,
    // Barre de titre intégrée à l'interface ; Windows garde ses boutons natifs (réduire, agrandir, fermer),
    // sur un fond transparent : la barre du haut, en verre, passe dessous (repli possible : couleur pleine '#142743').
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: '#cdbfca', height: 52 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      devTools: !app.isPackaged
    }
  })
  attachWindow(win)
  // La mise en page de la V3 est pensée entre 1120 × 620 et 1600 × 940 : en dehors, toute l'appli change d'échelle.
  const BAR = 52
  const scaleFor = (w: number, h: number): number => {
    if (w < 1120 || h < 620) return Math.min(w / 1120, h / 620)
    if (w > 1600 && h > 940) return Math.min(w / 1600, h / 940)
    return 1
  }
  let lastScale = 0
  const rescale = (): void => {
    if (win.isDestroyed()) return
    const [w, h] = win.getContentSize()
    const k = Math.round(scaleFor(w, h) * 1000) / 1000
    if (k === lastScale) return
    lastScale = k
    win.webContents.setZoomFactor(k)
    if (process.platform !== 'darwin') win.setTitleBarOverlay({ height: Math.round(BAR * k) })
  }
  let settle: NodeJS.Timeout | null = null
  win.on('resize', () => {
    rescale()
    if (settle) clearTimeout(settle)
    settle = setTimeout(rescale, 120)
  })
  win.webContents.on('did-finish-load', () => {
    lastScale = 0
    rescale()
  })
  // Fermée pour de bon (pas rangée près de l'horloge) : l'overlay CS2 se ferme aussi, sinon Player X ne quitterait pas.
  win.on('closed', closeCs2Overlay)
  // Windows se ferme (déconnexion, arrêt) : les dernières écritures de la base partent tout de suite.
  win.on('session-end', () => db.flushDb())
  // Les liens externes s'ouvrent dans le navigateur, pas dans l'appli.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.loadFile(join(__dirname, '../renderer/v3/index.html'), !app.isPackaged && process.env.PX_SOFTGL ? { search: 'softgl=1' } : undefined).catch((e) => logError('fenêtre', e))
}

let scanned = false
function notifyGamesChanged(): void {
  // Une fenêtre en train de se fermer ne doit pas empêcher les autres d'être prévenues, ni le relevé des jeux en cours.
  broadcast('games:changed')
  updateRunning()
}

/** Jeux en cours dans la vraie bibliothèque : menu de l'icône près de l'horloge, session Battlefield 6, match Counter-Strike 2. */
function updateRunning(): void {
  const all = withPlaytime(db.listGames())
  const running = all.filter((g) => g.running)
  // La démo reste dans la fenêtre : rien dans le menu de l'icône.
  const demo = getSettings().demoMode
  setTrayPlaying(demo ? [] : running.map((g) => cleanName(g.name)))
  // Jeux récents : menu de l'icône et liste de raccourcis de Windows (rien n'est refait si la liste ne change pas).
  const recent = demo ? [] : recentGames(all.filter(isGameEntry)).map((g) => ({ id: g.id, name: cleanName(g.name) }))
  if (launches) setRecentGames(recent, launchFromShortcut)
  // Fin vue sans relevé fiable (mise en veille, PowerShell en panne) : le bilan attend le prochain relevé réussi.
  setBf6Running(running.some((g) => isBf6Name(g.name)), lastPollOk())
  setCs2Running(running.some((g) => g.id === CS2_GAME_ID), lastPollOk())
  // Clips : le tampon vidéo ne tourne que pendant qu'un jeu tourne (les logiciels Steam ne comptent pas).
  syncClipsRunning(running.filter(isGameEntry))
}

// Favoris et lancements du mode démo : gardés à part pour ne jamais toucher la vraie bibliothèque.
interface DemoState {
  /** Absent tant qu'on n'a rien changé : on garde les favoris fictifs. */
  favorites?: string[]
  launches: Record<string, { count: number; last: number }>
}

function demoState(): DemoState {
  return { launches: {}, ...db.getKv<Partial<DemoState>>('demoState', {}) }
}

/** Lancement en mode démo : seul le compteur de démo change, jamais la vraie bibliothèque. */
function recordDemoLaunch(id: string): void {
  const state = demoState()
  const count = (state.launches[id]?.count ?? 0) + 1
  db.setKv('demoState', { ...state, launches: { ...state.launches, [id]: { count, last: Date.now() } } })
}

/** Lancements de jeux (services/launches.ts). Créé avant l'IPC, au démarrage. */
let launches: Launches
/** Simulateur de lancement (`npm run dev` avec PX_LAUNCH_SIM) : toujours null dans la version installée. */
let launchSim: LaunchSim | null = null

async function games(refresh = false): Promise<Game[]> {
  if (getSettings().demoMode) {
    const state = demoState()
    return withNews(
      applyArtwork(demoGames()).map((g) => {
        const l = state.launches[g.id]
        // Dernière partie : la date fictive (avec sa source) ou un lancement de démo, le plus récent des deux.
        const dates: PlayedDates = g.lastPlayed && g.lastPlayedSource ? { [g.lastPlayedSource]: g.lastPlayed } : {}
        if (l?.last) dates.launch = Math.max(dates.launch ?? 0, l.last)
        const played = lastPlayedOf(dates)
        return {
          ...g,
          favorite: state.favorites ? state.favorites.includes(g.id) : g.favorite,
          lastPlayed: played?.at,
          lastPlayedSource: played?.source,
          launches: (g.launches ?? 0) + (l?.count ?? 0),
          // Développement : « En jeu » d'après le faux relevé du simulateur de lancement.
          ...(launchSim?.isRunning(g.id) ? { running: true, runningSince: launchSim.runningSince(g.id) } : {})
        }
      })
    )
  }
  if (refresh || !scanned) {
    await scanLibrary()
    // Le mode démo a pu s'activer pendant le scan : on rend alors la bibliothèque de démo.
    if (getSettings().demoMode) return games()
  }
  return withNews(withPlaytime(withLogos(db.listGames().filter(isGameEntry))))
}

let scanRun: Promise<void> | null = null

/** Un seul scan à la fois : l'interface, un raccourci au démarrage et la fin d'une installation qui demandent en même temps partagent le même. */
function scanLibrary(): Promise<void> {
  scanRun ??= (async () => {
    const found = applyArtwork(await scanAllGames())
    db.replaceGames(found)
    scanned = true
    // CS2 installé, déplacé ou désinstallé : son fichier de liaison suit.
    void syncCs2()
    // Les jaquettes manquantes arrivent en arrière-plan : la bibliothèque s'affiche tout de suite.
    updateArtwork(found)
      .then((changed) => {
        if (!changed) return
        db.replaceGames(applyArtwork(db.listGames()))
        notifyGamesChanged()
      })
      .catch((e) => logError('jaquettes', e))
  })().finally(() => (scanRun = null))
  return scanRun
}

/** Les logiciels Steam (Wallpaper Engine…) et les entrées sans nom ne sont pas affichés dans la bibliothèque. */
function isGameEntry(g: Game): boolean {
  return hasName(g.name) && !(g.store === 'steam' && isSteamSoftware(g.storeId))
}

/** La bibliothèque déjà connue (vraie ou de démo), sans relancer de scan : pour les actus des jeux. */
function knownGames(): Game[] {
  return getSettings().demoMode ? demoGames() : db.listGames()
}

/**
 * Jeux suivis par le relevé des actus : la bibliothèque, plus les jeux du compte Steam pas installés les plus récemment
 * joués (leur jaquette de la Bibliothèque a aussi le badge « Nouveau patch »).
 */
function newsGames(): Game[] {
  const installed = knownGames()
  return [...installed, ...(getSettings().demoMode ? demoNotInstalled() : ownedForNews(installed))]
}

/** Amis et membres du serveur du mode démo (salons vocaux compris). */
function demoFriends(): FriendsResult {
  return { friends: DEMO_FRIENDS, errors: {}, discordServer: DEMO_SERVER, discordChannels: DEMO_CHANNELS }
}

/** Un jeu de la bibliothèque, ou un jeu du compte Steam pas installé sur ce PC (sa fiche s'ouvre aussi). */
function findGame(id: unknown): Game | undefined {
  if (typeof id !== 'string') return undefined
  const installed = knownGames().find((g) => g.id === id)
  if (installed) return installed
  return (getSettings().demoMode ? demoNotInstalled().find((g) => g.id === id) : ownedSteamGame(id)) ?? undefined
}

const OWNED_ART_EVERY_MS = 10 * 60_000
let ownedArt: { at: number; run: Promise<void> | null } = { at: 0, run: null }

/** Jaquettes des jeux Steam non installés, en arrière-plan : une recherche à la fois, au plus toutes les 10 min. */
function fetchOwnedArtwork(list: Game[]): void {
  if (!list.length || ownedArt.run || Date.now() - ownedArt.at < OWNED_ART_EVERY_MS) return
  ownedArt = {
    at: Date.now(),
    run: updateArtwork(list)
      .then((changed) => void (changed && notifyGamesChanged()))
      .catch((e) => logError('jaquettes', e))
      .finally(() => (ownedArt.run = null))
  }
}

function registerIpc(): void {
  const d: ChannelDeps = {
    games,
    findGame,
    knownGames,
    newsGames,
    launches: () => launches,
    demoState,
    demoFriends,
    fetchOwnedArtwork,
    notifyGamesChanged,
    updateRunning,
    rescan: () => {
      scanned = false
    }
  }
  registerLibraryChannels(d)
  registerFriendChannels(d)
  registerAccountChannels(d)
  registerPlayChannels(d)
  registerEditChannels()
}

// ---------- lancement d'un jeu ----------

function emitLaunch(s: LaunchStatus): void {
  broadcast('launch:status', s)
}

/**
 * Fenêtre principale vue par le lancement : lue, réduite, ou rouverte sans activation. Un « restore » qui ne vient pas de
 * showInactive ci-dessous est celui de l'utilisateur : Player X ne reviendra plus tout seul. Pareil quand la croix
 * range la fenêtre près de l'horloge.
 */
function launchWindow(): LaunchWindow {
  const win = mainWindow
  let ownRestoreUntil = 0
  let onUser = (): void => {}
  app.on('browser-window-created', (_e, w) =>
    w.on('restore', () => {
      if (Date.now() < ownRestoreUntil) {
        ownRestoreUntil = 0
        return
      }
      onUser()
    })
  )
  onHideToTray(() => onUser())
  return {
    focused: () => win()?.isFocused() ?? true,
    // Rangée près de l'horloge : comme réduite, jamais réduite (Windows la remontrerait dans la barre des tâches) ni rouverte.
    minimized: () => {
      const w = win()
      return !!w && (w.isMinimized() || !w.isVisible())
    },
    maximized: () => win()?.isMaximized() ?? false,
    minimize: () => win()?.minimize(),
    showInactive: () => {
      const w = win()
      if (!w) return
      ownRestoreUntil = Date.now() + 1000
      w.showInactive()
    },
    onUserRestore: (cb) => {
      onUser = cb
    }
  }
}

function launchDeps(): LaunchDeps {
  const timers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) }
  // Journal de développement seulement : `[launch] …` dans le terminal de `npm run dev`.
  const log = app.isPackaged ? (): void => {} : (msg: string): void => console.log(`[launch] ${msg}`)
  return {
    platform: process.platform,
    now: Date.now,
    timers,
    findGame: async (id) => (await games()).find((g) => g.id === id),
    demo: () => getSettings().demoMode,
    target: launchTarget,
    handoff,
    handlerKnown: (url) => {
      try {
        return app.getApplicationNameForProtocol(url) !== ''
      } catch {
        return null
      }
    },
    recordLaunch: db.recordLaunch,
    recordDemoLaunch,
    tracker: {
      isRunning,
      runningSince,
      pollNow,
      lastPollOk,
      snapshotPids,
      storeWasRunning,
      exeNamesFor,
      matchedNames,
      nudge: nudgePlaytime,
      onChange: onPlaytimeChange
    },
    watcher: (onDown) => createWatcher({ now: Date.now, timers, log, onDown }),
    newMatches,
    window: launchWindow(),
    onBattery: () => powerMonitor.isOnBatteryPower(),
    settings: getSettings,
    emit: emitLaunch,
    gamesChanged: notifyGamesChanged,
    log
  }
}

/**
 * Jeu lancé depuis le menu de l'icône près de l'horloge ou la liste de raccourcis de Windows (`--launch=<id>`) : le
 * même lancement que le bouton Jouer, sans ouvrir la fenêtre. Si l'envoi échoue, la fenêtre s'ouvre sur la carte qui
 * l'explique.
 */
function launchFromShortcut(id: string): void {
  launches
    .start(id, sanitizeOpts({ via: 'play' }))
    .then((s) => {
      if (s.phase === 'failed') showMainWindow()
    })
    .catch(() => showMainWindow())
}

/** En développement, PX_LAUNCH_SIM branche le vrai orchestrateur sur un faux Windows (launchSim.ts, jamais dans l'installeur). */
async function startLaunches(): Promise<Launches> {
  const deps = launchDeps()
  const mode = app.isPackaged ? undefined : process.env.PX_LAUNCH_SIM
  if (mode) {
    try {
      const { createLaunchSim } = await import('./launchSim')
      launchSim = createLaunchSim(mode, deps, process.env.PX_LAUNCH_SIM_FAST === '1')
      launchSim.onChange(notifyGamesChanged)
      return launchSim.launches
    } catch (e) {
      console.error('[launch]', e)
    }
  }
  return createLaunches(deps)
}

/** Électron accorde par défaut caméra, micro, position… à la page : seule l'écriture dans le presse-papiers sert à Player X (« Copier »). */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

function lockDown(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  // Version installée : plus de « Recharger » ni d'outils de développement, mais le zoom (Ctrl +, Ctrl -, Ctrl 0) et F11 restent.
  if (app.isPackaged)
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: 'Affichage', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }])
    )
}

// L'interface ne navigue jamais : aucune fenêtre ne doit quitter la page de Player X (lien, glisser-déposer, redirection).
// Seul le rechargement de la page elle-même passe (bouton « Recharger » après une erreur).
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e) => {
    if (e.url !== contents.getURL()) e.preventDefault()
  })
  contents.on('will-redirect', (e) => e.preventDefault())
  contents.on('will-attach-webview', (e) => e.preventDefault())
  // Aucune fenêtre ne s'ouvre d'elle-même (overlay, capture, pastille) ; la fenêtre principale pose ensuite son propre filtre.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

// Notifications Windows : même identifiant que l'installeur, sinon elles ne s'affichent pas.
if (process.platform === 'win32') app.setAppUserModelId('dev.breezy.playerx.v3test')

// Une seule instance : deux Player X ouverts écraseraient chacun la base de l'autre (temps de jeu relevé chaque minute).
const firstInstance = app.requestSingleInstanceLock()
if (!firstInstance) app.quit()
// Une deuxième ouverture montre la fenêtre déjà là ; avec `--launch=<id>` (liste de raccourcis de Windows), elle lance
// seulement le jeu.
app.on('second-instance', (_e, argv) => {
  const id = launchArgOf(argv)
  if (id && launches) return launchFromShortcut(id)
  const win = mainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.whenReady().then(async () => {
  if (!firstInstance) return
  await db.initDb()
  lockDown()
  launches = await startLaunches()
  // Avant le relevé du temps de jeu : à la mise en veille, les lancements s'arrêtent sans bruit avant qu'il ne coupe les sessions.
  powerMonitor.on('suspend', () => {
    launches.suspend()
    db.flushDb()
  })
  app.on('will-quit', () => {
    launches.shutdown()
    db.flushDb()
  })
  // Arrêt de la machine (Linux, macOS) ; sous Windows, la fenêtre reçoit « session-end » (voir createWindow).
  powerMonitor.on('shutdown', () => db.flushDb())
  process.on('exit', () => db.flushDb())
  registerIpc()
  startRoutines((gameId, launchId) => launches.start(gameId, sanitizeOpts({ via: 'play', ...(launchId ? { launchId } : {}) })))
  // Avant le suivi du temps de jeu : une session Battlefield 6 restée ouverte lit la dernière apparition du jeu.
  startBf6Recaps()
  // Avant le suivi du temps de jeu aussi : un match CS2 resté ouvert reprend si le jeu envoie encore.
  startCs2Live()
  startCs2Overlay()
  startClips()
  startPlaytimeTracker(notifyGamesChanged)
  startBf6Recorder()
  startCs2LifetimeRecorder()
  startNewsWatcher(newsGames, notifyGamesChanged)
  // Développement seulement : PX_NEWS_SIM simule les annonces Steam (newsSim.ts, jamais dans l'installeur).
  if (!app.isPackaged && process.env.PX_NEWS_SIM) {
    const mode = process.env.PX_NEWS_SIM
    import('./services/newsSim')
      .then(({ startNewsSim }) => {
        startNewsSim(mode)
        return refreshNewsIndex(newsGames())
      })
      .catch((e) => console.warn('[news-sim]', e))
  }
  onRareUnlocks(deliverRare)
  startAchievementsWatcher(() => getSettings().demoMode)
  // « Me prévenir » : les événements suivis qui commencent (vérifiés chaque minute).
  startEventReminders()
  // Prêt à jouer : une mise à jour Steam (ou un premier téléchargement) terminée prévient, si le réglage le permet.
  startSteamUpdates({
    demo: () => getSettings().demoMode,
    onReady: (appId, firstInstall) => {
      if (!getSettings().gameReadyAlert) return
      const game = findGame(`steam:${appId}`)
      if (game) deliverReady({ gameId: game.id, name: cleanName(game.name), firstInstall })
    }
  })
  // Développement seulement : PX_READY_SIM simule des mises à jour Steam, PX_SERVERS_SIM l'état des serveurs (jamais dans l'installeur).
  if (!app.isPackaged && process.env.PX_READY_SIM) {
    const mode = process.env.PX_READY_SIM
    import('./services/steamUpdatesSim').then(({ startSteamUpdatesSim }) => startSteamUpdatesSim(mode)).catch((e) => console.warn('[ready-sim]', e))
  }
  if (!app.isPackaged && process.env.PX_SERVERS_SIM) {
    const mode = process.env.PX_SERVERS_SIM
    import('./services/serversSim').then(({ startServersSim }) => startServersSim(mode)).catch((e) => console.warn('[servers-sim]', e))
  }
  // Un jeu installé avec « Installer » : nouveau scan, il passe des « Non installés » à la bibliothèque.
  startSteamLibrary(notifyGamesChanged, () => {
    games(true)
      .then(notifyGamesChanged)
      .catch(() => {})
  })
  // Premier lancement après l'installeur sur mesure : ses choix (Démarrer avec Windows), avant l'inscription au démarrage.
  applyInstallOptions()
  startTray()
  updateRunning()
  // Développement seulement : PX_BF6_SIM simule une partie de Battlefield 6 (bf6Sim.ts, jamais dans l'installeur).
  if (!app.isPackaged && process.env.PX_BF6_SIM) {
    const mode = process.env.PX_BF6_SIM
    import('./services/bf6Sim').then(({ startBf6Sim }) => startBf6Sim(mode)).catch((e) => console.warn('[bf6-sim]', e))
  }
  // Développement seulement : PX_CS2_SIM poste de faux envois de CS2 au serveur local (cs2Sim.ts, jamais dans l'installeur).
  if (!app.isPackaged && process.env.PX_CS2_SIM) {
    const mode = process.env.PX_CS2_SIM
    import('./services/cs2Sim').then(({ startCs2Sim }) => startCs2Sim(mode)).catch((e) => console.warn('[cs2-sim]', e))
  }
  createWindow()
  // Ouvert par la liste de raccourcis de Windows alors que Player X était fermé : le jeu demandé part tout de suite.
  const launchAtStart = launchArgOf(process.argv)
  if (launchAtStart) launchFromShortcut(launchAtStart)
  // En démo aussi, on récupère les vraies jaquettes des jeux fictifs.
  if (getSettings().demoMode) updateArtwork(DEMO_GAMES).then((changed) => changed && notifyGamesChanged()).catch((e) => logError('jaquettes', e))
  app.on('activate', () => appWindows().length === 0 && createWindow())
}).catch((e) => {
  // Démarrage raté (base illisible, disque plein…) : un message clair et l'appli se ferme. Sans ça, elle restait cachée,
  // gardait le verrou d'instance unique, et la relancer ne faisait plus rien.
  logError('démarrage', e)
  dialog.showErrorBox('Player X V3 Test n’a pas pu démarrer', `${e instanceof Error ? e.message : String(e)}\n\nLe détail est dans erreurs.log, dans ${app.getPath('userData')}.`)
  app.exit(1)
})

// Une promesse rejetée que personne n'attend : notée dans le journal au lieu de disparaître sans trace.
process.on('unhandledRejection', (e) => logError('promesse non gérée', e))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
