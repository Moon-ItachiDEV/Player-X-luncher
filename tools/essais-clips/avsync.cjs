// Écart son/image d'un fichier produit par la source d'essai : flash blanc (image) et bip (son) toutes les 2 s.
const { execFileSync, spawnSync } = require('child_process')
function videoFlashes(file) {
  const r = spawnSync('/usr/bin/ffmpeg', ['-hide_banner', '-i', file, '-map', '0:v', '-vf', 'scale=16:9,showinfo', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const out = []
  let prev = 0
  for (const l of r.stderr.split('\n')) {
    const m = /pts_time:([\d.]+).*mean:\[(\d+)/.exec(l)
    if (!m) continue
    const y = +m[2]
    if (y > 190 && prev <= 190) out.push(+m[1])
    prev = y
  }
  return out
}
function audioBeeps(file) {
  const pcm = execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a', '-af', 'aresample=first_pts=0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 29 })
  const f = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2)
  const out = []
  const hop = 240 // 5 ms
  let prev = 0
  for (let i = 0; i + hop < f.length; i += hop) {
    let e = 0
    for (let j = 0; j < hop; j++) e += f[i + j] * f[i + j]
    const rms = Math.sqrt(e / hop)
    if (rms > 0.1 && prev <= 0.1) out.push(i / 48000)
    prev = rms
  }
  return out
}
function avsync(file) {
  const v = videoFlashes(file), a = audioBeeps(file)
  const pairs = v.map((t) => { let best = null; for (const x of a) if (best === null || Math.abs(x - t) < Math.abs(best - t)) best = x; return best === null ? null : +(best - t).toFixed(3) }).filter((x) => x !== null && Math.abs(x) < 1)
  const mean = pairs.length ? pairs.reduce((s, x) => s + x, 0) / pairs.length : null
  return { flashes: v.length, beeps: a.length, écartsS: pairs, moyenneS: mean === null ? null : +mean.toFixed(3) }
}
module.exports = { avsync, videoFlashes, audioBeeps }
if (require.main === module) console.log(avsync(process.argv[2]))
