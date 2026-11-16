import { contextBridge, ipcRenderer } from 'electron'

// Pont de la page de capture des clips (renderer/public/clips-recorder.html), fenêtre cachée : elle reçoit des ordres du
// processus principal et lui envoie le flux MP4. Elle n'a accès à rien d'autre (ni window.launcher, ni canal clips:*).

contextBridge.exposeInMainWorld('pxRecorder', {
  onCommand: (cb: (command: unknown) => void): void => {
    ipcRenderer.on('clips-rec:command', (_e, command: unknown) => cb(command))
  },
  ready: (): void => ipcRenderer.send('clips-rec:ready'),
  started: (info: unknown): void => ipcRenderer.send('clips-rec:started', info),
  encoder: (recId: string, mime: string): void => ipcRenderer.send('clips-rec:encoder', recId, mime),
  chunk: (recId: string, data: Uint8Array): void => ipcRenderer.send('clips-rec:chunk', recId, data),
  pcm: (recId: string, wall: number, data: Uint8Array): void => ipcRenderer.send('clips-rec:pcm', recId, wall, data),
  stopped: (recId: string, info: unknown): void => ipcRenderer.send('clips-rec:stopped', recId, info),
  failed: (recId: string, reason: string): void => ipcRenderer.send('clips-rec:failed', recId, reason),
  thumb: (id: string, data: Uint8Array): void => ipcRenderer.send('clips-rec:thumb', id, data),
  log: (message: string): void => ipcRenderer.send('clips-rec:log', message)
})
