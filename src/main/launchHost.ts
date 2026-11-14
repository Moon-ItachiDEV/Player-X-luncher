import { app, powerMonitor } from 'electron'
import type { LaunchStatus } from '@shared/launch'
import * as db from './db'
import { broadcast, mainWindow } from './windows'
import { handoff, launchTarget } from './services/games'
import { createLaunches, sanitizeOpts, type LaunchDeps, type Launches, type LaunchWindow, type Timers } from './services/launches'
import { createWatcher } from './services/launchWatch'
import { newMatches } from './services/launchWatchParse'
import { games, notifyGamesChanged, recordDemoLaunch, setLaunchSim, setShortcutLauncher } from './services/library'
import { getSettings } from './services/settings'
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
  storeWasRunning
} from './services/playtime'
import { onHideToTray, showMainWindow } from './services/tray'

// Le lancement d'un jeu, branché sur la vraie appli : services/launches.ts ne connaît ni Electron ni Windows, il reçoit
// tout d'ici (la fenêtre, le relevé des programmes, la bibliothèque, la base). Sorti de index.ts.

/** Lancements de jeux (services/launches.ts). Créés au démarrage, avant les canaux. */
let launches: Launches

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
export function launchFromShortcut(id: string): void {
  launches
    .start(id, sanitizeOpts({ via: 'play' }))
    .then((s) => {
      if (s.phase === 'failed') showMainWindow()
    })
    .catch(() => showMainWindow())
}

/** En développement, PX_LAUNCH_SIM branche le vrai orchestrateur sur un faux Windows (launchSim.ts, jamais dans l'installeur). */
async function createFor(deps: LaunchDeps): Promise<Launches> {
  const mode = app.isPackaged ? undefined : process.env.PX_LAUNCH_SIM
  if (mode) {
    try {
      const { createLaunchSim } = await import('./launchSim')
      const sim = createLaunchSim(mode, deps, process.env.PX_LAUNCH_SIM_FAST === '1')
      setLaunchSim(sim)
      sim.onChange(notifyGamesChanged)
      return sim.launches
    } catch (e) {
      console.error('[launch]', e)
    }
  }
  return createLaunches(deps)
}

/** À appeler une fois, au démarrage, avant les canaux. À partir de là, l'icône et la liste de raccourcis peuvent lancer un jeu. */
export async function startLaunches(): Promise<Launches> {
  launches = await createFor(launchDeps())
  setShortcutLauncher(launchFromShortcut)
  return launches
}
