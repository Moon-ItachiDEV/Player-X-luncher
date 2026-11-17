// Mon PC, lot 2 : mettre à jour le pilote NVIDIA depuis Player X.
// 1. Téléchargement du pilote officiel, à l'adresse donnée par NVIDIA (…download.nvidia.com seulement), dans les données de
//    Player X (dossier « pilotes »). Avancement envoyé à la page, « Annuler » possible.
// 2. Vérification de la signature Windows du fichier : valide, et signée par NVIDIA Corporation. Sinon le fichier est effacé.
// 3. Une seule demande de Windows (contrôle de compte) : un PowerShell administrateur revérifie la signature, crée un point de
//    restauration, lance l'installeur officiel sans fenêtre à remplir, attend sa fin et écrit son résultat.
// 4. La version est relue par Windows : c'est elle qui dit si le pilote a changé. Le tout va dans le journal des pilotes.
// Jamais pendant une partie ni pendant un film. Rien ne vient de la page : ni adresse, ni chemin, ni commande.
// Les règles (adresses, signature, scripts, résultat) sont dans pcRules.ts, testées sans Windows.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { app, net, shell } from 'electron'
import type { DriverJournalEntry, DriverUpdateState, PcGpu } from '../../shared/types/pc'
import { getKv, setKv } from '../db'
import { UserError } from '../errors'
import { broadcast } from '../windows'
import { gameRunning } from './clips'
import { filmState } from './editFilm'
import { pcState } from './pc'
import { cleanJournal, ELEVATE_SCRIPT, encodePs, installerName, installOutcome, installScript, JOURNAL_KEY, nvidiaDownloadUrl, nvidiaSigned, parseInstallResult } from './pcRules'

/** Un pilote NVIDIA pèse 700 à 900 Mo : il en faut le double de libre (le fichier, puis ce que l'installeur décompresse). */
const NEED_FREE = 2.5 * 1024 ** 3
const MAX_SIZE = 3 * 1024 ** 3
const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000
const VERIFY_TIMEOUT_MS = 60_000
/** L'installeur NVIDIA prend 2 à 5 min ; au-delà de 30 min, on arrête d'attendre (il peut continuer seul). */
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000

let state: DriverUpdateState = { status: 'idle' }
let abort: AbortController | null = null

function set(next: DriverUpdateState): void {
  state = next
  broadcast('pc:driver', state)
}

export function driverState(): DriverUpdateState {
  return state
}

export function driverJournal(): DriverJournalEntry[] {
  return cleanJournal(getKv<unknown>(JOURNAL_KEY, []))
}

function addJournal(e: DriverJournalEntry): void {
  setKv(JOURNAL_KEY, cleanJournal([e, ...driverJournal()]))
}

const folder = (): string => join(app.getPath('userData'), 'pilotes')

/** Lance un PowerShell ordinaire, le script par l'entrée standard (comme pc.ts et db.ts). Rend sa sortie, ou null. */
function ps(script: string, env: Record<string, string>, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (v: string | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(v)
    }
    let p: ReturnType<typeof spawn>
    try {
      p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'], { windowsHide: true, env: { ...process.env, ...env } })
    } catch {
      return resolve(null)
    }
    const timer = setTimeout(() => {
      p.kill()
      finish(null)
    }, timeoutMs)
    p.stdout?.setEncoding('utf8')
    p.stdout?.on('data', (c: string) => {
      if (out.length < 64 * 1024) out += c
    })
    p.on('error', () => finish(null))
    p.on('close', () => finish(out))
    p.stdin?.on('error', () => {})
    p.stdin?.end(script, 'utf8')
  })
}

/** La signature du fichier, lue par Windows (le chemin passe par une variable d'environnement, jamais dans le script). */
async function signedByNvidia(file: string): Promise<boolean> {
  const out = await ps(
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $s=Get-AuthenticodeSignature -LiteralPath $env:PX_FILE; $sub=''; if($s.SignerCertificate){ $sub=$s.SignerCertificate.Subject }; 'SIG' + [char]9 + [string]$s.Status + [char]9 + $sub",
    { PX_FILE: file },
    VERIFY_TIMEOUT_MS
  )
  const line = out?.split(/\r?\n/).find((l) => l.startsWith('SIG\t'))
  if (!line) return false
  const [, status = '', subject = ''] = line.split('\t')
  return nvidiaSigned(status, subject)
}

/** Télécharge dans un fichier « .part », renommé seulement une fois complet. Un fichier déjà complet resert. */
async function download(url: string, file: string, version: string, signal: AbortSignal): Promise<void> {
  try {
    if ((await stat(file)).size > 1024 * 1024) return
  } catch {
    /* pas encore là */
  }
  const part = file + '.part'
  const res = await net.fetch(url, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]) })
  // Après les redirections, le fichier doit toujours venir de NVIDIA
  if (!nvidiaDownloadUrl(res.url || url)) throw new UserError('Le téléchargement a été redirigé hors de NVIDIA : arrêté.')
  if (!res.ok || !res.body) throw new UserError(`NVIDIA n’a pas donné le fichier (erreur ${res.status}). Réessaie plus tard.`)
  const total = Number(res.headers.get('content-length')) || 0
  if (total > MAX_SIZE) throw new UserError('Le fichier annoncé par NVIDIA est anormalement gros : arrêté.')
  const out = createWriteStream(part)
  let got = 0
  let last = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.byteLength
      if (got > MAX_SIZE) throw new UserError('Le fichier dépasse la taille prévue : arrêté.')
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      const now = Date.now()
      if (now - last > 400) {
        last = now
        set({ status: 'download', version, pct: total ? Math.min(99, Math.floor((got / total) * 100)) : undefined, mb: Math.round(got / 1024 ** 2), totalMb: total ? Math.round(total / 1024 ** 2) : undefined })
      }
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
  } catch (e) {
    out.destroy()
    await rm(part, { force: true })
    throw e
  }
  if (total && got !== total) {
    await rm(part, { force: true })
    throw new UserError('Le téléchargement s’est coupé avant la fin. Réessaie.')
  }
  await rename(part, file)
}

/** Les anciens pilotes téléchargés partent : seul celui en cours reste. */
async function cleanFolder(keep: string | null): Promise<void> {
  try {
    for (const f of await readdir(folder())) if (join(folder(), f) !== keep) await rm(join(folder(), f), { force: true })
  } catch {
    /* dossier absent */
  }
}

/** Le processus administrateur : point de restauration puis installation. Rend « refusé » ou son fichier de résultat. */
async function elevatedInstall(exe: string, version: string, restorePoint: boolean): Promise<{ refused: boolean; result: ReturnType<typeof parseInstallResult>; error?: string }> {
  const resultFile = join(folder(), 'resultat.json')
  await rm(resultFile, { force: true })
  const out = await ps(ELEVATE_SCRIPT, { PX_ELEV: encodePs(installScript({ exe, resultFile, version, restorePoint })) }, INSTALL_TIMEOUT_MS)
  const line = out?.split(/\r?\n/).find((l) => l.startsWith('EXIT\t') || l.startsWith('REFUSED\t'))
  if (line?.startsWith('REFUSED\t')) return { refused: true, result: null, error: line.slice(8) }
  let text = ''
  try {
    text = await readFile(resultFile, 'utf8')
  } catch {
    /* pas de résultat : l'attente a dépassé 30 min, ou le processus a été arrêté */
  }
  return { refused: false, result: text ? parseInstallResult(text) : null }
}

const MESSAGES: Record<DriverJournalEntry['outcome'], string> = {
  ok: 'Pilote installé.',
  reboot: 'Pilote installé. Redémarre ton PC pour finir.',
  refused: 'Tu as refusé la demande de Windows : rien n’a été installé.',
  signature: 'Le fichier n’est pas signé par NVIDIA : il a été effacé, rien n’a été installé.',
  'restore-failed': 'Windows n’a pas pu créer de point de restauration : rien n’a été installé.',
  failed: 'L’installeur NVIDIA n’a pas fini correctement.',
  stopped: 'Mise à jour annulée : rien n’a été installé.'
}

function busyReason(): string | null {
  if (gameRunning()) return 'Un jeu tourne. Mets à jour le pilote après ta partie : l’écran peut s’éteindre pendant l’installation.'
  if (filmState().status === 'running') return 'Un film est en fabrication. Attends sa fin pour mettre à jour le pilote.'
  return null
}

/**
 * « Mettre à jour » : la page n'envoie qu'une option (se passer du point de restauration, après un échec de celui-ci). La carte,
 * la version et l'adresse viennent de la dernière lecture de Mon PC, faite ici.
 */
export async function updateDriver(opts: unknown): Promise<DriverUpdateState> {
  if (process.platform !== 'win32') throw new UserError('La mise à jour du pilote ne marche que sous Windows.')
  if (abort || !['idle', 'done', 'failed', 'stopped'].includes(state.status)) throw new UserError('Une mise à jour du pilote est déjà en cours.')
  const busy = busyReason()
  if (busy) throw new UserError(busy)
  const restorePoint = !(opts && typeof opts === 'object' && (opts as { skipRestore?: unknown }).skipRestore === true)
  const pc = await pcState(false)
  const gpu: PcGpu | undefined = pc.gpus.find((g) => g.vendor === 'nvidia' && g.latest?.status === 'update' && g.latest.downloadUrl)
  const url = gpu?.latest?.downloadUrl ? nvidiaDownloadUrl(gpu.latest.downloadUrl) : null
  if (!gpu?.latest || !url) throw new UserError('Pas de nouveau pilote NVIDIA à installer. Clique « Relire » pour vérifier de nouveau.')
  const version = gpu.latest.version
  const from = gpu.version

  try {
    const free = await statfs(app.getPath('userData'))
    if (free.bavail * free.bsize < NEED_FREE) throw new UserError('Pas assez de place sur le disque : il faut environ 2,5 Go de libre.')
  } catch (e) {
    if (e instanceof UserError) throw e
  }

  abort = new AbortController()
  const signal = abort.signal
  const journal = (outcome: DriverJournalEntry['outcome'], extra: Partial<DriverJournalEntry> = {}): void => addJournal({ at: Date.now(), from, to: version, outcome, ...extra })
  const fail = (outcome: DriverJournalEntry['outcome'], message = MESSAGES[outcome], extra: Partial<DriverUpdateState> = {}): DriverUpdateState => {
    set({ status: outcome === 'stopped' ? 'stopped' : 'failed', version, outcome, message, ...extra })
    return state
  }
  set({ status: 'download', version, pct: 0, mb: 0 })
  const file = join(folder(), installerName(url, version))
  try {
    await mkdir(folder(), { recursive: true })
    await cleanFolder(file)
    await download(url, file, version, signal)
    if (signal.aborted) throw new Error('stopped')

    set({ status: 'verify', version })
    if (!(await signedByNvidia(file))) {
      await rm(file, { force: true })
      journal('signature')
      return fail('signature')
    }
    if (signal.aborted) throw new Error('stopped')
    // Une partie a pu démarrer pendant le téléchargement
    const late = busyReason()
    if (late) return fail('stopped', `${late} Le fichier est gardé : relance quand tu veux, sans retélécharger.`)

    set({ status: 'consent', version })
    abort = null // plus d'annulation possible : la suite appartient à Windows et à l'installeur NVIDIA
    const r = await elevatedInstall(file, version, restorePoint)
    const outcome = installOutcome(r.refused, r.result)
    if (outcome === 'refused' || outcome === 'restore-failed' || outcome === 'signature') {
      journal(outcome, { restore: r.result?.restore })
      if (outcome === 'signature') await rm(file, { force: true })
      return fail(outcome, outcome === 'restore-failed' ? `${MESSAGES[outcome]} ${r.result?.error ? `(${r.result.error})` : ''} Tu peux installer sans point de restauration.`.replace(/\s+/g, ' ').trim() : MESSAGES[outcome], { canSkipRestore: outcome === 'restore-failed' })
    }

    set({ status: 'install', version })
    // La preuve : la version que Windows lit maintenant
    const after = (await pcState(true)).gpus.find((g) => g.vendor === 'nvidia')?.version ?? null
    const changed = after === version
    journal(outcome, { restore: r.result?.restore, after })
    if (outcome === 'failed' && !changed) return fail('failed', `${MESSAGES.failed}${r.result?.code !== undefined ? ` (code ${r.result.code})` : ''} Ton pilote reste en ${after ?? from ?? 'l’ancienne version'}.`)
    await rm(file, { force: true })
    const restoreTxt = r.result?.restore === 'ok' ? ' Point de restauration créé avant.' : r.result?.restore === 'recent' ? ' Windows avait déjà un point de restauration de moins de 24 h.' : ''
    const msg = changed
      ? `Pilote ${version} installé.${outcome === 'reboot' ? ' Redémarre ton PC pour finir.' : ''}${restoreTxt}`
      : `L’installeur NVIDIA a fini, mais Windows lit encore ${after ?? 'l’ancienne version'}. Redémarre ton PC, puis « Relire ».${restoreTxt}`
    set({ status: 'done', version, outcome, message: msg, reboot: outcome === 'reboot' || !changed })
    return state
  } catch (e) {
    if (signal.aborted) {
      journal('stopped')
      return fail('stopped')
    }
    const message = e instanceof UserError ? e.message : 'Le téléchargement a échoué. Vérifie ta connexion et réessaie.'
    journal('failed')
    return fail('failed', message)
  } finally {
    abort = null
  }
}

/** « Annuler » : seulement pendant le téléchargement et la vérification. Ensuite, c'est Windows et NVIDIA qui ont la main. */
export function stopDriverUpdate(): void {
  abort?.abort()
}

/** « Restauration du système » de Windows (rstrui.exe), pour revenir en arrière. Windows demande lui-même l'autorisation. */
export async function openSystemRestore(): Promise<void> {
  if (process.platform !== 'win32') return
  const err = await shell.openPath(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rstrui.exe'))
  if (err) throw new UserError('Windows n’a pas ouvert la restauration du système.')
}
