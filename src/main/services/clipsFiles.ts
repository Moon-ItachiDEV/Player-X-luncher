import { existsSync } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFlat, readBoxes, type ClipTrack, type FlatPlan } from './fmp4'
import type { ShareSource } from './sharePlan'

// Les fichiers MP4 des clips, sur le disque : écrire un clip d'après son plan, relire l'index d'un clip déjà écrit, trouver
// un nom de fichier libre. Les calculs (boîtes MP4, plans, coupes) sont dans fmp4.ts ; ici, seulement les lectures et les
// écritures. Sans Electron et sans état : chaque fonction reçoit tout ce dont elle a besoin, et se teste sur de vrais
// fichiers dans le dossier temporaire (`npm test -- clipsFiles`).

// ---------- écrire ----------

async function writeAll(fh: FileHandle, buf: Buffer, length: number): Promise<void> {
  let done = 0
  while (done < length) done += (await fh.write(buf, done, length - done)).bytesWritten
}

/** En-tête, puis données recopiées depuis leurs sources (fragments du tampon, ou l'ancien fichier pour une découpe). */
export async function writePlan(plan: FlatPlan, sources: string[], out: string): Promise<void> {
  const fh = await open(out, 'w')
  let srcFile: FileHandle | null = null
  let srcIndex = -1
  const block = Buffer.allocUnsafe(1024 * 1024)
  try {
    await writeAll(fh, plan.head, plan.head.length)
    for (const r of plan.ranges) {
      if (r.src !== srcIndex) {
        await srcFile?.close()
        srcFile = await open(sources[r.src], 'r')
        srcIndex = r.src
      }
      let pos = r.pos
      let left = r.size
      while (left > 0) {
        const { bytesRead } = await srcFile!.read(block, 0, Math.min(left, block.length), pos)
        if (!bytesRead) throw new Error('source du clip plus courte que prévu')
        await writeAll(fh, block, bytesRead)
        pos += bytesRead
        left -= bytesRead
      }
    }
  } finally {
    await srcFile?.close().catch(() => {})
    await fh.close().catch(() => {})
  }
}

/** Le premier nom libre dans le dossier : « base.mp4 », sinon « base (2).mp4 »… Un fichier en cours d'écriture (« .part ») garde le sien. */
export function freeName(folder: string, base: string): string {
  let file = join(folder, `${base}.mp4`)
  for (let n = 2; existsSync(file) || existsSync(`${file}.part`); n++) file = join(folder, `${base} (${n}).mp4`)
  return file
}

// ---------- relire ----------

/** La boîte moov d'un clip : elle est devant les données. */
export async function readMoov(fh: FileHandle): Promise<Buffer> {
  const { size } = await fh.stat()
  let pos = 0
  const head = Buffer.alloc(16)
  while (pos + 8 <= size) {
    await fh.read(head, 0, 16, pos)
    let boxSize = head.readUInt32BE(0)
    if (boxSize === 1) boxSize = Number(head.readBigUInt64BE(8))
    else if (boxSize === 0) boxSize = size - pos
    if (boxSize < 8 || pos + boxSize > size) throw new Error('fichier abîmé')
    if (head.toString('latin1', 4, 8) === 'moov') {
      const moov = Buffer.alloc(boxSize)
      await fh.read(moov, 0, boxSize, pos)
      readBoxes(moov)
      return moov
    }
    pos += boxSize
  }
  throw new Error('fichier sans index (moov)')
}

/** Ce que le fichier est vraiment (relu dans son index, pas dans sa fiche) : durée, taille de l'image, images par seconde, son. */
export async function shareSource(file: string, sizeBytes: number): Promise<ShareSource> {
  const fh = await open(file, 'r')
  const tracks = parseFlat(await readMoov(fh).finally(() => fh.close()))
  const video = tracks.find((t) => t.kind === 'video' && t.samples.length)
  if (!video) throw new Error('pas d’image')
  const seconds = (t: ClipTrack): number => t.samples.reduce((n, x) => n + x.dur, 0) / t.timescale
  const videoS = seconds(video)
  const durationS = Math.max(videoS, ...tracks.filter((t) => t.kind === 'audio').map(seconds))
  return { sizeBytes, durationS, width: video.width, height: video.height, fps: videoS > 0 ? video.samples.length / videoS : 0, hasAudio: tracks.some((t) => t.kind === 'audio' && t.samples.length > 0) }
}

/**
 * Bêta 46 : la taille de l'image d'une vidéo MP4, relue dans son index (pour l'essai de capture : la vidéo d'essai dit si la
 * réduction a eu lieu). null : fichier illisible.
 */
export async function videoSizeOf(file: string): Promise<{ width: number; height: number } | null> {
  try {
    const fh = await open(file, 'r')
    const video = parseFlat(await readMoov(fh).finally(() => fh.close())).find((t) => t.kind === 'video')
    return video && video.width > 0 && video.height > 0 ? { width: video.width, height: video.height } : null
  } catch {
    return null
  }
}
