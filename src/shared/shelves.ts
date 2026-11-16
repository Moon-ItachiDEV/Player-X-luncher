// Collections et jeux masqués : opérations pures sur le rangement du joueur (processus principal : services/shelves.ts).
// Testé sous Node seul (npm run test:ready). Tout ce qui vient de la base ou de l'interface est revérifié ici.
import type { GameCollection, Shelves } from './types'

export const MAX_COLLECTIONS = 30
export const MAX_NAME = 40
const MAX_GAMES = 1000
/** Identifiant de jeu de Player X : `steam:730`, `epic:Fortnite`, `ea:Origin.OFR.50.0005577`. */
const GAME_ID = /^(steam|epic|ea):[\w.:-]{1,200}$/
const COLLECTION_ID = /^c[a-z0-9]{4,24}$/

export const isGameId = (v: unknown): v is string => typeof v === 'string' && GAME_ID.test(v)

/** Nom d'une collection : espaces resserrés, 40 caractères au plus ; '' s'il est vide. */
export function collectionName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : ''
}

/** Rangement relu (base ou interface) : seulement des collections et des jeux bien formés, sans doublon. */
export function cleanShelves(raw: unknown): Shelves {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Shelves, unknown>>
  const seen = new Set<string>()
  const collections: GameCollection[] = []
  for (const c of Array.isArray(r.collections) ? r.collections : []) {
    const o = (c && typeof c === 'object' ? c : {}) as Partial<Record<keyof GameCollection, unknown>>
    const id = typeof o.id === 'string' && COLLECTION_ID.test(o.id) ? o.id : ''
    const name = collectionName(o.name)
    if (!id || !name || seen.has(id) || collections.length >= MAX_COLLECTIONS) continue
    seen.add(id)
    const games = [...new Set((Array.isArray(o.games) ? o.games : []).filter(isGameId))].slice(0, MAX_GAMES)
    collections.push({ id, name, games })
  }
  const hidden = [...new Set((Array.isArray(r.hidden) ? r.hidden : []).filter(isGameId))].slice(0, MAX_GAMES)
  return { collections, hidden }
}

const sameName = (a: string, b: string): boolean => a.localeCompare(b, 'fr', { sensitivity: 'base' }) === 0

/** Nouvelle collection (avec un premier jeu, si donné). `id` : fourni par l'appelant (unique). */
export function withNewCollection(s: Shelves, id: string, rawName: unknown, gameId?: unknown): Shelves {
  const name = collectionName(rawName)
  if (!name) throw new Error('Donne un nom à la collection.')
  if (s.collections.length >= MAX_COLLECTIONS) throw new Error(`${MAX_COLLECTIONS} collections au plus : supprimes-en une d'abord.`)
  if (s.collections.some((c) => sameName(c.name, name))) throw new Error(`Une collection s'appelle déjà « ${name} ».`)
  return { ...s, collections: [...s.collections, { id, name, games: isGameId(gameId) ? [gameId] : [] }] }
}

export function withRenamed(s: Shelves, id: string, rawName: unknown): Shelves {
  const name = collectionName(rawName)
  if (!name) throw new Error('Donne un nom à la collection.')
  if (s.collections.some((c) => c.id !== id && sameName(c.name, name))) throw new Error(`Une collection s'appelle déjà « ${name} ».`)
  return { ...s, collections: s.collections.map((c) => (c.id === id ? { ...c, name } : c)) }
}

export function withoutCollection(s: Shelves, id: string): Shelves {
  return { ...s, collections: s.collections.filter((c) => c.id !== id) }
}

/** Ajoute le jeu à la collection (à la fin), ou l'en retire. */
export function withGameIn(s: Shelves, id: string, gameId: unknown, on: boolean): Shelves {
  if (!isGameId(gameId)) throw new Error('Jeu inconnu.')
  if (!s.collections.some((c) => c.id === id)) throw new Error('Collection introuvable.')
  return {
    ...s,
    collections: s.collections.map((c) => {
      if (c.id !== id) return c
      const rest = c.games.filter((g) => g !== gameId)
      return { ...c, games: on ? [...rest, gameId].slice(-MAX_GAMES) : rest }
    })
  }
}

export function withHidden(s: Shelves, gameId: unknown, hidden: boolean): Shelves {
  if (!isGameId(gameId)) throw new Error('Jeu inconnu.')
  const rest = s.hidden.filter((g) => g !== gameId)
  return { ...s, hidden: hidden ? [...rest, gameId].slice(-MAX_GAMES) : rest }
}
