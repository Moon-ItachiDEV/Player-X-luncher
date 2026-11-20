import { globalShortcut } from 'electron'
import { hotkeyProblem } from '@shared/hotkey'

/**
 * Un raccourci global est-il valable et libre ? null si oui, sinon la raison à afficher.
 * `mine` : celui que l'appelant tient déjà (rien à vérifier) ; `reserved` : ceux d'une autre fonction de Player X.
 */
export function hotkeyRefusal(accel: unknown, mine: string | null, reserved: (string | null | undefined)[] = []): string | null {
  if (typeof accel !== 'string') return 'Ce raccourci n’est pas reconnu.'
  const problem = hotkeyProblem(accel)
  if (problem) return problem
  const norm = (a: string | null | undefined): string | null => (typeof a === 'string' ? a.replace(/\bControl\+/g, 'Ctrl+') : null)
  if (accel === norm(mine)) return null
  if (reserved.some((r) => norm(r) === accel) || globalShortcut.isRegistered(accel)) return 'Player X utilise déjà ce raccourci.'
  try {
    // Un essai : Windows refuse si une autre appli l'a déjà pris.
    if (!globalShortcut.register(accel, () => {})) return 'Déjà pris par Windows ou une autre appli : choisis-en un autre.'
    globalShortcut.unregister(accel)
    return null
  } catch {
    return 'Ce raccourci n’est pas reconnu.'
  }
}
