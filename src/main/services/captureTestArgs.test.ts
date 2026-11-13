// Tests de l'essai « capture comme OBS » (npm run test:edit) : commandes du moteur et lecture de l'avancement.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { gameExeRegex, readProgress, reducedSize, trialArgs, trialsFor, TRIAL_ATTEMPTS, TRIAL_S } from './captureTestArgs.ts'
// @ts-ignore TS5097
import { engineAttempts, recordArgs } from './engineCapture.ts'

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

// ---------- bêta 46 : la capture réduite, à l'essai seulement ----------

test('bêta 46, taille réduite : dans 1920 × 1080, même rapport, nombres pairs, jamais d’agrandissement', () => {
  assert.deepEqual(reducedSize(2560, 1440), { width: 1920, height: 1080 })
  assert.deepEqual(reducedSize(3840, 2160), { width: 1920, height: 1080 })
  assert.deepEqual(reducedSize(3440, 1440), { width: 1920, height: 804 })
  assert.deepEqual(reducedSize(1920, 1200), { width: 1728, height: 1080 })
  assert.deepEqual(reducedSize(2560, 1080), { width: 1920, height: 810 })
  // Un écran en hauteur se réduit dans 1080 × 1920.
  assert.deepEqual(reducedSize(1440, 2560), { width: 1080, height: 1920 })
  // Déjà en 1080p ou moins : rien à réduire.
  assert.equal(reducedSize(1920, 1080), null)
  assert.equal(reducedSize(1366, 768), null)
  assert.equal(reducedSize(0, 1080), null)
  assert.equal(reducedSize(Number.NaN, 1080), null)
})

test('bêta 46, les essais sur un écran en 1440p : chaque méthode gfxcapture, puis la même réduite ; la copie de bureau une seule fois', () => {
  const t = trialsFor('(?i)^cs2[.]exe$', { width: 2560, height: 1440 })
  assert.deepEqual(t.map((x) => `${x.id}${'scale' in x && x.scale ? ` ${x.scale.width}x${x.scale.height}` : ''}`), ['fenetre', 'fenetre 1920x1080', 'ecran-wgc', 'ecran-wgc 1920x1080', 'ecran-dda'])
  assert.deepEqual(t.map((x) => x.label), ['Fenêtre du jeu', 'Fenêtre du jeu, réduite à 1920 × 1080', 'Écran, capture Windows 10/11', 'Écran, capture Windows 10/11, réduit à 1920 × 1080', 'Écran, copie de bureau'])
  // Sans jeu reconnu : l'écran seulement.
  assert.deepEqual(trialsFor(null, { width: 2560, height: 1440 }).map((x) => x.label), ['Écran, capture Windows 10/11', 'Écran, capture Windows 10/11, réduit à 1920 × 1080', 'Écran, copie de bureau'])
})

test('bêta 46, un écran en 1080p ou de taille inconnue : les mêmes essais qu’avant, sans réduction', () => {
  for (const screen of [{ width: 1920, height: 1080 }, null, undefined]) {
    const t = trialsFor('(?i)^cs2[.]exe$', screen)
    assert.deepEqual(t.map((x) => x.id), ['fenetre', 'ecran-wgc', 'ecran-dda'])
    assert.equal(t.some((x) => 'scale' in x && x.scale), false)
  }
})

test('bêta 46, la commande d’un essai réduit : la réduction de gfxcapture, rien d’autre ne change', () => {
  const [win, winSmall, mon, monSmall] = trialsFor('(?i)^cs2[.]exe$', { width: 2560, height: 1440 })
  const full = trialArgs(win, BAL, 'h264_nvenc', '/o.mp4')
  const small = trialArgs(winSmall, BAL, 'h264_nvenc', '/o.mp4')
  assert.equal(graph(small), "gfxcapture=window_exe='(?i)^cs2[.]exe$':max_framerate=60:capture_cursor=0:width=1920:height=1080:resize_mode=scale_aspect[v]")
  assert.equal(graph(trialArgs(monSmall, BAL, 'h264_amf', '/o.mp4')), 'gfxcapture=monitor_idx=0:max_framerate=60:capture_cursor=0:width=1920:height=1080:resize_mode=scale_aspect[v]')
  assert.equal(graph(trialArgs(mon, BAL, 'h264_amf', '/o.mp4')), 'gfxcapture=monitor_idx=0:max_framerate=60:capture_cursor=0[v]')
  // À part le graphe, la commande réduite est la même que celle à la taille de l'écran.
  const at = full.indexOf('-filter_complex') + 1
  assert.deepEqual(small.filter((_x: string, i: number) => i !== at), full.filter((_x: string, i: number) => i !== at))
  // La copie par le processeur garde sa place, après la réduction.
  assert.ok(graph(trialArgs(winSmall, BAL, 'h264_nvenc', '/o.mp4', 'copie')).endsWith(':resize_mode=scale_aspect,hwdownload,format=bgra[v]'))
  // Toujours sans la réduction qui cassait chez Breezydev.
  assert.equal(small.join(' ').includes('scale_d3d11'), false)
})

test('bêta 46, une taille réduite impaire, nulle ou démesurée est refusée', () => {
  const base = { id: 'ecran-wgc' as const, label: 'x', monitor: 0 }
  for (const scale of [{ width: 1921, height: 1080 }, { width: 1920, height: 0 }, { width: 1920.5, height: 1080 }, { width: 99998, height: 1080 }]) {
    assert.throws(() => trialArgs({ ...base, scale }, BAL, 'h264_nvenc', '/o.mp4'), /Taille refusée/)
  }
})

test('bêta 46, les vrais clips ne sont pas réduits : la capture de la partie ignore la taille d’essai', () => {
  // Les manières d'enregistrer une partie ne portent jamais de réduction.
  assert.equal(engineAttempts('(?i)^cs2[.]exe$', 0).some((a: { method: object }) => 'scale' in a.method), false)
  // Et même si une méthode en portait une, la commande d'enregistrement ne la lit pas.
  const [, winSmall] = trialsFor('(?i)^cs2[.]exe$', { width: 2560, height: 1440 })
  const rec = recordArgs({ method: winSmall, encoder: 'h264_nvenc', mode: 'gpu' }, { fps: 60, videoBps: 20_000_000 })
  assert.equal(graph(rec), "gfxcapture=window_exe='(?i)^cs2[.]exe$':max_framerate=60:capture_cursor=0[v]")
})
