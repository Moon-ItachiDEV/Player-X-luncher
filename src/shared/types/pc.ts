// Mon PC (Paramètres › Mon PC) : ce que Player X lit de la carte graphique et des écrans. Lecture seule : rien n'est installé.

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'other'

/** La dernière version connue du pilote (NVIDIA seulement : AMD et Intel ne la publient pas en clair). */
export interface PcLatest {
  version: string
  /** « 2026-11-04 », ou null si NVIDIA ne l'a pas donnée. */
  date: string | null
  /** La page officielle de ce pilote chez NVIDIA (toujours https://…nvidia.com). */
  url: string
  /** `newer` : la version installée est plus récente que la dernière Game Ready (une bêta, un pilote Studio…). */
  status: 'up-to-date' | 'update' | 'newer' | 'unknown'
  /** La carte n'est pas dans la liste de NVIDIA : la version vient d'une carte de la même série, qui a le même pilote. */
  bySeries: boolean
  /** Le fichier d'installation officiel (https://…download.nvidia.com/…exe). Absent : pas de bouton « Mettre à jour ». */
  downloadUrl?: string
}

export interface PcGpu {
  name: string
  vendor: GpuVendor
  /** La version comme le fabricant l'écrit (NVIDIA 566.36, AMD Adrenalin 25.10.2, Intel 32.0.101.9175). null si inconnue. */
  version: string | null
  /** La version comme Windows l'écrit (32.0.15.6636). */
  windowsVersion: string | null
  /** La date du pilote installé, « 2026-10-21 ». */
  date: string | null
  /** Le lien officiel pour vérifier ou mettre à jour. null pour une carte d'une autre marque. */
  link: { url: string; label: string } | null
  /** Une phrase de conseil (AMD, Intel, portable). */
  note?: string
  /** NVIDIA : la dernière version. Absente si la recherche n'a pas eu lieu. */
  latest?: PcLatest
  /** NVIDIA : pourquoi la dernière version manque (« NVIDIA n'a pas répondu… »). */
  lookupError?: string
}

export interface PcDisplay {
  name: string
  width: number
  height: number
  /** La fréquence actuelle, en Hz. 0 si inconnue. */
  hz: number
  /** La plus haute que Windows propose à cette taille d'image. null si Windows ne l'a pas dite. */
  maxHz: number | null
  primary: boolean
  /** Réglé nettement sous sa fréquence la plus haute (5 Hz d'écart ou plus). */
  low: boolean
}

export interface PcState {
  /** Quand la lecture a été faite (ms). */
  at: number
  gpus: PcGpu[]
  displays: PcDisplay[]
  /** Les mises à jour de pilote faites par Player X (les plus récentes d'abord). */
  journal?: DriverJournalEntry[]
  /** Le résumé du sommaire des paramètres (« Nouveau pilote », « Écran à régler »), vide si rien à faire. */
  badge: string
  /** Un PC portable (boîtier lu par Windows) : les conseils de pilote changent. */
  laptop: boolean
  /** Windows n'a pas pu être lu (PowerShell bloqué, délai dépassé) : les cartes manquent, les écrans d'Electron restent. */
  error?: string
  /** Hors Windows (développement) : rien n'est lu. */
  unsupported?: boolean
}

/** Une mise à jour de pilote faite depuis Player X (Paramètres › Mon PC). */
export interface DriverJournalEntry {
  at: number
  from: string | null
  to: string
  /** refused : demande de Windows refusée ; signature : fichier pas signé par NVIDIA ; restore-failed : pas de point de restauration, rien installé. */
  outcome: 'ok' | 'reboot' | 'refused' | 'signature' | 'restore-failed' | 'failed' | 'stopped'
  restore?: 'ok' | 'recent' | 'skipped' | 'failed'
  /** La version relue par Windows après l'installation. */
  after?: string | null
}

/** La mise à jour du pilote en cours (une seule à la fois), envoyée à la page par « pc:driver ». */
export interface DriverUpdateState {
  status: 'idle' | 'download' | 'verify' | 'consent' | 'install' | 'done' | 'failed' | 'stopped'
  version?: string
  /** Téléchargement : avancement de 0 à 100, et mégaoctets. */
  pct?: number
  mb?: number
  totalMb?: number
  /** done/failed : ce qui s'est passé, en clair. */
  message?: string
  outcome?: DriverJournalEntry['outcome']
  /** restore-failed : on peut relancer sans point de restauration. */
  canSkipRestore?: boolean
  /** Windows demande un redémarrage. */
  reboot?: boolean
}
