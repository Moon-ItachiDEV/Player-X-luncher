// Tests de Prêt à jouer (npm run test:ready) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { formatBytes, hasPending, parseUpdatingReg, readAppManifest, updateLabel, updateOf, updatePercent, updateSentence } from './steamUpdate.ts'

const GB = 1024 ** 3
const G31 = Math.round(3.1 * GB)

/** Un manifeste comme Steam les écrit (tabulations, sections imbriquées). */
const acf = (flags: number, extra: Record<string, number> = {}): string => `"AppState"
{
	"appid"		"730"
	"universe"		"1"
	"name"		"Counter-Strike 2"
	"StateFlags"		"${flags}"
	"installdir"		"Counter-Strike Global Offensive"
	"SizeOnDisk"		"36121234567"
${Object.entries(extra)
  .map(([k, v]) => `\t"${k}"\t\t"${v}"`)
  .join('\n')}
	"InstalledDepots"
	{
		"2347770"
		{
			"manifest"		"123456"
			"size"		"999"
		}
	}
}`

const state = (flags: number, extra?: Record<string, number>, active = false) => {
  const f = readAppManifest(acf(flags, extra))
  assert.ok(f)
  return updateOf(f, active)
}

test('jeu prêt (4) : rien à afficher', () => {
  assert.equal(state(4), null)
})

test('pas installé et rien en cours (0, 1) : rien à suivre', () => {
  assert.equal(state(0), undefined)
  assert.equal(state(1), undefined)
})

test('mise à jour requise (6) : en attente, avec ce qui reste à télécharger', () => {
  assert.deepEqual(state(6, { BytesToDownload: G31, BytesDownloaded: 0 }), { kind: 'queued', total: G31, done: 0 })
  assert.equal(updateLabel({ kind: 'queued', total: G31, done: 0 }), 'Mise à jour · 3,1 Go')
  assert.equal(updateLabel({ kind: 'queued' }), 'Mise à jour')
})

test('mise à jour commencée (1030) : téléchargement seulement si Steam y travaille', () => {
  const extra = { BytesToDownload: 4 * GB, BytesDownloaded: 2.5 * GB }
  assert.equal(state(1030, extra)?.kind, 'queued')
  assert.deepEqual(state(1030, extra, true), { kind: 'downloading', total: 4 * GB, done: 2.5 * GB })
  assert.equal(updateLabel({ kind: 'downloading', total: 4 * GB, done: 2.5 * GB }), 'Téléchargement · 62 %')
  // Remise dans la file de Steam après un début de téléchargement.
  assert.equal(updateLabel({ kind: 'queued', total: 4 * GB, done: 2.5 * GB }), 'En attente · 62 %')
})

test('bits de téléchargement écrits dans le fichier : téléchargement même sans le registre', () => {
  assert.equal(state(4 | 2 | 256, { BytesToDownload: 100, BytesDownloaded: 10 })?.kind, 'downloading')
  assert.equal(state(4 | 2 | 1_048_576)?.kind, 'downloading')
})

test('en pause (1542) ; une reprise vue dans le registre passe avant le fichier pas encore réécrit', () => {
  const extra = { BytesToDownload: 1000, BytesDownloaded: 300 }
  assert.deepEqual(state(1542, extra), { kind: 'paused', total: 1000, done: 300 })
  assert.equal(updateLabel({ kind: 'paused', total: 1000, done: 300 }), 'En pause · 30 %')
  assert.equal(state(1542, extra, true)?.kind, 'downloading')
})

test('téléchargement fini, fichiers en cours de pose : installation, avec sa propre progression', () => {
  const extra = { BytesToDownload: 1000, BytesDownloaded: 1000, BytesToStage: 2000, BytesStaged: 1600 }
  assert.deepEqual(state(1030, extra, true), { kind: 'installing', total: 2000, done: 1600 })
  assert.equal(state(4 | 2_097_152, extra)?.kind, 'installing')
  assert.equal(updateLabel({ kind: 'installing', total: 2000, done: 1600 }), 'Installation · 80 %')
})

test('vérification des fichiers', () => {
  assert.deepEqual(state(4 | 131_072), { kind: 'verifying' })
  assert.equal(updateLabel({ kind: 'verifying' }), 'Vérification')
})

test('premier téléchargement (1026) : « À télécharger », pas « Mise à jour »', () => {
  const u = state(1026, { BytesToDownload: 12 * GB })
  assert.deepEqual(u, { kind: 'queued', total: 12 * GB, done: 0, firstInstall: true })
  assert.equal(updateLabel(u!), 'À télécharger · 12 Go')
  assert.equal(updateSentence(u!), 'Le téléchargement du jeu attend dans Steam (12 Go).')
})

test('jeu lancé pendant qu’une mise à jour attend (70) : toujours en attente', () => {
  assert.equal(state(70)?.kind, 'queued')
})

test('le pourcentage ne dit jamais 100 avant la fin, et reste dans les bornes', () => {
  assert.equal(updatePercent({ kind: 'downloading', total: 1000, done: 999 }), 99)
  assert.equal(updatePercent({ kind: 'downloading', total: 1000, done: 1000 }), 99)
  assert.equal(updatePercent({ kind: 'downloading' }), null)
  // Octets téléchargés au-delà du total (manifeste à moitié réécrit) : bornés.
  assert.deepEqual(state(1030, { BytesToDownload: 100, BytesDownloaded: 150 }, true), { kind: 'downloading', total: 100, done: 100 })
})

test('manifeste illisible : null', () => {
  assert.equal(readAppManifest(''), null)
  assert.equal(readAppManifest('"AppState" { "appid" "abc" "StateFlags" "4" }'), null)
  assert.equal(readAppManifest('"AppState" { "appid" "730" }'), null)
})

test('hasPending : seulement quand une mise à jour attend ou tourne', () => {
  assert.equal(hasPending(readAppManifest(acf(4))!), false)
  assert.equal(hasPending(readAppManifest(acf(6))!), true)
  assert.equal(hasPending(readAppManifest(acf(1542))!), true)
})

test('registre : les appids dont « Updating » vaut 1', () => {
  const out = [
    'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\730',
    '    Updating    REG_DWORD    0x1',
    '',
    'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\1086940',
    '    Updating    REG_DWORD    0x0',
    '',
    'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\570',
    '    Updating    REG_DWORD    0x1',
    '',
    'Fin de la recherche : 3 correspondance(s) trouvée(s).'
  ].join('\r\n')
  assert.deepEqual([...parseUpdatingReg(out)].sort(), ['570', '730'])
  assert.equal(parseUpdatingReg('').size, 0)
})

test('tailles en français, en multiples de 1 024', () => {
  assert.equal(formatBytes(G31), '3,1 Go')
  assert.equal(formatBytes(12 * GB), '12 Go')
  assert.equal(formatBytes(150 * GB), '150 Go')
  assert.equal(formatBytes(850 * 1024 ** 2), '850 Mo')
  assert.equal(formatBytes(10), '1 Ko')
})

test('phrases complètes', () => {
  assert.equal(updateSentence({ kind: 'downloading', total: 4 * GB, done: 2 * GB }), 'Steam télécharge la mise à jour : 50 % (2 Go sur 4 Go).')
  assert.equal(updateSentence({ kind: 'queued', total: GB, done: 0 }), 'Une mise à jour attend dans Steam : 1 Go à télécharger.')
  assert.equal(updateSentence({ kind: 'paused' }), 'Le téléchargement est en pause dans Steam.')
})
