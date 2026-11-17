import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { paceLog, paceOfCounts } from '@shared/clipPace'
import { CS2_GAME_ID } from '@shared/cs2'
import {
  canMerge,
  clipBaseName,
  clipEvents,
  clipKills,
  clipTitle,
  mergePending,
  openPending,
  pickRecorder,
  QUALITY,
  selectFragments,
  withNeighbours,
  type ClipMoment,
  type PendingClip
} from './clipsPlan'
import { freeName, writePlan } from './clipsFiles'
import { addClip, applyRetention, emitChanged, paceOfTracks, thumbPath, type ClipMeta } from './clipsIndex'
import { errText, log } from './clipsLog'
import { serial } from './clipsQueue'
import { clipSettings, usableFolder } from './clipsSettings'
import { capture, emitState, frags, libraryRunning, pendings, recorders, setLastProblem, testRunning, writing, type RunningGame } from './clipsState'
import { recorderLost, requestThumb, send } from './clipsWindow'
import { pcmForWindow, pruneBuffer } from './clipsBuffer'
import { engineOnce, engineThumb, MUX_TIMEOUT_MS } from './clipsEngine'
import { cs2MomentContext } from './cs2Live'
import { buildFlat, collectTracks, cutTracks, firstFrameS, type FlatPlan } from './fmp4'
import { muxArgs } from './engineCapture'

// Les clips : un événement (un kill, le raccourci) ouvre ou prolonge un clip en attente ; l'horloge de la capture le
// ferme et surveille les enregistreurs muets ; puis le clip est écrit, image de la page ou du moteur. L'état qu'ils
// changent est dans clipsState.ts.
// Ce code vient de clips.ts, sans changement de comportement.

/** Attente de la dernière image après la fermeture de la fenêtre d'un clip : un fragment arrive au plus toutes les 2 s environ. */
const GRACE_MS = 6_000
const TICK_MS = 250
/** Plus aucune donnée de l'enregistreur depuis ce temps : il est relancé. */
const STALL_MS = 15_000

let tickTimer: ReturnType<typeof setInterval> | undefined

/** Sans aucune image pendant ce temps (jeu en pause, fenêtre réduite), le moteur est relancé. */
const ENGINE_STALL_MS = 60_000

// ---------- événements ----------

function currentGame(gameId?: string): RunningGame | null {
  if (!capture) return null
  if (!gameId || capture.game.id === gameId) return capture.game
  return [...libraryRunning, ...testRunning].find((g) => g.id === gameId) ?? (gameId === CS2_GAME_ID ? { id: CS2_GAME_ID, name: 'Counter-Strike 2' } : capture.game)
}

/** Un événement : il prolonge le clip en attente s'il arrive assez tôt, sinon il en ouvre un autre. */
export function onMoment(m: ClipMoment, gameId?: string): boolean {
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

/** Le raccourci, ou le bouton : garde les `before` dernières secondes et les `after` suivantes. */
export function saveNow(): boolean {
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

export function ensureTick(): void {
  if (!tickTimer) tickTimer = setInterval(tick, TICK_MS)
}

// ---------- écriture d'un clip ----------

export function finalize(p: PendingClip): void {
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
  // 0.7.4 : le moteur sort à cadence fixe (images répétées comprises), son rythme vient de son compteur d'images reçues ;
  // inconnu si les relevés ne couvrent pas le clip.
  const pace = rec.engine
    ? (paceOfCounts(rec.engine.marks, firstWall, firstWall + plan.durationS * 1000, rec.wantedFps) ?? undefined)
    : paceOfTracks(cut, plan.durationS, rec.wantedFps)
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
