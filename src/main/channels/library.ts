import { stat } from 'node:fs/promises'
import { shell } from 'electron'
import type { SteamLibrary } from '@shared/types'
import * as db from '../db'
import { handle } from '../ipc'
import { getGameAchievements } from '../services/achievements'
import { demoAchievements } from '../services/achievementsDemo'
import { applyArtwork } from '../services/artwork'
import { DEMO_GAMES, demoNotInstalled } from '../services/demo'
import { getGameEvents, setEventReminder } from '../services/events'
import { getScanReport } from '../services/games'
import { sanitizeOpts } from '../services/launches'
import { getGameNews, markNewsSeen, withNews } from '../services/news'
import { getSettings } from '../services/settings'
import { getCs2Servers, getSteamPlayers } from '../services/servers'
import { createCollection, deleteCollection, getShelves, renameCollection, setGameHidden, setInCollection } from '../services/shelves'
import { installSteamGame, steamLibrary } from '../services/steamLibrary'
import { steamUpdates } from '../services/steamUpdates'
import type { ChannelDeps } from './deps'

// Canaux de la bibliothèque : jeux, lancements, actus, Steam, succès, événements, rangement, serveurs.

export function registerLibraryChannels(d: ChannelDeps): void {
  handle('games:list', (_e, refresh?: unknown) => d.games(refresh === true))
  // Ne rejette jamais pour un échec de lancement : la phase le dit (failed, already…), en français.
  handle('games:launch', (_e, id: unknown, opts: unknown) => d.launches().start(typeof id === 'string' ? id : '', sanitizeOpts(opts)))
  handle('launch:cancel', (_e, launchId: unknown) => {
    if (typeof launchId === 'string') d.launches().cancel(launchId)
  })
  handle('launch:list', () => d.launches().list())
  handle('games:report', () => getScanReport())
  handle('games:open-folder', async (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Jeu introuvable.')
    if (getSettings().demoMode) throw new Error('Mode démo : ce dossier n’existe pas sur ton PC.')
    // Le chemin vient de la base, jamais du renderer.
    const dir = (await d.games()).find((g) => g.id === id)?.installDir
    if (!dir) throw new Error('Dossier d’installation inconnu.')
    // shell.openPath exécute un fichier : on n'ouvre qu'un vrai dossier local (le chemin vient d'un manifeste).
    const isDir = await stat(dir).then((s) => s.isDirectory(), () => false)
    if (!isDir || /^[\\/]{2}/.test(dir)) throw new Error('Impossible d’ouvrir le dossier : il a peut-être été déplacé ou supprimé.')
    const err = await shell.openPath(dir)
    if (err) throw new Error('Impossible d’ouvrir le dossier : il a peut-être été déplacé ou supprimé.')
  })
  handle('games:favorite', async (_e, id: unknown) => {
    // Seul un jeu de la bibliothèque actuelle peut changer d'état.
    if (typeof id !== 'string' || !(await d.games()).some((g) => g.id === id)) return d.games()
    if (getSettings().demoMode) {
      const current = (await d.games()).filter((g) => g.favorite).map((g) => g.id)
      const favorites = current.includes(id) ? current.filter((f) => f !== id) : [...current, id]
      db.setKv('demoState', { ...d.demoState(), favorites })
    } else db.toggleFavorite(id)
    return d.games()
  })
  handle('games:set-favorites', async (_e, ids: unknown) => {
    // Seuls les identifiants de la bibliothèque actuelle sont gardés.
    const known = new Set((await d.games()).map((g) => g.id))
    const favorites = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && known.has(id))
    if (getSettings().demoMode) db.setKv('demoState', { ...d.demoState(), favorites })
    else db.setFavorites(favorites)
    return d.games()
  })
  // Actus des jeux : l'appid Steam est retrouvé ici, à partir de la bibliothèque, jamais reçu de l'interface.
  handle('news:game', async (_e, id: unknown, refresh?: unknown) => {
    if (!getSettings().gameNews) throw new Error('Les actus des jeux sont désactivées dans Paramètres.')
    const game = d.findGame(id)
    if (!game) throw new Error('Jeu introuvable.')
    return getGameNews(game, refresh === true)
  })
  handle('news:seen', (_e, id: unknown, upTo?: unknown) => {
    const game = d.findGame(id)
    if (game) markNewsSeen(game, typeof upTo === 'number' ? upTo : undefined, d.knownGames().filter((g) => g.id !== game.id))
  })
  // Jeux du compte Steam pas installés sur ce PC (Bibliothèque › Non installés).
  handle('steam:library', async (_e, refresh?: unknown): Promise<SteamLibrary> => {
    let lib: SteamLibrary
    if (getSettings().demoMode) {
      const notInstalled = demoNotInstalled()
      lib = { state: 'ready', notInstalled, owned: DEMO_GAMES.filter((g) => g.store === 'steam').length + notInstalled.length }
    } else lib = await steamLibrary(db.listGames(), refresh === true)
    d.fetchOwnedArtwork(lib.notInstalled)
    // Badge « Nouveau patch » des jeux pas installés suivis par le relevé (newsGames).
    return { ...lib, notInstalled: withNews(applyArtwork(lib.notInstalled)) }
  })
  // Succès Steam : comme les actus, le jeu est retrouvé ici à partir de son identifiant.
  handle('achievements:game', async (_e, id: unknown, refresh?: unknown) => {
    const game = d.findGame(id)
    if (!game) throw new Error('Jeu introuvable.')
    return getSettings().demoMode ? demoAchievements(game) : getGameAchievements(game, refresh === true)
  })
  handle('steam:install', async (_e, id: unknown) => {
    const game = d.findGame(id)
    if (!game?.notInstalled) throw new Error('Ce jeu n’est pas dans la liste de ton compte Steam.')
    // Mode démo : rien n'est installé pour de vrai.
    if (!getSettings().demoMode) await installSteamGame(game.storeId)
  })
  // Prêt à jouer : mises à jour Steam en attente ou en cours (manifestes locaux et registre de Steam).
  handle('steam:updates', () => steamUpdates())
  handle('steam:open-downloads', async () => {
    if (getSettings().demoMode) return 'demo'
    await shell.openExternal('steam://open/downloads')
    return 'opened'
  })
  // Événements des jeux (page Steam du jeu) et « Me prévenir » : le jeu est retrouvé ici, comme pour les actus.
  handle('events:game', async (_e, id: unknown) => {
    const game = d.findGame(id)
    if (!game) throw new Error('Jeu introuvable.')
    return getGameEvents(game)
  })
  handle('events:remind', (_e, id: unknown, eventId: unknown, on: unknown) => {
    const game = d.findGame(id)
    if (!game || typeof eventId !== 'string' || eventId.length > 32) throw new Error('Événement introuvable.')
    return setEventReminder(game, eventId, on === true)
  })
  // Collections et jeux masqués (rangement du joueur, sur ce PC ; la démo a le sien).
  handle('shelves:get', () => getShelves())
  handle('shelves:create', (_e, name: unknown, gameId: unknown) => createCollection(name, gameId))
  handle('shelves:rename', (_e, id: unknown, name: unknown) => renameCollection(id, name))
  handle('shelves:delete', (_e, id: unknown) => deleteCollection(id))
  handle('shelves:toggle', (_e, id: unknown, gameId: unknown, on: unknown) => setInCollection(id, gameId, on))
  handle('shelves:hide', (_e, gameId: unknown, hidden: unknown) => setGameHidden(gameId, hidden))
  // Serveurs : CS2 avec la clé Steam Web API ; joueurs en jeu pour un jeu Steam retrouvé ici (jamais un appid reçu tel quel).
  handle('servers:cs2', (_e, force: unknown) => getCs2Servers(force === true))
  handle('servers:players', (_e, id: unknown) => {
    const game = d.findGame(id)
    return game?.store === 'steam' ? getSteamPlayers(game.storeId) : null
  })
}
