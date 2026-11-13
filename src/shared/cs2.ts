// Counter-Strike 2 : libellés en français des cartes et des modes, et la ligne qui résume un bilan (notification Windows,
// liste des derniers matchs). Partagé entre le processus principal et l'interface, sans dépendance.
import type { Cs2Recap, Cs2Result, Cs2Round } from './types'

/** Identifiant de CS2 dans la bibliothèque (appid Steam 730). */
export const CS2_GAME_ID = 'steam:730'
export const CS2_APPID = 730

const MAPS: Record<string, string> = {
  de_dust2: 'Dust II',
  de_mirage: 'Mirage',
  de_inferno: 'Inferno',
  de_nuke: 'Nuke',
  de_overpass: 'Overpass',
  de_vertigo: 'Vertigo',
  de_ancient: 'Ancient',
  de_anubis: 'Anubis',
  de_train: 'Train',
  de_cache: 'Cache',
  de_basalt: 'Basalt',
  de_edin: 'Edin',
  de_palais: 'Palais',
  de_whistle: 'Whistle',
  de_thera: 'Thera',
  de_mills: 'Mills',
  de_assembly: 'Assembly',
  de_memento: 'Memento',
  de_jura: 'Jura',
  de_grail: 'Grail',
  de_brewery: 'Brewery',
  de_dogtown: 'Dogtown',
  de_sanctum: 'Sanctum',
  de_poseidon: 'Poseidon',
  cs_office: 'Office',
  cs_italy: 'Italy',
  cs_agency: 'Agency',
  ar_baggage: 'Baggage',
  ar_shoots: 'Shoots',
  ar_pool_day: 'Pool Day',
  // Cartes de CS:GO : elles restent dans les stats à vie de Steam.
  de_cbble: 'Cobblestone',
  de_lake: 'Lake',
  de_safehouse: 'Safehouse',
  de_shortdust: 'Shortdust',
  de_shortnuke: 'Shortnuke',
  de_stmarc: 'St. Marc',
  de_bank: 'Bank',
  de_sugarcane: 'Sugarcane',
  de_aztec: 'Aztec',
  de_dust: 'Dust',
  de_canals: 'Canals',
  de_tuscany: 'Tuscany',
  de_zoo: 'Zoo',
  de_abbey: 'Abbey',
  de_biome: 'Biome',
  de_breach: 'Breach',
  de_studio: 'Studio',
  cs_assault: 'Assault',
  cs_militia: 'Militia',
  cs_insertion: 'Insertion',
  ar_monastery: 'Monastery',
  ar_lunacy: 'Lunacy'
}

const MODES: Record<string, string> = {
  competitive: 'Compétitif',
  premier: 'Premier',
  casual: 'Occasionnel',
  scrimcomp2v2: 'Wingman',
  deathmatch: 'Match à mort',
  gungameprogressive: 'Course aux armements',
  gungametrbomb: 'Démolition',
  training: 'Entraînement',
  custom: 'Personnalisé',
  cooperative: 'Coopératif',
  coopmission: 'Mission en coop',
  survival: 'Zone de danger',
  retakes: 'Reprises'
}

/** Modes sans rounds à gagner : ni frise, ni ADR, ni victoire d'équipe. */
const NO_ROUNDS = new Set(['deathmatch', 'gungameprogressive', 'training', 'survival'])

const title = (s: string): string => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())

/** « de_mirage » → « Mirage » ; carte de l'atelier (workshop/123/de_xxx) ou inconnue : son nom sans préfixe. */
export function mapLabel(map: string): string {
  const base = map.split('/').pop() ?? map
  return MAPS[base.toLowerCase()] ?? (title(base.replace(/^[a-z]{1,3}_/i, '').replace(/_/g, ' ').trim()) || base)
}

export function modeLabel(mode: string): string {
  return MODES[mode.toLowerCase()] ?? (title(mode.replace(/_/g, ' ').trim()) || 'Partie')
}

export function modeHasRounds(mode: string): boolean {
  return !NO_ROUNDS.has(mode.toLowerCase())
}

export const RESULT_LABEL: Record<Cs2Result, string> = {
  win: 'Victoire',
  loss: 'Défaite',
  tie: 'Nul',
  left: 'Quitté',
  done: 'Terminé'
}

const dec = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** K/D d'un match : sans mort, le nombre d'éliminations (comme le tableau des scores). */
export function killDeath(r: Pick<Cs2Recap, 'kills' | 'deaths'>): number {
  return r.deaths > 0 ? r.kills / r.deaths : r.kills
}

export const formatKd = (n: number): string => dec.format(n)

/** « Victoire 13–9 sur Mirage · 22 élim. · K/D 1,57 » (notification Windows). */
export function cs2RecapLine(r: Pick<Cs2Recap, 'result' | 'score' | 'map' | 'kills' | 'deaths'>): string {
  const head = [RESULT_LABEL[r.result], r.score && r.result !== 'left' ? `${r.score.us}–${r.score.them}` : ''].filter(Boolean).join(' ')
  return `${head} sur ${mapLabel(r.map)} · ${r.kills} élim. · K/D ${formatKd(killDeath(r))}`
}

/** Une carte de tes matchs suivis par Player X. */
export interface Cs2MapSummary {
  map: string
  matches: number
  wins: number
  losses: number
  ties: number
  kills: number
  deaths: number
  kd: number
  /** Dégâts par round, sur les rounds suivis des modes en rounds (null : aucun). */
  adr: number | null
  /** Dernier match joué sur cette carte. */
  last: number
}

/** Tes matchs suivis regroupés par carte : la plus jouée d'abord (puis la plus récente). Les exemples sont ignorés. */
export function mapSummaries(recaps: Cs2Recap[]): Cs2MapSummary[] {
  const by = new Map<string, Cs2Recap[]>()
  for (const r of recaps) {
    if (r.sample || !r.map) continue
    const k = r.map.toLowerCase()
    by.set(k, [...(by.get(k) ?? []), r])
  }
  return [...by.entries()]
    .map(([map, list]) => {
      const kills = list.reduce((n, r) => n + r.kills, 0)
      const deaths = list.reduce((n, r) => n + r.deaths, 0)
      const rounds = list.filter((r) => r.hasRounds && r.roundsTracked > 0)
      const tracked = rounds.reduce((n, r) => n + r.roundsTracked, 0)
      return {
        map,
        matches: list.length,
        wins: list.filter((r) => r.result === 'win').length,
        losses: list.filter((r) => r.result === 'loss').length,
        ties: list.filter((r) => r.result === 'tie').length,
        kills,
        deaths,
        kd: deaths > 0 ? kills / deaths : kills,
        adr: tracked > 0 ? rounds.reduce((n, r) => n + r.damage, 0) / tracked : null,
        last: Math.max(...list.map((r) => r.endedAt))
      }
    })
    .sort((a, b) => b.matches - a.matches || b.last - a.last)
}

/** Plus longue série de rounds gagnés (seulement ceux dont ton camp est connu). */
export function longestStreak(rounds: Pick<Cs2Round, 'side' | 'winner'>[]): number {
  let best = 0
  let run = 0
  for (const r of rounds) {
    run = r.side && r.side === r.winner ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}
