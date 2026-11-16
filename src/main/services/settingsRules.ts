import { cleanProfileName, isProfileAvatar } from '@shared/profile'
import { discordGuildIdFrom } from '@shared/text'
import { DEFAULT_OVERLAY_HOTKEY, isValidHotkey } from '@shared/hotkey'
import type { Settings } from '@shared/types'
import { isVersion } from './updaterRules'

// Règles des réglages, sans Electron ni base (testées par settingsRules.test.ts).

/**
 * Réglages par défaut. `env` : les variables du .env, en développement seulement (la version installée passe {} : une
 * variable d'environnement de Windows ne doit pas glisser une clé dans Player X).
 */
export function defaults(env: Record<string, string | undefined> = {}, platform: string = process.platform): Settings {
  return {
    steamApiKey: env.STEAM_API_KEY ?? '',
    discordClientId: env.DISCORD_CLIENT_ID ?? '',
    discordClientSecret: env.DISCORD_CLIENT_SECRET ?? '',
    discordGuildId: '',
    psnNpsso: '',
    demoMode: false,
    friendAlerts: 'all',
    friendWatch: [],
    launchWindow: 'stay',
    gameNews: true,
    // Sous Linux, beaucoup de bureaux n'affichent pas la zone de notification : la croix y ferme Player X par défaut.
    closeToTray: platform === 'win32',
    startWithWindows: false,
    bf6Recap: true,
    cs2Live: true,
    cs2RecapOpen: true,
    cs2Overlay: 'off',
    overlaySize: 'n',
    overlayPos: {},
    overlayHotkey: DEFAULT_OVERLAY_HOTKEY,
    profileName: '',
    profileAvatar: '',
    gameReadyAlert: true,
    updateOnQuit: true,
    updateSkipped: null,
    notesSeen: ''
  }
}

export const TEXT_KEYS = ['steamApiKey', 'discordClientId', 'discordClientSecret', 'discordGuildId', 'psnNpsso'] as const
/** Clés et jetons : jamais envoyés à l'interface (voir publicSettings). */
export const SECRET_KEYS = ['steamApiKey', 'discordClientSecret', 'psnNpsso'] as const
const ALERT_MODES = ['all', 'games', 'off']
const WINDOW_MODES = ['stay', 'minimize']
const OVERLAY_STYLES = ['off', 'c', 'etendard', 'viseur', 'regie']
const OVERLAY_SIZES = ['s', 'n', 'l']
/** Une place par style et par moment de l'overlay : « etendard.buy »… Rien d'autre n'est gardé. */
export const OVERLAY_POS_KEY = /^(etendard|viseur|regie)\.(buy|pill|half|end)$/
/** Échelle d'un bloc, choisie en plus de la taille générale. */
export const OVERLAY_SCALE = { min: 0.5, max: 1.6 } as const
function cleanOverlayPos(v: Record<string, unknown>): Settings['overlayPos'] {
  const out: Settings['overlayPos'] = {}
  for (const [k, xy] of Object.entries(v)) {
    if (!OVERLAY_POS_KEY.test(k) || !Array.isArray(xy) || (xy.length !== 2 && xy.length !== 3)) continue
    if (!xy.every((n) => typeof n === 'number' && Number.isFinite(n))) continue
    const [x, y, k0] = xy as number[]
    // Au plus un écran de décalage, arrondi au millième (assez fin pour un écran 4K) ; l'échelle au centième.
    const c = (n: number): number => Math.round(Math.max(-1, Math.min(1, n)) * 1000) / 1000
    const sc = k0 === undefined ? 1 : Math.round(Math.max(OVERLAY_SCALE.min, Math.min(OVERLAY_SCALE.max, k0)) * 100) / 100
    out[k] = sc === 1 ? [c(x), c(y)] : [c(x), c(y), sc]
  }
  return out
}
/** Anciens styles retirés en 0.6.1 (Apple, Verre) : l'overlay reste allumé, en style Player X. */
const OLD_OVERLAY_STYLES = ['a', 'b']
/** Bien au-delà des vraies valeurs (clé Steam 32, NPSSO 64, secret Discord 32 caractères). */
export const MAX_TEXT = 256

/**
 * Ne garde que les réglages connus, avec le bon type (le reste vient de l'interface et n'est pas fiable).
 * `demoAllowed` : le mode démo n'existe qu'en développement ; sinon toujours coupé, quoi qu'en dise l'enregistrement.
 */
export function cleanPatch(patch: unknown, demoAllowed = false): Partial<Settings> {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  const clean: Partial<Settings> = {}
  for (const k of TEXT_KEYS) {
    const v = p[k]
    // Une valeur masquée renvoyée par erreur ne doit jamais remplacer le vrai secret.
    if (typeof v === 'string' && v.length <= MAX_TEXT && !v.startsWith('•')) clean[k] = v.trim()
  }
  if (typeof clean.discordGuildId === 'string') clean.discordGuildId = discordGuildIdFrom(clean.discordGuildId)
  if (typeof p.demoMode === 'boolean') clean.demoMode = demoAllowed && p.demoMode
  if (typeof p.gameNews === 'boolean') clean.gameNews = p.gameNews
  if (typeof p.closeToTray === 'boolean') clean.closeToTray = p.closeToTray
  if (typeof p.startWithWindows === 'boolean') clean.startWithWindows = p.startWithWindows
  if (typeof p.bf6Recap === 'boolean') clean.bf6Recap = p.bf6Recap
  if (typeof p.cs2Live === 'boolean') clean.cs2Live = p.cs2Live
  if (typeof p.cs2RecapOpen === 'boolean') clean.cs2RecapOpen = p.cs2RecapOpen
  if (typeof p.gameReadyAlert === 'boolean') clean.gameReadyAlert = p.gameReadyAlert
  if (typeof p.updateOnQuit === 'boolean') clean.updateOnQuit = p.updateOnQuit
  if (p.updateSkipped === null || isVersion(p.updateSkipped)) clean.updateSkipped = p.updateSkipped
  if (isVersion(p.notesSeen)) clean.notesSeen = p.notesSeen
  if (typeof p.friendAlerts === 'string' && ALERT_MODES.includes(p.friendAlerts)) clean.friendAlerts = p.friendAlerts as Settings['friendAlerts']
  if (Array.isArray(p.friendWatch)) clean.friendWatch = [...new Set(p.friendWatch.filter((x): x is string => typeof x === 'string' && /^(steam|psn):[\w-]{1,64}$/.test(x)))].slice(0, 200)
  if (typeof p.launchWindow === 'string' && WINDOW_MODES.includes(p.launchWindow)) clean.launchWindow = p.launchWindow as Settings['launchWindow']
  if (typeof p.cs2Overlay === 'string' && OVERLAY_STYLES.includes(p.cs2Overlay)) clean.cs2Overlay = p.cs2Overlay as Settings['cs2Overlay']
  else if (typeof p.cs2Overlay === 'string' && OLD_OVERLAY_STYLES.includes(p.cs2Overlay)) clean.cs2Overlay = 'c'
  if (typeof p.overlaySize === 'string' && OVERLAY_SIZES.includes(p.overlaySize)) clean.overlaySize = p.overlaySize as Settings['overlaySize']
  if (p.overlayPos && typeof p.overlayPos === 'object' && !Array.isArray(p.overlayPos)) clean.overlayPos = cleanOverlayPos(p.overlayPos as Record<string, unknown>)
  if (isValidHotkey(p.overlayHotkey)) clean.overlayHotkey = p.overlayHotkey
  if (typeof p.profileName === 'string') clean.profileName = cleanProfileName(p.profileName)
  // '' remet la photo du compte ; sinon seulement une vraie image (PNG, JPEG, WebP) de taille raisonnable.
  if (p.profileAvatar === '' || isProfileAvatar(p.profileAvatar)) clean.profileAvatar = p.profileAvatar as string
  return clean
}

/** Ce que voit l'interface : les secrets sont remplacés par « •••• » et leurs 4 derniers caractères (vide s'ils ne sont pas renseignés). */
export function publicSettings(s: Settings): Settings {
  const masked = { ...s }
  for (const k of SECRET_KEYS) masked[k] = s[k] ? `••••••••${s[k].length >= 12 ? s[k].slice(-4) : ''}` : ''
  return masked
}
