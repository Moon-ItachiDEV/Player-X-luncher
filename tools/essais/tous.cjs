// Tous les scénarios de la vraie appli, l'un après l'autre (ils partagent le port local de CS2 : jamais deux à la fois).
// Chaque scénario reçoit un écran Xvfb neuf et un dossier de données neuf. Une ligne par scénario, un bilan à la fin, et un
// code de sortie qui dit la vérité : 0 seulement si tout ce qui a tourné a réussi.
//
//   npm run build                                   les scénarios lancent out/, pas les sources
//   node tools/essais/tous.cjs                      tout : une demi-heure
//   node tools/essais/tous.cjs a8 t1                seulement a8 et t1-basics (« a », « t » ou « nommes » : toute une famille)
//   node tools/essais/tous.cjs a11                  a9 puis a11 : a11 lance la routine qu'a9 enregistre
//   A16_BIN=<binaire> node tools/essais/tous.cjs    avec a16, qui demande l'appli empaquetée (sauté sinon, et c'est dit)
//
// Les scénarios se trouvent tout seuls : tools/essais/*.cjs (a<n> et scénarios nommés) et tools/essais-clips/t<n>-<nom>.cjs (ou .mts). Un scénario
// ajouté tourne sans rien inscrire ici. Les sorties complètes sont gardées dans tools/essais/sorties/<passage>/.
// Sous Linux seulement (Xvfb, ffmpeg et ffprobe installés), comme les scénarios eux-mêmes.
const { spawn, spawnSync } = require('child_process')
const fs = require('fs'), path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const SCREEN = process.env.PX_ESSAIS_ECRAN || '1280x1024x24'
const LIMIT_MS = 15 * 60000

// Ce que certains scénarios demandent en plus : un autre scénario juste avant, un argument, ou une raison de les sauter.
const EXTRA = {
  a11: () => ({ after: 'a9' }), // a11 lance la routine qu'a9 enregistre, dans le même dossier de données
  a16: () => (process.env.A16_BIN ? { args: [process.env.A16_BIN] } : { skip: 'il demande l’appli empaquetée (A16_BIN=<binaire>)' }),
  a17: () => ({ args: [path.join(ROOT, 'tools/essais-clips/xkey.py')] })
}

// Scripts utilitaires ou aperçus visuels manuels de tools/essais/ (pas des scénarios autonomes).
const NON_SCENARIOS = new Set(['tous.cjs', 'h.cjs', 'stats-etats-pre.cjs', 'cdp.cjs', 'sp.cjs', 'sp2.cjs', 'sp3.cjs', 'sp4.cjs'])

function scenarios() {
  const pick = (dir, re) => fs.readdirSync(path.join(ROOT, dir)).map((f) => ({ f, m: re.exec(f) })).filter((x) => x.m)
    .sort((a, b) => +a.m[1] - +b.m[1]).map(({ f, m }) => ({ name: f.replace(/\.(cjs|mts)$/, ''), file: path.join(dir, f), ts: f.endsWith('.mts'), n: +m[1] }))
  const a = pick('tools/essais', /^a(\d+)\.cjs$/)
  const named = fs.readdirSync(path.join(ROOT, 'tools/essais'))
    .filter((f) => f.endsWith('.cjs') && !/^a\d+\.cjs$/.test(f) && !NON_SCENARIOS.has(f))
    .sort()
    .map((f) => ({ name: f.replace(/\.cjs$/, ''), file: path.join('tools/essais', f), ts: false, named: true }))
  return [...a, ...named, ...pick('tools/essais-clips', /^t(\d+)-.+\.(cjs|mts)$/)]
}

// Un écran neuf : Xvfb choisit lui-même un numéro libre et l'écrit quand il est prêt (-displayfd).
function display() {
  return new Promise((resolve, reject) => {
    const x = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', SCREEN, '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
    let got = ''
    const late = setTimeout(() => { x.kill(); reject(new Error('Xvfb ne répond pas')) }, 15000)
    x.stdio[3].on('data', (d) => { got += d; if (got.includes('\n')) { clearTimeout(late); resolve({ name: ':' + got.trim(), stop: () => x.kill() }) } })
    x.on('error', (e) => { clearTimeout(late); reject(new Error(`Xvfb ne se lance pas (${e.code || e.message}) : installe-le, ou donne un écran avec DISPLAY`)) })
    x.on('exit', (code) => { clearTimeout(late); reject(new Error(`Xvfb s’est arrêté (code ${code})`)) })
  })
}

function run(s, extra, env, out) {
  return new Promise((resolve) => {
    const log = fs.createWriteStream(out)
    const child = spawn(process.execPath, [...(s.ts ? ['--experimental-strip-types', '--no-warnings'] : []), s.file, ...(extra.args || [])], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
    let late = false
    const timer = setTimeout(() => { late = true; child.kill('SIGKILL') }, LIMIT_MS)
    child.on('close', (code, signal) => { clearTimeout(timer); log.end(() => resolve({ code, signal, late })) })
  })
}

// Pourquoi un scénario a raté, en une ligne tirée de sa sortie.
function why(text, r) {
  if (r.late) return `arrêté au bout de ${LIMIT_MS / 60000} minutes`
  const lines = text.split('\n')
  const stop = lines.find((l) => /^(ECHEC|ÉCHEC)/.test(l))
  if (stop) return stop.slice(0, 150)
  const no = lines.filter((l) => /^(NON|DEFAUT) /.test(l))
  if (no.length) return `${no.length} contrôle${no.length > 1 ? 's' : ''} raté${no.length > 1 ? 's' : ''} : ${no[0].replace(/^(NON|DEFAUT) /, '').slice(0, 110)}`
  const errs = lines.find((l) => /^ERREURS [1-9]/.test(l))
  if (errs) return `${errs.slice(8)} erreur(s) dans la page`
  return r.signal ? `arrêté par ${r.signal}` : `code de sortie ${r.code}`
}
const tally = (text) => (text.split('\n').reverse().find((l) => /^\d+ (OK|réussis?) ?[,/] ?\d+ (NON|ratés?)$/.test(l.trim())) || '').trim()

;(async () => {
  if (process.platform !== 'linux') { console.error('Ces scénarios ne tournent que sous Linux (Xvfb).'); process.exit(2) }
  if (!fs.existsSync(path.join(ROOT, 'out/main/index.js'))) { console.error('Pas de construction : lance d’abord « npm run build ».'); process.exit(2) }
  if (!fs.existsSync(path.join(ROOT, 'node_modules/electron/dist/electron'))) { console.error('Electron manque : lance « node node_modules/electron/install.js ».'); process.exit(2) }
  try { require.resolve('playwright') } catch { console.error('Playwright manque : il s’installe à part, pas dans package.json (voir NOTES.md).'); process.exit(2) }
  const only = process.argv.slice(2)
  // « a8 » : ce scénario ; « t1 » : t1-basics, pas t11 ; « a », « t » ou « nommes » : toute une famille
  const wanted = (s, w) => {
    if (w === 'a') return /^a\d+$/.test(s.name)
    if (w === 't') return /^t\d+-/.test(s.name)
    if (w === 'nommes') return Boolean(s.named)
    return s.name === w || s.name.startsWith(w + '-')
  }
  const all = scenarios(), list = only.length ? all.filter((s) => only.some((w) => wanted(s, w))) : all
  if (!list.length) { console.error(`Aucun scénario ne s’appelle « ${only.join(' » ni « ')} » (${all.length} scénarios : ${all.map((s) => s.name).join(', ')}).`); process.exit(2) }
  // Un scénario qui continue le travail d'un autre l'emmène avec lui : « a11 » seul fait aussi passer a9, juste avant
  for (const s of [...list]) {
    const pre = all.find((x) => x.name === (EXTRA[s.name] ? EXTRA[s.name]().after : undefined))
    if (pre && !list.includes(pre)) { list.splice(list.indexOf(s), 0, pre); console.log(`${pre.name} passe aussi : ${s.name} continue son travail`) }
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const suf = process.env.SUF || '-' + stamp
  const outDir = path.join(__dirname, 'sorties', stamp)
  for (const d of [outDir, path.join(__dirname, 'shots'), path.join(ROOT, 'tools/essais-clips/shots')]) fs.mkdirSync(d, { recursive: true })
  // ed, t12 et t14 demandent un vrai ffmpeg : celui de la machine, s'ils n'en ont pas reçu un autre
  const ffmpeg = ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((f) => fs.existsSync(f))
  const base = {
    ...process.env,
    SUF: suf,
    ...(ffmpeg ? { PX_FFMPEG: process.env.PX_FFMPEG || ffmpeg, PX_T12_FFMPEG: process.env.PX_T12_FFMPEG || ffmpeg, PX_T14_FFMPEG: process.env.PX_T14_FFMPEG || ffmpeg } : {})
  }
  console.log(`${list.length} scénario${list.length > 1 ? 's' : ''}${only.length ? ` sur ${all.length}` : ''}, sorties dans ${path.relative(ROOT, outDir)}`)

  const done = [], t00 = Date.now()
  for (const s of list) {
    const extra = EXTRA[s.name] ? EXTRA[s.name]() : {}
    if (extra.skip) { done.push({ s, state: 'SAUTÉ', note: extra.skip }); console.log(`${s.name.padEnd(18)} SAUTÉ  ${extra.skip}`); continue }
    const t0 = Date.now(), out = path.join(outDir, s.name + '.txt')
    let r, screen = null
    try {
      // Un écran déjà donné (xvfb-run, un vrai bureau) est gardé ; sinon chaque scénario a le sien
      if (!process.env.DISPLAY) screen = await display()
      r = await run(s, extra, { ...base, ...(screen ? { DISPLAY: screen.name } : {}) }, out)
    } catch (e) { r = { code: 1, pre: e.message } } finally {
      // Une appli restée ouverte ne doit pas gêner le scénario suivant (même port, mêmes raccourcis)
      spawnSync('pkill', ['-KILL', '-f', `user-data-dir=${ROOT}/tools/essais`])
      if (screen) screen.stop()
    }
    const text = r.pre ? '' : fs.readFileSync(out, 'utf8'), ok = r.code === 0 && !r.pre
    const secs = Math.round((Date.now() - t0) / 1000), note = ok ? tally(text) : r.pre || why(text, r)
    done.push({ s, state: ok ? 'OK' : 'RATÉ', note })
    console.log(`${s.name.padEnd(18)} ${ok ? 'OK   ' : 'RATÉ '} ${String(secs).padStart(4)} s  ${note}`)
  }

  const count = (st) => done.filter((d) => d.state === st).length
  const bad = done.filter((d) => d.state === 'RATÉ'), skipped = done.filter((d) => d.state === 'SAUTÉ')
  const nb = (n, one, many) => `${n} ${n > 1 ? many : one}`
  console.log(`\n${nb(done.length, 'scénario', 'scénarios')} en ${Math.round((Date.now() - t00) / 60000)} min : ${nb(count('OK'), 'réussi', 'réussis')}, ${nb(bad.length, 'raté', 'ratés')}, ${nb(skipped.length, 'sauté', 'sautés')}`)
  if (bad.length) console.log('Ratés : ' + bad.map((d) => d.s.name).join(', '))
  if (skipped.length) console.log('Sautés, donc pas vérifiés : ' + skipped.map((d) => d.s.name).join(', '))
  process.exit(bad.length ? 1 : 0)
})()
