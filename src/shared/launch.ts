// Lancement d'un jeu, entre le processus principal (services/launches.ts, seul à décider des phases) et l'interface
// (renderer/src/launch). Types seulement : aucun import à l'exécution. Spec docs/design/launch-sequence.md.

/** Par où part le lancement : le client du store (lien) ou l'exécutable du jeu. */
export type LaunchRoute = 'steam' | 'epic' | 'ea' | 'gog' | 'exe'

/**
 * Comment le démarrage du jeu est suivi : `fast` (petit relevé des programmes chaque seconde), `poll` (relevés à 20 s,
 * 45 s puis chaque minute), `none` (hors Windows : rien n'est suivi).
 */
export type DetectMode = 'fast' | 'poll' | 'none'

/** Bouton d'origine : « Jouer », « Réessayer », « Relancer quand même » ou « Réanalyser ». */
export type LaunchVia = 'play' | 'retry' | 'relaunch' | 'rescan'

/** Pourquoi le lancement n'a pas pu partir. */
export type LaunchFail = 'no-handler' | 'exe-missing' | 'no-target' | 'not-found' | 'other'

export type LaunchPhase =
  /** Lien ou exécutable en train d'être transmis par Windows. */
  | 'sending'
  /** Transmis : on attend que le jeu apparaisse. */
  | 'waiting'
  /** Un programme du jeu s'est fermé moins de 30 s après sa détection : un autre peut suivre (lanceur intermédiaire). */
  | 'relay'
  /** Détecté et confirmé par le relevé des programmes (la même vérité que les pastilles cyan). */
  | 'running'
  /** Le jeu s'est fermé (pas de carte). */
  | 'ended'
  /** Fermé peu après sa détection, et rien n'a pris le relais. */
  | 'early-exit'
  /** Pas vu en 5 min (ou mise en veille pendant l'attente, `silent`). */
  | 'gave-up'
  | 'failed'
  /** Le jeu tournait déjà : rien n'a été envoyé. */
  | 'already'
  /** « Relancer quand même » sur un jeu qui semblait tourner : lien renvoyé, pas de suivi. */
  | 'resent'
  /** « Ne plus attendre ». */
  | 'cancelled'
  /** Envoyé, mais la détection n'existe que sous Windows. */
  | 'untracked'

export interface LaunchOpts {
  /** Choisi par l'interface (au plus 64 caractères) : les événements qui arrivent avant la réponse s'y rattachent. */
  launchId: string
  via: LaunchVia
  /** Lancer même si le jeu semble déjà tourner. */
  force?: boolean
}

export interface LaunchStatus {
  launchId: string
  gameId: string
  route: LaunchRoute
  phase: LaunchPhase
  detect: DetectMode
  via: LaunchVia
  /** Croît à chaque changement d'un même lancement : l'interface ne revient jamais en arrière. */
  rev: number
  /** Mode démo : rien n'est lancé ni enregistré, sauf le compteur de démo. */
  demo?: true
  /** Fin sans carte ni annonce (mise en veille, mode démo basculé). */
  silent?: true
  /** Horloge du processus principal (même machine que l'interface). */
  clickAt: number
  handedAt?: number
  detectedAt?: number
  goneAt?: number
  endedAt?: number
  /** Le client du store tournait au dernier relevé (≤ 90 s) ; null : inconnu. */
  storeWasOpen?: boolean | null
  /** Windows connaît une appli pour ce lien (lu juste après l'envoi) ; null : inconnu ou exécutable. */
  handler?: boolean | null
  /** Steam indique une mise à jour de ce jeu (registre, indice de texte seulement). */
  steamUpdating?: boolean
  /** Début de la partie en cours (phase `already`). */
  runningSince?: number
  reason?: LaunchFail
  /** Message de Windows, pour l'infobulle d'un échec. Jamais affiché tel quel dans la carte. */
  detail?: string
}
