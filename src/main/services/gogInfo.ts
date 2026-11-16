// GOG (bêta 43), sans Electron ni fichier : lecture du fichier goggame-<id>.info d'un jeu et des clés de registre de GOG.
// Testé par gogInfo.test.ts.
//
// Chaque jeu GOG installé (par GOG Galaxy ou par l'installeur hors ligne) a, dans son dossier, un fichier goggame-<id>.info
// (JSON) : son nom, son identifiant, celui du jeu de base (les extensions en ont un autre) et ses façons de le lancer
// (playTasks). Le registre (HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>) donne le dossier de chaque jeu.

export interface GogTask {
  /** Chemin complet de l'exécutable. */
  exe: string
  /** Dossier de travail (celui du jeu si le fichier n'en donne pas). */
  cwd: string
  args: string[]
}

export interface GogInfo {
  id: string
  name: string
  task: GogTask
}

const join = (dir: string, rel: string): string => (/^[A-Za-z]:[\\/]|^[\\/]{2}/.test(rel) ? rel : `${dir.replace(/[\\/]+$/, '')}\\${rel.replace(/^[\\/]+/, '').replace(/\//g, '\\')}`)

/** Les arguments d'une ligne de commande, guillemets compris (« -a "deux mots" » → ['-a', 'deux mots']). */
export function splitArgs(line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2])
  return out.slice(0, 32)
}

/**
 * Le jeu décrit par un fichier goggame-<id>.info, ou null : extension (son jeu de base est un autre), fichier illisible, ou
 * aucune façon de lancer un exécutable. La façon gardée : celle marquée principale, sinon la première de type fichier.
 */
export function readGogInfo(text: string, installDir: string): GogInfo | null {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { gameId?: unknown; rootGameId?: unknown; name?: unknown; playTasks?: unknown }
  const id = typeof r.gameId === 'string' ? r.gameId : typeof r.gameId === 'number' ? String(r.gameId) : ''
  if (!/^\d{1,20}$/.test(id) || typeof r.name !== 'string' || !r.name.trim()) return null
  const root = typeof r.rootGameId === 'number' ? String(r.rootGameId) : r.rootGameId
  if (typeof root === 'string' && root && root !== id) return null
  const tasks = Array.isArray(r.playTasks) ? (r.playTasks as Record<string, unknown>[]).filter((t) => t && typeof t === 'object' && t.type === 'FileTask' && typeof t.path === 'string' && /\.exe$/i.test(t.path as string)) : []
  const t = tasks.find((x) => x.isPrimary === true) ?? tasks[0]
  if (!t) return null
  const exe = join(installDir, t.path as string)
  return {
    id,
    name: r.name.trim(),
    task: { exe, cwd: typeof t.workingDir === 'string' && t.workingDir ? join(installDir, t.workingDir) : exe.replace(/[\\/][^\\/]+$/, ''), args: typeof t.arguments === 'string' ? splitArgs(t.arguments) : [] }
  }
}

/** Les jeux déclarés dans le registre de GOG (sortie de « reg query …\GOG.com\Games /s ») : identifiant, nom, dossier. */
export function readGogRegistry(out: string): { id: string; name: string; dir: string }[] {
  const games: { id: string; name: string; dir: string }[] = []
  let cur: { id: string; name: string; dir: string } | null = null
  for (const line of out.split(/\r?\n/)) {
    const key = line.match(/^HKEY_\S*\\GOG\.com\\Games\\(\d{1,20})\s*$/i)
    if (key) {
      cur = { id: key[1], name: '', dir: '' }
      games.push(cur)
      continue
    }
    if (line.startsWith('HKEY_')) {
      cur = null
      continue
    }
    const m = line.match(/^\s+(gameName|path)\s+REG_\w+\s+(.*)$/i)
    if (m && cur) {
      if (m[1].toLowerCase() === 'gamename') cur.name = m[2].trim()
      else cur.dir = m[2].trim().replace(/[\\"]+$/, '')
    }
  }
  return games.filter((g) => g.dir)
}
