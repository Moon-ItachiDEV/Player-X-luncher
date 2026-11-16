// Tests des règles de la copie « pour Discord » (npm run test:clips) : limite, taille d'image, débit, second essai, commande.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { DISCORD_MB, fitSize, limitBytes, needBps, shareArgs, shareEncoders, sharePercent, sharePlan, shareRetry, shareTimeoutMs, SHARE_MARGIN, type ShareEncode, type ShareSource } from './sharePlan.ts'

/** Le clip par défaut de Breezydev : 25 s, écran 2560 × 1440, 20 Mb/s, environ 63 Mo. */
const CLIP: ShareSource = { sizeBytes: 63_000_000, durationS: 25, width: 2560, height: 1440, fps: 58.2, hasAudio: true }
const FREE = limitBytes('free')
const BASIC = limitBytes('basic')
const NITRO = limitBytes('nitro')
const enc = (width: number, height: number, fps: number, videoBps: number, audioBps = 128_000): ShareEncode => ({ kind: 'encode', width, height, fps, videoBps, audioBps })
/** Le poids visé par un plan de copie, en octets (image + son, sans l'enveloppe du fichier). */
const weight = (p: ShareEncode, durationS: number): number => ((p.videoBps + p.audioBps) * durationS) / 8

test('les limites : 20, 50 et 500 Mo, un Mo comptant un million d’octets', () => {
  assert.deepEqual(DISCORD_MB, { free: 20, basic: 50, nitro: 500 })
  assert.equal(FREE, 20_000_000)
  assert.equal(BASIC, 50_000_000)
  assert.equal(NITRO, 500_000_000)
  assert.equal(SHARE_MARGIN, 0.06)
})

test('un clip déjà assez léger part tel quel', () => {
  assert.deepEqual(sharePlan(CLIP, NITRO), { kind: 'original' })
  assert.deepEqual(sharePlan({ ...CLIP, sizeBytes: FREE }, FREE), { kind: 'original' })
  // Pile un octet de trop : une copie est à fabriquer.
  assert.equal(sharePlan({ ...CLIP, sizeBytes: FREE + 1 }, FREE).kind, 'encode')
  // Un fichier léger ne demande rien d'autre que son poids.
  assert.deepEqual(sharePlan({ sizeBytes: 5_000_000, durationS: 0, width: 0, height: 0, fps: 0, hasAudio: false }, FREE), { kind: 'original' })
})

test('25 s sous 20 Mo : 720p à 60 images/s', () => {
  const p = sharePlan(CLIP, FREE)
  assert.deepEqual(p, enc(1280, 720, 60, 5_888_000))
  // Le poids visé reste 6 % sous la limite.
  assert.ok(weight(p as ShareEncode, 25) <= FREE * (1 - SHARE_MARGIN))
  // Pareil pour un clip filmé sur un écran en 1080p.
  assert.deepEqual(sharePlan({ ...CLIP, width: 1920, height: 1080 }, FREE), enc(1280, 720, 60, 5_888_000))
})

test('25 s sous 50 Mo : 1080p à 60 images/s', () => {
  assert.deepEqual(sharePlan(CLIP, BASIC), enc(1920, 1080, 60, 14_912_000))
  assert.deepEqual(sharePlan({ ...CLIP, width: 1920, height: 1080 }, BASIC), enc(1920, 1080, 60, 14_912_000))
})

test('un clip court garde la taille de l’écran si le débit le permet', () => {
  // 8,5 s à 20 Mb/s : 21,25 Mo, juste au-dessus de la limite.
  assert.deepEqual(sharePlan({ ...CLIP, sizeBytes: 21_250_000, durationS: 8.5 }, FREE), enc(2560, 1440, 60, 17_566_000))
})

test('un clip long descend à 30 images/s, puis en 480p', () => {
  // 60 s sous 20 Mo : 720p à 30 images/s demanderait 2,475 Mb/s, il en reste 2,378.
  assert.deepEqual(sharePlan({ ...CLIP, sizeBytes: 150_000_000, durationS: 60 }, FREE), enc(854, 480, 30, 2_410_000, 96_000))
  // 45 s sous 20 Mo : 720p à 30 images/s.
  assert.deepEqual(sharePlan({ ...CLIP, sizeBytes: 112_500_000, durationS: 45 }, FREE), enc(1280, 720, 30, 3_214_000))
  // 3 min sous 50 Mo.
  assert.deepEqual(sharePlan({ ...CLIP, sizeBytes: 450_000_000, durationS: 180 }, BASIC), enc(854, 480, 30, 1_992_000, 96_000))
})

test('180 s sous 20 Mo : refusé, avec la durée la plus longue qui tient', () => {
  assert.deepEqual(sharePlan({ ...CLIP, sizeBytes: 450_000_000, durationS: 180 }, FREE), { kind: 'too-long', maxS: 115 })
  // Un clip de 115 s tient, un clip de 116 s non.
  assert.equal(sharePlan({ ...CLIP, sizeBytes: 290_000_000, durationS: 115 }, FREE).kind, 'encode')
  assert.equal(sharePlan({ ...CLIP, sizeBytes: 290_000_000, durationS: 116 }, FREE).kind, 'too-long')
  // Avec Nitro, le même clip de 3 min part tel quel.
  assert.deepEqual(sharePlan({ ...CLIP, sizeBytes: 450_000_000, durationS: 180 }, NITRO), { kind: 'original' })
})

test('qualité légère (30 images/s) : la copie reste à 30', () => {
  assert.deepEqual(sharePlan({ sizeBytes: 31_600_000, durationS: 25, width: 1920, height: 1080, fps: 29.6, hasAudio: true }, FREE), enc(1920, 1080, 30, 5_888_000))
})

test('un clip sans son : tout le débit va à l’image', () => {
  assert.deepEqual(sharePlan({ ...CLIP, hasAudio: false }, FREE), enc(1280, 720, 60, 6_016_000, 0))
})

test('écran très large, image en hauteur, petite image : le rapport est gardé, sans agrandir', () => {
  // 3440 × 1440 sous 50 Mo : réduit dans la boîte 2560 × 1440.
  assert.deepEqual(sharePlan({ ...CLIP, width: 3440, height: 1440 }, BASIC), enc(2560, 1072, 60, 14_912_000))
  // Un film vertical 1080 × 1920 sous 20 Mo.
  assert.deepEqual(sharePlan({ sizeBytes: 60_000_000, durationS: 30, width: 1080, height: 1920, fps: 60, hasAudio: true }, FREE), enc(720, 1280, 60, 4_885_000))
  // Une petite image très lourde : elle garde sa taille, le débit est plafonné au double du minimum.
  assert.deepEqual(sharePlan({ sizeBytes: 30_000_000, durationS: 13, width: 640, height: 360, fps: 60, hasAudio: true }, FREE), enc(640, 360, 60, 2_474_000))
})

test('une image plus petite que 480p : le son s’allège avant le refus', () => {
  // Le clip d'essai sous Linux : 640 × 360 à 29,4 images/s, 13,2 s. Le minimum de l'image y est de 680 kb/s.
  const small: ShareSource = { sizeBytes: 2_752_165, durationS: 13.2, width: 640, height: 360, fps: 29.4, hasAudio: true }
  assert.equal(needBps(640, 360, 30), 680_000)
  // 790 kb/s en tout : pas assez avec le son à 128 kb/s, assez avec le son à 96 kb/s.
  assert.deepEqual(sharePlan(small, 1_386_702), enc(640, 360, 30, 693_000, 96_000))
  // Sous 30 % du poids : refusé, et la durée qui tient compte le son allégé (680 + 96 kb/s).
  assert.deepEqual(sharePlan(small, 825_650), { kind: 'too-long', maxS: 8 })
})

test('la taille de l’image dans une boîte', () => {
  assert.deepEqual(fitSize(2560, 1440, 1920, 1080), { width: 1920, height: 1080 })
  assert.deepEqual(fitSize(2560, 1440, 854, 480), { width: 854, height: 480 })
  assert.deepEqual(fitSize(1280, 720, 1920, 1080), { width: 1280, height: 720 })
  assert.deepEqual(fitSize(3440, 1440, 1920, 1080), { width: 1920, height: 804 })
  assert.deepEqual(fitSize(1280, 960, 1280, 720), { width: 960, height: 720 })
  assert.deepEqual(fitSize(1080, 1920, 1280, 720), { width: 720, height: 1280 })
  // Toujours des nombres pairs.
  assert.deepEqual(fitSize(1365, 767, 1280, 720), { width: 1280, height: 720 })
  assert.deepEqual(fitSize(1365, 767, 2560, 1440), { width: 1366, height: 768 })
})

test('le débit minimal de l’image', () => {
  assert.equal(needBps(2560, 1440, 60), 16_000_000)
  assert.equal(needBps(1920, 1080, 60), 9_000_000)
  assert.equal(needBps(1280, 720, 60), 4_500_000)
  assert.equal(needBps(854, 480, 60), 2_200_000)
  assert.equal(needBps(1280, 720, 30), 2_475_000)
  assert.equal(needBps(854, 480, 30), 1_210_000)
  // Entre deux repères, au-delà du dernier, et sous le premier : en proportion.
  assert.equal(needBps(2560, 1072, 60), 11_911_000)
  assert.equal(needBps(3840, 2160, 60), 36_000_000)
  assert.equal(needBps(640, 360, 60), 1_237_000)
})

test('le second essai : au moins 10 % plus bas, davantage si la copie a beaucoup dépassé', () => {
  const p = enc(1280, 720, 60, 5_888_000)
  assert.deepEqual(shareRetry(p, 20_600_000, FREE), enc(1280, 720, 60, 5_286_000))
  assert.deepEqual(shareRetry(p, 24_000_000, FREE), enc(1280, 720, 60, 4_734_000))
  // Jamais un débit absurde.
  assert.equal(shareRetry(enc(854, 480, 30, 150_000, 96_000), 900_000_000, FREE).videoBps, 100_000)
})

test('la commande : cadence, taille, débit plafonné, son AAC, index au début', () => {
  const a = shareArgs('C:\\V\\Counter-Strike 2 Triple.mp4', enc(1280, 720, 60, 5_888_000), 'h264_nvenc', 'C:\\T\\copie.part')
  assert.deepEqual(a, [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-protocol_whitelist', 'file', '-i', 'file:C:\\V\\Counter-Strike 2 Triple.mp4',
    '-map', '0:v:0', '-map', '0:a:0',
    '-vf', 'fps=60,scale=1280:720,setsar=1,format=nv12',
    '-c:v', 'h264_nvenc', '-b:v', '5888000', '-maxrate', '5888000', '-bufsize', '11776000', '-g', '120', '-bf', '0',
    '-c:a', 'aac', '-b:a', '128000', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats',
    '-f', 'mp4', 'file:C:\\T\\copie.part'
  ])
  // Jamais la réduction par la carte graphique qui casse chez Breezydev.
  assert.equal(a.join(' ').includes('scale_d3d11'), false)
})

test('la commande : sans son, et un encodeur logiciel en YUV 4:2:0', () => {
  const a = shareArgs('/v/clip.mp4', enc(854, 480, 30, 1_992_000, 0), 'libopenh264', '/t/copie.part')
  assert.equal(a[a.indexOf('-vf') + 1], 'fps=30,scale=854:480,setsar=1,format=yuv420p')
  assert.equal(a.includes('-an'), true)
  assert.equal(a.includes('-c:a'), false)
  assert.equal(a.filter((x) => x === '-map').length, 1)
  assert.equal(a[a.indexOf('-g') + 1], '60')
})

test('la commande refuse ce qui n’est pas un encodeur ou une copie valable', () => {
  const p = enc(1280, 720, 60, 5_888_000)
  assert.throws(() => shareArgs('/v/c.mp4', p, 'h264 -y', '/t/o'), /Encodeur inconnu/)
  assert.throws(() => shareArgs('/v/c.mp4', { ...p, width: 1281 }, 'libx264', '/t/o'), /Copie refusée/)
  assert.throws(() => shareArgs('/v/c.mp4', { ...p, videoBps: 12.5 }, 'libx264', '/t/o'), /Copie refusée/)
  assert.throws(() => shareArgs('/v/c.mp4', { ...p, fps: 0 }, 'libx264', '/t/o'), /Copie refusée/)
  assert.throws(() => shareArgs('/v/c.mp4', { ...p, audioBps: 8 }, 'libx264', '/t/o'), /Copie refusée/)
})

test('un clip illisible ou une limite absurde : refusés', () => {
  assert.throws(() => sharePlan({ ...CLIP, durationS: Number.NaN }, FREE), /Clip illisible/)
  assert.throws(() => sharePlan({ ...CLIP, width: 0 }, FREE), /Clip illisible/)
  assert.throws(() => sharePlan(CLIP, 0), /Limite refusée/)
})

test('l’avancement, le délai et l’ordre des encodeurs', () => {
  assert.equal(sharePercent(0, 25), 0)
  assert.equal(sharePercent(12.5, 25), 50)
  assert.equal(sharePercent(25, 25), 99)
  assert.equal(sharePercent(3, 0), 0)
  assert.equal(shareTimeoutMs(25), 280_000)
  assert.deepEqual(shareEncoders(['h264_nvenc', 'h264_amf', 'libopenh264'], 'h264_amf'), ['h264_amf', 'h264_nvenc', 'libopenh264'])
  assert.deepEqual(shareEncoders(['h264_nvenc', 'h264_amf'], 'inconnu'), ['h264_nvenc', 'h264_amf'])
  assert.deepEqual(shareEncoders(['h264_nvenc', 'h264_amf'], null), ['h264_nvenc', 'h264_amf'])
})
