// Raccourcis globaux de l'overlay (format « accélérateur » d'Electron : « Alt+X », « Ctrl+Maj+F7 » s'écrit « Ctrl+Shift+F7 »).
// Choisis par le joueur dans Paramètres › Overlay. Règles :
// - jamais une touche seule utilisée en jeu : il faut Ctrl ou Alt, sauf pour les touches F (F1 à F24) ;
// - Ctrl+Alt seulement avec une touche F : sur un clavier AZERTY, AltGr = Ctrl+Alt (AltGr+E écrit €, AltGr+0 écrit @) ;
// - pas de raccourci de Windows ou de Steam (Alt+F4, F12 = capture Steam).

export const DEFAULT_OVERLAY_HOTKEY = 'Alt+X'

const MODS = ['Ctrl', 'Alt', 'Shift'] as const
type Mod = (typeof MODS)[number]

const NAMED = ['Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'] as const

/** Touches acceptées après les modificateurs : lettres, chiffres, pavé numérique, F1–F24 et quelques touches de navigation. */
function isKey(k: string): boolean {
  return /^[A-Z]$/.test(k) || /^[0-9]$/.test(k) || /^num[0-9]$/.test(k) || isFKey(k) || (NAMED as readonly string[]).includes(k)
}

function isFKey(k: string): boolean {
  const m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(k)
  return !!m
}

/** Raccourcis réservés par Windows, Steam ou CS2. */
const RESERVED = new Set(['Alt+F4', 'F12', 'Shift+F12', 'Ctrl+Shift+Delete', 'Ctrl+Alt+Delete'])

interface Parsed {
  mods: Mod[]
  key: string
}

function parse(accel: string): Parsed | null {
  const parts = accel.split('+')
  if (parts.length < 1 || parts.length > 4) return null
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  if (!mods.every((m): m is Mod => (MODS as readonly string[]).includes(m))) return null
  if (new Set(mods).size !== mods.length) return null
  if (!isKey(key)) return null
  // Ordre fixe : Ctrl, Alt, Shift.
  const ordered = MODS.filter((m) => mods.includes(m))
  if (ordered.join('+') !== mods.join('+')) return null
  return { mods: ordered, key }
}

/** Pourquoi ce raccourci ne va pas, ou null s'il est accepté. */
export function hotkeyProblem(accel: string): string | null {
  const p = parse(accel)
  if (!p) return "Ce raccourci n'est pas reconnu."
  const ctrl = p.mods.includes('Ctrl')
  const alt = p.mods.includes('Alt')
  if (!isFKey(p.key) && !ctrl && !alt) return 'Ajoute Ctrl ou Alt (ou prends une touche F) : une touche seule servirait aussi au jeu.'
  if (ctrl && alt && !isFKey(p.key)) return 'Ctrl + Alt est la touche AltGr des claviers AZERTY : garde-le pour les touches F.'
  if (RESERVED.has(accel)) return 'Ce raccourci est déjà utilisé par Windows ou Steam.'
  return null
}

export function isValidHotkey(accel: unknown): accel is string {
  return typeof accel === 'string' && accel.length <= 32 && hotkeyProblem(accel) === null
}

/** Touches à afficher, en français (« Maj » pour Shift, « Pavé 1 » pour num1). */
export function hotkeyLabel(accel: string): string[] {
  const p = parse(accel)
  if (!p) return [accel]
  const key = /^num[0-9]$/.test(p.key)
    ? `Pavé ${p.key.slice(3)}`
    : ({ Insert: 'Inser', Delete: 'Suppr', Home: 'Début', End: 'Fin', PageUp: 'Page préc.', PageDown: 'Page suiv.' } as Record<string, string>)[p.key] ?? p.key
  return [...p.mods.map((m) => (m === 'Shift' ? 'Maj' : m)), key]
}

/** Le raccourci en une ligne : « Alt + X ». */
export function hotkeyText(accel: string): string {
  return hotkeyLabel(accel).join(' + ')
}

export interface KeyPress {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * Une touche pressée → l'accélérateur, null tant qu'on n'a appuyé que sur des modificateurs, ou une erreur.
 * Les lettres suivent le clavier (AZERTY : la touche marquée A donne A), les chiffres la rangée du haut quel que soit
 * le clavier (sur AZERTY elle écrit & é " sans Maj).
 */
export function hotkeyFromPress(e: KeyPress): { accel: string } | { problem: string } | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return null
  if (e.metaKey) return { problem: 'La touche Windows est réservée à Windows.' }
  let key: string | null = null
  if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase()
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (/^Numpad[0-9]$/.test(e.code)) key = `num${e.code.slice(6)}`
  else if (isFKey(e.code)) key = e.code
  else if ((NAMED as readonly string[]).includes(e.code)) key = e.code
  if (!key) return { problem: 'Cette touche ne peut pas servir de raccourci : prends une lettre, un chiffre ou une touche F.' }
  const mods: Mod[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const accel = [...mods, key].join('+')
  const problem = hotkeyProblem(accel)
  return problem ? { problem } : { accel }
}
