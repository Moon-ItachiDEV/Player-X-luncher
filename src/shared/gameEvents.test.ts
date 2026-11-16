// Tests des événements des jeux (npm run test:ready) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { eventDates, eventLabel, eventWhen, parseStoreEvents } from './gameEvents.ts'

const NOW = new Date(2026, 9, 30, 12, 0).getTime()
const H = 3600_000
const sec = (ms: number): number => Math.floor(ms / 1000)
const ev = (gid: string, type: number, startH: number, endH?: number, extra: Record<string, unknown> = {}) => ({
  gid,
  event_name: `Événement ${gid}`,
  event_type: type,
  rtime32_start_time: sec(NOW + startH * H),
  rtime32_end_time: endH === undefined ? 0 : sec(NOW + endH * H),
  ...extra
})

test('en cours d’abord (qui finit le plus tôt), puis à venir (le plus proche)', () => {
  const list = parseStoreEvents(
    [ev('3', 32, 72, 900), ev('1', 22, -20, 52), ev('2', 25, 10, 40), ev('4', 35, -5, 10)],
    '1245620',
    NOW
  )
  assert.deepEqual(
    list.map((e) => e.id),
    ['4', '1', '2', '3']
  )
  assert.equal(list[1].url, 'https://store.steampowered.com/news/app/1245620/view/1')
})

test('jamais : promos, notes de patch, actus, republications, événements finis ou trop lointains', () => {
  const list = parseStoreEvents(
    [ev('1', 20, -1, 10), ev('2', 21, -1, 10), ev('3', 12, -1, 10), ev('4', 28, -1, 10), ev('5', 34, -1, 10), ev('6', 22, -50, -2), ev('7', 22, 24 * 50)],
    '730',
    NOW
  )
  assert.deepEqual(list, [])
})

test('sans fin donnée : en cours pendant 24 h, puis oublié', () => {
  assert.equal(parseStoreEvents([ev('1', 32, -3)], '730', NOW).length, 1)
  assert.equal(parseStoreEvents([ev('1', 32, -30)], '730', NOW).length, 0)
})

test('titre : celui de l’annonce (traduit) d’abord, entités décodées ; sans titre ni gid valable, ignoré', () => {
  const [e] = parseStoreEvents([ev('1', 22, 5, 9, { announcement_body: { headline: 'Double XP &amp; butin' } })], '730', NOW)
  assert.equal(e.title, 'Double XP & butin')
  assert.equal(parseStoreEvents([ev('x', 22, 5, 9)], '730', NOW).length, 0)
  assert.equal(parseStoreEvents([{ ...ev('1', 22, 5, 9), event_name: '' }], '730', NOW).length, 0)
  assert.deepEqual(parseStoreEvents('nope', '730', NOW), [])
})

test('quand : « finit dans », « commence dans », puis la date au-delà d’une semaine', () => {
  const live = { id: '1', title: 't', type: 22, start: NOW - H, end: NOW + 52 * H, url: '' }
  assert.deepEqual(eventWhen(live, NOW), { live: true, text: 'finit dans 2 j' })
  assert.deepEqual(eventWhen({ ...live, start: NOW + 3 * H, end: undefined }, NOW), { live: false, text: 'commence dans 3 h' })
  assert.deepEqual(eventWhen({ ...live, start: NOW + 20 * 60_000 }, NOW), { live: false, text: 'commence dans 20 min' })
  assert.deepEqual(eventWhen({ ...live, end: undefined }, NOW), { live: true, text: 'en ce moment' })
  const far = eventWhen({ ...live, start: NOW + 10 * 24 * H }, NOW)
  assert.equal(far.live, false)
  assert.match(far.text, /^commence le \d{1,2} /)
})

test('dates et libellés', () => {
  const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
  const e = { id: '1', title: 't', type: 22, start: NOW, end: NOW + 72 * H, url: '' }
  assert.equal(eventDates(e), `Du ${day.format(NOW)} au ${day.format(NOW + 72 * H)}`)
  assert.match(eventDates({ ...e, end: undefined }), /^Le .+ à \d{2}:\d{2}$/)
  assert.match(eventDates({ ...e, end: NOW + 2 * H }), /^Le .+, de \d{2}:\d{2} à \d{2}:\d{2}$/)
  assert.equal(eventLabel(22), "Bonus d'XP")
  assert.equal(eventLabel(32), 'Nouvelle saison')
  assert.equal(eventLabel(999), 'Événement')
})
