// Tests des commandes du film (npm run test:edit) : un plan, la liste d'assemblage, l'assemblage, la vignette, l'avancement.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { frameStep, joinArgs, joinList, percentOf, progressReader, readProgress, shotArgs, shotFrames, thumbArgs } from './editCompile.ts'

const HD = { width: 1920, height: 1080, fps: 60 }
const A = { file: 'D:\\Vidéos\\Player X V3 Test\\CS2 [1] ace;x.mp4', hasAudio: true }
const MUET = { file: '/clips/sans son.mp4', hasAudio: false }
const graph = (args: string[]): string[] => args[args.indexOf('-filter_complex') + 1].split(';')

test('la durée d’un plan tombe juste : en images, en son et en microsecondes', () => {
  // 60 images/s : pas de 3 images, soit 50 ms.
  assert.equal(frameStep(60), 3)
  assert.equal(shotFrames(4.2, 60), 252)
  // 1,234 s : 74,04 images, ramenées à 75 (1,25 s).
  assert.equal(shotFrames(1.234, 60), 75)
  assert.equal(shotFrames(0.001, 60), 3)
  // D'autres cadences gardent des durées exactes.
  assert.deepEqual([24, 25, 30, 50].map(frameStep), [6, 5, 3, 5])
  for (const fps of [24, 25, 30, 50, 60]) {
    for (const d of [0.04, 1, 1.234, 4.2, 9.99]) {
      const n = shotFrames(d, fps)
      assert.equal(n % frameStep(fps), 0)
      // Microsecondes entières, et un nombre entier d'échantillons à 48 kHz.
      assert.ok(Number.isInteger(Math.round((n / fps) * 1e6)) && Math.abs((n / fps) * 1e6 - Math.round((n / fps) * 1e6)) < 1e-6, `${fps} ${d}`)
      assert.equal((n * 48000) % fps, 0)
    }
  }
})

test('la commande d’un plan : lu à sa seconde, coupé à l’image et à l’échantillon près', () => {
  const c = shotArgs({ inS: 17, outS: 21.2 }, A, HD, 'h264_nvenc', 'C:\\Temp\\px-film-ab\\p000.mov')
  assert.equal(c.frames, 252)
  assert.equal(c.durationS, 4.2)
  assert.deepEqual(c.args.slice(0, 5), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'])
  // Une seule lecture : le clip, à partir de 17 s, une demi-seconde de marge.
  assert.deepEqual(c.args.slice(5, c.args.indexOf('-filter_complex')), ['-protocol_whitelist', 'file', '-ss', '17', '-t', '4.7', '-i', 'file:D:\\Vidéos\\Player X V3 Test\\CS2 [1] ace;x.mp4'])
  const g = graph(c.args)
  assert.equal(g.length, 2)
  assert.equal(g[0], '[0:v]fps=60:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=252,scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=nv12[v]')
  // 252 images à 60 images/s : 201 600 échantillons à 48 kHz.
  assert.equal(g[1], '[0:a]aresample=48000:async=1:first_pts=0,aformat=sample_fmts=s16:channel_layouts=stereo,atrim=end_sample=201600,apad=whole_len=201600,asetpts=round(N/SR/TB)[a]')
  // Aucun chemin dans le graphe : rien à échapper, quel que soit le nom du clip.
  assert.ok(!g.join(';').includes('Vidéos') && !g.join(';').includes('.mp4') && !g.join(';').includes('.mov'))
  assert.deepEqual(c.args.slice(c.args.indexOf('-map')), ['-map', '[v]', '-map', '[a]', '-c:v', 'h264_nvenc', '-b:v', '16M', '-g', '120', '-bf', '0', '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-nostats', '-f', 'mov', 'file:C:\\Temp\\px-film-ab\\p000.mov'])
})

test('un clip sans son reçoit du silence ; un encodeur sans carte reçoit du YUV 4:2:0', () => {
  const c = shotArgs({ inS: 0.4, outS: 2.9 }, MUET, HD, 'libopenh264', '/t/p001.mov')
  assert.equal(c.frames, 150)
  assert.deepEqual(c.args.slice(5, c.args.indexOf('-filter_complex')), ['-protocol_whitelist', 'file', '-ss', '0.4', '-t', '3', '-i', 'file:/clips/sans son.mp4', '-f', 'lavfi', '-t', '2.5', '-i', 'anullsrc=r=48000:cl=stereo'])
  const g = graph(c.args)
  assert.match(g[0], /^\[0:v\]fps=60:start_time=0,.*trim=end_frame=150,.*format=yuv420p\[v\]$/)
  // Le son vient de la seconde lecture, pas du clip.
  assert.match(g[1], /^\[1:a\]aresample=48000:.*atrim=end_sample=120000,apad=whole_len=120000,asetpts=round\(N\/SR\/TB\)\[a\]$/)
})

test('les bornes d’un plan : la durée est remise sur le pas, le début reste celui demandé', () => {
  const c = shotArgs({ inS: 2.001, outS: 3.235 }, A, HD, 'h264_mf', '/t/p.mov')
  assert.equal(c.frames, 75)
  assert.equal(c.durationS, 1.25)
  assert.ok(c.args.join(' ').includes('-ss 2.001 -t 1.75 -i '))
  assert.ok(c.args.join(' ').includes('trim=end_frame=75,'))
  assert.ok(c.args.join(' ').includes('atrim=end_sample=60000,apad=whole_len=60000,'))
})

test('ce qui est refusé : encodeur, bornes, format', () => {
  const ok = { inS: 0, outS: 1 }
  assert.throws(() => shotArgs(ok, A, HD, 'h264 nvenc -f null', '/f.mov'), /Encodeur inconnu/)
  for (const bad of [{ inS: 2, outS: 1 }, { inS: -1, outS: 1 }, { inS: 0, outS: Number.NaN }, { inS: 'a', outS: 1 }, { inS: 1, outS: 1 }]) {
    assert.throws(() => shotArgs(bad as { inS: number; outS: number }, A, HD, 'h264_nvenc', '/f.mov'), /bornes/)
  }
  for (const bad of [{ width: 0 }, { height: 99999 }, { fps: 59.94 }, { fps: 1000 }, { width: '1920' }, { width: 1919 }]) {
    assert.throws(() => shotArgs(ok, A, { ...HD, ...bad } as typeof HD, 'h264_nvenc', '/f.mov'), /Format de film refusé/)
  }
})

test('la liste d’assemblage : des noms seuls, chacun avec sa durée exacte', () => {
  assert.equal(joinList([{ name: 'p000.mov', durationS: 4.2 }, { name: 'p001.mov', durationS: 2.5 }, { name: 'p002.mov', durationS: 0.05 }]), 'ffconcat version 1.0\nfile p000.mov\nduration 4.200000\nfile p001.mov\nduration 2.500000\nfile p002.mov\nduration 0.050000\n')
  // Rien d'autre qu'un nom simple : ni chemin, ni espace, ni apostrophe, ni retour à la ligne, ni autre directive.
  for (const name of ['../p000.mov', 'C:\\x\\p000.mov', '/t/p000.mov', 'p 0.mov', "p'0.mov", 'p000.mov\nfile /etc/passwd', 'p000.mp4', '.mov', 'P000.mov', 'file:p000.mov']) {
    assert.throws(() => joinList([{ name, durationS: 1 }]), /refusé/, name)
  }
  for (const durationS of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => joinList([{ name: 'p000.mov', durationS }]), /refusé/)
  assert.throws(() => joinList([]), /vide/)
})

test('l’assemblage : l’image recopiée, le son encodé d’une traite, l’index au début', () => {
  assert.deepEqual(joinArgs('liste.txt', 'D:\\Vidéos\\Player X V3 Test\\Films\\Film Mirage.mp4.part'), [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-protocol_whitelist', 'file', '-f', 'concat', '-i', 'liste.txt',
    '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats',
    '-f', 'mp4', 'file:D:\\Vidéos\\Player X V3 Test\\Films\\Film Mirage.mp4.part'
  ])
  for (const name of ['../liste.txt', 'C:\\liste.txt', 'liste', 'li ste.txt', '-i.txt']) assert.throws(() => joinArgs(name, '/f.mp4'), /refusée/, name)
})

test('la vignette : une image, en JPEG de 640 px', () => {
  assert.deepEqual(thumbArgs('/films/f.mp4', '/t/x.jpg', 2.5), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file', '-ss', '2.5', '-i', 'file:/films/f.mp4', '-frames:v', '1', '-vf', 'scale=640:-2', '-pix_fmt', 'yuvj420p', '-q:v', '4', '-f', 'image2', '-update', '1', 'file:/t/x.jpg'])
  assert.equal(thumbArgs('/f.mp4', '/x.jpg', -3)[8], '0')
})

test('l’avancement : la dernière valeur écrite par le moteur, et la fin', () => {
  // Morceau écrit à la main, avec les clés que ffmpeg écrit pour « -progress pipe:1 » (fftools/ffmpeg.c, version 9.0.2). La
  // lecture d'un vrai passage est vérifiée par le scénario tools/essais-clips/t14-film.cjs.
  const chunk = 'frame=120\nfps=58.2\nbitrate=15800.1kbits/s\nout_time_us=2000000\nout_time_ms=2000000\nout_time=00:00:02.000000\nspeed=0.97x\nprogress=continue\nframe=240\nout_time_us=4000000\nout_time_ms=4000000\nprogress=continue\n'
  assert.deepEqual(readProgress(chunk), { seconds: 4, end: false })
  assert.deepEqual(readProgress('out_time_us=14096625\r\nprogress=end\r\n'), { seconds: 14.096625, end: true })
  assert.deepEqual(readProgress('progress=end\n'), { seconds: 0, end: true })
  assert.equal(readProgress('frame=1\nfps=0.0\n'), null)
  assert.equal(readProgress('out_time_us=N/A\n'), null)
})

test('l’avancement au fil de l’eau : une ligne coupée en deux attend sa suite', () => {
  const read = progressReader()
  assert.deepEqual(read('frame=10\nout_time_us=1500'), { seconds: 0, end: false })
  // « 1500 » n'était que le début de « 1500000 » : rien n'est lu tant que la ligne n'est pas finie.
  assert.deepEqual(read('000\nprogress=cont'), { seconds: 1.5, end: false })
  assert.deepEqual(read('inue\nout_time_us=2000000\nprogress=continue\n'), { seconds: 2, end: false })
  // Une valeur plus petite (reprise du moteur) ne fait pas reculer l'avancement ; la fin sans temps garde le dernier temps.
  assert.deepEqual(read('out_time_us=1000000\n'), { seconds: 2, end: false })
  assert.deepEqual(read('progress=end\n'), { seconds: 2, end: true })
  assert.deepEqual(read('out_time_us=9000000\n'), { seconds: 9, end: true })
  // Chaque lecture a sa mémoire.
  assert.deepEqual(progressReader()('progress=continue\n'), { seconds: 0, end: false })
  // Du bruit sans fin de ligne ne s'accumule pas sans limite, et ne casse rien.
  const noisy = progressReader()
  for (let i = 0; i < 50; i++) noisy('x'.repeat(1000))
  assert.deepEqual(noisy('\nout_time_us=3000000\n'), { seconds: 3, end: false })
})

test('le pourcentage : les plans, puis l’assemblage ; jamais 100 avant que le fichier soit rangé', () => {
  assert.equal(percentOf(0, 20), 0)
  assert.equal(percentOf(10, 20), 47)
  assert.equal(percentOf(20, 20), 94)
  assert.equal(percentOf(20, 20, 10), 97)
  assert.equal(percentOf(20, 20, 20), 99)
  assert.equal(percentOf(999, 20, 999), 99)
  assert.equal(percentOf(3, 0), 0)
  assert.equal(percentOf(-5, 20), 0)
  // Il ne recule jamais quand les plans avancent.
  let last = -1
  for (let s = 0; s <= 20; s += 0.25) {
    const p = percentOf(s, 20)
    assert.ok(p >= last)
    last = p
  }
})

test('un ralenti : la moitié de la vitesse, image et son, deux fois plus long dans le film', () => {
  // 0,5 s du clip à vitesse 0,5 : 1 s de film, 60 images.
  const c = shotArgs({ inS: 10, outS: 10.5 }, A, HD, 'h264_nvenc', '/t/p.mov', { speed: 0.5 })
  assert.equal(c.frames, 60)
  assert.equal(c.durationS, 1)
  // La lecture couvre ce qu'il faut du clip (0,5 s) plus la marge.
  assert.deepEqual(c.args.slice(5, 11), ['-protocol_whitelist', 'file', '-ss', '10', '-t', '1'])
  const g = graph(c.args)
  assert.ok(g[0].startsWith('[0:v]setpts=PTS/0.5,fps=60:start_time=0,'))
  assert.ok(g[1].includes('first_pts=0,atempo=0.5,aformat='))
  assert.throws(() => shotArgs({ inS: 1, outS: 2 }, A, HD, 'h264_nvenc', '/t/p.mov', { speed: 0.3 }), /Vitesse refusée/)
})

test('le nombre d’images peut venir de la ligne de temps du film (multiple du pas)', () => {
  const c = shotArgs({ inS: 1, outS: 3 }, A, HD, 'h264_nvenc', '/t/p.mov', { frames: 123 })
  assert.equal(c.frames, 123)
  assert.throws(() => shotArgs({ inS: 1, outS: 3 }, A, HD, 'h264_nvenc', '/t/p.mov', { frames: 124 }), /durée refusée/)
  assert.throws(() => shotArgs({ inS: 1, outS: 3 }, A, HD, 'h264_nvenc', '/t/p.mov', { frames: 0 }), /durée refusée/)
})

test('l’assemblage avec une musique : temps choisi, fondu de fin, volumes, limiteur', () => {
  const a = joinArgs('liste.txt', '/f.mp4', { musicFile: 'C:\\Musique\\a;b [c].mp3', startS: 12.345, durationS: 30, music: 0.9, game: 0.5 })
  const i = a.indexOf('-filter_complex')
  // La musique est une seconde lecture, limitée aux fichiers, à partir de son temps.
  assert.deepEqual(a.slice(a.indexOf('liste.txt') + 1, a.indexOf('-map')), ['-protocol_whitelist', 'file', '-ss', '12.345', '-t', '31', '-i', 'file:C:\\Musique\\a;b [c].mp3'])
  assert.equal(a[i + 1], '[0:a]volume=0.5[g];[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=end=30,asetpts=PTS-STARTPTS,afade=t=out:st=28:d=2,volume=0.9[m];[g][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]')
  assert.ok(!a[i + 1].includes('Musique'))
  assert.deepEqual(a.slice(a.indexOf('-map'), a.indexOf('-map') + 2), ['-map', '0:v:0'])
  assert.deepEqual(a.slice(i + 2, i + 6), ['-map', '[a]', '-c:v', 'copy'])
  assert.throws(() => joinArgs('liste.txt', '/f.mp4', { musicFile: '/m.mp3', startS: 0, durationS: 10, music: 2, game: 0.5 }), /Volume refusé/)
  assert.throws(() => joinArgs('liste.txt', '/f.mp4', { musicFile: '/m.mp3', startS: -1, durationS: 10, music: 1, game: 1 }), /Musique refusée/)
  // Sans musique : la commande de la bêta 33, inchangée.
  assert.ok(!joinArgs('liste.txt', '/f.mp4').includes('-filter_complex'))
})

// @ts-ignore TS5097
import { filmPieces } from './editCompile.ts'
// @ts-ignore TS5097
import { timeline as tl, unitOf as uo } from '../../shared/editShots.ts'

test('les morceaux d’un projet : images arrondies sur la ligne du film, aucun écart qui s’additionne', () => {
  const u = uo(128)
  const shots = Array.from({ length: 30 }, (_, i) => ({ clipId: 'c' + (i % 3), anchorS: 12, lead: 3 + (i % 4), tail: 2 + (i % 3), slow: i % 2 === 1 }))
  const pieces = filmPieces(shots, u, 60)
  // 15 plans au ralenti (3 morceaux), 15 sans (1 morceau).
  assert.equal(pieces.length, 15 * 3 + 15)
  let frames = 0
  const { anchors, totalS } = tl(shots, u)
  for (const p of pieces) { assert.equal(p.frames % 3, 0); frames += p.frames }
  // La fin du film à moins d'un demi-pas (25 ms) de la vraie durée, après 30 plans.
  assert.ok(Math.abs(frames / 60 - totalS) <= 0.025 + 1e-9, `${frames / 60} / ${totalS}`)
  // Le kill du dernier plan (au ralenti) tombe à moins de 25 ms de son temps.
  const before = pieces.slice(0, -2).reduce((n, p) => n + p.frames, 0)
  const last = pieces[pieces.length - 2]
  assert.equal(last.speed, 0.5)
  assert.ok(Math.abs((before + last.frames / 2) / 60 - anchors[anchors.length - 1]) <= 0.025 + 1e-9)
})
