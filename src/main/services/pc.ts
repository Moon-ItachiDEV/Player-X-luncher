// Mon PC (Paramètres › Mon PC), en lecture seule : la carte graphique et la version de son pilote (WMI), les écrans et leur
// fréquence (Electron + Windows), et, pour NVIDIA, la dernière version du pilote. Rien n'est installé, rien n'est changé :
// l'écran donne la page officielle de chaque marque.
// Rien ne tourne au démarrage de l'appli : la lecture se fait à l'ouverture de la rubrique, puis reste en mémoire 6 h.
// Les règles (versions, liste NVIDIA, écrans) sont dans pcRules.ts, testées sans Windows.

import { spawn, type ChildProcess } from 'node:child_process'
import { net, screen, shell } from 'electron'
import type { PcGpu, PcState } from '../../shared/types/pc'
import { getKv } from '../db'
import { cleanJournal, JOURNAL_KEY, nvidiaLatest, pcBadge, nvidiaLookupUrl, nvidiaPfid, parseDisplayLines, parseNvidiaLookup, readDisplays, readGpus, type RawGpu, type RawRadeon } from './pcRules'

const KEEP_MS = 6 * 60 * 60 * 1000
const PS_TIMEOUT_MS = 25_000
const NVIDIA_TIMEOUT_MS = 10_000
const MAX_OUT = 256 * 1024

// Les cartes (WMI), la version Adrenalin d'AMD (registre du pilote, lu sans droits d'administrateur), le boîtier (portable ou
// non), puis les écrans par EnumDisplaySettings : le mode actuel et la fréquence la plus haute à la même taille d'image.
// Sortie en UTF-8, une ligne JSON « J » pour les cartes, une ligne « D » par écran. Aucune écriture, aucun droit demandé.
const PS_SCRIPT = String.raw`
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='SilentlyContinue'
$g=@(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name=$_.Name; ver=$_.DriverVersion; date=$(if($_.DriverDate){$_.DriverDate.ToString('yyyy-MM-dd')}else{$null}); pnp=$_.PNPDeviceID; maker=$_.AdapterCompatibility } })
$r=@(Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' | ForEach-Object { $p=Get-ItemProperty $_.PSPath; if($p.RadeonSoftwareVersion -and $p.MatchingDeviceId){ [pscustomobject]@{ match=[string]$p.MatchingDeviceId; radeon=[string]$p.RadeonSoftwareVersion } } })
$c=@((Get-CimInstance Win32_SystemEnclosure).ChassisTypes)
$lap=[bool]($c | Where-Object { $_ -in 8,9,10,11,12,14,18,21,31,32 })
'J' + [char]9 + (ConvertTo-Json -Compress -Depth 3 @{ gpus=$g; radeon=$r; laptop=$lap })
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PxDisplays {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DEVMODE { [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName; public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra; public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput; public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName; public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight; public int dmDisplayFlags; public int dmDisplayFrequency; public int dmICMMethod; public int dmICMIntent; public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2; public int dmPanningWidth; public int dmPanningHeight; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevices(string dev, uint n, ref DISPLAY_DEVICE d, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE m);
  public static string Read() {
    var sb = new System.Text.StringBuilder();
    var d = new DISPLAY_DEVICE(); d.cb = Marshal.SizeOf(d);
    for (uint i = 0; EnumDisplayDevices(null, i, ref d, 0); i++, d.cb = Marshal.SizeOf(d)) {
      if ((d.StateFlags & 1) == 0) continue;
      var cur = new DEVMODE(); cur.dmSize = (short)Marshal.SizeOf(cur);
      if (!EnumDisplaySettings(d.DeviceName, -1, ref cur)) continue;
      int max = cur.dmDisplayFrequency;
      var m = new DEVMODE(); m.dmSize = (short)Marshal.SizeOf(m);
      for (int k = 0; EnumDisplaySettings(d.DeviceName, k, ref m) && k < 5000; k++) {
        if (m.dmPelsWidth == cur.dmPelsWidth && m.dmPelsHeight == cur.dmPelsHeight && m.dmDisplayFrequency > max) max = m.dmDisplayFrequency;
      }
      sb.Append("D\t" + cur.dmPositionX + "\t" + cur.dmPositionY + "\t" + cur.dmPelsWidth + "\t" + cur.dmPelsHeight + "\t" + cur.dmDisplayFrequency + "\t" + max + "\t" + (((d.StateFlags & 4) != 0) ? "1" : "0") + "\n");
    }
    return sb.ToString();
  }
}
'@
[PxDisplays]::Read()
`

interface WinRead {
  gpus: RawGpu[]
  radeon: RawRadeon[]
  laptop: boolean
  displays: ReturnType<typeof parseDisplayLines>
}

/** Lit Windows en un seul powershell.exe. null : PowerShell bloqué, trop long, ou sortie illisible. */
function readWindows(): Promise<WinRead | null> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      // Une erreur sur les écrans (Add-Type refusé) n'efface pas les cartes déjà écrites : on prend ce qui est sorti
      const line = out.split(/\r?\n/).find((l) => l.startsWith('J\t'))
      if (!line) return resolve(null)
      try {
        const j = JSON.parse(line.slice(2)) as { gpus?: unknown; radeon?: unknown; laptop?: unknown }
        const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === 'object' ? [v as T] : [])
        resolve({ gpus: arr<RawGpu>(j.gpus), radeon: arr<RawRadeon>(j.radeon), laptop: j.laptop === true, displays: parseDisplayLines(out) })
      } catch {
        resolve(null)
      }
    }
    let p: ChildProcess
    try {
      // Le script passe par l'entrée standard (comme le déchiffrement de db.ts) : plusieurs lignes et des guillemets, rien n'est
      // réinterprété par la ligne de commande. Une ligne fixe le lit et l'exécute.
      p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'], { windowsHide: true })
    } catch {
      return resolve(null)
    }
    const timer = setTimeout(() => {
      p.kill()
      finish()
    }, PS_TIMEOUT_MS)
    p.stdout?.setEncoding('utf8')
    p.stdout?.on('data', (c: string) => {
      if (out.length < MAX_OUT) out += c
    })
    p.on('error', finish)
    p.on('close', finish)
    p.stdin?.on('error', () => {})
    p.stdin?.end(PS_SCRIPT, 'utf8')
  })
}

/** Les écrans tels qu'Electron les voit : le nom, la fréquence utilisée, le coin en haut à gauche en pixels réels. */
function electronDisplays(): Parameters<typeof readDisplays>[0] {
  try {
    const primary = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d) => ({
      label: d.label,
      hz: d.displayFrequency,
      x: d.nativeOrigin?.x ?? Math.round(d.bounds.x * d.scaleFactor),
      y: d.nativeOrigin?.y ?? Math.round(d.bounds.y * d.scaleFactor),
      w: Math.round(d.size.width * d.scaleFactor),
      h: Math.round(d.size.height * d.scaleFactor),
      primary: d.id === primary
    }))
  } catch {
    return []
  }
}

/** Demande à NVIDIA la dernière version pour cette carte. Adresse non officielle : une panne laisse le lien vers nvidia.com. */
async function addNvidiaLatest(g: PcGpu, laptop: boolean): Promise<PcGpu> {
  const id = nvidiaPfid(g.name, laptop)
  if (!id) return { ...g, lookupError: 'Carte pas trouvée dans la liste de NVIDIA : vérifie sur leur page.' }
  try {
    const res = await net.fetch(nvidiaLookupUrl(id.pfid), { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(NVIDIA_TIMEOUT_MS) })
    if (!res.ok) throw new Error(String(res.status))
    const found = parseNvidiaLookup(await res.json())
    if (!found) return { ...g, lookupError: 'NVIDIA a répondu sans version lisible : vérifie sur leur page.' }
    return { ...g, latest: nvidiaLatest(g.version, found, id.bySeries) }
  } catch {
    return { ...g, lookupError: 'NVIDIA n’a pas répondu : vérifie sur leur page.' }
  }
}

let cache: { at: number; state: PcState } | null = null
let reading: Promise<PcState> | null = null

async function readAll(): Promise<PcState> {
  const at = Date.now()
  if (process.platform !== 'win32') {
    const displays = readDisplays(electronDisplays(), [])
    return { at, gpus: [], displays, laptop: false, badge: '', unsupported: true }
  }
  const win = await readWindows()
  const displays = readDisplays(electronDisplays(), win?.displays ?? [])
  if (!win) return { at, gpus: [], displays, laptop: false, badge: pcBadge([], displays), error: 'Windows n’a pas répondu à la lecture de la carte graphique.' }
  const gpus = await Promise.all(readGpus(win.gpus, win.radeon, win.laptop).map((g) => (g.vendor === 'nvidia' ? addNvidiaLatest(g, win.laptop) : g)))
  return { at, gpus, displays, laptop: win.laptop, badge: pcBadge(gpus, displays) }
}

/** L'état, avec le journal des pilotes lu à chaque fois (une mise à jour a pu l'allonger entre-temps). */
export async function pcState(refresh: unknown): Promise<PcState> {
  const st = await readState(refresh)
  return { ...st, journal: cleanJournal(getKv<unknown>(JOURNAL_KEY, [])) }
}

function readState(refresh: unknown): Promise<PcState> {
  if (reading) return reading
  if (refresh !== true && cache && Date.now() - cache.at < KEEP_MS) {
    // Les écrans changent sans prévenir (fréquence réglée entre-temps) : la fréquence actuelle se relit à chaque fois
    const displays = readDisplays(electronDisplays(), cache.state.displays.map((d) => ({ x: NaN, y: NaN, w: d.width, h: d.height, hz: d.hz, maxHz: d.maxHz ?? 0, primary: d.primary })))
    return Promise.resolve({ ...cache.state, displays, badge: pcBadge(cache.state.gpus, displays) })
  }
  reading = readAll()
    .then((state) => {
      cache = { at: state.at, state }
      return state
    })
    .finally(() => {
      reading = null
    })
  return reading
}

/** Paramètres Windows › Affichage › Affichage avancé : adresse fixe, rien ne vient de la page. */
export async function openDisplaySettings(): Promise<void> {
  if (process.platform === 'win32') await shell.openExternal('ms-settings:display-advanced')
}
