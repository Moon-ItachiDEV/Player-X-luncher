import { contextBridge, ipcRenderer } from 'electron'
import type { Cs2Live, Cs2OverlayConfig, Cs2RecapEvent, OverlayApi } from '@shared/types'

// Pont de la fenêtre de l'overlay CS2 (main/services/cs2Overlay.ts, page renderer/index.html) : ses six envois cs2:*
// seulement (réglages de l'overlay, page peinte, état et match en direct, bilans). Ni window.launcher, ni rien d'autre ;
// src/main/ipc.ts refuse en plus, depuis cette fenêtre, tout canal qui ne commence pas par cs2:.

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: OverlayApi = {
  cs2OverlayConfig: () => ipcRenderer.invoke('cs2:overlay-config'),
  cs2OverlayReady: () => ipcRenderer.invoke('cs2:overlay-ready'),
  cs2State: () => ipcRenderer.invoke('cs2:state'),
  onCs2OverlayConfig: (cb) => on<Cs2OverlayConfig>('cs2:overlay-config', cb),
  onCs2Live: (cb) => on<Cs2Live | null>('cs2:live', cb),
  onCs2Recap: (cb) => on<Cs2RecapEvent>('cs2:recap', cb)
}

contextBridge.exposeInMainWorld('pxOverlay', api)
