import type { FriendsResult, Game } from '@shared/types'
import type { Launches } from '../services/launches'

/** Ce que les canaux prennent au démarrage de l'appli (index.ts) : la bibliothèque, les lancements, l'état de la démo. */
export interface ChannelDeps {
  games(refresh?: boolean): Promise<Game[]>
  findGame(id: unknown): Game | undefined
  knownGames(): Game[]
  newsGames(): Game[]
  launches(): Launches
  demoState(): { favorites?: string[]; launches: Record<string, { count: number; last: number }> }
  demoFriends(): FriendsResult
  fetchOwnedArtwork(list: Game[]): void
  notifyGamesChanged(): void
  updateRunning(): void
  /** Le prochain affichage de la bibliothèque relance un scan (retour du mode démo). */
  rescan(): void
}


