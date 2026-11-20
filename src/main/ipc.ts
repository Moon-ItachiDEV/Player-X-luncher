import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { logError } from './crashLog'
import { unexpectedFailure } from './ipcRules'
import { trustedUrl } from './trust'
import { isAuxiliary, isOverlay } from './windows'

const RENDERER_ROOT = join(__dirname, '../renderer')

/** Seule la page de Player X, dans le cadre principal d'une de ses fenêtres, peut appeler le processus principal. */
export function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame
  if (!frame || frame.parent !== null || !BrowserWindow.fromWebContents(e.sender)) return false
  return trustedUrl(frame.url, !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined, RENDERER_ROOT)
}

/** Un appel refusé n'arrive jamais dans une appli saine : il est noté (une page étrangère, ou une adresse de page que `trustedUrl` ne reconnaît plus). */
function refuse(channel: string, e: IpcMainInvokeEvent, why: string): never {
  logError('appel refusé', `${channel} : ${why} (${e.senderFrame?.url ?? 'page inconnue'})`)
  throw new Error('Appel refusé.')
}

/**
 * Comme `ipcMain.handle`, mais refuse les appels qui ne viennent pas de la page de l'appli. Ce que la page envoie arrive en
 * `unknown` : chaque récepteur vérifie ce qu'il reçoit avant de s'en servir, le compilateur n'accepte plus l'inverse.
 */
export function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) refuse(channel, event, 'page non reconnue')
    const from = BrowserWindow.fromWebContents(event.sender)
    // Fenêtres auxiliaires (capture cachée, pastille) : aucun canal handle() autorisé.
    if (from && isAuxiliary(from)) refuse(channel, event, 'canal fermé aux fenêtres auxiliaires')
    // L'overlay CS2 n'a besoin que de ses envois : rien d'autre (réglages, lancement, liens) depuis sa fenêtre.
    if (from && isOverlay(from) && !channel.startsWith('cs2:')) refuse(channel, event, 'canal fermé à l’overlay')
    try {
      return await listener(event, ...args)
    } catch (e) {
      // Un refus écrit pour la personne part vers l'interface, comme avant. Une panne inattendue (bogue, disque) y part aussi,
      // mais elle est d'abord notée dans erreurs.log avec son canal : avant, il n'en restait aucune trace.
      if (unexpectedFailure(e)) logError(`canal ${channel}`, e)
      throw e
    }
  })
}
