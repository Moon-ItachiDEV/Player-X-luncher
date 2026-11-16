import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** Journal des erreurs du processus principal : `erreurs.log` dans le dossier de données, 256 Ko au plus (repart de zéro au-delà). */
const MAX = 256 * 1024
const file = (): string => join(app.getPath('userData'), 'erreurs.log')

export function logError(where: string, e: unknown): void {
  const text = e instanceof Error ? e.stack || `${e.name}: ${e.message}` : String(e)
  try {
    const f = file()
    let size = 0
    try {
      size = statSync(f).size
    } catch {
      /* pas encore de journal */
    }
    const line = `${new Date().toISOString()} [${where}] ${text}\n`
    if (size + line.length > MAX) writeFileSync(f, line)
    else appendFileSync(f, line)
  } catch {
    /* le journal ne doit jamais faire tomber l'appli */
  }
  console.error(`[${where}]`, e)
}
