import { net } from 'electron'
import type { Game, GameNews, NewsPost } from '@shared/types'
import { getKv, setKv } from '../db'
import { steamAppIds } from './artwork'
import { entryFrom, fetchAll, needsRefresh, nextSeen, olderThanAll, patchFlags, postsStillFresh, type NewsIndex } from './newsFeed'
import { cleanRawNews, frenchPost, frenchTexts, toNewsPost, type RawNews } from './newsFormat'
import { getSettings } from './settings'
import { UserError } from '../errors'

// Actus des jeux : les annonces officielles publiées sur Steam (notes de patch comprises), via ISteamNews/GetNewsForApp.
// API publique, sans clé. Les jeux EA et Epic passent par l'appid Steam trouvé pour leurs jaquettes (artwork.ts).
// Deux lectures :
//  - la fiche d'un jeu : ses dernières annonces complètes, à l'ouverture (gardées 30 min en mémoire) ;
//  - le relevé : les titres des dernières annonces de chaque jeu, au plus toutes les 6 h. Il donne le badge
//    « Nouveau patch » et le dernier patch du jeu (newsFeed.ts).

const API = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/'
/**
 * Liste d'événements du magasin, celle du site Steam : elle donne la version française d'une annonce quand l'éditeur l'a
 * écrite, et les événements datés du jeu (saisons, bonus d'XP… : events.ts).
 */
const EVENTS_API = 'https://store.steampowered.com/events/ajaxgetpartnereventspageable/'
/** La version française ne retarde pas la fiche : passé ce délai, l'annonce s'affiche dans sa langue d'origine. */
const FRENCH_TIMEOUT_MS = 6_000
/** Assez d'événements pour les annonces de la fiche et les événements datés à venir. */
const STORE_COUNT = 20
/** Après un échec, la liste est redemandée au bout de 2 min (sinon 30 min, comme les annonces). */
const STORE_RETRY_MS = 2 * 60_000
const TIMEOUT_MS = 15_000
const POSTS_COUNT = 8
const POSTS_MAX_AGE = 30 * 60_000
const INDEX_MAX_AGE = 6 * 3600_000
/** Un relevé qui n'a pas été refait depuis (jeu désinstallé) est oublié. */
const INDEX_FORGET_MS = 30 * 24 * 3600_000
/** Premier relevé des badges peu après le démarrage, puis toutes les heures (seuls les jeux relevés il y a plus de 6 h sont redemandés). */
const FIRST_RUN_MS = 45_000
const RUN_EVERY_MS = 3600_000
const PARALLEL = 4

const NETWORK_ERROR = 'Connexion à Steam impossible : vérifie ta connexion internet.'
const SERVICE_ERROR = 'Steam ne répond pas pour le moment. Réessaie dans quelques minutes.'

/** appid → annonces complètes lues pour la fiche. */
const posts = new Map<string, { at: number; posts: NewsPost[] }>()
let onChange: () => void = () => {}

/** Source des annonces à la place de Steam : le simulateur de développement (newsSim.ts), jamais dans l'installeur. */
type NewsSource = (appId: string, count: number, maxlength: number, enddate?: number) => Promise<unknown[]>
let source: NewsSource | null = null

export function setNewsSource(fn: NewsSource | null): void {
  source = fn
  posts.clear()
  stores.clear()
}

/** Versions françaises du simulateur (événements au format du magasin), à la place de la liste d'événements de Steam. */
type FrenchSource = (appId: string) => Promise<unknown[]>
let frenchSource: FrenchSource | null = null

export function setFrenchSource(fn: FrenchSource | null): void {
  frenchSource = fn
  posts.clear()
  stores.clear()
}

/** Le simulateur a son propre relevé : les vrais ne sont jamais mélangés à des annonces inventées. */
function indexKey(): string {
  return source ? 'newsSimIndex' : 'newsIndex'
}

/** Comme le reste du mode démo, ce qui a été vu dans les fiches de démo vit à part (et celles du simulateur aussi). */
function seenKey(): string {
  if (source) return 'simNewsSeen'
  return getSettings().demoMode ? 'demoNewsSeen' : 'newsSeen'
}

function seenMap(): Record<string, number> {
  return getKv<Record<string, number>>(seenKey(), {})
}

function readIndex(): NewsIndex {
  return getKv<NewsIndex>(indexKey(), {})
}

// ---------- lecture de l'API ----------

/** `enddate` (secondes) : seulement les annonces publiées avant. */
async function fetchNews(appId: string, count: number, maxlength: number, enddate?: number): Promise<RawNews[]> {
  let items: unknown
  if (source) {
    try {
      items = await source(appId, count, maxlength, enddate)
    } catch {
      throw new UserError(NETWORK_ERROR)
    }
  } else {
    const before = enddate ? `&enddate=${enddate}` : ''
    const url = `${API}?appid=${appId}&count=${count}&maxlength=${maxlength}${before}&feeds=steam_community_announcements&format=json`
    let res: Response
    try {
      res = await net.fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new UserError(NETWORK_ERROR)
    }
    if (!res.ok) throw new UserError(SERVICE_ERROR)
    let body: { appnews?: { newsitems?: unknown } }
    try {
      body = (await res.json()) as typeof body
    } catch {
      throw new UserError(SERVICE_ERROR)
    }
    items = body?.appnews?.newsitems
  }
  return (Array.isArray(items) ? items : [])
    .map(cleanRawNews)
    .filter((n): n is RawNews => !!n)
    .sort((a, b) => b.date - a.date)
}

/** Liste d'événements du magasin pour un appid ; null si Steam ne répond pas. Avec le simulateur, jamais de vraie requête. */
async function fetchStoreEvents(appId: string): Promise<unknown[] | null> {
  try {
    if (source) return frenchSource ? await frenchSource(appId) : []
    const url = `${EVENTS_API}?clan_accountid=0&appid=${appId}&offset=0&count=${STORE_COUNT}&l=french`
    const res = await net.fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(FRENCH_TIMEOUT_MS) })
    if (!res.ok) return null
    const body = (await res.json()) as { events?: unknown }
    return Array.isArray(body?.events) ? body.events : []
  } catch {
    return null
  }
}

/** appid → dernière liste d'événements du magasin, et si Steam a répondu. */
const stores = new Map<string, { at: number; ok: boolean; events: unknown[] }>()
const storeRuns = new Map<string, Promise<unknown[]>>()

/**
 * Événements du magasin en français (versions traduites par l'éditeur, sinon l'anglais) : gardés 30 min, partagés par
 * les actus (traductions) et les événements datés. Ne rejette jamais : sans réponse, une liste vide.
 */
export function storeEvents(appId: string, refresh = false): Promise<unknown[]> {
  const c = stores.get(appId)
  if (!refresh && c && Date.now() - c.at < (c.ok ? POSTS_MAX_AGE : STORE_RETRY_MS)) return Promise.resolve(c.events)
  let run = storeRuns.get(appId)
  if (!run) {
    run = fetchStoreEvents(appId)
      .then((events) => {
        stores.delete(appId)
        stores.set(appId, { at: Date.now(), ok: events !== null, events: events ?? [] })
        if (stores.size > 100) stores.delete(stores.keys().next().value as string)
        return events ?? []
      })
      .finally(() => storeRuns.delete(appId))
    storeRuns.set(appId, run)
  }
  return run
}

const itemIds = (e: NewsIndex[string] | undefined): string => (e?.items ?? []).map((i) => i.id).join(',')

/** Range les relevés ; prévient l'interface si un badge peut avoir changé. Renvoie true dans ce cas. */
function updateIndex(updates: NewsIndex): boolean {
  const now = Date.now()
  const index = readIndex()
  const changed = Object.entries(updates).some(
    ([id, e]) => index[id]?.patch?.id !== e.patch?.id || index[id]?.latest !== e.latest || !index[id]?.items || itemIds(index[id]) !== itemIds(e)
  )
  const next = Object.fromEntries(Object.entries({ ...index, ...updates }).filter(([, e]) => now - e.at < INDEX_FORGET_MS))
  setKv(indexKey(), next)
  if (changed) onChange()
  return changed
}

// ---------- fiche d'un jeu ----------

export async function getGameNews(game: Game, refresh = false): Promise<GameNews> {
  const appId = steamAppIds([game]).get(game.id) ?? null
  const seenAt = seenMap()[game.id] ?? 0
  if (!appId) return { appId: null, posts: [], seenAt }
  const cached = posts.get(appId)
  const index = readIndex()
  // Le relevé connaît une annonce plus récente (trouvée par « Actualiser ») : relue, sinon elle ne s'ouvrirait pas.
  const fresh = postsStillFresh(cached && { at: cached.at, newest: cached.posts[0]?.date ?? 0 }, index[appId]?.latest ?? 0, Date.now(), POSTS_MAX_AGE)
  if (cached && !refresh && fresh) return { appId, posts: cached.posts, seenAt }
  // Version française demandée en même temps que les annonces : elle ne rallonge pas l'attente.
  const french = storeEvents(appId, refresh)
  let raw: RawNews[]
  try {
    raw = await fetchNews(appId, POSTS_COUNT, 0)
  } catch (e) {
    // Hors ligne : la dernière lecture vaut mieux que rien.
    if (cached) return { appId, posts: cached.posts, seenAt }
    throw new UserError(e instanceof UserError ? e.message : SERVICE_ERROR)
  }
  // Dernier patch gardé par le relevé mais sorti de ces annonces (jeu qui publie beaucoup) : lu à part, sinon « Dernier
  // patch » sur l'accueil et le bandeau de la fiche s'ouvriraient sur « Cette annonce n'est plus dans les dernières actus ».
  const kept = index[appId]?.patch
  if (kept && olderThanAll(raw, kept.date)) {
    const older = await fetchNews(appId, 1, 0, Math.floor(kept.date / 1000) + 1).catch(() => [])
    if (older[0]?.gid === kept.id) raw = [...raw, older[0]]
  }
  const now = Date.now()
  // Le français de l'éditeur quand il existe ; le relevé (badges) garde les titres d'origine.
  const fr = frenchTexts(raw, await french)
  const list = raw.map((r) => {
    const post = toNewsPost(r)
    const text = fr.get(r.gid)
    return text ? frenchPost(post, text) : post
  })
  posts.set(appId, { at: now, posts: list })
  // Le badge suit ce qu'on vient de lire.
  updateIndex({ [appId]: entryFrom(raw, now, index[appId]) })
  return { appId, posts: list, seenAt }
}

/** Date de la plus récente annonce connue d'un jeu (relevé ou fiche). */
function latestOf(index: NewsIndex, appId: string): number {
  return Math.max(index[appId]?.latest ?? 0, posts.get(appId)?.posts[0]?.date ?? 0)
}

/**
 * Les actus de ce jeu ont été vues : plus de badge jusqu'à la prochaine annonce. `upTo` : seulement jusqu'à cette annonce
 * (lue dans la fiche). Les jeux qui partagent son appid (Battlefield 6 sur EA et sur Steam) suivent.
 */
export function markNewsSeen(game: Game, upTo?: number, siblings: Game[] = []): void {
  const ids = steamAppIds([game, ...siblings])
  const appId = ids.get(game.id)
  if (!appId) return
  const latest = latestOf(readIndex(), appId)
  const key = seenKey()
  const seen = getKv<Record<string, number>>(key, {})
  const next = { ...seen }
  let changed = false
  for (const g of [game, ...siblings.filter((s) => ids.get(s.id) === appId)]) {
    const v = nextSeen(seen[g.id] ?? 0, latest, upTo)
    if (v === (seen[g.id] ?? 0)) continue
    next[g.id] = v
    changed = true
  }
  if (!changed) return
  setKv(key, next)
  onChange()
}

// ---------- badges « Nouveau patch » et dernier patch ----------

/** Ajoute le dernier patch publié sur Steam, et le badge si ce patch date de moins de 7 jours et n'a pas été vu dans la fiche. */
export function withNews(games: Game[]): Game[] {
  if (!getSettings().gameNews) return games
  const index = readIndex()
  const seen = seenMap()
  const ids = steamAppIds(games)
  const now = Date.now()
  return games.map((g) => {
    const appId = ids.get(g.id)
    return appId ? { ...g, ...patchFlags(index[appId], seen[g.id] ?? 0, now) } : g
  })
}

/** Relevé en cours : un deuxième appel attend la fin de celui-ci. */
let running: Promise<void> | null = null

async function runIndex(games: Game[], maxAge: number): Promise<void> {
  const index = readIndex()
  const now = Date.now()
  const stale = [...new Set(steamAppIds(games).values())].filter((id) => needsRefresh(index[id], now, maxAge))
  if (!stale.length) return
  // Titres seulement (le texte des annonces n'est lu qu'à l'ouverture de la fiche), mais autant d'annonces que la fiche :
  // le dernier patch est cherché dans les mêmes, sinon il apparaissait et disparaissait selon qui avait relevé en dernier.
  // Hors ligne ou Steam indisponible : redemandé au prochain passage.
  const { results } = await fetchAll(
    stale,
    PARALLEL,
    async (appId) => entryFrom(await fetchNews(appId, POSTS_COUNT, 1), Date.now(), index[appId]),
    (e) => e instanceof UserError && e.message === NETWORK_ERROR
  )
  const updates: NewsIndex = Object.fromEntries(results)
  if (Object.keys(updates).length) updateIndex(updates)
}

/** Relève les dernières annonces des jeux qui n'ont pas été relevés depuis `maxAge` (6 h par défaut). */
export async function refreshNewsIndex(games: Game[], { maxAge = INDEX_MAX_AGE }: { maxAge?: number } = {}): Promise<void> {
  if (!getSettings().gameNews) return
  // Un relevé déjà en route : on l'attend, puis on ne redemande que ce qui reste à relever.
  while (running) await running
  running = runIndex(games, maxAge).finally(() => (running = null))
  await running
}

/** `listGames` : la bibliothèque affichée (vraie ou de démo). `notify` : les badges ont pu changer. */
export function startNewsWatcher(listGames: () => Game[], notify: () => void): void {
  onChange = notify
  const run = (): void => {
    Promise.resolve()
      .then(() => refreshNewsIndex(listGames()))
      .catch(() => {})
  }
  setTimeout(run, FIRST_RUN_MS)
  setInterval(run, RUN_EVERY_MS)
}
