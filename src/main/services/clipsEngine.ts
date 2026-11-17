import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, screen } from 'electron'
import { rateBetween } from '@shared/clipPace'
import { CS2_GAME_ID } from '@shared/cs2'
import { getKv, setKv } from '../db'
import { QUALITY } from './clipsPlan'
import { emitChanged, thumbPath } from './clipsIndex'
import { errText, log } from './clipsLog'
import { clipSettings } from './clipsSettings'
import { bufferRoot, capture, emitState, recorders, type Capture, type Recorder } from './clipsState'
import { launchRecorder, recordersChanged, send, targetDisplayId, testSource, videoHeaderSeen } from './clipsWindow'
import { storeFragment } from './clipsBuffer'
import { Fmp4Splitter, parseFragment, parseInit } from './fmp4'
import { gameExeRegex } from './captureTestArgs'
import { thumbArgs } from './editCompile'
import { captureEngineReady, spawnCaptureEngine } from './editFfmpeg'
import { attemptLabel, clipRate, engineAttempts, readEngineProgress, recordArgs, type EngineAttempt } from './engineCapture'

/** 0.7.4 : relevés du compteur du moteur gardés (un par seconde) : 10 min, plus que le tampon. */
const MARKS_MAX = 600

// Le moteur vidéo : choisir s'il filme et de quelle manière, le lancer, lire son flux, le relancer ou y renoncer, et
// ses commandes courtes (vignette, assemblage d'un clip). L'état qu'il change est dans clipsState.ts.
// Ce code vient de clips.ts, sans changement de comportement.

/** Temps 0 posé en avance : storeFragment le recale sur les premiers fragments reçus (le flux ne peut pas devancer l'horloge). */
const ENGINE_LATE_MS = 3_000
/** Relances d'une même manière après une coupure, avant de passer à la suivante. */
const ENGINE_MAX_RESTARTS = 5
/** La fenêtre du jeu peut n'apparaître qu'après le lancement : on la réessaie pendant ce temps avant de filmer l'écran. */
const ENGINE_WINDOW_WAIT_MS = 90_000

const ENGINE_GOOD_KEY = 'clipsEngineGood'

/** Assemblage image + son d'un clip par le moteur : quelques secondes d'habitude. */
export const MUX_TIMEOUT_MS = 120_000

/** Essais sous Linux seulement (développement) : l'écran X11 et libx264 à la place des captures de Windows. */
function engineDevAttempts(): EngineAttempt[] | null {
  if (app.isPackaged || process.env.PX_ENGINE_SOURCE !== 'x11') return null
  const d = screen.getPrimaryDisplay().size
  return [{ method: { id: 'x11', label: 'écran (essai Linux)', display: process.env.DISPLAY || ':0', width: d.width, height: d.height }, encoder: 'libx264', mode: 'copie' }]
}

const mannerOf = (a: EngineAttempt): string => `${a.encoder}/${a.mode}`

/** Au début de la partie : le moteur filme-t-il l'image ? Puis il démarre, et la page avec lui (son seulement). */
export async function decideEngine(c: Capture): Promise<void> {
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

/**
 * 0.7.6 : la fréquence de l'écran filmé (Hz), pour caler la cadence du clip (clipRate). Écran filmé : le sien. Fenêtre du jeu :
 * on ne sait pas sur quel écran elle est, donc seulement si tous les écrans ont la même fréquence. 0 : inconnue (pas calé).
 */
function refreshOf(a: EngineAttempt): number {
  const all = screen.getAllDisplays()
  const m = a.method
  const hzOf = (d: Electron.Display | undefined): number => {
    const hz = d?.displayFrequency
    return typeof hz === 'number' && Number.isFinite(hz) ? Math.round(hz) : 0
  }
  if ('monitor' in m && typeof m.monitor === 'number') return hzOf(all[m.monitor])
  const rates = [...new Set(all.map(hzOf))]
  return rates.length === 1 ? rates[0] : 0
}

function startEngine(c: Capture): void {
  clearTimeout(c.engTimer)
  c.engTimer = undefined
  if (capture !== c || c.stopping || c.eng || !c.engMode) return
  const attempt = c.engAttempts[c.engIdx]
  if (!attempt) return engineGiveUp(c, 'aucune manière n’a marché')
  let args: string[]
  try {
    args = recordArgs(attempt, { ...QUALITY[clipSettings().quality], refreshHz: refreshOf(attempt) })
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
    // 0.7.6 : la cadence vraie du fichier, calée sur l'écran (72 sur un écran à 144 Hz).
    engine: { proc, attempt, err: '', progress: '', loggedAt: now, marks: [], clipFps: clipRate(QUALITY[clipSettings().quality].fps, attempt.method.id === 'x11' ? 0 : refreshOf(attempt)).value }
  }
  recorders.set(id, rec)
  c.eng = rec
  recordersChanged()
  if (c.engRound === 0 || attempt.method.id !== 'fenetre') {
    const r = clipRate(QUALITY[clipSettings().quality].fps, attempt.method.id === 'x11' ? 0 : refreshOf(attempt))
    // 0.7.6 : la cadence calée sur l'écran, dite seulement quand elle l'est (sinon la ligne reste la même qu'avant).
    log(`Moteur : essai « ${attemptLabel(attempt)} ».${r.refresh ? ` Clip à ${String(Math.round(r.value * 10) / 10).replace('.', ',')} images/s (écran à ${r.refresh} Hz).` : ''}`)
  }
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
    // 0.7.4 : on ne lit que les blocs complets (jusqu'à la dernière ligne « progress=… » finie) ; la suite attend le prochain envoi.
    const done = [...e.progress.matchAll(/^progress=\w*\r?\n/gm)].pop()
    if (!done) return
    const cut = done.index + done[0].length
    const pr = readEngineProgress(e.progress.slice(0, cut))
    e.progress = e.progress.slice(cut)
    // 0.7.4 : un relevé par seconde, gardé le temps du tampon (10 min au plus).
    if (pr) {
      e.marks.push({ at: Date.now(), n: pr.received })
      if (e.marks.length > MARKS_MAX) e.marks.splice(0, e.marks.length - MARKS_MAX)
    }
    // Les images par seconde dans le journal, toutes les 10 s la première minute, puis chaque minute.
    const every = Date.now() - rec.startedAt < 65_000 ? 9_000 : 59_000
    if (Date.now() - e.loggedAt > every) {
      if (pr) {
        // Bêta 46 : le chiffre du moteur est une moyenne depuis le début ; le rythme depuis le relevé d'avant dit ce qui se passe
        // maintenant. Pour le journal seulement : une pause du jeu le fait baisser sans que la capture soit en faute.
        // 0.7.4 : le clip est à cadence fixe ; le rythme est compté sur les images reçues de la capture (sans les répétées).
        const now = { frames: pr.received, at: Date.now() }
        const rate = rateBetween(e.last, now)
        log(`Moteur : ${pr.fps} images/s dans le clip (${pr.frames} images, ${pr.received} reçues de la capture${rate === null ? '' : ` ; capture : ${String(rate).replace('.', ',')} images/s depuis le dernier relevé`}).`)
        e.last = now
      }
      e.loggedAt = Date.now()
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
export function engineThumb(id: string, file: string, atS: number): void {
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

export function onChunk(rec: Recorder, chunk: Uint8Array): void {
  rec.lastDataAt = Date.now()
  for (const item of rec.splitter.push(chunk)) {
    if (item.kind === 'init') {
      rec.init = parseInit(item.data)
      log(`En-tête MP4 de ${rec.id} : ${rec.init.tracks.map((t) => (t.kind === 'video' ? `${t.codec} ${t.width}×${t.height}` : t.codec)).join(', ')}.`)
      if (rec.engine) engineReady(rec)
      if (rec.init.tracks.some((t) => t.kind === 'video')) videoHeaderSeen(rec)
      continue
    }
    if (!rec.init) continue
    const info = parseFragment(item.data, rec.init)
    if (info.tracks.some((t) => t.samples.length)) storeFragment(rec, item.data, info)
  }
}

/** Une commande courte du moteur (assemblage d'un clip) : code de sortie et dernières lignes d'erreur. */
export function engineOnce(args: string[], timeoutMs: number): Promise<{ code: number | null; err: string }> {
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
