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
  const raw = execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-ss', String(atS), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: width * height * 2 })
  if (raw.length < width * 32) return null
  const cell = Math.floor(width / 40)
  let v = 0
  for (let i = 0; i < 40; i++) if (raw[16 * width + i * cell + (cell >> 1)] > 128) v += 2 ** i
  return v * 10
}

function listDir(d) { try { return fs.readdirSync(d) } catch { return [] } }

module.exports = { start, sleep, until, launcher, test, simPost, simRunning, payload, probe, ffprobe, decodeCheck, clockAt, freshDirs, listDir, ROOT, WORK, fs, path, execFileSync }
