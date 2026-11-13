// L'essai « capture comme OBS » (bêta 38), sans Electron ni fichier : les commandes du moteur et la lecture de son avancement.
// Testé par captureTestArgs.test.ts.
//
// L'image reste dans la carte graphique du début à la fin : capture Windows (gfxcapture = Windows.Graphics.Capture,
// ddagrab = copie de bureau DXGI), réduction et passage en NV12 par la carte (scale_d3d11), encodage par la puce vidéo
// (h264_nvenc, h264_amf). Rien ne repasse par le processeur, contrairement à la capture de Chrome.
// Options relevées dans le ffmpeg.exe livré (FFmpeg n9.0.2) : gfxcapture window_exe, monitor_idx, max_framerate,
// capture_cursor ; ddagrab output_idx, framerate, dup_frames, draw_mouse ; scale_d3d11 width, height, format.
//
// Bêta 46 : la réduction intégrée à gfxcapture, à l'essai seulement. Relu dans les sources de la version livrée (commit
// 7adfbe40dc, libavfilter/vsrc_gfxcapture.c et vsrc_gfxcapture_winrt.cpp) : `width` et `height` fixent la taille des images
// produites, `resize_mode=scale_aspect` y réduit la source en gardant son rapport. C'est un calcul fait dans la capture
// elle-même, pas scale_d3d11. ddagrab n'a pas cette option. Jamais lancé avant cette bêta : c'est l'essai qui dira si ça
// marche chez Breezydev. Les vrais clips ne s'en servent pas (engineCapture.ts ne lit pas `scale`).

/** Taille visée d'un essai réduit. */
export interface TrialScale {
  width: number
  height: number
}

export type CaptureTrial =
  | { id: 'fenetre'; label: string; exeRegex: string; scale?: TrialScale }
  | { id: 'ecran-wgc'; label: string; monitor: number; scale?: TrialScale }
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

/**
 * La taille d'une image réduite pour tenir dans 1920 × 1080 : même rapport que l'écran, nombres pairs, jamais d'agrandissement.
 * null : l'écran y tient déjà (rien à réduire), ou sa taille n'est pas connue. Un écran en hauteur se réduit dans 1080 × 1920.
 */
export function reducedSize(width: number, height: number, maxW = 1920, maxH = 1080): TrialScale | null {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return null
  const [bw, bh] = height > width ? [maxH, maxW] : [maxW, maxH]
  const f = Math.min(bw / width, bh / height)
  if (f >= 1) return null
  const even = (x: number): number => Math.max(2, Math.round(x / 2) * 2)
  return { width: even(width * f), height: even(height * f) }
}

/**
 * Les essais : la fenêtre du jeu (si on la connaît), puis l'écran par les deux méthodes de Windows. Bêta 46 : quand l'écran
 * dépasse 1920 × 1080 (`screen` : sa taille en points réels), les deux méthodes gfxcapture sont essayées une seconde fois,
 * réduites, juste après leur essai à la taille de l'écran : les deux chiffres se comparent.
 */
export function trialsFor(exeRegex: string | null, screen?: { width: number; height: number } | null): CaptureTrial[] {
  const scale = screen ? reducedSize(screen.width, screen.height) : null
  const small = scale ? ` à ${scale.width} × ${scale.height}` : ''
  return [
    ...(exeRegex ? [{ id: 'fenetre' as const, label: 'Fenêtre du jeu', exeRegex }] : []),
    ...(exeRegex && scale ? [{ id: 'fenetre' as const, label: `Fenêtre du jeu, réduite${small}`, exeRegex, scale }] : []),
    { id: 'ecran-wgc' as const, label: 'Écran, capture Windows 10/11', monitor: 0 },
    ...(scale ? [{ id: 'ecran-wgc' as const, label: `Écran, capture Windows 10/11, réduit${small}`, monitor: 0, scale }] : []),
    { id: 'ecran-dda' as const, label: 'Écran, copie de bureau', monitor: 0 }
  ]
}

/** Les options de réduction de gfxcapture, à coller derrière la source. '' : pas de réduction. */
function scaleOpts(scale: TrialScale | undefined): string {
  if (!scale) return ''
  const { width: w, height: h } = scale
  if (![w, h].every((n) => Number.isInteger(n) && n >= 2 && n <= 7680 && n % 2 === 0)) throw new Error('Taille refusée.')
  return `:width=${w}:height=${h}:resize_mode=scale_aspect`
}

const SAFE_REGEX = /^[\w()?^$.[\]*|+ -]{1,80}$/

/**
 * La commande d'un essai, à la taille de l'écran (q.fps et q.videoBps servent ; la taille demandée par la qualité est ignorée).
 * Bêta 46 : un essai qui porte `scale` demande à gfxcapture des images réduites à cette taille.
 */
export function trialArgs(trial: CaptureTrial, q: { maxWidth: number; maxHeight: number; fps: number; videoBps: number }, encoder: string, outFile: string, mode: TrialMode = 'gpu'): string[] {
  if (!(TRIAL_ENCODERS as readonly string[]).includes(encoder)) throw new Error('Encodeur refusé.')
  const fps = Math.min(120, Math.max(1, Math.round(q.fps)))
  let src: string
  if (trial.id === 'fenetre') {
    if (!SAFE_REGEX.test(trial.exeRegex) || /['\\:,;]/.test(trial.exeRegex)) throw new Error('Programme refusé.')
    src = `gfxcapture=window_exe='${trial.exeRegex}':max_framerate=${fps}:capture_cursor=0${scaleOpts(trial.scale)}`
  } else if (trial.id === 'ecran-wgc') src = `gfxcapture=monitor_idx=${trial.monitor | 0}:max_framerate=${fps}:capture_cursor=0${scaleOpts(trial.scale)}`
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
