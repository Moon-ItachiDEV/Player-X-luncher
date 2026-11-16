// Événements des jeux : lecture de la liste d'événements du magasin Steam (ajaxgetpartnereventspageable, celle des actus
// en français) et libellés. Module pur : processus principal (services/events.ts) et interface. Testé sous Node seul
// (npm run test:ready). Types d'événements : EProtoClanEventType de Steam (steam-user, enums/EProtoClanEventType.js).
import type { GameEvent } from './types'

/**
 * Types montrés, avec leur libellé. Jamais montrés : les promos (20, 21), les notes de patch (12) et les actus (28), déjà
 * dans l'onglet Actus, les republications (34) et les types sans rapport avec le jeu (1, 3 à 9, 27).
 */
const LABEL: Record<number, string> = {
  2: 'Événement',
  10: 'Sortie',
  11: 'Diffusion',
  13: 'Mise à jour annoncée',
  14: 'Grosse mise à jour',
  15: "Sortie d'un contenu additionnel",
  16: 'Sortie à venir',
  17: 'Tournoi en direct',
  18: 'Diffusion des développeurs',
  19: 'Diffusion',
  22: "Bonus d'XP",
  23: 'Butin',
  24: 'Avantages',
  25: 'Défi',
  26: 'Concours',
  29: 'Bêta',
  30: 'Nouveau contenu',
  31: 'Essai gratuit',
  32: 'Nouvelle saison',
  33: 'Saison',
  35: 'Événement en jeu'
}

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
/** À venir : dans les 45 prochains jours. */
const AHEAD_MS = 45 * DAY
/** Sans fin donnée par l'éditeur : « en cours » pendant 24 h après le début. */
const NO_END_MS = DAY

export function eventLabel(type: number): string {
  return LABEL[type] ?? 'Événement'
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>' }

function clean(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .replace(/&(amp|quot|#39|apos|lt|gt);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

/** La fin, ou 24 h après le début quand l'éditeur n'en donne pas. */
export function eventUntil(e: GameEvent): number {
  return e.end ?? e.start + NO_END_MS
}

/**
 * Événements en cours ou à venir (45 jours au plus) d'une liste du magasin, en cours d'abord (celui qui finit le plus
 * tôt), puis à venir (le plus proche d'abord). Titre : celui de l'annonce (traduit quand l'éditeur l'a fait), sinon le
 * nom de l'événement. Les dates sont celles de Steam (secondes Unix).
 */
export function parseStoreEvents(raw: unknown, appId: string, now: number): GameEvent[] {
  if (!Array.isArray(raw) || !/^\d{1,10}$/.test(appId)) return []
  const out: GameEvent[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const type = Number(e.event_type)
    if (!LABEL[type]) continue
    const id = typeof e.gid === 'string' && /^\d{1,24}$/.test(e.gid) ? e.gid : ''
    const startS = Number(e.rtime32_start_time)
    const endS = Number(e.rtime32_end_time)
    if (!id || seen.has(id) || !Number.isFinite(startS) || startS <= 0) continue
    const start = startS * 1000
    const end = Number.isFinite(endS) && endS > startS ? endS * 1000 : undefined
    if ((end ?? start + NO_END_MS) <= now || start - now > AHEAD_MS) continue
    const body = e.announcement_body && typeof e.announcement_body === 'object' ? (e.announcement_body as Record<string, unknown>) : null
    const title = clean(body?.headline) || clean(e.event_name)
    if (!title) continue
    seen.add(id)
    out.push({ id, title, type, start, ...(end ? { end } : {}), url: `https://store.steampowered.com/news/app/${appId}/view/${id}` })
  }
  const live = (e: GameEvent): boolean => e.start <= now
  return out.sort((a, b) => (live(a) === live(b) ? (live(a) ? eventUntil(a) - eventUntil(b) : a.start - b.start) : live(a) ? -1 : 1))
}

/** « dans 12 min », « dans 3 h », « dans 2 j » ; au-delà d'une semaine, la date. */
function inLabel(at: number, now: number): string {
  const d = at - now
  if (d < HOUR) return `dans ${Math.max(1, Math.round(d / MIN))} min`
  if (d < DAY) return `dans ${Math.round(d / HOUR)} h`
  if (d < 7 * DAY) return `dans ${Math.round(d / DAY)} j`
  return `le ${dayFmt.format(at)}`
}

const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** En cours (commencé) ou à venir, et ce qu'il reste : « finit dans 2 j », « commence dans 3 h ». */
export function eventWhen(e: GameEvent, now: number): { live: boolean; text: string } {
  if (e.start <= now) return { live: true, text: e.end ? `finit ${inLabel(e.end, now)}` : 'en ce moment' }
  return { live: false, text: `commence ${inLabel(e.start, now)}` }
}

/** « Du 30 oct. au 2 nov. », « Le 5 nov. à 19:00 », « Le 5 nov., de 18:00 à 22:00 » (heure de ce PC). */
export function eventDates(e: GameEvent): string {
  if (!e.end) return `Le ${dayFmt.format(e.start)} à ${timeFmt.format(e.start)}`
  if (dayFmt.format(e.start) === dayFmt.format(e.end)) return `Le ${dayFmt.format(e.start)}, de ${timeFmt.format(e.start)} à ${timeFmt.format(e.end)}`
  return `Du ${dayFmt.format(e.start)} au ${dayFmt.format(e.end)}`
}
