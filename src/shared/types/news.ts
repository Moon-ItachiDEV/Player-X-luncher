// Types partagés : actus des jeux (annonces Steam).

// ---------- Actus des jeux (annonces officielles publiées sur Steam) ----------

/** Morceau de texte d'une actu, avec sa mise en forme. */
export interface NewsSpan {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** Lien https, ouvert dans le navigateur. */
  href?: string
}

/** Bloc d'une actu, déjà lu dans le processus principal : l'interface n'affiche que du texte, jamais de HTML venu d'internet. */
export type NewsBlock =
  | { type: 'heading'; level: 1 | 2 | 3; spans: NewsSpan[] }
  | { type: 'paragraph'; spans: NewsSpan[] }
  /** `depth` : 0 pour un point de premier niveau, 1 pour un sous-point… */
  | { type: 'list'; ordered: boolean; items: { spans: NewsSpan[]; depth: number }[] }
  | { type: 'quote'; spans: NewsSpan[] }
  | { type: 'image'; src: string }
  /** Vidéo YouTube : un lien, jamais de lecteur intégré. */
  | { type: 'video'; url: string }
  | { type: 'rule' }

/** Une annonce officielle d'un jeu sur Steam. */
export interface NewsPost {
  id: string
  title: string
  /** Page de l'annonce sur Steam (https). */
  url: string
  date: number
  author?: string
  /** Notes de patch : marquées comme telles sur Steam, ou titre de mise à jour (« Update 1.2.0 », « Hotfix »…). */
  patch: boolean
  /** Début du texte, sans mise en forme. */
  excerpt: string
  /** Première image de l'annonce. */
  image?: string
  blocks: NewsBlock[]
}

export interface GameNews {
  /** Appid Steam du jeu ; null si le jeu n'est pas sur Steam (pas d'actus). */
  appId: string | null
  /** Les plus récentes d'abord. */
  posts: NewsPost[]
  /** Date de la plus récente actu déjà vue dans la fiche, avant cette ouverture (0 : jamais). */
  seenAt: number
}
