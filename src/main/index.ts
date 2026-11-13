import { join } from 'node:path'
import { app, dialog, powerMonitor } from 'electron'
import { cleanName } from '@shared/text'
import { logError } from './crashLog'
import * as db from './db'
import { launchFromShortcut, startLaunches } from './launchHost'
import { createMainWindow } from './mainWindow'
import { lockDown, lockNavigation } from './security'
import { appWindows, mainWindow } from './windows'
import { onRareUnlocks, startAchievementsWatcher } from './services/achievements'
import { deliverRare, deliverReady } from './services/alerts'
import { updateArtwork } from './services/artwork'
import { startBf6Recaps } from './services/bf6Recap'
import { gameRunning, newestClipSource, startClips } from './services/clips'
import { startCs2LifetimeRecorder } from './services/cs2Lifetime'
import { startCs2Live } from './services/cs2Live'
import { startCs2Overlay } from './services/cs2Overlay'
import { DEMO_GAMES } from './services/demo'
import { setEngineHost } from './services/editFfmpeg'
import { startEventReminders } from './services/events'
import { sanitizeOpts, type Launches } from './services/launches'
import {
  demoFriends,
  demoState,
  fetchOwnedArtwork,
  findGame,
  games,
  knownGames,
  newsGames,
  notifyGamesChanged,
  rescanNextTime,
  updateRunning
} from './services/library'
import { refreshNewsIndex, startNewsWatcher } from './services/news'
import { startPlaytimeTracker } from './services/playtime'
import { launchArgOf } from './services/recentGames'
import { startRoutines } from './services/routines'
import { allowDemo, getSettings } from './services/settings'
import { startBf6Recorder } from './services/stats'
import { startSteamLibrary } from './services/steamLibrary'
import { startSteamUpdates } from './services/steamUpdates'
import { applyInstallOptions, startTray } from './services/tray'
import type { ChannelDeps } from './channels/deps'
import { registerAccountChannels } from './channels/account'
import { registerEditChannels } from './channels/edit'
import { registerFriendChannels } from './channels/friends'
import { registerLibraryChannels } from './channels/library'
import { registerPlayChannels } from './channels/play'

// Le démarrage de Player X, et rien d'autre : ce fichier dit dans quel ordre les services partent et comment l'appli se
// ferme. Le reste a son fichier : la fenêtre (mainWindow.ts), ce que les pages n'ont pas le droit de faire (security.ts), la
// bibliothèque (services/library.ts), le lancement d'un jeu (launchHost.ts), les canaux (channels/).

// Bêta 37 : sous Windows, la capture d'écran passe par Windows.Graphics.Capture (celle d'OBS « capture Windows 10 ») au lieu
// de la copie de bureau DXGI, choix par défaut de Chromium. Mesuré en bêta 36 sur le PC de Breezydev (CS2, 2560 × 1440) :
// l'écran ne livrait que 27 à 50 images/s sur 60, aucune perdue ensuite. Fonction de Chromium désactivée par défaut
// (media/webrtc/webrtc_features.cc : AllowWgcScreenCapturer) ; sans effet ailleurs que sous Windows.
if (process.platform === 'win32') app.commandLine.appendSwitch('enable-features', 'AllowWgcScreenCapturer')

// .env : clés de développement seulement, jamais lu par la version installée.
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

/** Lancements de jeux (services/launches.ts, branchés par launchHost.ts). Créés avant les canaux, au démarrage. */
let launches: Launches

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
    rescan: rescanNextTime
  }
  registerLibraryChannels(d)
  registerFriendChannels(d)
  registerAccountChannels(d)
  registerPlayChannels(d)
  registerEditChannels()
}

lockNavigation()

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
  // Arrêt de la machine (Linux, macOS) ; sous Windows, la fenêtre reçoit « session-end » (voir mainWindow.ts).
  powerMonitor.on('shutdown', () => db.flushDb())
  process.on('exit', () => db.flushDb())
  // Le moteur vidéo ne connaît pas la capture des clips : elle lui est présentée ici (un jeu tourne-t-il ? quel est le dernier clip ?).
  setEngineHost({ gameRunning, newestClipSource })
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
  createMainWindow()
  // Ouvert par la liste de raccourcis de Windows alors que Player X était fermé : le jeu demandé part tout de suite.
  const launchAtStart = launchArgOf(process.argv)
  if (launchAtStart) launchFromShortcut(launchAtStart)
  // En démo aussi, on récupère les vraies jaquettes des jeux fictifs.
  if (getSettings().demoMode) updateArtwork(DEMO_GAMES).then((changed) => changed && notifyGamesChanged()).catch((e) => logError('jaquettes', e))
  app.on('activate', () => appWindows().length === 0 && createMainWindow())
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
