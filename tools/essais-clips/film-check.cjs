// Contrôles d'un film fabriqué à partir de clips de la source d'essai : l'heure peinte dans chaque image, le flash blanc et le
// bip (toutes les 2 s, au même instant). Tout se lit avec le ffmpeg de la machine, à part de celui qui a fabriqué le film.
const { execFileSync, spawnSync } = require('child_process')
const FF = '/usr/bin/ffmpeg'

const probeText = (file, args) => execFileSync('ffprobe', ['-v', 'error', ...args, file], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()

/** L'heure peinte en haut de chaque image (40 cases ; ligne 16 en 360p), pour toutes les images du fichier, dans l'ordre. */
function clocks(file, width, height) {
  const row = Math.round((16 * height) / 360)
  const raw = spawnSync(FF, ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `format=gray,crop=iw:1:0:${row}`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 }).stdout
  const cell = Math.floor(width / 40)
  const out = []
  for (let f = 0; f + width <= raw.length; f += width) {
    let v = 0
    for (let i = 0; i < 40; i++) if (raw[f + i * cell + (cell >> 1)] > 128) v += 2 ** i
    out.push(v * 10)
  }
  return out
}

/** Le temps d'affichage de chaque image, en secondes. */
const framePts = (file) => probeText(file, ['-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0']).split('\n').map((x) => Number(x.replace(',', '')))

/** Les instants où l'image devient blanche (le flash de la source d'essai). */
function flashes(file) {
  const r = spawnSync(FF, ['-hide_banner', '-i', file, '-map', '0:v:0', '-vf', 'scale=16:9,showinfo', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const out = []
  let prev = 0
  for (const l of r.stderr.split('\n')) {
    const m = /pts_time:([\d.]+).*mean:\[(\d+)/.exec(l)
    if (!m) continue
    if (+m[2] > 190 && prev <= 190) out.push(+m[1])
    prev = +m[2]
  }
  return out
}

/** Le son du fichier, en mono 48 kHz, depuis le temps 0 du fichier. */
function pcm(file) {
  const raw = spawnSync(FF, ['-v', 'error', '-i', file, '-map', '0:a:0', '-af', 'aresample=first_pts=0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 29 }).stdout
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length >> 2)
}

/** Les instants où le son devient fort (le bip de la source d'essai), à la milliseconde. */
function beeps(samples) {
  const out = []
  let prev = 0
  for (let i = 0; i + 48 < samples.length; i += 48) {
    let e = 0
    for (let q = 0; q < 48; q++) e += samples[i + q] * samples[i + q]
    const level = Math.sqrt(e / 48)
    if (level > 0.1 && prev <= 0.1) out.push(i / 48000)
    prev = level
  }
  return out
}

/**
 * L'écart, dans un clip, entre l'horodatage du son et le compte réel de ses échantillons (en secondes, à l'instant `t`). Les
 * horodatages de l'enregistreur se promènent de quelques millisecondes autour du compte (jusqu'à 20 ms mesurés). Un lecteur
 * qui se place à `t` cale le son sur l'horodatage : c'est ce que fait un plan de film. Un décodage du clip entier depuis son
 * début (pcm ci-dessus) suit le compte des échantillons : entre les deux mesures, l'écart est celui de l'instant de la coupe.
 */
function audioDrift(file) {
  const frames = probeText(file, ['-select_streams', 'a:0', '-show_entries', 'frame=pts,nb_samples', '-of', 'csv=p=0']).split('\n').map((l) => l.split(',').map(Number)).filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]))
  const rate = Number(probeText(file, ['-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0'])) || 48000
  let pos = frames.length ? frames[0][0] : 0
  const rows = frames.map(([pts, n]) => { const row = { t: pts / rate, drift: (pts - pos) / rate }; pos += n; return row })
  return (t) => { let d = 0; for (const r of rows) { if (r.t <= t + 1e-9) d = r.drift; else break } return d }
}

const near = (list, x, within = 0.5) => { let best = null; for (const y of list) if (best === null || Math.abs(y - x) < Math.abs(best - x)) best = y; return best !== null && Math.abs(best - x) < within ? best : null }

/**
 * Chaque image d'un plan du film est-elle celle du clip à cet instant ? `filmClock` : l'heure de chaque image du film ;
 * `base` : rang de la première image du plan ; `n` : nombre d'images ; `src` : { pts, clock } du clip ; `inS` : début du plan.
 * Le moteur prend les images du clip à partir de l'instant demandé et range chacune sur la grille à 60 images/s.
 */
function shotFrames(filmClock, base, n, src, inS) {
  const kept = src.pts.map((p, f) => ({ slot: Math.round((p - inS) * 60), f })).filter((x) => src.pts[x.f] >= inS - 1e-6)
  if (!kept.length) return { exact: 0, near: 0, bad: n, worst: null }
  let exact = 0, close = 0, bad = 0, worst = 0
  for (let j = 0; j < n; j++) {
    let shown = kept[0]
    for (const x of kept) if (x.slot <= j) shown = x
    const d = Math.abs(filmClock[base + j] - src.clock[shown.f])
    worst = Math.max(worst, d)
    if (d === 0) exact++
    else if (d <= 70) close++
    else bad++
  }
  return { exact, near: close, bad, worst }
}

module.exports = { clocks, framePts, flashes, pcm, beeps, audioDrift, near, shotFrames, probeText }
