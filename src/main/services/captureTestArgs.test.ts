// Tests de l'essai « capture comme OBS » (npm run test:edit) : commandes du moteur et lecture de l'avancement.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { gameExeRegex, readProgress, trialArgs, trialsFor, TRIAL_ATTEMPTS, TRIAL_S } from './captureTestArgs.ts'

const HIGH = { maxWidth: 0, maxHeight: 0, fps: 60, videoBps: 40_000_000 }
const BAL = { maxWidth: 1920, maxHeight: 1080, fps: 60, videoBps: 20_000_000 }
const graph = (a: string[]) => a[a.indexOf('-filter_complex') + 1]

test('le programme du jeu : CS2 et Battlefield 6, sinon rien', () => {
  assert.equal(gameExeRegex({ id: 'cs2', name: 'Counter-Strike 2' }, 'cs2'), '(?i)^cs2[.]exe$')
  assert.equal(gameExeRegex({ id: 'x', name: 'Battlefield 6' }, 'cs2'), '(?i)^bf6.*[.]exe$')
  assert.equal(gameExeRegex({ id: 'x', name: 'Minecraft' }, 'cs2'), null)
  assert.equal(gameExeRegex(null, 'cs2'), null)
})

test('les essais : la fenêtre du jeu seulement si on la connaît, puis l’écran par les deux méthodes', () => {
  assert.deepEqual(trialsFor('(?i)^cs2[.]exe$').map((t) => t.id), ['fenetre', 'ecran-wgc', 'ecran-dda'])
  assert.deepEqual(trialsFor(null).map((t) => t.id), ['ecran-wgc', 'ecran-dda'])
})

test('fenêtre du jeu en qualité haute : capture Windows, taille de l’écran, NV12 par la carte, NVENC', () => {
  const a = trialArgs(trialsFor('(?i)^cs2[.]exe$')[0], HIGH, 'h264_nvenc', 'C:\\V\\essai.mp4')
  assert.equal(graph(a), "gfxcapture=window_exe='(?i)^cs2[.]exe$':max_framerate=60:capture_cursor=0[v]")
  assert.deepEqual(a.slice(a.indexOf('-t'), a.indexOf('-t') + 4), ['-t', String(TRIAL_S), '-fps_mode', 'passthrough'])
  assert.deepEqual(a.slice(a.indexOf('-c:v'), a.indexOf('-c:v') + 6), ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr'])
  assert.equal(a[a.indexOf('-b:v') + 1], '40000000')
  assert.equal(a[a.length - 1], 'file:C:\\V\\essai.mp4')
  assert.ok(a.includes('pipe:1'))
})

test('écran : taille de l’écran, sans scale_d3d11 (il cassait la chaîne chez Breezydev) ; copie de bureau sans images répétées', () => {
  const [wgc, dda] = trialsFor(null)
  assert.equal(graph(trialArgs(wgc, BAL, 'h264_amf', '/o.mp4')), 'gfxcapture=monitor_idx=0:max_framerate=60:capture_cursor=0[v]')
  assert.equal(graph(trialArgs(dda, BAL, 'h264_amf', '/o.mp4')), 'ddagrab=output_idx=0:framerate=60:dup_frames=0:draw_mouse=0[v]')
})

test('refusés : un encodeur inconnu, un programme avec des caractères du graphe', () => {
  assert.throws(() => trialArgs(trialsFor(null)[0], BAL, 'libx264', '/o.mp4'), /Encodeur refusé/)
  assert.throws(() => trialArgs({ id: 'fenetre', label: 'x', exeRegex: "a',b" }, BAL, 'h264_nvenc', '/o.mp4'), /Programme refusé/)
  assert.throws(() => trialArgs({ id: 'fenetre', label: 'x', exeRegex: 'a:b' }, BAL, 'h264_nvenc', '/o.mp4'), /Programme refusé/)
})

test('avancement : le dernier compte d’images, rapporté à la durée de l’essai', () => {
  assert.deepEqual(readProgress('frame=10\nfps=0.0\nprogress=continue\nframe=598\nfps=59.9\nprogress=end\n'), { frames: 598, fps: 59.8 })
  assert.equal(readProgress('rien'), null)
})

test('bêta 39 : trois manières, de la meilleure à la plus sûre ; NVENC d’abord', () => {
  const t = trialsFor(null)[0]
  const gpu = trialArgs(t, BAL, 'h264_nvenc', '/o.mp4', 'gpu')
  const auto = trialArgs(t, BAL, 'h264_nvenc', '/o.mp4', 'gpu-auto')
  const copie = trialArgs(t, BAL, 'h264_nvenc', '/o.mp4', 'copie')
  assert.ok(gpu.includes('-init_hw_device') && !auto.includes('-init_hw_device') && !copie.includes('-init_hw_device'))
  assert.ok(graph(copie).endsWith(',hwdownload,format=bgra[v]'))
  assert.ok(!graph(copie).includes('scale_d3d11'))
  assert.ok(!graph(gpu).includes('hwdownload'))
  assert.equal(gpu[gpu.indexOf('-loglevel') + 1], 'warning')
  assert.deepEqual(TRIAL_ATTEMPTS.map((a) => `${a.encoder}/${a.mode}`), ['h264_nvenc/gpu', 'h264_nvenc/gpu-auto', 'h264_amf/gpu', 'h264_amf/gpu-auto', 'h264_nvenc/copie', 'h264_amf/copie'])
})
