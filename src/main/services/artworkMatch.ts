// Retrouver le jeu Steam d'un jeu d'un autre magasin (bêta 44), sans réseau ni base. Testé par artworkMatch.test.ts.
//
// Cas relevé chez Breezydev (bêta 43) : « The Witcher 3: Wild Hunt - Game of the Year Edition » (GOG) n'a pas trouvé son jeu
// Steam, et ce « pas trouvé » restait en cache 7 jours : relancer la recherche n'y changeait rien.

import { cleanName, norm } from '@shared/text'

/** Un « pas trouvé » est réessayé après ce délai (un échec du réseau n'est jamais gardé). */
export const NOT_FOUND_RETRY_MS = 6 * 3600_000

/**
 * Les mots à chercher sur Steam, du plus fidèle au plus souple : le nom nettoyé, puis sans ponctuation (la recherche de
 * Steam peut se perdre sur « : »), puis sans l'édition, puis le début avant « : » si c'est assez long.
 */
export function searchTerms(name: string): string[] {
  const base = cleanName(name)
  const flat = base.replace(/[:;,!?"“”’'®™©]/g, ' ').replace(/\s+/g, ' ').trim()
  const noEdition = flat.replace(/\s*[-–]\s*[^-–]*\b(Edition|Édition|Collection|Remastered|Bundle)\b.*$/i, '').trim()
  const head = base.split(':')[0].trim()
  const terms = [base, flat, noEdition, head.length >= 8 ? head : '']
  return [...new Set(terms.filter(Boolean))]
}

/** Le résultat dont le nom est exactement celui du jeu (sans accents, ponctuation ni édition) : jamais « le premier venu ». */
export function pickExact(items: { id: number; name: string }[], name: string): string | null {
  const target = norm(name)
  const hit = items.find((i) => norm(i.name) === target)
  return hit ? String(hit.id) : null
}
