import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'

// Journal du moteur de clips (userData/logs/clips.log) : Paramètres › Enregistrement › Copier le journal le lit.

const MAX_LOG_BYTES = 512 * 1024
const LOG_TAIL_LINES = 40
const userData = (...p: string[]): string => join(app.getPath('userData'), ...p)

let logChain: Promise<unknown> = Promise.resolve()
let logSize = -1

const logFile = (): string => userData('logs', 'clips.log')

/** Une ligne dans userData/logs/clips.log, borné : au-delà de 512 Ko, la moitié la plus ancienne part. */
export function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`
  if (!app.isPackaged) console.log('[clips]', message)
  logChain = logChain
    .then(async () => {
      const file = logFile()
      if (logSize < 0) {
        await mkdir(dirname(file), { recursive: true })
        logSize = await stat(file).then((s) => s.size, () => 0)
      }
      await appendFile(file, line, 'utf8')
      logSize += Buffer.byteLength(line)
      if (logSize > MAX_LOG_BYTES) {
        const text = await readFile(file, 'utf8')
        const kept = text.slice(text.indexOf('\n', text.length - MAX_LOG_BYTES / 2) + 1)
        await writeFile(file, kept, 'utf8')
        logSize = Buffer.byteLength(kept)
      }
    })
    .catch(() => {})
}

export async function logTail(): Promise<string> {
  await logChain
  const text = await readFile(logFile(), 'utf8').catch(() => '')
  return text.split('\n').filter(Boolean).slice(-LOG_TAIL_LINES).join('\n')
}

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Attend que les lignes en cours soient écrites (avant de quitter). */
export const logFlushed = (): Promise<unknown> => logChain
