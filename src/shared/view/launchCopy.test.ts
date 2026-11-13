// Tests des textes du lancement (npm run test:launch) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DetectMode, LaunchFail, LaunchPhase, LaunchRoute, LaunchStatus } from '../launch'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { announcement, cardCopy, libraryMeta, playCopy, railHint, sheetLine, STORE_FORMS, type PlayState } from './launchCopy.ts'

const T0 = 1_760_000_000_000
const ROUTES: LaunchRoute[] = ['steam', 'epic', 'ea', 'exe']
const PHASES: LaunchPhase[] = ['sending', 'waiting', 'relay', 'running', 'early-exit', 'gave-up', 'failed', 'already', 'resent', 'untracked']
const REASONS: (LaunchFail | undefined)[] = ['no-handler', 'exe-missing', 'no-target', 'not-found', 'other', undefined]
const DETECTS: DetectMode[] = ['fast', 'poll', 'none']
/** Instants après le clic : envoi, envoi bloqué, relais, attente, longue attente. */
const AGES = [0, 5_000, 6_000, 20_000, 95_000, 299_000]
const NAME = 'Need for Speed™ Unbound'

const status = (o: Partial<LaunchStatus>): LaunchStatus => ({
  launchId: 'l1',
  gameId: 'g1',
  route: 'steam',
  phase: 'sending',
  detect: 'fast',
  via: 'play',
  rev: 1,
  clickAt: T0,
  ...o
})

/** Toutes les combinaisons utiles : phase × palier × route × store ouvert × suivi × lien connu × démo. */
function* every(): Generator<{ s: LaunchStatus; now: number }> {
  for (const phase of PHASES)
    for (const route of ROUTES)
      for (const age of AGES)
        for (const detect of DETECTS)
          for (const storeWasOpen of [true, false, null])
            for (const handler of [true, false, null])
              for (const demo of [false, true])
                for (const reason of phase === 'failed' ? REASONS : [undefined])
                  for (const steamUpdating of route === 'steam' && phase === 'waiting' ? [false, true] : [false]) {
                    const handed = phase !== 'sending'
                    const s = status({
                      phase,
                      route,
                      detect,
                      storeWasOpen,
                      handler,
                      steamUpdating,
                      reason,
                      detail: reason ? 'Failed to open: 0x80070002' : undefined,
                      ...(demo ? { demo: true as const } : {}),
                      ...(handed ? { handedAt: T0 + 300 } : {}),
                      ...(phase === 'running' || phase === 'early-exit' || phase === 'relay' ? { detectedAt: T0 + 24_000 } : {}),
                      ...(phase === 'early-exit' || phase === 'relay' ? { goneAt: T0 + 31_000 } : {}),
                      ...(phase === 'already' ? { runningSince: T0 - 3_600_000 } : {})
                    })
                    yield { s, now: T0 + age }
                  }
}

/** Les textes utilisent des espaces insécables (« 24 s », « ! ») : comparés ici en espaces simples. */
const plain = (s: string | null | undefined): string | null | undefined => s?.replace(/\u00a0/g, ' ')

const FORBIDDEN = [/\bvous\b/i, /%/, /Failed/, /Préparation du jeu/, /app EA/, /Electron/, /undefined/, /NaN/]

test('carte : surtitre et détail jamais vides, dans leur budget, sans anglais ni « vous »', () => {
  let n = 0
  for (const { s, now } of every()) {
    const c = cardCopy(s, { name: NAME, now })
    const where = `${s.phase}/${s.route}/${now - T0}ms/${s.detect}/${String(s.storeWasOpen)}/${String(s.handler)}/${s.demo ? 'démo' : ''}/${s.reason ?? ''}`
    assert.ok(c.kicker.length > 0, `surtitre vide : ${where}`)
    assert.ok(c.sub.length > 0, `détail vide : ${where}`)
    assert.ok(c.kicker.length <= 30, `surtitre trop long (${c.kicker.length}) : ${c.kicker}`)
    const budget = !c.action ? 60 : c.action.kind === 'relaunch' ? 32 : 42
    assert.ok(c.sub.length <= budget, `détail trop long (${c.sub.length} > ${budget}) : ${c.sub} · ${where}`)
    for (const bad of FORBIDDEN) {
      assert.equal(bad.test(c.kicker), false, `${bad} dans « ${c.kicker} »`)
      assert.equal(bad.test(c.sub), false, `${bad} dans « ${c.sub} »`)
    }
    assert.ok(c.closeLabel.length > 0 && c.groupLabel === `Lancement de ${NAME}`)
    n++
  }
  assert.ok(n > 5_000)
})

test('carte : les paliers suivent le temps (envoi, envoi bloqué, relais, attente, longue attente)', () => {
  const at = (phase: LaunchPhase, age: number, o: Partial<LaunchStatus> = {}): string =>
    cardCopy(status({ phase, handedAt: phase === 'sending' ? undefined : T0, ...o }), { name: NAME, now: T0 + age }).kicker
  assert.equal(at('sending', 0), 'Lancement')
  assert.equal(cardCopy(status({}), { name: NAME, now: T0 }).sub, 'Envoi à Steam…')
  assert.equal(cardCopy(status({}), { name: NAME, now: T0 + 5_000 }).sub, 'Windows n’a pas encore transmis le lien')
  assert.equal(cardCopy(status({ handler: false }), { name: NAME, now: T0 + 5_000 }).sub, 'Windows te demande peut-être quelle appli utiliser')
  assert.equal(at('waiting', 14_999), 'Envoyé à Steam')
  assert.equal(at('waiting', 15_000), 'En attente du jeu')
  assert.equal(at('waiting', 90_000), 'Toujours en attente')
  assert.equal(at('waiting', 1_000, { route: 'exe' }), 'Exécutable ouvert')
  assert.equal(plain(cardCopy(status({ phase: 'waiting', handedAt: T0, detect: 'poll' }), { name: NAME, now: T0 + 1 }).sub), 'Vérification à 20 s, 45 s, puis chaque minute')
  assert.equal(plain(cardCopy(status({ phase: 'running', handedAt: T0, detectedAt: T0 + 24_000 }), { name: NAME, now: T0 + 25_000 }).sub), 'Détecté après 24 s · bonne partie !')
})

test('EA app : toujours « l’EA app », au féminin', () => {
  assert.equal(STORE_FORMS.ea.to, 'à l’EA app')
  assert.equal(STORE_FORMS.ea.of, 'de l’EA app')
  assert.ok(STORE_FORMS.ea.feminine)
  const sending = cardCopy(status({ route: 'ea' }), { name: NAME, now: T0 })
  assert.equal(sending.sub, 'Envoi à l’EA app…')
  const relais = cardCopy(status({ route: 'ea', phase: 'waiting', handedAt: T0 }), { name: NAME, now: T0 + 1_000 })
  assert.equal(relais.kicker, 'Envoyé à l’EA app')
  assert.equal(relais.sub, 'L’EA app peut ouvrir sa propre fenêtre avant le jeu')
  const closed = cardCopy(status({ route: 'ea', phase: 'waiting', handedAt: T0, storeWasOpen: false }), { name: NAME, now: T0 + 1_000 })
  assert.equal(closed.sub, 'L’EA app semblait fermée · elle peut ouvrir sa fenêtre')
  const failed = cardCopy(status({ route: 'ea', phase: 'failed', reason: 'no-handler', detail: 'x' }), { name: NAME, now: T0 })
  assert.equal(failed.sub, 'Le lien de l’EA app n’a pas pu s’ouvrir')
  assert.ok(failed.subTitle.startsWith('Vérifie que l’EA app est installée.'))
})

test('échec : le message de Windows reste dans l’infobulle, jamais dans la carte', () => {
  const c = cardCopy(status({ phase: 'failed', reason: 'other', detail: 'Failed to open: boom' }), { name: NAME, now: T0 })
  assert.equal(c.sub, 'Le lancement a échoué')
  assert.ok(c.subTitle.includes('Failed to open: boom'))
  assert.equal(c.action?.label, 'Réessayer')
  assert.equal(cardCopy(status({ phase: 'failed', reason: 'exe-missing', route: 'exe' }), { name: NAME, now: T0 }).action?.kind, 'rescan')
  assert.equal(cardCopy(status({ phase: 'failed', reason: 'no-target' }), { name: NAME, now: T0 }).action, null)
})

test('annonces : une phrase finie par un point, rien pour le relais ni le compteur', () => {
  for (const { s, now } of every()) {
    const prevs: (LaunchStatus | null)[] = [null, { ...s, phase: 'sending' }, { ...s, phase: 'waiting' }, { ...s, phase: 'relay' }]
    for (const prev of prevs) {
      const a = announcement(prev, s, NAME, now)
      if (a === null) continue
      assert.ok(/[.!]$/.test(a), `annonce sans point : ${a}`)
      for (const bad of FORBIDDEN) assert.equal(bad.test(a), false, `${bad} dans « ${a} »`)
    }
  }
  const relay = status({ phase: 'relay', handedAt: T0 })
  assert.equal(announcement(status({ phase: 'waiting', handedAt: T0 }), relay, NAME), null)
  // Même phase, rien de neuf : rien n'est lu (le compteur ne l'est jamais).
  const w = status({ phase: 'waiting', handedAt: T0 })
  assert.equal(announcement(w, { ...w, rev: 2 }, NAME), null)
  assert.equal(announcement(status({}), w, NAME), `${NAME} envoyé à Steam.`)
  assert.equal(announcement(status({ route: 'ea' }), { ...w, route: 'ea' }, NAME), `${NAME} envoyé à l’EA app. Elle peut ouvrir sa propre fenêtre.`)
  assert.equal(announcement(w, { ...w, steamUpdating: true }, NAME), `Steam indique une mise à jour de ${NAME}.`)

  // « 1 seconde » au singulier, « 3 secondes » au pluriel.
  const run = status({ phase: 'running', handedAt: T0, detectedAt: T0 + 2_000 })
  const gone = (ms: number): string | null | undefined => plain(announcement(run, { ...run, phase: 'early-exit', goneAt: T0 + 2_000 + ms }, NAME))
  assert.equal(gone(900), `${NAME} s’est fermé 1 seconde après avoir été détecté.`)
  assert.equal(gone(3_200), `${NAME} s’est fermé 3 secondes après avoir été détecté.`)
})

test('mode démo : le texte le dit toujours, jamais de faux « En jeu »', () => {
  const d = (phase: LaunchPhase): string => cardCopy(status({ phase, demo: true, handedAt: T0 }), { name: NAME, now: T0 + 1_000 }).kicker
  assert.equal(d('sending'), 'Mode démo · Lancement')
  assert.equal(d('waiting'), 'Mode démo · En attente du jeu')
  assert.equal(d('running'), 'Mode démo · En jeu')
  assert.equal(playCopy('demo-running', NAME).label, 'Démo · en jeu')
  assert.equal(libraryMeta('demo-running', 'steam'), 'Démo · en jeu')
  // Un échec en démo (l'IPC a rejeté) se dit comme un échec, pas « En attente du jeu ».
  const failed = cardCopy(status({ phase: 'failed', reason: 'other', demo: true }), { name: NAME, now: T0 })
  assert.equal(failed.kicker, 'Lancement impossible')
  assert.equal(failed.closeLabel, 'Fermer')
  // × pendant l'attente (A9) et échec (A7) : lus aussi en démo.
  const waiting = status({ phase: 'waiting', demo: true, handedAt: T0 })
  assert.equal(announcement(waiting, { ...waiting, phase: 'cancelled', rev: 2 }, NAME), `Player X n’attend plus ${NAME}.`)
  assert.equal(plain(announcement(waiting, { ...waiting, phase: 'failed', reason: 'other', rev: 2 }, NAME)), `Impossible de lancer ${NAME} : le lancement a échoué.`)
  assert.equal(announcement(status({ demo: true }), { ...waiting, rev: 2 }, NAME)?.startsWith('Mode démo'), true)
  assert.equal(announcement(waiting, { ...waiting, rev: 2 }, NAME), null)
})

test('annonces : « Player X » garde sa majuscule au milieu de A7', () => {
  const a = announcement(null, status({ phase: 'failed', reason: 'no-target' }), 'Hades')
  assert.equal(plain(a), 'Impossible de lancer Hades : Player X ne sait pas lancer ce jeu.')
  assert.equal(plain(announcement(null, status({ phase: 'failed', reason: 'not-found' }), 'Hades')), 'Impossible de lancer Hades : ce jeu n’est plus dans ta bibliothèque.')
})

test('boutons, méta, rail et fiche', () => {
  const states: PlayState[] = ['idle', 'sending', 'checking', 'pending', 'running', 'demo-running']
  for (const st of states) {
    const c = playCopy(st, NAME)
    assert.ok(c.label && c.ariaLabel && c.title)
    assert.ok(railHint(st).includes('clic droit : fiche'))
  }
  assert.equal(playCopy('idle', NAME).ariaLabel, `Jouer à ${NAME}`)
  assert.equal(libraryMeta('pending', 'epic'), 'En attente · Epic Games')
  assert.equal(libraryMeta('pending', 'ea'), 'En attente · EA app')
  assert.equal(libraryMeta('pending', 'exe'), 'En attente · exécutable')
  assert.equal(libraryMeta('idle', 'steam'), null)
  const line = sheetLine(status({ phase: 'waiting', handedAt: T0 }), { name: NAME, now: T0 + 7_000 })
  assert.equal(line?.text, 'Steam peut ouvrir sa propre fenêtre avant le jeu · 0:07')
  assert.equal(line?.icon, 'clock')
  assert.equal(sheetLine(status({ phase: 'running', handedAt: T0 }), { name: NAME, now: T0 }), null)
  const failed = sheetLine(status({ phase: 'failed', reason: 'other' }), { name: NAME, now: T0 })
  assert.equal(failed?.text, 'Lancement impossible · Le lancement a échoué')
  assert.equal(failed?.tone, 'danger')
  // Déjà en jeu : la carte est sous le voile de la fiche, la ligne reprend « Relancer quand même ».
  const already = sheetLine(status({ phase: 'already', handedAt: T0 }), { name: NAME, now: T0 })
  assert.equal(already?.text, 'Déjà en jeu · Il tourne déjà sur ce PC')
  assert.equal(already?.action?.kind, 'relaunch')
  assert.equal(already?.action?.label, 'Relancer quand même')
  // Démo : la partie simulée est dite dans la fiche (pas de « Partie en cours »).
  assert.equal(sheetLine(status({ phase: 'running', demo: true, handedAt: T0 }), { name: NAME, now: T0 })?.text, 'Mode démo · Partie simulée · rien ne tourne vraiment')
  assert.equal(sheetLine(status({ phase: 'waiting', demo: true, handedAt: T0 }), { name: NAME, now: T0 })?.text, 'Mode démo · Simulation · rien n’est lancé sur ton PC')
  assert.equal(sheetLine(status({ phase: 'ended', demo: true, handedAt: T0 }), { name: NAME, now: T0 }), null)
  assert.equal(sheetLine(status({ phase: 'failed', reason: 'other', demo: true }), { name: NAME, now: T0 })?.tone, 'danger')
})
