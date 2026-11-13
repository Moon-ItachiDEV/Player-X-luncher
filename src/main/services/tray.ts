import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, Notification, Tray } from 'electron'
import type { StartupState } from '@shared/types'
import { getKv, setKv } from '../db'
import { getSettings, saveSettings } from './settings'
import { mainWindow } from '../windows'
import { LAUNCH_ARG, menuLabel } from './recentGames'

// Zone de notification (près de l'horloge) : la croix y range Player X au lieu de le fermer, pour que le temps de jeu,
// les alertes d'amis et le bilan Battlefield 6 continuent. « Quitter » dans le menu de l'icône le ferme vraiment.
// Démarrage avec Windows : Player X se lance caché (--hidden), directement dans la zone de notification.

const HIDDEN_ARG = '--hidden'
/** La notification « Player X reste près de l'horloge » n'est montrée qu'une fois. */
const HINT_KEY = 'trayHintShown'

/** Lancé à l'ouverture de la session Windows : la fenêtre attend le premier clic sur l'icône. */
export const startHidden = process.argv.includes(HIDDEN_ARG)

/** Sur macOS, le Dock garde Player X ouvert : pas d'icône près de l'horloge. */
const SUPPORTED = process.platform !== 'darwin'

let tray: Tray | null = null
let quitting = false
let playing: string[] = []
/** Jeux récents (menu de l'icône, liste de raccourcis de Windows) et ce que fait un clic sur l'un d'eux. */
let recent: { id: string; name: string }[] = []
let onLaunch: (id: string) => void = () => {}
/** Gardée tant qu'elle vit, sinon son clic est perdu. */
let hint: Notification | null = null
let onHide = (): void => {}

/** Montre la fenêtre, qu'elle soit cachée, réduite ou derrière une autre. */
export function showMainWindow(): void {
  const win = mainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function refresh(): void {
  if (!tray) return
  tray.setToolTip(playing.length ? `Player X V3 Test · en jeu : ${playing.join(', ')}` : 'Player X V3 Test')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir Player X V3 Test', click: showMainWindow },
      ...(playing.length ? [{ type: 'separator' as const }, ...playing.map((name) => ({ label: menuLabel(`En jeu : ${name}`), enabled: false }))] : []),
      // Jeux récents : un clic lance le jeu comme le bouton Jouer, sans ouvrir la fenêtre.
      ...(recent.length
        ? [
            { type: 'separator' as const },
            { label: 'Jeux récents', enabled: false },
            ...recent.map((g) => ({ label: menuLabel(g.name), click: () => onLaunch(g.id) }))
          ]
        : []),
      { type: 'separator' },
      { label: 'Quitter Player X V3 Test', click: () => app.quit() }
    ])
  )
}

/**
 * Jeux récents : dans le menu de l'icône et dans la liste de raccourcis de Windows (clic droit sur Player X dans la
 * barre des tâches). Rien n'est refait si la liste n'a pas changé.
 */
export function setRecentGames(list: { id: string; name: string }[], launch: (id: string) => void): void {
  onLaunch = launch
  if (JSON.stringify(list) === JSON.stringify(recent)) return
  recent = list
  refresh()
  syncJumpList()
}

/**
 * Liste de raccourcis de Windows : la catégorie « Jeux récents ». Chaque entrée relance Player X avec `--launch=<id>` ;
 * l'instance déjà ouverte reçoit l'argument (second-instance) et lance le jeu. Version installée seulement : en
 * développement, l'exécutable est celui d'Electron.
 */
function syncJumpList(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  try {
    // Une entrée retirée à la main ne peut pas revenir : Windows refuserait alors toute la catégorie.
    const removed = new Set(app.getJumpListSettings().removedItems.map((i) => i.args ?? ''))
    const items = recent
      .filter((g) => !removed.has(`${LAUNCH_ARG}${g.id}`))
      .map((g) => ({
        type: 'task' as const,
        title: g.name,
        description: `Lancer ${g.name}`,
        program: process.execPath,
        args: `${LAUNCH_ARG}${g.id}`,
        iconPath: process.execPath,
        iconIndex: 0
      }))
    const result = app.setJumpList(items.length ? [{ type: 'custom', name: 'Jeux récents', items }] : null)
    if (result !== 'ok') console.warn('[jump-list]', result)
  } catch (e) {
    console.warn('[jump-list]', e)
  }
}

/** Jeux en cours, affichés dans le menu et l'infobulle de l'icône. */
export function setTrayPlaying(names: string[]): void {
  if (names.join('\n') === playing.join('\n')) return
  playing = names
  refresh()
}

function showHint(): void {
  if (getKv<boolean>(HINT_KEY, false) || !Notification.isSupported()) return
  setKv(HINT_KEY, true)
  hint = new Notification({
    title: 'Player X reste près de l’horloge',
    body: 'Il continue de suivre ton temps de jeu et tes amis. Pour le fermer : clic droit sur son icône, puis Quitter.',
    icon: join(app.getAppPath(), 'resources', 'icon.png')
  })
  hint.on('click', showMainWindow)
  hint.on('close', () => (hint = null))
  hint.show()
}

/** La croix range la fenêtre près de l'horloge (si le réglage le demande et que l'icône existe). */
export function attachWindow(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (quitting || !tray || !getSettings().closeToTray) return
    e.preventDefault()
    win.hide()
    onHide()
    showHint()
  })
  // Arrêt ou redémarrage de Windows : la fenêtre ne doit pas le retenir.
  win.on('query-session-end', () => (quitting = true))
  win.on('session-end', () => (quitting = true))
}

/** La croix vient de ranger la fenêtre : un choix de l'utilisateur, que la fin d'une partie ne défait pas. */
export function onHideToTray(cb: () => void): void {
  onHide = cb
}

/**
 * Choix faits dans l'installeur sur mesure (installer/, « Démarrer avec Windows ») : un fichier déposé dans le dossier de
 * Player X, appliqué au premier lancement puis supprimé. À appeler après l'ouverture de la base, avant startTray().
 */
export function applyInstallOptions(): void {
  const file = join(app.getPath('userData'), 'install-options.json')
  if (!existsSync(file)) return
  try {
    const o = JSON.parse(readFileSync(file, 'utf8')) as { startWithWindows?: unknown }
    if (typeof o.startWithWindows === 'boolean') saveSettings({ startWithWindows: o.startWithWindows })
  } catch (e) {
    console.warn('[install-options]', e)
  }
  try {
    unlinkSync(file)
  } catch {
    // Laissé en place : appliqué de nouveau au prochain lancement, sans dommage.
  }
}

/** Inscrit (ou retire) Player X des programmes lancés à l'ouverture de la session Windows. Version installée seulement. */
export function syncStartup(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: getSettings().startWithWindows, args: [HIDDEN_ARG] })
}

export function startupState(): StartupState {
  if (process.platform !== 'win32' || !app.isPackaged) return 'unavailable'
  if (!getSettings().startWithWindows) return 'off'
  // Désactivé dans le Gestionnaire des tâches › Applications de démarrage : Windows ne le lancera pas.
  return app.getLoginItemSettings({ args: [HIDDEN_ARG] }).executableWillLaunchAtLogin ? 'on' : 'blocked'
}

/** À appeler une fois, après `app.whenReady()`. */
export function startTray(): void {
  if (!SUPPORTED || tray) return
  // Toute fermeture voulue (menu, mise à jour, Windows) passe par before-quit : la croix ne doit plus la retenir.
  app.on('before-quit', () => (quitting = true))
  try {
    // tray.png et ses variantes @1.25x, @1.5x, @2x : la bonne taille pour chaque échelle d'affichage.
    tray = new Tray(join(app.getAppPath(), 'resources', 'tray.png'))
  } catch (e) {
    // Pas de zone de notification (certains bureaux Linux) : la croix ferme Player X, comme avant.
    console.warn('[tray]', e)
    return
  }
  tray.on('click', showMainWindow)
  refresh()
  syncStartup()
}
