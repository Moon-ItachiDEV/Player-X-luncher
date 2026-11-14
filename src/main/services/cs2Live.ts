import { randomBytes } from 'node:crypto'
import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { app, Notification } from 'electron'
import { CS2_GAME_ID, cs2RecapLine } from '@shared/cs2'
import type { Cs2Config, Cs2Recap, Cs2RecapEvent, Cs2State } from '@shared/types'
import { logError } from '../crashLog'
import { deleteKv, getKv, listGames, setKv } from '../db'
import { BASE_PORT, cfgDir, cfgText, GSI_FILE, isToken, MAX_BODY, PORT_TRIES, refuse, tokenMatches } from './cs2Gsi'
import { expire, liveOf, readPayload, recapOf, sameMatch, step, type EndReason, type MatchState, type Snapshot } from './cs2Match'
import { NO_MOMENTS, stepMoments, type Cs2Moment, type MomentsState } from './cs2Moments'
import { getSettings } from './settings'
import { broadcast, mainWindow } from '../windows'
import { showMainWindow } from './tray'

// Counter-Strike 2 : match en direct et bilan de fin de match, avec la Game State Integration de Valve (officielle,
// gratuite, sans clé ni compte, sans risque pour l'anti-triche). CS2 lit au démarrage un fichier de son dossier cfg et
// poste ensuite l'état de la partie à l'adresse qu'il donne : ici un petit serveur sur 127.0.0.1, protégé par un jeton.
// Le calcul du match est dans cs2Match.ts (testé sans Electron), le fichier et le tri des requêtes dans cs2Gsi.ts.

const GSI_KEY = 'cs2Gsi'
const MATCH_KEY = 'cs2Match'
const RECAPS_KEY = 'cs2Recaps'
/** Bilans gardés : assez pour que tes chiffres et ta vue par carte aient du sens (environ 2 Ko chacun). */
const MAX_RECAPS = 500
/** Plus aucun envoi (CS2 en envoie un toutes les 10 s) : le match est coupé (jeu fermé, planté). */
const SILENCE_MS = 35_000
/** Player X relancé pendant un match : il continue si le dernier envoi date de moins de 10 min. */
const RESUME_MS = 10 * 60_000
/**
 * Match coupé sans fin (plus d'envoi, CS2 fermé ou planté) : mis de côté 5 min. CS2 relancé dans le même match (même
 * compte, carte et mode, rounds qui n'ont pas reculé) : il continue, sans deuxième bilan. Sinon son bilan est fait.
 */
const HOLD_MS = 5 * 60_000
/** Match en cours gardé en base au plus souvent toutes les 15 s (la base est réécrite sur le disque à chaque fois). */
const SAVE_MS = 15_000
/** « Liaison active » : un envoi il y a moins d'une minute. */
const CONNECTED_MS = 60_000
/** Match en direct envoyé à l'interface au plus une fois par seconde. */
const LIVE_MS = 1_000
/**
 * CS2 envoie au moins toutes les 10 s, menus compris, dès qu'il a lu le fichier. Ouvert depuis 30 s sans rien envoyer :
 * il tournait déjà quand le fichier a été écrit (première installation, port changé), il faut le relancer.
 */
const QUIET_MS = 30_000

interface Gsi {
  token: string
  port: number
}

let server: Server | null = null
let port: number | null = null
let config: Cs2Config = 'off'
let match: MatchState | null = null
/** Match coupé, en attente d'un retour de CS2 (voir HOLD_MS). Il reste aussi en base. */
let held: { match: MatchState; until: number } | null = null
let savedAt = 0
let lastPayloadAt = 0
/** CS2 tourne (dernier état donné par le suivi du temps de jeu), et depuis quand Player X le voit. */
let running = false
let runningAt = 0
/** Fichier en place depuis (écrit ou vérifié). */
let readyAt = 0
let quietTimer: ReturnType<typeof setTimeout> | undefined
let silenceTimer: ReturnType<typeof setInterval> | undefined
let connectedTimer: ReturnType<typeof setTimeout> | undefined
let liveTimer: ReturnType<typeof setTimeout> | undefined
let liveSentAt = 0
/** Bilans prêts pendant que Player X n'était pas devant : une seule notification Windows, à la fermeture de CS2. */
let toastQueue: string[] = []
/** Gardée tant qu'elle vit, sinon son clic est perdu. */
let toast: Notification | null = null
/** Développement (cs2Sim.ts) : les envois du simulateur comptent aussi en mode démo, leurs bilans restent en mémoire. */
let simulated = false
let simRecaps: Cs2Recap[] = []
let syncing: Promise<void> = Promise.resolve()

/** L'overlay reçoit aussi ces envois (cs2:live, cs2:recap). */
const send = (channel: string, payload?: unknown): void => broadcast(channel, payload, { overlay: true })

const emitState = (): void => send('cs2:state')

/** Le mode démo n'affiche ni tes vrais matchs ni tes vrais bilans ; seul le simulateur de développement y passe. */
const hidden = (): boolean => getSettings().demoMode && !simulated

// ---------- match en direct ----------

function sendLive(): void {
  liveTimer = undefined
  liveSentAt = Date.now()
  send('cs2:live', hidden() ? null : liveOf(match))
}

/** Au plus une fois par seconde ; la fin d'un match (null) part tout de suite. */
function emitLive(): void {
  if (!match) {
    clearTimeout(liveTimer)
    return sendLive()
  }
  if (liveTimer) return
  liveTimer = setTimeout(sendLive, Math.max(0, LIVE_MS - (Date.now() - liveSentAt)))
}

function saveMatch(force = false): void {
  if (!match) {
    deleteKv(MATCH_KEY)
    savedAt = 0
    return
  }
  if (!force && Date.now() - savedAt < SAVE_MS) return
  savedAt = Date.now()
  setKv(MATCH_KEY, match)
}

/** Toutes les 5 s, tant qu'un match est suivi ou mis de côté : coupure, puis fin de l'attente. */
function silenceTick(): void {
  try {
    const now = Date.now()
    if (match && expire(match, now, SILENCE_MS).ended) hold(match, now + HOLD_MS)
    if (held && now >= held.until) {
      const m = held.match
      held = null
      if (!match) saveMatch(true)
      record(m, 'left')
    }
    watchSilence()
  } catch (e) {
    logError('cs2 : fin de match', e)
  }
}

function watchSilence(): void {
  const busy = !!match || !!held
  if (busy && !silenceTimer) silenceTimer = setInterval(silenceTick, 5_000)
  if (!busy && silenceTimer) {
    clearInterval(silenceTimer)
    silenceTimer = undefined
  }
}

/** Met le match de côté : plus de carte « En match », mais il reste en base et peut reprendre. */
function hold(m: MatchState, until: number): void {
  if (held && held.match.id !== m.id) record(held.match, 'left')
  held = { match: m, until }
  if (match?.id === m.id) {
    match = null
    emitLive()
  }
  setKv(MATCH_KEY, m)
  savedAt = Date.now()
  watchSilence()
}

function apply(r: { match: MatchState | null; ended?: { match: MatchState; by: EndReason } }): void {
  const before = match
  const roundBefore = before?.mapRound
  match = r.match
  if (r.ended) record(r.ended.match, r.ended.by)
  // Nouveau match, nouveau round ou fin : gardé tout de suite. Sinon au plus toutes les 15 s. Un match mis de côté
  // garde sa place en base.
  if (match !== before && (match || !held)) saveMatch(!match || !before || match.id !== before.id || match.mapRound !== roundBefore)
  watchSilence()
  if (match !== before) emitLive()
}

// ---------- bilans ----------

function recaps(): Cs2Recap[] {
  return getKv<Cs2Recap[]>(RECAPS_KEY, [])
}

function front(): boolean {
  const win = mainWindow()
  return !!win && win.isFocused() && win.isVisible() && !win.isMinimized()
}

function record(m: MatchState, by: EndReason): void {
  const recap = recapOf(m, by)
  if (!recap) return
  if (simulated && getSettings().demoMode) {
    // Simulateur en mode démo : un exemple, jamais enregistré.
    const sample: Cs2Recap = { ...recap, sample: true }
    simRecaps = [sample, ...simRecaps.filter((r) => r.id !== sample.id)].slice(0, MAX_RECAPS)
    return announce(sample)
  }
  setKv(RECAPS_KEY, [recap, ...recaps().filter((r) => r.id !== recap.id)].sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX_RECAPS))
  // Mode démo : ton vrai bilan est gardé sans être montré ; il est proposé au retour (moins de 12 h).
  if (getSettings().demoMode) return
  announce(recap)
}

/** Player X au premier plan : une carte dans la fenêtre. Sinon une notification Windows, à la fermeture de CS2. */
function announce(recap: Cs2Recap): void {
  emitState()
  const e: Cs2RecapEvent = { recap, reason: front() ? 'ready' : 'updated' }
  send('cs2:recap', e)
  if (e.reason === 'ready' || recap.sample) return
  toastQueue = [...toastQueue.filter((id) => id !== recap.id), recap.id]
  if (!running) flushToasts()
}

function flushToasts(): void {
  const list = recaps()
  const ready = toastQueue.map((id) => list.find((r) => r.id === id)).filter((r): r is Cs2Recap => !!r && !r.seen)
  toastQueue = []
  if (!ready.length || front() || hidden()) return
  const last = ready[ready.length - 1]
  toast?.close()
  if (getSettings().cs2RecapOpen) {
    // Player X s'ouvre de lui-même sur le dernier bilan (les autres restent dans la fiche de CS2).
    showMainWindow()
    send('cs2:recap', { recap: last, reason: 'open' } satisfies Cs2RecapEvent)
    // Windows peut refuser de passer la fenêtre devant : la notification prend le relais.
    setTimeout(() => {
      if (!front()) notifyRecaps(ready.length, last)
    }, 1500)
    return
  }
  notifyRecaps(ready.length, last)
}

function notifyRecaps(count: number, last: Cs2Recap): void {
  if (!Notification.isSupported()) return
  toast?.close()
  const n = new Notification({
    title: count > 1 ? `Tes ${count} bilans Counter-Strike 2 sont prêts` : 'Ton bilan Counter-Strike 2 est prêt',
    body: cs2RecapLine(last),
    icon: join(app.getAppPath(), 'resources', 'icon.png')
  })
  n.on('click', () => {
    showMainWindow()
    send('cs2:recap', { recap: recaps().find((r) => r.id === last.id) ?? last, reason: 'open' } satisfies Cs2RecapEvent)
  })
  n.on('close', () => toast === n && (toast = null))
  toast = n
  n.show()
}

export function markCs2RecapSeen(id: unknown): void {
  if (typeof id !== 'string' || getSettings().demoMode) return
  const list = recaps()
  const r = list.find((x) => x.id === id)
  if (!r || r.seen) return
  r.seen = true
  setKv(RECAPS_KEY, list)
}

// ---------- serveur local ----------

/** Jeton et port, gardés en mémoire : relus à chaque envoi (deux fois par seconde en partie). */
let gsiCache: Gsi | null = null

function gsi(): Gsi {
  if (gsiCache) return gsiCache
  const saved = getKv<Partial<Gsi>>(GSI_KEY, {})
  const g: Gsi = {
    token: isToken(saved.token) ? saved.token : randomBytes(24).toString('base64url'),
    port: typeof saved.port === 'number' && saved.port >= BASE_PORT && saved.port < BASE_PORT + PORT_TRIES ? saved.port : BASE_PORT
  }
  if (g.token !== saved.token || g.port !== saved.port) setKv(GSI_KEY, g, true)
  gsiCache = g
  return g
}

// ---------- moments d'une partie (déclencheurs des clips) ----------

let momentsState: MomentsState = NO_MOMENTS
const momentListeners = new Set<(m: Cs2Moment) => void>()

/** Élimination, headshot, multi-kill, ace, mort : jamais pendant l'échauffement ni pour un joueur observé (cs2Moments.ts). */
export function onCs2Moment(cb: (m: Cs2Moment) => void): () => void {
  momentListeners.add(cb)
  return () => momentListeners.delete(cb)
}

function emitMoments(snap: Snapshot): void {
  try {
    const r = stepMoments(momentsState, snap, Date.now())
    momentsState = r.state
    for (const m of r.moments) for (const cb of momentListeners) cb(m)
  } catch (e) {
    logError('cs2 : moments', e)
  }
}

/** Carte, mode, round et score du match suivi, pour un clip manuel pendant la partie. */
export function cs2MomentContext(): { map: string; mode: string; round: number; score?: { us: number; them: number } } | null {
  const live = liveOf(match)
  return live ? { map: live.map, mode: live.mode, round: live.round, ...(live.score ? { score: live.score } : {}) } : null
}

function onPayload(body: unknown): void {
  // Envoi parti juste avant la coupure du réglage : ignoré.
  if (!getSettings().cs2Live) return
  const snap = readPayload(body)
  if (!snap) return
  emitMoments(snap)
  const first = Date.now() - lastPayloadAt > CONNECTED_MS
  lastPayloadAt = Date.now()
  // « Liaison active » redevient « prête » une minute après le dernier envoi (jeu fermé) : l'interface relit l'état.
  clearTimeout(connectedTimer)
  connectedTimer = setTimeout(emitState, CONNECTED_MS + 500)
  // Le simulateur de développement tient lieu de CS2 : la liaison est active, quel que soit l'état du vrai jeu.
  if (simulated && config !== 'ready') config = 'ready'
  // Premier envoi depuis un moment : « Relance CS2 » disparaît, « Liaison active » s'affiche.
  if (first) emitState()
  // En mode démo aussi : ton vrai match continue d'être suivi (seul l'affichage est masqué), son bilan est gardé.
  let base = match
  // Au menu (CS2 relancé après un plantage, avant « Reconnecter ») : le match mis de côté attend encore.
  if (!base && held && snap.map) {
    // Retour de CS2 après une coupure : le même match continue, sinon celui mis de côté est terminé.
    const h = held
    held = null
    if (sameMatch(h.match, snap)) base = h.match
    else record(h.match, 'left')
  }
  apply(step(base, snap, Date.now()))
}

function listen(at: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      const code = refuse(req)
      if (code) {
        res.writeHead(code).end()
        req.resume()
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) {
          res.writeHead(413).end()
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        if (res.writableEnded) return
        let body: unknown
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return void res.writeHead(400).end()
        }
        if (!tokenMatches(body, gsi().token)) return void res.writeHead(401).end()
        // Réponse tout de suite : CS2 attend un 2XX pour envoyer la suite (et ses différences).
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
        try {
          onPayload(body)
        } catch (e) {
          logError('cs2 : envoi du jeu', e)
        }
      })
    })
    s.headersTimeout = 5_000
    s.requestTimeout = 10_000
    s.once('error', () => resolve(null))
    s.listen(at, '127.0.0.1', () => resolve(s))
  })
}

/** Port enregistré d'abord (le fichier de CS2 le connaît), puis les suivants. */
async function startServer(): Promise<number | null> {
  if (server && port) return port
  const saved = gsi()
  const tries = [saved.port, ...Array.from({ length: PORT_TRIES }, (_, i) => BASE_PORT + i).filter((p) => p !== saved.port)]
  for (const p of tries) {
    const s = await listen(p)
    if (!s) continue
    server = s
    port = p
    if (p !== saved.port) {
      gsiCache = { ...saved, port: p }
      setKv(GSI_KEY, gsiCache, true)
    }
    return p
  }
  return null
}

function stopServer(): void {
  server?.close()
  server?.closeAllConnections()
  server = null
  port = null
}

// ---------- fichier de config de CS2 ----------

/** Dossier cfg de CS2 d'après la bibliothèque (jamais un chemin reçu de l'interface). */
async function cs2CfgDir(): Promise<string | null> {
  const dir = listGames().find((g) => g.id === CS2_GAME_ID)?.installDir
  if (!dir) return null
  const cfg = cfgDir(dir)
  return (await stat(cfg).then((s) => s.isDirectory(), () => false)) ? cfg : null
}

async function writeCfg(at: number): Promise<Cs2Config> {
  const dir = await cs2CfgDir()
  if (!dir) return 'missing'
  const file = join(dir, GSI_FILE)
  const text = cfgText(at, gsi().token)
  const current = await readFile(file, 'utf8').catch(() => null)
  if (current === text) return 'ready'
  try {
    // UTF-8 sans BOM : CS2 ignore un fichier qui en a un.
    await writeFile(file, text, 'utf8')
  } catch (e) {
    logError('cs2 : fichier de liaison', e)
    return 'blocked'
  }
  // Écrit pendant que CS2 tourne : il ne le lira qu'à son prochain démarrage (cs2State dit alors « Relance CS2 »).
  readyAt = Date.now()
  return 'ready'
}

/** « Relance CS2 » : CS2 ouvert depuis 30 s, fichier en place depuis 30 s, et rien reçu depuis 30 s. */
function shownConfig(): Cs2Config {
  const now = Date.now()
  const quiet = now - lastPayloadAt > QUIET_MS && now - Math.max(runningAt, readyAt) > QUIET_MS
  return config === 'ready' && running && !simulated && quiet ? 'restart' : config
}

/** L'état affiché peut passer à « Relance CS2 » sans autre événement : l'interface relit l'état à ce moment-là. */
function recheckQuiet(): void {
  clearTimeout(quietTimer)
  if (running) quietTimer = setTimeout(emitState, QUIET_MS + 500)
}

async function removeCfg(): Promise<void> {
  const dir = await cs2CfgDir()
  if (dir) await unlink(join(dir, GSI_FILE)).catch(() => {})
}

async function doSync(): Promise<void> {
  const before = config
  if (!getSettings().cs2Live) {
    stopServer()
    await removeCfg()
    config = 'off'
    if (match) apply({ match: null })
    if (held) {
      held = null
      saveMatch(true)
    }
  } else {
    const at = await startServer()
    config = at === null ? 'no-port' : await writeCfg(at)
    if (config === 'ready' && before !== 'ready') readyAt = Math.max(readyAt, Date.now())
  }
  if (config !== before) emitState()
  recheckQuiet()
}

/** Réglage changé, bibliothèque relue (CS2 installé, déplacé) : serveur et fichier remis d'accord. Une passe à la fois. */
export function syncCs2(): Promise<void> {
  syncing = syncing.then(doSync).catch((e) => logError('cs2 : liaison', e))
  return syncing
}

// ---------- branchements ----------

/** Au démarrage : reprend un match laissé ouvert (Player X relancé en pleine partie), puis lance le serveur. */
export function startCs2Live(): void {
  const saved = getKv<MatchState | null>(MATCH_KEY, null)
  if (saved && typeof saved.id === 'string' && typeof saved.lastAt === 'number' && Array.isArray(saved.rounds)) {
    // Plus d'envoi depuis longtemps : il s'est terminé pendant que Player X était fermé. Sinon il attend la suite,
    // mis de côté (pas de carte « En match » avant le prochain envoi de CS2).
    if (Date.now() - saved.lastAt > RESUME_MS) {
      deleteKv(MATCH_KEY)
      record(saved, 'left')
    } else hold(saved, saved.lastAt + RESUME_MS)
  }
  void syncCs2()
}

/** CS2 vient d'être vu en cours, ou vient de se fermer (suivi du temps de jeu, chaque minute). */
export function setCs2Running(now: boolean, sure = true): void {
  // Disparu sans relevé fiable (mise en veille, liste des programmes illisible) : on attend le relevé suivant.
  if (simulated || (!now && !sure)) return
  setRunning(now)
}

/** CS2 tourne ou vient de se fermer : l'overlay s'ouvre ou se ferme avec lui (cs2Overlay.ts). */
const runningListeners = new Set<(now: boolean) => void>()
export function onCs2Running(cb: (now: boolean) => void): void {
  runningListeners.add(cb)
}
export const cs2IsRunning = (): boolean => running

function setRunning(now: boolean): void {
  if (now === running) return
  running = now
  runningAt = now ? Date.now() : 0
  recheckQuiet()
  emitState()
  for (const cb of runningListeners) {
    try {
      cb(now)
    } catch (e) {
      logError('cs2 : overlay', e)
    }
  }
  if (now) return
  // Jeu fermé (ou planté) : le match en cours est mis de côté (il reprend si CS2 revient dans le même match), et les
  // bilans en attente partent en une notification.
  if (match) hold(match, Date.now() + HOLD_MS)
  flushToasts()
}

/** Mode démo activé ou coupé : l'interface relit l'état (ni match ni bilans réels en démo). */
export function cs2DemoChanged(): void {
  emitState()
  sendLive()
}

export function cs2State(): Cs2State {
  const { cs2Live, demoMode } = getSettings()
  const demo = demoMode && !simulated
  return {
    enabled: cs2Live,
    demo,
    config: shownConfig(),
    connected: Date.now() - lastPayloadAt < CONNECTED_MS,
    live: demo ? null : liveOf(match),
    recaps: demoMode ? (simulated ? simRecaps : []) : recaps()
  }
}

// ---------- développement (cs2Sim.ts) ----------

/** Adresse et jeton du serveur, pour que le simulateur poste comme CS2. Jamais dans la version installée. */
export async function cs2SimEndpoint(): Promise<{ port: number; token: string } | null> {
  if (app.isPackaged) return null
  simulated = true
  await syncing
  const at = port ?? (await startServer())
  return at === null ? null : { port: at, token: gsi().token }
}

export function simulateCs2Running(now: boolean): void {
  if (app.isPackaged) return
  simulated = true
  setRunning(now)
}
