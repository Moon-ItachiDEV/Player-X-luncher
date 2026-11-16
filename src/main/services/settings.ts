import { app } from 'electron'
import { isProfileAvatar } from '@shared/profile'
import type { Account, FriendPlatform, Settings } from '@shared/types'
import { canEncrypt, deleteKv, forgetOtherKeys, getKv, kvStamp, peekOtherKvSecret, peekOtherRaw, setKv } from '../db'
import { cleanMemberPrefs, type MemberPrefs } from './discordMembers'
import { UserError } from '../errors'
import { cleanPatch, defaults, MAX_TEXT, SECRET_KEYS, TEXT_KEYS } from './settingsRules'

export { publicSettings } from './settingsRules'

/** Mode démo permis (développement seulement, voir index.ts) : sinon toujours coupé, quoi qu'en dise l'enregistrement. */
let demoAllowed = false
export function allowDemo(on: boolean): void {
  demoAllowed = on
  cache = null
}

/** La photo de profil vit hors du blob chiffré : elle n'est plus chiffrée, déchiffrée et revérifiée à chaque lecture. */
const AVATAR_KEY = 'profileAvatar'

/**
 * Réglages relus seulement quand la base a changé (getSettings est appelé ~80 fois, dont 2 fois par seconde en partie de
 * CS2) : avant, chaque appel relisait et déchiffrait tout le blob, photo comprise.
 */
let cache: { stamp: string; value: Settings } | null = null

function load(): Settings {
  const raw = getKv<Partial<Settings>>('settings', {})
  // Ancienne version : la photo était dans le blob chiffré. Elle en sort une fois pour toutes.
  if (raw && typeof raw === 'object' && typeof raw.profileAvatar === 'string') {
    const { profileAvatar, ...rest } = raw
    if (profileAvatar) setKv(AVATAR_KEY, profileAvatar)
    setKv('settings', cleanPatch(rest, demoAllowed), true)
    return load()
  }
  const saved = cleanPatch(raw, demoAllowed)
  const avatar = getKv<string>(AVATAR_KEY, '')
  const env = app.isPackaged ? {} : process.env
  // Une valeur enregistrée (même vide) l'emporte sur le .env
  return { ...defaults(env), ...saved, profileAvatar: isProfileAvatar(avatar) ? avatar : '' }
}

export function getSettings(): Settings {
  const stamp = `${kvStamp('settings')}:${kvStamp(AVATAR_KEY)}`
  if (!cache || cache.stamp !== stamp) cache = { stamp, value: load() }
  // Copie : un appelant qui modifierait l'objet ne touche pas au cache.
  return { ...cache.value, friendWatch: [...cache.value.friendWatch] }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  if (TEXT_KEYS.some((k) => typeof patch?.[k] === 'string' && patch[k].length > MAX_TEXT)) throw new Error('Valeur trop longue.')
  const { profileAvatar, ...rest } = cleanPatch(patch, demoAllowed)
  if (typeof profileAvatar === 'string') {
    if (profileAvatar) setKv(AVATAR_KEY, profileAvatar)
    else deleteKv(AVATAR_KEY)
  }
  getSettings() // migre l'ancien blob s'il le faut avant de le compléter
  const next = { ...cleanPatch(getKv<Partial<Settings>>('settings', {}), demoAllowed), ...rest }
  if (!canEncrypt()) {
    // Une clé ou un jeton n'est jamais écrit en clair : sans chiffrement, ils ne sont pas enregistrés (le reste l'est).
    const asked = SECRET_KEYS.some((k) => typeof rest[k] === 'string' && rest[k])
    for (const k of SECRET_KEYS) delete next[k]
    setKv('settings', next)
    if (asked) throw new UserError('Windows ne permet pas de protéger cette clé sur ce PC : elle n’a pas été enregistrée.')
    return getSettings()
  }
  setKv('settings', next, true)
  return getSettings()
}

export function getAccounts(): Account[] {
  return getKv<Account[]>('accounts', [])
}

export function saveAccount(account: Account): void {
  const others = getAccounts().filter((a) => a.platform !== account.platform)
  setKv('accounts', [...others, account], true)
}

export function removeAccount(platform: FriendPlatform): Account[] {
  const rest = getAccounts().filter((a) => a.platform !== platform)
  if (rest.length) setKv('accounts', rest, true)
  else deleteKv('accounts')
  return rest
}

// Membres du serveur Discord masqués : hors des réglages (jamais envoyés à l'interface avec publicSettings).
// Le mode démo a les siens, pour ne jamais toucher aux vrais.

function memberKv(demo: boolean): string {
  return demo ? 'demoDiscordMembers' : 'discordMembers'
}

export function getMemberPrefs(demo: boolean): MemberPrefs {
  return cleanMemberPrefs(getKv<unknown>(memberKv(demo), null))
}

export function saveMemberPrefs(demo: boolean, prefs: MemberPrefs): void {
  setKv(memberKv(demo), cleanMemberPrefs(prefs))
}

// ---------- Reprendre les connexions de Player X (la version GitHub) sur ce PC ----------
// Lecture seule : rien n'est modifié dans Player X. On ne remplace jamais ce qui est déjà rempli ici.

const OTHER_APPS = ['Player X', 'Player X Test']
const NAMES: Record<FriendPlatform, string> = { steam: 'Steam', discord: 'Discord', psn: 'PlayStation' }

/** Le dossier de Player X sur ce PC, s'il a des réglages ou des comptes enregistrés. */
export function playerXConnections(): string | null {
  return OTHER_APPS.find((f) => peekOtherRaw(f, 'settings') !== null || peekOtherRaw(f, 'accounts') !== null) ?? null
}

export async function importPlayerXConnections(): Promise<string[]> {
  const from = playerXConnections()
  if (!from) throw new UserError('Player X n’a aucune connexion enregistrée sur ce PC.')
  let theirs: Partial<Settings> | null, accounts: Account[] | null
  // La clé de chiffrement de Player X n'est lue qu'ici (au clic sur « Reprendre ») et oubliée juste après.
  try {
    theirs = await peekOtherKvSecret<Partial<Settings>>(from, 'settings')
    accounts = await peekOtherKvSecret<Account[]>(from, 'accounts')
  } catch {
    throw new UserError('Les réglages de Player X n’ont pas pu être lus. Ouvre Player X une fois, ferme-le, puis réessaie.')
  } finally {
    forgetOtherKeys()
  }
  const cur = getSettings()
  const got = cleanPatch(theirs ?? {}, demoAllowed)
  const patch: Partial<Settings> = {}
  for (const k of TEXT_KEYS) if (!cur[k] && got[k]) patch[k] = got[k]
  const done = new Set<string>()
  if (patch.discordGuildId || patch.discordClientId || patch.discordClientSecret) done.add('Discord')
  if (patch.steamApiKey) done.add('Steam')
  if (patch.psnNpsso) done.add('PlayStation')
  if (Object.keys(patch).length) saveSettings(patch)
  const mine = new Set(getAccounts().map((a) => a.platform))
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!a || !(a.platform in NAMES) || mine.has(a.platform) || typeof a.id !== 'string' || typeof a.name !== 'string') continue
    saveAccount({ platform: a.platform, id: a.id.slice(0, 64), name: a.name.slice(0, 64), ...(typeof a.avatarUrl === 'string' && /^https:\/\//.test(a.avatarUrl) ? { avatarUrl: a.avatarUrl } : {}) })
    done.add(NAMES[a.platform])
  }
  if (!done.size) throw new UserError('Rien de nouveau : tes connexions de Player X sont déjà ici.')
  return [...done]
}
