// Rattachement des programmes en cours aux jeux de la bibliothèque : temps de jeu, « En jeu » et suivi d'un lancement.
// Module pur, sans Electron ni base : testé sous Node seul (npm run test:launch).
import { win32 } from 'node:path'
import type { Game } from '@shared/types'

export interface RunningProcess {
  /** Nom sans « .exe », toujours lisible. */
  name: string
  /** Identifiant Windows : un programme nouveau est un PID absent du relevé d'avant le clic. */
  pid: number
  /** Chemin complet : vide pour un processus protégé (anti-triche) ou lancé en administrateur. */
  path: string
}

/**
 * Exécutables trop génériques pour désigner un jeu (installeurs, rapports de plantage, anti-triche, navigateurs intégrés…).
 * UnrealCEFSubProcess et QtWebEngineProcess sont livrés avec certains jeux, mais tournent aussi en permanence avec Epic Games
 * et l'EA app : ils feraient croire le jeu lancé, ou jamais fermé.
 */
export const GENERIC_EXE =
  /^(unins\d*|uninstall.*|setup.*|install.*|vc_?redist.*|dxsetup|dotnet.*|directx.*|ue\dprereqsetup.*|.*crash.*|.*report.*|easyanticheat.*|eac.*|beservice.*|battleye.*|.*launcher.*|.*updater.*|.*helper.*|cef.*|unrealcefsubprocess|qtwebengineprocess|.*webview.*|quicksfv|touchup|cleanup|activation.*|pbsvc|start_protected_game)$/i

export const normPath = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** Dossiers trop courts (« C:\Games ») : on ne les rattache à aucun jeu pour éviter les faux positifs. */
export const usableDir = (dir: string): boolean => normPath(dir).split('\\').filter(Boolean).length >= 3

/** Nom d'un exécutable tel que Windows le donne au processus (minuscules, sans « .exe »). Chemins Windows, même sous Node ailleurs. */
export const exeName = (path: string): string => win32.basename(normPath(path), '.exe')

/** Sortie de PS_COMMAND (playtime.ts) : une ligne « nom TAB id TAB chemin » par programme. */
export function parseProcLines(stdout: string): RunningProcess[] {
  const procs: RunningProcess[] = []
  for (const line of stdout.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const [name = '', id = '', path = ''] = line.split('\t')
    if (!name.trim() || !/^\d+$/.test(id.trim())) continue
    procs.push({ name: name.trim(), pid: Number(id.trim()), path: path.trim() })
  }
  return procs
}

export type Matchable = Pick<Game, 'id' | 'installDir' | 'exePath'>

/**
 * Jeu → noms (minuscules) des programmes qui lui sont rattachés : par chemin d'abord, par nom d'exécutable quand le chemin
 * est illisible. Les noms servent au suivi d'un lancement (exécutable trouvé par son dossier, même à plus de 3 niveaux).
 */
export function matchGames(procs: RunningProcess[], games: Matchable[], namesByGame: Map<string, Set<string>> = new Map()): Map<string, Set<string>> {
  const dirs = games
    .filter((g) => g.installDir && usableDir(g.installDir))
    .map((g) => ({ id: g.id, dir: normPath(g.installDir!) + '\\' }))
    // Le dossier le plus précis gagne si deux jeux sont imbriqués.
    .sort((a, b) => b.dir.length - a.dir.length)
  const exes = new Map(games.filter((g) => g.exePath).map((g) => [normPath(g.exePath!), g.id]))
  const byName = new Map<string, string>()
  for (const g of games) {
    if (g.exePath) byName.set(exeName(g.exePath), g.id)
    for (const n of namesByGame.get(g.id) ?? []) if (!byName.has(n)) byName.set(n, g.id)
  }
  const found = new Map<string, Set<string>>()
  for (const proc of procs) {
    let id: string | undefined
    if (proc.path) {
      const p = normPath(proc.path)
      id = exes.get(p) ?? dirs.find((d) => p.startsWith(d.dir))?.id
    } else {
      // Chemin illisible (jeu protégé par un anti-triche ou lancé en administrateur) : on compare le nom de l'exécutable.
      id = byName.get(proc.name.toLowerCase())
    }
    if (!id) continue
    const names = found.get(id) ?? new Set<string>()
    names.add(proc.name.toLowerCase())
    found.set(id, names)
  }
  return found
}

/**
 * Noms qu'un suivi de lancement peut chercher parmi ceux que matchGames a rattachés au jeu : sans les génériques, qu'un jeu
 * lance de son dossier (navigateur intégré, rapport de plantage) mais qu'Epic Games ou l'EA app font tourner en permanence.
 * Suivis par leur nom seul, ils feraient croire le jeu encore ouvert après sa fermeture.
 */
export const watchNames = (names: Iterable<string>): Set<string> => new Set([...names].filter((n) => !GENERIC_EXE.test(n)))

export function runningGameIds(procs: RunningProcess[], games: Matchable[], namesByGame?: Map<string, Set<string>>): Set<string> {
  return new Set(matchGames(procs, games, namesByGame).keys())
}

/**
 * Regroupe les relevés : pendant celui en cours, les demandes suivantes attendent un seul relevé de plus (celui en cours a pu
 * commencer avant elles). Jamais deux relevés à la fois, jamais une demande perdue.
 */
export function coalesce<T>(run: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null
  let queued: Promise<T> | null = null
  const now = (): Promise<T> => {
    if (!inFlight) {
      inFlight = run().finally(() => {
        inFlight = null
      })
      return inFlight
    }
    const next = (): Promise<T> => {
      queued = null
      return now()
    }
    queued ??= inFlight.then(next, next)
    return queued
  }
  return now
}

/**
 * Résultat d'un calcul asynchrone gardé par clé. Un appel pendant le calcul attend son résultat complet, jamais un résultat
 * à moitié rempli ; `refresh` relance le calcul, et les appels suivants attendent le nouveau.
 */
export function memoAsync<T>(compute: (key: string) => Promise<T>): (key: string, refresh?: boolean) => Promise<T> {
  const cache = new Map<string, Promise<T>>()
  return (key, refresh = false) => {
    let p = refresh ? undefined : cache.get(key)
    if (!p) {
      const next = compute(key)
      // Un échec n'est pas gardé : l'appel suivant réessaie.
      next.catch(() => cache.get(key) === next && cache.delete(key))
      cache.set(key, next)
      p = next
    }
    return p
  }
}
