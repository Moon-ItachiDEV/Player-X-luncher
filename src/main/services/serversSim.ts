// Développement seulement : PX_SERVERS_SIM remplace les réponses de Steam par des chiffres d'exemple (marqués `sample`),
// pour voir la pastille du matchmaking et la carte Serveurs sans clé ni réseau. Jamais lancé par la version installée.
// `PX_SERVERS_SIM=1` : tout va bien ; `down` : matchmaking ralenti.
import { simulateServers } from './servers'

/** Joueurs d'exemple par appid (ordre de grandeur seulement). */
const SAMPLE_PLAYERS: Record<string, number> = { '730': 1_234_567, '1245620': 41_230, '1086940': 63_800, '570': 612_000 }

export function startServersSim(mode: string): void {
  simulateServers({
    servers: () => ({
      at: Date.now(),
      matchmaking: mode === 'down' ? 'delayed' : 'normal',
      logon: 'normal',
      searchSeconds: mode === 'down' ? 640 : 121,
      searching: 34_567,
      online: 1_234_567,
      europe: [
        { name: 'EU West', load: 'low' },
        { name: 'EU East', load: 'medium' },
        { name: 'EU North', load: 'low' },
        { name: 'Spain', load: 'idle' }
      ],
      sample: true
    }),
    players: (appId) => ({ count: SAMPLE_PLAYERS[appId] ?? 8_400, at: Date.now(), sample: true })
  })
}
