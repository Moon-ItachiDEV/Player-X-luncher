import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, readSync, openSync, closeSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { app, net, shell } from 'electron'
import type { MajNoteEntry, MajNotes, MajState, MajStatus } from '@shared/types'
import { getKv } from '../db'
import { logError } from '../crashLog'
import { broadcast } from '../windows'
import { gameRunning } from './clips'
import { filmState } from './editFilm'
import { driverState } from './pcDriver'
import { getSettings, saveSettings } from './settings'
import { setQuitting } from './tray'
import { UPDATE_KEYS } from './updaterKey'
import {
  afterAttempt, chooseNotes, decideInstall, etaSeconds, FEED_SIG_URL, FEED_URL, isNewer, MAX_MANIFEST, markerBlocks, parseAttempt, parseManifest, parseMarker, parseNotes, RELEASES_BASE, reviewNotes,
  verifySignature, type InstallFacts, type Manifest, type NoteEntry, type NotesChoice
} from './updaterRules'

// Mise à jour de Player X dans l'appli. Le fichier maj.json de la dernière Release GitHub est signé (Ed25519) : Player X ne
// croit que ce qui porte la signature de sa clé (updaterKey.ts). Le Setup n'est installé que si sa taille et son SHA-256
// sont ceux du maj.json signé. Les règles (versions, fichier, signature, quand installer) sont dans updaterRules.ts.

const FIRST_CHECK_MS = 30_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const BLOCK_POLL_MS = 3000
const COUNTDOWN_MS = 3000
const PROGRESS_MS = 250
const HEADERS_TIMEOUT_MS = 20_000
const STALL_TIMEOUT_MS = 30_000
/** Place laissée sur le disque en plus du Setup. */
const DISK_MARGIN = 100 * 1024 * 1024

const current = app.getVersion()
const dir = (): string => join(app.getPath('userData'), 'mise-a-jour')
const MANIFEST_FILE = 'maj.json'
const SIG_FILE = 'maj.json.sig'
const ATTEMPT_FILE = 'tentative.json'
const MARKER_FILE = 'installation-en-cours'

let state: MajState = { status: 'idle', current, configured: UPDATE_KEYS.length > 0, blocked: false, quiet: false }
let manifest: Manifest | null = null
let feed: { json: Buffer; sig: Buffer } | null = null
let busy = false
let download: AbortController | null = null
let userCancel = false
let simulated = false
/** Un seul lancement du Setup, par n'importe quel chemin (« Redémarrer » ou fermeture). */
let installerSpawned = false
let sessionEnding = false
/** Échecs d'installation déjà notés pour la version proposée. */
let attempts = 0
let countdown: { tick: NodeJS.Timeout; go: NodeJS.Timeout } | null = null
let finalizing = false
let settingsExisted = true
let notesAll: NoteEntry[] = []
let notesPending: (NotesChoice & { from: string }) | null = null
let started = false

// ---------- état ----------

const configured = (): boolean => simulated || UPDATE_KEYS.length > 0

/** Les notes de la nouvelle version, et de celles qu'on saute pour y arriver. */
function notesFor(m: Manifest): MajNoteEntry[] {
  return m.notes.filter((e) => isNewer(e.version, current) && !isNewer(e.version, m.version)).sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1))
}

const WITH_VERSION: MajStatus[] = ['available', 'downloading', 'verifying', 'ready', 'installing', 'error']

function put(status: MajStatus, extra: Partial<MajState> = {}): void {
  const m = manifest
  state = {
    status,
    current,
    configured: configured(),
    blocked: state.blocked,
    quiet: extra.quiet ?? state.quiet,
    ...(state.checkedAt ? { checkedAt: state.checkedAt } : {}),
    ...(m && WITH_VERSION.includes(status) ? { version: m.version, date: m.date, size: m.size, notes: notesFor(m) } : {}),
    ...extra
  }
  push()
}

function push(): void {
  broadcast('maj:state', state)
}

export function majState(): MajState {
  return state
}

/** Un jeu tourne, un clip est filmé, un film se fabrique ou un pilote s'installe : rien ne redémarre. */
function isBlocked(): boolean {
  if (simulated && state.blocked) return true
  try {
    return gameRunning() || filmState().status === 'running' || ['download', 'verify', 'consent', 'install'].includes(driverState().status)
  } catch {
    return false
  }
}

/** Relevé du « bloqué » : à chaque changement de jeux en cours, et toutes les 3 s. */
export function majRecheck(): void {
  if (simulated) return
  const b = isBlocked()
  if (b === state.blocked) return
  state = { ...state, blocked: b }
  push()
}

/** Windows ferme la session : rien ne s'installe à la fermeture (index.ts, fenêtre). */
export function markSessionEnd(): void {
  sessionEnding = true
}

/** Le Setup est lancé : une deuxième ouverture de Player X ne doit rien montrer (index.ts). */
export function majInstalling(): boolean {
  return installerSpawned
}

// ---------- fichiers ----------

function ensureDir(): string {
  const d = dir()
  mkdirSync(d, { recursive: true })
  return d
}

/** Efface les Setup, les .part et le maj.json gardé ; `all` : le fichier des tentatives aussi. */
function purge(all = false): void {
  try {
    for (const f of readdirSync(dir())) {
      if (f === MARKER_FILE) continue
      if (f === ATTEMPT_FILE && !all) continue
      rmSync(join(dir(), f), { force: true, recursive: false })
    }
  } catch {
    /* pas de dossier : rien à effacer */
  }
}

/** L'empreinte d'un fichier : relue sur le disque, pas gardée en mémoire. */
function hashFile(path: string): Promise<{ sha: string; size: number }> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    let size = 0
    createReadStream(path)
      .on('data', (c) => {
        h.update(c)
        size += c.length
      })
      .on('error', reject)
      .on('end', () => resolve({ sha: h.digest('hex'), size }))
  })
}

/** Même chose, sans attendre : pour la fermeture de Player X, qui ne peut pas attendre. */
function hashFileSync(path: string): { sha: string; size: number } {
  const h = createHash('sha256')
  const buf = Buffer.allocUnsafe(1024 * 1024)
  const fd = openSync(path, 'r')
  let size = 0
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (!n) break
      h.update(buf.subarray(0, n))
      size += n
    }
  } finally {
    closeSync(fd)
  }
  return { sha: h.digest('hex'), size }
}

const setupPath = (m: Manifest): string => join(dir(), m.file)

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// ---------- réseau ----------

class Quiet extends Error {}

/** Lit une réponse jusqu'à `max` octets (au-delà : refusée), avec un délai pour l'en-tête et un pour chaque morceau. */
async function fetchBytes(url: string, max: number): Promise<Buffer | null> {
  const ac = new AbortController()
  let timer = setTimeout(() => ac.abort(), HEADERS_TIMEOUT_MS)
  try {
    const res = await net.fetch(url, { cache: 'no-store', redirect: 'follow', signal: ac.signal })
    if (res.status === 404) return null
    if (!res.ok || !res.body) throw new Quiet(`réponse ${res.status}`)
    // net.fetch d'Electron peut rendre une adresse vide après les redirections de GitHub : seule une adresse en http:// est refusée.
    // (Le contenu reste de toute façon vérifié : signature de maj.json, taille et SHA-256 du Setup.)
    if (res.url && !res.url.startsWith('https://')) throw new Quiet('adresse non sécurisée')
    const len = Number(res.headers.get('content-length'))
    if (Number.isFinite(len) && len > max) throw new Quiet('fichier trop gros')
    const chunks: Uint8Array[] = []
    let n = 0
    const reader = res.body.getReader()
    for (;;) {
      clearTimeout(timer)
      timer = setTimeout(() => ac.abort(), STALL_TIMEOUT_MS)
      const { done, value } = await reader.read()
      if (done) break
      n += value.length
      if (n > max) {
        ac.abort()
        throw new Quiet('fichier trop gros')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    clearTimeout(timer)
  }
}

/** Le maj.json de la dernière Release, vérifié : signature d'abord (sur les octets bruts), lecture ensuite. null : pas de Release. */
async function fetchFeed(): Promise<{ json: Buffer; sig: Buffer; manifest: Manifest } | null> {
  const json = await fetchBytes(FEED_URL, MAX_MANIFEST)
  if (!json) return null
  const sig = await fetchBytes(FEED_SIG_URL, 4096)
  if (!sig) throw new Quiet('signature absente')
  if (!verifySignature(json, sig, UPDATE_KEYS)) throw new Quiet('signature invalide')
  let raw: unknown
  try {
    raw = JSON.parse(json.toString('utf8'))
  } catch {
    throw new Quiet('maj.json illisible')
  }
  const m = parseManifest(raw)
  if (!m.ok) throw new Quiet(`maj.json refusé : ${m.reason}`)
  return { json, sig, manifest: m.value }
}

// ---------- vérification ----------

const sameFeed = (a: Manifest | null, b: Manifest): boolean => !!a && a.version === b.version && a.sha256 === b.sha256

async function check(manual: boolean): Promise<void> {
  if (!configured() || simulated) return
  const st = state.status
  if (busy || st === 'downloading' || st === 'verifying' || st === 'installing') return
  // Déjà trouvée : une vérification à la demande la remontre (« Plus tard » ou la croix l'avaient rangée).
  if ((st === 'available' || st === 'ready') && manual) {
    put(st, { quiet: false })
    return
  }
  busy = true
  const was = state
  if (manual) put('checking')
  // Une vérification qui ne trouve rien de neuf remet l'état d'avant (et, à la demande, dit pourquoi).
  const back = (checkError?: string): void => {
    state = { ...was }
    delete state.checkError
    if (checkError) state.checkError = checkError
    if (manual) push()
  }
  try {
    const f = await fetchFeed()
    if (!f) return back('Aucune version publiée pour l’instant.')
    state = { ...was, checkedAt: Date.now() }
    const m = f.manifest
    if (!isNewer(m.version, current) || getSettings().updateSkipped === m.version) {
      if (st === 'available' || st === 'ready') return back()
      put('uptodate', { quiet: false })
      return
    }
    if (sameFeed(manifest, m) && (st === 'available' || st === 'ready' || st === 'error')) {
      // Rien de nouveau depuis la dernière fois : une vérification automatique ne rouvre rien.
      put(st, {})
      return
    }
    // Une version plus récente que celle déjà gardée : l'ancien Setup n'a plus d'intérêt.
    if (manifest) purge()
    manifest = m
    feed = { json: f.json, sig: f.sig }
    put('available', { quiet: false })
  } catch (e) {
    // Réseau coupé, signature fausse, fichier refusé : noté dans le journal, on réessaiera. Aucune alerte.
    logError('mise à jour : vérification', e)
    back('Pas de réponse de GitHub pour l’instant. Réessaie plus tard.')
  } finally {
    busy = false
  }
}

export async function majCheck(): Promise<MajState> {
  await check(true)
  return state
}

// ---------- téléchargement ----------

function reasonOf(e: unknown): string {
  const msg = e instanceof Error ? e.message : ''
  if (msg === 'espace') return `Pas assez de place sur le disque · ta ${current} n’a pas bougé`
  if (msg === 'empreinte') return `Empreinte invalide · fichier supprimé, ta ${current} n’a pas bougé`
  if (msg === 'taille') return `Taille inattendue · fichier supprimé, ta ${current} n’a pas bougé`
  return `Téléchargement interrompu · vérifie ta connexion, ta ${current} n’a pas bougé`
}

async function downloadSetup(m: Manifest): Promise<void> {
  const d = ensureDir()
  try {
    const fs = statfsSync(d)
    if (fs.bavail * fs.bsize < m.size + DISK_MARGIN) throw new Error('espace')
  } catch (e) {
    if (e instanceof Error && e.message === 'espace') throw e
    /* espace libre illisible : on essaie quand même */
  }
  const part = join(d, `${m.file}.part`), final = setupPath(m)
  rmSync(part, { force: true })
  const ac = new AbortController()
  download = ac
  let stall = setTimeout(() => ac.abort(), HEADERS_TIMEOUT_MS)
  const h = createHash('sha256')
  let n = 0
  let fh: Awaited<ReturnType<typeof open>> | null = null
  try {
    const res = await net.fetch(m.url, { cache: 'no-store', redirect: 'follow', signal: ac.signal })
    if (!res.ok || !res.body) throw new Error(`réponse ${res.status}`)
    if (res.url && !res.url.startsWith('https://')) throw new Error('adresse non sécurisée')
    const len = Number(res.headers.get('content-length'))
    if (Number.isFinite(len) && len > 0 && len !== m.size) throw new Error('taille')
    fh = await open(part, 'w')
    const reader = res.body.getReader()
    let lastAt = Date.now(), lastN = 0, speed = 0
    put('downloading', { received: 0, total: m.size, bytesPerSec: 0 })
    for (;;) {
      clearTimeout(stall)
      stall = setTimeout(() => ac.abort(), STALL_TIMEOUT_MS)
      const { done, value } = await reader.read()
      if (done) break
      n += value.length
      // Plus d'octets que le maj.json signé n'en annonce : on s'arrête tout de suite
      if (n > m.size) throw new Error('taille')
      h.update(value)
      await fh.write(value)
      const now = Date.now()
      if (now - lastAt >= PROGRESS_MS) {
        const inst = ((n - lastN) * 1000) / (now - lastAt)
        speed = speed ? speed * 0.7 + inst * 0.3 : inst
        lastAt = now
        lastN = n
        const eta = etaSeconds(n, m.size, speed)
        put('downloading', { received: n, total: m.size, bytesPerSec: Math.round(speed), ...(eta ? { etaS: eta } : {}) })
      }
    }
    clearTimeout(stall)
    await fh.close()
    fh = null
    if (n !== m.size) throw new Error('taille')
    if (h.digest('hex') !== m.sha256) throw new Error('empreinte')
    // Relu sur le disque : c'est ce fichier-là qui sera lancé.
    put('verifying')
    const disk = await hashFile(part)
    if (disk.size !== m.size || disk.sha !== m.sha256) throw new Error('empreinte')
    renameSync(part, final)
    if (feed) {
      writeFileSync(join(d, MANIFEST_FILE), feed.json)
      writeFileSync(join(d, SIG_FILE), feed.sig)
    }
  } catch (e) {
    clearTimeout(stall)
    await fh?.close().catch(() => {})
    rmSync(part, { force: true })
    // Un Setup qui ne correspond pas n'est jamais gardé.
    if (e instanceof Error && (e.message === 'empreinte' || e.message === 'taille')) purge()
    throw e
  } finally {
    download = null
  }
}

async function startDownload(quiet: boolean): Promise<void> {
  const m = manifest
  if (!m || busy) return
  busy = true
  userCancel = false
  put('downloading', { quiet, received: 0, total: m.size, bytesPerSec: 0 })
  try {
    await downloadSetup(m)
    put('ready', { quiet })
  } catch (e) {
    if (userCancel) {
      put('available', { quiet: true })
    } else {
      logError('mise à jour : téléchargement', e)
      put('error', { reason: reasonOf(e), quiet: false })
    }
  } finally {
    busy = false
  }
}

export async function majDownload(): Promise<MajState> {
  if (state.status === 'available' || state.status === 'error') void startDownload(false)
  return state
}

/** « Plus tard » : la mise à jour se télécharge sans rien montrer, puis s'installe à la fermeture. */
export async function majLater(): Promise<MajState> {
  if (state.status === 'available') void startDownload(true)
  else if (state.status === 'ready') put('ready', { quiet: true })
  else if (state.status === 'error') put('error', { quiet: true })
  return state
}

export async function majCancel(): Promise<MajState> {
  if (state.status === 'downloading' && download) {
    userCancel = true
    download.abort()
  }
  return state
}

export async function majSkip(): Promise<MajState> {
  const v = manifest?.version
  if (!v || (state.status !== 'available' && state.status !== 'error')) return state
  saveSettings({ updateSkipped: v })
  purge()
  manifest = null
  feed = null
  put('uptodate', { quiet: false })
  return state
}

export async function majRetry(): Promise<MajState> {
  if (state.status !== 'error') return state
  if (manifest && feed) void startDownload(false)
  else {
    put('idle', { quiet: false })
    await check(true)
  }
  return state
}

export function majOpenRelease(): void {
  void shell.openExternal(`${RELEASES_BASE}/latest`)
}

// ---------- installation ----------

function installFacts(): InstallFacts {
  return { ready: state.status === 'ready' || state.status === 'installing', blocked: isBlocked(), sessionEnd: sessionEnding, spawned: installerSpawned, attempts, updateOnQuit: getSettings().updateOnQuit }
}

/** Marque l'installation (tentatives, marqueur) puis lance le Setup, détaché : il survit à Player X. null : rien n'a été lancé. */
function spawnSetup(m: Manifest, args: string[]): ChildProcess | null {
  if (installerSpawned) return null
  installerSpawned = true
  try {
    const d = ensureDir()
    writeFileSync(join(d, ATTEMPT_FILE), JSON.stringify({ version: m.version, attempts }))
    writeFileSync(join(d, MARKER_FILE), JSON.stringify({ version: m.version, at: Date.now() }))
    const child = spawn(setupPath(m), args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', (e) => {
      // Windows a refusé de lancer le Setup : rien n'est parti, Player X reste ouvert.
      installerSpawned = false
      rmSync(join(dir(), MARKER_FILE), { force: true })
      logError('mise à jour : lancement du Setup', e)
      put('error', { reason: `Windows n’a pas pu lancer l’installation · ta ${current} n’a pas bougé`, quiet: false })
    })
    child.unref()
    return child
  } catch (e) {
    installerSpawned = false
    logError('mise à jour : lancement du Setup', e)
    return null
  }
}

function stopCountdown(): void {
  if (!countdown) return
  clearInterval(countdown.tick)
  clearTimeout(countdown.go)
  countdown = null
}

/** « Redémarrer » : 3 secondes pour annuler, puis les dernières vérifications, puis le Setup et la sortie. */
export async function majInstall(): Promise<MajState> {
  if (countdown || finalizing) return state
  const d = decideInstall('now', installFacts())
  if (!d.ok) return state
  const endsAt = Date.now() + COUNTDOWN_MS
  put('installing', { secondsLeft: 3, endsAt, quiet: false })
  const tick = setInterval(() => {
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
    if (left !== state.secondsLeft) put('installing', { secondsLeft: left, endsAt })
  }, 200)
  const go = setTimeout(() => void finishInstall(), COUNTDOWN_MS)
  countdown = { tick, go }
  return state
}

async function finishInstall(): Promise<void> {
  stopCountdown()
  const m = manifest
  if (!m) return
  finalizing = true
  try {
    // Un jeu a démarré pendant le compte à rebours : on n'installe pas.
    if (isBlocked()) {
      put('ready', { quiet: false })
      return
    }
    const disk = await hashFile(setupPath(m)).catch(() => null)
    if (!disk || disk.size !== m.size || disk.sha !== m.sha256) {
      purge()
      put('error', { reason: `Le fichier a changé sur le disque · supprimé, ta ${current} n’a pas bougé`, quiet: false })
      return
    }
    // Et une dernière fois, juste avant de lancer : le jeu a pu démarrer pendant la relecture.
    if (!decideInstall('now', installFacts()).ok) {
      put('ready', { quiet: false })
      return
    }
    const child = spawnSetup(m, ['/S', '--force-run'])
    if (!child) {
      put('error', { reason: `Windows n’a pas pu lancer l’installation · ta ${current} n’a pas bougé`, quiet: false })
      return
    }
    // On attend que Windows ait vraiment lancé le Setup avant de fermer Player X.
    const started = await new Promise<boolean>((resolve) => {
      child.once('spawn', () => resolve(true))
      child.once('error', () => resolve(false))
    })
    if (started && installerSpawned) {
      setQuitting()
      app.quit()
    }
  } finally {
    finalizing = false
  }
}

export async function majInstallCancel(): Promise<MajState> {
  if (state.status === 'installing' && countdown && !finalizing) {
    stopCountdown()
    put('ready', { quiet: false })
  }
  return state
}

/** À la fermeture de Player X : installation en silence si une version est prête (réglage, jamais pendant une partie). */
function installAtQuit(): void {
  if (installerSpawned || !manifest || simulated) return
  const d = decideInstall('quit', installFacts())
  if (!d.ok) return
  const m = manifest
  try {
    // La fermeture n'attend pas : relecture sans pause, de quelques dixièmes de seconde.
    const disk = hashFileSync(setupPath(m))
    if (disk.size !== m.size || disk.sha !== m.sha256) {
      purge()
      return
    }
    spawnSetup(m, ['/S'])
  } catch (e) {
    logError('mise à jour : installation à la fermeture', e)
  }
}

// ---------- démarrage ----------

/** Pas de page de départ : une deuxième ouverture de l'ancienne version se tait pendant une installation (index.ts). */
export function installInProgress(): boolean {
  try {
    const m = parseMarker(readJson(join(app.getPath('userData'), 'mise-a-jour', MARKER_FILE)))
    return markerBlocks(m, current, Date.now())
  } catch {
    return false
  }
}

function readNotesFile(): NoteEntry[] {
  try {
    const r = parseNotes(JSON.parse(readFileSync(join(app.getAppPath(), 'notes-de-version.json'), 'utf8')))
    if (r.ok) return r.value
    logError('notes de version', new Error(r.reason))
  } catch (e) {
    logError('notes de version', e)
  }
  return []
}

/** À appeler juste après l'ouverture de la base, avant tout enregistrement des réglages : savoir si c'est une première installation. */
export function prepareUpdater(): void {
  settingsExisted = getKv<unknown>('settings', null) !== null
  notesAll = readNotesFile()
}

/** Au démarrage : tentatives, marqueur, Setup gardé, nouveautés à montrer. */
function restore(): void {
  const d = dir()
  // Le marqueur n'a servi qu'à retenir une deuxième ouverture : un démarrage normal l'enlève.
  rmSync(join(d, MARKER_FILE), { force: true })
  const rec = parseAttempt(readJson(join(d, ATTEMPT_FILE)))
  let gaveUp: string | null = null
  if (rec) {
    const r = afterAttempt(rec, current)
    if (r.outcome === 'installed') purge(true)
    else if (r.outcome === 'retry') {
      attempts = r.attempts
      writeFileSync(join(d, ATTEMPT_FILE), JSON.stringify({ version: rec.version, attempts }))
    } else {
      // Deux installations qui n'ont pas changé la version : plus d'installation silencieuse, la personne choisit.
      gaveUp = rec.version
      purge(true)
    }
  }
  if (gaveUp) {
    put('error', { reason: `L’installation de la ${gaveUp} n’a pas marché deux fois · ta ${current} n’a pas bougé`, release: true, version: gaveUp, quiet: false })
    return
  }
  if (!configured()) return
  // Le Setup gardé d'une fois précédente : seulement s'il est encore signé, plus récent que cette version, et intact.
  const json = existsSync(join(d, MANIFEST_FILE)) ? readFileSync(join(d, MANIFEST_FILE)) : null
  const sig = existsSync(join(d, SIG_FILE)) ? readFileSync(join(d, SIG_FILE)) : null
  const keep = ((): Manifest | null => {
    if (!json || !sig || !verifySignature(json, sig, UPDATE_KEYS)) return null
    let raw: unknown
    try {
      raw = JSON.parse(json.toString('utf8'))
    } catch {
      return null
    }
    const m = parseManifest(raw)
    if (!m.ok || !isNewer(m.value.version, current)) return null
    try {
      return statSync(setupPath(m.value)).size === m.value.size ? m.value : null
    } catch {
      return null
    }
  })()
  if (!keep || !json || !sig) {
    purge()
    return
  }
  void hashFile(setupPath(keep)).then(
    (disk) => {
      if (disk.sha !== keep.sha256 || disk.size !== keep.size) return purge()
      if (manifest || installerSpawned) return
      manifest = keep
      feed = { json, sig }
      // Prête, mais discrète : elle s'installe à la fermeture, ou à la demande depuis Paramètres.
      put('ready', { quiet: true })
    },
    () => purge()
  )
}

function startNotes(): void {
  const s = getSettings()
  const c = chooseNotes(notesAll, s.notesSeen, current, settingsExisted)
  if (c.show.length) notesPending = { ...c, from: s.notesSeen }
  else if (c.seen !== s.notesSeen) saveSettings({ notesSeen: c.seen })
}

/** À appeler une fois, après `app.whenReady()` et l'ouverture de la base. */
export function startUpdater(): void {
  if (started) return
  started = true
  state = { ...state, configured: configured() }
  try {
    restore()
  } catch (e) {
    logError('mise à jour : démarrage', e)
  }
  try {
    startNotes()
  } catch (e) {
    logError('notes de version', e)
  }
  majRecheck()
  setInterval(majRecheck, BLOCK_POLL_MS).unref()
  app.on('will-quit', installAtQuit)
  if (!configured()) return
  setTimeout(() => void check(false), FIRST_CHECK_MS).unref()
  setInterval(() => void check(false), CHECK_EVERY_MS).unref()
}

// ---------- nouveautés ----------

export function majNotes(review: boolean): MajNotes {
  if (review) return { entries: reviewNotes(notesAll, current), fresh: false, to: current }
  if (!notesPending) return { entries: [], fresh: false, to: current }
  return { entries: notesPending.show, fresh: true, ...(notesPending.from ? { from: notesPending.from } : {}), to: current }
}

export function majNotesSeen(): void {
  if (!notesPending) return
  const seen = notesPending.seen
  notesPending = null
  saveSettings({ notesSeen: seen })
}

// ---------- essais en développement (majSim.ts, jamais dans l'installeur) ----------

/** Imite l'état de la mise à jour pour voir l'interface sans GitHub. Sans effet dans la version installée. */
export function simSet(status: MajStatus, extra: Partial<MajState> = {}): void {
  if (app.isPackaged) return
  simulated = true
  manifest = null
  put(status, { version: '0.7.2', date: '2026-11-17', size: 139 * 1024 * 1024, ...extra })
}

export function simNotes(entries: NoteEntry[], from?: string): void {
  if (app.isPackaged) return
  notesPending = { show: entries, seen: current, from: from ?? '' }
}

export function simBlocked(on: boolean): void {
  if (app.isPackaged) return
  state = { ...state, blocked: on }
  push()
}
