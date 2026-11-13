// L'essai « capture comme OBS » (bêta 38), sans Electron ni fichier : les commandes du moteur et la lecture de son avancement.
// Testé par captureTestArgs.test.ts.
//
// L'image reste dans la carte graphique du début à la fin : capture Windows (gfxcapture = Windows.Graphics.Capture,
// ddagrab = copie de bureau DXGI), réduction et passage en NV12 par la carte (scale_d3d11), encodage par la puce vidéo
// (h264_nvenc, h264_amf). Rien ne repasse par le processeur, contrairement à la capture de Chrome.
// Options relevées dans le ffmpeg.exe livré (FFmpeg n9.0.2) : gfxcapture window_exe, monitor_idx, max_framerate,
// capture_cursor ; ddagrab output_idx, framerate, dup_frames, draw_mouse ; scale_d3d11 width, height, format.

export type CaptureTrial =
  | { id: 'fenetre'; label: string; exeRegex: string }
  | { id: 'ecran-wgc'; label: string; monitor: number }
  | { id: 'ecran-dda'; label: string; monitor: number }

/** Durée de chaque essai, en secondes. */
export const TRIAL_S = 10
/** Encodeurs essayés : ceux qui prennent directement une image de la carte graphique. */
export const TRIAL_ENCODERS = ['h264_nvenc', 'h264_amf'] as const

/**
 * Les manières d'essayer, de la meilleure à la plus sûre.
 * - gpu : tout dans la carte graphique, avec un périphérique D3D11 créé par ffmpeg (exemple de la documentation de ddagrab) ;
 * - gpu-auto : pareil, sans imposer de périphérique (la source garde le sien : utile si le PC a deux puces graphiques) ;
 * - copie : l'image passe par le processeur juste avant l'encodeur (le chemin des films, qui marche déjà chez lui).
 * Bêta 40 : plus de scale_d3d11. Sur le PC de Breezydev (bêta 39), les 18 tentatives ont échoué dans la chaîne d'image,
 * avant l'ouverture de l'encodeur, y compris avec ddagrab et avec la copie : la seule pièce commune était scale_d3d11.
 * L'image garde donc la taille de l'écran (BGRA, que NVENC et AMF prennent directement).
 */
export type TrialMode = 'gpu' | 'gpu-auto' | 'copie'
export const TRIAL_ATTEMPTS: ReadonlyArray<{ encoder: (typeof TRIAL_ENCODERS)[number]; mode: TrialMode }> = [
  { encoder: 'h264_nvenc', mode: 'gpu' },
  { encoder: 'h264_nvenc', mode: 'gpu-auto' },
  { encoder: 'h264_amf', mode: 'gpu' },
  { encoder: 'h264_amf', mode: 'gpu-auto' },
  { encoder: 'h264_nvenc', mode: 'copie' },
  { encoder: 'h264_amf', mode: 'copie' }
]

/** Le programme du jeu, en expression régulière pour gfxcapture (sans barre oblique inverse : rien à échapper). */
export function gameExeRegex(game: { id: string; name: string } | null, cs2Id: string): string | null {
  if (!game) return null
  if (game.id === cs2Id) return '(?i)^cs2[.]exe$'
  if (/battlefield\s*6|\bbf6\b/i.test(game.name)) return '(?i)^bf6.*[.]exe$'
  return null
}

/** Les essais : la fenêtre du jeu (si on la connaît), puis l'écran par les deux méthodes de Windows. */
export function trialsFor(exeRegex: string | null): CaptureTrial[] {
  return [
    ...(exeRegex ? [{ id: 'fenetre' as const, label: 'Fenêtre du jeu', exeRegex }] : []),
    { id: 'ecran-wgc' as const, label: 'Écran, capture Windows 10/11', monitor: 0 },
    { id: 'ecran-dda' as const, label: 'Écran, copie de bureau', monitor: 0 }
  ]
}

const SAFE_REGEX = /^[\w()?^$.[\]*|+ -]{1,80}$/

/** La commande d'un essai, à la taille de l'écran (q.fps et q.videoBps servent ; la taille demandée est ignorée). */
export function trialArgs(trial: CaptureTrial, q: { maxWidth: number; maxHeight: number; fps: number; videoBps: number }, encoder: string, outFile: string, mode: TrialMode = 'gpu'): string[] {
  if (!(TRIAL_ENCODERS as readonly string[]).includes(encoder)) throw new Error('Encodeur refusé.')
  const fps = Math.min(120, Math.max(1, Math.round(q.fps)))
  let src: string
  if (trial.id === 'fenetre') {
    if (!SAFE_REGEX.test(trial.exeRegex) || /['\\:,;]/.test(trial.exeRegex)) throw new Error('Programme refusé.')
    src = `gfxcapture=window_exe='${trial.exeRegex}':max_framerate=${fps}:capture_cursor=0`
  } else if (trial.id === 'ecran-wgc') src = `gfxcapture=monitor_idx=${trial.monitor | 0}:max_framerate=${fps}:capture_cursor=0`
  // dup_frames=0 : seulement les images nouvelles (sinon ddagrab répète la dernière et le compte serait faux).
  else src = `ddagrab=output_idx=${trial.monitor | 0}:framerate=${fps}:dup_frames=0:draw_mouse=0`
  const bps = Math.round(q.videoBps)
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1',
    ...(mode === 'gpu' ? ['-init_hw_device', 'd3d11va=px', '-filter_hw_device', 'px'] : []),
    '-filter_complex', `${src}${mode === 'copie' ? ',hwdownload,format=bgra' : ''}[v]`,
    '-map', '[v]', '-t', String(TRIAL_S),
    // Les instants réels de la capture : une image non reçue n'est pas inventée.
    '-fps_mode', 'passthrough',
    '-c:v', encoder,
    ...(encoder === 'h264_nvenc' ? ['-preset', 'p4', '-rc', 'vbr'] : ['-rc', 'vbr_peak']),
    '-b:v', String(bps), '-maxrate', String(Math.round(bps * 1.5)), '-bufsize', String(bps * 2),
    '-g', String(fps * 2),
    `file:${outFile}`
  ]
}

/** Images comptées par le moteur (dernier `frame=` de -progress) et images par seconde sur la durée de l'essai. */
export function readProgress(out: string): { frames: number; fps: number } | null {
  const all = [...out.matchAll(/^frame=(\d+)\s*$/gm)]
  if (!all.length) return null
  const frames = Number(all[all.length - 1][1])
  return { frames, fps: Math.round((frames / TRIAL_S) * 10) / 10 }
}
