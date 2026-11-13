import { join } from 'node:path'
import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import { CS2_GAME_ID } from '@shared/cs2'
import type { Cs2OverlayConfig } from '@shared/types'
import { hotkeyRefusal } from '../hotkeys'
import { handle } from '../ipc'
import { appWindows, isOverlay, markOverlay } from '../windows'
import { cs2IsRunning, onCs2Running } from './cs2Live'
import { gamePids, pidAlive, pollNow } from './playtime'
import { getSettings } from './settings'

// Overlay CS2 (bêta) : une fenêtre transparente posée par-dessus le jeu, qui ne prend jamais les clics ni le clavier et
// n'est jamais au premier plan à la place du jeu. Rien n'est injecté dans CS2 : c'est une fenêtre de Player X, visible
// quand le jeu est en « plein écran fenêtré » (Windows ne montre rien devant un jeu en plein écran exclusif).
// Elle n'existe que pendant que CS2 tourne (ou pendant un aperçu lancé depuis Paramètres). Ce qu'elle affiche vient des
// mêmes envois que la fiche (cs2:live, cs2:recap) ; son style et son raccourci (Alt+X par défaut, réglable dans
// Paramètres › Overlay) passent par cs2:overlay-config.

/** Aperçu depuis Paramètres : le temps de voir les quatre pièces. */
const PREVIEW_MS = 24_000

let win: BrowserWindow | null = null
let hidden = false
let previewAt: number | undefined
let previewTimer: ReturnType<typeof setTimeout> | undefined
/** Le raccourci pris en ce moment (accélérateur), null si aucun. */
let hotkey: string | null = null
/** Raccourci refusé par Windows à la dernière tentative : pas de nouvel essai tant qu'il ne change pas. */
let hotkeyRefused: string | null = null
/** Une fenêtre de Player X a le focus : l'overlay s'efface pour ne pas la couvrir. */
let appFocused = false
/**
 * CS2 fermé : sans ça, la fenêtre restait jusqu'au relevé suivant des programmes (une fois par minute), et la dernière
 * carte pouvait rester sur le bureau. Tant que l'overlay est ouvert, on teste toutes les 3 s si les PID de CS2 vivent
 * encore (gratuit) ; s'ils sont tous partis, un relevé complet tout de suite le confirme et ferme l'overlay.
 */
const EXIT_CHECK_MS = 3_000
/** Relevé complet au plus toutes les 15 s si le premier n'a pas suffi (PowerShell lent ou en panne). */
const EXIT_POLL_GAP_MS = 15_000
let exitTimer: ReturnType<typeof setInterval> | undefined
let exitPolledAt = 0

// Proposé à tout le monde depuis la 0.9.1 (avant : canal Bêta et versions de test seulement). Désactivé par défaut.
function config(): Cs2OverlayConfig {
  // L'aperçu se lance depuis Paramètres, donc Player X au premier plan : il se voit quand même.
  return {
    style: getSettings().cs2Overlay,
    hidden: hidden || (appFocused && previewAt === undefined),
    hotkey: getSettings().overlayHotkey,
    ...(previewAt !== undefined ? { previewAt } : {})
  }
}

function send(): void {
  if (win && !win.isDestroyed()) win.webContents.send('cs2:overlay-config', config())
}

function wanted(): boolean {
  return config().style !== 'off' && (cs2IsRunning() || previewAt !== undefined)
}

function create(): void {
  // L'écran principal en entier : CS2 en plein écran fenêtré le couvre.
  const { bounds } = screen.getPrimaryDisplay()
  const w = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Player X · overlay',
    webPreferences: {
      // Son propre pont (preload/overlay.ts) : les envois cs2:* de la page, rien d'autre.
      preload: join(__dirname, '../preload/overlay.js'),
      sandbox: true,
      contextIsolation: true,
      devTools: !app.isPackaged,
      backgroundThrottling: false
    }
  })
  markOverlay(w)
  // Au-dessus d'une fenêtre de jeu en plein écran fenêtré.
  w.setAlwaysOnTop(true, 'screen-saver')
  // Les clics traversent : la souris reste au jeu.
  w.setIgnoreMouseEvents(true)
  // Affichée seulement quand la page a peint son fond transparent (cs2:overlay-ready), jamais le fond de l'appli.
  w.on('closed', () => win === w && (win = null))
  // renderer/index.html ne sert qu'à l'overlay (la fenêtre principale charge renderer/v3/index.html).
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  if (devUrl) void w.loadURL(devUrl)
  else void w.loadFile(join(__dirname, '../renderer/index.html'))
  win = w
}

function destroy(): void {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}

/**
 * Le raccourci choisi (Alt+X par défaut) masque ou réaffiche l'overlay. Pris seulement pendant que l'overlay existe, pour
 * ne gêner aucun autre jeu ; changé dans Paramètres, il est remplacé tout de suite.
 */
function syncHotkey(): void {
  const want = win ? getSettings().overlayHotkey : null
  if (want === hotkey || (want !== null && want === hotkeyRefused)) return
  if (hotkey) globalShortcut.unregister(hotkey)
  hotkey = null
  hotkeyRefused = null
  if (!want) return
  try {
    if (
      globalShortcut.register(want, () => {
        hidden = !hidden
        send()
      })
    )
      hotkey = want
    else {
      hotkeyRefused = want
      console.warn('[cs2] raccourci de l’overlay déjà pris :', want)
    }
  } catch (e) {
    hotkeyRefused = want
    console.warn('[cs2] raccourci de l’overlay refusé :', want, e)
  }
}

/** Avant d'enregistrer un nouveau raccourci : est-il valable et libre ? null si oui, sinon la raison à afficher. */
function checkHotkey(accel: unknown): string | null {
  // Déjà le nôtre (overlay ouvert avec ce raccourci) : rien à vérifier.
  return hotkeyRefusal(accel, hotkey)
}

function checkExit(): void {
  const pids = gamePids(CS2_GAME_ID)
  if (!pids.length || pids.some(pidAlive)) return
  const now = Date.now()
  if (now - exitPolledAt < EXIT_POLL_GAP_MS) return
  exitPolledAt = now
  void pollNow()
}

function syncExitWatch(): void {
  const need = !!win && cs2IsRunning()
  if (need && !exitTimer) exitTimer = setInterval(checkExit, EXIT_CHECK_MS)
  else if (!need && exitTimer) {
    clearInterval(exitTimer)
    exitTimer = undefined
    exitPolledAt = 0
  }
}

/** Ouvre ou ferme la fenêtre selon le réglage, CS2 et l'aperçu ; sinon prévient la fenêtre d'un changement de réglage. */
export function syncCs2Overlay(): void {
  if (wanted() && !win) create()
  else if (!wanted() && win) destroy()
  else send()
  syncHotkey()
  syncExitWatch()
}

function preview(): void {
  clearTimeout(previewTimer)
  previewAt = Date.now()
  hidden = false
  syncCs2Overlay()
  previewTimer = setTimeout(() => {
    previewAt = undefined
    syncCs2Overlay()
  }, PREVIEW_MS)
}

export function startCs2Overlay(): void {
  handle('cs2:overlay-config', () => config())
  handle('cs2:overlay-preview', () => preview())
  handle('cs2:overlay-hotkey-check', (_e, accel: unknown) => checkHotkey(accel))
  handle('cs2:overlay-ready', (e) => {
    if (win && !win.isDestroyed() && e.sender === win.webContents && !win.isVisible()) win.showInactive()
  })
  // Player X au premier plan (fenêtre principale) : l'overlay ne la couvre pas. Il revient quand on retourne au jeu.
  app.on('browser-window-focus', (_e, w) => {
    if (isOverlay(w) || appFocused) return
    appFocused = true
    send()
  })
  app.on('browser-window-blur', () => {
    setTimeout(() => {
      const now = appWindows().some((w) => w.isFocused())
      if (now === appFocused) return
      appFocused = now
      send()
    }, 0)
  })
  onCs2Running((now) => {
    // Nouvelle partie : l'overlay revient visible.
    if (now) hidden = false
    syncCs2Overlay()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  syncCs2Overlay()
}

/** La fenêtre principale se ferme (pas rangée près de l'horloge) : l'overlay part avec elle, sinon l'appli ne quitte pas. */
export function closeCs2Overlay(): void {
  clearTimeout(previewTimer)
  previewAt = undefined
  destroy()
  syncHotkey()
  syncExitWatch()
}
