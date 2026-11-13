import { BrowserWindow, clipboard, ClipboardItem } from 'electron'
import { handle } from '../ipc'
import { bf6RecapState, markBf6RecapSeen } from '../services/bf6Recap'
import { getCs2Lifetime } from '../services/cs2Lifetime'
import { cs2State, markCs2RecapSeen } from '../services/cs2Live'
import { chooseRoutineApp, getRoutines, routineHotkeys, runRoutine, saveRoutines } from '../services/routines'
import { deleteBf6Loadout, getBf6Loadouts, getMyWeapons, saveBf6Loadout, saveBf6Loadouts } from '../services/bf6Loadouts'
import { getBf6Art, getBf6History, getBf6Stats, getBf6Tracked, importPlayerXBf6, playerXBf6, searchBf6, setBf6Tracked } from '../services/stats'
import type { ChannelDeps } from './deps'

// Canaux des jeux suivis : Battlefield 6, Counter-Strike 2, loadouts, routines, copie d'une zone de la fenêtre.

export function registerPlayChannels(d: ChannelDeps): void {
  // Mes loadouts Battlefield 6 (carnet du joueur, sur ce PC ; la démo a le sien).
  handle('loadouts:get', () => getBf6Loadouts())
  handle('loadouts:save', (_e, loadout: unknown) => saveBf6Loadout(loadout))
  handle('loadouts:delete', (_e, id: unknown) => deleteBf6Loadout(id))
  handle('loadouts:save-many', (_e, list: unknown) => saveBf6Loadouts(list))
  handle('loadouts:weapons', () => getMyWeapons())
  // Image d'une zone de la fenêtre (une carte de loadout) dans le presse-papiers, pour la coller sur Discord.
  handle('window:copy-area', async (e, rect: unknown) => {
    const r = rect && typeof rect === 'object' ? (rect as Record<string, unknown>) : {}
    const zoom = e.sender.getZoomFactor()
    const box = ['x', 'y', 'width', 'height'].map((k) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? Math.round((r[k] as number) * zoom) : NaN))
    if (box.some(Number.isNaN) || box[2] < 1 || box[3] < 1) throw new Error('Zone à copier invalide.')
    const [width0, height0] = BrowserWindow.fromWebContents(e.sender)?.getContentSize() ?? [box[0] + box[2], box[1] + box[3]]
    const x = Math.max(0, box[0])
    const y = Math.max(0, box[1])
    const area = { x, y, width: Math.min(box[2], width0 - x), height: Math.min(box[3], height0 - y) }
    if (area.width < 1 || area.height < 1) throw new Error('Zone à copier hors de la fenêtre.')
    const png = (await e.sender.capturePage(area)).toPNG()
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    return 'copied' as const
  })
  // Routines : ce qui se passe quand tu appuies sur Jouer (services/routines.ts).
  handle('routines:get', () => getRoutines())
  handle('routines:save', (_e, list: unknown) => saveRoutines(list))
  handle('routines:choose-app', () => chooseRoutineApp())
  handle('routines:run', (_e, id: unknown, launchId: unknown) => runRoutine(id, launchId))
  handle('routines:hotkeys', () => routineHotkeys())
  // Stats Battlefield 6 : vraies données même en mode démo (jamais de stats inventées).
  handle('bf6:search', (_e, name: unknown) => searchBf6(name))
  handle('bf6:playerx', () => playerXBf6())
  handle('bf6:import-playerx', () => importPlayerXBf6())
  handle('bf6:stats', (_e, account: unknown, refresh?: unknown) => getBf6Stats(account, refresh === true))
  handle('bf6:art', () => getBf6Art())
  handle('bf6:tracked', () => getBf6Tracked())
  handle('bf6:set-tracked', (_e, tracked: unknown) => setBf6Tracked(tracked))
  handle('bf6:history', (_e, account: unknown) => getBf6History(account))
  // Bilans de session : ton vrai compte seulement (rien en mode démo).
  handle('bf6:recaps', () => bf6RecapState())
  handle('bf6:recap-seen', (_e, id: unknown) => markBf6RecapSeen(id))
  // Counter-Strike 2 : ton vrai match et tes vrais bilans seulement (rien en mode démo, sauf le simulateur de développement).
  handle('cs2:state', () => cs2State())
  handle('cs2:recap-seen', (_e, id: unknown) => markCs2RecapSeen(id))
  // Stats à vie de Valve (clé Steam Web API et compte Steam relié) : rien en mode démo, jamais de chiffres inventés.
  handle('cs2:lifetime', (_e, force: unknown) => getCs2Lifetime(force === true))
}
