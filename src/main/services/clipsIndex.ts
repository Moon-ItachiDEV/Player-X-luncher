import { randomBytes } from 'node:crypto'
import { copyFile as copyOnDisk, mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, shell } from 'electron'
import { cleanPace, paceOf, type ClipPace } from '@shared/clipPace'
import type { Clip } from '@shared/types'
import { getKv, setKv } from '../db'
import { broadcast } from '../windows'
import { freeName, readMoov, writePlan } from './clipsFiles'
import { errText, log } from './clipsLog'
import { CLIP_ID, clipBaseName, clipsToPurge, cleanTitle, safeFileName, trimEvents } from './clipsPlan'
import { SCHEME } from './clipsProtocol'
import { serial } from './clipsQueue'
import { clipSettings, usableFolder } from './clipsSettings'
import { dropShareCopies } from './clipsShare'
import { buildFlat, cutTracks, firstFrameS, parseFlat, type ClipTrack } from './fmp4'

// La liste des clips : la fiche de chaque clip, gardée en base, et ce qui change cette liste (renommer, épingler, découper,
// supprimer, la limite de place, ranger un film). Ce fichier est le seul à garder la liste et à l'écrire en base : clips.ts
// la lit par clipIndex() et y ajoute un clip par addClip(). Les travaux sur les fichiers passent un à la fois par la file
// de clipsQueue.ts. Ce code vient de clips.ts, sans changement de comportement.

const INDEX_KEY = 'clipsIndex'

/** Fiche d'un clip, en base. Le chemin ne sort jamais du processus principal. */
export type ClipMeta = Omit<Clip, 'videoUrl' | 'thumbUrl'> & { file: string }

let index: ClipMeta[] = []

/** La liste du moment. Hors de ce fichier, elle se lit seulement : un clip s'y ajoute par addClip(). */
export const clipIndex = (): readonly ClipMeta[] => index

/** Après l'ouverture de la base : la liste enregistrée. Une fiche sans identifiant ou sans fichier est laissée de côté. */
export function loadClipIndex(): void {
  index = getKv<ClipMeta[]>(INDEX_KEY, []).filter((c) => c && typeof c.id === 'string' && CLIP_ID.test(c.id) && typeof c.file === 'string')
}

/** Un clip vient d'être écrit : sa fiche passe en tête de la liste, et la liste est enregistrée. */
export function addClip(meta: ClipMeta): void {
  index = [meta, ...index]
  saveIndex()
}

function saveIndex(): void {
  setKv(INDEX_KEY, index)
}

// Deux lignes recopiées de clips.ts, qui garde les siennes : le dossier de données de l'appli, et une attente.
const userData = (...p: string[]): string => join(app.getPath('userData'), ...p)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Le fichier de la vignette d'un clip. */
export const thumbPath = (id: string): string => userData('clips-thumbs', `${id}.jpg`)

/** Dit aux pages que la liste des clips a changé. */
export const emitChanged = (): void => broadcast('clips:changed')

/** 0.7.4 : vrai si toutes les images de la piste vidéo ont la même durée (clip du moteur, à cadence fixe). */
export function constantRate(tracks: ClipTrack[]): boolean {
  const v = tracks.find((t) => t.kind === 'video' && t.samples.length > 1)
  return !!v && v.samples.slice(0, -1).every((s) => s.dur === v.samples[0].dur)
}

/** Bêta 46 : le rythme réel d'un clip (clipPace.ts), d'après les images de sa piste vidéo. undefined : pas assez d'images pour le dire. */
export function paceOfTracks(tracks: ClipTrack[], durationS: number, wantedFps: number): ClipPace | undefined {
  const video = tracks.find((t) => t.kind === 'video' && t.samples.length)
  return (video && paceOf(video.samples.map((s) => (s.dts + s.cto) / video.timescale), durationS, wantedFps)) || undefined
}

async function deleteFiles(meta: ClipMeta): Promise<void> {
  // Sous Windows, le fichier peut être encore ouvert un instant par la lecture dans l'interface.
  for (let i = 0; i < 5; i++) {
    try {
      await unlink(meta.file)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') break
      if (i === 4) log(`Suppression de ${meta.id} : ${errText(e)}`)
      else await sleep(200)
    }
  }
  await unlink(thumbPath(meta.id)).catch(() => {})
  // Bêta 46 : ses copies légères pour Discord partent avec lui.
  await dropShareCopies(meta.id).catch(() => {})
}

/** Au-delà de la limite : les plus vieux non épinglés partent. Le clip qui vient d'arriver reste. */
export async function applyRetention(keepId?: string): Promise<void> {
  const ids = clipsToPurge(index, clipSettings().limitGb * 1024 ** 3, keepId)
  if (!ids.length) return
  const gone = index.filter((c) => ids.includes(c.id))
  index = index.filter((c) => !ids.includes(c.id))
  saveIndex()
  for (const c of gone) await deleteFiles(c)
  log(`Limite de ${clipSettings().limitGb} Go : ${gone.length} ancien(s) clip(s) supprimé(s).`)
  emitChanged()
}

// ---------- liste et actions ----------

function publicClip({ file: _file, pace: rawPace, ...meta }: ClipMeta): Clip {
  // Le rythme est relu de la base : sa structure est vérifiée avant de partir vers la page.
  const pace = cleanPace(rawPace)
  return { ...meta, ...(pace ? { pace } : {}), videoUrl: `${SCHEME}://video/${meta.id}`, thumbUrl: `${SCHEME}://thumb/${meta.id}` }
}

export function clipById(id: unknown): ClipMeta | undefined {
  return typeof id === 'string' && CLIP_ID.test(id) ? index.find((c) => c.id === id) : undefined
}

export function needClip(id: unknown): ClipMeta {
  const c = clipById(id)
  if (!c) throw new Error('Clip inconnu.')
  return c
}

/** Fichier disparu : retiré. Dossier entier absent (disque débranché) : gardé mais pas listé, il reviendra avec le disque. */
export async function listClips(): Promise<Clip[]> {
  const shown: ClipMeta[] = []
  const gone: string[] = []
  const isDir = (p: string): Promise<boolean> => stat(p).then((s) => s.isDirectory(), () => false)
  await Promise.all(
    index.map(async (c) => {
      if (await stat(c.file).then((s) => s.isFile(), () => false)) shown.push(c)
      // Un film est dans le sous-dossier Films : ce sous-dossier supprimé à la main, le film a disparu lui aussi.
      else if ((await isDir(dirname(c.file))) || (c.kind === 'film' && (await isDir(dirname(dirname(c.file)))))) gone.push(c.id)
    })
  )
  if (gone.length) {
    index = index.filter((c) => !gone.includes(c.id))
    for (const id of gone) void unlink(thumbPath(id)).catch(() => {})
    saveIndex()
    log(`${gone.length} clip(s) retiré(s) de la liste : fichier disparu.`)
  }
  return shown.sort((a, b) => b.at - a.at).map(publicClip)
}

/** Une découpe devient un nouveau clip, juste au-dessus de l'original : rien n'est perdu si la coupe est ratée. */
export function trimClip(id: unknown, startS: unknown, endS: unknown): Promise<Clip> {
  const meta = needClip(id)
  const from = typeof startS === 'number' && Number.isFinite(startS) ? Math.max(0, startS) : NaN
  const to = typeof endS === 'number' && Number.isFinite(endS) ? endS : NaN
  if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 0.5) throw new Error('Découpe invalide : choisis au moins une demi-seconde.')
  return serial(async () => {
    const c = needClip(meta.id)
    // La coupe sans réencodage connaît les fichiers de l'enregistreur, pas ceux du moteur vidéo.
    if (c.kind === 'film') throw new Error('Un film ne se coupe pas ici. Refais-le depuis ses clips.')
    const fh = await open(c.file, 'r').catch(() => {
      throw new Error('Le fichier de ce clip a disparu.')
    })
    const moov = await readMoov(fh).finally(() => fh.close())
    const cut = cutTracks(parseFlat(moov), from, to, 'nearest')
    if (!cut) throw new Error('Rien à garder dans cette découpe.')
    const plan = buildFlat(cut, { createdAtMs: c.at })
    // Sans réencodage, le début se cale sur une image clé, toutes les 2 s.
    if (plan.durationS > c.durationS - 0.1) throw new Error('Trop peu à couper : le début d’un clip se cale toutes les 2 secondes. Déplace la poignée un peu plus.')
    const newId = randomBytes(8).toString('hex')
    const title = cleanTitle(`${c.title.replace(/ \(coupé\)$/, '').slice(0, 70)} (coupé)`) ?? c.title
    const file = freeName(dirname(c.file), clipBaseName(c.gameName, c.at, safeFileName(title)))
    const part = `${file}.part`
    try {
      await writePlan(plan, [c.file], part)
      await rename(part, file)
    } catch (e) {
      await unlink(part).catch(() => {})
      throw e
    }
    // Les événements qui restent dans la partie gardée suivent, recalés sur la nouvelle première image.
    const events = trimEvents(c.events, firstFrameS(cut), plan.durationS)
    // Bêta 46 : la coupe a son propre rythme (celui de la partie gardée), jamais celui du clip entier.
    const { pace: wholePace, ...rest } = c
    const wantedFps = cleanPace(wholePace)?.wanted
    // 0.7.4 : un clip du moteur est à cadence fixe (images répétées comprises) : ses images ne disent plus le rythme, la coupe
    // garde celui du clip entier.
    const pace = wantedFps ? (constantRate(cut) ? cleanPace(wholePace) : paceOfTracks(cut, plan.durationS, wantedFps)) : undefined
    const made: ClipMeta = { ...rest, id: newId, title, at: c.at + 1, durationS: plan.durationS, sizeBytes: plan.size, pinned: false, file, ...(events ? { events } : {}), ...(pace ? { pace } : {}) }
    await copyOnDisk(thumbPath(c.id), thumbPath(newId)).catch(() => {})
    index = [made, ...index]
    saveIndex()
    log(`Clip ${c.id} coupé dans ${newId} : ${from.toFixed(1)} à ${to.toFixed(1)} s, ${plan.durationS.toFixed(1)} s.`)
    await applyRetention(newId)
    emitChanged()
    return publicClip(made)
  })
}

export function renameClip(id: unknown, name: unknown): Promise<Clip> {
  const meta = needClip(id)
  const title = cleanTitle(name)
  if (!title) throw new Error('Donne un nom à ce clip.')
  return serial(async () => {
    const c = needClip(meta.id)
    c.title = title
    const base = clipBaseName(c.gameName, c.at, safeFileName(title))
    if (join(dirname(c.file), `${base}.mp4`) !== c.file) {
      const target = freeName(dirname(c.file), base)
      // Fichier occupé : le titre change quand même, le nom du fichier reste.
      await rename(c.file, target).then(
        () => {
          c.file = target
        },
        (e) => log(`Fichier de ${c.id} non renommé : ${errText(e)}`)
      )
    }
    saveIndex()
    emitChanged()
    return publicClip(c)
  })
}

export function deleteClip(id: unknown): Promise<boolean> {
  const meta = clipById(id)
  if (!meta) return Promise.resolve(false)
  return serial(async () => {
    index = index.filter((c) => c.id !== meta.id)
    saveIndex()
    await deleteFiles(meta)
    log(`Clip ${meta.id} supprimé.`)
    emitChanged()
    return true
  })
}

export function pinClip(id: unknown, on: unknown): Clip {
  const c = needClip(id)
  c.pinned = on === true
  saveIndex()
  emitChanged()
  return publicClip(c)
}

export async function openFolder(id: unknown): Promise<void> {
  if (id !== undefined && id !== null) return shell.showItemInFolder(needClip(id).file)
  const folder = await usableFolder()
  const err = await shell.openPath(folder)
  if (err) throw new Error('Impossible d’ouvrir le dossier des clips.')
}

// ---------- les films (fabriqués par services/editFilm.ts) ----------

export const FILMS_DIR = 'Films'

/** Un clip tel que la fabrication d'un film en a besoin : sa fiche, son fichier, et s'il a du son. Ne quitte pas le processus principal. */
export type FilmSource = Pick<ClipMeta, 'id' | 'gameId' | 'gameName' | 'kind' | 'at' | 'kills' | 'durationS' | 'events' | 'map' | 'mode' | 'sessionId' | 'file'> & { hasAudio: boolean }

/**
 * Les clips demandés qui peuvent entrer dans un film : connus, pas eux-mêmes des films, fichier présent et lisible, avec une
 * image. `skipped` compte les autres. La page n'envoie que des identifiants ; les fichiers sont relus ici (lecture seule).
 */
export async function filmSources(ids: unknown): Promise<{ sources: FilmSource[]; skipped: number }> {
  const wantedIds = Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === 'string' && CLIP_ID.test(x)))].slice(0, 500) : []
  const sources: FilmSource[] = []
  let skipped = 0
  for (const id of wantedIds) {
    const c = clipById(id)
    if (!c || c.kind === 'film') {
      skipped++
      continue
    }
    try {
      const fh = await open(c.file, 'r')
      const tracks = parseFlat(await readMoov(fh).finally(() => fh.close()))
      if (!tracks.some((t) => t.kind === 'video' && t.samples.length)) throw new Error('pas d’image')
      const { id: cid, gameId, gameName, kind, at, kills, durationS, events, map, mode, sessionId, file } = c
      sources.push({ id: cid, gameId, gameName, kind, at, kills, durationS, events, map, mode, sessionId, file, hasAudio: tracks.some((t) => t.kind === 'audio' && t.samples.length > 0) })
    } catch (e) {
      skipped++
      log(`Film : clip ${id} laissé de côté : ${errText(e)}`)
    }
  }
  return { sources, skipped }
}

/**
 * Le clip le plus récent qui peut entrer dans un film (pas un film, fichier présent et lisible), pour l'essai du moteur :
 * il passe par le même chemin qu'un film. Son chemin ne quitte pas le processus principal.
 */
export async function newestClipSource(): Promise<(FilmSource & { width: number; height: number }) | null> {
  for (const c of [...index].sort((a, b) => b.at - a.at)) {
    if (c.kind === 'film') continue
    const { sources } = await filmSources([c.id])
    if (sources[0]) return { ...sources[0], width: c.width, height: c.height }
  }
  return null
}

/** Où écrire un film : dans le sous-dossier Films du dossier des clips, d'abord en « .part », sous un nom libre. */
export async function filmTarget(gameName: string, title: string, at: number): Promise<{ file: string; part: string }> {
  const folder = join(await usableFolder(), FILMS_DIR)
  await mkdir(folder, { recursive: true })
  const file = freeName(folder, clipBaseName(gameName, at, safeFileName(title)))
  return { file, part: `${file}.part` }
}

/**
 * Range un film fini avec les clips : son fichier « .part » prend son nom, sa vignette est copiée, sa fiche entre dans la liste.
 * Un film ne compte pas dans la limite de place et ne part jamais tout seul (clipsToPurge).
 */
export function addFilm(f: { part: string; file: string; thumb?: string; title: string; gameId: string; gameName: string; at: number; shots: number; durationS: number; width: number; height: number; map?: string; mode?: string; sessionId: string }): Promise<Clip> {
  return serial(async () => {
    // Sous Windows, un antivirus peut tenir un instant le fichier que le moteur vient de fermer.
    for (let i = 0; ; i++) {
      try {
        await rename(f.part, f.file)
        break
      } catch (e) {
        if (i === 9 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e
        await sleep(300)
      }
    }
    const { size } = await stat(f.file)
    const id = randomBytes(8).toString('hex')
    if (f.thumb) {
      await mkdir(dirname(thumbPath(id)), { recursive: true })
        .then(() => copyOnDisk(f.thumb as string, thumbPath(id)))
        .catch((e) => log(`Vignette du film ${id} : ${errText(e)}`))
    }
    const meta: ClipMeta = {
      id,
      gameId: f.gameId,
      gameName: f.gameName,
      kind: 'film',
      title: cleanTitle(f.title) ?? 'Film',
      kills: 0,
      headshots: 0,
      at: f.at,
      shots: f.shots,
      durationS: f.durationS,
      sizeBytes: size,
      width: f.width,
      height: f.height,
      pinned: false,
      ...(f.map ? { map: f.map } : {}),
      ...(f.mode ? { mode: f.mode } : {}),
      sessionId: f.sessionId,
      file: f.file
    }
    index = [meta, ...index]
    saveIndex()
    log(`Film ${id} rangé : « ${meta.title} », ${f.shots} plan(s), ${f.durationS.toFixed(1)} s, ${(size / 1e6).toFixed(1)} Mo.`)
    emitChanged()
    return publicClip(meta)
  })
}
