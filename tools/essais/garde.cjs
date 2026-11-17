// Essai de la garde : page qui plante, erreur imprévue, base abîmée / vide / illisible, démarrage raté.
//   xvfb-run -a env NODE_PATH=/opt/node22/lib/node_modules node tools/essais/garde.cjs
// PX_GARDE_MUET=1 : aucune boîte native, la réponse est le bouton 0 ; les boîtes sont lues dans globalThis.__pxGarde.boxes.
const { _electron } = require('playwright')
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert'), crypto = require('crypto'), { spawn } = require('child_process')
const ROOT = path.resolve(__dirname, '../..')
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron')
/** `node garde.cjs 6,11` ne lance que ces cas. */
const only = process.argv[2] ? process.argv[2].split(',') : null
const want = (n) => !only || only.includes(n)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'px-garde-'))
const launch = async (dir) => {
  const app = await _electron.launch({ executablePath: ELECTRON, args: ['--no-sandbox', '--user-data-dir=' + dir, '.'], cwd: ROOT, env: { ...process.env, PX_SOFTGL: '1', PX_GARDE_MUET: '1' }, timeout: 60000 })
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
  return { app, page }
}
const boxes = (app) => app.evaluate(() => (globalThis.__pxGarde ? globalThis.__pxGarde.boxes.slice() : null))
const logLines = (dir) => { try { return fs.readFileSync(path.join(dir, 'erreurs.log'), 'utf8').split('\n').filter((l) => /^\d{4}-/.test(l)) } catch { return [] } }
const withTag = (dir, tag) => logLines(dir).filter((l) => l.includes(`[${tag}]`))
const aside = (dir, prefix) => fs.readdirSync(dir).filter((f) => f.startsWith(prefix + '.illisible-'))
const close = (app) => app.close().catch(() => {})
const demo = (page) => page.evaluate(async () => (await window.launcher.getSettings()).demoMode)
/** Une base qu'a créée la vraie appli ; avec `withDemo`, un réglage (mode démo) y est posé. Rend les octets du fichier après fermeture. */
const makeBase = async (withDemo) => {
  const dir = fresh()
  const { app, page } = await launch(dir)
  await page.waitForTimeout(2500)
  if (withDemo) { await page.evaluate(async () => { await window.launcher.saveSettings({ demoMode: true }) }); await page.waitForTimeout(2500) }
  await close(app)
  return fs.readFileSync(path.join(dir, 'launcher.db'))
}
const damage = (bytes) => { const junk = crypto.randomBytes(4096); return { junk, file: Buffer.concat([bytes.subarray(0, 4096), junk, bytes.subarray(8192)]) } }
const sqljs = require(path.join(ROOT, 'node_modules/sql.js'))
let SQLm = null
/** Ouvre des octets de base avec le sql.js du projet : `quick_check` bon ? combien de lignes dans kv ? */
const inspect = async (buf) => {
  SQLm ??= await sqljs({ locateFile: () => path.join(ROOT, 'node_modules/sql.js/dist/sql-wasm.wasm') })
  const d = new SQLm.Database(new Uint8Array(buf)) // une copie : sql.js écrit dans le tableau qu'on lui donne
  const out = { ok: false, kv: 0, kvRows: 0, sessions: 0 }
  // Chaque mesure à part : une page abîmée fait lever l'une sans empêcher les autres
  try { const q = d.exec('PRAGMA quick_check')[0].values; out.ok = q.length === 1 && q[0][0] === 'ok' } catch {}
  try { out.kv = d.exec('SELECT count(*) FROM kv')[0].values[0][0] } catch {}
  const readable = (table, cols) => { let n = 0; let st = null; try { st = d.prepare(`SELECT rowid, ${cols} FROM ${table} ORDER BY rowid ASC`); while (st.step()) n++ } catch {} finally { try { st && st.free() } catch {} } return n }
  out.kvRows = readable('kv', 'key, value'); out.sessions = readable('sessions', 'game_id, started, ended')
  try { d.close() } catch {}
  return out
}
/** Une bonne base avec 3 000 lignes de plus dans `sessions` (sql.js du projet). */
const withSessions = async (buf, n = 3000) => {
  SQLm ??= await sqljs({ locateFile: () => path.join(ROOT, 'node_modules/sql.js/dist/sql-wasm.wasm') })
  const d = new SQLm.Database(new Uint8Array(buf)); d.run('BEGIN')
  for (let i = 0; i < n; i++) d.run('INSERT INTO sessions (game_id, started, ended) VALUES (?,?,?)', ['steam:' + (i % 50), 1700000000000 + i, 1700000000900 + i])
  d.run('COMMIT'); const out = Buffer.from(d.export()); d.close(); return out
}
/** Des octets « empoisonnés » : une page abîmée qui fait rater quick_check mais laisse kv lisible en entier et des lignes de `sessions`. */
let poisonedCache = null
const poisoned = async (base) => {
  if (poisonedCache) return poisonedCache
  const g = await withSessions(base); const ref = await inspect(g); assert.ok(ref.ok && ref.sessions === 3000, 'base de départ')
  for (let p = 1; p < g.length / 4096; p++) {
    const b = Buffer.concat([g.subarray(0, p * 4096), crypto.randomBytes(4096), g.subarray((p + 1) * 4096)])
    const c = await inspect(b); if (!c.ok && c.kvRows === ref.kvRows && c.sessions > 0) return (poisonedCache = b)
  }
  assert.fail('aucune page ne laisse kv lisible en entier et des sessions, avec un quick_check raté')
}
/** Lance la vraie appli sans fenêtre de test et rend son code de sortie (ou « toujours ouvert » après 20 s). */
const runToExit = (dir) => new Promise((res) => { const c = spawn(ELECTRON, ['--no-sandbox', '--user-data-dir=' + dir, '.'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PX_SOFTGL: '1', PX_GARDE_MUET: '1' } }); const t = setTimeout(() => { c.kill('SIGKILL'); res('toujours ouvert') }, 20000); c.on('exit', (x) => { clearTimeout(t); res(x) }) })
/** Un dossier de données avec les fichiers donnés ({ 'launcher.db': Buffer, … }). */
const seed = (files) => { const dir = fresh(); for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), b); return dir }
const waitFor = async (fn, ms) => { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return Date.now() - t } catch {} if (Date.now() - t > ms) throw new Error('délai dépassé'); await sleep(200) } }

;(async () => {
  // 1. Base saine : rien de côté, aucune boîte
  if (want('1')) {
    const dir = fresh(); const { app, page } = await launch(dir); await page.waitForTimeout(4000)
    assert.deepStrictEqual(await boxes(app), []); assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => /illisible/.test(f)), []); assert.deepStrictEqual(withTag(dir, 'base'), [])
    await page.evaluate(async () => { await window.launcher.saveSettings({ demoMode: true }) }); await page.waitForTimeout(2500)
    await close(app); console.log('ok 1 : base saine, rien de côté, aucune boîte')
    // 1b. Le même dossier, avec un vieux launcher.db.tmp (copie du principal) : le principal sain gagne, rien ne bouge
    fs.copyFileSync(path.join(dir, 'launcher.db'), path.join(dir, 'launcher.db.tmp'))
    const old = new Date(Date.now() - 3600e3); fs.utimesSync(path.join(dir, 'launcher.db.tmp'), old, old)
    const r = await launch(dir); await r.page.waitForTimeout(4000)
    assert.strictEqual(await demo(r.page), true); assert.deepStrictEqual(await boxes(r.app), []); assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => /illisible/.test(f)), []); assert.deepStrictEqual(withTag(dir, 'base'), [])
    const bakCheck = await inspect(fs.readFileSync(path.join(dir, 'launcher.db.bak'))); assert.ok(bakCheck.ok, 'copie de secours saine : ' + JSON.stringify(bakCheck))
    await close(r.app); console.log('ok 1b : vieux .tmp et principal sain : aucune boîte, rien de côté, aucune ligne [base], réglage gardé, copie de secours saine')
  }
  // 2 et 3. La page plante : rechargée toute seule ; la deuxième fois dans la minute : boîte « page »
  if (want('2')) {
    const dir = fresh(); const { app, page } = await launch(dir); await page.waitForTimeout(2500)
    const crash = () => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer() })
    await crash(); const t0 = Date.now()
    await waitFor(() => withTag(dir, 'page').length >= 1, 8000)
    // Playwright garde la page pour « plantée » : on interroge la page depuis le processus principal
    await waitFor(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.launcher.getSettings().then((s) => typeof s.demoMode === "boolean")')), 8000)
    const ms = Date.now() - t0; assert.ok(ms < 8000, 'trop long : ' + ms)
    assert.strictEqual(withTag(dir, 'page').length, 1); assert.ok(!(await boxes(app)).includes('page'))
    console.log('ok 2 : page plantée, rechargée en', ms, 'ms, la page répond, ligne [page] :', withTag(dir, 'page')[0].slice(25, 140))
    // Fenêtre en arrière-plan : le deuxième plantage ne pose pas la question ; elle sort dès que la fenêtre revient au premier plan
    await sleep(1500)
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].blur() })
    await crash(); await sleep(2500)
    assert.strictEqual(withTag(dir, 'page').length, 2); assert.ok(!(await boxes(app)).includes('page'), 'boîte sortie en arrière-plan')
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].focus() })
    const back = await waitFor(async () => (await boxes(app)).includes('page'), 3000)
    console.log('ok 3 : deuxième plantage dans la minute : 2 lignes [page], aucune boîte en arrière-plan, boîte « page » notée', back, 'ms après le retour au premier plan :', JSON.stringify(await boxes(app)))
    await close(app)
  }
  // 4. Erreur imprévue dans le processus principal, deux fois
  if (want('4')) {
    const dir = fresh(); const { app, page } = await launch(dir); await page.waitForTimeout(2500)
    const n = await app.evaluate(() => process.listenerCount('uncaughtException')); assert.ok(n >= 2, 'écouteurs : ' + n)
    // La boîte ne sort que si la fenêtre est au premier plan
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
    await app.evaluate(() => { setTimeout(() => { throw new Error('essai garde 1') }, 50); setTimeout(() => { throw new Error('essai garde 2') }, 300) })
    await sleep(2500)
    const alive = await Promise.race([app.evaluate(() => 'répond'), sleep(5000).then(() => 'ne répond plus')]); assert.strictEqual(alive, 'répond')
    assert.strictEqual(withTag(dir, 'erreur imprévue').length, 2)
    assert.strictEqual((await boxes(app)).filter((b) => b === 'erreur').length, 1)
    console.log('ok 4 : 2 erreurs imprévues, 2 lignes, boîte « erreur » une fois, l’appli répond, écouteurs :', n)
    await close(app)
  }
  const good = await makeBase(true), older = await makeBase(false)
  // 5. Une page abîmée + bonne copie de secours
  if (want('5')) {
    const d = damage(good); const dir = seed({ 'launcher.db': d.file, 'launcher.db.bak': good })
    const { app, page } = await launch(dir); await page.waitForTimeout(4000)
    assert.strictEqual(await demo(page), true)
    const [side] = aside(dir, 'launcher.db'); assert.ok(side, 'rien de côté'); assert.strictEqual(sha(fs.readFileSync(path.join(dir, side))), sha(d.file))
    for (const f of ['launcher.db', 'launcher.db.bak']) assert.ok(!fs.readFileSync(path.join(dir, f)).includes(d.junk), f + ' contient les octets abîmés')
    assert.deepStrictEqual(await boxes(app), ['base-secours']); assert.strictEqual(withTag(dir, 'base').length, 1)
    assert.ok(withTag(dir, 'base')[0].includes('Gardé de côté : launcher.db.illisible-'), withTag(dir, 'base')[0])
    console.log('ok 5 : page abîmée, réglage gardé, fichier de côté identique, ni principal ni secours abîmés, boîte base-secours')
    await close(app)
  }
  // 6. Fichier de 0 octet + bonne copie de secours
  if (want('6')) {
    const dir = seed({ 'launcher.db': Buffer.alloc(0), 'launcher.db.bak': good })
    // Copie de secours vieille de 11 minutes : le premier persist() voudrait la refaire (c'est l'essai de mainTrusted)
    const old = new Date(Date.now() - 11 * 60e3); fs.utimesSync(path.join(dir, 'launcher.db.bak'), old, old)
    const { app, page } = await launch(dir); await page.waitForTimeout(4000)
    assert.strictEqual(await demo(page), true); assert.deepStrictEqual(await boxes(app), ['base-secours']); assert.ok(fs.statSync(path.join(dir, 'launcher.db')).size > 0)
    const bak = fs.readFileSync(path.join(dir, 'launcher.db.bak')); assert.ok(bak.length > 0, 'copie de secours vide')
    const c = await inspect(bak); assert.ok(c.ok && c.kv > 0, 'copie de secours abîmée ou sans réglages : ' + JSON.stringify(c))
    console.log('ok 6 : 0 octet, réglage gardé, boîte base-secours, copie de secours vieillie de 11 min toujours saine (kv :', c.kv, 'lignes)')
    await close(app)
  }
  // 10. Une base saine mais sans table kv (ce n'est pas une base de Player X) + bonne copie de secours : mise de côté, jamais supprimée
  if (want('10')) {
    const SQL = await require(path.join(ROOT, 'node_modules/sql.js'))({ locateFile: () => path.join(ROOT, 'node_modules/sql.js/dist/sql-wasm.wasm') })
    const x = new SQL.Database(); x.run("CREATE TABLE autre (a TEXT); INSERT INTO autre VALUES ('x')"); const other = Buffer.from(x.export()); x.close()
    const dir = seed({ 'launcher.db': other, 'launcher.db.bak': good })
    const { app, page } = await launch(dir); await page.waitForTimeout(4000)
    assert.strictEqual(await demo(page), true); assert.deepStrictEqual(await boxes(app), ['base-secours'])
    const [side] = aside(dir, 'launcher.db'); assert.ok(side && sha(fs.readFileSync(path.join(dir, side))) === sha(other), 'fichier de côté')
    assert.strictEqual(withTag(dir, 'base').length, 1); assert.ok(withTag(dir, 'base')[0].includes('Gardé de côté'))
    console.log('ok 10 : base sans table kv mise de côté (même sha256), réglage gardé, boîte base-secours, ligne [base] « Gardé de côté »')
    await close(app)
  }
  // 7. Principal et secours illisibles
  if (want('7')) {
    const a = Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(200000)]), b = Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(150000)])
    const dir = seed({ 'launcher.db': a, 'launcher.db.bak': b })
    const { app, page } = await launch(dir); await page.waitForTimeout(4000)
    assert.strictEqual(await demo(page), false); assert.deepStrictEqual(await boxes(app), ['base-zero'])
    const sa = aside(dir, 'launcher.db'), sb = aside(dir, 'launcher.db.bak')
    assert.ok(sa.some((f) => !f.includes('.bak.') && sha(fs.readFileSync(path.join(dir, f))) === sha(a)), 'principal de côté'); assert.ok(sb.length === 1 && sha(fs.readFileSync(path.join(dir, sb[0]))) === sha(b), 'secours de côté')
    assert.strictEqual(withTag(dir, 'base').length, 1)
    console.log('ok 7 : tout illisible, base neuve, les deux de côté avec leur contenu, boîte base-zero')
    await close(app)
  }
  // 8. Démarrage raté : launcher.db.tmp est un dossier
  if (want('8')) {
    const dir = fresh(); fs.mkdirSync(path.join(dir, 'launcher.db.tmp'))
    const t0 = Date.now()
    const code = await runToExit(dir)
    assert.strictEqual(code, 1); assert.ok(Date.now() - t0 < 20000); assert.strictEqual(withTag(dir, 'démarrage').length, 1)
    // Un fichier qu'on n'a pas pu lire est dit dans le journal, même quand aucune autre ligne [base] n'est due
    const lb = withTag(dir, 'base'); assert.strictEqual(lb.length, 1); assert.ok(lb[0].includes('Lecture impossible : launcher.db.tmp (EISDIR)'), lb[0])
    console.log('ok 8 : démarrage raté, code', code, 'en', Date.now() - t0, 'ms, ligne [démarrage], une ligne [base] « Lecture impossible : launcher.db.tmp (EISDIR) »')
  }
  // 9. Principal illisible + provisoire complet + secours plus ancienne : le provisoire gagne ; provisoire tronqué : la secours gagne
  if (want('9')) {
    const junk = Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(100000)])
    const dir = seed({ 'launcher.db': junk, 'launcher.db.tmp': good, 'launcher.db.bak': older })
    const { app, page } = await launch(dir); await page.waitForTimeout(4000)
    assert.strictEqual(await demo(page), true); assert.deepStrictEqual(await boxes(app), []); assert.strictEqual(aside(dir, 'launcher.db').length, 1); assert.strictEqual(withTag(dir, 'base').length, 1)
    console.log('ok 9 : provisoire complet repris, aucune boîte, principal de côté, ligne [base]')
    await close(app)
    const dir2 = seed({ 'launcher.db': junk, 'launcher.db.tmp': good.subarray(0, Math.floor(good.length / 2)), 'launcher.db.bak': good })
    const r = await launch(dir2); await r.page.waitForTimeout(4000)
    assert.strictEqual(await demo(r.page), true); assert.deepStrictEqual(await boxes(r.app), ['base-secours'])
    console.log('ok 9b : provisoire tronqué ignoré, copie de secours reprise, boîte base-secours')
    await close(r.app)
  }
  // 11. Impossible de mettre de côté : des DOSSIERS portent les noms que prendrait le fichier ; rien n'est écrit, le démarrage échoue
  if (want('11')) {
    const d = damage(good); const dir = seed({ 'launcher.db': d.file, 'launcher.db.bak': good })
    const p2 = (n) => String(n).padStart(2, '0')
    const t0 = Date.now()
    for (let k = -2; k < 40; k++) { const t = new Date(t0 + k * 1000); fs.mkdirSync(path.join(dir, `launcher.db.illisible-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`)) }
    const before = [sha(fs.readFileSync(path.join(dir, 'launcher.db'))), sha(fs.readFileSync(path.join(dir, 'launcher.db.bak')))]
    const code = await runToExit(dir)
    assert.strictEqual(code, 1); assert.ok(Date.now() - t0 < 20000)
    assert.strictEqual(withTag(dir, 'base').length, 1); assert.ok(withTag(dir, 'base')[0].includes('Impossible de mettre de côté : launcher.db'), withTag(dir, 'base')[0])
    assert.strictEqual(withTag(dir, 'démarrage').length, 1); assert.ok(withTag(dir, 'démarrage')[0].includes('ni lu ni mis de côté'))
    assert.deepStrictEqual([sha(fs.readFileSync(path.join(dir, 'launcher.db'))), sha(fs.readFileSync(path.join(dir, 'launcher.db.bak')))], before)
    assert.ok(!fs.existsSync(path.join(dir, 'launcher.db.tmp')))
    console.log('ok 11 : impossible de mettre de côté : code', code, 'en', Date.now() - t0, 'ms, lignes [base] et [démarrage], launcher.db et .bak intacts, rien écrit')
  }
  // 11b. Mise de côté à moitié faite : le principal est renommé, la copie de secours ne peut pas l'être : le principal reprend son nom
  if (want('11b')) {
    const bad = await poisoned(good); const dir = seed({ 'launcher.db': bad, 'launcher.db.bak': bad })
    const p2 = (n) => String(n).padStart(2, '0'); const t0 = Date.now()
    const dirs = []
    for (let k = -2; k < 40; k++) { const t = new Date(t0 + k * 1000); const d = path.join(dir, `launcher.db.bak.illisible-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`); fs.mkdirSync(d); dirs.push(d) }
    const code = await runToExit(dir)
    assert.strictEqual(code, 1); assert.ok(Date.now() - t0 < 20000)
    for (const f of ['launcher.db', 'launcher.db.bak']) assert.strictEqual(sha(fs.readFileSync(path.join(dir, f))), sha(bad), f + ' a changé ou a disparu')
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.startsWith('launcher.db.illisible-')), [], 'le principal n’a pas repris son nom')
    assert.ok(!fs.existsSync(path.join(dir, 'launcher.db.tmp')))
    const l = withTag(dir, 'base'); assert.strictEqual(l.length, 1)
    assert.ok(l[0].includes('Impossible de mettre de côté : launcher.db.bak') && l[0].includes('sans toucher à la base') && !l[0].includes('Gardé de côté') && !l[0].includes('encore lisible'), l[0])
    assert.strictEqual(withTag(dir, 'démarrage').length, 1); assert.ok(withTag(dir, 'démarrage')[0].includes('ni lu ni mis de côté'))
    // Les dossiers partent : le même dossier de données démarre normalement
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
    const { app, page } = await launch(dir); await page.waitForTimeout(4000)
    assert.strictEqual(await demo(page), true); assert.deepStrictEqual(await boxes(app), ['base-partiel'])
    const l2 = withTag(dir, 'base'); assert.strictEqual(l2.length, 2); assert.ok(l2[1].includes('encore lisible dans launcher.db'), l2[1])
    assert.ok(aside(dir, 'launcher.db').length === 1 && aside(dir, 'launcher.db.bak').length === 1, 'les deux fichiers de côté')
    console.log('ok 11b : mise de côté à moitié faite : code', code, ', principal et copie intacts, une ligne [base] « sans toucher à la base » ; puis relancé sans les dossiers : base-partiel, réglage gardé, 2e ligne « encore lisible »')
    await close(app)
  }
  // 12. Copie de secours « empoisonnée » (ce que laisse la 0.7.4 après un démarrage raté) : le principal et la copie ont les mêmes octets abîmés
  if (want('12')) {
    const bad = await poisoned(good)
    const dir = seed({ 'launcher.db': bad, 'launcher.db.bak': bad })
    const { app, page } = await launch(dir); await page.waitForTimeout(4000)
    assert.strictEqual(await demo(page), true); assert.deepStrictEqual(await boxes(app), ['base-partiel'])
    const a = aside(dir, 'launcher.db'), ab = aside(dir, 'launcher.db.bak'), mainSide = a.filter((f) => !f.startsWith('launcher.db.bak.'))
    assert.ok(mainSide.length === 1 && ab.length === 1 && sha(fs.readFileSync(path.join(dir, mainSide[0]))) === sha(bad) && sha(fs.readFileSync(path.join(dir, ab[0]))) === sha(bad), 'les deux fichiers de côté')
    assert.strictEqual(withTag(dir, 'base').length, 1); const line = withTag(dir, 'base')[0]; assert.ok(line.includes('encore lisible'), line)
    const n = Number((/sessions : (\d+)/.exec(line) || [])[1]); assert.ok(n > 0, 'sessions dans la ligne : ' + line)
    const fresh2 = await inspect(fs.readFileSync(path.join(dir, 'launcher.db'))); assert.ok(fresh2.ok, 'nouveau launcher.db sain'); assert.ok(fresh2.sessions > 0, 'aucune session sur le disque')
    console.log('ok 12 : copie empoisonnée : démarre, réglage gardé, boîte base-partiel, deux fichiers de côté (même sha256), ligne « sessions :', n, '», nouveau principal sain avec', fresh2.sessions, 'sessions')
    await close(app)
  }
  // 13. Démarrage caché (--hidden, comme avec Windows) : la ligne [base] est écrite, la boîte attend qu'on regarde Player X
  if (want('13')) {
    const d = damage(good); const dir = seed({ 'launcher.db': d.file, 'launcher.db.bak': good })
    const app = await _electron.launch({ executablePath: ELECTRON, args: ['--no-sandbox', '--user-data-dir=' + dir, '--hidden', '.'], cwd: ROOT, env: { ...process.env, PX_SOFTGL: '1', PX_GARDE_MUET: '1' }, timeout: 60000 })
    await sleep(4000)
    // Temps 1 : fenêtre cachée : la ligne [base] est écrite, aucune boîte
    assert.strictEqual(withTag(dir, 'base').length, 1); assert.deepStrictEqual(await boxes(app), [], 'boîte sortie pendant que la fenêtre est cachée')
    // Temps 2 : fenêtre visible mais pas au premier plan : toujours aucune boîte
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.showInactive(); if (w.isFocused()) w.blur() })
    const st = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { visible: w.isVisible(), focused: w.isFocused() } })
    assert.deepStrictEqual(st, { visible: true, focused: false }, 'la fenêtre doit être visible sans être au premier plan')
    await sleep(2500)
    assert.deepStrictEqual(await boxes(app), [], 'boîte sortie alors que la fenêtre n’est pas au premier plan')
    // Temps 3 : au premier plan : la boîte sort
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].focus() })
    const ms = await waitFor(async () => (await boxes(app)).includes('base-secours'), 3000)
    console.log('ok 13 : démarrage caché : ligne [base] écrite, aucune boîte pendant 4 s ; visible sans premier plan 2,5 s, aucune boîte ; après focus(), boîte base-secours notée en', ms, 'ms')
    await close(app)
  }
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
