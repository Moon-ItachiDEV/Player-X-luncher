import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, randomBytes } from 'node:crypto'
// @ts-ignore TS5097
import { decryptChromium } from './chromiumCrypt.ts'

const seal = (text: string, key: Buffer, prefix = 'v10'): Buffer => {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return Buffer.concat([Buffer.from(prefix, 'latin1'), iv, data, c.getAuthTag()])
}

test('Relit une valeur chiffrée par une autre appli Electron (v10, AES-256-GCM)', () => {
  const key = randomBytes(32)
  assert.equal(decryptChromium(seal('{"discordGuildId":"123"}', key), key), '{"discordGuildId":"123"}')
})

test('Mauvaise clé, format inconnu ou valeur abîmée : rien', () => {
  const key = randomBytes(32), blob = seal('secret', key)
  assert.equal(decryptChromium(blob, randomBytes(32)), null)
  assert.equal(decryptChromium(seal('secret', key, 'v99'), key), null)
  assert.equal(decryptChromium(blob.subarray(0, 20), key), null)
  assert.equal(decryptChromium(blob, randomBytes(16)), null)
  const bad = Buffer.from(blob); bad[20] ^= 1
  assert.equal(decryptChromium(bad, key), null)
})
