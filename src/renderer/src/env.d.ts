/// <reference types="vite/client" />
import type { OverlayApi } from '@shared/types'

declare global {
  interface Window {
    /** Pont de l'overlay CS2 (preload/overlay.ts). */
    pxOverlay: OverlayApi
  }
}
