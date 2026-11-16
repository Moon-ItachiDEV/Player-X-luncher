import type { Bf6Recap, Bf6RecapPlace, Bf6Row, Bf6Stats } from '@shared/types'

// Bilan d'une session de Battlefield 6 : gametools.network ne donne que des totaux, alors on compare deux relevés,
// celui du lancement du jeu et celui d'après la partie. Sans Electron : testé par `npm run test:bf6`.

/** Ce que donne la comparaison ; les dates et le compte viennent de la session. */
export type SessionNumbers = Omit<Bf6Recap, 'id' | 'account' | 'startedAt' | 'endedAt' | 'partial' | 'seen' | 'sample'>

/** Ligne « All » des cartes, modes et classes : c'est le total, pas une entrée. */
const isTotal = (name: string): boolean => /^(all|tous|toutes|total)$/i.test(name.trim())

/** Cartes et modes gardés dans le bilan. */
const MAX_PLACES = 8

interface Line {
  name: string
  image?: string
  kills: number
  matches: number
  wins: number
  seconds: number
}

/** Lignes regroupées par nom : leur id n'est pas stable d'une lecture à l'autre, et un nom peut revenir deux fois. */
function byName(list: Bf6Row[]): Map<string, Line> {
  const out = new Map<string, Line>()
  for (const r of list) {
    if (isTotal(r.name)) continue
    const key = r.name.trim().toLowerCase()
    const line = out.get(key) ?? { name: r.name.trim(), kills: 0, matches: 0, wins: 0, seconds: 0 }
    line.image ??= r.image
    line.kills += r.kills ?? 0
    line.matches += r.matches ?? 0
    line.wins += r.wins ?? 0
    line.seconds += r.secondsPlayed ?? 0
    out.set(key, line)
  }
  return out
}

/** Ce qui a bougé, ligne par ligne. Une ligne qui recule compte pour zéro. */
function deltas(before: Bf6Row[], after: Bf6Row[]): Line[] {
  const prev = byName(before)
  return [...byName(after)].map(([key, a]) => {
    const b = prev.get(key)
    const d = (k: 'kills' | 'matches' | 'wins' | 'seconds'): number => Math.max(0, a[k] - (b?.[k] ?? 0))
    return { name: a.name, image: a.image ?? b?.image, kills: d('kills'), matches: d('matches'), wins: d('wins'), seconds: d('seconds') }
  })
}

function places(before: Bf6Row[], after: Bf6Row[]): Bf6RecapPlace[] {
  return deltas(before, after)
    .filter((l) => l.matches > 0)
    .sort((a, b) => b.matches - a.matches || b.wins - a.wins)
    .slice(0, MAX_PLACES)
    .map(({ name, image, matches, wins }) => ({ name, ...(image ? { image } : {}), matches, wins: Math.min(wins, matches) }))
}

/**
 * Bilan entre deux relevés du même compte. null tant que rien n'a bougé (gametools n'a pas encore compté la partie),
 * ou si un compteur principal a reculé : ce n'est alors pas le même compte, ou ses stats ont été remises à zéro.
 */
export function sessionNumbers(before: Bf6Stats, after: Bf6Stats): SessionNumbers | null {
  const kills = after.kills - before.kills
  const deaths = after.deaths - before.deaths
  const matches = after.matches - before.matches
  const wins = after.wins - before.wins
  const losses = after.losses - before.losses
  if (kills < 0 || deaths < 0 || matches < 0 || wins < 0 || losses < 0) return null
  // Compteurs secondaires : un léger recul (arrondi du service) ne doit pas faire perdre le bilan.
  const assists = Math.max(0, after.assists - before.assists)
  const revives = Math.max(0, after.revives - before.revives)
  const secondsPlayed = Math.max(0, after.secondsPlayed - before.secondsPlayed)
  if (!kills && !deaths && !matches && !wins && !losses && !assists && !revives && !secondsPlayed) return null

  const weapon = deltas(before.weapons, after.weapons)
    .filter((l) => l.kills > 0)
    .sort((a, b) => b.kills - a.kills || b.seconds - a.seconds)[0]
  // La classe la plus jouée : au temps passé, sinon aux éliminations.
  const role = deltas(before.classes, after.classes)
    .filter((l) => l.seconds > 0 || l.kills > 0)
    .sort((a, b) => b.seconds - a.seconds || b.kills - a.kills)[0]
  const vehicleKills = deltas(before.vehicles, after.vehicles).reduce((n, l) => n + l.kills, 0)

  return {
    kills,
    deaths,
    assists,
    revives,
    matches,
    wins,
    losses,
    secondsPlayed,
    killDeath: deaths ? kills / deaths : kills,
    killsPerMinute: secondsPlayed ? kills / (secondsPlayed / 60) : 0,
    vehicleKills: Math.min(kills, vehicleKills),
    average: { killDeath: before.killDeath, killsPerMinute: before.killsPerMinute, winPercent: before.winPercent },
    ...(weapon ? { weapon: { name: weapon.name, ...(weapon.image ? { image: weapon.image } : {}), kills: weapon.kills } } : {}),
    ...(role ? { role: { name: role.name, kills: role.kills, seconds: role.seconds } } : {}),
    maps: places(before.maps, after.maps),
    modes: places(before.modes, after.modes)
  }
}

const int = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const dec = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** « 1 partie », « 0 victoire », « 3 parties » */
const count = (n: number, one: string, many: string): string => `${int.format(n)} ${n > 1 ? many : one}`

/** « 23 éliminations · K/D 1,53 · 2 victoires sur 3 parties » : le texte de la notification Windows. */
export function recapLine(n: Pick<SessionNumbers, 'kills' | 'killDeath' | 'matches' | 'wins' | 'secondsPlayed'>): string {
  const parts = [count(n.kills, 'élimination', 'éliminations'), `K/D ${dec.format(n.killDeath)}`]
  if (n.matches > 0) parts.push(`${count(n.wins, 'victoire', 'victoires')} sur ${count(n.matches, 'partie', 'parties')}`)
  else if (n.secondsPlayed >= 60) parts.push(`${int.format(Math.round(n.secondsPlayed / 60))} min en partie`)
  return parts.join(' · ')
}
