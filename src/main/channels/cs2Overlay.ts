// Canaux de l'overlay Counter-Strike 2 : configuration, aperçu, placement et raccourci.
import { handle } from '../ipc'
import {
  checkOverlayHotkey,
  editOverlay,
  editOverlayStyle,
  endOverlayEdit,
  overlayConfig,
  overlayReady,
  placeOverlay,
  previewOverlay
} from '../services/cs2Overlay'

export function registerCs2OverlayChannels(): void {
  handle('cs2:overlay-config', () => overlayConfig())
  handle('cs2:overlay-preview', () => previewOverlay())
  handle('cs2:overlay-edit', (e, style: unknown, moment: unknown) => editOverlay(e, style, moment))
  handle('cs2:overlay-place', (e, key: unknown, value: unknown) => placeOverlay(e, key, value))
  handle('cs2:overlay-edit-style', (e, style: unknown) => editOverlayStyle(e, style))
  handle('cs2:overlay-edit-end', (e) => endOverlayEdit(e))
  handle('cs2:overlay-hotkey-check', (_e, accel: unknown) => checkOverlayHotkey(accel))
  handle('cs2:overlay-ready', (e) => overlayReady(e))
}
