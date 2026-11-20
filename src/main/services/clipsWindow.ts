import { randomBytes } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, screen, session, type IpcMainEvent, type Session, type WebContents } from 'electron'
import { markAuxiliary } from '../windows'
import { QUALITY, restartDelayMs } from './clipsPlan'
import { errText, log } from './clipsLog'
import { clipSettings } from './clipsSettings'
import { bufferRoot, capture, emitState, frags, recorders, setFrags, thumbAllowed, type Capture, type Recorder } from './clipsState'
import { Fmp4Splitter } from './fmp4'

// La fenêtre de capture : la fenêtre cachée qui filme, sa session, la page interne qu'elle charge, et l'enregistreur de
// cette page (le lancer, le relancer après une panne, le perdre). L'état qu'elle change est dans clipsState.ts.
// Ce code vient de clips.ts, sans changement de comportement.

const PARTITION = 'px-clips-capture'
const PAGE_NAME = 'clips-recorder.html'

/** Enregistreur en bonne santé depuis ce temps : ses relances repartent de la plus courte. */
const HEALTHY_MS = 30_000

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

export function fromRecorder(e: IpcMainEvent): boolean {
  return isRecorderContents(e.sender) && e.senderFrame?.parent === null && isRecorderUrl(e.senderFrame?.url)
}

/** Écran à capturer : celui des réglages, sinon l'écran principal. */
export function targetDisplayId(): number {
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

export function openWindow(c: Capture): void {
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
  // Fenêtre auxiliaire : hors de appWindows/broadcast et aucun canal handle() (y compris cs2:*) ne lui répond.
  markAuxiliary(w)
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

export function send(c: Capture, command: Record<string, unknown>): void {
  const win = c.win
  if (win && !win.isDestroyed()) win.webContents.send('clips-rec:command', command)
}

/** Essais en développement seulement : PX_CLIP_TEST_SOURCE=1 (ou 640x360), un canvas et un oscillateur à la place de l'écran. */
export function testSource(): { width: number; height: number } | null {
  const v = app.isPackaged ? undefined : process.env.PX_CLIP_TEST_SOURCE
  if (!v) return null
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(v)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1280, height: 720 }
}

/** Essais en développement seulement : PX_CLIP_TEST_MIME impose un format d'enregistrement. */
const testMime = (): string | null => (app.isPackaged ? null : process.env.PX_CLIP_TEST_MIME || null)

/** Démarre un nouvel enregistreur (le tampon de l'ancien reste). */
export function launchRecorder(c: Capture): void {
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
  recordersChanged()
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
  recordersChanged()
  emitState()
}

/** L'enregistreur vient de s'arrêter tout seul : ses fragments restent, un nouveau repart après un délai. */
export function recorderLost(rec: Recorder, reason: string, quick = false): void {
  rec.ended = true
  const c = capture
  if (!c || c.rec !== rec) return
  if (Date.now() - rec.startedAt > HEALTHY_MS && rec.seq > 0) c.attempts = 0
  // Démarré sans jamais rien produire (encodeur matériel muet, par exemple) : le format suivant au prochain essai.
  if (rec.mimeIndex !== undefined) c.mimeFrom = rec.init ? rec.mimeIndex : rec.mimeIndex + 1
  c.rec = null
  scheduleRestart(c, reason, quick)
}

export function requestThumb(id: string): void {
  const c = capture
  if (!c?.rec || !c.ready) return
  thumbAllowed.add(id)
  send(c, { type: 'thumb', id })
}

export function onRecorderStopped(rec: Recorder, info: { reason?: unknown; badSince?: unknown; quick?: unknown }): void {
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

// Le raccourci « garder un clip » est tenu par clips.ts, qui s'y branche au démarrage : la fenêtre, et le moteur
// (clipsEngine.ts), le préviennent quand un enregistreur arrive ou part.
export let recordersChanged = (): void => {}
export function onRecordersChanged(fn: () => void): void {
  recordersChanged = fn
}
// Le rappel du raccourci (clips.ts) attend la première image : le moteur (clipsEngine.ts) le prévient quand l'en-tête vidéo arrive.
export let videoHeaderSeen = (_rec: Recorder): void => {}
export function onVideoHeader(fn: (rec: Recorder) => void): void {
  videoHeaderSeen = fn
}
