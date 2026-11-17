import { handle } from '../ipc'
import { openDisplaySettings, pcState } from '../services/pc'
import { driverState, openSystemRestore, stopDriverUpdate, updateDriver } from '../services/pcDriver'

// Canaux de Mon PC (Paramètres › Mon PC). La lecture (carte, pilote, écrans) ne change rien. La mise à jour du pilote NVIDIA
// (pc:driver-update) ne reçoit de la page qu'une option : la carte, la version et l'adresse du fichier sont relues ici.
// Les pages de Windows s'ouvrent à des adresses fixes.

export function registerPcChannels(): void {
  handle('pc:state', (_e, refresh: unknown) => pcState(refresh === true))
  handle('pc:display-settings', () => openDisplaySettings())
  // L'avancement part vers toutes les fenêtres par « pc:driver » (services/pcDriver.ts)
  handle('pc:driver-update', (_e, opts: unknown) => updateDriver(opts))
  handle('pc:driver-state', () => driverState())
  handle('pc:driver-stop', () => stopDriverUpdate())
  handle('pc:system-restore', () => openSystemRestore())
}
