// Prêt à jouer : où en est Steam avec un jeu, d'après son manifeste local `steamapps/appmanifest_<appid>.acf`.
// Module pur, sans Electron : lu par le processus principal (services/steamUpdates.ts) et par l'interface (libellés).
// Testé sous Node seul (npm run test:ready).
//
// Bits de `StateFlags` : l'énumération EAppState de Steam, telle que la liste Lutris (docs/steam.rst).
// Champs `BytesToDownload`, `BytesDownloaded`, `BytesToStage`, `BytesStaged` : ceux que lit GameFinder (AppManifestParser.cs).
// Dans le fichier, Steam écrit surtout 4 (prêt), 6 (mise à jour requise), 1026 ou 1030 (mise à jour commencée) et 1542
// (en pause) : un 6 ou un 1030 ne dit pas si le téléchargement tourne. C'est la clé `Updating` du registre de Steam
// (HKCU\Software\Valve\Steam\Apps\<appid>), ou des octets qui augmentent d'une lecture à l'autre, qui le disent.
// Steam réécrit le manifeste par intervalles : la progression avance par paliers.
import type { SteamUpdate } from './types'

const UPDATE_REQUIRED = 2
const FULLY_INSTALLED = 4
const UPDATE_RUNNING = 256
const UPDATE_PAUSED = 512
const UPDATE_STARTED = 1024
const VALIDATING = 131_072
const ADDING_FILES = 262_144
const PREALLOCATING = 524_288
const DOWNLOADING = 1_048_576
const STAGING = 2_097_152
const COMMITTING = 4_194_304

/** Bits d'un téléchargement en cours, quand Steam les écrit dans le fichier. */
const RUNNING_BITS = UPDATE_RUNNING | DOWNLOADING | PREALLOCATING | ADDING_FILES
/** Bits d'une mise à jour à faire ou commencée. */
const PENDING_BITS = UPDATE_REQUIRED | UPDATE_STARTED | RUNNING_BITS

/** Ce que dit le manifeste d'un jeu. */
export interface AppManifestFacts {
  appId: string
  flags: number
  /** Octets à télécharger et déjà téléchargés pour la mise à jour en cours. */
  toDownload: number
  downloaded: number
  /** Octets à installer (« staging ») et déjà installés. */
  toStage: number
  staged: number
}

/** Valeur d'une clé du manifeste (`"BytesToDownload"		"123"`). Les clés lues ici ne sont qu'au premier niveau. */
function field(acf: string, key: string): string | undefined {
  return new RegExp(`"${key}"\\s+"([^"]*)"`, 'i').exec(acf)?.[1]
}

function bytes(acf: string, key: string): number {
  const v = Number(field(acf, key))
  return Number.isSafeInteger(v) && v > 0 ? v : 0
}

/** Lit un manifeste ; null s'il est illisible (pas d'appid ni de StateFlags). */
export function readAppManifest(acf: string): AppManifestFacts | null {
  const appId = field(acf, 'appid')
  if (!appId || !/^\d{1,10}$/.test(appId)) return null
  const flags = Number(field(acf, 'StateFlags'))
  if (!Number.isSafeInteger(flags) || flags < 0) return null
  return {
    appId,
    flags,
    toDownload: bytes(acf, 'BytesToDownload'),
    downloaded: bytes(acf, 'BytesDownloaded'),
    toStage: bytes(acf, 'BytesToStage'),
    staged: bytes(acf, 'BytesStaged')
  }
}

const step = (total: number, done: number): Pick<SteamUpdate, 'total' | 'done'> => (total > 0 ? { total, done: Math.min(done, total) } : {})

/**
 * État d'un jeu. `active` : Steam travaille dessus en ce moment (clé `Updating` du registre, ou octets en hausse).
 * null : prêt à jouer. undefined : rien à suivre (pas installé et pas en téléchargement : StateFlags 0 ou 1).
 */
export function updateOf(f: AppManifestFacts, active: boolean): SteamUpdate | null | undefined {
  const installed = (f.flags & FULLY_INSTALLED) !== 0
  const first = installed ? {} : { firstInstall: true as const }
  const pending = (f.flags & (PENDING_BITS | UPDATE_PAUSED)) !== 0
  if (f.flags & (STAGING | COMMITTING)) return { kind: 'installing', ...step(f.toStage, f.staged), ...first }
  if (f.flags & VALIDATING) return { kind: 'verifying', ...first }
  if (pending && (active || f.flags & RUNNING_BITS)) {
    // Téléchargement fini, Steam pose les fichiers : l'installation a sa propre progression.
    if (f.toDownload > 0 && f.downloaded >= f.toDownload && f.toStage > 0 && f.staged < f.toStage)
      return { kind: 'installing', ...step(f.toStage, f.staged), ...first }
    return { kind: 'downloading', ...step(f.toDownload, f.downloaded), ...first }
  }
  if (f.flags & UPDATE_PAUSED) return { kind: 'paused', ...step(f.toDownload, f.downloaded), ...first }
  if (pending) return { kind: 'queued', ...step(f.toDownload, f.downloaded), ...first }
  return installed ? null : undefined
}

/** Le manifeste dit qu'une mise à jour attend ou tourne (de quoi interroger le registre). */
export function hasPending(f: AppManifestFacts): boolean {
  return (f.flags & (PENDING_BITS | UPDATE_PAUSED | STAGING | COMMITTING | VALIDATING)) !== 0
}

/**
 * Appids que Steam est en train de mettre à jour, d'après `reg query HKCU\Software\Valve\Steam\Apps /s /v Updating` :
 * des blocs « HKEY_CURRENT_USER\…\Apps\730 » suivis de « Updating    REG_DWORD    0x1 ».
 */
export function parseUpdatingReg(stdout: string): Set<string> {
  const out = new Set<string>()
  let app: string | null = null
  for (const line of stdout.split(/\r?\n/)) {
    const key = /\\Apps\\(\d{1,10})\s*$/i.exec(line)
    if (key) {
      app = key[1]
      continue
    }
    const v = /^\s+Updating\s+REG_DWORD\s+0x([0-9a-f]+)\s*$/i.exec(line)
    if (v && app && parseInt(v[1], 16) !== 0) out.add(app)
  }
  return out
}

/** « 3,1 Go », « 12 Go », « 850 Mo », « 12 Ko » : en multiples de 1 024, comme les tailles qu'affiche Steam. */
export function formatBytes(n: number): string {
  const GB = 1024 ** 3
  const MB = 1024 ** 2
  if (n >= GB) {
    const v = n / GB
    return `${String(v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).replace('.', ',')} Go`
  }
  if (n >= MB) return `${Math.round(n / MB)} Mo`
  return `${Math.max(1, Math.round(n / 1024))} Ko`
}

/** Avancement de l'étape en cours (0 à 99) ; null si Steam n'a pas donné de taille. Jamais 100 avant la fin. */
export function updatePercent(u: SteamUpdate): number | null {
  if (!u.total) return null
  return Math.max(0, Math.min(99, Math.floor(((u.done ?? 0) / u.total) * 100)))
}

/** Ce qui reste à télécharger (octets), quand Steam le dit. */
export function remainingBytes(u: SteamUpdate): number | null {
  return u.total ? Math.max(0, u.total - (u.done ?? 0)) : null
}

/**
 * Libellé court, pour une pastille : « Mise à jour · 3,1 Go », « Téléchargement · 62 % », « En pause · 62 % »,
 * « Installation · 80 % », « Vérification ». Un premier téléchargement en attente : « À télécharger · 3,1 Go ».
 */
export function updateLabel(u: SteamUpdate): string {
  const pct = updatePercent(u)
  const withPct = (word: string): string => (pct === null ? word : `${word} · ${pct} %`)
  switch (u.kind) {
    case 'downloading':
      return withPct('Téléchargement')
    case 'paused':
      return withPct('En pause')
    case 'installing':
      return withPct('Installation')
    case 'verifying':
      return 'Vérification'
    case 'queued': {
      // Déjà commencé, puis remis dans la file d'attente de Steam.
      if (pct !== null && (u.done ?? 0) > 0) return `En attente · ${pct} %`
      const left = remainingBytes(u)
      const word = u.firstInstall ? 'À télécharger' : 'Mise à jour'
      return left ? `${word} · ${formatBytes(left)}` : word
    }
  }
}

/** Phrase complète, pour une infobulle ou un lecteur d'écran. */
export function updateSentence(u: SteamUpdate): string {
  const pct = updatePercent(u)
  const of = u.total ? ` (${formatBytes(u.done ?? 0)} sur ${formatBytes(u.total)})` : ''
  const what = u.firstInstall ? 'le jeu' : 'la mise à jour'
  switch (u.kind) {
    case 'downloading':
      return `Steam télécharge ${what}${pct === null ? '' : ` : ${pct} %`}${of}.`
    case 'paused':
      return `Le téléchargement est en pause dans Steam${pct === null ? '' : ` (${pct} %)`}.`
    case 'installing':
      return `Steam installe ${what}${pct === null ? '' : ` : ${pct} %`}.`
    case 'verifying':
      return 'Steam vérifie les fichiers du jeu.'
    case 'queued': {
      const left = remainingBytes(u)
      if (u.firstInstall) return `Le téléchargement du jeu attend dans Steam${left ? ` (${formatBytes(left)})` : ''}.`
      return `Une mise à jour attend dans Steam${left ? ` : ${formatBytes(left)} à télécharger` : ''}.`
    }
  }
}

/** Steam est en train de faire quelque chose (barre qui avance), plutôt qu'attendre. */
export function updateActive(u: SteamUpdate): boolean {
  return u.kind === 'downloading' || u.kind === 'installing' || u.kind === 'verifying'
}
