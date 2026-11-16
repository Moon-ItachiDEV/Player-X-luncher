#!/usr/bin/env node
// Publication d'une mise à jour de Player X (Node seul, marche sous Windows).
//
//   node scripts/publier-maj.mjs --cle        crée la paire de clés (une seule fois) : la clé privée reste sur ton PC, chiffrée par
//                                             un mot de passe, hors du dépôt ; la clé publique est ajoutée à src/main/services/updaterKey.ts
//   node scripts/publier-maj.mjs              prépare la publication de la version de package.json : dist/maj/maj.json + maj.json.sig
//     options : --dist <dossier>              où est le Setup (par défaut dist)
//               --cle-fichier <fichier>       la clé privée (par défaut %USERPROFILE%\.player-x\cle-maj.pem)
//
// Rien n'est envoyé nulle part : le script écrit des fichiers et dit quoi publier à la main sur GitHub.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const KEY_FILE = join(root, 'src/main/services/updaterKey.ts')
export const DEFAULT_PRIVATE = join(homedir(), '.player-x', 'cle-maj.pem')
const RELEASES = 'https://github.com/Moon-ItachiDEV/player-x-luncher/releases'
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

async function publish() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const version = pkg.version
  const distDir = resolve(root, argValue('--dist') || 'dist')
  const keyFile = resolve(argValue('--cle-fichier') || DEFAULT_PRIVATE)
  if (!readPublicKeys().length) fail('updaterKey.ts n’a aucune clé publique : lance d’abord « npm run maj:cle ».')
  if (!existsSync(keyFile)) fail(`Clé privée introuvable : ${keyFile}\nLance « npm run maj:cle » pour la créer.`)
  const notes = readNotes(join(root, 'notes-de-version.json'))
  const setup = findSetup(distDir, version)
  const { manifest, bytes } = buildManifest({ version, setup, notes })
  const pass = await askSecret('Mot de passe de la clé de signature : ')
  let sig
  try {
    sig = signBytes(bytes, readFileSync(keyFile, 'utf8'), pass)
  } catch {
    fail('Mot de passe faux, ou clé illisible.')
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
  console.log(`À faire sur GitHub (Moon-ItachiDEV/player-x-luncher), dans cet ordre :
  1. Releases › « Draft a new release » (un BROUILLON), étiquette  v${version}  (crée-la sur la bonne branche).
  2. Glisse dans la Release : ${manifest.file}, maj.json et maj.json.sig (les trois, noms inchangés).
  3. Relis, puis « Publish release » EN DERNIER : c'est à ce moment seulement que les Player X la voient.
  Les Player X installés ne prennent que la Release « latest » : ne coche pas « pre-release ».`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = process.argv.includes('--cle') ? makeKey : publish
  run().catch((e) => {
    console.error(`\nErreur : ${e.message}`)
    process.exit(1)
  })
}
