// Membres d'un serveur Discord masqués : bots connus, et membres masqués avec « Masquer ».
// Le widget Discord ne dit pas qui est un bot et anonymise les identifiants : tout repose sur le pseudo affiché.
// Module pur, sans import d'Electron : testé sous Node seul (npm run test:friends).
import type { FriendsResult, HiddenMember } from '@shared/types'

/** Choix de l'utilisateur, par pseudo : `hidden` masqués avec « Masquer », `shown` bots connus réaffichés. */
export interface MemberPrefs {
  hidden: string[]
  shown: string[]
}

/** Bots courants des serveurs Discord, reconnus à leur pseudo exact (aux emojis, symboles et numéro d'instance près). */
export const KNOWN_BOTS = [
  'MEE6',
  'Carl-bot',
  'YAGPDB.xyz',
  'YAGPDB',
  'ProBot',
  'GearBot',
  'Double Counter',
  'Captcha.bot',
  'DraftBot',
  'NadekoBot',
  'Ticket Tool',
  'Ticket King',
  'MonitoRSS',
  'PatchBot',
  'Streamcord',
  'Pingcord',
  'Statbot',
  'ServerStats',
  'Server Stats',
  'Member Count',
  'FreeStuff',
  'DISBOARD',
  'Simple Poll',
  'GiveawayBot',
  'Giveaway Boat',
  'Birthday Bot',
  'TempVoice',
  'VoiceMaster',
  'Rythm',
  'FredBoat',
  'Jockie Music',
  'Green-bot',
  'Soundboards.gg',
  'Dank Memer',
  'Mudae',
  'Pokétwo',
  'Pokecord',
  'Midjourney Bot',
  'Tupperbox',
  'PluralKit',
  'IdleRPG',
  'EPIC RPG',
  'Bloxlink'
]

/**
 * Bots dont le nom est aussi un pseudo courant (un prénom, un personnage, un mot, une frimousse) : reconnus seulement avec
 * « Bot » ou une étiquette [BOT], pour ne jamais cacher un vrai membre. « Dyno » ou « OwO » tout court restent donc affichés.
 */
export const AMBIGUOUS_BOTS = [
  'Arcane',
  'Sofi',
  'Wick',
  'Zira',
  'Gaius',
  'Kiai',
  'Pancake',
  'Craig',
  'Hydra',
  'Groovy',
  'Tickets',
  'Tatsu',
  'Tatsumaki',
  'Karuta',
  'Dyno',
  'Nadeko',
  'OwO',
  'Rover',
  'Loritta',
  'Nekotina',
  'Vexera',
  'Lurkr'
]

/** Identité d'un membre : son pseudo sans accents, casse ni espaces en trop (Discord ne donne rien d'autre de stable). */
export function memberKey(name: string): string {
  return name
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pseudo ramené à l'essentiel : sans emojis ni symboles, sans numéro d'instance (« Jockie Music (1) », « Rythm 2 »). */
function botKey(name: string): string {
  return memberKey(name)
    .replace(/[^\p{L}\p{N} ._-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ ._-]+|[ ._-]+$/g, '')
    .replace(/ \d{1,2}$/, '')
}

const BOTS = new Set(KNOWN_BOTS.map(botKey))
const AMBIGUOUS = new Set(AMBIGUOUS_BOTS.map(botKey))

/** Étiquette posée par les admins du serveur : « [BOT] Annonces », « Musique (bot) », « 🤖 Logs ». */
const BOT_TAG = /^\s*[[({]\s*bot\s*[\])}]|[[({]\s*bot\s*[\])}]\s*$|\u{1F916}/iu

/** Bot connu ou étiqueté comme tel. Jamais de règle « contient bot » : « NoobBot » ou « Le Bot » restent des membres. */
export function isKnownBot(name: string): boolean {
  if (BOT_TAG.test(name.normalize('NFKC'))) return true
  const k = botKey(name)
  if (!k) return false
  if (BOTS.has(k)) return true
  // « MEE6 Bot », « Dyno-bot », « Hydra Bot » : suffixe accepté seulement sur un nom de la liste.
  const m = k.match(/^(.+?)[ -]bot$/)
  return !!m && (BOTS.has(m[1]) || AMBIGUOUS.has(m[1]))
}

const MAX_NAMES = 200
const MAX_NAME = 128

/** Réglage relu de la base (ou reçu) : listes de pseudos non vides, sans doublon, 200 au plus (les plus récents). */
export function cleanMemberPrefs(raw: unknown): MemberPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = (v: unknown): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const n of Array.isArray(v) ? v : []) {
      if (typeof n !== 'string') continue
      const name = n.trim().slice(0, MAX_NAME)
      const k = memberKey(name)
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push(name)
    }
    return out.slice(-MAX_NAMES)
  }
  return { hidden: list(o.hidden), shown: list(o.shown) }
}

/**
 * « Masquer » / « Afficher » un pseudo. Un bot connu masqué de nouveau redevient un bot (il quitte `shown`) ;
 * un bot réaffiché entre dans `shown`. Masquer puis afficher rend le réglage de départ.
 */
export function withMemberHidden(prefs: MemberPrefs, name: string, hide: boolean): MemberPrefs {
  const k = memberKey(name)
  const bot = isKnownBot(name)
  const without = (l: string[]): string[] => l.filter((n) => memberKey(n) !== k)
  return cleanMemberPrefs({
    hidden: hide && !bot ? [...without(prefs.hidden), name] : without(prefs.hidden),
    shown: !hide && bot ? [...without(prefs.shown), name] : without(prefs.shown)
  })
}

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

/** Retire des amis les membres Discord masqués et les liste dans `hidden`. Les amis Steam et PlayStation ne sont jamais filtrés. */
export function hideMembers(result: FriendsResult, prefs: MemberPrefs): FriendsResult {
  const hidden = new Set(prefs.hidden.map(memberKey))
  const shown = new Set(prefs.shown.map(memberKey))
  const out: HiddenMember[] = []
  const online = new Set<string>()
  const friends = result.friends.filter((f) => {
    if (f.platform !== 'discord') return true
    const k = memberKey(f.name)
    const reason = hidden.has(k) ? 'user' : isKnownBot(f.name) && !shown.has(k) ? 'bot' : null
    if (!reason) return true
    // Deux membres au même pseudo : une seule ligne (« Afficher » agit sur le pseudo).
    if (!online.has(k)) {
      online.add(k)
      out.push({ name: f.name, reason, online: true, ...(f.avatarUrl ? { avatarUrl: f.avatarUrl } : {}) })
    }
    return false
  })
  for (const name of prefs.hidden) if (!online.has(memberKey(name))) out.push({ name, reason: 'user', online: false })
  out.sort((a, b) => collator.compare(a.name, b.name))
  return { ...result, friends, hidden: out }
}
