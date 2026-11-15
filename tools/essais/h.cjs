// Essais du build réel : la vraie fenêtre Electron, sous Xvfb, en mode démo avec les simulateurs de développement.
const { _electron } = require('playwright')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const OUT = path.resolve(__dirname, 'shots')
async function start({ env = {}, name = 'd', demo = true, setupDone = true, w = 1600, h = 940 } = {}) {
  const dir = path.resolve(__dirname, 'data-' + name + (process.env.SUF || ''))
  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--user-data-dir=' + dir, '.'],
    cwd: ROOT, env: { ...process.env, PX_SOFTGL: '1', ...env }
  })
  const p = await app.firstWindow()
  const errs = []
  p.on('pageerror', (e) => errs.push('PAGE ' + (e.stack || (e.name + ': ' + e.message)).split('\n').slice(0, 4).join(' | ')))
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource|net::/.test(m.text())) errs.push('CONS ' + (m.text() + ' ' + (m.location()?.lineNumber || '')).slice(0, 500)) })
  await p.waitForLoadState('domcontentloaded')
  await p.evaluate(async ({ demo, setupDone }) => {
    if (setupDone) localStorage.setItem('pxv3-setup', '1')
    if (demo) { const s = await window.launcher.getSettings(); if (!s.demoMode) await window.launcher.saveSettings({ demoMode: true }) }
  }, { demo, setupDone })
  await p.reload(); await p.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, h) }, [w, h])
  await p.waitForTimeout(9000)
  return { app, p, errs }
}
const shot = async (p, n) => { await p.waitForTimeout(80); await p.screenshot({ path: `${OUT}/${n}.png` }) }
// La vue a fini de changer (le rendu logiciel de Xvfb est lent)
const settle = async (p, extra = 500) => { await p.waitForTimeout(120); await p.waitForFunction(() => !document.documentElement.matches(':active-view-transition'), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(extra) }
const go = async (p, v) => { await p.click(`.b-tab[data-go=${v}]`); await settle(p) }

// La fin d'un scénario dit la vérité par son code de sortie : 0 seulement s'il est allé au bout, sans erreur dans la page
// et sans contrôle raté. Avant, un scénario arrêté en route écrivait « ECHEC » et sortait quand même avec 0.
let pass = 0, fail = 0
// Un contrôle : une ligne « OK  … » ou « NON … », comme dans tools/essais-clips.
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'OK ' : 'NON'} ${name}${extra !== undefined ? ' : ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); return !!ok }
// Le scénario est allé au bout : le compte des contrôles s'il y en a, puis les erreurs vues dans la page.
const done = (errs, max = 20) => {
  if (pass + fail) console.log(`${pass} OK, ${fail} NON`)
  console.log('ERREURS', errs.length); errs.slice(0, max).forEach((e) => console.log(e))
  if (errs.length || fail) process.exitCode = 1
}
// Le scénario s'arrête en route : « ECHEC », avec ce que Playwright attendait (le sélecteur), puis les erreurs de la page.
const failed = (e, errs = [], max = 20) => {
  const lines = String((e && e.message) || e).replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter((l) => l && l !== 'Call log:')
  console.log('ECHEC', lines.slice(0, 2).join(' '))
  if (errs.length) console.log(errs.slice(0, max).join('\n'))
  process.exitCode = 1
}
module.exports = { start, shot, settle, go, check, done, failed, OUT, ROOT }
