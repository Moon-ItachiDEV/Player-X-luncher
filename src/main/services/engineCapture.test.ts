// Tests de la capture par le moteur (npm run test:edit) : ordre des essais, commandes, avancement, son en PCM.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { attemptLabel, engineAttempts, muxArgs, pcmWindow, readEngineProgress, recordArgs } from './engineCapture.ts'

const Q = { fps: 60, videoBps: 40_000_000 }
const graph = (a: string[]) => a[a.indexOf('-filter_complex') + 1]

test('ordre : fenêtre du jeu, puis écran Windows 10/11, puis copie de bureau ; six manières chacune', () => {
  const all = engineAttempts('(?i)^cs2[.]exe$', 0)
  assert.equal(all.length, 18)
  assert.deepEqual([...new Set(all.map((a) => a.method.id))], ['fenetre', 'ecran-wgc', 'ecran-dda'])
  assert.deepEqual(all.slice(0, 2).map((a) => `${a.encoder}/${a.mode}`), ['h264_nvenc/gpu', 'h264_nvenc/gpu-auto'])
  assert.equal(engineAttempts(null, 1).length, 12)
  assert.equal((engineAttempts(null, 1)[0].method as { monitor: number }).monitor, 1)
})

test('commande : fenêtre du jeu, NVENC au débit constant demandé, image clé toutes les 2 s, MP4 fragmenté sur la sortie', () => {
  const a = recordArgs(engineAttempts('(?i)^cs2[.]exe$', 0)[0], Q)
  assert.equal(graph(a), "gfxcapture=window_exe='(?i)^cs2[.]exe$':max_framerate=60:capture_cursor=0[v]")
  assert.ok(a.includes('-init_hw_device'))
  const at = (k: string) => a[a.indexOf(k) + 1]
  assert.equal(at('-c:v'), 'h264_nvenc')
  assert.equal(at('-rc'), 'cbr')
  assert.equal(at('-b:v'), '40000000')
  assert.equal(at('-maxrate'), '40000000')
  assert.equal(at('-g'), '120')
  assert.equal(at('-force_key_frames'), 'expr:gte(t,n_forced*2)')
  assert.equal(at('-fps_mode'), 'passthrough')
  assert.equal(at('-movflags'), '+frag_keyframe+empty_moov+default_base_moof')
  assert.equal(at('-frag_duration'), '500000')
  assert.equal(at('-progress'), 'pipe:2')
  assert.equal(a[a.length - 1], 'pipe:1')
  assert.ok(a.includes('-an'))
})

test('commande : copie de bureau copiée avant AMF ; essai Linux x11grab + libx264', () => {
  const dda = engineAttempts(null, 0).find((x) => x.method.id === 'ecran-dda' && x.mode === 'copie' && x.encoder === 'h264_amf')!
  const a = recordArgs(dda, { fps: 30, videoBps: 10_000_000 })
  assert.equal(graph(a), 'ddagrab=output_idx=0:framerate=30:dup_frames=0:draw_mouse=0,hwdownload,format=bgra[v]')
  assert.ok(!a.includes('-init_hw_device'))
  assert.equal(a[a.indexOf('-usage') + 1], 'lowlatency')
  assert.equal(a[a.indexOf('-g') + 1], '60')
  const x = recordArgs({ method: { id: 'x11', label: 'x', display: ':93', width: 1920, height: 1080 }, encoder: 'libx264', mode: 'copie' }, Q)
  assert.deepEqual(x.slice(x.indexOf('-f'), x.indexOf('-f') + 8), ['-f', 'x11grab', '-framerate', '60', '-video_size', '1920x1080', '-i', ':93'])
  assert.throws(() => recordArgs({ method: { id: 'x11', label: 'x', display: '/etc/x', width: 1, height: 1 }, encoder: 'libx264', mode: 'copie' }, Q), /Écran refusé/)
  assert.throws(() => recordArgs({ ...dda, encoder: 'hevc_nvenc' }, Q), /Encodeur refusé/)
  assert.match(attemptLabel(dda), /copie de bureau, h264_amf, copie/)
})

test('avancement : dernières images et images/s', () => {
  assert.deepEqual(readEngineProgress('frame=10\nfps=12.0\nprogress=continue\nframe=600\nfps=59.8\nprogress=continue\n'), { frames: 600, fps: 59.8 })
  assert.equal(readEngineProgress('rien'), null)
})

test('son : fenêtre en PCM, silence là où rien n’est reçu, morceaux recollés bout à bout à 10 ms près', () => {
  const part = (wall: number, frames: number, v: number) => ({ wall, data: Buffer.alloc(frames * 4, v) })
  // Fenêtre de 1 s à partir de 1000 ms ; un morceau avant (coupé), un trou, deux morceaux décalés de 3 ms.
  const { pcm, covered } = pcmWindow([part(900, 9600, 1), part(1500, 4800, 2), part(1603, 4800, 3)], 1000, 1)
  assert.equal(pcm.length, 48000 * 4)
  assert.equal(pcm[0], 1) // 900 + 200 ms = 1100 : de 0 à 100 ms
  assert.equal(pcm[4799 * 4], 1)
  assert.equal(pcm[4800 * 4], 0) // trou
  assert.equal(pcm[24000 * 4], 2) // 1500 ms
  // 1603 ms est collé à la fin du précédent (1600 ms), pas 3 ms plus loin.
  assert.equal(pcm[28800 * 4], 3)
  assert.equal(pcm[33599 * 4], 3)
  assert.equal(pcm[33600 * 4], 0)
  assert.ok(Math.abs(covered - 0.3) < 1e-9) // 100 ms + 100 ms + 100 ms
  assert.deepEqual(pcmWindow([], 0, 0.5).covered, 0)
})

test('son : l’image copiée, le PCM encodé en AAC au débit de la qualité', () => {
  const a = muxArgs('C:\\T\\v.mp4', 'C:\\T\\a.pcm', 'C:\\Clips\\c.mp4.part', 192_000)
  const at = (k: string, from = 0) => a[a.indexOf(k, from) + 1]
  assert.equal(at('-i'), 'file:C:\\T\\v.mp4')
  assert.equal(at('-f'), 's16le')
  assert.equal(at('-c:v'), 'copy')
  assert.equal(at('-c:a'), 'aac')
  assert.equal(at('-b:a'), '192000')
  assert.equal(a[a.length - 1], 'file:C:\\Clips\\c.mp4.part')
})
