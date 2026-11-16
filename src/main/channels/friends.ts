import { app, shell } from 'electron'
import type { Friend, FriendsResult } from '@shared/types'
import { handle } from '../ipc'
import { checkFriends, demoFriendAlert, testFriendAlert } from '../services/alerts'
import { DEMO_FRIENDS } from '../services/demo'
import { hideMembers, withMemberHidden } from '../services/discordMembers'
import { getAllFriends, steamFriendProfile, steamJoinUrl } from '../services/friends'
import { getMemberPrefs, getSettings, saveMemberPrefs } from '../services/settings'
import type { ChannelDeps } from './deps'

// Canaux des amis : liste (Steam, Discord, PSN), fiche Steam, membres du serveur masqués, salons vocaux.

/** Dernière liste d'amis réelle, pour l'alerte d'essai. */
let lastFriends: Friend[] = []
/** Dernière liste réelle avant le retrait des membres Discord masqués : « Masquer » / « Afficher » la refiltre sans redemander à Discord. */
let lastRaw: FriendsResult = { friends: [], errors: {} }
/** Numéro de la dernière demande de la liste d'amis. */
let friendsAsked = 0

export function registerFriendChannels(d: ChannelDeps): void {
  // Membres Discord masqués (bots connus, « Masquer ») retirés ici : aucun écran ne les voit.
  handle('friends:list', async () => {
    if (getSettings().demoMode) {
      demoFriendAlert(DEMO_FRIENDS)
      return hideMembers(d.demoFriends(), getMemberPrefs(true))
    }
    // Deux demandes qui se croisent : seule la plus récente met à jour la dernière liste (la plus lente ne l'écrase plus avec du périmé).
    const ticket = ++friendsAsked
    const raw = await getAllFriends()
    // Filtré après l'attente : un « Masquer » envoyé pendant la récupération compte déjà.
    const result = hideMembers(raw, getMemberPrefs(false))
    if (ticket !== friendsAsked) return result
    lastRaw = raw
    checkFriends(result)
    lastFriends = raw.friends
    return result
  })
  // Profil Steam d'un ami de la dernière liste : rien en mode démo (jamais de données inventées), rien sans clé.
  handle('friends:profile', async (_e, id: unknown) => {
    const s = getSettings()
    if (s.demoMode || !s.steamApiKey || typeof id !== 'string' || !lastFriends.some((f) => f.id === id && f.platform === 'steam')) return null
    return steamFriendProfile(s.steamApiKey, id)
  })
  // Steam ouvert sur la discussion avec l'ami, ou sur sa partie. L'adresse est faite ici, jamais par l'interface.
  handle('friends:steam', async (_e, action: unknown, id: unknown) => {
    const f = typeof id === 'string' ? lastFriends.find((x) => x.id === id && x.platform === 'steam') : undefined
    if (!f) throw new Error('Ami Steam introuvable : actualise tes amis.')
    const sid = f.id.slice('steam:'.length)
    const url = action === 'message' ? `steam://friends/message/${sid}` : action === 'join' ? steamJoinUrl(f.id) : undefined
    if (!url || !/^steam:\/\/(friends\/message\/\d{17}|connect\/[\d.:]+|joinlobby\/\d+\/\d+\/\d{17})$/.test(url)) throw new Error('Sa partie ne peut plus être rejointe.')
    await shell.openExternal(url)
  })
  handle('friends:hide-member', (_e, name: unknown, hidden: unknown) => {
    const clean = typeof name === 'string' ? name.trim() : ''
    if (!clean || clean.length > 128 || typeof hidden !== 'boolean') throw new Error('Membre inconnu.')
    const demo = getSettings().demoMode
    saveMemberPrefs(demo, withMemberHidden(getMemberPrefs(demo), clean, hidden))
    return hideMembers(demo ? d.demoFriends() : lastRaw, getMemberPrefs(demo))
  })
  // Salon vocal du serveur Discord : l'appli Discord s'il est installé, sinon le site. L'adresse est faite ici,
  // avec le serveur des Paramètres ; l'interface ne donne que l'identifiant du salon.
  handle('discord:open-channel', async (_e, channelId: unknown) => {
    if (typeof channelId !== 'string' || !/^\d{15,22}$/.test(channelId)) throw new Error('Salon inconnu.')
    if (getSettings().demoMode) return 'demo'
    const guild = getSettings().discordGuildId
    if (!/^\d{15,22}$/.test(guild)) throw new Error('Serveur Discord inconnu : vérifie son identifiant dans Paramètres › Comptes.')
    let app_ = ''
    try {
      app_ = app.getApplicationNameForProtocol('discord://')
    } catch {
      /* inconnu : le site */
    }
    await shell.openExternal(app_ ? `discord://-/channels/${guild}/${channelId}` : `https://discord.com/channels/${guild}/${channelId}`)
    return 'opened'
  })
  handle('friends:test-alert', () => testFriendAlert(getSettings().demoMode ? DEMO_FRIENDS : lastFriends))
}
