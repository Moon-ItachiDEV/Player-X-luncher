import { app, safeStorage } from 'electron'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { copyFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import type { Game } from '@shared/types'
import { logError } from './crashLog'
import { asideName, lockedFiles, readRetry, rescuePlan, salvageText, stuckLog, stuckText, toPrune, unreadText, withUnread, type FileState } from './dbRescue'
import { ensureSchema, salvage } from './dbSalvage'
import { decryptChromium } from './services/chromiumCrypt'

// SQLite local via sql.js (WebAssembly) : aucun module natif à compiler sous Windows.
// La base est un simple fichier dans le dossier de données de l'appli.
let db: Database
let dbPath: string
let SQLmod: Awaited<ReturnType<typeof initSqlJs>> | null = null

/** Le fichier principal sur le disque est une base saine (vérifiée au démarrage, ou écrite par cette session) : seul lui est copié en .bak. */
let mainTrusted = false
let report: { notice: 'secours' | 'zero' | 'partiel'; kept: number } | null = null

/** Ce qu'il faut dire à la personne après le démarrage (copie de secours reprise, base reprise en partie, ou repartie de zéro) ; null sinon. */
export function rescueReport(): { notice: 'secours' | 'zero' | 'partiel'; kept: number } | null {
  return report
}

type SqlJs = Awaited<ReturnType<typeof initSqlJs>>
const loadSql = (): Promise<SqlJs> => initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * État d'un fichier de base : ouvert, `PRAGMA quick_check` doit répondre « ok », et la table kv doit exister. Ne lève jamais.
 * Un fichier tenu par un autre programme (antivirus) est relu quelques fois avant d'être dit « verrouille » (jamais confondu
 * avec « illisible », qui ne désigne qu'un fichier réellement lu mais abîmé). Pour un fichier abîmé, les octets lus sont rendus.
 */
async function probe(SQL: SqlJs, file: string): Promise<{ state: FileState; db: Database | null; bytes: Uint8Array | null; readError: string | null }> {
  if (!existsSync(file)) return { state: 'absent', db: null, bytes: null, readError: null }
  let bytes: Buffer
  try {
    bytes = await readRetry(() => readFileSync(file), sleep, 8, 350)
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code
    return { state: 'verrouille', db: null, bytes: null, readError: typeof code === 'string' ? code : 'erreur' }
  }
  let d: Database | null = null
  try {
    d = new SQL.Database(bytes)
    const rows = d.exec('PRAGMA quick_check')
    const lines = rows.flatMap((r) => r.values)
    if (lines.length !== 1 || lines[0][0] !== 'ok') throw new Error('quick_check')
    if (d.exec('SELECT count(*) FROM sqlite_master')[0].values[0][0] === 0) {
      d.close()
      return { state: 'vide', db: null, bytes: null, readError: null }
    }
    // Des tables mais pas kv (elle existe depuis la première version) : ce n'est pas une base de Player X, on la met de côté.
    if (d.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kv'").length === 0) throw new Error('pas de table kv')
    return { state: 'ok', db: d, bytes: null, readError: null }
  } catch {
    try {
      d?.close()
    } catch {
      /* déjà fermée */
    }
    return { state: 'illisible', db: null, bytes, readError: null }
  }
}

export async function initDb(): Promise<void> {
  let SQL = await loadSql()
  const dir = app.getPath('userData')
  dbPath = join(dir, 'launcher.db')
  // Sonde : principal, puis dernier fichier provisoire, puis copie de secours. On s'arrête au premier fichier sain, sauf si le
  // principal lui-même est verrouillé (il est peut-être sain : on n'ira jamais le remplacer par la copie de secours).
  const facts: { main: FileState; tmp: FileState; bak: FileState } = { main: 'absent', tmp: 'absent', bak: 'absent' }
  const unread: { main?: Uint8Array; tmp?: Uint8Array; bak?: Uint8Array } = {}
  const unreadable: string[] = []
  let opened: Database | null = null
  const files = { main: dbPath, tmp: `${dbPath}.tmp`, bak: `${dbPath}.bak` }
  for (const k of ['main', 'tmp', 'bak'] as const) {
    const r = await probe(SQL, files[k])
    facts[k] = r.state
    if (r.bytes) unread[k] = r.bytes
    if (r.readError) unreadable.push(unreadText(basename(files[k]), r.readError))
    if (k === 'main' && r.state === 'verrouille') break
    if (r.db) {
      opened = r.db
      break
    }
    // Une instance de sql.js qui a lu un fichier abîmé n'est jamais gardée : celle de la base ne lit que du sain.
    if (r.state === 'illisible') SQL = await loadSql()
  }
  const locked = lockedFiles(facts)
  if (locked.length) {
    try {
      opened?.close()
    } catch {
      /* rien à fermer */
    }
    const names = locked.map((w) => basename(files[w]))
    logError('base', withUnread(stuckLog(names, []), unreadable))
    throw new Error(stuckText(names))
  }
  const plan = rescuePlan(facts)
  // Aucun fichier sain : on reprend ce qui se lit encore du principal, sinon de la copie de secours, avant de repartir de zéro.
  let notice: 'secours' | 'zero' | 'partiel' | null = plan.notice
  let logLine = plan.log
  let rebuilt: Database | null = null
  for (const which of plan.salvage) {
    const bytes = unread[which]
    if (!bytes) continue
    const got = salvage(await loadSql(), SQL, bytes)
    if (!got) continue
    rebuilt = got.db
    notice = 'partiel'
    logLine = salvageText(basename(files[which]), got.counts)
    break
  }
  // La suite s'applique avant la première écriture ; une opération de fichier qui rate ne doit pas faire rater le démarrage...
  const keptNames: string[] = []
  const lostNames: string[] = []
  const moved: { from: string; to: string }[] = []
  const at = new Date()
  for (const which of plan.aside) {
    const from = files[which]
    const to = asideName(from, at)
    try {
      renameSync(from, to)
      keptNames.push(basename(to))
      moved.push({ from, to })
    } catch {
      try {
        // Le principal reste en place (jamais supprimé) : le premier persist() le remplace, mainTrusted l'empêche d'écraser .bak.
        copyFileSync(from, to)
        keptNames.push(basename(to))
      } catch {
        lostNames.push(basename(from))
      }
    }
  }
  // ... sauf si un fichier qui contient quelque chose n'a pu être gardé : on ne l'écrase jamais, rien n'est écrit, et la base
  // retrouve l'état d'avant ce démarrage (les fichiers renommés reprennent leur nom, dans l'ordre inverse).
  if (lostNames.length) {
    for (const m of moved.reverse()) {
      try {
        renameSync(m.to, m.from)
        keptNames.splice(keptNames.indexOf(basename(m.to)), 1)
      } catch {
        /* il reste de côté : il n'est pas perdu */
      }
    }
    logError('base', withUnread(stuckLog(lostNames, keptNames), unreadable))
    for (const d of [opened, rebuilt]) {
      try {
        d?.close()
      } catch {
        /* rien à fermer */
      }
    }
    throw new Error(stuckText(lostNames))
  }
  for (const which of plan.drop) {
    try {
      unlinkSync(files[which])
    } catch {
      /* verrouillée : mainTrusted empêche déjà de la remplacer par une copie douteuse */
    }
  }
  // Une seule ligne [base] : ce qui a été trouvé, puis ce qui s'est vraiment passé.
  if (logLine) {
    const more = keptNames.length ? `Gardé de côté : ${keptNames.join(', ')}.` : ''
    logError('base', [withUnread(logLine, unreadable), more].filter(Boolean).join(' '))
  } else if (unreadable.length) {
    // Aucune ligne due, mais un fichier n'a pas pu être lu (premier démarrage où seul le provisoire existe) : on le dit quand même.
    logError('base', unreadable.join(' '))
  }
  try {
    // Jamais un fichier mis de côté pendant ce démarrage, même si l'horloge du PC a reculé.
    const names = readdirSync(dir).filter((n) => n.startsWith('launcher.db') && !keptNames.includes(n))
    for (const n of toPrune(names)) {
      try {
        unlinkSync(join(dir, n))
      } catch {
        /* un vieux fichier de plus */
      }
    }
  } catch {
    /* dossier illisible : rien à élaguer */
  }
  // Un démarrage arrêté ne laisse aucune base que quelqu'un pourrait écrire : tout ça n'est affecté qu'ici.
  db = opened ?? rebuilt ?? new SQL.Database()
  SQLmod = SQL
  mainTrusted = plan.source === 'main'
  report = notice ? { notice, kept: keptNames.length } : null
  ensureSchema(db)
  persist()
  try {
    unlinkSync(`${dbPath}.async.tmp`)
  } catch {
    /* aucun fichier temporaire asynchrone précédent */
  }
}

/** Une copie de secours au plus toutes les 10 minutes. */
const BACKUP_EVERY_MS = 10 * 60_000
/**
 * Les écritures sont regroupées : le fichier est réécrit en asynchrone au plus une fois toutes les 1,5 s (avant :
 * écriture synchrone bloquante sur le fil principal). flushDb() écrit tout de suite en synchrone (fermeture, veille).
 */
const PERSIST_DELAY_MS = 1_500
let persistTimer: ReturnType<typeof setTimeout> | null = null
let dirty = false
let persistRunning = false
/** Incrémenté à chaque écriture (asynchrone ou synchrone) : une écriture asynchrone dépassée n'écrase jamais flushDb(). */
let persistSeq = 0

function schedulePersist(): void {
  dirty = true
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persistAsync()
  }, PERSIST_DELAY_MS)
}

/** Écrit tout de suite ce qui attend (à appeler avant de quitter ou de se mettre en veille). */
export function flushDb(): void {
  if (!persistTimer && !dirty && !persistRunning) return
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  persistSeq++
  dirty = false
  try {
    persist()
  } catch (e) {
    logError('écriture de la base', e)
  }
}

async function persistAsync(): Promise<void> {
  if (!dirty || persistRunning) return
  persistRunning = true
  const seq = ++persistSeq
  dirty = false
  const asyncTmp = `${dbPath}.async.tmp`
  try {
    const bytes = Buffer.from(db.export())
    await writeFile(asyncTmp, bytes)
    if (seq !== persistSeq) {
      await unlink(asyncTmp).catch(() => {})
      return
    }
    try {
      const bak = `${dbPath}.bak`
      if (mainTrusted && existsSync(dbPath)) {
        const bakStat = await stat(bak).catch(() => null)
        if (!bakStat || Date.now() - bakStat.mtimeMs > BACKUP_EVERY_MS) {
          await copyFile(dbPath, bak)
        }
      }
    } catch {
      /* la copie de secours est un plus, pas une condition */
    }
    if (seq !== persistSeq) {
      await unlink(asyncTmp).catch(() => {})
      return
    }
    // Le renommage final est un simple changement de métadonnée sur le fil principal : jamais en course avec flushDb().
    let renamed = false
    for (let i = 0; i < 3; i++) {
      if (seq !== persistSeq) {
        await unlink(asyncTmp).catch(() => {})
        return
      }
      try {
        renameSync(asyncTmp, dbPath)
        mainTrusted = true
        renamed = true
        break
      } catch {
        if (i < 2) await sleep(100)
      }
    }
    if (!renamed && seq === persistSeq) {
      // Fichier verrouillé un instant (antivirus, indexation) : écriture directe.
      mainTrusted = false
      await writeFile(dbPath, bytes)
      if (seq === persistSeq) mainTrusted = true
      await unlink(asyncTmp).catch(() => {})
    }
  } catch (e) {
    await unlink(asyncTmp).catch(() => {})
    if (seq === persistSeq) logError('écriture de la base', e)
  } finally {
    persistRunning = false
    if (dirty && !persistTimer) schedulePersist()
  }
}

function persist(): void {
  // Écriture atomique : fichier temporaire puis renommage. Une coupure en pleine écriture laisse l'ancienne base intacte.
  const tmp = `${dbPath}.tmp`
  writeFileSync(tmp, Buffer.from(db.export()))
  try {
    const bak = `${dbPath}.bak`
    if (mainTrusted && existsSync(dbPath) && (!existsSync(bak) || Date.now() - statSync(bak).mtimeMs > BACKUP_EVERY_MS)) copyFileSync(dbPath, bak)
  } catch {
    /* la copie de secours est un plus, pas une condition */
  }
  try {
    renameSync(tmp, dbPath)
    mainTrusted = true
  } catch {
    // Fichier verrouillé un instant (antivirus, indexation) : écriture directe, comme avant.
    // Une écriture directe coupée laisse un principal incomplet : il ne doit pas être copié en .bak.
    mainTrusted = false
    writeFileSync(dbPath, readFileSync(tmp))
    mainTrusted = true
  }
}

// --- clé/valeur (paramètres, comptes). Les valeurs secrètes sont chiffrées par l'OS. ---

/** Clés connues de la table `kv` : une faute de frappe dans un service ne compile plus. */
export type KvKey =
  | 'accounts'
  | 'achievementsIndex'
  | 'artwork'
  | 'bf6Art'
  | 'bf6Cache'
  | 'bf6History'
  | 'bf6Loadouts'
  | 'bf6MyWeapons'
  | 'bf6Recaps'
  | 'bf6Session'
  | 'bf6Tracked'
  | 'clipsEngineGood'
  | 'clipsIndex'
  | 'clipsLastGame'
  | 'clipsSettings'
  | 'clipsShareEncoder'
  | 'cs2Gsi'
  | 'cs2Lifetime'
  | 'cs2LifetimeHistory'
  | 'cs2LifetimeRaw'
  | 'cs2Match'
  | 'cs2Recaps'
  | 'demoBf6History'
  | 'demoBf6Loadouts'
  | 'demoBf6MyWeapons'
  | 'demoBf6Tracked'
  | 'demoDiscordMembers'
  | 'demoEventReminders'
  | 'demoNewsSeen'
  | 'demoShelves'
  | 'demoState'
  | 'discordMembers'
  | 'editEngineTest'
  | 'editFilmEncoder'
  | 'editLastFilm'
  | 'editMusic'
  | 'eventReminders'
  | 'newsIndex'
  | 'newsSeen'
  | 'newsSimIndex'
  | 'pcDriverJournal'
  | 'profileAvatar'
  | 'settings'
  | 'shelves'
  | 'simNewsSeen'
  | 'steamOwned'
  | 'steamPlaytime'
  | 'steamSoftware'
  | 'steamTagNames'
  | 'trayHintShown'
  | 'v3Routines'

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
export const kvStamp = (key: KvKey): number => stamps.get(key) ?? 0
function changed(key: KvKey): void {
  decrypted.delete(key)
  stamps.set(key, kvStamp(key) + 1)
}

function keepUnreadable(key: KvKey): void {
  const raw = unreadable.get(key)
  if (raw === undefined) return
  db.run('INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)', [`${key}.illisible`, raw])
  unreadable.delete(key)
}

export function getKv<T>(key: KvKey, fallback: T): T {
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

export function setKv(key: KvKey, value: unknown, secret = false): void {
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

export function deleteKv(key: KvKey): void {
  keepUnreadable(key)
  db.run('DELETE FROM kv WHERE key = ?', [key])
  changed(key)
  schedulePersist()
}

// --- jeux ---

function parseLaunchArgs(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  try {
    const a = JSON.parse(raw)
    return Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string') ? a : undefined
  } catch {
    return undefined
  }
}

/**
 * Jeux détectés. `lastPlayed` : dernier lancement depuis Player X, repris de l'historique des lancements si la ligne du jeu
 * l'a perdu (jeu désinstallé puis réinstallé). Les autres dates (Steam, parties vues) s'ajoutent dans withPlaytime, jamais ici.
 */
export function listGames(): Game[] {
  // Une seule lecture groupée de `launches` (index sur game_id) pour le nombre et le dernier lancement.
  const res = db.exec(`
    SELECT g.id, g.store, g.store_id, g.name, g.install_dir, g.cover_url, g.hero_url,
           MAX(COALESCE(g.last_played, 0), COALESCE(l.last, 0)), g.favorite, g.exe_path, l.n, g.launch_args, g.work_dir
    FROM games g
    LEFT JOIN (SELECT game_id, COUNT(*) AS n, MAX(at) AS last FROM launches GROUP BY game_id) l ON l.game_id = g.id`)
  if (!res.length) return []
  return res[0].values.map((r) => {
    const launchArgs = parseLaunchArgs(r[11])
    return {
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
      launches: (r[10] as number) ?? 0,
      ...(launchArgs ? { launchArgs } : {}),
      workDir: (r[12] as string) ?? undefined
    }
  })
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
        'INSERT OR REPLACE INTO games (id, store, store_id, name, install_dir, cover_url, hero_url, last_played, favorite, exe_path, launch_args, work_dir) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
          g.exePath ?? null,
          g.launchArgs?.length ? JSON.stringify(g.launchArgs) : null,
          g.workDir ?? null
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
const otherReads = new Map<string, { stamp: string; values: Map<string, string> }>()

export function peekOtherRaw(folder: string, key: KvKey): string | null {
  const file = join(app.getPath('appData'), folder, 'launcher.db')
  if (!SQLmod || !existsSync(file) || file === dbPath) return null
  // Une seule lecture de toute la table kv par version du fichier (au lieu de rouvrir toute la base à chaque clé).
  let stamp = ''
  try {
    const st = statSync(file)
    stamp = `${st.mtimeMs}:${st.size}`
  } catch {
    return null
  }
  const memo = otherReads.get(folder)
  if (memo?.stamp === stamp) return memo.values.get(key) ?? null
  const values = readAllOther(file)
  if (!values) return null
  otherReads.set(folder, { stamp, values })
  return values.get(key) ?? null
}

function readAllOther(file: string): Map<string, string> | null {
  if (!SQLmod) return null
  let d: Database | null = null
  try {
    d = new SQLmod.Database(readFileSync(file))
    const res = d.exec('SELECT key, value FROM kv')
    const out = new Map<string, string>()
    for (const row of res[0]?.values ?? []) {
      if (typeof row[0] === 'string' && row[1] !== null && row[1] !== undefined) out.set(row[0], String(row[1]))
    }
    return out
  } catch {
    return null
  } finally {
    d?.close()
  }
}

export function peekOtherKv<T>(folder: string, key: KvKey): T | null {
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
  const script = "$ProgressPreference='SilentlyContinue'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $o=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o))"
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (v: Buffer | null): void => { if (!done) { done = true; resolve(v) } }
    try {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true })
      const timer = setTimeout(() => { p.kill(); finish(null) }, 15000)
      p.stdout.on('data', (c: Buffer) => { out += c.toString('latin1') })
      p.stderr?.resume()
      p.stdin?.on('error', () => {})
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
export async function peekOtherKvSecret<T>(folder: string, key: KvKey): Promise<T | null> {
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
