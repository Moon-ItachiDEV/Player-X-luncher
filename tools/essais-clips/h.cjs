// Outils d'essai des clips : Electron + Playwright, sous Xvfb. Hors du projet (scratchpad).
const { _electron } = require('playwright')
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process')
const ROOT = path.resolve(__dirname, '../..')
const WORK = path.resolve(__dirname, 'work')

function freshDirs(name) {
  const base = path.join(WORK, `${name}-${Date.now().toString(36)}`)
  const userData = path.join(base, 'userData'), home = path.join(base, 'home')
  fs.mkdirSync(userData, { recursive: true }); fs.mkdirSync(home, { recursive: true })
  return { base, userData, home }
}

async function start(dirs, env = {}, extraArgs = []) {
  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--user-data-dir=${dirs.userData}`, ...extraArgs, '.'],
    cwd: ROOT,
    env: { ...process.env, HOME: dirs.home, XDG_CONFIG_HOME: path.join(dirs.home, '.config'), ...env }
  })
  const logs = []
  const proc = app.process()
  proc.stdout.on('data', (d) => logs.push(String(d)))
  proc.stderr.on('data', (d) => logs.push(String(d)))
  const p = await app.firstWindow()
  const errs = []
  p.on('pageerror', (e) => errs.push('PAGE ' + (e.stack || e.message)))
  await p.waitForLoadState('domcontentloaded')
  return { app, p, errs, logs, proc }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms, what, step = 250) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`Délai dépassé : ${what}`)
    await sleep(step)
  }
}

const launcher = (p, name, ...args) => p.evaluate(([n, a]) => window.launcher[n](...a), [name, args])
const test = (app, name, ...args) => app.evaluate((_e, [n, a]) => globalThis.pxClipsTest[n](...a), [name, args])
const simPost = (app, body) => app.evaluate((_e, b) => globalThis.pxCs2Sim.post(b), body)
const simRunning = (app, on) => app.evaluate((_e, v) => globalThis.pxCs2Sim.running(v), on)

function payload(p = {}) {
  const ME = '76561198000000001', MATE = '76561198000000002'
  return {
    provider: { name: 'Counter-Strike: Global Offensive', appid: 730, version: 14100, steamid: ME, timestamp: Math.floor(Date.now() / 1000) },
    ...(p.noMap ? {} : {
      map: { mode: p.mode || 'competitive', name: p.map || 'de_mirage', phase: p.mapPhase || 'live', round: p.round ?? 0, team_ct: { score: p.ct ?? 0 }, team_t: { score: p.t ?? 0 }, round_wins: {} },
      round: { phase: p.phase || 'live' }
    }),
    player: {
      steamid: p.spectating ? MATE : ME, name: 'Breezy', team: p.team || 'CT', activity: 'playing',
      state: { health: p.health ?? 100, armor: 100, helmet: true, money: 800, round_kills: p.rk ?? 0, round_killhs: p.rhs ?? 0, round_totaldmg: 0 },
      match_stats: { kills: p.kills ?? 0, assists: 0, deaths: p.deaths ?? 0, mvps: 0, score: 0 }
    }
  }
}

const ffprobe = (file, ...args) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', ...args, file], { encoding: 'utf8', maxBuffer: 1 << 28 }))
function probe(file) {
  const j = ffprobe(file, '-show_format', '-show_streams', '-count_packets')
  return {
    duration: +j.format.duration, size: +j.format.size, format: j.format.format_name, brand: j.format.tags && j.format.tags.major_brand,
    streams: j.streams.map((s) => ({ type: s.codec_type, codec: s.codec_name, w: s.width, h: s.height, dur: +s.duration, packets: +s.nb_read_packets, start: +s.start_time, profile: s.profile }))
  }
}

/** Décode vraiment tout le fichier : renvoie le nombre d'images et les erreurs du décodeur. */
function decodeCheck(file) {
  let out = ''
  try {
    out = execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 })
  } catch (e) { return { ok: false, err: String(e.stderr || e.message).slice(0, 2000) } }
  return { ok: true, out: out.slice(0, 500) }
}

/** L'heure peinte dans l'image par la source d'essai (centièmes de seconde sur 40 bits, ligne du haut), à cet instant du fichier. */
function clockAt(file, atS, width = 1280, height = 720) {
  // Un instant après la dernière image ne rend aucune image : la fin d'un clip est celle du son, qui peut finir quelques
  // dizaines de millisecondes après l'image (« durée − 0,1 s » tombait alors parfois après elle). On recule par pas de
  // 20 ms, au plus de 0,3 s, jusqu'à la dernière image.
  const frame = (s) => execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-ss', String(s), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: width * height * 2 })
  let raw = frame(atS)
  for (let back = 0.02; raw.length < width * 32 && back <= 0.3 && atS - back >= 0; back += 0.02) raw = frame(atS - back)
  if (raw.length < width * 32) return null
  const cell = Math.floor(width / 40)
  let v = 0
  for (let i = 0; i < 40; i++) if (raw[16 * width + i * cell + (cell >> 1)] > 128) v += 2 ** i
  return v * 10
}

function listDir(d) { try { return fs.readdirSync(d) } catch { return [] } }

/**
 * Comment un fichier MP4 est fait, en quelques lignes : ses boîtes du premier niveau (les suites « moof + mdat » d'un fichier
 * fragmenté sont comptées), puis pour chaque piste son codec (stsd) et sa liste de montage (elst), qui dit d'où part la
 * piste. Ne lit que les en-têtes et la boîte moov, jamais les images.
 */
function mp4Boxes(file) {
  const fd = fs.openSync(file, 'r'), lines = []
  try {
    const size = fs.fstatSync(fd).size, top = []
    for (let pos = 0; pos + 8 <= size;) {
      const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, pos)
      let n = b.readUInt32BE(0), h = 8
      if (n === 1) { n = Number(b.readBigUInt64BE(8)); h = 16 } else if (n === 0) n = size - pos
      if (n < h) break
      top.push({ type: b.toString('latin1', 4, 8), size: n, h, pos }); pos += n
    }
    for (let i = 0; i < top.length; i++) {
      if (top[i].type === 'moof' && top[i + 1]?.type === 'mdat') {
        let n = 0, bytes = 0
        for (; top[i]?.type === 'moof' && top[i + 1]?.type === 'mdat'; i += 2) { n++; bytes += top[i].size + top[i + 1].size }
        i--
        lines.push(`moof + mdat × ${n} : ${bytes} octets`)
      } else lines.push(`${top[i].type} : ${top[i].size} octets`)
    }
    const moov = top.find((b) => b.type === 'moov')
    if (!moov) return lines
    const buf = Buffer.alloc(moov.size); fs.readSync(fd, buf, 0, moov.size, moov.pos)
    const kids = (start, end) => {
      const out = []
      for (let p = start; p + 8 <= end;) {
        let n = buf.readUInt32BE(p), h = 8
        if (n === 1) { n = Number(buf.readBigUInt64BE(p + 8)); h = 16 }
        if (n < h || p + n > end) break
        out.push({ type: buf.toString('latin1', p + 4, p + 8), start: p + h, end: p + n }); p += n
      }
      return out
    }
    const find = (list, ...types) => { let box = null; for (const t of types) { box = list.find((b) => b.type === t); if (!box) return null; list = kids(box.start, box.end) } return box }
    // mvhd et mdhd : version et drapeaux (4 octets), deux dates (4 ou 8 octets chacune), puis les unités par seconde
    const scaleOf = (box) => (box ? buf.readUInt32BE(box.start + (buf[box.start] === 1 ? 20 : 12)) : 0)
    const root = kids(moov.h, moov.size), movieScale = scaleOf(root.find((b) => b.type === 'mvhd'))
    if (root.some((b) => b.type === 'mvex')) lines.push('  moov : mvex (fichier fragmenté)')
    for (const trak of root.filter((b) => b.type === 'trak')) {
      const tk = kids(trak.start, trak.end), hdlr = find(tk, 'mdia', 'hdlr'), stsd = find(tk, 'mdia', 'minf', 'stbl', 'stsd'), elst = find(tk, 'edts', 'elst')
      const scale = scaleOf(find(tk, 'mdia', 'mdhd')), kind = hdlr ? buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) : '?'
      const codecs = [], edits = []
      // stsd : 4 octets, le nombre d'entrées, puis pour chacune sa taille, son format, et selon la piste la taille de l'image ou le son
      if (stsd) for (let i = 0, p = stsd.start + 8, n = buf.readUInt32BE(stsd.start + 4); i < n && p + 36 <= stsd.end; i++) {
        const sz = buf.readUInt32BE(p), fmt = buf.toString('latin1', p + 4, p + 8)
        codecs.push(kind === 'vide' ? `${fmt} ${buf.readUInt16BE(p + 32)} × ${buf.readUInt16BE(p + 34)}` : kind === 'soun' ? `${fmt} ${buf.readUInt16BE(p + 24)} ${buf.readUInt16BE(p + 24) > 1 ? 'canaux' : 'canal'}, ${buf.readUInt32BE(p + 32) >>> 16} Hz` : fmt)
        if (sz < 8) break
        p += sz
      }
      // elst : 4 octets, le nombre de morceaux, puis pour chacun sa durée (unités du film) et son début dans la piste (-1 : un vide)
      if (elst) for (let i = 0, p = elst.start + 8, v1 = buf[elst.start] === 1, n = buf.readUInt32BE(elst.start + 4); i < n && p + (v1 ? 20 : 12) <= elst.end; i++, p += v1 ? 20 : 12) {
        const dur = v1 ? Number(buf.readBigUInt64BE(p)) : buf.readUInt32BE(p), at = v1 ? Number(buf.readBigInt64BE(p + 8)) : buf.readInt32BE(p + 4)
        edits.push(at < 0 ? `vide de ${(dur / movieScale).toFixed(3)} s` : `${(dur / movieScale).toFixed(3)} s à partir de ${(at / scale).toFixed(3)} s`)
      }
      lines.push(`  trak ${kind} : stsd ${codecs.join(', ') || 'absent'} ; elst ${edits.join(', ') || 'absent'} ; ${scale} unités/s`)
    }
    return lines
  } finally { fs.closeSync(fd) }
}

module.exports = { start, sleep, until, launcher, test, simPost, simRunning, payload, probe, ffprobe, decodeCheck, clockAt, freshDirs, listDir, mp4Boxes, ROOT, WORK, fs, path, execFileSync }
