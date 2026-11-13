// Le contrat entre les pages et le moteur (npm test), relu dans les fichiers tels quels, sans rien lancer.
// Un canal est écrit à la main à deux endroits : dans le pont (src/preload) et dans le moteur (src/main). TypeScript ne voit
// pas ce lien : un nom changé d'un seul côté compile, puis le bouton ne répond plus dans l'appli. Ici, chaque appel doit
// avoir son récepteur, chaque message son écoute, et l'interface V3 ne peut appeler que ce que le pont expose.
// Rien n'est listé à la main : un canal ajouté des deux côtés passe tout seul.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const rel = (p: string): string => relative(ROOT, p).split('\\').join('/')

interface Source {
  path: string
  text: string
}

/** Les fichiers d'un dossier, sans leurs commentaires (un exemple écrit dans une explication ne compte pas). */
function sources(dir: string, ext: RegExp): Source[] {
  return (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
    .filter((f) => ext.test(f) && !/\.test\.ts$/.test(f) && !/\.d\.ts$/.test(f))
    .map((f) => join(ROOT, dir, f))
    .map((path) => ({ path: rel(path), text: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') }))
}

const MAIN = sources('src/main', /\.ts$/)
const PRELOAD = sources('src/preload', /\.ts$/)
const UI = sources('v3ui/src', /\.js$/)

interface Use {
  channel: string
  path: string
}

function uses(files: Source[], ...patterns: RegExp[]): Use[] {
  const out: Use[] = []
  for (const f of files) for (const re of patterns) for (const m of f.text.matchAll(re)) out.push({ channel: m[1], path: f.path })
  return out
}
const count = (files: Source[], re: RegExp): number => files.reduce((n, f) => n + [...f.text.matchAll(re)].length, 0)
const names = (list: Use[]): string[] => [...new Set(list.map((u) => u.channel))].sort()
const missing = (from: Use[], inside: Use[]): string[] => {
  const known = new Set(inside.map((u) => u.channel))
  return [...new Set(from.filter((u) => !known.has(u.channel)).map((u) => `${u.channel} (${u.path})`))].sort()
}

// ---------- ce que le pont demande ----------
const invoked = uses(PRELOAD, /ipcRenderer\.invoke\(\s*'([^']+)'/g)
const pageSends = uses(PRELOAD, /ipcRenderer\.send\(\s*'([^']+)'/g)
// `on('canal', cb)` : la petite fonction d'écoute du pont de l'overlay.
const pageListens = uses(PRELOAD, /ipcRenderer\.on\(\s*'([^']+)'/g, /(?<![.\w])on(?:<[^>]*>)?\(\s*'([^']+)'/g)

// ---------- ce que le moteur offre ----------
const handled = uses(MAIN, /(?<![.\w])handle\(\s*'([^']+)'/g)
const rawListens = uses(MAIN, /ipcMain\.on\(\s*'([^']+)'/g)
// Envois vers les pages : broadcast, showMainAndSend, sendTo(fenêtre, …), webContents.send, et le `send` local de cs2Live.
const mainSends = uses(
  MAIN,
  /\b(?:broadcast|showMainAndSend)\(\s*'([^']+)'/g,
  /\bsendTo\(\s*[^,()]+(?:\([^)]*\))?\s*,\s*'([^']+)'/g,
  /\.send\(\s*'([^']+)'/g,
  /(?<![.\w])send\(\s*'([^']+)'/g
)

test('la lecture voit bien le code (sinon les règles ci-dessous ne prouveraient rien)', () => {
  assert.ok(invoked.length >= 90, `seulement ${invoked.length} appels lus dans le pont`)
  assert.ok(handled.length >= 90, `seulement ${handled.length} récepteurs lus dans le moteur`)
  assert.ok(mainSends.length >= 15 && pageListens.length >= 15, 'messages du moteur vers les pages non lus')
  assert.ok(UI.length >= 15, `seulement ${UI.length} fichiers de l’interface lus`)
})

test('les canaux sont écrits en toutes lettres, sous la forme domaine:action', () => {
  // Un canal passé par une variable échapperait à toutes les vérifications de ce fichier.
  assert.equal(count(PRELOAD, /ipcRenderer\.invoke\(/g), invoked.length, 'pont : un ipcRenderer.invoke sans nom de canal en toutes lettres')
  assert.equal(count(PRELOAD, /ipcRenderer\.send\(/g), pageSends.length, 'pont : un ipcRenderer.send sans nom de canal en toutes lettres')
  assert.equal(count(MAIN.filter((f) => f.path !== 'src/main/ipc.ts'), /(?<![.\w])handle\(/g), handled.length, 'moteur : un handle() sans nom de canal en toutes lettres')
  assert.equal(count(MAIN, /ipcMain\.on\(/g), rawListens.length, 'moteur : un ipcMain.on sans nom de canal en toutes lettres')
  const odd = names([...invoked, ...pageSends, ...pageListens, ...handled, ...rawListens, ...mainSends]).filter((c) => !/^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/.test(c))
  assert.deepEqual(odd, [])
})

test('chaque appel du pont a un récepteur dans le moteur, et un seul', () => {
  assert.deepEqual(missing(invoked, handled), [], 'appel sans récepteur : le bouton ne répondrait pas')
  assert.deepEqual(missing(handled, invoked), [], 'récepteur que plus aucun pont n’appelle')
  // Deux récepteurs pour un même canal : Electron refuse le second au démarrage.
  const twice = names(handled).filter((c) => handled.filter((u) => u.channel === c).length > 1)
  assert.deepEqual(twice, [])
})

test('tout récepteur passe par handle() : c’est lui qui vérifie d’où vient l’appel', () => {
  const direct = MAIN.filter((f) => f.path !== 'src/main/ipc.ts' && /ipcMain\.handle(?:Once)?\(/.test(f.text)).map((f) => f.path)
  assert.deepEqual(direct, [])
  // Les envois sans réponse (ipcMain.on) vérifient eux-mêmes l'expéditeur : seule la page cachée de capture en a.
  assert.deepEqual(names(rawListens).filter((c) => !c.startsWith('clips-rec:')), [])
})

test('la page de capture : chacun de ses envois est écouté par le moteur, et l’inverse', () => {
  assert.deepEqual(missing(pageSends, rawListens), [])
  assert.deepEqual(missing(rawListens, pageSends), [])
})

test('chaque message du moteur est écouté par une page, et chaque écoute a son envoi', () => {
  assert.deepEqual(missing(mainSends, pageListens), [], 'message envoyé que personne n’écoute')
  assert.deepEqual(missing(pageListens, mainSends), [], 'écoute d’un message que le moteur n’envoie jamais')
})

test('le pont de l’overlay ne connaît que les canaux cs2:', () => {
  // src/main/ipc.ts refuse déjà tout autre canal depuis cette fenêtre : le pont ne doit pas en proposer.
  const overlay = [...invoked, ...pageSends, ...pageListens].filter((u) => u.path === 'src/preload/overlay.ts')
  assert.ok(overlay.length >= 6, 'pont de l’overlay non lu')
  assert.deepEqual(names(overlay).filter((c) => !c.startsWith('cs2:')), [])
})

test('l’interface V3 n’appelle que ce que le pont expose', () => {
  const bridge = PRELOAD.find((f) => f.path === 'src/preload/index.ts')
  assert.ok(bridge, 'src/preload/index.ts introuvable')
  const body = bridge.text.slice(bridge.text.indexOf('const api: LauncherApi = {'), bridge.text.indexOf("contextBridge.exposeInMainWorld('launcher'"))
  // Les entrées du pont : un nom en début de ligne, à deux espaces.
  const exposed = new Set([...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]))
  assert.ok(exposed.size >= 100 && exposed.has('getGames') && exposed.has('version'), `pont mal lu : ${exposed.size} entrées`)
  // L'interface parle au moteur par `API` (real.js : const API = window.launcher), parfois par window.launcher.
  assert.ok(UI.some((f) => /\bconst API = window\.launcher\b/.test(f.text)), 'v3ui : `const API = window.launcher` introuvable')
  const unknown = new Set<string>()
  for (const f of UI) for (const m of f.text.matchAll(/\b(?:API|window\.launcher)\??\.(\w+)/g)) if (!exposed.has(m[1])) unknown.add(`${m[1]} (${f.path})`)
  assert.deepEqual([...unknown].sort(), [])
})
