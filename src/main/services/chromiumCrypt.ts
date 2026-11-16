import { createDecipheriv } from 'node:crypto'

// Sans Electron : testé à part (chromiumCrypt.test.ts).

/**
 * Déchiffre une valeur « safeStorage » d'Electron sous Windows : « v10 » + nonce (12 octets) + texte chiffré + étiquette (16 octets),
 * en AES-256-GCM. Renvoie null si le format ou la clé ne vont pas.
 */
export function decryptChromium(blob: Buffer, key: Buffer): string | null {
  if (key.length !== 32 || blob.length < 3 + 12 + 16) return null
  const prefix = blob.subarray(0, 3).toString('latin1')
  if (prefix !== 'v10' && prefix !== 'v11') return null
  try {
    const iv = blob.subarray(3, 15), tag = blob.subarray(blob.length - 16), data = blob.subarray(15, blob.length - 16)
    const d = createDecipheriv('aes-256-gcm', key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(data), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

