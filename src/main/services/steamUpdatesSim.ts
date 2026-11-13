// Développement seulement : PX_READY_SIM simule des mises à jour Steam sur les jeux de la démo, pour voir les pastilles,
// la barre de progression et l'alerte « … est prêt » sans vrai téléchargement. Jamais lancé par la version installée.
// `PX_READY_SIM=1` : Baldur's Gate 3 se télécharge en 40 s, s'installe en 10 s, puis l'alerte part ; `static` : rien ne bouge.
import type { SteamUpdates } from '@shared/types'
import { simulateSteamUpdates } from './steamUpdates'

const GB = 1024 ** 3

export function startSteamUpdatesSim(mode: string): void {
  const publish = simulateSteamUpdates()
  const t0 = Date.now()
  const moving = mode !== 'static'
  const bg3 = { total: Math.round(4.2 * GB), from: 0.62 }

  const tick = (): void => {
    const s = moving ? (Date.now() - t0) / 1000 : 0
    const next: SteamUpdates = {
      // Counter-Strike 2 : une mise à jour attend.
      '730': { kind: 'queued', total: Math.round(3.1 * GB), done: 0 },
      // Valheim : en pause à 30 %.
      '892970': { kind: 'paused', total: Math.round(1.8 * GB), done: Math.round(0.54 * GB) },
      // Balatro (pas installé) : premier téléchargement.
      '2379780': { kind: 'downloading', total: 160 * 1024 ** 2, done: 25 * 1024 ** 2, firstInstall: true }
    }
    // Baldur's Gate 3 : de 62 % à la fin en 40 s, puis 10 s d'installation, puis prêt.
    const done = Math.min(bg3.total, Math.round(bg3.total * (bg3.from + (1 - bg3.from) * (s / 40))))
    if (s < 40) next['1086940'] = { kind: 'downloading', total: bg3.total, done }
    else if (s < 50) next['1086940'] = { kind: 'installing', total: bg3.total, done: Math.round(bg3.total * ((s - 40) / 10)) }
    publish(next, new Set(['1086940', '1245620', '570', '1091500', '413150', '1145360']))
  }
  tick()
  if (moving) setInterval(tick, 2_000)
}
