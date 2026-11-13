import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { dirname, basename, extname } from 'node:path'
import { dialog, globalShortcut, shell } from 'electron'
import type { Routine, RoutineStatus, RoutineStep } from '@shared/routines'
import { getKv, setKv } from '../db'
import { broadcast, mainWindow } from '../windows'
import { appKey, batArgs, cleanRoutine, isAppPath, MAX_ROUTINES, savedApps } from './routineRules'
import { getSettings } from './settings'

// Routines : ce qui se passe quand tu appuies sur Jouer, dans l'ordre que tu veux. Une étape ratée n'arrête pas la suite ;
// une seule routine à la fois. Le chemin d'une appli vient du sélecteur de fichiers natif, jamais d'un texte libre :
// les règles (routineRules.ts) refusent une appli qui n'en sort pas.

export type { Routine, RoutineStatus, RoutineStep } from '@shared/routines'

const KEY = 'v3Routines'
const HOTKEYS = ['Control+Alt+F1', 'Control+Alt+F2', 'Control+Alt+F3']

/** Applis choisies avec le sélecteur natif pendant cette session. */
const picked = new Set<string>()

export const getRoutines = (): Routine[] => getKv<Routine[]>(KEY, [])

export function saveRoutines(list: unknown): Routine[] {
  const approved = new Set([...picked, ...savedApps(getRoutines())])
  const clean = (Array.isArray(list) ? list : [])
    .map((r) => cleanRoutine(r, approved))
    .filter((r): r is Routine => !!r)
    .slice(0, MAX_ROUTINES)
  setKv(KEY, clean)
  syncHotkeys()
  return clean
}

/** Sélecteur de fichiers natif : la seule façon d'ajouter une appli à une routine. */
export async function chooseRoutineApp(): Promise<{ path: string; name: string } | null> {
  const win = mainWindow()
  const opts: Electron.OpenDialogOptions = { title: 'Choisir une appli', properties: ['openFile'], filters: [{ name: 'Applications', extensions: ['exe', 'lnk', 'bat', 'cmd'] }] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const path = res.canceled ? undefined : res.filePaths[0]
  if (!path || !isAppPath(path)) return null
  picked.add(appKey(path))
  return { path, name: basename(path, extname(path)) }
}

// ---------- exécution ----------

let launchGame: (gameId: string, launchId?: string) => Promise<unknown> = async () => {}
let running = false

function emit(s: RoutineStatus): void {
  broadcast('routines:status', s)
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function runApp(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (/\.lnk$/i.test(path)) {
      shell.openPath(path).then((err) => (err ? reject(new Error(err)) : resolve()), reject)
      return
    }
    const bat = /\.(bat|cmd)$/i.test(path)
    const args = bat ? batArgs(path) : []
    if (!args) {
      reject(new Error('Chemin refusé'))
      return
    }
    // .bat et .cmd : le chemin passe entre guillemets à cmd.exe, sans que Node le retouche (& et ^ restent du texte).
    const child = bat
      ? spawn(process.env.ComSpec || 'cmd.exe', args, { cwd: dirname(path), detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
      : spawn(path, [], { cwd: dirname(path), detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function taskkill(name: string, force: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('taskkill', [...(force ? ['/F'] : []), '/T', '/IM', name], { stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('close', () => resolve())
  })
}

const stepLabel = (s: RoutineStep): string => {
  if (s.kind === 'app') return `Ouverture de ${s.name || basename(s.value ?? '')}`
  if (s.kind === 'close') return `Fermeture de ${s.name || s.value}`
  if (s.kind === 'link') return `Ouverture de ${s.name || 'ton lien'}`
  if (s.kind === 'wait') return `Attente de ${s.value} s`
  if (s.kind === 'minimize') return 'Player X se réduit'
  return s.name || 'Lancement du jeu'
}

async function runStep(s: RoutineStep, routine: Routine, launchId?: string): Promise<void> {
  if (s.kind === 'game') {
    await launchGame(routine.gameId, launchId)
    return
  }
  // Mode démo (développement seulement) : rien ne se lance pour de vrai.
  if (getSettings().demoMode) {
    await wait(s.kind === 'wait' ? Math.min(1500, Number(s.value) * 300) : 300)
    return
  }
  if (s.kind === 'app') {
    const ok = await stat(s.value ?? '').then((i) => i.isFile(), () => false)
    if (!ok) throw new Error('Appli introuvable')
    await runApp(s.value ?? '')
  } else if (s.kind === 'close') {
    await taskkill(s.value ?? '', false)
    if (s.force) {
      await wait(2000)
      await taskkill(s.value ?? '', true)
    }
  } else if (s.kind === 'link') {
    await shell.openExternal(s.value ?? '')
  } else if (s.kind === 'wait') {
    await wait(Number(s.value) * 1000)
  } else if (s.kind === 'minimize') {
    mainWindow()?.minimize()
  }
}

/** Lance une routine. Faux si une autre tourne encore. Ne rejette jamais pour une étape ratée. */
export async function runRoutine(id: unknown, launchId?: unknown): Promise<boolean> {
  const routine = getRoutines().find((r) => r.id === id)
  if (!routine || running) return false
  running = true
  const lid = typeof launchId === 'string' ? launchId.slice(0, 64) : undefined
  const steps = routine.steps.filter((s) => s.on)
  const total = steps.length
  try {
    for (let index = 0; index < total; index++) {
      const s = steps[index]
      const label = stepLabel(s)
      emit({ routineId: routine.id, launchId: lid, index, total, state: 'run', text: label })
      try {
        await runStep(s, routine, lid)
        emit({ routineId: routine.id, launchId: lid, index, total, state: 'ok', text: label })
      } catch {
        emit({ routineId: routine.id, launchId: lid, index, total, state: 'fail', text: `${label} : raté, on continue` })
      }
    }
    emit({ routineId: routine.id, launchId: lid, index: total, total, state: 'done', text: 'Routine terminée' })
  } finally {
    running = false
  }
  return true
}

// ---------- raccourcis ----------

let registered: string[] = []

function syncHotkeys(): void {
  for (const k of registered) globalShortcut.unregister(k)
  registered = []
  const list = getRoutines().filter((r) => r.trigger === 'hotkey').slice(0, HOTKEYS.length)
  list.forEach((r, i) => {
    try {
      if (globalShortcut.register(HOTKEYS[i], () => void runRoutine(r.id))) registered.push(HOTKEYS[i])
    } catch {
      /* raccourci pris par une autre appli : la routine reste lançable depuis Player X */
    }
  })
}

/** Raccourci de chaque routine liée à un raccourci (dans l'ordre : Ctrl Alt F1, F2, F3). */
export function routineHotkeys(): Record<string, string> {
  const out: Record<string, string> = {}
  getRoutines().filter((r) => r.trigger === 'hotkey').slice(0, HOTKEYS.length).forEach((r, i) => (out[r.id] = HOTKEYS[i]))
  return out
}

export function startRoutines(launch: (gameId: string, launchId?: string) => Promise<unknown>): void {
  launchGame = launch
  syncHotkeys()
}
