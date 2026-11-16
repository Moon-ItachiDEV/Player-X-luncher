// Tests du relevé des actus et de la page Actus des jeux (npm run test:news) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RawNews } from './newsFormat'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { entryFrom, fetchAll, needsRefresh, NEW_MS, nextSeen, olderThanAll, patchFlags, postsStillFresh, type IndexEntry } from './newsFeed.ts'
// @ts-ignore TS5097
import { cleanRawNews, isPatchPost } from './newsFormat.ts'
// @ts-ignore TS5097
import { SIM_AUTHOR, SIM_FRENCH, SIM_POSTS, simFrenchEvents, simNews } from './newsSimData.ts'

const NOW = new Date(2026, 9, 21, 22, 0).getTime()
const H = 3600_000
const D = 24 * H

const raw = (gid: string, title: string, date: number, tags: string[] = []): RawNews => ({
  gid,
  title,
  url: `https://store.steampowered.com/news/app/1/view/${gid}`,
  contents: '',
  date,
  tags
})

const entry = (items: [string, string, number, boolean][], at = NOW - H): IndexEntry => ({
  at,
  latest: Math.max(0, ...items.map((i) => i[2])),
  items: items.map(([id, title, date, patch]) => ({ id, title, url: `https://store.steampowered.com/news/app/1/view/${id}`, date, patch }))
})

test('entryFrom : 5 annonces gardées, dernier patch cherché dans toutes, aucune annonce', () => {
  const list = [
    raw('1', 'Community Spotlight', NOW - 1 * D),
    raw('2', 'Roadmap', NOW - 2 * D),
    raw('3', 'Dev blog', NOW - 3 * D),
    raw('4', 'Event', NOW - 4 * D),
    raw('5', 'Screenshots', NOW - 5 * D),
    raw('6', 'Update 1.2.3', NOW - 6 * D)
  ]
  const e = entryFrom(list, NOW)
  assert.equal(e.at, NOW)
  assert.equal(e.latest, NOW - D)
  assert.deepEqual(
    e.items?.map((i) => i.id),
    ['1', '2', '3', '4', '5']
  )
  assert.ok(e.items?.every((i) => !i.patch))
  assert.deepEqual(e.patch, { id: '6', title: 'Update 1.2.3', date: NOW - 6 * D })
  assert.deepEqual(entryFrom([], NOW), { at: NOW, latest: 0, items: [] })
  assert.equal(entryFrom([raw('9', 'Release notes', NOW, ['patchnotes'])], NOW).items?.[0].patch, true)
})

test('entryFrom : un patch sorti de la liste (jeu qui publie beaucoup) reste le dernier patch, pas un patch retiré', () => {
  const prev: IndexEntry = { at: NOW - 7 * H, latest: NOW - 6 * D, patch: { id: 'p', title: 'Update 2.0', date: NOW - 9 * D } }
  // Huit annonces plus récentes que le patch, aucune n'en est un : le patch du relevé précédent est gardé.
  const busy = Array.from({ length: 8 }, (_, k) => raw(`n${k}`, `Weekly event ${k}`, NOW - (k + 1) * D))
  assert.deepEqual(entryFrom(busy, NOW, prev).patch, prev.patch)
  // Le patch tombait dans la période lue et n'y est plus (annonce retirée) : oublié.
  const short = busy.slice(0, 3).concat(raw('old', 'Dev blog', NOW - 12 * D))
  assert.equal(entryFrom(short, NOW, prev).patch, undefined)
  // Un nouveau patch remplace l'ancien ; sans relevé précédent ni annonce, rien.
  assert.equal(entryFrom([raw('q', 'Hotfix', NOW - H), ...busy], NOW, prev).patch?.id, 'q')
  assert.equal(entryFrom(busy, NOW).patch, undefined)
  assert.equal(entryFrom([], NOW, prev).patch, undefined)
  // Même règle pour la fiche, qui lit alors ce patch à part (sinon « Dernier patch » s'ouvrirait sur une annonce introuvable).
  assert.equal(olderThanAll(busy, prev.patch!.date), true)
  assert.equal(olderThanAll(short, prev.patch!.date), false)
  assert.equal(olderThanAll(busy, busy[7].date), false)
  assert.equal(olderThanAll([], prev.patch!.date), false)
})

test('postsStillFresh : la fiche relit ses annonces si le relevé en connaît une plus récente ou après 30 min', () => {
  const max = 30 * 60_000
  const cache = { at: NOW - 10 * 60_000, newest: NOW - 2 * H }
  assert.equal(postsStillFresh(cache, NOW - 2 * H, NOW, max), true)
  assert.equal(postsStillFresh(cache, 0, NOW, max), true)
  // « Actualiser » a trouvé une annonce publiée après l'ouverture de la fiche.
  assert.equal(postsStillFresh(cache, NOW - 20 * 60_000, NOW, max), false)
  assert.equal(postsStillFresh({ ...cache, at: NOW - 31 * 60_000 }, NOW - 2 * H, NOW, max), false)
  assert.equal(postsStillFresh(undefined, 0, NOW, max), false)
})

test('fetchAll : 4 à la fois, arrêt après une série entièrement hors ligne, pas après une erreur isolée', async () => {
  const OFF = new Error('off')
  const ids = Array.from({ length: 10 }, (_, i) => String(i))
  const asked: string[] = []
  const offline = (e: unknown): boolean => e === OFF
  // Steam ne répond plus : une seule série demandée, les 6 autres jeux comptent comme échoués.
  const down = await fetchAll(ids, 4, async (id) => (asked.push(id), Promise.reject(OFF)), offline)
  assert.deepEqual(asked, ['0', '1', '2', '3'])
  assert.deepEqual([down.ok, down.failed, down.results.size], [0, 10, 0])
  // Un jeu en erreur (Steam refuse cet appid) ou une série en partie hors ligne : on continue.
  asked.length = 0
  const some = await fetchAll(
    ids,
    4,
    async (id) => {
      asked.push(id)
      if (id === '1') throw new Error('500')
      if (id === '4' || id === '5' || id === '6') throw OFF
      return `entry ${id}`
    },
    offline
  )
  assert.equal(asked.length, 10)
  assert.deepEqual([some.ok, some.failed], [6, 4])
  assert.equal(some.results.get('9'), 'entry 9')
  // Une série de service en panne (pas de réseau en cause) n'arrête pas non plus.
  asked.length = 0
  await fetchAll(ids, 4, async (id) => (asked.push(id), Promise.reject(new Error('500'))), offline)
  assert.equal(asked.length, 10)
  assert.deepEqual(await fetchAll([], 4, async () => 1, offline), { results: new Map(), ok: 0, failed: 0 })
})

test('needsRefresh : jamais relevé, relevé de la 0.7.2 sans annonces, trop vieux', () => {
  assert.equal(needsRefresh(undefined, NOW, 6 * H), true)
  // Relevé écrit par la 0.7.2 : pas de liste d'annonces, redemandé une fois même s'il est récent.
  assert.equal(needsRefresh({ at: NOW - 60_000, latest: NOW - D, patch: { id: '1', title: 'Patch', date: NOW - D } }, NOW, 6 * H), true)
  assert.equal(needsRefresh(entry([], NOW - 5 * H), NOW, 6 * H), false)
  assert.equal(needsRefresh(entry([], NOW - 7 * H), NOW, 6 * H), true)
  // « Actualiser » : tout ce qui a plus d'une minute.
  assert.equal(needsRefresh(entry([], NOW - 2 * 60_000), NOW, 60_000), true)
})

test('nextSeen : tout, jusqu’à une annonce, jamais en arrière, valeur douteuse ignorée', () => {
  assert.equal(nextSeen(0, NOW - H), NOW - H)
  assert.equal(nextSeen(NOW, NOW - H), NOW)
  assert.equal(nextSeen(0, NOW - H, NOW - 3 * H), NOW - 3 * H)
  assert.equal(nextSeen(NOW - 2 * H, NOW - H, NOW - 3 * H), NOW - 2 * H)
  // Une date plus récente que la dernière annonce connue ne va pas plus loin qu'elle.
  assert.equal(nextSeen(0, NOW - H, NOW), NOW - H)
  for (const bad of ['x', NaN, -1, 0, Infinity, null]) assert.equal(nextSeen(5, NOW, bad), 5, String(bad))
})

test('patchFlags : dernier patch toujours, badge seulement s’il a moins de 7 jours et n’a pas été vu', () => {
  const e: IndexEntry = { at: NOW, latest: NOW - 2 * D, patch: { id: 'p', title: 'Patch 1.2', date: NOW - 2 * D } }
  const last = { id: 'p', title: 'Patch 1.2', at: NOW - 2 * D }
  assert.deepEqual(patchFlags(e, 0, NOW), { newPatch: last, lastPatch: last })
  assert.deepEqual(patchFlags(e, NOW - 2 * D, NOW), { lastPatch: last })
  assert.deepEqual(patchFlags(e, 0, NOW - 2 * D + NEW_MS + 1), { lastPatch: last })
  assert.deepEqual(patchFlags({ at: NOW, latest: NOW, items: [] }, 0, NOW), {})
  assert.deepEqual(patchFlags(undefined, 0, NOW), {})
})

test('simulateur : chaque titre est reconnu comme prévu, annonces au format de Steam, signées « Simulation Player X »', () => {
  for (const p of SIM_POSTS) assert.equal(isPatchPost(p.title, p.tags), p.patch, p.title)
  // Aucune image : la page de l'annonce montre l'image du jeu.
  assert.ok(SIM_POSTS.every((p) => !/\[img|STEAM_CLAN/i.test(p.contents)))
  const t0 = NOW
  const cs2 = simNews('730', t0)
  assert.equal(cs2.length, 2)
  const clean = cs2.map(cleanRawNews)
  assert.ok(clean.every((n) => n && n.author === SIM_AUTHOR && n.date < t0))
  assert.ok(clean[0]!.date > clean[1]!.date)
  assert.deepEqual(simNews('900001', t0), [])
  // 13 annonces (dont une d'un jeu pas installé en démo), 9 patchs de moins de 60 jours, 6 de moins de 7 jours.
  const all = SIM_POSTS.map((p) => ({ ...p, date: t0 - p.hours * H }))
  assert.equal(all.length, 13)
  assert.equal(all.filter((p) => p.patch && t0 - p.date < 60 * D).length, 9)
  assert.equal(all.filter((p) => p.patch && t0 - p.date < NEW_MS).length, 6)
  // Versions françaises : sans image, rattachées à leur annonce, et aucune pour Counter-Strike 2 (comme chez Valve).
  assert.ok(Object.values(SIM_FRENCH).every((f) => !/\[img|STEAM_CLAN/i.test(f.contents)))
  assert.deepEqual(simFrenchEvents('730', t0), [])
  const elden = simFrenchEvents('1245620', t0)
  assert.equal(elden.length, 1)
  assert.ok(simNews('1245620', t0).some((n) => n.gid === elden[0].news_post_gid))
})
