import { mkdtemp, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { EditProject, EditProjectShot, FilmState } from '@shared/types'
import { timeline, unitOf } from '@shared/editShots'
import { UserError } from '../errors'
import { broadcast } from '../windows'
import { addFilm, clipAfterSetting, filmSources, filmTarget, gameRunning, type FilmSource } from './clips'
import { errText, log } from './clipsLog'
import { filmPieces, FILM_FORMAT as FORMAT, joinArgs, joinList, percentOf, progressReader, shotArgs, shotFrames, thumbArgs, type FilmMix, type FilmPart, type FilmPiece, type ShotSource } from './editCompile'
import { filmReportText, scrub, type FilmAttempt } from './editEngineRules'
import { filmEngine } from './editFfmpeg'
import { cleanProject, filmTitle, planProject, planShots } from './editPlan'
import { musicFile, musicInfos } from './editMusic'

// La fabrication d'un film à partir de clips : la première règle de montage, « bout à bout » (editPlan.ts), puis le moteur
// vidéo, un plan après l'autre, et un assemblage final (editCompile.ts). La page n'envoie que des identifiants de clips :
// le plan de montage, les fichiers et les commandes se décident ici. Un seul film à la fois, jamais pendant qu'un jeu tourne,
// et tout s'arrête si un jeu démarre. Le film fini est rangé avec les clips (kind « film »), dans le sous-dossier Films.

const WORK_PREFIX = 'px-film-'
const LIST_NAME = 'liste.txt'
/** En dessous, un morceau n'est pas une vidéo. */
const MIN_BYTES = 1000
/** Un plan qui ne répond pas est coupé : un pilote graphique en panne peut ne jamais rendre la main. */
const shotTimeoutMs = (durationS: number): number => 30_000 + durationS * 10_000
const joinTimeoutMs = (durationS: number): number => 60_000 + durationS * 2_000
const THUMB_TIMEOUT_MS = 30_000
/** La vignette : juste après le premier kill (un plan garde 3 s avant lui). */
const THUMB_AT_S = 3.2
const GAME_WATCH_MS = 1000

interface Job {
  at: number
  title: string
  gameId: string
  gameName: string
  map?: string
  mode?: string
  sessionId: string
  /** Les morceaux à fabriquer, dans l'ordre, avec leurs images. */
  pieces: FilmPiece[]
  /** Nombre de plans (un plan au ralenti fait trois morceaux). */
  shots: number
  files: Map<string, ShotSource>
  /** La musique, mélangée à l'assemblage. */
  mix?: Omit<FilmMix, 'durationS'>
  /** Où tombe le premier kill dans le film : la vignette est prise juste après. */
  thumbAtS: number
  /** Durée prévue du film : la somme des plans, avant leur mise au pas des images. */
  durationS: number
  skipped: number
}

class Stopped extends Error {}
class Failed extends Error {}

let state: FilmState = { status: 'idle' }
let busy = false
let stopWhy: 'user' | 'game' | null = null

function set(next: FilmState): void {
  state = next
  broadcast('edit:film', state)
}

export function filmState(): FilmState {
  return state
}

/** Arrête le film en cours (bouton « Arrêter ») : rien n'est gardé. */
export function stopFilm(): void {
  stop('user')
}

function stop(why: 'user' | 'game'): void {
  if (!busy || stopWhy) return
  stopWhy = why
  filmEngine.stop()
}

function checkStop(): void {
  if (stopWhy) throw new Stopped()
}

const same = <T>(values: readonly T[]): T | undefined => (values.length && values.every((v) => v === values[0]) ? values[0] : undefined)

/**
 * Lance la fabrication d'un film avec ces clips (leurs identifiants). Répond dès que le film est lancé : la suite arrive par
 * « edit:film ». Refuse en clair ce qui ne peut pas démarrer (un jeu tourne, un film est déjà en cours, rien à monter).
 */
export async function startFilm(ids: unknown): Promise<FilmState> {
  if (busy) throw new UserError('Un film est déjà en cours de fabrication.')
  if (gameRunning()) throw new UserError('Un jeu tourne. Fais ton film après ta partie : la fabrication gênerait ton jeu.')
  if (!filmEngine.begin()) throw new UserError('Le moteur vidéo est en cours d’essai. Relance le film dans un instant.')
  busy = true
  stopWhy = null
  let job: Job
  try {
    const status = await filmEngine.status()
    if (status === 'missing') throw new UserError('Le moteur vidéo manque. Réinstalle Player X V3 Test pour le remettre.')
    if (status === 'damaged') throw new UserError('Le moteur vidéo a été modifié depuis l’installation. Réinstalle Player X V3 Test pour le remettre.')
    const project = ids && typeof ids === 'object' && !Array.isArray(ids) ? (ids as Partial<EditProject>) : null
    const wanted = project ? (Array.isArray(project.shots) ? project.shots.map((x) => (x as EditProjectShot)?.clipId) : []) : ids
    const { sources, skipped } = await filmSources(wanted)
    if (!sources.length) throw new UserError('Aucun clip lisible pour ce film.')
    let plan: { pieces: FilmPiece[]; shots: number; durationS: number; thumbAtS: number; mix?: Omit<FilmMix, 'durationS'> }
    if (project) {
      // Le projet de l'éditeur : revu plan par plan contre les vrais clips et la vraie musique.
      let p: ReturnType<typeof cleanProject>
      try {
        p = cleanProject(project, new Map(sources.map((x) => [x.id, { durationS: x.durationS }])), musicInfos())
      } catch (e) {
        throw new UserError(e instanceof Error ? e.message : 'Projet de montage refusé.')
      }
      let mix: Omit<FilmMix, 'durationS'> | undefined
      if (p.music) {
        const m = await musicFile(p.music.id)
        if (!m) throw new UserError('Le fichier de la musique a disparu. Choisis-la à nouveau.')
        mix = { musicFile: m.file, startS: p.music.startS, music: p.music.volume, game: p.gameVolume }
      }
      const pieces = filmPieces(p.shots, p.unit, FORMAT.fps)
      plan = { pieces, shots: p.shots.length, durationS: p.durationS, thumbAtS: timeline(p.shots, p.unit).anchors[0] ?? 0, ...(mix ? { mix } : {}) }
    } else {
      // Bêta 33 : des identifiants seuls, montés bout à bout.
      const old = planShots(sources, { after: clipAfterSetting() })
      plan = { pieces: old.shots.map((x) => ({ ...x, speed: 1, frames: shotFrames(x.outS - x.inS, FORMAT.fps) })), shots: old.shots.length, durationS: old.durationS, thumbAtS: THUMB_AT_S }
    }
    if (!plan.pieces.length) throw new UserError('Rien à monter : ces clips sont trop courts.')
    const used = sources.filter((s) => plan.pieces.some((p) => p.clipId === s.id))
    job = {
      at: Date.now(),
      title: filmTitle(used),
      gameId: same(used.map((s) => s.gameId)) ?? used[0].gameId,
      gameName: same(used.map((s) => s.gameName)) ?? 'Film',
      map: same(used.map((s) => s.map)),
      mode: same(used.map((s) => s.mode)),
      sessionId: same(used.map((s) => s.sessionId)) ?? `film-${Date.now().toString(36)}`,
      pieces: plan.pieces,
      shots: plan.shots,
      files: new Map(sources.map((s: FilmSource) => [s.id, { file: s.file, hasAudio: s.hasAudio }])),
      durationS: plan.durationS,
      skipped,
      thumbAtS: plan.thumbAtS,
      ...(plan.mix ? { mix: plan.mix } : {})
    }
    set({ status: 'running', fromClipId: plan.pieces[0].clipId, title: job.title, percent: 0, shots: job.shots, durationS: job.durationS, ...(skipped ? { skipped } : {}) })
  } catch (e) {
    busy = false
    filmEngine.end()
    throw e
  }
  const started = state
  void render(job)
    .then(
      (done) => set(done),
      async (e) => {
        if (e instanceof Stopped) {
          log(`Film arrêté : ${stopWhy === 'game' ? 'un jeu a démarré' : 'à la demande'}.`)
          return set({ status: 'stopped', fromClipId: started.fromClipId, title: job.title, message: stopWhy === 'game' ? 'Un jeu a démarré : le film est arrêté. Relance-le après ta partie.' : 'Film arrêté.' })
        }
        // Une panne hors du moteur (disque plein, dossier refusé) se raconte comme les autres, après ce qui a déjà raté.
        const attempts: FilmAttempt[] = e instanceof Failed ? lastAttempts : [...lastAttempts, { encoder: 'appli', step: 'fichiers', error: scrub(errText(e), [...[...job.files.values()].map((f) => dirname(f.file)), ...filmEngine.hidden()]) }]
        const report = filmReportText({ at: job.at, shots: job.shots, durationS: job.durationS, ...FORMAT }, attempts, await filmEngine.context())
        log(`Film raté : ${attempts.map((a) => `${a.encoder}, ${a.step} : ${a.error}`).join(' | ')}`)
        const full = (e as NodeJS.ErrnoException)?.code === 'ENOSPC' || attempts.some((a) => /No space left on device/i.test(a.error))
        set({ status: 'failed', fromClipId: started.fromClipId, title: job.title, message: full ? 'Plus assez de place sur le disque pour ce film.' : 'Le film n’a pas pu être fabriqué.', report })
      }
    )
    .catch((e) => {
      log(`Film : ${errText(e)}`)
      set({ status: 'failed', title: job.title, message: 'Le film n’a pas pu être fabriqué.' })
    })
    .finally(() => {
      busy = false
      stopWhy = null
      filmEngine.end()
    })
  return started
}

/** Les essais ratés de la fabrication en cours, pour le texte à copier. */
let lastAttempts: FilmAttempt[] = []

/** Restes d'une fabrication interrompue par une fermeture brutale de l'appli. */
async function cleanOldWork(): Promise<void> {
  const temp = app.getPath('temp')
  for (const n of await readdir(temp).catch(() => [] as string[])) {
    if (n.startsWith(WORK_PREFIX)) await rm(join(temp, n), { recursive: true, force: true }).catch(() => {})
  }
}

async function render(job: Job): Promise<FilmState> {
  const t0 = performance.now()
  lastAttempts = []
  await cleanOldWork()
  const work = await mkdtemp(join(app.getPath('temp'), WORK_PREFIX))
  const sourceFiles = [...job.files.values()].map((f) => f.file)
  const musicPaths = job.mix ? [job.mix.musicFile, dirname(job.mix.musicFile)] : []
  const hide = [work, ...sourceFiles, ...new Set(sourceFiles.map((f) => dirname(f))), ...musicPaths, ...filmEngine.hidden()]
  // Un jeu qui démarre pendant la fabrication : le film s'arrête, le jeu passe avant.
  const watch = setInterval(() => {
    if (gameRunning()) stop('game')
  }, GAME_WATCH_MS)
  let percent = 0
  const progress = (p: number): void => {
    // L'avancement ne recule pas, même quand la fabrication repart avec un autre encodeur.
    if (p <= percent || state.status !== 'running') return
    percent = p
    set({ ...state, percent })
  }
  let part: string | null = null
  try {
    // ----- les plans, avec le premier encodeur qui va au bout -----
    let made: { parts: FilmPart[]; encoder: string; lost: number } | null = null
    for (const encoder of await filmEngine.encoders()) {
      checkStop()
      const r = await renderShots(job, encoder, work, hide, progress)
      if (r) {
        made = { ...r, encoder }
        break
      }
    }
    checkStop()
    if (!made) throw new Failed()
    const totalS = made.parts.reduce((n, p) => n + p.durationS, 0)

    // ----- l'assemblage -----
    await writeFile(join(work, LIST_NAME), joinList(made.parts))
    const target = await filmTarget(job.gameName, job.title, job.at)
    part = target.part
    const read = progressReader()
    let joined = { seconds: 0, end: false }
    const j = await filmEngine.run(joinArgs(LIST_NAME, target.part, job.mix ? { ...job.mix, durationS: totalS } : undefined), work, joinTimeoutMs(totalS), (chunk) => {
      joined = read(chunk)
      progress(percentOf(totalS, totalS, joined.seconds))
    })
    checkStop()
    const size = await stat(target.part).then((s) => s.size, () => 0)
    // Le moteur dit lui-même combien de secondes il a assemblées : un film plus court que prévu est un film raté.
    if (j.code !== 0 || j.timedOut || size < MIN_BYTES || !joined.end || Math.abs(joined.seconds - totalS) > 0.25) {
      const why = j.timedOut ? 'pas de réponse' : j.err || `code ${j.code}, ${joined.seconds.toFixed(2)} s assemblées sur ${totalS.toFixed(2)}, fichier de ${size} octets`
      lastAttempts.push({ encoder: made.encoder, step: 'assemblage', error: scrub(why, [target.part, dirname(target.part), ...hide]) })
      throw new Failed()
    }

    // ----- la vignette (un film sans vignette reste un film) -----
    const thumb = join(work, 'vignette.jpg')
    const t = await filmEngine.run(thumbArgs(target.part, thumb, Math.min(job.thumbAtS + 0.2, totalS / 2)), work, THUMB_TIMEOUT_MS)
    checkStop()
    const hasThumb = t.code === 0 && (await stat(thumb).then((s) => s.size > 0, () => false))
    if (!hasThumb) log(`Film : vignette impossible (${scrub(t.err || `code ${t.code}`, [target.part, dirname(target.part), ...hide])}).`)

    // ----- le film rangé avec les clips -----
    const clip = await addFilm({
      part: target.part,
      file: target.file,
      ...(hasThumb ? { thumb } : {}),
      title: job.title,
      gameId: job.gameId,
      gameName: job.gameName,
      at: job.at,
      shots: job.shots,
      durationS: totalS,
      width: FORMAT.width,
      height: FORMAT.height,
      ...(job.map ? { map: job.map } : {}),
      ...(job.mode ? { mode: job.mode } : {}),
      sessionId: job.sessionId
    })
    part = null
    const seconds = (performance.now() - t0) / 1000
    await filmEngine.remember({ at: job.at, shots: job.shots, durationS: totalS, seconds, encoder: made.encoder })
    const skipped = job.skipped + made.lost
    log(`Film ${clip.id} fabriqué en ${seconds.toFixed(1)} s avec ${made.encoder} : ${job.shots} plan(s), ${totalS.toFixed(1)} s${skipped ? `, ${skipped} clip(s) laissé(s) de côté` : ''}.`)
    return { status: 'done', fromClipId: state.fromClipId, title: clip.title, percent: 100, shots: job.shots, durationS: totalS, clipId: clip.id, ...(skipped ? { skipped } : {}) }
  } finally {
    clearInterval(watch)
    if (part) await unlink(part).catch(() => {})
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Tous les plans avec un encodeur. Un plan raté est laissé de côté et le film continue ; deux plans ratés de suite, ou aucun
 * plan réussi : cet encodeur ne va pas (null), le suivant reprend tout depuis le début.
 */
async function renderShots(job: Job, encoder: string, work: string, hide: readonly string[], progress: (percent: number) => void): Promise<{ parts: FilmPart[]; lost: number } | null> {
  const parts: FilmPart[] = []
  const total = job.pieces.length
  let lost = 0
  let failedInARow = 0
  let doneS = 0
  const giveUp = async (): Promise<null> => {
    for (const p of parts) await rm(join(work, p.name), { force: true }).catch(() => {})
    return null
  }
  for (const [i, shot] of job.pieces.entries()) {
    checkStop()
    const src = job.files.get(shot.clipId)
    if (!src) {
      lost++
      continue
    }
    const name = `p${String(i).padStart(3, '0')}.mov`
    const out = join(work, name)
    const cmd = shotArgs(shot, src, FORMAT, encoder, out, { speed: shot.speed, frames: shot.frames })
    const read = progressReader()
    const r = await filmEngine.run(cmd.args, work, shotTimeoutMs(cmd.durationS), (chunk) => progress(percentOf(doneS + Math.min(read(chunk).seconds, cmd.durationS), job.durationS)))
    checkStop()
    const size = await stat(out).then((s) => s.size, () => 0)
    if (r.code === 0 && !r.timedOut && size >= MIN_BYTES) {
      parts.push({ name, durationS: cmd.durationS })
      failedInARow = 0
    } else {
      lastAttempts.push({ encoder, step: `morceau ${i + 1} sur ${total}`, error: scrub(r.timedOut ? 'pas de réponse' : r.err || `code ${r.code}, fichier de ${size} octets`, hide) })
      await rm(out, { force: true }).catch(() => {})
      if (++failedInARow >= 2) return giveUp()
      lost++
    }
    doneS += cmd.durationS
    progress(percentOf(doneS, job.durationS))
  }
  return parts.length ? { parts, lost } : giveUp()
}

/**
 * Le premier montage proposé par l'éditeur pour ces clips, avec cette musique (ou sans) : des plans calés sur ses temps. Les
 * clips illisibles sont laissés de côté. La page le retouche, puis l'envoie à startFilm.
 */
export async function planFilm(ids: unknown, musicId: unknown): Promise<{ project: EditProject; skipped: number }> {
  const { sources, skipped } = await filmSources(ids)
  if (!sources.length) throw new UserError('Aucun clip lisible pour ce film.')
  const info = typeof musicId === 'string' ? musicInfos().get(musicId) : undefined
  const unit = unitOf(info?.bpm ?? null)
  const shots = planProject(sources, { after: clipAfterSetting(), unit })
  if (!shots.length) throw new UserError('Rien à monter : ces clips sont trop courts.')
  const music = info && typeof musicId === 'string' ? { id: musicId, startS: info.grid[0] ?? 0, volume: 0.9 } : null
  return { project: { v: 2, shots, music, gameVolume: music ? 0.5 : 1 }, skipped }
}
