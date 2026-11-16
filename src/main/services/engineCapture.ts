// La capture des clips par le moteur vidéo (bêta 42), sans Electron ni fichier : les commandes d'enregistrement, l'ordre des
// essais, la lecture de l'avancement et la fusion de l'image du moteur avec le son lu par la page. Testé par engineCapture.test.ts.
//
// Mesuré sur le PC de Breezydev (bêta 40, CS2 sans limite d'images, 2560 × 1440) : fenêtre du jeu 57,8 et 58,1 images/s,
// écran (Windows.Graphics.Capture) 56,2 et 58, copie de bureau 49,7 et 56,7 ; la capture de Chrome au même moment : 15 à 53.
// L'image reste dans la carte graphique (gfxcapture, ddagrab) et va droit à l'encodeur (NVENC, AMF). scale_d3d11 n'est pas
// utilisé : il cassait la chaîne chez lui. Le flux sort en MP4 fragmenté sur la sortie standard, comme celui de MediaRecorder,
// et passe dans le même tampon (fmp4.ts, clips.ts).

import { TRIAL_ATTEMPTS, type CaptureTrial, type TrialMode } from './captureTestArgs'

export type EngineMethod = CaptureTrial | { id: 'x11'; label: string; display: string; width: number; height: number }

export interface EngineAttempt {
  method: EngineMethod
  encoder: string
  mode: TrialMode
}

/**
 * Ordre des essais : la fenêtre du jeu (la plus fluide sans limite d'images, et elle ne filme que le jeu), puis l'écran par
 * Windows.Graphics.Capture, puis la copie de bureau ; pour chacune, NVENC puis AMF, l'image dans la carte puis copiée.
 */
export function engineAttempts(exeRegex: string | null, monitor: number): EngineAttempt[] {
  const methods: EngineMethod[] = [
    ...(exeRegex ? [{ id: 'fenetre' as const, label: 'fenêtre du jeu', exeRegex }] : []),
    { id: 'ecran-wgc' as const, label: 'écran, capture Windows 10/11', monitor },
    { id: 'ecran-dda' as const, label: 'écran, copie de bureau', monitor }
  ]
  return methods.flatMap((method) => TRIAL_ATTEMPTS.map((a) => ({ method, encoder: a.encoder, mode: a.mode })))
}

const SAFE_REGEX = /^[\w()?^$.[\]*|+ -]{1,80}$/
const ENCODERS = ['h264_nvenc', 'h264_amf', 'libx264']

/** Une image clé toutes les 2 s (le tampon coupe un clip sur une image clé), un fragment toutes les 0,5 s au plus. */
export const KEY_S = 2
export const FRAG_US = 500_000

/**
 * La commande d'enregistrement : capture, encodage au débit demandé, MP4 fragmenté sur la sortie standard. L'avancement
 * (images, images/s) part sur la sortie d'erreur toutes les 10 s. `x11` et `libx264` : essais sous Linux seulement.
 */
export function recordArgs(a: EngineAttempt, q: { fps: number; videoBps: number }): string[] {
  if (!ENCODERS.includes(a.encoder)) throw new Error('Encodeur refusé.')
  const fps = Math.min(120, Math.max(1, Math.round(q.fps)))
  const m = a.method
  let input: string[]
  if (m.id === 'x11') {
    if (!/^:\d{1,3}(\.\d)?$/.test(m.display)) throw new Error('Écran refusé.')
    input = ['-f', 'x11grab', '-framerate', String(fps), '-video_size', `${m.width | 0}x${m.height | 0}`, '-i', m.display]
  } else {
    let src: string
    if (m.id === 'fenetre') {
      if (!SAFE_REGEX.test(m.exeRegex) || /['\\:,;]/.test(m.exeRegex)) throw new Error('Programme refusé.')
      src = `gfxcapture=window_exe='${m.exeRegex}':max_framerate=${fps}:capture_cursor=0`
    } else if (m.id === 'ecran-wgc') src = `gfxcapture=monitor_idx=${m.monitor | 0}:max_framerate=${fps}:capture_cursor=0`
    else src = `ddagrab=output_idx=${m.monitor | 0}:framerate=${fps}:dup_frames=0:draw_mouse=0`
    input = [...(a.mode === 'gpu' ? ['-init_hw_device', 'd3d11va=px', '-filter_hw_device', 'px'] : []), '-filter_complex', `${src}${a.mode === 'copie' ? ',hwdownload,format=bgra' : ''}[v]`, '-map', '[v]']
  }
  const bps = Math.round(q.videoBps)
  const rate =
    a.encoder === 'h264_nvenc'
      ? ['-preset', 'p4', '-tune', 'll', '-rc', 'cbr', '-b:v', String(bps), '-maxrate', String(bps), '-bufsize', String(bps)]
      : a.encoder === 'h264_amf'
        ? ['-usage', 'lowlatency', '-rc', 'cbr', '-b:v', String(bps), '-maxrate', String(bps), '-bufsize', String(bps)]
        : ['-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-b:v', String(bps), '-maxrate', String(bps), '-bufsize', String(bps)]
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'warning', '-stats_period', '10', '-progress', 'pipe:2',
    ...input,
    // Les instants réels de la capture : une image non reçue n'est pas inventée.
    '-fps_mode', 'passthrough',
    '-c:v', a.encoder, ...rate,
    // Image clé à heure fixe (toutes les 2 s), quelle que soit la cadence reçue.
    '-g', String(fps * KEY_S), '-force_key_frames', `expr:gte(t,n_forced*${KEY_S})`,
    '-an',
    '-f', 'mp4', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', String(FRAG_US), '-flush_packets', '1',
    'pipe:1'
  ]
}

/** Le dernier bloc d'avancement (-progress) : images et images/s. */
export function readEngineProgress(text: string): { frames: number; fps: number } | null {
  const f = [...text.matchAll(/^frame=(\d+)\s*$/gm)]
  const r = [...text.matchAll(/^fps=([\d.]+)\s*$/gm)]
  if (!f.length) return null
  return { frames: Number(f[f.length - 1][1]), fps: r.length ? Number(r[r.length - 1][1]) : 0 }
}

/**
 * Le son des clips filmés par le moteur : la page lit le son du PC directement (PCM, 16 bits, stéréo, 48 kHz), par morceaux
 * d'environ 85 ms, chacun daté à l'heure du système de son premier échantillon. Bêta 42, premier essai : recoller le son
 * enregistré par MediaRecorder décalait d'environ une seconde (MediaRecorder livre son son en retard, d'un délai variable).
 */
export const PCM_RATE = 48_000
/** Octets par instant : 2 voies × 16 bits. */
export const PCM_FRAME_BYTES = 4
/** Deux morceaux qui se suivent à moins de 10 ms près sont recollés bout à bout (la datation varie de quelques ms). */
const PCM_SNAP_FRAMES = 480

export interface PcmPart {
  /** Heure du système du premier échantillon (ms). */
  wall: number
  data: Buffer
}

/**
 * Le son de [fromWall ; fromWall + durS] : PCM s16 stéréo 48 kHz, du silence là où rien n'a été reçu. `covered` : part de la
 * fenêtre couverte par du son reçu (0 à 1).
 */
export function pcmWindow(parts: PcmPart[], fromWall: number, durS: number): { pcm: Buffer; covered: number } {
  const frames = Math.max(0, Math.round(durS * PCM_RATE))
  const pcm = Buffer.alloc(frames * PCM_FRAME_BYTES)
  let covered = 0
  let prevEnd: number | null = null
  for (const p of parts) {
    const n = Math.floor(p.data.length / PCM_FRAME_BYTES)
    let at = Math.round(((p.wall - fromWall) * PCM_RATE) / 1000)
    if (prevEnd !== null && Math.abs(at - prevEnd) <= PCM_SNAP_FRAMES) at = prevEnd
    prevEnd = at + n
    const a = Math.max(0, at)
    const b = Math.min(frames, at + n)
    if (b <= a) continue
    p.data.copy(pcm, a * PCM_FRAME_BYTES, (a - at) * PCM_FRAME_BYTES, (b - at) * PCM_FRAME_BYTES)
    covered += b - a
  }
  return { pcm, covered: frames ? Math.min(1, covered / frames) : 0 }
}

/** Image du clip (copiée telle quelle) + son PCM encodé en AAC : le clip final. */
export function muxArgs(video: string, pcm: string, out: string, audioBps: number): string[] {
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-i', `file:${video}`,
    '-f', 's16le', '-ar', String(PCM_RATE), '-ac', '2', '-i', `file:${pcm}`,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', String(Math.round(audioBps)),
    '-movflags', '+faststart', '-f', 'mp4', `file:${out}`
  ]
}

/** Méthode lisible, pour le journal. */
export function attemptLabel(a: EngineAttempt): string {
  const how = a.mode === 'gpu' ? 'tout dans la carte graphique' : a.mode === 'gpu-auto' ? 'carte graphique, périphérique de la source' : 'copie avant l’encodeur'
  return `${a.method.label}, ${a.encoder}, ${how}`
}
