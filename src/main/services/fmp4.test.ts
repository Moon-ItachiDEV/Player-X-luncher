// Tests du MP4 des clips (npm run test:clips) : découpe du flux, lecture des fragments, écriture et relecture du MP4 classique.
// Les fichiers d'essai sont construits ici, sur le modèle de ce que produit MediaRecorder (Chromium 152).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFlat, collectTracks, cutTracks, Fmp4Splitter, parseFlat, parseFragment, parseInit, readBoxes, type ClipTrack, type FragmentInfo } from './fmp4'

const AUDIO = 1
const VIDEO = 2
const AUDIO_TS = 48000
const VIDEO_TS = 30000
const NON_SYNC = 0x1010000
const SYNC = 0x2000000

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

const full = (type: string, v: number, flags: number, ...parts: Buffer[]): Buffer => box(type, u32(((v << 24) | flags) >>> 0), ...parts)

function trak(id: number, handler: string, timescale: number, entry: string, width = 0, height = 0): Buffer {
  const tkhd = full('tkhd', 1, 3, Buffer.alloc(16), u32(id, 0), Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(36), u32(width * 65536, height * 65536))
  const mdhd = full('mdhd', 1, 0, Buffer.alloc(16), u32(timescale), Buffer.alloc(8), Buffer.alloc(4))
  const hdlr = full('hdlr', 0, 0, u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(12), Buffer.from('x\0', 'latin1'))
  const stsd = full('stsd', 0, 0, u32(1), box(entry, Buffer.alloc(30, 7)))
  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', box('stbl', stsd))))
}

function makeInit(withAudio = true): Buffer {
  const trex = (id: number, flags: number): Buffer => full('trex', 0, 0, u32(id, 1, 0, 0, flags))
  return Buffer.concat([
    box('ftyp', Buffer.from('isom', 'latin1'), u32(512), Buffer.from('isomiso6', 'latin1')),
    box(
      'moov',
      full('mvhd', 1, 0, Buffer.alloc(104)),
      ...(withAudio ? [trak(AUDIO, 'soun', AUDIO_TS, 'mp4a')] : []),
      trak(VIDEO, 'vide', VIDEO_TS, 'avc1', 1920, 1080),
      box('mvex', trex(VIDEO, 0), ...(withAudio ? [trex(AUDIO, 0)] : []))
    )
  ])
}

interface RunSample {
  d: number
  s: number
}

/** moof + mdat comme ceux de Chromium : deux traf dans un moof, un seul mdat, données à partir du moof. */
function makeFragment(seq: number, videoAt: number, video: RunSample[], audioAt: number, audio: RunSample[], key = true): Buffer {
  const trafOf = (id: number, at: number, samples: RunSample[], dataOffset: number, flags: number): Buffer => {
    const tfhd = full('tfhd', 0, 0x20020, u32(id, flags))
    const tfdt = full('tfdt', 1, 0, Buffer.from(new BigUint64Array([BigInt(at)]).buffer).reverse())
    const video_ = id === VIDEO
    const rflags = video_ ? 0x305 : 0x301
    const head = video_ ? u32(samples.length, dataOffset, key ? SYNC : NON_SYNC) : u32(samples.length, dataOffset)
    const rows = u32(...samples.flatMap((r) => [r.d, r.s]))
    return box('traf', tfhd, tfdt, full('trun', 1, rflags, head, rows))
  }
  const moofSize = (a: number, v: number): number => box('moof', full('mfhd', 0, 0, u32(seq)), trafOf(AUDIO, 0, audio.slice(0, a), 0, SYNC), trafOf(VIDEO, 0, video.slice(0, v), 0, NON_SYNC)).length
  const size = moofSize(audio.length, video.length)
  const dataStart = size + 8
  const audioBytes = audio.reduce((n, r) => n + r.s, 0)
  const moof = box(
    'moof',
    full('mfhd', 0, 0, u32(seq)),
    trafOf(AUDIO, audioAt, audio, dataStart, SYNC),
    trafOf(VIDEO, videoAt, video, dataStart + audioBytes, NON_SYNC)
  )
  // Données reconnaissables : la valeur de l'octet dit la piste et le fragment.
  const data = Buffer.concat([Buffer.alloc(audioBytes, 0x10 + seq), Buffer.alloc(video.reduce((n, r) => n + r.s, 0), 0x80 + seq)])
  return Buffer.concat([moof, box('mdat', data)])
}

const repeat = (n: number, d: number, s: number): RunSample[] => Array.from({ length: n }, () => ({ d, s }))

/** Trois fragments de 2 s, comme le flux réel : la dernière durée de chaque piste est fausse, le tfdt suivant fait foi. */
function stream(): { init: Buffer; frags: Buffer[] } {
  const v = [...repeat(59, 1000, 300), { d: 999, s: 300 }]
  const a = [...repeat(99, 960, 100), { d: 240, s: 100 }]
  return {
    init: makeInit(),
    frags: [makeFragment(1, 0, v, 0, a), makeFragment(2, 60000, v, 96000, a), makeFragment(3, 120000, v, 192000, a)]
  }
}

function parsedStream(): { tracks: ClipTrack[]; frags: Buffer[]; infos: FragmentInfo[] } {
  const { init, frags } = stream()
  const info = parseInit(init)
  const infos = frags.map((f) => parseFragment(f, info))
  return { tracks: collectTracks(info, infos), frags, infos }
}

/** Le fichier réellement écrit à partir d'un plan. */
function assemble(plan: ReturnType<typeof buildFlat>, sources: Buffer[]): Buffer {
  return Buffer.concat([plan.head, ...plan.ranges.map((r) => sources[r.src].subarray(r.pos, r.pos + r.size))])
}

test('découpe du flux : init et fragments, quelle que soit la taille des morceaux', () => {
  const { init, frags } = stream()
  const all = Buffer.concat([init, ...frags])
  for (const size of [1, 7, 9, 16, 100, 1000, 100_000]) {
    const s = new Fmp4Splitter()
    const items = []
    for (let i = 0; i < all.length; i += size) items.push(...s.push(all.subarray(i, i + size)))
    assert.equal(items.length, 4, `morceaux de ${size}`)
    assert.equal(items[0].kind, 'init')
    assert.ok(items[0].data.equals(init))
    for (let i = 0; i < 3; i++) {
      assert.equal(items[i + 1].kind, 'fragment')
      assert.ok(items[i + 1].data.equals(frags[i]))
    }
  }
})

test('découpe du flux : ce qui n’est pas un fragment est ignoré, une taille impossible lève une erreur', () => {
  const { init, frags } = stream()
  const s = new Fmp4Splitter()
  const items = s.push(Buffer.concat([init, box('free', Buffer.alloc(5)), frags[0], box('mfra', Buffer.alloc(9))]))
  assert.deepEqual(items.map((i) => i.kind), ['init', 'fragment'])
  assert.throws(() => new Fmp4Splitter().push(Buffer.from([0, 0, 0, 3, 0x6d, 0x6f, 0x6f, 0x66])))
})

test('en-tête : pistes, échelles, taille de la vidéo, stsd gardé tel quel', () => {
  const info = parseInit(makeInit())
  const v = info.tracks.find((t) => t.kind === 'video')!
  const a = info.tracks.find((t) => t.kind === 'audio')!
  assert.deepEqual([v.id, v.timescale, v.width, v.height, v.codec], [VIDEO, VIDEO_TS, 1920, 1080, 'avc1'])
  assert.deepEqual([a.id, a.timescale, a.codec], [AUDIO, AUDIO_TS, 'mp4a'])
  assert.equal(v.stsd.toString('latin1', 4, 8), 'stsd')
  assert.throws(() => parseInit(box('ftyp', Buffer.alloc(8))))
})

test('fragment : temps, durée, image clé, position des données', () => {
  const { init, frags } = stream()
  const info = parseInit(init)
  const f = parseFragment(frags[1], info)
  assert.equal(f.key, true)
  assert.equal(f.startS, 2)
  assert.ok(Math.abs(f.endS - (2 + 59999 / VIDEO_TS)) < 1e-9)
  const v = f.tracks.find((t) => t.id === VIDEO)!
  assert.equal(v.tfdt, 60000)
  assert.equal(v.samples.length, 60)
  assert.equal(v.samples[0].sync, true)
  assert.equal(v.samples[1].sync, false)
  assert.equal(v.samples[1].dts, 61000)
  const a = f.tracks.find((t) => t.id === AUDIO)!
  assert.equal(a.samples.every((s) => s.sync), true)
  // Les octets désignés sont bien ceux de la bonne piste.
  assert.equal(frags[1][v.samples[0].pos], 0x80 + 2)
  assert.equal(frags[1][a.samples[0].pos], 0x10 + 2)
  assert.equal(frags[1][v.samples[59].pos + 299], 0x80 + 2)
})

test('fragment sans image clé, ou sans vidéo (piste vidéo terminée) : pas un début de clip possible', () => {
  const info = parseInit(makeInit())
  const noKey = parseFragment(makeFragment(1, 0, repeat(3, 1000, 10), 0, repeat(3, 960, 10), false), info)
  assert.equal(noKey.key, false)
  const audioOnly = parseFragment(makeFragment(2, 0, [], 96000, repeat(5, 960, 10)), info)
  assert.equal(audioOnly.key, false)
  assert.equal(audioOnly.startS, 2)
  assert.ok(audioOnly.tracks.find((t) => t.id === VIDEO)!.samples.length === 0)
})

test('fragment abîmé : erreur plutôt qu’un clip faux', () => {
  const { init, frags } = stream()
  const info = parseInit(init)
  assert.throws(() => parseFragment(frags[0].subarray(0, frags[0].length - 100), info))
  assert.throws(() => parseFragment(box('mdat', Buffer.alloc(8)), info))
})

test('coupe : part de la dernière image clé avant le début, finit à la fin demandée, le son suit', () => {
  const { tracks } = parsedStream()
  const cut = cutTracks(tracks, 2.5, 5)!
  const v = cut.find((t) => t.kind === 'video')!
  const a = cut.find((t) => t.kind === 'audio')!
  assert.equal(v.samples[0].dts, 60000)
  assert.equal(v.samples[0].sync, true)
  assert.ok(v.samples[v.samples.length - 1].dts / VIDEO_TS < 5)
  assert.ok(a.samples[0].dts / AUDIO_TS >= 2)
  assert.ok(a.samples[a.samples.length - 1].dts / AUDIO_TS < 5)
  // Avant le premier fragment : la première image clé.
  assert.equal(cutTracks(tracks, -3, 1)!.find((t) => t.kind === 'video')!.samples[0].dts, 0)
  // Coupe à la main : l'image clé la plus proche, jamais au-delà de la fin demandée.
  const startAt = (from: number, to: number): number => {
    const v = cutTracks(tracks, from, to, 'nearest')!.find((t) => t.kind === 'video')!
    return (v.samples[0].dts + v.samples[0].cto) / v.timescale
  }
  const keys = tracks.find((t) => t.kind === 'video')!
  const syncs = keys.samples.filter((s) => s.sync).map((s) => (s.dts + s.cto) / keys.timescale)
  assert.ok(syncs.length >= 2, 'il faut deux images clés pour cet essai')
  const [k0, k1] = syncs
  assert.equal(startAt(k1 - 0.01, k1 + 1), k1)
  assert.equal(startAt(k0 + 0.01, k1 + 1), k0)
  assert.equal(startAt(k1 - 0.01, k1 - 0.005), k0)
  // Sans vidéo : rien.
  assert.equal(cutTracks(tracks.filter((t) => t.kind === 'audio'), 0, 1), null)
})

test('MP4 classique : un moov complet devant, un seul mdat, données recopiées à l’identique', () => {
  const { tracks, frags } = parsedStream()
  const plan = buildFlat(cutTracks(tracks, 2.5, 5.5)!, { createdAtMs: Date.UTC(2026, 10, 3) })
  const file = assemble(plan, frags)
  assert.equal(file.length, plan.size)
  assert.deepEqual(readBoxes(file).map((b) => b.type), ['ftyp', 'moov', 'mdat'])
  const top = readBoxes(file)
  const moovRef = top[1]
  const moov = file.subarray(moovRef.start, moovRef.end)
  // Pas d'index de fragments : c'est un fichier ordinaire.
  assert.ok(!moov.includes(Buffer.from('mvex', 'latin1')))
  const back = parseFlat(moov)
  assert.deepEqual(back.map((t) => t.kind), ['video', 'audio'])
  const [v, a] = back
  // Vidéo : de 2 s à 5,5 s, soit 105 images, dont des images clés à 2 s et à 4 s.
  assert.equal(v.samples.length, 105)
  assert.deepEqual(v.samples.flatMap((s, i) => (s.sync ? [i] : [])), [0, 60])
  assert.equal(v.samples[0].dts, 0)
  // Chaque échantillon pointe vers les bons octets dans le fichier écrit.
  assert.equal(file[v.samples[0].pos], 0x80 + 2)
  assert.equal(file[v.samples[60].pos], 0x80 + 3)
  assert.equal(file[v.samples[60].pos + 299], 0x80 + 3)
  assert.equal(file[a.samples[0].pos], 0x10 + 2)
  // Son : même durée, même départ que la vidéo.
  assert.equal(a.samples[0].dts, 0)
  assert.equal(plan.width, 1920)
  assert.equal(plan.height, 1080)
  assert.ok(Math.abs(plan.durationS - 3.5) < 0.05)
})

test('MP4 classique : la dernière image d’un fragment dure jusqu’au début du suivant', () => {
  const { tracks, frags } = parsedStream()
  const plan = buildFlat(cutTracks(tracks, 0, 6)!)
  const top = readBoxes(assemble(plan, frags))
  const moov = assemble(plan, frags).subarray(top[1].start, top[1].end)
  const [v] = parseFlat(moov)
  // Aucun trou ni recouvrement : 60 000 ticks par fragment.
  assert.equal(v.samples[60].dts, 60000)
  assert.equal(v.samples[120].dts, 120000)
  assert.equal(v.samples[59].dur, 1000)
  assert.equal(v.samples[60].dts - v.samples[59].dts, 1000)
})

test('MP4 classique : le son qui démarre après l’image clé garde son écart (elst), relu à l’identique', () => {
  const info = parseInit(makeInit())
  const frag = makeFragment(1, 3000, repeat(30, 1000, 50), 4800 + 2400, repeat(40, 960, 20))
  const tracks = collectTracks(info, [parseFragment(frag, info)])
  const plan = buildFlat(cutTracks(tracks, 0, 10)!)
  const file = assemble(plan, [frag])
  const moov = file.subarray(readBoxes(file)[1].start, readBoxes(file)[1].end)
  assert.ok(moov.includes(Buffer.from('elst', 'latin1')))
  const [v, a] = parseFlat(moov)
  assert.equal(v.samples[0].dts, 0)
  // 2400 ticks à 48 kHz = 50 ms après l'image clé.
  assert.equal(a.samples[0].dts, 2400)
  // Une deuxième découpe garde le même écart.
  const again = buildFlat(cutTracks([v, a], 0, 0.5)!)
  const file2 = assemble(again, [file])
  const moov2 = file2.subarray(readBoxes(file2)[1].start, readBoxes(file2)[1].end)
  const [v2, a2] = parseFlat(moov2)
  assert.equal(v2.samples[0].dts, 0)
  assert.equal(a2.samples[0].dts, 2400)
  assert.equal(file2[v2.samples[0].pos], file[v.samples[0].pos])
})

test('MP4 classique sans son : une seule piste', () => {
  const info = parseInit(makeInit(false))
  const frag = (seq: number, at: number): Buffer => {
    // Sans piste audio, la piste 1 inconnue de l'en-tête est ignorée.
    return makeFragment(seq, at, repeat(10, 1000, 40), at, repeat(1, 960, 4))
  }
  const list = [frag(1, 0), frag(2, 10000)]
  const tracks = collectTracks(info, list.map((f) => parseFragment(f, info)))
  assert.deepEqual(tracks.map((t) => t.kind), ['video'])
  const plan = buildFlat(cutTracks(tracks, 0, 100)!)
  const file = assemble(plan, list)
  const [v] = parseFlat(file.subarray(readBoxes(file)[1].start, readBoxes(file)[1].end))
  assert.equal(v.samples.length, 20)
  assert.equal(file[v.samples[10].pos], 0x80 + 2)
})

test('images B : décalages gardés (ctts) et affichage ramené à zéro (elst)', () => {
  const samples = [
    { dts: 0, dur: 1000, size: 10, cto: 2000, sync: true, pos: 0, src: 0 },
    { dts: 1000, dur: 1000, size: 10, cto: 0, sync: false, pos: 10, src: 0 },
    { dts: 2000, dur: 1000, size: 10, cto: 1000, sync: false, pos: 20, src: 0 }
  ]
  const track: ClipTrack = { id: 1, kind: 'video', timescale: 30000, width: 640, height: 360, codec: 'avc1', stsd: full('stsd', 0, 0, u32(0)), samples }
  const plan = buildFlat([track])
  const file = assemble(plan, [Buffer.alloc(30, 9)])
  const moov = file.subarray(readBoxes(file)[1].start, readBoxes(file)[1].end)
  assert.ok(moov.includes(Buffer.from('ctts', 'latin1')))
  const [v] = parseFlat(moov)
  // Sur la ligne de lecture : la plus petite date d'affichage (l'image 2) tombe à zéro.
  assert.deepEqual(v.samples.map((s) => s.dts + s.cto), [1000, 0, 2000])
  assert.deepEqual(v.samples.map((s) => s.sync), [true, false, false])
})

test('données non contiguës : plusieurs plages, plusieurs chunks, positions justes', () => {
  const { tracks, frags } = parsedStream()
  const plan = buildFlat(cutTracks(tracks, 0, 6)!)
  // Trois sources, deux pistes : les plages contiguës d'une même source sont réunies.
  assert.ok(plan.ranges.length >= 3)
  assert.deepEqual([...new Set(plan.ranges.map((r) => r.src))], [0, 1, 2])
  const file = assemble(plan, frags)
  const [v, a] = parseFlat(file.subarray(readBoxes(file)[1].start, readBoxes(file)[1].end))
  for (const [n, s] of v.samples.entries()) assert.equal(file[s.pos], 0x80 + 1 + Math.floor(n / 60))
  for (const s of a.samples) assert.ok(file[s.pos] >= 0x11 && file[s.pos] <= 0x13)
})
