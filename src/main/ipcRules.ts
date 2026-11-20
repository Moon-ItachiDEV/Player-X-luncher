// Sans Electron : testé par ipcRules.test.ts.
import { UserError } from './errors'

/** Les erreurs que JavaScript lève lui-même quand le code se trompe (« x n'est pas une fonction », « lecture de undefined »…). */
const BUGS = [TypeError, RangeError, ReferenceError, SyntaxError, EvalError, URIError, AggregateError]

/** Noms d'erreurs techniques (Node, Fetch, Web APIs, assertions) qui ne portent pas toujours de `.code` texte. */
const TECHNICAL_NAMES = new Set(['DOMException', 'AbortError', 'TimeoutError', 'FetchError', 'SystemError', 'AssertionError'])

/** Messages techniques en anglais d'une bibliothèque externe (réseau, Chromium, SQLite, HTTP…) qui ne sont pas des refus utilisateur. */
const TECHNICAL_MESSAGE =
  /\b(?:fetch failed|request failed|network error|socket hang up|unexpected (?:token|end of json|identifier)|cannot read properties|is not a function|is not defined|out of memory|maximum call stack|timed ?out|bad gateway|internal server error|service unavailable|unauthorized|forbidden)\b|net::ERR_|SQLITE_|ERR_[A-Z0-9_]+|\bE[A-Z]{2,}(?:REFUSED|RESET|TIMEDOUT|NOENT|ACCES|PERM|EXIST|BUSY|PIPE|NOTFOUND|AI_AGAIN)\b|\bHTTP\s+[45]\d{2}\b/i

/**
 * Un récepteur a échoué : est-ce une panne inattendue, à noter dans le journal ? Un refus écrit pour la personne
 * (`UserError`, ou `new Error('texte en français')` comme partout dans les canaux) s'affiche dans l'interface et n'a rien
 * à faire dans le journal. Une erreur du langage, du système (fichier, droit refusé, `code`/`errno`) ou d'une bibliothèque
 * externe (réseau, `DOMException`, SQLite, HTTP 5xx…) est une panne : elle est notée dans `erreurs.log`.
 */
export function unexpectedFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return true
  if (e instanceof UserError) return false
  if (BUGS.some((type) => e instanceof type)) return true
  if (typeof DOMException === 'function' && e instanceof DOMException) return true
  if (TECHNICAL_NAMES.has(e.name)) return true
  const raw = e as { code?: unknown; errno?: unknown; cause?: unknown }
  if (typeof raw.code === 'string' || typeof raw.errno === 'number') return true
  if (TECHNICAL_MESSAGE.test(e.message)) return true
  return raw.cause instanceof Error && unexpectedFailure(raw.cause)
}
