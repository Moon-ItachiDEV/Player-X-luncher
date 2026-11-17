// Retrouver le jeu Steam d'un jeu d'un autre magasin (bêta 44), sans réseau ni base. Testé par artworkMatch.test.ts.
//
// Cas relevé chez Breezydev (bêta 43) : « The Witcher 3: Wild Hunt - Game of the Year Edition » (GOG) n'a pas trouvé son jeu
// Steam, et ce « pas trouvé » restait en cache 7 jours : relancer la recherche n'y changeait rien.
//
// 0.6.2 : sa jaquette manquait toujours. Deux trous possibles, bouchés ici :
//  - Steam a aussi une fiche à part pour l'édition (499450 « … Game of the Year Edition », à côté du jeu 292030). Les deux
//    ont le même nom une fois l'édition retirée, et c'était la première venue qui était gardée, même sans image.
//    Maintenant tous les candidats sont gardés, dans l'ordre, et artwork.ts prend le premier qui a une jaquette ;
//  - un mot d'édition sans tiret (« Remastered », « GOTY », « Next-Gen »…) empêchait le nom de tomber juste.
//    Si rien ne tombe juste, on réessaie avec le nom sans ces mots.

import { cleanName, norm } from '@shared/text'

type Item = { id: number; name: string }

/** Un « pas trouvé » est réessayé après ce délai (un échec du réseau n'est jamais gardé). */
export const NOT_FOUND_RETRY_MS = 6 * 3600_000

/** Version des règles de recherche : un jeu retrouvé avec des règles plus anciennes est recherché une fois de plus. */
export const MATCH_VERSION = 2

/** Le nom réduit à ses lettres et chiffres, édition comprise (seuls ™ ® © partent). */
const raw = (s: string): string =>
  s
    .replace(/[™®©]/g, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')

// Mots d'édition en fin de nom, avec ou sans tiret ni « Edition » : « GOTY », « Remastered », « Complete Edition », « Next-Gen »…
const TAIL = /\s*[-–:]?\s*\(?\b(GOTY|Game of the Year|Remastered|Remaster|Complete|Definitive|Enhanced|Next[- ]?Gen|Director'?s Cut|Anniversary|Standard|Deluxe|Ultimate|Gold|Premium)(\s+(Edition|Édition))?\)?\s*$/i

/** Le nom sans ses mots d'édition en fin, même à la suite : « The Witcher 3 Wild Hunt Remastered » → « The Witcher 3 Wild Hunt ». */
export function withoutEdition(name: string): string {
  let s = cleanName(name)
  for (let i = 0; i < 4; i++) {
    const t = s.replace(TAIL, '').trim()
    if (!t || t === s) break
    s = t
  }
  return s
}

/**
 * Les mots à chercher sur Steam, du plus fidèle au plus souple : le nom nettoyé, puis sans ponctuation (la recherche de
 * Steam peut se perdre sur « : »), puis sans l'édition, puis sans les mots d'édition sans tiret, puis le début avant « : »
 * si c'est assez long.
 */
export function searchTerms(name: string): string[] {
  const base = cleanName(name)
  const flat = base.replace(/[:;,!?"“”’'®™©]/g, ' ').replace(/\s+/g, ' ').trim()
  const noEdition = flat.replace(/\s*[-–]\s*[^-–]*\b(Edition|Édition|Collection|Remastered|Bundle)\b.*$/i, '').trim()
  const loose = withoutEdition(noEdition)
  const head = base.split(':')[0].trim()
  const terms = [base, flat, noEdition, loose.length >= 4 ? loose : '', head.length >= 8 ? head : '']
  return [...new Set(terms.filter(Boolean))]
}

/** Ordre de préférence entre des résultats qui conviennent : le nom exact (édition comprise), puis le jeu de base, puis les autres. */
function ranked(hits: Item[], name: string): string[] {
  const exact = raw(name)
  const base = norm(name)
  const score = (i: Item): number => (raw(i.name) === exact ? 0 : raw(i.name) === base ? 1 : 2)
  const order = hits.map((i, k) => ({ i, k })).sort((a, b) => score(a.i) - score(b.i) || a.k - b.k)
  return [...new Set(order.map(({ i }) => String(i.id)))]
}

/** Les résultats dont le nom est exactement celui du jeu (sans accents, ponctuation ni édition), du plus sûr au moins sûr. */
export function matchIds(items: Item[], name: string): string[] {
  const target = norm(name)
  return ranked(
    items.filter((i) => norm(i.name) === target),
    name
  )
}

/** En dernier recours : les résultats qui ont le nom du jeu sans ses mots d'édition (rien si le nom n'en a pas). */
export function looseIds(items: Item[], name: string): string[] {
  const short = withoutEdition(name)
  const target = norm(short)
  if (target.length < 4 || target === norm(name)) return []
  return ranked(
    items.filter((i) => norm(i.name) === target),
    short
  )
}

/** Le résultat le plus sûr dont le nom est exactement celui du jeu : jamais « le premier venu ». */
export function pickExact(items: Item[], name: string): string | null {
  return matchIds(items, name)[0] ?? null
}

/** Parmi les candidats, le premier qui a une jaquette sur Steam ; sinon le premier. */
export function firstWithCover(ids: string[], hasCover: (id: string) => boolean): string | null {
  return ids.find(hasCover) ?? ids[0] ?? null
}
