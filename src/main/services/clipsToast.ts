import { BrowserWindow, screen } from 'electron'
import { markOverlay } from '../windows'

// Pastille « Clip gardé » : le raccourci se presse en plein jeu, Player X est derrière. Fenêtre sans clic, jamais filmée.

const TOAST_MS = 1800
const TOAST_W = 248
const TOAST_H = 72
let toastWin: BrowserWindow | null = null
let toastTimer: ReturnType<typeof setTimeout> | undefined

function toastPage(text: string, ok: boolean): string {
  const mark = ok ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1.3 1.3 3 3m6.4-3-3 3m-3.4 3.4-3 3m6.4-3 3 3"/></svg>' : ''
  const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Player X</title><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
body{display:flex;align-items:flex-start;justify-content:flex-end;padding:8px;box-sizing:border-box;font:500 14px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;color:#f6f1f4}
div{display:flex;align-items:center;gap:8px;height:48px;padding:0 16px;box-sizing:border-box;border-radius:16px;background:rgba(16,12,20,.92);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);animation:i .15s ease-out}
svg{width:16px;height:16px;fill:none;stroke:#ff5c8a;stroke-width:1.8;stroke-linecap:round}
@keyframes i{from{opacity:0}}
</style><div>${mark}${text}</div></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/** Le raccourci se presse en plein jeu, Player X est derrière : une pastille confirme, et la vidéo ne la montre pas. */
export function showClipToast(text: string, ok: boolean, displayId: number): void {
  clearTimeout(toastTimer)
  if (toastWin && !toastWin.isDestroyed()) toastWin.destroy()
  const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
  const w = new BrowserWindow({
    x: display.bounds.x + display.bounds.width - TOAST_W - 16,
    y: display.bounds.y + 16,
    width: TOAST_W,
    height: TOAST_H,
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
    title: 'Player X · clip',
    webPreferences: { sandbox: true, contextIsolation: true, devTools: false }
  })
  markOverlay(w)
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setIgnoreMouseEvents(true)
  w.setContentProtection(true)
  w.once('ready-to-show', () => {
    if (!w.isDestroyed()) w.showInactive()
  })
  void w.loadURL(toastPage(text, ok))
  toastWin = w
  toastTimer = setTimeout(() => {
    if (!w.isDestroyed()) w.destroy()
    if (toastWin === w) toastWin = null
  }, TOAST_MS)
}
