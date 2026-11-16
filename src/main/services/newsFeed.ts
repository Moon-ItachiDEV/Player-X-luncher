// Relevé des actus des jeux : ce qu'on garde des dernières annonces de chaque jeu (par appid Steam), et ce qu'on en tire
// (badge « Nouveau patch », dernier patch). Module pur, sans Electron : testé sous Node seul (npm run test:news).
import type { Game } from '@shared/types'
import { isPatchPost, type RawNews } from './newsFormat'

/** Annonces gardées par jeu dans le relevé (titres seulement). */
export const ITEMS_PER_GAME = 5
/** Comme NEW_MS de NewsSection.tsx : au-delà de 7 jours, plus de badge « Nouveau patch » ni de « Nouveau ». */
export const NEW_MS = 7 * 24 * 3600_000

export interface IndexItem {
  id: string
  title: string
  url: string
  date: number
  patch: boolean
}

/** Ce que le relevé sait d'un jeu : ses dernières annonces et son dernier patch. */
export interface IndexEntry {
  at: number
  /** Date de la plus récente annonce (0 : aucune). */
  latest: number
  patch?: { id: string; title: string; date: number }
  /** Absent des relevés de la 0.7.2 : relevé redemandé une fois. */
  items?: IndexItem[]
}

export type NewsIndex = Record<string, IndexEntry>

/**
 * Relevé d'un jeu à partir de ses annonces (les plus récentes d'abord). Le dernier patch est cherché dans toutes ; s'il n'y
 * en a aucun, celui du relevé précédent (`prev`) est gardé quand il est plus ancien que toutes les annonces lues : il est
 * simplement sorti de la liste (un jeu qui publie beaucoup), il n'a pas disparu de Steam.
 */
export function entryFrom(raw: RawNews[], at: number, prev?: IndexEntry): IndexEntry {
  const found = raw.find((n) => isPatchPost(n.title, n.tags))
  const patch = found
    ? { id: found.gid, title: found.title, date: found.date }
    : prev?.patch && olderThanAll(raw, prev.patch.date)
      ? prev.patch
      : undefined
  return {
    at,
    latest: raw[0]?.date ?? 0,
    ...(patch ? { patch } : {}),
    items: raw.slice(0, ITEMS_PER_GAME).map((n) => ({ id: n.gid, title: n.title, url: n.url, date: n.date, patch: isPatchPost(n.title, n.tags) }))
  }
}

/** `date` est plus ancienne que toutes ces annonces (aucune : false) : un patch qui en est sorti, pas un patch retiré. */
export function olderThanAll(raw: RawNews[], date: number): boolean {
  const oldest = raw[raw.length - 1]?.date
  return oldest !== undefined && date < oldest
}

/**
 * Annonces de la fiche gardées en mémoire (`at` : lues à ce moment, `newest` : date de la plus récente) : encore bonnes
 * si elles ont moins de `maxAge` et que le relevé (`known` : sa plus récente annonce) ne connaît rien de plus récent.
 * Sinon une annonce trouvée par « Actualiser » s'ouvrirait sur « Cette annonce n'est plus dans les dernières actus ».
 */
export function postsStillFresh(cache: { at: number; newest: number } | undefined, known: number, now: number, maxAge: number): boolean {
  return !!cache && now - cache.at < maxAge && known <= cache.newest
}

/**
 * Relevé de plusieurs jeux, `parallel` à la fois. Une série où toutes les demandes échouent faute de réseau (`offline`) arrête
 * tout : Steam qui ne répond pas coûterait sinon 15 s par série, plusieurs minutes pour une grande bibliothèque. Les jeux
 * pas encore demandés comptent alors comme échoués (redemandés au prochain passage).
 */
export async function fetchAll<T>(
  ids: string[],
  parallel: number,
  fetchOne: (id: string) => Promise<T>,
  offline: (e: unknown) => boolean
): Promise<{ results: Map<string, T>; ok: number; failed: number }> {
  const results = new Map<string, T>()
  let failed = 0
  for (let i = 0; i < ids.length; i += parallel) {
    const batch = ids.slice(i, i + parallel)
    const down = await Promise.all(
      batch.map(async (id) => {
        try {
          results.set(id, await fetchOne(id))
          return false
        } catch (e) {
          failed++
          return offline(e)
        }
      })
    )
    if (down.every(Boolean)) {
      failed += ids.length - i - batch.length
      break
    }
  }
  return { results, ok: results.size, failed }
}

/** À relever : jamais relevé, relevé d'avant la 0.7.4 (sans annonces), ou plus vieux que `maxAge`. */
export function needsRefresh(entry: IndexEntry | undefined, now: number, maxAge: number): boolean {
  return !entry || !entry.items || now - entry.at > maxAge
}

/** Nouvelle date « vu jusqu'à » : toutes les annonces (sans `upTo`), ou seulement jusqu'à celle qu'on vient de lire. Jamais en arrière. */
export function nextSeen(prev: number, latest: number, upTo?: unknown): number {
  if (upTo === undefined) return Math.max(prev, latest)
  if (typeof upTo === 'number' && Number.isFinite(upTo) && upTo > 0) return Math.max(prev, Math.min(upTo, latest))
  return prev
}

/** Dernier patch du jeu (`lastPatch`, même vu ou ancien) et badge « Nouveau patch » (moins de 7 jours, pas encore vu). */
export function patchFlags(entry: IndexEntry | undefined, seenAt: number, now: number): Pick<Game, 'newPatch' | 'lastPatch'> {
  const p = entry?.patch
  if (!p) return {}
  const lastPatch = { id: p.id, title: p.title, at: p.date }
  return now - p.date < NEW_MS && p.date > seenAt ? { newPatch: { ...lastPatch }, lastPatch } : { lastPatch }
}
