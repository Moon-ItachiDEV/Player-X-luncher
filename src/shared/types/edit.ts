// Types partagés : montage (l'éditeur de films) : le moteur vidéo, la liste de montage et la fabrication d'un film.

// ---------- moteur vidéo (services/editFfmpeg.ts) ----------

/** Les encodeurs H.264 que Player X sait utiliser, du plus rapide au secours. */
export type EditEncoder = 'h264_nvenc' | 'h264_amf' | 'h264_qsv' | 'h264_mf' | 'libopenh264'

export interface EditEncoderResult {
  /** Un nom de la liste ci-dessus (ou l'encodeur d'essai du développement, jamais dans la version installée). */
  id: string
  ok: boolean
  /** Secondes mises pour fabriquer le film d'essai (si ok). */
  seconds?: number
  /** Ce que le moteur a répondu en cas d'échec, sans aucun chemin de ce PC. */
  error?: string
}

/** Un essai du moteur sur ce PC. */
export interface EditEngineTest {
  at: number
  /** Version du moteur testé (« 9.0.2 »). */
  version: string
  /** Durée du film d'essai, en secondes. */
  sampleS: number
  encoders: EditEncoderResult[]
  /** Celui que Player X utilisera : le premier qui marche, dans l'ordre de préférence. null : aucun. */
  best: string | null
  /**
   * L'essai sur le dernier clip du joueur, avec `best`, par le chemin d'un vrai film (un plan, puis l'assemblage) : `sampleS`
   * secondes de film fabriquées en `seconds`. `width`, `height`, `audio` : le clip lu. Absent s'il n'a aucun clip.
   */
  clip?: { ok: boolean; seconds?: number; sampleS: number; width: number; height: number; audio?: boolean; error?: string }
}

/** Le dernier film fabriqué sur ce PC : `durationS` secondes de film en `seconds`, avec cet encodeur. */
export interface EditLastFilm {
  at: number
  shots: number
  durationS: number
  seconds: number
  encoder: string
}

/** Le moteur vidéo (FFmpeg), livré avec l'appli : c'est lui qui fabrique le fichier d'un film. */
export interface EditEngine {
  /** ready : le fichier est là et intact ; missing : absent ; damaged : modifié depuis l'installation. */
  status: 'ready' | 'missing' | 'damaged'
  /** « 9.0.2 » */
  version: string
  /** Un essai est en cours. */
  testing: boolean
  /** Le dernier essai fait sur ce PC. */
  test?: EditEngineTest
  /** Le dernier essai en texte, à copier pour l'envoyer. */
  report?: string
}

/** Avancement d'un essai : l'étape `index` (à partir de 1) sur `total`. */
export interface EditEngineStep {
  index: number
  total: number
  /** Un encodeur, ou « clip » pour l'essai sur le dernier clip. */
  what: string
}

// ---------- liste de montage (services/editPlan.ts, editCompile.ts) ----------

/** Un plan du film : un morceau d'un clip, de `inS` à `outS` (secondes dans le fichier du clip). */
export interface EditShot {
  clipId: string
  inS: number
  outS: number
}

/**
 * La liste de montage : le seul contrat entre ce qui décide du film (les règles aujourd'hui ; l'écran et Claude plus tard) et
 * le moteur qui le fabrique. Des identifiants de clips, jamais de chemins. `v` change si le format change.
 */
export interface EditList {
  v: 1
  title: string
  width: number
  height: number
  fps: number
  shots: EditShot[]
}

// ---------- fabrication d'un film (services/editFilm.ts) ----------

/** Où en est la fabrication d'un film. Un seul film à la fois. */
export interface FilmState {
  /** idle : rien en cours ; running : en fabrication ; done : rangé dans les clips ; stopped : arrêté ; failed : raté. */
  status: 'idle' | 'running' | 'done' | 'stopped' | 'failed'
  /** Un des clips montés : la page s'en sert pour retrouver le groupe d'où le film a été demandé. */
  fromClipId?: string
  title?: string
  /** Avancement réel, de 0 à 100 (lu dans ce que le moteur écrit). */
  percent?: number
  /** Nombre de plans du film. */
  shots?: number
  durationS?: number
  /** Clips laissés de côté : fichier disparu ou illisible. */
  skipped?: number
  /** done : l'identifiant du film, rangé avec les clips. */
  clipId?: string
  /** stopped ou failed : pourquoi, en clair. */
  message?: string
  /** failed : ce que le moteur a répondu, sans aucun chemin de ce PC, à copier pour l'envoyer. */
  report?: string
}

// ---------- l'éditeur (bêta 35) : musique et projet de montage ----------

/** Une musique choisie par le joueur sur son PC. Son chemin ne quitte jamais le processus principal. */
export interface EditMusic {
  id: string
  /** Nom du fichier, sans dossier. */
  name: string
  durationS: number
  /** null : aucun tempo trouvé (morceau calme, parlé) ; le film se monte alors sans caler les coupes. */
  bpm: number | null
  /** Les temps, en secondes depuis le début du morceau. */
  grid: number[]
  /** Le fichier n'est plus là (déplacé, effacé). */
  missing?: boolean
}

/** Un plan du projet : un instant d'un clip (le kill), `lead` pas avant, `tail` pas après, ralenti ou non. */
export interface EditProjectShot {
  clipId: string
  anchorS: number
  lead: number
  tail: number
  slow: boolean
}

/**
 * Le projet de montage que l'éditeur envoie pour fabriquer un film. Des identifiants (clips, musique), jamais de chemins.
 * Tout est revérifié par le processus principal (editPlan.cleanProject).
 */
export interface EditProject {
  v: 2
  shots: EditProjectShot[]
  /** startS : où la musique commence, un temps de la grille. Volumes de 0 à 1. */
  music: { id: string; startS: number; volume: number } | null
  gameVolume: number
}

// ---------- l'essai « capture comme OBS » (bêta 38) ----------

export type CaptureTestStep = { phase: 'wait'; seconds: number } | { phase: 'run'; label: string; index: number; total: number } | { phase: 'done' }

export interface CaptureTestResult {
  /** Le jeu filmé pendant l'essai (null : aucun). */
  game: string | null
  seconds: number
  /**
   * Un résultat par méthode essayée. Bêta 46 : `width` et `height` sont la taille réelle de l'image, relue dans la vidéo d'essai
   * (absentes si le fichier n'a pas pu être relu) ; une méthode essayée une seconde fois, réduite, a son identifiant en « -reduit ».
   */
  trials: Array<{ id: string; label: string; ok: true; fps: number; frames: number; encoder: string; file: string; width?: number; height?: number } | { id: string; label: string; ok: false; error: string }>
}
