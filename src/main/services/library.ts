import type { FriendsResult, Game } from '@shared/types'
import { lastPlayedOf, type PlayedDates } from '@shared/played'
import { CS2_GAME_ID } from '@shared/cs2'
import { hasName } from '@shared/steamApps'
import { cleanName, isBf6Name } from '@shared/text'
import { logError } from '../crashLog'
import * as db from '../db'
import type { LaunchSim } from '../launchSim'
import { broadcast } from '../windows'
import { applyArtwork, updateArtwork, withLogos } from './artwork'
import { setBf6Running } from './bf6Recap'
import { syncClipsRunning } from './clips'
import { setCs2Running, syncCs2 } from './cs2Live'
import { DEMO_CHANNELS, DEMO_FRIENDS, DEMO_SERVER, demoGames, demoNotInstalled } from './demo'
import { scanAllGames } from './games'
import { withNews } from './news'
import { lastPollOk, withPlaytime } from './playtime'
import { recentGames } from './recentGames'
import { getSettings } from './settings'
import { isSteamSoftware, ownedForNews, ownedSteamGame } from './steamLibrary'
import { setRecentGames, setTrayPlaying } from './tray'

// La bibliothèque vue par toute l'appli : les jeux (vrais ou de démo), le scan des stores, les jaquettes qui arrivent en
// arrière-plan, et « quels jeux tournent » redistribué aux services qui en dépendent (icône près de l'horloge, bilans
// Battlefield 6 et CS2, tampon des clips). Sortie de index.ts, qui ne garde que l'ordre de démarrage.

/** Simulateur de lancement (développement, PX_LAUNCH_SIM) : son faux relevé donne « En jeu » dans la bibliothèque de démo. Toujours null dans la version installée. */
let launchSim: Pick<LaunchSim, 'isRunning' | 'runningSince'> | null = null

export function setLaunchSim(sim: Pick<LaunchSim, 'isRunning' | 'runningSince'>): void {
  launchSim = sim
}

/** Le lancement d'un jeu depuis le menu de l'icône ou la liste de raccourcis de Windows : absent tant que les lancements ne sont pas prêts. */
let shortcutLauncher: ((id: string) => void) | null = null

export function setShortcutLauncher(launch: (id: string) => void): void {
  shortcutLauncher = launch
}

export function notifyGamesChanged(): void {
  // Une fenêtre en train de se fermer ne doit pas empêcher les autres d'être prévenues, ni le relevé des jeux en cours.
  broadcast('games:changed')
  updateRunning()
}

/** Jeux en cours dans la vraie bibliothèque : menu de l'icône près de l'horloge, session Battlefield 6, match Counter-Strike 2. */
export function updateRunning(): void {
  const all = withPlaytime(db.listGames())
  const running = all.filter((g) => g.running)
  // La démo reste dans la fenêtre : rien dans le menu de l'icône.
  const demo = getSettings().demoMode
  setTrayPlaying(demo ? [] : running.map((g) => cleanName(g.name)))
  // Jeux récents : menu de l'icône et liste de raccourcis de Windows (rien n'est refait si la liste ne change pas).
  const recent = demo ? [] : recentGames(all.filter(isGameEntry)).map((g) => ({ id: g.id, name: cleanName(g.name) }))
  if (shortcutLauncher) setRecentGames(recent, shortcutLauncher)
  // Fin vue sans relevé fiable (mise en veille, PowerShell en panne) : le bilan attend le prochain relevé réussi.
  setBf6Running(running.some((g) => isBf6Name(g.name)), lastPollOk())
  setCs2Running(running.some((g) => g.id === CS2_GAME_ID), lastPollOk())
  // Clips : le tampon vidéo ne tourne que pendant qu'un jeu tourne (les logiciels Steam ne comptent pas).
  syncClipsRunning(running.filter(isGameEntry))
}

// Favoris et lancements du mode démo : gardés à part pour ne jamais toucher la vraie bibliothèque.
interface DemoState {
  /** Absent tant qu'on n'a rien changé : on garde les favoris fictifs. */
  favorites?: string[]
  launches: Record<string, { count: number; last: number }>
}

export function demoState(): DemoState {
  return { launches: {}, ...db.getKv<Partial<DemoState>>('demoState', {}) }
}

/** Lancement en mode démo : seul le compteur de démo change, jamais la vraie bibliothèque. */
export function recordDemoLaunch(id: string): void {
  const state = demoState()
  const count = (state.launches[id]?.count ?? 0) + 1
  db.setKv('demoState', { ...state, launches: { ...state.launches, [id]: { count, last: Date.now() } } })
}

export async function games(refresh = false): Promise<Game[]> {
  if (getSettings().demoMode) {
    const state = demoState()
    return withNews(
      applyArtwork(demoGames()).map((g) => {
        const l = state.launches[g.id]
        // Dernière partie : la date fictive (avec sa source) ou un lancement de démo, le plus récent des deux.
        const dates: PlayedDates = g.lastPlayed && g.lastPlayedSource ? { [g.lastPlayedSource]: g.lastPlayed } : {}
        if (l?.last) dates.launch = Math.max(dates.launch ?? 0, l.last)
        const played = lastPlayedOf(dates)
        return {
          ...g,
          favorite: state.favorites ? state.favorites.includes(g.id) : g.favorite,
          lastPlayed: played?.at,
          lastPlayedSource: played?.source,
          launches: (g.launches ?? 0) + (l?.count ?? 0),
          // Développement : « En jeu » d'après le faux relevé du simulateur de lancement.
          ...(launchSim?.isRunning(g.id) ? { running: true, runningSince: launchSim.runningSince(g.id) } : {})
        }
      })
    )
  }
  if (refresh || !scanned) {
    await scanLibrary()
    // Le mode démo a pu s'activer pendant le scan : on rend alors la bibliothèque de démo.
    if (getSettings().demoMode) return games()
  }
  return withNews(withPlaytime(withLogos(db.listGames().filter(isGameEntry))))
}

/** Faux tant que les stores n'ont pas été lus une première fois (ou après `rescanNextTime`). */
let scanned = false
let scanRun: Promise<void> | null = null

/** Un seul scan à la fois : l'interface, un raccourci au démarrage et la fin d'une installation qui demandent en même temps partagent le même. */
function scanLibrary(): Promise<void> {
  scanRun ??= (async () => {
    const found = applyArtwork(await scanAllGames())
    db.replaceGames(found)
    scanned = true
    // CS2 installé, déplacé ou désinstallé : son fichier de liaison suit.
    void syncCs2()
    // Les jaquettes manquantes arrivent en arrière-plan : la bibliothèque s'affiche tout de suite.
    updateArtwork(found)
      .then((changed) => {
        if (!changed) return
        db.replaceGames(applyArtwork(db.listGames()))
        notifyGamesChanged()
      })
      .catch((e) => logError('jaquettes', e))
  })().finally(() => (scanRun = null))
  return scanRun
}

/** Le prochain affichage de la bibliothèque relance un scan (retour du mode démo). */
export function rescanNextTime(): void {
  scanned = false
}

/** Les logiciels Steam (Wallpaper Engine…) et les entrées sans nom ne sont pas affichés dans la bibliothèque. */
export function isGameEntry(g: Game): boolean {
  return hasName(g.name) && !(g.store === 'steam' && isSteamSoftware(g.storeId))
}

/** La bibliothèque déjà connue (vraie ou de démo), sans relancer de scan : pour les actus des jeux. */
export function knownGames(): Game[] {
  return getSettings().demoMode ? demoGames() : db.listGames()
}

/**
 * Jeux suivis par le relevé des actus : la bibliothèque, plus les jeux du compte Steam pas installés les plus récemment
 * joués (leur jaquette de la Bibliothèque a aussi le badge « Nouveau patch »).
 */
export function newsGames(): Game[] {
  const installed = knownGames()
  return [...installed, ...(getSettings().demoMode ? demoNotInstalled() : ownedForNews(installed))]
}

/** Amis et membres du serveur du mode démo (salons vocaux compris). */
export function demoFriends(): FriendsResult {
  return { friends: DEMO_FRIENDS, errors: {}, discordServer: DEMO_SERVER, discordChannels: DEMO_CHANNELS }
}

/** Un jeu de la bibliothèque, ou un jeu du compte Steam pas installé sur ce PC (sa fiche s'ouvre aussi). */
export function findGame(id: unknown): Game | undefined {
  if (typeof id !== 'string') return undefined
  const installed = knownGames().find((g) => g.id === id)
  if (installed) return installed
  return (getSettings().demoMode ? demoNotInstalled().find((g) => g.id === id) : ownedSteamGame(id)) ?? undefined
}

const OWNED_ART_EVERY_MS = 10 * 60_000
let ownedArt: { at: number; run: Promise<void> | null } = { at: 0, run: null }

/** Jaquettes des jeux Steam non installés, en arrière-plan : une recherche à la fois, au plus toutes les 10 min. */
export function fetchOwnedArtwork(list: Game[]): void {
  if (!list.length || ownedArt.run || Date.now() - ownedArt.at < OWNED_ART_EVERY_MS) return
  ownedArt = {
    at: Date.now(),
    run: updateArtwork(list)
      .then((changed) => void (changed && notifyGamesChanged()))
      .catch((e) => logError('jaquettes', e))
      .finally(() => (ownedArt.run = null))
  }
}
