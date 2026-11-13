// Types partagés : Counter-Strike 2 (match en direct, bilans, overlay, stats à vie).

// ---------- Counter-Strike 2 : match en direct et bilan (Game State Integration) ----------

export type Cs2Side = 'CT' | 'T'

/** Comment un round s'est terminé (map.round_wins de CS2). */
export type Cs2RoundEnd = 'elimination' | 'bomb' | 'defuse' | 'time' | 'hostage' | 'other'

/** Un round de la frise du bilan. */
export interface Cs2Round {
  n: number
  /** Camp qui gagne le round. */
  winner: Cs2Side
  end: Cs2RoundEnd
  /** Ton camp pendant ce round : absent si Player X ne t'a pas vu jouer ce round (match rejoint en cours). */
  side?: Cs2Side
  /** Tes éliminations du round, s'il a été suivi. */
  kills?: number
}

/** Match en cours, tel que CS2 l'envoie. Seulement tes chiffres : en partie, le jeu ne donne pas ceux des autres. */
export interface Cs2Live {
  /** Nom technique de la carte (de_mirage) et du mode (competitive) : libellés dans @shared/cs2. */
  map: string
  mode: string
  phase: 'warmup' | 'live' | 'intermission' | 'gameover'
  /** Phase du round : temps d'achat, en jeu, fin du round. */
  roundPhase?: 'freezetime' | 'live' | 'over'
  /** Round en cours (à partir de 1). */
  round: number
  /** Frise des rounds terminés (vide pour un mode sans rounds). */
  rounds: Cs2Round[]
  /** Dégâts par round et % de headshots sur les rounds terminés que Player X a suivis. */
  adr?: number
  hsPct?: number
  side?: Cs2Side
  /** Rounds gagnés par ton camp et par l'autre (absents tant que ton camp est inconnu). */
  score?: { us: number; them: number }
  kills: number
  deaths: number
  assists: number
  mvps: number
  /** Points du tableau des scores. */
  points: number
  /** Tes points de vie : absents quand tu es mort et que tu regardes un autre joueur. */
  health?: number
  money?: number
  /** Ce que tu as fait dans le round en cours. */
  roundKills: number
  /** Début du suivi (fin de l'échauffement, ou arrivée en cours de match). */
  startedAt: number
  /** Le match avait commencé avant que Player X le voie. */
  partial?: boolean
}

/** Issue du match pour toi. `done` : mode sans équipes (match à mort…) ; `left` : quitté avant la fin. */
export type Cs2Result = 'win' | 'loss' | 'tie' | 'left' | 'done'

/** Bilan d'un match de Counter-Strike 2, gardé sur ce PC. */
export interface Cs2Recap {
  id: string
  /** Ton compte Steam (provider.steamid) : deux comptes sur un même PC ne se mélangent pas. */
  steamId: string
  map: string
  mode: string
  startedAt: number
  endedAt: number
  result: Cs2Result
  score?: { us: number; them: number }
  kills: number
  deaths: number
  assists: number
  mvps: number
  points: number
  /** Sur les rounds suivis seulement (`roundsTracked`) : un match rejoint en cours n'a pas ses premiers rounds. */
  headshots: number
  damage: number
  /** Éliminations comptées dans les rounds suivis : la base du % de headshots. */
  trackedKills: number
  roundsTracked: number
  /** Rounds à 3, 4 et 5 éliminations. */
  multi: { k3: number; k4: number; k5: number }
  /** Round avec le plus d'éliminations. */
  best?: { n: number; kills: number; damage: number }
  /** Frise des rounds, du premier au dernier. Vide pour un mode sans rounds. */
  rounds: Cs2Round[]
  /** Mode joué en rounds (compétitif, occasionnel, wingman) : sinon pas d'ADR ni de frise. */
  hasRounds: boolean
  partial?: boolean
  seen?: boolean
  /** Exemple (Paramètres, fiche) : chiffres fictifs, jamais enregistrés. */
  sample?: boolean
}

/** État de la liaison avec CS2. */
export type Cs2Config =
  /** Réglage coupé : fichier retiré. */
  | 'off'
  /** Fichier en place, CS2 le lira (ou le lit déjà). */
  | 'ready'
  /** Fichier écrit pendant que CS2 tournait : il ne le lit qu'à son démarrage. */
  | 'restart'
  /** CS2 n'est pas dans la bibliothèque de ce PC. */
  | 'missing'
  /** Windows a refusé l'écriture du fichier dans le dossier du jeu. */
  | 'blocked'
  /** Aucun port local libre pour recevoir les envois du jeu. */
  | 'no-port'

export interface Cs2State {
  enabled: boolean
  /** Mode démo : ni ton vrai match ni tes vrais bilans (seulement des exemples). */
  demo: boolean
  config: Cs2Config
  /** CS2 a envoyé quelque chose il y a moins d'une minute. */
  connected: boolean
  /** Match en cours, s'il y en a un. Toujours null en mode démo. */
  live: Cs2Live | null
  /** Les plus récents d'abord. Vide en mode démo. */
  recaps: Cs2Recap[]
}

/** `ready` : bilan prêt, Player X au premier plan ; `open` : clic sur la notification Windows ; `updated` : liste changée. */
export interface Cs2RecapEvent {
  recap: Cs2Recap
  reason: 'ready' | 'open' | 'updated'
}

/**
 * Totaux à vie de Valve (Steam Web API, GetUserStatsForGame, appid 730) : CS:GO et CS2 confondus, tous modes.
 * Un champ absent de la réponse de Steam reste absent : rien n'est deviné.
 */
export interface Cs2LifetimeTotals {
  kills?: number
  deaths?: number
  /** Éliminations d'un tir à la tête. */
  headshots?: number
  /** En secondes. */
  timePlayed?: number
  plantedBombs?: number
  defusedBombs?: number
  /** Rounds gagnés (total_wins). */
  roundsWon?: number
  roundsPlayed?: number
  matchesWon?: number
  matchesPlayed?: number
  damage?: number
  moneyEarned?: number
  mvps?: number
}

/** Une arme : `id` est le nom technique de Valve (ak47, m4a1…), libellé dans @shared/cs2Lifetime. */
export interface Cs2WeaponStat {
  id: string
  kills: number
}

/** Une carte : `id` est son nom technique (de_dust2). Ce sont des rounds, pas des matchs. */
export interface Cs2MapStat {
  id: string
  roundsWon?: number
  rounds?: number
}

export interface Cs2Lifetime {
  totals: Cs2LifetimeTotals
  /** Armes avec au moins une élimination, de la plus utilisée à la moins utilisée. */
  weapons: Cs2WeaponStat[]
  /** Cartes avec au moins un round, de la plus jouée à la moins jouée. */
  maps: Cs2MapStat[]
}

/** Relevé quotidien des totaux (gardé sur ce PC), pour les écarts sur 7 et 30 jours et une future courbe. */
export type Cs2LifetimePoint = Cs2LifetimeTotals & { at: number }

/** Pourquoi les stats à vie ne s'affichent pas. */
export type Cs2LifetimeReason = 'demo' | 'no-account' | 'no-key' | 'key-refused' | 'private' | 'none' | 'network' | 'error'

export type Cs2LifetimeResult =
  | {
      ok: true
      stats: Cs2Lifetime
      fetchedAt: number
      /** Relevés quotidiens, du plus ancien au plus récent. */
      history: Cs2LifetimePoint[]
      /** Steam n'a pas répondu : dernière lecture gardée, avec la raison. */
      stale?: string
      /** Chiffres fictifs (simulateur de développement) : toujours présentés comme un exemple. */
      sample?: boolean
    }
  | { ok: false; reason: Cs2LifetimeReason; message: string }
