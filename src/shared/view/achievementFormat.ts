import type { Achievement } from '../types'

const pctFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })

/** « 2,4 % » */
export const formatPercent = (p: number): string => `${pctFmt.format(p < 0.1 && p > 0 ? 0.1 : p)} %`

export const isUnlocked = (a: Achievement): boolean => a.unlockedAt !== undefined

/** Palier de rareté, comme Steam le suggère : moins de 5 % des joueurs, ou moins de 15 %. */
export function rarityOf(percent: number | undefined): { label: string; tier: 'ultra' | 'rare' } | null {
  if (percent === undefined) return null
  if (percent < 5) return { label: 'Ultra rare', tier: 'ultra' }
  if (percent < 15) return { label: 'Rare', tier: 'rare' }
  return null
}

/** Part des succès débloqués, arrondie vers le bas (100 % seulement quand tout est fait). */
export const completion = (unlocked: number, total: number): number => (total ? Math.floor((unlocked / total) * 100) : 0)
