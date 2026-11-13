import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { app, dialog } from 'electron'
import type { EditMusic } from '@shared/types'
import { getKv, setKv } from '../db'
import { UserError } from '../errors'
import { mainWindow } from '../windows'
import { errText, log } from './clipsLog'
import { BEAT_RATE, detectBeats } from './editBeats'
import { scrub } from './editEngineRules'
import { filmEngine } from './editFfmpeg'

// Les musiques des films : le joueur choisit un fichier de son PC dans une fenêtre de Windows (Player X n'en fournit pas).
// Le moteur vidéo le décode une fois (10 premières minutes, mono, passe-bas : le kick) pour trouver ses temps (editBeats.ts).
// La liste est gardée dans la base, avec le chemin : le chemin ne quitte jamais le processus principal, la page ne reçoit que
// des identifiants, des noms de fichier, des durées et des temps.

const KEY = 'editMusic'
const MAX_KEPT = 12
const MAX_BYTES = 300 * 1024 * 1024
const ANALYSE_S = 600
const ANALYSE_TIMEOUT_MS = 120_000
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'wma']
const ID = /^[a-z0-9]{12}$/

interface Kept extends Omit<EditMusic, 'missing'> {
  file: string
  size: number
}

function kept(): Kept[] {
  const raw = getKv<unknown>(KEY, [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Kept => !!x && typeof x === 'object' && typeof (x as Kept).id === 'string' && ID.test((x as Kept).id) && typeof (x as Kept).file === 'string' && Array.isArray((x as Kept).grid))
    .slice(0, MAX_KEPT)
}

const pub = (k: Kept, missing = false): EditMusic => ({ id: k.id, name: k.name, durationS: k.durationS, bpm: k.bpm, grid: k.grid, ...(missing ? { missing: true } : {}) })

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
  const ext = (file.split('.').pop() || '').toLowerCase()
  if (!AUDIO_EXT.includes(ext)) throw new UserError('Ce fichier n’est pas une musique. Choisis un MP3, WAV, FLAC, OGG, M4A ou AAC.')
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
