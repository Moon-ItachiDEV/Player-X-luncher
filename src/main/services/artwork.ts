import { net } from 'electron'
import { cleanName as clean, norm } from '@shared/text'
import { MATCH_VERSION, NOT_FOUND_RETRY_MS, firstWithCover, looseIds, matchIds, searchTerms } from './artworkMatch'
import type { Game } from '@shared/types'
import { getKv, kvStamp, setKv } from '../db'

// Jaquettes et bannières : on s'appuie sur le catalogue Steam, qui couvre aussi la plupart des jeux
// EA et Epic (Battlefield, EA SPORTS FC…). Deux API publiques, sans clé :
//  - storesearch : retrouve l'appid Steam d'un jeu à partir de son nom ;
//  - IStoreBrowseService/GetItems : donne les vrais chemins d'images (les jeux récents ont des
//    chemins avec un hash, l'ancienne URL steam/apps/<id>/library_600x900.jpg ne marche plus pour eux).

const CDN = 'https://shared.steamstatic.com/store_item_assets/'
const LEGACY_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps/'
const MAX_AGE = 7 * 24 * 3600_000
const SEARCH_PARALLEL = 2
/** Pause après un 429 de Steam pour éviter d'insister en boucle. */
const RATE_LIMIT_BACKOFF_MS = 10 * 60_000

class RateLimitError extends Error {}
let rateLimitedUntil = 0

interface Art {
  appId: string | null
  cover?: string
  hero?: string
  /** Logo du jeu (catalogue Steam). null : demandé, Steam n'en a pas. Absent : pas encore demandé. */
  logo?: string | null
  /** Les chemins d'images ont été demandés à Steam (même si aucune image n'existe). */
  assetsFetched?: boolean
  /** Tags Steam du jeu (identifiants, les plus votés d'abord), pour le style de l'accueil. Absent : pas encore demandé. */
  tagIds?: number[]
  /** Jeu EA / Epic / GOG : les autres jeux Steam au même nom, essayés si `appId` n'a pas de jaquette (0.6.2). */
  alts?: string[]
  /** Jeu EA / Epic / GOG : version des règles de recherche qui l'a retrouvé (MATCH_VERSION). */
  m?: number
  at: number
}

type ArtCache = Record<string, Art>

/**
 * Appids Steam d'un jeu non-Steam, du plus sûr au moins sûr, seulement si le nom correspond vraiment (pas le premier
 * résultat venu). Vide : pas trouvé.
 */
async function findSteamAppIds(name: string): Promise<string[]> {
  if (Date.now() < rateLimitedUntil) throw new RateLimitError('storesearch 429')
  // Plusieurs façons d'écrire la recherche : Steam ne retrouve pas toujours un titre avec « : » ou une édition. Une erreur
  // du réseau remonte (rien n'est gardé en cache), un « pas trouvé » ne sort qu'après tous les essais.
  const seen: { id: number; name: string }[] = []
  for (const term of searchTerms(name)) {
    const res = await net.fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=french&cc=FR`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    })
    if (res.status === 429) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS
      throw new RateLimitError('storesearch 429')
    }
    if (!res.ok) throw new Error(`storesearch ${res.status}`)
    const items = ((await res.json()) as { items?: { id: number; name: string }[] }).items ?? []
    const ids = matchIds(items, name)
    if (ids.length) return ids
    seen.push(...items)
  }
  // Rien d'exact : le nom sans ses mots d'édition (« … Remastered », « … GOTY »)
  const loose = looseIds(seen, name)
  if (loose.length) return loose
  console.warn('[artwork] jeu introuvable sur Steam :', name, '| recherches :', searchTerms(name).join(' ; '))
  return []
}

interface StoreItem {
  appid: number
  assets?: Record<string, string> & { asset_url_format?: string }
  tagids?: number[]
  tags?: { tagid: number; weight?: number }[]
}

interface Assets {
  cover?: string
  hero?: string
  logo?: string
  tagIds?: number[]
}

/** Chemins exacts des images pour une liste d'appids (par lots de 50). */
export async function fetchAssets(appIds: string[]): Promise<Map<string, Assets>> {
  if (Date.now() < rateLimitedUntil) throw new RateLimitError('GetItems 429')
  const out = new Map<string, Assets>()
  for (let i = 0; i < appIds.length; i += 50) {
    const input = {
      ids: appIds.slice(i, i + 50).map((id) => ({ appid: Number(id) })),
      context: { language: 'french', country_code: 'FR' },
      data_request: { include_assets: true, include_tag_count: 12 }
    }
    const res = await net.fetch(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, {
      // Sans limite, une réponse qui ne vient jamais bloquait les jaquettes jusqu'au redémarrage
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    })
    if (res.status === 429) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS
      throw new RateLimitError('GetItems 429')
    }
    if (!res.ok) throw new Error(`GetItems ${res.status}`)
    const items = ((await res.json()) as { response?: { store_items?: StoreItem[] } }).response?.store_items ?? []
    for (const item of items) {
      const a = item.assets
      // Les tags, triés du plus voté au moins voté : ils servent au style de l'accueil, même sans images
      const tagIds = (item.tags?.length ? [...item.tags].sort((x, y) => (y.weight ?? 0) - (x.weight ?? 0)).map((t) => t.tagid) : (item.tagids ?? [])).filter((t) => Number.isInteger(t))
      if (!a?.asset_url_format) {
        out.set(String(item.appid), { tagIds })
        continue
      }
      const url = (file?: string): string | undefined => (file ? CDN + a.asset_url_format!.replace('${FILENAME}', file).replace(/\?.*$/, '') : undefined)
      out.set(String(item.appid), {
        cover: url(a.library_capsule_2x ?? a.library_capsule),
        hero: url(a.library_hero ?? a.library_hero_2x ?? a.page_background ?? a.header),
        logo: url(a.library_logo_2x ?? a.library_logo),
        tagIds
      })
    }
  }
  return out
}

/** Va chercher sur Steam les images manquantes ou périmées. Renvoie true si le cache a changé. */
export async function updateArtwork(games: Game[]): Promise<boolean> {
  if (Date.now() < rateLimitedUntil) return false
  const cache = getKv<ArtCache>('artwork', {})
  const now = Date.now()
  const fresh = (g: Game): Art | undefined => {
    const a = cache[g.id]
    if (!a) return undefined
    // Jeu EA / Epic / GOG retrouvé avec d'anciennes règles : recherché une fois de plus (0.6.2, The Witcher 3 de Breezydev)
    if (g.store !== 'steam' && a.m !== MATCH_VERSION) return undefined
    // Un « pas trouvé » (appId null), ou un jeu retrouvé mais sans jaquette, est réessayé au bout de 6 h seulement :
    // une semaine était trop long.
    const ok = a.appId && (g.store === 'steam' || !a.assetsFetched || a.cover)
    return now - a.at < (ok ? MAX_AGE : NOT_FOUND_RETRY_MS) ? a : undefined
  }
  /** Ce que cette recherche a trouvé : seul écrit à la fin, par-dessus le cache relu (une autre recherche a pu finir entre-temps). */
  const found: ArtCache = {}
  let changed = false
  let limited = false

  // 1. Appid Steam des jeux EA / Epic / GOG (recherche par nom, 2 à la fois). Une erreur réseau ou 429 n'est pas mise en cache.
  const unknown = games.filter((g) => g.store !== 'steam' && !fresh(g))
  for (let i = 0; i < unknown.length && !limited; i += SEARCH_PARALLEL) {
    await Promise.all(
      unknown.slice(i, i + SEARCH_PARALLEL).map(async (g) => {
        if (limited) return
        try {
          const ids = await findSteamAppIds(g.name)
          cache[g.id] = found[g.id] = { appId: ids[0] ?? null, ...(ids.length > 1 ? { alts: ids.slice(1, 4) } : {}), m: MATCH_VERSION, at: now }
          changed = true
        } catch (e) {
          if (e instanceof RateLimitError) limited = true
          /* hors ligne ou 429 : on réessaiera au prochain scan */
        }
      })
    )
  }

  // 2. Chemins d'images exacts pour tout ce qui a un appid. Un jeu EA / Epic / GOG peut avoir plusieurs jeux Steam au même
  // nom (le jeu et sa fiche « Game of the Year Edition ») : on garde le premier qui a une jaquette.
  const want = new Map<string, string[]>() // id du jeu -> appids candidats
  for (const g of games) {
    const appId = g.store === 'steam' ? g.storeId : cache[g.id]?.appId
    // Un cache d'avant les logos ou les tags (absents) est redemandé une fois.
    const f = fresh(g)
    if (!appId || (f?.assetsFetched && f.logo !== undefined && f.tagIds !== undefined)) continue
    want.set(g.id, [appId, ...(g.store === 'steam' ? [] : (cache[g.id]?.alts ?? []))])
  }
  if (want.size && !limited) {
    try {
      const assets = await fetchAssets([...new Set([...want.values()].flat())])
      for (const [id, cands] of want) {
        const appId = firstWithCover(cands, (c) => !!assets.get(c)?.cover) ?? cands[0]
        const a = assets.get(appId)
        const m = cache[id]?.m
        cache[id] = found[id] = { appId, cover: a?.cover, hero: a?.hero, logo: a?.logo ?? null, tagIds: a?.tagIds ?? [], assetsFetched: true, ...(m ? { m } : {}), at: now }
      }
      changed = true
    } catch (e) {
      if (e instanceof RateLimitError) limited = true
      console.warn('[artwork]', e)
    }
  }

  if (changed) setKv('artwork', { ...getKv<ArtCache>('artwork', {}), ...found })
  // Les noms des tags : une liste commune à tous les jeux, gardée un mois
  if (!limited && Object.values(cache).some((a) => a.tagIds?.length) && (await updateTagNames())) changed = true
  return changed
}

// ---------- Noms des tags Steam ----------
// IStoreService/GetTagList : la liste publique des tags (identifiant → nom anglais), sans clé.

const TAG_MAX_AGE = 30 * 24 * 3600_000
interface TagNames {
  at: number
  names: Record<string, string>
}

/** Va chercher la liste des tags si elle manque ou date de plus d'un mois. Renvoie true si elle a changé. */
async function updateTagNames(): Promise<boolean> {
  if (Date.now() < rateLimitedUntil) return false
  const cur = getKv<TagNames | null>('steamTagNames', null)
  if (cur && Date.now() - cur.at < TAG_MAX_AGE) return false
  try {
    const res = await net.fetch('https://api.steampowered.com/IStoreService/GetTagList/v1/?language=english', {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    })
    if (res.status === 429) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS
      return false
    }
    if (!res.ok) throw new Error(`GetTagList ${res.status}`)
    const tags = ((await res.json()) as { response?: { tags?: { tagid: number; name: string }[] } }).response?.tags ?? []
    if (!tags.length) return false
    const names: Record<string, string> = {}
    for (const t of tags) if (Number.isInteger(t.tagid) && typeof t.name === 'string') names[t.tagid] = t.name
    setKv('steamTagNames', { at: Date.now(), names })
    return true
  } catch (e) {
    // Hors ligne : l'accueil garde le style lu dans la jaquette seule
    console.warn('[artwork] tags', e)
    return false
  }
}

let tagMemo: { stamp: number; names: Record<string, string> } | null = null
function tagNames(): Record<string, string> {
  const stamp = kvStamp('steamTagNames')
  if (!tagMemo || tagMemo.stamp !== stamp) tagMemo = { stamp, names: getKv<TagNames | null>('steamTagNames', null)?.names ?? {} }
  return tagMemo.names
}
const tagsOf = (a: Art | undefined): string[] | undefined => {
  if (!a?.tagIds?.length) return undefined
  const names = tagNames()
  const out = a.tagIds.map((id) => names[id]).filter((n): n is string => !!n)
  return out.length ? out : undefined
}

/** Le cache des jaquettes, relu seulement quand il a changé (il était relu trois fois par affichage de la bibliothèque). Lecture seule. */
let artMemo: { stamp: number; cache: ArtCache } | null = null
function artCache(): ArtCache {
  const stamp = kvStamp('artwork')
  if (!artMemo || artMemo.stamp !== stamp) artMemo = { stamp, cache: getKv<ArtCache>('artwork', {}) }
  return artMemo.cache
}

/** Appid Steam de chaque jeu : le sien pour un jeu Steam, sinon celui retrouvé par son nom (cache des jaquettes). */
export function steamAppIds(games: Game[]): Map<string, string> {
  const cache = artCache()
  const out = new Map<string, string>()
  for (const g of games) {
    const appId = g.store === 'steam' ? g.storeId : cache[g.id]?.appId
    if (appId && /^\d{1,10}$/.test(appId)) out.set(g.id, appId)
  }
  return out
}

/**
 * Logo du jeu : celui du catalogue Steam ; pour un jeu Steam seulement, l'ancien `logo.png` du CDN en secours (la fiche
 * revient au titre si l'image ne charge pas). Jamais d'adresse devinée pour un jeu EA ou Epic.
 */
function logoOf(g: Game, a: Art | undefined): string | undefined {
  if (a?.logo) return a.logo
  return g.store === 'steam' && /^\d{1,10}$/.test(g.storeId) ? `${LEGACY_CDN}${g.storeId}/logo.png` : undefined
}

/** Ajoute le logo et les tags connus (cache local) à chaque jeu, sans réseau : ils ne sont pas gardés dans la table des jeux. */
export function withLogos(games: Game[]): Game[] {
  const cache = artCache()
  return games.map((g) => {
    const logoUrl = logoOf(g, cache[g.id])
    const tags = tagsOf(cache[g.id])
    return logoUrl || tags ? { ...g, ...(logoUrl ? { logoUrl } : {}), ...(tags ? { tags } : {}) } : g
  })
}

/** Applique les images connues (cache local), sans réseau. */
export function applyArtwork(games: Game[]): Game[] {
  const cache = artCache()
  return games.map((g) => {
    const a = cache[g.id]
    const appId = g.store === 'steam' ? g.storeId : a?.appId
    if (!appId) return g
    const logoUrl = logoOf(g, a)
    const tags = tagsOf(a)
    return {
      ...g,
      ...(tags ? { tags } : {}),
      // Ancienne URL en secours : marche encore pour la plupart des jeux sortis avant 2024.
      coverUrl: a?.cover ?? `${LEGACY_CDN}${appId}/library_600x900.jpg`,
      heroUrl: a?.hero ?? `${LEGACY_CDN}${appId}/library_hero.jpg`,
      ...(logoUrl ? { logoUrl } : {})
    }
  })
}
