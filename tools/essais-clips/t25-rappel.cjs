// Rappel du raccourci : un jeu sans clip automatique (BF6) le montre une fois, CS2 avec ses moments ne le montre pas.
const H = require('./h.cjs')
const { start, sleep, until, launcher, test, simRunning, freshDirs } = H
const { execFileSync } = require('child_process')
const OUT = process.env.PX_SHOTS || '/tmp/claude-0/shots'
require('fs').mkdirSync(OUT, { recursive: true })
let bad = 0
const check = (ok, what) => { console.log(ok ? 'OK ' : 'RATÉ', what); if (!ok) bad++ }
const grab = (name) => execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-y', '-f', 'x11grab', '-video_size', process.env.PX_SCR || '1600x940', '-i', process.env.DISPLAY, '-frames:v', '1', `${OUT}/${name}.png`])
const hints = (logs) => logs.join('').split('\n').filter((l) => l.includes('Rappel du raccourci')).length

;(async () => {
  const dirs = freshDirs('t25')
  const { app, p, logs } = await start(dirs, { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '1', PX_FFMPEG: '/usr/bin/ffmpeg', PX_FFMPEG_ENCODER: 'libx264' })
  try {
    await until(() => app.evaluate(() => !!globalThis.pxCs2Sim && !!globalThis.pxClipsTest), 15000, 'prêt')
    await test(app, 'setRunning', [{ id: 'ea:bf6', name: 'Battlefield 6' }])
    await until(async () => (await launcher(p, 'clipsState')).status === 'recording', 15000, 'capture BF6')
    await until(() => hints(logs) >= 1, 20000, 'rappel BF6')
    await sleep(400); grab('bf6-rappel')
    check(hints(logs) === 1, 'BF6 : rappel montré une fois')
    await sleep(7000)
    check(hints(logs) === 1, 'BF6 : pas de second rappel pendant la partie')
    await test(app, 'setRunning', [])
    await until(async () => (await launcher(p, 'clipsState')).status !== 'recording', 15000, 'fin BF6')
    await sleep(1500)
    if (process.env.PX_ENGINE_SOURCE) {
      // Moteur vidéo seul (ni son du jeu ni micro) : le raccourci est pris et le rappel passe quand même
      await launcher(p, 'clipsSaveSettings', { capture: 'engine', gameAudio: false, mic: false })
      await test(app, 'setRunning', [{ id: 'ea:bf6', name: 'Battlefield 6' }])
      await until(() => hints(logs) >= 2, 40000, 'rappel BF6, moteur sans son')
      const info = await test(app, 'info')
      check(info.hotkeyRegistered, 'moteur sans son : raccourci pris et rappel montré')
      await test(app, 'setRunning', [])
      await until(async () => (await launcher(p, 'clipsState')).status !== 'recording', 15000, 'fin BF6 moteur')
      await launcher(p, 'clipsSaveSettings', { gameAudio: true })
      await sleep(1500)
    }
    const before = hints(logs)
    await simRunning(app, true)
    await until(async () => (await launcher(p, 'clipsState')).status === 'recording', 15000, 'capture CS2')
    await sleep(8000)
    check(hints(logs) === before, 'CS2 avec ses moments : aucun rappel')
    grab('cs2-sans-rappel')
  } catch (e) { console.log('ERREUR', e.message); bad++ }
  finally { await app.close().catch(() => {}) }
  console.log(bad ? `${bad} raté(s)` : 'tout bon')
  process.exit(bad ? 1 : 0)
})()
