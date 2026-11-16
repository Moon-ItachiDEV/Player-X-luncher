// Collections et jeux masqués : le rangement choisi par le joueur, gardé sur ce PC (base locale). Le mode démo a le sien,
// pour ne jamais toucher au vrai. Les opérations (vérifications comprises) sont dans shared/shelves.ts.
import { randomBytes } from 'node:crypto'
import { cleanShelves, withGameIn, withHidden, withNewCollection, withoutCollection, withRenamed } from '@shared/shelves'
import type { Shelves } from '@shared/types'
import { getKv, setKv } from '../db'
import { getSettings } from './settings'

const key = (): string => (getSettings().demoMode ? 'demoShelves' : 'shelves')

export function getShelves(): Shelves {
  return cleanShelves(getKv<unknown>(key(), {}))
}

function save(next: Shelves): Shelves {
  const clean = cleanShelves(next)
  setKv(key(), clean)
  return clean
}

export const createCollection = (name: unknown, gameId?: unknown): Shelves =>
  save(withNewCollection(getShelves(), `c${randomBytes(6).toString('hex')}`, name, gameId))
export const renameCollection = (id: unknown, name: unknown): Shelves => save(withRenamed(getShelves(), String(id), name))
export const deleteCollection = (id: unknown): Shelves => save(withoutCollection(getShelves(), String(id)))
export const setInCollection = (id: unknown, gameId: unknown, on: unknown): Shelves => save(withGameIn(getShelves(), String(id), gameId, on === true))
export const setGameHidden = (gameId: unknown, hidden: unknown): Shelves => save(withHidden(getShelves(), gameId, hidden === true))
