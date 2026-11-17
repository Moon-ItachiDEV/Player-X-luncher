import { handle } from '../ipc'
import { majCancel, majCheck, majDownload, majInstall, majInstallCancel, majLater, majNotes, majNotesSeen, majOpenRelease, majRetry, majSkip, majState } from '../services/updater'

// Canaux des mises à jour (services/updater.ts). La page ne donne jamais d'adresse ni de chemin : tout est fixe côté
// processus principal. L'état part vers toutes les fenêtres par « maj:state ».

export function registerMajChannels(): void {
  handle('maj:state', () => majState())
  handle('maj:check', () => majCheck())
  handle('maj:download', () => majDownload())
  handle('maj:later', () => majLater())
  handle('maj:cancel', () => majCancel())
  handle('maj:install', () => majInstall())
  handle('maj:install-cancel', () => majInstallCancel())
  handle('maj:retry', () => majRetry())
  handle('maj:skip', () => majSkip())
  handle('maj:open-release', () => majOpenRelease())
  handle('maj:notes', (_e, review: unknown) => majNotes(review === true))
  handle('maj:notes-seen', () => majNotesSeen())
}
