import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { trustedUrl } from './trust'
import { isOverlay } from './windows'

/** Seule la page de Player X, dans le cadre principal d'une de ses fenêtres, peut appeler le processus principal. */
export function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame
  if (!frame || frame.parent !== null || !BrowserWindow.fromWebContents(e.sender)) return false
  return trustedUrl(frame.url, !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined)
}

/** Comme `ipcMain.handle`, mais refuse les appels qui ne viennent pas de la page de l'appli. */
export function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Appel refusé.')
    // L'overlay CS2 n'a besoin que de ses envois : rien d'autre (réglages, lancement, liens) depuis sa fenêtre.
    const from = BrowserWindow.fromWebContents(event.sender)
    if (from && isOverlay(from) && !channel.startsWith('cs2:')) throw new Error('Appel refusé.')
    return listener(event, ...args)
  })
}
