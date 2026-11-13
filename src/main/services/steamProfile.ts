import type { SteamFriendGame, SteamFriendProfile } from '@shared/types'

// Lecture des réponses de Steam pour la fiche d'un ami. Pas d'import d'Electron : testé à part (steamProfile.test.ts).

const CDN = 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/'
const text = (v: unknown, max = 128): string | undefined => (typeof v === 'string' && v ? v.slice(0, max) : undefined)

/** Adresse steam:// pour rejoindre : seulement des chiffres et des points, jamais le texte brut de l'API. */
export function steamJoin(p: Record<string, unknown>, steamid: string): string | undefined {
  const ip = typeof p.gameserverip === 'string' ? p.gameserverip : ''
  if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(ip) && !ip.startsWith('0.0.0.0')) return `steam://connect/${ip}`
  const lobby = typeof p.lobbysteamid === 'string' ? p.lobbysteamid : ''
  const gameid = typeof p.gameid === 'string' ? p.gameid : ''
  if (/^\d{17,20}$/.test(lobby) && /^\d{1,10}$/.test(gameid)) return `steam://joinlobby/${gameid}/${lobby}/${steamid}`
  return undefined
}

const minutes = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
function steamGames(raw: unknown): SteamFriendGame[] {
  if (!Array.isArray(raw)) return []
  const out: SteamFriendGame[] = []
  for (const g of raw as Record<string, unknown>[]) {
    const appId = typeof g?.appid === 'number' && Number.isInteger(g.appid) && g.appid > 0 ? g.appid : 0
    if (!appId) continue
    const recent = minutes(g.playtime_2weeks)
    out.push({ appId, name: text(g.name), minutes: minutes(g.playtime_forever), ...(recent ? { recentMinutes: recent } : {}) })
  }
  return out
}
/** Chemin d'image du CDN de Steam : lettres, chiffres, « / », « _ », « - », « . » seulement. */
const cdnUrl = (v: unknown, ext: RegExp): string | undefined =>
  typeof v === 'string' && /^[\w/.-]{4,300}$/.test(v) && !v.includes('..') && ext.test(v) ? CDN + v : undefined

/** Fond de profil et cadre d'avatar (IPlayerService/GetProfileItemsEquipped : non documenté, d'autres outils s'en servent). */
export function parseEquipped(r: Record<string, unknown> | undefined): Pick<SteamFriendProfile, 'background' | 'backgroundVideo' | 'avatarFrame' | 'avatarAnimated'> {
  const bg = (r?.profile_background ?? {}) as Record<string, unknown>
  const frame = (r?.avatar_frame ?? {}) as Record<string, unknown>
  const img = /\.(jpe?g|png|gif|webp)$/i
  const background = cdnUrl(bg.image_large, img)
  const backgroundVideo = cdnUrl(bg.movie_webm, /\.webm$/i)
  const avatarFrame = cdnUrl(frame.image_small, img) ?? cdnUrl(frame.image_large, img)
  const anim = (r?.animated_avatar ?? {}) as Record<string, unknown>
  const avatarAnimated = cdnUrl(anim.image_large, img) ?? cdnUrl(anim.image_small, img)
  return { ...(background ? { background } : {}), ...(backgroundVideo ? { backgroundVideo } : {}), ...(avatarFrame ? { avatarFrame } : {}), ...(avatarAnimated ? { avatarAnimated } : {}) }
}

export function buildFriendProfile(
  steamId: string,
  level: Record<string, unknown> | undefined,
  owned: Record<string, unknown> | undefined,
  recent: Record<string, unknown> | undefined,
  equipped: Record<string, unknown> | undefined,
  extra: { badges?: Record<string, unknown>; summary?: Record<string, unknown>; friends?: unknown } = {}
): SteamFriendProfile {
  const games = steamGames(owned?.games).sort((a, b) => b.minutes - a.minutes)
  const count = typeof owned?.game_count === 'number' && owned.game_count >= 0 ? Math.floor(owned.game_count) : undefined
  const lv = typeof level?.player_level === 'number' && level.player_level >= 0 ? Math.floor(level.player_level) : undefined
  const rec = steamGames(recent?.games).filter((g) => g.recentMinutes).slice(0, 6)
  const p: SteamFriendProfile = { steamId, ...parseEquipped(equipped) }
  if (lv !== undefined) p.level = lv
  if (games.length) {
    p.games = games.slice(0, 1000)
    p.gameCount = count ?? games.length
    p.totalMinutes = games.reduce((t, g) => t + g.minutes, 0)
  } else if (count === undefined) p.gamesHidden = true
  if (rec.length) p.recent = rec
  // Niveau : badges et progression vers le niveau suivant
  const b = extra.badges
  if (b) {
    if (Array.isArray(b.badges)) p.badgeCount = b.badges.length
    const xp = b.player_xp, cur = b.player_xp_needed_current_level, up = b.player_xp_needed_to_level_up
    if (typeof xp === 'number' && typeof cur === 'number' && typeof up === 'number' && xp >= cur && up >= 0 && xp - cur + up > 0) p.levelProgress = Math.min(1, (xp - cur) / (xp - cur + up))
    if (p.level === undefined && typeof b.player_level === 'number' && b.player_level >= 0) p.level = Math.floor(b.player_level)
  }
  // Pays, ancienneté, grand avatar (GetPlayerSummaries) : seulement s'ils sont publics
  const s = extra.summary
  if (s) {
    if (typeof s.loccountrycode === 'string' && /^[A-Z]{2}$/.test(s.loccountrycode)) p.country = s.loccountrycode
    if (typeof s.timecreated === 'number' && s.timecreated > 1e9) p.memberSince = s.timecreated * 1000
    if (typeof s.avatarfull === 'string' && /^https:\/\/[\w.-]+\.(steamstatic|akamaihd)\.(com|net)\//.test(s.avatarfull)) p.avatarFull = s.avatarfull
  }
  if (Array.isArray(extra.friends)) p.friendCount = extra.friends.length
  return p
}

