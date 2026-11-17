// Mises à jour dans l'appli : ce que le processus principal envoie à la page (« maj:state ») et ce qu'elle peut demander.

export type MajStatus = 'off' | 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error' | 'uptodate'

export interface MajNoteItem {
  kind: 'nouveau' | 'ameliore' | 'corrige'
  title: string
  text: string
  /** Page de l'appli où la note renvoie (« Voir ») : un identifiant connu, jamais une adresse. */
  page?: string
}
export interface MajNoteEntry {
  version: string
  date: string
  items: MajNoteItem[]
}

export interface MajState {
  status: MajStatus
  /** Version installée. */
  current: string
  /** Les clés de vérification sont en place : sinon rien n'est vérifié ni proposé. */
  configured: boolean
  /** La nouvelle version (available, downloading, verifying, ready, installing, error). */
  version?: string
  date?: string
  size?: number
  /** Les notes de la nouvelle version (celles des versions entre la tienne et la sienne comprises). */
  notes?: MajNoteEntry[]
  /** Téléchargement : octets reçus, taille, vitesse (octets par seconde), secondes restantes. */
  received?: number
  total?: number
  bytesPerSec?: number
  etaS?: number
  /** Installation : le compte à rebours (fin à `endsAt`, heure en ms). */
  secondsLeft?: number
  endsAt?: number
  /** error : ce qui s'est passé, en clair, et si la page de la version peut s'ouvrir. */
  reason?: string
  release?: boolean
  /** Un jeu tourne, un clip est filmé ou un film se fabrique : rien ne redémarre. */
  blocked: boolean
  /** Rien à montrer : « Plus tard » (la mise à jour se fait en silence, à la fermeture). */
  quiet: boolean
  /** Dernière vérification réussie (ms), et la raison d'une vérification ratée à la demande. */
  checkedAt?: number
  checkError?: string
}

/** Les notes à montrer : `fresh` après un redémarrage (une seule fois), sinon « Revoir les nouveautés ». */
export interface MajNotes {
  entries: MajNoteEntry[]
  fresh: boolean
  /** La version d'où l'on vient (la première vue des notes) : pour « De la 0.7.0 à la 0.7.2 ». */
  from?: string
  to: string
}
