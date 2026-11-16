// Types partagés : clips (enregistrement en arrière-plan).
import type { ClipPace, GamePace } from '../clipPace'

// ---------- clips (enregistrement en arrière-plan, services/clips.ts) ----------

export type ClipKind = 'kill' | 'hs' | 'multi' | 'ace' | 'death' | 'manual'
export type ClipQuality = 'light' | 'balanced' | 'high'
/** Le compte Discord de la personne : il fixe le poids maximal d'un fichier envoyé (20, 50 ou 500 Mo). */
export type ClipDiscord = 'free' | 'basic' | 'nitro'

/** Un événement à l'intérieur d'un clip : un kill, une mort, l'appui sur le raccourci. */
export interface ClipEvent {
  /** Secondes depuis le début du fichier. Sur CS2, le jeu l'annonce 0,1 à 0,6 s après le vrai moment. */
  t: number
  kind: ClipKind
  kills: number
  headshots: number
}

/**
 * Un clip enregistré, ou un film monté à partir de clips (kind « film »). Le fichier reste côté processus principal : la page
 * n'a que son identifiant et ses adresses pxclip://.
 */
export interface Clip {
  id: string
  gameId: string
  gameName: string
  kind: ClipKind | 'film'
  /** En français : « Headshot », « Triple », « Ace », « Clip manuel »… (renommable). */
  title: string
  kills: number
  headshots: number
  /** Premier événement du clip (ms) ; pour un film, le moment où il a été fabriqué. */
  at: number
  /** Les événements du clip, dans l'ordre. Absent des clips enregistrés avant la bêta 33, et des films. */
  events?: ClipEvent[]
  /** Film seulement : nombre de plans. */
  shots?: number
  durationS: number
  sizeBytes: number
  width: number
  height: number
  pinned: boolean
  /** Identifiant de carte de CS2 (« de_mirage » : mapLabel de @shared/cs2 pour l'afficher). */
  map?: string
  /** Mode de CS2 (« competitive » : modeLabel de @shared/cs2 pour l'afficher). */
  mode?: string
  round?: number
  score?: { us: number; them: number }
  /** pxclip://video/<id> : réponses 206 pour l'avance rapide. */
  videoUrl: string
  /** pxclip://thumb/<id> : JPEG de 640 px, 404 si la capture de l'image a échoué. */
  thumbUrl: string
  /** Une session par partie (de l'ouverture à la fermeture du jeu). */
  sessionId: string
  /** Bêta 46 : le rythme réel du clip (images par seconde gardées par la capture). Absent des clips plus anciens et des films. */
  pace?: ClipPace
}

export interface ClipSettings {
  enabled: boolean
  /** Secondes gardées avant l'événement (5 à 120). */
  before: number
  /** Secondes gardées après l'événement (0 à 30). */
  after: number
  /** Écart maximal entre deux événements d'un même clip, en secondes (0 à 30 ; 0 : jamais de fusion). */
  merge: number
  /** light : 1080p 30 i/s 10 Mb/s ; balanced : 1080p 60 i/s 20 Mb/s ; high : résolution de l'écran 60 i/s 40 Mb/s. */
  quality: ClipQuality
  triggers: { kill: boolean; hs: boolean; multi: boolean; ace: boolean; death: boolean }
  mic: boolean
  gameAudio: boolean
  /** Raccourci global du clip manuel (format de @shared/hotkey). */
  hotkey: string
  /** Dossier des clips (changé seulement par clipsChooseFolder ; '' dans un patch : celui par défaut). */
  folder: string
  /** Au-delà, les plus vieux clips non épinglés sont supprimés. */
  limitGb: number
  /** all : tout jeu lancé ; cs2bf6 : Counter-Strike 2 et Battlefield 6 seulement. */
  games: 'all' | 'cs2bf6'
  /** 0 : écran principal ; sinon l'id d'un écran de clipsDisplays(). */
  display: number
  /**
   * engine : l'image est filmée et encodée par le moteur vidéo, sans quitter la carte graphique (bêta 42) ; le son du PC reste
   * capté par Chrome et recollé. chrome : l'ancienne capture, image et son par Chrome.
   */
  capture: 'engine' | 'chrome'
  /** Bêta 46 : « Copier pour Discord » garde le fichier sous la limite de ce compte (un clip trop lourd est copié en plus léger). */
  discord: ClipDiscord
}

export interface ClipsState {
  /** off : réglage coupé ; idle : aucun jeu ; recording : le tampon tourne ; error : la capture est en panne (relance en cours). */
  status: 'off' | 'idle' | 'recording' | 'error'
  /** Format réel du tampon (« video/mp4;codecs=avc1.640028,mp4a.40.2 »). */
  encoder?: string
  /** Son enregistré : game (système), mic, game+mic ou none (vidéo seule). */
  audio?: 'game' | 'mic' | 'game+mic' | 'none'
  /** Nom du jeu suivi. */
  game?: string
  /** Problème à afficher, même en enregistrement (son indisponible, raccourci refusé, relance en cours). */
  error?: string
  /** Secondes disponibles dans le tampon. */
  bufferSeconds?: number
  /** Bêta 46 : le rythme des clips de la dernière partie finie (absent tant qu'aucune partie n'a fini). */
  lastGame?: GamePace
}

/**
 * Bêta 46 : ce que « Copier pour Discord » a fait.
 * - copied : le fichier est dans le presse-papiers. `reduced` : c'est une copie plus légère, fabriquée à côté du clip (sa
 *   taille d'image, ses images par seconde) ; sans `reduced`, c'est le fichier d'origine, déjà sous la limite.
 * - too-long : même à la plus petite taille, ce clip ne tient pas sous la limite (`maxS` : la durée la plus longue qui
 *   tient). Rien n'est copié.
 * - unmade : la copie légère n'a pas pu être fabriquée (engine : le moteur vidéo manque ou a été modifié ; encode : aucun
 *   encodeur n'y est arrivé). Rien n'est copié.
 * - failed : le presse-papiers a refusé (ou l'appli ne tourne pas sous Windows).
 * `sizeBytes` : le poids de ce qui est copié (copied), sinon celui du fichier d'origine.
 */
export type ClipShareResult =
  | { status: 'copied'; sizeBytes: number; limitMb: number; reduced?: { width: number; height: number; fps: number } }
  | { status: 'too-long'; sizeBytes: number; limitMb: number; maxS: number }
  | { status: 'unmade'; sizeBytes: number; limitMb: number; reason: 'engine' | 'encode' }
  | { status: 'failed' }

/** Bêta 46 : avancement de la fabrication d'une copie légère (0 à 100), pour le bouton « Copier pour Discord ». */
export interface ClipShareStep {
  id: string
  percent: number
}

export interface ClipDisplay {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}
