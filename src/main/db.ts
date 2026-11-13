import { app, safeStorage } from 'electron'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import type { Game } from '@shared/types'
import { logError } from './crashLog'
import { decryptChromium } from './services/chromiumCrypt'

// SQLite local via sql.js (WebAssembly) : aucun module natif à compiler sous Windows.
// La base est un simple fichier dans le dossier de données de l'appli.
let db: Database
let dbPath: string
let SQLmod: Awaited<ReturnType<typeof initSqlJs>> | null = null

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
  SQLmod = SQL
  dbPath = join(app.getPath('userData'), 'launcher.db')
  // Base illisible (coupure pendant une écriture d'une ancienne version) : on repart de la copie de secours.
  const open = (file: string): Database | null => {
    if (!existsSync(file)) return null
    try {
      const d = new SQL.Database(readFileSync(file))
      d.exec('SELECT count(*) FROM sqlite_master')
      return d
    } catch {
      return null
    }
  }
  db = open(dbPath) ?? open(`${dbPath}.bak`) ?? new SQL.Database()
  db.run(`
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, store TEXT NOT NULL, store_id TEXT NOT NULL, name TEXT NOT NULL,
      install_dir TEXT, cover_url TEXT, hero_url TEXT, last_played INTEGER, favorite INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS launches (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER NOT NULL);
  `)
  // Migration : colonne ajoutée après la première version.
  try {
    db.run('ALTER TABLE games ADD COLUMN exe_path TEXT')
  } catch {
    /* déjà présente */
  }
  persist()
}

/** Une copie de secours au plus toutes les 10 minutes. */
const BACKUP_EVERY_MS = 10 * 60_000
/**
 * Les écritures sont regroupées : le fichier est réécrit au plus une fois toutes les 1,5 s (avant : à chaque écriture,
 * jusqu'à plusieurs fois par seconde en partie). flushDb() écrit tout de suite (fermeture, mise en veille, fin de session).
 */
const PERSIST_DELAY_MS = 1_500
let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist(): void {
  persistTimer ??= setTimeout(() => {
    persistTimer = null
    try {
      persist()
    } catch (e) {
      logError('écriture de la base', e)
    }
  }, PERSIST_DELAY_MS)
}

/** Écrit tout de suite ce qui attend (à appeler avant de quitter ou de se mettre en veille). */
export function flushDb(): void {
  if (!persistTimer) return
  clearTimeout(persistTimer)
  persistTimer = null
  try {
    persist()
  } catch (e) {
    logError('écriture de la base', e)
  }
}

function persist(): void {
  // Écriture atomique : fichier temporaire puis renommage. Une coupure en pleine écriture laisse l'ancienne base intacte.
  const tmp = `${dbPath}.tmp`
  writeFileSync(tmp, Buffer.from(db.export()))
  try {
    const bak = `${dbPath}.bak`
    if (existsSync(dbPath) && (!existsSync(bak) || Date.now() - statSync(bak).mtimeMs > BACKUP_EVERY_MS)) copyFileSync(dbPath, bak)
  } catch {
    /* la copie de secours est un plus, pas une condition */
  }
  try {
    renameSync(tmp, dbPath)
  } catch {
    // Fichier verrouillé un instant (antivirus, indexation) : écriture directe, comme avant.
    writeFileSync(dbPath, readFileSync(tmp))
  }
}

// --- clé/valeur (paramètres, comptes). Les valeurs secrètes sont chiffrées par l'OS. ---

/**
 * Valeurs présentes mais illisibles (base copiée d'un autre compte Windows, chiffrement de Windows réinitialisé…).
 * L'appli continue avec les valeurs par défaut, mais l'original n'est jamais détruit : avant la première réécriture,
 * il est mis de côté sous « <clé>.illisible », récupérable si le chiffrement d'origine revient.
 */
const unreadable = new Map<string, string>()

/** Valeurs chiffrées déjà déchiffrées (le déchiffrement passe par Windows à chaque fois) : oubliées dès qu'elles changent. */
const decrypted = new Map<string, string>()
/** Numéro de version de chaque clé, pour les caches des services (réglages…). */
const stamps = new Map<string, number>()
export const kvStamp = (key: string): number => stamps.get(key) ?? 0
function changed(key: string): void {
  decrypted.delete(key)
  stamps.set(key, kvStamp(key) + 1)
}

function keepUnreadable(key: string): void {
  const raw = unreadable.get(key)
  if (raw === undefined) return
  db.run('INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)', [`${key}.illisible`, raw])
  unreadable.delete(key)
}

export function getKv<T>(key: string, fallback: T): T {
  const stmt = db.prepare('SELECT value FROM kv WHERE key = ?')
  stmt.bind([key])
  const raw = stmt.step() ? (stmt.get()[0] as string) : null
  stmt.free()
  if (raw === null) return fallback
  try {
    let text = raw
    if (raw.startsWith('enc:')) {
      text = decrypted.get(key) ?? safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'))
      decrypted.set(key, text)
    }
    return JSON.parse(text) as T
  } catch (e) {
    if (!unreadable.has(key)) {
      unreadable.set(key, raw)
      logError(`lecture de « ${key} »`, e)
    }
    return fallback
  }
}

/** Chiffrement de Windows (DPAPI) disponible. */
export const canEncrypt = (): boolean => safeStorage.isEncryptionAvailable()
const plainNoted = new Set<string>()

export function setKv(key: string, value: unknown, secret = false): void {
  let text = JSON.stringify(value)
  if (secret && canEncrypt()) text = 'enc:' + safeStorage.encryptString(text).toString('base64')
  else if (secret && !plainNoted.has(key)) {
    // Sans chiffrement de Windows : écrit en clair, et noté. Les vrais secrets (clés, jetons) n'arrivent jamais ici :
    // settings.ts les retire avant (voir saveSettings).
    plainNoted.add(key)
    logError(`écriture de « ${key} »`, new Error('chiffrement de Windows indisponible : valeur écrite sans chiffrement'))
  }
  keepUnreadable(key)
  db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, text])
  changed(key)
  schedulePersist()
}

export function deleteKv(key: string): void {
  keepUnreadable(key)
  db.run('DELETE FROM kv WHERE key = ?', [key])
  changed(key)
  schedulePersist()
}

// --- jeux ---

/**
 * Jeux détectés. `lastPlayed` : dernier lancement depuis Player X, repris de l'historique des lancements si la ligne du jeu
 * l'a perdu (jeu désinstallé puis réinstallé). Les autres dates (Steam, parties vues) s'ajoutent dans withPlaytime, jamais ici.
 */
export function listGames(): Game[] {
  // Une seule lecture groupée de `launches` (pas d'index sur game_id) pour le nombre et le dernier lancement.
  const res = db.exec(`
    SELECT g.id, g.store, g.store_id, g.name, g.install_dir, g.cover_url, g.hero_url,
           MAX(COALESCE(g.last_played, 0), COALESCE(l.last, 0)), g.favorite, g.exe_path, l.n
    FROM games g
    LEFT JOIN (SELECT game_id, COUNT(*) AS n, MAX(at) AS last FROM launches GROUP BY game_id) l ON l.game_id = g.id`)
  if (!res.length) return []
  return res[0].values.map((r) => ({
    id: r[0] as string,
    store: r[1] as Game['store'],
    storeId: r[2] as string,
    name: r[3] as string,
    installDir: (r[4] as string) ?? undefined,
    coverUrl: (r[5] as string) ?? undefined,
    heroUrl: (r[6] as string) ?? undefined,
    lastPlayed: (r[7] as number) || undefined,
    favorite: r[8] === 1,
    exePath: (r[9] as string) ?? undefined,
    launches: (r[10] as number) ?? 0
  }))
}

/** Remplace la liste des jeux détectés en gardant favoris et dernière session. */
export function replaceGames(games: Game[]): void {
  const keep = new Map(listGames().map((g) => [g.id, g]))
  db.run('BEGIN')
  try {
    db.run('DELETE FROM games')
    for (const g of games) {
      const old = keep.get(g.id)
      db.run(
        'INSERT OR REPLACE INTO games (id, store, store_id, name, install_dir, cover_url, hero_url, last_played, favorite, exe_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          g.id,
          g.store,
          g.storeId,
          g.name,
          g.installDir ?? null,
          g.coverUrl ?? null,
          g.heroUrl ?? null,
          old?.lastPlayed ?? g.lastPlayed ?? null,
          (old ? old.favorite : g.favorite) ? 1 : 0,
          g.exePath ?? null
        ]
      )
    }
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  schedulePersist()
}

export function recordLaunch(id: string): void {
  const now = Date.now()
  db.run('UPDATE games SET last_played = ? WHERE id = ?', [now, id])
  db.run('INSERT INTO launches (game_id, at) VALUES (?, ?)', [id, now])
  schedulePersist()
}

export function toggleFavorite(id: string): void {
  db.run('UPDATE games SET favorite = 1 - favorite WHERE id = ?', [id])
  schedulePersist()
}

/** Seuls les jeux listés restent en favoris. */
export function setFavorites(ids: string[]): void {
  db.run('BEGIN')
  try {
    db.run('UPDATE games SET favorite = 0')
    for (const id of ids) db.run('UPDATE games SET favorite = 1 WHERE id = ?', [id])
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  schedulePersist()
}

// --- sessions de jeu (temps de jeu mesuré par Player X) ---

/** Ouvre une session et renvoie son identifiant. */
/** Sessions changées : les deux bilans par jeu ci-dessous sont recalculés seulement à ce moment-là. */
let sessionsMemo: { seen: Map<string, number>; time: Map<string, number> } | null = null

export function openSession(gameId: string, at: number): number {
  sessionsMemo = null
  db.run('INSERT INTO sessions (game_id, started, ended) VALUES (?, ?, ?)', [gameId, at, at])
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
  schedulePersist()
  return id
}

/** Prolonge les sessions en cours : `ended` est la dernière fois où le jeu a été vu, même si Player X se ferme ensuite. */
export function touchSessions(ids: number[], at: number): void {
  if (!ids.length) return
  sessionsMemo = null
  for (const id of ids) db.run('UPDATE sessions SET ended = ? WHERE id = ?', [at, id])
  schedulePersist()
}

/** Dernière fois où l'un de ces jeux a été vu en cours (fin de sa session la plus récente). */
export function lastSeenAt(gameIds: string[]): number | undefined {
  if (!gameIds.length) return undefined
  const res = db.exec(`SELECT MAX(ended) FROM sessions WHERE game_id IN (${gameIds.map(() => '?').join(', ')})`, gameIds)
  const v = res[0]?.values[0]?.[0]
  return typeof v === 'number' ? v : undefined
}

/** Dernière fois où chaque jeu a été vu en cours par Player X (fin de sa session la plus récente). */
export function lastSeenByGame(): Map<string, number> {
  return new Map(sessionTotals().seen)
}

function sessionTotals(): { seen: Map<string, number>; time: Map<string, number> } {
  if (sessionsMemo) return sessionsMemo
  const res = db.exec('SELECT game_id, MAX(ended), SUM(ended - started) FROM sessions GROUP BY game_id')
  const rows = res[0]?.values ?? []
  sessionsMemo = {
    seen: new Map(rows.map((r) => [r[0] as string, r[1] as number])),
    time: new Map(rows.map((r) => [r[0] as string, (r[2] as number) / 60_000]))
  }
  return sessionsMemo
}

/** Minutes jouées par jeu, toutes sessions confondues. */
export function playtimeByGame(): Map<string, number> {
  return new Map(sessionTotals().time)
}

/**
 * Lecture SEULE d'une valeur dans la base d'une autre appli Player X du même PC (`%APPDATA%\<dossier>\launcher.db`).
 * Rien n'est jamais écrit là-bas. Une valeur chiffrée (clé, jeton) n'est pas lisible ici et reste ignorée.
 */
/** Valeur brute d'une clé dans la base d'une autre appli Player X du même PC (lecture seule). */
const otherReads = new Map<string, { stamp: string; values: Map<string, string | null> }>()

export function peekOtherRaw(folder: string, key: string): string | null {
  const file = join(app.getPath('appData'), folder, 'launcher.db')
  if (!SQLmod || !existsSync(file) || file === dbPath) return null
  // Relu seulement si le fichier a changé : l'écran Comptes demande les mêmes valeurs plusieurs fois de suite.
  let stamp = ''
  try {
    const st = statSync(file)
    stamp = `${st.mtimeMs}:${st.size}`
  } catch {
    return null
  }
  const memo = otherReads.get(folder)
  if (memo?.stamp === stamp && memo.values.has(key)) return memo.values.get(key) ?? null
  const raw = readOther(file, key)
  const values = memo?.stamp === stamp ? memo.values : new Map<string, string | null>()
  values.set(key, raw)
  otherReads.set(folder, { stamp, values })
  return raw
}

function readOther(file: string, key: string): string | null {
  if (!SQLmod) return null
  let d: Database | null = null
  try {
    d = new SQLmod.Database(readFileSync(file))
    const st = d.prepare('SELECT value FROM kv WHERE key = ?')
    st.bind([key])
    const raw = st.step() ? String(st.get()[0]) : null
    st.free()
    return raw
  } catch {
    return null
  } finally {
    d?.close()
  }
}

export function peekOtherKv<T>(folder: string, key: string): T | null {
  const raw = peekOtherRaw(folder, key)
  if (!raw || raw.startsWith('enc:')) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Déchiffre avec la protection de Windows (DPAPI) du compte Windows en cours, via PowerShell. La donnée passe par l'entrée standard, jamais dans la ligne de commande. */
function dpapiUnprotect(data: Buffer): Promise<Buffer | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const script = "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $o=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o))"
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (v: Buffer | null): void => { if (!done) { done = true; resolve(v) } }
    try {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true })
      const timer = setTimeout(() => { p.kill(); finish(null) }, 15000)
      p.stdout.on('data', (c: Buffer) => { out += c.toString('latin1') })
      p.on('error', () => { clearTimeout(timer); finish(null) })
      p.on('close', (code) => {
        clearTimeout(timer)
        const b = code === 0 && /^[A-Za-z0-9+/=\s]+$/.test(out) ? Buffer.from(out.trim(), 'base64') : null
        finish(b && b.length ? b : null)
      })
      p.stdin.end(data.toString('base64'))
    } catch {
      finish(null)
    }
  })
}

/** Clé de chiffrement d'une autre appli Electron du même compte Windows (son fichier « Local State »). Gardée en mémoire seulement. */
const otherKeys = new Map<string, Buffer | null>()
async function otherAppKey(folder: string): Promise<Buffer | null> {
  if (otherKeys.has(folder)) return otherKeys.get(folder) ?? null
  let key: Buffer | null = null
  try {
    const state = JSON.parse(readFileSync(join(app.getPath('appData'), folder, 'Local State'), 'utf8')) as { os_crypt?: { encrypted_key?: unknown } }
    const enc = state?.os_crypt?.encrypted_key
    if (typeof enc === 'string') {
      const b = Buffer.from(enc, 'base64')
      if (b.subarray(0, 5).toString('latin1') === 'DPAPI') key = await dpapiUnprotect(b.subarray(5))
    }
  } catch {
    key = null
  }
  if (key && key.length !== 32) key = null
  otherKeys.set(folder, key)
  return key
}

/** Oublie les clés de chiffrement lues (à appeler dès la fin d'une reprise : elles ne restent pas en mémoire). */
export function forgetOtherKeys(): void {
  for (const k of otherKeys.values()) k?.fill(0)
  otherKeys.clear()
}

/** Comme peekOtherKv, mais lit aussi les valeurs chiffrées (réglages, comptes) de l'autre appli. Rien n'y est modifié. */
export async function peekOtherKvSecret<T>(folder: string, key: string): Promise<T | null> {
  const raw = peekOtherRaw(folder, key)
  if (!raw) return null
  let text: string | null = raw
  if (raw.startsWith('enc:')) {
    const k = await otherAppKey(folder)
    text = k ? decryptChromium(Buffer.from(raw.slice(4), 'base64'), k) : null
  }
  if (text === null) throw new Error('locked')
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
