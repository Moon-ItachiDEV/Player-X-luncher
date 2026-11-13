// Simulateur de lancement pour `npm run dev` (PX_LAUNCH_SIM) : le vrai orchestrateur (services/launches.ts) et le vrai IPC,
// branchés sur un faux Windows. L'envoi du lien, le relevé des programmes, le suivi rapide et la fenêtre sont joués en
// mémoire, aussi sous Linux et en mode démo (il remplace alors la séquence de démo : chaque phase passe par le vrai code).
// Chargé seulement quand l'appli n'est pas installée (import dynamique dans index.ts) : jamais dans l'installeur.
import type { Game } from '@shared/types'
import { LaunchError, type LaunchTarget } from './services/games'
import { createLaunches, scaledTiming, type LaunchDeps, type LaunchTracker, type LaunchWindow, type Launches } from './services/launches'
import type { Watcher } from './services/launchWatch'
import type { Sample } from './services/launchWatchParse'
import { coalesce } from './services/tracking'

type Mode = 'ok' | 'slow' | 'fail' | 'nohandler' | 'stall' | 'early' | 'relay' | 'already' | 'poll' | 'gaveup' | 'exe-missing'
const MODES: Mode[] = ['ok', 'slow', 'fail', 'nohandler', 'stall', 'early', 'relay', 'already', 'poll', 'gaveup', 'exe-missing']

export interface LaunchSim {
  launches: Launches
  /** Faux relevé, pour la bibliothèque de démo (index.ts, games()). */
  isRunning(gameId: string): boolean
  runningSince(gameId: string): number | undefined
  onChange(cb: () => void): void
}

/** Programme d'un jeu simulé : vivant de `from` à `to`, avec une fenêtre à partir de `windowAt`. */
interface SimProc {
  pid: number
  name: string
  from: number
  to: number
  windowAt: number
}

/** De quoi dépasser les 20 programmes d'un relevé valable. */
const SYSTEM = ['system', 'smss', 'csrss', 'wininit', 'services', 'lsass', 'svchost', 'fontdrvhost', 'dwm', 'explorer', 'sihost', 'ctfmon',
  'searchhost', 'startmenuexperiencehost', 'runtimebroker', 'textinputhost', 'audiodg', 'spoolsv', 'msmpeng', 'securityhealthservice',
  'taskhostw', 'conhost', 'dllhost', 'wudfhost', 'steam', 'steamwebhelper', 'epicgameslauncher', 'eadesktop']
const BASE_PROCS = SYSTEM.map((name, i) => ({ pid: 400 + i * 4, name }))
const POLL_MS = 60_000
const NUDGE_MS = [20_000, 45_000]
/** Durée d'un relevé PowerShell de playtime.ts (environ). */
const POLL_TAKES_MS = 600
/** Démarrage à froid du suivi rapide, puis un relevé. */
const COLD_MS = 1_500
const SAMPLE_MS = 40
/** Mode `already` : la partie « tourne » depuis 21 min. */
const ALREADY_FOR_MS = 21 * 60_000

export function createLaunchSim(raw: string, base: LaunchDeps, fast: boolean): LaunchSim {
  const mode: Mode = MODES.includes(raw as Mode) ? (raw as Mode) : 'ok'
  if (mode !== raw) base.log(`PX_LAUNCH_SIM=${raw} inconnu : simulation ok (${MODES.join(', ')})`)
  const log = (msg: string): void => base.log(`sim ${mode} : ${msg}`)
  const { timers } = base
  const now = (): number => base.now()
  // PX_LAUNCH_SIM_FAST=1 : les délais de l'orchestrateur et le scénario, dix fois plus vite.
  const ms = (v: number): number => Math.max(1, Math.round(v / (fast ? 10 : 1)))
  const wait = (v: number): Promise<void> => new Promise((resolve) => timers.setTimeout(resolve, v))
  const startedAt = now()
  const procs = new Map<string, SimProc[]>()
  const running = new Map<string, number>()
  const listeners = new Set<() => void>()
  const gameOf = new WeakMap<LaunchTarget, Game>()
  let nextPid = 7000
  let handedAt = 0

  const slug = (g: Game): string => g.name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'jeu'
  const alive = (gameId: string, at: number): SimProc[] => (procs.get(gameId) ?? []).filter((p) => at >= p.from && at < p.to)

  /** Ce que fait le « jeu » une fois le lien transmis. */
  function play(game: Game): void {
    const h = now()
    const name = slug(game)
    const proc = (n: string, from: number, life: number): SimProc => ({
      pid: nextPid++,
      name: n,
      from: h + ms(from),
      to: h + ms(from + life),
      windowAt: h + ms(from + 2_000)
    })
    const script: Record<Mode, SimProc[]> = {
      ok: [proc(name, 3_000, 60_000)],
      slow: [proc(name, 100_000, 60_000)],
      early: [proc(name, 3_000, 9_000)],
      // Lanceur intermédiaire qui se ferme, puis le vrai jeu (nouveau PID).
      relay: [proc(`${name}_stub`, 2_000, 6_000), proc(name, 20_000, 60_000)],
      // Suivi rapide muet : le jeu n'est vu qu'au relevé rapproché de 45 s.
      poll: [proc(name, 30_000, 120_000)],
      gaveup: [],
      already: [],
      fail: [],
      nohandler: [],
      stall: [],
      'exe-missing': []
    }
    procs.set(game.id, script[mode])
    handedAt = h
    log(`${game.name} : ${script[mode].map((p) => `${p.name} de +${p.from - h} à +${p.to - h} ms`).join(', ') || 'aucun programme'}`)
  }

  // ----- faux relevé des programmes (playtime.ts) -----

  const isRunning = (id: string): boolean => mode === 'already' || running.has(id)
  const runningSince = (id: string): number | undefined => (mode === 'already' ? startedAt - ALREADY_FOR_MS : running.get(id))

  const pollNow = coalesce(async (): Promise<boolean> => {
    await wait(ms(POLL_TAKES_MS))
    const at = now()
    const seen = new Set([...procs.keys()].filter((id) => alive(id, at).length > 0))
    let changed = false
    for (const id of [...running.keys()]) {
      if (seen.has(id)) continue
      running.delete(id)
      changed = true
    }
    for (const id of seen) {
      if (running.has(id)) continue
      running.set(id, at)
      changed = true
    }
    if (changed) {
      log(`relevé : ${[...running.keys()].join(', ') || 'aucun jeu'}`)
      for (const cb of listeners) cb()
    }
    return true
  })

  const minute = (): void => {
    timers.setTimeout(() => {
      void pollNow()
      minute()
    }, ms(POLL_MS))
  }
  minute()

  const tracker: LaunchTracker = {
    isRunning,
    runningSince,
    pollNow,
    // Le faux relevé ne rate jamais.
    lastPollOk: () => true,
    snapshotPids: () => new Set(BASE_PROCS.map((p) => p.pid)),
    // Mode `slow` : le store semblait fermé.
    storeWasRunning: () => mode !== 'slow',
    exeNamesFor: async (game) => new Set([slug(game), `${slug(game)}_stub`]),
    matchedNames: (id) => new Set(alive(id, now()).map((p) => p.name)),
    nudge: (still) => {
      for (const v of NUDGE_MS)
        timers.setTimeout(() => {
          if (still()) void pollNow()
        }, ms(v))
    },
    onChange: (cb) => listeners.add(cb)
  }

  // ----- faux suivi rapide (launchWatch.ts) -----

  const watcher = (onDown: (why: string) => void): Watcher => {
    let up = false
    let count = 0
    let failures = 0
    let cpu = 0
    let last: { at: number; sample: Sample } | null = null
    return {
      alive: () => up,
      async sample(q) {
        up = true
        if (mode === 'poll') {
          // PowerShell ne répond pas : trois délais dépassés, puis relevés à 20 s, 45 s et chaque minute.
          await wait(ms(count++ === 0 ? 10_000 : 3_000))
          if (++failures >= 3) {
            up = false
            failures = 0
            onDown('simulation : pas de réponse')
          }
          return null
        }
        await wait(count++ === 0 ? ms(COLD_MS) : SAMPLE_MS)
        if (!up) return null
        const at = now()
        const asked = new Set([...(q.w ?? [])].flatMap((names) => [...names]))
        const s: Sample = { procs: [...BASE_PROCS], windows: new Set(), runningAppId: null, updating: new Map(), cpuMs: (cpu += 18), ws: 52e6 }
        for (const [gameId, list] of procs)
          for (const p of list) {
            if (at < p.from || at >= p.to) continue
            s.procs.push({ pid: p.pid, name: p.name })
            if (at >= p.windowAt && asked.has(p.name)) s.windows.add(p.pid)
            if (gameId.startsWith('steam:')) s.runningAppId = gameId.slice(6)
          }
        // Mode `slow` : Steam indique une mise à jour pendant la première minute.
        for (const id of q.s ?? []) s.updating.set(id, mode === 'slow' && at - handedAt < ms(60_000))
        last = { at, sample: s }
        return s
      },
      last: () => last,
      cost: () => ({ p95CpuMs: 18, ws: 52e6, samples: count }),
      stop() {
        up = false
        count = 0
      }
    }
  }

  // ----- faux Windows : envoi du lien et fenêtre -----

  const target = (game: Game): LaunchTarget | null => {
    const t: LaunchTarget | null = mode === 'exe-missing' ? { kind: 'exe', path: `C:\\Jeux\\${game.name}\\${slug(game)}.exe` } : base.target(game)
    if (t) gameOf.set(t, game)
    return t
  }

  async function handoff(t: LaunchTarget): Promise<void> {
    const game = gameOf.get(t)
    log(`envoi ${t.kind === 'url' ? t.url : t.path}`)
    // Windows demande quelle appli utiliser : rien ne revient.
    if (mode === 'stall') return new Promise<void>(() => {})
    await wait(ms(150))
    if (mode === 'fail') throw new LaunchError('other', 'Le fichier spécifié est introuvable. (0x2)')
    if (mode === 'nohandler') throw new LaunchError('no-handler', 'Aucune application n’est associée au fichier spécifié pour cette opération. (0x483)')
    if (mode === 'exe-missing') throw new LaunchError('exe-missing')
    if (game && mode !== 'already') play(game)
  }

  let minimized = false
  const window: LaunchWindow = {
    focused: () => false,
    minimized: () => minimized,
    maximized: () => false,
    minimize: () => {
      minimized = true
      log('Player X serait réduit (rien n’est fait en simulation)')
    },
    showInactive: () => {
      minimized = false
      log('Player X reviendrait sans activation (rien n’est fait en simulation)')
    },
    onUserRestore: () => {}
  }

  log(fast ? 'délais divisés par 10' : 'délais réels')
  const launches = createLaunches({
    ...base,
    platform: 'win32',
    timing: fast ? scaledTiming(10) : undefined,
    // La séquence de démo est remplacée : chaque phase passe par le vrai orchestrateur.
    demo: () => false,
    findGame: async (id) => {
      const game = await base.findGame(id)
      if (!game) log(`${id} introuvable dans la bibliothèque`)
      return game
    },
    target,
    handoff,
    handlerKnown: () => mode !== 'nohandler' && mode !== 'stall',
    // Mode démo : seul le compteur de démo change, comme sans simulateur. Sinon rien n'est écrit : aucun lien n'est parti,
    // la vraie bibliothèque (« Lancements », « Récents ») ne doit pas compter ce lancement.
    recordLaunch: (id) => (base.demo() ? base.recordDemoLaunch(id) : log(`${id} : lancement non enregistré (rien n’a été envoyé)`)),
    tracker,
    watcher,
    window
  })
  return { launches, isRunning, runningSince, onChange: (cb) => listeners.add(cb) }
}
