// Canaux des clips : liste, gestion, copie Discord, découpage, réglages, écrans et journal.
import { handle } from '../ipc'
import { clipDisplays, saveClipSettings } from '../services/clips'
import { copyFile, shareClip } from '../services/clipsCopy'
import { deleteClip, listClips, openFolder, pinClip, renameClip, trimClip } from '../services/clipsIndex'
import { logTail } from '../services/clipsLog'
import { chooseFolder, clipSettings, resolved } from '../services/clipsSettings'
import { stateNow } from '../services/clipsState'

export function registerClipsChannels(): void {
  handle('clips:list', () => listClips())
  handle('clips:delete', (_e, id: unknown) => deleteClip(id))
  handle('clips:rename', (_e, id: unknown, name: unknown) => renameClip(id, name))
  handle('clips:pin', (_e, id: unknown, on: unknown) => pinClip(id, on))
  handle('clips:open-folder', (_e, id: unknown) => openFolder(id))
  handle('clips:copy-file', (_e, id: unknown) => copyFile(id))
  handle('clips:share', (_e, id: unknown) => shareClip(id))
  handle('clips:trim', (_e, id: unknown, startS: unknown, endS: unknown) => trimClip(id, startS, endS))
  handle('clips:state', () => stateNow())
  handle('clips:settings-get', () => resolved(clipSettings()))
  handle('clips:settings-save', (_e, patch: unknown) => saveClipSettings(patch))
  handle('clips:choose-folder', () => chooseFolder())
  handle('clips:displays', () => clipDisplays())
  handle('clips:log-tail', () => logTail())
}
