// Tests de Vocal (npm run test:friends) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Friend } from '../types'
import { voiceAria, voiceCount, voiceRooms, voiceSub } from './voice'

const CH = [
  { id: '1100000000000000001', name: 'Général' },
  { id: '1100000000000000002', name: '5v5' },
  { id: '1100000000000000003', name: 'Chill' }
]
const m = (name: string, channel?: number, extra: Partial<Friend> = {}): Friend => ({
  id: `discord:${name}`,
  platform: 'discord',
  name,
  status: 'online',
  ...(channel !== undefined ? { voice: { channelId: CH[channel].id } } : {}),
  ...extra
})

test('salons occupés seulement, dans l’ordre du serveur', () => {
  const people = [m('Mira', 2), m('Kaze', 1), m('Yuki'), m('Sora', 1)]
  const rooms = voiceRooms(CH, people, (f) => f)
  assert.deepEqual(
    rooms.map((r) => [r.channel.name, r.people.map((p) => p.name)]),
    [
      ['5v5', ['Kaze', 'Sora']],
      ['Chill', ['Mira']]
    ]
  )
  assert.equal(voiceCount(rooms), 3)
})

test('sans salons connus, ou un ami Steam : personne en vocal', () => {
  assert.deepEqual(voiceRooms(undefined, [m('Kaze', 1)], (f) => f), [])
  const steam: Friend = { id: 'steam:1', platform: 'steam', name: 'Rook', status: 'online', voice: { channelId: CH[1].id } }
  assert.deepEqual(voiceRooms(CH, [steam], (f) => f), [])
})

test('sous-ligne : le jeu, sinon le micro ou le casque coupé', () => {
  assert.equal(voiceSub(m('Kaze', 1, { status: 'in-game', game: 'Counter-Strike 2' })), 'Counter-Strike 2')
  assert.equal(voiceSub(m('Sora', 1, { voice: { channelId: CH[1].id, muted: true } })), 'Micro coupé')
  assert.equal(voiceSub(m('Mira', 2, { voice: { channelId: CH[2].id, muted: true, deafened: true } })), 'Casque coupé')
  assert.equal(voiceSub(m('Yuki', 0)), 'En vocal')
  assert.equal(voiceAria(m('Sora', 1, { status: 'in-game', game: 'CS2', voice: { channelId: CH[1].id, muted: true } })), 'Sora, CS2, micro coupé')
})
