// Ton profil dans Player X : pseudo et photo choisis dans Profil › Modifier. Ils passent avant ceux des comptes reliés
// (Steam, puis Discord, puis PlayStation), partout où Player X te montre : barre du haut, menu du compte, Profil.
// Laissés vides : ceux du compte principal, comme avant. Module pur, testé (npm run test:profile).
import type { Account, FriendPlatform } from './types'

/** Assez pour un pseudo de jeu, pas pour un paragraphe. */
export const PROFILE_NAME_MAX = 32
/** Photo recadrée et réduite dans l'interface (256 × 256, WebP) : quelques dizaines de Ko. Marge pour un PNG. */
export const PROFILE_AVATAR_MAX = 400_000
export const GUEST_NAME = 'Joueur'

const PRIORITY: FriendPlatform[] = ['steam', 'discord', 'psn']

/** Compte principal : Steam, puis Discord, puis PlayStation. */
export function primaryAccount(accounts: Account[]): Account | undefined {
  for (const p of PRIORITY) {
    const a = accounts.find((x) => x.platform === p)
    if (a) return a
  }
  return accounts[0]
}

/** Pseudo propre : sans caractères de contrôle ni espaces en trop, au plus PROFILE_NAME_MAX caractères ('' : celui du compte). */
export function cleanProfileName(v: unknown): string {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim()
  return [...s].slice(0, PROFILE_NAME_MAX).join('').trim()
}

/** Photo enregistrable : une image PNG, JPEG ou WebP en data URL, pas trop lourde ('' : celle du compte). */
export function isProfileAvatar(v: unknown): v is string {
  return typeof v === 'string' && v.length <= PROFILE_AVATAR_MAX && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v)
}

export interface Identity {
  name: string
  avatarUrl?: string
  /** Compte principal (pour l'état « connecté » de l'avatar). */
  account?: Account
  /** Pseudo ou photo choisis dans Player X. */
  customName: boolean
  customAvatar: boolean
}

/** Qui afficher : ton pseudo et ta photo s'ils sont choisis, sinon ceux du compte principal, sinon « Joueur ». */
export function identity(accounts: Account[], s: { profileName?: string; profileAvatar?: string }): Identity {
  const account = primaryAccount(accounts)
  const name = cleanProfileName(s.profileName)
  const avatar = isProfileAvatar(s.profileAvatar) ? s.profileAvatar : ''
  return {
    name: name || account?.name || GUEST_NAME,
    avatarUrl: avatar || account?.avatarUrl,
    account,
    customName: !!name,
    customAvatar: !!avatar
  }
}
