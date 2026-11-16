// Vocal : qui est dans quel salon vocal du serveur Discord, d'après son widget. Module pur, sans React : testé sous Node
// seul (npm run test:friends). Ce sont des membres du serveur, jamais des « amis ».
import type { DiscordChannel, Friend } from '../types'

export interface VoiceRoom<T> {
  channel: DiscordChannel
  people: T[]
}

/** Salons occupés, dans l'ordre du serveur ; dans chaque salon, les personnes dans l'ordre reçu. */
export function voiceRooms<T>(channels: readonly DiscordChannel[] | undefined, items: readonly T[], friendOf: (t: T) => Friend): VoiceRoom<T>[] {
  if (!channels?.length) return []
  const by = new Map<string, T[]>()
  for (const t of items) {
    const f = friendOf(t)
    const id = f.platform === 'discord' ? f.voice?.channelId : undefined
    if (!id) continue
    const list = by.get(id)
    if (list) list.push(t)
    else by.set(id, [t])
  }
  return channels.filter((c) => by.has(c.id)).map((c) => ({ channel: c, people: by.get(c.id) ?? [] }))
}

/** Nombre de personnes en vocal, tous salons confondus. */
export function voiceCount<T>(rooms: readonly VoiceRoom<T>[]): number {
  return rooms.reduce((n, r) => n + r.people.length, 0)
}

/** Sous-ligne d'un membre en vocal : son jeu, sinon « Casque coupé », « Micro coupé » ou « En vocal ». */
export function voiceSub(f: Friend): string {
  if (f.status === 'in-game' && f.game) return f.game
  if (f.voice?.deafened) return 'Casque coupé'
  if (f.voice?.muted) return 'Micro coupé'
  return 'En vocal'
}

/** Pour un lecteur d'écran : « Kaze, Counter-Strike 2, micro coupé ». */
export function voiceAria(f: Friend): string {
  const parts = [f.name]
  if (f.status === 'in-game' && f.game) parts.push(f.game)
  if (f.voice?.deafened) parts.push('casque coupé')
  else if (f.voice?.muted) parts.push('micro coupé')
  return parts.join(', ')
}
