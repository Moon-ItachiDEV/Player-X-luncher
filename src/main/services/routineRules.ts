import type { Routine, RoutineStep, RoutineStepKind } from '@shared/routines'

// Règles des routines, sans Electron (testées par routineRules.test.ts).
// Sécurité : une appli ne s'ajoute que si son chemin sort du sélecteur de fichiers natif (ou d'une routine déjà enregistrée,
// donc choisie avant) ; un texte envoyé par la page ne suffit pas. Les liens steam:// et discord:// sont limités à des formes
// simples (pas d'arguments de lancement, pas de %).

export const MAX_ROUTINES = 30
export const MAX_STEPS = 24

const KINDS: RoutineStepKind[] = ['app', 'close', 'link', 'wait', 'minimize', 'game']
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Clé de comparaison d'un chemin Windows (insensible à la casse et au sens des barres). */
export const appKey = (p: string): string => p.replace(/\//g, '\\').toLowerCase()

/** Chemin absolu Windows (C:\… ou \\serveur\…), d'une appli que Player X sait ouvrir. */
export const isAppPath = (p: string): boolean => /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/])/i.test(p) && /\.(exe|lnk|bat|cmd)$/i.test(p) && !/["<>|?*\0]/.test(p)

/** Lien qu'une routine peut ouvrir : https, un salon ou une page Discord, une action Steam sans arguments de lancement. */
export function isRoutineLink(v: string): boolean {
  if (!/^(https:\/\/|discord:\/\/|steam:\/\/)[^\s"'<>\\%]+$/i.test(v)) return false
  if (/^steam:\/\//i.test(v)) return /^steam:\/\/[a-z]+(\/[^/]+)*\/?$/i.test(v)
  if (/^discord:\/\//i.test(v)) return /^discord:\/\/[\w.-]+(\/[\w.-]+)*\/?$/i.test(v)
  return true
}

export function cleanStep(v: unknown, approved: ReadonlySet<string>): RoutineStep | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const kind = o.kind as RoutineStepKind
  if (!KINDS.includes(kind)) return null
  const step: RoutineStep = { id: text(o.id, 40) || `s${Math.random().toString(36).slice(2, 9)}`, kind, on: o.on !== false, name: text(o.name, 80) || undefined }
  const value = text(o.value, 1024)
  if (kind === 'app') {
    if (!isAppPath(value) || !approved.has(appKey(value))) return null
    step.value = value
  } else if (kind === 'close') {
    if (!/^[\w .()-]{1,120}\.exe$/i.test(value)) return null
    step.value = value
    step.force = o.force === true
  } else if (kind === 'link') {
    if (!isRoutineLink(value)) return null
    step.value = value
  } else if (kind === 'wait') {
    const s = Math.round(Number(value))
    if (!Number.isFinite(s) || s < 1 || s > 120) return null
    step.value = String(s)
  }
  return step
}

export function cleanRoutine(v: unknown, approved: ReadonlySet<string>): Routine | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = text(o.name, 32)
  const gameId = text(o.gameId, 128)
  if (!name || !gameId) return null
  const steps = (Array.isArray(o.steps) ? o.steps : [])
    .map((s) => cleanStep(s, approved))
    .filter((s): s is RoutineStep => !!s)
    .slice(0, MAX_STEPS)
  // Toujours exactement une étape « lancer le jeu ».
  if (!steps.some((s) => s.kind === 'game')) steps.push({ id: 'game', kind: 'game', on: true })
  return { id: text(o.id, 40) || `r${Date.now().toString(36)}`, name, gameId, trigger: o.trigger === 'hotkey' ? 'hotkey' : 'launch', steps }
}

/** Les applis déjà présentes dans des routines enregistrées : choisies avec le sélecteur avant, elles restent valables. */
export function savedApps(list: readonly Routine[]): Set<string> {
  const out = new Set<string>()
  for (const r of list) for (const s of r.steps ?? []) if (s.kind === 'app' && typeof s.value === 'string') out.add(appKey(s.value))
  return out
}

/** Arguments de cmd.exe pour un .bat ou un .cmd : le chemin entre guillemets, lu tel quel (& et ^ ne sont pas interprétés). */
export function batArgs(path: string): string[] | null {
  if (/["%]/.test(path)) return null
  return ['/d', '/s', '/c', `""${path}""`]
}
