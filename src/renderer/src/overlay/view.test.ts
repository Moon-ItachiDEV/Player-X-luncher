// Overlay CS2 (npm run test:overlay) : la pièce montrée selon le réglage, le match et l'horloge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Cs2Live, Cs2OverlayConfig } from '@shared/types'
import { buyAdvice, endSecondsLeft, lossBonusMin, pickView, previewView, sampleCs2Recap, sampleLive } from './view'

const cfg = (c: Partial<Cs2OverlayConfig> = {}): Cs2OverlayConfig => ({ style: 'c', hidden: false, hotkey: 'Alt+X', ...c })
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

test('aperçu : la pastille passe d’une élim. à un triplé au même round', () => {
  const at = 1_000_000
  const a = previewView(at, at + 6_000), b = previewView(at, at + 9_000)
  assert.equal(a?.kind, 'pill')
  assert.equal(b?.kind, 'pill')
  assert.equal(a?.kind === 'pill' && a.live.roundKills, 1)
  assert.equal(b?.kind === 'pill' && b.live.roundKills, 3)
  assert.equal(a?.kind === 'pill' && b?.kind === 'pill' && a.live.round === b.live.round, true)
})

test('conseil d’achat : complet, presque, force, éco selon le camp', () => {
  assert.equal(buyAdvice(4300, 'CT').kind, 'full')
  assert.equal(buyAdvice(4250, 'CT').kind, 'almost')
  assert.match(buyAdvice(4250, 'CT').detail, /50\u00a0\$ pour le kit/)
  assert.equal(buyAdvice(3700, 'T').kind, 'full')
  assert.equal(buyAdvice(3000, 'CT').kind, 'force')
  assert.equal(buyAdvice(1999, 'T').kind, 'eco')
})

test('bonus de défaite minimum : série en cours, mi-temps et prolongation sans annonce', () => {
  const r = (n: number, won: boolean, side: 'CT' | 'T' = 'CT') => ({ n, winner: won ? side : side === 'CT' ? 'T' : 'CT', end: 'elimination', side }) as const
  assert.equal(lossBonusMin([r(1, true), r(2, true)], 3), 1400)
  assert.equal(lossBonusMin([r(1, true), r(2, false), r(3, false)], 4), 2400)
  assert.equal(lossBonusMin([1, 2, 3, 4, 5, 6, 7].map((n) => r(n, false)), 8), 3400)
  assert.equal(lossBonusMin([], 12), null)
  assert.equal(lossBonusMin([], 24), null)
  assert.equal(lossBonusMin([], 25), null)
  // la série ne déborde pas sur l'autre mi-temps
  assert.equal(lossBonusMin([r(11, false), r(12, false), r(13, false, 'T')], 14), 1900)
})
