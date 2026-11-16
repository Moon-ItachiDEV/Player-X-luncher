// Tous les textes du lancement (spec launch-sequence.md §4) : carte, boutons, fiche, annonces lues.
// Ce qui est une supposition est écrit avec « peut » ou « pas encore ». Jamais de pourcentage, ni de durée prévue,
// ni de message de Windows ou d'Electron en anglais dans la carte (seulement dans une infobulle).
import type { LaunchRoute, LaunchStatus } from '../launch'
import { bucket, fmtDetected, fmtElapsed, isPending, type PlayState } from './launchPhase'

const NB = ' '
/** « texte » avec les espaces insécables. */
const q = (s: string): string => `«${NB}${s}${NB}»`

interface StoreForm {
  /** Sujet en début de phrase : « Steam », « L’EA app ». */
  subject: string
  /** « à Steam », « à l’EA app ». */
  to: string
  /** « de Steam », « d’Epic Games ». */
  of: string
  /** Accord : l'EA app est une application. */
  feminine: boolean
}

/** Mêmes noms que STORE_LONG (components/ui/StoreTag.tsx) : « Epic Games », « EA app ». */
export const STORE_FORMS: Record<Exclude<LaunchRoute, 'exe'>, StoreForm> = {
  steam: { subject: 'Steam', to: 'à Steam', of: 'de Steam', feminine: false },
  epic: { subject: 'Epic Games', to: 'à Epic Games', of: 'd’Epic Games', feminine: false },
  ea: { subject: 'L’EA app', to: 'à l’EA app', of: 'de l’EA app', feminine: true },
  gog: { subject: 'GOG', to: 'à GOG', of: 'de GOG', feminine: false }
}

/** Nom court affiché après « En attente · » (bibliothèque). */
const ROUTE_SHORT: Record<LaunchRoute, string> = { steam: 'Steam', epic: 'Epic Games', ea: 'EA app', gog: 'GOG', exe: 'exécutable' }

/** « l’EA app » au milieu d'une phrase. */
const lower = (subject: string): string => (subject.startsWith('L’') ? `l’${subject.slice(2)}` : subject)

// ---------- carte ----------

/** Couleur de la carte : filet à gauche et surtitre. */
export type Tone = 'accent' | 'dim' | 'live' | 'muted' | 'warning' | 'danger'

export interface CardAction {
  label: 'Réessayer' | 'Réanalyser' | 'Relancer quand même'
  kind: 'retry' | 'rescan' | 'relaunch'
}

export interface CardCopy {
  kicker: string
  sub: string
  /** Texte complet de l'infobulle du détail. */
  subTitle: string
  action: CardAction | null
  /** × : « Ne plus attendre X » pendant l'attente, « Fermer » ensuite. */
  closeLabel: string
  groupLabel: string
  tone: Tone
  /** Point cyan devant le surtitre (jeu détecté). */
  live: boolean
}

const RETRY: CardAction = { label: 'Réessayer', kind: 'retry' }
const RESCAN: CardAction = { label: 'Réanalyser', kind: 'rescan' }
const RELAUNCH: CardAction = { label: 'Relancer quand même', kind: 'relaunch' }

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Surtitre une fois le lien parti : « Envoyé à Steam », « Exécutable ouvert ». */
function sentKicker(route: LaunchRoute): string {
  return route === 'exe' ? 'Exécutable ouvert' : `Envoyé ${STORE_FORMS[route].to}`
}

function sendingSub(route: LaunchRoute): string {
  return route === 'exe' ? 'Ouverture de l’exécutable…' : `Envoi ${STORE_FORMS[route].to}…`
}

function relaisSub(s: LaunchStatus): string {
  if (s.route === 'exe') return 'Le jeu peut mettre quelques secondes à s’afficher'
  const f = STORE_FORMS[s.route]
  if (s.storeWasOpen === false) {
    if (s.route === 'steam') return 'Steam semblait fermé · il peut mettre un moment à s’ouvrir'
    if (s.route === 'epic') return 'Epic Games semblait fermé · il peut mettre un moment'
    return 'L’EA app semblait fermée · elle peut ouvrir sa fenêtre'
  }
  return `${f.subject} peut ouvrir sa propre fenêtre avant le jeu`
}

const WAITING_SUB: Record<LaunchRoute, string> = {
  steam: 'Steam peut d’abord mettre à jour ou synchroniser',
  epic: 'Epic Games peut d’abord synchroniser tes sauvegardes',
  ea: 'L’EA app peut d’abord vérifier ou mettre à jour le jeu',
  gog: 'Certains jeux mettent du temps à démarrer',
  exe: 'Certains jeux mettent du temps à démarrer'
}

function slowSub(route: LaunchRoute): string {
  return route === 'exe' ? 'Pas encore détecté · regarde ta barre des tâches' : `Pas encore détecté · regarde la fenêtre ${STORE_FORMS[route].of}`
}

const POLL_SUB = `Vérification à 20${NB}s, 45${NB}s, puis chaque minute`

function failedCopy(s: LaunchStatus): { sub: string; subTitle: string; action: CardAction | null } {
  const detail = s.detail ? `Windows${NB}: ${s.detail}` : ''
  switch (s.reason) {
    case 'no-handler': {
      if (s.route === 'exe') break
      const f = STORE_FORMS[s.route]
      const sub = `Le lien ${f.of} n’a pas pu s’ouvrir`
      const check = `Vérifie que ${lower(f.subject)} est installé${f.feminine ? 'e' : ''}.`
      return { sub, subTitle: [check, detail].filter(Boolean).join(' '), action: RETRY }
    }
    case 'exe-missing':
      return { sub: 'Exécutable introuvable sur ce PC', subTitle: 'Il a peut-être été déplacé ou supprimé.', action: RESCAN }
    case 'no-target':
      return { sub: 'Player X ne sait pas lancer ce jeu', subTitle: 'Player X ne sait pas lancer ce jeu', action: null }
    case 'not-found':
      return { sub: 'Ce jeu n’est plus dans ta bibliothèque', subTitle: 'Ce jeu n’est plus dans ta bibliothèque', action: null }
  }
  return { sub: 'Le lancement a échoué', subTitle: detail || 'Le lancement a échoué', action: RETRY }
}

/** Abandon d'un envoi que Windows n'a jamais confirmé (l'exécutable n'a pas de lien). */
const stalledGaveUp = (route: LaunchRoute): string => (route === 'exe' ? 'Windows n’a pas démarré le jeu en 5 min' : 'Windows n’a pas transmis le lien en 5 min')

/** Les lignes de la carte d'un lancement, à l'instant `now`. */
export function cardCopy(s: LaunchStatus, o: { name: string; now: number }): CardCopy {
  const pending = isPending(s.phase)
  const base = { closeLabel: pending ? `Ne plus attendre ${o.name}` : 'Fermer', groupLabel: `Lancement de ${o.name}`, live: false }
  const done = (kicker: string, sub: string, tone: Tone, extra: Partial<CardCopy> = {}): CardCopy => ({
    ...base,
    kicker,
    sub,
    subTitle: sub,
    action: null,
    tone,
    ...extra
  })

  // Démo : seulement ce qu'elle simule (attente, partie) ; un échec ou une fin se disent comme d'habitude.
  if (s.demo && (pending || s.phase === 'running')) {
    if (s.phase === 'running') return done('Mode démo · En jeu', 'Partie simulée · rien ne tourne vraiment', 'live', { live: true })
    const kicker = s.phase === 'sending' ? 'Mode démo · Lancement' : 'Mode démo · En attente du jeu'
    return done(kicker, 'Simulation · rien n’est lancé sur ton PC', 'muted')
  }

  const b = bucket(s, o.now)
  switch (b) {
    case 'sending':
      return done('Lancement', sendingSub(s.route), 'accent')
    case 'stalled': {
      const sub =
        s.handler === false
          ? 'Windows te demande peut-être quelle appli utiliser'
          : s.route === 'exe'
            ? 'Windows n’a pas encore ouvert le jeu'
            : 'Windows n’a pas encore transmis le lien'
      return done('Lancement', sub, 'accent')
    }
    case 'relais':
    case 'waiting':
    case 'slow': {
      if (s.steamUpdating) return done('Mise à jour Steam', 'Steam indique une mise à jour de ce jeu', 'accent')
      const kicker = b === 'relais' ? sentKicker(s.route) : b === 'waiting' ? 'En attente du jeu' : 'Toujours en attente'
      const sub = s.detect === 'poll' ? POLL_SUB : b === 'relais' ? relaisSub(s) : b === 'waiting' ? WAITING_SUB[s.route] : slowSub(s.route)
      return done(kicker, sub, b === 'slow' ? 'dim' : 'accent')
    }
    case 'relay':
      return done('En attente du jeu', 'Un programme du jeu s’est fermé · un autre peut suivre', 'accent')
    case 'running': {
      const after = s.detectedAt !== undefined ? `Détecté après ${fmtDetected(s.detectedAt - s.clickAt)} · ` : ''
      return done('En jeu', `${after}bonne partie${NB}!`, 'live', { live: true })
    }
    case 'already': {
      const sub = s.runningSince ? `Tourne sur ce PC depuis ${timeFmt.format(s.runningSince)}` : 'Il tourne déjà sur ce PC'
      return done('Déjà en jeu', sub, 'live', { live: true, action: RELAUNCH })
    }
    case 'resent': {
      const tail = s.route === 'exe' ? 'rien n’a été fermé' : `${lower(STORE_FORMS[s.route].subject)} décide de la suite`
      return done('Lien renvoyé', `Le jeu semblait déjà tourner · ${tail}`, 'muted')
    }
    case 'untracked':
      return done(sentKicker(s.route), 'Détection du jeu disponible sous Windows seulement', 'muted')
    case 'early-exit': {
      const n = Math.max(1, Math.round(((s.goneAt ?? o.now) - (s.detectedAt ?? s.clickAt)) / 1000))
      return done('Jeu fermé', `Fermé ${n}${NB}s après avoir été détecté`, 'warning', { action: RETRY })
    }
    case 'failed': {
      const f = failedCopy(s)
      return { ...base, kicker: 'Lancement impossible', sub: f.sub, subTitle: f.subTitle, action: f.action, tone: 'danger' }
    }
    case 'gave-up': {
      const sub = s.handedAt === undefined ? stalledGaveUp(s.route) : `Pas vu en 5 min · ${q('En jeu')} s’affichera s’il démarre`
      return done('Jeu non détecté', sub, 'muted')
    }
    case 'ended':
    case 'cancelled':
      return done('', '', 'muted')
  }
}

/** Compteur de la carte (« 0:07 »), seulement pendant l'attente et à partir de 3 s. */
export function elapsedLabel(s: LaunchStatus, now: number, fromMs: number): string | null {
  if (!isPending(s.phase)) return null
  const ms = now - s.clickAt
  return ms >= fromMs ? fmtElapsed(ms) : null
}

// ---------- boutons ----------

export type { PlayState }

export interface PlayCopy {
  label: string
  ariaLabel: string
  title: string
}

export function playCopy(state: PlayState, name: string): PlayCopy {
  switch (state) {
    case 'sending':
      return { label: 'Lancement…', ariaLabel: `Lancement de ${name}…`, title: 'Lancement…' }
    case 'checking':
      return { label: 'Vérification…', ariaLabel: `Vérification de ${name}…`, title: 'Vérification…' }
    case 'pending':
      return { label: 'En attente…', ariaLabel: `${name}${NB}: en attente du jeu. Afficher le suivi`, title: 'Afficher le suivi du lancement' }
    case 'running':
      return { label: 'En jeu', ariaLabel: `${name} est en jeu`, title: 'Tourne sur ce PC' }
    case 'demo-running':
      return { label: 'Démo · en jeu', ariaLabel: `Mode démo${NB}: partie simulée de ${name}`, title: 'Mode démo : rien ne tourne vraiment' }
    default:
      return { label: 'Jouer', ariaLabel: `Jouer à ${name}`, title: 'Jouer' }
  }
}

/** Méta d'une jaquette de la bibliothèque pendant un lancement (null : la méta habituelle). */
export function libraryMeta(state: PlayState, route: LaunchRoute | null): string | null {
  if (state === 'sending' || state === 'checking') return state === 'sending' ? 'Lancement…' : 'Vérification…'
  if (state === 'pending') return `En attente · ${ROUTE_SHORT[route ?? 'exe']}`
  if (state === 'demo-running') return 'Démo · en jeu'
  return null
}

/** Ligne d'aide de l'infobulle du rail des favoris. */
export function railHint(state: PlayState): string {
  switch (state) {
    case 'sending':
    case 'checking':
      return 'Lancement… · clic droit : fiche'
    case 'pending':
      return 'En attente… · clic droit : fiche'
    case 'running':
      return 'En jeu · clic droit : fiche'
    default:
      return 'Clic : jouer · clic droit : fiche'
  }
}

// ---------- ligne de la fiche ----------

export interface SheetLine {
  text: string
  tone: 'muted' | 'danger'
  icon: 'clock' | 'alert-circle' | null
  action: CardAction | null
}

/** Ligne sous « Jouer » dans la fiche (null : rien à dire, ou « Partie en cours » est déjà affiché). */
export function sheetLine(s: LaunchStatus, o: { name: string; now: number }): SheetLine | null {
  if (s.silent || s.phase === 'cancelled' || s.phase === 'ended') return null
  const c = cardCopy(s, o)
  // Démo : « Partie en cours » n'apparaît jamais dans la fiche, la ligne dit la partie simulée.
  if (s.demo && (isPending(s.phase) || s.phase === 'running')) return { text: `Mode démo · ${c.sub}`, tone: 'muted', icon: null, action: null }
  if (s.phase === 'running') return null
  // La carte est sous le voile de la fiche : son « Relancer quand même » est repris ici (un faux « En jeu » ne bloque jamais).
  if (s.phase === 'already') return { text: `Déjà en jeu · ${c.sub}`, tone: 'muted', icon: null, action: c.action }
  if (s.phase === 'failed') return { text: `Lancement impossible · ${c.sub}`, tone: 'danger', icon: 'alert-circle', action: c.action }
  if (s.phase === 'early-exit') return { text: `Jeu fermé · ${c.sub}`, tone: 'muted', icon: null, action: c.action }
  if (s.phase === 'gave-up') return { text: `Jeu non détecté · ${c.sub}`, tone: 'muted', icon: null, action: null }
  if (s.phase === 'sending') return { text: c.sub, tone: 'muted', icon: null, action: null }
  if (isPending(s.phase)) return { text: `${c.sub} · ${fmtElapsed(o.now - s.clickAt)}`, tone: 'muted', icon: 'clock', action: null }
  return { text: c.sub, tone: 'muted', icon: null, action: null }
}

// ---------- annonces (région polie, changements de phase seulement) ----------

/** Phrase lue au début d'un lancement (A1), au clic. */
export const clickAnnouncement = (name: string): string => `Lancement de ${name}.`
/** Clic sur un jeu déjà en cours de lancement (A11). */
export const pendingAnnouncement = (name: string): string => `${name} est déjà en cours de lancement.`
/** Le lancement entre dans « Toujours en attente » (A3, 90 s). */
export const slowAnnouncement = (name: string): string => `${name} n’est toujours pas détecté.`

function sentAnnouncement(s: LaunchStatus, name: string): string {
  if (s.route === 'exe') return `Exécutable de ${name} ouvert.`
  if (s.route === 'ea') return `${name} envoyé à l’EA app. Elle peut ouvrir sa propre fenêtre.`
  return `${name} envoyé ${STORE_FORMS[s.route].to}.`
}

/** Annonce d'un changement (null : rien à lire). `prev` est l'état d'avant, ou null pour un lancement tout neuf. */
export function announcement(prev: LaunchStatus | null, next: LaunchStatus, name: string, now = Date.now()): string | null {
  if (next.silent) return null
  const phaseChanged = !prev || prev.phase !== next.phase
  if (next.demo) {
    if (!phaseChanged) return null
    if (next.phase === 'waiting') return `Mode démo${NB}: ${name} serait lancé. Rien n’est lancé sur ton PC.`
    if (next.phase === 'running') return `Mode démo${NB}: partie simulée de ${name}.`
    if (next.phase === 'ended') return `Mode démo${NB}: partie simulée terminée.`
    // × pendant l'attente (A9) et échec (A7) : lus comme hors démo.
    if (next.phase !== 'cancelled' && next.phase !== 'failed') return null
  }
  if (!phaseChanged) {
    if (next.phase === 'waiting' && next.steamUpdating && !prev?.steamUpdating) return `Steam indique une mise à jour de ${name}.`
    return null
  }
  switch (next.phase) {
    case 'waiting':
      // Retour d'un relais : rien de neuf à lire.
      return prev?.phase === 'relay' ? null : sentAnnouncement(next, name)
    case 'running':
      return `${name} est en jeu.`
    case 'ended':
      return `${name} s’est fermé.`
    case 'early-exit': {
      const n = Math.max(1, Math.round(((next.goneAt ?? now) - (next.detectedAt ?? next.clickAt)) / 1000))
      return `${name} s’est fermé ${n}${NB}seconde${n > 1 ? 's' : ''} après avoir été détecté.`
    }
    case 'failed': {
      const sub = failedCopy(next).sub
      // Minuscule en milieu de phrase, sauf pour le nom de l'appli (« Player X ne sait pas lancer ce jeu »).
      const head = sub.startsWith('Player X') ? sub : `${sub.charAt(0).toLowerCase()}${sub.slice(1)}`
      return `Impossible de lancer ${name}${NB}: ${head}.`
    }
    case 'gave-up':
      // Resté bloqué à l'envoi : c'est Windows qui n'a rien fait, pas le jeu qui manque.
      if (next.handedAt === undefined) return next.route === 'exe' ? `Windows n’a pas démarré ${name} en 5${NB}minutes.` : `Windows n’a pas transmis le lien de ${name} en 5${NB}minutes.`
      return `${name} n’a pas été détecté en 5${NB}minutes.`
    case 'cancelled':
      return `Player X n’attend plus ${name}.`
    case 'already':
      return `${name} tourne déjà. Passe dessus avec Alt+Tab, ou relance-le quand même.`
    case 'resent':
      return `Lien renvoyé${NB}: ${name} semblait déjà tourner.`
    case 'untracked':
      return `${sentAnnouncement(next, name).replace(/ Elle peut ouvrir sa propre fenêtre\.$/, '')} Détection disponible sous Windows seulement.`
    default:
      // sending (déjà annoncé au clic), relay (pas annoncé).
      return null
  }
}
