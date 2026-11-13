import { BrowserWindow } from 'electron'
import { handle } from '../ipc'
import { engine, openEngineFolder, stopEngineTest, testEngine } from '../services/editFfmpeg'
import { filmState, planFilm, startFilm, stopFilm } from '../services/editFilm'
import { forgetMusic, musicList, pickMusic } from '../services/editMusic'
import { runCaptureTest } from '../services/captureTest'
import { sendTo } from '../windows'

// Canaux du montage (l'éditeur de films) : le moteur vidéo (son état, son essai sur ce PC, le dossier de sa licence) et la
// fabrication d'un film. La page ne choisit ni fichier ni commande : pour un film, elle envoie des identifiants (clips,
// musique) et un projet de montage, revu ici.

export function registerEditChannels(): void {
  handle('edit:engine', () => engine())
  // L'avancement de l'essai part vers la fenêtre qui l'a demandé.
  handle('edit:engine-test', (e) => {
    const from = BrowserWindow.fromWebContents(e.sender) ?? undefined
    return testEngine((step) => sendTo(from, 'edit:engine-step', step))
  })
  handle('edit:engine-stop', () => stopEngineTest())
  handle('edit:engine-folder', () => openEngineFolder())
  // Un film : lancé avec des identifiants de clips, suivi par « edit:film » (envoyé à toutes les fenêtres de l'appli).
  handle('edit:film-start', (_e, ids: unknown) => startFilm(ids))
  handle('edit:film-state', () => filmState())
  handle('edit:film-stop', () => stopFilm())
  // L'éditeur : les musiques (choisies dans une fenêtre de Windows, jamais par un chemin venu de la page) et le premier montage
  // d'une liste de clips. La page envoie ensuite son projet à « edit:film-start ».
  handle('edit:music-list', () => musicList())
  handle('edit:music-pick', () => pickMusic())
  handle('edit:music-forget', (_e, id: unknown) => forgetMusic(id))
  handle('edit:plan', (_e, ids: unknown, musicId: unknown) => planFilm(ids, musicId))
  // L'essai « capture comme OBS » (Paramètres › Enregistrement) : son avancement part vers la fenêtre qui l'a demandé.
  handle('edit:capture-test', (e) => {
    const from = BrowserWindow.fromWebContents(e.sender) ?? undefined
    return runCaptureTest((step) => sendTo(from, 'edit:capture-step', step))
  })
}
