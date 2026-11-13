import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  exchangeRefreshTokenForAuthTokens,
  getBasicPresence,
  getProfileFromAccountId,
  getUserFriendsAccountIds,
  type AuthTokensResponse
} from 'psn-api'
import { net } from 'electron'
import type { Account, DiscordChannel, Friend, FriendPlatform, FriendsResult, FriendStatus, SteamFriendProfile } from '@shared/types'
import { discordGuildIdFrom } from '@shared/text'
import { memberKey } from './discordMembers'
import { buildFriendProfile, steamJoin } from './steamProfile'
import { getAccounts, getSettings, saveAccount } from './settings'
import { UserError } from '../errors'

// ---------- Messages d'erreur ----------
// fetch et psn-api renvoient des erreurs en anglais : l'interface n'affiche que du français.

/** Message déjà rédigé pour l'utilisateur, affiché tel quel. */

const NETWORK_ERROR = 'Connexion impossible : vérifie ta connexion internet.'
const PSN_AUTH_ERROR = 'Jeton PlayStation invalide ou expiré : colle un nouveau NPSSO dans Paramètres.'
const FALLBACK: Record<FriendPlatform, string> = {
  steam: 'Impossible de récupérer tes amis Steam pour le moment.',
  discord: 'Impossible de récupérer les membres du serveur Discord pour le moment.',
  psn: 'Impossible de récupérer tes amis PlayStation pour le moment.'
}

const isNetworkError = (e: unknown): boolean =>
  (e instanceof TypeError && /fetch failed|network/i.test(e.message)) ||
  (e instanceof Error &&
    /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|NETWORK_CHANGED|NETWORK_IO_SUSPENDED|NETWORK_ACCESS_DENIED|CONNECTION_|TIMED_OUT|ADDRESS_UNREACHABLE|PROXY_|TUNNEL_)/.test(
      e.message
    ))

function frenchError(e: unknown, fallback: string): string {
  if (e instanceof UserError) return e.message
  return isNetworkError(e) ? NETWORK_ERROR : fallback
}

// ---------- Données reçues ----------
// Les réponses des API ne sont pas fiables : on ne garde que des textes courts et des images en https.

const TIMEOUT = 15_000
const text = (v: unknown, max = 128): string | undefined => (typeof v === 'string' && v ? v.slice(0, max) : undefined)
/** Date en secondes Unix plausible (après 2003, pas dans le futur), sinon rien. */
const unixSeconds = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 1_041_379_200 && v * 1000 <= Date.now() + 86_400_000 ? Math.floor(v) : undefined
const httpsUrl = (v: unknown): string | undefined => (typeof v === 'string' && v.startsWith('https://') && v.length <= 2048 ? v : undefined)

// ---------- Steam Web API ----------

interface SteamPlayer {
  steamid: string
  personaname: string
  avatarfull: string
  personastate: number // 0 hors ligne, 1 en ligne, 2 occupé, 3 absent, 4 sieste, 5-6 en ligne
  gameextrainfo?: string
  /** Dernière déconnexion, en secondes Unix (absente si le profil la cache). */
  lastlogoff?: number
  /** Partie qu'on peut rejoindre : serveur (`gameserverip`) ou salon (`lobbysteamid` + `gameid`). */
  join?: string
}

/** Dernières adresses « Rejoindre » connues, par ami (`steam:<id>`). L'interface ne voit que `joinable`. */
const joinUrls = new Map<string, string>()
export const steamJoinUrl = (friendId: string): string | undefined => joinUrls.get(friendId)

export async function getSteamProfiles(key: string, ids: string[]): Promise<SteamPlayer[]> {
  const players: SteamPlayer[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${ids.slice(i, i + 100).join(',')}`
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) throw new Error(`Steam API ${res.status}`)
    const list = ((await res.json()) as { response?: { players?: unknown } }).response?.players
    for (const p of Array.isArray(list) ? (list as Record<string, unknown>[]) : []) {
      const steamid = text(p?.steamid, 32)
      const personaname = text(p?.personaname)
      if (!steamid || !personaname) continue
      players.push({
        steamid,
        personaname,
        avatarfull: httpsUrl(p.avatarfull) ?? '',
        personastate: typeof p.personastate === 'number' ? p.personastate : 0,
        gameextrainfo: text(p.gameextrainfo),
        lastlogoff: unixSeconds(p.lastlogoff),
        join: steamJoin(p, steamid)
      })
    }
  }
  return players
}

/** Met à jour le pseudo et l'avatar du compte Steam enregistré (la clé a pu être ajoutée après la connexion). */
function refreshOwnSteamProfile(account: Account, me: SteamPlayer | undefined): void {
  if (!me || (me.personaname === account.name && me.avatarfull === account.avatarUrl)) return
  // Seulement si ce compte est toujours connecté (pas de retour d'un compte déconnecté entre-temps).
  if (getAccounts().some((a) => a.platform === 'steam' && a.id === account.id)) saveAccount({ ...account, name: me.personaname, avatarUrl: me.avatarfull || undefined })
}

async function steamFriends(account: Account, key: string): Promise<Friend[]> {
  const res = await fetch(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${encodeURIComponent(key)}&steamid=${account.id}&relationship=friend`, {
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (res.status === 401) {
    // Liste d'amis privée : le profil, lui, reste lisible.
    await getSteamProfiles(key, [account.id])
      .then(([me]) => refreshOwnSteamProfile(account, me))
      .catch(() => {})
    throw new UserError('Ta liste d’amis Steam est privée : passe-la en public dans ton profil Steam.')
  }
  if (!res.ok) throw new Error(`Steam API ${res.status}`)
  const list = ((await res.json()) as { friendslist?: { friends?: unknown } }).friendslist?.friends
  // Ami depuis : `friend_since` (secondes Unix) de chaque ami.
  const since = new Map<string, number>()
  for (const f of Array.isArray(list) ? (list as { steamid?: unknown; friend_since?: unknown }[]) : []) {
    const at = unixSeconds(f?.friend_since)
    if (typeof f?.steamid === 'string' && at) since.set(f.steamid, at * 1000)
  }
  const ids = (Array.isArray(list) ? list : []).map((f) => (f as { steamid?: unknown })?.steamid).filter((id): id is string => typeof id === 'string' && /^\d{17}$/.test(id))
  // Son propre profil dans la même requête.
  const players = await getSteamProfiles(key, [account.id, ...ids])
  refreshOwnSteamProfile(
    account,
    players.find((p) => p.steamid === account.id)
  )
  joinUrls.clear()
  for (const p of players) if (p.join && p.gameextrainfo && p.steamid !== account.id) joinUrls.set(`steam:${p.steamid}`, p.join)
  return players
    .filter((p) => p.steamid !== account.id)
    .map((p): Friend => {
      const status: FriendStatus = p.gameextrainfo
        ? 'in-game'
        : p.personastate === 0
          ? 'offline'
          : p.personastate === 3 || p.personastate === 4
            ? 'away'
            : 'online'
      const friendSince = since.get(p.steamid)
      return {
        id: `steam:${p.steamid}`,
        platform: 'steam',
        name: p.personaname,
        avatarUrl: p.avatarfull || undefined,
        status,
        game: p.gameextrainfo,
        ...(p.join && p.gameextrainfo ? { joinable: true } : {}),
        ...(friendSince ? { since: friendSince } : {}),
        // Vu pour la dernière fois : seulement hors ligne (connecté, la date ne dit rien d'utile).
        ...(status === 'offline' && p.lastlogoff ? { lastSeen: p.lastlogoff * 1000 } : {})
      }
    })
}

// ---------- Profil Steam d'un ami ----------
// Seulement ce que Steam rend public. Profil privé : pas de jeux ni d'heures, et la fiche ne montre pas de case vide.

const PROFILE_TTL = 5 * 60_000
const profiles = new Map<string, { at: number; p: SteamFriendProfile }>()

async function steamJson(url: string, field = 'response'): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) return undefined
    const body = (await res.json()) as Record<string, unknown>
    const v = body?.[field]
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export async function steamFriendProfile(key: string, friendId: string): Promise<SteamFriendProfile> {
  const steamId = friendId.slice('steam:'.length)
  if (!/^\d{17}$/.test(steamId)) throw new UserError('Ami Steam inconnu.')
  const hit = profiles.get(steamId)
  if (hit && Date.now() - hit.at < PROFILE_TTL) return hit.p
  const k = encodeURIComponent(key)
  const base = 'https://api.steampowered.com/IPlayerService'
  const [level, owned, recent, equipped, badges, summaries, friends] = await Promise.all([
    steamJson(`${base}/GetSteamLevel/v1/?key=${k}&steamid=${steamId}`),
    steamJson(`${base}/GetOwnedGames/v1/?key=${k}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`),
    steamJson(`${base}/GetRecentlyPlayedGames/v1/?key=${k}&steamid=${steamId}&count=10`),
    steamJson(`${base}/GetProfileItemsEquipped/v1/?key=${k}&steamid=${steamId}`),
    steamJson(`${base}/GetBadges/v1/?key=${k}&steamid=${steamId}`),
    steamJson(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${k}&steamids=${steamId}`),
    steamJson(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${k}&steamid=${steamId}&relationship=friend`, 'friendslist')
  ])
  const summary = Array.isArray(summaries?.players) ? (summaries.players as Record<string, unknown>[]).find((x) => x?.steamid === steamId) : undefined
  const p = buildFriendProfile(steamId, level, owned, recent, equipped, { badges, summary, friends: friends?.friends })
  profiles.set(steamId, { at: Date.now(), p })
  return p
}

// ---------- Discord ----------
// L'API OAuth de Discord ne donne pas accès à la liste d'amis. À la place on lit le widget
// public d'un serveur (paramètres du serveur, « Activer le widget du serveur ») : membres en ligne et jeu en cours.

interface DiscordWidget {
  name: string
  /** Salons vocaux que @everyone peut voir (les salons privés n'y sont pas). Leurs identifiants sont les vrais. */
  channels: { id: string; name: string; position: number }[]
  /**
   * Membres en ligne. En vocal : `channel_id` du salon, micro et casque coupés (`mute`, `deaf` par le serveur ;
   * `self_mute`, `self_deaf` par le membre ; `suppress` : auditeur d'une scène). Noms lus par discord.py et disnake.
   */
  members: {
    id: string
    username: string
    avatar_url: string
    status: string
    activity?: { name: string }
    channel_id?: string | null
    mute?: boolean
    self_mute?: boolean
    deaf?: boolean
    self_deaf?: boolean
    suppress?: boolean
  }[]
}

/** Salons vocaux du widget, dans l'ordre du serveur (`position`). */
function widgetChannels(raw: unknown): DiscordChannel[] {
  if (!Array.isArray(raw)) return []
  return (raw as Partial<DiscordWidget['channels'][number]>[])
    .map((c, i) => ({ id: typeof c?.id === 'string' && /^\d{15,22}$/.test(c.id) ? c.id : '', name: text(c?.name, 100) ?? '', position: typeof c?.position === 'number' ? c.position : i }))
    .filter((c) => c.id && c.name)
    .sort((a, b) => a.position - b.position)
    .map(({ id, name }) => ({ id, name }))
}

const DISCORD_WIDGET_OFF =
  'Le widget de ce serveur est désactivé. Dans les paramètres du serveur Discord, active « Activer le widget du serveur » puis enregistre les modifications.'

async function discordServerMembers(rawId: string): Promise<{ name?: string; members: Friend[]; channels: DiscordChannel[] }> {
  const guildId = discordGuildIdFrom(rawId)
  if (!/^\d{15,22}$/.test(guildId))
    throw new UserError('Identifiant de serveur Discord invalide : colle l’« Identifiant du serveur » affiché à côté du widget.')
  // Pile réseau de Chromium (comme un navigateur) et sans cache : Discord refuse parfois les clients « node », et un ancien refus ne doit pas rester.
  const res = await net.fetch(`https://discord.com/api/guilds/${guildId}/widget.json`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!res.ok) {
    // Discord précise la cause dans le corps : 50004 = widget désactivé, 10004 = serveur inconnu, 40333 = requête bloquée.
    let body: { code?: number; message?: string } = {}
    try {
      body = (await res.json()) as typeof body
    } catch {
      /* page HTML (protection anti-robot) */
    }
    if (body.code === 50004 || /widget/i.test(body.message ?? '')) throw new UserError(DISCORD_WIDGET_OFF)
    if (res.status === 404 || body.code === 10004)
      throw new UserError('Serveur Discord introuvable : vérifie que c’est bien l’identifiant du serveur, pas ton ID ni celui d’un salon.')
    if (res.status === 429) throw new UserError('Discord limite les requêtes : réessaie dans une minute.')
    if (res.status === 403 || res.status === 401)
      throw new UserError(`Discord a refusé la requête (code ${body.code ?? res.status}). Réessaie dans quelques minutes.`)
    throw new Error(`Discord ${res.status}`)
  }
  const widget = (await res.json()) as Partial<DiscordWidget>
  const channels = widgetChannels(widget.channels)
  const voiceIds = new Set(channels.map((c) => c.id))
  const friends: Friend[] = []
  // Les identifiants du widget sont anonymes et changent selon la position : l'identité d'un membre, c'est son pseudo
  // (stable d'une récupération à l'autre, comme « Masquer »). Deux membres au même pseudo : « pseudo#2 »…
  const seen = new Map<string, number>()
  for (const m of Array.isArray(widget.members) ? widget.members : []) {
    const name = text(m?.username)
    if (!name) continue
    const key = memberKey(name)
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    const game = text(m.activity?.name)
    // En vocal : seulement dans un salon que le widget liste (sinon, pas de nom à montrer ni de lien sûr).
    const channelId = typeof m.channel_id === 'string' && voiceIds.has(m.channel_id) ? m.channel_id : undefined
    const muted = m.mute === true || m.self_mute === true || m.suppress === true
    const deafened = m.deaf === true || m.self_deaf === true
    friends.push({
      id: `discord:${n > 1 ? `${key}#${n}` : key}`,
      platform: 'discord',
      name,
      avatarUrl: httpsUrl(m.avatar_url),
      status: game ? 'in-game' : m.status === 'idle' ? 'away' : 'online',
      game,
      ...(channelId ? { voice: { channelId, ...(muted ? { muted } : {}), ...(deafened ? { deafened } : {}) } } : {})
    })
  }
  return { name: text(widget.name, 100), members: friends, channels }
}

// ---------- PlayStation (non officiel, via psn-api) ----------

let psnTokens: (AuthTokensResponse & { obtainedAt: number }) | null = null

/** Change à chaque oubli : une connexion commencée avant ne remet pas l'ancienne session en cache. */
let psnGeneration = 0

/** Oublie la session PlayStation en mémoire (déconnexion ou nouveau jeton NPSSO). */
export function resetPsn(): void {
  psnTokens = null
  psnGeneration++
}

async function psnAuth(npsso: string): Promise<{ accessToken: string }> {
  const now = Date.now()
  const generation = psnGeneration
  const keep = (tokens: AuthTokensResponse): AuthTokensResponse & { obtainedAt: number } => {
    const session = { ...tokens, obtainedAt: now }
    if (generation === psnGeneration) psnTokens = session
    return session
  }
  if (psnTokens && now < psnTokens.obtainedAt + (psnTokens.expiresIn - 60) * 1000) return psnTokens
  if (psnTokens?.refreshToken) {
    try {
      return keep(await exchangeRefreshTokenForAuthTokens(psnTokens.refreshToken))
    } catch {
      /* on retombe sur le NPSSO */
    }
  }
  let tokens: AuthTokensResponse
  try {
    tokens = await exchangeAccessCodeForAuthTokens(await exchangeNpssoForAccessCode(npsso))
    if (!tokens.accessToken) throw new Error('PSN token')
  } catch (e) {
    // Hors réseau, un échec ici veut dire que le NPSSO est refusé.
    throw isNetworkError(e) ? e : new UserError(PSN_AUTH_ERROR)
  }
  return keep(tokens)
}

export async function connectPsn(): Promise<Account> {
  const { psnNpsso } = getSettings()
  if (!psnNpsso) throw new Error('Colle ton jeton NPSSO PlayStation dans Paramètres.')
  resetPsn()
  // Sony peut ne jamais répondre : sans limite, le bouton « Connecter » restait sans rien faire
  const limit = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error('PlayStation ne répond pas. Vérifie ta connexion, puis réessaie.')), 20_000))])
  try {
    const auth = await limit(psnAuth(psnNpsso))
    const me = await limit(getProfileFromAccountId(auth, 'me'))
    const account: Account = { platform: 'psn', id: 'me', name: text(me.onlineId) ?? 'PlayStation', avatarUrl: httpsUrl(me.avatars?.at(-1)?.url) }
    saveAccount(account)
    return account
  } catch (e) {
    throw new Error(frenchError(e, 'Connexion à PlayStation impossible pour le moment. Réessaie plus tard.'))
  }
}

/** Amis PlayStation en 30 s au plus : sinon la page Amis attendait Sony indéfiniment. */
function psnFriends(npsso: string): Promise<Friend[]> {
  return Promise.race([
    psnFriendsNow(npsso),
    new Promise<Friend[]>((_, no) => setTimeout(() => no(new Error('PlayStation ne répond pas. Réessaie plus tard.')), 30_000))
  ])
}

async function psnFriendsNow(npsso: string): Promise<Friend[]> {
  const auth = await psnAuth(npsso)
  const { friends } = await getUserFriendsAccountIds(auth, 'me', { limit: 50 })
  return Promise.all(
    friends.map(async (accountId): Promise<Friend> => {
      const [profile, presence] = await Promise.all([getProfileFromAccountId(auth, accountId), getBasicPresence(auth, accountId).catch(() => null)])
      const p = presence?.basicPresence
      const game = text(p?.gameTitleInfoList?.[0]?.titleName)
      const online = p?.primaryPlatformInfo?.onlineStatus === 'online'
      return {
        id: `psn:${accountId}`,
        platform: 'psn',
        name: text(profile.onlineId) ?? 'Joueur PlayStation',
        avatarUrl: httpsUrl(profile.avatars?.at(-1)?.url),
        status: game ? 'in-game' : online ? 'online' : 'offline',
        game,
        device: text(p?.primaryPlatformInfo?.platform, 32),
        ...(presence ? {} : { presenceUnknown: true })
      }
    })
  )
}

// ---------- Agrégation ----------

export async function getAllFriends(): Promise<FriendsResult> {
  const settings = getSettings()
  const accounts = getAccounts()
  const result: FriendsResult = { friends: [], errors: {} }

  const queried: FriendPlatform[] = []
  const collect = async (platform: Friend['platform'], load: () => Promise<Friend[]>): Promise<void> => {
    queried.push(platform)
    try {
      result.friends.push(...(await load()))
    } catch (e) {
      result.errors[platform] = frenchError(e, FALLBACK[platform])
    }
  }

  const tasks: Promise<void>[] = []
  const steam = accounts.find((a) => a.platform === 'steam')
  if (steam) {
    tasks.push(
      collect('steam', () => {
        if (!settings.steamApiKey) throw new UserError('Ajoute ta clé Steam Web API dans Paramètres pour voir tes amis.')
        return steamFriends(steam, settings.steamApiKey)
      })
    )
  }
  if (settings.discordGuildId) {
    tasks.push(
      collect('discord', async () => {
        const { name, members, channels } = await discordServerMembers(settings.discordGuildId)
        if (name) result.discordServer = name
        if (channels.length) result.discordChannels = channels
        return members
      })
    )
  }
  if (accounts.some((a) => a.platform === 'psn') && settings.psnNpsso) {
    tasks.push(collect('psn', () => psnFriends(settings.psnNpsso)))
  }
  await Promise.all(tasks)
  return { ...result, queried }
}
