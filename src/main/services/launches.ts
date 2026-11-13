// Lancement d'un jeu, du clic à « En jeu » puis à la fin de la partie : seul ce module décide des phases (LaunchStatus).
// Module feuille : aucun import d'Electron, de la base ni des réglages à l'exécution. Tout arrive par `deps` (index.ts, ou
// launchSim.ts en développement), ce qui permet de le tester sous Node seul avec une fausse horloge (npm run test:launch).
// Règle : le suivi rapide (launchWatch.ts) ne fait que proposer ; « En jeu » n'est affirmé qu'après un relevé de playtime.ts
// (pollNow, puis isRunning), la même vérité que les pastilles cyan. Spec docs/design/launch-sequence.md.
import type { DetectMode, LaunchFail, LaunchOpts, LaunchPhase, LaunchRoute, LaunchStatus, LaunchVia } from '@shared/launch'
import type { Game, LaunchWindowMode, Settings, Store } from '@shared/types'
import type { LaunchTarget } from './games'
import type { Watcher } from './launchWatch'
import type { Query, Sample } from './launchWatchParse'

/** Ni relais ni jeu détecté au bout de 5 min (depuis l'envoi, ou depuis le clic si Windows n'a jamais transmis le lien). */
export const GAVE_UP_MS = 300_000
/** Une fermeture moins de 30 s après la détection est peut-être un lanceur intermédiaire (Steam → EA app → jeu). */
export const EARLY_MS = 30_000
/** Attente d'un autre programme du jeu après une fermeture précoce. */
export const RELAY_GRACE_MS = 60_000
/** Le jeu n'est plus vu sur au moins 2 relevés valables, étalés sur au moins 4 s. */
export const MISS_SPAN_MS = 4_000
/** Au plus une confirmation toutes les 10 s par lancement, sauf nouveau PID. */
export const CONFIRM_REARM_MS = 10_000
/** Suivi rapide d'une partie pendant ses 90 premières secondes (fermeture d'un lanceur, fenêtre du jeu). */
export const WATCH_AFTER_RUNNING_MS = 90_000
/** « Se réduire » sans fenêtre vue : au bout de 10 s après la détection. */
export const MINIMIZE_FALLBACK_MS = 10_000
export const RESTORE_DELAY_MS = 1_000
/** Retour de Player X sans activation à la fin de la partie : false si la vérification sous Windows échoue (spec §5). */
export const RESTORE_ON_EXIT = true
/** Âge maximal du relevé de la minute pour la base « programme nouveau » et « le store semblait ouvert ». */
export const SNAPSHOT_MAX_AGE_MS = 90_000
/** Âge maximal d'un relevé du suivi rapide pour servir de base. */
export const BASELINE_WATCH_MAX_AGE_MS = 10_000
/** Intervalle entre deux relevés du suivi rapide, [secteur, batterie]. */
export const CADENCE: { pending: [number, number]; running: [number, number] } = { pending: [1000, 2500], running: [5000, 10000] }
/** Coût du suivi rapide : au-delà de `p95CpuMs` ou `wsBytes`, il ne sert plus qu'aux lancements en attente. */
export const BUDGET = { p95CpuMs: 60, wsBytes: 90e6, hardP95CpuMs: 150 }
/** Mode démo : envoi, « En jeu », fin (depuis le clic). `waitingAt` : l'interface passe à « En attente du jeu » (aucun événement). */
export const DEMO = { handoff: 250, waitingAt: 4000, running: 7000, ended: 30000 }
/** Relevé de confirmation impossible (PowerShell en panne) : nouvel essai. */
export const RETRY_MS = 5_000
/** Suivi rapide hors service : plus d'essai pendant 10 min. */
export const WATCH_OFF_MS = 600_000
/** Lancements terminés que list() renvoie encore (rechargement de l'interface). */
export const KEEP_MS = 900_000
/** Coût jugé sur au moins autant de relevés. */
export const BUDGET_MIN_SAMPLES = 10

export const TIMING = {
  GAVE_UP_MS,
  EARLY_MS,
  RELAY_GRACE_MS,
  MISS_SPAN_MS,
  CONFIRM_REARM_MS,
  WATCH_AFTER_RUNNING_MS,
  MINIMIZE_FALLBACK_MS,
  RESTORE_DELAY_MS,
  SNAPSHOT_MAX_AGE_MS,
  BASELINE_WATCH_MAX_AGE_MS,
  RETRY_MS,
  WATCH_OFF_MS,
  CADENCE,
  DEMO
}
export type Timing = typeof TIMING

/** Mêmes délais divisés (PX_LAUNCH_SIM_FAST) : le même enchaînement, plus vite. */
export function scaledTiming(divisor: number): Timing {
  const d = (ms: number): number => Math.max(1, Math.round(ms / divisor))
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(TIMING)) if (typeof v === 'number') out[k] = d(v)
  return {
    ...(out as Timing),
    CADENCE: { pending: [d(CADENCE.pending[0]), d(CADENCE.pending[1])], running: [d(CADENCE.running[0]), d(CADENCE.running[1])] },
    DEMO: { handoff: d(DEMO.handoff), waitingAt: d(DEMO.waitingAt), running: d(DEMO.running), ended: d(DEMO.ended) }
  }
}

// ---------- dépendances ----------

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** Relevé des programmes (playtime.ts, ou son double du simulateur). */
export interface LaunchTracker {
  isRunning(gameId: string): boolean
  runningSince(gameId: string): number | undefined
  /** Relevé tout de suite, regroupé avec celui en cours ; vrai si la liste des programmes a pu être lue. */
  pollNow(): Promise<boolean>
  /** Faux après un relevé raté ou des sessions arrêtées sans relevé : un jeu absent ne s'est peut-être pas fermé. */
  lastPollOk(): boolean
  snapshotPids(maxAgeMs: number): Set<number> | null
  storeWasRunning(store: Store, maxAgeMs: number): boolean | null
  exeNamesFor(game: Game, refresh: boolean): Promise<Set<string>>
  /** Noms rattachés au jeu par le dernier relevé, sans les génériques (tracking.ts watchNames) : le suivi rapide les cherche aussi. */
  matchedNames(gameId: string): Set<string>
  /** Relevés à 20 s et 45 s, chacun seulement si `still()`. */
  nudge(still: () => boolean): void
  onChange(cb: () => void): unknown
}

/**
 * Fenêtre de Player X. Pour un lancement, on la lit, on la réduit ou on la rouvre sans l'activer : jamais rien qui la ferait
 * passer devant le jeu (ni premier plan, ni clignotement, ni barre de progression, qui appartient aux mises à jour).
 */
export interface LaunchWindow {
  focused(): boolean
  minimized(): boolean
  maximized(): boolean
  minimize(): void
  showInactive(): void
  /** La fenêtre a été rouverte, et pas par showInactive ci-dessus. */
  onUserRestore(cb: () => void): void
}

export interface LaunchDeps {
  platform: string
  now(): number
  timers: Timers
  timing?: Partial<Timing>
  findGame(id: string): Promise<Game | undefined>
  demo(): boolean
  target(game: Game): LaunchTarget | null
  /** Confie le lien ou l'exécutable à Windows ; rejette avec un LaunchError (games.ts). */
  handoff(target: LaunchTarget): Promise<void>
  /** Windows connaît une appli pour ce lien ; null : on ne sait pas. */
  handlerKnown(url: string): boolean | null
  recordLaunch(gameId: string): void
  recordDemoLaunch(gameId: string): void
  tracker: LaunchTracker
  watcher(onDown: (why: string) => void): Watcher
  /** launchWatchParse.newMatches (un module feuille n'importe que des types). */
  newMatches(sample: Sample, names: Set<string>, baseline: Set<number> | null): number[]
  window: LaunchWindow
  onBattery(): boolean
  settings(): Pick<Settings, 'launchWindow'>
  emit(status: LaunchStatus): void
  gamesChanged(): void
  log(msg: string): void
}

export interface Launches {
  /** Ne rejette jamais pour un échec de lancement : la phase le dit. Répond une fois le lien transmis (ou le lancement terminé). */
  start(gameId: string, opts: LaunchOpts): Promise<LaunchStatus>
  /** « Ne plus attendre » (rien n'est fermé). */
  cancel(launchId: string): void
  list(): LaunchStatus[]
  /** Mode démo basculé : tout s'arrête sans carte ni annonce. */
  reset(): void
  /** Mise en veille : les attentes s'arrêtent sans carte, et Player X ne reviendra pas tout seul au réveil. */
  suspend(): void
  shutdown(): void
}

// ---------- transitions (pures) ----------

const TERMINAL = new Set<LaunchPhase>(['ended', 'early-exit', 'gave-up', 'failed', 'already', 'resent', 'cancelled', 'untracked'])
const isTerminal = (phase: LaunchPhase): boolean => TERMINAL.has(phase)
/** En attente au sens des boutons et de « Ne plus attendre » : envoi, attente du jeu, relais. */
export const isPending = (phase: LaunchPhase): boolean => phase === 'sending' || phase === 'waiting' || phase === 'relay'

export type LaunchEvent =
  | { type: 'handler'; known: boolean | null }
  | { type: 'detect'; mode: DetectMode }
  | { type: 'steam-updating'; on: boolean }
  | { type: 'handed'; to: 'waiting' | 'untracked' | 'resent' }
  | { type: 'failed'; reason: LaunchFail; detail?: string }
  | { type: 'detected' }
  | { type: 'gone'; at: number }
  | { type: 'ended'; goneAt?: number }
  | { type: 'early-exit' }
  | { type: 'gave-up'; silent?: boolean }
  | { type: 'cancel'; silent?: boolean }

/** Phase suivante d'un lancement. Renvoie le même objet quand l'événement ne change rien (rien à émettre) ; `rev` croît sinon. */
export function reduce(s: LaunchStatus, e: LaunchEvent, now: number): LaunchStatus {
  const p = s.phase
  if (TERMINAL.has(p)) return s
  const next = (patch: Partial<LaunchStatus>): LaunchStatus => ({ ...s, ...patch, rev: s.rev + 1 })
  switch (e.type) {
    case 'handler':
      return s.handler === e.known ? s : next({ handler: e.known })
    case 'detect':
      return s.detect === e.mode ? s : next({ detect: e.mode })
    case 'steam-updating':
      return p !== 'waiting' || !!s.steamUpdating === e.on ? s : next({ steamUpdating: e.on })
    case 'handed':
      return p === 'sending' ? next({ phase: e.to, handedAt: now }) : s
    case 'failed':
      return p === 'sending' ? next({ phase: 'failed', reason: e.reason, ...(e.detail ? { detail: e.detail } : {}) }) : s
    case 'detected': {
      if (p !== 'waiting' && p !== 'relay') return s
      // Nouvelle détection après un relais : la fermeture précédente ne compte plus.
      const { goneAt: _goneAt, ...rest } = s
      return { ...rest, phase: 'running', detectedAt: now, rev: s.rev + 1 }
    }
    case 'gone':
      return p === 'running' ? next({ phase: 'relay', goneAt: e.at }) : s
    case 'ended':
      return p === 'running' ? next({ phase: 'ended', endedAt: now, ...(e.goneAt !== undefined ? { goneAt: e.goneAt } : {}) }) : s
    case 'early-exit':
      return p === 'relay' ? next({ phase: 'early-exit', endedAt: now }) : s
    case 'gave-up':
      return isPending(p) ? next({ phase: 'gave-up', ...(e.silent ? { silent: true as const } : {}) }) : s
    case 'cancel':
      // Une partie en cours ne s'annule que sans bruit (mode démo basculé, nouveau lancement du même jeu).
      return isPending(p) || (e.silent && p === 'running') ? next({ phase: 'cancelled', ...(e.silent ? { silent: true as const } : {}) }) : s
  }
}

// ---------- fenêtre (pure) ----------

export interface WindowCtx {
  /** `running` : à chaque relevé d'une partie suivie, et 10 s après la détection. */
  event: 'running' | 'ended' | 'early-exit' | 'relay' | 'user-restore' | 'suspend' | 'other'
  demo?: boolean
  /** Le jeu a une fenêtre principale (drapeau W du suivi rapide). */
  windowSeen?: boolean
  sinceDetectedMs?: number
  /** Le jeu est encore vu au dernier relevé. */
  stillSeen?: boolean
  focused?: boolean
  minimized?: boolean
  /** C'est ce lancement qui a réduit Player X. */
  minimizedByThis?: boolean
  /** Lancement d'un autre jeu encore en cours. */
  otherRunning?: string | null
  /** Player X était agrandi quand il a été réduit. */
  wasMaximized?: boolean
}

export type WindowAction =
  | { kind: 'none' }
  | { kind: 'minimize' }
  | { kind: 'restore'; delayMs: number }
  | { kind: 'hand-over'; to: string }
  /** Oublier qui a réduit Player X : il ne reviendra pas tout seul. */
  | { kind: 'clear' }

/** Réglage « Quand un jeu démarre » (spec §5) : réduire seulement en arrière-plan, revenir sans activation, jamais au premier plan. */
export function windowAction(
  setting: LaunchWindowMode,
  c: WindowCtx,
  t: { MINIMIZE_FALLBACK_MS: number; RESTORE_DELAY_MS: number; restoreOnExit?: boolean } = TIMING
): WindowAction {
  if (c.event === 'user-restore' || c.event === 'suspend') return { kind: 'clear' }
  const exit = c.event === 'ended' || c.event === 'early-exit'
  const none: WindowAction = exit && c.minimizedByThis ? { kind: 'clear' } : { kind: 'none' }
  if (setting !== 'minimize' || c.demo) return none
  if (c.event === 'running') {
    const ready = !!c.windowSeen || (c.sinceDetectedMs ?? 0) >= t.MINIMIZE_FALLBACK_MS
    // Player X au premier plan : tu as choisi de le regarder.
    return ready && c.stillSeen && !c.focused && !c.minimized ? { kind: 'minimize' } : none
  }
  // Jamais pendant un relais : un autre programme du jeu peut suivre.
  if (!exit || !c.minimizedByThis || !c.minimized) return none
  if (c.otherRunning) return { kind: 'hand-over', to: c.otherRunning }
  // Rouverte sans activation, une fenêtre réduite revient à sa taille normale (SW_SHOWNOACTIVATE), et rien ne l'agrandit
  // sans l'activer : agrandi, Player X reste dans la barre des tâches, d'où un clic le rouvre agrandi.
  if (c.wasMaximized) return { kind: 'clear' }
  return (t.restoreOnExit ?? RESTORE_ON_EXIT) ? { kind: 'restore', delayMs: t.RESTORE_DELAY_MS } : { kind: 'clear' }
}

// ---------- options venues de l'interface ----------

const VIAS: LaunchVia[] = ['play', 'retry', 'relaunch', 'rescan']
const FAILS: LaunchFail[] = ['no-handler', 'exe-missing', 'no-target', 'not-found', 'other']

/** Options de l'interface (non fiables) : identifiant de 64 caractères au plus, bouton connu, force booléen. */
export function sanitizeOpts(raw: unknown): LaunchOpts {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = typeof o.launchId === 'string' && o.launchId.length > 0 && o.launchId.length <= 64 ? o.launchId : `main-${globalThis.crypto.randomUUID()}`
  return { launchId: id, via: VIAS.includes(o.via as LaunchVia) ? (o.via as LaunchVia) : 'play', ...(o.force === true ? { force: true } : {}) }
}

/** Raison d'un échec d'envoi (LaunchError de games.ts) ; tout le reste devient « other », sans texte venu d'Electron. */
function failOf(e: unknown): { reason: LaunchFail; detail?: string } {
  const o = (e && typeof e === 'object' ? e : {}) as { reason?: unknown; detail?: unknown }
  const reason = FAILS.includes(o.reason as LaunchFail) ? (o.reason as LaunchFail) : 'other'
  return typeof o.detail === 'string' && o.detail ? { reason, detail: o.detail.slice(0, 300) } : { reason }
}

const routeOf = (game: Game, target: LaunchTarget | null): LaunchRoute => (target?.kind === 'exe' ? 'exe' : (target?.route ?? game.store))
const routeOfId = (id: string): LaunchRoute => (/^(steam|epic|ea):/.exec(id)?.[1] as LaunchRoute | undefined) ?? 'exe'

// ---------- orchestrateur ----------

interface Rec {
  s: LaunchStatus
  game: Game | null
  force: boolean
  /** Dernier changement : list() oublie les lancements terminés depuis 15 min. */
  changedAt: number
  /** Résolu quand le lancement se termine (start() n'attend pas un envoi bloqué au-delà). */
  done: Promise<void>
  finish: () => void
  timers: Map<string, unknown>
  /** Noms d'exécutables (minuscules) et jeu Steam, pour le suivi rapide. */
  names: Set<string>
  appId: string | null
  /** PID du relevé d'avant le clic ; null : aucun relevé récent. */
  baseline: Set<number> | null
  /** Suivi par le relevé rapide (sinon : relevés à 20 s, 45 s puis chaque minute, via reconcile). */
  watched: boolean
  nominated: Set<number>
  /** Noms du jeu déjà portés par un programme d'avant le clic : leurs nouveaux PID attendent les 10 s. */
  shared: Set<string>
  /** PID du jeu vus depuis sa détection : en relais, seul un PID nouveau compte. */
  seenPids: Set<number>
  lastConfirmAt: number
  confirming: boolean
  /** Candidat vu pendant une confirmation : une de plus juste après. */
  reconfirm: boolean
  /** Relance forcée d'un jeu qui tournait : le suivi rapide se décide à la fin de l'envoi. */
  watchLater: boolean
  /** Fermeture en cours de confirmation (relevé lancé ou nouvel essai prévu). */
  exiting: boolean
  missSince: number | null
  misses: number
  stillSeen: boolean
  windowSeen: boolean
  minimizeDone: boolean
}

export function createLaunches(deps: LaunchDeps): Launches {
  const t: Timing = { ...TIMING, ...deps.timing }
  const { timers, tracker } = deps
  const now = (): number => deps.now()
  const isWin = deps.platform === 'win32'
  const records = new Map<string, Rec>()
  const watcher = deps.watcher(watcherDown)
  let watchOffUntil = 0
  let overBudget = false
  /** Boucle du suivi rapide lancée (le watcher n'est appelé qu'alors : jamais en démo). */
  let looping = false
  let ticking = false
  let tickTimer: unknown = null
  let nextTickAt = Infinity
  let lastTickAt = 0
  let samples = 0
  /** Lancement qui a réduit Player X : lui seul peut le faire revenir. */
  let minimizedBy: string | null = null
  let wasMaximized = false
  let restoreTimer: unknown = null
  /** Croît à chaque reset() : un start() qui attendait (jeu, relevé frais) d'avant le basculement du mode démo s'arrête là. */
  let epoch = 0

  const label = (rec: Rec): string => `${rec.game?.name ?? rec.s.gameId} (${rec.s.launchId})`
  const watchOff = (): boolean => now() < watchOffUntil
  const all = (): Rec[] => [...records.values()]

  tracker.onChange(reconcile)
  deps.window.onUserRestore(() => {
    if (minimizedBy === null) return
    if (windowAction(deps.settings().launchWindow, { event: 'user-restore' }).kind !== 'clear') return
    deps.log('fenêtre rouverte par l’utilisateur : pas de retour automatique')
    minimizedBy = null
    clearRestore()
    refreshWatch()
  })

  // ----- minuteries d'un lancement -----

  function arm(rec: Rec, key: string, ms: number, fn: () => void): void {
    disarm(rec, key)
    rec.timers.set(
      key,
      timers.setTimeout(() => {
        rec.timers.delete(key)
        fn()
      }, ms)
    )
  }

  function disarm(rec: Rec, key: string): void {
    const h = rec.timers.get(key)
    if (h === undefined) return
    timers.clearTimeout(h)
    rec.timers.delete(key)
  }

  function disarmAll(rec: Rec): void {
    for (const h of rec.timers.values()) timers.clearTimeout(h)
    rec.timers.clear()
  }

  function clearRestore(): void {
    if (restoreTimer === null) return
    timers.clearTimeout(restoreTimer)
    restoreTimer = null
  }

  // ----- états -----

  function create(gameId: string, route: LaunchRoute, opts: LaunchOpts, game: Game | null, patch: Partial<LaunchStatus>): Rec {
    let finish = (): void => {}
    const done = new Promise<void>((resolve) => (finish = resolve))
    const at = now()
    const rec: Rec = {
      s: { launchId: opts.launchId, gameId, route, phase: 'sending', detect: 'none', via: opts.via, rev: 1, clickAt: at, ...patch },
      game,
      force: !!opts.force,
      changedAt: at,
      done,
      finish,
      timers: new Map(),
      names: new Set(),
      appId: null,
      baseline: null,
      watched: false,
      nominated: new Set(),
      shared: new Set(),
      seenPids: new Set(),
      lastConfirmAt: -Infinity,
      confirming: false,
      reconfirm: false,
      watchLater: false,
      exiting: false,
      missSince: null,
      misses: 0,
      stillSeen: false,
      windowSeen: false,
      minimizeDone: false
    }
    records.set(opts.launchId, rec)
    deps.emit(rec.s)
    return rec
  }

  function apply(rec: Rec, e: LaunchEvent): boolean {
    const prev = rec.s
    const next = reduce(prev, e, now())
    if (next === prev) return false
    rec.s = next
    rec.changedAt = now()
    if (prev.phase !== next.phase) deps.log(`${label(rec)} : ${prev.phase} → ${next.phase}`)
    deps.emit(next)
    if (TERMINAL.has(next.phase)) {
      disarmAll(rec)
      rec.watched = false
      rec.finish()
    }
    // Remplace l'ancien rafraîchissement après un lancement : l'interface relit la bibliothèque (dernier lancement, « En jeu »).
    if (isPending(prev.phase) && !isPending(next.phase)) deps.gamesChanged()
    refreshWatch()
    return true
  }

  function latest(gameId: string, keep: (rec: Rec) => boolean): Rec | undefined {
    let best: Rec | undefined
    for (const rec of records.values()) if (rec.s.gameId === gameId && keep(rec) && (!best || rec.s.clickAt >= best.s.clickAt)) best = rec
    return best
  }

  /** Un seul lancement en attente par jeu : l'ancien s'efface sans bruit (« Relancer quand même », démo relancée). */
  function supersede(rec: Rec): void {
    for (const other of all()) {
      if (other === rec || other.s.gameId !== rec.s.gameId || isTerminal(other.s.phase)) continue
      if (isPending(other.s.phase) || other.s.demo) apply(other, { type: 'cancel', silent: true })
    }
  }

  function prune(): void {
    const limit = now() - KEEP_MS
    for (const [id, rec] of records) if (isTerminal(rec.s.phase) && rec.changedAt < limit) records.delete(id)
  }

  // ----- lancement -----

  async function start(gameId: string, opts: LaunchOpts): Promise<LaunchStatus> {
    prune()
    const same = records.get(opts.launchId)
    if (same) return same.s
    // Mode démo basculé pendant une attente ci-dessous : le clic appartenait à l'autre bibliothèque, rien n'est créé ni émis.
    const began = epoch
    const dropped = (): LaunchStatus => ({
      launchId: opts.launchId,
      gameId,
      route: routeOfId(gameId),
      phase: 'cancelled',
      silent: true,
      detect: 'none',
      via: opts.via,
      rev: 1,
      clickAt: now()
    })
    // 1. Jeu introuvable.
    const game = await deps.findGame(gameId)
    if (epoch !== began) return dropped()
    if (!game) return create(gameId, routeOfId(gameId), opts, null, { phase: 'failed', reason: 'not-found' }).s
    const target = deps.target(game)
    // 2. Mode démo : séquence jouée en mémoire, rien n'est lancé.
    if (deps.demo()) return startDemo(game, target, opts)
    // 3. Double clic : le lancement en attente répond.
    const pending = (): Rec | undefined => latest(game.id, (r) => !r.s.demo && isPending(r.s.phase))
    if (!opts.force && pending()) return pending()!.s
    // 4. Jeu déjà en cours : relevé frais d'abord (une pastille « En jeu » fausse ne doit jamais bloquer).
    if (!opts.force && tracker.isRunning(game.id)) {
      const ok = await tracker.pollNow()
      if (epoch !== began) return dropped()
      const again = pending()
      if (again) return again.s
      if (!ok || tracker.isRunning(game.id)) {
        const since = tracker.runningSince(game.id)
        return create(game.id, routeOf(game, target), opts, game, { phase: 'already', ...(since !== undefined ? { runningSince: since } : {}) }).s
      }
    }
    // 5. Rien à lancer.
    if (!target) return create(game.id, routeOf(game, null), opts, game, { phase: 'failed', reason: 'no-target' }).s
    // 6. Le lancement existe avant l'envoi : l'interface le voit dans la même image que le clic.
    const last = watcher.last()
    const baseline =
      last && now() - last.at <= t.BASELINE_WATCH_MAX_AGE_MS ? new Set(last.sample.procs.map((p) => p.pid)) : tracker.snapshotPids(t.SNAPSHOT_MAX_AGE_MS)
    const storeWasOpen = target.kind === 'url' ? tracker.storeWasRunning(target.route, t.SNAPSHOT_MAX_AGE_MS) : undefined
    const rec = create(game.id, routeOf(game, target), opts, game, {
      phase: 'sending',
      detect: !isWin ? 'none' : watchOff() ? 'poll' : 'fast',
      ...(storeWasOpen !== undefined ? { storeWasOpen } : {})
    })
    rec.baseline = baseline
    rec.appId = game.store === 'steam' && target.kind === 'url' && /^\d+$/.test(game.storeId) ? game.storeId : null
    arm(rec, 'gave-up', t.GAVE_UP_MS, () => apply(rec, { type: 'gave-up' }))
    // 7. L'envoi part en premier : aucune autre lecture ne le retarde.
    let sent: Promise<void>
    try {
      sent = deps.handoff(target)
    } catch (e) {
      sent = Promise.reject(e)
    }
    // 8. Lu juste après l'envoi, seulement pour le texte d'un envoi qui traîne.
    if (target.kind === 'url') {
      let known: boolean | null = null
      try {
        known = deps.handlerKnown(target.url)
      } catch {
        /* inconnu */
      }
      apply(rec, { type: 'handler', known })
    }
    supersede(rec)
    // 9. En parallèle : noms d'exécutables et suivi rapide.
    void prepare(rec)
    // 10.
    await Promise.race([settle(rec, sent), rec.done])
    return rec.s
  }

  async function prepare(rec: Rec): Promise<void> {
    let names = new Set<string>()
    try {
      names = await tracker.exeNamesFor(rec.game!, true)
    } catch {
      /* dossier illisible : relevés à 20 s, 45 s puis chaque minute */
    }
    if (isTerminal(rec.s.phase) || !isWin) return
    rec.names = names
    // « Relancer quand même » sur un jeu qui tourne finira sans doute en `resent` : rien à suivre, sauf si le relevé ne le
    // voit plus d'ici la fin de l'envoi (settle).
    if (rec.force && rec.s.phase === 'sending' && tracker.isRunning(rec.s.gameId)) {
      rec.watchLater = true
      return
    }
    decideWatch(rec)
  }

  /** Suivi rapide si le jeu peut y être reconnu (noms d'exécutables ou jeu Steam) ; sinon relevés à 20 s, 45 s puis chaque minute. */
  function decideWatch(rec: Rec): void {
    if ((rec.names.size > 0 || rec.appId !== null) && !watchOff()) {
      rec.watched = true
      apply(rec, { type: 'detect', mode: 'fast' })
      refreshWatch()
    } else apply(rec, { type: 'detect', mode: 'poll' })
  }

  async function settle(rec: Rec, sent: Promise<void>): Promise<void> {
    try {
      await sent
    } catch (e) {
      const { reason, detail } = failOf(e)
      deps.log(`${label(rec)} : envoi refusé (${reason}${detail ? ` : ${detail}` : ''})`)
      // Annulé ou abandonné entre-temps : rien à montrer.
      apply(rec, { type: 'failed', reason, ...(detail ? { detail } : {}) })
      return
    }
    // Même sens qu'avant : un lien envoyé depuis Player X, même si tu as cessé d'attendre entre-temps.
    try {
      deps.recordLaunch(rec.s.gameId)
    } catch (e) {
      deps.log(`${label(rec)} : lancement non enregistré (${String(e)})`)
    }
    if (isTerminal(rec.s.phase)) {
      // Annulé ou abandonné pendant l'envoi : l'interface a relu la bibliothèque avant cet enregistrement, elle la relit.
      deps.gamesChanged()
      return
    }
    if (!isWin) {
      apply(rec, { type: 'handed', to: 'untracked' })
      return
    }
    if (rec.force && tracker.isRunning(rec.s.gameId)) {
      apply(rec, { type: 'handed', to: 'resent' })
      return
    }
    if (rec.watchLater) {
      rec.watchLater = false
      decideWatch(rec)
    }
    apply(rec, { type: 'handed', to: 'waiting' })
    arm(rec, 'gave-up', t.GAVE_UP_MS, () => apply(rec, { type: 'gave-up' }))
    // Le second relevé rapproché n'a pas lieu si le jeu est déjà détecté.
    tracker.nudge(() => rec.s.phase === 'waiting' || rec.s.phase === 'relay')
    // Un exécutable rapide a pu être vu par un relevé pendant l'envoi.
    reconcileOne(rec)
  }

  function startDemo(game: Game, target: LaunchTarget | null, opts: LaunchOpts): LaunchStatus {
    const pending = latest(game.id, (r) => !!r.s.demo && isPending(r.s.phase))
    if (pending && !opts.force) return pending.s
    const rec = create(game.id, routeOf(game, target), opts, game, { phase: 'sending', detect: 'none', demo: true })
    // Base illisible ou verrouillée (antivirus, OneDrive) : la séquence se joue quand même, start() ne rejette jamais.
    try {
      deps.recordDemoLaunch(game.id)
    } catch (e) {
      deps.log(`${label(rec)} : lancement de démo non enregistré (${String(e)})`)
    }
    supersede(rec)
    arm(rec, 'demo-handoff', t.DEMO.handoff, () => apply(rec, { type: 'handed', to: 'waiting' }))
    arm(rec, 'demo-running', t.DEMO.running, () => apply(rec, { type: 'detected' }))
    arm(rec, 'demo-ended', t.DEMO.ended, () => apply(rec, { type: 'ended' }))
    return rec.s
  }

  // ----- détection -----

  async function confirm(rec: Rec): Promise<void> {
    if (rec.confirming) {
      // Le relevé en cours a pu commencer avant ce candidat : un de plus juste après lui.
      rec.reconfirm = true
      return
    }
    rec.confirming = true
    rec.reconfirm = false
    rec.lastConfirmAt = now()
    let ok = false
    try {
      ok = await tracker.pollNow()
    } catch {
      ok = false
    }
    rec.confirming = false
    const p = rec.s.phase
    if (p !== 'waiting' && p !== 'relay') return
    if (ok && tracker.isRunning(rec.s.gameId)) return detected(rec)
    if (rec.reconfirm) void confirm(rec)
  }

  function detected(rec: Rec): void {
    if (!apply(rec, { type: 'detected' })) return
    disarm(rec, 'gave-up')
    disarm(rec, 'relay')
    rec.missSince = null
    rec.misses = 0
    rec.stillSeen = true
    arm(rec, 'minimize', t.MINIMIZE_FALLBACK_MS, () => maybeMinimize(rec))
    maybeMinimize(rec)
  }

  /** Fermé juste après la détection : lanceur intermédiaire probable (Steam → EA app → jeu). */
  function early(rec: Rec, goneAt: number): boolean {
    return goneAt - (rec.s.detectedAt ?? goneAt) < t.EARLY_MS
  }

  async function gone(rec: Rec): Promise<void> {
    const goneAt = rec.missSince ?? now()
    if (early(rec, goneAt)) return startRelay(rec, goneAt)
    rec.exiting = true
    let ok = false
    try {
      ok = await tracker.pollNow()
    } catch {
      ok = false
    }
    rec.exiting = false
    if (rec.s.phase !== 'running') return
    if (!ok) {
      // Relevé impossible : on ne conclut rien, nouvel essai dans 5 s si le jeu n'est toujours pas revenu. Au bout de 5 min,
      // la partie quitte le suivi rapide : le relevé de la minute décidera.
      if (now() - goneAt >= t.GAVE_UP_MS) {
        rec.watched = false
        reconcileOne(rec)
        refreshWatch()
        return
      }
      rec.exiting = true
      arm(rec, 'retry', t.RETRY_MS, () => {
        rec.exiting = false
        if (rec.s.phase === 'running' && rec.watched && rec.missSince !== null) void gone(rec)
      })
      return
    }
    if (tracker.isRunning(rec.s.gameId)) {
      // Le relevé voit encore le jeu (par son dossier) : le relevé de la minute décidera de la fin.
      rec.watched = false
      refreshWatch()
      return
    }
    ended(rec, goneAt)
  }

  /** Ni relevé, ni « Jeu fermé », ni retour de la fenêtre pendant le relais : un autre programme du jeu peut suivre. */
  function startRelay(rec: Rec, goneAt: number): void {
    if (!apply(rec, { type: 'gone', at: goneAt })) return
    arm(rec, 'relay', t.RELAY_GRACE_MS, () => void relayEnd(rec))
    // Relevés en échec pendant tout le relais : au bout de 5 min, l'attente s'arrête sans carte (rien ne dit s'il s'est fermé).
    // Player X réduit par ce lancement reste dans la barre des tâches : il n'est plus à nous de le rouvrir.
    arm(rec, 'gave-up', Math.max(0, goneAt + t.GAVE_UP_MS - now()), () => {
      if (!apply(rec, { type: 'gave-up', silent: true })) return
      if (minimizedBy === rec.s.launchId) minimizedBy = null
      refreshWatch()
    })
  }

  async function relayEnd(rec: Rec): Promise<void> {
    let ok = false
    try {
      ok = await tracker.pollNow()
    } catch {
      ok = false
    }
    if (rec.s.phase !== 'relay') return
    if (!ok) return arm(rec, 'relay', t.RETRY_MS, () => void relayEnd(rec))
    if (tracker.isRunning(rec.s.gameId)) return detected(rec)
    if (apply(rec, { type: 'early-exit' })) onExit(rec, 'early-exit')
  }

  function ended(rec: Rec, goneAt?: number): void {
    if (apply(rec, { type: 'ended', goneAt })) onExit(rec, 'ended')
  }

  /** Changement vu par le relevé de la minute ou un relevé rapproché. */
  function reconcile(): void {
    for (const rec of all()) reconcileOne(rec)
  }

  function reconcileOne(rec: Rec): void {
    if (rec.s.demo) return
    const running = tracker.isRunning(rec.s.gameId)
    switch (rec.s.phase) {
      case 'waiting':
        if (running) detected(rec)
        break
      case 'relay':
        // Ce relevé peut dater d'avant la fermeture : on en refait un avant de conclure (au plus toutes les 10 s).
        if (running && now() - rec.lastConfirmAt >= t.CONFIRM_REARM_MS) void confirm(rec)
        break
      case 'running': {
        if (running) break
        if (!tracker.lastPollOk()) {
          // Sessions arrêtées sans relevé réussi (PowerShell en panne depuis 3 min) : rien ne dit que le jeu s'est fermé.
          // Sans suivi rapide, la partie s'efface sans annonce, et Player X ne reviendra pas tout seul.
          if (rec.watched) break
          if (minimizedBy === rec.s.launchId) minimizedBy = null
          apply(rec, { type: 'cancel', silent: true })
          break
        }
        // Le relevé ne voit plus le jeu : il fait foi, même pendant le suivi rapide (un programme d'un autre dossier peut
        // porter un des noms du jeu et le faire croire encore lancé).
        const goneAt = rec.missSince ?? now()
        if (!rec.watched) ended(rec)
        else if (early(rec, goneAt)) startRelay(rec, goneAt)
        else ended(rec, goneAt)
        break
      }
    }
  }

  // ----- suivi rapide -----

  function needsWatch(rec: Rec): boolean {
    if (!rec.watched || rec.s.demo) return false
    if (isPending(rec.s.phase)) return true
    if (rec.s.phase !== 'running' || overBudget) return false
    return now() - (rec.s.detectedAt ?? 0) < t.WATCH_AFTER_RUNNING_MS || minimizedBy === rec.s.launchId
  }

  function cadence(): number {
    const urgent = all().some((r) => needsWatch(r) && isPending(r.s.phase))
    return (urgent ? t.CADENCE.pending : t.CADENCE.running)[deps.onBattery() ? 1 : 0]
  }

  function schedule(ms: number): void {
    if (tickTimer !== null) timers.clearTimeout(tickTimer)
    nextTickAt = now() + ms
    tickTimer = timers.setTimeout(() => {
      tickTimer = null
      nextTickAt = Infinity
      void tick()
    }, ms)
  }

  /** Le suivi rapide tourne tant qu'un lancement en a besoin ; sinon il s'arrête et les parties passent au relevé de la minute. */
  function refreshWatch(): void {
    if (all().some(needsWatch)) {
      if (!looping) {
        looping = true
        lastTickAt = -Infinity
        schedule(0)
      } else if (!ticking) {
        // Un lancement en attente arrive pendant le rythme lent d'une partie : relevé plus tôt.
        const at = Math.max(now(), lastTickAt + cadence())
        if (at < nextTickAt) schedule(at - now())
      }
      return
    }
    for (const rec of all()) {
      if (!rec.watched) continue
      rec.watched = false
      reconcileOne(rec)
    }
    stopWatch(false)
  }

  function stopWatch(hard: boolean): void {
    if (tickTimer !== null) timers.clearTimeout(tickTimer)
    tickTimer = null
    nextTickAt = Infinity
    if (!looping) return
    looping = false
    overBudget = false
    watcher.stop(hard)
    deps.log('suivi rapide arrêté')
  }

  async function tick(): Promise<void> {
    if (!looping || ticking) return
    if (!all().some(needsWatch)) return refreshWatch()
    ticking = true
    lastTickAt = now()
    const q = query()
    let s: Sample | null = null
    try {
      s = await watcher.sample(q)
    } catch {
      s = null
    }
    ticking = false
    if (!looping) return
    // Relevé raté : compté par le watcher pour sa santé seulement, jamais comme une fermeture.
    if (s) onSample(s)
    if (!looping) return
    if (!all().some(needsWatch)) return refreshWatch()
    schedule(Math.max(0, lastTickAt + cadence() - now()))
  }

  function liveNames(rec: Rec): Set<string> {
    const names = new Set(rec.names)
    for (const n of tracker.matchedNames(rec.s.gameId)) names.add(n)
    return names
  }

  function query(): Query {
    const w: Set<string>[] = []
    const s = new Set<string>()
    for (const rec of all()) {
      if (!needsWatch(rec)) continue
      w.push(liveNames(rec))
      if (rec.appId && isPending(rec.s.phase)) s.add(rec.appId)
    }
    return { w, s }
  }

  function onSample(s: Sample): void {
    const at = now()
    budget()
    for (const rec of all()) {
      if (!rec.watched || rec.s.demo || isTerminal(rec.s.phase)) continue
      if (!needsWatch(rec)) {
        // Partie suivie depuis plus de 90 s : le relevé de la minute prend le relais.
        rec.watched = false
        reconcileOne(rec)
        continue
      }
      const names = liveNames(rec)
      if (rec.s.phase === 'waiting' || rec.s.phase === 'relay') nominate(rec, s, names, at)
      else if (rec.s.phase === 'running') follow(rec, s, names, at)
    }
  }

  /** Le suivi rapide propose (nouveau PID du jeu, ou jeu lancé d'après Steam) ; le relevé de playtime.ts confirme. */
  function nominate(rec: Rec, s: Sample, names: Set<string>, at: number): void {
    if (rec.appId && rec.s.phase === 'waiting') {
      const updating = s.updating.get(rec.appId)
      if (updating !== undefined) apply(rec, { type: 'steam-updating', on: updating })
    }
    // En relais, le programme qui vient de se fermer ne compte plus : seul un PID nouveau relance la confirmation.
    const known = rec.s.phase === 'relay' ? new Set([...(rec.baseline ?? []), ...rec.seenPids]) : rec.baseline
    // Un nom déjà porté avant le clic (sous-processus d'un store, Java…) ne prouve rien de neuf : ses nouveaux PID attendent
    // les 10 s, sinon chacun relancerait un relevé complet.
    for (const p of s.procs) {
      const n = p.name.toLowerCase()
      if (rec.baseline?.has(p.pid) && names.has(n)) rec.shared.add(n)
    }
    const nameOf = (pid: number): string => s.procs.find((p) => p.pid === pid)?.name.toLowerCase() ?? ''
    const fresh = deps.newMatches(s, names, known)
    for (const pid of fresh) if (s.windows.has(pid)) rec.windowSeen = true
    const newPid = fresh.some((pid) => !rec.nominated.has(pid) && !rec.shared.has(nameOf(pid)))
    for (const pid of fresh) rec.nominated.add(pid)
    const rearmed = at - rec.lastConfirmAt >= t.CONFIRM_REARM_MS
    const steam = rec.appId !== null && s.runningAppId === rec.appId
    if (newPid || (rearmed && (fresh.length > 0 || steam))) void confirm(rec)
  }

  function follow(rec: Rec, s: Sample, names: Set<string>, at: number): void {
    if (!names.size) {
      // Rien à reconnaître dans le relevé rapide : le relevé de la minute suit la partie.
      rec.watched = false
      reconcileOne(rec)
      return
    }
    const live = s.procs.filter((p) => names.has(p.name.toLowerCase()))
    if (live.length) {
      rec.missSince = null
      rec.misses = 0
      rec.stillSeen = true
      for (const p of live) {
        rec.seenPids.add(p.pid)
        if (s.windows.has(p.pid)) rec.windowSeen = true
      }
      maybeMinimize(rec)
      return
    }
    rec.stillSeen = false
    if (rec.missSince === null) {
      rec.missSince = at
      rec.misses = 1
    } else rec.misses++
    if (rec.misses >= 2 && at - rec.missSince >= t.MISS_SPAN_MS && !rec.exiting) void gone(rec)
  }

  function budget(): void {
    const c = watcher.cost()
    if (++samples % 30 === 0) deps.log(`watcher p95 ${Math.round(c.p95CpuMs)}ms ws ${Math.round(c.ws / 1e6)}MB`)
    if (c.samples < BUDGET_MIN_SAMPLES) return
    if (c.p95CpuMs > BUDGET.hardP95CpuMs) return watcherDown(`trop coûteux : p95 ${Math.round(c.p95CpuMs)} ms`)
    if (!overBudget && (c.p95CpuMs > BUDGET.p95CpuMs || c.ws > BUDGET.wsBytes)) {
      overBudget = true
      deps.log(`watcher au-delà du budget (p95 ${Math.round(c.p95CpuMs)}ms ws ${Math.round(c.ws / 1e6)}MB) : lancements en attente seulement`)
    }
  }

  /** Suivi rapide impossible (PowerShell muet, bloqué ou trop coûteux) : relevés à 20 s, 45 s puis chaque minute, pendant 10 min. */
  function watcherDown(why: string): void {
    watchOffUntil = now() + t.WATCH_OFF_MS
    deps.log(`suivi rapide coupé pour 10 min (${why})`)
    const unwatched: Rec[] = []
    for (const rec of all()) {
      if (!rec.watched) continue
      rec.watched = false
      unwatched.push(rec)
      if (!isPending(rec.s.phase)) continue
      apply(rec, { type: 'detect', mode: 'poll' })
      tracker.nudge(() => isPending(rec.s.phase))
    }
    stopWatch(true)
    for (const rec of unwatched) reconcileOne(rec)
  }

  // ----- fenêtre -----

  function maybeMinimize(rec: Rec): void {
    if (rec.s.demo || rec.minimizeDone || rec.s.phase !== 'running') return
    if (deps.settings().launchWindow !== 'minimize') return
    const w = deps.window
    const a = windowAction(
      'minimize',
      {
        event: 'running',
        windowSeen: rec.windowSeen,
        sinceDetectedMs: now() - (rec.s.detectedAt ?? now()),
        stillSeen: rec.watched ? rec.stillSeen : tracker.isRunning(rec.s.gameId),
        focused: w.focused(),
        minimized: w.minimized()
      },
      t
    )
    if (a.kind !== 'minimize') return
    rec.minimizeDone = true
    wasMaximized = w.maximized()
    minimizedBy = rec.s.launchId
    w.minimize()
    deps.log(`${label(rec)} : Player X réduit${wasMaximized ? ' (il était agrandi)' : ''}`)
    refreshWatch()
  }

  function onExit(rec: Rec, event: 'ended' | 'early-exit'): void {
    if (rec.s.demo || minimizedBy !== rec.s.launchId) return
    const w = deps.window
    const other = all().find((r) => r !== rec && !r.s.demo && r.s.phase === 'running')
    const a = windowAction(
      deps.settings().launchWindow,
      { event, minimizedByThis: true, minimized: w.minimized(), otherRunning: other?.s.launchId ?? null, wasMaximized },
      t
    )
    if (a.kind === 'hand-over') {
      minimizedBy = a.to
      if (other && !watchOff() && other.s.detect === 'fast') other.watched = true
    } else if (a.kind === 'restore') {
      const id = rec.s.launchId
      clearRestore()
      restoreTimer = timers.setTimeout(() => {
        restoreTimer = null
        // Rouverte entre-temps par toi : ce n'est plus à nous de la rouvrir.
        if (minimizedBy !== id) return
        minimizedBy = null
        if (!w.minimized()) return
        w.showInactive()
        deps.log(`${label(rec)} : Player X revient sans activation (agrandi après : ${w.maximized()})`)
      }, a.delayMs)
    } else {
      if (wasMaximized) deps.log(`${label(rec)} : Player X était agrandi, il reste dans la barre des tâches`)
      minimizedBy = null
    }
    refreshWatch()
  }

  // ----- cycle de vie -----

  function cancel(launchId: string): void {
    const rec = records.get(launchId)
    if (rec) apply(rec, { type: 'cancel' })
  }

  function list(): LaunchStatus[] {
    prune()
    return all().map((r) => r.s)
  }

  function reset(): void {
    epoch++
    stopWatch(true)
    clearRestore()
    minimizedBy = null
    for (const rec of all()) {
      apply(rec, { type: 'cancel', silent: true })
      disarmAll(rec)
    }
    records.clear()
  }

  function suspend(): void {
    stopWatch(true)
    clearRestore()
    minimizedBy = null
    for (const rec of all()) {
      if (rec.s.demo) continue
      rec.watched = false
      // Au réveil, rien ne reprend : les pastilles « En jeu » viennent du relevé qui suit (5 s après), sans carte ni annonce.
      apply(rec, isPending(rec.s.phase) ? { type: 'gave-up', silent: true } : { type: 'cancel', silent: true })
    }
  }

  function shutdown(): void {
    stopWatch(true)
    clearRestore()
    for (const rec of all()) disarmAll(rec)
  }

  return { start, cancel, list, reset, suspend, shutdown }
}
