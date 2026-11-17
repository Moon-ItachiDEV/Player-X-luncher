import { app, dialog, powerMonitor, shell, type BrowserWindow, type WebContents } from 'electron'
import { logError } from './crashLog'
import { rescueReport } from './db'
import { boxOf, crashAction, tellUnexpected, type Box, type BoxId } from './guardRules'
import { RELEASES_BASE } from './services/updaterRules'
import { focusedAppWindow, mainWindow } from './windows'

// La garde : ce qui se passe quand quelque chose tourne mal pendant que Player X est ouvert (erreur imprévue, page qui plante,
// base reprise de la copie de secours, démarrage raté). Les règles et les textes sont dans guardRules.ts.

type Trace = { boxes: BoxId[] }
/** Essais seulement (version non installée) : PX_GARDE_MUET=1 n'affiche aucune boîte native, la réponse est le bouton 0. */
const muet = (): boolean => !app.isPackaged && process.env.PX_GARDE_MUET === '1'
const dataDir = (): string => app.getPath('userData')

/** Essais seulement : la liste des boîtes montrées (ou qui l'auraient été), lue par tools/essais/garde.cjs. */
function note(id: BoxId): void {
  if (app.isPackaged) return
  const g = globalThis as { __pxGarde?: Trace }
  ;(g.__pxGarde ??= { boxes: [] }).boxes.push(id)
}

const optionsOf = (box: Box): Electron.MessageBoxOptions => ({
  type: box.type,
  title: 'Player X',
  message: box.message,
  detail: box.detail,
  buttons: box.buttons,
  noLink: true,
  defaultId: 0,
  cancelId: 0
})

/** Montre une boîte sans bloquer ; `answer` reçoit le bouton choisi. Ne lève jamais. */
function show(box: Box, parent: BrowserWindow | undefined, answer: (button: number) => void = () => {}): void {
  note(box.id)
  // Si la boîte ne peut pas s'afficher, c'est comme si on avait répondu avec le bouton 0 (la question « page » ne reste pas ouverte).
  const reply = (button: number): void => {
    try {
      answer(button)
    } catch (e) {
      console.error('[garde]', e)
    }
  }
  try {
    if (muet()) {
      Promise.resolve().then(() => reply(0))
      return
    }
    const opts = optionsOf(box)
    const p = parent && !parent.isDestroyed() ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)
    p.then((r) => r.response, () => 0).then(reply)
  } catch (e) {
    console.error('[garde]', e)
    reply(0)
  }
}

let installed = false
let told = false
let quitting = false
let lastReloadAt: number | null = null
let pageBoxOpen = false
let dbTold = false

function reloadPage(contents: WebContents): void {
  try {
    lastReloadAt = Date.now()
    if (!contents.isDestroyed()) contents.reload()
  } catch (e) {
    logError('page', e)
  }
}

/**
 * Page de la fenêtre principale arrêtée : le premier rechargement est immédiat et sans boîte ; si elle replante dans la
 * minute, on demande à la personne, mais seulement quand une fenêtre de Player X est au premier plan (jamais en pleine partie).
 */
function onPageGone(contents: WebContents, details: Electron.RenderProcessGoneDetails): void {
  if (quitting || details.reason === 'clean-exit') return
  if (mainWindow()?.webContents !== contents) return
  const what = `la page de la fenêtre principale s’est arrêtée (raison : ${details.reason}, code : ${details.exitCode})`
  // Deux lignes différentes : le journal n'écrit qu'une fois toutes les dix minutes une même erreur (voir crashLog.ts).
  if (crashAction(Date.now(), lastReloadAt) === 'reload') {
    logError('page', `${what} : rechargée`)
    reloadPage(contents)
    return
  }
  logError('page', `${what} : encore arrêtée moins d’une minute après son rechargement, pas de nouveau rechargement sans demander`)
  if (pageBoxOpen) return
  pageBoxOpen = true
  const ask = (parent: BrowserWindow): void =>
    show(boxOf('page', { dataDir: dataDir() }), parent, (button) => {
      pageBoxOpen = false
      if (button === 1) app.quit()
      else reloadPage(contents)
    })
  const now = focusedAppWindow()
  if (now) return ask(now)
  // Personne ne regarde Player X : la question attend (une seule à la fois, pageBoxOpen reste vrai).
  const timer = setInterval(() => {
    try {
      if (quitting) {
        clearInterval(timer)
        pageBoxOpen = false
        return
      }
      const w = focusedAppWindow()
      if (!w) return
      clearInterval(timer)
      ask(w)
    } catch (e) {
      console.error('[garde]', e)
    }
  }, 1000)
  timer.unref()
}

/**
 * Le message de la base : seulement quand la personne regarde Player X, page chargée (jamais en pleine partie). Tant qu'il
 * n'y a pas de fenêtre principale, initDb n'a peut-être pas fini ; une fois la fenêtre là, le rapport est définitif.
 */
function watchDbReport(): void {
  const timer = setInterval(() => {
    try {
      if (quitting || !mainWindow()) {
        if (quitting) clearInterval(timer)
        return
      }
      const r = rescueReport()
      if (!r || dbTold) return void clearInterval(timer)
      const w = focusedAppWindow()
      if (!w || w.webContents.isLoading()) return
      clearInterval(timer)
      dbTold = true
      const id = r.notice === 'secours' ? 'base-secours' : r.notice === 'partiel' ? 'base-partiel' : 'base-zero'
      show(boxOf(id, { dataDir: dataDir(), kept: r.kept }), w, (button) => {
        if (button === 1) shell.openPath(dataDir()).catch(() => {})
      })
    } catch (e) {
      console.error('[garde]', e)
    }
  }, 1000)
  timer.unref()
}

/** À appeler une fois au démarrage ; un deuxième appel ne fait rien. */
export function installGuards(): void {
  if (installed) return
  installed = true
  if (!app.isPackaged) (globalThis as { __pxGarde?: Trace }).__pxGarde ??= { boxes: [] }
  // Ajouter un écouteur suffit à faire taire la boîte d'Electron (en anglais, bloquante) : l'erreur va au journal.
  process.on('uncaughtException', (e) => {
    try {
      logError('erreur imprévue', e)
      const parent = focusedAppWindow()
      if (tellUnexpected({ told, ready: app.isReady() && !quitting, focused: parent !== undefined })) {
        told = true
        show(boxOf('erreur', { dataDir: dataDir() }), parent)
      }
    } catch {
      /* l'écouteur ne doit jamais lever */
    }
  })
  app.on('before-quit', () => {
    quitting = true
  })
  // Windows se ferme : Player X se ferme aussi (session-end de chaque fenêtre ; le powerMonitor est branché après whenReady).
  app.on('browser-window-created', (_e, w) => {
    w.on('session-end', () => {
      quitting = true
    })
  })
  app.on('render-process-gone', (_e, contents, details) => {
    try {
      onPageGone(contents, details)
    } catch (e) {
      console.error('[garde]', e)
    }
  })
  app
    .whenReady()
    .then(() => {
      powerMonitor.on('shutdown', () => {
        quitting = true
      })
      watchDbReport()
    })
    .catch(() => {})
}

/** Démarrage raté : journal, boîte qui bloque (avec la page des versions comme sortie de secours), puis on quitte. */
export function startupFailed(e: unknown): void {
  logError('démarrage', e)
  try {
    const box = boxOf('demarrage', { dataDir: dataDir(), reason: e instanceof Error ? e.message : String(e) })
    note('demarrage')
    if (muet()) {
      app.exit(1)
      return
    }
    if (!app.isReady()) {
      dialog.showErrorBox('Player X', `${box.message}\n\n${box.detail}`)
      app.exit(1)
      return
    }
    if (dialog.showMessageBoxSync(optionsOf(box)) === 1) {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        app.exit(1)
      }
      shell.openExternal(RELEASES_BASE).then(finish, finish)
      setTimeout(finish, 3000)
      return
    }
  } catch (err) {
    console.error('[garde]', err)
  }
  app.exit(1)
}
