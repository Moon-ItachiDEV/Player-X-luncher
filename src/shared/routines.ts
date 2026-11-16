// Routines : ce qui se passe quand tu appuies sur Jouer, dans l'ordre que tu veux (types partagés par le main, le pont et la V3).

export type RoutineStepKind = 'app' | 'close' | 'link' | 'wait' | 'minimize' | 'game'

export interface RoutineStep {
  id: string
  kind: RoutineStepKind
  /** Selon le type : chemin de l'appli, nom du programme à fermer, lien, secondes d'attente. */
  value?: string
  /** Nom affiché. */
  name?: string
  on: boolean
  /** Fermer une appli : forcer au bout de 2 s si elle ne se ferme pas. */
  force?: boolean
}

export interface Routine {
  id: string
  name: string
  gameId: string
  trigger: 'launch' | 'hotkey'
  steps: RoutineStep[]
}

export interface RoutineStatus {
  routineId: string
  launchId?: string
  index: number
  total: number
  state: 'run' | 'ok' | 'fail' | 'done'
  text: string
}
