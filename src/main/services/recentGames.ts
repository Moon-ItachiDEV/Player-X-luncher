// Jeux récents : quels jeux proposer dans le menu de l'icône près de l'horloge et dans la liste de raccourcis de Windows
// (clic droit sur Player X dans la barre des tâches), et l'argument `--launch=<id>` qui les lance.
// Module pur, sans Electron : testé sous Node seul (npm run test:ready).
import type { Game } from '@shared/types'

export const LAUNCH_ARG = '--launch='
export const RECENT_MAX = 5

/** Identifiant de jeu de Player X : `steam:730`, `epic:Fortnite`, `ea:Origin.OFR.50.0005577`. Jamais d'espace ni de guillemet. */
const GAME_ID = /^(steam|epic|ea):[\w.:-]{1,200}$/

/** Jeu demandé par `--launch=<id>`, ou null (argument absent ou mal formé). */
export function launchArgOf(argv: readonly string[]): string | null {
  const a = argv.find((x) => typeof x === 'string' && x.startsWith(LAUNCH_ARG))
  if (!a) return null
  const id = a.slice(LAUNCH_ARG.length)
  return GAME_ID.test(id) ? id : null
}

/** Les derniers jeux joués qui sont sur ce PC, du plus récent au plus ancien. */
export function recentGames(games: readonly Game[], max = RECENT_MAX): Game[] {
  return games
    .filter((g) => !g.notInstalled && (g.lastPlayed ?? 0) > 0 && GAME_ID.test(g.id))
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    .slice(0, max)
}

/** Libellé d'un menu Windows : « & » y souligne la lettre suivante, « && » l'affiche. */
export function menuLabel(name: string): string {
  return name.replace(/&/g, '&&')
}
