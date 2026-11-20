// Tests de l'origine acceptée pour les appels au processus principal (npm run test:security).
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { trustedUrl } from './trust.ts'

test('version installée : seule une page de l’appli (file:) peut appeler', () => {
  assert.ok(trustedUrl('file:///C:/Users/x/AppData/Local/Programs/test-v3-player-x/resources/app.asar/out/renderer/v3/index.html'))
  assert.equal(trustedUrl('https://evil.example/'), false)
  assert.equal(trustedUrl('http://localhost:5173/'), false)
  assert.equal(trustedUrl('data:text/html,x'), false)
  assert.equal(trustedUrl('pas une adresse'), false)
})

test('développement : la V3 (file:) et le serveur Vite', () => {
  assert.ok(trustedUrl('file:///home/x/out/renderer/v3/index.html', 'http://localhost:5173'))
  assert.ok(trustedUrl('http://localhost:5173/#overlay', 'http://localhost:5173'))
  assert.equal(trustedUrl('http://localhost:5174/', 'http://localhost:5173'), false)
  assert.equal(trustedUrl('https://evil.example/', 'nimporte quoi'), false)
})

test('file: limité au dossier renderer : fichiers externes, traversées et UNC refusés', () => {
  const root = '/home/x/app/out/renderer'
  assert.ok(trustedUrl('file:///home/x/app/out/renderer/v3/index.html', undefined, root))
  assert.ok(trustedUrl('file:///home/x/app/out/renderer/index.html', undefined, root))
  assert.equal(trustedUrl('file:///home/x/app/out/renderer-evil/index.html', undefined, root), false)
  assert.equal(trustedUrl('file:///home/x/Downloads/evil.html', undefined, root), false)
  assert.equal(trustedUrl('file:///home/x/app/out/renderer/../secret.html', undefined, root), false)
  assert.equal(trustedUrl('file://serveur/partage/out/renderer/v3/index.html', undefined, root), false)
  assert.equal(trustedUrl('file:///C:/Users/x/Downloads/evil.html'), false)
  assert.equal(trustedUrl('file:///C:/Users/x/out/renderer/%2e%2e/secret.html'), false)
  // Chemins Windows (espaces, casse de la lettre de lecteur, paramètres ?softgl=1)
  const winRoot = 'C:\\Users\\Jean Luc\\AppData\\Local\\Programs\\Player X V3 Test\\resources\\app.asar\\out\\renderer'
  assert.ok(trustedUrl('file:///c:/Users/Jean%20Luc/AppData/Local/Programs/Player%20X%20V3%20Test/resources/app.asar/out/renderer/v3/index.html?softgl=1', undefined, winRoot))
  assert.equal(trustedUrl('file:///C:/Users/Jean%20Luc/Downloads/evil.html', undefined, winRoot), false)
  assert.equal(trustedUrl('file:///C:/Users/Jean%20Luc/AppData/Local/Programs/Player%20X%20V3%20Test/resources/app.asar/out/renderer2/index.html', undefined, winRoot), false)
})

