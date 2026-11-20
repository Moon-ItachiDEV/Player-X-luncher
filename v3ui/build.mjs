#!/usr/bin/env node
// Assemble l'interface V3 : src/renderer/public/v3/{index.html,app.js,app.css,assets/,fonts/}. Copié aussi dans out/renderer/v3 pour les essais sans refaire electron-vite.
import * as esbuild from 'esbuild'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const U = dirname(fileURLToPath(import.meta.url))
const R = dirname(U)
const S = join(U, 'src')
const OUT = join(R, 'src/renderer/public/v3')

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

mkdirSync(join(OUT, 'assets'), { recursive: true })

esbuild.buildSync({
  entryPoints: [join(U, 'shared-entry.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'Shared',
  platform: 'browser',
  target: 'chrome130',
  alias: { '@shared': join(R, 'src/shared') },
  outfile: join(U, '.shared.js'),
  logLevel: 'warning'
})

let css = `@font-face{font-family:'Archivo';src:url(fonts/archivo.woff2) format('woff2');font-weight:100 900;font-stretch:62% 125%;font-display:swap}
@font-face{font-family:'Sora';src:url(fonts/sora.woff2) format('woff2');font-weight:100 800;font-display:swap}
`
// Boutons caméléon (style.css) : une police par style, sous licence libre (OFL, Apache pour Special Elite ; textes dans fonts/licences)
const FONTS = [
  ['PX Neon', 'chakra-petch-700', 700, false],
  ['PX Stade', 'barlow-condensed-800i', 800, true],
  ['PX Epique', 'cinzel-700', 700, false],
  ['PX Pop', 'baloo2-800', 800, false],
  ['PX Vitesse', 'racing-sans-one', 400, false],
  ['PX Frisson', 'special-elite', 400, false],
  ['PX Tactique', 'share-tech-mono', 400, false]
]
for (const [fam, f, w, it] of FONTS) {
  css += `@font-face{font-family:'${fam}';src:url(fonts/${f}.woff2) format('woff2');font-weight:${w};font-style:${it ? 'italic' : 'normal'};font-display:swap}\n`
}

const srcFiles = readdirSync(S)
for (const f of srcFiles.filter((n) => n.endsWith('.css')).sort(byName)) {
  css += readFileSync(join(S, f), 'utf8') + '\n'
}

const ORDER = [
  'data.js', 'core.js', 'real.js', 'real-friends.js', 'fluid.js', 'pxtype.js', 'style.js', 'play.js', 'bar.js', 'live.js',
  'clips.js', 'edit.js', 'pages.js', 'board.js', 'stats.js', 'atelier.js', 'news.js', 'settings.js', 'flows.js', 'maj.js', 'moments.js', 'main.js'
]

// Un fichier de ORDER absent, ou un fichier de src/ hors de ORDER, arrête le build : rien ne disparaît en silence
const presentJs = new Set(srcFiles.filter((n) => n.endsWith('.js')))
const orderSet = new Set(ORDER)
const manque = ORDER.filter((f) => !presentJs.has(f))
const oublie = [...presentJs].filter((f) => !orderSet.has(f)).sort(byName)
if (manque.length || oublie.length) {
  console.error(`build.mjs : absents de src/ ${JSON.stringify(manque)}, absents de ORDER ${JSON.stringify(oublie)}`)
  process.exit(1)
}

let js = readFileSync(join(U, 'constants.js'), 'utf8') + '\n' + readFileSync(join(U, '.shared.js'), 'utf8') + '\n'
for (const f of ORDER) {
  js += `\n// ---- ${f}\n` + readFileSync(join(S, f), 'utf8')
}

// Allègement : espaces et syntaxe pour le JS (les noms restent : les modules se parlent par leurs noms globaux), tout pour le CSS
const minify = (src, loader, opts) => {
  try {
    return esbuild.transformSync(src, { loader, target: 'chrome130', charset: 'utf8', logLevel: 'warning', ...opts }).code
  } catch (e) {
    console.error(`build.mjs : esbuild a refusé le ${loader}\n${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}

js = minify(js, 'js', { minifyWhitespace: true, minifySyntax: true })
css = minify(css, 'css', { minify: true })

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: blob: https: pxclip:; media-src 'self' blob: pxclip:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self' pxclip:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<title>Player X V3 Test</title>
<link rel="stylesheet" href="app.css">
</head>
<body>
<div id="root"><main id="stage"><div id="win" data-view="play"></div></main></div>
<script src="app.js"></script>
</body>
</html>
`

const write = (base) => {
  mkdirSync(join(base, 'assets'), { recursive: true })
  writeFileSync(join(base, 'index.html'), html, 'utf8')
  writeFileSync(join(base, 'app.js'), js, 'utf8')
  writeFileSync(join(base, 'app.css'), css, 'utf8')
  // Les images et polices sont recopiées à neuf : un fichier retiré de v3ui ne part plus dans l'exe
  rmSync(join(base, 'assets'), { recursive: true, force: true })
  cpSync(join(U, 'assets'), join(base, 'assets'), { recursive: true })
  rmSync(join(base, 'fonts'), { recursive: true, force: true })
  cpSync(join(U, 'fonts'), join(base, 'fonts'), { recursive: true })
}

write(OUT)
const outRenderer = join(R, 'out/renderer')
if (existsSync(outRenderer) && statSync(outRenderer).isDirectory()) {
  write(join(outRenderer, 'v3'))
}
console.log('app.js', Math.floor(Buffer.byteLength(js, 'utf8') / 1024), 'Ko, app.css', Math.floor(Buffer.byteLength(css, 'utf8') / 1024), 'Ko')
