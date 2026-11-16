// Simulateur des annonces Steam pour le développement (PX_NEWS_SIM) : l'onglet Actus de la fiche, les badges « Nouveau patch »
// et le lecteur, sans réseau. Chargé seulement quand l'appli n'est pas installée (import dynamique), jamais livré dans
// l'installeur. PX_NEWS_SIM=1 : 13 annonces inventées (newsSimData.ts) ; offline : Steam ne répond pas ; empty : aucune annonce.
// Ses relevés et ce qui a été lu vivent dans leurs propres clés, effacées à chaque démarrage : rien ne touche aux vrais.
import { deleteKv } from '../db'
import { setFrenchSource, setNewsSource } from './news'
import { simEvents, simFrenchEvents, simNews } from './newsSimData'

/** Comme une vraie requête : la réponse arrive un peu après. */
const DELAY_MS = 400

export function startNewsSim(mode: string): void {
  deleteKv('newsSimIndex')
  deleteKv('simNewsSeen')
  const t0 = Date.now()
  setNewsSource(async (appId, count, maxlength, enddate) => {
    await new Promise((r) => setTimeout(r, DELAY_MS))
    if (mode === 'offline') throw new Error('PX_NEWS_SIM=offline')
    if (mode === 'empty') return []
    return simNews(appId, t0)
      .filter((n) => !enddate || (n.date as number) < enddate)
      .slice(0, count)
      .map((n) => (maxlength > 0 && typeof n.contents === 'string' ? { ...n, contents: n.contents.slice(0, maxlength) } : n))
  })
  // Versions françaises (ELDEN RING, Balatro) et événements datés (ELDEN RING, CS2), comme la liste d'événements du
  // magasin avec l=french.
  setFrenchSource(async (appId) => {
    await new Promise((r) => setTimeout(r, DELAY_MS))
    if (mode === 'offline') throw new Error('PX_NEWS_SIM=offline')
    return mode === 'empty' ? [] : [...simFrenchEvents(appId, t0), ...simEvents(appId, t0)]
  })
}
