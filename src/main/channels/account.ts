import { shell } from 'electron'
import type { FriendPlatform, Settings } from '@shared/types'
import { logError } from '../crashLog'
import { handle } from '../ipc'
import { resetFriendAlerts } from '../services/alerts'
import { cancelLogin, loginDiscord, loginSteam } from '../services/auth'
import { updateArtwork } from '../services/artwork'
import { syncBf6Recaps } from '../services/bf6Recap'
import { cs2DemoChanged, syncCs2 } from '../services/cs2Live'
import { syncCs2Overlay } from '../services/cs2Overlay'
import { DEMO_GAMES } from '../services/demo'
import { connectPsn, resetPsn } from '../services/friends'
import { refreshNewsIndex } from '../services/news'
import { getAccounts, getSettings, importPlayerXConnections, playerXConnections, publicSettings, removeAccount, saveSettings } from '../services/settings'
import { steamUpdatesDemoChanged } from '../services/steamUpdates'
import { startupState, syncStartup } from '../services/tray'
import type { ChannelDeps } from './deps'

// Canaux des comptes et des réglages : connexions, réglages (et ce qu'un changement relance), reprise depuis Player X, liens.

const PLATFORMS: readonly FriendPlatform[] = ['steam', 'discord', 'psn']
const isPlatform = (v: unknown): v is FriendPlatform => PLATFORMS.includes(v as FriendPlatform)
/** Une vraie adresse https (sans identifiants), seule chose que Player X ouvre dans le navigateur. */
function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}

export function registerAccountChannels(d: ChannelDeps): void {
  handle('accounts:list', () => getAccounts())
  handle('accounts:login', async (_e, platform: unknown) => {
    if (platform !== 'steam' && platform !== 'discord') throw new Error('Compte inconnu.')
    const account = await (platform === 'steam' ? loginSteam() : loginDiscord())
    resetFriendAlerts(platform)
    return account
  })
  handle('accounts:psn', async () => {
    const account = await connectPsn()
    resetFriendAlerts('psn')
    return account
  })
  handle('accounts:cancel', () => cancelLogin())
  handle('accounts:logout', (_e, platform: unknown) => {
    if (!isPlatform(platform)) throw new Error('Compte inconnu.')
    resetFriendAlerts()
    // Le jeton NPSSO sert seulement à ce compte : on l'efface avec lui.
    if (platform === 'psn') {
      saveSettings({ psnNpsso: '' })
      resetPsn()
    }
    return removeAccount(platform)
  })
  // Les clés et jetons ne quittent jamais le processus principal : l'interface ne voit que leurs 4 derniers caractères.
  handle('settings:get', () => publicSettings(getSettings()))
  handle('settings:save', (_e, patch: unknown) => {
    const before = getSettings()
    const wasDemo = before.demoMode
    // Ce que la page envoie n'a aucun type garanti : saveSettings n'en garde que les réglages connus, du bon type (cleanPatch).
    const next = saveSettings(patch as Partial<Settings>)
    if (next.psnNpsso !== before.psnNpsso) resetPsn()
    if (next.startWithWindows !== before.startWithWindows) syncStartup()
    if (next.bf6Recap !== before.bf6Recap) syncBf6Recaps()
    if (next.cs2Live !== before.cs2Live) void syncCs2()
    if (next.cs2Overlay !== before.cs2Overlay || next.overlayHotkey !== before.overlayHotkey) syncCs2Overlay()
    if (next.gameNews !== before.gameNews) {
      // Badges retirés tout de suite, ou relevés dès la réactivation.
      d.notifyGamesChanged()
      if (next.gameNews) refreshNewsIndex(d.newsGames()).catch(() => {})
    }
    if (next.demoMode !== wasDemo) {
      d.updateRunning()
      resetFriendAlerts()
      steamUpdatesDemoChanged()
      cs2DemoChanged()
      // Les lancements en cours (vrais ou de démo) s'arrêtent sans carte : l'interface vide aussi les siens.
      d.launches().reset()
      // Au retour du mode démo, on rescanne la vraie bibliothèque.
      d.rescan()
      // Jaquettes des jeux fictifs, aussi quand la démo s'active en cours de session.
      if (next.demoMode) updateArtwork(DEMO_GAMES).then((changed) => changed && d.notifyGamesChanged()).catch((e) => logError('jaquettes', e))
      // Actus de l'autre bibliothèque tout de suite, sans attendre le relevé de l'heure suivante.
      if (next.gameNews) refreshNewsIndex(d.newsGames()).catch(() => {})
    }
    return publicSettings(next)
  })
  handle('accounts:playerx', () => (getSettings().demoMode ? null : playerXConnections()))
  handle('accounts:import-playerx', () => importPlayerXConnections())
  handle('app:startup', () => startupState())
  handle('shell:open', (_e, url: unknown) => {
    if (isHttpsUrl(url)) return shell.openExternal(url)
  })
}
