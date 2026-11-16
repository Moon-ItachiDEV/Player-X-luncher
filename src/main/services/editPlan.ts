import { mapLabel } from '@shared/cs2'
import type { Clip, EditProject, EditProjectShot, EditShot } from '@shared/types'
import { fitShot, snapToGrid, timeline, unitOf, FILM_LIMITS } from '@shared/editShots'

// Règles du montage, sans Electron ni fichier (testées par editPlan.test.ts) : d'une liste de clips à une liste de plans.
// Première règle, « bout à bout » : chaque kill garde ce qui l'amène et ce qui le suit ; deux kills proches font un seul plan ;
// les clips se suivent dans l'ordre du match. Pas encore de musique : rien n'est calé sur un tempo.

/**
 * Ce qu'un plan garde (secondes). Un kill : 3 s avant, 1,2 s après ; le jeu l'annonce 0,1 à 0,6 s après le vrai moment, donc
 * le vrai kill tombe vers 2,6 s. Un clip gardé à la main : ce qui vient de se passer (8 s), l'appui arrive après l'action.
 */
export const SHOT = { lead: 3, tail: 1.2, manualLead: 8, manualTail: 1, join: 0.6, min: 1, spread: 2.5, maxShots: 48 } as const

/** Le plus fort reste quand il faut choisir. */
const WEIGHT: Record<string, number> = { ace: 5, multi: 4, hs: 3, kill: 2, manual: 1, death: 0 }

export type PlanClip = Pick<Clip, 'id' | 'kind' | 'durationS' | 'at' | 'kills'> & Partial<Pick<Clip, 'events'>>

interface Span {
  a: number
  b: number
  w: number
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000

/** Les morceaux à garder d'un clip, dans l'ordre, sans chevauchement. */
function spansOf(c: PlanClip, after: number): Span[] {
  const d = c.durationS
  const events = Array.isArray(c.events) ? c.events.filter((e) => e && Number.isFinite(e.t)) : []
  let raw: Span[]
  if (events.length) {
    // Une mort ne fait pas un plan, sauf si le clip n'a que ça.
    const kills = events.filter((e) => e.kind !== 'death')
    raw = (kills.length ? kills : events).map((e) =>
      e.kind === 'manual' ? { a: e.t - SHOT.manualLead, b: e.t + SHOT.manualTail, w: WEIGHT.manual } : { a: e.t - SHOT.lead, b: e.t + SHOT.tail, w: WEIGHT[e.kind] ?? 1 }
    )
  } else {
    // Clip d'avant la bêta 33 : il ne dit pas où sont ses kills. Le dernier est à `after` secondes de la fin (le réglage de
    // l'enregistrement) ; les autres sont avant, on leur laisse 2,5 s chacun.
    const t = d - Math.min(Math.max(0, after), d / 2)
    raw =
      c.kind === 'manual'
        ? [{ a: t - SHOT.manualLead, b: t + SHOT.manualTail, w: WEIGHT.manual }]
        : [{ a: t - SHOT.lead - Math.max(0, (c.kills || 1) - 1) * SHOT.spread, b: t + SHOT.tail, w: WEIGHT[c.kind] ?? 1 }]
  }
  const out: Span[] = []
  for (const s of raw.map((x) => ({ a: Math.max(0, x.a), b: Math.min(d, x.b), w: x.w })).sort((p, q) => p.a - q.a)) {
    const last = out[out.length - 1]
    if (last && s.a <= last.b + SHOT.join) {
      last.b = Math.max(last.b, s.b)
      last.w += s.w
    } else out.push(s)
  }
  return out.filter((s) => s.b - s.a >= SHOT.min)
}

/**
 * Les plans d'un film « bout à bout ». `after` : le réglage « après le moment » de l'enregistrement, pour les clips qui ne
 * disent pas où sont leurs kills. Un film n'est jamais monté à partir d'un autre film. Au-delà de 48 plans, les moins forts
 * partent (une élimination simple avant un triple) et l'ordre du match reste.
 */
export function planShots(clips: readonly PlanClip[], opts: { after: number }): { shots: EditShot[]; durationS: number } {
  let all = clips
    .filter((c) => c.kind !== 'film' && Number.isFinite(c.durationS) && c.durationS > 0)
    .sort((a, b) => a.at - b.at)
    .flatMap((c) => spansOf(c, opts.after).map((s) => ({ clipId: c.id, inS: r3(s.a), outS: r3(s.b), w: s.w })))
  if (all.length > SHOT.maxShots) {
    const keep = new Set([...all.keys()].sort((i, j) => all[j].w - all[i].w || i - j).slice(0, SHOT.maxShots))
    all = all.filter((_, i) => keep.has(i))
  }
  const shots = all.map(({ clipId, inS, outS }) => ({ clipId, inS, outS }))
  return { shots, durationS: r3(shots.reduce((n, s) => n + (s.outS - s.inS), 0)) }
}

/**
 * Le nom d'un film, d'après les clips qui le composent : « Film Mirage » s'ils viennent tous de la même carte de CS2, sinon
 * « Film Counter-Strike 2 » s'ils viennent du même jeu, sinon « Film ». Le joueur peut le renommer.
 */
export function filmTitle(clips: readonly (Pick<Clip, 'gameName'> & Partial<Pick<Clip, 'map'>>)[]): string {
  const maps = new Set(clips.map((c) => (typeof c.map === 'string' ? c.map : '')))
  const games = new Set(clips.map((c) => c.gameName))
  const only = <T>(set: Set<T>): T | undefined => (set.size === 1 ? [...set][0] : undefined)
  const map = only(maps)
  if (map) return `Film ${mapLabel(map)}`.slice(0, 80)
  const game = only(games)
  return game ? `Film ${game}`.slice(0, 80) : 'Film'
}

// ---------- l'éditeur (bêta 35) : un projet de montage, calé sur la musique ----------

/**
 * Le jeu annonce un kill 0,1 à 0,6 s après le vrai moment (données toutes les 0,5 s) : l'ancre d'un plan est reculée de 0,3 s.
 * Un clip gardé à la main garde l'instant de l'appui.
 */
export const REPORT_LAG_S = 0.3
/** Ce qu'un plan garde par défaut autour de son kill, en secondes (ramené au pas : un temps de la musique, ou 0,5 s). */
export const AROUND = { lead: 2.5, tail: 1.2, manualLead: 7, manualTail: 1 } as const
/** Les kills qui passent au ralenti par défaut. */
const SLOW_KINDS = new Set(['hs', 'multi', 'ace'])

const SPEC_ID = /^[a-z0-9-]{1,40}$/i

/** Le plan d'un morceau de clip : ancré sur son kill le plus fort (le dernier à égalité), couvrant tous ses kills. */
function specOf(c: PlanClip, after: number, unit: number): EditProjectShot[] {
  const d = c.durationS
  const events = Array.isArray(c.events) ? c.events.filter((e) => e && Number.isFinite(e.t)) : []
  type Ev = { t: number; kind: string }
  let evs: Ev[]
  if (events.length) {
    const kills = events.filter((e) => e.kind !== 'death')
    evs = (kills.length ? kills : events).map((e) => ({ t: e.kind === 'manual' ? e.t : e.t - REPORT_LAG_S, kind: e.kind }))
  } else {
    const t = d - Math.min(Math.max(0, after), d / 2)
    evs = [{ t: c.kind === 'manual' ? t : t - REPORT_LAG_S, kind: c.kind }]
  }
  evs = evs.map((e) => ({ t: Math.min(Math.max(0, e.t), d), kind: e.kind })).sort((p, q) => p.t - q.t)
  // Des kills à moins de 2 pas d'écart (plus la marge) restent dans le même plan.
  const groups: Ev[][] = []
  for (const e of evs) {
    const g = groups[groups.length - 1]
    const lastT = g ? g[g.length - 1].t : -Infinity
    if (g && e.t - lastT <= AROUND.lead + AROUND.tail) g.push(e)
    else groups.push([e])
  }
  return groups.map((g) => {
    const best = g.reduce((p, q) => ((WEIGHT[q.kind] ?? 1) >= (WEIGHT[p.kind] ?? 1) ? q : p))
    const manual = best.kind === 'manual'
    const first = g[0].t
    const last = g[g.length - 1].t
    const lead = Math.max(1, Math.ceil((best.t - first + (manual ? AROUND.manualLead : AROUND.lead)) / unit - 1e-6))
    const tail = Math.max(1, Math.ceil((last - best.t + (manual ? AROUND.manualTail : AROUND.tail)) / unit - 1e-6))
    return fitShot({ clipId: c.id, anchorS: best.t, lead, tail, slow: SLOW_KINDS.has(best.kind) || g.length >= 3 }, d, unit)
  })
}

/**
 * Le premier montage d'un projet : les clips dans l'ordre du match, un plan par kill (ou groupe de kills proches), ralenti
 * sur les headshots et les séries. Le dernier plan finit toujours au ralenti. `unit` : le pas du film (un temps, ou 0,5 s).
 */
export function planProject(clips: readonly PlanClip[], opts: { after: number; unit: number }): EditProjectShot[] {
  let all = clips
    .filter((c) => c.kind !== 'film' && Number.isFinite(c.durationS) && c.durationS > 0)
    .sort((a, b) => a.at - b.at)
    .flatMap((c) => specOf(c, opts.after, opts.unit).map((s) => ({ s, w: WEIGHT[c.kind] ?? 1 })))
  if (all.length > FILM_LIMITS.shots) {
    const keep = new Set([...all.keys()].sort((i, j) => all[j].w - all[i].w || i - j).slice(0, FILM_LIMITS.shots))
    all = all.filter((_, i) => keep.has(i))
  }
  const shots = all.map((x) => x.s)
  if (shots.length) {
    const lastClip = clips.find((c) => c.id === shots[shots.length - 1].clipId)
    if (lastClip) shots[shots.length - 1] = fitShot({ ...shots[shots.length - 1], slow: true }, lastClip.durationS, opts.unit)
  }
  return shots
}

/** Un projet propre, prêt à fabriquer : chaque plan revu contre son clip, la musique contre sa grille. Refuse le reste en clair. */
export function cleanProject(
  raw: unknown,
  clips: ReadonlyMap<string, { durationS: number }>,
  musics: ReadonlyMap<string, { bpm: number | null; grid: readonly number[]; durationS: number }>
): { shots: EditProjectShot[]; music: EditProject['music']; gameVolume: number; unit: number; durationS: number } {
  if (!raw || typeof raw !== 'object') throw new Error('Projet de montage refusé.')
  const r = raw as Record<string, unknown>
  if (r.v !== 2 || !Array.isArray(r.shots)) throw new Error('Projet de montage refusé.')
  if (r.shots.length > FILM_LIMITS.shots) throw new Error(`Un film garde ${FILM_LIMITS.shots} plans au plus.`)
  const volume = (x: unknown, dflt: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, Math.round(x * 100) / 100)) : dflt)
  let music: EditProject['music'] = null
  let unit = unitOf(null)
  const m = r.music as Record<string, unknown> | null | undefined
  if (m && typeof m === 'object') {
    const id = typeof m.id === 'string' && SPEC_ID.test(m.id) ? m.id : ''
    const info = musics.get(id)
    if (!info) throw new Error('Cette musique n’est plus disponible. Choisis-la à nouveau.')
    unit = unitOf(info.bpm)
    const want = typeof m.startS === 'number' && Number.isFinite(m.startS) ? Math.max(0, m.startS) : 0
    const startS = info.grid.length ? snapToGrid(info.grid, want - 1e-3) : Math.min(want, Math.max(0, info.durationS - 1))
    music = { id, startS, volume: volume(m.volume, 0.9) }
  }
  const shots: EditProjectShot[] = []
  for (const s of r.shots as unknown[]) {
    if (!s || typeof s !== 'object') continue
    const x = s as Record<string, unknown>
    const clip = typeof x.clipId === 'string' ? clips.get(x.clipId) : undefined
    if (!clip || !Number.isFinite(x.anchorS)) continue
    shots.push(fitShot({ clipId: x.clipId as string, anchorS: x.anchorS as number, lead: Number(x.lead), tail: Number(x.tail), slow: x.slow === true }, clip.durationS, unit))
  }
  if (!shots.length) throw new Error('Ce film n’a aucun plan.')
  const durationS = timeline(shots, unit).totalS
  if (durationS > FILM_LIMITS.seconds) throw new Error('Un film dure 10 minutes au plus.')
  return { shots, music, gameVolume: volume(r.gameVolume, music ? 0.5 : 1), unit, durationS }
}
