#!/usr/bin/env node
// Publication d'une mise à jour de Player X (Node seul, marche sous Windows).
//
//   node scripts/publier-maj.mjs --cle        crée la paire de clés (une seule fois) : la clé privée reste sur ton PC, chiffrée par
//                                             un mot de passe, hors du dépôt ; la clé publique est ajoutée à src/main/services/updaterKey.ts
//   node scripts/publier-maj.mjs              prépare la publication de la version de package.json : dist/maj/maj.json + maj.json.sig
//     options : --dist <dossier>              où est le Setup (par défaut dist)
//               --cle-fichier <fichier>       la clé privée (par défaut %USERPROFILE%\.player-x\cle-maj.pem)
//   node scripts/publier-maj.mjs --coffre     (une seule fois, Windows) range la clé, ouverte avec son mot de passe, dans le coffre
//                                             de Windows (DPAPI, liée à ce PC et à cette session), et le jeton GitHub s'il est donné.
//                                             Ensuite la publication ne demande plus rien.
//
// Avec un jeton GitHub dans le coffre, la Release est créée en brouillon, les 3 fichiers envoyés, puis elle est publiée en dernier.
// Sans jeton, le script écrit les fichiers et dit quoi publier à la main sur GitHub (code de sortie 10).
import { spawnSync } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const KEY_FILE = join(root, 'src/main/services/updaterKey.ts')
export const DEFAULT_PRIVATE = join(homedir(), '.player-x', 'cle-maj.pem')
const RELEASES = 'https://github.com/Moon-ItachiDEV/player-x-luncher/releases'
export const REPO = 'Moon-ItachiDEV/player-x-luncher'
export const VAULT_KEY = join(homedir(), '.player-x', 'cle-maj.coffre')
export const VAULT_TOKEN = join(homedir(), '.player-x', 'jeton-github.coffre')
export const MANUAL_EXIT = 10
const MAX_SETUP = 400 * 1024 * 1024
const MAX_MANIFEST = 256 * 1024
const KEEP_NOTES = 20
// Les mêmes pages que src/main/services/updaterRules.ts (le test updaterRules.test.ts vérifie que le maj.json produit ici passe)
const PAGES = ['play', 'lib', 'clips', 'stats', 'friends', 'set-home', 'set-rec', 'set-overlay', 'set-routine', 'set-keys', 'set-general', 'set-library', 'set-pc', 'set-accounts', 'set-edit', 'set-about']
const KINDS = ['nouveau', 'ameliore', 'corrige']

const fail = (msg) => {
  throw new Error(msg)
}

// ---------- versions ----------

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
/** -1, 0, 1 (semver) ; null si ce n'est pas une version. */
export function compareVersions(a, b) {
  const x = SEMVER.exec(a), y = SEMVER.exec(b)
  if (!x || !y) return null
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) < Number(y[i]) ? -1 : 1
  const p = x[4] ? x[4].split('.') : [], q = y[4] ? y[4].split('.') : []
  if (!p.length && !q.length) return 0
  if (!p.length) return 1
  if (!q.length) return -1
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1
    if (q[i] === undefined) return 1
    if (p[i] === q[i]) continue
    const pn = /^\d+$/.test(p[i]), qn = /^\d+$/.test(q[i])
    if (pn && qn) return Number(p[i]) < Number(q[i]) ? -1 : 1
    if (pn) return -1
    if (qn) return 1
    return p[i] < q[i] ? -1 : 1
  }
  return 0
}

// ---------- notes ----------

const plain = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)

/** notes-de-version.json : une liste d'entrées {version, date, items}. Refuse ce que l'appli refuserait. */
export function readNotes(file) {
  let list
  try {
    list = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    fail(`notes-de-version.json illisible : ${e.message}`)
  }
  if (!Array.isArray(list)) fail('notes-de-version.json doit être une liste.')
  for (const e of list) {
    if (!e || typeof e !== 'object' || SEMVER.exec(e.version) === null) fail('Une entrée de notes-de-version.json n’a pas de version valide.')
    if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) fail(`Notes ${e.version} : date attendue au format AAAA-MM-JJ.`)
    if (!Array.isArray(e.items)) fail(`Notes ${e.version} : « items » manque.`)
    for (const it of e.items) {
      if (!KINDS.includes(it?.kind)) fail(`Notes ${e.version} : « kind » doit être ${KINDS.join(', ')}.`)
      if (!plain(it.title, 80)) fail(`Notes ${e.version} : titre vide ou de plus de 80 caractères.`)
      if (!plain(it.text, 300)) fail(`Notes ${e.version} : texte vide ou de plus de 300 caractères.`)
      if (it.page !== undefined && !PAGES.includes(it.page)) fail(`Notes ${e.version} : page « ${it.page} » inconnue (${PAGES.join(', ')}).`)
      const extra = Object.keys(it).find((k) => !['kind', 'title', 'text', 'page'].includes(k))
      if (extra) fail(`Notes ${e.version} : champ « ${extra} » inconnu.`)
    }
    const extra = Object.keys(e).find((k) => !['version', 'date', 'items'].includes(k))
    if (extra) fail(`Notes ${e.version} : champ « ${extra} » inconnu.`)
  }
  return list
}

// ---------- fabrication de maj.json ----------

/** Le Setup de cette version dans `distDir` : Player-X-…-Setup-<version>.exe (l'artifactName d'electron-builder), un seul. */
export function findSetup(distDir, version) {
  if (!existsSync(distDir)) fail(`Dossier introuvable : ${distDir}. Fabrique d'abord le Setup (npm run dist).`)
  const re = new RegExp(`^Player-X-(?:.+-)?Setup-${version.replace(/[.+-]/g, '\\$&')}\\.exe$`)
  const found = readdirSync(distDir).filter((f) => re.test(f))
  if (!found.length) fail(`Aucun Setup « Player-X-…-Setup-${version}.exe » dans ${distDir}. Fabrique-le (npm run dist) ou change la version de package.json.`)
  if (found.length > 1) fail(`Plusieurs Setup pour la ${version} dans ${distDir} : ${found.join(', ')}.`)
  return join(distDir, found[0])
}

export function buildManifest({ version, setup, notes, date = new Date().toISOString().slice(0, 10) }) {
  if (!SEMVER.test(version)) fail(`Version « ${version} » invalide dans package.json.`)
  const mine = notes.find((e) => e.version === version)
  if (!mine || !mine.items.length) fail(`Pas de notes pour la ${version} dans notes-de-version.json : ajoute une entrée (au moins une nouveauté), puis relance.`)
  const size = statSync(setup).size
  if (size < 1 || size > MAX_SETUP) fail(`Le Setup pèse ${size} octets : l'appli refuse plus de 400 Mo.`)
  const data = readFileSync(setup)
  const file = basename(setup)
  if (!/^[\w.-]+\.exe$/.test(file)) fail(`Nom de fichier « ${file} » refusé par l'appli (lettres, chiffres, point, tiret, souligné).`)
  const recent = notes
    .filter((e) => (compareVersions(e.version, version) ?? 1) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, KEEP_NOTES)
  const manifest = {
    version,
    date,
    file,
    url: `${RELEASES}/download/v${version}/${file}`,
    size,
    sha256: createHash('sha256').update(data).digest('hex'),
    notes: recent
  }
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  if (bytes.length > MAX_MANIFEST) fail('maj.json dépasse 256 Ko : trop de notes.')
  return { manifest, bytes }
}

// ---------- clés ----------

/** Les clés publiques de updaterKey.ts. */
export function readPublicKeys(file = KEY_FILE) {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----\n?/g)].map((m) => m[0])
}

/** Ajoute une clé publique au tableau de updaterKey.ts (les anciennes restent). */
export function appendPublicKey(pem, file = KEY_FILE) {
  const text = readFileSync(file, 'utf8')
  const keys = readPublicKeys(file)
  if (keys.some((k) => k.trim() === pem.trim())) return false
  const body = [...keys, pem].map((k) => `  \`${k.endsWith('\n') ? k : k + '\n'}\``).join(',\n')
  const next = text.replace(/export const UPDATE_KEYS: string\[\] = \[[^\]]*\]/, `export const UPDATE_KEYS: string[] = [\n${body}\n]`)
  if (next === text) fail('updaterKey.ts n’a pas la forme attendue (export const UPDATE_KEYS: string[] = [...]).')
  writeFileSync(file, next)
  return true
}

export function signBytes(bytes, privateKeyPem, passphrase) {
  return sign(null, bytes, createPrivateKey({ key: privateKeyPem, format: 'pem', passphrase }))
}

// ---------- terminal ----------

function askSecret(prompt) {
  return new Promise((res, rej) => {
    if (!process.stdin.isTTY) return rej(new Error('Il faut un terminal interactif pour taper le mot de passe.'))
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    let buf = ''
    const end = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', on)
      process.stdout.write('\n')
    }
    const on = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          end()
          return res(buf)
        }
        if (ch === '\u0003') {
          end()
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1)
        else buf += ch
      }
    }
    process.stdin.on('data', on)
  })
}

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

// ---------- coffre de Windows (DPAPI) ----------

/** Chiffre ou déchiffre avec le coffre de Windows : seul ce compte Windows, sur ce PC, peut rouvrir. Les données passent par l'entrée standard. */
function vault(mode, data) {
  if (process.platform !== 'win32') fail('Le coffre de Windows ne marche que sous Windows.')
  const ps = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $e=[Text.Encoding]::UTF8.GetBytes('player-x-maj'); $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $r=[Security.Cryptography.ProtectedData]::${mode}($b,$e,'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($r))`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { input: data.toString('base64'), encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 20 })
  if (r.status !== 0 || !r.stdout) fail(mode === 'Unprotect' ? 'Le coffre de Windows n’a pas pu rouvrir la clé (autre PC ou autre compte Windows ?). Relance la mise en place.' : 'Le coffre de Windows a refusé d’enregistrer.')
  return Buffer.from(r.stdout.trim(), 'base64')
}
const vaultSave = (file, buf) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, vault('Protect', buf).toString('base64') + '\n', { mode: 0o600 })
}
const vaultRead = (file) => vault('Unprotect', Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'))

// ---------- GitHub ----------

/** Le texte de la Release : les notes de cette version. */
export function releaseBody(entry) {
  const lab = { nouveau: 'Nouveau', ameliore: 'Amélioré', corrige: 'Corrigé' }
  return entry.items.map((i) => `- **${lab[i.kind]}** · ${i.title} : ${i.text}`).join('\n')
}

/**
 * Ordre des fichiers : le Setup, la signature, maj.json EN DERNIER (dans une Release déjà publiée, l'appli ne voit rien avant lui).
 * Crée la Release en brouillon (ou reprend un brouillon de la même étiquette), envoie les fichiers, puis publie EN DERNIER :
 * les Player X installés ne voient rien tant que les trois fichiers ne sont pas tous là. `http` : fetch (remplacé dans les tests).
 */
export async function githubRelease({ token, version, files, body, http = fetch, repo = REPO }) {
  const api = `https://api.github.com/repos/${repo}`
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'player-x-publier' }
  const call = async (method, url, json, okCodes = [200, 201]) => {
    const res = await http(url, { method, headers: json ? { ...h, 'Content-Type': 'application/json' } : h, body: json ? JSON.stringify(json) : undefined })
    if (!okCodes.includes(res.status)) {
      const t = await res.text().catch(() => '')
      if (res.status === 401) fail('GitHub refuse le jeton (expiré ou faux). Relance la mise en place pour en donner un nouveau.')
      if (res.status === 403 || res.status === 404) fail(`GitHub refuse l’accès au dépôt (${res.status}). Le jeton doit avoir « Contents : Read and write » sur ${repo}.`)
      fail(`GitHub a répondu ${res.status} : ${t.slice(0, 200)}`)
    }
    return res.status === 204 ? null : res.json()
  }
  const tag = `v${version}`
  const found = await call('GET', `${api}/releases/tags/${tag}`, null, [200, 404])
  let rel
  if (found && found.id) {
    // Déjà publiée : on ne complète que si elle n'a encore aucun de ces fichiers (Release créée vide). Sinon, c'est une autre version qu'il faut.
    const has = (found.assets || []).filter((a) => files.some((f) => basename(f) === a.name))
    if (!found.draft && has.length) fail(`La Release ${tag} est déjà publiée sur GitHub avec ses fichiers. Change la version avant de republier.`)
    rel = found
    for (const a of has) await call('DELETE', `${api}/releases/assets/${a.id}`, null, [204])
  } else {
    rel = await call('POST', `${api}/releases`, { tag_name: tag, target_commitish: 'main', name: `Player X ${version}`, body, draft: true, prerelease: false })
  }
  for (const f of files) {
    const data = readFileSync(f)
    const name = basename(f)
    console.log(`  envoi de ${name} (${(data.length / 1024 / 1024).toFixed(1)} Mo)…`)
    const res = await http(`https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: data })
    if (res.status !== 201) fail(`L’envoi de ${name} a échoué (${res.status}). La Release reste en brouillon : relance Publier.bat.`)
  }
  if (!rel.draft && rel.html_url) return rel.html_url
  const done = await call('PATCH', `${api}/releases/${rel.id}`, { draft: false, make_latest: 'true' })
  return done.html_url
}

async function checkToken(token, http = fetch) {
  const res = await http(`https://api.github.com/repos/${REPO}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'player-x-publier' } })
  if (res.status !== 200) fail(`GitHub refuse ce jeton (${res.status}).`)
  const j = await res.json()
  if (!j.permissions || !j.permissions.push) fail(`Ce jeton ne peut pas écrire dans ${REPO} : il faut « Contents : Read and write ».`)
}

// ---------- commandes ----------

async function makeKey() {
  const target = resolve(argValue('--cle-fichier') || DEFAULT_PRIVATE)
  if (existsSync(target)) fail(`Une clé existe déjà : ${target}\nElle n'est jamais remplacée (les Player X installés ne reconnaîtraient plus tes mises à jour). Pour une nouvelle clé, choisis un autre fichier avec --cle-fichier.`)
  console.log(`Création de la clé de signature des mises à jour.\nLa clé privée sera ici : ${target}\n(Garde-la hors de GitHub, hors du dépôt, et fais-en une copie : sans elle, plus de mise à jour possible.)\n`)
  const a = await askSecret('Mot de passe de la clé (12 caractères au moins) : ')
  if (a.length < 12) fail('Mot de passe trop court.')
  const b = await askSecret('Le même, encore une fois : ')
  if (a !== b) fail('Les deux mots de passe ne sont pas les mêmes. Rien n’a été créé.')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: a })
  mkdirSync(dirname(target), { recursive: true })
  // 'wx' : jamais d'écrasement, même si le fichier est apparu entre-temps
  writeFileSync(target, priv, { flag: 'wx', mode: 0o600 })
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const added = appendPublicKey(pub)
  console.log(`\nClé privée écrite : ${target}`)
  console.log(added ? `Clé publique ajoutée à ${KEY_FILE}.\nCommit ce fichier : l'appli ne vérifiera que cette clé.` : 'Clé publique déjà dans updaterKey.ts.')
}

async function setupVault() {
  if (!existsSync(DEFAULT_PRIVATE)) fail(`Clé privée introuvable : ${DEFAULT_PRIVATE}`)
  console.log('Mise en place, une seule fois : ta clé va dans le coffre de Windows (liée à ce PC et à ta session).\n')
  const pass = await askSecret('Mot de passe de la clé de signature : ')
  let pem
  try {
    pem = createPrivateKey({ key: readFileSync(DEFAULT_PRIVATE, 'utf8'), format: 'pem', passphrase: pass }).export({ type: 'pkcs8', format: 'pem' })
  } catch {
    fail('Mot de passe faux, ou clé illisible.')
  }
  const probe = Buffer.from('player-x')
  if (!readPublicKeys().some((k) => verify(null, probe, createPublicKey(k), sign(null, probe, createPrivateKey(pem))))) fail('Cette clé ne correspond à aucune clé de updaterKey.ts.')
  vaultSave(VAULT_KEY, Buffer.from(pem))
  console.log('Clé rangée dans le coffre.\n')
  console.log('Jeton GitHub, pour envoyer la Release tout seul (laisse vide pour continuer à la faire à la main).')
  const token = (await askSecret('Jeton GitHub : ')).trim()
  if (token) {
    await checkToken(token)
    vaultSave(VAULT_TOKEN, Buffer.from(token))
    console.log('Jeton rangé dans le coffre.')
  }
  console.log('\nC’est fini. Désormais, un double-clic sur Publier.bat suffit.')
}

async function publish() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const version = pkg.version
  const distDir = resolve(root, argValue('--dist') || 'dist')
  const keyFile = resolve(argValue('--cle-fichier') || DEFAULT_PRIVATE)
  if (!readPublicKeys().length) fail('updaterKey.ts n’a aucune clé publique : lance d’abord « npm run maj:cle ».')
  const fromVault = !argValue('--cle-fichier') && existsSync(VAULT_KEY)
  if (!fromVault && !existsSync(keyFile)) fail(`Clé privée introuvable : ${keyFile}\nLance « npm run maj:cle » pour la créer.`)
  const notes = readNotes(join(root, 'notes-de-version.json'))
  const setup = findSetup(distDir, version)
  const { manifest, bytes } = buildManifest({ version, setup, notes })
  let sig
  if (fromVault) {
    sig = sign(null, bytes, createPrivateKey(vaultRead(VAULT_KEY).toString('utf8')))
  } else {
    const pass = await askSecret('Mot de passe de la clé de signature : ')
    try {
      sig = signBytes(bytes, readFileSync(keyFile, 'utf8'), pass)
    } catch {
      fail('Mot de passe faux, ou clé illisible.')
    }
  }
  // La clé qui signe doit être une de celles que l'appli connaît, sinon l'appli refuserait tout.
  if (!readPublicKeys().some((k) => verify(null, bytes, createPublicKey(k), sig))) fail('Cette clé privée ne correspond à aucune clé de updaterKey.ts : l’appli refuserait ce maj.json.')
  const out = join(distDir, 'maj')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'maj.json'), bytes)
  writeFileSync(join(out, 'maj.json.sig'), sig.toString('base64') + '\n')
  const mo = (manifest.size / 1024 / 1024).toFixed(1)
  console.log(`\nPrêt : version ${version}, ${manifest.file} (${mo} Mo), notes de ${manifest.notes.length} version(s).`)
  console.log(`Fichiers écrits dans ${out} :\n  maj.json\n  maj.json.sig\n`)
  if (existsSync(VAULT_TOKEN)) {
    console.log('Envoi sur GitHub :')
    const url = await githubRelease({ token: vaultRead(VAULT_TOKEN).toString('utf8').trim(), version, files: [setup, join(out, 'maj.json.sig'), join(out, 'maj.json')], body: releaseBody(notes.find((e) => e.version === version)) })
    console.log(`\nPublié : ${url}\nLes Player X installés la proposeront d'eux-mêmes.`)
    return
  }
  process.exitCode = MANUAL_EXIT
  console.log(`À faire sur GitHub (Moon-ItachiDEV/player-x-luncher), dans cet ordre :
  1. Releases › « Draft a new release » (un BROUILLON), étiquette  v${version}  (crée-la sur la bonne branche).
  2. Glisse dans la Release : ${manifest.file}, maj.json et maj.json.sig (les trois, noms inchangés).
  3. Relis, puis « Publish release » EN DERNIER : c'est à ce moment seulement que les Player X la voient.
  Les Player X installés ne prennent que la Release « latest » : ne coche pas « pre-release ».`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = process.argv.includes('--cle') ? makeKey : process.argv.includes('--coffre') ? setupVault : publish
  run().catch((e) => {
    console.error(`\nErreur : ${e.message}`)
    process.exit(1)
  })
}
