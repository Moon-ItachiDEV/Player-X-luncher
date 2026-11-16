// Essai du démarrage des mises à jour : fichier des tentatives (réussi, nouvel essai, abandon) et marqueur d'installation.
//   xvfb-run -a node tools/essais/maj-demarrage.cjs
const { _electron } = require('playwright')
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert')
const ROOT = path.resolve(__dirname, '../..')
const run = async (setup) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-maj-'))
  const md = path.join(dir, 'mise-a-jour'); fs.mkdirSync(md)
  setup(md)
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--user-data-dir=' + dir, '.'], cwd: ROOT, env: { ...process.env, PX_SOFTGL: '1' } })
  return { app, dir, md }
}
const J = (md, f) => { try { return JSON.parse(fs.readFileSync(path.join(md, f), 'utf8')) } catch { return null } }
;(async () => {
  // Une installation qui n'a pas changé la version, une première fois : on garde le compte
  let r = await run((md) => fs.writeFileSync(path.join(md, 'tentative.json'), JSON.stringify({ version: '9.9.9', attempts: 0 })))
  let p = await r.app.firstWindow(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(3000)
  assert.deepStrictEqual(J(r.md, 'tentative.json'), { version: '9.9.9', attempts: 1, launched: false }); console.log('ok 1 : un échec noté, on garde le fichier')
  assert.strictEqual((await p.evaluate(() => window.launcher.majState())).status, 'idle'); await r.app.close()
  // Deuxième échec : abandon, fichier supprimé, erreur avec la page des versions
  r = await run((md) => { fs.writeFileSync(path.join(md, 'tentative.json'), JSON.stringify({ version: '9.9.9', attempts: 1 })); fs.writeFileSync(path.join(md, 'Setup-9.9.9.exe'), 'x') })
  p = await r.app.firstWindow(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(3000)
  const s = await p.evaluate(() => window.launcher.majState())
  assert.strictEqual(s.status, 'error'); assert.strictEqual(s.release, true); assert.ok(!fs.existsSync(path.join(r.md, 'tentative.json'))); assert.ok(!fs.existsSync(path.join(r.md, 'Setup-9.9.9.exe')))
  assert.deepStrictEqual(J(r.md, 'abandon.json'), { version: '9.9.9' })
  console.log('ok 2 : abandon après deux échecs :', s.reason); await r.app.close()
  // La version a changé : réussi, tout est nettoyé
  r = await run((md) => { fs.writeFileSync(path.join(md, 'tentative.json'), JSON.stringify({ version: '0.0.2', attempts: 0 })); fs.writeFileSync(path.join(md, 'a.exe.part'), 'x') })
  p = await r.app.firstWindow(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(3000)
  assert.ok(!fs.existsSync(path.join(r.md, 'tentative.json')) && !fs.existsSync(path.join(r.md, 'a.exe.part'))); console.log('ok 3 : installation réussie, nettoyage'); await r.app.close()
  // Un démarrage de plus sans Setup relancé : rien n'est compté (audit : un seul vrai échec ne doit pas devenir « deux fois »)
  r = await run((md) => fs.writeFileSync(path.join(md, 'tentative.json'), JSON.stringify({ version: '9.9.9', attempts: 1, launched: false })))
  p = await r.app.firstWindow(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(3000)
  const s3 = await p.evaluate(() => window.launcher.majState())
  assert.notStrictEqual(s3.status, 'error'); assert.deepStrictEqual(J(r.md, 'tentative.json'), { version: '9.9.9', attempts: 1, launched: false })
  console.log('ok 3b : démarrage sans Setup lancé, pas d’échec de plus'); await r.app.close()
  // Marqueur périmé : retiré à un démarrage normal
  r = await run((md) => fs.writeFileSync(path.join(md, 'installation-en-cours'), JSON.stringify({ version: '9.9.9', at: Date.now() - 600000 })))
  p = await r.app.firstWindow(); await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(3000)
  assert.ok(!fs.existsSync(path.join(r.md, 'installation-en-cours'))); console.log('ok 4 : marqueur périmé retiré'); await r.app.close()
  // Marqueur frais, version plus récente à venir : cette ouverture se tait (pas de fenêtre) et ferme tout de suite
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-maj-')); fs.mkdirSync(path.join(dir, 'mise-a-jour'))
  fs.writeFileSync(path.join(dir, 'mise-a-jour', 'installation-en-cours'), JSON.stringify({ version: '9.9.9', at: Date.now() }))
  const { spawn } = require('child_process')
  const code = await new Promise((res) => { const c = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'), ['--no-sandbox', '--user-data-dir=' + dir, '.'], { cwd: ROOT, stdio: 'ignore' }); const t = setTimeout(() => { c.kill(); res('toujours ouvert') }, 8000); c.on('exit', (x) => { clearTimeout(t); res(x) }) })
  assert.strictEqual(code, 0); assert.ok(fs.existsSync(path.join(dir, 'mise-a-jour', 'installation-en-cours'))); console.log('ok 5 : marqueur frais, ouverture silencieuse, code', code)
  // Marqueur frais mais cette version est déjà la nouvelle (relancée par le Setup) : démarrage normal
  fs.writeFileSync(path.join(dir, 'mise-a-jour', 'installation-en-cours'), JSON.stringify({ version: '0.0.1', at: Date.now() }))
  r = { app: await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--user-data-dir=' + dir, '.'], cwd: ROOT, env: { ...process.env, PX_SOFTGL: '1' } }) }
  p = await r.app.firstWindow(); await p.waitForTimeout(3000); assert.ok(!fs.existsSync(path.join(dir, 'mise-a-jour', 'installation-en-cours'))); console.log('ok 6 : la nouvelle version démarre normalement'); await r.app.close()
})().catch((e) => { console.error(e); process.exit(1) })
