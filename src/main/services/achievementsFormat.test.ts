// Tests de la lecture des succès Steam (npm run test:achievements) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { buildOverview, mergeAchievements, parseBadges, parseGlobal, parsePlayer, parseSchema, summarize, freshRare } from './achievementsFormat.ts'

test('GetPlayerAchievements : profil privé, jeu sans succès, clé refusée', () => {
  assert.deepEqual(parsePlayer(403, { playerstats: { error: 'Profile is not public', success: false } }), { kind: 'private' })
  assert.deepEqual(parsePlayer(400, { playerstats: { error: 'Requested app has no stats', success: false } }), { kind: 'none' })
  assert.deepEqual(parsePlayer(403, null), { kind: 'key' })
  assert.deepEqual(parsePlayer(500, null), { kind: 'error' })
  // Jeu avec des statistiques mais sans succès : pas de liste.
  assert.deepEqual(parsePlayer(200, { playerstats: { steamID: '1', gameName: 'X', success: true } }), { kind: 'none' })
})

test('GetPlayerAchievements : débloqués, dates, champs douteux', () => {
  const r = parsePlayer(200, {
    playerstats: {
      success: true,
      achievements: [
        { apiname: 'ACH_WIN', achieved: 1, unlocktime: 1_700_000_000, name: '  Victoire ', description: 'Gagner une partie' },
        { apiname: 'ACH_OLD', achieved: 1, unlocktime: 0 },
        { apiname: 'ACH_TODO', achieved: 0, unlocktime: 0 },
        { apiname: '', achieved: 1 },
        null
      ]
    }
  })
  assert.equal(r.kind, 'ok')
  if (r.kind !== 'ok') return
  assert.deepEqual(r.list, [
    { id: 'ACH_WIN', achieved: true, unlocktime: 1_700_000_000, name: 'Victoire', description: 'Gagner une partie' },
    { id: 'ACH_OLD', achieved: true, unlocktime: 0 },
    { id: 'ACH_TODO', achieved: false, unlocktime: 0 }
  ])
})

test('GetSchemaForGame : icônes https seulement, succès cachés sans description', () => {
  const schema = parseSchema({
    game: {
      availableGameStats: {
        achievements: [
          { name: 'ACH_WIN', displayName: 'Victoire', description: 'Gagner', hidden: 0, icon: 'https://cdn.steamstatic.com/a.jpg', icongray: 'https://cdn.steamstatic.com/b.jpg' },
          { name: 'ACH_SECRET', displayName: 'Secret', hidden: 1, icon: 'javascript:alert(1)', icongray: 'http://x/y.jpg' }
        ]
      }
    }
  })
  assert.deepEqual(schema, [
    { id: 'ACH_WIN', name: 'Victoire', hidden: false, description: 'Gagner', icon: 'https://cdn.steamstatic.com/a.jpg', iconGray: 'https://cdn.steamstatic.com/b.jpg' },
    { id: 'ACH_SECRET', name: 'Secret', hidden: true }
  ])
  assert.deepEqual(parseSchema({ game: {} }), [])
})

test('Rareté : nombres ou textes, bornés à 0–100', () => {
  assert.deepEqual(parseGlobal({ achievementpercentages: { achievements: [{ name: 'A', percent: 12.5 }, { name: 'B', percent: '3.2' }, { name: 'C', percent: 'x' }, { name: 'D', percent: 140 }] } }), {
    A: 12.5,
    B: 3.2,
    D: 100
  })
})

test('Niveau Steam : XP dans le niveau en cours', () => {
  assert.deepEqual(parseBadges({ response: { badges: [{}, {}], player_xp: 9470, player_level: 37, player_xp_needed_to_level_up: 130, player_xp_needed_current_level: 9200 } }), {
    level: 37,
    badges: 2,
    xp: 9470,
    xpInLevel: 270,
    xpForLevel: 400
  })
  assert.equal(parseBadges({ response: {} }), undefined)
})

test('Fusion : ordre du jeu, rareté, nom du joueur sans schéma', () => {
  const player = [
    { id: 'B', achieved: true, unlocktime: 100, name: 'Bé' },
    { id: 'A', achieved: false, unlocktime: 0, name: 'A' }
  ]
  const merged = mergeAchievements(player, [{ id: 'A', name: 'Alpha', hidden: false }, { id: 'B', name: 'Bravo', hidden: true, icon: 'https://i/b.jpg' }], { A: 50, B: 2 })
  assert.deepEqual(merged, [
    { id: 'A', name: 'Alpha', hidden: false, percent: 50 },
    { id: 'B', name: 'Bravo', hidden: true, icon: 'https://i/b.jpg', unlockedAt: 100_000, percent: 2 }
  ])
  // Schéma indisponible : les noms viennent de la liste du joueur.
  assert.equal(mergeAchievements(player, [], {})[0].name, 'Bé')
})

test('Résumé et page Trophées : récents, plus rares, 100 %, moyenne', () => {
  const ach = (id: string, percent: number, unlockedAt?: number) => ({ id, name: id, hidden: false, percent, ...(unlockedAt !== undefined ? { unlockedAt } : {}) })
  const a = summarize([ach('a1', 50, 1000), ach('a2', 5, 2000), ach('a3', 1)], 'Jeu A', 60, 0)
  assert.equal(a.unlocked, 2)
  assert.equal(a.total, 3)
  assert.equal(a.lastAt, 2000)
  const b = summarize([ach('b1', 80, 3000), ach('b2', 1.5, 500)], 'Jeu B', 30, 0)
  const c = summarize([ach('c1', 70)], 'Jeu C', 10, 0)
  const o = buildOverview({ '10': a, '20': b, '30': c, '40': { at: 0, minutes: 5, name: 'Sans succès', total: 0, unlocked: 0, picks: [] } }, { state: 'ready', updatedAt: 1 })
  assert.equal(o.games.length, 3)
  assert.equal(o.unlocked, 4)
  assert.equal(o.total, 6)
  assert.equal(o.perfect, 1)
  // Moyenne des jeux commencés (A 2/3, B 2/2) : le jeu C, pas commencé, n'y compte pas.
  assert.equal(o.average, 83)
  assert.deepEqual(
    o.recent.map((p) => p.id),
    ['b1', 'a2', 'a1', 'b2']
  )
  assert.deepEqual(
    o.rarest.map((p) => p.id),
    ['b2', 'a2', 'a1', 'b1']
  )
  assert.equal(o.rarest[0].gameId, 'steam:20')
  assert.equal(o.rarest[0].gameName, 'Jeu B')
})

test('succès rares : seulement ceux débloqués depuis le relevé précédent, sous 15 %, les plus rares d’abord', () => {
  const list = [
    { id: 'A', name: 'A', hidden: false, percent: 3, unlockedAt: 2_000 },
    { id: 'B', name: 'B', hidden: false, percent: 40, unlockedAt: 2_000 },
    { id: 'C', name: 'C', hidden: false, percent: 1.2, unlockedAt: 2_500 },
    { id: 'D', name: 'D', hidden: false, percent: 2, unlockedAt: 500 },
    { id: 'E', name: 'E', hidden: false, percent: 5 },
    { id: 'F', name: 'F', hidden: false, unlockedAt: 3_000 }
  ]
  assert.deepEqual(
    freshRare(list, 1_000).map((a) => a.id),
    ['C', 'A']
  )
  assert.deepEqual(freshRare(list, 5_000), [])
})
