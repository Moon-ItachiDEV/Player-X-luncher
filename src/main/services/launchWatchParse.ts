// Protocole du petit relevé des programmes pendant un lancement (launchWatch.ts) : le script PowerShell, la requête
// envoyée par Node et la lecture de sa réponse. Module pur, sans import : testé sous Node seul (npm run test:launch).

/**
 * Lancé une fois avec `powershell.exe -NoProfile -NonInteractive -NoLogo -Command`, puis piloté par l'entrée standard :
 * une ligne JSON par relevé, une ligne de réponse, arrêt à la fin de l'entrée (Player X fermé). Priorité basse. Ne lit que
 * le nom, l'identifiant et la fenêtre principale des programmes (jamais leur chemin ni leurs modules : rapide, et rien que
 * l'anti-triche puisse prendre pour une inspection).
 * Compatible PowerShell 5.1 (pas de ??, de ternaire ni de && entre commandes) ; sans guillemets doubles, qui ne passent pas
 * toujours intacts dans la ligne de commande de Windows.
 *
 * Réponse : `S`, puis tabulations : `pid:nom` par programme, `W:pid` (fenêtre principale, noms demandés seulement),
 * `R:appid` (jeu en cours d'après Steam), `U:appid:0|1` (mise à jour Steam), `C:ms:octets` (coût du script lui-même).
 */
export const SCRIPT = String.raw`$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8
$me=[Diagnostics.Process]::GetCurrentProcess(); $me.PriorityClass='BelowNormal'; $t=[char]9
while ($null -ne ($l=[Console]::In.ReadLine())) {
  $q = if ($l.Length -gt 2) { $l | ConvertFrom-Json } else { $null }
  $ps=[Diagnostics.Process]::GetProcesses(); $o=New-Object Text.StringBuilder; [void]$o.Append('S')
  foreach ($p in $ps) { [void]$o.Append($t).Append($p.Id).Append(':').Append($p.ProcessName) }
  if ($q -and $q.w) { foreach ($p in $ps) { if ($q.w -contains $p.ProcessName -and $p.MainWindowHandle -ne 0) { [void]$o.Append($t).Append('W:').Append($p.Id) } } }
  if ($q -and $q.s) {
    [void]$o.Append($t).Append('R:').Append([string](Get-ItemProperty 'HKCU:\Software\Valve\Steam').RunningAppID)
    foreach ($a in $q.s) { [void]$o.Append($t).Append('U:').Append($a).Append(':').Append([int](Get-ItemProperty ('HKCU:\Software\Valve\Steam\Apps\' + $a)).Updating) }
  }
  $me.Refresh(); [void]$o.Append($t).Append('C:').Append([int64]$me.TotalProcessorTime.TotalMilliseconds).Append(':').Append($me.WorkingSet64)
  [Console]::Out.WriteLine($o.ToString()); [Console]::Out.Flush()
}`

/** Noms d'exécutables envoyés par jeu. */
export const MAX_NAMES = 64
/** Un relevé de 20 programmes ou moins est tronqué (Windows en compte toujours bien plus) : il ne prouve rien. */
export const MIN_PROCS = 20

export interface Query {
  /** Noms d'exécutables d'un jeu (un ensemble par jeu suivi) : leur fenêtre principale est signalée. */
  w?: Iterable<string>[]
  /** Jeux Steam suivis (appid) : jeu en cours d'après Steam et mise à jour en cours. */
  s?: Iterable<string>
}

export interface Sample {
  procs: { pid: number; name: string }[]
  /** PID qui ont une fenêtre principale (parmi les noms demandés). */
  windows: Set<number>
  /** Jeu que Steam dit lancé (registre) ; null : aucun, ou pas demandé. */
  runningAppId: string | null
  /** appid → Steam indique une mise à jour. */
  updating: Map<string, boolean>
  /** Temps processeur cumulé du script (ms) et sa mémoire (octets) ; null si absents. */
  cpuMs: number | null
  ws: number | null
}

/** Ligne de requête : JSON en ASCII seul (PowerShell 5.1 lit l'entrée dans la page de code de la console ; les \uXXXX passent partout). */
export function tickLine({ w = [], s = [] }: Query): string {
  const names = new Set<string>()
  for (const list of w) {
    let kept = 0
    for (const raw of list) {
      if (kept >= MAX_NAMES) break
      const name = String(raw).replace(/[\u0000-\u001f\u007f]/g, '').toLowerCase()
      if (!name || names.has(name)) continue
      names.add(name)
      kept++
    }
  }
  const ids = [...new Set([...s].filter((a) => /^\d{1,10}$/.test(a)))]
  const q: { w?: string[]; s?: string[] } = {}
  if (names.size) q.w = [...names]
  if (ids.length) q.s = ids
  return JSON.stringify(q).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

/** Réponse du script ; null si ce n'en est pas une. */
export function parseSample(line: string): Sample | null {
  const parts = line.replace(/^﻿/, '').replace(/\r$/, '').split('\t')
  if (parts[0] !== 'S') return null
  const sample: Sample = { procs: [], windows: new Set(), runningAppId: null, updating: new Map(), cpuMs: null, ws: null }
  for (const part of parts.slice(1)) {
    let m: RegExpExecArray | null
    if ((m = /^(\d+):(.+)$/.exec(part))) sample.procs.push({ pid: Number(m[1]), name: m[2] })
    else if ((m = /^W:(\d+)$/.exec(part))) sample.windows.add(Number(m[1]))
    // Steam écrit 0 quand aucun jeu ne tourne.
    else if ((m = /^R:(\d*)$/.exec(part))) sample.runningAppId = m[1] && m[1] !== '0' ? m[1] : null
    else if ((m = /^U:(\d{1,10}):(\d+)$/.exec(part))) sample.updating.set(m[1], m[2] !== '0')
    else if ((m = /^C:(\d+):(\d+)$/.exec(part))) {
      sample.cpuMs = Number(m[1])
      sample.ws = Number(m[2])
    }
  }
  return sample
}

export function isValid(sample: Sample): boolean {
  return sample.procs.length > MIN_PROCS
}

/** PID qui portent un des noms (minuscules) et n'étaient pas dans le relevé d'avant le clic (`baseline` null : aucun relevé récent). */
export function newMatches(sample: Sample, names: Set<string>, baseline: Set<number> | null): number[] {
  return sample.procs.filter((p) => names.has(p.name.toLowerCase()) && !baseline?.has(p.pid)).map((p) => p.pid)
}

/** 95e centile (rang le plus proche) ; 0 sans valeur. */
export function p95(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
}
