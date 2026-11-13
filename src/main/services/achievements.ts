import { net } from 'electron'
import { cleanName } from '@shared/text'
import type { Achievement, AchievementsOverview, AchievementsOverviewState, Game, GameAchievements, RareUnlock } from '@shared/types'
import { logError } from '../crashLog'
import { getKv, listGames, setKv } from '../db'
import {
  freshRare,
  isUnlocked,
  mergeAchievements,
  parseBadges,
  parseGlobal,
  parsePlayer,
  parseSchema,
  summarize,
  type GameSummary,
  type PlayerResult,
  type SchemaAch
} from './achievementsFormat'
import { getAccounts, getSettings } from './settings'
import { ownedSteamList, steamLibrary } from './steamLibrary'
import { UserError } from '../errors'

// Succès Steam, avec la clé Steam Web API du joueur :
//  - ISteamUserStats/GetPlayerAchievements : ce que le joueur a débloqué, et quand (profil aux détails de jeu publics) ;
//  - ISteamUserStats/GetSchemaForGame : noms, descriptions, icônes, succès cachés ;
//  - ISteamUserStats/GetGlobalAchievementPercentagesForApp : rareté (sans clé) ;
//  - IPlayerService/GetBadges : niveau Steam et badges.
// Deux lectures :
//  - la fiche d'un jeu : sa liste complète, à l'ouverture (gardée 10 min en mémoire) ;
//  - la page Trophées : un résumé par jeu joué, relevé au plus toutes les 6 h. Seuls les jeux dont le temps de jeu
//    Steam a bougé (ou relevés il y a plus de 7 jours) sont relus : le premier relevé est long, les suivants rapides.

const BASE = 'https://api.steampowered.com'
const LANG = 'french'
const TIMEOUT_MS = 15_000
const GAME_MAX_AGE = 10 * 60_000
/** Schéma et rareté bougent peu. */
const META_MAX_AGE = 24 * 3600_000
const OVERVIEW_MAX_AGE = 6 * 3600_000
const SUMMARY_MAX_AGE = 7 * 24 * 3600_000
/** Après un relevé raté (hors ligne), pas de nouvel essai automatique avant 5 min. */
const RETRY_MS = 5 * 60_000
const PARALLEL = 4
/** Pendant le premier relevé, la page se remplit au fur et à mesure : on enregistre tous les 24 jeux. */
const SAVE_EVERY = 24
const FIRST_RUN_MS = 90_000
const RUN_EVERY_MS = 3600_000

const NETWORK_ERROR = 'Connexion à Steam impossible : vérifie ta connexion internet.'
const SERVICE_ERROR = 'Steam ne répond pas pour le moment. Réessaie dans quelques minutes.'

interface Index {
  steamId: string
  /** Dernier relevé complet (0 : jamais). */
  at: number
  /** appid → résumé. */
  games: Record<string, GameSummary>
  level?: AchievementsOverview['level']
}

const KEY = 'achievementsIndex'

/** `undefined` : pas encore lu dans la base. */
let memo: Index | null | undefined
const gameCache = new Map<string, { at: number; data: GameAchievements }>()
const metaCache = new Map<string, { at: number; schema: SchemaAch[]; global: Record<string, number> }>()
let scan: { done: number; total: number } | null = null
let lastTry = { at: 0, who: '' }

// Succès rares débloqués depuis le relevé précédent d'un jeu (jamais au premier relevé : tout serait « nouveau »).
let rareListener: ((list: RareUnlock[]) => void) | null = null
export function onRareUnlocks(cb: (list: RareUnlock[]) => void): void {
  rareListener = cb
}
function reportRare(appId: string, gameName: string, list: Achievement[], prev: GameSummary | undefined): void {
  if (!prev || !rareListener) return
  const fresh = freshRare(list, prev.at)
  if (fresh.length) rareListener(fresh.map((a) => ({ gameId: `steam:${appId}`, gameName, id: a.id, name: a.name, percent: a.percent! })))
}

function steamId(): string | undefined {
  return getAccounts().find((a) => a.platform === 'steam')?.id
}

function loadIndex(id: string): Index {
  if (memo === undefined) memo = getKv<Index | null>(KEY, null)
  if (!memo || memo.steamId !== id) memo = { steamId: id, at: 0, games: {} }
  return memo
}

function saveIndex(index: Index): void {
  memo = index
  setKv(KEY, index)
}

// ---------- lecture de l'API ----------

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  let res: Response
  try {
    res = await net.fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new UserError(NETWORK_ERROR)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* réponse sans JSON (clé refusée : page HTML) */
  }
  return { status: res.status, body }
}

async function fetchPlayer(appId: string, key: string, id: string): Promise<PlayerResult> {
  const r = await getJson(`${BASE}/ISteamUserStats/GetPlayerAchievements/v1/?key=${encodeURIComponent(key)}&steamid=${id}&appid=${appId}&l=${LANG}`)
  return parsePlayer(r.status, r.body)
}

/** Schéma et rareté d'un jeu. Un échec donne une liste vide (les noms du joueur servent alors) et n'est pas gardé. */
async function fetchMeta(appId: string, key: string): Promise<{ schema: SchemaAch[]; global: Record<string, number> }> {
  const cached = metaCache.get(appId)
  if (cached && Date.now() - cached.at < META_MAX_AGE) return cached
  const [schema, global] = await Promise.all([
    getJson(`${BASE}/ISteamUserStats/GetSchemaForGame/v2/?key=${encodeURIComponent(key)}&appid=${appId}&l=${LANG}`).then(
      (r) => parseSchema(r.body),
      () => []
    ),
    getJson(`${BASE}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}`).then(
      (r) => parseGlobal(r.body),
      () => ({})
    )
  ])
  if (schema.length && Object.keys(global).length) metaCache.set(appId, { at: Date.now(), schema, global })
  return { schema, global }
}

const empty = (state: GameAchievements['state']): GameAchievements => ({ state, list: [], unlocked: 0, total: 0 })

// ---------- fiche d'un jeu ----------

/** Les succès d'un jeu Steam. Les jeux Epic et EA n'en ont pas : aucune API publique. */
export async function getGameAchievements(game: Game, refresh = false): Promise<GameAchievements> {
  const appId = game.store === 'steam' && /^\d{1,10}$/.test(game.storeId) ? game.storeId : null
  if (!appId) return empty('not-steam')
  const id = steamId()
  if (!id) return empty('no-account')
  const key = getSettings().steamApiKey
  if (!key) return empty('no-key')
  const cacheKey = `${id}:${appId}`
  const cached = gameCache.get(cacheKey)
  if (cached && !refresh && Date.now() - cached.at < GAME_MAX_AGE) return cached.data

  let player: PlayerResult
  let meta: Awaited<ReturnType<typeof fetchMeta>>
  try {
    ;[player, meta] = await Promise.all([fetchPlayer(appId, key, id), fetchMeta(appId, key)])
  } catch (e) {
    // Hors ligne : la dernière lecture vaut mieux que rien.
    if (cached) return cached.data
    throw new UserError(e instanceof UserError ? e.message : SERVICE_ERROR)
  }
  // Steam répond aussi « Profile is not public » pour certains jeux d'un profil public (jeu prêté, retiré de la
  // boutique…) : si la liste des jeux du compte est lisible, les détails de jeu sont publics et seul ce jeu est en cause.
  if (player.kind === 'private') return empty(ownedSteamList() ? 'none' : 'private')
  if (player.kind === 'key') return empty('key-refused')
  if (player.kind === 'none') return empty('none')
  if (player.kind === 'error') {
    if (cached) return cached.data
    throw new UserError(SERVICE_ERROR)
  }
  const list = mergeAchievements(player.list, meta.schema, meta.global)
  const data: GameAchievements = { state: 'ready', list, unlocked: list.filter(isUnlocked).length, total: list.length }
  gameCache.set(cacheKey, { at: Date.now(), data })

  // La page Trophées suit ce qu'on vient de lire (si le jeu y est déjà, ou s'il a été joué).
  const index = loadIndex(id)
  const minutes = ownedSteamList()?.find((g) => g.appId === appId)?.minutes ?? game.playtime ?? 0
  if (index.games[appId] || data.unlocked > 0) {
    reportRare(appId, cleanName(game.name), list, index.games[appId])
    saveIndex({ ...index, games: { ...index.games, [appId]: summarize(list, cleanName(game.name), minutes, Date.now()) } })
  }
  return data
}

// ---------- page Trophées ----------

async function runScan(key: string, id: string): Promise<void> {
  // La liste des jeux du compte vient de GetOwnedGames (steamLibrary.ts), relue au besoin.
  let owned = ownedSteamList()
  if (!owned) {
    const lib = await steamLibrary(listGames(), true)
    if (lib.state === 'private' || lib.state === 'key-refused') return
    owned = ownedSteamList()
    if (!owned) return
  }

  const start = loadIndex(id)
  const played = owned.filter((g) => g.minutes > 0).sort((a, b) => b.last - a.last || b.minutes - a.minutes)
  const keep = new Set(played.map((g) => g.appId))
  // Un jeu qui n'est plus sur le compte (remboursé, partage familial arrêté) est oublié.
  const games: Record<string, GameSummary> = Object.fromEntries(Object.entries(start.games).filter(([appId]) => keep.has(appId)))
  const now = Date.now()
  const todo = played.filter((g) => {
    const s = games[g.appId]
    return !s || s.minutes !== g.minutes || now - s.at > SUMMARY_MAX_AGE
  })

  scan = { done: 0, total: todo.length }
  let stop: AchievementsOverviewState | null = null
  let failed = 0
  let done = 0
  /** Jeux pour lesquels Steam a répondu « Profile is not public ». */
  let refused = 0
  let unsaved = 0
  for (let i = 0; i < todo.length && !stop; i += PARALLEL) {
    await Promise.all(
      todo.slice(i, i + PARALLEL).map(async (g) => {
        try {
          const player = await fetchPlayer(g.appId, key, id)
          if (player.kind === 'key') {
            stop = 'key-refused'
            return
          }
          // Un seul jeu refusé ne veut pas dire que le profil est privé (voir getGameAchievements) : on le passe,
          // sans le noter, pour le relire au prochain relevé.
          if (player.kind === 'private') {
            refused++
            return
          }
          if (player.kind === 'none') {
            games[g.appId] = { at: Date.now(), minutes: g.minutes, name: g.name, total: 0, unlocked: 0, picks: [] }
            return
          }
          if (player.kind === 'error') {
            failed++
            return
          }
          // Rien de débloqué : pas besoin des icônes ni de la rareté pour la page.
          const meta = player.list.some((a) => a.achieved) ? await fetchMeta(g.appId, key) : { schema: [], global: {} }
          const merged = mergeAchievements(player.list, meta.schema, meta.global)
          reportRare(g.appId, g.name, merged, loadIndex(id).games[g.appId] ?? start.games[g.appId])
          games[g.appId] = summarize(merged, g.name, g.minutes, Date.now())
        } catch {
          failed++
        } finally {
          if (scan) scan.done++
          done++
          unsaved++
        }
      })
    )
    // Tous les jeux lus jusqu'ici refusés : là, c'est bien le profil qui est privé.
    if (!stop && refused === done && (done >= 8 || done === todo.length)) stop = 'private'
    if (unsaved >= SAVE_EVERY) {
      unsaved = 0
      saveIndex({ ...loadIndex(id), games: { ...games } })
    }
  }

  let level = start.level
  if (!stop) {
    try {
      level = parseBadges((await getJson(`${BASE}/IPlayerService/GetBadges/v1/?key=${encodeURIComponent(key)}&steamid=${id}`)).body) ?? level
    } catch {
      /* le niveau attendra le prochain relevé */
    }
  }
  // Tout a échoué (hors ligne) : le relevé n'est pas compté comme fait, il sera retenté.
  const offline = todo.length > 0 && failed === todo.length
  saveIndex({ steamId: id, at: stop || offline ? start.at : Date.now(), games, ...(level ? { level } : {}) })
}

/** Lance le relevé s'il a plus de 6 h (ou tout de suite avec `force`), sauf s'il vient d'échouer. */
function ensureScan(force: boolean): void {
  const key = getSettings().steamApiKey
  const id = steamId()
  if (!key || !id || scan) return
  const index = loadIndex(id)
  const who = `${id}:${key}`
  const stale = Date.now() - index.at > OVERVIEW_MAX_AGE
  if (!force && (!stale || (lastTry.who === who && Date.now() - lastTry.at < RETRY_MS))) return
  lastTry = { at: Date.now(), who }
  scan = { done: 0, total: 0 }
  runScan(key, id)
    .catch((e) => logError('succès', e))
    .finally(() => (scan = null))
}

/** Premier relevé peu après le démarrage (pour que la page Trophées soit prête), puis vérifié toutes les heures. */
export function startAchievementsWatcher(isDemo: () => boolean): void {
  const run = (): void => {
    if (!isDemo()) ensureScan(false)
  }
  setTimeout(run, FIRST_RUN_MS)
  setInterval(run, RUN_EVERY_MS)
}
