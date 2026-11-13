// Overlay CS2 (npm run test:overlay) : la pièce montrée selon le réglage, le match et l'horloge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Cs2Live, Cs2OverlayConfig } from '@shared/types'
import { endSecondsLeft, pickView, previewView, sampleCs2Recap, sampleLive } from './view'

const cfg = (c: Partial<Cs2OverlayConfig> = {}): Cs2OverlayConfig => ({ style: 'b', hidden: false, hotkey: 'Alt+X', ...c })
const live = (l: Partial<Cs2Live> = {}): Cs2Live => ({ ...sampleLive('pill'), ...l })

test('aperçu : achat, pastille, mi-temps, bilan, 6 s chacun, puis rien', () => {
  const at = 1_000_000
  const kinds = [0, 5_999, 6_000, 11_999, 12_000, 17_999, 18_000, 23_999, 24_000].map((t) => previewView(at, at + t)?.kind ?? null)
  assert.deepEqual(kinds, ['buy', 'buy', 'pill', 'pill', 'half', 'half', 'end', 'end', null])
})

test('coupé, masqué : rien ; aperçu prioritaire sur le match', () => {
  const now = Date.now()
  assert.equal(pickView(cfg({ style: 'off' }), live(), null, now), null)
  assert.equal(pickView(cfg({ hidden: true }), live(), null, now), null)
  assert.equal(pickView(cfg({ previewAt: now }), live(), null, now)?.kind, 'buy')
})

test('match : temps d’achat, round, mi-temps, échauffement', () => {
  const now = Date.now()
  assert.equal(pickView(cfg(), live({ roundPhase: 'freezetime' }), null, now)?.kind, 'buy')
  assert.equal(pickView(cfg(), live({ roundPhase: 'live', health: 0 }), null, now)?.kind, 'pill')
  assert.equal(pickView(cfg(), live({ roundPhase: 'over' }), null, now)?.kind, 'pill')
  assert.equal(pickView(cfg(), live({ phase: 'intermission' }), null, now)?.kind, 'half')
  assert.equal(pickView(cfg(), live({ phase: 'warmup' }), null, now), null)
  assert.equal(pickView(cfg(), null, null, now), null)
})

test('bilan : 20 s après la fin, seulement match fini ou fermé', () => {
  const now = Date.now()
  const end = { ...sampleCs2Recap(), endedAt: now - 5_000 }
  assert.equal(pickView(cfg(), null, end, now)?.kind, 'end')
  assert.equal(pickView(cfg(), live({ phase: 'gameover' }), end, now)?.kind, 'end')
  assert.equal(pickView(cfg(), live({ phase: 'live' }), end, now)?.kind, 'pill')
  assert.equal(pickView(cfg(), null, end, now + 15_000), null)
  assert.equal(endSecondsLeft(cfg(), end, now), 15)
  assert.equal(endSecondsLeft(cfg(), end, now + 200), 15)
  assert.equal(endSecondsLeft(cfg(), end, now + 30_000), 0)
  // Aperçu : le bilan commence à 18 s et compte depuis 20.
  assert.equal(endSecondsLeft(cfg({ previewAt: now - 18_000 }), end, now), 20)
  assert.equal(endSecondsLeft(cfg({ previewAt: now - 21_500 }), end, now), 17)
})
