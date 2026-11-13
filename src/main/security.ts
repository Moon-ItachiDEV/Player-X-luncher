import { app, Menu, session } from 'electron'

// Ce que les pages n'ont pas le droit de faire, posé une fois pour toutes les fenêtres : aucune permission au-delà du
// presse-papiers, aucune navigation hors de la page de Player X, aucune fenêtre ouverte par une page.

/** Électron accorde par défaut caméra, micro, position… à la page : seule l'écriture dans le presse-papiers sert à Player X (« Copier »). */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

/** Après le démarrage d'Electron : les permissions, et le menu réduit de la version installée. */
export function lockDown(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  // Version installée : plus de « Recharger » ni d'outils de développement, mais le zoom (Ctrl +, Ctrl -, Ctrl 0) et F11 restent.
  if (app.isPackaged)
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: 'Affichage', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }])
    )
}

/**
 * L'interface ne navigue jamais : aucune fenêtre ne doit quitter la page de Player X (lien, glisser-déposer, redirection).
 * Seul le rechargement de la page elle-même passe (bouton « Recharger » après une erreur).
 * À appeler dès le chargement de l'appli, avant qu'une fenêtre n'existe.
 */
export function lockNavigation(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (e) => {
      if (e.url !== contents.getURL()) e.preventDefault()
    })
    contents.on('will-redirect', (e) => e.preventDefault())
    contents.on('will-attach-webview', (e) => e.preventDefault())
    // Aucune fenêtre ne s'ouvre d'elle-même (overlay, capture, pastille) ; la fenêtre principale pose ensuite son propre filtre.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}
