import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import { getKv, setKv } from '../db'
import { UserError } from '../errors'
import { errText, log } from './clipsLog'
import { progressReader } from './editCompile'
import { scrub } from './editEngineRules'
import { filmEngine } from './editFfmpeg'
import { shareArgs, shareEncoders, sharePercent, sharePlan, shareRetry, shareTimeoutMs, type ShareEncode, type ShareSource } from './sharePlan'

// La copie légère d'un clip pour Discord (bêta 46). Les règles sont dans sharePlan.ts ; ici, les fichiers et le moteur vidéo.
//
// Le clip d'origine n'est jamais touché : la copie se fabrique dans un dossier à part (userData/clips-share/<clip>-<limite>),
// sous le même nom de fichier que le clip, d'abord en « copie.part ». Elle n'est gardée que si son poids passe sous la limite :
// sinon un second essai plus bas, puis l'abandon. Une copie déjà faite resservira (même clip, même limite). Les copies partent
// avec leur clip, et après 7 jours sans servir.
// Le moteur est le même que celui des films (un seul ffmpeg à la fois, priorité basse). Contrairement à un film, une copie peut
// se fabriquer pendant qu'un jeu tourne : c'est le moment où l'on partage un clip, et elle ne dure que quelques secondes.

const ROOT = 'clips-share'
const NOTE = 'copie.json'
const PART = 'copie.part'
const KEEP_MS = 7 * 24 * 3600 * 1000
const ENCODER_KEY = 'clipsShareEncoder'
/** En dessous, le fichier fabriqué n'est pas une vidéo. */
const MIN_BYTES = 1000
const DIR_NAME = /^([0-9a-f]{16})-(\d{1,12})$/

const root = (): string => join(app.getPath('userData'), ROOT)
const mo = (bytes: number): string => `${(bytes / 1e6).toFixed(1).replace('.', ',')} Mo`
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Ce qui est écrit à côté d'une copie, pour savoir si elle peut resservir. */
interface Note {
  v: 1
  /** Fabrication, ou dernière fois qu'elle a servi (ms). */
  at: number
  /** Nom du fichier de la copie, dans son dossier. */
  file: string
  /** Le clip d'origine au moment de la copie : s'il a changé, la copie ne vaut plus. */
  srcSize: number
  srcMtimeMs: number
  sizeBytes: number
  width: number
  height: number
  fps: number
}

export type LightCopy =
  | { kind: 'original' }
  | { kind: 'copy'; file: string; sizeBytes: number; width: number; height: number; fps: number }
  | { kind: 'too-long'; maxS: number }
  /** engine : le moteur vidéo manque ou a été modifié ; encode : aucun encodeur n'a fabriqué une copie sous la limite. */
  | { kind: 'unmade'; reason: 'engine' | 'encode' }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

async function readNote(dir: string): Promise<Note | null> {
  try {
    const n = JSON.parse(await readFile(join(dir, NOTE), 'utf8')) as Record<string, unknown>
    if (n.v !== 1 || typeof n.file !== 'string' || basename(n.file) !== n.file || !/\.mp4$/i.test(n.file)) return null
    if (![n.at, n.srcSize, n.srcMtimeMs, n.sizeBytes, n.width, n.height, n.fps].every(num)) return null
    return n as unknown as Note
  } catch {
    return null
  }
}

/** Sous Windows, un antivirus peut tenir un instant le fichier que le moteur vient de fermer. */
async function renameSoon(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to)
      return
    } catch (e) {
      if (i === 9 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e
      await sleep(300)
    }
  }
}

let busy = false

/**
 * Ce qu'il faut mettre dans le presse-papiers pour que ce clip passe sous `limit` octets : le clip lui-même (original), une
 * copie plus légère (fabriquée ici, ou déjà faite), ou rien (trop long, ou copie impossible). `onPercent` suit la fabrication.
 */
export async function lightCopy(clip: { id: string; file: string; mtimeMs: number }, src: ShareSource, limit: number, onPercent: (percent: number) => void): Promise<LightCopy> {
  const plan = sharePlan(src, limit)
  if (plan.kind !== 'encode') return plan
  if (busy) throw new UserError('Une copie est déjà en préparation.')
  busy = true
  try {
    const dir = join(root(), `${clip.id}-${limit}`)
    const name = basename(clip.file).replace(/\.[^.]*$/, '') + '.mp4'
    // ----- une copie déjà faite pour ce clip et cette limite -----
    const old = await readNote(dir)
    if (old && old.srcSize === src.sizeBytes && old.srcMtimeMs === clip.mtimeMs && old.sizeBytes <= limit && (await stat(join(dir, old.file)).then((s) => s.size === old.sizeBytes, () => false))) {
      // Le clip a pu être renommé depuis : la copie suit son nom. Si elle est encore ouverte ailleurs, elle garde l'ancien.
      const file = old.file === name ? name : await renameSoon(join(dir, old.file), join(dir, name)).then(() => name, () => old.file)
      await writeFile(join(dir, NOTE), JSON.stringify({ ...old, file, at: Date.now() } satisfies Note)).catch((e) => log(`Copie pour Discord : note non écrite (${errText(e)}).`))
      log(`Copie pour Discord du clip ${clip.id} : déjà faite (${mo(old.sizeBytes)}), reprise.`)
      return { kind: 'copy', file: join(dir, file), sizeBytes: old.sizeBytes, width: old.width, height: old.height, fps: old.fps }
    }
    // ----- la fabrication -----
    if ((await filmEngine.status()) !== 'ready') {
      log(`Copie pour Discord du clip ${clip.id} impossible : le moteur vidéo manque ou a été modifié.`)
      return { kind: 'unmade', reason: 'engine' }
    }
    if (!filmEngine.begin('share')) throw new UserError('Le moteur vidéo est occupé (un film ou un essai). Réessaie après.')
    try {
      await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })
      const made = await encode(clip, src, plan, limit, dir, onPercent)
      if (!made) {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
        return { kind: 'unmade', reason: 'encode' }
      }
      await renameSoon(join(dir, PART), join(dir, name))
      const p = made.plan
      await writeFile(join(dir, NOTE), JSON.stringify({ v: 1, at: Date.now(), file: name, srcSize: src.sizeBytes, srcMtimeMs: clip.mtimeMs, sizeBytes: made.sizeBytes, width: p.width, height: p.height, fps: p.fps } satisfies Note))
      setKv(ENCODER_KEY, made.encoder)
      log(`Copie pour Discord du clip ${clip.id} : ${p.width} × ${p.height} à ${p.fps} images/s, ${mo(made.sizeBytes)} (limite ${mo(limit)}, clip de ${mo(src.sizeBytes)}), ${made.encoder}, ${made.seconds.toFixed(1)} s.`)
      return { kind: 'copy', file: join(dir, name), sizeBytes: made.sizeBytes, width: p.width, height: p.height, fps: p.fps }
    } catch (e) {
      // Une panne autour du moteur (disque plein, dossier refusé, clip effacé pendant la copie) : dite au journal, sans chemin,
      // et la page propose l'original. Le message brut citerait des dossiers du PC.
      log(`Copie pour Discord du clip ${clip.id} impossible : ${scrub(errText(e), [dir, root(), clip.file, dirname(clip.file), ...filmEngine.hidden()])}`)
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      return { kind: 'unmade', reason: 'encode' }
    } finally {
      filmEngine.end()
    }
  } finally {
    busy = false
  }
}

/**
 * La copie avec le premier encodeur qui va au bout. Un encodeur qui rate (pilote, carte absente) laisse la place au suivant.
 * Un encodeur qui marche mais dépasse la limite a droit à un second essai plus bas ; s'il dépasse encore, on s'arrête là.
 */
async function encode(clip: { id: string; file: string }, src: ShareSource, plan: ShareEncode, limit: number, dir: string, onPercent: (percent: number) => void): Promise<{ encoder: string; sizeBytes: number; plan: ShareEncode; seconds: number } | null> {
  const part = join(dir, PART)
  const hide = [dir, root(), clip.file, dirname(clip.file), ...filmEngine.hidden()]
  let shown = 0
  for (const encoder of shareEncoders(await filmEngine.encoders(), getKv<unknown>(ENCODER_KEY, null))) {
    let p = plan
    for (let attempt = 1; attempt <= 2; attempt++) {
      const read = progressReader()
      let done = { seconds: 0, end: false }
      const t0 = performance.now()
      const r = await filmEngine.run(shareArgs(clip.file, p, encoder, part), dir, shareTimeoutMs(src.durationS), (chunk) => {
        done = read(chunk)
        // L'avancement ne recule pas, même quand la fabrication repart (autre encodeur, second essai).
        const percent = sharePercent(done.seconds, src.durationS)
        if (percent > shown) {
          shown = percent
          onPercent(percent)
        }
      })
      const size = await stat(part).then((s) => s.size, () => 0)
      // Le moteur dit lui-même combien de secondes il a fabriquées : une copie nettement plus courte que le clip est ratée.
      const whole = done.end && done.seconds >= src.durationS * 0.9 - 1
      if (r.code !== 0 || r.timedOut || size < MIN_BYTES || !whole) {
        log(`Copie pour Discord, ${encoder} raté : ${scrub(r.timedOut ? 'pas de réponse' : r.err || `code ${r.code}, ${done.seconds.toFixed(1)} s fabriquées sur ${src.durationS.toFixed(1)}, fichier de ${size} octets`, hide)}`)
        await rm(part, { force: true }).catch(() => {})
        break
      }
      if (size <= limit) return { encoder, sizeBytes: size, plan: p, seconds: (performance.now() - t0) / 1000 }
      await rm(part, { force: true }).catch(() => {})
      if (attempt === 2) {
        log(`Copie pour Discord, ${encoder} : ${mo(size)} au second essai, toujours plus que la limite de ${mo(limit)}. Abandon.`)
        return null
      }
      log(`Copie pour Discord, ${encoder} : ${mo(size)} obtenus pour une limite de ${mo(limit)}, second essai plus bas.`)
      p = shareRetry(p, size, limit)
    }
  }
  return null
}

/** Les copies d'un clip supprimé partent avec lui. */
export async function dropShareCopies(id: string): Promise<void> {
  if (!/^[0-9a-f]{16}$/.test(id)) return
  const names = await readdir(root()).catch(() => [] as string[])
  for (const n of names) if (n.startsWith(`${id}-`) && DIR_NAME.test(n)) await rm(join(root(), n), { recursive: true, force: true }).catch((e) => log(`Copie pour Discord non effacée : ${errText(e)}`))
}

/**
 * Au démarrage : les copies de clips disparus, celles qui n'ont pas servi depuis 7 jours, et les restes d'une fabrication
 * interrompue par une fermeture brutale.
 */
export async function cleanShareCopies(known: ReadonlySet<string>, now = Date.now()): Promise<void> {
  const names = await readdir(root()).catch(() => [] as string[])
  for (const n of names) {
    const dir = join(root(), n)
    const m = DIR_NAME.exec(n)
    const note = m && known.has(m[1]) ? await readNote(dir) : null
    if (!note || now - note.at > KEEP_MS || note.at > now + KEEP_MS) await rm(dir, { recursive: true, force: true }).catch(() => {})
    else await rm(join(dir, PART), { force: true }).catch(() => {})
  }
}
