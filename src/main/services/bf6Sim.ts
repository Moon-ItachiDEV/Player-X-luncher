// Simulateur de session Battlefield 6 pour le développement (PX_BF6_SIM) : sans Windows ni le jeu, il dit à bf6Recap.ts
// quand le jeu tourne. Chargé seulement quand l'appli n'est pas installée (import dynamique), jamais livré dans l'installeur.
// PX_BF6_SIM=auto : une partie de 30 s, 5 s après le démarrage. PX_BF6_SIM=manual : globalThis.pxBf6Sim.running(true|false),
// pour les tests (electronApp.evaluate). PX_BF6_SIM=running : comme manual, le jeu tournant déjà au démarrage (Player X
// relancé en pleine partie). Avec PX_BF6_SIM_FAST=1, les minutes du bilan deviennent des secondes.
import { simulateBf6Running } from './bf6Recap'

export function startBf6Sim(mode: string): void {
  ;(globalThis as { pxBf6Sim?: unknown }).pxBf6Sim = { running: simulateBf6Running }
  if (mode === 'running') simulateBf6Running(true)
  if (mode !== 'auto') return
  setTimeout(() => simulateBf6Running(true), 5_000)
  setTimeout(() => simulateBf6Running(false), 35_000)
}
