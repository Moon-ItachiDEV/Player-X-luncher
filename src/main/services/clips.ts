import { execFile, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile as copyOnDisk, mkdir, open, readdir, rename, rm, stat, unlink, writeFile, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, clipboard, ClipboardItem, desktopCapturer, dialog, globalShortcut, ipcMain, powerMonitor, protocol, screen, session, shell, type IpcMainEvent, type Session, type WebContents } from 'electron'
import { cleanGamePace, cleanPace, gamePace, gamePaceLine, paceLog, paceOf, rateBetween, type ClipPace, type GamePace } from '@shared/clipPace'
import { CS2_GAME_ID } from '@shared/cs2'
import { cleanName, isBf6Name } from '@shared/text'
import type { Clip, ClipDisplay, ClipSettings, ClipShareResult, ClipShareStep, ClipsState, Game } from '@shared/types'
import { getKv, setKv } from '../db'
import { hotkeyRefusal } from '../hotkeys'
import { handle } from '../ipc'
import { appWindows, broadcast, markOverlay, mainWindow } from '../windows'
import {
  CLIP_ID,
  canMerge,
  clipBaseName,
  clipEvents,
  clipKills,
  clipsToPurge,
  clipTitle,
  cleanClipSettings,
  cleanTitle,
  DEFAULT_CLIP_SETTINGS,
  keepFrom,
  mergePending,
  openPending,
  pickRecorder,
  QUALITY,
  restartDelayMs,
  safeFileName,
  selectFragments,
  trimEvents,
  withNeighbours,
  type BufferedFragment,
  type ClipMoment,
  type PendingClip
} from './clipsPlan'
import { errText, log, logFlushed, logTail } from './clipsLog'
import { registerClipProtocol } from './clipsProtocol'
import { cleanShareCopies, dropShareCopies, lightCopy } from './clipsShare'
import { showClipToast } from './clipsToast'
import { cs2IsRunning, cs2MomentContext, onCs2Moment, onCs2Running } from './cs2Live'
import { buildFlat, collectTracks, cutTracks, firstFrameS, Fmp4Splitter, parseFlat, parseFragment, parseInit, readBoxes, type ClipTrack, type FlatPlan, type FragmentInfo, type InitInfo } from './fmp4'
import { getSettings } from './settings'
import { gameExeRegex } from './captureTestArgs'
import { thumbArgs } from './editCompile'
import { captureEngineReady, spawnCaptureEngine } from './editFfmpeg'
import { attemptLabel, engineAttempts, muxArgs, PCM_FRAME_BYTES, PCM_RATE, pcmWindow, readEngineProgress, recordArgs, type EngineAttempt, type PcmPart } from './engineCapture'
import { DISCORD_MB, type ShareSource } from './sharePlan'

// Clips « comme NVIDIA » : pendant qu'un jeu tourne, une fenêtre cachée capture l'écran et le son du système, MediaRecorder
// les encode en MP4 fragmenté et chaque fragment (2 s) part dans un tampon circulaire sur le disque. Sur un kill de CS2 ou le
// raccourci, le clip est écrit en vrai fichier MP4, sans réencodage. Rien ne tourne quand aucun jeu ne tourne.
// Les calculs purs sont dans fmp4.ts (boîtes MP4), clipsPlan.ts (fenêtres, fusion, rétention) et cs2Moments.ts.
// La fenêtre de capture a sa propre session : la session des pages de l'appli continue de tout refuser (lockDown).

const SCHEME = 'pxclip'

// Doit être appelé une seule fois, avant que l'appli soit prête : d'où ici, au chargement du module (index.ts l'importe).
// Un autre protocole privilégié devra s'ajouter à cette même liste.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }])

const SETTINGS_KEY = 'clipsSettings'
const INDEX_KEY = 'clipsIndex'
/** Bêta 46 : le rythme des clips de la dernière partie finie. */
const LAST_GAME_KEY = 'clipsLastGame'
const PARTITION = 'px-clips-capture'
const PAGE_NAME = 'clips-recorder.html'
/** Attente de la dernière image après la fermeture de la fenêtre d'un clip : un fragment arrive au plus toutes les 2 s environ. */
const GRACE_MS = 6_000
const TICK_MS = 250
/** Plus aucune donnée de l'enregistreur depuis ce temps : il est relancé. */
const STALL_MS = 15_000
/** Après la demande d'arrêt, le dernier fragment arrive en quelques dizaines de millisecondes. */
const STOP_WAIT_MS = 3_000
/** L'appli qui quitte n'attend pas plus longtemps ses derniers clips. */
const QUIT_WAIT_MS = 8_000
/** Plus que ça en attente d'écriture : le disque ne suit pas, l'enregistreur s'arrête plutôt que de remplir la mémoire. */
const MAX_QUEUED_BYTES = 256 * 1024 * 1024
const MAX_THUMB_BYTES = 4 * 1024 * 1024
/** Enregistreur en bonne santé depuis ce temps : ses relances repartent de la plus courte. */
const HEALTHY_MS = 30_000

interface RunningGame {
  id: string
  name: string
}

/** Fiche d'un clip, en base. Le chemin ne sort jamais du processus principal. */
type ClipMeta = Omit<Clip, 'videoUrl' | 'thumbUrl'> & { file: string }

/** Un enregistreur (MediaRecorder) : son en-tête ne vaut que pour ses propres fragments. */
interface Recorder {
  id: string
  dir: string
  splitter: Fmp4Splitter
  init: InitInfo | null
  /** Heure du système du temps 0 du flux. */
  anchor: number
  startedAt: number
  lastDataAt: number
  /** Bêta 46 : la cadence demandée à cet enregistreur (60, ou 30 en qualité légère), pour dire le rythme réel de ses clips. */
  wantedFps: number
  seq: number
  queued: number
  writes: Promise<void>
  mime?: string
  audio?: ClipsState['audio']
  audioError?: string
  /** Rang du format dans la liste de la page. */
  mimeIndex?: number
  ended: boolean
  /** Arrêt demandé pour repartir tout de suite avec d'autres réglages. */
  restartNow: boolean
  onEnded?: () => void
  /** Bêta 42 : la page n'enregistre que le son (l'image vient du moteur). */
  audioOnly?: boolean
  /** Bêta 42 : le son lu par la page en PCM, daté à l'heure du système, gardé en mémoire le temps du tampon. */
  pcm?: PcmPart[]
  /** Bêta 42 : enregistreur d'image du moteur vidéo. */
  engine?: { proc: ChildProcess; attempt: EngineAttempt; err: string; progress: string; loggedAt: number; last?: { frames: number; at: number } }
}

interface Capture {
  game: RunningGame
  sessionId: string
  win: BrowserWindow | null
  ready: boolean
  rec: Recorder | null
  attempts: number
  restartTimer?: ReturnType<typeof setTimeout>
  stopping: boolean
  /** Dernière panne, tant qu'aucun enregistreur n'a repris. */
  failure?: string
  /** Format à essayer en premier : le suivant, quand un enregistreur n'a jamais rien produit. */
  mimeFrom: number
  /** Dernière relance rapide (changement de résolution) : pas de boucle si elle se répète. */
  quickAt: number
  /**
   * Bêta 42 : l'image par le moteur vidéo. undefined : pas encore décidé (le moteur se vérifie au début de la partie) ;
   * true : le moteur filme l'image, la page le son ; false : tout par Chrome (réglage, moteur absent, ou tous les essais ratés).
   */
  engMode?: boolean
  eng: Recorder | null
  engAttempts: EngineAttempt[]
  engIdx: number
  /** Relances du moteur après une coupure, depuis la dernière minute sans souci. */
  engRestarts: number
  engTimer?: ReturnType<typeof setTimeout>
  /** Début de la partie, et tours d'essais : la fenêtre du jeu peut n'apparaître qu'après quelques secondes. */
  engStart: number
  engRound: number
}

interface BufFrag extends BufferedFragment {
  file: string
  info: FragmentInfo
}

let started = false
let capture: Capture | null = null
let stopping: Promise<void> | null = null
let quitting = false
let quitRun: Promise<unknown> | null = null
let suspended = false
/** Toutes les fenêtres de l'appli sont fermées pour de bon : on arrête la capture, sinon l'appli ne quitterait pas. */
let windowsGone = false
let libraryRunning: RunningGame[] = []
/** Développement : jeux marqués comme lancés par les essais (globalThis.pxClipsTest). */
let testRunning: RunningGame[] = []

let current: ClipSettings = DEFAULT_CLIP_SETTINGS
let index: ClipMeta[] = []

const recorders = new Map<string, Recorder>()
let frags: BufFrag[] = []
const pendings = new Map<string, PendingClip>()
/** Fenêtres des clips en cours d'écriture : leurs fragments restent. */
const writing = new Map<string, number>()
/** Écritures, découpes, renommages : un à la fois. */
let fileQueue: Promise<unknown> = Promise.resolve()
let fileBusy = 0
const thumbAllowed = new Set<string>()
let tickTimer: ReturnType<typeof setInterval> | undefined
let hotkeyNow: string | null = null
let hotkeyError: string | undefined
/** Dernier problème hors capture (clip impossible). */
let lastProblem: string | undefined
/** Bêta 46 : le rythme des clips de la dernière partie finie (relu de la base au démarrage). */
let lastGame: GamePace | undefined
let lastStateJson = ''
let captureSession: Session | null = null

const userData = (...p: string[]): string => join(app.getPath('userData'), ...p)
const bufferRoot = (): string => userData('clips-buffer')
const thumbPath = (id: string): string => userData('clips-thumbs', `${id}.jpg`)
function defaultFolder(): string {
  try {
    return join(app.getPath('videos'), 'Player X V3 Test')
  } catch {
    // Dossier Vidéos introuvable sur ce PC.
    return userData('Clips')
  }
}
const folderOf = (s: ClipSettings): string => s.folder || defaultFolder()
const resolved = (s: ClipSettings): ClipSettings => ({ ...s, folder: folderOf(s) })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------- état ----------

function bufferSeconds(rec: Recorder | null): number {
  if (!rec) return 0
  const mine = frags.filter((f) => f.recId === rec.id)
  return mine.length ? Math.round((mine[mine.length - 1].endWall - mine[0].startWall) / 1000) : 0
}

function stateNow(): ClipsState {
  const last = lastGame ? { lastGame } : {}
  if (!current.enabled) return { status: 'off', ...last }
  if (!capture) return { status: 'idle', ...(lastProblem ? { error: lastProblem } : {}), ...last }
  const c = capture
  const rec = c.rec
  // Bêta 42 : l'image peut venir du moteur (c.eng), le son de la page (c.rec).
  const video = c.eng ?? rec
  const problems = [c.failure, rec?.audioError, hotkeyError, lastProblem].filter(Boolean)
  return {
    status: c.stopping || video || (!c.failure && !c.restartTimer) ? 'recording' : 'error',
    game: c.game.name,
    ...(video?.mime ? { encoder: video.mime } : {}),
    ...(rec?.audio ? { audio: rec.audio } : {}),
    ...(problems.length ? { error: problems.join(' ') } : {}),
    ...(video ? { bufferSeconds: bufferSeconds(video) } : {}),
    ...last
  }
}

function emitState(): void {
  const s = stateNow()
  const json = JSON.stringify(s)
  if (json === lastStateJson) return
  lastStateJson = json
  broadcast('clips:state', s)
}

const emitChanged = (): void => broadcast('clips:changed')

// ---------- fenêtre de capture ----------

/** La page interne, dans sa fenêtre : rien d'autre n'a droit à l'écran ni au micro. */
function isRecorderContents(wc: WebContents | null | undefined): boolean {
  const win = capture?.win
  if (!wc || !win || win.isDestroyed() || wc !== win.webContents) return false
  const url = wc.getURL()
  return !url || isRecorderUrl(url)
}

function isRecorderUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'file:' && u.pathname.endsWith(`/renderer/${PAGE_NAME}`)
  } catch {
    return false
  }
}

function fromRecorder(e: IpcMainEvent): boolean {
  return isRecorderContents(e.sender) && e.senderFrame?.parent === null && isRecorderUrl(e.senderFrame?.url)
}

/** Écran à capturer : celui des réglages, sinon l'écran principal. */
function targetDisplayId(): number {
  const all = screen.getAllDisplays()
  return all.find((d) => d.id === current.display)?.id ?? screen.getPrimaryDisplay().id
}

/** Session de la fenêtre de capture : la seule où l'écran et le micro peuvent être accordés, et seulement à sa page. */
function ensureSession(): Session {
  if (captureSession) return captureSession
  const ses = session.fromPartition(PARTITION)
  const allowed = (permission: string): boolean => permission === 'media' || permission === 'display-capture'
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(allowed(permission) && isRecorderContents(wc)))
  ses.setPermissionCheckHandler((wc, permission) => allowed(permission) && isRecorderContents(wc))
  // getDisplayMedia sans aucune invite : la source est choisie ici, jamais par la page.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const win = capture?.win
    const frame = request.frame
    if (!win || win.isDestroyed() || !frame || frame !== win.webContents.mainFrame) return callback(null)
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const id = String(targetDisplayId())
        const source = sources.find((s) => s.display_id === id) ?? sources[0]
        if (!source) {
          log('Capture : aucun écran disponible.')
          return callback(null)
        }
        log(`Capture de l’écran ${source.display_id || source.id} (son du système : ${request.audioRequested ? 'demandé' : 'non'}).`)
        callback({ video: source, ...(request.audioRequested ? { audio: 'loopback' as const } : {}) })
      })
      .catch((e) => {
        log(`Capture : liste des écrans illisible : ${errText(e)}`)
        callback(null)
      })
  })
  captureSession = ses
  return ses
}

function openWindow(c: Capture): void {
  const w = new BrowserWindow({
    show: false,
    width: 640,
    height: 360,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    title: 'Player X · capture',
    webPreferences: {
      preload: join(__dirname, '../preload/clipsRecorder.js'),
      session: ensureSession(),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      devTools: !app.isPackaged
    }
  })
  // Hors de la liste des fenêtres de l'appli (mainWindow, envois) ; et aucun canal clips:* ne lui répond (ipc.ts).
  markOverlay(w)
  c.win = w
  c.ready = false
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // Avertissements de MediaRecorder (changement de taille, encodeur) : au journal, pas plus de 30 par fenêtre.
  let consoleLines = 0
  w.webContents.on('console-message', (e) => {
    if ((e.level === 'warning' || e.level === 'error') && consoleLines++ < 30) log(`Console : ${e.message.slice(0, 300)}`)
  })
  w.webContents.on('render-process-gone', (_e, details) => {
    log(`Page de capture plantée : ${details.reason}.`)
    if (!w.isDestroyed()) w.destroy()
  })
  w.on('closed', () => {
    if (c.win !== w) return
    c.win = null
    c.ready = false
    if (capture !== c || c.stopping) return
    if (c.rec) recorderLost(c.rec, 'fenêtre de capture fermée')
    else scheduleRestart(c, 'fenêtre de capture fermée')
  })
  void w.loadFile(join(__dirname, `../renderer/${PAGE_NAME}`))
}

function send(c: Capture, command: Record<string, unknown>): void {
  const win = c.win
  if (win && !win.isDestroyed()) win.webContents.send('clips-rec:command', command)
}

/** Essais en développement seulement : PX_CLIP_TEST_SOURCE=1 (ou 640x360), un canvas et un oscillateur à la place de l'écran. */
function testSource(): { width: number; height: number } | null {
  const v = app.isPackaged ? undefined : process.env.PX_CLIP_TEST_SOURCE
  if (!v) return null
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(v)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1280, height: 720 }
}

/** Essais en développement seulement : PX_CLIP_TEST_MIME impose un format d'enregistrement. */
const testMime = (): string | null => (app.isPackaged ? null : process.env.PX_CLIP_TEST_MIME || null)

/** Démarre un nouvel enregistreur (le tampon de l'ancien reste). */
function launchRecorder(c: Capture): void {
  clearTimeout(c.restartTimer)
  c.restartTimer = undefined
  if (capture !== c || c.stopping || c.rec) return
  if (!c.win) return openWindow(c)
  if (!c.ready) return
  // Le moteur vidéo se vérifie au début de la partie (decideEngine) : la page attend de savoir si elle filme l'image.
  if (c.engMode === undefined) return
  const audioOnly = c.engMode === true
  // Le moteur filme l'image et aucun son n'est voulu : la page n'enregistre rien.
  if (audioOnly && !current.gameAudio && !current.mic) return
  const id = `r${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
  const now = Date.now()
  const rec: Recorder = {
    id,
    dir: join(bufferRoot(), id),
    splitter: new Fmp4Splitter(),
    init: null,
    anchor: now,
    startedAt: now,
    lastDataAt: now,
    wantedFps: QUALITY[current.quality].fps,
    seq: 0,
    queued: 0,
    writes: mkdir(join(bufferRoot(), id), { recursive: true }).then(
      () => {},
      (e) => log(`Tampon inaccessible : ${errText(e)}`)
    ),
    ended: false,
    restartNow: false,
    ...(audioOnly ? { audioOnly: true, pcm: [] } : {})
  }
  recorders.set(id, rec)
  c.rec = rec
  send(c, { type: 'start', recId: id, quality: QUALITY[current.quality], gameAudio: current.gameAudio, mic: current.mic, mimeFrom: c.mimeFrom, test: testSource(), testMime: audioOnly ? null : testMime(), audioOnly })
  log(`Enregistreur ${id} demandé (${audioOnly ? 'son seulement, image par le moteur' : current.quality}, son du jeu : ${current.gameAudio ? 'oui' : 'non'}, micro : ${current.mic ? 'oui' : 'non'}).`)
  syncHotkey()
  emitState()
}

function scheduleRestart(c: Capture, reason: string, quick = false): void {
  if (capture !== c || c.stopping || c.restartTimer) return
  const fast = quick && Date.now() - c.quickAt > 10_000
  if (fast) c.quickAt = Date.now()
  const delay = fast ? 300 : restartDelayMs(c.attempts++)
  c.failure = `Capture interrompue (${reason}) : nouvel essai dans ${Math.max(1, Math.round(delay / 1000))} s.`
  log(c.failure)
  c.restartTimer = setTimeout(() => launchRecorder(c), delay)
  syncHotkey()
  emitState()
}

/** L'enregistreur vient de s'arrêter tout seul : ses fragments restent, un nouveau repart après un délai. */
function recorderLost(rec: Recorder, reason: string, quick = false): void {
  rec.ended = true
  const c = capture
  if (!c || c.rec !== rec) return
  if (Date.now() - rec.startedAt > HEALTHY_MS && rec.seq > 0) c.attempts = 0
  // Démarré sans jamais rien produire (encodeur matériel muet, par exemple) : le format suivant au prochain essai.
  if (rec.mimeIndex !== undefined) c.mimeFrom = rec.init ? rec.mimeIndex : rec.mimeIndex + 1
  c.rec = null
  scheduleRestart(c, reason, quick)
}

// ---------- l'image par le moteur vidéo (bêta 42) ----------

/** Temps 0 posé en avance : storeFragment le recale sur les premiers fragments reçus (le flux ne peut pas devancer l'horloge). */
const ENGINE_LATE_MS = 3_000
/** Relances d'une même manière après une coupure, avant de passer à la suivante. */
const ENGINE_MAX_RESTARTS = 5
/** La fenêtre du jeu peut n'apparaître qu'après le lancement : on la réessaie pendant ce temps avant de filmer l'écran. */
const ENGINE_WINDOW_WAIT_MS = 90_000
/** Sans aucune image pendant ce temps (jeu en pause, fenêtre réduite), le moteur est relancé. */
const ENGINE_STALL_MS = 60_000
const ENGINE_GOOD_KEY = 'clipsEngineGood'
/** Un morceau de son de la page : 4096 instants (16 Ko) d'habitude ; au-delà de 1 Mo, refusé. */
const MAX_PCM_PART_BYTES = 1024 * 1024
/** Assemblage image + son d'un clip par le moteur : quelques secondes d'habitude. */
const MUX_TIMEOUT_MS = 120_000
let lastPcmPrune = 0

/** Essais sous Linux seulement (développement) : l'écran X11 et libx264 à la place des captures de Windows. */
function engineDevAttempts(): EngineAttempt[] | null {
  if (app.isPackaged || process.env.PX_ENGINE_SOURCE !== 'x11') return null
  const d = screen.getPrimaryDisplay().size
  return [{ method: { id: 'x11', label: 'écran (essai Linux)', display: process.env.DISPLAY || ':0', width: d.width, height: d.height }, encoder: 'libx264', mode: 'copie' }]
}

const mannerOf = (a: EngineAttempt): string => `${a.encoder}/${a.mode}`

/** Au début de la partie : le moteur filme-t-il l'image ? Puis il démarre, et la page avec lui (son seulement). */
async function decideEngine(c: Capture): Promise<void> {
  const dev = engineDevAttempts()
  let on = current.capture === 'engine' && (!!dev || (!testSource() && process.platform === 'win32'))
  if (on) on = await captureEngineReady().catch(() => false)
  if (capture !== c || c.stopping) return
  c.engMode = on
  if (on) {
    const monitor = Math.max(0, screen.getAllDisplays().findIndex((d) => d.id === targetDisplayId()))
    const all = dev ?? engineAttempts(gameExeRegex(c.game, CS2_GAME_ID), monitor)
    // La manière qui a déjà marché sur ce PC passe en premier, sans changer l'ordre des méthodes.
    const good = getKv<string>(ENGINE_GOOD_KEY, '')
    const order = [...new Set(all.map((a) => a.method.id))]
    c.engAttempts = [...all].sort((a, b) => order.indexOf(a.method.id) - order.indexOf(b.method.id) || Number(mannerOf(b) === good) - Number(mannerOf(a) === good))
    c.engIdx = 0
    c.engRound = 0
    c.engStart = Date.now()
    startEngine(c)
  } else log(current.capture === 'engine' ? 'Moteur vidéo indisponible : image et son par Chrome.' : 'Capture par Chrome (réglage).')
  launchRecorder(c)
  emitState()
}

function startEngine(c: Capture): void {
  clearTimeout(c.engTimer)
  c.engTimer = undefined
  if (capture !== c || c.stopping || c.eng || !c.engMode) return
  const attempt = c.engAttempts[c.engIdx]
  if (!attempt) return engineGiveUp(c, 'aucune manière n’a marché')
  let args: string[]
  try {
    args = recordArgs(attempt, QUALITY[current.quality])
  } catch (e) {
    log(`Moteur : ${errText(e)}`)
    c.engIdx++
    return startEngine(c)
  }
  const proc = spawnCaptureEngine(args, app.getPath('temp'))
  if (!proc) return engineGiveUp(c, 'moteur impossible à lancer')
  const id = `e${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
  const now = Date.now()
  const rec: Recorder = {
    id,
    dir: join(bufferRoot(), id),
    splitter: new Fmp4Splitter(),
    init: null,
    anchor: now + ENGINE_LATE_MS,
    startedAt: now,
    lastDataAt: now,
    wantedFps: QUALITY[current.quality].fps,
    seq: 0,
    queued: 0,
    writes: mkdir(join(bufferRoot(), id), { recursive: true }).then(
      () => {},
      (e) => log(`Tampon inaccessible : ${errText(e)}`)
    ),
    ended: false,
    restartNow: false,
    mime: `moteur : ${attemptLabel(attempt)}`,
    engine: { proc, attempt, err: '', progress: '', loggedAt: now }
  }
  recorders.set(id, rec)
  c.eng = rec
  if (c.engRound === 0 || attempt.method.id !== 'fenetre') log(`Moteur : essai « ${attemptLabel(attempt)} ».`)
  proc.stdout?.on('data', (d: Buffer) => {
    if (rec.ended) return
    rec.lastDataAt = Date.now()
    try {
      onChunk(rec, d)
    } catch (err) {
      log(`Flux du moteur illisible : ${errText(err)}`)
      proc.kill()
    }
  })
  const e = rec.engine!
  proc.stderr?.setEncoding('utf8').on('data', (t: string) => {
    e.progress = (e.progress + t).slice(-4000)
    const msgs = t.split(/\r?\n/).filter((l) => l.trim() && !/^[a-z_0-9]+=/.test(l.trim()))
    if (msgs.length) e.err = (e.err + msgs.join('\n') + '\n').slice(-3000)
    // Les images par seconde, toutes les 10 s la première minute, puis chaque minute.
    const every = Date.now() - rec.startedAt < 65_000 ? 9_000 : 59_000
    if (/progress=/.test(t) && Date.now() - e.loggedAt > every) {
      const pr = readEngineProgress(e.progress)
      if (pr) {
        // Bêta 46 : le chiffre du moteur est une moyenne depuis le début ; le rythme depuis le relevé d'avant dit ce qui se passe
        // maintenant. Pour le journal seulement : une pause du jeu le fait baisser sans que la capture soit en faute.
        const now = { frames: pr.frames, at: Date.now() }
        const rate = rateBetween(e.last, now)
        log(`Moteur : ${pr.fps} images/s (${pr.frames} images depuis le début${rate === null ? '' : `, ${String(rate).replace('.', ',')} images/s depuis le dernier relevé`}).`)
        e.last = now
      }
      e.loggedAt = Date.now()
      e.progress = ''
    }
  })
  proc.once('error', (err) => {
    e.err += `${err.message}\n`
  })
  proc.once('close', (code) => engineExited(c, rec, code))
  emitState()
}

/** Le premier en-tête du moteur : la capture marche, cette manière passera en premier la prochaine fois. */
function engineReady(rec: Recorder): void {
  const c = capture
  if (!c || c.eng !== rec || !rec.engine) return
  log(`Moteur : capture par ${attemptLabel(rec.engine.attempt)}.`)
  setKv(ENGINE_GOOD_KEY, mannerOf(rec.engine.attempt))
  c.failure = undefined
  emitState()
}

function engineErrLines(rec: Recorder): string[] {
  const lines = (rec.engine?.err ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/ @ [0-9a-f]{8,}/gi, '').trim())
    .filter((l) => l && !/Terminating thread|Task finished/.test(l))
  return [...new Set(lines)].slice(-6).map((l) => l.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/"':\r\n]+/gi, '$1…').slice(0, 300))
}

function engineExited(c: Capture, rec: Recorder, code: number | null): void {
  rec.ended = true
  const done = rec.onEnded
  rec.onEnded = undefined
  done?.()
  if (capture !== c || c.eng !== rec) return
  c.eng = null
  if (c.stopping) return
  const attempt = rec.engine!.attempt
  if (rec.restartNow) {
    startEngine(c)
    return
  }
  if (!rec.init) {
    // Raté avant la première image : la manière suivante, tout de suite.
    if (c.engRound === 0 || attempt.method.id !== 'fenetre') {
      log(`Moteur : « ${attemptLabel(attempt)} » raté (code ${code}).`)
      for (const l of engineErrLines(rec)) log(`  ${l}`)
    }
    c.engIdx++
    const next = c.engAttempts[c.engIdx]
    // Toutes les manières de la fenêtre du jeu ont raté au début de la partie : la fenêtre n'existe peut-être pas encore.
    if (attempt.method.id === 'fenetre' && next?.method.id !== 'fenetre' && Date.now() - c.engStart < ENGINE_WINDOW_WAIT_MS) {
      if (c.engRound === 0) log('Moteur : la fenêtre du jeu n’est pas encore là, nouvel essai dans 5 s.')
      c.engRound++
      c.engIdx = 0
      c.engTimer = setTimeout(() => startEngine(c), 5_000)
      emitState()
      return
    }
    if (!next) return engineGiveUp(c, 'aucune manière n’a marché')
    startEngine(c)
    return
  }
  // Coupé en route (fenêtre fermée, pilote, jeu en pause trop longtemps) : la même manière, puis la suivante.
  const healthy = Date.now() - rec.startedAt > 60_000
  c.engRestarts = healthy ? 1 : c.engRestarts + 1
  log(`Moteur arrêté (code ${code}) après ${Math.round((Date.now() - rec.startedAt) / 1000)} s.`)
  for (const l of engineErrLines(rec)) log(`  ${l}`)
  if (c.engRestarts > ENGINE_MAX_RESTARTS) {
    c.engIdx++
    c.engRestarts = 0
    if (!c.engAttempts[c.engIdx]) return engineGiveUp(c, 'coupures répétées')
  }
  c.engTimer = setTimeout(() => startEngine(c), 1_000)
  emitState()
}

/** Le moteur ne marche pas ici : image et son repassent par Chrome pour le reste de la partie. */
function engineGiveUp(c: Capture, why: string): void {
  log(`Moteur abandonné pour cette partie (${why}) : image et son par Chrome.`)
  c.engMode = false
  clearTimeout(c.engTimer)
  c.engTimer = undefined
  const r = c.rec
  if (r && !r.ended) {
    r.restartNow = true
    send(c, { type: 'stop', recId: r.id })
  } else launchRecorder(c)
  emitState()
}

/** Une vignette tirée du clip écrit (la page, en son seulement, n'a pas l'image du jeu). */
function engineThumb(id: string, file: string, atS: number): void {
  void mkdir(dirname(thumbPath(id)), { recursive: true }).then(() => {
    const p = spawnCaptureEngine(thumbArgs(file, thumbPath(id), atS), app.getPath('temp'))
    if (!p) return
    p.stdout?.resume()
    p.stderr?.resume()
    p.once('close', (code) => {
      if (code === 0 && existsSync(thumbPath(id))) emitChanged()
      else log(`Vignette ${id} : le moteur n’a pas pu la tirer (code ${code}).`)
    })
  })
}

// ---------- flux reçu de la page ----------

function storeFragment(rec: Recorder, data: Buffer, info: FragmentInfo): void {
  const seq = rec.seq++
  const file = join(rec.dir, `${String(seq).padStart(6, '0')}.m4s`)
  // Le fragment vient de finir : le flux ne peut pas être en avance sur l'horloge. S'il l'est, le temps 0 était plus tôt.
  const lag = Date.now() - (rec.anchor + info.endS * 1000)
  if (lag < 0) rec.anchor += lag
  const startWall = rec.anchor + info.startS * 1000
  const endWall = rec.anchor + info.endS * 1000
  rec.queued += data.length
  if (rec.queued > MAX_QUEUED_BYTES) {
    log('Le disque ne suit pas : enregistreur arrêté.')
    if (capture?.rec === rec) {
      send(capture, { type: 'abort', recId: rec.id, reason: 'disque trop lent' })
      recorderLost(rec, 'disque trop lent')
    }
    return
  }
  rec.writes = rec.writes
    .then(async () => {
      await writeFile(file, data)
      rec.queued -= data.length
      frags.push({ recId: rec.id, startWall, endWall, key: info.key, file, info })
      pruneBuffer()
      emitState()
    })
    .catch((e) => {
      rec.queued -= data.length
      log(`Écriture du tampon impossible : ${errText(e)}`)
      if (capture?.rec === rec) {
        send(capture, { type: 'abort', recId: rec.id, reason: 'écriture impossible' })
        recorderLost(rec, 'écriture du tampon impossible')
      }
    })
}

function onChunk(rec: Recorder, chunk: Uint8Array): void {
  rec.lastDataAt = Date.now()
  for (const item of rec.splitter.push(chunk)) {
    if (item.kind === 'init') {
      rec.init = parseInit(item.data)
      log(`En-tête MP4 de ${rec.id} : ${rec.init.tracks.map((t) => (t.kind === 'video' ? `${t.codec} ${t.width}×${t.height}` : t.codec)).join(', ')}.`)
      if (rec.engine) engineReady(rec)
      continue
    }
    if (!rec.init) continue
    const info = parseFragment(item.data, rec.init)
    if (info.tracks.some((t) => t.samples.length)) storeFragment(rec, item.data, info)
  }
}

/** Retire les fragments qui ne servent plus à rien : ni à un événement à venir, ni à un clip en cours. */
function pruneBuffer(): void {
  const inUse = [...[...pendings.values()].map((p) => p.start), ...writing.values()]
  const from = keepFrom(Date.now(), current, inUse)
  // Le son en PCM : les morceaux finis avant le début utile.
  for (const r of recorders.values()) {
    if (!r.pcm?.length) continue
    let i = 0
    while (i < r.pcm.length && r.pcm[i].wall + (r.pcm[i].data.length / PCM_FRAME_BYTES / PCM_RATE) * 1000 < from) i++
    if (i) r.pcm.splice(0, i)
  }
  const gone = frags.filter((f) => f.endWall < from)
  if (!gone.length) return
  frags = frags.filter((f) => f.endWall >= from)
  for (const f of gone) void unlink(f.file).catch(() => {})
  dropEmptyRecorders()
}

function dropEmptyRecorders(): void {
  for (const [id, rec] of recorders) {
    if (capture?.rec === rec || capture?.eng === rec || rec.pcm?.length || frags.some((f) => f.recId === id)) continue
    recorders.delete(id)
    void rm(rec.dir, { recursive: true, force: true }).catch(() => {})
  }
}

// ---------- événements ----------

function currentGame(gameId?: string): RunningGame | null {
  if (!capture) return null
  if (!gameId || capture.game.id === gameId) return capture.game
  return [...libraryRunning, ...testRunning].find((g) => g.id === gameId) ?? (gameId === CS2_GAME_ID ? { id: CS2_GAME_ID, name: 'Counter-Strike 2' } : capture.game)
}

/** Un événement : il prolonge le clip en attente s'il arrive assez tôt, sinon il en ouvre un autre. */
function onMoment(m: ClipMoment, gameId?: string): boolean {
  const c = capture
  const game = currentGame(gameId)
  if (!c || !game || c.stopping || (!c.rec && !c.eng && !frags.length)) return false
  const w = { before: current.before, after: current.after, merge: current.merge }
  for (const p of pendings.values()) {
    if (canMerge(p, game.id, m, w)) {
      pendings.set(p.id, mergePending(p, m, w))
      log(`Clip ${p.id} prolongé : ${m.kind}.`)
      return true
    }
  }
  const id = randomBytes(8).toString('hex')
  pendings.set(id, openPending(id, { ...game, sessionId: c.sessionId }, m, w))
  log(`Clip ${id} ouvert : ${m.kind} (${game.name}).`)
  // Image par le moteur : la page n'a qu'une petite image, la vignette sera tirée du clip écrit.
  if (!c.engMode) requestThumb(id)
  ensureTick()
  pruneBuffer()
  return true
}

function requestThumb(id: string): void {
  const c = capture
  if (!c?.rec || !c.ready) return
  thumbAllowed.add(id)
  send(c, { type: 'thumb', id })
}

/** Le raccourci, ou le bouton : garde les `before` dernières secondes et les `after` suivantes. */
function saveNow(): boolean {
  const context = capture?.game.id === CS2_GAME_ID ? cs2MomentContext() : null
  return onMoment({ kind: 'manual', at: Date.now(), kills: 0, headshots: 0, ...(context ?? {}) })
}

function tick(): void {
  const now = Date.now()
  const rec = capture?.rec ?? null
  // L'image d'un clip : celle du moteur s'il filme, sinon celle de la page.
  const video = capture?.eng ?? (rec && !rec.audioOnly ? rec : null)
  for (const p of [...pendings.values()]) {
    if (now < p.closeAt) continue
    const covered = !!video && frags.some((f) => f.recId === video.id && f.endWall >= p.end)
    if (covered || !video || now >= p.closeAt + GRACE_MS) finalize(p)
  }
  const eng = capture?.eng
  if (eng && !eng.ended && now - eng.lastDataAt > ENGINE_STALL_MS) {
    log('Moteur : plus aucune image depuis 60 s, relance.')
    eng.lastDataAt = now
    eng.engine?.proc.kill()
  }
  if (rec && !rec.ended && now - rec.lastDataAt > STALL_MS && capture) {
    send(capture, { type: 'abort', recId: rec.id, reason: 'plus de données' })
    recorderLost(rec, 'plus aucune image reçue')
  }
  if (!capture && !pendings.size && tickTimer) {
    clearInterval(tickTimer)
    tickTimer = undefined
  }
}

function ensureTick(): void {
  if (!tickTimer) tickTimer = setInterval(tick, TICK_MS)
}

// ---------- écriture d'un clip ----------

function serial<T>(job: () => Promise<T>): Promise<T> {
  fileBusy++
  const run = fileQueue.then(job, job)
  fileQueue = run.then(
    () => {
      fileBusy--
    },
    () => {
      fileBusy--
    }
  )
  return run
}

function finalize(p: PendingClip): void {
  pendings.delete(p.id)
  writing.set(p.id, p.start)
  void serial(() => writeClip(p))
    .catch((e) => {
      lastProblem = 'Un clip n’a pas pu être écrit : voir le journal.'
      log(`Clip ${p.id} impossible : ${errText(e)}`)
      void unlink(thumbPath(p.id)).catch(() => {})
      emitState()
    })
    .finally(() => {
      writing.delete(p.id)
      pruneBuffer()
    })
}

async function writeAll(fh: FileHandle, buf: Buffer, length: number): Promise<void> {
  let done = 0
  while (done < length) done += (await fh.write(buf, done, length - done)).bytesWritten
}

/** En-tête, puis données recopiées depuis leurs sources (fragments du tampon, ou l'ancien fichier pour une découpe). */
async function writePlan(plan: FlatPlan, sources: string[], out: string): Promise<void> {
  const fh = await open(out, 'w')
  let srcFile: FileHandle | null = null
  let srcIndex = -1
  const block = Buffer.allocUnsafe(1024 * 1024)
  try {
    await writeAll(fh, plan.head, plan.head.length)
    for (const r of plan.ranges) {
      if (r.src !== srcIndex) {
        await srcFile?.close()
        srcFile = await open(sources[r.src], 'r')
        srcIndex = r.src
      }
      let pos = r.pos
      let left = r.size
      while (left > 0) {
        const { bytesRead } = await srcFile!.read(block, 0, Math.min(left, block.length), pos)
        if (!bytesRead) throw new Error('source du clip plus courte que prévu')
        await writeAll(fh, block, bytesRead)
        pos += bytesRead
        left -= bytesRead
      }
    }
  } finally {
    await srcFile?.close().catch(() => {})
    await fh.close().catch(() => {})
  }
}

function freeName(folder: string, base: string): string {
  let file = join(folder, `${base}.mp4`)
  for (let n = 2; existsSync(file) || existsSync(`${file}.part`); n++) file = join(folder, `${base} (${n}).mp4`)
  return file
}

/** Le dossier des réglages, sinon celui par défaut (clé USB retirée, droits). */
async function usableFolder(): Promise<string> {
  const wanted_ = folderOf(current)
  try {
    await mkdir(wanted_, { recursive: true })
    return wanted_
  } catch (e) {
    log(`Dossier ${wanted_} inutilisable : ${errText(e)}`)
    const fallback = defaultFolder()
    await mkdir(fallback, { recursive: true })
    return fallback
  }
}

/**
 * Bêta 42 : le son d'un clip filmé par le moteur, en PCM, pris dans l'enregistreur « son seulement » qui couvre le mieux
 * [fromWall ; fromWall + durS]. null : rien pour cette fenêtre.
 */
function pcmForWindow(fromWall: number, durS: number): { pcm: Buffer; covered: number } | null {
  const toWall = fromWall + durS * 1000
  let best: { pcm: Buffer; covered: number } | null = null
  for (const r of recorders.values()) {
    if (!r.pcm?.length) continue
    const parts = r.pcm.filter((x) => x.wall < toWall && x.wall + (x.data.length / PCM_FRAME_BYTES / PCM_RATE) * 1000 > fromWall)
    if (!parts.length) continue
    const w = pcmWindow(parts, fromWall, durS)
    if (!best || w.covered > best.covered) best = w
  }
  return best && best.covered >= 0.02 ? best : null
}

/** Une commande courte du moteur (assemblage d'un clip) : code de sortie et dernières lignes d'erreur. */
function engineOnce(args: string[], timeoutMs: number): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve) => {
    const proc = spawnCaptureEngine(args, app.getPath('temp'))
    if (!proc) return resolve({ code: null, err: 'moteur impossible à lancer' })
    let err = ''
    proc.stdout?.resume()
    proc.stderr?.setEncoding('utf8').on('data', (t: string) => {
      err = (err + t).slice(-2000)
    })
    const timer = setTimeout(() => {
      err += 'trop long\n'
      proc.kill()
    }, timeoutMs)
    proc.once('error', (e) => {
      err += `${e.message}\n`
    })
    proc.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, err })
    })
  })
}

/**
 * Clip filmé par le moteur : l'image (copiée du tampon) et le son en PCM, assemblés par le moteur (son encodé en AAC). Sans
 * son pour ce moment, ou si l'assemblage rate, le clip garde l'image seule. Rend la taille du fichier écrit.
 */
async function writeEngineClip(p: PendingClip, plan: FlatPlan, sources: string[], firstWall: number, out: string): Promise<number> {
  const audio = current.gameAudio || current.mic ? pcmForWindow(firstWall, plan.durationS) : null
  if (!audio) {
    if (current.gameAudio || current.mic) log(`Clip ${p.id} : pas de son dans le tampon pour ce moment, clip sans son.`)
    await writePlan(plan, sources, out)
    return plan.size
  }
  if (audio.covered < 0.95) log(`Clip ${p.id} : son reçu sur ${Math.round(audio.covered * 100)} % du clip, silence ailleurs.`)
  const base = join(app.getPath('temp'), `player-x-clip-${p.id}`)
  const video = `${base}.mp4`
  const pcm = `${base}.pcm`
  try {
    await writePlan(plan, sources, video)
    await writeFile(pcm, audio.pcm)
    const r = await engineOnce(muxArgs(video, pcm, out, QUALITY[current.quality].audioBps), MUX_TIMEOUT_MS)
    if (r.code === 0 && existsSync(out)) return (await stat(out)).size
    log(`Clip ${p.id} : assemblage du son raté (code ${r.code}), clip sans son.`)
    for (const l of r.err.split(/\r?\n/).filter((x) => x.trim()).slice(-4)) log(`  ${l.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/"':\r\n]+/gi, '$1…').slice(0, 300)}`)
    await writePlan(plan, sources, out)
    return plan.size
  } finally {
    await unlink(video).catch(() => {})
    await unlink(pcm).catch(() => {})
  }
}

/** Bêta 46 : le rythme réel d'un clip (clipPace.ts), d'après les images de sa piste vidéo. undefined : pas assez d'images pour le dire. */
function paceOfTracks(tracks: ClipTrack[], durationS: number, wantedFps: number): ClipPace | undefined {
  const video = tracks.find((t) => t.kind === 'video' && t.samples.length)
  return (video && paceOf(video.samples.map((s) => (s.dts + s.cto) / video.timescale), durationS, wantedFps)) || undefined
}

async function writeClip(p: PendingClip): Promise<void> {
  // L'image : un enregistreur qui en a (le moteur, ou la page quand elle filme tout), jamais celui du son seul.
  const vfrags = frags.filter((f) => !recorders.get(f.recId)?.audioOnly)
  const recId = pickRecorder(vfrags, p.start, p.end, p.lastAt)
  const rec = recId ? recorders.get(recId) : undefined
  if (!recId || !rec?.init) throw new Error('rien dans le tampon pour cette fenêtre')
  const mine = vfrags.filter((f) => f.recId === recId)
  const list = withNeighbours(mine, selectFragments(mine, p.start, p.end))
  if (!list.length) throw new Error('aucune image clé dans la fenêtre')
  const tracks = collectTracks(rec.init, list.map((f) => f.info))
  const cut = cutTracks(tracks, (p.start - rec.anchor) / 1000, (p.end - rec.anchor) / 1000)
  if (!cut) throw new Error('fenêtre sans vidéo')
  const sources = list.map((f) => f.file)
  const plan = buildFlat(cut, { createdAtMs: p.firstAt })
  // Le fichier commence sur une image clé, souvent avant la fenêtre demandée : les événements se situent depuis cette image-là.
  const firstWall = rec.anchor + firstFrameS(cut) * 1000
  // Bêta 46 : le rythme réel du clip, d'après l'instant de chacune de ses images.
  const pace = paceOfTracks(cut, plan.durationS, rec.wantedFps)
  const events = clipEvents(p.events, firstWall, plan.durationS)
  const kills = clipKills(p)
  const title = clipTitle(p.kind, kills, p.headshots, p.peak)
  const folder = await usableFolder()
  const file = freeName(folder, clipBaseName(p.gameName, p.firstAt, title))
  const part = `${file}.part`
  let size = plan.size
  try {
    // Image du moteur : le son de la page y est ajouté (writeEngineClip).
    if (rec.engine) size = await writeEngineClip(p, plan, sources, firstWall, part)
    else await writePlan(plan, sources, part)
    await rename(part, file)
  } catch (e) {
    await unlink(part).catch(() => {})
    throw e
  }
  const meta: ClipMeta = {
    id: p.id,
    gameId: p.gameId,
    gameName: p.gameName,
    kind: p.kind,
    title,
    kills,
    headshots: p.headshots,
    at: p.firstAt,
    events,
    durationS: plan.durationS,
    sizeBytes: size,
    width: plan.width,
    height: plan.height,
    pinned: false,
    ...(p.map ? { map: p.map } : {}),
    ...(p.mode ? { mode: p.mode } : {}),
    ...(p.round !== undefined ? { round: p.round } : {}),
    ...(p.score ? { score: p.score } : {}),
    sessionId: p.sessionId,
    ...(pace ? { pace } : {}),
    file
  }
  index = [meta, ...index]
  saveIndex()
  log(`Clip ${p.id} écrit : « ${title} », ${plan.durationS.toFixed(1)} s, ${(size / 1e6).toFixed(1)} Mo, ${kills} élim., ${p.headshots} HS, ${paceLog(pace)}.`)
  lastProblem = undefined
  await applyRetention(p.id)
  // Image du moteur : la vignette vient du clip (vers le moment gardé, avant les secondes « après »).
  if (rec.engine) engineThumb(p.id, file, Math.max(0, plan.durationS - current.after - 0.5))
  else if (!existsSync(thumbPath(p.id))) requestThumb(p.id)
  emitChanged()
  emitState()
}

function saveIndex(): void {
  setKv(INDEX_KEY, index)
}

async function deleteFiles(meta: ClipMeta): Promise<void> {
  // Sous Windows, le fichier peut être encore ouvert un instant par la lecture dans l'interface.
  for (let i = 0; i < 5; i++) {
    try {
      await unlink(meta.file)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') break
      if (i === 4) log(`Suppression de ${meta.id} : ${errText(e)}`)
      else await sleep(200)
    }
  }
  await unlink(thumbPath(meta.id)).catch(() => {})
  // Bêta 46 : ses copies légères pour Discord partent avec lui.
  await dropShareCopies(meta.id).catch(() => {})
}

/** Au-delà de la limite : les plus vieux non épinglés partent. Le clip qui vient d'arriver reste. */
async function applyRetention(keepId?: string): Promise<void> {
  const ids = clipsToPurge(index, current.limitGb * 1024 ** 3, keepId)
  if (!ids.length) return
  const gone = index.filter((c) => ids.includes(c.id))
  index = index.filter((c) => !ids.includes(c.id))
  saveIndex()
  for (const c of gone) await deleteFiles(c)
  log(`Limite de ${current.limitGb} Go : ${gone.length} ancien(s) clip(s) supprimé(s).`)
  emitChanged()
}

// ---------- liste et actions ----------

function publicClip({ file: _file, pace: rawPace, ...meta }: ClipMeta): Clip {
  // Le rythme est relu de la base : sa structure est vérifiée avant de partir vers la page.
  const pace = cleanPace(rawPace)
  return { ...meta, ...(pace ? { pace } : {}), videoUrl: `${SCHEME}://video/${meta.id}`, thumbUrl: `${SCHEME}://thumb/${meta.id}` }
}

function clipById(id: unknown): ClipMeta | undefined {
  return typeof id === 'string' && CLIP_ID.test(id) ? index.find((c) => c.id === id) : undefined
}

function needClip(id: unknown): ClipMeta {
  const c = clipById(id)
  if (!c) throw new Error('Clip inconnu.')
  return c
}

/** Fichier disparu : retiré. Dossier entier absent (disque débranché) : gardé mais pas listé, il reviendra avec le disque. */
async function listClips(): Promise<Clip[]> {
  const shown: ClipMeta[] = []
  const gone: string[] = []
  const isDir = (p: string): Promise<boolean> => stat(p).then((s) => s.isDirectory(), () => false)
  await Promise.all(
    index.map(async (c) => {
      if (await stat(c.file).then((s) => s.isFile(), () => false)) shown.push(c)
      // Un film est dans le sous-dossier Films : ce sous-dossier supprimé à la main, le film a disparu lui aussi.
      else if ((await isDir(dirname(c.file))) || (c.kind === 'film' && (await isDir(dirname(dirname(c.file)))))) gone.push(c.id)
    })
  )
  if (gone.length) {
    index = index.filter((c) => !gone.includes(c.id))
    for (const id of gone) void unlink(thumbPath(id)).catch(() => {})
    saveIndex()
    log(`${gone.length} clip(s) retiré(s) de la liste : fichier disparu.`)
  }
  return shown.sort((a, b) => b.at - a.at).map(publicClip)
}

// ---------- pour le moteur vidéo (services/editFfmpeg.ts) : lecture seule, rien ne change dans les clips ----------

/** Vrai tant qu'un jeu tourne, filmé ou non : le moteur vidéo attend la fin de la partie pour ses essais. */
export function gameRunning(): boolean {
  return capture !== null || libraryRunning.length > 0 || cs2IsRunning()
}

// ---------- pour la fabrication des films (services/editFilm.ts) ----------

const FILMS_DIR = 'Films'

/** Un clip tel que la fabrication d'un film en a besoin : sa fiche, son fichier, et s'il a du son. Ne quitte pas le processus principal. */
export type FilmSource = Pick<ClipMeta, 'id' | 'gameId' | 'gameName' | 'kind' | 'at' | 'kills' | 'durationS' | 'events' | 'map' | 'mode' | 'sessionId' | 'file'> & { hasAudio: boolean }

/**
 * Les clips demandés qui peuvent entrer dans un film : connus, pas eux-mêmes des films, fichier présent et lisible, avec une
 * image. `skipped` compte les autres. La page n'envoie que des identifiants ; les fichiers sont relus ici (lecture seule).
 */
export async function filmSources(ids: unknown): Promise<{ sources: FilmSource[]; skipped: number }> {
  const wantedIds = Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === 'string' && CLIP_ID.test(x)))].slice(0, 500) : []
  const sources: FilmSource[] = []
  let skipped = 0
  for (const id of wantedIds) {
    const c = clipById(id)
    if (!c || c.kind === 'film') {
      skipped++
      continue
    }
    try {
      const fh = await open(c.file, 'r')
      const tracks = parseFlat(await readMoov(fh).finally(() => fh.close()))
      if (!tracks.some((t) => t.kind === 'video' && t.samples.length)) throw new Error('pas d’image')
      const { id: cid, gameId, gameName, kind, at, kills, durationS, events, map, mode, sessionId, file } = c
      sources.push({ id: cid, gameId, gameName, kind, at, kills, durationS, events, map, mode, sessionId, file, hasAudio: tracks.some((t) => t.kind === 'audio' && t.samples.length > 0) })
    } catch (e) {
      skipped++
      log(`Film : clip ${id} laissé de côté : ${errText(e)}`)
    }
  }
  return { sources, skipped }
}

/**
 * Le clip le plus récent qui peut entrer dans un film (pas un film, fichier présent et lisible), pour l'essai du moteur :
 * il passe par le même chemin qu'un film. Son chemin ne quitte pas le processus principal.
 */
export async function newestClipSource(): Promise<(FilmSource & { width: number; height: number }) | null> {
  for (const c of [...index].sort((a, b) => b.at - a.at)) {
    if (c.kind === 'film') continue
    const { sources } = await filmSources([c.id])
    if (sources[0]) return { ...sources[0], width: c.width, height: c.height }
  }
  return null
}

/** Le réglage « après le moment » : là où tombe le dernier kill d'un clip qui ne note pas ses événements. */
export function clipAfterSetting(): number {
  return current.after
}

/** Où écrire un film : dans le sous-dossier Films du dossier des clips, d'abord en « .part », sous un nom libre. */
export async function filmTarget(gameName: string, title: string, at: number): Promise<{ file: string; part: string }> {
  const folder = join(await usableFolder(), FILMS_DIR)
  await mkdir(folder, { recursive: true })
  const file = freeName(folder, clipBaseName(gameName, at, safeFileName(title)))
  return { file, part: `${file}.part` }
}

/**
 * Range un film fini avec les clips : son fichier « .part » prend son nom, sa vignette est copiée, sa fiche entre dans la liste.
 * Un film ne compte pas dans la limite de place et ne part jamais tout seul (clipsToPurge).
 */
export function addFilm(f: { part: string; file: string; thumb?: string; title: string; gameId: string; gameName: string; at: number; shots: number; durationS: number; width: number; height: number; map?: string; mode?: string; sessionId: string }): Promise<Clip> {
  return serial(async () => {
    // Sous Windows, un antivirus peut tenir un instant le fichier que le moteur vient de fermer.
    for (let i = 0; ; i++) {
      try {
        await rename(f.part, f.file)
        break
      } catch (e) {
        if (i === 9 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e
        await sleep(300)
      }
    }
    const { size } = await stat(f.file)
    const id = randomBytes(8).toString('hex')
    if (f.thumb) {
      await mkdir(dirname(thumbPath(id)), { recursive: true })
        .then(() => copyOnDisk(f.thumb as string, thumbPath(id)))
        .catch((e) => log(`Vignette du film ${id} : ${errText(e)}`))
    }
    const meta: ClipMeta = {
      id,
      gameId: f.gameId,
      gameName: f.gameName,
      kind: 'film',
      title: cleanTitle(f.title) ?? 'Film',
      kills: 0,
      headshots: 0,
      at: f.at,
      shots: f.shots,
      durationS: f.durationS,
      sizeBytes: size,
      width: f.width,
      height: f.height,
      pinned: false,
      ...(f.map ? { map: f.map } : {}),
      ...(f.mode ? { mode: f.mode } : {}),
      sessionId: f.sessionId,
      file: f.file
    }
    index = [meta, ...index]
    saveIndex()
    log(`Film ${id} rangé : « ${meta.title} », ${f.shots} plan(s), ${f.durationS.toFixed(1)} s, ${(size / 1e6).toFixed(1)} Mo.`)
    emitChanged()
    return publicClip(meta)
  })
}

/** La boîte moov d'un clip : elle est devant les données. */
async function readMoov(fh: FileHandle): Promise<Buffer> {
  const { size } = await fh.stat()
  let pos = 0
  const head = Buffer.alloc(16)
  while (pos + 8 <= size) {
    await fh.read(head, 0, 16, pos)
    let boxSize = head.readUInt32BE(0)
    if (boxSize === 1) boxSize = Number(head.readBigUInt64BE(8))
    else if (boxSize === 0) boxSize = size - pos
    if (boxSize < 8 || pos + boxSize > size) throw new Error('fichier abîmé')
    if (head.toString('latin1', 4, 8) === 'moov') {
      const moov = Buffer.alloc(boxSize)
      await fh.read(moov, 0, boxSize, pos)
      readBoxes(moov)
      return moov
    }
    pos += boxSize
  }
  throw new Error('fichier sans index (moov)')
}

/** Une découpe devient un nouveau clip, juste au-dessus de l'original : rien n'est perdu si la coupe est ratée. */
function trimClip(id: unknown, startS: unknown, endS: unknown): Promise<Clip> {
  const meta = needClip(id)
  const from = typeof startS === 'number' && Number.isFinite(startS) ? Math.max(0, startS) : NaN
  const to = typeof endS === 'number' && Number.isFinite(endS) ? endS : NaN
  if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 0.5) throw new Error('Découpe invalide : choisis au moins une demi-seconde.')
  return serial(async () => {
    const c = needClip(meta.id)
    // La coupe sans réencodage connaît les fichiers de l'enregistreur, pas ceux du moteur vidéo.
    if (c.kind === 'film') throw new Error('Un film ne se coupe pas ici. Refais-le depuis ses clips.')
    const fh = await open(c.file, 'r').catch(() => {
      throw new Error('Le fichier de ce clip a disparu.')
    })
    const moov = await readMoov(fh).finally(() => fh.close())
    const cut = cutTracks(parseFlat(moov), from, to, 'nearest')
    if (!cut) throw new Error('Rien à garder dans cette découpe.')
    const plan = buildFlat(cut, { createdAtMs: c.at })
    // Sans réencodage, le début se cale sur une image clé, toutes les 2 s.
    if (plan.durationS > c.durationS - 0.1) throw new Error('Trop peu à couper : le début d’un clip se cale toutes les 2 secondes. Déplace la poignée un peu plus.')
    const newId = randomBytes(8).toString('hex')
    const title = cleanTitle(`${c.title.replace(/ \(coupé\)$/, '').slice(0, 70)} (coupé)`) ?? c.title
    const file = freeName(dirname(c.file), clipBaseName(c.gameName, c.at, safeFileName(title)))
    const part = `${file}.part`
    try {
      await writePlan(plan, [c.file], part)
      await rename(part, file)
    } catch (e) {
      await unlink(part).catch(() => {})
      throw e
    }
    // Les événements qui restent dans la partie gardée suivent, recalés sur la nouvelle première image.
    const events = trimEvents(c.events, firstFrameS(cut), plan.durationS)
    // Bêta 46 : la coupe a son propre rythme (celui de la partie gardée), jamais celui du clip entier.
    const { pace: wholePace, ...rest } = c
    const wantedFps = cleanPace(wholePace)?.wanted
    const pace = wantedFps ? paceOfTracks(cut, plan.durationS, wantedFps) : undefined
    const made: ClipMeta = { ...rest, id: newId, title, at: c.at + 1, durationS: plan.durationS, sizeBytes: plan.size, pinned: false, file, ...(events ? { events } : {}), ...(pace ? { pace } : {}) }
    await copyOnDisk(thumbPath(c.id), thumbPath(newId)).catch(() => {})
    index = [made, ...index]
    saveIndex()
    log(`Clip ${c.id} coupé dans ${newId} : ${from.toFixed(1)} à ${to.toFixed(1)} s, ${plan.durationS.toFixed(1)} s.`)
    await applyRetention(newId)
    emitChanged()
    return publicClip(made)
  })
}

function renameClip(id: unknown, name: unknown): Promise<Clip> {
  const meta = needClip(id)
  const title = cleanTitle(name)
  if (!title) throw new Error('Donne un nom à ce clip.')
  return serial(async () => {
    const c = needClip(meta.id)
    c.title = title
    const base = clipBaseName(c.gameName, c.at, safeFileName(title))
    if (join(dirname(c.file), `${base}.mp4`) !== c.file) {
      const target = freeName(dirname(c.file), base)
      // Fichier occupé : le titre change quand même, le nom du fichier reste.
      await rename(c.file, target).then(
        () => {
          c.file = target
        },
        (e) => log(`Fichier de ${c.id} non renommé : ${errText(e)}`)
      )
    }
    saveIndex()
    emitChanged()
    return publicClip(c)
  })
}

function deleteClip(id: unknown): Promise<boolean> {
  const meta = clipById(id)
  if (!meta) return Promise.resolve(false)
  return serial(async () => {
    index = index.filter((c) => c.id !== meta.id)
    saveIndex()
    await deleteFiles(meta)
    log(`Clip ${meta.id} supprimé.`)
    emitChanged()
    return true
  })
}

function pinClip(id: unknown, on: unknown): Clip {
  const c = needClip(id)
  c.pinned = on === true
  saveIndex()
  emitChanged()
  return publicClip(c)
}

async function openFolder(id: unknown): Promise<void> {
  if (id !== undefined && id !== null) return shell.showItemInFolder(needClip(id).file)
  const folder = await usableFolder()
  const err = await shell.openPath(folder)
  if (err) throw new Error('Impossible d’ouvrir le dossier des clips.')
}

/**
 * Presse-papiers de Windows : le fichier, à coller dans Discord ou l'Explorateur. Il faut un vrai CF_HDROP (c'est ce que lit
 * Chromium au collage) : Electron 44 n'a plus clipboard.writeBuffer et ne sait pas l'écrire, PowerShell si (Set-Clipboard
 * -LiteralPath, Windows PowerShell 5.1, livré avec Windows). Le chemin passe par une variable d'environnement, jamais dans la
 * commande. En secours, le format brut FileNameW suffit à l'Explorateur. Rien d'équivalent ailleurs que sous Windows.
 */
async function copyPath(file: string): Promise<boolean> {
  if (process.platform !== 'win32') {
    // Essais en développement seulement (PX_CLIP_TEST_COPY=1) : le fichier est noté au lieu d'aller dans le presse-papiers.
    if (app.isPackaged || process.env.PX_CLIP_TEST_COPY !== '1') return false
    testCopied = file
    return true
  }
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Sta', '-Command', 'Set-Clipboard -LiteralPath $env:PX_CLIP_FILE'],
        { windowsHide: true, timeout: 15_000, env: { ...process.env, PX_CLIP_FILE: file } },
        (err) => (err ? reject(err) : resolve())
      )
    })
    return true
  } catch (e) {
    log(`Copie du fichier par PowerShell impossible : ${errText(e)}`)
  }
  try {
    await clipboard.write([new ClipboardItem({ FileNameW: new Blob([Buffer.from(`${file}\0`, 'ucs2')]) })])
    return true
  } catch (e) {
    log(`Copie du fichier impossible : ${errText(e)}`)
    return false
  }
}

/** Développement : le dernier fichier « copié » hors de Windows (PX_CLIP_TEST_COPY=1), pour les essais. */
let testCopied: string | null = null

/** Le fichier d'origine dans le presse-papiers, quel que soit son poids. */
async function copyFile(id: unknown): Promise<boolean> {
  const c = clipById(id)
  return c ? copyPath(c.file) : false
}

// ---------- copier pour Discord (bêta 46) ----------

/**
 * La limite du compte Discord choisi dans les réglages. En développement seulement, PX_CLIP_TEST_SHARE_MB impose une limite
 * (en Mo, à virgule si besoin) : un petit clip d'essai peut alors demander une copie légère.
 */
function shareLimit(): { mb: number; bytes: number } {
  const dev = app.isPackaged ? Number.NaN : Number(process.env.PX_CLIP_TEST_SHARE_MB)
  const mb = dev > 0 && dev <= 500 ? dev : DISCORD_MB[current.discord]
  return { mb, bytes: Math.round(mb * 1_000_000) }
}

/** Ce que le fichier est vraiment (relu dans son index, pas dans sa fiche) : durée, taille de l'image, images par seconde, son. */
async function shareSource(file: string, sizeBytes: number): Promise<ShareSource> {
  const fh = await open(file, 'r')
  const tracks = parseFlat(await readMoov(fh).finally(() => fh.close()))
  const video = tracks.find((t) => t.kind === 'video' && t.samples.length)
  if (!video) throw new Error('pas d’image')
  const seconds = (t: ClipTrack): number => t.samples.reduce((n, x) => n + x.dur, 0) / t.timescale
  const videoS = seconds(video)
  const durationS = Math.max(videoS, ...tracks.filter((t) => t.kind === 'audio').map(seconds))
  return { sizeBytes, durationS, width: video.width, height: video.height, fps: videoS > 0 ? video.samples.length / videoS : 0, hasAudio: tracks.some((t) => t.kind === 'audio' && t.samples.length > 0) }
}

/**
 * « Copier pour Discord » : le fichier va dans le presse-papiers s'il passe sous la limite du compte ; sinon une copie plus
 * légère est fabriquée à côté (clipsShare.ts) et c'est elle qui est copiée. Le clip d'origine n'est jamais modifié. Un clip
 * trop long, ou une copie impossible, ne met rien dans le presse-papiers : la page le dit et propose l'original.
 */
async function shareClip(id: unknown): Promise<ClipShareResult> {
  const c = needClip(id)
  const { mb: limitMb, bytes: limit } = shareLimit()
  const st = await stat(c.file).catch(() => null)
  if (!st?.isFile()) throw new Error('Le fichier de ce clip a disparu.')
  if (st.size <= limit) return (await copyPath(c.file)) ? { status: 'copied', sizeBytes: st.size, limitMb } : { status: 'failed' }
  let src: ShareSource
  try {
    src = await shareSource(c.file, st.size)
  } catch (e) {
    log(`Copie pour Discord du clip ${c.id} impossible : fichier illisible (${errText(e)}).`)
    return { status: 'unmade', limitMb, sizeBytes: st.size, reason: 'encode' }
  }
  const step = (percent: number): void => broadcast('clips:share', { id: c.id, percent } satisfies ClipShareStep)
  const made = await lightCopy({ id: c.id, file: c.file, mtimeMs: st.mtimeMs }, src, limit, step)
  if (made.kind === 'too-long') {
    log(`Copie pour Discord du clip ${c.id} : ${src.durationS.toFixed(1)} s, trop long pour ${limitMb} Mo (au plus ${made.maxS} s).`)
    return { status: 'too-long', limitMb, maxS: made.maxS, sizeBytes: st.size }
  }
  if (made.kind === 'unmade') return { status: 'unmade', limitMb, sizeBytes: st.size, reason: made.reason }
  if (made.kind === 'original') return (await copyPath(c.file)) ? { status: 'copied', sizeBytes: st.size, limitMb } : { status: 'failed' }
  if (!(await copyPath(made.file))) return { status: 'failed' }
  return { status: 'copied', sizeBytes: made.sizeBytes, limitMb, reduced: { width: made.width, height: made.height, fps: made.fps } }
}

function displays(): ClipDisplay[] {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Écran ${i + 1}`,
    width: Math.round(d.bounds.width * d.scaleFactor),
    height: Math.round(d.bounds.height * d.scaleFactor),
    primary: d.id === primary
  }))
}

// ---------- réglages ----------

/** Raccourci d'un jeu seulement : pris pendant que le tampon tourne, rendu dès qu'il s'arrête. */
function syncHotkey(): void {
  const want = capture?.rec && !capture.stopping ? current.hotkey : null
  if (want === hotkeyNow) return
  if (hotkeyNow) globalShortcut.unregister(hotkeyNow)
  hotkeyNow = null
  hotkeyError = undefined
  if (!want) return
  try {
    const onKey = (): void => {
      const ok = saveNow()
      showClipToast(ok ? 'Clip gardé' : 'Rien à garder pour l’instant', ok, targetDisplayId())
    }
    if (globalShortcut.register(want, onKey)) {
      hotkeyNow = want
      return
    }
  } catch (e) {
    log(`Raccourci ${want} : ${errText(e)}`)
  }
  hotkeyError = `Le raccourci ${want} est déjà pris : choisis-en un autre.`
  log(hotkeyError)
}

function checkHotkey(accel: unknown): void {
  const refusal = hotkeyRefusal(accel, hotkeyNow, [getSettings().overlayHotkey])
  if (refusal) throw new Error(refusal)
}

function restartRecorder(reason: string): void {
  const c = capture
  if (!c || c.stopping) return
  // L'image du moteur repart elle aussi (qualité, écran filmé).
  const eng = c.eng
  if (eng && !eng.ended) {
    eng.restartNow = true
    eng.engine?.proc.kill()
  }
  const rec = c.rec
  if (!rec) {
    // Rien à arrêter côté page (moteur seul, sans son) : elle démarre si les nouveaux réglages veulent du son.
    launchRecorder(c)
    return
  }
  log(`Enregistreur relancé : ${reason}.`)
  rec.restartNow = true
  send(c, { type: 'stop', recId: rec.id })
}

function saveClipSettings(patch: unknown): ClipSettings {
  const before = current
  const p: Record<string, unknown> = patch && typeof patch === 'object' && !Array.isArray(patch) ? { ...(patch as Record<string, unknown>) } : {}
  // Le dossier vient de la fenêtre native (clipsChooseFolder) ; la page peut seulement revenir à celui par défaut.
  if (p.folder !== '') delete p.folder
  if ('hotkey' in p && p.hotkey !== before.hotkey) checkHotkey(p.hotkey)
  current = cleanClipSettings(p, before)
  setKv(SETTINGS_KEY, current)
  if (current.capture !== before.capture && capture && !stopping) {
    // Moteur ↔ Chrome : la capture repart de zéro avec l'autre méthode.
    // La partie continue : pas de bilan de rythme ici.
    stopping = stopCapture('méthode de capture changée', false)
      .catch((e) => log(`Arrêt de la capture : ${errText(e)}`))
      .finally(() => {
        stopping = null
        sync()
      })
  } else if (current.quality !== before.quality || current.mic !== before.mic || current.gameAudio !== before.gameAudio || current.display !== before.display) restartRecorder('réglages changés')
  syncHotkey()
  sync()
  if (current.limitGb < before.limitGb) void serial(() => applyRetention()).catch((e) => log(`Rétention : ${errText(e)}`))
  emitState()
  return resolved(current)
}

async function chooseFolder(): Promise<ClipSettings | null> {
  const parent = mainWindow()
  const options: Electron.OpenDialogOptions = { title: 'Dossier des clips', defaultPath: folderOf(current), properties: ['openDirectory', 'createDirectory'] }
  const res = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options))
  if (res.canceled || !res.filePaths[0]) return null
  current = { ...current, folder: res.filePaths[0] }
  setKv(SETTINGS_KEY, current)
  log('Dossier des clips changé.')
  return resolved(current)
}

// ---------- démarrage et arrêt de la capture ----------

function wanted(): RunningGame | null {
  if (!started || quitting || suspended || windowsGone || !current.enabled) return null
  const all = [...libraryRunning, ...testRunning]
  // CS2 vu par sa liaison (simulateur compris), même si la bibliothèque ne l'a pas encore en cours.
  if (cs2IsRunning() && !all.some((g) => g.id === CS2_GAME_ID)) all.push({ id: CS2_GAME_ID, name: 'Counter-Strike 2' })
  const list = current.games === 'all' ? all : all.filter((g) => g.id === CS2_GAME_ID || isBf6Name(g.name))
  return list.find((g) => g.id === CS2_GAME_ID) ?? list[0] ?? null
}

function startCapture(game: RunningGame): void {
  const c: Capture = { game, sessionId: `s${Date.now().toString(36)}`, win: null, ready: false, rec: null, attempts: 0, stopping: false, mimeFrom: 0, quickAt: 0, eng: null, engAttempts: [], engIdx: 0, engRestarts: 0, engStart: Date.now(), engRound: 0 }
  capture = c
  lastProblem = undefined
  log(`Jeu lancé : ${game.name}. Capture démarrée (encodage vidéo par la carte graphique selon Chromium : ${app.getGPUFeatureStatus().video_encode} ; fonctions : ${app.commandLine.getSwitchValue('enable-features') || 'aucune'}).`)
  ensureTick()
  openWindow(c)
  void decideEngine(c).catch((e) => {
    log(`Moteur : ${errText(e)}`)
    if (capture === c && c.engMode === undefined) {
      c.engMode = false
      launchRecorder(c)
    }
  })
  emitState()
}

/** Arrêt propre : le dernier fragment arrive, les clips en attente s'écrivent avec ce qu'il y a, le tampon est vidé. */
async function stopCapture(reason: string, gameOver = true): Promise<void> {
  const c = capture
  if (!c) return
  c.stopping = true
  clearTimeout(c.restartTimer)
  c.restartTimer = undefined
  syncHotkey()
  log(`Capture arrêtée : ${reason}.`)
  clearTimeout(c.engTimer)
  c.engTimer = undefined
  const eng = c.eng
  if (eng && !eng.ended) {
    await Promise.race([
      new Promise<void>((resolve) => {
        eng.onEnded = resolve
        eng.engine?.proc.kill()
      }),
      sleep(STOP_WAIT_MS)
    ])
  }
  c.eng = null
  if (eng) eng.ended = true
  const rec = c.rec
  if (rec && !rec.ended && c.ready) {
    await Promise.race([
      new Promise<void>((resolve) => {
        rec.onEnded = resolve
        send(c, { type: 'stop', recId: rec.id })
      }),
      sleep(STOP_WAIT_MS)
    ])
  }
  c.rec = null
  if (rec) rec.ended = true
  const win = c.win
  c.win = null
  if (win && !win.isDestroyed()) win.destroy()
  capture = null
  emitState()
  await Promise.all([...recorders.values()].map((r) => r.writes.catch(() => {})))
  for (const p of [...pendings.values()]) finalize(p)
  await fileQueue
  await clearBuffer()
  if (gameOver) noteGamePace(c)
}

/**
 * Bêta 46 : la partie est finie et ses derniers clips sont écrits. Le rythme de ses clips est gardé pour Paramètres, et la
 * page le dit une fois si des clips sont sous le seuil (jamais pendant la partie : rien ne s'affiche avant cet instant).
 */
function noteGamePace(c: Capture): void {
  try {
    lastGame = gamePace(index.filter((x) => x.sessionId === c.sessionId && x.kind !== 'film').map((x) => ({ pace: cleanPace(x.pace), durationS: x.durationS })), c.game.name, Date.now())
    setKv(LAST_GAME_KEY, lastGame)
    log(lastGame.clips ? `${gamePaceLine(lastGame)} (${String(lastGame.fps).replace('.', ',')} images/s sur ${lastGame.clips} clip(s), ${c.game.name}).` : `Partie finie sans clip dont le rythme est connu (${c.game.name}).`)
    emitState()
  } catch (e) {
    log(`Rythme de la partie : ${errText(e)}`)
  }
}

async function clearBuffer(): Promise<void> {
  frags = []
  recorders.clear()
  await rm(bufferRoot(), { recursive: true, force: true }).catch((e) => log(`Tampon non vidé : ${errText(e)}`))
}

/** Remet la capture d'accord avec les jeux en cours et les réglages. */
function sync(): void {
  if (!started) return
  if (stopping) {
    emitState()
    return
  }
  const want = wanted()
  if (want && !capture) startCapture(want)
  else if (!want && capture) {
    stopping = stopCapture(windowsGone ? 'fenêtres fermées' : quitting ? 'fermeture de l’appli' : 'plus de jeu en cours')
      .catch((e) => log(`Arrêt de la capture : ${errText(e)}`))
      .finally(() => {
        stopping = null
        sync()
      })
  } else if (want && capture && capture.game.id !== want.id) {
    capture.game = want
    log(`Jeu suivi : ${want.name}.`)
  }
  emitState()
}

/** Jeux de la bibliothèque en cours (updateRunning, index.ts). */
export function syncClipsRunning(running: Game[]): void {
  libraryRunning = running.map((g) => ({ id: g.id, name: cleanName(g.name) }))
  sync()
}

function onRecorderStopped(rec: Recorder, info: { reason?: unknown; badSince?: unknown; quick?: unknown }): void {
  const reason = typeof info.reason === 'string' ? info.reason.slice(0, 200) : 'arrêt inconnu'
  rec.ended = true
  // Résolution changée : le dernier morceau a été encodé avec une autre taille que celle de l'en-tête.
  if (typeof info.badSince === 'number') {
    const bad = info.badSince
    rec.writes = rec.writes.then(() => {
      const gone = frags.filter((f) => f.recId === rec.id && f.startWall >= bad)
      frags = frags.filter((f) => !(f.recId === rec.id && f.startWall >= bad))
      for (const f of gone) void unlink(f.file).catch(() => {})
    })
  }
  const done = rec.onEnded
  rec.onEnded = undefined
  done?.()
  const c = capture
  if (!c || c.rec !== rec || c.stopping) return
  if (rec.restartNow) {
    c.rec = null
    c.attempts = 0
    c.failure = undefined
    launchRecorder(c)
    return
  }
  log(`Enregistreur ${rec.id} arrêté : ${reason}.`)
  recorderLost(rec, reason, info.quick === true)
}

function registerRecorderIpc(): void {
  const live = (e: IpcMainEvent, recId: unknown): Recorder | null => {
    if (!fromRecorder(e) || typeof recId !== 'string') return null
    const rec = capture?.rec
    return rec && rec.id === recId ? rec : null
  }
  ipcMain.on('clips-rec:ready', (e) => {
    const c = capture
    if (!c || !fromRecorder(e)) return
    c.ready = true
    if (!c.rec) launchRecorder(c)
  })
  ipcMain.on('clips-rec:started', (e, info: { recId?: unknown; mime?: unknown; mimeIndex?: unknown; wall?: unknown; audio?: unknown; audioError?: unknown }) => {
    const rec = live(e, info?.recId)
    if (!rec) return
    // Le flux repart de zéro (premier essai ou format suivant) : tout ce qui a été reçu avant ne compte plus.
    rec.splitter = new Fmp4Splitter()
    rec.init = null
    if (rec.pcm) rec.pcm = []
    if (typeof info.wall === 'number') rec.anchor = info.wall
    rec.startedAt = Date.now()
    rec.lastDataAt = Date.now()
    if (typeof info.mime === 'string') rec.mime = info.mime.slice(0, 120)
    if (typeof info.mimeIndex === 'number') rec.mimeIndex = info.mimeIndex
    if (info.audio === 'game' || info.audio === 'mic' || info.audio === 'game+mic' || info.audio === 'none') rec.audio = info.audio
    rec.audioError = typeof info.audioError === 'string' ? info.audioError.slice(0, 200) : undefined
    if (capture) {
      capture.failure = undefined
      lastProblem = undefined
    }
    log(`Enregistreur ${rec.id} : ${rec.mime}, son : ${rec.audio}.${rec.audioError ? ` ${rec.audioError}` : ''}`)
    syncHotkey()
    emitState()
  })
  ipcMain.on('clips-rec:encoder', (e, recId: unknown, mime: unknown) => {
    const rec = live(e, recId)
    if (!rec || typeof mime !== 'string') return
    rec.mime = mime.slice(0, 120)
    log(`Format réel de ${rec.id} : ${rec.mime}.`)
    emitState()
  })
  // Bêta 42 : un morceau de son en PCM (16 bits, stéréo, 48 kHz), daté par la page.
  ipcMain.on('clips-rec:pcm', (e, recId: unknown, wall: unknown, data: unknown) => {
    const rec = live(e, recId)
    if (!rec?.pcm || typeof wall !== 'number' || !Number.isFinite(wall)) return
    if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength % PCM_FRAME_BYTES || data.byteLength > MAX_PCM_PART_BYTES) return
    const now = Date.now()
    rec.lastDataAt = now
    // Une date absurde (horloge changée pendant la partie) : le morceau est ignoré.
    if (Math.abs(wall - now) > 60_000) return
    if (!rec.seq) log(`Enregistreur ${rec.id} : premier son reçu (${Math.round(now - wall)} ms après sa capture).`)
    rec.seq++
    rec.pcm.push({ wall, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) })
    if (now - lastPcmPrune > 5_000) {
      lastPcmPrune = now
      pruneBuffer()
    }
  })
  ipcMain.on('clips-rec:chunk', (e, recId: unknown, data: unknown) => {
    const rec = live(e, recId)
    if (!rec || !(data instanceof Uint8Array) || !data.byteLength) return
    try {
      onChunk(rec, data)
    } catch (err) {
      log(`Flux illisible : ${errText(err)}`)
      if (capture?.rec === rec) {
        send(capture, { type: 'abort', recId: rec.id, reason: 'flux illisible' })
        recorderLost(rec, 'flux illisible')
      }
    }
  })
  ipcMain.on('clips-rec:stopped', (e, recId: unknown, info: unknown) => {
    const rec = live(e, recId)
    if (rec) onRecorderStopped(rec, info && typeof info === 'object' ? (info as Record<string, unknown>) : {})
  })
  ipcMain.on('clips-rec:failed', (e, recId: unknown, reason: unknown) => {
    const rec = live(e, recId)
    if (!rec) return
    const why = typeof reason === 'string' ? reason.slice(0, 200) : 'capture impossible'
    log(`Échec de la capture : ${why}`)
    onRecorderStopped(rec, { reason: why })
  })
  ipcMain.on('clips-rec:thumb', (e, id: unknown, data: unknown) => {
    if (!fromRecorder(e) || typeof id !== 'string' || !CLIP_ID.test(id) || !thumbAllowed.delete(id)) return
    if (!(data instanceof Uint8Array) || data.length < 4 || data.length > MAX_THUMB_BYTES || data[0] !== 0xff || data[1] !== 0xd8) return
    void mkdir(dirname(thumbPath(id)), { recursive: true })
      .then(() => writeFile(thumbPath(id), data))
      .then(emitChanged)
      .catch((err) => log(`Vignette ${id} : ${errText(err)}`))
  })
  ipcMain.on('clips-rec:log', (e, message: unknown) => {
    if (fromRecorder(e) && typeof message === 'string') log(`Page : ${message.slice(0, 300)}`)
  })
}

// ---------- branchements ----------

function registerApi(): void {
  handle('clips:list', () => listClips())
  handle('clips:delete', (_e, id: unknown) => deleteClip(id))
  handle('clips:rename', (_e, id: unknown, name: unknown) => renameClip(id, name))
  handle('clips:pin', (_e, id: unknown, on: unknown) => pinClip(id, on))
  handle('clips:open-folder', (_e, id: unknown) => openFolder(id))
  handle('clips:copy-file', (_e, id: unknown) => copyFile(id))
  handle('clips:share', (_e, id: unknown) => shareClip(id))
  handle('clips:trim', (_e, id: unknown, startS: unknown, endS: unknown) => trimClip(id, startS, endS))
  handle('clips:state', () => stateNow())
  handle('clips:settings-get', () => resolved(current))
  handle('clips:settings-save', (_e, patch: unknown) => saveClipSettings(patch))
  handle('clips:choose-folder', () => chooseFolder())
  handle('clips:displays', () => displays())
  handle('clips:log-tail', () => logTail())
}

/** Fichiers laissés par une fermeture brutale : le tampon et les clips à moitié écrits. */
async function cleanLeftovers(): Promise<void> {
  await rm(bufferRoot(), { recursive: true, force: true }).catch(() => {})
  const folder = folderOf(current)
  // Les clips à la racine du dossier, les films dans leur sous-dossier.
  for (const dir of [folder, join(folder, FILMS_DIR)]) {
    const names = await readdir(dir).catch(() => [] as string[])
    for (const n of names) if (n.endsWith('.mp4.part')) await unlink(join(dir, n)).catch(() => {})
  }
  const known = new Set(index.map((c) => `${c.id}.jpg`))
  const thumbs = await readdir(dirname(thumbPath('x'))).catch(() => [] as string[])
  for (const n of thumbs) if (!known.has(n)) await unlink(join(dirname(thumbPath('x')), n)).catch(() => {})
  // Bêta 46 : les copies légères pour Discord dont le clip a disparu, ou qui n'ont pas servi depuis 7 jours.
  await cleanShareCopies(new Set(index.map((c) => c.id))).catch(() => {})
}

/** Après l'ouverture de la base. */
export function startClips(): void {
  if (started) return
  current = cleanClipSettings(getKv<unknown>(SETTINGS_KEY, {}))
  index = getKv<ClipMeta[]>(INDEX_KEY, []).filter((c) => c && typeof c.id === 'string' && CLIP_ID.test(c.id) && typeof c.file === 'string')
  lastGame = cleanGamePace(getKv<unknown>(LAST_GAME_KEY, null))
  registerClipProtocol(SCHEME, (id) => {
    const c = clipById(id)
    return c ? { video: c.file, thumb: thumbPath(c.id) } : undefined
  }, (e) => log(`pxclip : ${errText(e)}`))
  registerRecorderIpc()
  registerApi()
  void cleanLeftovers()
  started = true

  onCs2Running(sync)
  onCs2Moment((m) => {
    try {
      if (!current.triggers[m.kind]) return
      onMoment(
        { kind: m.kind, at: m.at, kills: m.kills, headshots: m.headshots, roundKills: m.roundKills, map: m.map, mode: m.mode, round: m.round, ...(m.score ? { score: m.score } : {}) },
        CS2_GAME_ID
      )
    } catch (e) {
      log(`Événement CS2 : ${errText(e)}`)
    }
  })
  powerMonitor.on('suspend', () => {
    suspended = true
    sync()
  })
  powerMonitor.on('resume', () => {
    suspended = false
    sync()
  })
  // La dernière fenêtre de l'appli fermée pour de bon : la fenêtre de capture ne doit pas retenir l'appli.
  app.on('browser-window-created', (_e, w) => {
    w.once('closed', () => {
      windowsGone = appWindows().length === 0
      if (windowsGone) sync()
    })
    if (windowsGone) {
      windowsGone = false
      setImmediate(sync)
    }
  })
  // L'appli ne quitte qu'une fois les derniers clips écrits (8 s au plus).
  app.on('before-quit', (e) => {
    quitting = true
    if (!capture && !stopping && !pendings.size && !fileBusy) return
    e.preventDefault()
    if (quitRun) return
    const finish = async (): Promise<void> => {
      sync()
      while (capture || stopping) await (stopping ?? sleep(50))
      for (const p of [...pendings.values()]) finalize(p)
      await fileQueue
      await clearBuffer()
    }
    quitRun = Promise.race([finish(), sleep(QUIT_WAIT_MS)])
      .catch((err) => log(`Fermeture : ${errText(err)}`))
      .then(() => logFlushed())
      .finally(() => {
        // Plus rien n'attend (ou l'attente est finie) : cette fois, on quitte.
        capture = null
        stopping = null
        pendings.clear()
        fileBusy = 0
        app.quit()
      })
  })
  log(`Service démarré : ${index.length} clip(s).`)

  // Développement : essais sous Linux, sans le jeu ni Windows. Jamais dans la version installée.
  if (!app.isPackaged) {
    ;(globalThis as { pxClipsTest?: unknown }).pxClipsTest = {
      setRunning: (list: RunningGame[]) => {
        testRunning = list
        sync()
      },
      /** Le raccourci « garder un clip », sans touche (il n'a plus de canal : seul le raccourci s'en sert). */
      saveNow: () => saveNow(),
      command: (action: string, arg?: unknown) => {
        if (capture) send(capture, { type: 'test', action, arg, recId: capture.rec?.id })
      },
      info: () => ({
        capture: !!capture,
        recorder: capture?.rec?.id ?? null,
        recorders: recorders.size,
        fragments: frags.length,
        bytes: frags.reduce((n, f) => n + f.info.size, 0),
        keyFragments: frags.filter((f) => f.key).length,
        spans: frags.slice(-8).map((f) => +(f.endWall - f.startWall).toFixed(0)),
        list: frags.map((f) => ({ recId: f.recId, startS: f.info.startS, endS: f.info.endS, key: f.key, startWall: f.startWall, endWall: f.endWall, size: f.info.size, counts: f.info.tracks.map((x) => x.samples.length) })),
        anchor: capture?.rec?.anchor ?? null,
        pendings: [...pendings.values()],
        hotkey: hotkeyNow,
        hotkeyRegistered: hotkeyNow ? globalShortcut.isRegistered(hotkeyNow) : false,
        folder: folderOf(current),
        bufferRoot: bufferRoot(),
        // Bêta 46 : le dernier fichier « copié » (PX_CLIP_TEST_COPY=1).
        copied: testCopied
      })
    }
  }
}

/**
 * Pour l'essai de capture du moteur (captureTest.ts) : le dossier des clips, le jeu filmé, la qualité choisie. Bêta 46 :
 * `screen` est la taille réelle (en points de l'écran, pas en points de Windows mis à l'échelle) du premier écran, celui que
 * l'essai filme (monitor 0) : elle dit s'il y a de quoi essayer une capture réduite.
 */
export async function captureTestContext(): Promise<{ folder: string; game: { id: string; name: string } | null; quality: { maxWidth: number; maxHeight: number; fps: number; videoBps: number }; screen: { width: number; height: number } | null }> {
  const q = QUALITY[current.quality]
  const d = screen.getAllDisplays()[0]
  const size = d ? { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) } : null
  return { folder: await usableFolder(), game: capture?.game ?? null, quality: { maxWidth: q.maxWidth, maxHeight: q.maxHeight, fps: q.fps, videoBps: q.videoBps }, screen: size }
}

/**
 * Bêta 46 : la taille de l'image d'une vidéo MP4, relue dans son index (pour l'essai de capture : la vidéo d'essai dit si la
 * réduction a eu lieu). null : fichier illisible.
 */
export async function videoSizeOf(file: string): Promise<{ width: number; height: number } | null> {
  try {
    const fh = await open(file, 'r')
    const video = parseFlat(await readMoov(fh).finally(() => fh.close())).find((t) => t.kind === 'video')
    return video && video.width > 0 && video.height > 0 ? { width: video.width, height: video.height } : null
  } catch {
    return null
  }
}

/** Une ligne du journal des clips, pour l'essai de capture. */
export function clipsLogLine(text: string): void {
  log(text)
}
