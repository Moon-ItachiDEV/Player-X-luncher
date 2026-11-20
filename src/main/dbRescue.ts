// Règles de secours de la base (sans Electron ni fichiers, testées par dbRescue.test.ts) : que faire de launcher.db,
// launcher.db.tmp et launcher.db.bak selon leur état. db.ts mesure les états et applique le plan.

export type FileState = 'absent' | 'vide' | 'illisible' | 'verrouille' | 'ok'
export interface RescueFacts {
  main: FileState
  tmp: FileState
  bak: FileState
}
export interface RescuePlan {
  /** D'où vient la base qu'on ouvre. */
  source: 'main' | 'tmp' | 'bak' | 'new'
  /** À renommer de côté avant la première écriture. */
  aside: ('main' | 'bak')[]
  /**
   * Copie de secours « vide » à supprimer avant la première écriture. Le principal n'y est jamais : un principal vide reste en
   * place et le premier persist() le remplace (supprimer un fichier ouvert ailleurs fait échouer l'écriture suivante sous Windows).
   */
  drop: 'bak'[]
  /** Quand aucun fichier n'est sain : les fichiers illisibles dont on essaie de reprendre ce qui se lit encore, le principal d'abord. */
  salvage: ('main' | 'bak')[]
  /** Message à montrer à la personne. */
  notice: null | 'secours' | 'zero'
  /** Ligne pour erreurs.log ; null si tout va bien, et au premier démarrage. */
  log: string | null
}

const BAD = (s: FileState): boolean => s === 'vide' || s === 'illisible'

/**
 * Fichiers tenus par un autre programme (antivirus, sauvegarde) qu'il est interdit d'écraser ou d'ignorer :
 * - le principal dès qu'il est verrouillé (il est peut-être parfaitement sain : ni mis de côté, ni remplacé par .bak ou du vide) ;
 * - la copie de secours quand ni le principal ni le provisoire ne sont sains (elle contient peut-être toutes les données).
 */
export function lockedFiles(f: RescueFacts): ('main' | 'bak')[] {
  if (f.main === 'verrouille') return f.bak === 'verrouille' ? ['main', 'bak'] : ['main']
  if (f.main !== 'ok' && f.tmp !== 'ok' && f.bak === 'verrouille') return ['bak']
  return []
}

export function rescuePlan(f: RescueFacts): RescuePlan {
  const source: RescuePlan['source'] = f.main === 'ok' ? 'main' : f.tmp === 'ok' ? 'tmp' : f.bak === 'ok' ? 'bak' : 'new'
  const aside: RescuePlan['aside'] = []
  if (f.main === 'illisible') aside.push('main')
  if (f.bak === 'illisible') aside.push('bak')
  const drop: RescuePlan['drop'] = f.bak === 'vide' ? ['bak'] : []
  const salvage: RescuePlan['salvage'] = []
  if (source === 'new') {
    if (f.main === 'illisible') salvage.push('main')
    if (f.bak === 'illisible') salvage.push('bak')
  }
  const notice: RescuePlan['notice'] = source === 'bak' ? 'secours' : source === 'new' && (BAD(f.main) || BAD(f.bak)) ? 'zero' : null
  const main = f.main === 'absent' ? 'absente' : f.main === 'verrouille' ? 'verrouillée' : f.main
  let log: string | null = null
  if (source === 'tmp') log = `Base principale ${main} : reprise depuis le dernier fichier provisoire (launcher.db.tmp).`
  else if (source === 'bak') log = `Base principale ${main} : reprise depuis la copie de secours. Les changements récents peuvent manquer.`
  else if (notice === 'zero') log = 'Ni la base ni la copie de secours ne sont lisibles : Player X repart d’une base neuve.'
  return { source, aside, drop, salvage, notice, log }
}

const pad = (n: number, len = 2): string => String(n).padStart(len, '0')

/** Nom d'un fichier mis de côté : `<fichier>.illisible-AAAAMMJJ-HHMMSS`, à l'heure locale. */
export function asideName(file: string, at: Date): string {
  return `${file}.illisible-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
}

const ASIDE = /^(.*)\.illisible-(\d{8}-\d{6})$/

/** Les fichiers mis de côté à supprimer : pour chaque fichier d'origine, on garde les `keep` plus récents. Les autres noms ne sont jamais touchés. */
export function toPrune(names: string[], keep = 6): string[] {
  const groups = new Map<string, { name: string; at: string }[]>()
  for (const name of names) {
    const m = ASIDE.exec(name)
    if (!m) continue
    const list = groups.get(m[1]) ?? []
    list.push({ name, at: m[2] })
    groups.set(m[1], list)
  }
  const out: string[] = []
  for (const list of groups.values()) {
    list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    for (const x of list.slice(keep)) out.push(x.name)
  }
  return out
}

const LOCKED = new Set(['EBUSY', 'EPERM', 'EACCES'])

/**
 * Lit un fichier, en réessayant quand un autre programme le tient un instant (antivirus, indexation : EBUSY, EPERM, EACCES).
 * Toute autre erreur, et la dernière erreur après les essais, est relancée telle quelle.
 */
export async function readRetry<T>(read: () => T, wait: (ms: number) => Promise<void>, tries = 4, delayMs = 300): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return read()
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code
      if (i >= tries || typeof code !== 'string' || !LOCKED.has(code)) throw e
      await wait(delayMs)
    }
  }
}

/** Message du démarrage raté quand des fichiers n'ont pu être ni lus ni mis de côté (jamais écrasés). */
export function stuckText(names: string[]): string {
  const tail = 'Redémarre ton PC, puis rouvre Player X.'
  if (names.length === 1) return `Le fichier ${names[0]} ne peut être ni lu ni mis de côté : un autre programme l’utilise peut-être. ${tail}`
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : ''
  return `Les fichiers ${list} ne peuvent être ni lus ni mis de côté : un autre programme les utilise peut-être. ${tail}`
}

/** Ligne du journal quand on a repris ce qui se lisait encore d'un fichier abîmé. */
export function salvageText(file: string, c: { kv: number; games: number; launches: number; sessions: number }): string {
  return `Aucun fichier sain : reprise de ce qui était encore lisible dans ${file} (réglages : ${c.kv} lignes, jeux : ${c.games}, lancements : ${c.launches}, sessions : ${c.sessions}).`
}

/** Ligne du journal quand le démarrage s'arrête parce qu'un fichier n'a pu être ni lu ni mis de côté. */
export function stuckLog(lost: string[], kept: string[]): string {
  return `Impossible de mettre de côté : ${lost.join(', ')}.${kept.length ? ` Gardé de côté : ${kept.join(', ')}.` : ''} Player X s’arrête sans toucher à la base.`
}

/** Phrase du journal pour un fichier qu'on n'a pas pu lire (autre chose qu'un fichier abîmé : verrou, droits). */
export function unreadText(file: string, code: string): string {
  return `Lecture impossible : ${file} (${code}).`
}

/**
 * Ajoute à une ligne [base] les phrases « Lecture impossible » des fichiers qu'on n'a pas pu lire : juste après la première
 * phrase de la ligne (repérée par le premier « . »), ou à la fin s'il n'y en a qu'une. Rien à ajouter : la ligne telle quelle.
 */
export function withUnread(line: string, unread: string[]): string {
  if (unread.length === 0) return line
  const i = line.indexOf('. ')
  const more = unread.join(' ')
  return i < 0 ? `${line} ${more}` : `${line.slice(0, i + 1)} ${more}${line.slice(i + 1)}`
}
