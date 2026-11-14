import { join } from 'node:path'
import { app, BrowserWindow, Notification } from 'electron'
import { isBf6Name } from '@shared/text'
import type { Bf6Account, Bf6Recap, Bf6RecapEvent, Bf6RecapState, Bf6Stats, Bf6Tracked } from '@shared/types'
import { logError } from '../crashLog'
import { deleteKv, getKv, lastSeenAt, listGames, setKv } from '../db'
import { recapLine, sessionNumbers } from './bf6Diff'
import { getSettings } from './settings'
import { mainWindow, sendTo } from '../windows'
import { getBf6Stats } from './stats'
import { showMainWindow } from './tray'

// Bilan de session Battlefield 6. gametools.network ne donne que des totaux : au lancement du jeu, Player X relève
// tes stats ; après la fermeture, il les relit (le délai de mise à jour du service n'est pas documenté) et la différence
// fait le bilan. Le jeu est vu par le suivi du temps de jeu (Windows, chaque minute), qu'il soit lancé ou non depuis Player X.

const SESSION_KEY = 'bf6Session'
const RECAPS_KEY = 'bf6Recaps'
const MAX_RECAPS = 20
/** Une minute. En développement, PX_BF6_SIM_FAST la ramène à une seconde pour le simulateur (bf6Sim.ts). */
const MIN = !app.isPackaged && process.env.PX_BF6_SIM_FAST ? 1_000 : 60_000
/** Relevé du lancement manqué (hors ligne, service en panne) : nouveaux essais, bien avant la fin d'une première partie. */
const BEFORE_RETRY = [1, 3, 8].map((m) => m * MIN)
/** Relevé obtenu plus tard que ça : une partie a pu finir avant, le suivi est dit commencé en cours de route. */
const LATE_BEFORE_MS = 5 * MIN
/** Stats gardées en cache acceptées comme relevé du lancement (service injoignable à ce moment-là). */
const STALE_BEFORE_MS = 30 * MIN
/** Après la fermeture du jeu : relectures de plus en plus espacées, jusqu'à ce que le bilan ne bouge plus. */
const AFTER_CHECKS = [2, 5, 10, 15, 30, 60, 120].map((m) => m * MIN)
/** Bilan inchangé d'une relecture à l'autre, fermeture passée de 15 min : il est complet. */
const SETTLE_MS = 15 * MIN
/**
 * Jeu relancé alors que le bilan de la session précédente n'est pas encore complet (plantage, redémarrage du jeu) :
 * c'est la même session. Sinon la partie que gametools n'a pas encore comptée tomberait dans la suivante.
 * Au-delà de 2 h (mise en veille en pleine partie), c'est une autre session.
 */
const MERGE_MS = 120 * MIN
/** Player X relancé pendant la partie : la session continue si le jeu a été vu il y a moins de 10 min. */
const RESUME_MS = 10 * MIN
/** Au démarrage de Player X, le temps de voir si le jeu d'une session restée ouverte tourne encore. */
const ORPHAN_WAIT_MS = 3 * MIN
/** Session restée ouverte dont le jeu n'a plus été vu depuis 6 h : abandonnée, son bilan mélangerait d'autres parties. */
const ORPHAN_MAX_MS = 360 * MIN
/** Jeu déjà en cours dans les premières secondes de Player X : le suivi commence en cours de route. */
const BOOT_MS = 0.75 * MIN

interface Session {
  id: string
  account: Bf6Account
  /** Début du suivi : lancement du jeu, ou plus tard quand le suivi a commencé en cours de route (`partial`). */
  startedAt: number
  partial?: boolean
  endedAt?: number
  /** Relevé du lancement : absent tant qu'il manque. */
  before?: Bf6Stats
  /** Essais du relevé du lancement déjà faits. */
  beforeTries: number
  /** Prochaine étape prévue (reprise après un redémarrage de Player X). */
  nextAt?: number
  /** Chiffres du bilan enregistré, pour voir s'ils bougent encore. */
  last?: string
  /** Bilan déjà annoncé (dans Player X ou par une notification Windows). */
  announced?: boolean
}

let session: Session | null = null
/** Battlefield 6 tourne (dernier état donné par le suivi du temps de jeu). */
let running = false
let timer: ReturnType<typeof setTimeout> | undefined
/** Session restée ouverte à la dernière fermeture de Player X : on attend de savoir si le jeu tourne encore. */
let orphan: { lastSeen?: number; timer: ReturnType<typeof setTimeout> } | null = null
/** Gardée tant qu'elle vit, sinon son clic est perdu. */
let toast: Notification | null = null
let queue: Promise<void> = Promise.resolve()

/** Une étape à la fois : un relevé peut prendre 15 s, et le jeu peut se fermer pendant ce temps. */
function enqueue(step: () => Promise<void> | void): void {
  queue = queue.then(step).catch((e) => logError('bilan Battlefield 6', e))
}

const keyOf = (a: Bf6Account): string => `${a.platform}:${a.personaId ?? a.name.toLowerCase()}`

/** Ton compte Battlefield 6 : toujours le vrai, jamais celui du mode démo. */
function realMe(): Bf6Account | null {
  return getKv<Partial<Bf6Tracked>>('bf6Tracked', {}).me ?? null
}

/** Dernière fois où le suivi du temps de jeu a vu Battlefield 6 (relevé chaque minute, gardé même si Player X se ferme). */
function bf6LastSeen(): number | undefined {
  return lastSeenAt(listGames().flatMap((g) => (isBf6Name(g.name) ? [g.id] : [])))
}

function load(): Session | null {
  const s = getKv<Session | null>(SESSION_KEY, null)
  return s && typeof s.id === 'string' && typeof s.startedAt === 'number' && s.account ? s : null
}

function save(): void {
  if (session) setKv(SESSION_KEY, session)
  else deleteKv(SESSION_KEY)
}

/** Prochaine étape de la session (nouvel essai du relevé, ou relecture après la fermeture). */
function setTimer(at: number | undefined): void {
  clearTimeout(timer)
  timer = undefined
  if (!session) return
  session.nextAt = at
  save()
  if (at !== undefined) timer = setTimeout(() => enqueue(tick), Math.max(1_000, at - Date.now()))
}

function close(): void {
  clearTimeout(timer)
  timer = undefined
  if (orphan) clearTimeout(orphan.timer)
  orphan = null
  session = null
  save()
}

/** Relecture prévue après la fermeture : la première encore à venir (après une mise en veille, celles passées sont sautées). */
function nextCheck(s: Session): number | undefined {
  const soon = Date.now() + MIN / 2
  return AFTER_CHECKS.map((ms) => s.endedAt! + ms).find((t) => t > soon)
}

/** Stats fraîches du compte. `since` : une lecture gardée en cache (service injoignable) est acceptée si elle date d'après. */
async function read(account: Bf6Account, since?: number): Promise<{ stats: Bf6Stats; at: number } | null> {
  try {
    const snap = await getBf6Stats(account, true)
    if (snap.stale && (since === undefined || snap.fetchedAt < since)) return null
    return { stats: snap.stats, at: snap.fetchedAt }
  } catch {
    return null
  }
}

function recaps(): Bf6Recap[] {
  return getKv<Bf6Recap[]>(RECAPS_KEY, [])
}

/** Enregistre ou complète le bilan de la session. `same` : chiffres inchangés ; `none` : rien de compté pour l'instant. */
function record(s: Session, after: Bf6Stats): 'new' | 'same' | 'none' {
  const numbers = s.before ? sessionNumbers(s.before, after) : null
  if (!numbers) return 'none'
  const sig = JSON.stringify(numbers)
  if (sig === s.last) return 'same'
  s.last = sig
  const list = recaps()
  const prev = list.find((r) => r.id === s.id)
  const first = !s.announced
  const recap: Bf6Recap = {
    id: s.id,
    account: { name: after.account.name, platform: s.account.platform },
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? Date.now(),
    ...(s.partial ? { partial: true } : {}),
    ...numbers,
    // Bilan complété après coup : il reste « vu ». Annoncé de nouveau (session prolongée) : il redevient nouveau.
    ...(prev?.seen && !first ? { seen: true } : {})
  }
  setKv(
    RECAPS_KEY,
    [recap, ...list.filter((r) => r.id !== s.id)].sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX_RECAPS)
  )
  s.announced = true
  announce(recap, first ? 'ready' : 'updated')
  return 'new'
}

function send(win: BrowserWindow | undefined, e: Bf6RecapEvent): void {
  sendTo(win, 'bf6:recap', e)
}

/** Player X au premier plan : une carte dans la fenêtre. Sinon une notification Windows, sauf pendant une partie. */
function announce(recap: Bf6Recap, reason: 'ready' | 'updated'): void {
  // Mode démo : les vrais bilans restent hors de la fenêtre. Ils sont proposés au retour (moins de 12 h).
  if (getSettings().demoMode) return
  const win = mainWindow()
  const front = !!win && win.isFocused() && win.isVisible() && !win.isMinimized()
  if (reason === 'updated' || front) return send(win, { recap, reason })
  send(win, { recap, reason: 'updated' })
  if (running || !Notification.isSupported()) return
  toast?.close()
  const n = new Notification({
    title: 'Ton bilan Battlefield 6 est prêt',
    body: recapLine(recap),
    icon: join(app.getAppPath(), 'resources', 'icon.png')
  })
  n.on('click', () => {
    showMainWindow()
    // La dernière version : le bilan a pu être complété depuis la notification.
    send(mainWindow(), { recap: recaps().find((r) => r.id === recap.id) ?? recap, reason: 'open' })
  })
  n.on('close', () => toast === n && (toast = null))
  toast = n
  n.show()
}

// ---------- étapes de la session ----------

/** Nouvelle session : relevé du lancement. Une session précédente qui attendait ses chiffres est complétée par la même lecture. */
async function begin(me: Bf6Account, partial: boolean): Promise<void> {
  const now = Date.now()
  const prev = session
  // La précédente s'arrête là. La nouvelle est montrée tout de suite (« En jeu »), son relevé suit.
  clearTimeout(timer)
  const s: Session = { id: `bf6-${now}`, account: me, startedAt: now, beforeTries: 0, ...(partial ? { partial } : {}) }
  session = s
  save()
  const snap = await read(me, now - STALE_BEFORE_MS)
  if (snap && prev?.endedAt !== undefined && keyOf(prev.account) === keyOf(me)) record(prev, snap.stats)
  if (session !== s) return
  if (snap) s.before = snap.stats
  setTimer(snap ? undefined : now + BEFORE_RETRY[0])
}

/** Nouvel essai du relevé du lancement. */
async function takeBefore(s: Session): Promise<void> {
  const snap = await read(s.account, s.startedAt - STALE_BEFORE_MS)
  if (session !== s || s.endedAt !== undefined) return
  s.beforeTries++
  if (snap) {
    s.before = snap.stats
    // Relevé tardif : une partie a pu finir avant lui, elle ne sera pas comptée.
    if (snap.at - s.startedAt > LATE_BEFORE_MS) Object.assign(s, { partial: true, startedAt: snap.at })
    return setTimer(undefined)
  }
  const next = BEFORE_RETRY[s.beforeTries]
  // Pas de relevé avant la fin d'une première partie : pas de bilan possible pour cette session.
  if (next === undefined) return close()
  setTimer(s.startedAt + next)
}

/** Relecture après la fermeture du jeu. */
async function check(s: Session): Promise<void> {
  const me = realMe()
  // Réglage coupé, compte délié ou changé : plus de bilan pour cette session.
  if (!getSettings().bf6Recap || !me || keyOf(me) !== keyOf(s.account) || !s.before) return close()
  const snap = await read(s.account)
  if (session !== s) return
  const result = snap ? record(s, snap.stats) : 'none'
  if (result === 'same' && Date.now() - s.endedAt! >= SETTLE_MS) return close()
  const next = nextCheck(s)
  if (next === undefined) return close()
  setTimer(next)
}

function tick(): Promise<void> | void {
  const s = session
  if (!s) return
  if (s.endedAt !== undefined) return check(s)
  if (!s.before) return takeBefore(s)
}

async function started(): Promise<void> {
  if (orphan) {
    // Le jeu d'une session restée ouverte tourne : Player X a été relancé en pleine partie (mise à jour, plantage…).
    const { lastSeen } = orphan
    clearTimeout(orphan.timer)
    orphan = null
    const s = session
    if (s && s.endedAt === undefined) {
      if (lastSeen !== undefined && Date.now() - lastSeen < RESUME_MS) return setTimer(s.before ? undefined : Date.now())
      // Fermé trop longtemps : on ne sait plus ce qui s'est joué entre-temps.
      close()
    }
  }
  if (session && session.endedAt === undefined) return
  const me = realMe()
  if (!getSettings().bf6Recap || getSettings().demoMode || !me) return
  const s = session
  // Bilan précédent pas encore complet : même session, même relevé de départ. Il sera annoncé de nouveau s'il change.
  if (s?.before && s.endedAt !== undefined && keyOf(s.account) === keyOf(me) && Date.now() - s.endedAt < MERGE_MS) {
    s.endedAt = undefined
    s.announced = false
    return setTimer(undefined)
  }
  await begin(me, process.uptime() * 1000 < BOOT_MS)
}

function stopped(): void {
  const s = session
  if (!s || s.endedAt !== undefined || orphan) return
  if (!s.before) return close()
  // Fin réelle : dernière fois où le suivi du temps de jeu a vu le jeu.
  s.endedAt = Math.min(Date.now(), Math.max(s.startedAt, bf6LastSeen() ?? Date.now()))
  setTimer(nextCheck(s) ?? Date.now() + MIN)
}

/** Player X a démarré sans voir le jeu d'une session restée ouverte : elle se termine à la dernière apparition du jeu. */
function settleOrphan(): void {
  if (!orphan) return
  const { lastSeen } = orphan
  orphan = null
  const s = session
  if (!s || s.endedAt !== undefined || running) return
  const end = Math.max(s.startedAt, lastSeen ?? s.startedAt)
  if (!s.before || Date.now() - end > ORPHAN_MAX_MS) return close()
  s.endedAt = end
  // Au moins une relecture, même si toutes les relectures prévues sont passées.
  setTimer(nextCheck(s) ?? Date.now() + MIN / 12)
}

// ---------- branchements ----------

/** Au démarrage, avant le suivi du temps de jeu : reprend la session laissée par le lancement précédent. */
export function startBf6Recaps(): void {
  session = load()
  if (!session) return
  if (session.endedAt !== undefined) return setTimer(session.nextAt ?? nextCheck(session) ?? Date.now() + MIN / 12)
  // Lu avant le premier relevé du suivi, qui ouvrira une nouvelle session de jeu si le jeu tourne encore.
  orphan = { lastSeen: bf6LastSeen(), timer: setTimeout(() => enqueue(settleOrphan), ORPHAN_WAIT_MS) }
}

function setRunning(now: boolean): void {
  if (now === running) return
  running = now
  enqueue(now ? started : stopped)
}

/**
 * Battlefield 6 vient d'être vu en cours, ou vient de se fermer (suivi du temps de jeu). `sure` : faux quand le jeu a
 * disparu sans relevé fiable (mise en veille, liste des programmes illisible) ; la session continue jusqu'au relevé suivant.
 */
export function setBf6Running(now: boolean, sure = true): void {
  if (simulated || (!now && !sure)) return
  setRunning(now)
}

/** Développement seulement (bf6Sim.ts) : l'état du jeu vient du simulateur, plus du suivi du temps de jeu. */
let simulated = false

export function simulateBf6Running(now: boolean): void {
  if (app.isPackaged) return
  simulated = true
  setRunning(now)
}

/** Réglage « Bilan Battlefield 6 » changé. */
export function syncBf6Recaps(): void {
  enqueue(async () => {
    const { bf6Recap, demoMode } = getSettings()
    if (!bf6Recap) return close()
    // Activé en pleine partie : le suivi commence maintenant.
    const me = realMe()
    if (running && !session && !demoMode && me) await begin(me, true)
  })
}

export function bf6RecapState(): Bf6RecapState {
  const { bf6Recap, demoMode } = getSettings()
  // Mode démo : ni tes vrais bilans ni ta session en cours.
  if (demoMode) return { enabled: bf6Recap, pending: null, recaps: [] }
  const s = session
  // Bilan déjà annoncé : il est dans la liste (et peut encore être complété), plus « en préparation ».
  const showPending = s && !orphan && !(s.endedAt !== undefined && s.announced)
  return {
    enabled: bf6Recap,
    pending: showPending ? { startedAt: s.startedAt, ...(s.endedAt !== undefined ? { endedAt: s.endedAt } : {}) } : null,
    recaps: recaps()
  }
}

/** Bilan ouvert dans Player X : il n'est plus proposé. */
export function markBf6RecapSeen(id: unknown): void {
  if (typeof id !== 'string' || getSettings().demoMode) return
  const list = recaps()
  const r = list.find((x) => x.id === id)
  if (!r || r.seen) return
  r.seen = true
  setKv(RECAPS_KEY, list)
}
