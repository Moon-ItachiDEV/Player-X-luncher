// Événements des jeux : saisons, bonus d'XP, défis, bêtas… publiés par l'éditeur sur la page Steam du jeu, lus dans la
// même liste du magasin que les actus en français (news.ts, gardée 30 min). Rien d'inventé : sans événement daté, rien.
// « Me prévenir » : le rappel est gardé sur ce PC ; quand l'événement commence, une carte dans Player X (fenêtre au premier
// plan) ou une notification Windows. Player X fermé à ce moment-là : le rappel part au démarrage suivant, 6 h au plus après.
import { app, Notification } from 'electron'
import { join } from 'node:path'
import { parseStoreEvents } from '@shared/gameEvents'
import { cleanName } from '@shared/text'
import type { Game, GameEvent, GameEventStarted, GameEvents } from '@shared/types'
import { getKv, setKv } from '../db'
import { focusedAppWindow, sendTo, showMainAndSend } from '../windows'
import { steamAppIds } from './artwork'
import { storeEvents } from './news'
import { getSettings } from './settings'
import { logError } from '../crashLog'

interface Reminder extends GameEventStarted {
  start: number
}

/** Rappels plus vieux que ça (Player X fermé au début de l'événement) : oubliés sans alerte. */
const LATE_MS = 6 * 3600_000
const CHECK_MS = 60_000
const MAX_REMINDERS = 50

/** Dernière liste lue par jeu : « Me prévenir » y retrouve le titre et la date de l'événement. */
const lastRead = new Map<string, GameEvent[]>()

/** Comme le reste du mode démo, ses rappels vivent à part. */
function key(): string {
  return getSettings().demoMode ? 'demoEventReminders' : 'eventReminders'
}

function reminders(): Reminder[] {
  const list = getKv<unknown>(key(), [])
  return Array.isArray(list) ? (list as Reminder[]).filter((r) => r && typeof r.eventId === 'string' && typeof r.start === 'number') : []
}

/** Événements en cours et à venir d'un jeu, et ceux pour lesquels un rappel est demandé. Actus coupées : rien. */
export async function getGameEvents(game: Game): Promise<GameEvents> {
  const appId = steamAppIds([game]).get(game.id) ?? null
  const mine = reminders()
    .filter((r) => r.gameId === game.id)
    .map((r) => r.eventId)
  if (!appId || !getSettings().gameNews) return { appId, events: [], reminders: mine }
  const events = parseStoreEvents(await storeEvents(appId), appId, Date.now())
  lastRead.set(game.id, events)
  return { appId, events, reminders: mine }
}

/** « Me prévenir » (ou l'annule) pour un événement à venir lu dans la fiche. Renvoie les rappels de ce jeu. */
export function setEventReminder(game: Game, eventId: string, on: boolean): string[] {
  let list = reminders().filter((r) => !(r.gameId === game.id && r.eventId === eventId))
  if (on) {
    const e = lastRead.get(game.id)?.find((x) => x.id === eventId)
    if (!e) throw new Error('Événement introuvable : rouvre la fiche du jeu.')
    if (e.start <= Date.now()) throw new Error('Cet événement a déjà commencé.')
    list = [...list, { gameId: game.id, gameName: cleanName(game.name), eventId, title: e.title, url: e.url, start: e.start }].slice(-MAX_REMINDERS)
  }
  setKv(key(), list)
  return list.filter((r) => r.gameId === game.id).map((r) => r.eventId)
}

const live = new Set<Notification>()

function deliver(e: GameEventStarted): void {
  const win = focusedAppWindow()
  if (win) {
    sendTo(win, 'events:started', e)
    return
  }
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: `Ça commence : ${e.title}`,
    body: `${e.gameName} · Clique pour ouvrir Player X.`,
    icon: join(app.getAppPath(), 'resources', 'icon.png')
  })
  live.add(n)
  const drop = (): boolean => live.delete(n)
  n.on('click', () => {
    drop()
    showMainAndSend('events:started', e)
  })
  n.on('close', drop)
  n.on('failed', drop)
  n.show()
}

/** Rappels arrivés à l'heure : prévenus (6 h de retard au plus), puis retirés. */
function check(): void {
  const now = Date.now()
  const list = reminders()
  const due = list.filter((r) => r.start <= now)
  if (!due.length) return
  setKv(key(), list.filter((r) => r.start > now))
  for (const r of due) {
    if (now - r.start > LATE_MS) continue
    deliver({ gameId: r.gameId, gameName: r.gameName, eventId: r.eventId, title: r.title, url: r.url })
  }
}

export function startEventReminders(): void {
  const safeCheck = (): void => {
    try {
      check()
    } catch (e) {
      logError('événements', e)
    }
  }
  safeCheck()
  setInterval(safeCheck, CHECK_MS)
}
