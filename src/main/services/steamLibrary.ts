import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { net, shell } from 'electron'
import { hasName, KNOWN_SOFTWARE, parseAppListPage } from '@shared/steamApps'
import type { Game, SteamLibrary } from '@shared/types'
import { deleteKv, getKv, setKv } from '../db'
import { isSteamTool, steamLibraryDirs } from './games'
import { getAccounts, getSettings } from './settings'
import { logError } from '../crashLog'

// Tous les jeux du compte Steam, installés ou non : IPlayerService/GetOwnedGames, avec la clé Steam Web API.
// Steam ne donne la liste que si les « détails des jeux » du profil sont publics, quelle que soit la clé.
// La même réponse donne le temps de jeu Steam (playtime.ts) : un seul appel pour les deux, au plus toutes les heures.

const API = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'
const APP_LIST = 'https://api.steampowered.com/IStoreService/GetAppList/v1/'
/** Logiciels du magasin : relus une fois par semaine (la liste change peu). */
const SOFTWARE_MAX_AGE = 7 * 24 * 3600_000
const SOFTWARE_KEY = 'steamSoftware'
/** Au plus autant de pages de 50 000 (le magasin a bien moins de logiciels). */
const SOFTWARE_PAGES = 4
const MAX_AGE = 3600_000
/** Après un échec (hors ligne, clé refusée), pas de nouvel essai automatique avant 5 min. */
const RETRY_MS = 5 * 60_000
const TIMEOUT_MS = 20_000
/** Après « Installer » : on guette la fin du téléchargement toutes les 20 s, 6 h au plus (ensuite, le prochain scan le trouvera). */
const INSTALL_CHECK_MS = 20_000
const INSTALL_WATCH_MS = 6 * 3600_000

/** appid → [nom, minutes de jeu, dernière partie en secondes (0 : jamais)]. Compact : un compte peut avoir des milliers de jeux. */
type Owned = Record<string, [string, number, number]>

interface OwnedCache {
  at: number
  steamId: string
  /** Détails des jeux privés sur le profil : Steam ne donne pas la liste. */
  hidden: boolean
  games: Owned
}

const KEY = 'steamOwned'
/** Relevé du temps de jeu Steam des versions avant la 0.7.1, remplacé par cette liste. */
const OLD_KEY = 'steamPlaytime'

/** `undefined` : pas encore lu dans la base. */
let cache: OwnedCache | null | undefined
let loading: Promise<void> | null = null
/** Dernier essai : quand, et pour quel compte et quelle clé (une nouvelle clé est essayée tout de suite). */
let lastTry = { at: 0, who: '' }
let lastError: 'key' | 'offline' | null = null
/** Temps de jeu et dernière partie par appid, recalculés seulement quand la liste change. */
let memo: { from: OwnedCache; minutes: Record<string, number>; last: Record<string, number> } | null = null
let onChange: () => void = () => {}
let onInstalled: () => void = () => {}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)

function steamId(): string | undefined {
  return getAccounts().find((a) => a.platform === 'steam')?.id
}

/** La liste du compte Steam connecté, s'il y a une clé Web API. */
function mine(): OwnedCache | null {
  if (cache === undefined) cache = getKv<OwnedCache | null>(KEY, null)
  const id = steamId()
  return cache && id && cache.steamId === id && getSettings().steamApiKey ? cache : null
}

async function fetchOwned(key: string, id: string): Promise<void> {
  const url = `${API}?key=${encodeURIComponent(key)}&steamid=${id}&include_appinfo=1&include_played_free_games=1&skip_unvetted_apps=0&format=json`
  try {
    const res = await net.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      lastError = res.status === 401 || res.status === 403 ? 'key' : 'offline'
      return
    }
    const r = ((await res.json()) as { response?: { game_count?: unknown; games?: unknown } })?.response ?? {}
    const games: Owned = {}
    for (const g of Array.isArray(r.games) ? (r.games as Record<string, unknown>[]) : []) {
      const appId = typeof g?.appid === 'number' && Number.isSafeInteger(g.appid) && g.appid > 0 ? String(g.appid) : ''
      const name = typeof g?.name === 'string' ? g.name.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
      if (!appId || !name || isSteamTool(appId, name) || /dedicated server|\bsdk\b/i.test(name)) continue
      games[appId] = [name, count(g.playtime_forever), count(g.rtime_last_played)]
    }
    // Profil aux détails de jeu privés : réponse vide, sans même le nombre de jeux.
    cache = { at: Date.now(), steamId: id, hidden: typeof r.game_count !== 'number', games }
    setKv(KEY, cache)
    if (getKv<unknown>(OLD_KEY, null) !== null) deleteKv(OLD_KEY)
    lastError = null
    onChange()
  } catch {
    lastError = 'offline'
  }
}

// ---------- logiciels ----------

interface SoftwareCache {
  at: number
  ids: string[]
}
/** `undefined` : pas encore lu dans la base. */
let software: Set<string> | undefined
let softwareAt = 0
let softwareLoading: Promise<void> | null = null
let softwareTry = 0

function softwareSet(): Set<string> {
  if (software === undefined) {
    const c = getKv<SoftwareCache | null>(SOFTWARE_KEY, null)
    software = new Set([...KNOWN_SOFTWARE, ...(Array.isArray(c?.ids) ? c.ids : [])])
    softwareAt = typeof c?.at === 'number' ? c.at : 0
  }
  return software
}

/** Logiciel Steam (pas un jeu) : masqué de la bibliothèque, installé ou non. */
export function isSteamSoftware(appId: string): boolean {
  return softwareSet().has(appId)
}

async function fetchSoftware(key: string): Promise<void> {
  const ids: string[] = []
  let last = 0
  try {
    for (let i = 0; i < SOFTWARE_PAGES; i++) {
      const url = `${APP_LIST}?key=${encodeURIComponent(key)}&include_games=false&include_software=true&max_results=50000${last ? `&last_appid=${last}` : ''}`
      const res = await net.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) return
      const page = parseAppListPage(await res.json())
      if (!page) return
      ids.push(...page.ids)
      if (!page.next) break
      last = page.next
    }
  } catch {
    return
  }
  // Une liste vide est suspecte (clé refusée, réponse tronquée) : on garde l'ancienne.
  if (!ids.length) return
  const before = softwareSet().size
  software = new Set([...KNOWN_SOFTWARE, ...ids])
  softwareAt = Date.now()
  setKv(SOFTWARE_KEY, { at: softwareAt, ids } satisfies SoftwareCache)
  if (software.size !== before) onChange()
}

/** Relit la liste des logiciels du magasin au plus une fois par semaine (essai au plus toutes les 5 min après un échec). */
function ensureSoftware(key: string): void {
  softwareSet()
  if (softwareLoading || Date.now() - softwareAt < SOFTWARE_MAX_AGE || Date.now() - softwareTry < RETRY_MS) return
  softwareTry = Date.now()
  softwareLoading = fetchSoftware(key).finally(() => (softwareLoading = null))
}

/** Relit la liste si elle a plus d'une heure (ou tout de suite avec `force`). Renvoie la lecture en cours, s'il y en a une. */
function ensure(force = false): Promise<void> | null {
  const key = getSettings().steamApiKey
  const id = steamId()
  if (key) ensureSoftware(key)
  if (!key || !id) return null
  const list = mine()
  const stale = !list || Date.now() - list.at > MAX_AGE
  const who = `${id}:${key}`
  if (!loading && (force || (stale && (lastTry.who !== who || Date.now() - lastTry.at > RETRY_MS)))) {
    lastTry = { at: Date.now(), who }
    loading = fetchOwned(key, id).finally(() => (loading = null))
  }
  return loading
}

function ownedGame(appId: string, [name, minutes, last]: [string, number, number]): Game {
  return {
    id: `steam:${appId}`,
    store: 'steam',
    storeId: appId,
    name,
    notInstalled: true,
    ...(last ? { lastPlayed: last * 1000, lastPlayedSource: 'steam' as const } : {}),
    ...(minutes ? { playtime: minutes, playtimeSource: 'steam' as const } : {})
  }
}

/** Relit la liste au besoin (en arrière-plan) et renvoie ses chiffres par appid. */
function stats(): { minutes: Record<string, number>; last: Record<string, number> } | null {
  void ensure()
  const list = mine()
  if (!list) return null
  if (memo?.from !== list) {
    const minutes: Record<string, number> = {}
    const last: Record<string, number> = {}
    for (const [id, g] of Object.entries(list.games)) {
      minutes[id] = g[1]
      if (g[2] > 0) last[id] = g[2] * 1000
    }
    memo = { from: list, minutes, last }
  }
  return memo
}

/** Temps de jeu selon Steam (appid → minutes), pour le compte connecté ; vide sans clé Web API. */
export function steamMinutes(): Record<string, number> {
  return stats()?.minutes ?? {}
}

/** Dernière partie selon Steam (appid → ms), compte connecté ; vide sans clé Web API. */
export function steamLastPlayed(): Record<string, number> {
  return stats()?.last ?? {}
}

/** Jeux du compte Steam absents de `installed`, et pourquoi la liste manque le cas échéant. */
export async function steamLibrary(installed: Game[], refresh = false): Promise<SteamLibrary> {
  const none = (state: SteamLibrary['state']): SteamLibrary => ({ state, notInstalled: [], owned: 0 })
  if (!steamId()) return none('no-account')
  if (!getSettings().steamApiKey) return none('no-key')
  const reading = ensure(refresh)
  if (refresh && reading) await reading
  const list = mine()
  if (!list) return none(loading ? 'loading' : lastError === 'key' ? 'key-refused' : 'offline')
  if (list.hidden) return none('private')
  const here = new Set(installed.filter((g) => g.store === 'steam').map((g) => g.storeId))
  const notInstalled = Object.entries(list.games)
    .filter(([appId, g]) => !here.has(appId) && !isSteamSoftware(appId) && hasName(g[0]))
    .map(([appId, g]) => ownedGame(appId, g))
  return { state: 'ready', notInstalled, owned: Object.keys(list.games).length }
}

/** Jeux de la dernière liste Steam (succès) ; null sans liste, ou si les détails des jeux du profil sont privés. */
export function ownedSteamList(): { appId: string; name: string; minutes: number; last: number }[] | null {
  const list = mine()
  if (!list || list.hidden) return null
  return Object.entries(list.games).map(([appId, [name, minutes, last]]) => ({ appId, name, minutes, last: last * 1000 }))
}

/** Relevé des actus : au plus tant de jeux du compte pas installés, pour que l'appel à Steam reste léger avec un gros compte. */
const NEWS_OWNED_MAX = 30

/**
 * Jeux du compte Steam pas installés sur ce PC que le relevé des actus suit aussi (badge « Nouveau patch » sur leur jaquette,
 * dans la Bibliothèque) : les plus récemment joués, NEWS_OWNED_MAX au plus, sans les logiciels ni les entrées sans nom.
 */
export function ownedForNews(installed: Game[]): Game[] {
  const list = mine()
  if (!list || list.hidden) return []
  const here = new Set(installed.filter((g) => g.store === 'steam').map((g) => g.storeId))
  return Object.entries(list.games)
    .filter(([appId, g]) => !here.has(appId) && !isSteamSoftware(appId) && hasName(g[0]))
    .sort(([, a], [, b]) => b[2] - a[2] || b[1] - a[1])
    .slice(0, NEWS_OWNED_MAX)
    .map(([appId, g]) => ownedGame(appId, g))
}

/** Un jeu de la dernière liste Steam, installé ou non (pour retrouver la fiche d'un jeu non installé). */
export function ownedSteamGame(id: string): Game | null {
  const appId = /^steam:(\d{1,10})$/.exec(id)?.[1]
  const g = appId ? mine()?.games[appId] : undefined
  return appId && g ? ownedGame(appId, g) : null
}

// ---------- installation ----------

/** appid → début du suivi. */
const pending = new Map<string, number>()
let watch: ReturnType<typeof setInterval> | null = null
let checking = false

/** Le manifeste Steam du jeu dit « entièrement installé » (bit 4 de StateFlags, posé à la fin du téléchargement). */
async function installedIn(dirs: string[], appId: string): Promise<boolean> {
  for (const dir of dirs) {
    try {
      const acf = await readFile(join(dir, 'steamapps', `appmanifest_${appId}.acf`), 'utf8')
      if (Number(/"StateFlags"\s+"(\d+)"/i.exec(acf)?.[1] ?? 0) & 4) return true
    } catch {
      /* pas dans cette bibliothèque */
    }
  }
  return false
}

async function checkInstalls(): Promise<void> {
  if (checking) return
  checking = true
  try {
    // Relu à chaque fois : Steam a pu ajouter une bibliothèque sur un autre disque pour ce jeu.
    const dirs = await steamLibraryDirs()
    let done = false
    for (const [appId, since] of [...pending]) {
      if (await installedIn(dirs, appId)) {
        pending.delete(appId)
        done = true
      } else if (Date.now() - since > INSTALL_WATCH_MS) pending.delete(appId)
    }
    if (!pending.size && watch) {
      clearInterval(watch)
      watch = null
    }
    if (done) onInstalled()
  } catch (e) {
    logError('installation Steam', e)
  } finally {
    checking = false
  }
}

/** Ouvre l'installation dans Steam (choix du disque, téléchargement), puis guette la fin pour ajouter le jeu à la bibliothèque. */
export async function installSteamGame(appId: string): Promise<void> {
  if (!/^\d{1,10}$/.test(appId)) throw new Error('Jeu introuvable.')
  await shell.openExternal(`steam://install/${appId}`)
  pending.set(appId, Date.now())
  watch ??= setInterval(() => void checkInstalls(), INSTALL_CHECK_MS)
}

/** `notify` : la liste ou le temps de jeu Steam ont changé. `installed` : un jeu lancé avec « Installer » est prêt (à rescanner). */
export function startSteamLibrary(notify: () => void, installed: () => void): void {
  onChange = notify
  onInstalled = installed
}
