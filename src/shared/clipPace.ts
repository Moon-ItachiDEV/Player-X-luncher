// Le rythme réel d'un clip (bêta 46) : combien d'images par seconde la capture a vraiment gardées. Module pur, partagé avec
// l'interface (window.Shared.clipPace), testé par clipPace.test.ts (npm run test:clips).
//
// Pourquoi se fier aux clips et pas au compteur du moteur : la capture ne reçoit que les images nouvelles. Jeu en pause,
// fenêtre réduite, écran de chargement, Alt+Tab : moins d'images arrivent sans que la capture soit en faute, et une alerte
// réglée sur ce compteur sonnerait à tort. Un clip, lui, couvre un moment de jeu (les secondes avant un kill, ou avant le
// raccourci) : son rythme dit ce que tu verras à la lecture.
//
// Une seule règle à l'écran : la moyenne du clip sous le seuil. Le passage le plus lent (`low`) ne sert qu'au journal : un
// arrêt d'une seconde peut venir du jeu lui-même, il ne doit pas faire sonner l'alerte.

export interface ClipPace {
  /** Images par seconde, en moyenne sur tout le clip. */
  fps: number
  /** Les deux secondes les plus lentes du clip, en images par seconde (pour le journal). */
  low: number
  /** La cadence demandée à la capture : 60, ou 30 en qualité légère. */
  wanted: number
}

/** Le rythme des clips d'une partie, calculé quand elle finit. */
export interface GamePace {
  /** Fin de la partie (ms). */
  at: number
  game: string
  /** Clips de la partie dont le rythme est connu. */
  clips: number
  /** Parmi eux, ceux qui sont sous le seuil. */
  slow: number
  /** Images par seconde sur l'ensemble de ces clips. */
  fps: number
  wanted: number
}

/** Durée des tranches où l'on cherche le passage le plus lent. */
export const PACE_WINDOW_S = 2

/** Sous ce rythme moyen, un clip est dit lent : 50 pour une capture à 60 images/s, 25 pour une capture à 30. */
export const slowUnder = (wanted: number): number => Math.round((wanted * 5) / 6)

const r1 = (x: number): number => Math.round(x * 10) / 10
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** 58,2 : la virgule du français, une décimale au plus. */
const fr = (x: number): string => String(r1(x)).replace('.', ',')

/**
 * Le rythme d'un clip d'après l'instant de chacune de ses images (secondes) et sa durée. Le passage le plus lent se cherche
 * par tranches entières de deux secondes depuis la première image : une tranche sans aucune image compte zéro.
 * null : trop court ou trop peu d'images pour dire un rythme.
 */
export function paceOf(timesS: readonly number[], durationS: number, wanted: number): ClipPace | null {
  if (!num(durationS) || durationS < 1 || !num(wanted) || wanted <= 0) return null
  const times = timesS.filter(num).sort((a, b) => a - b)
  if (times.length < 2) return null
  const fps = r1(times.length / durationS)
  const windows = Math.floor(durationS / PACE_WINDOW_S)
  if (windows < 1) return { fps, low: fps, wanted }
  const counts = new Array<number>(windows).fill(0)
  for (const t of times) {
    // + 1e-9 : une image pile sur la limite d'une tranche y entre, malgré l'arrondi des nombres à virgule.
    const k = Math.floor((t - times[0]) / PACE_WINDOW_S + 1e-9)
    if (k < windows) counts[k]++
  }
  // Une tranche ne peut pas être plus rapide que la moyenne et rester « la plus lente ».
  return { fps, low: Math.min(fps, r1(Math.min(...counts) / PACE_WINDOW_S)), wanted }
}

/** Un rythme relu dans la base : structure vérifiée. undefined s'il ne vaut rien. */
export function cleanPace(raw: unknown): ClipPace | undefined {
  const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!p || !num(p.fps) || !num(p.low) || !num(p.wanted) || p.fps < 0 || p.low < 0 || p.wanted <= 0 || p.fps > 1000) return undefined
  return { fps: p.fps, low: p.low, wanted: p.wanted }
}

/** Vrai si le clip a été filmé sous le seuil, en moyenne. */
export function isSlow(p: ClipPace | undefined | null): boolean {
  return !!p && p.fps < slowUnder(p.wanted)
}

/** La note d'un clip lent, à afficher telle quelle. null : rien à dire. Arrondi vers le bas : 49,6 se lit « 49 », sous le seuil de 50. */
export function paceNote(p: ClipPace | undefined | null): string | null {
  return p && isSlow(p) ? `Filmé à ${Math.floor(p.fps)} images/s` : null
}

/** Le rythme d'un clip, pour le journal : la moyenne et le passage le plus lent. */
export function paceLog(p: ClipPace | undefined | null): string {
  return p ? `${fr(p.fps)} images/s (2 s les plus lentes : ${fr(p.low)})` : 'rythme inconnu'
}

/**
 * Le rythme d'une partie d'après ses clips : images par seconde sur l'ensemble (chaque clip pèse selon sa durée) et nombre de
 * clips lents. Les clips sans rythme connu ne comptent pas.
 */
export function gamePace(clips: readonly { pace?: ClipPace; durationS: number }[], game: string, at: number): GamePace {
  const known = clips.filter((c): c is { pace: ClipPace; durationS: number } => !!c.pace && num(c.durationS) && c.durationS > 0)
  const seconds = known.reduce((n, c) => n + c.durationS, 0)
  const frames = known.reduce((n, c) => n + c.pace.fps * c.durationS, 0)
  // La cadence demandée la plus fréquente (un réglage changé en cours de partie reste l'exception).
  const byWanted = new Map<number, number>()
  for (const c of known) byWanted.set(c.pace.wanted, (byWanted.get(c.pace.wanted) ?? 0) + 1)
  const wanted = [...byWanted.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 60
  return { at, game, clips: known.length, slow: known.filter((c) => isSlow(c.pace)).length, fps: seconds > 0 ? r1(frames / seconds) : 0, wanted }
}

/** Le rythme d'une partie relu dans la base : structure vérifiée. undefined s'il ne vaut rien. */
export function cleanGamePace(raw: unknown): GamePace | undefined {
  const g = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!g || !num(g.at) || g.at <= 0 || typeof g.game !== 'string' || !num(g.clips) || !num(g.slow) || !num(g.fps) || !num(g.wanted)) return undefined
  if (g.clips < 0 || g.slow < 0 || g.slow > g.clips || g.fps < 0 || g.fps > 1000 || g.wanted <= 0) return undefined
  return { at: g.at, game: g.game.slice(0, 120), clips: Math.round(g.clips), slow: Math.round(g.slow), fps: g.fps, wanted: g.wanted }
}

const countOf = (g: GamePace): string => `${g.slow} clip${g.slow > 1 ? 's' : ''} sur ${g.clips} sous ${slowUnder(g.wanted)} images/s`

/** La ligne de Paramètres sur la dernière partie. null : aucun clip dont le rythme est connu. */
export function gamePaceLine(g: GamePace | undefined | null): string | null {
  if (!g || g.clips < 1) return null
  return g.slow ? `Dernière partie : ${countOf(g)}.` : `Dernière partie : ${Math.round(g.fps)} images/s dans tes clips.`
}

/** Le message de fin de partie. null : rien à signaler (aucun clip lent). */
export function gamePaceAlert(g: GamePace | undefined | null): string | null {
  return g && g.clips > 0 && g.slow ? `Partie finie : ${countOf(g)}.` : null
}

/**
 * Le rythme de la capture entre deux relevés du moteur (images en plus ÷ temps écoulé), pour le journal. null : pas de relevé
 * d'avant, relevés trop proches, ou compteur reparti de zéro (moteur relancé).
 */
export function rateBetween(prev: { frames: number; at: number } | null | undefined, cur: { frames: number; at: number }): number | null {
  if (!prev || !num(prev.frames) || !num(prev.at) || !num(cur.frames) || !num(cur.at)) return null
  const seconds = (cur.at - prev.at) / 1000
  const frames = cur.frames - prev.frames
  if (seconds < 1 || frames < 0) return null
  return r1(frames / seconds)
}
