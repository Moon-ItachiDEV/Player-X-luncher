// Sans Electron : testé par crashLogRules.test.ts.

/**
 * La fin d'un journal devenu trop long : ses lignes entières les plus récentes, sur `keep` octets au plus. Avant, le journal
 * repartait de zéro : l'erreur qui avait tout déclenché partait avec le reste.
 */
export function keepRecent(log: Uint8Array, keep: number): Uint8Array {
  if (log.length <= keep) return log
  // Coupe juste après un retour à la ligne : jamais au milieu d'une ligne, ni au milieu d'un caractère accentué. La recherche
  // part de l'octet qui précède la place gardée : si c'est un retour à la ligne, la place commence pile sur une ligne.
  const cut = log.indexOf(10, log.length - keep - 1)
  return cut < 0 ? new Uint8Array(0) : log.subarray(cut + 1)
}

export interface RepeatVerdict {
  /** Faux : la même erreur vient d'être écrite, cette fois-ci est seulement comptée. */
  write: boolean
  /** Combien de fois elle est passée sous silence depuis la dernière ligne écrite. */
  skipped: number
}

/**
 * Une même erreur qui revient sans cesse (un relevé qui rate chaque minute, un envoi illisible plusieurs fois par seconde) ne
 * doit ni remplir le journal ni en chasser les autres. Elle est écrite la première fois, puis au plus une fois par `everyMs`,
 * avec le nombre de fois passées sous silence entre-temps.
 */
export function createRepeatFilter(everyMs: number, maxKeys = 200): (key: string, now: number) => RepeatVerdict {
  const seen = new Map<string, { at: number; skipped: number }>()
  return (key, now) => {
    const last = seen.get(key)
    if (last && now - last.at < everyMs && now >= last.at) {
      last.skipped++
      return { write: false, skipped: last.skipped }
    }
    const skipped = last?.skipped ?? 0
    // Remise en fin de liste : quand elle déborde, c'est l'erreur vue il y a le plus longtemps qui sort.
    seen.delete(key)
    seen.set(key, { at: now, skipped: 0 })
    if (seen.size > maxKeys) seen.delete(seen.keys().next().value as string)
    return { write: true, skipped }
  }
}

/** La première ligne d'une erreur, sans ce qui change d'une fois à l'autre : sert à reconnaître « la même erreur ». */
export function errorKey(where: string, text: string): string {
  return `${where}|${text.split('\n', 1)[0].slice(0, 300)}`
}
