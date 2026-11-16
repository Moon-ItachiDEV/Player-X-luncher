// Prêt à jouer : mises à jour et téléchargements Steam, lus dans les manifestes de chaque bibliothèque
// (`steamapps/appmanifest_<appid>.acf`) et dans la clé `Updating` du registre de Steam. Rien ne passe par internet.
// Les dossiers `steamapps` sont surveillés (fs.watch) et relus au plus 1,5 s après un changement ; filet de sécurité :
// une relecture toutes les 20 s pendant un téléchargement, toutes les 2 min quand une mise à jour attend, toutes les
// 10 min sinon. Le registre n'est lu que quand un manifeste dit qu'une mise à jour attend (un seul `reg query` pour
// tous les jeux) : un jeu dont la mise à jour attend des jours ne fait pas tourner `reg` toutes les 20 s.
import { execFile } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hasPending, parseUpdatingReg, readAppManifest, updateActive, updateOf, type AppManifestFacts } from '@shared/steamUpdate'
import type { SteamUpdates } from '@shared/types'
import { broadcast } from '../windows'
import { steamLibraryDirs } from './games'

const DEBOUNCE_MS = 1_500
const ACTIVE_EVERY_MS = 20_000
const WAITING_EVERY_MS = 2 * 60_000
const IDLE_EVERY_MS = 10 * 60_000
/** Bibliothèques Steam relues (un disque ajouté dans Steam) au plus toutes les 10 min. */
const DIRS_EVERY_MS = 10 * 60_000
/** Octets téléchargés en hausse depuis moins que ça : Steam télécharge (hors Windows, ou registre illisible). */
const GROWTH_MS = 90_000
const MANIFEST = /^appmanifest_\d+\.acf$/i

interface Deps {
  /** Mode démo : rien n'est lu sur le disque (le simulateur de développement peut prendre le relais). */
  demo: () => boolean
  /** Un jeu est prêt : il attendait ou recevait une mise à jour (ou son premier téléchargement) au relevé précédent. */
  onReady: (appId: string, firstInstall: boolean) => void
}

let deps: Deps | null = null
let current: SteamUpdates = {}
let dirs: string[] = []
let dirsAt = 0
const watchers = new Map<string, FSWatcher>()
let poll: ReturnType<typeof setTimeout> | null = null
let soon: ReturnType<typeof setTimeout> | null = null
let scanning: Promise<void> | null = null
let again = false
/** Octets téléchargés au dernier relevé, et moment de leur dernière hausse. */
const growth = new Map<string, { bytes: number; grewAt: number }>()
/** Le simulateur de développement (PX_READY_SIM) publie ses propres états : plus de lecture du disque. */
let simulated = false

/** États en cours (appid → état) : seulement les jeux qui attendent ou reçoivent quelque chose. */
export function steamUpdates(): SteamUpdates {
  return current
}

function updatingApps(): Promise<Set<string>> {
  if (process.platform !== 'win32') return Promise.resolve(new Set())
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam\\Apps', '/s', '/v', 'Updating'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
      // Aucune valeur trouvée : code de sortie 1, sortie vide.
      (_err, stdout) => resolve(parseUpdatingReg(String(stdout ?? '')))
    )
  })
}

function syncWatchers(): void {
  const want = new Set(dirs.map((d) => join(d, 'steamapps')))
  for (const [path, w] of watchers) {
    if (want.has(path)) continue
    w.close()
    watchers.delete(path)
  }
  for (const path of want) {
    if (watchers.has(path)) continue
    try {
      // Steam peut écrire un fichier temporaire puis le renommer : tout nom qui parle d'un manifeste compte.
      const w = watch(path, { persistent: false }, (_e, name) => {
        if (!name || /appmanifest_\d+/i.test(String(name))) scanSoon()
      })
      w.on('error', () => {
        w.close()
        watchers.delete(path)
      })
      watchers.set(path, w)
    } catch {
      /* dossier illisible : la relecture régulière suffit */
    }
  }
}

async function readAll(): Promise<AppManifestFacts[]> {
  if (!dirs.length || Date.now() - dirsAt > DIRS_EVERY_MS) {
    dirs = await steamLibraryDirs()
    dirsAt = Date.now()
    syncWatchers()
  }
  const found = new Map<string, AppManifestFacts>()
  for (const dir of dirs) {
    const apps = join(dir, 'steamapps')
    let files: string[]
    try {
      files = await readdir(apps)
    } catch {
      continue
    }
    for (const file of files) {
      if (!MANIFEST.test(file)) continue
      try {
        const f = readAppManifest(await readFile(join(apps, file), 'utf8'))
        // La première bibliothèque gagne, comme au scan de la bibliothèque (games.ts).
        if (f && !found.has(f.appId)) found.set(f.appId, f)
      } catch {
        /* manifeste en cours d'écriture : relu au prochain passage */
      }
    }
  }
  return [...found.values()]
}

async function scan(): Promise<void> {
  if (!deps || simulated) return
  if (deps.demo()) return publish({}, new Set())
  const facts = await readAll()
  const updating = facts.some(hasPending) ? await updatingApps() : new Set<string>()
  const now = Date.now()
  const next: SteamUpdates = {}
  const ready = new Set<string>()
  for (const f of facts) {
    const prev = growth.get(f.appId)
    const grewAt = prev && f.downloaded > prev.bytes ? now : prev && f.downloaded === prev.bytes ? prev.grewAt : 0
    growth.set(f.appId, { bytes: f.downloaded, grewAt })
    const u = updateOf(f, updating.has(f.appId) || now - grewAt < GROWTH_MS)
    if (u) next[f.appId] = u
    else if (u === null) ready.add(f.appId)
  }
  publish(next, ready)
}

function rescan(): Promise<void> {
  if (scanning) {
    again = true
    return scanning
  }
  scanning = scan()
    .catch((e) => console.warn('[steam-updates]', e))
    .finally(() => {
      scanning = null
      if (again) {
        again = false
        void rescan()
      }
    })
  return scanning
}

/** Après un changement dans un dossier `steamapps` : une relecture dans 1,5 s (un flot d'écritures n'en repousse pas la date). */
function scanSoon(): void {
  if (soon) return
  soon = setTimeout(() => {
    soon = null
    void rescan()
  }, DEBOUNCE_MS)
}

function schedule(): void {
  if (poll) clearTimeout(poll)
  const states = Object.values(current)
  poll = setTimeout(() => void rescan(), states.some(updateActive) ? ACTIVE_EVERY_MS : states.length ? WAITING_EVERY_MS : IDLE_EVERY_MS)
}

/** Nouveaux états : l'interface les reçoit s'ils ont changé ; un jeu qui attendait et qui est prêt déclenche `onReady`. */
function publish(next: SteamUpdates, ready: ReadonlySet<string>): void {
  const before = current
  current = next
  for (const [appId, u] of Object.entries(before)) if (!next[appId] && ready.has(appId)) deps?.onReady(appId, !!u.firstInstall)
  if (JSON.stringify(before) !== JSON.stringify(next)) {
    broadcast('steam:updates', next)
  }
  if (!simulated) schedule()
}

export function startSteamUpdates(d: Deps): void {
  deps = d
  void rescan()
}

/**
 * Mode démo basculé : tout est relu tout de suite. Pas d'alerte pour l'autre bibliothèque : la démo publie une liste
 * vide, et rien ne devient « prêt » à partir d'une liste vide.
 */
export function steamUpdatesDemoChanged(): void {
  growth.clear()
  void rescan()
}

/** Développement seulement (steamUpdatesSim.ts) : la publication passe au simulateur. */
export function simulateSteamUpdates(): (next: SteamUpdates, ready: ReadonlySet<string>) => void {
  simulated = true
  if (poll) clearTimeout(poll)
  return publish
}
