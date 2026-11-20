// Sans Electron : testé par trust.test.ts.
import { resolve, win32 } from 'node:path'

function normFilePath(p: string): string {
  const slash = p.replace(/\\/g, '/')
  // Harmonise les chemins Windows (« C:/... » et « /C:/... » issu de URL.pathname) en minuscules.
  const win = /^\/?([A-Za-z]:\/.*)$/.exec(slash)
  return win ? win[1].toLowerCase() : slash
}

/**
 * Adresse d'une page de Player X : un fichier dans le dossier `renderer` de l'appli (`file:`), ou, en développement
 * seulement, le serveur Vite. La fenêtre principale charge toujours la V3 en `file:`, y compris en développement.
 */
export function trustedUrl(frameUrl: string, devServer?: string, appRoot?: string): boolean {
  let url: URL
  try {
    url = new URL(frameUrl)
  } catch {
    return false
  }
  if (url.protocol === 'file:') {
    // Refuse les chemins réseau UNC (file://serveur/partage/...) et les traversées de dossier.
    if (url.hostname) return false
    let decoded: string
    try {
      decoded = decodeURIComponent(url.pathname)
    } catch {
      return false
    }
    if (decoded.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/.test(decoded)) return false
    const filePath = normFilePath(decoded)
    if (appRoot) {
      const rootPath = /^[A-Za-z]:[\\/]/.test(appRoot) ? win32.normalize(appRoot) : resolve(appRoot)
      const root = normFilePath(rootPath).replace(/\/+$/, '')
      return filePath.startsWith(`${root}/`)
    }
    return /(^|\/)out\/renderer\/.+/.test(filePath)
  }
  if (!devServer) return false
  try {
    return url.origin === new URL(devServer).origin
  } catch {
    return false
  }
}
