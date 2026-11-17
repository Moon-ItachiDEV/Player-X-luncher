// Mon PC (lecture seule) : les règles, sans Electron ni Windows, testées par pcRules.test.ts.
// - les cartes graphiques lues par Windows (WMI Win32_VideoController) : marque, version du pilote telle que le fabricant l'écrit ;
// - la dernière version d'un pilote NVIDIA, demandée à l'adresse non officielle AjaxDriverService (celle de nvidia-update, MIT) ;
// - les écrans réglés sous la fréquence qu'ils savent faire.
// Rien n'est installé ni changé : Player X lit, compare et donne un lien vers la page officielle.

import type { DriverJournalEntry, GpuVendor, PcDisplay, PcGpu, PcLatest } from '../../shared/types/pc'
import { NVIDIA_PFID } from './nvidiaProducts'

/** Ce que le script PowerShell renvoie pour une carte (services/pc.ts). Tout peut manquer. */
export interface RawGpu {
  name?: unknown
  ver?: unknown
  date?: unknown
  pnp?: unknown
  maker?: unknown
}

/** Version « Adrenalin » d'une carte AMD, lue dans le registre du pilote : `match` est le début de son identifiant PCI. */
export interface RawRadeon {
  match?: unknown
  radeon?: unknown
}

/** Un écran vu par Windows (EnumDisplaySettings) : son mode actuel, et la fréquence la plus haute à la même taille. */
export interface RawDisplay {
  x: number
  y: number
  w: number
  h: number
  hz: number
  maxHz: number
  primary: boolean
}

/** Un écran vu par Electron (screen.getAllDisplays) : le nom et la fréquence que Chromium utilise. */
export interface ElectronDisplay {
  label: string
  hz: number
  x: number
  y: number
  w: number
  h: number
  primary: boolean
}

// ---------- les liens officiels ----------

export const LINKS = {
  nvidiaDrivers: 'https://www.nvidia.com/fr-fr/drivers/',
  nvidiaApp: 'https://www.nvidia.com/fr-fr/software/nvidia-app/',
  amd: 'https://www.amd.com/fr/support/download/drivers.html',
  intel: 'https://www.intel.fr/content/www/fr/fr/support/detect.html'
} as const

/** Une adresse venue de NVIDIA n'est gardée que si elle mène chez NVIDIA, en https. */
export function nvidiaUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  try {
    const url = new URL(u)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || (host !== 'nvidia.com' && !host.endsWith('.nvidia.com'))) return null
    return url.toString()
  } catch {
    return null
  }
}

// ---------- les cartes ----------

export const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** La marque, d'après l'identifiant PCI (VEN_10DE…) : le nom affiché peut être changé par le fabricant du PC. */
export function vendorOf(pnp: string, maker = '', name = ''): GpuVendor {
  const v = /VEN_([0-9A-F]{4})/i.exec(pnp)?.[1]?.toUpperCase()
  if (v === '10DE') return 'nvidia'
  if (v === '1002' || v === '1022') return 'amd'
  if (v === '8086') return 'intel'
  if (v) return 'other'
  // Sans identifiant PCI (pilote générique, carte virtuelle) : le nom du fabricant, sinon rien
  const t = `${maker} ${name}`.toLowerCase()
  if (/\bnvidia\b/.test(t)) return 'nvidia'
  if (/\b(amd|ati|radeon)\b/.test(t)) return 'amd'
  if (/\bintel\b/.test(t)) return 'intel'
  return 'other'
}

/** Les cartes qui ne sont pas des cartes : écran à distance, pilote de base, écrans virtuels (Parsec, Spacedesk…). */
export function isVirtual(name: string, pnp: string): boolean {
  if (/^(ROOT|SWD)\\/i.test(pnp)) return true
  return /basic (display|render)|remote display|indirect display|virtual display|parsec|spacedesk|citrix|vmware|virtualbox|hyper-v/i.test(name)
}

/**
 * La version que NVIDIA affiche (566.36), depuis celle de Windows (32.0.15.6636) : les cinq derniers chiffres, un point après
 * le troisième. C'est la règle de nvidia-update et de NVIDIA elle-même.
 */
export function nvidiaVersion(windowsVersion: string): string | null {
  if (!/^\d+(\.\d+){3}$/.test(windowsVersion)) return null
  const digits = windowsVersion.replace(/\./g, '')
  if (digits.length < 5) return null
  const last = digits.slice(-5)
  return `${last.slice(0, 3)}.${last.slice(3)}`.replace(/^0+(?=\d)/, '')
}

/** Compare deux versions « 566.36 » ou « 32.0.101.9175 » : négatif si a est plus vieille. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Une date WMI déjà mise en « 2026-10-21 » par le script ; tout le reste est jeté. */
function cleanDate(v: unknown): string | null {
  const s = str(v)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= '2000-01-01' ? s : null
}

const radeonVersion = (pnp: string, radeon: RawRadeon[]): string | null => {
  const id = pnp.toLowerCase()
  for (const r of radeon) {
    const m = str(r.match).toLowerCase(), v = str(r.radeon)
    if (m && v && id.startsWith(m) && /^\d+\.\d+(\.\d+)*$/.test(v)) return v
  }
  return null
}

/** Une carte Intel séparée (Arc), pas la puce graphique du processeur (UHD, Iris Xe). */
export const isIntelArc = (name: string): boolean => /\barc\b/i.test(name)

/** Les cartes, rangées : NVIDIA et AMD d'abord (celles des jeux), puis Intel. Les cartes virtuelles sont laissées de côté. */
export function readGpus(raw: RawGpu[], radeon: RawRadeon[], laptop: boolean): PcGpu[] {
  const out: PcGpu[] = []
  for (const r of raw) {
    const name = str(r.name).replace(/\((R|TM)\)/gi, '').replace(/\s+/g, ' ').trim()
    const pnp = str(r.pnp)
    if (!name || isVirtual(name, pnp)) continue
    const vendor = vendorOf(pnp, str(r.maker), name)
    const win = /^\d+(\.\d+){3}$/.test(str(r.ver)) ? str(r.ver) : null
    const version = !win ? null : vendor === 'nvidia' ? nvidiaVersion(win) : vendor === 'amd' ? radeonVersion(pnp, radeon) : win
    out.push({ name, vendor, version, windowsVersion: win, date: cleanDate(r.date), ...gpuAdvice(vendor, name, laptop) })
  }
  const rank: Record<GpuVendor, number> = { nvidia: 0, amd: 1, intel: 2, other: 3 }
  // Intel séparée (Arc) avant la puce du processeur
  return out.sort((a, b) => rank[a.vendor] - rank[b.vendor] || Number(isIntelArc(b.name)) - Number(isIntelArc(a.name)))
}

/** Le lien officiel et la phrase qui va avec. Pour NVIDIA, `latest` peut s'ajouter ensuite (nvidiaLatest). */
function gpuAdvice(vendor: GpuVendor, name: string, laptop: boolean): Pick<PcGpu, 'link' | 'note'> {
  if (vendor === 'nvidia') return { link: { url: LINKS.nvidiaDrivers, label: 'Page des pilotes NVIDIA' } }
  if (vendor === 'amd') {
    return {
      link: { url: LINKS.amd, label: 'Outil officiel AMD' },
      note: laptop
        ? 'AMD ne publie pas sa dernière version : son outil officiel la trouve. Sur un portable, le pilote du fabricant du PC passe parfois avant.'
        : 'AMD ne publie pas sa dernière version : son outil officiel (Auto-Detect) la trouve et l’installe.'
    }
  }
  if (vendor === 'intel') {
    const arc = isIntelArc(name)
    return {
      link: { url: LINKS.intel, label: 'Assistant officiel Intel' },
      note: laptop
        ? 'Sur un portable, prends d’abord le pilote du fabricant du PC : il est fait pour ton modèle, et l’assistant Intel peut le refuser.'
        : arc
          ? 'L’assistant officiel Intel compare ta version à la dernière et propose la mise à jour.'
          : 'C’est la puce graphique du processeur. L’assistant officiel Intel dit si un pilote plus récent existe.'
    }
  }
  return { link: null }
}

// ---------- NVIDIA : quelle carte, et sa dernière version ----------

/** Le nom de la carte comme NVIDIA le range : sans « NVIDIA », sans la mémoire (« 6GB »), sans « (OEM) » ni « Max-Q ». */
export function nvidiaModel(name: string): string {
  return name
    .replace(/^NVIDIA\s+/i, '')
    .replace(/\s+\([A-Z]+\)$/, '')
    .replace(/\s+\d+\s?GB\b.*$/i, '')
    .replace(/\s+COLLECTORS EDITION$/i, '')
    .replace(/\s+with Max-Q Design$/i, '')
    .replace(/\bSuper\b/g, 'SUPER')
    .trim()
}

/** La série d'une GeForce (« RTX 50 », « GTX 16 ») : toutes les cartes d'une série récente partagent le même pilote. */
export function nvidiaSeries(model: string): string | null {
  const m = /^GeForce (RTX|GTX) (\d{2})\d{2}\b/.exec(model)
  if (!m) return null
  // Seules les séries récentes : les GTX 900 et 10 ne suivent plus le pilote Game Ready du moment, on les cherche par leur nom exact
  if (m[1] === 'RTX' && ['20', '30', '40', '50'].includes(m[2])) return `RTX ${m[2]}`
  if (m[1] === 'GTX' && m[2] === '16') return 'GTX 16'
  return null
}

/**
 * Le numéro NVIDIA (« pfid ») de la carte. D'abord le nom exact ; sinon une carte de la même série récente, qui reçoit le même
 * pilote (une carte sortie après la liste). `bySeries` le dit, pour l'écrire à l'écran.
 */
export function nvidiaPfid(name: string, laptop: boolean): { pfid: number; notebook: boolean; bySeries: boolean } | null {
  const model = nvidiaModel(name)
  const notebook = laptop || /\bLaptop GPU\b/i.test(model)
  const tables = notebook ? [NVIDIA_PFID.notebook, NVIDIA_PFID.desktop] : [NVIDIA_PFID.desktop]
  for (const t of tables) if (t[model]) return { pfid: t[model], notebook: t === NVIDIA_PFID.notebook, bySeries: false }
  const series = nvidiaSeries(model)
  if (!series) return null
  const [kind, num] = series.split(' ')
  const table = notebook ? NVIDIA_PFID.notebook : NVIDIA_PFID.desktop
  const same = Object.entries(table).find(([n]) => new RegExp(`^GeForce ${kind} ${num}\\d{2}\\b`).test(n))
  return same ? { pfid: same[1], notebook, bySeries: true } : null
}

/** Windows 10 et 11 64 bits : le même pilote, l'identifiant 57 chez NVIDIA. Pilotes DCH (les seuls publiés aujourd'hui). Mêmes
 * paramètres que nvidia-update, rien de plus : la première réponse est le dernier pilote Game Ready. */
export const nvidiaLookupUrl = (pfid: number): string =>
  `https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup&pfid=${pfid}&osID=57&dch=1`

const decode = (v: unknown): string => {
  const s = str(v)
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/** Une date NVIDIA (« Tue Nov 04, 2026 » ou « 2026-11-04 ») en « 2026-11-04 », sinon null. */
export function nvidiaDate(v: unknown): string | null {
  const s = decode(v)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s)
  if (!m) return null
  const mo = MONTHS.indexOf(m[1].toLowerCase())
  if (mo < 0) return null
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/**
 * La réponse d'AjaxDriverService. Adresse non officielle : sa forme peut changer sans prévenir, donc tout est vérifié et une
 * réponse qui ne ressemble pas à l'attendu donne null (l'écran montre alors le lien vers nvidia.com, sans version).
 */
export function parseNvidiaLookup(body: unknown): { version: string; date: string | null; url: string | null; name: string; downloadUrl: string | null } | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { Success?: unknown; IDS?: unknown }
  if (String(b.Success) !== '1' || !Array.isArray(b.IDS) || !b.IDS.length) return null
  const info = (b.IDS[0] as { downloadInfo?: Record<string, unknown> } | null)?.downloadInfo
  if (!info || typeof info !== 'object') return null
  const version = decode(info.Version)
  if (!/^\d{3}\.\d{2}$/.test(version)) return null
  return { version, date: nvidiaDate(info.ReleaseDateTime), url: nvidiaUrl(decode(info.DetailsURL)), name: decode(info.Name) || 'Pilote NVIDIA', downloadUrl: nvidiaDownloadUrl(decode(info.DownloadURL)) }
}

/** Ce que l'écran dit de la version installée face à la dernière. */
export function nvidiaLatest(installed: string | null, found: { version: string; date: string | null; url: string | null; downloadUrl?: string | null }, bySeries: boolean): PcLatest {
  const cmp = installed ? compareVersions(installed, found.version) : -1
  return {
    version: found.version,
    date: found.date,
    url: found.url ?? LINKS.nvidiaDrivers,
    status: !installed ? 'unknown' : cmp < 0 ? 'update' : cmp === 0 ? 'up-to-date' : 'newer',
    bySeries,
    ...(found.downloadUrl ? { downloadUrl: found.downloadUrl } : {})
  }
}

// ---------- les écrans ----------

/** Une fréquence à moins de 5 Hz de la plus haute ne compte pas : 59 et 60 Hz, c'est le même écran. */
const HZ_MARGIN = 5

/**
 * Les écrans : le nom et la fréquence d'Electron, la fréquence la plus haute de Windows (même taille d'image). Les deux se
 * retrouvent par leur coin en haut à gauche, en pixels réels. Un écran que Windows n'a pas décrit garde sa fréquence, sans alerte.
 */
export function readDisplays(electron: ElectronDisplay[], windows: RawDisplay[]): PcDisplay[] {
  const out: PcDisplay[] = []
  const used = new Set<RawDisplay>()
  for (const e of electron) {
    const w = windows.find((d) => !used.has(d) && d.x === e.x && d.y === e.y) ?? windows.find((d) => !used.has(d) && d.w === e.w && d.h === e.h && d.primary === e.primary)
    if (w) used.add(w)
    const hz = Math.round(e.hz > 0 ? e.hz : w?.hz ?? 0)
    const maxHz = w && w.maxHz > 0 ? Math.round(Math.max(w.maxHz, w.hz)) : null
    out.push({ name: str(e.label) || (e.primary ? 'Écran principal' : 'Écran'), width: w?.w ?? e.w, height: w?.h ?? e.h, hz, maxHz, primary: e.primary, low: isLowHz(hz, maxHz) })
  }
  // Electron muet (aucun écran rendu) : ceux de Windows seuls
  if (!electron.length) {
    for (const w of windows) out.push({ name: w.primary ? 'Écran principal' : 'Écran', width: w.w, height: w.h, hz: Math.round(w.hz), maxHz: Math.round(Math.max(w.maxHz, w.hz)), primary: w.primary, low: isLowHz(w.hz, w.maxHz) })
  }
  return out.sort((a, b) => Number(b.primary) - Number(a.primary))
}

export const isLowHz = (hz: number, maxHz: number | null): boolean => !!maxHz && hz > 0 && maxHz - hz >= HZ_MARGIN

/** Les lignes du script des écrans : x, y, largeur, hauteur, fréquence, fréquence la plus haute, principal (1/0). */
export function parseDisplayLines(text: string): RawDisplay[] {
  const out: RawDisplay[] = []
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split('\t')
    if (p[0] !== 'D' || p.length < 8) continue
    const [x, y, w, h, hz, maxHz] = p.slice(1, 7).map((n) => parseInt(n, 10))
    if ([x, y, w, h, hz, maxHz].some((n) => !Number.isFinite(n)) || w <= 0 || h <= 0 || hz > 1000 || maxHz > 1000) continue
    out.push({ x, y, w, h, hz, maxHz, primary: p[7] === '1' })
  }
  return out
}

/** Le résumé du sommaire des paramètres : ce qui demande un geste d'abord. */
export function pcBadge(gpus: PcGpu[], displays: PcDisplay[]): string {
  if (gpus.some((g) => g.latest?.status === 'update')) return 'Nouveau pilote'
  if (displays.some((d) => d.low)) return 'Écran à régler'
  return ''
}

// ---------- mise à jour du pilote NVIDIA (lot 2) ----------
// Le fichier vient de NVIDIA, sa signature est vérifiée deux fois (avant la demande de Windows, puis par le processus
// administrateur juste avant de le lancer), un point de restauration est créé, puis l'installeur officiel tourne.

/** Le fichier d'installation : seulement sur download.nvidia.com (us., international.…), en https, un .exe. */
export function nvidiaDownloadUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  try {
    const url = new URL(u)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || !(host === 'download.nvidia.com' || host.endsWith('.download.nvidia.com'))) return null
    if (!/\.exe$/i.test(url.pathname) || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Nom du fichier sur le disque : celui de NVIDIA, sans rien d'autre que lettres, chiffres, points et tirets. */
export function installerName(downloadUrl: string, version: string): string {
  const base = decodeURIComponent(new URL(downloadUrl).pathname.split('/').pop() || '')
  const clean = base.replace(/[^A-Za-z0-9._-]/g, '')
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/i.test(clean) && clean.length <= 120 ? clean : `nvidia-${version.replace(/[^0-9.]/g, '')}.exe`
}

/** Une signature Authenticode acceptée : valide, et signée par NVIDIA Corporation (sujet du certificat). */
export function nvidiaSigned(status: string, subject: string): boolean {
  return status.trim() === 'Valid' && /(^|,\s*)O=NVIDIA Corporation(,|$)/.test(subject.trim()) && /(^|,\s*)CN=NVIDIA Corporation(,|$)/.test(subject.trim())
}

/** Texte PowerShell entre apostrophes. PowerShell prend aussi les apostrophes typographiques pour des délimiteurs. */
export const psQuote = (s: string): string => `'${s.replace(/['‘’‚‛]/g, (c) => c + c)}'`

/** Arguments de l'installeur NVIDIA : sans fenêtre à remplir, sans redémarrage forcé (ceux de nvidia-update). */
export const NVIDIA_SETUP_ARGS = ['-s', '-noreboot', '-noeula', '-nofinish', '-passive']

/**
 * Le script du processus administrateur (une seule demande de Windows). Il revérifie la signature, crée le point de
 * restauration (ou s'arrête s'il échoue, sauf si on a choisi de s'en passer), lance l'installeur et attend sa fin. Il écrit
 * son résultat en JSON dans `resultFile`. Aucun chemin ni texte ne vient de la page : tout est fabriqué ici.
 */
export function installScript(o: { exe: string; resultFile: string; version: string; restorePoint: boolean }): string {
  const args = NVIDIA_SETUP_ARGS.map(psQuote).join(',')
  return [
    "$ErrorActionPreference='Stop'",
    `$exe=${psQuote(o.exe)}`,
    `$res=${psQuote(o.resultFile)}`,
    "function Fin($h){ $h | ConvertTo-Json -Compress | Set-Content -LiteralPath $res -Encoding UTF8; exit 0 }",
    "$r=@{ step='signature' }",
    'try {',
    '  $s=Get-AuthenticodeSignature -LiteralPath $exe',
    "  $sub=''; if($s.SignerCertificate){ $sub=$s.SignerCertificate.Subject }",
    "  if([string]$s.Status -ne 'Valid' -or $sub -notmatch '(^|, )O=NVIDIA Corporation(,|$)'){ $r.error='signature'; Fin $r }",
    "  $r.restore='skipped'",
    ...(o.restorePoint
      ? [
          "  $r.step='restore'",
          '  try {',
          '    $w=$null',
          `    Checkpoint-Computer -Description ${psQuote(`Player X : avant le pilote NVIDIA ${o.version}`)} -RestorePointType MODIFY_SETTINGS -WarningVariable w -WarningAction SilentlyContinue -ErrorAction Stop`,
          "    if($w){ $r.restore='recent' } else { $r.restore='ok' }",
          "  } catch { $r.restore='failed'; $r.error=[string]$_.Exception.Message; Fin $r }"
        ]
      : []),
    "  $r.step='install'",
    `  $p=Start-Process -FilePath $exe -ArgumentList ${args} -Wait -PassThru`,
    '  $r.code=$p.ExitCode',
    '  Fin $r',
    '} catch { $r.error=[string]$_.Exception.Message; Fin $r }'
  ].join('\n')
}

/** Le script du processus ordinaire : il demande l'élévation (fenêtre de Windows) et attend. Le script administrateur arrive par PX_ELEV. */
export const ELEVATE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'try {',
  "  $ps=Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
  "  $p=Start-Process -FilePath $ps -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$env:PX_ELEV",
  "  'EXIT' + [char]9 + $p.ExitCode",
  "} catch { 'REFUSED' + [char]9 + $_.Exception.Message }"
].join('\n')

export const encodePs = (script: string): string => Buffer.from(script, 'utf16le').toString('base64')

export interface InstallResult {
  step?: string
  restore?: 'ok' | 'recent' | 'skipped' | 'failed'
  code?: number
  error?: string
}

/** Le fichier de résultat du processus administrateur (UTF-8 avec BOM sous PowerShell 5.1). null s'il est illisible. */
export function parseInstallResult(text: string): InstallResult | null {
  try {
    const j = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>
    if (!j || typeof j !== 'object') return null
    const restore = ['ok', 'recent', 'skipped', 'failed'].includes(String(j.restore)) ? (String(j.restore) as InstallResult['restore']) : undefined
    return {
      step: typeof j.step === 'string' ? j.step : undefined,
      restore,
      code: typeof j.code === 'number' ? j.code : undefined,
      error: typeof j.error === 'string' ? j.error.slice(0, 300) : undefined
    }
  } catch {
    return null
  }
}

export type InstallOutcome = Exclude<DriverJournalEntry['outcome'], 'stopped'>

/**
 * Ce qui s'est passé. Codes de l'installeur NVIDIA (documentation NVIDIA) : 0 réussi, 1 réussi mais redémarrage demandé.
 * La preuve finale reste la version relue ensuite par Windows (services/pcDriver.ts).
 */
export function installOutcome(refused: boolean, r: InstallResult | null): InstallOutcome {
  if (refused) return 'refused'
  if (!r) return 'failed'
  if (r.error === 'signature') return 'signature'
  if (r.restore === 'failed') return 'restore-failed'
  if (r.code === 0) return 'ok'
  if (r.code === 1) return 'reboot'
  return 'failed'
}

/** Clé du journal des pilotes dans la base de Player X. */
export const JOURNAL_KEY = 'pcDriverJournal'

export function cleanJournal(v: unknown): DriverJournalEntry[] {
  if (!Array.isArray(v)) return []
  const OUT = ['ok', 'reboot', 'refused', 'signature', 'restore-failed', 'failed', 'stopped']
  const ver = (x: unknown): string | null => (typeof x === 'string' && /^\d{3}\.\d{2}$/.test(x) ? x : null)
  return v
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({ at: Number(e.at), from: ver(e.from), to: ver(e.to) ?? '', outcome: String(e.outcome) as DriverJournalEntry['outcome'], restore: e.restore as DriverJournalEntry['restore'], after: ver(e.after) }))
    .filter((e) => Number.isFinite(e.at) && e.at > 0 && e.to && OUT.includes(e.outcome))
    .map((e) => ({ ...e, restore: ['ok', 'recent', 'skipped', 'failed'].includes(String(e.restore)) ? e.restore : undefined }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 20)
}
