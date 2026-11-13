import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CS2_GAME_ID } from '@shared/cs2'
import type { CaptureTestResult, CaptureTestStep } from '@shared/types'
import { UserError } from '../errors'
import { gameExeRegex, readProgress, trialArgs, trialsFor, TRIAL_ATTEMPTS, TRIAL_S, type TrialMode } from './captureTestArgs'
import { captureTestContext, clipsLogLine, videoSizeOf } from './clips'
import { scrub } from './editEngineRules'
import { filmEngine } from './editFfmpeg'

// L'essai « capture comme OBS » (bêta 38), lancé depuis Paramètres › Enregistrement pendant une partie : 10 s pour revenir
// dans le jeu, puis chaque méthode filme 10 s avec le moteur vidéo, l'image restant dans la carte graphique
// (captureTestArgs.ts). Le résultat (images par seconde) s'affiche et s'écrit dans le journal des clips ; les vidéos d'essai
// restent dans « Essais capture », dans le dossier des clips. La capture habituelle continue pendant ce temps.
// Bêta 46 : sur un écran plus grand que 1920 × 1080, les deux méthodes gfxcapture sont aussi essayées réduites (la réduction
// intégrée à la capture, pas scale_d3d11). Le résultat donne la taille réelle de l'image, relue dans chaque vidéo d'essai.

const WAIT_S = 10
const TRIAL_TIMEOUT_MS = (TRIAL_S + 25) * 1000
let running = false

const stamp = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runCaptureTest(onStep: (s: CaptureTestStep) => void): Promise<CaptureTestResult> {
  if (running) throw new UserError('Un essai est déjà en cours.')
  if (process.platform !== 'win32') throw new UserError('Cet essai ne marche que sous Windows.')
  if ((await filmEngine.status()) !== 'ready') throw new UserError('Le moteur vidéo manque ou a été modifié. Réinstalle Player X V3 Test pour le remettre.')
  if (!filmEngine.begin()) throw new UserError('Le moteur vidéo est occupé (un film ou un essai). Réessaie après.')
  running = true
  try {
    const ctx = await captureTestContext()
    const dir = join(ctx.folder, 'Essais capture')
    await mkdir(dir, { recursive: true })
    const trials = trialsFor(gameExeRegex(ctx.game, CS2_GAME_ID), ctx.screen)
    for (let s = WAIT_S; s > 0; s--) {
      onStep({ phase: 'wait', seconds: s })
      await sleep(1000)
    }
    const results: CaptureTestResult['trials'] = []
    let attempts = [...TRIAL_ATTEMPTS]
    const MODE_WORD: Record<TrialMode, string> = { gpu: 'tout dans la carte graphique', 'gpu-auto': 'carte graphique, périphérique de la source', copie: 'copie par le processeur avant l’encodeur' }
    for (const [i, t] of trials.entries()) {
      onStep({ phase: 'run', label: t.label, index: i + 1, total: trials.length })
      // Un essai réduit a le même genre que son essai à la taille de l'écran : son nom et son identifiant le distinguent.
      const id = 'scale' in t && t.scale ? `${t.id}-reduit` : t.id
      const name = `Essai ${stamp()} ${id}.mp4`
      const out = join(dir, name)
      let done: CaptureTestResult['trials'][number] | null = null
      let lastErr = ''
      for (const at of attempts) {
        const r = await filmEngine.run(trialArgs(t, ctx.quality, at.encoder, out, at.mode), dir, TRIAL_TIMEOUT_MS, undefined, 'normal')
        const p = readProgress(r.out)
        const size = await stat(out).then((x) => x.size, () => 0)
        if (r.code === 0 && p && p.frames > 0 && size > 0) {
          // La taille réelle de l'image, relue dans la vidéo : c'est elle qui dit si la réduction a eu lieu.
          const image = await videoSizeOf(out)
          done = { id, label: t.label, ok: true, fps: p.fps, frames: p.frames, encoder: `${at.encoder}, ${MODE_WORD[at.mode]}`, file: name, ...(image ?? {}) }
          // Cette manière marche : les essais suivants commencent par elle.
          attempts = [at, ...attempts.filter((x) => x !== at)]
          break
        }
        // Chaque tentative ratée garde son erreur dans le journal : les lignes du moteur une par une (une ligne du journal est
        // coupée au-delà de 400 caractères), sans les lignes de fin qui se répètent.
        const hide = [dir, ctx.folder, ...filmEngine.hidden()]
        const lines = (r.timedOut ? 'pas de réponse' : r.err || `code ${r.code}`)
          .split(/\r?\n/)
          .map((l) => l.replace(/ @ [0-9a-f]{8,}/gi, '').trim())
          .filter((l) => l && !/^(Task finished|Terminating thread)|Terminating thread with return code|Task finished with error code/.test(l))
        const keep = [...new Set(lines)].slice(-8)
        lastErr = scrub(keep[0] || 'échec', hide)
        clipsLogLine(`Essai de capture « ${t.label} », ${at.encoder} (${MODE_WORD[at.mode]}) raté :`)
        for (const l of keep) clipsLogLine(`  ${scrub(l, hide)}`)
      }
      done ??= { id, label: t.label, ok: false, error: (lastErr || 'échec').slice(0, 200) }
      results.push(done)
      clipsLogLine(done.ok ? `Essai de capture « ${t.label} » (${done.encoder}, ${done.width ? `image de ${done.width} × ${done.height}` : 'taille de l’image inconnue'}) : ${done.frames} images en ${TRIAL_S} s, ${done.fps} par seconde.` : `Essai de capture « ${t.label} » : toutes les manières ont raté.`)
    }
    onStep({ phase: 'done' })
    return { game: ctx.game?.name ?? null, seconds: TRIAL_S, trials: results }
  } finally {
    running = false
    filmEngine.end()
  }
}
