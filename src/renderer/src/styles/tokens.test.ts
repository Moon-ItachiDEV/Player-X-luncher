// Garde-fous du thème (npm run test:ui) : contrastes des jetons, couleurs d'avant la 0.7.4, variables CSS déclarées,
// noms de classes uniques. Lit les fichiers tels quels, sans navigateur ni dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RENDERER = fileURLToPath(new URL('../', import.meta.url))
// Le fichier qui crée la fenêtre principale : sa couleur de fond et celles de sa barre de titre y sont écrites en dur.
const MAIN_WINDOW = fileURLToPath(new URL('../../../main/mainWindow.ts', import.meta.url))

const files = (ext: RegExp): string[] =>
  (readdirSync(RENDERER, { recursive: true }) as string[]).filter((f) => ext.test(f)).map((f) => join(RENDERER, f))
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = files(/\.css$/).map((path) => ({ path, text: stripComments(readFileSync(path, 'utf8')) }))
const TS = files(/\.tsx?$/).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
const rel = (p: string): string => p.slice(RENDERER.length)

// ---------- couleurs ----------

type Rgba = [number, number, number, number]
const tokensCss = readFileSync(join(RENDERER, 'styles/tokens.css'), 'utf8')
const root = tokensCss.slice(tokensCss.indexOf(':root'))

function token(name: string): string {
  const m = root.match(new RegExp(`--${name}:\\s*([^;]+);`))
  assert.ok(m, `--${name} absent de tokens.css`)
  return m[1].trim()
}
function parse(c: string): Rgba {
  const hex = c.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba
  const rgba = c.match(/^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/)
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], rgba[4] === undefined ? 1 : +rgba[4]]
  throw new Error(`couleur illisible : ${c}`)
}
/** `fg` (avec son alpha) posé sur `bg` opaque. */
const over = (fg: Rgba, bg: Rgba): Rgba => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as Rgba
/** color-mix(in srgb, a p%, b) */
const mix = (a: Rgba, p: number, b: Rgba): Rgba => [0, 1, 2].map((i) => a[i] * p + b[i] * (1 - p)).concat(1) as Rgba
const lum = (c: Rgba): number => {
  const ch = c.slice(0, 3).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
const ratio = (a: Rgba, b: Rgba): number => {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

test('contrastes : textes 1 à 3 ≥ 4,5 sur tous les fonds, pastilles de store ≥ 4,5, hors ligne ≥ 3', () => {
  const bg1 = parse(token('bg-1'))
  const stops = token('card-bg').match(/rgba\([^)]+\)/g) ?? []
  assert.equal(stops.length, 2, '--card-bg : deux arrêts rgba attendus')
  const backgrounds: Record<string, Rgba> = {
    'bg-0': parse(token('bg-0')),
    'bg-1': bg1,
    'bg-2': parse(token('bg-2')),
    'bg-rail': parse(token('bg-rail')),
    'surface-1': parse(token('surface-1')),
    'surface-2': parse(token('surface-2')),
    'card-bg (haut)': over(parse(stops[0]), bg1),
    'card-bg (bas)': over(parse(stops[1]), bg1)
  }
  const failures: string[] = []
  for (const t of ['text-1', 'text-2', 'text-3']) {
    for (const [name, bg] of Object.entries(backgrounds)) {
      const r = ratio(parse(token(t)), bg)
      if (r < 4.5) failures.push(`--${t} sur ${name} : ${r.toFixed(2)}`)
    }
  }
  // Exception connue : --text-3 sur --surface-3 (≈ 4,3). Les infobulles du rail y passent en --text-2.
  for (const t of ['text-1', 'text-2']) {
    const r = ratio(parse(token(t)), parse(token('surface-3')))
    if (r < 4.5) failures.push(`--${t} sur surface-3 : ${r.toFixed(2)}`)
  }
  const offline = ratio(parse(token('st-offline')), backgrounds['bg-2'])
  if (offline < 3) failures.push(`--st-offline sur bg-2 : ${offline.toFixed(2)}`)
  // Pastilles de store (base.css) : teinte mêlée à 60 % de blanc, sur 16 % de la teinte posée sur le fond.
  const white: Rgba = [255, 255, 255, 1]
  for (const tint of ['store-steam', 'store-epic', 'store-ea', 'text-2']) {
    const c = parse(token(tint))
    for (const [name, bg] of Object.entries(backgrounds)) {
      const r = ratio(mix(c, 0.6, white), mix(c, 0.16, bg))
      if (r < 4.5) failures.push(`pastille --${tint} sur ${name} : ${r.toFixed(2)}`)
    }
  }
  // Boutons pleins : texte sombre sur le rose, blanc sur le rouge des actions destructives.
  const fills: [string, Rgba, string][] = [
    ['accent-solid', parse(token('on-accent')), 'on-accent'],
    ['accent-solid-hover', parse(token('on-accent')), 'on-accent'],
    ['danger-solid-hover', white, 'blanc']
  ]
  for (const [fill, fg, fgName] of fills) {
    const r = ratio(fg, parse(token(fill)))
    if (r < 4.5) failures.push(`${fgName} sur --${fill} : ${r.toFixed(2)}`)
  }
  assert.deepEqual(failures, [])
})

test("couleurs d'avant la 0.7.4 : plus aucune en dur hors de tokens.css", () => {
  const STALE = ['#06101c', '#09192a', '#040b15', '#071322', '#0b2036', '#0c1f33', '#0f2236', '#24456b', 'rgba(8, 26, 46', 'rgba(18, 40, 63', 'rgba(24, 52, 86', 'rgba(32, 68, 110', 'rgb(9 25 42', 'rgb(4 11 21', 'rgba(4, 11, 21']
  const sources = [...CSS.filter((f) => !f.path.endsWith('styles/tokens.css')), { path: MAIN_WINDOW, text: readFileSync(MAIN_WINDOW, 'utf8') }]
  // Garde-fou du garde-fou : si la fenêtre change de fichier, ce test doit le suivre au lieu de ne plus rien regarder.
  assert.match(readFileSync(MAIN_WINDOW, 'utf8'), /backgroundColor:/, 'main/mainWindow.ts ne crée plus la fenêtre principale')
  const found: string[] = []
  for (const { path, text } of sources) {
    const low = text.toLowerCase()
    for (const s of STALE) if (low.includes(s)) found.push(`${path === MAIN_WINDOW ? 'main/mainWindow.ts' : rel(path)} : ${s}`)
  }
  assert.deepEqual(found, [])
})

test('variables CSS : chaque var(--x) lue est déclarée (CSS, ou posée depuis TS/TSX), ou a une valeur de repli', () => {
  const declared = new Set<string>()
  for (const { text } of CSS) for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1])
  // Posées depuis le code : setProperty('--x', …) et { '--x': … } dans un style.
  for (const { text } of TS) for (const m of text.matchAll(/['"`](--[\w-]+)['"`]/g)) declared.add(m[1])
  const missing = new Set<string>()
  for (const { path, text } of CSS) {
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
      if (!declared.has(m[1]) && !m[2]) missing.add(`${rel(path)} : ${m[1]}`)
    }
  }
  assert.deepEqual([...missing], [])
})

test('noms de classes : chacun déclaré dans un seul fichier CSS (garde-fou de la collision de la 0.7.1)', () => {
  const NAMES = ['ov-root', 'ov-card', 'ov-r', 'ov-res', 'ov-strip', 'ov-pill', 'ov-end']
  for (const name of NAMES) {
    const re = new RegExp(`\\.${name}(?![\\w-])`)
    const where = CSS.filter((f) => re.test(f.text)).map((f) => rel(f.path))
    assert.equal(where.length, 1, `.${name} : ${where.join(', ') || 'aucun fichier'}`)
  }
})
