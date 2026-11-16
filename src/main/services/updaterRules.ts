import { createPublicKey, verify } from 'node:crypto'

// Règles de la mise à jour dans l'appli, sans Electron (testées par updaterRules.test.ts) : versions, fichier de mise à jour
// (maj.json), signature, notes de version, et quand on a le droit d'installer.

/** Adresses fixes : rien d'autre n'est jamais téléchargé ni ouvert. */
export const RELEASES_BASE = 'https://github.com/Moon-ItachiDEV/player-x-luncher/releases'
export const FEED_URL = `${RELEASES_BASE}/latest/download/maj.json`
export const FEED_SIG_URL = `${RELEASES_BASE}/latest/download/maj.json.sig`
export const DOWNLOAD_PREFIX = `${RELEASES_BASE}/download/`
/** maj.json ne fait jamais plus que ça : au-delà, il est refusé avant même d'être lu. */
export const MAX_MANIFEST = 256 * 1024
export const MAX_SETUP = 400 * 1024 * 1024
/** Une installation qui échoue deux fois n'est plus relancée toute seule. */
export const MAX_ATTEMPTS = 2

export type NoteKind = 'nouveau' | 'ameliore' | 'corrige'
export interface NoteItem {
  kind: NoteKind
  title: string
  text: string
  page?: string
}
export interface NoteEntry {
  version: string
  date: string
  items: NoteItem[]
}
export interface Manifest {
  version: string
  date: string
  file: string
  url: string
  size: number
  sha256: string
  notes: NoteEntry[]
}

/** Les pages où une note peut renvoyer (« Voir ») : les pages de la barre, et les sections de Paramètres. */
export const PAGE_IDS: readonly string[] = [
  'play', 'lib', 'clips', 'stats', 'friends',
  'set-home', 'set-rec', 'set-overlay', 'set-routine', 'set-keys', 'set-general', 'set-library', 'set-pc', 'set-accounts', 'set-edit', 'set-about'
]

// ---------- versions ----------

export interface Semver {
  major: number
  minor: number
  patch: number
  pre: (string | number)[]
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function parseVersion(v: unknown): Semver | null {
  if (typeof v !== 'string' || v.length > 64) return null
  const m = SEMVER.exec(v)
  if (!m) return null
  const pre = m[4] ? m[4].split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x)) : []
  // Un identifiant numérique sans zéro de tête (règle de semver)
  if (m[4] && m[4].split('.').some((x) => /^0\d+$/.test(x))) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre }
}

export const isVersion = (v: unknown): v is string => parseVersion(v) !== null

/** -1, 0 ou 1 (semver : une préversion est plus petite que sa version) ; null si une des deux n'est pas une version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parseVersion(a), y = parseVersion(b)
  if (!x || !y) return null
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1
  if (!x.pre.length && !y.pre.length) return 0
  if (!x.pre.length) return 1
  if (!y.pre.length) return -1
  const n = Math.max(x.pre.length, y.pre.length)
  for (let i = 0; i < n; i++) {
    const p = x.pre[i], q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    if (typeof p === 'number' && typeof q === 'number') return p < q ? -1 : 1
    // Un identifiant numérique est plus petit qu'un identifiant avec des lettres
    if (typeof p === 'number') return -1
    if (typeof q === 'number') return 1
    return p < q ? -1 : 1
  }
  return 0
}

/** `a` est strictement plus récente que `b`. */
export const isNewer = (a: string, b: string): boolean => compareVersions(a, b) === 1

// ---------- fichier de mise à jour ----------

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string }
const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** Texte simple : ni retour à la ligne ni caractère de contrôle. */
const plain = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)
const extra = (o: Record<string, unknown>, keys: string[]): string | undefined => Object.keys(o).find((k) => !keys.includes(k))
const DATE = /^\d{4}-\d{2}-\d{2}$/
const KINDS: readonly string[] = ['nouveau', 'ameliore', 'corrige']

export function parseNotes(raw: unknown): Parsed<NoteEntry[]> {
  if (!Array.isArray(raw) || raw.length > 60) return bad('notes : liste invalide')
  const out: NoteEntry[] = []
  for (const e of raw) {
    if (!isObj(e)) return bad('notes : entrée invalide')
    const x = extra(e, ['version', 'date', 'items'])
    if (x) return bad(`notes : champ inconnu « ${x.slice(0, 20)} »`)
    if (!isVersion(e.version)) return bad('notes : version invalide')
    if (typeof e.date !== 'string' || !DATE.test(e.date)) return bad('notes : date invalide')
    if (!Array.isArray(e.items) || e.items.length > 40) return bad('notes : liste de nouveautés invalide')
    const items: NoteItem[] = []
    for (const it of e.items) {
      if (!isObj(it)) return bad('notes : nouveauté invalide')
      const y = extra(it, ['kind', 'title', 'text', 'page'])
      if (y) return bad(`notes : champ inconnu « ${y.slice(0, 20)} »`)
      if (typeof it.kind !== 'string' || !KINDS.includes(it.kind)) return bad('notes : type invalide')
      if (!plain(it.title, 80) || !plain(it.text, 300)) return bad('notes : texte invalide')
      if (it.page !== undefined && (typeof it.page !== 'string' || !PAGE_IDS.includes(it.page))) return bad('notes : page inconnue')
      items.push({ kind: it.kind as NoteKind, title: it.title, text: it.text, ...(it.page !== undefined ? { page: it.page } : {}) })
    }
    out.push({ version: e.version, date: e.date, items })
  }
  return { ok: true, value: out }
}

/** L'adresse du Setup : exactement celle d'une Release du dépôt, qui finit par le nom du fichier, sans rien de plus. */
export function isSetupUrl(url: unknown, file: string): boolean {
  if (typeof url !== 'string' || url.length > 400 || !url.startsWith(DOWNLOAD_PREFIX) || !url.endsWith('/' + file)) return false
  if (/[?#%\\\u0000- ]/.test(url) || url.includes('..')) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'github.com' && !u.username && !u.password && !u.port && !u.search && !u.hash && u.href === url
  } catch {
    return false
  }
}

/** Le contenu de maj.json (déjà signé) : chaque champ vérifié, aucun champ en trop. */
export function parseManifest(raw: unknown): Parsed<Manifest> {
  if (!isObj(raw)) return bad('fichier invalide')
  const x = extra(raw, ['version', 'date', 'file', 'url', 'size', 'sha256', 'notes'])
  if (x) return bad(`champ inconnu « ${x.slice(0, 20)} »`)
  if (!isVersion(raw.version)) return bad('version invalide')
  if (typeof raw.date !== 'string' || !DATE.test(raw.date)) return bad('date invalide')
  const file = raw.file
  if (typeof file !== 'string' || file.length > 120 || !/^[\w.-]+\.exe$/.test(file) || file.includes('..') || file.startsWith('.')) return bad('nom de fichier invalide')
  if (!isSetupUrl(raw.url, file)) return bad('adresse invalide')
  const size = raw.size
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > MAX_SETUP) return bad('taille invalide')
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(raw.sha256)) return bad('empreinte invalide')
  const notes = parseNotes(raw.notes)
  if (!notes.ok) return notes
  return { ok: true, value: { version: raw.version, date: raw.date, file, url: raw.url as string, size, sha256: raw.sha256.toLowerCase(), notes: notes.value } }
}

// ---------- signature ----------

/** La signature est un fichier de 64 octets (Ed25519), brut ou écrit en base64. */
export function decodeSignature(buf: Uint8Array): Buffer | null {
  const b = Buffer.from(buf)
  if (b.length === 64) return b
  if (b.length > 200) return null
  const text = b.toString('latin1').trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null
  const d = Buffer.from(text, 'base64')
  return d.length === 64 ? d : null
}

/** Vrai si une des clés publiques (PEM, SPKI) a signé exactement ces octets. Une clé illisible est sautée. */
export function verifySignature(data: Uint8Array, sig: Uint8Array, pems: readonly string[]): boolean {
  const s = decodeSignature(sig)
  if (!s) return false
  for (const pem of pems) {
    try {
      if (verify(null, data, createPublicKey(pem), s)) return true
    } catch {
      /* clé illisible : on essaie la suivante */
    }
  }
  return false
}

// ---------- notes de version ----------

export interface NotesChoice {
  /** Les versions à montrer, de la plus récente à la plus ancienne. */
  show: NoteEntry[]
  /** Le réglage `notesSeen` à enregistrer une fois les notes vues. */
  seen: string
}

/**
 * Quelles notes montrer après un démarrage. `settingsExisted` : il y avait déjà des réglages avant ce lancement.
 * - Première installation : rien, la version actuelle est notée comme vue.
 * - Première version avec les mises à jour (réglages déjà là, `seen` vide) : les notes de la version actuelle.
 * - Sinon : toutes les versions après `seen`, jusqu'à la version actuelle (une version sautée n'est pas perdue).
 */
export function chooseNotes(all: NoteEntry[], seen: string, current: string, settingsExisted: boolean): NotesChoice {
  if (!isVersion(current)) return { show: [], seen }
  if (!settingsExisted) return { show: [], seen: current }
  const sorted = (l: NoteEntry[]): NoteEntry[] => l.slice().sort((a, b) => compareVersions(b.version, a.version) ?? 0)
  if (!isVersion(seen)) return { show: sorted(all.filter((e) => e.version === current)), seen: current }
  if (!isNewer(current, seen)) return { show: [], seen }
  return { show: sorted(all.filter((e) => isNewer(e.version, seen) && !isNewer(e.version, current))), seen: current }
}

/** « Revoir les nouveautés » : la version installée et les deux d'avant. */
export function reviewNotes(all: NoteEntry[], current: string): NoteEntry[] {
  return all.filter((e) => !isNewer(e.version, current)).sort((a, b) => compareVersions(b.version, a.version) ?? 0).slice(0, 3)
}

// ---------- installer ----------

export interface InstallFacts {
  ready: boolean
  /** Un jeu tourne, un clip est filmé, un film se fabrique. */
  blocked: boolean
  /** Windows s'arrête ou ferme la session. */
  sessionEnd: boolean
  /** Le Setup a déjà été lancé (un seul lancement, quel que soit le chemin). */
  spawned: boolean
  /** Échecs d'installation déjà notés pour cette version. */
  attempts: number
  /** Réglage « Installer à la fermeture ». */
  updateOnQuit: boolean
}
export type InstallRefusal = 'not-ready' | 'blocked' | 'session-end' | 'spawned' | 'attempts' | 'setting'

/** `now` : la personne a cliqué « Redémarrer ». `quit` : installation en silence à la fermeture de Player X. */
export function decideInstall(mode: 'now' | 'quit', f: InstallFacts): { ok: true } | { ok: false; reason: InstallRefusal } {
  if (f.spawned) return { ok: false, reason: 'spawned' }
  if (!f.ready) return { ok: false, reason: 'not-ready' }
  if (f.blocked) return { ok: false, reason: 'blocked' }
  if (mode === 'quit') {
    if (f.sessionEnd) return { ok: false, reason: 'session-end' }
    if (!f.updateOnQuit) return { ok: false, reason: 'setting' }
    if (f.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'attempts' }
  }
  return { ok: true }
}

export interface AttemptFile {
  version: string
  attempts: number
}

/** Lecture du petit fichier des tentatives : n'importe quoi d'autre qu'un {version, attempts} valide donne null. */
export function parseAttempt(raw: unknown): AttemptFile | null {
  if (!isObj(raw) || !isVersion(raw.version)) return null
  const n = raw.attempts
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100) return null
  return { version: raw.version, attempts: n }
}

/**
 * Au démarrage, après une installation lancée : la version a changé (réussi), ou pas (échec de plus).
 * `give-up` : trop d'échecs, on arrête les installations silencieuses.
 */
export function afterAttempt(rec: AttemptFile, current: string): { outcome: 'installed' } | { outcome: 'retry'; attempts: number } | { outcome: 'give-up'; attempts: number } {
  if (!isNewer(rec.version, current)) return { outcome: 'installed' }
  const attempts = rec.attempts + 1
  return attempts >= MAX_ATTEMPTS ? { outcome: 'give-up', attempts } : { outcome: 'retry', attempts }
}

/** Marqueur « installation en cours » : bloque une deuxième ouverture de l'ancienne version pendant 2 minutes. */
export const MARKER_MAX_AGE_MS = 2 * 60 * 1000
export interface MarkerFile {
  version: string
  at: number
}
export function parseMarker(raw: unknown): MarkerFile | null {
  if (!isObj(raw) || !isVersion(raw.version) || typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null
  return { version: raw.version, at: raw.at }
}
/** Une ouverture doit se taire : le marqueur est frais, et cette version est encore celle qui va être remplacée. */
export function markerBlocks(m: MarkerFile | null, current: string, now: number): boolean {
  if (!m) return false
  const age = now - m.at
  return age >= 0 && age < MARKER_MAX_AGE_MS && isNewer(m.version, current)
}

// ---------- avancement ----------

export function etaSeconds(received: number, total: number, bytesPerSec: number): number | null {
  if (!(bytesPerSec > 0) || total <= received) return null
  return Math.max(1, Math.ceil((total - received) / bytesPerSec))
}
