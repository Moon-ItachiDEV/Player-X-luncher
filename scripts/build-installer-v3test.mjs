#!/usr/bin/env node
// Construit l'installeur sur mesure de Player X V3 Test (installer/, Go + WebView2) autour de son installeur NSIS.
//   node scripts/build-installer-v3test.mjs <installeur NSIS .exe> <dossier win-unpacked> <sortie .exe>
//   node scripts/build-installer-v3test.mjs --page <sortie .html>     la page seule (essais dans un navigateur)
//
// Différences avec l’installeur du vrai Player X (dépôt GitHub) :
// - l'identité vient de package.json (productName, name, nsis.shortcutName…) et part dans payload/info.json :
//   dossier %LOCALAPPDATA%\Programs\<name>, données %APPDATA%\<productName>, raccourcis et exécutable à son nom.
//   Le dossier ne se choisit pas (fixedDir) : jamais dans celui du vrai Player X. Pas de mises à jour automatiques
//   à vérifier (publish: null), pas d'option « Démarrer avec Windows ».
// - le script refuse de construire si l'identité est celle du vrai Player X ;
// - icône, polices (Archivo, Sora) et logo animé (la console) sont ceux de la V3 ;
// - tout est assemblé dans build/installer-v3test/ : installer/ n'est pas modifié (pas de page.html ni de payload).
// Go doit être installé (variable GO, sinon « go » dans le PATH, sinon /usr/local/go/bin/go). Compilation croisée
// depuis Linux. Les dépendances Go sont dans installer/vendor (rien n'est téléchargé). L'icône et le manifeste
// de l'exe sont refaits avec llvm-rc et llvm-cvtres s'ils sont là ; sinon ceux de installer/ (icône de Player X).
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const b = pkg.build || {}
const nsis = b.nsis || {}

// Identité de l'appli installée, telle que NSIS l'écrit (electron-builder, installation par utilisateur).
const product = {
  name: b.productName || pkg.productName,
  exe: `${b.productName || pkg.productName}.exe`,
  dirName: pkg.name,
  dataDir: b.productName || pkg.productName,
  shortcut: nsis.shortcutName || b.productName,
  display: nsis.uninstallDisplayName || b.productName,
  slug: (b.productName || pkg.productName).replace(/\s+/g, '-'),
  fixedDir: true,
  noUpdates: b.publish === null || b.publish === undefined,
  noBoot: true
}
// Garde-fou : cet installeur ne doit jamais viser le vrai Player X (son dossier, ses données, ses raccourcis).
const real = ['Player X', 'player-x']
if (b.appId === 'dev.breezy.playerx' || [product.name, product.dirName, product.dataDir, product.shortcut, product.display].some((v) => !v || real.includes(v))) {
  console.error(`Identité refusée (${b.appId}, ${product.name}, ${product.dirName}) : ce script est pour une version installée à part.`)
  process.exit(1)
}

/** La page : polices et logo de la V3 intégrés, rien n'est chargé depuis Internet. __PX_ICON__ est remplacé par l'installeur. */
function buildPage() {
  const b64 = (p) => readFileSync(join(root, p)).toString('base64')
  const fonts = [
    `@font-face{font-family:'Archivo';font-weight:100 900;font-stretch:62% 125%;font-display:block;src:url(data:font/woff2;base64,${b64('v3ui/fonts/archivo.woff2')}) format('woff2')}`,
    `@font-face{font-family:'Sora';font-weight:100 800;font-display:block;src:url(data:font/woff2;base64,${b64('v3ui/fonts/sora.woff2')}) format('woff2')}`
  ].join('\n')
  const m = readFileSync(join(root, 'v3ui/constants.js'), 'utf8').match(/const LOGO_FULL='([^']*)'/)
  if (!m) throw new Error('LOGO_FULL introuvable dans v3ui/constants.js')
  const logo = `<span class="logo">${m[1].replaceAll('pxc-', 'pxi-')}</span>`
  // Le mot « PLAYER X » dessiné (repère facultatif : sans lui, la page l'écrit en texte)
  const wm = readFileSync(join(root, 'v3ui/constants.js'), 'utf8').match(/const WORDMARK='([^']*)'/)
  const page = readFileSync(join(root, 'installer/ui/index.html'), 'utf8')
  if (!page.includes('/*__PX_FONTS__*/') || !page.includes('<!--__PX_LOGO__-->')) throw new Error('installer/ui/index.html : repères __PX_FONTS__ ou __PX_LOGO__ absents')
  return page.replace('/*__PX_FONTS__*/', () => fonts).replace('<!--__PX_LOGO__-->', () => logo).replace('<!--__PX_WORDMARK__-->', () => (wm ? wm[1].replaceAll('pxc-', 'pxw-') : ''))
}

const args = process.argv.slice(2)
if (args[0] === '--page') {
  if (!args[1]) {
    console.error('usage : node scripts/build-installer-v3test.mjs --page <sortie .html>')
    process.exit(1)
  }
  writeFileSync(resolve(args[1]), buildPage())
  console.log(`Page : ${args[1]}`)
  process.exit(0)
}

const [setup, unpacked, out] = args
if (!setup || !unpacked || !out) {
  console.error('usage : node scripts/build-installer-v3test.mjs <installeur NSIS .exe> <dossier win-unpacked> <sortie .exe>')
  process.exit(1)
}
if (!existsSync(join(resolve(unpacked), product.exe))) {
  console.error(`${product.exe} absent de ${unpacked} : ce n'est pas la bonne construction.`)
  process.exit(1)
}
if (!existsSync(join(root, 'installer/vendor/modules.txt'))) {
  console.error('installer/vendor manque (dépendances Go) : copie-le depuis le dépôt de Player X.')
  process.exit(1)
}

/** Taille installée : somme des fichiers du dossier win-unpacked (la progression la suit pendant la copie). */
function size(p) {
  const st = statSync(p)
  if (!st.isDirectory()) return st.size
  return readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0)
}

// Copie de travail : installer/ sans ses fichiers produits (ni la fenêtre de mise à jour, qui n'est pas construite ici).
const work = join(root, 'build/installer-v3test')
rmSync(work, { recursive: true, force: true })
cpSync(join(root, 'installer'), work, {
  recursive: true,
  filter: (src) => !/[\\/]installer[\\/](payload|cmd)([\\/]|$)/.test(src) && !src.endsWith(join('ui', 'page.html'))
})
const payload = join(work, 'payload')
mkdirSync(payload, { recursive: true })
copyFileSync(resolve(setup), join(payload, 'setup.exe'))
copyFileSync(join(root, 'resources/icon.png'), join(payload, 'icon.png'))
writeFileSync(join(payload, 'info.json'), JSON.stringify({ version: pkg.version, size: size(resolve(unpacked)), ...product }))
writeFileSync(join(work, 'ui/page.html'), buildPage())

// Icône (celle de la V3 Test, avec son badge) et manifeste de l'exe.
function which(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' })
    return true
  } catch (e) {
    return e.code !== 'ENOENT'
  }
}
if (which('llvm-rc') && which('llvm-cvtres')) {
  const res = join(work, 'res')
  mkdirSync(res, { recursive: true })
  copyFileSync(join(root, 'resources/icon.ico'), join(res, 'icon.ico'))
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  writeFileSync(join(res, 'app.manifest'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="${esc(product.slug.replace(/-/g, ''))}.Installer" version="0.0.0.0" processorArchitecture="*"/>
  <description>Installation de ${esc(product.name)}</description>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">permonitorv2,system</dpiAwareness>
    </windowsSettings>
  </application>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
</assembly>
`)
  const v = (pkg.version.match(/\d+/g) || []).slice(0, 3).concat(['0', '0', '0']).slice(0, 4).join(',')
  const rcs = (s) => s.replace(/"/g, '""')
  // UTF-8 (#pragma code_page) : accents des textes de version.
  writeFileSync(join(res, 'app.rc'), `#pragma code_page(65001)
1 ICON "icon.ico"
1 24 "app.manifest"
1 VERSIONINFO
FILEVERSION ${v}
PRODUCTVERSION ${v}
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040C04B0"
    BEGIN
      VALUE "CompanyName", "${rcs(pkg.author || b.copyright || '')}"
      VALUE "FileDescription", "Installation de ${rcs(product.name)}"
      VALUE "FileVersion", "${rcs(pkg.version)}"
      VALUE "ProductName", "${rcs(product.name)}"
      VALUE "ProductVersion", "${rcs(pkg.version)}"
      VALUE "LegalCopyright", "${rcs(b.copyright || '')}"
      VALUE "OriginalFilename", "${rcs(product.slug)}-Installer.exe"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x040C, 1200
  END
END
`)
  execFileSync('llvm-rc', ['/L', '0x040C', '/FO', join(res, 'app.res'), join(res, 'app.rc')], { cwd: res, stdio: 'inherit' })
  execFileSync('llvm-cvtres', ['/MACHINE:X64', `/OUT:${join(work, 'rsrc_windows_amd64.syso')}`, join(res, 'app.res')], { cwd: res, stdio: 'inherit' })
  rmSync(res, { recursive: true, force: true })
} else {
  console.warn('llvm-rc ou llvm-cvtres absent : l’exe garde l’icône et le manifeste de installer/ (ceux de Player X).')
}

const go = process.env.GO || (which('go') ? 'go' : '/usr/local/go/bin/go')
execFileSync(go, ['build', '-mod=vendor', '-trimpath', '-ldflags', '-H windowsgui -s -w', '-o', resolve(out), '.'], {
  cwd: work,
  stdio: 'inherit',
  env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0', GOFLAGS: '-mod=vendor' }
})
console.log(`Installeur sur mesure : ${out} (${(statSync(out).size / 1048576).toFixed(1)} Mo)`)
