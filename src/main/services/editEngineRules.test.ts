// Tests des règles du moteur vidéo (npm run test:edit) : ce que ffmpeg répond, ses arguments, le choix de l'encodeur, l'essai relu.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { cleanLastFilm, cleanTest, CLIP_SAMPLE_S, encoderOrder, ENCODERS, filmReportText, gpuText, minuteSeconds, parseEncoders, parseVersion, pickBest, reportText, SAMPLE, sampleArgs, scrub } from './editEngineRules.ts'

// Le numéro du build livré est celui lu dans son fichier (le moteur Windows n'a pas pu être lancé pendant le développement) ;
// les deux lignes d'Ubuntu sont la vraie réponse du ffmpeg qui sert aux essais sous Linux. La liste suit le format de « -encoders ».
const VERSION_BTBN = 'ffmpeg version n9.0.2-39-g7adfbe40dc-20261031 Copyright (c) 2000-2026 the FFmpeg developers\n'
const VERSION_UBUNTU = 'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers\nbuilt with gcc 13 (Ubuntu 13.2.0-23ubuntu3)\n'
const ENCODERS_OUT = `Encoders:
 V..... = Video
 A..... = Audio
 ------
 V....D libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_amf             AMD AMF H.264 Encoder (codec h264)
 V....D h264_mf              H264 via MediaFoundation (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video acceleration) (codec h264)
 V....D hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
 A....D aac                  AAC (Advanced Audio Coding)
 A....D h264_fake            un encodeur audio qui porte un nom de vidéo
`

test('la version se lit dans la première ligne de ffmpeg, et seulement là', () => {
  assert.equal(parseVersion(VERSION_BTBN), '9.0.2')
  assert.equal(parseVersion(VERSION_UBUNTU), '6.1.1')
  assert.equal(parseVersion('ffmpeg version N-128227-g4811625b5f-20261031 Copyright'), '')
  assert.equal(parseVersion('bash: ffmpeg: command not found'), '')
  assert.equal(parseVersion(''), '')
})

test('les encodeurs cités sortent dans l’ordre de préférence, les autres sont ignorés', () => {
  assert.deepEqual(parseEncoders(ENCODERS_OUT), ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf', 'libopenh264'])
  assert.deepEqual(parseEncoders(' V....D libx264              libx264 H.264\n V....D h264_nvenc           NVIDIA\n'), ['h264_nvenc'])
  assert.deepEqual(parseEncoders(' V....D libx264              libx264 H.264\n', [...ENCODERS, 'libx264']), ['libx264'])
  assert.deepEqual(parseEncoders('rien'), [])
})

test('l’essai d’un encodeur : une mire de ffmpeg, les réglages d’image d’un vrai film, un seul fichier écrit', () => {
  const a = sampleArgs('h264_nvenc', 'C:\\Temp\\px\\essai.mp4')
  // Les mêmes réglages qu'un plan de film (editCompile.videoArgs) : un encodeur qui passe l'essai fera les films.
  assert.deepEqual(a.slice(a.indexOf('-c:v'), a.indexOf('-an')), ['-c:v', 'h264_nvenc', '-b:v', '16M', '-g', '120', '-bf', '0'])
  assert.deepEqual(a.slice(0, 5), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'])
  assert.equal(a[a.indexOf('-i') + 1], 'testsrc2=size=1920x1080:rate=60')
  assert.equal(a[a.indexOf('-t') + 1], String(SAMPLE.seconds))
  assert.equal(a[a.indexOf('-vf') + 1], 'format=nv12')
  assert.equal(a[a.indexOf('-c:v') + 1], 'h264_nvenc')
  assert.equal(a.at(-1), 'file:C:\\Temp\\px\\essai.mp4')
  assert.equal(a.filter((x: string) => x.startsWith('file:')).length, 1)
  assert.ok(a.includes('-an'))
  // Les encodeurs logiciels ne prennent pas le NV12.
  const soft = sampleArgs('libopenh264', '/tmp/a.mp4')
  assert.equal(soft[soft.indexOf('-vf') + 1], 'format=yuv420p')
})

test('un nom d’encodeur qui n’en est pas un ne passe jamais dans la commande', () => {
  for (const bad of ['', 'h264 nvenc', '-i', 'libx264 -f null', 'a;b', 'É', 'x'.repeat(40)]) {
    assert.throws(() => sampleArgs(bad, '/tmp/a.mp4'), /Encodeur inconnu/)
  }
})

test('l’essai sur le dernier clip passe par les commandes d’un film (editCompile) : 20 s au plus', () => {
  // Les commandes elles-mêmes sont testées dans editCompile.test.ts : un plan, puis l'assemblage.
  assert.equal(CLIP_SAMPLE_S, 20)
  assert.ok(CLIP_SAMPLE_S > SAMPLE.seconds)
})

test('le choix : le premier qui marche dans l’ordre de préférence, pas le plus rapide', () => {
  const r = [
    { id: 'h264_nvenc', ok: false, error: 'Cannot load nvEncodeAPI64.dll' },
    { id: 'h264_amf', ok: true, seconds: 1.4 },
    { id: 'h264_qsv', ok: false },
    { id: 'h264_mf', ok: true, seconds: 0.9 },
    { id: 'libopenh264', ok: true, seconds: 4.2 }
  ]
  assert.equal(pickBest(r), 'h264_amf')
  assert.equal(pickBest(r.map((x) => ({ ...x, ok: false }))), null)
  assert.equal(pickBest([]), null)
  // L'encodeur d'essai du développement ne passe qu'en dernier recours.
  assert.equal(pickBest([{ id: 'libx264', ok: true, seconds: 8 }]), 'libx264')
  assert.equal(pickBest([{ id: 'libx264', ok: true, seconds: 8 }, { id: 'libopenh264', ok: true, seconds: 9 }]), 'libopenh264')
})

test('les encodeurs d’un film : le dernier qui a servi, ceux que l’essai a vus marcher, puis les autres', () => {
  const ALL = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf', 'libopenh264']
  // Jamais d'essai sur ce PC : tous, dans l'ordre de préférence.
  assert.deepEqual(encoderOrder(null), ALL)
  // Un essai relevé sur un vrai PC (GeForce RTX 4070 Ti, le 10/11/2026) : la carte NVIDIA, puis Windows, puis le secours ; AMD
  // et Intel en dernier recours.
  const test = { at: 1, version: '9.0.2', sampleS: 5, best: 'h264_nvenc', encoders: [{ id: 'h264_nvenc', ok: true, seconds: 0.85 }, { id: 'h264_amf', ok: false }, { id: 'h264_qsv', ok: false }, { id: 'h264_mf', ok: true, seconds: 0.56 }, { id: 'libopenh264', ok: true, seconds: 0.9 }] }
  assert.deepEqual(encoderOrder(test), ['h264_nvenc', 'h264_mf', 'libopenh264', 'h264_amf', 'h264_qsv'])
  // Celui qui a fabriqué le film précédent passe devant.
  assert.deepEqual(encoderOrder(test, 'h264_mf'), ['h264_mf', 'h264_nvenc', 'libopenh264', 'h264_amf', 'h264_qsv'])
  assert.deepEqual(encoderOrder(null, 'libopenh264'), ['libopenh264', 'h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf'])
  // Un essai où rien n'a marché : tous quand même, un film vaut l'essai.
  assert.deepEqual(encoderOrder({ at: 1, version: '9.0.2', sampleS: 5, best: null, encoders: [{ id: 'demarrage', ok: false }] }), ALL)
  // Un nom inconnu ou farfelu gardé en base ne passe pas ; l'encodeur du développement passe en tête.
  assert.deepEqual(encoderOrder(null, 'libx264'), ALL)
  assert.deepEqual(encoderOrder(null, '-f null'), ALL)
  assert.deepEqual(encoderOrder(null, 'libx264', 'libx264'), ['libx264', ...ALL])
  assert.deepEqual(encoderOrder(test, null, 'libx264'), ['libx264', 'h264_nvenc', 'h264_mf', 'libopenh264', 'h264_amf', 'h264_qsv'])
  assert.deepEqual(encoderOrder(null, null, 'pas un nom'), ALL)
})

test('une minute de film : la règle de trois sur l’essai', () => {
  assert.equal(minuteSeconds(1, 5), 12)
  assert.equal(minuteSeconds(8.45, 5), 101.39999999999999)
  assert.equal(minuteSeconds(1, 0), 0)
})

test('un message de ffmpeg ne garde aucun chemin de ce PC', () => {
  const tmp = 'C:\\Users\\Jean Dupont\\AppData\\Local\\Temp\\px-moteur-Ab12'
  const msg = `[out#0/mp4 @ 000001] Error opening output file:C:\\Users\\Jean Dupont\\AppData\\Local\\Temp\\px-moteur-Ab12\\h264_amf.mp4.\r\nError opening output files: No such file`
  const s = scrub(msg, [tmp])
  assert.ok(!/Jean|Dupont|AppData/.test(s), s)
  assert.match(s, /Error opening output file:…\\h264_amf\.mp4\. Error opening output files/)
  // Même sans la liste : tout dossier de session part, avec ses espaces, sous Windows comme ailleurs.
  assert.equal(scrub('C:/Users/Jean Dupont/Videos/a.mp4: Invalid data'), 'C:/Users/…/Videos/a.mp4: Invalid data')
  assert.equal(scrub('c:\\users\\breezy\\x.mp4 introuvable'), 'c:\\users\\…\\x.mp4 introuvable')
  assert.equal(scrub('/home/alex/clips/a.mp4: No such file'), '/home/…/clips/a.mp4: No such file')
  // La casse et le sens des barres du chemin donné ne comptent pas.
  assert.equal(scrub('c:/users/jean dupont/appdata/local/temp/px-moteur-ab12/x.mp4', [tmp]), '…/x.mp4')
  assert.equal(scrub('a\u0000b\n\n  c'), 'a b c')
  assert.equal(scrub('x'.repeat(500)).length, 300)
})

test('un essai relu dans la base : structure vérifiée, autre version refusée', () => {
  const good = {
    at: 1_794_000_000_000,
    version: '9.0.2',
    sampleS: 5,
    encoders: [
      { id: 'h264_nvenc', ok: true, seconds: 0.84, error: 'ignoré quand ça marche', autre: 1 },
      { id: 'h264_amf', ok: false, error: 'Cannot load amfrt64.dll from C:\\Users\\Jean\\x' },
      { id: 'h264 qsv', ok: true, seconds: 1 },
      { id: 'h264_mf', ok: true },
      'pas un objet'
    ],
    best: 'h264_nvenc',
    clip: { ok: true, seconds: 1.02, sampleS: 5, width: 1920, height: 1080, audio: true, chemin: 'C:\\x' },
    inconnu: true
  }
  assert.deepEqual(cleanTest(good, '9.0.2'), {
    at: 1_794_000_000_000,
    version: '9.0.2',
    sampleS: 5,
    encoders: [
      { id: 'h264_nvenc', ok: true, seconds: 0.84 },
      { id: 'h264_amf', ok: false, error: 'Cannot load amfrt64.dll from C:\\Users\\…\\x' }
    ],
    best: 'h264_nvenc',
    clip: { ok: true, seconds: 1.02, sampleS: 5, width: 1920, height: 1080, audio: true }
  })
  assert.equal(cleanTest(good, '9.1'), null)
  assert.equal(cleanTest(good, ''), null)
  assert.equal(cleanTest(null, '9.0.2'), null)
  assert.equal(cleanTest({ ...good, encoders: [] }, '9.0.2'), null)
  assert.equal(cleanTest({ ...good, at: 'hier' }, '9.0.2'), null)
  // Un « meilleur » qui n'a pas marché n'est pas gardé ; un clip sans mesure non plus.
  assert.equal(cleanTest({ ...good, best: 'h264_amf' }, '9.0.2')?.best, null)
  assert.equal(cleanTest({ ...good, clip: { ok: true, sampleS: 5, width: 1920, height: 1080 } }, '9.0.2')?.clip, undefined)
  assert.deepEqual(cleanTest({ ...good, clip: { ok: false, sampleS: 3, width: 2560, height: 1440, error: 'Invalid data' } }, '9.0.2')?.clip, { ok: false, sampleS: 3, width: 2560, height: 1440, error: 'Invalid data' })
  // Un essai gardé par la bêta 32 (sans « audio ») se relit toujours ; un « audio » qui n'est pas un oui ou un non est ignoré.
  assert.deepEqual(cleanTest({ ...good, clip: { ok: true, seconds: 2, sampleS: 5, width: 1920, height: 1080, audio: 'oui' } }, '9.0.2')?.clip, { ok: true, seconds: 2, sampleS: 5, width: 1920, height: 1080 })
})

test('le texte à copier dit tout l’essai, en clair', () => {
  const at = new Date(2026, 10, 9, 23, 52).getTime()
  const test = {
    at,
    version: '9.0.2',
    sampleS: 5,
    encoders: [
      { id: 'h264_nvenc', ok: true, seconds: 0.84 },
      { id: 'h264_amf', ok: false, error: 'Cannot load amfrt64.dll' },
      { id: 'libopenh264', ok: true, seconds: 3.951 }
    ],
    best: 'h264_nvenc',
    clip: { ok: true, seconds: 3.1, sampleS: 20, width: 2560, height: 1440, audio: true }
  }
  const ctx = { app: '0.5.3-beta.33', build: 'n9.0.2-39-g7adfbe40dc', system: 'Windows 10.0.26100 · Processeur d’essai · 16 cœurs logiques · 32 Go' }
  assert.deepEqual(reportText(test, ctx, { at, shots: 12, durationS: 50.4, seconds: 14.24, encoder: 'h264_nvenc' }).split('\n'), [
    'Player X V3 Test 0.5.3-beta.33 : essai du moteur vidéo du 09/11/2026 à 23 h 52',
    'Moteur : FFmpeg 9.0.2 (n9.0.2-39-g7adfbe40dc)',
    'PC : Windows 10.0.26100 · Processeur d’essai · 16 cœurs logiques · 32 Go',
    'Mire d\'essai : 1920 × 1080, 60 images/s, 5 s',
    // La mire dit si l'encodeur marche, pas sa vitesse : plus de « ×6,0 » trompeur.
    '- h264_nvenc : marche (0,84 s)',
    '- h264_amf : non (Cannot load amfrt64.dll)',
    '- libopenh264 : marche (3,95 s)',
    'Choisi : h264_nvenc',
    'Dernier clip (2560 × 1440, avec le son) : 20,0 s de film en 3,10 s (×6,5)',
    'Dernier film : 12 plans, 50,4 s, fabriqué en 14,2 s avec h264_nvenc (×3,5)'
  ])
  // Sans film, la ligne n'y est pas ; un clip sans son, un clip non lu, pas de clip.
  assert.ok(!reportText(test, ctx).includes('Dernier film'))
  assert.ok(!reportText(test, ctx, null).includes('Dernier film'))
  assert.match(reportText({ ...test, clip: { ...test.clip, audio: false } }, ctx), /\nDernier clip \(2560 × 1440, sans le son\) : 20,0 s de film en 3,10 s \(×6,5\)$/)
  assert.match(reportText({ ...test, clip: { ok: false, sampleS: 20, width: 1920, height: 1080, error: 'plan : Invalid data' } }, ctx), /\nDernier clip \(1920 × 1080\) : non \(plan : Invalid data\)$/)
  assert.match(reportText({ ...test, clip: undefined }, ctx, { at, shots: 1, durationS: 4.2, seconds: 2, encoder: 'h264_mf' }), /\nDernier clip : aucun clip sur ce PC\nDernier film : 1 plan, 4,2 s, fabriqué en 2,0 s avec h264_mf \(×2,1\)$/)
  const none = reportText({ at, version: '9.0.2', sampleS: 5, encoders: [{ id: 'h264_mf', ok: false }], best: null }, { app: 'x', build: 'y', system: 'z' })
  assert.match(none, /- h264_mf : non\nChoisi : aucun\nDernier clip : aucun clip sur ce PC$/)
})

test('la ligne des cartes graphiques : marque et modèle, sans les pilotes logiciels de Windows', () => {
  // Ce que voit Electron sur un PC à GeForce RTX 4070 Ti (relevé du 10/11/2026) : la carte, et le pilote de secours de Microsoft.
  assert.equal(gpuText([{ vendorId: 0x10de, deviceId: 0x2782 }, { vendorId: 0x1414, deviceId: 0x008c }]), 'NVIDIA 2782')
  assert.equal(gpuText([{ vendorId: 0x8086, deviceId: 0xa780 }, { vendorId: 0x1002, deviceId: 0x744c }, { vendorId: 0x1002, deviceId: 0x744c }]), 'Intel a780, AMD 744c')
  assert.equal(gpuText([{ vendorId: 0x5333, deviceId: 0x12 }]), '5333 0012')
  assert.equal(gpuText([{ vendorId: 0x1414, deviceId: 0x008c }]), 'aucune reconnue')
  assert.equal(gpuText([{ vendorId: 0, deviceId: 1 }, { vendorId: 'x' }, {}]), 'aucune reconnue')
  assert.equal(gpuText([]), 'aucune reconnue')
})

test('le dernier film relu dans la base : structure vérifiée', () => {
  const good = { at: 1_794_000_000_000, shots: 12, durationS: 50.4, seconds: 14.2, encoder: 'h264_nvenc', chemin: 'C:\\x' }
  assert.deepEqual(cleanLastFilm(good), { at: 1_794_000_000_000, shots: 12, durationS: 50.4, seconds: 14.2, encoder: 'h264_nvenc' })
  for (const bad of [null, 'x', {}, { ...good, shots: 0 }, { ...good, seconds: 0 }, { ...good, durationS: 'long' }, { ...good, encoder: 'h264 nvenc -f null' }, { ...good, at: -1 }]) assert.equal(cleanLastFilm(bad), null)
})

test('un film raté se raconte en clair, sans chemin', () => {
  const at = new Date(2026, 10, 10, 21, 5).getTime()
  const text = filmReportText(
    { at, shots: 12, durationS: 50.4, width: 1920, height: 1080, fps: 60 },
    [
      { encoder: 'h264_nvenc', step: 'plan 1 sur 12', error: 'OpenEncodeSessionEx failed: out of memory (10)' },
      { encoder: 'h264_nvenc', step: 'plan 2 sur 12', error: 'C:\\Users\\Jean Dupont\\Videos\\x.mp4: Invalid data found when processing input' },
      { encoder: 'h264_mf', step: 'assemblage', error: '' }
    ],
    { app: '0.5.3-beta.33', version: '9.0.2', build: 'n9.0.2-39-g7adfbe40dc', system: 'Windows 10.0.26200 · Processeur d’essai · 24 cœurs logiques · 32 Go' }
  )
  assert.deepEqual(text.split('\n'), [
    'Player X V3 Test 0.5.3-beta.33 : film raté le 10/11/2026 à 21 h 05',
    'Moteur : FFmpeg 9.0.2 (n9.0.2-39-g7adfbe40dc)',
    'PC : Windows 10.0.26200 · Processeur d’essai · 24 cœurs logiques · 32 Go',
    'Film : 12 plans, 50,4 s, 1920 × 1080 à 60 images/s',
    '- h264_nvenc, plan 1 sur 12 : OpenEncodeSessionEx failed: out of memory (10)',
    '- h264_nvenc, plan 2 sur 12 : C:\\Users\\…\\Videos\\x.mp4: Invalid data found when processing input',
    '- h264_mf, assemblage : pas de message'
  ])
  assert.ok(!text.includes('Dupont'))
  // Un seul plan, aucun détail, et jamais plus de douze essais.
  const one = filmReportText({ at, shots: 1, durationS: 4.2, width: 1920, height: 1080, fps: 60 }, [], { app: 'a', version: 'v', build: 'b', system: 's' })
  assert.match(one, /Film : 1 plan, 4,2 s, .*\n- aucun détail$/)
  const many = filmReportText({ at, shots: 3, durationS: 9, width: 1920, height: 1080, fps: 60 }, Array.from({ length: 20 }, (_, i) => ({ encoder: 'h264_mf', step: `plan ${i + 1} sur 20`, error: 'x' })), { app: 'a', version: 'v', build: 'b', system: 's' })
  assert.equal(many.split('\n').length, 16)
})
