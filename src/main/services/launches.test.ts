// Tests de l'orchestrateur de lancement (npm run test:launch) : fausse horloge, fausses minuteries, faux relevé, faux suivi
// rapide et fausse fenêtre. Lanceur intégré à Node, aucune dépendance.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import type { LaunchOpts, LaunchPhase, LaunchStatus } from '@shared/launch'
import type { Game, LaunchWindowMode } from '@shared/types'
import type { LaunchTarget } from './games'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { CADENCE, createLaunches, DEMO, reduce, sanitizeOpts, scaledTiming, TIMING, windowAction, type LaunchDeps, type WindowCtx } from './launches.ts'
// @ts-ignore TS5097
import { isValid, MIN_PROCS, newMatches, parseSample, SCRIPT, tickLine, type Query, type Sample } from './launchWatchParse.ts'
// @ts-ignore TS5097
import { watchNames } from './tracking.ts'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const CS2: Game = { id: 'steam:730', store: 'steam', storeId: '730', name: 'Counter-Strike 2', installDir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\cs2' }
const APEX: Game = { id: 'ea:apex', store: 'ea', storeId: 'Origin.OFR.50.0002694', name: 'Apex Legends', installDir: 'C:\\Program Files\\EA Games\\Apex' }
const OLD: Game = { id: 'ea:old', store: 'ea', storeId: '', name: 'Old Game', installDir: 'C:\\Jeux\\EA\\Old', exePath: 'C:\\Jeux\\EA\\Old\\old.exe' }
const NONE: Game = { id: 'ea:none', store: 'ea', storeId: '', name: 'Sans cible' }
const EPIC: Game = { id: 'epic:Fortnite', store: 'epic', storeId: 'fn:x:Fortnite', name: 'Fortnite' }
/** Aucun exécutable connu : suivi par les relevés seulement. */
const NAMELESS: Game = { id: 'epic:Nameless', store: 'epic', storeId: 'x:y:Nameless', name: 'Sans nom' }
const NAMES: Record<string, string[]> = { 'steam:730': ['cs2'], 'ea:apex': ['r5apex'], 'ea:old': ['old'], 'epic:Fortnite': ['fortniteclient'] }
const FILLER = Array.from({ length: MIN_PROCS + 5 }, (_, i) => ({ pid: 100 + i, name: `svc${i}` }))

const target = (g: Game): LaunchTarget | null => {
  if (g.store === 'steam' && /^\d+$/.test(g.storeId)) return { kind: 'url', url: `steam://rungameid/${g.storeId}`, route: 'steam' }
  if (g.store === 'epic') return { kind: 'url', url: `com.epicgames.launcher://apps/${g.storeId}`, route: 'epic' }
  if (g.store === 'ea' && g.storeId) return { kind: 'url', url: `origin2://game/launch?offerIds=${g.storeId}`, route: 'ea' }
  return g.exePath ? { kind: 'exe', path: g.exePath } : null
}

interface Options {
  platform?: string
  demo?: boolean
  setting?: LaunchWindowMode
  battery?: boolean
  timing?: LaunchDeps['timing']
}

function harness(o: Options = {}) {
  const calls: string[] = []
  const call = (name: string): void => void calls.push(name)
  const statuses: LaunchStatus[] = []

  // Horloge et minuteries
  let clock = 1_000_000
  let seq = 0
  let queue: { at: number; id: number; fn: () => void }[] = []
  const timers = {
    setTimeout: (fn: () => void, ms: number): unknown => {
      const id = ++seq
      queue.push({ at: clock + Math.max(0, ms), id, fn })
      return id
    },
    clearTimeout: (id: unknown): void => {
      queue = queue.filter((t) => t.id !== id)
    }
  }
  async function advance(ms: number): Promise<void> {
    const end = clock + ms
    for (;;) {
      await flush()
      queue.sort((a, b) => a.at - b.at || a.id - b.id)
      const next = queue[0]
      if (!next || next.at > end) break
      queue.shift()
      clock = next.at
      next.fn()
    }
    clock = end
    await flush()
  }

  // Programmes en cours sur le faux PC : pid → nom
  const world = new Map<number, string>()
  let nextPid = 5000
  const run = (name: string): number => {
    const pid = nextPid++
    world.set(pid, name)
    return pid
  }

  // Faux relevé de playtime.ts : il voit les jeux dont un programme tourne, sauf ceux de `blind` ; `pinned` tourne toujours.
  const running = new Map<string, number>()
  const blind = new Set<string>()
  const pinned = new Set<string>()
  /** Programmes rattachés à un jeu par leur dossier au dernier relevé, en plus de NAMES (noms génériques compris, comme matchGames). */
  const folder = new Map<string, Set<string>>()
  const listeners: (() => void)[] = []
  const nudges: (() => boolean)[] = []
  const t = {
    pollOk: true,
    /** Résultat du dernier relevé, faux aussi après des sessions arrêtées sans relevé (gap). */
    lastOk: true,
    polls: 0,
    /** Durée d'un relevé : la liste est prise au début, rendue à la fin (un vrai relevé dure 0,5 à 1,5 s). */
    pollDelay: 0,
    snapshot: new Set(FILLER.map((p) => p.pid)) as Set<number> | null,
    storeOpen: true as boolean | null,
    /** La base refuse d'écrire (antivirus, OneDrive). */
    recordFails: false
  }
  const seen = (id: string): boolean => pinned.has(id) || (!blind.has(id) && [...world.values()].some((n) => NAMES[id]?.includes(n)))
  const tracker = {
    isRunning: (id: string): boolean => {
      call('tracker.isRunning')
      return running.has(id)
    },
    runningSince: (id: string): number | undefined => {
      call('tracker.runningSince')
      return running.get(id)
    },
    pollNow: async (): Promise<boolean> => {
      call('tracker.pollNow')
      t.polls++
      const ok = t.pollOk
      const ids = Object.keys(NAMES).concat([...pinned])
      const snap = new Map(ids.map((id) => [id, seen(id)]))
      if (t.pollDelay) await new Promise<void>((resolve) => timers.setTimeout(resolve, t.pollDelay))
      // Comme playtime.ts : le premier relevé réussi après une panne prévient tout le monde.
      let changed = ok && !t.lastOk
      t.lastOk = ok
      if (!ok) return false
      for (const id of ids) {
        if (snap.get(id) && !running.has(id)) {
          running.set(id, clock)
          changed = true
        } else if (!snap.get(id) && running.delete(id)) changed = true
      }
      if (changed) for (const cb of listeners) cb()
      return true
    },
    lastPollOk: (): boolean => {
      call('tracker.lastPollOk')
      return t.lastOk
    },
    snapshotPids: (): Set<number> | null => {
      call('tracker.snapshotPids')
      return t.snapshot
    },
    storeWasRunning: (): boolean | null => {
      call('tracker.storeWasRunning')
      return t.storeOpen
    },
    exeNamesFor: async (g: Game): Promise<Set<string>> => {
      call('tracker.exeNamesFor')
      return new Set(NAMES[g.id] ?? [])
    },
    matchedNames: (id: string): Set<string> => {
      call('tracker.matchedNames')
      if (!running.has(id)) return new Set()
      // Comme playtime.ts : sans les noms génériques.
      return watchNames([...[...world.values()].filter((n) => NAMES[id]?.includes(n)), ...(folder.get(id) ?? [])])
    },
    nudge: (still: () => boolean): void => {
      call('tracker.nudge')
      nudges.push(still)
      for (const ms of [20_000, 45_000])
        timers.setTimeout(() => {
          if (still()) void tracker.pollNow()
        }, ms)
    },
    onChange: (cb: () => void): void => void listeners.push(cb)
  }

  // Faux suivi rapide : relevé = programmes système + programmes du faux PC. `timeouts` : il ne répond plus (3 ratés → hors service).
  const w = {
    timeouts: false,
    fails: 0,
    alive: false,
    samples: [] as number[],
    queries: [] as Query[],
    windows: new Set<number>(),
    runningAppId: null as string | null,
    updating: new Map<string, boolean>(),
    cost: { p95CpuMs: 12, ws: 50e6, samples: 0 },
    last: null as { at: number; sample: Sample } | null,
    stops: 0,
    onDown: (_why: string): void => {}
  }
  const watcher = {
    alive: (): boolean => w.alive,
    sample: async (q: Query): Promise<Sample | null> => {
      call('watcher.sample')
      w.alive = true
      w.samples.push(clock)
      w.queries.push(q)
      if (w.timeouts) {
        if (++w.fails >= 3) {
          w.alive = false
          w.fails = 0
          w.onDown('pas de réponse')
        }
        return null
      }
      const s: Sample = {
        procs: [...FILLER, ...[...world].map(([pid, name]) => ({ pid, name }))],
        windows: new Set(w.windows),
        runningAppId: w.runningAppId,
        updating: new Map(w.updating),
        cpuMs: 0,
        ws: 0
      }
      w.cost.samples++
      w.last = { at: clock, sample: s }
      return s
    },
    last: () => {
      call('watcher.last')
      return w.last
    },
    cost: () => w.cost,
    stop: (): void => {
      call('watcher.stop')
      w.alive = false
      w.stops++
    }
  }

  // Fausse fenêtre de Player X
  const win = { focused: false, minimized: false, maximized: false, userRestore: (): void => {} }
  const window = {
    focused: (): boolean => {
      call('window.focused')
      return win.focused
    },
    minimized: (): boolean => {
      call('window.minimized')
      return win.minimized
    },
    maximized: (): boolean => {
      call('window.maximized')
      return win.maximized
    },
    minimize: (): void => {
      call('window.minimize')
      win.minimized = true
    },
    showInactive: (): void => {
      call('window.showInactive')
      win.minimized = false
    },
    onUserRestore: (cb: () => void): void => {
      win.userRestore = cb
    }
  }

  const recorded: string[] = []
  const demoRecorded: string[] = []
  let handoffImpl: (t: LaunchTarget) => Promise<void> = async () => {}
  let gamesChanged = 0
  const games = [CS2, APEX, OLD, NONE, EPIC, NAMELESS]
  const deps: LaunchDeps = {
    platform: o.platform ?? 'win32',
    now: () => clock,
    timers,
    timing: o.timing,
    findGame: async (id) => {
      call('findGame')
      return games.find((g) => g.id === id)
    },
    demo: () => {
      call('demo')
      return !!o.demo
    },
    target: (g) => {
      call('target')
      return target(g)
    },
    handoff: (tg) => {
      call('handoff')
      return handoffImpl(tg)
    },
    handlerKnown: () => {
      call('handlerKnown')
      return true
    },
    recordLaunch: (id) => {
      call('recordLaunch')
      if (t.recordFails) throw new Error('EBUSY: resource busy or locked')
      recorded.push(id)
    },
    recordDemoLaunch: (id) => {
      call('recordDemoLaunch')
      if (t.recordFails) throw new Error('EPERM: operation not permitted')
      demoRecorded.push(id)
    },
    tracker,
    watcher: (onDown) => {
      w.onDown = onDown
      return watcher
    },
    newMatches,
    window,
    onBattery: () => !!o.battery,
    settings: () => ({ launchWindow: o.setting ?? 'stay' }),
    emit: (s) => {
      call('emit')
      statuses.push(s)
    },
    gamesChanged: () => {
      call('gamesChanged')
      gamesChanged++
    },
    log: () => {}
  }
  const launches = createLaunches(deps)

  /** Envoi qui ne revient qu'à la demande. */
  function manualHandoff(): { resolve: () => void; reject: (e: unknown) => void } {
    const ctl = { resolve: (): void => {}, reject: (_e: unknown): void => {} }
    handoffImpl = () =>
      new Promise<void>((resolve, reject) => {
        ctl.resolve = resolve
        ctl.reject = reject
      })
    return ctl
  }
  const of = (id: string): LaunchStatus[] => statuses.filter((s) => s.launchId === id)
  const last = (id: string): LaunchStatus => of(id).at(-1)!
  const phases = (id: string): LaunchPhase[] => of(id).map((s) => s.phase).filter((p, i, a) => i === 0 || a[i - 1] !== p)
  const count = (name: string): number => calls.filter((c) => c === name).length
  return {
    launches,
    calls,
    count,
    statuses,
    of,
    last,
    phases,
    advance,
    now: () => clock,
    world,
    run,
    running,
    blind,
    pinned,
    folder,
    t,
    w,
    win,
    nudges,
    recorded,
    demoRecorded,
    gamesChanged: () => gamesChanged,
    setHandoff: (fn: (t: LaunchTarget) => Promise<void>) => void (handoffImpl = fn),
    manualHandoff,
    poll: () => tracker.pollNow(),
    /** Changement signalé sans relevé (compteur Steam, par exemple). */
    change: () => {
      for (const cb of listeners) cb()
    },
    /** Trois relevés manqués d'affilée (playtime.ts) : les sessions s'arrêtent sans qu'aucun relevé ait vu le jeu partir. */
    gap: () => {
      t.lastOk = false
      running.clear()
      for (const cb of listeners) cb()
    }
  }
}

const opts = (launchId: string, over: Partial<LaunchOpts> = {}): LaunchOpts => ({ launchId, via: 'play', ...over })

/** Avance par pas de 100 ms jusqu'à la phase voulue (au plus 2 min). */
async function untilPhase(h: ReturnType<typeof harness>, id: string, phase: LaunchPhase): Promise<void> {
  for (let i = 0; i < 1_200 && h.last(id).phase !== phase; i++) await h.advance(100)
  assert.equal(h.last(id).phase, phase)
}

/** Lance CS2, fait apparaître son programme, et attend « En jeu ». */
async function detectedCs2(h: ReturnType<typeof harness>, id = 'L1'): Promise<number> {
  await h.launches.start(CS2.id, opts(id))
  await h.advance(2_000)
  const pid = h.run('cs2')
  await h.advance(1_000)
  assert.equal(h.last(id).phase, 'running')
  return pid
}

// ---------- envoi ----------

describe('envoi', () => {
  test('handoff part avant toute autre dépendance (sauf jeu, démo, déjà en cours et création du lancement)', async () => {
    const h = harness()
    await h.launches.start(CS2.id, opts('L1'))
    const i = h.calls.indexOf('handoff')
    assert.ok(i > 0)
    const allowed = new Set(['findGame', 'target', 'demo', 'tracker.isRunning', 'tracker.pollNow', 'watcher.last', 'tracker.snapshotPids', 'tracker.storeWasRunning', 'emit'])
    for (const c of h.calls.slice(0, i)) assert.ok(allowed.has(c), `${c} avant handoff`)
    // Le lancement existe (émis en « sending ») avant l'envoi, et le nom de l'appli du lien est lu juste après.
    assert.equal(h.statuses[0].phase, 'sending')
    assert.ok(h.calls.indexOf('emit') < i)
    assert.equal(h.calls[i + 1], 'handlerKnown')
    for (const later of ['tracker.exeNamesFor', 'recordLaunch', 'tracker.nudge', 'watcher.sample']) {
      await h.advance(0)
      assert.ok(h.calls.indexOf(later) > i, later)
    }
  })

  test('premier statut : route, base « programme nouveau », store ouvert, détection rapide', async () => {
    const h = harness()
    h.t.storeOpen = false
    const s = await h.launches.start(CS2.id, opts('L1', { via: 'retry' }))
    const first = h.of('L1')[0]
    assert.deepEqual(
      { route: first.route, phase: first.phase, detect: first.detect, via: first.via, rev: first.rev, storeWasOpen: first.storeWasOpen },
      { route: 'steam', phase: 'sending', detect: 'fast', via: 'retry', rev: 1, storeWasOpen: false }
    )
    assert.equal(s.phase, 'waiting')
    assert.equal(s.handler, true)
    assert.equal(s.handedAt, h.now())
    assert.deepEqual(h.recorded, [CS2.id])
  })

  const failures: [string, unknown, string, string | undefined][] = [
    ['no-handler avec le message de Windows', { reason: 'no-handler', detail: 'Aucune application n’est associée à ce lien. (0x483)' }, 'no-handler', 'Aucune application n’est associée à ce lien. (0x483)'],
    ['exe-missing', { reason: 'exe-missing' }, 'exe-missing', undefined],
    ['erreur anglaise d’Electron', new Error('Failed to open: Something went wrong'), 'other', undefined],
    ['texte brut', 'boom', 'other', undefined],
    ['raison inconnue', { reason: 'nope', detail: 42 }, 'other', undefined]
  ]
  for (const [name, err, reason, detail] of failures) {
    test(`échec d’envoi (${name}) → failed:${reason}, jamais enregistré`, async () => {
      const h = harness()
      h.setHandoff(async () => {
        throw err
      })
      const s = await h.launches.start(CS2.id, opts('L1'))
      assert.equal(s.phase, 'failed')
      assert.equal(s.reason, reason)
      assert.equal(s.detail, detail)
      assert.equal(h.count('recordLaunch'), 0)
      // Aucun texte anglais d'Electron ne sort du processus principal.
      for (const st of h.statuses) assert.equal(/Failed|Error|boom/.test(JSON.stringify(st)), false)
      await h.advance(5_000)
      assert.equal(h.w.alive, false)
    })
  }

  test('envoi qui lève tout de suite → failed:other', async () => {
    const h = harness()
    h.setHandoff(() => {
      throw new Error('sync')
    })
    const s = await h.launches.start(CS2.id, opts('L1'))
    assert.equal(s.reason, 'other')
  })

  test('jeu introuvable → failed:not-found ; rien à lancer → failed:no-target ; aucun envoi', async () => {
    const h = harness()
    const a = await h.launches.start('steam:999', opts('L1'))
    assert.deepEqual([a.phase, a.reason, a.route], ['failed', 'not-found', 'steam'])
    const b = await h.launches.start(NONE.id, opts('L2'))
    assert.deepEqual([b.phase, b.reason], ['failed', 'no-target'])
    assert.equal(h.count('handoff'), 0)
  })

  test('exécutable : route exe, pas de lecture du store ni de l’appli du lien', async () => {
    const h = harness()
    const s = await h.launches.start(OLD.id, opts('L1'))
    assert.equal(s.route, 'exe')
    assert.equal(s.storeWasOpen, undefined)
    assert.equal(s.handler, undefined)
    assert.equal(h.count('handlerKnown'), 0)
    assert.equal(h.count('tracker.storeWasRunning'), 0)
  })

  test('hors Windows → untracked, enregistré, ni suivi ni relevé', async () => {
    const h = harness({ platform: 'linux' })
    const s = await h.launches.start(CS2.id, opts('L1'))
    assert.equal(s.phase, 'untracked')
    assert.equal(s.detect, 'none')
    assert.deepEqual(h.recorded, [CS2.id])
    await h.advance(60_000)
    assert.equal(h.count('watcher.sample'), 0)
    assert.equal(h.count('tracker.nudge'), 0)
  })
})

// ---------- phases ----------

describe('phases', () => {
  test('sending pendant 300 s → gave-up ; l’envoi tardif est enregistré une fois, sans rien montrer', async () => {
    const h = harness()
    const ctl = h.manualHandoff()
    const p = h.launches.start(CS2.id, opts('L1'))
    await h.advance(TIMING.GAVE_UP_MS - 1)
    assert.equal(h.last('L1').phase, 'sending')
    await h.advance(1)
    assert.equal(h.last('L1').phase, 'gave-up')
    assert.equal(h.last('L1').handedAt, undefined)
    assert.equal((await p).phase, 'gave-up')
    const n = h.statuses.length
    const changed = h.gamesChanged()
    ctl.resolve()
    await h.advance(1_000)
    assert.deepEqual(h.recorded, [CS2.id])
    assert.equal(h.statuses.length, n)
    // Enregistré après le rafraîchissement de la sortie d'attente : la bibliothèque est relue encore une fois.
    assert.equal(h.gamesChanged(), changed + 1)
  })

  test('waiting 300 s après l’envoi → gave-up, puis le suivi s’arrête', async () => {
    const h = harness()
    const ctl = h.manualHandoff()
    void h.launches.start(CS2.id, opts('L1'))
    await h.advance(10_000)
    ctl.resolve()
    await h.advance(0)
    assert.equal(h.last('L1').phase, 'waiting')
    await h.advance(TIMING.GAVE_UP_MS - 1)
    assert.equal(h.last('L1').phase, 'waiting')
    await h.advance(1)
    assert.equal(h.last('L1').phase, 'gave-up')
    assert.equal(h.last('L1').silent, undefined)
    assert.equal(h.w.alive, false)
    const n = h.count('watcher.sample')
    await h.advance(60_000)
    assert.equal(h.count('watcher.sample'), n)
  })

  test('candidat non confirmé par le relevé → reste waiting, nouvel essai après 10 s', async () => {
    const h = harness()
    h.blind.add(CS2.id)
    await h.launches.start(CS2.id, opts('L1'))
    await h.advance(1_000)
    h.run('cs2')
    await h.advance(1_500)
    assert.equal(h.last('L1').phase, 'waiting')
    const polls = h.t.polls
    assert.ok(polls >= 1)
    // Même PID : pas de nouveau relevé avant 10 s.
    await h.advance(5_000)
    assert.equal(h.t.polls, polls)
    h.blind.delete(CS2.id)
    await h.advance(5_000)
    assert.equal(h.last('L1').phase, 'running')
  })

  test('nouveau PID pendant une confirmation : une autre juste après, sans attendre 10 s', async () => {
    const h = harness()
    h.t.pollDelay = 1_500
    h.blind.add(CS2.id)
    await h.launches.start(CS2.id, opts('L1'))
    await h.advance(1_500)
    // Vu à 2 s : la confirmation va de 2 s à 3,5 s, et sa liste est prise avant le vrai jeu.
    h.run('cs2')
    await h.advance(1_000)
    // Le vrai programme apparaît à 2,5 s et le relevé rapide le voit à 3 s, pendant la confirmation.
    h.blind.delete(CS2.id)
    h.run('cs2')
    await h.advance(3_000)
    assert.equal(h.last('L1').phase, 'running')
    assert.equal(h.t.polls, 2)
  })

  test('nom déjà porté avant le clic (sous-processus d’un store) : ses nouveaux PID attendent les 10 s', async () => {
    const h = harness()
    h.blind.add(CS2.id)
    const old = h.run('cs2')
    h.t.snapshot = new Set([...FILLER.map((p) => p.pid), old])
    await h.launches.start(CS2.id, opts('L1'))
    for (let i = 0; i < 12; i++) {
      h.run('cs2')
      await h.advance(1_000)
    }
    assert.equal(h.t.polls, 2)
    // Le jeu qui porte ce nom est quand même détecté, au plus 10 s plus tard.
    h.blind.delete(CS2.id)
    await h.advance(TIMING.CONFIRM_REARM_MS)
    assert.equal(h.last('L1').phase, 'running')
  })

  test('confirmé → running avec detectedAt, en 1 à 2 s, et le relevé rapproché suivant n’a plus lieu', async () => {
    const h = harness()
    await h.launches.start(CS2.id, opts('L1'))
    await h.advance(3_000)
    h.run('cs2')
    const at = h.now()
    await h.advance(1_000)
    const s = h.last('L1')
    assert.equal(s.phase, 'running')
    assert.ok(s.detectedAt! - at <= 1_000)
    assert.equal(h.nudges.length, 1)
    assert.equal(h.nudges[0](), false)
  })

  test('un programme déjà là avant le clic n’est pas un démarrage', async () => {
    const h = harness()
    const pid = h.run('cs2')
    h.blind.add(CS2.id)
    h.t.snapshot = new Set([...FILLER.map((p) => p.pid), pid])
    await h.launches.start(CS2.id, opts('L1'))
    await h.advance(3_000)
    assert.equal(h.t.polls, 0)
    assert.equal(h.last('L1').phase, 'waiting')
  })

  test('Steam : jeu lancé d’après Steam → confirmation, au plus une fois toutes les 10 s ; mise à jour signalée', async () => {
    const h = harness()
    h.blind.add(CS2.id)
    await h.launches.start(CS2.id, opts('L1'))
    h.w.runningAppId = '730'
    h.w.updating.set('730', true)
    await h.advance(1_500)
    assert.equal(h.last('L1').steamUpdating, true)
    assert.equal(h.t.polls, 1)
    await h.advance(8_000)
    assert.equal(h.t.polls, 1)
    await h.advance(3_000)
    assert.equal(h.t.polls, 2)
    assert.deepEqual([...(h.w.queries.at(-1)!.s ?? [])], ['730'])
  })

  test('sans suivi rapide (aucun nom, pas Steam) → detect poll, « En jeu » par le relevé rapproché de 20 s', async () => {
    const h = harness()
    await h.launches.start(NAMELESS.id, opts('L1'))
    await h.advance(0)
    assert.equal(h.last('L1').detect, 'poll')
    assert.equal(h.count('watcher.sample'), 0)
    h.pinned.add(NAMELESS.id)
    await h.advance(19_000)
    assert.equal(h.last('L1').phase, 'waiting')
    await h.advance(1_000)
    assert.equal(h.last('L1').phase, 'running')
  })

  test('relevé de la minute qui voit le jeu → running (reconcile) ; quitter l’attente rafraîchit la bibliothèque', async () => {
    const h = harness()
    await h.launches.start(APEX.id, opts('L1'))
    h.w.timeouts = true
    await h.advance(30_000)
    assert.equal(h.last('L1').detect, 'poll')
    const before = h.gamesChanged()
    h.run('r5apex')
    await h.poll()
    assert.equal(h.last('L1').phase, 'running')
    assert.equal(h.gamesChanged(), before + 1)
  })
})

// ---------- fin de partie et relais ----------

describe('fin de partie et relais', () => {
  test('fermé moins de 30 s après la détection → relay, sans relevé', async () => {
    const h = harness()
    const pid = await detectedCs2(h)
    const polls = h.t.polls
    await h.advance(10_000)
    h.world.delete(pid)
    await h.advance(11_000)
    const s = h.last('L1')
    assert.equal(s.phase, 'relay')
    assert.ok(s.goneAt! - s.detectedAt! < TIMING.EARLY_MS)
    assert.equal(h.t.polls, polls)
  })

  test('relay + nouveau PID → running ; sinon 60 s → early-exit', async () => {
    const h = harness()
    const pid = await detectedCs2(h)
    h.world.delete(pid)
    await h.advance(11_000)
    assert.equal(h.last('L1').phase, 'relay')
    h.run('cs2')
    await h.advance(1_500)
    const s = h.last('L1')
    assert.equal(s.phase, 'running')
    assert.equal(s.goneAt, undefined)

    const h2 = harness()
    const pid2 = await detectedCs2(h2)
    h2.world.delete(pid2)
    await h2.poll()
    await h2.advance(11_000)
    assert.equal(h2.last('L1').phase, 'relay')
    await h2.advance(TIMING.RELAY_GRACE_MS)
    const e = h2.last('L1')
    assert.equal(e.phase, 'early-exit')
    assert.ok(e.endedAt)
  })

  test('relais : un état « en jeu » d’avant la fermeture ne fait pas revenir « En jeu »', async () => {
    const h = harness()
    const pid = await detectedCs2(h)
    h.world.delete(pid)
    await h.advance(11_000)
    assert.equal(h.last('L1').phase, 'relay')
    // Aucun relevé depuis la fermeture : le faux relevé croit encore au jeu. Un changement sans relevé (compteur Steam)
    // déclenche reconcile, qui refait un relevé avant de conclure.
    assert.equal(h.running.has(CS2.id), true)
    const polls = h.t.polls
    h.change()
    await h.advance(0)
    assert.equal(h.t.polls, polls + 1)
    assert.equal(h.last('L1').phase, 'relay')
  })

  test('fermé 30 s ou plus après la détection, confirmé par le relevé → ended', async () => {
    const h = harness()
    const pid = await detectedCs2(h)
    await h.advance(40_000)
    h.world.delete(pid)
    await h.advance(12_000)
    const s = h.last('L1')
    assert.equal(s.phase, 'ended')
    assert.ok(s.goneAt! - s.detectedAt! >= TIMING.EARLY_MS)
    assert.equal(s.silent, undefined)
  })

  // Jeu Unreal avec son navigateur intégré, rattaché par son dossier, pendant qu'Epic Games fait tourner le sien.
  async function detectedWithCef(h: ReturnType<typeof harness>): Promise<{ game: number; cef: number }> {
    const epicCef = h.run('UnrealCEFSubProcess')
    h.t.snapshot = new Set([...h.t.snapshot!, epicCef])
    await h.launches.start(EPIC.id, opts('L1'))
    await h.advance(2_000)
    const game = h.run('fortniteclient')
    const cef = h.run('UnrealCEFSubProcess')
    h.folder.set(EPIC.id, new Set(['unrealcefsubprocess']))
    await h.advance(1_000)
    assert.equal(h.last('L1').phase, 'running')
    return { game, cef }
  }

  test('nom générique rattaché par le dossier (UnrealCEFSubProcess) : la copie d’Epic ne retient pas la partie', async () => {
    const h = harness({ setting: 'minimize' })
    const { game, cef } = await detectedWithCef(h)
    await h.advance(40_000)
    assert.equal(h.count('window.minimize'), 1)
    h.world.delete(game)
    h.world.delete(cef)
    const closedAt = h.now()
    // Le suivi rapide seul (aucun relevé de la minute dans ce faux PC) voit la fermeture et Player X revient.
    await untilPhase(h, 'L1', 'ended')
    assert.ok(h.now() - closedAt <= 15_000, `${h.now() - closedAt} ms`)
    await h.advance(TIMING.RESTORE_DELAY_MS)
    assert.equal(h.count('window.showInactive'), 1)
  })

  test('nom générique rattaché par le dossier : un plantage juste après la détection passe par le relais, puis early-exit', async () => {
    const h = harness()
    const { game, cef } = await detectedWithCef(h)
    await h.advance(10_000)
    h.world.delete(game)
    h.world.delete(cef)
    await h.advance(11_000)
    assert.equal(h.last('L1').phase, 'relay')
    await h.advance(TIMING.RELAY_GRACE_MS)
    assert.deepEqual(h.phases('L1'), ['sending', 'waiting', 'running', 'relay', 'early-exit'])
  })

  test('relevé de confirmation en échec : rien ne se termine, nouvel essai toutes les 5 s', async () => {
    const h = harness()
    const pid = await detectedCs2(h)
    await h.advance(40_000)
    h.t.pollOk = false
    h.world.delete(pid)
    await h.advance(30_000)
    assert.equal(h.last('L1').phase, 'running')
    const polls = h.t.polls
    await h.advance(5_000)
    assert.ok(h.t.polls > polls)
    h.t.pollOk = true
    await h.advance(5_000)
    assert.equal(h.last('L1').phase, 'ended')
  })

  test('le relevé voit encore le jeu (par son dossier) → plus de suivi rapide, le relevé de la minute décidera', async () => {
    const h = harness()
    const pid = await detectedCs2(h)
    await h.advance(40_000)
    h.world.delete(pid)
    h.pinned.add(CS2.id)
    await h.advance(12_000)
    assert.equal(h.last('L1').phase, 'running')
    assert.equal(h.w.alive, false)
    h.pinned.delete(CS2.id)
    await h.poll()
    assert.equal(h.last('L1').phase, 'ended')
  })

  test('relais et relevés en échec : l’attente s’arrête sans carte 5 min après la fermeture, et le suivi aussi', async () => {
    const h = harness()
    const pid = await detectedCs2(h)
    h.world.delete(pid)
    await h.advance(11_000)
    const s = h.last('L1')
    assert.equal(s.phase, 'relay')
    h.t.pollOk = false
    await h.advance(s.goneAt! + TIMING.GAVE_UP_MS - h.now() - 1)
    assert.equal(h.last('L1').phase, 'relay')
    await h.advance(1)
    assert.deepEqual([h.last('L1').phase, h.last('L1').silent], ['gave-up', true])
    assert.equal(h.w.alive, false)
    const polls = h.t.polls
    const samples = h.count('watcher.sample')
    await h.advance(10 * 60_000)
    assert.equal(h.t.polls, polls)
    assert.equal(h.count('watcher.sample'), samples)
  })

  test('le relevé ne voit plus le jeu : il fait foi pendant le suivi rapide (même nom dans un autre dossier)', async () => {
    const h = harness()
    const pid = await detectedCs2(h)
    await h.advance(40_000)
    // Même nom, autre dossier : le relevé par chemin ne le rattache pas au jeu, le relevé rapide ne voit que le nom.
    h.blind.add(CS2.id)
    h.run('cs2')
    h.world.delete(pid)
    await h.advance(20_000)
    assert.equal(h.last('L1').phase, 'running')
    await h.poll()
    assert.equal(h.last('L1').phase, 'ended')
    assert.equal(h.last('L1').silent, undefined)
    // Moins de 30 s après la détection, c'est un relais, comme avec le relevé rapide.
    const h2 = harness()
    const pid2 = await detectedCs2(h2)
    h2.world.delete(pid2)
    await h2.poll()
    assert.equal(h2.last('L1').phase, 'relay')
  })

  test('sessions arrêtées sans relevé réussi (PowerShell en panne 3 min) : la partie s’efface sans annonce', async () => {
    const h = harness()
    await detectedCs2(h)
    await h.advance(TIMING.WATCH_AFTER_RUNNING_MS + 10_000)
    assert.equal(h.w.alive, false)
    h.t.pollOk = false
    await h.poll()
    h.gap()
    assert.deepEqual([h.last('L1').phase, h.last('L1').silent], ['cancelled', true])
    assert.equal(h.phases('L1').includes('ended'), false)
  })

  test('relevé tronqué (null) : jamais compté comme une fermeture', async () => {
    const h = harness()
    await detectedCs2(h)
    await h.advance(40_000)
    // Relevés ratés, sans jamais atteindre les trois d'affilée qui couperaient le suivi rapide.
    h.w.timeouts = true
    h.w.fails = -100
    await h.advance(30_000)
    assert.equal(h.last('L1').phase, 'running')
  })
})

// ---------- santé du suivi rapide ----------

describe('suivi rapide', () => {
  test('3 relevés sans réponse → detect poll, relevés rapprochés, plus d’essai pendant 10 min', async () => {
    const h = harness()
    h.w.timeouts = true
    await h.launches.start(CS2.id, opts('L1'))
    await h.advance(5_000)
    assert.equal(h.last('L1').detect, 'poll')
    assert.equal(h.count('tracker.nudge'), 2)
    assert.equal(h.count('watcher.sample'), 3)
    h.w.timeouts = false
    const s = await h.launches.start(APEX.id, opts('L2'))
    assert.equal(s.detect, 'poll')
    await h.advance(60_000)
    assert.equal(h.count('watcher.sample'), 3)
    // Au bout de 10 min, le suivi rapide est de nouveau essayé.
    await h.advance(TIMING.WATCH_OFF_MS)
    await h.launches.start(OLD.id, opts('L3'))
    await h.advance(0)
    assert.equal(h.last('L3').detect, 'fast')
    assert.ok(h.count('watcher.sample') > 3)
  })

  test('rythme : 1 s en attente sur secteur, 2,5 s sur batterie ; 5 s / 10 s pendant la partie', async () => {
    for (const battery of [false, true]) {
      const h = harness({ battery })
      await h.launches.start(CS2.id, opts('L1'))
      await h.advance(10_000)
      const gaps = h.w.samples.slice(1).map((at, i) => at - h.w.samples[i])
      assert.ok(gaps.length > 2)
      for (const g of gaps) assert.equal(g, CADENCE.pending[battery ? 1 : 0])
      h.run('cs2')
      await h.advance(CADENCE.pending[1] + 100)
      assert.equal(h.last('L1').phase, 'running')
      const from = h.w.samples.length
      await h.advance(40_000)
      const later = h.w.samples.slice(from)
      for (let i = 1; i < later.length; i++) assert.equal(later[i] - later[i - 1], CADENCE.running[battery ? 1 : 0])
    }
  })

  test('au-delà du budget : suivi gardé pour l’attente, arrêté dès qu’aucun lancement n’attend', async () => {
    const h = harness()
    h.w.cost = { p95CpuMs: 70, ws: 50e6, samples: 20 }
    await h.launches.start(CS2.id, opts('L1'))
    await h.advance(3_000)
    assert.equal(h.w.alive, true)
    assert.equal(h.last('L1').detect, 'fast')
    const pid = h.run('cs2')
    await h.advance(1_500)
    assert.equal(h.last('L1').phase, 'running')
    assert.equal(h.w.alive, false)
    // La fin vient alors du relevé de la minute.
    h.world.delete(pid)
    await h.poll()
    assert.equal(h.last('L1').phase, 'ended')
  })

  test('très au-delà du budget (p95 > 150 ms) → detect poll tout de suite', async () => {
    const h = harness()
    h.w.cost = { p95CpuMs: 200, ws: 50e6, samples: 20 }
    await h.launches.start(CS2.id, opts('L1'))
    await h.advance(1_000)
    assert.equal(h.last('L1').detect, 'poll')
    assert.equal(h.w.alive, false)
  })

  test('arrêté quand plus rien n’en a besoin : 90 s après la détection', async () => {
    const h = harness()
    await detectedCs2(h)
    await h.advance(TIMING.WATCH_AFTER_RUNNING_MS - 6_000)
    assert.equal(h.w.alive, true)
    await h.advance(12_000)
    assert.equal(h.w.alive, false)
    assert.equal(h.last('L1').phase, 'running')
    const n = h.count('watcher.sample')
    await h.advance(120_000)
    assert.equal(h.count('watcher.sample'), n)
  })

  test('un seul suivi pour deux lancements, requête avec les noms des deux jeux', async () => {
    const h = harness()
    await h.launches.start(CS2.id, opts('L1'))
    await h.launches.start(APEX.id, opts('L2'))
    await h.advance(3_000)
    const q = h.w.queries.at(-1)!
    assert.deepEqual(
      (q.w ?? []).map((names) => [...names]),
      [['cs2'], ['r5apex']]
    )
    h.run('r5apex')
    await h.advance(1_500)
    assert.equal(h.last('L2').phase, 'running')
    assert.equal(h.last('L1').phase, 'waiting')
  })
})

// ---------- déjà en cours, relance ----------

describe('déjà en cours', () => {
  test('double clic : le lancement en attente répond (même launchId), un seul envoi', async () => {
    const h = harness()
    h.manualHandoff()
    void h.launches.start(CS2.id, opts('L1'))
    await h.advance(0)
    const s = await h.launches.start(CS2.id, opts('L2'))
    assert.equal(s.launchId, 'L1')
    assert.equal(h.count('handoff'), 1)
    // Même launchId renvoyé deux fois : même réponse.
    assert.equal((await h.launches.start(CS2.id, opts('L1'))).launchId, 'L1')
  })

  test('jeu en cours → relevé frais, puis already avec runningSince, sans envoi', async () => {
    const h = harness()
    h.pinned.add(CS2.id)
    await h.poll()
    const since = h.running.get(CS2.id)
    const polls = h.t.polls
    const s = await h.launches.start(CS2.id, opts('L1'))
    assert.equal(s.phase, 'already')
    assert.equal(s.runningSince, since)
    assert.equal(h.t.polls, polls + 1)
    assert.equal(h.count('handoff'), 0)
  })

  test('relevé frais en échec alors que le jeu semblait tourner → already quand même', async () => {
    const h = harness()
    h.running.set(CS2.id, 5)
    h.t.pollOk = false
    const s = await h.launches.start(CS2.id, opts('L1'))
    assert.equal(s.phase, 'already')
    assert.equal(h.count('handoff'), 0)
  })

  test('pastille « En jeu » périmée : le relevé frais ne voit plus le jeu → lancement normal', async () => {
    const h = harness()
    h.running.set(CS2.id, 5)
    const s = await h.launches.start(CS2.id, opts('L1'))
    assert.equal(s.phase, 'waiting')
  })

  test('« Relancer quand même » (force) → envoi, resent, sans suivi rapide', async () => {
    const h = harness()
    h.pinned.add(CS2.id)
    await h.poll()
    const s = await h.launches.start(CS2.id, opts('L1', { via: 'relaunch', force: true }))
    assert.equal(s.phase, 'resent')
    assert.equal(h.count('handoff'), 1)
    assert.deepEqual(h.recorded, [CS2.id])
    await h.advance(5_000)
    assert.equal(h.count('watcher.sample'), 0)
  })

  test('« Relancer quand même », le jeu ne tourne plus à la fin de l’envoi → waiting avec le suivi rapide', async () => {
    const h = harness()
    h.pinned.add(CS2.id)
    await h.poll()
    const ctl = h.manualHandoff()
    void h.launches.start(CS2.id, opts('L1', { via: 'relaunch', force: true }))
    await h.advance(0)
    // Noms lus pendant l'envoi, jeu encore vu : pas de suivi rapide pour l'instant.
    assert.equal(h.count('watcher.sample'), 0)
    h.pinned.delete(CS2.id)
    await h.poll()
    ctl.resolve()
    await h.advance(0)
    assert.deepEqual([h.last('L1').phase, h.last('L1').detect], ['waiting', 'fast'])
    h.run('cs2')
    await h.advance(2_000)
    assert.equal(h.last('L1').phase, 'running')
    assert.ok(h.count('watcher.sample') > 0)
  })

  test('force sur un lancement en attente : l’ancien s’efface sans bruit', async () => {
    const h = harness()
    h.manualHandoff()
    void h.launches.start(CS2.id, opts('L1'))
    await h.advance(0)
    h.setHandoff(async () => {})
    await h.launches.start(CS2.id, opts('L2', { force: true }))
    assert.equal(h.last('L1').phase, 'cancelled')
    assert.equal(h.last('L1').silent, true)
    assert.equal(h.last('L2').phase, 'waiting')
  })
})

// ---------- annulation et cycle de vie ----------

describe('cycle de vie', () => {
  test('« Ne plus attendre » pendant l’envoi : envoi tardif enregistré une fois, rien de montré', async () => {
    const h = harness()
    const ctl = h.manualHandoff()
    const p = h.launches.start(CS2.id, opts('L1'))
    await h.advance(1_000)
    h.launches.cancel('L1')
    assert.equal((await p).phase, 'cancelled')
    const n = h.statuses.length
    const changed = h.gamesChanged()
    ctl.resolve()
    await h.advance(10_000)
    assert.deepEqual(h.recorded, [CS2.id])
    assert.equal(h.statuses.length, n)
    assert.equal(h.gamesChanged(), changed + 1)
    assert.equal(h.w.alive, false)
  })

  test('base qui refuse d’écrire : start() ne rejette jamais, en démo comme en vrai', async () => {
    const h = harness()
    h.t.recordFails = true
    assert.equal((await h.launches.start(CS2.id, opts('L1'))).phase, 'waiting')
    const d = harness({ demo: true })
    d.t.recordFails = true
    const s = await d.launches.start(CS2.id, opts('D1'))
    assert.deepEqual([s.phase, s.demo], ['sending', true])
    await d.advance(DEMO.running)
    assert.equal(d.last('D1').phase, 'running')
  })

  test('« Ne plus attendre » pendant l’attente et le relais ; sans effet sur une partie', async () => {
    const h = harness()
    await h.launches.start(CS2.id, opts('L1'))
    h.launches.cancel('L1')
    assert.equal(h.last('L1').phase, 'cancelled')
    assert.equal(h.last('L1').silent, undefined)
    await h.advance(0)
    assert.equal(h.w.alive, false)

    const h2 = harness()
    const pid = await detectedCs2(h2)
    h2.launches.cancel('L1')
    assert.equal(h2.last('L1').phase, 'running')
    h2.world.delete(pid)
    await h2.advance(11_000)
    assert.equal(h2.last('L1').phase, 'relay')
    h2.launches.cancel('L1')
    assert.equal(h2.last('L1').phase, 'cancelled')
  })

  test('mise en veille : attente → gave-up silencieux, partie → cancelled silencieux, suivi coupé', async () => {
    const h = harness()
    await h.launches.start(APEX.id, opts('L2'))
    await detectedCs2(h)
    h.launches.suspend()
    assert.deepEqual([h.last('L2').phase, h.last('L2').silent], ['gave-up', true])
    assert.deepEqual([h.last('L1').phase, h.last('L1').silent], ['cancelled', true])
    assert.ok(h.w.stops > 0)
    assert.equal(h.w.alive, false)
  })

  test('reset (mode démo basculé) : tout s’arrête sans bruit, list() vide', async () => {
    const h = harness()
    await h.launches.start(APEX.id, opts('L2'))
    await detectedCs2(h)
    h.launches.reset()
    for (const id of ['L1', 'L2']) assert.deepEqual([h.last(id).phase, h.last(id).silent], ['cancelled', true])
    assert.deepEqual(h.launches.list(), [])
    assert.equal(h.w.alive, false)
  })

  test('mode démo basculé pendant le relevé frais d’un jeu « En jeu » : rien n’est envoyé, créé ni émis', async () => {
    const h = harness({ setting: 'minimize' })
    // Pastille « En jeu » périmée : le relevé frais (1 s) ne verra plus le jeu.
    h.running.set(CS2.id, 5)
    h.t.pollDelay = 1_000
    const reply = h.launches.start(CS2.id, opts('L1'))
    await h.advance(500)
    assert.equal(h.t.polls, 1)
    h.launches.reset()
    await h.advance(1_000)
    const s = await reply
    assert.deepEqual([s.launchId, s.phase, s.silent, s.demo], ['L1', 'cancelled', true, undefined])
    assert.equal(h.of('L1').length, 0)
    assert.deepEqual(h.launches.list(), [])
    assert.equal(h.count('handoff'), 0)
    assert.deepEqual(h.recorded, [])
    assert.equal(h.count('tracker.nudge'), 0)
    await h.advance(30_000)
    assert.equal(h.w.samples.length, 0)
    assert.equal(h.count('window.minimize'), 0)
  })

  test('mode démo basculé pendant la recherche du jeu (scan) : ni envoi, ni échec « introuvable »', async () => {
    const h = harness()
    const found = h.launches.start(CS2.id, opts('L1'))
    const missing = h.launches.start('steam:999', opts('L2'))
    h.launches.reset()
    for (const [p, id] of [[found, 'L1'], [missing, 'L2']] as const) {
      const s = await p
      assert.deepEqual([s.launchId, s.phase, s.silent], [id, 'cancelled', true])
      assert.equal(h.of(id).length, 0)
    }
    assert.deepEqual(h.launches.list(), [])
    assert.equal(h.count('handoff'), 0)
    assert.deepEqual(h.recorded, [])
    // Après le basculement, un nouveau clic part normalement.
    assert.equal((await h.launches.start(CS2.id, opts('L3'))).phase, 'waiting')
  })

  test('list() : lancements en cours, et terminés depuis moins de 15 min', async () => {
    const h = harness()
    await h.launches.start('steam:999', opts('L0'))
    await h.launches.start(CS2.id, opts('L1'))
    assert.deepEqual(
      h.launches.list().map((s) => s.launchId),
      ['L0', 'L1']
    )
    await h.advance(14 * 60_000)
    assert.equal(h.launches.list().length, 2)
    await h.advance(2 * 60_000)
    // L1 a abandonné à 5 min : il disparaît 15 min plus tard, L0 aussi.
    assert.deepEqual(
      h.launches.list().map((s) => s.launchId),
      ['L1']
    )
    await h.advance(5 * 60_000)
    assert.deepEqual(h.launches.list(), [])
  })

  test('rev croît à chaque statut d’un même lancement', async () => {
    const h = harness()
    const pid = await detectedCs2(h)
    await h.launches.start(APEX.id, opts('L2'))
    h.w.updating.set('730', true)
    await h.advance(40_000)
    h.world.delete(pid)
    await h.advance(20_000)
    for (const id of ['L1', 'L2']) {
      const revs = h.of(id).map((s) => s.rev)
      assert.ok(revs.length >= 2)
      for (let i = 1; i < revs.length; i++) assert.ok(revs[i] > revs[i - 1], `${id} : ${revs.join(', ')}`)
    }
    assert.deepEqual(h.phases('L1'), ['sending', 'waiting', 'running', 'ended'])
  })
})

// ---------- démo ----------

describe('mode démo', () => {
  test('séquence en mémoire : sending → waiting 250 ms → running 7 s → ended 30 s, toujours demo', async () => {
    const h = harness({ demo: true })
    const s = await h.launches.start(CS2.id, opts('D1'))
    assert.equal(s.phase, 'sending')
    const times: Record<string, number> = {}
    const t0 = h.now()
    for (let step = 0; step < 31_000; step += 50) {
      await h.advance(50)
      const p = h.last('D1').phase
      times[p] ??= h.now() - t0
    }
    assert.deepEqual(times, { sending: 50, waiting: DEMO.handoff, running: DEMO.running, ended: DEMO.ended })
    assert.ok(h.of('D1').every((x) => x.demo === true))
    assert.deepEqual(h.phases('D1'), ['sending', 'waiting', 'running', 'ended'])
    assert.equal(h.last('D1').handedAt! - t0, DEMO.handoff)
    assert.equal(h.last('D1').detectedAt! - t0, DEMO.running)
  })

  test('n’appelle jamais l’envoi, le suivi rapide, le relevé, la fenêtre ni l’enregistrement réel', async () => {
    const h = harness({ demo: true, setting: 'minimize' })
    await h.launches.start(CS2.id, opts('D1'))
    await h.launches.start(CS2.id, opts('D2'))
    await h.advance(40_000)
    h.launches.cancel('D1')
    const forbidden = h.calls.filter((c) => /^(handoff|handlerKnown|recordLaunch|tracker\.|watcher\.|window\.)/.test(c))
    assert.deepEqual(forbidden, [])
    assert.deepEqual(h.demoRecorded, [CS2.id])
  })

  test('« Ne plus attendre » en démo', async () => {
    const h = harness({ demo: true })
    await h.launches.start(CS2.id, opts('D1'))
    h.launches.cancel('D1')
    await h.advance(40_000)
    assert.deepEqual(h.phases('D1'), ['sending', 'cancelled'])
  })
})

// ---------- fenêtre ----------

describe('fenêtre', () => {
  const T = { MINIMIZE_FALLBACK_MS: 10_000, RESTORE_DELAY_MS: 1_000 }
  const base: WindowCtx = { event: 'running', windowSeen: true, sinceDetectedMs: 2_000, stillSeen: true, focused: false, minimized: false }

  test('windowAction : « Rester ouvert » ne fait jamais rien', () => {
    for (const event of ['running', 'ended', 'early-exit', 'relay', 'other'] as const) assert.deepEqual(windowAction('stay', { ...base, event }, T), { kind: 'none' })
    // Ce lancement avait réduit Player X (réglage changé entre-temps) : on oublie, sans rien toucher.
    assert.deepEqual(windowAction('stay', { event: 'ended', minimizedByThis: true, minimized: true }, T), { kind: 'clear' })
  })

  test('windowAction : réduire seulement en arrière-plan, après la fenêtre du jeu ou 10 s', () => {
    assert.deepEqual(windowAction('minimize', base, T), { kind: 'minimize' })
    assert.deepEqual(windowAction('minimize', { ...base, windowSeen: false }, T), { kind: 'none' })
    assert.deepEqual(windowAction('minimize', { ...base, windowSeen: false, sinceDetectedMs: 10_000 }, T), { kind: 'minimize' })
    assert.deepEqual(windowAction('minimize', { ...base, focused: true }, T), { kind: 'none' })
    assert.deepEqual(windowAction('minimize', { ...base, minimized: true }, T), { kind: 'none' })
    assert.deepEqual(windowAction('minimize', { ...base, stillSeen: false }, T), { kind: 'none' })
    assert.deepEqual(windowAction('minimize', { ...base, demo: true }, T), { kind: 'none' })
  })

  test('windowAction : revenir après ended ou early-exit, jamais pendant un relais', () => {
    const exit: WindowCtx = { event: 'ended', minimizedByThis: true, minimized: true, otherRunning: null }
    assert.deepEqual(windowAction('minimize', exit, T), { kind: 'restore', delayMs: 1_000 })
    assert.deepEqual(windowAction('minimize', { ...exit, event: 'early-exit' }, T), { kind: 'restore', delayMs: 1_000 })
    assert.deepEqual(windowAction('minimize', { ...exit, event: 'relay' }, T), { kind: 'none' })
    assert.deepEqual(windowAction('minimize', { ...exit, minimizedByThis: false }, T), { kind: 'none' })
    assert.deepEqual(windowAction('minimize', { ...exit, minimized: false }, T), { kind: 'clear' })
    assert.deepEqual(windowAction('minimize', { ...exit, otherRunning: 'L9' }, T), { kind: 'hand-over', to: 'L9' })
    // Agrandi : pas de retour automatique (il reviendrait à sa taille normale), sauf passage de relais à un autre jeu.
    assert.deepEqual(windowAction('minimize', { ...exit, wasMaximized: true }, T), { kind: 'clear' })
    assert.deepEqual(windowAction('minimize', { ...exit, wasMaximized: true, otherRunning: 'L9' }, T), { kind: 'hand-over', to: 'L9' })
    assert.deepEqual(windowAction('minimize', exit, { ...T, restoreOnExit: false }), { kind: 'clear' })
    assert.deepEqual(windowAction('minimize', { ...exit, demo: true }, T), { kind: 'clear' })
  })

  test('windowAction : retour par l’utilisateur ou mise en veille → oublier', () => {
    for (const setting of ['stay', 'minimize'] as const) {
      assert.deepEqual(windowAction(setting, { event: 'user-restore' }, T), { kind: 'clear' })
      assert.deepEqual(windowAction(setting, { event: 'suspend' }, T), { kind: 'clear' })
    }
  })

  test('« Rester ouvert » : la fenêtre n’est jamais touchée', async () => {
    const h = harness()
    const pid = await detectedCs2(h)
    h.w.windows.add(pid)
    await h.advance(60_000)
    h.world.delete(pid)
    await h.advance(20_000)
    assert.deepEqual(
      h.calls.filter((c) => c.startsWith('window.')),
      []
    )
  })

  test('« Se réduire » : seulement après la fenêtre du jeu, puis retour sans activation 1 s après la fin', async () => {
    const h = harness({ setting: 'minimize' })
    const pid = await detectedCs2(h)
    assert.equal(h.count('window.minimize'), 0)
    h.w.windows.add(pid)
    await h.advance(5_000)
    assert.equal(h.count('window.minimize'), 1)
    await h.advance(30_000)
    // Réduit par nous : le suivi rapide reste là au-delà de 90 s, pour revenir vite.
    await h.advance(TIMING.WATCH_AFTER_RUNNING_MS)
    assert.equal(h.w.alive, true)
    h.world.delete(pid)
    await untilPhase(h, 'L1', 'ended')
    assert.equal(h.count('window.showInactive'), 0)
    await h.advance(TIMING.RESTORE_DELAY_MS - 1)
    assert.equal(h.count('window.showInactive'), 0)
    await h.advance(1)
    assert.equal(h.count('window.showInactive'), 1)
    assert.equal(h.count('window.minimize'), 1)
  })

  test('« Se réduire » : Player X agrandi reste dans la barre des tâches à la fin, et ne revient plus tout seul', async () => {
    const h = harness({ setting: 'minimize' })
    h.win.maximized = true
    const pid = await detectedCs2(h)
    h.w.windows.add(pid)
    await h.advance(5_000)
    assert.equal(h.count('window.minimize'), 1)
    await h.advance(40_000)
    h.world.delete(pid)
    await untilPhase(h, 'L1', 'ended')
    await h.advance(TIMING.RESTORE_DELAY_MS * 5)
    assert.equal(h.count('window.showInactive'), 0)
    // Plus rien à rouvrir : un relevé suivant ne fait rien non plus.
    await h.advance(60_000)
    assert.equal(h.count('window.showInactive'), 0)
  })

  test('« Se réduire » sans fenêtre vue : au bout de 10 s ; jamais si Player X est au premier plan', async () => {
    const h = harness({ setting: 'minimize' })
    await detectedCs2(h)
    await h.advance(TIMING.MINIMIZE_FALLBACK_MS - 2_000)
    assert.equal(h.count('window.minimize'), 0)
    await h.advance(2_500)
    assert.equal(h.count('window.minimize'), 1)

    const h2 = harness({ setting: 'minimize' })
    h2.win.focused = true
    const pid = await detectedCs2(h2)
    h2.w.windows.add(pid)
    await h2.advance(30_000)
    assert.equal(h2.count('window.minimize'), 0)
  })

  test('« Se réduire » : rouverte par l’utilisateur → pas de retour automatique', async () => {
    const h = harness({ setting: 'minimize' })
    const pid = await detectedCs2(h)
    h.w.windows.add(pid)
    await h.advance(5_000)
    assert.equal(h.count('window.minimize'), 1)
    h.win.minimized = false
    h.win.userRestore()
    await h.advance(40_000)
    h.world.delete(pid)
    await h.advance(20_000)
    assert.equal(h.last('L1').phase, 'ended')
    assert.equal(h.count('window.showInactive'), 0)
  })

  test('« Se réduire » : relais puis early-exit → retour seulement à la fin, jamais pendant le relais', async () => {
    const h = harness({ setting: 'minimize' })
    const pid = await detectedCs2(h)
    h.w.windows.add(pid)
    await h.advance(CADENCE.running[0])
    assert.equal(h.count('window.minimize'), 1)
    h.world.delete(pid)
    await h.poll()
    await h.advance(11_000)
    assert.equal(h.last('L1').phase, 'relay')
    await h.advance(30_000)
    assert.equal(h.count('window.showInactive'), 0)
    await untilPhase(h, 'L1', 'early-exit')
    assert.equal(h.count('window.showInactive'), 0)
    await h.advance(TIMING.RESTORE_DELAY_MS)
    assert.equal(h.count('window.showInactive'), 1)
  })

  test('« Se réduire » : un programme d’un autre dossier porte le nom du jeu → le relevé de la minute conclut, retour', async () => {
    const h = harness({ setting: 'minimize' })
    const pid = await detectedCs2(h)
    h.w.windows.add(pid)
    await h.advance(CADENCE.running[0])
    assert.equal(h.count('window.minimize'), 1)
    await h.advance(40_000)
    h.blind.add(CS2.id)
    h.run('cs2')
    h.world.delete(pid)
    await h.advance(30_000)
    assert.equal(h.last('L1').phase, 'running')
    await h.poll()
    assert.equal(h.last('L1').phase, 'ended')
    await h.advance(TIMING.RESTORE_DELAY_MS)
    assert.equal(h.count('window.showInactive'), 1)
    assert.equal(h.w.alive, false)
  })

  test('« Se réduire » : sessions arrêtées sans relevé réussi → le relevé rapide suit toujours la partie, pas de retour', async () => {
    const h = harness({ setting: 'minimize' })
    const pid = await detectedCs2(h)
    h.w.windows.add(pid)
    await h.advance(CADENCE.running[0])
    assert.equal(h.count('window.minimize'), 1)
    h.t.pollOk = false
    await h.poll()
    h.gap()
    await h.advance(60_000)
    assert.equal(h.last('L1').phase, 'running')
    assert.equal(h.count('window.showInactive'), 0)
    // PowerShell revient, puis le jeu se ferme : fin confirmée, retour.
    h.t.pollOk = true
    await h.poll()
    h.world.delete(pid)
    await untilPhase(h, 'L1', 'ended')
    await h.advance(TIMING.RESTORE_DELAY_MS)
    assert.equal(h.count('window.showInactive'), 1)
  })

  test('« Se réduire » : fermeture jamais confirmée (relevés en échec) → au bout de 5 min, plus de relevé toutes les 5 s', async () => {
    const h = harness({ setting: 'minimize' })
    const pid = await detectedCs2(h)
    h.w.windows.add(pid)
    await h.advance(CADENCE.running[0])
    await h.advance(40_000)
    h.t.pollOk = false
    h.world.delete(pid)
    await h.advance(TIMING.GAVE_UP_MS + 15_000)
    assert.equal(h.w.alive, false)
    const polls = h.t.polls
    await h.advance(10 * 60_000)
    assert.equal(h.t.polls, polls)
    assert.equal(h.count('window.showInactive'), 0)
    // Les sessions finissent par s'arrêter sans relevé : la partie s'efface sans annonce, Player X ne revient pas tout seul.
    h.gap()
    assert.deepEqual([h.last('L1').phase, h.last('L1').silent], ['cancelled', true])
    assert.equal(h.count('window.showInactive'), 0)
  })

  test('« Se réduire » : mise en veille → plus de retour au réveil', async () => {
    const h = harness({ setting: 'minimize' })
    const pid = await detectedCs2(h)
    h.w.windows.add(pid)
    await h.advance(CADENCE.running[0])
    assert.equal(h.count('window.minimize'), 1)
    h.launches.suspend()
    h.world.delete(pid)
    await h.poll()
    await h.advance(30_000)
    assert.equal(h.count('window.showInactive'), 0)
  })
})

// ---------- divers ----------

test('reduce : pur, même objet quand rien ne change, rev + 1 sinon', () => {
  const s: LaunchStatus = { launchId: 'L', gameId: CS2.id, route: 'steam', phase: 'sending', detect: 'fast', via: 'play', rev: 3, clickAt: 0 }
  assert.equal(reduce(s, { type: 'detected' }, 10), s)
  assert.equal(reduce(s, { type: 'detect', mode: 'fast' }, 10), s)
  const w = reduce(s, { type: 'handed', to: 'waiting' }, 10)
  assert.deepEqual([w.phase, w.handedAt, w.rev, s.phase], ['waiting', 10, 4, 'sending'])
  const done = reduce(w, { type: 'gave-up' }, 20)
  assert.equal(reduce(done, { type: 'detected' }, 30), done)
  assert.equal(reduce(done, { type: 'cancel', silent: true }, 30), done)
})

test('sanitizeOpts : identifiant ≤ 64 caractères, bouton connu, force booléen', () => {
  assert.deepEqual(sanitizeOpts({ launchId: 'abc', via: 'retry', force: true }), { launchId: 'abc', via: 'retry', force: true })
  assert.deepEqual(sanitizeOpts({ launchId: 'abc', via: 'hack', force: 'yes' }), { launchId: 'abc', via: 'play' })
  const long = sanitizeOpts({ launchId: 'x'.repeat(65) })
  assert.notEqual(long.launchId, 'x'.repeat(65))
  assert.ok(long.launchId.length <= 64)
  assert.equal(sanitizeOpts(null).via, 'play')
  assert.ok(sanitizeOpts(42).launchId.startsWith('main-'))
})

test('scaledTiming : chaque délai divisé', () => {
  const fast = scaledTiming(10)
  assert.equal(fast.GAVE_UP_MS, 30_000)
  assert.deepEqual(fast.CADENCE, { pending: [100, 250], running: [500, 1000] })
  assert.equal(fast.DEMO.running, 700)
})

test('délais remplaçables (simulateur rapide)', async () => {
  const h = harness({ timing: scaledTiming(10) })
  h.manualHandoff()
  void h.launches.start(CS2.id, opts('L1'))
  await h.advance(30_000)
  assert.equal(h.last('L1').phase, 'gave-up')
})

// ---------- vrai script avec PowerShell 7 (si présent) ----------

const pwsh = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore' }).status === 0

test('SCRIPT sous pwsh : deux requêtes, deux relevés, arrêt à la fin de l’entrée', { skip: !pwsh && 'pwsh absent', timeout: 60_000 }, async () => {
  const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', SCRIPT], { stdio: ['pipe', 'pipe', 'ignore'] })
  const lines: string[] = []
  let buf = ''
  child.stdout.setEncoding('utf8')
  const got = new Promise<void>((resolve) =>
    child.stdout.on('data', (chunk: string) => {
      buf += chunk
      const parts = buf.split('\n')
      buf = parts.pop()!
      lines.push(...parts)
      if (lines.length >= 2) resolve()
    })
  )
  child.stdin.write(tickLine({}) + '\n')
  child.stdin.write(tickLine({ w: [['pwsh', 'Élan']], s: ['730', 'pas-un-id'] }) + '\n')
  await Promise.race([got, new Promise((_, reject) => setTimeout(() => reject(new Error('pas de réponse en 30 s')), 30_000))])
  const [a, b] = lines.map(parseSample)
  assert.ok(a && b)
  for (const s of [a, b]) {
    assert.ok(s.procs.length >= 1)
    assert.ok(s.procs.some((p) => p.name.toLowerCase() === 'pwsh'))
    assert.equal(typeof s.cpuMs, 'number')
    assert.equal(typeof s.ws, 'number')
  }
  // Pas de registre Steam ici : R vide, mise à jour à 0 pour l'appid valable seulement.
  assert.equal(b.runningAppId, null)
  assert.deepEqual([...b.updating], [['730', false]])
  // Le seuil de validité est appliqué à part (un conteneur peut avoir moins de 20 programmes).
  assert.equal(isValid(a), a.procs.length > MIN_PROCS)
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
  const t0 = Date.now()
  child.stdin.end()
  const code = await Promise.race([exited, new Promise<'délai'>((resolve) => setTimeout(() => resolve('délai'), 3_000))])
  if (code === 'délai') child.kill()
  assert.notEqual(code, 'délai')
  assert.ok(Date.now() - t0 < 3_000)
})
