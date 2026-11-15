// La file d'attente des fichiers des clips : écrire un clip, le découper, le renommer, le supprimer, ranger un film. Un seul
// travail à la fois, dans l'ordre des demandes. Ce fichier est le seul à garder la file : clips.ts et clipsIndex.ts y
// ajoutent un travail par serial(), et clips.ts la lit par les trois fonctions du bas (l'appli qui quitte attend la file).
// Ce code vient de clips.ts, sans changement de comportement. Sans Electron : il se teste directement
// (`npm test -- clipsQueue`).

/** Écritures, découpes, renommages : un à la fois. */
let fileQueue: Promise<unknown> = Promise.resolve()
let fileBusy = 0

/** Ajoute un travail à la file et rend son résultat, ou son erreur. Un travail raté ne bloque pas les suivants. */
export function serial<T>(job: () => Promise<T>): Promise<T> {
  fileBusy++
  const run = fileQueue.then(job, job)
  fileQueue = run.then(
    () => {
      fileBusy--
    },
    () => {
      fileBusy--
    }
  )
  return run
}

/** Vrai tant qu'un travail attend ou tourne. « !== 0 » : c'est le test d'avant le déplacement (!fileBusy), gardé tel quel. */
export const filesBusy = (): boolean => fileBusy !== 0

/** Finit quand tous les travaux demandés jusqu'ici sont finis, réussis ou ratés. Ne rate jamais. */
export const filesDone = (): Promise<unknown> => fileQueue

/** L'appli quitte, son attente est finie : les travaux qui restent ne sont plus comptés. */
export function forgetFiles(): void {
  fileBusy = 0
}
