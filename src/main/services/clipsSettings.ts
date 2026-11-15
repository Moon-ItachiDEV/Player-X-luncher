import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import type { ClipSettings } from '@shared/types'
import { getKv, setKv } from '../db'
import { mainWindow } from '../windows'
import { errText, log } from './clipsLog'
import { cleanClipSettings, DEFAULT_CLIP_SETTINGS } from './clipsPlan'

// Les réglages des clips et leur dossier. Ce fichier est le seul à garder les réglages et à les écrire en base : le reste des
// clips les lit par clipSettings() et les remplace par storeClipSettings(). Les règles (valeurs permises, valeurs par défaut)
// sont dans clipsPlan.ts. Ce code vient de clips.ts, sans changement de comportement.

const SETTINGS_KEY = 'clipsSettings'

let current: ClipSettings = DEFAULT_CLIP_SETTINGS

/** Les réglages du moment. */
export const clipSettings = (): ClipSettings => current

/** Après l'ouverture de la base : les réglages enregistrés. */
export function loadClipSettings(): void {
  current = cleanClipSettings(getKv<unknown>(SETTINGS_KEY, {}))
}

/** Remplace les réglages et les enregistre. */
export function storeClipSettings(next: ClipSettings): void {
  current = next
  setKv(SETTINGS_KEY, current)
}

const userData = (...p: string[]): string => join(app.getPath('userData'), ...p)
function defaultFolder(): string {
  try {
    return join(app.getPath('videos'), 'Player X V3 Test')
  } catch {
    // Dossier Vidéos introuvable sur ce PC.
    return userData('Clips')
  }
}
export const folderOf = (s: ClipSettings): string => s.folder || defaultFolder()
export const resolved = (s: ClipSettings): ClipSettings => ({ ...s, folder: folderOf(s) })

/** Le dossier des réglages, sinon celui par défaut (clé USB retirée, droits). */
export async function usableFolder(): Promise<string> {
  const wanted_ = folderOf(current)
  try {
    await mkdir(wanted_, { recursive: true })
    return wanted_
  } catch (e) {
    log(`Dossier ${wanted_} inutilisable : ${errText(e)}`)
    const fallback = defaultFolder()
    await mkdir(fallback, { recursive: true })
    return fallback
  }
}

export async function chooseFolder(): Promise<ClipSettings | null> {
  const parent = mainWindow()
  const options: Electron.OpenDialogOptions = { title: 'Dossier des clips', defaultPath: folderOf(current), properties: ['openDirectory', 'createDirectory'] }
  const res = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options))
  if (res.canceled || !res.filePaths[0]) return null
  current = { ...current, folder: res.filePaths[0] }
  setKv(SETTINGS_KEY, current)
  log('Dossier des clips changé.')
  return resolved(current)
}
