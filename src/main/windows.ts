import { BrowserWindow } from 'electron'

// Fenêtres de Player X : la fenêtre principale, et la fenêtre de l'overlay CS2 (services/cs2Overlay.ts), transparente et
// sans clic, posée par-dessus le jeu. Tout ce qui parle de « la fenêtre » (zone de notification, lancement, bilans, mises à
// jour, alertes) vise la principale : jamais l'overlay.

const overlays = new WeakSet<BrowserWindow>()

/** À appeler dès la création de la fenêtre de l'overlay. */
export function markOverlay(w: BrowserWindow): void {
  overlays.add(w)
}

export function isOverlay(w: BrowserWindow): boolean {
  return overlays.has(w)
}

/** Fenêtres de l'appli (sans l'overlay), encore ouvertes. */
export function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !overlays.has(w))
}

/** La fenêtre principale, si elle existe. */
export function mainWindow(): BrowserWindow | undefined {
  return appWindows()[0]
}

/** Envoie un message à une fenêtre ; une fenêtre fermée ou en plein rechargement est sautée sans erreur (elle relira l'état). */
export function sendTo(w: BrowserWindow | undefined, channel: string, payload?: unknown): void {
  if (!w || w.isDestroyed()) return
  try {
    w.webContents.send(channel, payload)
  } catch {
    /* fenêtre détruite ou page en plein rechargement */
  }
}

/** Envoie un message à toutes les fenêtres de l'appli ; l'overlay et ses fenêtres sœurs seulement si `overlay` est vrai. */
export function broadcast(channel: string, payload?: unknown, opts: { overlay?: boolean } = {}): void {
  for (const w of opts.overlay ? BrowserWindow.getAllWindows() : appWindows()) sendTo(w, channel, payload)
}

/** La fenêtre de l'appli que la personne regarde en ce moment (au premier plan, visible, pas réduite). */
export function focusedAppWindow(): BrowserWindow | undefined {
  return appWindows().find((w) => w.isFocused() && w.isVisible() && !w.isMinimized())
}

/** Ramène la fenêtre principale au premier plan (clic sur une notification Windows), puis lui envoie le message. */
export function showMainAndSend(channel: string, payload?: unknown): void {
  const w = mainWindow()
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
  sendTo(w, channel, payload)
}
