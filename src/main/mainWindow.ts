import { join } from 'node:path'
import { app, BrowserWindow, screen, shell } from 'electron'
import { logError } from './crashLog'
import * as db from './db'
import { closeCs2Overlay } from './services/cs2Overlay'
import { attachWindow, startHidden } from './services/tray'

// La fenêtre principale : sa taille, son échelle, sa barre de titre. Les autres fenêtres (overlay CS2, capture des clips,
// pastille) sont créées par leur service ; windows.ts sait les distinguer.

/**
 * Taille au lancement : 1600 × 940, celle où l'accueil tient en entier sans défiler (choix de Breezydev, 25/10/2026),
 * réduite si l'écran est plus petit (zone de travail, barre des tâches comprise).
 */
function defaultSize(): { width: number; height: number } {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  return { width: Math.max(1024, Math.min(1600, width - 32)), height: Math.max(640, Math.min(940, height - 32)) }
}

export function createMainWindow(): void {
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
