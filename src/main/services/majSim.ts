import type { MajStatus } from '@shared/types'
import { simBlocked, simNotes, simSet } from './updater'

// Développement seulement : PX_MAJ_SIM imite la mise à jour avec de fausses données, pour voir l'interface sans GitHub.
// Jamais dans l'installeur (package.json, build.files l'exclut ; index.ts ne l'appelle que hors version installée).
//   PX_MAJ_SIM=available | downloading | verifying | ready | installing | error | blocked | blocked-ready | uptodate | notes | loop
//   (loop : disponible, puis téléchargement, vérification, prête, installation, en boucle)

const TOTAL = 139 * 1024 * 1024

const NOTES = [
  { version: '0.7.2', date: '2026-11-17', items: [
    { kind: 'nouveau' as const, title: 'Les mises à jour dans l’appli', text: 'Player X te prévient et s’installe quand tu le fermes.', page: 'set-about' },
    { kind: 'ameliore' as const, title: 'Overlay CS2', text: 'Échap quitte l’aperçu, comme dans le jeu.', page: 'set-overlay' }
  ] },
  { version: '0.7.1', date: '2026-11-16', items: [
    { kind: 'nouveau' as const, title: 'Éditeur de films', text: 'Ton montage est gardé, la musique joue dans l’aperçu.', page: 'clips' },
    { kind: 'corrige' as const, title: 'Son des clips', text: 'Il arrive 85 ms plus tôt sur les clips filmés par le moteur.' }
  ] }
]

const NEXT = [
  { version: '0.7.2', date: '2026-11-17', items: [{ kind: 'nouveau' as const, title: 'Les mises à jour arrivent dans l’appli', text: 'Player X te prévient quand une version sort.' }, { kind: 'ameliore' as const, title: 'Overlay CS2', text: 'Échap quitte l’aperçu, comme dans le jeu.' }, { kind: 'corrige' as const, title: 'Amis et Stats', text: 'Petites corrections.' }] }
]

function downloading(from: number, then: () => void, ms = 120): void {
  let p = from
  const t = setInterval(() => {
    p += 0.9 + Math.random() * 0.8
    if (p >= 100) {
      clearInterval(t)
      then()
      return
    }
    const received = Math.round((TOTAL * p) / 100)
    simSet('downloading', { received, total: TOTAL, bytesPerSec: 12 * 1024 * 1024, etaS: Math.max(1, Math.ceil((TOTAL - received) / (12 * 1024 * 1024))) })
  }, ms)
}

export function startMajSim(mode: string): void {
  const stay = (s: MajStatus, extra = {}): void => simSet(s, extra)
  switch (mode) {
    case 'available': return stay('available', { notes: NEXT })
    case 'downloading': return stay('downloading', { received: Math.round(TOTAL * 0.42), total: TOTAL, bytesPerSec: 12 * 1024 * 1024, etaS: 7 })
    case 'verifying': return stay('verifying')
    case 'ready': return stay('ready')
    case 'installing': return stay('installing', { secondsLeft: 3, endsAt: Date.now() + 3000 })
    case 'error': return stay('error', { reason: 'Empreinte invalide · fichier supprimé, ta version n’a pas bougé' })
    case 'blocked': simBlocked(true); return stay('available', { notes: NEXT, blocked: true })
    case 'blocked-ready': return stay('ready', { blocked: true })
    case 'uptodate': return stay('uptodate', { checkedAt: Date.now() - 2 * 3600 * 1000 })
    case 'notes': return simNotes(NOTES, '0.7.0')
    default: {
      const run = (): void => {
        stay('available', { notes: NEXT })
        setTimeout(() => downloading(4, () => {
          stay('verifying')
          setTimeout(() => {
            stay('ready')
            setTimeout(() => {
              stay('installing', { secondsLeft: 3, endsAt: Date.now() + 3000 })
              setTimeout(run, 3200)
            }, 2500)
          }, 1500)
        }), 2500)
      }
      run()
    }
  }
}
