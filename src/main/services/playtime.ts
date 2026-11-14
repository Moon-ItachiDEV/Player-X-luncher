import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { powerMonitor } from 'electron'
import type { Game, Store } from '@shared/types'
import { lastPlayedOf } from '@shared/played'
import { logError } from '../crashLog'
import { lastSeenByGame, listGames, openSession, playtimeByGame, touchSessions } from '../db'
import { steamLastPlayed, steamMinutes } from './steamLibrary'
import { coalesce, exeName, GENERIC_EXE, matchGames, memoAsync, parseProcLines, usableDir, watchNames, type Matchable, type RunningProcess } from './tracking'

// Temps de jeu : toutes les minutes, on regarde quels programmes tournent et on les rattache au dossier
// d'installation d'un jeu. Ça marche aussi pour un jeu lancé hors de Player X, tant que Player X est ouvert.
// Pour les jeux Steam, le compteur de Steam (tout l'historique) prend le relais quand la clé Web API est là.

const POLL_MS = 60_000
/** Après un lancement depuis Player X : vérifications rapprochées, le temps que le jeu démarre. */
const NUDGE_MS = [20_000, 45_000]
/** Noms d'exécutables suivis par jeu pendant un lancement. */
const MAX_NAMES = 64

/** Jeu en cours → session ouverte dans la base, et début de la partie (premier relevé qui l'a vu). */
const running = new Map<string, { session: number; since: number }>()
const listeners = new Set<() => void>()
let lastPoll = 0
/** Dernier relevé réussi, avec les PID : base du « programme nouveau » d'un lancement. */
let snapshot: { at: number; procs: RunningProcess[] } | null = null
/** Jeu → noms des programmes qui lui ont été rattachés au dernier relevé réussi. */
let lastMatch = new Map<string, Set<string>>()
/** Relevé raté, ou sessions arrêtées sans relevé, depuis le dernier réussi : un jeu absent ne s'est peut-être pas fermé. */
let unsure = false

function onChange(): void {
  for (const cb of listeners) {
    try {
      cb()
    } catch (e) {
      logError('temps de jeu : abonné', e)
    }
  }
}

/** Toutes les sessions s'arrêtent (mise en veille, ou trop longtemps sans relevé) : le temps passé n'est pas compté. */
function endAll(): boolean {
  if (!running.size) return false
  running.clear()
  unsure = true
  return true
}

// Sortie en UTF-8 (sinon PowerShell 5.1 écrit dans la page de code OEM et les chemins accentués ne correspondent plus).
const PS_COMMAND =
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | ForEach-Object { $_.ProcessName + [char]9 + $_.Id + [char]9 + $_.Path }'

/** Programmes en cours (Windows uniquement). null si la liste n'a pas pu être lue (erreur, délai dépassé) : rien n'en est conclu. */
function runningProcesses(): Promise<RunningProcess[] | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_COMMAND],
      { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        const procs = err ? [] : parseProcLines(stdout)
        // Une liste vide n'existe pas sous Windows : c'est une sortie tronquée, pas « plus aucun jeu ».
        resolve(procs.length ? procs : null)
      }
    )
  })
}

// ---------- exécutables de chaque jeu (pour les processus dont le chemin est illisible) ----------

const MAX_SCAN_ENTRIES = 3000

/** Noms d'exécutables (minuscules, sans « .exe ») d'un dossier, gardés : un relevé pendant le parcours attend la liste complète. */
const exeNames = memoAsync(scanExeNames)

async function scanExeNames(dir: string): Promise<Set<string>> {
  const names = new Set<string>()
  let seen = 0
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 3 || seen > MAX_SCAN_ENTRIES) return
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (++seen > MAX_SCAN_ENTRIES) return
      if (e.isDirectory()) await walk(join(d, e.name), depth + 1)
      else if (/\.exe$/i.test(e.name)) {
        const n = e.name.slice(0, -4).toLowerCase()
        if (!GENERIC_EXE.test(n)) names.add(n)
      }
    }
  }
  await walk(dir, 0)
  return names
}

async function gameExeNames(games: Matchable[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  for (const g of games) if (g.installDir && usableDir(g.installDir)) out.set(g.id, await exeNames(g.installDir))
  return out
}

/** Un relevé : true si la liste des programmes a pu être lue. */
async function poll(): Promise<boolean> {
  const now = Date.now()
  // Un trou de plus de trois relevés réussis (veille, PC figé, PowerShell en panne) : les sessions en cours s'arrêtent au dernier relevé.
  let changed = lastPoll > 0 && now - lastPoll > POLL_MS * 3 ? endAll() : false
  const procs = await runningProcesses()
  if (!procs) {
    // Liste illisible : aucune conclusion (avant, toutes les sessions s'arrêtaient d'un coup).
    unsure = true
    if (changed) onChange()
    return false
  }
  // Premier relevé réussi après une panne : chacun revérifie (une fin vue pendant la panne n'a rien conclu).
  if (unsure) {
    unsure = false
    changed = true
  }
  lastPoll = now
  snapshot = { at: now, procs }
  const games = listGames()
  lastMatch = matchGames(procs, games, procs.some((p) => !p.path) ? await gameExeNames(games) : undefined)
  for (const id of [...running.keys()]) {
    if (lastMatch.has(id)) continue
    // Session terminée : sa fin reste la dernière fois où le jeu a été vu.
    running.delete(id)
    changed = true
  }
  touchSessions([...running.values()].map((r) => r.session), now)
  for (const id of lastMatch.keys()) {
    if (running.has(id)) continue
    running.set(id, { session: openSession(id, now), since: now })
    changed = true
  }
  if (changed) onChange()
  return true
}

/**
 * Relevé tout de suite, regroupé avec celui en cours : la minute, le démarrage, les relevés rapprochés et la confirmation
 * d'un lancement passent tous par ici. Vrai si la liste des programmes a pu être lue.
 */
export const pollNow = coalesce(() =>
  poll().catch((e) => {
    logError('temps de jeu : relevé', e)
    return false
  })
)

/** PID des programmes rattachés à un jeu au dernier relevé réussi (vide si le jeu n'y était pas). */
export function gamePids(id: string): number[] {
  const names = lastMatch.get(id)
  if (!names || !snapshot) return []
  return snapshot.procs.filter((p) => names.has(p.name.toLowerCase())).map((p) => p.pid)
}

/** Le programme tourne-t-il encore ? Test sans coût (aucun signal envoyé, pas de PowerShell). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM : le programme existe mais appartient à un autre compte (ou est protégé).
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function startPlaytimeTracker(notify: () => void): void {
  listeners.add(notify)
  if (process.platform !== 'win32') return
  const tick = (): void => void pollNow()
  setTimeout(tick, 5_000)
  setInterval(tick, POLL_MS)
  powerMonitor.on('suspend', () => endAll() && onChange())
  // Au réveil, l'état « en jeu » n'attend pas la minute suivante.
  powerMonitor.on('resume', () => setTimeout(tick, 5_000))
}

/** Chaque changement (jeu lancé ou fermé). Renvoie la fonction de désabonnement. */
export function onPlaytimeChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Un jeu vient d'être lancé depuis Player X. `still` : faux une fois le jeu détecté, le relevé suivant n'a plus lieu. */
export function nudgePlaytime(still: () => boolean = () => true): void {
  if (process.platform !== 'win32') return
  for (const ms of NUDGE_MS)
    setTimeout(() => {
      if (still()) void pollNow()
    }, ms)
}

// ---------- état « en jeu », pour le suivi d'un lancement (launches.ts) ----------

export function isRunning(id: string): boolean {
  return running.has(id)
}

export function runningSince(id: string): number | undefined {
  return running.get(id)?.since
}

/** Le dernier relevé a réussi, et aucune session ne s'est arrêtée sans relevé depuis : un jeu absent s'est bien fermé. */
export function lastPollOk(): boolean {
  return !unsure
}

/**
 * Noms des programmes rattachés à ce jeu au dernier relevé (y compris ceux trouvés par leur dossier), pour le suivi rapide :
 * sans les génériques (watchNames). Les pastilles « En jeu » et les sessions gardent tout lastMatch.
 */
export function matchedNames(id: string): Set<string> {
  return watchNames(lastMatch.get(id) ?? [])
}

const fresh = (maxAgeMs: number): RunningProcess[] | null => (snapshot && Date.now() - snapshot.at <= maxAgeMs ? snapshot.procs : null)

/** PID du dernier relevé s'il a moins de `maxAgeMs` ; null sinon. */
export function snapshotPids(maxAgeMs: number): Set<number> | null {
  const procs = fresh(maxAgeMs)
  return procs ? new Set(procs.map((p) => p.pid)) : null
}

/** Programme principal de chaque client (noms vérifiés sous Windows). */
const STORE_PROCESS: Record<Store, string> = { steam: 'steam', epic: 'epicgameslauncher', ea: 'eadesktop', gog: 'galaxyclient' }

/** Le client du store tournait au dernier relevé (s'il a moins de `maxAgeMs`) ; null : on ne sait pas. */
export function storeWasRunning(store: Store, maxAgeMs = 90_000): boolean | null {
  const procs = fresh(maxAgeMs)
  return procs ? procs.some((p) => p.name.toLowerCase() === STORE_PROCESS[store]) : null
}

/** Noms d'exécutables d'un jeu, au plus 64. `refresh` relit son dossier (le jeu a pu être mis à jour depuis le dernier relevé). */
export async function exeNamesFor(game: Matchable, refresh: boolean): Promise<Set<string>> {
  const names = new Set<string>()
  if (game.exePath) names.add(exeName(game.exePath))
  if (game.installDir && usableDir(game.installDir)) {
    for (const n of await exeNames(game.installDir, refresh)) {
      if (names.size >= MAX_NAMES) break
      names.add(n)
    }
  }
  return names
}

/** Ajoute le temps de jeu, la dernière partie et l'état « en jeu » à la vraie bibliothèque. */
export function withPlaytime(games: Game[]): Game[] {
  const local = playtimeByGame()
  const steam = steamMinutes()
  const seen = lastSeenByGame()
  const steamLast = steamLastPlayed()
  const now = Date.now()
  return games.map((g) => {
    const r = running.get(g.id)
    const mine = local.get(g.id) ?? 0
    const fromSteam = g.store === 'steam' ? steam[g.storeId] : undefined
    // Le compteur Steam peut avoir une heure de retard sur une session en cours : on garde le plus grand.
    const useSteam = fromSteam !== undefined && fromSteam >= mine
    const playtime = useSteam ? fromSteam : mine
    // Dernière partie : la plus récente des trois dates. Calculée ici seulement, jamais écrite dans games.last_played.
    const played = lastPlayedOf({ launch: g.lastPlayed, session: seen.get(g.id), steam: g.store === 'steam' ? steamLast[g.storeId] : undefined }, now)
    return {
      ...g,
      lastPlayed: played?.at,
      ...(played ? { lastPlayedSource: played.source } : {}),
      ...(playtime > 0 ? { playtime, playtimeSource: useSteam ? ('steam' as const) : ('local' as const) } : {}),
      ...(r ? { running: true, runningSince: r.since } : {})
    }
  })
}
