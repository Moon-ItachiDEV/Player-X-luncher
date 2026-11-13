import type { EditShot } from '@shared/types'
import { shotParts, type ShotSpec } from '@shared/editShots'

// Les commandes du moteur pour fabriquer un film, sans Electron ni fichier (testé par editCompile.test.ts).
// Un film se fabrique plan par plan, un seul ffmpeg à la fois : chaque plan devient un petit fichier (image encodée une fois
// pour toutes, son sans perte), puis un dernier passage met les morceaux bout à bout sans retoucher l'image et encode le son
// d'une traite. Mémoire constante quel que soit le nombre de plans, lignes de commande courtes, et un plan raté se nomme.
// Tout passe en arguments séparés, jamais dans un interpréteur de commandes. Les chemins du PC ne vont que derrière « -i » et
// en sortie, avec « file: » : ils ne sont jamais écrits dans un graphe de filtres ni dans la liste d'assemblage.
// Chaque option utilisée ici a été relue dans les sources de la version livrée (FFmpeg 9.0.2).

/** Un nom d'encodeur de ffmpeg : rien d'autre ne passe dans la ligne de commande. */
const ENCODER_NAME = /^[a-z0-9_]{3,24}$/
/** Un nom de morceau : ce que la liste d'assemblage accepte sans réglage (lettres, chiffres, un point). */
const PART_NAME = /^[a-z0-9]{1,24}\.mov$/
const HEAD = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y']
/** Débit de l'image d'un film en 1080p à 60 images/s, son du film, une image clé toutes les 2 s au moins. */
export const FILM = { videoBitrate: '16M', audioBitrate: '192k', audioRate: 48000, keyEveryS: 2 } as const
/** Un plan lit un peu plus que sa durée : la coupe se fait au nombre d'images, pas à la lecture. */
const READ_MARGIN_S = 0.5

/** Les encodeurs de la carte graphique et celui de Windows prennent du NV12 ; les encodeurs logiciels du YUV 4:2:0. */
export const pixelFormat = (encoder: string): string => (/^h264_(nvenc|amf|qsv|mf)$/.test(encoder) ? 'nv12' : 'yuv420p')
const r3 = (x: number): number => Math.round(x * 1000) / 1000
const num = (x: number): string => String(r3(x))
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

export interface FilmFormat {
  width: number
  height: number
  fps: number
}

/** Le format des films, pour l'instant le même pour tous : 1080p à 60 images/s. */
export const FILM_FORMAT: FilmFormat = { width: 1920, height: 1080, fps: 60 }

/**
 * Les réglages d'image d'un film : les mêmes pour chaque plan et pour l'essai du moteur (un encodeur qui passe l'essai l'a
 * passé avec les réglages d'un vrai film). Pas d'images B : les temps d'un morceau commencent à zéro et se suivent,
 * l'assemblage n'a rien à réordonner.
 */
export function videoArgs(encoder: string, fps: number): string[] {
  if (!ENCODER_NAME.test(encoder)) throw new Error('Encodeur inconnu.')
  return ['-c:v', encoder, '-b:v', FILM.videoBitrate, '-g', String(fps * FILM.keyEveryS), '-bf', '0']
}

function checkedFormat(f: FilmFormat): FilmFormat {
  const { width: w, height: h, fps } = f
  if (![w, h, fps].every((n) => Number.isInteger(n) && n > 0) || w > 7680 || h > 4320 || w % 2 || h % 2 || fps > 240) throw new Error('Format de film refusé.')
  return f
}

/**
 * Le pas des durées, en images : un plan compte un multiple de ce pas, pour que sa durée tombe juste à la fois en images, en
 * échantillons de son et en microsecondes (3 images à 60 images/s : 50 ms). Les morceaux se suivent alors sans aucun arrondi.
 */
export function frameStep(fps: number): number {
  return fps / gcd(fps, 20)
}

/** Nombre d'images d'un plan de `seconds` secondes : le multiple du pas le plus proche, un pas au moins. */
export function shotFrames(seconds: number, fps: number): number {
  const step = frameStep(fps)
  return Math.max(1, Math.round((seconds * fps) / step)) * step
}

export interface ShotSource {
  file: string
  hasAudio: boolean
}

export interface ShotCommand {
  args: string[]
  frames: number
  /** Durée exacte du morceau : `frames` images, et autant de son. */
  durationS: number
}

/**
 * La commande d'un plan : le clip est lu à partir de `inS` (« -ss » avant « -i » : ffmpeg part de l'image clé d'avant et jette
 * ce qui précède), remis à la taille du film sur une grille d'images régulière qui commence à l'instant demandé, coupé au
 * nombre d'images exact. Le son suit la même horloge : calé sur l'instant demandé, coupé ou complété de silence à l'échantillon
 * près. Un clip sans son reçoit du silence. Le morceau est un fichier MOV : image H.264, son sans perte.
 */
export function shotArgs(
  shot: Pick<EditShot, 'inS' | 'outS'>,
  src: ShotSource,
  format: FilmFormat,
  encoder: string,
  outFile: string,
  opts: { speed?: number; frames?: number } = {}
): ShotCommand {
  if (!ENCODER_NAME.test(encoder)) throw new Error('Encodeur inconnu.')
  const { width: w, height: h, fps } = checkedFormat(format)
  if (!(Number.isFinite(shot.inS) && Number.isFinite(shot.outS) && shot.inS >= 0 && shot.outS > shot.inS)) throw new Error('Un plan a des bornes refusées.')
  // Vitesse : 1, ou 0,5 pour un ralenti (le son garde sa hauteur : atempo).
  const speed = opts.speed ?? 1
  if (speed !== 1 && speed !== 0.5) throw new Error('Vitesse refusée.')
  const step = frameStep(fps)
  // `frames` : le nombre d'images voulu par la ligne de temps du film (multiple du pas), sinon la durée du plan.
  const frames = opts.frames !== undefined ? opts.frames : shotFrames((shot.outS - shot.inS) / speed, fps)
  if (!(Number.isInteger(frames) && frames >= step && frames % step === 0)) throw new Error('Un plan a une durée refusée.')
  const d = frames / fps
  const samples = (frames * FILM.audioRate) / fps
  const inputs = ['-protocol_whitelist', 'file', '-ss', num(shot.inS), '-t', num(d * speed + READ_MARGIN_S), '-i', `file:${src.file}`]
  // Un clip sans son : la seconde lecture est du silence fabriqué par ffmpeg.
  if (!src.hasAudio) inputs.push('-f', 'lavfi', '-t', num(d), '-i', `anullsrc=r=${FILM.audioRate}:cl=stereo`)
  // fps (start_time=0) : la première image dure depuis l'instant demandé. tpad : si le clip s'arrête une image trop tôt, la
  // dernière est tenue. trim garde le compte exact.
  const slowV = speed === 1 ? '' : `setpts=PTS/${speed},`
  const slowA = speed === 1 ? '' : `,atempo=${speed}`
  const video = `[0:v]${slowV}fps=${fps}:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frames},scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=${pixelFormat(encoder)}[v]`
  // aresample (first_pts=0) : le son garde sa place par rapport à l'image. asetpts : des temps réguliers, sans trou (round :
  // sans lui, la division laisse parfois un échantillon d'écart).
  const audio = `[${src.hasAudio ? 0 : 1}:a]aresample=${FILM.audioRate}:async=1:first_pts=0${slowA},aformat=sample_fmts=s16:channel_layouts=stereo,atrim=end_sample=${samples},apad=whole_len=${samples},asetpts=round(N/SR/TB)[a]`
  const args = [
    ...HEAD,
    ...inputs,
    '-filter_complex', `${video};${audio}`,
    '-map', '[v]', '-map', '[a]',
    ...videoArgs(encoder, fps),
    '-c:a', 'pcm_s16le',
    '-progress', 'pipe:1', '-nostats',
    '-f', 'mov', `file:${outFile}`
  ]
  return { args, frames, durationS: d }
}

export interface FilmPart {
  /** Nom du morceau dans le dossier de travail (« p000.mov »). */
  name: string
  durationS: number
}

/**
 * La liste d'assemblage (format « ffconcat ») : les morceaux dans l'ordre, par leur nom seul, chacun avec sa durée exacte.
 * ffmpeg la lit depuis le dossier de travail : aucun chemin du PC n'y est écrit.
 */
export function joinList(parts: readonly FilmPart[]): string {
  if (!parts.length) throw new Error('Liste de montage vide.')
  const lines = ['ffconcat version 1.0']
  for (const p of parts) {
    if (!PART_NAME.test(p.name) || !(Number.isFinite(p.durationS) && p.durationS > 0)) throw new Error('Un morceau du film est refusé.')
    lines.push(`file ${p.name}`, `duration ${p.durationS.toFixed(6)}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * La commande d'assemblage, à lancer dans le dossier de travail : les morceaux bout à bout, l'image recopiée telle quelle, le
 * son encodé d'une traite (aucun raccord audible), l'index du fichier au début (lecture immédiate, envoi en ligne).
 */
export interface FilmMix {
  /** Le fichier de la musique (choisi par le joueur dans une fenêtre de Windows). */
  musicFile: string
  /** Où la musique commence (secondes dans le morceau) : un temps de la musique. */
  startS: number
  /** Durée du film. */
  durationS: number
  /** Volumes, de 0 à 1. */
  music: number
  game: number
}

/** Fondu de fin de la musique, en secondes. */
const MUSIC_FADE_S = 2
const vol = (x: number): string => {
  if (!(Number.isFinite(x) && x >= 0 && x <= 1)) throw new Error('Volume refusé.')
  return String(Math.round(x * 100) / 100)
}

export function joinArgs(listName: string, outFile: string, mix?: FilmMix): string[] {
  if (!/^[a-z0-9]{1,24}\.txt$/.test(listName)) throw new Error('Liste d’assemblage refusée.')
  // Avec une musique : elle part de son temps choisi, coupée à la durée du film avec un fondu à la fin, mélangée au son du jeu
  // (chacun à son volume, sans normalisation), puis un limiteur pour qu'aucun pic ne sature.
  let audio: string[] = ['-map', '0:a:0']
  let music: string[] = []
  if (mix) {
    if (!(Number.isFinite(mix.startS) && mix.startS >= 0 && Number.isFinite(mix.durationS) && mix.durationS > 0)) throw new Error('Musique refusée.')
    const D = mix.durationS
    const fade = Math.min(MUSIC_FADE_S, D / 2)
    music = ['-protocol_whitelist', 'file', '-ss', num(mix.startS), '-t', num(D + 1), '-i', `file:${mix.musicFile}`]
    const graph =
      `[0:a]volume=${vol(mix.game)}[g];` +
      `[1:a]aresample=${FILM.audioRate},aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=end=${num(D)},asetpts=PTS-STARTPTS,afade=t=out:st=${num(D - fade)}:d=${num(fade)},volume=${vol(mix.music)}[m];` +
      `[g][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`
    audio = ['-filter_complex', graph, '-map', '[a]']
  }
  return [
    ...HEAD,
    '-protocol_whitelist', 'file', '-f', 'concat', '-i', listName,
    ...music,
    '-map', '0:v:0', ...audio,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', FILM.audioBitrate, '-ar', String(FILM.audioRate), '-ac', '2',
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats',
    '-f', 'mp4', `file:${outFile}`
  ]
}

/** Une image du film pour sa vignette : JPEG de 640 px de large, prise à `atS`. */
export function thumbArgs(filmFile: string, outFile: string, atS: number): string[] {
  return [...HEAD, '-protocol_whitelist', 'file', '-ss', num(Math.max(0, atS)), '-i', `file:${filmFile}`, '-frames:v', '1', '-vf', 'scale=640:-2', '-pix_fmt', 'yuvj420p', '-q:v', '4', '-f', 'image2', '-update', '1', `file:${outFile}`]
}

/**
 * L'avancement lu dans ce que ffmpeg écrit avec « -progress » : les secondes déjà fabriquées (la dernière valeur du morceau
 * reçu), et si c'est fini. null : ce morceau ne dit rien.
 */
export function readProgress(chunk: string): { seconds: number; end: boolean } | null {
  const times = [...chunk.matchAll(/^out_time_(?:us|ms)=(\d+)\s*$/gm)]
  const end = /^progress=end\s*$/m.test(chunk)
  if (!times.length && !end) return null
  return { seconds: times.length ? Number(times[times.length - 1][1]) / 1e6 : 0, end }
}

/**
 * L'avancement au fil de l'eau : ce que ffmpeg écrit arrive par morceaux qui peuvent couper une ligne en deux, et seule une
 * ligne entière compte. Renvoie, à chaque morceau, les secondes fabriquées (elles ne reculent jamais) et si c'est fini.
 */
export function progressReader(): (chunk: string) => { seconds: number; end: boolean } {
  let carry = ''
  let seconds = 0
  let end = false
  return (chunk) => {
    const text = carry + chunk
    const cut = text.lastIndexOf('\n')
    // Une ligne sans fin attend la suite ; un moteur qui n'écrirait jamais de fin de ligne ne remplit pas la mémoire.
    carry = cut < 0 ? text.slice(-4096) : text.slice(cut + 1)
    const p = cut < 0 ? null : readProgress(text.slice(0, cut + 1))
    if (p) {
      seconds = Math.max(seconds, p.seconds)
      end ||= p.end
    }
    return { seconds, end }
  }
}

/** Part de l'assemblage dans l'avancement : les plans font le reste. */
const JOIN_SHARE = 0.06

/**
 * De 0 à 99 pendant la fabrication : `doneS` secondes de plans finis sur `totalS`, puis l'assemblage (`joinS` secondes
 * recopiées). 100 n'est annoncé que quand le fichier est rangé.
 */
export function percentOf(doneS: number, totalS: number, joinS = 0): number {
  if (!(totalS > 0)) return 0
  const part = (x: number): number => Math.min(1, Math.max(0, x / totalS))
  return Math.min(99, Math.floor((part(doneS) * (1 - JOIN_SHARE) + part(joinS) * JOIN_SHARE) * 100))
}

/** Un morceau à fabriquer, avec son nombre d'images pris sur la ligne de temps du film. */
export interface FilmPiece {
  clipId: string
  inS: number
  outS: number
  speed: number
  frames: number
}

/**
 * Les morceaux d'un projet, avec leurs images : chaque fin de morceau est arrondie au pas des images sur la ligne de temps du
 * film entier (pas morceau par morceau). L'écart avec les temps de la musique reste sous un demi-pas (25 ms à 60 images/s)
 * et ne s'additionne jamais. Un morceau qui ne garderait aucun pas est laissé de côté.
 */
export function filmPieces(shots: readonly ShotSpec[], unit: number, fps: number): FilmPiece[] {
  const step = frameStep(fps)
  const out: FilmPiece[] = []
  let t = 0
  let doneFrames = 0
  for (const s of shots) {
    for (const p of shotParts(s, unit)) {
      t += (p.toS - p.fromS) / p.speed
      const end = Math.round((t * fps) / step) * step
      const frames = end - doneFrames
      if (frames < step) continue
      doneFrames = end
      out.push({ clipId: s.clipId, inS: p.fromS, outS: p.toS, speed: p.speed, frames })
    }
  }
  return out
}
