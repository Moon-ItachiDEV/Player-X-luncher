// Tests des membres Discord masqués (npm run test:friends) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Friend, FriendsResult } from '@shared/types'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { AMBIGUOUS_BOTS, cleanMemberPrefs, hideMembers, isKnownBot, KNOWN_BOTS, memberKey, withMemberHidden } from './discordMembers.ts'

const member = (n: number, name: string, status: Friend['status'] = 'online'): Friend => ({ id: `discord:${n}`, platform: 'discord', name, status })
const names = (r: FriendsResult): string[] => r.friends.map((f) => f.name)

test('bots reconnus : liste, variantes typographiques, numéro d’instance, suffixe « bot », étiquettes des admins', () => {
  const yes = [
    'MonitoRSS',
    'PatchBot',
    'Soundboards.gg',
    'mee6',
    'MEE6 Bot',
    '𝐌𝐄𝐄𝟔',
    'Ｍｅｅ６',
    'ProBot ✨',
    'FredBoat♪♪',
    'Jockie Music (1)',
    'Rythm 2',
    'Pokétwo',
    'Poketwo',
    'Carl-bot',
    'DISBOARD',
    'Dyno-bot',
    '[BOT] Annonces',
    'Musique (bot)',
    '🤖 Logs',
    ...KNOWN_BOTS
  ]
  for (const n of yes) assert.equal(isKnownBot(n), true, n)
})

test('membres jamais pris pour des bots', () => {
  const no = [
    'MoonDev no Jutsu',
    'Timeout no Jutsu - Angel',
    'ELISA MES MORTS',
    'MEE7',
    'Hydraa',
    'xX_Hydra_Xx',
    'Craig Martin',
    'Le Bot',
    'NoobBot',
    'Groovy Gamer',
    'Dyno 123',
    'Bot',
    '',
    '🎵',
    'Robot Lunaa',
    'Abbot',
    '[BOTTE] Mira',
    // Pseudos de joueurs qui sont aussi des noms de bots : jamais masqués sans « Bot » ou une étiquette.
    'Rover',
    'rover',
    'Rover 7',
    'OwO',
    'OwO 69',
    'Tatsumaki',
    'Nadeko',
    'Dyno',
    'Dyno 12',
    'Loritta',
    'Nekotina',
    'Vexera',
    'Lurkr'
  ]
  for (const n of no) assert.equal(isKnownBot(n), false, JSON.stringify(n))
})

test('noms de bots qui sont aussi des pseudos courants : seulement avec « Bot » ou une étiquette', () => {
  for (const n of ['Hydra Bot', '[BOT] Craig', 'Sofi-bot', 'Arcane (bot)', 'Dyno Bot', '[BOT] OwO', 'Rover Bot', 'Tatsumaki (bot)', 'Nadeko-bot']) {
    assert.equal(isKnownBot(n), true, n)
  }
  for (const n of ['Hydra', 'Sofi', 'Arcane', 'Craig', ...AMBIGUOUS_BOTS]) assert.equal(isKnownBot(n), false, n)
})

test('listes sans doublon une fois normalisées, et sans nom à la fois sûr et ambigu', () => {
  const keys = [...KNOWN_BOTS, ...AMBIGUOUS_BOTS].map((n) =>
    memberKey(n)
      .replace(/[^\p{L}\p{N} ._-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(memberKey('  Timeout   no Jutsu - Angel '), 'timeout no jutsu - angel')
  assert.equal(memberKey('Élisa'), 'elisa')
})

test('hideMembers : la vraie liste garde les 2 humains, masque 3 bots, jamais un ami Steam', () => {
  const input: FriendsResult = {
    friends: [
      member(0, 'MonitoRSS'),
      member(1, 'MoonDev no Jutsu'),
      member(2, 'PatchBot'),
      member(3, 'Soundboards.gg'),
      member(4, 'Timeout no Jutsu - Angel', 'away'),
      { id: 'steam:1', platform: 'steam', name: 'MEE6', status: 'online' }
    ],
    errors: { psn: 'Jeton expiré' },
    queried: ['discord', 'steam', 'psn']
  }
  const copy = structuredClone(input)
  const out = hideMembers(input, cleanMemberPrefs(null))
  assert.deepEqual(names(out), ['MoonDev no Jutsu', 'Timeout no Jutsu - Angel', 'MEE6'])
  assert.deepEqual(
    out.hidden?.map((h) => [h.name, h.reason, h.online]),
    [
      ['MonitoRSS', 'bot', true],
      ['PatchBot', 'bot', true],
      ['Soundboards.gg', 'bot', true]
    ]
  )
  assert.deepEqual(out.errors, { psn: 'Jeton expiré' })
  assert.deepEqual(out.queried, ['discord', 'steam', 'psn'])
  // L'entrée n'est pas modifiée.
  assert.deepEqual(input, copy)
})

test('hideMembers : masqués à la main, hors ligne, doublons de pseudo', () => {
  const input: FriendsResult = { friends: [member(0, 'Mira'), member(1, 'mira'), member(2, 'Lunaa'), member(3, 'MEE6')], errors: {} }
  const prefs = withMemberHidden(withMemberHidden(cleanMemberPrefs(null), 'MIRA', true), 'Ghost', true)
  const out = hideMembers(input, prefs)
  assert.deepEqual(names(out), ['Lunaa'])
  assert.deepEqual(
    out.hidden?.map((h) => [h.name, h.reason, h.online]),
    [
      ['Ghost', 'user', false],
      ['MEE6', 'bot', true],
      ['Mira', 'user', true]
    ]
  )
})

test('withMemberHidden : aller-retour, bot réaffiché puis masqué de nouveau, casse ignorée', () => {
  const empty = cleanMemberPrefs(null)
  const hidden = withMemberHidden(empty, 'Mira', true)
  assert.deepEqual(hidden, { hidden: ['Mira'], shown: [] })
  assert.deepEqual(withMemberHidden(hidden, 'mira', false), empty)
  assert.deepEqual(withMemberHidden(withMemberHidden(hidden, 'MIRA', true), 'Mira', true), { hidden: ['Mira'], shown: [] })
  // Un bot connu réaffiché entre dans `shown` ; masqué de nouveau, il redevient un simple bot.
  const shown = withMemberHidden(empty, 'PatchBot', false)
  assert.deepEqual(shown, { hidden: [], shown: ['PatchBot'] })
  assert.deepEqual(names(hideMembers({ friends: [member(0, 'PatchBot')], errors: {} }, shown)), ['PatchBot'])
  assert.deepEqual(withMemberHidden(shown, 'patchbot', true), empty)
})

test('cleanMemberPrefs : entrée douteuse, pseudos coupés à 128 caractères, 200 au plus', () => {
  for (const junk of [null, undefined, 3, 'x', [], { hidden: 'x', shown: 7 }]) assert.deepEqual(cleanMemberPrefs(junk), { hidden: [], shown: [] })
  assert.deepEqual(cleanMemberPrefs({ hidden: ['a', 'A ', 3, '', '  ', 'b', null], shown: ['🎵'] }), { hidden: ['a', 'b'], shown: ['🎵'] })
  assert.equal(cleanMemberPrefs({ hidden: ['x'.repeat(300)] }).hidden[0].length, 128)
  const many = cleanMemberPrefs({ hidden: Array.from({ length: 250 }, (_, i) => `Membre ${i}`) }).hidden
  assert.equal(many.length, 200)
  assert.equal(many[199], 'Membre 249')
})
