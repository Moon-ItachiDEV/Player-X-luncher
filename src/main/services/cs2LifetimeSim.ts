// FIXTURE : réponse fictive de Steam (GetUserStatsForGame, appid 730) et relevés fictifs, pour les tests
// (npm run test:cs2stats) et le simulateur de développement (PX_CS2_STATS_SIM, chargé par import dynamique seulement
// quand l'appli n'est pas installée, jamais livré dans l'installeur). Aucun de ces chiffres n'est vrai.
// Les noms des champs suivent CS:GO : ceux de CS2 n'ont pas encore été vérifiés sur une vraie réponse.
import type { Cs2Lifetime, Cs2LifetimePoint } from '@shared/types'

/** FIXTURE : SteamID fictif (aucun compte réel). */
export const FIXTURE_STEAM_ID = '76561198000000001'

/** FIXTURE : couples nom / valeur, comme dans `playerstats.stats`. */
const FIXTURE_STATS: [string, number][] = [
  ['total_kills', 48_213],
  ['total_deaths', 41_870],
  ['total_time_played', 3_312_000],
  ['total_planted_bombs', 3_904],
  ['total_defused_bombs', 1_217],
  ['total_wins', 31_540],
  ['total_damage_done', 6_842_190],
  ['total_money_earned', 102_455_300],
  ['total_rescued_hostages', 112],
  ['total_kills_knife', 412],
  ['total_kills_hegrenade', 611],
  ['total_kills_glock', 2_318],
  ['total_kills_deagle', 2_904],
  ['total_kills_elite', 96],
  ['total_kills_fiveseven', 541],
  ['total_kills_xm1014', 287],
  ['total_kills_mac10', 1_120],
  ['total_kills_ump45', 1_407],
  ['total_kills_p90', 802],
  ['total_kills_awp', 5_870],
  ['total_kills_ak47', 14_212],
  ['total_kills_aug', 655],
  ['total_kills_famas', 1_302],
  ['total_kills_g3sg1', 14],
  ['total_kills_m249', 9],
  ['total_kills_headshot', 21_870],
  ['total_kills_enemy_weapon', 3_420],
  ['total_kills_enemy_blinded', 1_288],
  ['total_kills_knife_fight', 37],
  ['total_kills_against_zoomed_sniper', 640],
  ['total_kills_hkp2000', 2_011],
  ['total_kills_p250', 744],
  ['total_kills_sg556', 1_093],
  ['total_kills_scar20', 31],
  ['total_kills_ssg08', 488],
  ['total_kills_mp7', 610],
  ['total_kills_mp9', 954],
  ['total_kills_nova', 201],
  ['total_kills_negev', 22],
  ['total_kills_sawedoff', 18],
  ['total_kills_bizon', 133],
  ['total_kills_tec9', 702],
  ['total_kills_mag7', 165],
  ['total_kills_m4a1', 9_874],
  ['total_kills_galilar', 1_655],
  ['total_kills_molotov', 377],
  ['total_kills_taser', 58],
  // FIXTURE : arme inconnue (nom technique), avec tirs : elle doit s'afficher telle quelle.
  ['total_kills_futuregun_mk2', 7],
  ['total_shots_futuregun_mk2', 90],
  // FIXTURE : compteur inconnu sans tirs ni touches : ce n'est pas une arme.
  ['total_kills_mystery_bonus', 55],
  ['total_shots_ak47', 380_210],
  ['total_hits_ak47', 81_540],
  ['total_shots_awp', 22_870],
  ['total_hits_awp', 9_310],
  ['total_shots_m4a1', 260_400],
  ['total_hits_m4a1', 55_120],
  ['total_mvps', 6_204],
  ['total_matches_won', 1_548],
  ['total_matches_played', 2_870],
  ['total_rounds_played', 58_430],
  ['total_wins_map_de_dust2', 6_120],
  ['total_rounds_map_de_dust2', 11_470],
  ['total_wins_map_de_mirage', 5_480],
  ['total_rounds_map_de_mirage', 10_210],
  ['total_wins_map_de_inferno', 4_870],
  ['total_rounds_map_de_inferno', 9_130],
  ['total_wins_map_de_nuke', 2_210],
  ['total_rounds_map_de_nuke', 4_490],
  ['total_wins_map_de_train', 1_870],
  ['total_rounds_map_de_train', 3_520],
  ['total_wins_map_de_vertigo', 940],
  ['total_rounds_map_de_vertigo', 1_930],
  ['total_wins_map_cs_office', 760],
  ['total_rounds_map_cs_office', 1_480],
  ['total_wins_map_de_cbble', 1_310],
  ['total_rounds_map_de_cbble', 2_660],
  ['total_wins_map_de_lake', 0],
  ['total_rounds_map_de_lake', 0],
  ['last_match_t_wins', 9],
  ['last_match_ct_wins', 13],
  ['last_match_kills', 22],
  ['last_match_deaths', 14],
  ['GI.lesson.csgo_instr_explain_buymenu', 1]
]

/** FIXTURE : la réponse complète, telle que Steam l'enverrait. */
export function fixtureResponse(): unknown {
  return {
    playerstats: {
      steamID: FIXTURE_STEAM_ID,
      gameName: 'ValveTestApp260',
      stats: FIXTURE_STATS.map(([name, value]) => ({ name, value })),
      achievements: [
        { name: 'WIN_BOMB_PLANT', achieved: 1 },
        { name: 'KILL_ENEMY_AWP', achieved: 1 }
      ]
    }
  }
}

export const fixtureText = (): string => JSON.stringify(fixtureResponse())

/** FIXTURE : page HTML d'une clé refusée. */
export const FIXTURE_KEY_REFUSED =
  '<html><head><title>Forbidden</title></head><body><h1>Forbidden</h1>Access is denied. Retrying will not help. Please verify your <pre>key=</pre> parameter.</body></html>'

/** FIXTURE : profil aux détails de jeu privés (forme supposée, d'après GetPlayerAchievements). */
export const FIXTURE_PRIVATE = JSON.stringify({ playerstats: { error: 'Profile is not public', success: false } })

/**
 * FIXTURE : 30 relevés quotidiens qui mènent aux totaux donnés (un peu de jeu chaque jour, rien certains jours),
 * pour voir la ligne « Ces 7 derniers jours » sans attendre une semaine. Le dernier relevé est celui d'aujourd'hui.
 */
export function fixtureHistory(stats: Cs2Lifetime, now: number, days = 30): Cs2LifetimePoint[] {
  const t = stats.totals
  // Ce qui est joué un jour « actif », en moyenne.
  const perDay = { kills: 19, deaths: 16, headshots: 9, timePlayed: 5_400, matchesPlayed: 2, matchesWon: 1, roundsWon: 26, roundsPlayed: 46, mvps: 3, damage: 2_650, plantedBombs: 2, defusedBombs: 1 }
  const out: Cs2LifetimePoint[] = []
  let back: Record<string, number> = {}
  for (let i = 0; i < days; i++) {
    const at = now - i * 86_400_000
    const p: Record<string, number> = { at }
    for (const [k, v] of Object.entries(t)) if (typeof v === 'number') p[k] = Math.max(0, v - (back[k] ?? 0))
    out.unshift({ ...p, at })
    // Un jour sur trois sans jouer ; sinon un peu plus ou un peu moins que la moyenne.
    if (i % 3 !== 2) {
      const f = 0.6 + ((i * 37) % 10) / 10
      const next = { ...back }
      for (const [k, v] of Object.entries(perDay)) next[k] = (next[k] ?? 0) + Math.round(v * f)
      back = next
    }
  }
  return out
}
