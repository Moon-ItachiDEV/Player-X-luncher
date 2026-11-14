import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { createRepeatFilter, errorKey, keepRecent } from './crashLogRules'

/**
 * Journal des erreurs du processus principal : `erreurs.log` dans le dossier de données, 256 Ko au plus. Plein, il garde sa
 * moitié la plus récente (avant, il repartait de zéro). Une erreur qui se répète n'y est écrite qu'une fois toutes les dix
 * minutes, avec le nombre de fois où elle est revenue : c'est ce qui permet d'y noter aussi les pannes des relevés réguliers.
 */
const MAX = 256 * 1024
/** Une seule erreur ne prend jamais plus que ça (une page web entière reçue à la place d'une réponse, par exemple). */
const MAX_ENTRY = 16 * 1024
const REPEAT_MS = 10 * 60_000
const file = (): string => join(app.getPath('userData'), 'erreurs.log')
const repeats = createRepeatFilter(REPEAT_MS)

export function logError(where: string, e: unknown): void {
  const text = (e instanceof Error ? e.stack || `${e.name}: ${e.message}` : String(e)).slice(0, MAX_ENTRY)
  const verdict = repeats(errorKey(where, text), Date.now())
  if (verdict.write) {
    try {
      const f = file()
      let size = 0
      try {
        size = statSync(f).size
      } catch {
        /* pas encore de journal */
      }
      const again = verdict.skipped ? ` (revenue ${verdict.skipped} fois de plus depuis la dernière ligne)` : ''
      const line = Buffer.from(`${new Date().toISOString()} [${where}] ${text}${again}\n`)
      if (size + line.length > MAX) writeFileSync(f, Buffer.concat([keepRecent(readFileSync(f), MAX / 2), line]))
      else appendFileSync(f, line)
    } catch {
      /* le journal ne doit jamais faire tomber l'appli */
    }
  }
  console.error(`[${where}]`, e)
}
