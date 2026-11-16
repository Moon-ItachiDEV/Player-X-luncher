import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { cleanGamePace, cleanPace, gamePace, gamePaceLine, type GamePace } from '@shared/clipPace'
import type { ClipsState } from '@shared/types'
import { getKv, setKv } from '../db'
import { broadcast } from '../windows'
import { clipIndex } from './clipsIndex'
import { errText, log } from './clipsLog'
import type { BufferedFragment, PendingClip } from './clipsPlan'
import { clipSettings } from './clipsSettings'
import type { EngineAttempt, PcmPart } from './engineCapture'
import type { Fmp4Splitter, FragmentInfo, InitInfo } from './fmp4'

// L'état de la capture des clips : la partie filmée en ce moment, ses enregistreurs, les fragments du tampon, les clips en
// attente et ceux qui s'écrivent, le dernier problème, et ce que les pages en voient (stateNow, emitState).
// Tout le reste de la capture lit cet état. Ce fichier est le seul à pouvoir changer ses variables : les autres passent
// par les fonctions set… plus bas (le langage refuse d'écrire dans une variable importée).
// Ce code vient de clips.ts, sans changement de comportement.

/** Bêta 46 : le rythme des clips de la dernière partie finie. */
const LAST_GAME_KEY = 'clipsLastGame'

export interface RunningGame {
  id: string
  name: string
}

/** Un enregistreur (MediaRecorder) : son en-tête ne vaut que pour ses propres fragments. */
export interface Recorder {
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

export interface Capture {
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

export interface BufFrag extends BufferedFragment {
  file: string
  info: FragmentInfo
}

export let capture: Capture | null = null
export let libraryRunning: RunningGame[] = []
/** Développement : jeux marqués comme lancés par les essais (globalThis.pxClipsTest). */
export let testRunning: RunningGame[] = []

export const recorders = new Map<string, Recorder>()
export let frags: BufFrag[] = []
export const pendings = new Map<string, PendingClip>()
/** Fenêtres des clips en cours d'écriture : leurs fragments restent. */
export const writing = new Map<string, number>()
export const thumbAllowed = new Set<string>()
export let hotkeyError: string | undefined
/** Dernier problème hors capture (clip impossible). */
export let lastProblem: string | undefined
/** Bêta 46 : le rythme des clips de la dernière partie finie (relu de la base au démarrage). */
let lastGame: GamePace | undefined
let lastStateJson = ''

// Ces variables se lisent partout dans la capture, mais ce fichier est le seul à les changer : par ces fonctions.

export function setCapture(c: Capture | null): void {
  capture = c
}

export function setLibraryRunning(list: RunningGame[]): void {
  libraryRunning = list
}

export function setTestRunning(list: RunningGame[]): void {
  testRunning = list
}

export function setFrags(list: BufFrag[]): void {
  frags = list
}

export function setHotkeyError(text: string | undefined): void {
  hotkeyError = text
}

export function setLastProblem(text: string | undefined): void {
  lastProblem = text
}

const userData = (...p: string[]): string => join(app.getPath('userData'), ...p)
export const bufferRoot = (): string => userData('clips-buffer')
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------- ce que les pages voient ----------

function bufferSeconds(rec: Recorder | null): number {
  if (!rec) return 0
  const mine = frags.filter((f) => f.recId === rec.id)
  return mine.length ? Math.round((mine[mine.length - 1].endWall - mine[0].startWall) / 1000) : 0
}

export function stateNow(): ClipsState {
  const last = lastGame ? { lastGame } : {}
  if (!clipSettings().enabled) return { status: 'off', ...last }
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

export function emitState(): void {
  const s = stateNow()
  const json = JSON.stringify(s)
  if (json === lastStateJson) return
  lastStateJson = json
  broadcast('clips:state', s)
}

// ---------- le rythme de la dernière partie ----------

/** Au démarrage, après l'ouverture de la base : le rythme de la dernière partie finie. */
export function loadLastGame(): void {
  lastGame = cleanGamePace(getKv<unknown>(LAST_GAME_KEY, null))
}

/**
 * Bêta 46 : la partie est finie et ses derniers clips sont écrits. Le rythme de ses clips est gardé pour Paramètres, et la
 * page le dit une fois si des clips sont sous le seuil (jamais pendant la partie : rien ne s'affiche avant cet instant).
 */
export function noteGamePace(c: Capture): void {
  try {
    lastGame = gamePace(clipIndex().filter((x) => x.sessionId === c.sessionId && x.kind !== 'film').map((x) => ({ pace: cleanPace(x.pace), durationS: x.durationS })), c.game.name, Date.now())
    setKv(LAST_GAME_KEY, lastGame)
    log(lastGame.clips ? `${gamePaceLine(lastGame)} (${String(lastGame.fps).replace('.', ',')} images/s sur ${lastGame.clips} clip(s), ${c.game.name}).` : `Partie finie sans clip dont le rythme est connu (${c.game.name}).`)
    emitState()
  } catch (e) {
    log(`Rythme de la partie : ${errText(e)}`)
  }
}
