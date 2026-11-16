import { join } from 'node:path'
import { app, BrowserWindow, globalShortcut, screen, type IpcMainInvokeEvent } from 'electron'
import { CS2_GAME_ID } from '@shared/cs2'
import type { Cs2OverlayConfig, Cs2OverlayMoment, Cs2OverlayPlace, Cs2OverlayThree } from '@shared/types'
import { hotkeyRefusal } from '../hotkeys'
import { handle } from '../ipc'
import { appWindows, isOverlay, mainWindow, markOverlay, sendTo } from '../windows'
import { cs2IsRunning, onCs2Running } from './cs2Live'
import { gamePids, pidAlive, pollNow } from './playtime'
import { getSettings, saveSettings } from './settings'
import { OVERLAY_POS_KEY } from './settingsRules'

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

/**
 * Réglage en plein écran (0.6.2) : la fenêtre de l'overlay montre Dust II et le vrai bloc, prend la souris et le clavier,
 * et enregistre la place et l'échelle de chaque bloc. Fini par « Terminé » ou Échap ; au bout de 20 min sans fin, il se
 * ferme seul (la fenêtre ne doit pas rester devant le bureau).
 */
const EDIT_MS = 20 * 60_000
const THREE: readonly string[] = ['etendard', 'viseur', 'regie']
const MOMENTS: readonly string[] = ['buy', 'pill', 'half', 'end']
let editing: { style: Cs2OverlayThree; moment: Cs2OverlayMoment } | undefined
let editTimer: ReturnType<typeof setTimeout> | undefined
/** Échap pris pendant l'aperçu et le réglage seulement : il les ferme tout de suite. */
let escTaken = false

/** Un réglage enregistré avant la 0.6.1 peut encore dire 'a' ou 'b' (Apple, Verre) : il devient le style Player X. */
function overlayStyle(s: string): Cs2OverlayConfig['style'] {
  return s === 'off' || s === 'etendard' || s === 'viseur' || s === 'regie' ? s : 'c'
}

// Proposé à tout le monde depuis la 0.9.1 (avant : canal Bêta et versions de test seulement). Désactivé par défaut.
function config(): Cs2OverlayConfig {
  // L'aperçu se lance depuis Paramètres, donc Player X au premier plan : il se voit quand même.
  return {
    style: overlayStyle(getSettings().cs2Overlay),
    size: getSettings().overlaySize ?? 'n',
    pos: getSettings().overlayPos ?? {},
    hidden: !editing && (hidden || (appFocused && previewAt === undefined)),
    hotkey: getSettings().overlayHotkey,
    ...(previewAt !== undefined ? { previewAt } : {}),
    ...(editing ? { edit: { ...editing } } : {})
  }
}

function send(): void {
  if (win && !win.isDestroyed()) win.webContents.send('cs2:overlay-config', config())
}

function wanted(): boolean {
  return !!editing || (config().style !== 'off' && (cs2IsRunning() || previewAt !== undefined))
}

/** Pendant le réglage, la fenêtre prend la souris et le clavier ; sinon les clics traversent jusqu'au jeu. */
function syncEditWin(): void {
  if (!win || win.isDestroyed()) return
  if (editing) {
    win.setIgnoreMouseEvents(false)
    win.setFocusable(true)
    if (win.isVisible()) win.focus()
  } else {
    win.setIgnoreMouseEvents(true)
    win.setFocusable(false)
  }
}

/** Échap ferme l'aperçu ou le réglage : pris seulement pendant ces moments-là, rendu ensuite aux autres applis. */
function syncEsc(): void {
  const want = previewAt !== undefined || !!editing
  if (want === escTaken) return
  if (want) {
    try {
      escTaken = globalShortcut.register('Escape', () => {
        if (editing) endEdit()
        else endPreview()
      })
    } catch {
      escTaken = false
    }
  } else {
    globalShortcut.unregister('Escape')
    escTaken = false
  }
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
  syncEditWin()
  syncHotkey()
  syncExitWatch()
  syncEsc()
}

function endPreview(): void {
  clearTimeout(previewTimer)
  if (previewAt === undefined) return
  previewAt = undefined
  syncCs2Overlay()
}

function preview(): void {
  clearTimeout(previewTimer)
  if (editing) return
  previewAt = Date.now()
  hidden = false
  syncCs2Overlay()
  previewTimer = setTimeout(endPreview, PREVIEW_MS)
}

function startEdit(style: unknown, moment: unknown): void {
  if (typeof style !== 'string' || !THREE.includes(style) || typeof moment !== 'string' || !MOMENTS.includes(moment)) throw new Error('Réglage inconnu.')
  clearTimeout(previewTimer)
  previewAt = undefined
  hidden = false
  editing = { style: style as Cs2OverlayThree, moment: moment as Cs2OverlayMoment }
  clearTimeout(editTimer)
  editTimer = setTimeout(endEdit, EDIT_MS)
  syncCs2Overlay()
}

function endEdit(): void {
  clearTimeout(editTimer)
  if (!editing) return
  editing = undefined
  syncCs2Overlay()
  // Paramètres relit les places et le style, et revient au premier plan.
  const main = mainWindow()
  sendTo(main, 'cs2:overlay-config', config())
  if (main && !main.isDestroyed()) main.focus()
}

/** Seule la page de l'overlay, pendant le réglage, peut enregistrer une place. */
function fromEditor(e: IpcMainInvokeEvent): boolean {
  return !!editing && !!win && !win.isDestroyed() && e.sender === win.webContents
}

function place(key: unknown, value: unknown): void {
  if (typeof key !== 'string' || !OVERLAY_POS_KEY.test(key)) throw new Error('Bloc inconnu.')
  const pos = { ...(getSettings().overlayPos ?? {}) }
  if (value === null) delete pos[key]
  else if (Array.isArray(value)) pos[key] = value as Cs2OverlayPlace
  else throw new Error('Place illisible.')
  // saveSettings la nettoie (bornes, arrondis) ; la page reçoit la place gardée.
  saveSettings({ overlayPos: pos })
  send()
}

function editStyle(style: unknown): void {
  if (!editing || typeof style !== 'string' || !THREE.includes(style)) throw new Error('Style inconnu.')
  editing = { ...editing, style: style as Cs2OverlayThree }
  // Overlay allumé : le style essayé devient le sien. Coupé : il reste coupé (Paramètres garde le choix pour plus tard).
  if (getSettings().cs2Overlay !== 'off') saveSettings({ cs2Overlay: editing.style })
  send()
}

export function startCs2Overlay(): void {
  handle('cs2:overlay-config', () => config())
  handle('cs2:overlay-preview', () => preview())
  handle('cs2:overlay-edit', (e, style: unknown, moment: unknown) => {
    if (win && e.sender === win.webContents) throw new Error('Appel refusé.')
    startEdit(style, moment)
  })
  handle('cs2:overlay-place', (e, key: unknown, value: unknown) => {
    if (!fromEditor(e)) throw new Error('Appel refusé.')
    place(key, value)
  })
  handle('cs2:overlay-edit-style', (e, style: unknown) => {
    if (!fromEditor(e)) throw new Error('Appel refusé.')
    editStyle(style)
  })
  handle('cs2:overlay-edit-end', (e) => {
    if (!fromEditor(e)) throw new Error('Appel refusé.')
    endEdit()
  })
  handle('cs2:overlay-hotkey-check', (_e, accel: unknown) => checkHotkey(accel))
  handle('cs2:overlay-ready', (e) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents || win.isVisible()) return
    // Réglage : la fenêtre passe au premier plan pour prendre la souris et le clavier ; sinon elle ne vole jamais le focus.
    if (editing) {
      win.show()
      win.focus()
    } else win.showInactive()
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
  clearTimeout(editTimer)
  previewAt = undefined
  editing = undefined
  destroy()
  syncHotkey()
  syncExitWatch()
  syncEsc()
}
