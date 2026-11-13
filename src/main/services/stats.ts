import { net } from 'electron'
import type { Bf6Account, Bf6Art, Bf6Match, Bf6Platform, Bf6Point, Bf6Row, Bf6Snapshot, Bf6Stats, Bf6Tracked } from '@shared/types'
import { getKv, peekOtherKv, setKv } from '../db'
import { fetchAssets } from './artwork'
import { getSettings } from './settings'
import { UserError } from '../errors'

// Statistiques Battlefield 6 via gametools.network : EA n'a pas d'API publique, ce service communautaire
// lit le service de stats du jeu et le rend en JSON, sans clé. Tout passe par le processus principal (pas de CORS).

const API = 'https://api.gametools.network/bf6'
const TIMEOUT_MS = 15_000
/** Au-delà, une ouverture de la page relit les stats. */
const FRESH_MS = 10 * 60_000
const MAX_RIVALS = 12
const PLATFORMS: Bf6Platform[] = ['ea', 'pc', 'steam', 'psn', 'xbox']
/** Recherche par plateforme quand la recherche globale ne trouve rien (elle renvoie vide si on l'appelle trop vite). */
const LOOKUP_PLATFORMS: Bf6Platform[] = ['ea', 'steam', 'psn', 'xbox']

const NETWORK_ERROR = 'Connexion à gametools.network impossible : vérifie ta connexion internet.'
const SERVICE_ERROR = 'Le service de statistiques ne répond pas pour le moment. Réessaie dans quelques minutes.'
const NOT_FOUND = 'Aucune statistique Battlefield 6 pour ce joueur (pseudo introuvable ou profil privé).'

// ---------- lecture de l'API ----------

async function getJson(path: string, params: Record<string, string>): Promise<unknown> {
  const url = `${API}/${path}/?${new URLSearchParams(params).toString()}`
  let res: Response
  try {
    res = await net.fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new UserError(NETWORK_ERROR)
  }
  // L'API répond 404 (ou 400) pour un joueur inconnu.
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) throw new UserError(SERVICE_ERROR)
  try {
    return await res.json()
  } catch {
    throw new UserError(SERVICE_ERROR)
  }
}

type Raw = Record<string, unknown>

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Nombre lu tel quel ou depuis un texte formaté (« 52,3 % », « 1,234 »). */
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const n = parseFloat(
    v
      .replace(/[^0-9.,-]/g, '')
      .replace(/,(?=\d{3}\b)/g, '')
      .replace(',', '.')
  )
  return Number.isFinite(n) ? n : undefined
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined)

function toPlatform(p: unknown): Bf6Platform {
  const s = typeof p === 'string' ? p.toLowerCase() : ''
  if (s.startsWith('xbox')) return 'xbox'
  if (s.startsWith('ps')) return 'psn'
  return (PLATFORMS as string[]).includes(s) ? (s as Bf6Platform) : 'ea'
}

const MAX_ROWS = 300

function rows(list: unknown, nameKeys: string[]): Bf6Row[] {
  if (!Array.isArray(list)) return []
  // Taille bornée : ces listes sont gardées en cache dans la base.
  return list.filter(isObj).slice(0, MAX_ROWS).map((r, i) => ({
    id: str(r.id) ?? String(i),
    name: nameKeys.map((k) => str(r[k])).find(Boolean) ?? 'Sans nom',
    image: str(r.image)?.startsWith('https://') ? str(r.image) : undefined,
    kills: num(r.kills),
    deaths: num(r.deaths),
    killDeath: num(r.killDeath),
    kpm: num(r.killsPerMinute ?? r.kpm),
    accuracy: num(r.accuracy),
    headshots: num(r.headshots),
    matches: num(r.matches),
    wins: num(r.wins),
    winPercent: num(r.winPercent),
    secondsPlayed: num(r.secondsPlayed ?? r.timeEquipped ?? r.timeIn)
  }))
}

function toStats(raw: Raw, account: Bf6Account): Bf6Stats {
  const kills = num(raw.kills) ?? 0
  const deaths = num(raw.deaths) ?? 0
  const wins = num(raw.wins) ?? 0
  const losses = num(raw.loses ?? raw.losses) ?? 0
  return {
    account: {
      ...account,
      name: str(raw.userName) ?? account.name,
      personaId: str(raw.id) ?? account.personaId,
      nucleusId: str(raw.userId) ?? account.nucleusId
    },
    avatarUrl: str(raw.avatar)?.startsWith('https://') ? str(raw.avatar) : undefined,
    kills,
    deaths,
    killDeath: num(raw.killDeath) ?? (deaths ? kills / deaths : kills),
    killsPerMinute: num(raw.killsPerMinute) ?? 0,
    wins,
    losses,
    winPercent: num(raw.winPercent) ?? (wins + losses ? (wins / (wins + losses)) * 100 : 0),
    accuracy: num(raw.accuracy) ?? 0,
    headshots: num(raw.headshots) ?? 0,
    assists: num(raw.assists) ?? 0,
    revives: num(raw.revives) ?? 0,
    matches: num(raw.matchesPlayed) ?? wins + losses,
    secondsPlayed: num(raw.secondsPlayed) ?? 0,
    bestClass: str(raw.bestClass),
    weapons: rows(raw.weapons, ['weaponName', 'name']),
    vehicles: rows(raw.vehicles, ['vehicleName', 'name']),
    classes: rows(raw.classes, ['className', 'name']),
    modes: rows(raw.gameModes, ['gamemodeName', 'name']),
    maps: rows(raw.maps, ['mapName', 'name'])
  }
}

async function fetchStats(account: Bf6Account): Promise<Bf6Stats | null> {
  const params: Record<string, string> = {
    categories: 'multiplayer',
    raw: 'false',
    format_values: 'true',
    seperation: 'false',
    skip_battlelog: 'true',
    lang: 'fr-fr',
    platform: account.platform
  }
  // Les identifiants évitent toute confusion entre deux joueurs au pseudo proche.
  if (account.personaId && account.nucleusId) Object.assign(params, { playerid: account.personaId, nucleus_id: account.nucleusId })
  else params.name = account.name
  const raw = await getJson('stats', params)
  if (!isObj(raw) || !raw.id || raw.hasResults === false) return null
  return toStats(raw, account)
}

// ---------- recherche ----------

export async function searchBf6(input: unknown): Promise<Bf6Match[]> {
  const name = typeof input === 'string' ? input.trim().slice(0, 64) : ''
  if (!name) return []
  const lower = name.toLowerCase()
  const found = await getJson('player', { name, limit: '10' })
  const results = isObj(found) && Array.isArray(found.results) ? found.results.filter(isObj) : []
  const hits = results.filter((r) => (str(r.name) ?? str(r.displayName) ?? str(r.username) ?? '').toLowerCase() === lower)

  if (hits.length) {
    return Promise.all(
      hits.map(async (r) => {
        const account: Bf6Account = {
          name: str(r.name) ?? str(r.displayName) ?? str(r.username) ?? name,
          platform: toPlatform(r.platform),
          personaId: str(r.personaId),
          nucleusId: str(r.nucleusId)
        }
        const stats = await fetchStats(account).catch(() => null)
        if (stats) remember(stats)
        return { ...(stats?.account ?? account), kills: stats?.kills ?? null }
      })
    )
  }

  // Repli : lecture directe des stats sur chaque plateforme.
  const byPlatform = await Promise.all(LOOKUP_PLATFORMS.map((platform) => fetchStats({ name, platform }).catch(() => null)))
  const seen = new Set<string>()
  const out: Bf6Match[] = []
  for (const stats of byPlatform) {
    if (!stats || seen.has(String(stats.account.personaId))) continue
    seen.add(String(stats.account.personaId))
    remember(stats)
    out.push({ ...stats.account, kills: stats.kills })
  }
  return out
}

// ---------- cache et comptes suivis ----------

const keyOf = (a: Bf6Account): string => `${a.platform}:${a.personaId ?? a.name.toLowerCase()}`

type Cache = Record<string, { stats: Bf6Stats; fetchedAt: number }>

/** `alias` : clé demandée, quand elle diffère de celle du profil renvoyé (compte enregistré sans personaId). */
function remember(stats: Bf6Stats, alias?: string): Bf6Snapshot {
  const fetchedAt = Date.now()
  const cache = getKv<Cache>('bf6Cache', {})
  cache[keyOf(stats.account)] = { stats, fetchedAt }
  if (alias && alias !== keyOf(stats.account)) cache[alias] = { stats, fetchedAt }
  // On ne garde que les plus récents.
  const kept = Object.entries(cache)
    .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
    .slice(0, MAX_RIVALS + 8)
  setKv('bf6Cache', Object.fromEntries(kept))
  return { stats, fetchedAt }
}

export async function getBf6Stats(input: unknown, refresh = false): Promise<Bf6Snapshot> {
  const account = cleanAccount(input)
  if (!account) throw new UserError('Compte Battlefield 6 invalide.')
  const cached = getKv<Cache>('bf6Cache', {})[keyOf(account)]
  if (cached && !refresh && Date.now() - cached.fetchedAt < FRESH_MS) return cached
  try {
    const stats = await fetchStats(account)
    if (!stats) throw new UserError(NOT_FOUND)
    recordPoint(account, stats)
    return remember(stats, keyOf(account))
  } catch (e) {
    const message = e instanceof UserError ? e.message : SERVICE_ERROR
    // Hors ligne ou service en panne : on garde la dernière lecture, en le disant.
    if (cached && message !== NOT_FOUND) return { ...cached, stale: message }
    throw new UserError(message)
  }
}

function cleanAccount(v: unknown): Bf6Account | null {
  if (!isObj(v)) return null
  const name = str(v.name)?.slice(0, 64)
  if (!name || !(PLATFORMS as unknown[]).includes(v.platform)) return null
  const personaId = str(v.personaId)
  const nucleusId = str(v.nucleusId)
  return {
    name,
    platform: v.platform as Bf6Platform,
    ...(personaId && /^\d{1,20}$/.test(personaId) ? { personaId } : {}),
    ...(nucleusId && /^\d{1,20}$/.test(nucleusId) ? { nucleusId } : {})
  }
}

/** En mode démo, les joueurs suivis vivent à part : la démo ne touche jamais aux vraies données. */
function trackedKey(): string {
  return getSettings().demoMode ? 'demoBf6Tracked' : 'bf6Tracked'
}

export function getBf6Tracked(): Bf6Tracked {
  return { me: null, rivals: [], ...getKv<Partial<Bf6Tracked>>(trackedKey(), {}) }
}

export function setBf6Tracked(input: unknown): Bf6Tracked {
  const t = isObj(input) ? input : {}
  const me = cleanAccount(t.me)
  const seen = new Set(me ? [keyOf(me)] : [])
  const rivals = (Array.isArray(t.rivals) ? t.rivals : [])
    .map(cleanAccount)
    .filter((a): a is Bf6Account => !!a && !seen.has(keyOf(a)) && !!seen.add(keyOf(a)))
    .slice(0, MAX_RIVALS)
  setKv(trackedKey(), { me, rivals })
  // Premier relevé tout de suite pour un compte qu'on vient de suivre (ses stats sont déjà en cache).
  const cache = getKv<Cache>('bf6Cache', {})
  for (const a of [me, ...rivals]) {
    if (!a || getBf6History(a).length) continue
    const hit = cache[keyOf(a)]
    if (hit) recordPoint(a, hit.stats)
  }
  return { me, rivals }
}

// ---------- progression (un relevé par jour, gardé sur ce PC) ----------

/** Les relevés suivent le pseudo et la plateforme : un compte enregistré sans personaId garde son historique. */
const historyKey = (a: Bf6Account): string => `${a.platform}:${a.name.toLowerCase()}`
const MAX_POINTS = 400
/** Relevé automatique de ton compte si le dernier a plus de 20 h (Player X ouvert sans passer par la page). */
const AUTO_AFTER_MS = 20 * 3600_000

type History = Record<string, Bf6Point[]>

const dayOf = (t: number): string => new Date(t).toDateString()

/** Comme les joueurs suivis, les relevés du mode démo vivent à part. */
function historyStore(): string {
  return getSettings().demoMode ? 'demoBf6History' : 'bf6History'
}

function isTracked(a: Bf6Account): boolean {
  const k = historyKey(a)
  const t = getBf6Tracked()
  return [t.me, ...t.rivals].some((x) => x && historyKey(x) === k)
}

function recordPoint(account: Bf6Account, s: Bf6Stats): void {
  if (!isTracked(account)) return
  const at = Date.now()
  const point: Bf6Point = {
    at,
    kills: s.kills,
    deaths: s.deaths,
    wins: s.wins,
    losses: s.losses,
    matches: s.matches,
    secondsPlayed: s.secondsPlayed,
    killsPerMinute: s.killsPerMinute,
    accuracy: s.accuracy
  }
  const all = getKv<History>(historyStore(), {})
  const list = all[historyKey(account)] ?? []
  const last = list.at(-1)
  // Même jour : le relevé du jour est remplacé par le plus récent.
  if (last && dayOf(last.at) === dayOf(at)) list[list.length - 1] = point
  else list.push(point)
  all[historyKey(account)] = list.slice(-MAX_POINTS)
  setKv(historyStore(), all)
}

export function getBf6History(input: unknown): Bf6Point[] {
  const account = cleanAccount(input)
  return account ? (getKv<History>(historyStore(), {})[historyKey(account)] ?? []) : []
}

/** Au démarrage puis toutes les 6 h : un relevé de ton compte, pour que la courbe avance même sans ouvrir la page. */
export function startBf6Recorder(): void {
  const run = (): void => {
    if (getSettings().demoMode) return
    const me = getKv<Partial<Bf6Tracked>>('bf6Tracked', {}).me
    if (!me) return
    const last = getBf6History(me).at(-1)
    if (last && Date.now() - last.at < AUTO_AFTER_MS) return
    getBf6Stats(me, true).catch(() => {})
  }
  setTimeout(run, 90_000)
  setInterval(run, 6 * 3600_000)
}

// ---------- visuels du jeu ----------

/** Battlefield 6 sur Steam : https://store.steampowered.com/app/2807960 */
const BF6_STEAM_APPID = '2807960'
const ART_MAX_AGE = 7 * 24 * 3600_000

export async function getBf6Art(): Promise<Bf6Art> {
  const cached = getKv<(Bf6Art & { at: number }) | null>('bf6Art', null)
  if (cached && Date.now() - cached.at < ART_MAX_AGE) return cached
  try {
    const a = (await fetchAssets([BF6_STEAM_APPID])).get(BF6_STEAM_APPID)
    const art = { heroUrl: a?.hero, coverUrl: a?.cover, logoUrl: a?.logo, at: Date.now() }
    setKv('bf6Art', art)
    return art
  } catch {
    // Hors ligne : on garde les anciens visuels s'il y en a, sinon la page affiche son fond de marque.
    return cached ?? {}
  }
}

// ---------- reprendre le profil de Player X ----------

/** Les autres applis Player X de ce PC, dans l'ordre : la vraie, puis l'appli de test. */
const OTHER_APPS = ['Player X', 'Player X Test']

/** Ton profil Battlefield 6 tel que relié dans Player X sur ce PC, s'il y en a un (lecture seule). */
export function playerXBf6(): { from: string; me: Bf6Account } | null {
  for (const from of OTHER_APPS) {
    const t = peekOtherKv<Partial<Bf6Tracked>>(from, 'bf6Tracked')
    const me = cleanAccount(t?.me)
    if (me) return { from, me }
  }
  return null
}

/** Reprend ton profil et tes joueurs suivis depuis Player X. Rien n'est modifié dans Player X. */
export function importPlayerXBf6(): Bf6Tracked {
  for (const from of OTHER_APPS) {
    const t = peekOtherKv<Partial<Bf6Tracked>>(from, 'bf6Tracked')
    const me = cleanAccount(t?.me)
    if (!me) continue
    const cur = getBf6Tracked()
    return setBf6Tracked({ me, rivals: [...cur.rivals, ...(Array.isArray(t?.rivals) ? t.rivals : [])] })
  }
  throw new UserError('Aucun profil Battlefield 6 relié dans Player X sur ce PC.')
}
