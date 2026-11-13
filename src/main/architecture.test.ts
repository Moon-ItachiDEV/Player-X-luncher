// Garde-fous de l'architecture (npm test). Ils lisent les fichiers de src/ tels quels, sans rien lancer :
//  - src/shared ne dépend de rien (ni d'Electron, ni de Node, ni du reste de l'appli) : le moteur, le pont et l'interface
//    s'en servent tous les trois ;
//  - le pont (src/preload) et les pages (src/renderer) ne voient que src/shared ;
//  - personne n'importe le démarrage (main/index.ts), et un service n'importe jamais un canal ;
//  - aucun import en boucle : un fichier qui en importe un autre, lequel finit par importer le premier.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC = join(ROOT, 'src')
/** Chemin depuis la racine du dépôt, toujours avec des « / » (les tests tournent aussi sous Windows). */
const rel = (p: string): string => relative(ROOT, p).split('\\').join('/')

const FILES = (readdirSync(SRC, { recursive: true }) as string[])
  .map((f) => join(SRC, f))
  .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !/\.d\.ts$/.test(f))

interface Import {
  /** Ce qui est écrit entre guillemets. */
  spec: string
  /** `import type` ou `export type` : effacé à la compilation, il ne crée aucun lien entre les fichiers qui tournent. */
  typeOnly: boolean
  /** Le fichier de src/ visé, s'il y en a un (sinon c'est un paquet : electron, node:fs…). */
  file: string | null
}

function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith('@shared/') ? join(SRC, 'shared', spec.slice('@shared/'.length)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  for (const c of [base, `${base}.ts`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c
  return null
}

function importsOf(file: string): Import[] {
  // Les commentaires partent d'abord : un exemple d'import écrit dans une explication ne compte pas.
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const out: Import[] = []
  const add = (spec: string, typeOnly: boolean): void => void out.push({ spec, typeOnly, file: resolveSpec(file, spec) })
  for (const m of text.matchAll(/^[ \t]*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/gm)) add(m[2], !!m[1])
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1], false)
  return out
}

const GRAPH = new Map(FILES.map((f) => [f, importsOf(f)]))
const under = (file: string, dir: string): boolean => rel(file).startsWith(`src/${dir}/`)
const INDEX = join(SRC, 'main', 'index.ts')

test('la lecture des imports voit bien le code (sinon les règles ci-dessous ne prouveraient rien)', () => {
  assert.ok(FILES.length > 100, `seulement ${FILES.length} fichiers lus`)
  const index = GRAPH.get(INDEX) ?? []
  assert.ok(index.some((i) => i.spec === 'electron'), 'main/index.ts : import d’electron non vu')
  assert.ok(index.filter((i) => i.file).length >= 10, 'main/index.ts : imports de services non vus')
  assert.ok(index.some((i) => i.file && !i.typeOnly && /Sim\.ts$/.test(i.file)), 'main/index.ts : import() des simulateurs non vu')
})

test('src/shared ne dépend de rien : ni paquet, ni Electron, ni Node, ni le reste de l’appli', () => {
  const bad: string[] = []
  for (const [file, imports] of GRAPH) {
    if (!under(file, 'shared')) continue
    for (const i of imports) if (!i.file || !under(i.file, 'shared')) bad.push(`${rel(file)} importe ${i.spec}`)
  }
  assert.deepEqual(bad, [])
})

test('le pont et les pages ne voient que src/shared (et Electron pour le pont)', () => {
  const bad: string[] = []
  for (const [file, imports] of GRAPH) {
    const layer = under(file, 'preload') ? 'preload' : under(file, 'renderer') ? 'renderer' : null
    if (!layer) continue
    for (const i of imports) {
      // Feuilles de style et polices de la page : pas du code de l'appli.
      if (/\.css$/.test(i.spec)) continue
      const ok = i.file ? under(i.file, 'shared') || under(i.file, layer) : layer === 'preload' && i.spec === 'electron'
      if (!ok) bad.push(`${rel(file)} importe ${i.spec}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('personne n’importe le démarrage (main/index.ts) ; un service n’importe jamais un canal', () => {
  const bad: string[] = []
  for (const [file, imports] of GRAPH) {
    for (const i of imports) {
      if (i.file === INDEX) bad.push(`${rel(file)} importe le démarrage`)
      if (under(file, 'main/services') && i.file && under(i.file, 'main/channels')) bad.push(`${rel(file)} importe le canal ${rel(i.file)}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('aucun import en boucle (les `import type` ne comptent pas)', () => {
  // Composantes fortement connexes (Tarjan) : une composante de plusieurs fichiers est une boucle.
  const edges = (f: string): string[] => (GRAPH.get(f) ?? []).filter((i) => i.file && !i.typeOnly && GRAPH.has(i.file)).map((i) => i.file as string)
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const loops: string[] = []
  let next = 0
  const visit = (v: string): void => {
    index.set(v, next)
    low.set(v, next)
    next++
    stack.push(v)
    onStack.add(v)
    for (const w of edges(v)) {
      if (!index.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number))
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v) as number, index.get(w) as number))
    }
    if (low.get(v) !== index.get(v)) return
    const group: string[] = []
    for (;;) {
      const w = stack.pop() as string
      onStack.delete(w)
      group.push(w)
      if (w === v) break
    }
    if (group.length > 1 || edges(v).includes(v)) loops.push(group.map(rel).sort().join(' ↔ '))
  }
  for (const f of GRAPH.keys()) if (!index.has(f)) visit(f)
  // Pour en sortir : si l'un des imports ne sert qu'à des types, l'écrire `import type` ; sinon, celui des deux fichiers qui
  // est le plus bas (le moteur, la base) reçoit ce dont il a besoin au démarrage au lieu de l'importer.
  assert.deepEqual(loops, [])
})
