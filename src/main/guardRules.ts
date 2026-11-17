// Règles de la garde (sans Electron, testées par guardRules.test.ts) : quand recharger la page, quand parler à la
// personne, et les textes des boîtes.

/** Une page qui replante moins de 60 s après son rechargement n'est plus rechargée toute seule. */
export const CRASH_WINDOW_MS = 60_000

export function crashAction(now: number, lastReloadAt: number | null): 'reload' | 'ask' {
  return lastReloadAt !== null && now - lastReloadAt < CRASH_WINDOW_MS ? 'ask' : 'reload'
}

/** Une boîte ne sort que si la personne regarde Player X : jamais en pleine partie, jamais devant une autre appli. */
export function tellUnexpected(f: { told: boolean; ready: boolean; focused: boolean }): boolean {
  return f.ready && !f.told && f.focused
}

export type BoxId = 'erreur' | 'page' | 'demarrage' | 'base-secours' | 'base-zero' | 'base-partiel'
export interface Box {
  id: BoxId
  type: 'error' | 'warning'
  message: string
  detail: string
  buttons: string[]
}

export function boxOf(id: BoxId, f: { dataDir: string; reason?: string; kept?: number }): Box {
  const log = `erreurs.log, dans ${f.dataDir}`
  const n = f.kept ?? 0
  // La phrase « gardé » suit le nombre de fichiers mis de côté.
  const kept = n === 1 ? `\n\nL’ancien fichier est gardé dans ${f.dataDir}.` : n > 1 ? `\n\nLes anciens fichiers sont gardés dans ${f.dataDir}.` : ''
  switch (id) {
    case 'erreur':
      return {
        id,
        type: 'error',
        message: 'Player X a rencontré une erreur imprévue.',
        detail: `Elle est notée dans ${log}.\n\nSi quelque chose ne marche plus, ferme Player X et rouvre-le.`,
        buttons: ['OK']
      }
    case 'page':
      return {
        id,
        type: 'error',
        message: 'La page de Player X s’est arrêtée deux fois de suite.',
        detail: `Le détail est dans ${log}.`,
        buttons: ['Recharger', 'Quitter Player X']
      }
    case 'demarrage':
      return {
        id,
        type: 'error',
        message: 'Player X n’a pas pu démarrer',
        detail: [f.reason ?? '', `Le détail est dans ${log}.`, 'Si ça recommence à chaque démarrage, tu peux réinstaller une version depuis la page des versions.'].filter(Boolean).join('\n\n'),
        buttons: ['Fermer', 'Ouvrir la page des versions']
      }
    case 'base-secours':
      return {
        id,
        type: 'warning',
        message: 'Player X n’a pas pu lire sa base.',
        detail: `Il a repris sa copie de secours. Tes tout derniers changements peuvent manquer.${kept}`,
        buttons: ['OK', 'Ouvrir le dossier']
      }
    case 'base-zero':
      return {
        id,
        type: 'warning',
        message: 'Player X n’a pas pu lire sa base.',
        detail: `Sa copie de secours non plus. Player X est reparti de zéro : il faut relancer la recherche de tes jeux et refaire tes réglages. Tes fichiers vidéo ne sont pas touchés.${kept}`,
        buttons: ['OK', 'Ouvrir le dossier']
      }
    case 'base-partiel':
      return {
        id,
        type: 'warning',
        message: 'Player X n’a pas pu lire toute sa base.',
        detail: `Il a repris ce qui était encore lisible. Des jeux, des réglages ou des temps de jeu peuvent manquer.${kept}`,
        buttons: ['OK', 'Ouvrir le dossier']
      }
  }
}
