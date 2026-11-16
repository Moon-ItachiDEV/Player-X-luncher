// Dernière partie d'un jeu : la plus récente des dates connues (lancement depuis Player X, partie vue par Player X, Steam).
// Module pur, sans Electron ni React : partagé par le processus principal et l'interface, testé sous Node seul (npm run test:played).
import type { Game, PlayedSource } from './types'
import { capitalize, formatPlaytime, timeAgo } from './text'

export type PlayedDates = Partial<Record<PlayedSource, number>>
export interface LastPlayed {
  at: number
  source: PlayedSource
}

/** Sortie de Steam : une date plus ancienne est fausse (secondes prises pour des millisecondes…). */
const OLDEST = Date.UTC(2003, 8, 12)
/** Horloge d'un autre PC un peu en avance : tolérée, ramenée à maintenant. Au-delà, la date est ignorée. */
const MAX_SKEW_MS = 24 * 3600_000
/** À date égale : le lancement depuis Player X, puis la partie vue par Player X, puis Steam. */
const ORDER: PlayedSource[] = ['launch', 'session', 'steam']

/** La plus récente des dates valides, et d'où elle vient ; null sans aucune date. */
export function lastPlayedOf(dates: PlayedDates, now = Date.now()): LastPlayed | null {
  let best: LastPlayed | null = null
  for (const source of ORDER) {
    const v = dates[source]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < OLDEST || v > now + MAX_SKEW_MS) continue
    const at = Math.min(v, now)
    if (!best || at > best.at) best = { at, source }
  }
  return best
}

/** D'où vient la date, pour les légendes et les lecteurs d'écran. */
export const PLAYED_SOURCE: Record<PlayedSource, string> = {
  launch: 'lancé depuis Player X',
  session: 'vu en jeu par Player X',
  steam: 'selon Steam'
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const yearFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

/** « Lancé aujourd'hui · 20:10 », « Joué hier · 18:05 », « Joué le 12 oct. · 14:00 », « Joué le 3 mars 2019 ». « Lancé » seulement depuis Player X. */
export function playedOn(at: number, source: PlayedSource | undefined, now = Date.now()): string {
  const d = new Date(at)
  const verb = source === 'launch' ? 'Lancé' : 'Joué'
  if (d.toDateString() === new Date(now).toDateString()) return `${verb} aujourd'hui · ${timeFmt.format(d)}`
  if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return `${verb} hier · ${timeFmt.format(d)}`
  if (d.getFullYear() === new Date(now).getFullYear()) return `${verb} le ${dayFmt.format(d)} · ${timeFmt.format(d)}`
  return `${verb} le ${yearFmt.format(d)}`
}

/** Pastille d'une carte : « En cours », « Il y a 2 h » ; null sans date (rien n'est affiché). */
export function playedBadge(g: Pick<Game, 'running' | 'lastPlayed'>, now = Date.now()): string | null {
  if (g.running) return 'En cours'
  return g.lastPlayed ? capitalize(timeAgo(g.lastPlayed, now)) : null
}

/** Player X sait que le jeu a déjà été joué : une date, du temps de jeu ou un lancement. */
export function hasPlayed(g: Pick<Game, 'lastPlayed' | 'playtime' | 'launches'>): boolean {
  return !!(g.lastPlayed || g.playtime || g.launches)
}

/**
 * Méta courte d'une jaquette : « 123 h · il y a 2 h », « En jeu · 45 h 45 », « 12 h », « Pas installé · 52 h » ou « Aucune
 * partie connue » (comme la fiche : le jeu a pu être joué avant Player X, ou sans clé Steam Web API).
 */
export function cardMeta(game: Pick<Game, 'running' | 'notInstalled' | 'playtime' | 'lastPlayed'>, now = Date.now()): string {
  const time = game.playtime ? formatPlaytime(game.playtime) : ''
  if (game.running) return `En jeu${time ? ` · ${time}` : ''}`
  if (game.notInstalled) return `Pas installé${time ? ` · ${time}` : ''}`
  // La plateforme est déjà sur la carte : le temps de jeu passe devant quand on le connaît.
  const when = game.lastPlayed ? timeAgo(game.lastPlayed, now) : ''
  if (time) return when ? `${time} · ${when}` : time
  return when ? capitalize(when) : 'Aucune partie connue'
}
