// Annonces du simulateur PX_NEWS_SIM (newsSim.ts) : texte inventé, sans rapport avec les vraies notes des jeux, signé
// « Simulation Player X » pour qu'une capture ne puisse jamais passer pour une annonce de l'éditeur. Module pur : les tests
// vérifient que chaque titre est bien reconnu (ou non) comme des notes de patch.

export const SIM_AUTHOR = 'Simulation Player X'

export interface SimPost {
  appId: string
  /** Il y a combien d'heures, au démarrage du simulateur. */
  hours: number
  title: string
  tags: string[]
  /** Ce que isPatchPost doit en dire. */
  patch: boolean
  /** BBCode, sans [img] : la page de l'annonce montre l'image du jeu à la place. */
  contents: string
}

const fixes = (items: string[]): string => `[list]${items.map((t) => `[*][p]${t}[/p][/*]`).join('')}[/list]`

export const SIM_POSTS: SimPost[] = [
  {
    appId: '730',
    hours: 3,
    title: 'Counter-Strike 2 Release Notes',
    tags: ['patchnotes'],
    patch: true,
    // Crochets échappés comme dans les vraies notes de Counter-Strike 2 (« \[ UI ] »).
    contents:
      '[p]\\[ UI ][/p]' +
      fixes(['Demo viewer: added a progress bar while a demo downloads.', 'Fixed a case where the scoreboard could overlap the buy menu.']) +
      '[p]\\[ MAPS ][/p]' +
      fixes(['Fixed a spot where players could get stuck near a ladder.', 'Minor lighting fixes.']) +
      '[p]\\[ MISC ][/p]' +
      fixes(['\\[ Linux ] Fixed a rare crash on startup.', 'Stability improvements.'])
  },
  {
    appId: '1245620',
    hours: 20,
    title: 'Patch Notes Ver. 1.16.2',
    tags: ['patchnotes'],
    patch: true,
    contents: '[h2]Bug fixes[/h2]' + fixes(['Fixed a bug where some menus could not be closed with a controller.', 'Improved stability during online play.'])
  },
  {
    appId: '1086940',
    hours: 2 * 24,
    title: 'Hotfix #31',
    tags: [],
    patch: true,
    contents: '[p]A small hotfix is now live.[/p]' + fixes(['Fixed a crash when loading some saves.', 'Fixed a few typos in the journal.'])
  },
  {
    appId: '1091500',
    hours: 4 * 24,
    title: 'Community Spotlight: Photo Mode',
    tags: [],
    patch: false,
    contents: '[p]A look back at some of the photos shared by players this month. Thanks to everyone who took part.[/p]'
  },
  {
    appId: '570',
    hours: 5 * 24,
    title: 'Gameplay Patch 7.40b',
    tags: [],
    patch: true,
    contents: '[h2]General[/h2]' + fixes(['Small balance changes.', 'Bug fixes and stability improvements.'])
  },
  {
    appId: '730',
    hours: 6 * 24,
    title: 'Counter-Strike 2 Release Notes',
    tags: ['patchnotes'],
    patch: true,
    contents: '[ MAPS ]\n' + fixes(['Fixed some clipping issues.']) + '[ MISC ]\n' + fixes(['Stability improvements.'])
  },
  {
    appId: '892970',
    hours: 9 * 24,
    title: 'Public Test Patch 0.221.4',
    tags: [],
    patch: true,
    contents: '[p]A new public test build is available.[/p]' + fixes(['Fixed a crash when leaving a world.', 'Performance improvements.'])
  },
  {
    appId: '1145360',
    hours: 12 * 24,
    title: 'A thank-you from the studio',
    tags: [],
    patch: false,
    contents: '[p]Thank you for playing. We read every message.[/p]'
  },
  {
    appId: '1245620',
    hours: 18 * 24,
    title: 'Community Event Announcement',
    tags: [],
    patch: false,
    contents: '[p]A community event is coming soon. More details later.[/p]'
  },
  {
    appId: '413150',
    hours: 26 * 24,
    title: 'Stardew Valley 1.6.16 Patch Notes',
    tags: [],
    patch: true,
    contents: fixes(['Fixed a few rare bugs.', 'Stability improvements.'])
  },
  {
    appId: '1091500',
    hours: 33 * 24,
    title: 'Update 2.31',
    tags: [],
    patch: true,
    contents: '[h2]Fixes[/h2]' + fixes(['Fixed some quests not progressing.', 'Stability improvements.'])
  },
  {
    appId: '570',
    hours: 40 * 24,
    title: 'Event Recap',
    tags: [],
    patch: false,
    contents: '[p]Thanks to everyone who joined the event.[/p]'
  },
  {
    // Jeu du compte pas installé en mode démo (Balatro) : son nouveau patch donne le badge de sa jaquette dans la Bibliothèque.
    appId: '2379780',
    hours: 30,
    title: 'Patch Notes 1.0.2',
    tags: ['patchnotes'],
    patch: true,
    contents: fixes(['Fixed a rare crash when opening a booster pack.', 'Stability improvements.'])
  }
]

/**
 * Versions françaises du simulateur, comme un éditeur qui traduit ses annonces (index dans SIM_POSTS) : ELDEN RING et Balatro.
 * Les autres restent en anglais, comme Counter-Strike 2 chez Valve.
 */
export const SIM_FRENCH: Record<number, { title: string; contents: string }> = {
  1: {
    title: 'Notes de patch ver. 1.16.2',
    contents: fixes(['Correction d\'un plantage au chargement de certaines zones.', 'Équilibrage de plusieurs armes.', 'Améliorations de la stabilité.'])
  },
  12: {
    title: 'Notes de patch 1.0.2',
    contents: fixes(["Correction d'un plantage rare à l'ouverture d'un booster.", 'Améliorations de la stabilité.'])
  }
}

/** Identifiant Steam (gid) fictif de la n-ième annonce : « 9100000000000000001 »… */
export function simGid(i: number): string {
  return `91000000000000000${String(i + 1).padStart(2, '0')}`
}

/** Annonces d'un appid au format de l'API Steam (dates en secondes), les plus récentes d'abord. Inconnu : aucune. */
export function simNews(appId: string, t0: number): Record<string, unknown>[] {
  return SIM_POSTS.map((p, i) => ({ p, gid: simGid(i) }))
    .filter(({ p }) => p.appId === appId)
    .sort((a, b) => a.p.hours - b.p.hours)
    .map(({ p, gid }) => ({
      gid,
      title: p.title,
      url: `https://store.steampowered.com/news/app/${p.appId}/view/${gid}`,
      author: SIM_AUTHOR,
      contents: p.contents,
      date: Math.floor((t0 - p.hours * 3600_000) / 1000),
      tags: p.tags,
      feedname: 'steam_community_announcements'
    }))
}

/**
 * Événements du magasin en français (ajaxgetpartnereventspageable, l=french) pour un appid : les annonces traduites de
 * SIM_FRENCH, rattachées par news_post_gid, langue 2 (« french » dans la numérotation de Steam).
 */
export function simFrenchEvents(appId: string, t0: number): Record<string, unknown>[] {
  return SIM_POSTS.map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.appId === appId && SIM_FRENCH[i])
    .map(({ p, i }) => ({
      gid: `92${simGid(i).slice(2)}`,
      event_name: p.title,
      news_post_gid: simGid(i),
      announcement_body: {
        gid: simGid(i),
        headline: SIM_FRENCH[i].title,
        body: SIM_FRENCH[i].contents,
        posttime: Math.floor((t0 - p.hours * 3600_000) / 1000),
        language: 2
      }
    }))
}

/**
 * Événements datés du simulateur (types de Steam, EProtoClanEventType), en heures depuis le lancement du simulateur :
 * un en cours, deux à venir, et une promo, qui ne doit jamais s'afficher.
 */
const SIM_EVENTS: { appId: string; type: number; title: string; startH: number; endH?: number }[] = [
  { appId: '1245620', type: 22, title: 'Week-end double XP', startH: -20, endH: 52 },
  { appId: '1245620', type: 25, title: 'Défi de la Lune rouge', startH: 70, endH: 238 },
  { appId: '730', type: 32, title: 'Opération Braise', startH: 30, endH: 30 + 24 * 60 },
  { appId: '1245620', type: 20, title: "Soldes d'automne", startH: -5, endH: 100 }
]

/** Événements datés d'un appid, au format de la liste d'événements du magasin (secondes Unix). */
export function simEvents(appId: string, t0: number): Record<string, unknown>[] {
  const at = (h: number): number => Math.floor((t0 + h * 3600_000) / 1000)
  return SIM_EVENTS.map((e, i) => ({ e, i }))
    .filter(({ e }) => e.appId === appId)
    .map(({ e, i }) => ({
      gid: `93000000000000000${String(i + 1).padStart(2, '0')}`,
      event_name: e.title,
      event_type: e.type,
      rtime32_start_time: at(e.startH),
      rtime32_end_time: e.endH === undefined ? 0 : at(e.endH),
      announcement_body: { headline: e.title, language: 2 }
    }))
}
