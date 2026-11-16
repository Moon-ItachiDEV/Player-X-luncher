import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, powerMonitor, protocol, screen, session, type IpcMainEvent, type Session, type WebContents } from 'electron'
import { paceLog, rateBetween } from '@shared/clipPace'
import { CS2_GAME_ID } from '@shared/cs2'
import { cleanName, isBf6Name } from '@shared/text'
import type { ClipDisplay, ClipSettings, Game } from '@shared/types'
import { getKv, setKv } from '../db'
import { hotkeyRefusal } from '../hotkeys'
import { handle } from '../ipc'
import { appWindows, markOverlay } from '../windows'
import {
  CLIP_ID,
  canMerge,
  clipBaseName,
  clipEvents,
  clipKills,
  clipTitle,
  cleanClipSettings,
  keepFrom,
  mergePending,
  openPending,
  pickRecorder,
  QUALITY,
  restartDelayMs,
  selectFragments,
  withNeighbours,
  type ClipMoment,
  type PendingClip
} from './clipsPlan'
import { copyFile, lastTestCopy, shareClip } from './clipsCopy'
import { freeName, writePlan } from './clipsFiles'
import { addClip, applyRetention, clipById, clipIndex, deleteClip, emitChanged, FILMS_DIR, listClips, loadClipIndex, openFolder, paceOfTracks, pinClip, renameClip, thumbPath, trimClip, type ClipMeta } from './clipsIndex'
import { errText, log, logFlushed, logTail } from './clipsLog'
import { registerClipProtocol, SCHEME } from './clipsProtocol'
import { filesBusy, filesDone, forgetFiles, serial } from './clipsQueue'
import { chooseFolder, clipSettings, folderOf, loadClipSettings, resolved, storeClipSettings, usableFolder } from './clipsSettings'
import { cleanShareCopies } from './clipsShare'
import { bufferRoot, capture, emitState, frags, libraryRunning, loadLastGame, noteGamePace, pendings, recorders, setCapture, setFrags, setHotkeyError, setLastProblem, setLibraryRunning, setTestRunning, sleep, stateNow, testRunning, thumbAllowed, writing, type Capture, type Recorder, type RunningGame } from './clipsState'
import { showClipToast } from './clipsToast'
import { cs2IsRunning, cs2MomentContext, onCs2Moment, onCs2Running } from './cs2Live'
import { buildFlat, collectTracks, cutTracks, firstFrameS, Fmp4Splitter, parseFragment, parseInit, type FlatPlan, type FragmentInfo } from './fmp4'
import { getSettings } from './settings'
import { gameExeRegex } from './captureTestArgs'
import { thumbArgs } from './editCompile'
import { captureEngineReady, spawnCaptureEngine } from './editFfmpeg'
import { attemptLabel, engineAttempts, muxArgs, PCM_FRAME_BYTES, PCM_RATE, pcmWindow, readEngineProgress, recordArgs, type EngineAttempt } from './engineCapture'

// Clips « comme NVIDIA » : pendant qu'un jeu tourne, une fenêtre cachée capture l'écran et le son du système, MediaRecorder
// les encode en MP4 fragmenté et chaque fragment (2 s) part dans un tampon circulaire sur le disque. Sur un kill de CS2 ou le
// raccourci, le clip est écrit en vrai fichier MP4, sans réencodage. Rien ne tourne quand aucun jeu ne tourne.
// Les calculs purs sont dans fmp4.ts (boîtes MP4), clipsPlan.ts (fenêtres, fusion, rétention) et cs2Moments.ts.
// Les lectures et écritures des fichiers MP4 (écrire un clip, relire son index) sont dans clipsFiles.ts.
// Les réglages et le dossier des clips sont dans clipsSettings.ts : ici, ils se lisent par clipSettings().
// La liste des clips et ce qui la change (renommer, épingler, découper, supprimer, les films) sont dans clipsIndex.ts :
// ici, elle se lit par clipIndex(). Les travaux sur les fichiers passent un à la fois par la file de clipsQueue.ts.
// Copier un clip (son fichier dans le presse-papiers, « Copier pour Discord ») est dans clipsCopy.ts.
// L'état de la capture (la partie filmée, le tampon, les clips en attente) et ce que les pages en voient sont dans
// clipsState.ts : ici, il se lit tel quel, et se change par ses fonctions set…
// La fenêtre de capture a sa propre session : la session des pages de l'appli continue de tout refuser (lockDown).

// Doit être appelé une seule fois, avant que l'appli soit prête : d'où ici, au chargement du module (index.ts l'importe).
// Un autre protocole privilégié devra s'ajouter à cette même liste.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }])

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

let started = false
let stopping: Promise<void> | null = null
let quitting = false
let quitRun: Promise<unknown> | null = null
let suspended = false
/** Toutes les fenêtres de l'appli sont fermées pour de bon : on arrête la capture, sinon l'appli ne quitterait pas. */
let windowsGone = false
let tickTimer: ReturnType<typeof setInterval> | undefined
let hotkeyNow: string | null = null
let captureSession: Session | null = null

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
  return all.find((d) => d.id === clipSettings().display)?.id ?? screen.getPrimaryDisplay().id
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
  if (audioOnly && !clipSettings().gameAudio && !clipSettings().mic) return
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
    wantedFps: QUALITY[clipSettings().quality].fps,
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
  send(c, { type: 'start', recId: id, quality: QUALITY[clipSettings().quality], gameAudio: clipSettings().gameAudio, mic: clipSettings().mic, mimeFrom: c.mimeFrom, test: testSource(), testMime: audioOnly ? null : testMime(), audioOnly })
  log(`Enregistreur ${id} demandé (${audioOnly ? 'son seulement, image par le moteur' : clipSettings().quality}, son du jeu : ${clipSettings().gameAudio ? 'oui' : 'non'}, micro : ${clipSettings().mic ? 'oui' : 'non'}).`)
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
  let on = clipSettings().capture === 'engine' && (!!dev || (!testSource() && process.platform === 'win32'))
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
  } else log(clipSettings().capture === 'engine' ? 'Moteur vidéo indisponible : image et son par Chrome.' : 'Capture par Chrome (réglage).')
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
    args = recordArgs(attempt, QUALITY[clipSettings().quality])
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
    wantedFps: QUALITY[clipSettings().quality].fps,
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
  syncHotkey()
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
  const from = keepFrom(Date.now(), clipSettings(), inUse)
  // Le son en PCM : les morceaux finis avant le début utile.
  for (const r of recorders.values()) {
    if (!r.pcm?.length) continue
    let i = 0
    while (i < r.pcm.length && r.pcm[i].wall + (r.pcm[i].data.length / PCM_FRAME_BYTES / PCM_RATE) * 1000 < from) i++
    if (i) r.pcm.splice(0, i)
  }
  const gone = frags.filter((f) => f.endWall < from)
  if (!gone.length) return
  setFrags(frags.filter((f) => f.endWall >= from))
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
  const w = { before: clipSettings().before, after: clipSettings().after, merge: clipSettings().merge }
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

function finalize(p: PendingClip): void {
  pendings.delete(p.id)
  writing.set(p.id, p.start)
  void serial(() => writeClip(p))
    .catch((e) => {
      setLastProblem('Un clip n’a pas pu être écrit : voir le journal.')
      log(`Clip ${p.id} impossible : ${errText(e)}`)
      void unlink(thumbPath(p.id)).catch(() => {})
      emitState()
    })
    .finally(() => {
      writing.delete(p.id)
      pruneBuffer()
    })
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
  const audio = clipSettings().gameAudio || clipSettings().mic ? pcmForWindow(firstWall, plan.durationS) : null
  if (!audio) {
    if (clipSettings().gameAudio || clipSettings().mic) log(`Clip ${p.id} : pas de son dans le tampon pour ce moment, clip sans son.`)
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
    const r = await engineOnce(muxArgs(video, pcm, out, QUALITY[clipSettings().quality].audioBps), MUX_TIMEOUT_MS)
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
  addClip(meta)
  log(`Clip ${p.id} écrit : « ${title} », ${plan.durationS.toFixed(1)} s, ${(size / 1e6).toFixed(1)} Mo, ${kills} élim., ${p.headshots} HS, ${paceLog(pace)}.`)
  setLastProblem(undefined)
  await applyRetention(p.id)
  // Image du moteur : la vignette vient du clip (vers le moment gardé, avant les secondes « après »).
  if (rec.engine) engineThumb(p.id, file, Math.max(0, plan.durationS - clipSettings().after - 0.5))
  else if (!existsSync(thumbPath(p.id))) requestThumb(p.id)
  emitChanged()
  emitState()
}

// ---------- pour le moteur vidéo (services/editFfmpeg.ts) : lecture seule, rien ne change dans les clips ----------

/** Vrai tant qu'un jeu tourne, filmé ou non : le moteur vidéo attend la fin de la partie pour ses essais. */
export function gameRunning(): boolean {
  return capture !== null || libraryRunning.length > 0 || cs2IsRunning()
}

// ---------- pour la fabrication des films (services/editFilm.ts) ----------

/** Les clips qui entrent dans un film, l'endroit où écrire un film et son rangement dans la liste : ces fonctions sont dans clipsIndex.ts. */
export { addFilm, filmSources, filmTarget, newestClipSource, type FilmSource } from './clipsIndex'

/** Le réglage « après le moment » : là où tombe le dernier kill d'un clip qui ne note pas ses événements. */
export function clipAfterSetting(): number {
  return clipSettings().after
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

/**
 * Raccourci d'un jeu seulement : pris pendant que le tampon tourne, rendu dès qu'il s'arrête. Le tampon tourne quand la
 * page enregistre, ou quand le moteur vidéo filme : sans aucun son voulu, la page n'enregistre rien et le moteur filme seul.
 */
function syncHotkey(): void {
  const want = (capture?.rec || capture?.eng) && !capture.stopping ? clipSettings().hotkey : null
  if (want === hotkeyNow) return
  if (hotkeyNow) globalShortcut.unregister(hotkeyNow)
  hotkeyNow = null
  setHotkeyError(undefined)
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
  const taken = `Le raccourci ${want} est déjà pris : choisis-en un autre.`
  setHotkeyError(taken)
  log(taken)
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
  const before = clipSettings()
  const p: Record<string, unknown> = patch && typeof patch === 'object' && !Array.isArray(patch) ? { ...(patch as Record<string, unknown>) } : {}
  // Le dossier vient de la fenêtre native (clipsChooseFolder) ; la page peut seulement revenir à celui par défaut.
  if (p.folder !== '') delete p.folder
  if ('hotkey' in p && p.hotkey !== before.hotkey) checkHotkey(p.hotkey)
  storeClipSettings(cleanClipSettings(p, before))
  if (clipSettings().capture !== before.capture && capture && !stopping) {
    // Moteur ↔ Chrome : la capture repart de zéro avec l'autre méthode.
    // La partie continue : pas de bilan de rythme ici.
    stopping = stopCapture('méthode de capture changée', false)
      .catch((e) => log(`Arrêt de la capture : ${errText(e)}`))
      .finally(() => {
        stopping = null
        sync()
      })
  } else if (clipSettings().quality !== before.quality || clipSettings().mic !== before.mic || clipSettings().gameAudio !== before.gameAudio || clipSettings().display !== before.display) restartRecorder('réglages changés')
  syncHotkey()
  sync()
  if (clipSettings().limitGb < before.limitGb) void serial(() => applyRetention()).catch((e) => log(`Rétention : ${errText(e)}`))
  emitState()
  return resolved(clipSettings())
}

// ---------- démarrage et arrêt de la capture ----------

function wanted(): RunningGame | null {
  if (!started || quitting || suspended || windowsGone || !clipSettings().enabled) return null
  const all = [...libraryRunning, ...testRunning]
  // CS2 vu par sa liaison (simulateur compris), même si la bibliothèque ne l'a pas encore en cours.
  if (cs2IsRunning() && !all.some((g) => g.id === CS2_GAME_ID)) all.push({ id: CS2_GAME_ID, name: 'Counter-Strike 2' })
  const list = clipSettings().games === 'all' ? all : all.filter((g) => g.id === CS2_GAME_ID || isBf6Name(g.name))
  return list.find((g) => g.id === CS2_GAME_ID) ?? list[0] ?? null
}

function startCapture(game: RunningGame): void {
  const c: Capture = { game, sessionId: `s${Date.now().toString(36)}`, win: null, ready: false, rec: null, attempts: 0, stopping: false, mimeFrom: 0, quickAt: 0, eng: null, engAttempts: [], engIdx: 0, engRestarts: 0, engStart: Date.now(), engRound: 0 }
  setCapture(c)
  setLastProblem(undefined)
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
  setCapture(null)
  emitState()
  await Promise.all([...recorders.values()].map((r) => r.writes.catch(() => {})))
  for (const p of [...pendings.values()]) finalize(p)
  await filesDone()
  await clearBuffer()
  if (gameOver) noteGamePace(c)
}

async function clearBuffer(): Promise<void> {
  setFrags([])
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
  setLibraryRunning(running.map((g) => ({ id: g.id, name: cleanName(g.name) })))
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
      setFrags(frags.filter((f) => !(f.recId === rec.id && f.startWall >= bad)))
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
      setLastProblem(undefined)
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
  handle('clips:settings-get', () => resolved(clipSettings()))
  handle('clips:settings-save', (_e, patch: unknown) => saveClipSettings(patch))
  handle('clips:choose-folder', () => chooseFolder())
  handle('clips:displays', () => displays())
  handle('clips:log-tail', () => logTail())
}

/** Fichiers laissés par une fermeture brutale : le tampon et les clips à moitié écrits. */
async function cleanLeftovers(): Promise<void> {
  await rm(bufferRoot(), { recursive: true, force: true }).catch(() => {})
  const folder = folderOf(clipSettings())
  // Les clips à la racine du dossier, les films dans leur sous-dossier.
  for (const dir of [folder, join(folder, FILMS_DIR)]) {
    const names = await readdir(dir).catch(() => [] as string[])
    for (const n of names) if (n.endsWith('.mp4.part')) await unlink(join(dir, n)).catch(() => {})
  }
  const known = new Set(clipIndex().map((c) => `${c.id}.jpg`))
  const thumbs = await readdir(dirname(thumbPath('x'))).catch(() => [] as string[])
  for (const n of thumbs) if (!known.has(n)) await unlink(join(dirname(thumbPath('x')), n)).catch(() => {})
  // Bêta 46 : les copies légères pour Discord dont le clip a disparu, ou qui n'ont pas servi depuis 7 jours.
  await cleanShareCopies(new Set(clipIndex().map((c) => c.id))).catch(() => {})
}

/** Après l'ouverture de la base. */
export function startClips(): void {
  if (started) return
  loadClipSettings()
  loadClipIndex()
  loadLastGame()
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
      if (!clipSettings().triggers[m.kind]) return
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
    if (!capture && !stopping && !pendings.size && !filesBusy()) return
    e.preventDefault()
    if (quitRun) return
    const finish = async (): Promise<void> => {
      sync()
      while (capture || stopping) await (stopping ?? sleep(50))
      for (const p of [...pendings.values()]) finalize(p)
      await filesDone()
      await clearBuffer()
    }
    quitRun = Promise.race([finish(), sleep(QUIT_WAIT_MS)])
      .catch((err) => log(`Fermeture : ${errText(err)}`))
      .then(() => logFlushed())
      .finally(() => {
        // Plus rien n'attend (ou l'attente est finie) : cette fois, on quitte.
        setCapture(null)
        stopping = null
        pendings.clear()
        forgetFiles()
        app.quit()
      })
  })
  log(`Service démarré : ${clipIndex().length} clip(s).`)

  // Développement : essais sous Linux, sans le jeu ni Windows. Jamais dans la version installée.
  if (!app.isPackaged) {
    ;(globalThis as { pxClipsTest?: unknown }).pxClipsTest = {
      setRunning: (list: RunningGame[]) => {
        setTestRunning(list)
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
        folder: folderOf(clipSettings()),
        bufferRoot: bufferRoot(),
        // Bêta 46 : le dernier fichier « copié » (PX_CLIP_TEST_COPY=1).
        copied: lastTestCopy()
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
  const q = QUALITY[clipSettings().quality]
  const d = screen.getAllDisplays()[0]
  const size = d ? { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) } : null
  return { folder: await usableFolder(), game: capture?.game ?? null, quality: { maxWidth: q.maxWidth, maxHeight: q.maxHeight, fps: q.fps, videoBps: q.videoBps }, screen: size }
}

/** La taille de l'image d'une vidéo MP4, pour l'essai de capture (captureTest.ts) : la fonction est dans clipsFiles.ts. */
export { videoSizeOf } from './clipsFiles'

/** Une ligne du journal des clips, pour l'essai de capture. */
export function clipsLogLine(text: string): void {
  log(text)
}
