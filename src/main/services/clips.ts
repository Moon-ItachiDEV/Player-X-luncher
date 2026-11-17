import { mkdir, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, globalShortcut, ipcMain, powerMonitor, protocol, screen, session, type IpcMainEvent } from 'electron'
import { CS2_GAME_ID } from '@shared/cs2'
import { cleanName, isBf6Name } from '@shared/text'
import type { ClipDisplay, ClipSettings, Game } from '@shared/types'
import { hotkeyRefusal } from '../hotkeys'
import { handle } from '../ipc'
import { appWindows } from '../windows'
import { CLIP_ID, cleanClipSettings, QUALITY } from './clipsPlan'
import { copyFile, lastTestCopy, shareClip } from './clipsCopy'
import { applyRetention, clipById, clipIndex, deleteClip, emitChanged, FILMS_DIR, listClips, loadClipIndex, openFolder, pinClip, renameClip, thumbPath, trimClip } from './clipsIndex'
import { errText, log, logFlushed, logTail } from './clipsLog'
import { registerClipProtocol, SCHEME } from './clipsProtocol'
import { filesBusy, filesDone, forgetFiles, serial } from './clipsQueue'
import { chooseFolder, clipSettings, folderOf, loadClipSettings, resolved, storeClipSettings, usableFolder } from './clipsSettings'
import { cleanShareCopies } from './clipsShare'
import { bufferRoot, capture, emitState, frags, libraryRunning, loadLastGame, noteGamePace, pendings, recorders, setCapture, setHotkeyError, setLastProblem, setLibraryRunning, setTestRunning, sleep, stateNow, testRunning, thumbAllowed, type Capture, type Recorder, type RunningGame } from './clipsState'
import { fromRecorder, launchRecorder, onRecordersChanged, onRecorderStopped, openWindow, recorderLost, send, targetDisplayId } from './clipsWindow'
import { clearBuffer, pruneBuffer } from './clipsBuffer'
import { decideEngine, onChunk } from './clipsEngine'
import { ensureTick, finalize, onMoment, saveNow } from './clipsSave'
import { showClipToast } from './clipsToast'
import { cs2IsRunning, onCs2Moment, onCs2Running } from './cs2Live'
import { Fmp4Splitter } from './fmp4'
import { getSettings } from './settings'
import { PCM_FRAME_BYTES } from './engineCapture'

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

/** Après la demande d'arrêt, le dernier fragment arrive en quelques dizaines de millisecondes. */
const STOP_WAIT_MS = 3_000
/** L'appli qui quitte n'attend pas plus longtemps ses derniers clips. */
const QUIT_WAIT_MS = 8_000
const MAX_THUMB_BYTES = 4 * 1024 * 1024

let started = false
let stopping: Promise<void> | null = null
let quitting = false
let quitRun: Promise<unknown> | null = null
let suspended = false
/** Toutes les fenêtres de l'appli sont fermées pour de bon : on arrête la capture, sinon l'appli ne quitterait pas. */
let windowsGone = false
let hotkeyNow: string | null = null

// ---------- l'image par le moteur vidéo (bêta 42) ----------

/** Un morceau de son de la page : 4096 instants (16 Ko) d'habitude ; au-delà de 1 Mo, refusé. */
const MAX_PCM_PART_BYTES = 1024 * 1024
let lastPcmPrune = 0

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
  onRecordersChanged(syncHotkey)
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
        // Le plus vieux morceau de son PCM gardé (heure), tous enregistreurs confondus ; null : aucun.
        pcmFrom: [...recorders.values()].reduce<number | null>((m, r) => (r.pcm?.length && (m === null || r.pcm[0].wall < m) ? r.pcm[0].wall : m), null),
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
