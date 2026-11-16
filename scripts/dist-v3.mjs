#!/usr/bin/env node
// Fabrication complète de Player X V3 Test, dans l'ordre, et arrêt à la première erreur :
//   0. le moteur vidéo (scripts/fetch-ffmpeg.mjs : FFmpeg, téléchargé une fois et vérifié par son empreinte)
//   1. l'interface V3 (python3 v3ui/build.py)   2. les types (main, preload, overlay, scripts)   3. les tests
//   4. electron-vite   5. electron-builder (NSIS)   6. l'installeur sur mesure (Go)
//   node scripts/dist-v3.mjs [dossier de sortie]      (par défaut dist/ ; sous Linux, Wine et Go sont nécessaires)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const out = resolve(root, process.argv[2] || 'dist')
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// Mises à jour dans l'appli : pas de fabrication sans la clé publique de Breezydev dans updaterKey.ts. Un Setup sans elle,
// une fois publié, ne pourrait plus jamais se mettre à jour chez personne. PX_MAJ_SANS_CLE=1 : seulement pour un essai jetable.
const MAJ_CLE = 'MCowBQYDK2VwAyEAsE9FqykThj3fwaJo0YmYxqJD6adOmSOpM32JSX0Ugiw='
if (process.env.PX_MAJ_SANS_CLE !== '1') {
  const keyTs = readFileSync(join(root, 'src/main/services/updaterKey.ts'), 'utf8').replace(/\\n|\s/g, '')
  if (!keyTs.includes(MAJ_CLE)) {
    console.error('Arrêt : src/main/services/updaterKey.ts n’a pas la clé publique attendue, donc ce Setup ne pourrait pas se mettre à jour.\nReprends updaterKey.ts de la branche des mises à jour (ou, si la clé a changé exprès, mets la nouvelle dans MAJ_CLE de ce script).')
    process.exit(1)
  }
}
const run = (title, cmd, args) => {
  console.log(`\n▶ ${title}`)
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
}

// Le moteur vidéo d'abord : sans lui (ou avec une autre empreinte que celle de src/shared/ffmpegPin.json), rien n'est fabriqué.
run('Moteur vidéo', process.execPath, [join(root, 'scripts/fetch-ffmpeg.mjs')])
run('Interface V3', process.platform === 'win32' ? 'python' : 'python3', ['v3ui/build.py'])
run('Types', npm, ['run', 'typecheck'])
run('Tests', npm, ['test'])
run('electron-vite', npx, ['electron-vite', 'build'])
run('electron-builder (NSIS)', npx, ['electron-builder', '--win', '--x64', '--publish', 'never', `--config.directories.output=${out}`])
const setup = join(out, `Player-X-V3-Test-Setup-${pkg.version}.exe`)
run('Installeur sur mesure', process.execPath, [join(root, 'scripts/build-installer-v3test.mjs'), setup, join(out, 'win-unpacked'), join(out, `Player-X-V3-Test-Installer-${pkg.version}.exe`)])
console.log(`\nFini : ${out}`)
