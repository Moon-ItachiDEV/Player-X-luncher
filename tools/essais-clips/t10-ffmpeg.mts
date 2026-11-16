// Le module MP4 face à un autre muxeur : un MP4 fragmenté H.264 (images B) + AAC produit par ffmpeg (outil d'essai seulement)
// passe par le découpeur, les fragments et l'écriture classique, puis on compare les images décodées à l'original.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, openSync, readFileSync, readSync, writeFileSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { buildFlat, collectTracks, cutTracks, Fmp4Splitter, parseFlat, parseFragment, parseInit, readBoxes, type FragmentInfo, type InitInfo } from '../v3real/src/main/services/fmp4.ts'

const W = join(import.meta.dirname, 'work', 'ffmpeg')
mkdirSync(W, { recursive: true })
const SRC = join(W, 'src.mp4')
// 12 s, GOP de 2 s, images B, AAC.
execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-bf', '2', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'empty_moov+default_base_moof+frag_keyframe', SRC])

const all = readFileSync(SRC)
console.log('source', readBoxes(all).reduce<Record<string, number>>((m, b) => ((m[b.type] = (m[b.type] ?? 0) + 1), m), {}))
const splitter = new Fmp4Splitter()
let init: InitInfo | null = null
const frags: { data: Buffer; info: FragmentInfo }[] = []
for (let i = 0; i < all.length; i += 64 * 1024) {
  for (const item of splitter.push(all.subarray(i, i + 64 * 1024))) {
    if (item.kind === 'init') init = parseInit(item.data)
    else if (init) frags.push({ data: item.data, info: parseFragment(item.data, init) })
  }
}
if (!init) throw new Error('pas d’en-tête')
console.log('pistes', init.tracks.map((t) => [t.kind, t.codec, t.timescale, t.width, t.height]))
console.log('fragments', frags.length, 'clés', frags.filter((f) => f.info.key).length, frags.slice(0, 4).map((f) => [+f.info.startS.toFixed(3), +f.info.endS.toFixed(3), f.info.key]))

const assemble = (plan: ReturnType<typeof buildFlat>, sources: Buffer[], out: string): void => {
  writeFileSync(out, Buffer.concat([plan.head, ...plan.ranges.map((r) => sources[r.src].subarray(r.pos, r.pos + r.size))]))
}
const packets = (f: string, s: string): any[] => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', s, '-show_entries', 'packet=pts_time,dts_time,flags,size', '-of', 'json', f], { encoding: 'utf8', maxBuffer: 1 << 28 })).packets
const md5s = (f: string, extra: string[] = []): string[] => execFileSync('/usr/bin/ffmpeg', ['-v', 'error', ...extra, '-i', f, '-map', '0:v', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop()!.trim())

// Tout le flux
const tracks = collectTracks(init, frags.map((f) => f.info))
const whole = buildFlat(cutTracks(tracks, 0, 1e9)!)
const WHOLE = join(W, 'flat-whole.mp4')
assemble(whole, frags.map((f) => f.data), WHOLE)
const a = md5s(SRC), b = md5s(WHOLE)
console.log('tout le flux : images', a.length, b.length, 'identiques', a.length === b.length && a.every((x, i) => x === b[i]))
const probe = (f: string): unknown => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_name,duration,nb_read_packets,start_time', '-count_packets', '-of', 'json', f], { encoding: 'utf8' }))
console.log(JSON.stringify(probe(WHOLE)))
const pv = packets(WHOLE, 'v')
console.log('ordre de décodage différent de l’affichage (images B) :', pv.some((p, i) => p.pts_time !== p.dts_time))
console.log('images clés', pv.filter((p) => p.flags.startsWith('K')).length, 'attendues', frags.length)
// Un passage au milieu : 3,3 s à 8,4 s
const cut = cutTracks(tracks, 3.3, 8.4)!
const plan = buildFlat(cut)
const MID = join(W, 'flat-mid.mp4')
assemble(plan, frags.map((f) => f.data), MID)
console.log('passage :', plan.durationS, JSON.stringify(probe(MID)))
const m = md5s(MID)
const start = a.indexOf(m[0])
console.log('passage : images', m.length, 'à partir de l’image', start, 'attendue vers', 60, 'suite identique', m.every((x, i) => x === a[start + i]))
// Copie sans réencodage et lecture avec avance rapide par ffmpeg
const r = spawnSync('/usr/bin/ffmpeg', ['-v', 'warning', '-ss', '2.5', '-i', MID, '-frames:v', '10', '-f', 'null', '-'], { encoding: 'utf8' })
console.log('avance rapide : erreurs', JSON.stringify(r.stderr.slice(0, 300)))
const r2 = spawnSync('/usr/bin/ffmpeg', ['-v', 'warning', '-i', MID, '-c', 'copy', '-f', 'mp4', '-y', join(W, 'copy.mp4')], { encoding: 'utf8' })
console.log('recopie : erreurs', JSON.stringify(r2.stderr.slice(0, 300)))
// Relecture puis redécoupe
const fd = openSync(MID, 'r')
const top = readBoxes(readFileSync(MID))
const moovBox = top.find((x) => x.type === 'moov')!
const moov = Buffer.alloc(moovBox.end - moovBox.start)
readSync(fd, moov, 0, moov.length, moovBox.start)
closeSync(fd)
const back = parseFlat(moov)
const again = buildFlat(cutTracks(back, 1, 4)!)
const AGAIN = join(W, 'flat-again.mp4')
assemble(again, [readFileSync(MID)], AGAIN)
const c = md5s(AGAIN)
const s2 = a.indexOf(c[0])
console.log('redécoupe :', again.durationS, 'images', c.length, 'depuis', s2, 'suite identique', c.every((x, i) => x === a[s2 + i]), JSON.stringify(probe(AGAIN)))
