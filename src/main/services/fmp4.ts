// MP4 des clips : le MP4 fragmenté que produit MediaRecorder (ftyp + moov, puis des paires moof + mdat) entre dans le
// tampon circulaire ; un clip en sort en MP4 classique (moov complet devant, un seul mdat), sans réencodage : seuls les index
// sont réécrits, les données des images sont recopiées telles quelles.
// Pourquoi pas un MP4 fragmenté en sortie : le Lecteur multimédia de Windows le lit comme un direct (ni durée ni avance
// rapide) et l'Explorateur n'en montre pas la durée, même avec les bonnes boîtes. Le MP4 classique marche partout.
// Module pur, sans Electron ni disque (les lectures et écritures sont dans clips.ts) : testé par `npm run test:clips`.

export interface BoxRef {
  type: string
  /** Début de la boîte (en-tête compris). */
  start: number
  /** Début du contenu. */
  body: number
  end: number
}

/** Boîtes qui se suivent entre `start` et `end`. Une taille impossible lève une erreur (fichier ou flux abîmé). */
export function readBoxes(buf: Buffer, start = 0, end = buf.length): BoxRef[] {
  const out: BoxRef[] = []
  let p = start
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    let body = p + 8
    if (size === 1) {
      if (p + 16 > end) throw new Error('MP4 : boîte tronquée')
      size = Number(buf.readBigUInt64BE(p + 8))
      body = p + 16
    } else if (size === 0) size = end - p
    if (size < body - p || p + size > end) throw new Error(`MP4 : taille impossible pour la boîte ${type}`)
    out.push({ type, start: p, body, end: p + size })
    p += size
  }
  return out
}

const inside = (buf: Buffer, b: BoxRef): BoxRef[] => readBoxes(buf, b.body, b.end)
const pick = (list: BoxRef[], type: string): BoxRef | undefined => list.find((b) => b.type === type)

// ---------- découpe du flux ----------

/** Bien au-delà d'un fragment (2 s à 40 Mb/s font 10 Mo) : au-delà, le flux est abîmé. */
const MAX_BOX = 1024 * 1024 * 1024

export type SplitItem = { kind: 'init'; data: Buffer } | { kind: 'fragment'; data: Buffer; moofSize: number }

/**
 * Découpe le flux de MediaRecorder en boîtes, à cheval sur les morceaux reçus : init (ftyp + moov), puis fragments
 * (moof + mdat). Le reste (mfra, free…) est ignoré. Une taille impossible lève une erreur : l'enregistreur est à relancer.
 */
export class Fmp4Splitter {
  private parts: Buffer[] = []
  private have = 0
  /** Taille de la boîte en cours (0 : en-tête pas encore lu). */
  private need = 0
  private type = ''
  private ftyp: Buffer | null = null
  private moof: Buffer | null = null

  push(chunk: Uint8Array): SplitItem[] {
    const out: SplitItem[] = []
    this.parts.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
    this.have += chunk.byteLength
    for (;;) {
      if (!this.need && !this.readHeader()) break
      if (this.have < this.need) break
      const box = this.take(this.need)
      const type = this.type
      this.need = 0
      if (type === 'ftyp') this.ftyp = box
      else if (type === 'moov') out.push({ kind: 'init', data: this.ftyp ? Buffer.concat([this.ftyp, box]) : box })
      else if (type === 'moof') this.moof = box
      else if (type === 'mdat' && this.moof) {
        out.push({ kind: 'fragment', data: Buffer.concat([this.moof, box]), moofSize: this.moof.length })
        this.moof = null
      }
    }
    return out
  }

  private readHeader(): boolean {
    if (this.have < 8) return false
    const head = this.peek(Math.min(16, this.have))
    let size = head.readUInt32BE(0)
    if (size === 1) {
      if (head.length < 16) return false
      size = Number(head.readBigUInt64BE(8))
    }
    if (size < 8 || size > MAX_BOX) throw new Error(`MP4 : taille impossible dans le flux (${size})`)
    this.need = size
    this.type = head.toString('latin1', 4, 8)
    return true
  }

  private peek(n: number): Buffer {
    if (this.parts[0].length >= n) return this.parts[0].subarray(0, n)
    const joined = Buffer.concat(this.parts)
    this.parts = [joined]
    return joined.subarray(0, n)
  }

  private take(n: number): Buffer {
    const first = this.parts[0]
    let out: Buffer
    if (first.length >= n) {
      // Copie : un petit morceau gardé ne doit pas retenir tout le tampon reçu.
      out = first.length === n ? first : Buffer.from(first.subarray(0, n))
      if (first.length === n) this.parts.shift()
      else this.parts[0] = first.subarray(n)
    } else {
      const joined = Buffer.concat(this.parts)
      out = Buffer.from(joined.subarray(0, n))
      this.parts = joined.length > n ? [joined.subarray(n)] : []
    }
    this.have -= n
    return out
  }
}

// ---------- init ----------

export type TrackKind = 'video' | 'audio' | 'other'

export interface InitTrack {
  id: number
  kind: TrackKind
  timescale: number
  width: number
  height: number
  /** Format du premier stsd : avc1, mp4a, Opus, vp09… */
  codec: string
  /** Boîte stsd complète, recopiée telle quelle dans le clip. */
  stsd: Buffer
  defaultDuration: number
  defaultSize: number
  defaultFlags: number
}

export interface InitInfo {
  tracks: InitTrack[]
}

function readTrakCommon(buf: Buffer, trak: BoxRef): Omit<InitTrack, 'defaultDuration' | 'defaultSize' | 'defaultFlags'> | null {
  const parts = inside(buf, trak)
  const tkhd = pick(parts, 'tkhd')
  const mdia = pick(parts, 'mdia')
  if (!tkhd || !mdia) return null
  const v1 = buf[tkhd.body] === 1
  const id = buf.readUInt32BE(tkhd.body + (v1 ? 20 : 12))
  let width = buf.readUInt32BE(tkhd.body + (v1 ? 88 : 76)) >>> 16
  let height = buf.readUInt32BE(tkhd.body + (v1 ? 92 : 80)) >>> 16
  const mparts = inside(buf, mdia)
  const mdhd = pick(mparts, 'mdhd')
  const hdlr = pick(mparts, 'hdlr')
  const minf = pick(mparts, 'minf')
  const stbl = minf && pick(inside(buf, minf), 'stbl')
  const stsd = stbl && pick(inside(buf, stbl), 'stsd')
  if (!mdhd || !hdlr || !stsd) return null
  const timescale = buf.readUInt32BE(mdhd.body + (buf[mdhd.body] === 1 ? 20 : 12))
  const handler = buf.toString('latin1', hdlr.body + 8, hdlr.body + 12)
  const kind: TrackKind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : 'other'
  const codec = stsd.end - stsd.body >= 16 ? buf.toString('latin1', stsd.body + 12, stsd.body + 16) : ''
  // tkhd sans taille : celle de l'entrée vidéo du stsd.
  if (kind === 'video' && (!width || !height) && stsd.end - stsd.body >= 44) {
    width = buf.readUInt16BE(stsd.body + 8 + 32)
    height = buf.readUInt16BE(stsd.body + 8 + 34)
  }
  if (!timescale) return null
  return { id, kind, timescale, width, height, codec, stsd: Buffer.from(buf.subarray(stsd.start, stsd.end)) }
}

export function parseInit(init: Buffer): InitInfo {
  const moov = pick(readBoxes(init), 'moov')
  if (!moov) throw new Error('MP4 : pas de moov dans l’en-tête')
  const parts = inside(init, moov)
  const trex = new Map<number, { dur: number; size: number; flags: number }>()
  const mvex = pick(parts, 'mvex')
  if (mvex)
    for (const b of inside(init, mvex))
      if (b.type === 'trex')
        trex.set(init.readUInt32BE(b.body + 4), { dur: init.readUInt32BE(b.body + 12), size: init.readUInt32BE(b.body + 16), flags: init.readUInt32BE(b.body + 20) })
  const tracks: InitTrack[] = []
  for (const b of parts) {
    if (b.type !== 'trak') continue
    const t = readTrakCommon(init, b)
    if (!t) continue
    const d = trex.get(t.id)
    tracks.push({ ...t, defaultDuration: d?.dur ?? 0, defaultSize: d?.size ?? 0, defaultFlags: d?.flags ?? 0 })
  }
  if (!tracks.length) throw new Error('MP4 : aucune piste dans l’en-tête')
  return { tracks }
}

// ---------- fragments ----------

export interface Sample {
  /** Temps de décodage, dans l'échelle de la piste. */
  dts: number
  dur: number
  size: number
  /** Décalage d'affichage (images B). */
  cto: number
  sync: boolean
  /** Position des données dans leur source (fragment : depuis le début du moof ; clip : depuis le début du fichier). */
  pos: number
  /** Numéro de la source, pour la copie. */
  src: number
}

export interface FragmentTrack {
  id: number
  tfdt: number
  samples: Sample[]
}

export interface FragmentInfo {
  size: number
  moofSize: number
  tracks: FragmentTrack[]
  /** Commence par une image clé (piste vidéo). Un fragment sans vidéo n'en est pas. */
  key: boolean
  /** Début et fin sur la piste vidéo (ou l'audio si le fragment n'a pas de vidéo), en secondes depuis le début du flux. */
  startS: number
  endS: number
}

const NON_SYNC = 0x10000

/** Lit moof + mdat : temps de décodage (tfdt), durées et tailles (trun, tfhd, trex), images clés (sample flags). */
export function parseFragment(frag: Buffer, init: InitInfo): FragmentInfo {
  const top = readBoxes(frag)
  const moof = pick(top, 'moof')
  if (!moof) throw new Error('MP4 : fragment sans moof')
  const tracks: FragmentTrack[] = []
  let prevEnd = moof.start
  for (const traf of inside(frag, moof)) {
    if (traf.type !== 'traf') continue
    const parts = inside(frag, traf)
    const tfhd = pick(parts, 'tfhd')
    if (!tfhd) continue
    const flags = frag.readUInt32BE(tfhd.body) & 0xffffff
    const id = frag.readUInt32BE(tfhd.body + 4)
    const info = init.tracks.find((t) => t.id === id)
    if (!info) continue
    let q = tfhd.body + 8
    if (flags & 0x1) throw new Error('MP4 : décalage absolu non pris en charge')
    if (flags & 0x2) q += 4
    let defDur = info.defaultDuration
    let defSize = info.defaultSize
    let defFlags = info.defaultFlags
    if (flags & 0x8) {
      defDur = frag.readUInt32BE(q)
      q += 4
    }
    if (flags & 0x10) {
      defSize = frag.readUInt32BE(q)
      q += 4
    }
    if (flags & 0x20) defFlags = frag.readUInt32BE(q)
    const tfdtBox = pick(parts, 'tfdt')
    if (!tfdtBox) throw new Error('MP4 : fragment sans tfdt')
    const tfdt = frag[tfdtBox.body] === 1 ? Number(frag.readBigUInt64BE(tfdtBox.body + 4)) : frag.readUInt32BE(tfdtBox.body + 4)
    const base = flags & 0x20000 ? moof.start : prevEnd
    let nextPos = base
    let dts = tfdt
    const samples: Sample[] = []
    for (const trun of parts) {
      if (trun.type !== 'trun') continue
      const rf = frag.readUInt32BE(trun.body) & 0xffffff
      const n = frag.readUInt32BE(trun.body + 4)
      let r = trun.body + 8
      if (rf & 0x1) {
        nextPos = base + frag.readInt32BE(r)
        r += 4
      }
      let firstFlags: number | undefined
      if (rf & 0x4) {
        firstFlags = frag.readUInt32BE(r)
        r += 4
      }
      const row = (rf & 0x100 ? 4 : 0) + (rf & 0x200 ? 4 : 0) + (rf & 0x400 ? 4 : 0) + (rf & 0x800 ? 4 : 0)
      if (r + row * n > trun.end) throw new Error('MP4 : trun tronqué')
      for (let i = 0; i < n; i++) {
        let dur = defDur
        let size = defSize
        let sf = i === 0 && firstFlags !== undefined ? firstFlags : defFlags
        let cto = 0
        if (rf & 0x100) {
          dur = frag.readUInt32BE(r)
          r += 4
        }
        if (rf & 0x200) {
          size = frag.readUInt32BE(r)
          r += 4
        }
        if (rf & 0x400) {
          sf = frag.readUInt32BE(r)
          r += 4
        }
        if (rf & 0x800) {
          cto = frag.readInt32BE(r)
          r += 4
        }
        if (nextPos + size > frag.length) throw new Error('MP4 : données hors du fragment')
        samples.push({ dts, dur, size, cto, sync: (sf & NON_SYNC) === 0, pos: nextPos, src: 0 })
        dts += dur
        nextPos += size
      }
    }
    prevEnd = nextPos
    tracks.push({ id, tfdt, samples })
  }
  const withSamples = tracks.filter((t) => t.samples.length)
  const kindOf = (t: FragmentTrack): TrackKind | undefined => init.tracks.find((x) => x.id === t.id)?.kind
  const video = withSamples.find((t) => kindOf(t) === 'video')
  const ref = video ?? withSamples[0]
  let startS = 0
  let endS = 0
  if (ref) {
    const ts = init.tracks.find((x) => x.id === ref.id)!.timescale
    const last = ref.samples[ref.samples.length - 1]
    startS = ref.tfdt / ts
    endS = (last.dts + last.dur) / ts
  }
  return { size: frag.length, moofSize: moof.end, tracks, key: !!video?.samples[0].sync, startS, endS }
}

// ---------- pistes d'un clip ----------

export interface ClipTrack {
  id: number
  kind: TrackKind
  timescale: number
  width: number
  height: number
  codec: string
  stsd: Buffer
  samples: Sample[]
}

/** Regroupe les échantillons de fragments qui se suivent : `src` devient le rang du fragment dans la liste. */
export function collectTracks(init: InitInfo, frags: FragmentInfo[]): ClipTrack[] {
  const byId = new Map<number, Sample[]>()
  frags.forEach((f, src) => {
    for (const t of f.tracks) {
      const list = byId.get(t.id) ?? []
      for (const s of t.samples) list.push({ ...s, src })
      byId.set(t.id, list)
    }
  })
  return init.tracks.flatMap((t) => {
    const samples = byId.get(t.id)
    if (!samples?.length || t.kind === 'other') return []
    return [{ id: t.id, kind: t.kind, timescale: t.timescale, width: t.width, height: t.height, codec: t.codec, stsd: t.stsd, samples }]
  })
}

/**
 * Garde [startS ; endS[ (secondes dans le flux) : la vidéo commence sur la dernière image clé avant `startS` (la première
 * s'il n'y en a pas avant), le son à cette image-là. null : pas de vidéo, ou aucune image clé.
 */
export function cutTracks(tracks: ClipTrack[], startS: number, endS: number, align: 'before' | 'nearest' = 'before'): ClipTrack[] | null {
  const video = tracks.find((t) => t.kind === 'video' && t.samples.length)
  if (!video) return null
  const ts = video.timescale
  const at = (i: number): number => (video.samples[i].dts + video.samples[i].cto) / ts
  let first = -1
  let next = -1
  for (let i = 0; i < video.samples.length; i++) {
    if (!video.samples[i].sync) continue
    if (at(i) <= startS) first = i
    else {
      next = i
      if (first < 0) first = i
      break
    }
  }
  if (first < 0) return null
  // Une coupe à la main : au plus près de ce qui est demandé (un clip automatique garde « avant » en entier).
  if (align === 'nearest' && next > first && at(next) - startS < startS - at(first) && at(next) < endS) first = next
  const t0 = at(first)
  const out: ClipTrack[] = []
  for (const t of tracks) {
    if (!t.samples.length) continue
    if (t === video) {
      // Coupé en temps de décodage : avec des images B, l'ordre de décodage reste entier.
      const kept = t.samples.slice(first).filter((s, i) => i === 0 || s.dts / ts < endS)
      out.push({ ...t, samples: kept })
    } else {
      const kept = t.samples.filter((s) => s.dts / t.timescale >= t0 && s.dts / t.timescale < endS)
      if (kept.length) out.push({ ...t, samples: kept })
    }
  }
  return out
}

/**
 * Le moment où commence une coupe : le temps d'affichage de sa première image (une image clé), dans la même horloge que les
 * pistes données à cutTracks. 0 : pas de vidéo. Sert à situer les événements d'un clip dans son fichier.
 */
export function firstFrameS(tracks: ClipTrack[]): number {
  const video = tracks.find((t) => t.kind === 'video' && t.samples.length)
  if (!video) return 0
  const s = video.samples[0]
  return (s.dts + s.cto) / video.timescale
}

// ---------- écriture en MP4 classique ----------

export interface CopyRange {
  src: number
  pos: number
  size: number
}

export interface FlatPlan {
  /** ftyp + moov + en-tête du mdat. */
  head: Buffer
  /** Données à recopier à la suite, dans l'ordre. */
  ranges: CopyRange[]
  size: number
  durationS: number
  width: number
  height: number
}

const MOVIE_TIMESCALE = 1000
/** Secondes entre 1904 (origine des dates du MP4) et 1970. */
const EPOCH_1904 = 2_082_844_800

/** Une liste entière (une table d'index peut compter des dizaines de milliers de valeurs). */
function u32s(values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 4)
  values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4))
  return b
}

const u32 = (...values: number[]): Buffer => u32s(values)

function u64(v: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(v))
  return b
}

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length + 8, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}

const fullBox = (type: string, version: number, flags: number, ...parts: Buffer[]): Buffer => box(type, u32(((version << 24) | flags) >>> 0), ...parts)

const MATRIX = u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000)

/** Paires (nombre, valeur) d'une liste, pour stts et ctts. */
function runs(values: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const v of values) {
    const last = out[out.length - 1]
    if (last && last[1] === v) last[0]++
    else out.push([1, v])
  }
  return out
}

function ftypFor(tracks: ClipTrack[]): Buffer {
  const brands = ['isom', 'iso2']
  const video = tracks.find((t) => t.kind === 'video')
  if (video?.codec === 'avc1' || video?.codec === 'avc3') brands.push('avc1')
  if (video?.codec === 'vp09') brands.push('vp09')
  if (video?.codec === 'av01') brands.push('av01')
  brands.push('mp41')
  return box('ftyp', Buffer.from('isom', 'latin1'), u32(512), ...brands.map((b) => Buffer.from(b, 'latin1')))
}

interface TrackLayout {
  track: ClipTrack
  chunks: { rel: number; count: number }[]
}

/**
 * Le clip en MP4 classique : pistes ramenées à zéro (le son qui démarre après l'image clé garde son écart dans un elst),
 * dernier échantillon de chaque fragment recalé sur le début du suivant, images clés dans stss. Les données restent dans
 * l'ordre où elles arrivent, chaque suite d'une même piste forme un chunk.
 */
export function buildFlat(input: ClipTrack[], opts: { createdAtMs?: number } = {}): FlatPlan {
  const tracks = input.filter((t) => t.samples.length && (t.kind === 'video' || t.kind === 'audio'))
  if (!tracks.some((t) => t.kind === 'video')) throw new Error('MP4 : clip sans vidéo')
  tracks.sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === 'video' ? -1 : 1))

  // Ordre des données : celui des sources.
  const order: { t: number; s: Sample }[] = []
  tracks.forEach((track, t) => track.samples.forEach((s) => order.push({ t, s })))
  order.sort((a, b) => a.s.src - b.s.src || a.s.pos - b.s.pos)
  const layouts: TrackLayout[] = tracks.map((track) => ({ track, chunks: [] }))
  const ranges: CopyRange[] = []
  let rel = 0
  let lastT = -1
  for (const { t, s } of order) {
    const tail = ranges[ranges.length - 1]
    const adjacent = !!tail && tail.src === s.src && tail.pos + tail.size === s.pos
    if (adjacent) tail.size += s.size
    else ranges.push({ src: s.src, pos: s.pos, size: s.size })
    const chunks = layouts[t].chunks
    if (adjacent && lastT === t) chunks[chunks.length - 1].count++
    else chunks.push({ rel, count: 1 })
    rel += s.size
    lastT = t
  }

  // Temps : tout est ramené au premier affichage du clip.
  const firstPts = (t: ClipTrack): number => Math.min(...t.samples.slice(0, 64).map((s) => s.dts + s.cto)) / t.timescale
  const start = Math.min(...tracks.map(firstPts))
  const durations = tracks.map((t) => {
    const n = t.samples.length
    const deltas = t.samples.map((s, i) => (i < n - 1 ? Math.max(0, t.samples[i + 1].dts - s.dts) : s.dur))
    return { deltas, total: deltas.reduce((a, b) => a + b, 0) }
  })
  const emptyMs = tracks.map((t) => Math.max(0, Math.round((firstPts(t) - start) * MOVIE_TIMESCALE)))
  const trackMs = durations.map((d, i) => Math.round((d.total / tracks[i].timescale) * MOVIE_TIMESCALE))
  const movieMs = Math.max(...trackMs.map((ms, i) => ms + emptyMs[i]))
  const created = opts.createdAtMs ? Math.floor(opts.createdAtMs / 1000) + EPOCH_1904 : 0

  const wide = rel > 0xf0000000
  const ftyp = ftypFor(tracks)
  const moovAt = (base: number): Buffer =>
    box(
      'moov',
      fullBox('mvhd', 0, 0, u32(created, created, MOVIE_TIMESCALE, movieMs, 0x00010000), Buffer.from([0x01, 0x00, 0, 0]), Buffer.alloc(8), MATRIX, Buffer.alloc(24), u32(Math.max(...tracks.map((t) => t.id)) + 1)),
      ...layouts.map((l, i) => {
        const t = l.track
        const video = t.kind === 'video'
        const d = durations[i]
        const pts0 = Math.min(...t.samples.slice(0, 64).map((s) => s.dts + s.cto)) - t.samples[0].dts
        const tkhd = fullBox(
          'tkhd',
          0,
          3,
          u32(created, created, t.id, 0, trackMs[i] + emptyMs[i], 0, 0),
          // Couche, groupe (le son : 1), volume, réservé.
          Buffer.from([0, 0, 0, video ? 0 : 1, video ? 0 : 1, 0, 0, 0]),
          MATRIX,
          u32((video ? t.width : 0) * 65536, (video ? t.height : 0) * 65536)
        )
        const edits: Buffer[] = []
        if (emptyMs[i] > 0) edits.push(Buffer.concat([u32(emptyMs[i], 0xffffffff), Buffer.from([0, 1, 0, 0])]))
        if (emptyMs[i] > 0 || pts0 > 0) edits.push(Buffer.concat([u32(trackMs[i], Math.max(0, pts0)), Buffer.from([0, 1, 0, 0])]))
        const edts = edits.length ? [box('edts', fullBox('elst', 0, 0, u32(edits.length), ...edits))] : []
        const sttsRuns = runs(d.deltas)
        const ctos = t.samples.map((s) => s.cto)
        const hasCto = ctos.some((c) => c !== 0)
        const cttsRuns = hasCto ? runs(ctos) : []
        const negative = ctos.some((c) => c < 0)
        const syncs = t.samples.flatMap((s, n) => (s.sync ? [n + 1] : []))
        const perChunk = runs(l.chunks.map((c) => c.count))
        let firstChunk = 1
        const stsc = perChunk.map(([count, samples]) => {
          const row = u32(firstChunk, samples, 1)
          firstChunk += count
          return row
        })
        const stbl = box(
          'stbl',
          t.stsd,
          fullBox('stts', 0, 0, u32(sttsRuns.length), ...sttsRuns.map(([n, v]) => u32(n, v))),
          ...(hasCto ? [fullBox('ctts', negative ? 1 : 0, 0, u32(cttsRuns.length), ...cttsRuns.map(([n, v]) => u32(n, v)))] : []),
          ...(syncs.length < t.samples.length ? [fullBox('stss', 0, 0, u32(syncs.length), u32s(syncs))] : []),
          fullBox('stsc', 0, 0, u32(stsc.length), ...stsc),
          fullBox('stsz', 0, 0, u32(0, t.samples.length), u32s(t.samples.map((s) => s.size))),
          wide
            ? fullBox('co64', 0, 0, u32(l.chunks.length), ...l.chunks.map((c) => u64(base + c.rel)))
            : fullBox('stco', 0, 0, u32(l.chunks.length), u32s(l.chunks.map((c) => base + c.rel)))
        )
        const name = Buffer.from(video ? 'VideoHandler\0' : 'SoundHandler\0', 'latin1')
        const minf = box(
          'minf',
          video ? fullBox('vmhd', 0, 1, Buffer.alloc(8)) : fullBox('smhd', 0, 0, Buffer.alloc(4)),
          box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
          stbl
        )
        const mdia = box(
          'mdia',
          // Langue « und ».
          fullBox('mdhd', 0, 0, u32(created, created, t.timescale, d.total), Buffer.from([0x55, 0xc4, 0, 0])),
          fullBox('hdlr', 0, 0, u32(0), Buffer.from(video ? 'vide' : 'soun', 'latin1'), Buffer.alloc(12), name),
          minf
        )
        return box('trak', tkhd, ...edts, mdia)
      })
    )
  const mdatLarge = rel + 8 > 0xffffffff
  const mdatHead = mdatLarge ? Buffer.concat([u32(1), Buffer.from('mdat', 'latin1'), u64(rel + 16)]) : Buffer.concat([u32(rel + 8), Buffer.from('mdat', 'latin1')])
  const moovSize = moovAt(0).length
  const moov = moovAt(ftyp.length + moovSize + mdatHead.length)
  const head = Buffer.concat([ftyp, moov, mdatHead])
  const video = tracks.find((t) => t.kind === 'video')!
  return { head, ranges, size: head.length + rel, durationS: movieMs / MOVIE_TIMESCALE, width: video.width, height: video.height }
}

// ---------- relecture d'un clip (découpe) ----------

/**
 * Pistes d'un MP4 classique à partir de sa boîte moov complète (en-tête compris). Les temps sont ceux de la lecture : un
 * échantillon affiché à t secondes a dts + cto = t × échelle (d'où un dts négatif pour la première image s'il y a des images B).
 */
export function parseFlat(moovBox: Buffer): ClipTrack[] {
  const moov = pick(readBoxes(moovBox), 'moov')
  if (!moov) throw new Error('MP4 : pas de moov')
  const parts = inside(moovBox, moov)
  const mvhd = pick(parts, 'mvhd')
  if (!mvhd) throw new Error('MP4 : pas de mvhd')
  const movieTs = moovBox.readUInt32BE(mvhd.body + (moovBox[mvhd.body] === 1 ? 20 : 12))
  const out: ClipTrack[] = []
  for (const trak of parts) {
    if (trak.type !== 'trak') continue
    const common = readTrakCommon(moovBox, trak)
    if (!common || common.kind === 'other') continue
    const tp = inside(moovBox, trak)
    const mdia = pick(tp, 'mdia')!
    const minf = pick(inside(moovBox, mdia), 'minf')!
    const stbl = inside(moovBox, pick(inside(moovBox, minf), 'stbl')!)
    const need = (type: string): BoxRef => {
      const b = pick(stbl, type)
      if (!b) throw new Error(`MP4 : pas de ${type}`)
      return b
    }
    // Échantillons : tailles.
    const stsz = need('stsz')
    const fixed = moovBox.readUInt32BE(stsz.body + 4)
    const count = moovBox.readUInt32BE(stsz.body + 8)
    const sizeOf = (i: number): number => fixed || moovBox.readUInt32BE(stsz.body + 12 + i * 4)
    // Temps.
    const samples: Sample[] = new Array(count)
    const stts = need('stts')
    const nStts = moovBox.readUInt32BE(stts.body + 4)
    let idx = 0
    let dts = 0
    for (let e = 0; e < nStts; e++) {
      const n = moovBox.readUInt32BE(stts.body + 8 + e * 8)
      const delta = moovBox.readUInt32BE(stts.body + 12 + e * 8)
      for (let i = 0; i < n && idx < count; i++, idx++) {
        samples[idx] = { dts, dur: delta, size: sizeOf(idx), cto: 0, sync: true, pos: 0, src: 0 }
        dts += delta
      }
    }
    if (idx !== count) throw new Error('MP4 : stts et stsz en désaccord')
    const ctts = pick(stbl, 'ctts')
    if (ctts) {
      const nCtts = moovBox.readUInt32BE(ctts.body + 4)
      let k = 0
      for (let e = 0; e < nCtts; e++) {
        const n = moovBox.readUInt32BE(ctts.body + 8 + e * 8)
        const off = moovBox.readInt32BE(ctts.body + 12 + e * 8)
        for (let i = 0; i < n && k < count; i++, k++) samples[k].cto = off
      }
    }
    const stss = pick(stbl, 'stss')
    if (stss) {
      for (const s of samples) s.sync = false
      const nSync = moovBox.readUInt32BE(stss.body + 4)
      for (let e = 0; e < nSync; e++) {
        const s = samples[moovBox.readUInt32BE(stss.body + 8 + e * 4) - 1]
        if (s) s.sync = true
      }
    }
    // Positions.
    const co64 = pick(stbl, 'co64')
    const stco = co64 ?? need('stco')
    const nChunks = moovBox.readUInt32BE(stco.body + 4)
    const chunkAt = (c: number): number => (co64 ? Number(moovBox.readBigUInt64BE(stco.body + 8 + c * 8)) : moovBox.readUInt32BE(stco.body + 8 + c * 4))
    const stsc = need('stsc')
    const nStsc = moovBox.readUInt32BE(stsc.body + 4)
    let k = 0
    for (let e = 0; e < nStsc; e++) {
      const firstChunk = moovBox.readUInt32BE(stsc.body + 8 + e * 12) - 1
      const perChunk = moovBox.readUInt32BE(stsc.body + 12 + e * 12)
      const nextFirst = e + 1 < nStsc ? moovBox.readUInt32BE(stsc.body + 8 + (e + 1) * 12) - 1 : nChunks
      for (let c = firstChunk; c < nextFirst; c++) {
        let pos = chunkAt(c)
        for (let i = 0; i < perChunk && k < count; i++, k++) {
          samples[k].pos = pos
          pos += samples[k].size
        }
      }
    }
    if (k !== count) throw new Error('MP4 : stsc et stsz en désaccord')
    // Liste d'éditions : écart de départ (entrée vide) et début réel de l'affichage.
    let shift = 0
    const edts = pick(tp, 'edts')
    const elst = edts && pick(inside(moovBox, edts), 'elst')
    if (elst) {
      const v1 = moovBox[elst.body] === 1
      const n = moovBox.readUInt32BE(elst.body + 4)
      const row = v1 ? 20 : 12
      for (let e = 0; e < n; e++) {
        const at = elst.body + 8 + e * row
        const seg = v1 ? Number(moovBox.readBigUInt64BE(at)) : moovBox.readUInt32BE(at)
        const media = v1 ? Number(moovBox.readBigInt64BE(at + 8)) : moovBox.readInt32BE(at + 4)
        if (media < 0) shift += (seg / movieTs) * common.timescale
        else {
          shift -= media
          break
        }
      }
    }
    shift = Math.round(shift)
    if (shift) for (const s of samples) s.dts += shift
    out.push({ ...common, samples })
  }
  return out
}
