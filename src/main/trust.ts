// Sans Electron : testé par trust.test.ts.

/**
 * Adresse d'une page de Player X : un fichier de l'appli (`file:`), ou, en développement seulement, le serveur Vite.
 * La fenêtre principale charge toujours la V3 en `file:`, y compris en développement.
 */
export function trustedUrl(frameUrl: string, devServer?: string): boolean {
  let url: URL
  try {
    url = new URL(frameUrl)
  } catch {
    return false
  }
  if (url.protocol === 'file:') return true
  if (!devServer) return false
  try {
    return url.origin === new URL(devServer).origin
  } catch {
    return false
  }
}
