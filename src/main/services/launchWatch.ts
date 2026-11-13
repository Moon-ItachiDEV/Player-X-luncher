// Suivi rapide d'un lancement : un seul powershell.exe partagé, piloté ligne par ligne (protocole : launchWatchParse.ts).
// Il ne vit que tant qu'un lancement en a besoin (launches.ts décide) ; Player X fermé, son entrée se ferme et il s'arrête.
// Sans Electron : le lancement du processus est remplaçable.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import type { Timers } from './launches'
import { isValid, p95, parseSample, SCRIPT, tickLine, type Query, type Sample } from './launchWatchParse'

/** Le premier relevé paie le démarrage de PowerShell (2 à 3 s à froid). */
const FIRST_TIMEOUT_MS = 10_000
const TIMEOUT_MS = 3_000
/** Relevés ratés d'affilée (délai dépassé ou réponse tronquée) avant d'abandonner le suivi rapide. */
const MAX_FAILURES = 3
/** Après la fin de l'entrée, le script a ce délai pour s'arrêter seul. */
const STOP_KILL_MS = 1_000
/** Coût par relevé suivi sur les 30 derniers. */
const COST_WINDOW = 30
/** Au-delà, ce n'est plus une réponse du script : on vide. */
const MAX_LINE = 1024 * 1024

export type Spawn = (cmd: string, args: string[], opts: { windowsHide: boolean; stdio: ['pipe', 'pipe', 'ignore'] }) => ChildProcess

export interface Watcher {
  alive(): boolean
  /** Un relevé ; null si PowerShell n'a pas répondu à temps ou a répondu un relevé tronqué. */
  sample(query: Query): Promise<Sample | null>
  /** Dernier relevé valable et son heure. */
  last(): { at: number; sample: Sample } | null
  /** Temps processeur par relevé (95e centile, ms) et mémoire du script. */
  cost(): { p95CpuMs: number; ws: number; samples: number }
  /** Ferme l'entrée (le script s'arrête seul), puis l'arrête au bout d'1 s ; `hard` : tout de suite. */
  stop(hard?: boolean): void
}

export interface WatchDeps {
  spawn?: Spawn
  now(): number
  timers: Timers
  log(msg: string): void
  /** Trois relevés ratés, PowerShell introuvable ou arrêté : le suivi rapide n'est plus possible. */
  onDown(why: string): void
}

export function createWatcher(deps: WatchDeps): Watcher {
  const spawn: Spawn = deps.spawn ?? nodeSpawn
  const { timers } = deps
  let child: ChildProcess | null = null
  /** Aucune réponse encore de ce processus : délai long. */
  let first = true
  let buf = ''
  /** Réponses tardives à jeter (leur relevé a déjà été compté comme raté). */
  let late = 0
  let waiting: { resolve: (s: Sample | null) => void; timer: unknown } | null = null
  let failures = 0
  let last: { at: number; sample: Sample } | null = null
  let costs: number[] = []
  let prevCpu: number | null = null
  let ws = 0

  function answer(s: Sample | null): void {
    const w = waiting
    if (!w) return
    waiting = null
    timers.clearTimeout(w.timer)
    w.resolve(s)
  }

  function kill(): void {
    const c = child
    child = null
    answer(null)
    c?.kill()
  }

  function down(why: string): void {
    deps.log(`suivi rapide hors service (${why})`)
    kill()
    failures = 0
    deps.onDown(why)
  }

  function fail(why: string): void {
    if (++failures >= MAX_FAILURES) down(why)
  }

  function onLine(line: string): void {
    if (late > 0) {
      late--
      return
    }
    if (!waiting) return
    first = false
    const s = parseSample(line)
    if (!s || !isValid(s)) {
      answer(null)
      fail('relevé tronqué')
      return
    }
    failures = 0
    if (s.cpuMs !== null) {
      // Le premier relevé d'un processus compte son démarrage : il n'entre pas dans le coût.
      if (prevCpu !== null && s.cpuMs >= prevCpu) costs = [...costs, s.cpuMs - prevCpu].slice(-COST_WINDOW)
      prevCpu = s.cpuMs
    }
    if (s.ws !== null) ws = s.ws
    last = { at: deps.now(), sample: s }
    answer(s)
  }

  function start(): ChildProcess | null {
    let c: ChildProcess
    try {
      c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', SCRIPT], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore']
      })
    } catch {
      down('PowerShell introuvable')
      return null
    }
    first = true
    buf = ''
    late = 0
    prevCpu = null
    costs = []
    c.stdout?.setEncoding('utf8')
    c.stdout?.on('data', (chunk: string) => {
      if (c !== child) return
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        onLine(line)
      }
      if (buf.length > MAX_LINE) buf = ''
    })
    // Écriture après la mort du processus (EPIPE) : l'événement exit s'en occupe.
    c.stdin?.on('error', () => {})
    c.on('error', () => c === child && down('PowerShell introuvable'))
    // Arrêté sans qu'on le demande (gestionnaire des tâches, stratégie de sécurité) : on ne le relance pas en boucle.
    c.on('exit', () => c === child && down('arrêté'))
    return c
  }

  return {
    alive: () => child !== null,
    sample(query) {
      if (waiting) return Promise.resolve(null)
      if (!child) child = start()
      const c = child
      if (!c) return Promise.resolve(null)
      return new Promise((resolve) => {
        const timer = timers.setTimeout(
          () => {
            if (waiting?.timer !== timer) return
            waiting = null
            first = false
            late++
            resolve(null)
            fail('pas de réponse')
          },
          first ? FIRST_TIMEOUT_MS : TIMEOUT_MS
        )
        waiting = { resolve, timer }
        try {
          c.stdin?.write(tickLine(query) + '\n')
        } catch {
          /* processus déjà arrêté : le délai ou l'événement exit concluent */
        }
      })
    },
    last: () => last,
    cost: () => ({ p95CpuMs: p95(costs), ws, samples: costs.length }),
    stop(hard = false) {
      const c = child
      child = null
      answer(null)
      failures = 0
      if (!c) return
      if (hard) {
        c.kill()
        return
      }
      try {
        c.stdin?.end()
      } catch {
        /* déjà fermée */
      }
      timers.setTimeout(() => {
        if (c.exitCode === null && c.signalCode === null) c.kill()
      }, STOP_KILL_MS)
    }
  }
}
