// Types ambiants pour la vérification TypeScript (tsconfig.v3ui.json) de v3ui/src/*.js et clips-recorder.js.
// Relie window.launcher au vrai contrat LauncherApi (src/shared/types/api.ts) et Shared aux exports de v3ui/shared-entry.ts.
import type { LauncherApi } from '../src/shared/types/api'
import type * as SharedModule from './shared-entry'

declare global {
  const Shared: typeof SharedModule

  interface PxRecorderBridge {
    onCommand: (cb: (command: any) => void) => void
    ready: () => void
    started: (info: any) => void
    encoder: (recId: string, mime: string) => void
    chunk: (recId: string, data: Uint8Array) => void
    pcm: (recId: string, wall: number, data: Uint8Array) => void
    stopped: (recId: string, info: any) => void
    failed: (recId: string, reason: string) => void
    thumb: (id: string, data: Uint8Array) => void
    log: (message: string) => void
  }

  interface Window {
    launcher: LauncherApi
    pxRecorder: PxRecorderBridge
    webkitAudioContext?: typeof AudioContext
  }

  interface MediaRecorderOptions {
    videoBitrateMode?: 'constant' | 'variable'
    videoKeyFrameIntervalDuration?: number
  }

  interface Navigator {
    userAgentData?: { platform?: string; brands?: Array<{ brand: string; version: string }>; mobile?: boolean }
  }
}

export {}
