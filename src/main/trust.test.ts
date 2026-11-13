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
