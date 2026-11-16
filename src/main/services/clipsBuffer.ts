import { rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { keepFrom } from './clipsPlan'
import { errText, log } from './clipsLog'
import { clipSettings } from './clipsSettings'
import { bufferRoot, capture, emitState, frags, pendings, recorders, setFrags, writing, type Recorder } from './clipsState'
import { recorderLost, send } from './clipsWindow'
import { type FragmentInfo } from './fmp4'
import { PCM_FRAME_BYTES, PCM_RATE, pcmWindow } from './engineCapture'

// Le tampon : les fragments reçus de la page ou du moteur, écrits sur le disque, puis retirés quand plus rien ne
// s'en sert ; et le son en PCM d'un clip du moteur. L'état qu'il change est dans clipsState.ts.
// Ce code vient de clips.ts, sans changement de comportement.

/** Plus que ça en attente d'écriture : le disque ne suit pas, l'enregistreur s'arrête plutôt que de remplir la mémoire. */
const MAX_QUEUED_BYTES = 256 * 1024 * 1024

export function storeFragment(rec: Recorder, data: Buffer, info: FragmentInfo): void {
  const seq = rec.seq++
  const file = join(rec.dir, `${String(seq).padStart(6, '0')}.m4s`)
  // Le fragment vient de finir : le flux ne peut pas être en avance sur l'horloge. S'il l'est, le temps 0 était plus tôt.
  const lag = Date.now() - (rec.anchor + info.endS * 1000)
  if (lag < 0) rec.anchor += lag
  const startWall = rec.anchor + info.startS * 1000
  const endWall = rec.anchor + info.endS * 1000
  rec.queued += data.length
  if (rec.queued > MAX_QUEUED_BYTES) {
    log('Le disque ne suit pas : enregistreur arrêté.')
    if (capture?.rec === rec) {
      send(capture, { type: 'abort', recId: rec.id, reason: 'disque trop lent' })
      recorderLost(rec, 'disque trop lent')
    }
    return
  }
  rec.writes = rec.writes
    .then(async () => {
      await writeFile(file, data)
      rec.queued -= data.length
      frags.push({ recId: rec.id, startWall, endWall, key: info.key, file, info })
      pruneBuffer()
      emitState()
    })
    .catch((e) => {
      rec.queued -= data.length
      log(`Écriture du tampon impossible : ${errText(e)}`)
      if (capture?.rec === rec) {
        send(capture, { type: 'abort', recId: rec.id, reason: 'écriture impossible' })
        recorderLost(rec, 'écriture du tampon impossible')
      }
    })
}

/** Retire les fragments qui ne servent plus à rien : ni à un événement à venir, ni à un clip en cours. */
export function pruneBuffer(): void {
  const inUse = [...[...pendings.values()].map((p) => p.start), ...writing.values()]
  const from = keepFrom(Date.now(), clipSettings(), inUse)
  // Le son en PCM : les morceaux finis avant le début utile.
  for (const r of recorders.values()) {
    if (!r.pcm?.length) continue
    let i = 0
    while (i < r.pcm.length && r.pcm[i].wall + (r.pcm[i].data.length / PCM_FRAME_BYTES / PCM_RATE) * 1000 < from) i++
    if (i) r.pcm.splice(0, i)
  }
  const gone = frags.filter((f) => f.endWall < from)
  if (!gone.length) return
  setFrags(frags.filter((f) => f.endWall >= from))
  for (const f of gone) void unlink(f.file).catch(() => {})
  dropEmptyRecorders()
}

function dropEmptyRecorders(): void {
  for (const [id, rec] of recorders) {
    if (capture?.rec === rec || capture?.eng === rec || rec.pcm?.length || frags.some((f) => f.recId === id)) continue
    recorders.delete(id)
    void rm(rec.dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Bêta 42 : le son d'un clip filmé par le moteur, en PCM, pris dans l'enregistreur « son seulement » qui couvre le mieux
 * [fromWall ; fromWall + durS]. null : rien pour cette fenêtre.
 */
export function pcmForWindow(fromWall: number, durS: number): { pcm: Buffer; covered: number } | null {
  const toWall = fromWall + durS * 1000
  let best: { pcm: Buffer; covered: number } | null = null
  for (const r of recorders.values()) {
    if (!r.pcm?.length) continue
    const parts = r.pcm.filter((x) => x.wall < toWall && x.wall + (x.data.length / PCM_FRAME_BYTES / PCM_RATE) * 1000 > fromWall)
    if (!parts.length) continue
    const w = pcmWindow(parts, fromWall, durS)
    if (!best || w.covered > best.covered) best = w
  }
  return best && best.covered >= 0.02 ? best : null
}

export async function clearBuffer(): Promise<void> {
  setFrags([])
  recorders.clear()
  await rm(bufferRoot(), { recursive: true, force: true }).catch((e) => log(`Tampon non vidé : ${errText(e)}`))
}
