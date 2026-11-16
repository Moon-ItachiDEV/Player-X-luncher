import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { buildFriendProfile, parseEquipped, steamJoin } from './steamProfile.ts'

const SID = '76561198000000001'

test('Rejoindre : serveur, salon, ou rien', () => {
  assert.equal(steamJoin({ gameserverip: '1.2.3.4:27015' }, SID), 'steam://connect/1.2.3.4:27015')
  assert.equal(steamJoin({ gameserverip: '0.0.0.0:0' }, SID), undefined)
  assert.equal(steamJoin({ lobbysteamid: '109775241000000000', gameid: '730' }, SID), `steam://joinlobby/730/109775241000000000/${SID}`)
  assert.equal(steamJoin({ gameserverip: '1.2.3.4:27015;calc' }, SID), undefined)
  assert.equal(steamJoin({}, SID), undefined)
})

test('Fond et cadre : seulement des chemins propres du CDN de Steam', () => {
  const r = parseEquipped({ profile_background: { image_large: 'items/730/abc.jpg', movie_webm: 'items/730/abc.webm' }, avatar_frame: { image_small: 'items/1/f.png' } })
  assert.equal(r.background, 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/items/730/abc.jpg')
  assert.equal(r.backgroundVideo, 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/items/730/abc.webm')
  assert.ok(r.avatarFrame?.endsWith('items/1/f.png'))
  assert.deepEqual(parseEquipped({ profile_background: { image_large: '../x.jpg' } }), {})
  assert.deepEqual(parseEquipped({ profile_background: { image_large: 'https://evil.example/x.jpg' } }), {})
  assert.deepEqual(parseEquipped(undefined), {})
})

test('Profil public : niveau, jeux triés, heures, récents', () => {
  const p = buildFriendProfile(
    SID,
    { player_level: 42 },
    { game_count: 3, games: [{ appid: 730, name: 'Counter-Strike 2', playtime_forever: 600 }, { appid: 10, playtime_forever: 1200 }, { appid: 0 }] },
    { games: [{ appid: 730, name: 'Counter-Strike 2', playtime_2weeks: 90, playtime_forever: 600 }] },
    {}
  )
  assert.equal(p.level, 42)
  assert.equal(p.gameCount, 3)
  assert.equal(p.totalMinutes, 1800)
  assert.deepEqual(p.games?.map((g) => g.appId), [10, 730])
  assert.equal(p.recent?.[0].recentMinutes, 90)
  assert.equal(p.gamesHidden, undefined)
})

test('Profil privé : pas de jeux, et on le dit au lieu de montrer des zéros', () => {
  const p = buildFriendProfile(SID, { player_level: 5 }, {}, {}, undefined)
  assert.equal(p.gamesHidden, true)
  assert.equal(p.games, undefined)
  assert.equal(p.totalMinutes, undefined)
})

test('Vrai profil : niveau et progression, badges, amis, pays, ancienneté, avatar animé', () => {
  const p = buildFriendProfile(SID, { player_level: 57 }, undefined, undefined,
    { animated_avatar: { image_large: 'items/1/a.gif' } },
    { badges: { badges: [1, 2, 3], player_xp: 6200, player_xp_needed_current_level: 6000, player_xp_needed_to_level_up: 300 },
      summary: { loccountrycode: 'FR', timecreated: 1300000000, avatarfull: 'https://avatars.steamstatic.com/abc_full.jpg' },
      friends: [{}, {}] })
  assert.equal(p.badgeCount, 3)
  assert.equal(Math.round((p.levelProgress ?? 0) * 100), 40)
  assert.equal(p.country, 'FR')
  assert.equal(p.memberSince, 1300000000000)
  assert.equal(p.friendCount, 2)
  assert.ok(p.avatarAnimated?.endsWith('items/1/a.gif'))
  assert.equal(p.avatarFull, 'https://avatars.steamstatic.com/abc_full.jpg')
  const q = buildFriendProfile(SID, undefined, undefined, undefined, undefined, { summary: { loccountrycode: 'fr; x', avatarfull: 'https://evil.example/a.jpg' } })
  assert.equal(q.country, undefined)
  assert.equal(q.avatarFull, undefined)
})
