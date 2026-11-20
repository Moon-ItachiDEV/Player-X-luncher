// Tests des fichiers MP4 des clips (npm test -- clipsFiles) : de vrais fichiers, écrits puis relus dans un dossier temporaire.
// Le clip d'essai sort de deux sources d'une seconde, rangées comme deux fragments du tampon : le son, puis l'image.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFlat, parseFlat, type ClipTrack, type Sample } from './fmp4'
import { freeName, readMoov, renameWithRetry, shareSource, videoSizeOf, writePlan } from './clipsFiles'

const VIDEO_TS = 30000
const AUDIO_TS = 48000
/** Devant les données de chaque source : la place de l'index (moof) d'un vrai fragment. */
const LEAD = 64
const SOUNDS = 10
const SOUND_BYTES = 100
const FRAMES = 30
/** 1,2 Mo d'image par source : plus que le bloc de copie de writePlan (1 Mo), qui doit donc s'y reprendre à deux fois. */
const FRAME_BYTES = 40_000
const DATA_BYTES = SOUNDS * SOUND_BYTES + FRAMES * FRAME_BYTES

function u32(...values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 4)
  values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4))
  return b
}

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const h = Buffer.alloc(8)
  h.writeUInt32BE(body.length + 8)
  h.write(type, 4, 'latin1')
  return Buffer.concat([h, body])
}

/** Des octets qui ne se répètent pas : une copie décalée d'un seul octet se voit. */
function noise(length: number, seed: number): Buffer {
  const b = Buffer.alloc(length)
  let x = seed
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    b[i] = x >>> 24
  }
  return b
}

/** Deux secondes à 30 images/s (une image clé par seconde) et, si demandé, deux secondes de son. */
function tracks(withAudio = true): ClipTrack[] {
  const stsd = (entry: string): Buffer => box('stsd', u32(0, 1), box(entry, Buffer.alloc(30, 7)))
  const audio: Sample[] = []
  const video: Sample[] = []
  for (let src = 0; src < 2; src++) {
    for (let i = 0; i < SOUNDS; i++) audio.push({ dts: (src * SOUNDS + i) * 4800, dur: 4800, size: SOUND_BYTES, cto: 0, sync: true, pos: LEAD + i * SOUND_BYTES, src })
    for (let i = 0; i < FRAMES; i++) video.push({ dts: (src * FRAMES + i) * 1000, dur: 1000, size: FRAME_BYTES, cto: 0, sync: i === 0, pos: LEAD + SOUNDS * SOUND_BYTES + i * FRAME_BYTES, src })
  }
  const sound: ClipTrack = { id: 1, kind: 'audio', timescale: AUDIO_TS, width: 0, height: 0, codec: 'mp4a', stsd: stsd('mp4a'), samples: audio }
  const image: ClipTrack = { id: 2, kind: 'video', timescale: VIDEO_TS, width: 1280, height: 720, codec: 'avc1', stsd: stsd('avc1'), samples: video }
  return withAudio ? [sound, image] : [image]
}

let dir = ''
/** Le contenu des deux sources, et leurs fichiers. */
const bytes = [noise(LEAD + DATA_BYTES, 1), noise(LEAD + DATA_BYTES, 2)]
let sources: string[] = []
/** Le clip écrit une fois pour toutes par writePlan, que les tests relisent. */
let clip = ''
const plan = buildFlat(tracks())

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'px-clips-files-'))
  sources = [join(dir, '000000.m4s'), join(dir, '000001.m4s')]
  await Promise.all(sources.map((file, i) => writeFile(file, bytes[i])))
  clip = join(dir, 'clip.mp4')
  await writePlan(plan, sources, clip)
})

after(() => rm(dir, { recursive: true, force: true }))

/** Écrit un fichier d'essai, puis rend ce que readMoov en dit. */
async function moovOf(name: string, data: Buffer): Promise<Buffer> {
  const file = join(dir, name)
  await writeFile(file, data)
  const fh = await open(file, 'r')
  return readMoov(fh).finally(() => fh.close())
}

test('writePlan : l’en-tête, puis les données de chaque source, à l’octet près', async () => {
  const written = await readFile(clip)
  assert.equal(written.length, plan.size)
  assert.ok(written.equals(Buffer.concat([plan.head, ...bytes.map((b) => b.subarray(LEAD, LEAD + DATA_BYTES))])))
  // Sinon ce test ne dirait rien de la copie en plusieurs blocs.
  assert.ok(plan.ranges.length === 2 && plan.ranges.every((r) => r.size > 1024 * 1024))
})

test('writePlan : une source plus courte que prévu lève une erreur', async () => {
  const short = join(dir, 'courte.m4s')
  await writeFile(short, bytes[1].subarray(0, LEAD + 5000))
  await assert.rejects(writePlan(plan, [sources[0], short], join(dir, 'rate.mp4.part')), /plus courte que prévu/)
  await assert.rejects(writePlan(plan, [sources[0], join(dir, 'absente.m4s')], join(dir, 'rate.mp4.part')), { code: 'ENOENT' })
})

test('readMoov : le clip écrit se relit, chaque image et chaque son à sa place dans le fichier', async () => {
  const written = await readFile(clip)
  const read = parseFlat(await moovOf('relu.mp4', written))
  const made = tracks()
  // Dans le fichier, l'image passe devant le son.
  assert.deepEqual(read.map((t) => [t.id, t.kind, t.timescale, t.width, t.height, t.codec]), [[2, 'video', VIDEO_TS, 1280, 720, 'avc1'], [1, 'audio', AUDIO_TS, 0, 0, 'mp4a']])
  for (const want of made) {
    const got = read.find((t) => t.kind === want.kind)!.samples
    assert.equal(got.length, want.samples.length)
    want.samples.forEach((s, i) => {
      assert.deepEqual([got[i].dts, got[i].dur, got[i].size, got[i].sync], [s.dts, s.dur, s.size, s.sync], `${want.kind} ${i}`)
      assert.ok(written.subarray(got[i].pos, got[i].pos + s.size).equals(bytes[s.src].subarray(s.pos, s.pos + s.size)), `${want.kind} ${i} : données`)
    })
  }
})

test('readMoov : l’index est trouvé derrière les données, même après une boîte à taille sur 64 bits', async () => {
  const moov = await moovOf('devant.mp4', await readFile(clip))
  const big = Buffer.alloc(16)
  big.writeUInt32BE(1, 0)
  big.write('mdat', 4, 'latin1')
  big.writeBigUInt64BE(16n + 300n, 8)
  const behind = await moovOf('derriere.mp4', Buffer.concat([box('ftyp', Buffer.alloc(8)), box('free', Buffer.alloc(5)), big, Buffer.alloc(300, 9), moov]))
  assert.ok(behind.equals(moov))
})

test('readMoov : un fichier vide, sans index ou coupé est refusé', async () => {
  await assert.rejects(moovOf('vide.mp4', Buffer.alloc(0)), /sans index/)
  await assert.rejects(moovOf('sans-index.mp4', Buffer.concat([box('ftyp', Buffer.alloc(8)), box('mdat', Buffer.alloc(100))])), /sans index/)
  // Une boîte de taille 0 va jusqu'à la fin du fichier : rien derrière elle.
  await assert.rejects(moovOf('jusqu-au-bout.mp4', Buffer.concat([box('ftyp', Buffer.alloc(8)), u32(0), Buffer.from('mdat', 'latin1'), Buffer.alloc(100)])), /sans index/)
  // Coupé au milieu de son index : la boîte annonce plus que ce que le fichier contient.
  await assert.rejects(moovOf('coupe.mp4', (await readFile(clip)).subarray(0, 200)), /abîmé/)
  await assert.rejects(moovOf('pas-un-mp4.mp4', Buffer.from('pas une vidéo')), /abîmé/)
})

test('videoSizeOf et shareSource : ce que le fichier contient vraiment', async () => {
  assert.deepEqual(await videoSizeOf(clip), { width: 1280, height: 720 })
  assert.deepEqual(await shareSource(clip, plan.size), { sizeBytes: plan.size, durationS: 2, width: 1280, height: 720, fps: 30, hasAudio: true })
  const mute = join(dir, 'muet.mp4')
  await writePlan(buildFlat(tracks(false)), sources, mute)
  assert.deepEqual(await shareSource(mute, 7), { sizeBytes: 7, durationS: 2, width: 1280, height: 720, fps: 30, hasAudio: false })
  // Illisible : videoSizeOf rend null, shareSource lève l'erreur (la page propose alors l'original).
  await writeFile(join(dir, 'texte.mp4'), 'pas une vidéo')
  assert.equal(await videoSizeOf(join(dir, 'texte.mp4')), null)
  assert.equal(await videoSizeOf(join(dir, 'absent.mp4')), null)
  await assert.rejects(shareSource(join(dir, 'texte.mp4'), 13), /abîmé/)
  await assert.rejects(shareSource(join(dir, 'absent.mp4'), 0), { code: 'ENOENT' })
})

test('freeName : le premier nom libre, jamais celui d’un clip en cours d’écriture', async () => {
  const folder = join(dir, 'noms')
  await mkdir(folder)
  assert.equal(freeName(folder, 'Jeu 2026-11-15'), join(folder, 'Jeu 2026-11-15.mp4'))
  await writeFile(join(folder, 'Jeu 2026-11-15.mp4'), '')
  assert.equal(freeName(folder, 'Jeu 2026-11-15'), join(folder, 'Jeu 2026-11-15 (2).mp4'))
  await writeFile(join(folder, 'Jeu 2026-11-15 (2).mp4.part'), '')
  assert.equal(freeName(folder, 'Jeu 2026-11-15'), join(folder, 'Jeu 2026-11-15 (3).mp4'))
})

test('renameWithRetry : réessaie sur EPERM/EBUSY/EACCES puis renomme le fichier', async () => {
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    let n = 0
    const waits: number[] = []
    await renameWithRetry('a.part', 'a.mp4', {
      attempts: 5,
      delayMs: 120,
      wait: async (ms) => { waits.push(ms) },
      doRename: async () => {
        if (++n < 3) throw Object.assign(new Error('verrou antivirus'), { code })
      }
    })
    assert.equal(n, 3)
    assert.deepEqual(waits, [120, 120])
  }
  let n = 0
  await assert.rejects(
    renameWithRetry('a.part', 'a.mp4', {
      attempts: 4,
      wait: async () => {},
      doRename: async () => {
        n++
        throw Object.assign(new Error('absent'), { code: 'ENOENT' })
      }
    }),
    { code: 'ENOENT' }
  )
  assert.equal(n, 1)
})

