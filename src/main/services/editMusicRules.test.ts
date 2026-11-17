// Tests des règles pures des musiques (npm run test:edit).
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { AUDIO_EXT, MUSIC_ID, extOf, musicMime } from './editMusicRules.ts'

test('type servi selon l’extension relue sur le fichier gardé', () => {
  assert.equal(musicMime('C:\\Musique\\nuit-blanche.MP3'), 'audio/mpeg')
  assert.equal(musicMime('/home/x/a.wav'), 'audio/wav')
  assert.equal(musicMime('/home/x/a.flac'), 'audio/flac')
  assert.equal(musicMime('/home/x/a.ogg'), 'audio/ogg')
  assert.equal(musicMime('/home/x/a.opus'), 'audio/ogg')
  assert.equal(musicMime('/home/x/a.m4a'), 'audio/mp4')
  assert.equal(musicMime('/home/x/a.aac'), 'audio/mp4')
})

test('wma et inconnus : pas servis', () => {
  assert.equal(musicMime('/home/x/a.wma'), null)
  assert.equal(musicMime('/home/x/a.mp4'), null)
  assert.equal(musicMime('/home/x/sans-extension'), null)
})

test('extension et identifiants', () => {
  assert.equal(extOf('a.b.Flac'), 'flac')
  assert.ok(AUDIO_EXT.includes('wma'))
  assert.ok(MUSIC_ID.test('0123456789ab'))
  assert.ok(!MUSIC_ID.test('..%2F..%2Fetc'))
  assert.ok(!MUSIC_ID.test('0123456789abc'))
})
