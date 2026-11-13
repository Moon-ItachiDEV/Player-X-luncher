import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { app, shell } from 'electron'
import pin from '@shared/ffmpegPin.json'
import type { EditEncoderResult, EditEngine, EditEngineStep, EditEngineTest, EditLastFilm } from '@shared/types'
import { getKv, setKv } from '../db'
import { UserError } from '../errors'
import { FILM_FORMAT, joinArgs, joinList, progressReader, shotArgs, type ShotSource } from './editCompile'
import { cleanLastFilm, cleanTest, CLIP_SAMPLE_S, encoderOrder, ENCODERS, gpuText, parseEncoders, parseVersion, pickBest, reportText, SAMPLE, sampleArgs, scrub } from './editEngineRules'

// Le moteur vidéo : FFmpeg, livré tel quel à côté de l'appli (resources/ffmpeg/ffmpeg.exe, avec sa licence et l'adresse de
// ses sources). Player X le lance comme un programme à part, en priorité basse, sans passer par un interpréteur de commandes,
// avec des arguments écrits ici (editEngineRules.ts) : la page n'envoie jamais ni chemin ni commande.
// Rien ne tourne au démarrage de l'appli : le fichier n'est vérifié, puis lancé, que quand on en a besoin.

/** Le dernier clip gardé, tel que l'essai du moteur en a besoin. */
export interface EngineClip extends ShotSource {
  durationS: number
  width: number
  height: number
}

/**
 * Ce que le moteur demande au reste de l'appli, sans l'importer. La capture des clips (clips.ts) lance déjà le moteur : quand
 * le moteur importait clips.ts en retour, chacun des deux fichiers dépendait de l'autre. Branché au démarrage (index.ts).
 */
export interface EngineHost {
  /** Un jeu tourne : pas d'essai du moteur pendant une partie. */
  gameRunning(): boolean
  /** Le dernier clip gardé, pour l'essai sur un vrai clip ; null s'il n'y en a aucun. */
  newestClipSource(): Promise<EngineClip | null>
}

let host: EngineHost | null = null

export function setEngineHost(h: EngineHost): void {
  host = h
}

/** Un oubli de branchement doit se voir tout de suite : sans ça, l'essai croirait qu'aucun jeu ne tourne. */
function wired(): EngineHost {
  if (!host) throw new Error('Moteur vidéo : setEngineHost n’a pas été appelé au démarrage.')
  return host
}
const gameRunning = (): boolean => wired().gameRunning()
const newestClipSource = (): Promise<EngineClip | null> => wired().newestClipSource()

const TEST_KEY = 'editEngineTest'
const LAST_FILM_KEY = 'editLastFilm'
/** Un essai d'encodeur qui ne répond pas est coupé : un pilote graphique en panne peut ne jamais rendre la main. */
const SAMPLE_TIMEOUT_MS = 30_000
/** L'essai sur le dernier clip : 20 s de film au plus, par le chemin d'un vrai film. */
const CLIP_TIMEOUT_MS = 120_000
const INFO_TIMEOUT_MS = 15_000
const MAX_OUT = 512 * 1024
const MAX_ERR = 4096
/** En dessous, le fichier d'essai n'est pas un film (quelques secondes à 16 Mb/s pèsent des mégaoctets). */
const MIN_BYTES = 10_000

/** En développement seulement (jamais dans la version installée) : un autre ffmpeg, et un encodeur d'essai en plus. */
const devFile = (): string | undefined => (app.isPackaged ? undefined : process.env.PX_FFMPEG || undefined)
const devEncoder = (): string | undefined => (app.isPackaged ? undefined : process.env.PX_FFMPEG_ENCODER || undefined)

function engineFile(): string {
  return devFile() ?? join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'vendor'), 'ffmpeg', 'ffmpeg.exe')
}

// ---------- le fichier : présent, et le même qu'à l'installation ----------

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')))
  })
}

/** L'empreinte se calcule une fois par fichier (132 Mo), pas à chaque question : la clé change si le fichier change. */
let verified: { key: string; ok: Promise<boolean> } | null = null

async function fileStatus(): Promise<EditEngine['status']> {
  const file = engineFile()
  const s = await stat(file).catch(() => null)
  if (!s?.isFile()) return 'missing'
  // Le ffmpeg de développement n'a pas d'empreinte connue.
  if (devFile()) return 'ready'
  if (s.size !== pin.exeSize) return 'damaged'
  const key = `${file}:${s.size}:${s.mtimeMs}`
  if (verified?.key !== key) verified = { key, ok: sha256(file).then((h) => h === pin.exeSha256, () => false) }
  return (await verified.ok) ? 'ready' : 'damaged'
}

// ---------- lancer ffmpeg ----------

export interface EngineRun {
  /** null : il n'a pas démarré, ou il a été coupé. */
  code: number | null
  seconds: number
  out: string
  err: string
  timedOut: boolean
}

/** Un seul ffmpeg à la fois. */
let child: ChildProcess | null = null
let quitHooked = false

function run(args: string[], cwd: string, timeoutMs: number, onOut?: (chunk: string) => void, priority: 'low' | 'normal' = 'low'): Promise<EngineRun> {
  return new Promise((resolve) => {
    const t0 = performance.now()
    let out = ''
    let err = ''
    let timedOut = false
    let done = false
    const env = { ...process.env }
    // Ces variables feraient écrire un journal à ffmpeg, ou lui feraient lire des préréglages, ailleurs que dans son dossier
    // d'essai. Sous Windows, la casse d'un nom de variable ne compte pas.
    for (const k of Object.keys(env)) if (/^(FFREPORT|FFMPEG_DATADIR)$/i.test(k)) delete env[k]
    const file = engineFile()
    // Le moteur livré est un programme Windows : ailleurs (développement sous Linux), il n'est jamais lancé, même par Wine.
    if (process.platform !== 'win32' && /\.exe$/i.test(file)) {
      resolve({ code: null, seconds: 0, out: '', err: 'ce moteur est fait pour Windows', timedOut: false })
      return
    }
    let p: ChildProcess
    try {
      p = spawn(file, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ code: null, seconds: 0, out: '', err: e instanceof Error ? e.message : String(e), timedOut: false })
      return
    }
    child = p
    if (!quitHooked) {
      quitHooked = true
      app.on('will-quit', () => child?.kill())
    }
    const timer = setTimeout(() => {
      timedOut = true
      p.kill()
    }, timeoutMs)
    const end = (code: number | null, extra = ''): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (child === p) child = null
      resolve({ code, seconds: (performance.now() - t0) / 1000, out, err: err + extra, timedOut })
    }
    p.stdout?.setEncoding('utf8').on('data', (d: string) => {
      if (out.length < MAX_OUT) out += d
      // L'avancement d'un film se lit au fil de l'eau.
      onOut?.(d)
    })
    p.stderr?.setEncoding('utf8').on('data', (d: string) => {
      err = (err + d).slice(-MAX_ERR)
    })
    p.once('error', (e) => end(null, e.message))
    p.once('close', (code) => end(code))
    try {
      // Priorité basse : un rendu ne doit jamais gêner un jeu ni le reste du PC.
      // Sauf l'essai de capture : il doit suivre le jeu comme le ferait l'enregistrement.
      if (p.pid && priority === 'low') os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      /* la priorité normale fera l'affaire */
    }
  })
}

// ---------- l'état, pour Paramètres › Montage ----------

let devVersion: Promise<string> | null = null
const UNKNOWN = 'inconnue'

/** La version livrée est connue d'avance ; celle d'un ffmpeg de développement se demande, une fois. */
function engineVersion(): Promise<string> {
  if (!devFile()) return Promise.resolve(pin.version)
  devVersion ??= run(['-hide_banner', '-version'], os.tmpdir(), INFO_TIMEOUT_MS).then((r) => parseVersion(r.out) || UNKNOWN)
  return devVersion
}

/** Les cartes graphiques vues par l'appli, sans lancer de diagnostic long : marque et numéro de modèle. */
async function gpus(): Promise<string> {
  const info = (await app.getGPUInfo('basic').catch(() => null)) as { gpuDevice?: { vendorId?: number; deviceId?: number }[] } | null
  return gpuText(info?.gpuDevice ?? [])
}

async function reportContext(): Promise<{ app: string; build: string; system: string }> {
  const cpu = (os.cpus()[0]?.model ?? 'processeur inconnu').replace(/\s+/g, ' ').trim()
  // os.cpus() compte les cœurs logiques (ceux que Windows montre), pas les cœurs physiques.
  const system = `${process.platform === 'win32' ? 'Windows' : os.type()} ${os.release()} · ${cpu} · ${os.cpus().length} cœurs logiques · ${Math.round(os.totalmem() / 2 ** 30)} Go · carte graphique : ${await gpus()}`
  return { app: app.getVersion(), build: devFile() ? 'ffmpeg de développement' : pin.build, system }
}

let testing: Promise<EditEngine> | null = null
let stopAsked = false
/**
 * Ce qui tient le moteur : un film (services/editFilm.ts) ou, depuis la bêta 46, une copie pour Discord (clipsShare.ts). Pas
 * d'essai pendant ce temps, un seul ffmpeg à la fois.
 */
let holder: 'film' | 'share' | null = null

export async function engine(): Promise<EditEngine> {
  const status = await fileStatus()
  const version = status === 'ready' ? await engineVersion() : pin.version
  const test = status === 'ready' ? cleanTest(getKv<unknown>(TEST_KEY, null), version) : null
  return { status, version, testing: testing !== null, ...(test ? { test, report: reportText(test, await reportContext(), cleanLastFilm(getKv<unknown>(LAST_FILM_KEY, null))) } : {}) }
}

// ---------- l'essai sur ce PC ----------

/**
 * Essaie chaque encodeur sur 5 s de mire (il marche ou non), puis le meilleur sur le dernier clip, par le chemin d'un vrai
 * film : un plan de 20 s au plus, puis l'assemblage (c'est cet essai-là qui dit la vitesse). Tout se passe dans un dossier
 * temporaire à part, effacé à la fin. Un seul essai à la fois : un second appel attend le premier.
 */
export function testEngine(onStep: (s: EditEngineStep) => void): Promise<EditEngine> {
  testing ??= doTest(onStep)
    .finally(() => {
      testing = null
    })
    .then(() => engine())
  return testing
}

/** Arrête l'essai en cours (bouton « Arrêter ») : rien n'est enregistré. */
export function stopEngineTest(): void {
  if (!testing) return
  stopAsked = true
  child?.kill()
}

async function doTest(onStep: (s: EditEngineStep) => void): Promise<void> {
  stopAsked = false
  const status = await fileStatus()
  if (status === 'missing') throw new UserError('Le moteur vidéo manque. Réinstalle Player X V3 Test pour le remettre.')
  if (status === 'damaged') throw new UserError('Le moteur vidéo a été modifié depuis l’installation. Réinstalle Player X V3 Test pour le remettre.')
  if (gameRunning()) throw new UserError('Un jeu tourne. Teste le moteur après ta partie : l’essai gênerait ton jeu.')
  if (holder === 'share') throw new UserError('Une copie pour Discord est en préparation. Teste le moteur dans quelques secondes.')
  if (holder) throw new UserError('Un film est en cours de fabrication. Teste le moteur quand il sera prêt.')
  const work = await mkdtemp(join(app.getPath('temp'), 'px-moteur-'))
  const hide = [work, app.getPath('temp'), app.getPath('home')]
  const stopped = (): void => {
    if (stopAsked) throw new UserError('Essai arrêté.')
  }
  try {
    const results: EditEncoderResult[] = []
    const started = await run(['-hide_banner', '-version'], work, INFO_TIMEOUT_MS)
    stopped()
    const parsed = parseVersion(started.out)
    // Le numéro enregistré est celui du moteur livré : c'est lui qui dit, plus tard, si l'essai vaut toujours.
    const version = devFile() ? parsed || UNKNOWN : pin.version
    if (!parsed) {
      // Il ne démarre pas (antivirus, fichier bloqué) : c'est un résultat aussi, et il se copie comme les autres.
      results.push({ id: 'demarrage', ok: false, error: scrub(started.timedOut ? 'pas de réponse' : started.err || `code ${started.code}`, hide) })
    } else {
      const listed = await run(['-hide_banner', '-encoders'], work, INFO_TIMEOUT_MS)
      stopped()
      const dev = devEncoder()
      const wanted = [...ENCODERS, ...(dev ? [dev] : [])]
      const known = new Set(parseEncoders(listed.out, wanted))
      const clip = await newestClipSource()
      const clipS = clip ? Math.min(CLIP_SAMPLE_S, Math.floor(clip.durationS * 10) / 10) : 0
      const total = wanted.length + (clip && clipS >= 1 ? 1 : 0)
      for (const [i, id] of wanted.entries()) {
        onStep({ index: i + 1, total, what: id })
        if (!known.has(id)) {
          results.push({ id, ok: false, error: 'absent de ce moteur' })
          continue
        }
        const out = join(work, `${id}.mp4`)
        const r = await run(sampleArgs(id, out), work, SAMPLE_TIMEOUT_MS)
        stopped()
        const size = await stat(out).then((s) => s.size, () => 0)
        if (r.code === 0 && !r.timedOut && size >= MIN_BYTES) results.push({ id, ok: true, seconds: r.seconds })
        else results.push({ id, ok: false, error: scrub(r.timedOut ? `pas de réponse en ${SAMPLE_TIMEOUT_MS / 1000} s` : r.err || `code ${r.code}, fichier de ${size} octets`, hide) })
        await rm(out, { force: true })
      }
      const best = pickBest(results)
      let clipResult: EditEngineTest['clip']
      if (best && clip && clipS >= 1) {
        onStep({ index: total, total, what: 'clip' })
        // Les mêmes commandes qu'un film : un plan (le début du clip), puis l'assemblage.
        const part = 'p000.mov'
        const out = join(work, 'clip.mp4')
        const cmd = shotArgs({ inS: 0, outS: clipS }, clip, FILM_FORMAT, best, join(work, part))
        const base = { sampleS: cmd.durationS, width: clip.width, height: clip.height, audio: clip.hasAudio }
        const hideClip = [clip.file, dirname(clip.file), ...hide]
        const failed = (step: string, r: EngineRun, size: number): EditEngineTest['clip'] => ({ ok: false, ...base, error: scrub(`${step} : ${r.timedOut ? `pas de réponse en ${CLIP_TIMEOUT_MS / 1000} s` : r.err || `code ${r.code}, fichier de ${size} octets`}`, hideClip) })
        const shot = await run(cmd.args, work, CLIP_TIMEOUT_MS)
        stopped()
        const shotSize = await stat(join(work, part)).then((s) => s.size, () => 0)
        if (shot.code !== 0 || shot.timedOut || shotSize < MIN_BYTES) clipResult = failed('plan', shot, shotSize)
        else {
          await writeFile(join(work, 'liste.txt'), joinList([{ name: part, durationS: cmd.durationS }]))
          const read = progressReader()
          let joined = { seconds: 0, end: false }
          const j = await run(joinArgs('liste.txt', out), work, CLIP_TIMEOUT_MS, (chunk) => {
            joined = read(chunk)
          })
          stopped()
          const size = await stat(out).then((s) => s.size, () => 0)
          // Comme pour un film : le moteur dit lui-même combien de secondes il a assemblées.
          clipResult = j.code === 0 && !j.timedOut && size >= MIN_BYTES && joined.end && Math.abs(joined.seconds - cmd.durationS) <= 0.25 ? { ok: true, seconds: shot.seconds + j.seconds, ...base } : failed('assemblage', j, size)
        }
      }
      const test: EditEngineTest = { at: Date.now(), version, sampleS: SAMPLE.seconds, encoders: results, best, ...(clipResult ? { clip: clipResult } : {}) }
      setKv(TEST_KEY, test)
      return
    }
    setKv(TEST_KEY, { at: Date.now(), version, sampleS: SAMPLE.seconds, encoders: results, best: null } satisfies EditEngineTest)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

// ---------- pour la fabrication des films (services/editFilm.ts) ----------

const FILM_ENCODER_KEY = 'editFilmEncoder'

/**
 * Le moteur, pour un film ou une copie pour Discord : son état, puis `run` pour lancer ffmpeg (un seul à la fois, priorité
 * basse, sortie standard au fil de l'eau) et `stop` pour couper le film qui tourne. `begin` renvoie faux si un essai du moteur,
 * un film ou une copie tient déjà le moteur (`heldBy` dit lequel des deux derniers) ; `end` rend la main.
 */
export const filmEngine = {
  status: (): Promise<EditEngine['status']> => fileStatus(),
  begin(who: 'film' | 'share' = 'film'): boolean {
    if (testing || holder) return false
    holder = who
    return true
  },
  end(): void {
    holder = null
  },
  heldBy: (): 'film' | 'share' | null => holder,
  run: (args: string[], cwd: string, timeoutMs: number, onOut?: (chunk: string) => void, priority: 'low' | 'normal' = 'low'): Promise<EngineRun> => run(args, cwd, timeoutMs, onOut, priority),
  /** Coupe le film en cours. Jamais une copie pour Discord : elle ne dure que quelques secondes. */
  stop(): void {
    if (holder === 'film') child?.kill()
  },
  /** Les encodeurs à essayer, dans l'ordre (le dernier qui a fabriqué un film, ceux de l'essai, puis les autres). */
  async encoders(): Promise<string[]> {
    const version = await engineVersion()
    const last = getKv<{ version?: unknown; id?: unknown } | null>(FILM_ENCODER_KEY, null)
    return encoderOrder(cleanTest(getKv<unknown>(TEST_KEY, null), version), last && last.version === version && typeof last.id === 'string' ? last.id : null, devEncoder())
  },
  /** Cet encodeur vient de fabriquer un film : il passera en premier la prochaine fois, et le film se lit dans le résultat à copier. */
  async remember(film: EditLastFilm): Promise<void> {
    setKv(FILM_ENCODER_KEY, { version: await engineVersion(), id: film.encoder })
    setKv(LAST_FILM_KEY, film)
  },
  /** Version de l'appli, version et build du moteur, ligne sur le PC : pour le texte d'un film raté. */
  context: async (): Promise<{ app: string; version: string; build: string; system: string }> => ({ ...(await reportContext()), version: await engineVersion() }),
  /** Ce qu'un message du moteur ne doit pas dire : le dossier temporaire et le dossier de la session. */
  hidden: (): string[] => [app.getPath('temp'), app.getPath('home')]
}

/** Ouvre le dossier du moteur : sa licence (LICENSE.txt) et l'adresse de ses sources (SOURCE.txt) y sont. */
export async function openEngineFolder(): Promise<void> {
  const err = await shell.openPath(dirname(engineFile()))
  if (err) throw new UserError('Le dossier du moteur vidéo n’a pas pu s’ouvrir.')
}

// ---------- pour la capture des clips (bêta 42) ----------

/**
 * Le moteur pour la capture des clips : un processus qui dure toute la partie, indépendant de celui des films (pas de verrou
 * commun), en priorité normale. null : le moteur ne peut pas être lancé ici (programme Windows ailleurs que sous Windows).
 */
export function spawnCaptureEngine(args: string[], cwd: string): ChildProcess | null {
  const file = engineFile()
  if (process.platform !== 'win32' && /\.exe$/i.test(file)) return null
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (/^(FFREPORT|FFMPEG_DATADIR)$/i.test(k)) delete env[k]
  try {
    const p = spawn(file, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    // Player X se ferme : le moteur s'arrête avec lui. L'écoute reste tant que le processus peut encore tourner, et part
    // quand il est fini (« close »). Avant, il en restait une par lancement (chaque tentative de capture, chaque clip écrit,
    // chaque vignette), jamais retirée de toute la session.
    const kill = (): void => void p.kill()
    app.once('will-quit', kill)
    p.once('close', () => void app.removeListener('will-quit', kill))
    // Le programme n'a pas pu démarrer : Node le dit par « error », puis par « close » avec un code négatif, à condition que
    // quelqu'un écoute « error ». Sans écoute (la vignette d'un clip n'en avait pas), « error » devient une exception et
    // « close » n'arrive jamais : sur la vraie appli, la vignette ratée ne laissait alors aucune ligne dans le journal.
    // L'échec n'est pas caché par cette écoute vide : chaque appelant le lit dans « close ».
    p.on('error', () => {})
    return p
  } catch {
    return null
  }
}

/** Le moteur est-il prêt (installé, intact) ? */
export const captureEngineReady = async (): Promise<boolean> => (await fileStatus()) === 'ready'
