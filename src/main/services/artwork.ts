import { cleanName as clean, norm } from '@shared/text'
import { NOT_FOUND_RETRY_MS, pickExact, searchTerms } from './artworkMatch'
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

interface Art {
  appId: string | null
  cover?: string
  hero?: string
  /** Logo du jeu (catalogue Steam). null : demandé, Steam n'en a pas. Absent : pas encore demandé. */
  logo?: string | null
  /** Les chemins d'images ont été demandés à Steam (même si aucune image n'existe). */
  assetsFetched?: boolean
  at: number
}

type ArtCache = Record<string, Art>

/** Appid Steam d'un jeu non-Steam, seulement si le nom correspond vraiment (pas le premier résultat venu). */
async function findSteamAppId(name: string): Promise<string | null> {
  // Plusieurs façons d'écrire la recherche : Steam ne retrouve pas toujours un titre avec « : » ou une édition. Une erreur
  // du réseau remonte (rien n'est gardé en cache), un « pas trouvé » ne sort qu'après tous les essais.
  for (const term of searchTerms(name)) {
    const res = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=french&cc=FR`, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`storesearch ${res.status}`)
    const items = ((await res.json()) as { items?: { id: number; name: string }[] }).items ?? []
    const id = pickExact(items, name)
    if (id) return id
  }
  console.warn('[artwork] jeu introuvable sur Steam :', name, '| recherches :', searchTerms(name).join(' ; '))
  return null
}

interface StoreItem {
  appid: number
  assets?: Record<string, string> & { asset_url_format?: string }
}

/** Chemins exacts des images pour une liste d'appids (par lots de 50). */
export async function fetchAssets(appIds: string[]): Promise<Map<string, { cover?: string; hero?: string; logo?: string }>> {
  const out = new Map<string, { cover?: string; hero?: string; logo?: string }>()
  for (let i = 0; i < appIds.length; i += 50) {
    const input = {
      ids: appIds.slice(i, i + 50).map((id) => ({ appid: Number(id) })),
      context: { language: 'french', country_code: 'FR' },
      data_request: { include_assets: true }
    }
    const res = await fetch(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, {
      // Sans limite, une réponse qui ne vient jamais bloquait les jaquettes jusqu'au redémarrage
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) throw new Error(`GetItems ${res.status}`)
    const items = ((await res.json()) as { response?: { store_items?: StoreItem[] } }).response?.store_items ?? []
    for (const item of items) {
      const a = item.assets
      if (!a?.asset_url_format) continue
      const url = (file?: string): string | undefined => (file ? CDN + a.asset_url_format!.replace('${FILENAME}', file).replace(/\?.*$/, '') : undefined)
      out.set(String(item.appid), {
        cover: url(a.library_capsule_2x ?? a.library_capsule),
        hero: url(a.library_hero ?? a.library_hero_2x ?? a.page_background ?? a.header),
        logo: url(a.library_logo_2x ?? a.library_logo)
      })
    }
  }
  return out
}

/** Va chercher sur Steam les images manquantes ou périmées. Renvoie true si le cache a changé. */
export async function updateArtwork(games: Game[]): Promise<boolean> {
  const cache = getKv<ArtCache>('artwork', {})
  const now = Date.now()
  const fresh = (g: Game): Art | undefined => {
    const a = cache[g.id]
    // Un « pas trouvé » (appId null) est réessayé au bout de 6 h seulement : une semaine était trop long.
    return a && now - a.at < (a.appId ? MAX_AGE : NOT_FOUND_RETRY_MS) ? a : undefined
  }
  /** Ce que cette recherche a trouvé : seul écrit à la fin, par-dessus le cache relu (une autre recherche a pu finir entre-temps). */
  const found: ArtCache = {}
  let changed = false

  // 1. Appid Steam des jeux EA / Epic (recherche par nom, 4 à la fois). Une erreur réseau n'est pas mise en cache.
  const unknown = games.filter((g) => g.store !== 'steam' && !fresh(g))
  for (let i = 0; i < unknown.length; i += 4) {
    await Promise.all(
      unknown.slice(i, i + 4).map(async (g) => {
        try {
          cache[g.id] = found[g.id] = { appId: await findSteamAppId(g.name), at: now }
          changed = true
        } catch {
          /* hors ligne : on réessaiera au prochain scan */
        }
      })
    )
  }

  // 2. Chemins d'images exacts pour tout ce qui a un appid.
  const toFetch = new Map<string, string[]>() // appid -> ids de jeux
  for (const g of games) {
    const appId = g.store === 'steam' ? g.storeId : cache[g.id]?.appId
    // Un cache d'avant les logos (logo absent) est redemandé une fois.
    if (!appId || (fresh(g)?.assetsFetched && fresh(g)?.logo !== undefined)) continue
    toFetch.set(appId, [...(toFetch.get(appId) ?? []), g.id])
  }
  if (toFetch.size) {
    try {
      const assets = await fetchAssets([...toFetch.keys()])
      for (const [appId, ids] of toFetch) {
        const a = assets.get(appId)
        for (const id of ids) cache[id] = found[id] = { appId, cover: a?.cover, hero: a?.hero, logo: a?.logo ?? null, assetsFetched: true, at: now }
      }
      changed = true
    } catch (e) {
      console.warn('[artwork]', e)
    }
  }

  if (changed) setKv('artwork', { ...getKv<ArtCache>('artwork', {}), ...found })
  return changed
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

/** Ajoute le logo connu (cache local) à chaque jeu, sans réseau : il n'est pas gardé dans la table des jeux. */
export function withLogos(games: Game[]): Game[] {
  const cache = artCache()
  return games.map((g) => {
    const logoUrl = logoOf(g, cache[g.id])
    return logoUrl ? { ...g, logoUrl } : g
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
    return {
      ...g,
      // Ancienne URL en secours : marche encore pour la plupart des jeux sortis avant 2024.
      coverUrl: a?.cover ?? `${LEGACY_CDN}${appId}/library_600x900.jpg`,
      heroUrl: a?.hero ?? `${LEGACY_CDN}${appId}/library_hero.jpg`,
      ...(logoUrl ? { logoUrl } : {})
    }
  })
}
