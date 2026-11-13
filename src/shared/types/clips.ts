// Types partagés : clips (enregistrement en arrière-plan).

// ---------- clips (enregistrement en arrière-plan, services/clips.ts) ----------

export type ClipKind = 'kill' | 'hs' | 'multi' | 'ace' | 'death' | 'manual'
export type ClipQuality = 'light' | 'balanced' | 'high'

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
}

export interface ClipDisplay {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}
