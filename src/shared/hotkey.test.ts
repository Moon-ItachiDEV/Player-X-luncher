// Tests des raccourcis de l'overlay (npm run test:overlay) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { DEFAULT_OVERLAY_HOTKEY, hotkeyFromPress, hotkeyLabel, hotkeyProblem, hotkeyText, isValidHotkey } from './hotkey.ts'

const press = (key: string, code: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) => ({
  key,
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta
})

test('le raccourci par défaut est valide', () => {
  assert.equal(DEFAULT_OVERLAY_HOTKEY, 'Alt+X')
  assert.equal(isValidHotkey(DEFAULT_OVERLAY_HOTKEY), true)
})

test('acceptés : Alt/Ctrl + lettre ou chiffre, touches F seules, Ctrl+Alt + touche F', () => {
  for (const a of ['Alt+X', 'Ctrl+Shift+O', 'Alt+1', 'F7', 'Shift+F9', 'Ctrl+Alt+F1', 'Alt+num5', 'Ctrl+Insert', 'F24']) {
    assert.equal(hotkeyProblem(a), null, a)
  }
})

test('refusés : touche seule, Maj seul, AltGr, réservés, inconnus, ordre faux', () => {
  assert.match(hotkeyProblem('X') ?? '', /Ctrl ou Alt/)
  assert.match(hotkeyProblem('Shift+X') ?? '', /Ctrl ou Alt/)
  assert.match(hotkeyProblem('Ctrl+Alt+E') ?? '', /AltGr/)
  assert.match(hotkeyProblem('Alt+F4') ?? '', /Windows ou Steam/)
  assert.match(hotkeyProblem('F12') ?? '', /Windows ou Steam/)
  assert.match(hotkeyProblem('Alt+Tab') ?? '', /pas reconnu/)
  assert.match(hotkeyProblem('Shift+Alt+X') ?? '', /pas reconnu/)
  assert.match(hotkeyProblem('Alt+Alt+X') ?? '', /pas reconnu/)
  assert.match(hotkeyProblem('F25') ?? '', /pas reconnu/)
  assert.equal(isValidHotkey(42), false)
  assert.equal(isValidHotkey('Alt+' + 'X'.repeat(40)), false)
})

test('libellés en français', () => {
  assert.deepEqual(hotkeyLabel('Ctrl+Shift+num3'), ['Ctrl', 'Maj', 'Pavé 3'])
  assert.deepEqual(hotkeyLabel('Alt+PageDown'), ['Alt', 'Page suiv.'])
  assert.equal(hotkeyText('Alt+X'), 'Alt + X')
})

test('capture : AZERTY, chiffres de la rangée du haut, modificateurs seuls, refus', () => {
  // AZERTY : la touche marquée A (code KeyQ) donne A.
  assert.deepEqual(hotkeyFromPress(press('a', 'KeyQ', { alt: true })), { accel: 'Alt+A' })
  // AZERTY : « & » sur la touche 1.
  assert.deepEqual(hotkeyFromPress(press('&', 'Digit1', { alt: true })), { accel: 'Alt+1' })
  assert.deepEqual(hotkeyFromPress(press('F8', 'F8')), { accel: 'F8' })
  assert.deepEqual(hotkeyFromPress(press('1', 'Numpad1', { ctrl: true, shift: true })), { accel: 'Ctrl+Shift+num1' })
  assert.equal(hotkeyFromPress(press('Alt', 'AltLeft', { alt: true })), null)
  assert.ok('problem' in (hotkeyFromPress(press('x', 'KeyX')) ?? {}))
  assert.ok('problem' in (hotkeyFromPress(press('x', 'KeyX', { meta: true, alt: true })) ?? {}))
  assert.ok('problem' in (hotkeyFromPress(press(' ', 'Space', { alt: true })) ?? {}))
  assert.ok('problem' in (hotkeyFromPress(press('€', 'KeyE', { ctrl: true, alt: true })) ?? {}))
})
