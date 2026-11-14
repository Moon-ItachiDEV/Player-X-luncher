// Sans Electron : testé par ipcRules.test.ts.
import { UserError } from './errors'

/** Les erreurs que JavaScript lève lui-même quand le code se trompe (« x n'est pas une fonction », « lecture de undefined »…). */
const BUGS = [TypeError, RangeError, ReferenceError, SyntaxError, EvalError, URIError]

/**
 * Un récepteur a échoué : est-ce une panne inattendue, à noter dans le journal ? Un refus écrit pour la personne
 * (`UserError`, ou `new Error('texte en français')` comme partout dans les canaux) s'affiche dans l'interface et n'a rien
 * à faire dans le journal. Une erreur du langage ou du système (fichier, droit refusé : elles portent un `code`) est une
 * panne : avant, elle partait vers l'interface en message technique, puis disparaissait sans trace.
 */
export function unexpectedFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return true
  if (e instanceof UserError) return false
  return BUGS.some((type) => e instanceof type) || typeof (e as { code?: unknown }).code === 'string'
}
