// Tests du profil (npm run test:profile) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { cleanProfileName, identity, isProfileAvatar, PROFILE_AVATAR_MAX, PROFILE_NAME_MAX, primaryAccount } from './profile.ts'

const steam = { platform: 'steam' as const, id: '7656', name: 'xBreezy', avatarUrl: 'https://avatars.steamstatic.com/a.jpg' }
const discord = { platform: 'discord' as const, id: '42', name: 'breezy', avatarUrl: 'https://cdn.discordapp.com/b.png' }
const PNG = 'data:image/png;base64,iVBORw0KGgo='

test('primaryAccount : Steam, puis Discord, puis PlayStation', () => {
  assert.equal(primaryAccount([discord, steam])?.platform, 'steam')
  assert.equal(primaryAccount([discord])?.platform, 'discord')
  assert.equal(primaryAccount([]), undefined)
})

test('identity : le pseudo et la photo choisis passent avant ceux de Steam', () => {
  const me = identity([steam, discord], { profileName: 'AWPINATOR LAO', profileAvatar: PNG })
  assert.deepEqual(me, { name: 'AWPINATOR LAO', avatarUrl: PNG, account: steam, customName: true, customAvatar: true })
})

test('identity : vides, ceux du compte principal ; sans compte, « Joueur »', () => {
  assert.equal(identity([steam], { profileName: '', profileAvatar: '' }).name, 'xBreezy')
  assert.equal(identity([steam], {}).avatarUrl, steam.avatarUrl)
  assert.equal(identity([], {}).name, 'Joueur')
  assert.equal(identity([], {}).avatarUrl, undefined)
  // Seulement le pseudo : la photo reste celle de Steam.
  const me = identity([steam], { profileName: 'Moi' })
  assert.equal(me.avatarUrl, steam.avatarUrl)
  assert.equal(me.customAvatar, false)
})

test('cleanProfileName : espaces, caractères invisibles, longueur', () => {
  assert.equal(cleanProfileName('  AWPINATOR   LAO  '), 'AWPINATOR LAO')
  assert.equal(cleanProfileName('a\u0000b\u202ec\n'), 'abc')
  assert.equal(cleanProfileName('x'.repeat(50)).length, PROFILE_NAME_MAX)
  assert.equal(cleanProfileName('🎮'.repeat(40)), '🎮'.repeat(PROFILE_NAME_MAX))
  assert.equal(cleanProfileName(42), '')
  assert.equal(cleanProfileName('   '), '')
})

test('isProfileAvatar : seulement une image en data URL, pas trop lourde', () => {
  assert.equal(isProfileAvatar(PNG), true)
  assert.equal(isProfileAvatar('data:image/webp;base64,UklGRg=='), true)
  assert.equal(isProfileAvatar('data:image/svg+xml;base64,PHN2Zz4='), false)
  assert.equal(isProfileAvatar('https://evil.example/a.png'), false)
  assert.equal(isProfileAvatar('file:///C:/a.png'), false)
  assert.equal(isProfileAvatar('data:image/png;base64,AAA"onerror'), false)
  assert.equal(isProfileAvatar('data:image/png;base64,' + 'A'.repeat(PROFILE_AVATAR_MAX)), false)
  assert.equal(isProfileAvatar(''), false)
})
