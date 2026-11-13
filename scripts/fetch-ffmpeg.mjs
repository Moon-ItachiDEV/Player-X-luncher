#!/usr/bin/env node
// Le moteur vidéo livré avec Player X V3 Test : FFmpeg, récupéré tel quel et vérifié par son empreinte.
//   node scripts/fetch-ffmpeg.mjs [zip déjà téléchargé]
// Le build exact, son adresse et ses empreintes SHA-256 sont dans src/shared/ffmpegPin.json (le processus principal relit la
// même fiche pour revérifier le fichier avant de le lancer). Résultat dans vendor/ffmpeg/ (pas suivi par git) :
//   ffmpeg.exe, LICENSE.txt (sa licence) et SOURCE.txt (d'où il vient, où sont ses sources).
// Rien n'est lancé ici : le fichier est seulement téléchargé, comparé, dézippé et recomparé.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, inflateRawSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pin = JSON.parse(readFileSync(join(root, 'src/shared/ffmpegPin.json'), 'utf8'))
const out = join(root, 'vendor/ffmpeg')
const exe = join(out, 'ffmpeg.exe')

/** @param {string} file @returns {Promise<string>} */
const sha256 = (file) =>
  new Promise((ok, ko) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (d) => h.update(d)).on('error', ko).on('end', () => ok(h.digest('hex')))
  })
const mo = (/** @type {number} */ n) => `${(n / 1e6).toFixed(1).replace('.', ',')} Mo`

/**
 * Sort un fichier d'un zip (sans zip64 ni chiffrement : le cas de ce zip). Lit le répertoire central, puis les données de
 * l'entrée, et vérifie sa taille et son CRC-32.
 * @param {Buffer} zip @param {string} name @returns {Buffer}
 */
function unzipOne(zip, name) {
  let end = zip.length - 22
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new Error('zip illisible : pas de répertoire central')
  const count = zip.readUInt16LE(end + 10)
  let pos = zip.readUInt32LE(end + 16)
  if (count === 0xffff || pos === 0xffffffff) throw new Error('zip64 : format non prévu')
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error('zip illisible : entrée abîmée')
    const flags = zip.readUInt16LE(pos + 8)
    const method = zip.readUInt16LE(pos + 10)
    const crc = zip.readUInt32LE(pos + 16)
    const packed = zip.readUInt32LE(pos + 20)
    const size = zip.readUInt32LE(pos + 24)
    const nameLen = zip.readUInt16LE(pos + 28)
    const extraLen = zip.readUInt16LE(pos + 30)
    const commentLen = zip.readUInt16LE(pos + 32)
    const local = zip.readUInt32LE(pos + 42)
    const entry = zip.toString('utf8', pos + 46, pos + 46 + nameLen)
    pos += 46 + nameLen + extraLen + commentLen
    if (entry !== name) continue
    if (flags & 1) throw new Error(`${name} : entrée chiffrée`)
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error('zip64 : format non prévu')
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`${name} : en-tête abîmé`)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(start, start + packed)
    const file = method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : null
    if (!file) throw new Error(`${name} : compression ${method} non prévue`)
    if (file.length !== size || crc32(file) !== crc) throw new Error(`${name} : taille ou CRC différents du zip`)
    return file
  }
  throw new Error(`${name} : absent du zip`)
}

const source = () => `FFmpeg ${pin.build} (construit le ${pin.builtOn})

Player X lance ce programme pour fabriquer tes films. Il est livré tel quel : il n'est ni modifié, ni fondu dans Player X.

Licence : ${pin.license}. Son texte est dans LICENSE.txt, dans ce dossier.
Site de FFmpeg : https://ffmpeg.org

Le code source de cette version exacte :
${pin.sourceUrl}

Les scripts qui ont servi à la construire (BtbN/FFmpeg-Builds) :
${pin.buildScriptsUrl}

Le fichier d'origine :
${pin.zipUrl}
SHA-256 du zip : ${pin.zipSha256}
SHA-256 de ffmpeg.exe : ${pin.exeSha256}
`

async function main() {
  if (existsSync(exe) && statSync(exe).size === pin.exeSize && (await sha256(exe)) === pin.exeSha256 && existsSync(join(out, 'LICENSE.txt'))) {
    writeFileSync(join(out, 'SOURCE.txt'), source())
    console.log(`Moteur vidéo déjà là : FFmpeg ${pin.version}, ${mo(pin.exeSize)}, empreinte vérifiée.`)
    return
  }
  let zipFile = process.argv[2] ? resolve(process.argv[2]) : ''
  let downloaded = ''
  if (!zipFile) {
    downloaded = zipFile = join(tmpdir(), `px-ffmpeg-${process.pid}.zip`)
    console.log(`Téléchargement de FFmpeg ${pin.version} (${mo(pin.zipSize)})…`)
    // curl : présent sous Windows 10 et plus, macOS et Linux, et il suit les réglages de proxy de la machine.
    execFileSync('curl', ['-fsSL', '--retry', '2', '-o', zipFile, pin.zipUrl], { stdio: 'inherit' })
  }
  try {
    const got = await sha256(zipFile)
    if (got !== pin.zipSha256) throw new Error(`Le zip n'est pas celui attendu.\n  attendu ${pin.zipSha256}\n  reçu    ${got}`)
    const zip = readFileSync(zipFile)
    const bin = unzipOne(zip, pin.exeInZip)
    const hash = createHash('sha256').update(bin).digest('hex')
    if (bin.length !== pin.exeSize || hash !== pin.exeSha256) throw new Error(`ffmpeg.exe n'est pas celui attendu.\n  attendu ${pin.exeSha256}\n  reçu    ${hash}`)
    mkdirSync(out, { recursive: true })
    writeFileSync(exe, bin)
    writeFileSync(join(out, 'LICENSE.txt'), unzipOne(zip, pin.licenseInZip))
    writeFileSync(join(out, 'SOURCE.txt'), source())
    console.log(`Moteur vidéo prêt : FFmpeg ${pin.version}, ${mo(bin.length)}, empreinte vérifiée (${out}).`)
  } finally {
    if (downloaded) rmSync(downloaded, { force: true })
  }
}

main().catch((e) => {
  console.error(`fetch-ffmpeg : ${e.message}`)
  process.exit(1)
})
