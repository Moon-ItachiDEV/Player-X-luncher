// Tests des règles de la mise à jour (npm run test:maj) : versions, maj.json, signature, notes, droit d'installer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore TS5097
import { afterAttempt, chooseNotes, compareVersions, decideInstall, DOWNLOAD_PREFIX, etaSeconds, isNewer, markerBlocks, parseAttempt, parseMarker, parseManifest, parseNotes, reviewNotes, verifySignature, type InstallFacts, type NoteEntry } from './updaterRules.ts'
// @ts-ignore TS5097 TS7016
import { appendPublicKey, buildManifest, findInstaller, findSetup, githubRelease, isPrerelease, readNotes, readPublicKeys, releaseBody, signBytes } from '../../../scripts/publier-maj.mjs'
// @ts-ignore TS5097
import { cleanPatch, defaults } from './settingsRules.ts'

const good = () => ({
  version: '0.7.2',
  date: '2026-11-17',
  file: 'Player-X-V3-Test-Setup-0.7.2.exe',
  url: `${DOWNLOAD_PREFIX}v0.7.2/Player-X-V3-Test-Setup-0.7.2.exe`,
  size: 139 * 1024 * 1024,
  sha256: 'a'.repeat(64),
  notes: [{ version: '0.7.2', date: '2026-11-17', items: [{ kind: 'nouveau', title: 'Les mises à jour', text: 'Dans l’appli.', page: 'set-about' }] }]
})

// ---------- versions ----------

test('versions : l’ordre de semver, préversions comprises', () => {
  const order = ['0.7.0', '0.7.1', '0.7.2-beta.1', '0.7.2-beta.2', '0.7.2-beta.10', '0.7.2-rc.1', '0.7.2', '0.10.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0']
  for (let i = 0; i < order.length; i++) {
    assert.equal(compareVersions(order[i], order[i]), 0)
    for (let j = i + 1; j < order.length; j++) {
      assert.equal(compareVersions(order[i], order[j]), -1, `${order[i]} < ${order[j]}`)
      assert.equal(compareVersions(order[j], order[i]), 1, `${order[j]} > ${order[i]}`)
    }
  }
})

test('versions : « 0.7.10 » est plus récente que « 0.7.9 » (pas un ordre de texte)', () => {
  assert.equal(isNewer('0.7.10', '0.7.9'), true)
  assert.equal(isNewer('0.7.1', '0.7.1'), false)
  assert.equal(isNewer('0.7.1-beta.2', '0.7.1'), false)
})

test('versions : ce qui n’est pas une version donne null, jamais une réponse au hasard', () => {
  for (const v of ['', '1', '1.2', 'v1.2.3', '1.2.3.4', '01.2.3', '1.2.3-', '1.2.3-01', 'latest', '1.2.3 ', '../1.0.0']) assert.equal(compareVersions(v, '0.0.1'), null, v)
  assert.equal(isNewer('x', '0.7.1'), false)
  assert.equal(compareVersions('1.2.3+build5', '1.2.3'), 0)
})

// ---------- maj.json ----------

test('maj.json : un fichier correct passe, l’empreinte est mise en minuscules', () => {
  const r = parseManifest({ ...good(), sha256: 'AB'.repeat(32) })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.value.sha256, 'ab'.repeat(32))
    assert.equal(r.value.notes[0].items[0].page, 'set-about')
  }
})

test('maj.json : une adresse hors du dépôt, ou qui ne finit pas par le fichier, est refusée', () => {
  const f = 'Player-X-V3-Test-Setup-0.7.2.exe'
  const urls = [
    `https://evil.example/Moon-ItachiDEV/player-x-luncher/releases/download/v0.7.2/${f}`,
    `http://github.com/Moon-ItachiDEV/player-x-luncher/releases/download/v0.7.2/${f}`,
    `https://github.com/Moon-ItachiDEV/other/releases/download/v0.7.2/${f}`,
    `${DOWNLOAD_PREFIX}v0.7.2/other.exe`,
    `${DOWNLOAD_PREFIX}v0.7.2/${f}?x=1`,
    `${DOWNLOAD_PREFIX}v0.7.2/${f}#a`,
    `${DOWNLOAD_PREFIX}../../../x/${f}`,
    `${DOWNLOAD_PREFIX}v0.7.2/%2e%2e/${f}`,
    `https://github.com.evil.example/Moon-ItachiDEV/player-x-luncher/releases/download/v0.7.2/${f}`,
    `https://user@github.com/Moon-ItachiDEV/player-x-luncher/releases/download/v0.7.2/${f}`,
    `${DOWNLOAD_PREFIX}v0.7.2/${f} `,
    42, null
  ]
  for (const url of urls) assert.equal(parseManifest({ ...good(), url }).ok, false, String(url))
})

test('maj.json : un nom de fichier qui sort du dossier ou n’est pas un .exe est refusé', () => {
  for (const file of ['../x.exe', '..\\x.exe', 'a/b.exe', 'a\\b.exe', 'x.msi', 'x.exe.txt', '.exe', '..exe', 'x y.exe', '', 'C:x.exe', 'x.exe\u0000.png']) {
    const m = { ...good(), file, url: `${DOWNLOAD_PREFIX}v0.7.2/${file}` }
    assert.equal(parseManifest(m).ok, false, JSON.stringify(file))
  }
})

test('maj.json : un champ inconnu, ou manquant, est refusé (partout, notes comprises)', () => {
  assert.equal(parseManifest({ ...good(), extra: 1 }).ok, false)
  assert.equal(parseManifest({ ...good(), notes: [{ version: '0.7.2', date: '2026-11-17', items: [], more: 1 }] }).ok, false)
  assert.equal(parseManifest({ ...good(), notes: [{ version: '0.7.2', date: '2026-11-17', items: [{ kind: 'nouveau', title: 'a', text: 'b', html: '<b>' }] }] }).ok, false)
  for (const k of ['version', 'date', 'file', 'url', 'size', 'sha256', 'notes']) {
    const m: Record<string, unknown> = good()
    delete m[k]
    assert.equal(parseManifest(m).ok, false, k)
  }
  assert.equal(parseManifest(null).ok, false)
  assert.equal(parseManifest([]).ok, false)
  assert.equal(parseManifest('{}').ok, false)
})

test('maj.json : taille, empreinte, version, date et notes bornées', () => {
  for (const size of [0, -1, 1.5, 400 * 1024 * 1024 + 1, '100', NaN, Infinity]) assert.equal(parseManifest({ ...good(), size }).ok, false, String(size))
  assert.equal(parseManifest({ ...good(), size: 400 * 1024 * 1024 }).ok, true)
  for (const sha256 of ['a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), '', 5]) assert.equal(parseManifest({ ...good(), sha256 }).ok, false)
  assert.equal(parseManifest({ ...good(), version: '0.7' }).ok, false)
  assert.equal(parseManifest({ ...good(), date: '17/11/2026' }).ok, false)
  const item = { kind: 'nouveau', title: 'a', text: 'b' }
  assert.equal(parseNotes([{ version: '0.7.2', date: '2026-11-17', items: [{ ...item, kind: 'autre' }] }]).ok, false)
  assert.equal(parseNotes([{ version: '0.7.2', date: '2026-11-17', items: [{ ...item, page: 'http://evil' }] }]).ok, false)
  assert.equal(parseNotes([{ version: '0.7.2', date: '2026-11-17', items: [{ ...item, title: 'x'.repeat(81) }] }]).ok, false)
  assert.equal(parseNotes([{ version: '0.7.2', date: '2026-11-17', items: [{ ...item, text: 'a\nb' }] }]).ok, false)
  assert.equal(parseNotes([{ version: '0.7.2', date: '2026-11-17', items: Array.from({ length: 41 }, () => item) }]).ok, false)
  assert.equal(parseNotes(Array.from({ length: 61 }, () => ({ version: '0.7.2', date: '2026-11-17', items: [] }))).ok, false)
})

// ---------- signature ----------

test('signature : valide, un octet changé, mauvaise clé, plusieurs clés', () => {
  const mk = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    return { pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: privateKey }
  }
  const a = mk(), b = mk()
  const data = Buffer.from(JSON.stringify(good()))
  const sig = sign(null, data, a.priv)
  assert.equal(verifySignature(data, sig, [a.pem]), true)
  // En base64 (le format écrit par le script de publication)
  assert.equal(verifySignature(data, Buffer.from(sig.toString('base64') + '\n'), [a.pem]), true)
  // Un seul octet de maj.json change : refusé
  const bent = Buffer.from(data)
  bent[10] ^= 1
  assert.equal(verifySignature(bent, sig, [a.pem]), false)
  // Un seul octet de la signature change : refusé
  const bentSig = Buffer.from(sig)
  bentSig[0] ^= 1
  assert.equal(verifySignature(data, bentSig, [a.pem]), false)
  // Une autre clé : refusé ; la bonne clé parmi plusieurs : accepté, même après une clé illisible
  assert.equal(verifySignature(data, sig, [b.pem]), false)
  assert.equal(verifySignature(data, sig, [b.pem, a.pem]), true)
  assert.equal(verifySignature(data, sig, ['pas une clé', a.pem]), true)
  // Aucune clé (mises à jour pas configurées), signature absente ou de mauvaise taille : refusé
  assert.equal(verifySignature(data, sig, []), false)
  assert.equal(verifySignature(data, Buffer.alloc(0), [a.pem]), false)
  assert.equal(verifySignature(data, Buffer.alloc(63), [a.pem]), false)
  assert.equal(verifySignature(data, Buffer.from('!!!!'), [a.pem]), false)
})

// ---------- notes ----------

const entry = (version: string): NoteEntry => ({ version, date: '2026-11-16', items: [{ kind: 'nouveau', title: `Titre ${version}`, text: 'Texte.' }] })
const ALL = ['0.7.0', '0.7.1', '0.7.2', '0.7.3'].map(entry)

test('notes : première installation, rien à montrer, la version actuelle est notée vue', () => {
  assert.deepEqual(chooseNotes(ALL, '', '0.7.2', false), { show: [], seen: '0.7.2' })
})

test('notes : première version avec les mises à jour, seulement les notes de la version actuelle', () => {
  const c = chooseNotes(ALL, '', '0.7.2', true)
  assert.deepEqual(c.show.map((e) => e.version), ['0.7.2'])
  assert.equal(c.seen, '0.7.2')
  // Pas de notes pour cette version : rien, mais elle est notée
  assert.deepEqual(chooseNotes([entry('0.7.0')], '', '0.7.2', true), { show: [], seen: '0.7.2' })
})

test('notes : une version sautée n’est pas perdue, de la plus récente à la plus ancienne', () => {
  const c = chooseNotes(ALL, '0.7.0', '0.7.3', true)
  assert.deepEqual(c.show.map((e) => e.version), ['0.7.3', '0.7.2', '0.7.1'])
  assert.equal(c.seen, '0.7.3')
  // Les notes d’une version plus récente que la mienne (publiées d’avance) ne sont pas montrées
  assert.deepEqual(chooseNotes(ALL, '0.7.0', '0.7.1', true).show.map((e) => e.version), ['0.7.1'])
})

test('notes : déjà vues, ou version plus ancienne qu’avant, rien', () => {
  assert.deepEqual(chooseNotes(ALL, '0.7.2', '0.7.2', true), { show: [], seen: '0.7.2' })
  assert.deepEqual(chooseNotes(ALL, '0.7.3', '0.7.2', true), { show: [], seen: '0.7.3' })
})

test('notes : « Revoir les nouveautés » donne la version installée et les deux d’avant', () => {
  assert.deepEqual(reviewNotes(ALL, '0.7.2').map((e) => e.version), ['0.7.2', '0.7.1', '0.7.0'])
  assert.deepEqual(reviewNotes(ALL, '0.7.1').map((e) => e.version), ['0.7.1', '0.7.0'])
})

// ---------- installer ----------

const facts = (o: Partial<InstallFacts> = {}): InstallFacts => ({ ready: true, blocked: false, sessionEnd: false, spawned: false, attempts: 0, updateOnQuit: true, ...o })

test('installer : à la demande, seulement si prête, libre et pas déjà lancée', () => {
  assert.deepEqual(decideInstall('now', facts()), { ok: true })
  assert.deepEqual(decideInstall('now', facts({ ready: false })), { ok: false, reason: 'not-ready' })
  assert.deepEqual(decideInstall('now', facts({ blocked: true })), { ok: false, reason: 'blocked' })
  assert.deepEqual(decideInstall('now', facts({ spawned: true })), { ok: false, reason: 'spawned' })
  // Le réglage et la fin de session ne concernent pas un clic sur « Redémarrer »
  assert.deepEqual(decideInstall('now', facts({ updateOnQuit: false, sessionEnd: true })), { ok: true })
})

test('installer : à la fermeture, jamais pendant une partie, un arrêt de Windows, ni sans le réglage', () => {
  assert.deepEqual(decideInstall('quit', facts()), { ok: true })
  assert.deepEqual(decideInstall('quit', facts({ blocked: true })), { ok: false, reason: 'blocked' })
  assert.deepEqual(decideInstall('quit', facts({ sessionEnd: true })), { ok: false, reason: 'session-end' })
  assert.deepEqual(decideInstall('quit', facts({ updateOnQuit: false })), { ok: false, reason: 'setting' })
  assert.deepEqual(decideInstall('quit', facts({ spawned: true })), { ok: false, reason: 'spawned' })
  assert.deepEqual(decideInstall('quit', facts({ ready: false })), { ok: false, reason: 'not-ready' })
})

test('installer : après deux échecs, plus d’installation silencieuse', () => {
  assert.deepEqual(decideInstall('quit', facts({ attempts: 1 })), { ok: true })
  assert.deepEqual(decideInstall('quit', facts({ attempts: 2 })), { ok: false, reason: 'attempts' })
  assert.deepEqual(decideInstall('quit', facts({ attempts: 5 })), { ok: false, reason: 'attempts' })
})

test('tentatives : réussi, nouvel essai, puis abandon à la deuxième fois', () => {
  assert.deepEqual(afterAttempt({ version: '0.7.2', attempts: 0, launched: true }, '0.7.2'), { outcome: 'installed' })
  assert.deepEqual(afterAttempt({ version: '0.7.2', attempts: 0, launched: true }, '0.7.3'), { outcome: 'installed' })
  assert.deepEqual(afterAttempt({ version: '0.7.2', attempts: 0, launched: true }, '0.7.1'), { outcome: 'retry', attempts: 1 })
  assert.deepEqual(afterAttempt({ version: '0.7.2', attempts: 1, launched: true }, '0.7.1'), { outcome: 'give-up', attempts: 2 })
  assert.equal(parseAttempt({ version: '0.7.2', attempts: 1 })?.attempts, 1)
  // Sans Setup lancé depuis le dernier démarrage, rien n'est compté ; un ancien fichier (sans « launched ») compte comme lancé.
  assert.deepEqual(afterAttempt({ version: '0.7.2', attempts: 1, launched: false }, '0.7.1'), { outcome: 'retry', attempts: 1 })
  assert.deepEqual(afterAttempt({ version: '0.7.2', attempts: 1, launched: false }, '0.7.2'), { outcome: 'installed' })
  assert.equal(parseAttempt({ version: '0.7.2', attempts: 1 })?.launched, true)
  assert.equal(parseAttempt({ version: '0.7.2', attempts: 1, launched: false })?.launched, false)
  assert.equal(parseAttempt({ version: '0.7.2', attempts: 1, launched: 'oui' }), null)
  for (const x of [null, [], { version: 'x', attempts: 1 }, { version: '0.7.2', attempts: -1 }, { version: '0.7.2', attempts: '1' }, { version: '0.7.2' }]) assert.equal(parseAttempt(x), null)
})

test('marqueur d’installation : une ouverture de l’ancienne version se tait 2 minutes, pas la nouvelle', () => {
  const m = { version: '0.7.2', at: 1_000_000 }
  assert.equal(markerBlocks(m, '0.7.1', 1_000_000 + 119_000), true)
  assert.equal(markerBlocks(m, '0.7.1', 1_000_000 + 121_000), false)
  // La version installée se relance toute seule juste après : elle ne se tait pas
  assert.equal(markerBlocks(m, '0.7.2', 1_000_000 + 5_000), false)
  assert.equal(markerBlocks(null, '0.7.1', 1_000_000), false)
  // Une horloge qui recule ne bloque pas
  assert.equal(markerBlocks(m, '0.7.1', 900_000), false)
  // Le Setup est déjà sorti (installation ratée) : la réouverture n'attend plus
  const mp = { version: '0.7.2', at: 1_000_000, pid: 4242 }
  assert.equal(markerBlocks(mp, '0.7.1', 1_000_000 + 5_000, () => true), true)
  assert.equal(markerBlocks(mp, '0.7.1', 1_000_000 + 5_000, () => false), false)
  assert.equal(parseMarker({ version: '0.7.2', at: 1, pid: 4242 })?.pid, 4242)
  assert.equal(parseMarker({ version: '0.7.2', at: 1, pid: -3 })?.pid, undefined)
})

test('avancement : temps restant', () => {
  assert.equal(etaSeconds(50, 150, 10), 10)
  assert.equal(etaSeconds(149, 150, 1000), 1)
  assert.equal(etaSeconds(150, 150, 10), null)
  assert.equal(etaSeconds(10, 150, 0), null)
})

// ---------- réglages ----------

test('réglages : « Installer à la fermeture » (vrai par défaut), version ignorée, notes vues', () => {
  const d = defaults({}, 'win32')
  assert.equal(d.updateOnQuit, true)
  assert.equal(d.updateSkipped, null)
  assert.equal(d.notesSeen, '')
  assert.deepEqual(cleanPatch({ updateOnQuit: false, updateSkipped: '0.7.2', notesSeen: '0.7.1' }), { updateOnQuit: false, updateSkipped: '0.7.2', notesSeen: '0.7.1' })
  assert.deepEqual(cleanPatch({ updateSkipped: null }), { updateSkipped: null })
  assert.deepEqual(cleanPatch({ updateOnQuit: 'oui', updateSkipped: 'x', notesSeen: 5 }), {})
})

// ---------- script de publication ----------

test('publication : le maj.json fabriqué par le script passe la vérification de l’appli, signature comprise', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maj-'))
  const dist = join(tmp, 'dist')
  mkdirSync(dist)
  writeFileSync(join(dist, 'Player-X-V3-Test-Setup-0.7.2.exe'), Buffer.alloc(5000, 7))
  // Un autre Setup d'une autre version ne gêne pas
  writeFileSync(join(dist, 'Player-X-V3-Test-Setup-0.7.1.exe'), Buffer.alloc(10, 1))
  const setup = findSetup(dist, '0.7.2')
  const notes = readNotes(join(import.meta.dirname, '../../../notes-de-version.json'))
  const { bytes } = buildManifest({ version: '0.7.2', setup, notes, date: '2026-11-17' })
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'un mot de passe long' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const sig = signBytes(bytes, privateKey, 'un mot de passe long')
  assert.equal(verifySignature(bytes, sig, [publicKey]), true)
  const m = parseManifest(JSON.parse(bytes.toString('utf8')))
  assert.equal(m.ok, true)
  if (m.ok) {
    assert.equal(m.value.size, 5000)
    assert.equal(m.value.file, 'Player-X-V3-Test-Setup-0.7.2.exe')
    assert.deepEqual(m.value.notes.map((e) => e.version), ['0.7.2', '0.7.1'])
  }
  assert.throws(() => signBytes(bytes, privateKey, 'faux'))
})

test('publication : refus sans notes pour la version, sans Setup, avec une page inconnue', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maj-'))
  writeFileSync(join(tmp, 'Player-X-V3-Test-Setup-0.7.9.exe'), Buffer.alloc(10))
  const notes = readNotes(join(import.meta.dirname, '../../../notes-de-version.json'))
  assert.throws(() => buildManifest({ version: '0.7.9', setup: join(tmp, 'Player-X-V3-Test-Setup-0.7.9.exe'), notes }), /Pas de notes/)
  assert.throws(() => findSetup(tmp, '0.8.0'), /Aucun Setup/)
  writeFileSync(join(tmp, 'n.json'), JSON.stringify([{ version: '0.7.2', date: '2026-11-17', items: [{ kind: 'nouveau', title: 'a', text: 'b', page: 'http://x' }] }]))
  assert.throws(() => readNotes(join(tmp, 'n.json')), /page/)
})

test('nom du Setup : « Player-X-Setup-<version>.exe » (artifactName de package.json) passe la vérification de l’appli et se retrouve dans le dossier de fabrication', () => {
  const file = 'Player-X-Setup-0.7.7.exe'
  const r = parseManifest({ ...good(), version: '0.7.7', file, url: `${DOWNLOAD_PREFIX}v0.7.7/${file}` })
  assert.equal(r.ok, true, JSON.stringify(r))
  const tmp = mkdtempSync(join(tmpdir(), 'maj-'))
  writeFileSync(join(tmp, file), Buffer.alloc(10))
  assert.equal(findSetup(tmp, '0.7.7'), join(tmp, file))
})

test('publication : la clé publique s’ajoute à updaterKey.ts sans effacer les anciennes', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maj-'))
  const f = join(tmp, 'updaterKey.ts')
  copyFileSync(join(import.meta.dirname, 'updaterKey.ts'), f)
  const mk = () => generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const before = readPublicKeys(f).map((k: string) => k.trim())
  const a = mk(), b = mk()
  assert.equal(appendPublicKey(a, f), true)
  assert.equal(appendPublicKey(a, f), false)
  assert.equal(appendPublicKey(b, f), true)
  assert.deepEqual(readPublicKeys(f).map((k: string) => k.trim()), [...before, a.trim(), b.trim()])
})

test('publication : la Release est créée en brouillon, les 3 fichiers envoyés, publiée en dernier', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maj-gh-'))
  const files = ['Player-X-Setup-0.7.7.exe', 'maj.json', 'maj.json.sig'].map((n) => { writeFileSync(join(tmp, n), Buffer.alloc(8, 1)); return join(tmp, n) })
  const calls: string[] = []
  const reply = (status: number, json: unknown = {}) => ({ status, json: async () => json, text: async () => JSON.stringify(json) })
  const http = async (url: string, o: { method?: string; body?: unknown }) => {
    const m = o.method || 'GET'
    calls.push(`${m} ${url.replace(/^https:\/\/(api|uploads)\.github\.com\/repos\/o\/r/, '')}`)
    if (m === 'GET') return reply(404)
    if (m === 'POST' && url.includes('/assets?')) return reply(201)
    if (m === 'POST') { assert.equal(JSON.parse(String(o.body)).draft, true); return reply(201, { id: 9 }) }
    if (m === 'PATCH') { assert.equal(JSON.parse(String(o.body)).draft, false); return reply(200, { html_url: 'https://x/v0.7.7' }) }
    return reply(500)
  }
  const url = await githubRelease({ token: 't', version: '0.7.7', files, body: 'b', http, repo: 'o/r' })
  assert.equal(url, 'https://x/v0.7.7')
  assert.deepEqual(calls, ['GET /releases/tags/v0.7.7', 'POST /releases', 'POST /releases/9/assets?name=Player-X-Setup-0.7.7.exe', 'POST /releases/9/assets?name=maj.json', 'POST /releases/9/assets?name=maj.json.sig', 'PATCH /releases/9'])
  // Déjà publiée : refus, rien d'envoyé
  const http2 = async () => reply(200, { id: 3, draft: false, assets: [{ id: 1, name: 'maj.json' }] })
  await assert.rejects(githubRelease({ token: 't', version: '0.7.7', files, body: 'b', http: http2, repo: 'o/r' }), /déjà publiée/)
  // Un envoi raté : pas de publication
  const seen: string[] = []
  const http3 = async (url: string, o: { method?: string }) => { seen.push(o.method || 'GET'); return url.includes('/assets?') ? reply(500) : (o.method === 'POST' ? reply(201, { id: 4 }) : reply(404)) }
  await assert.rejects(githubRelease({ token: 't', version: '0.7.7', files, body: 'b', http: http3, repo: 'o/r' }), /brouillon/)
  assert.ok(!seen.includes('PATCH'))
  // Publiée mais vide : complétée, sans republier
  const seen4: string[] = []
  const http4 = async (url: string, o: { method?: string }) => { seen4.push(o.method || 'GET'); return (o.method || 'GET') === 'GET' ? reply(200, { id: 5, draft: false, assets: [], html_url: 'https://x/vide' }) : reply(201) }
  assert.equal(await githubRelease({ token: 't', version: '0.7.7', files, body: 'b', http: http4, repo: 'o/r' }), 'https://x/vide')
  assert.deepEqual(seen4, ['GET', 'POST', 'POST', 'POST'])
  assert.equal(releaseBody({ items: [{ kind: 'corrige', title: 'A', text: 'B.' }] }), '- **Corrigé** · A : B.')
})

test('publication : installeur sur mesure détecté si présent, préversion jamais publiée en latest', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maj-pre-'))
  assert.equal(findInstaller(tmp, '0.8.0-beta.1'), null)
  const inst = join(tmp, 'Player-X-Installer-0.8.0-beta.1.exe')
  writeFileSync(inst, Buffer.alloc(8, 2))
  assert.equal(findInstaller(tmp, '0.8.0-beta.1'), inst)
  assert.equal(isPrerelease('0.8.0-beta.1'), true)
  assert.equal(isPrerelease('0.8.0'), false)
  assert.equal(isPrerelease('0.8.0+build1'), false)
  const files = ['Player-X-Setup-0.8.0-beta.1.exe', 'Player-X-Installer-0.8.0-beta.1.exe', 'maj.json.sig', 'maj.json'].map((n) => {
    const p = join(tmp, n)
    writeFileSync(p, Buffer.alloc(8, 3))
    return p
  })
  const payloads: Record<string, unknown>[] = []
  const reply = (status: number, json: unknown = {}) => ({ status, json: async () => json, text: async () => JSON.stringify(json) })
  const http = async (url: string, o: { method?: string; body?: unknown }) => {
    const m = o.method || 'GET'
    if (m === 'GET') return reply(404)
    if (m === 'POST' && url.includes('/assets?')) return reply(201)
    if (m === 'POST') {
      payloads.push(JSON.parse(String(o.body)))
      return reply(201, { id: 12 })
    }
    if (m === 'PATCH') {
      payloads.push(JSON.parse(String(o.body)))
      return reply(200, { html_url: 'https://x/v0.8.0-beta.1' })
    }
    return reply(500)
  }
  const url = await githubRelease({ token: 't', version: '0.8.0-beta.1', files, body: 'b', http, repo: 'o/r', targetCommitish: 'beta' })
  assert.equal(url, 'https://x/v0.8.0-beta.1')
  assert.equal(payloads[0].prerelease, true)
  assert.equal(payloads[0].target_commitish, 'beta')
  assert.equal(payloads[1].prerelease, true)
  assert.equal(payloads[1].make_latest, 'false')
})
