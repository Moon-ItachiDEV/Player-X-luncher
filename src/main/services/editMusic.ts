import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { app, dialog } from 'electron'
import { tempoApply, type TempoFactor } from '@shared/editShots'
import type { EditMusic, EditMusicTempo } from '@shared/types'
import { getKv, setKv } from '../db'
import { UserError } from '../errors'
import { mainWindow } from '../windows'
import { errText, log } from './clipsLog'
import { BEAT_RATE, detectBeats } from './editBeats'
import { scrub } from './editEngineRules'
import { filmEngine } from './editFfmpeg'
import { AUDIO_EXT, extOf, MUSIC_ID, musicMime } from './editMusicRules'

// Les musiques des films : le joueur choisit un fichier de son PC dans une fenêtre de Windows (Player X n'en fournit pas).
// Le moteur vidéo le décode une fois (10 premières minutes, mono, passe-bas : le kick) pour trouver ses temps (editBeats.ts).
// La liste est gardée dans la base, avec le chemin : le chemin ne quitte jamais le processus principal, la page ne reçoit que
// des identifiants, des noms de fichier, des durées et des temps.

const KEY = 'editMusic'
const MAX_KEPT = 12
const MAX_BYTES = 300 * 1024 * 1024
const ANALYSE_S = 600
const ANALYSE_TIMEOUT_MS = 120_000
const ID = MUSIC_ID

interface Kept extends Omit<EditMusic, 'missing' | 'factor' | 'half' | 'bpm0'> {
  file: string
  size: number
  /** Lot A : le tempo et les temps tels que le détecteur les a trouvés. `bpm` et `grid` sont ceux de la correction du joueur. */
  bpm0?: number | null
  grid0?: number[]
  factor?: TempoFactor
  half?: boolean
}

function kept(): Kept[] {
  const raw = getKv<unknown>(KEY, [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Kept => !!x && typeof x === 'object' && typeof (x as Kept).id === 'string' && ID.test((x as Kept).id) && typeof (x as Kept).file === 'string' && Array.isArray((x as Kept).grid))
    .slice(0, MAX_KEPT)
}

const pub = (k: Kept, missing = false): EditMusic => ({
  id: k.id,
  name: k.name,
  durationS: k.durationS,
  bpm: k.bpm,
  grid: k.grid,
  bpm0: k.bpm0 !== undefined ? k.bpm0 : k.bpm,
  factor: k.factor ?? 1,
  half: k.half ?? false,
  ...(missing ? { missing: true } : {})
})

/** Les musiques déjà choisies, la plus récente en tête. Un fichier disparu est signalé, pas retiré. */
export async function musicList(): Promise<EditMusic[]> {
  return Promise.all(kept().map(async (k) => pub(k, !(await stat(k.file).then((s) => s.isFile(), () => false)))))
}

/** Oublie une musique de la liste (le fichier n'est pas touché). */
export function forgetMusic(id: unknown): EditMusic[] {
  const list = kept().filter((k) => k.id !== id)
  setKv(KEY, list)
  return list.map((k) => pub(k))
}

/** Le fichier d'une musique, pour la fabrication d'un film (processus principal seulement). */
export async function musicFile(id: string): Promise<{ file: string; info: EditMusic } | null> {
  const k = kept().find((x) => x.id === id)
  if (!k) return null
  if (!(await stat(k.file).then((s) => s.isFile(), () => false))) return null
  return { file: k.file, info: pub(k) }
}

/**
 * Pour pxclip://music/<identifiant> (aperçu de l'éditeur) : le fichier d'une musique connue, avec son type. Le type vient de
 * l'extension relue sur le fichier gardé (liste fermée, wma exclu) ; la taille doit être celle qu'on a gardée, sinon le fichier a
 * changé depuis le choix et on ne le sert pas.
 */
export async function musicServe(id: string): Promise<{ file: string; type: string } | null> {
  if (!ID.test(id)) return null
  const k = kept().find((x) => x.id === id)
  if (!k) return null
  const type = musicMime(k.file)
  if (!type) return null
  const st = await stat(k.file).catch(() => null)
  if (!st?.isFile() || st.size !== k.size) return null
  return { file: k.file, type }
}

/**
 * Corrige le tempo d'une musique : toujours calculé depuis les temps d'origine (grid0, bpm0), jamais depuis la grille déjà
 * corrigée. factor 0,5 : la moitié ; 2 : le double ; half : chaque temps avance d'un demi-temps. La fabrication relit la même
 * grille par musicInfos(). Un tempo hors des bornes du montage (40 à 250) est refusé.
 */
export function musicTempo(id: unknown, opts: unknown): EditMusic {
  const o = (opts && typeof opts === 'object' ? opts : {}) as { factor?: unknown; half?: unknown }
  const factor = o.factor === 0.5 || o.factor === 1 || o.factor === 2 ? o.factor : null
  if (typeof id !== 'string' || !ID.test(id) || factor === null || typeof o.half !== 'boolean') throw new UserError('Cette correction du tempo est refusée.')
  const list = kept()
  const k = list.find((x) => x.id === id)
  if (!k) throw new UserError('Cette musique n’est plus dans la liste. Choisis-la à nouveau.')
  const grid0 = k.grid0 ?? k.grid
  const bpm0 = k.bpm0 !== undefined ? k.bpm0 : k.bpm
  const r = tempoApply(grid0, bpm0, factor, o.half)
  if (!r) throw new UserError('Ce tempo sort des limites du montage (40 à 250 temps par minute).')
  const next: Kept = { ...k, grid0, bpm0, factor, half: o.half, grid: r.grid, bpm: r.bpm }
  setKv(KEY, list.map((x) => (x.id === id ? next : x)))
  return pub(next)
}

/** Les infos utiles à la vérification d'un projet : tempo, temps, durée. */
export function musicInfos(): Map<string, { bpm: number | null; grid: number[]; durationS: number }> {
  return new Map(kept().map((k) => [k.id, { bpm: k.bpm, grid: k.grid, durationS: k.durationS }]))
}

/**
 * Ouvre la fenêtre de Windows pour choisir une musique, puis cherche ses temps. null : le joueur a fermé la fenêtre.
 * Développement seulement : PX_MUSIC_PICK donne le fichier sans fenêtre (essais automatiques).
 */
export async function pickMusic(): Promise<EditMusic | null> {
  let file: string | undefined
  const dev = !app.isPackaged ? process.env.PX_MUSIC_PICK : undefined
  if (dev) file = dev
  else {
    const parent = mainWindow()
    const options: Electron.OpenDialogOptions = { title: 'Choisir une musique', properties: ['openFile'], filters: [{ name: 'Musique', extensions: AUDIO_EXT }] }
    const res = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options))
    if (res.canceled || !res.filePaths[0]) return null
    file = res.filePaths[0]
  }
  const ext = extOf(file)
  if (!AUDIO_EXT.includes(ext)) throw new UserError('Ce fichier n’est pas une musique. Choisis un MP3, WAV, FLAC, OGG, OPUS, M4A ou AAC.')
  const st = await stat(file).catch(() => null)
  if (!st?.isFile()) throw new UserError('Ce fichier n’a pas pu être lu.')
  if (st.size > MAX_BYTES) throw new UserError('Ce fichier est trop gros pour une musique (300 Mo au plus).')
  const already = kept().find((k) => k.file === file && k.size === st.size)
  if (already) {
    setKv(KEY, [already, ...kept().filter((k) => k.id !== already.id)])
    return pub(already)
  }
  const status = await filmEngine.status()
  if (status !== 'ready') throw new UserError('Le moteur vidéo manque ou a été modifié. Réinstalle Player X V3 Test pour le remettre.')
  if (!filmEngine.begin()) throw new UserError('Le moteur vidéo est occupé (un film ou un essai). Réessaie dans un instant.')
  const work = await mkdtemp(join(app.getPath('temp'), 'px-music-'))
  try {
    const raw = join(work, 'son.raw')
    // Les 10 premières minutes, sans image, en mono à 11 025 Hz, passe-bas à 150 Hz : ce qu'il faut pour entendre le kick.
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file', '-t', String(ANALYSE_S), '-i', `file:${file}`, '-vn', '-af', 'lowpass=f=150', '-ac', '1', '-ar', String(BEAT_RATE), '-f', 'f32le', `file:${raw}`]
    const r = await filmEngine.run(args, work, ANALYSE_TIMEOUT_MS)
    const buf = r.code === 0 ? await readFile(raw).catch(() => null) : null
    if (!buf || buf.length < BEAT_RATE * 4 * 2) {
      log(`Musique illisible : ${scrub(r.timedOut ? 'pas de réponse' : r.err || `code ${r.code}`, [file, dirname(file), work, ...filmEngine.hidden()])}`)
      throw new UserError('Cette musique n’a pas pu être lue. Essaie un autre fichier (MP3 ou WAV).')
    }
    const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
    const t0 = performance.now()
    const beats = detectBeats(samples)
    const durationS = Math.round((samples.length / BEAT_RATE) * 1000) / 1000
    const k: Kept = {
      id: randomBytes(6).toString('hex'),
      name: basename(file).slice(0, 120),
      durationS: beats?.durationS ?? durationS,
      bpm: beats?.bpm ?? null,
      grid: beats?.grid ?? [],
      bpm0: beats?.bpm ?? null,
      grid0: beats?.grid ?? [],
      factor: 1,
      half: false,
      file,
      size: st.size
    }
    log(`Musique analysée en ${((performance.now() - t0) / 1000).toFixed(2)} s : ${k.bpm ? `${k.bpm} temps par minute` : 'pas de tempo'}, ${k.durationS} s.`)
    setKv(KEY, [k, ...kept()].slice(0, MAX_KEPT))
    return pub(k)
  } catch (e) {
    if (e instanceof UserError) throw e
    log(`Musique : ${errText(e)}`)
    throw new UserError('Cette musique n’a pas pu être lue.')
  } finally {
    filmEngine.end()
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
