// Types partagés : collections et jeux masqués.

// ---------- Collections et jeux masqués ----------

/** Une collection de jeux choisie par le joueur (« Avec les potes », « À finir »…), gardée sur ce PC. */
export interface GameCollection {
  id: string
  name: string
  /** Identifiants des jeux, dans l'ordre d'ajout. */
  games: string[]
}

export type { Bf6Loadout, Bf6LoadoutPart } from '../bf6Loadouts'

export interface Shelves {
  collections: GameCollection[]
  /** Jeux masqués : ni sur l'Accueil ni dans la Bibliothèque (Paramètres › Bibliothèque les liste). */
  hidden: string[]
}
