// Actus des jeux : lecture des annonces Steam (ISteamNews/GetNewsForApp) en blocs simples, que l'interface affiche en texte.
// Module pur, sans import d'Electron : testé sous Node seul (npm run test:news).
import type { NewsBlock, NewsPost, NewsSpan } from '@shared/types'

/** Raccourci des annonces Steam pour leurs images. */
const CLAN_IMAGES = 'https://clan.akamai.steamstatic.com/images'
/** Au-delà, la suite de l'annonce est coupée (les notes de patch les plus longues font environ 40 000 caractères). */
const MAX_TEXT = 80_000
const MAX_BLOCKS = 600
const EXCERPT_LENGTH = 220

// ---------- annonce brute ----------

/** Une annonce telle que l'API la renvoie, vérifiée champ par champ (la réponse n'est pas fiable). */
export interface RawNews {
  gid: string
  title: string
  url: string
  author?: string
  contents: string
  /** En millisecondes. */
  date: number
  tags: string[]
}

const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

/** Lien https seulement (les liens « steam://openurl/https://… » des annonces sont ramenés à leur adresse). */
export function safeUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const url = v
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^steam:\/\/openurl(?:_external)?\//i, '')
  return /^https:\/\/[^\s"'<>\\]+$/i.test(url) && url.length <= 2048 ? url : undefined
}

export function cleanRawNews(v: unknown): RawNews | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const gid = typeof o.gid === 'string' && /^\d{1,24}$/.test(o.gid) ? o.gid : undefined
  const title = text(o.title, 200)
  const url = safeUrl(o.url)
  const date = typeof o.date === 'number' && Number.isFinite(o.date) && o.date > 0 ? Math.round(o.date * 1000) : undefined
  if (!gid || !title || !url || !date) return null
  return {
    gid,
    title: decodeEntities(unescapeBrackets(title)),
    url,
    author: text(o.author, 64),
    contents: typeof o.contents === 'string' ? o.contents.slice(0, 400_000) : '',
    date,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string').slice(0, 20) : []
  }
}

// ---------- notes de patch ----------

const PATCH_TITLE =
  /\b(?:patch(?:es)?|hot-?fix(?:es)?|correctifs?|changelog|release notes|update notes|notes de (?:version|patch|mise à jour))\b|\b(?:update|mise à jour|maj|version)\s*v?\d|\bv?\d+\.\d+\.\d+/i

/** Notes de patch : l'éditeur les a marquées comme telles sur Steam, ou le titre annonce une mise à jour numérotée, un patch, un correctif. */
export function isPatchPost(title: string, tags: string[]): boolean {
  return tags.some((t) => t.toLowerCase() === 'patchnotes') || PATCH_TITLE.test(title)
}

// ---------- texte ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

/**
 * Crochets échappés par l'éditeur d'annonces de Steam, pour qu'ils ne soient pas lus comme des balises :
 * « \[ UI ] » s'affiche « [ UI ] » (notes de Counter-Strike 2). Une barre oblique devant autre chose reste du texte.
 */
export function unescapeBrackets(s: string): string {
  return s.replace(/\\([[\]])/g, '$1')
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ''
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

// ---------- BBCode → arbre ----------

interface Node {
  tag: string
  arg?: string
  attrs: Record<string, string>
  children: (Node | string)[]
}

/** Balises connues ; les autres crochets (« [PC] », « [ MAPS ] ») restent du texte, comme un crochet échappé (« \[b] »). */
const ALIASES: Record<string, string> = {
  strong: 'b',
  em: 'i',
  strike: 's',
  ul: 'list',
  ol: 'olist',
  li: '*',
  h4: 'h3',
  h5: 'h3',
  h6: 'h3'
}
const KNOWN = new Set([
  'h1',
  'h2',
  'h3',
  'b',
  'i',
  'u',
  's',
  'p',
  'list',
  'olist',
  '*',
  'quote',
  'code',
  'noparse',
  'url',
  'img',
  'hr',
  'table',
  'tr',
  'th',
  'td',
  'spoiler',
  'previewyoutube',
  'video',
  'expand',
  'carousel',
  'dynamiclink',
  'emoticon',
  'center',
  'color',
  'size',
  'font',
  'sup',
  'sub'
])
const LISTS = new Set(['list', 'olist'])

// L'argument peut contenir des crochets échappés : « [url=https://exemple.fr/carte\[2\]] ». Les noms d'attributs peuvent
// contenir des chiffres : « [video mp4=… webm=… poster=…] » des annonces d'événements.
const TAG_RE = /\[(\/?)([a-z][a-z0-9]*|\*)(=(?:"(?:[^"\\\]]|\\.)*"|(?:[^\]\s\\]|\\.)*))?((?:\s+[a-z_][a-z0-9_]*=(?:"[^"]*"|[^\s\]]*))*)\s*\]/gi
const ATTR_RE = /([a-z_][a-z0-9_]*)=(?:"([^"]*)"|([^\s\]]*))/gi

const unquote = (s: string): string => s.replace(/^"([^"]*)"$/, '$1')

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of raw.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
  return attrs
}

/** Balises sans contenu : fermées tout de suite (leur éventuelle balise de fin est ignorée). */
function isLeaf(node: Node): boolean {
  switch (node.tag) {
    case 'hr':
    case 'previewyoutube':
    case 'video':
    case 'dynamiclink':
    case 'emoticon':
      return true
    case 'img':
      return !!node.attrs.src
    default:
      return false
  }
}

function parseTree(src: string): Node {
  const root: Node = { tag: 'root', attrs: {}, children: [] }
  const stack: Node[] = [root]
  const top = (): Node => stack[stack.length - 1]
  const lastIndex = (pred: (n: Node) => boolean): number => {
    for (let i = stack.length - 1; i > 0; i--) if (pred(stack[i])) return i
    return -1
  }
  const re = new RegExp(TAG_RE.source, 'gi')
  let last = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const [whole, slash, rawName, rawArg, rawAttrs] = m
    // « \[b] » : crochet échappé, du texte. La recherche reprend juste après, une vraie balise peut suivre.
    if (src[m.index - 1] === '\\') {
      re.lastIndex = m.index + 1
      continue
    }
    const lower = rawName.toLowerCase()
    const name = ALIASES[lower] ?? lower
    if (!KNOWN.has(name)) continue
    if (m.index > last) top().children.push(src.slice(last, m.index))
    last = m.index + whole.length

    if (slash) {
      if (name === '*') {
        // Fin d'un point : seulement celui de la liste la plus proche.
        const item = lastIndex((n) => n.tag === '*')
        if (item > lastIndex((n) => LISTS.has(n.tag))) stack.length = item
      } else {
        const open = lastIndex((n) => n.tag === name)
        if (open > 0) stack.length = open
      }
      continue
    }

    // Contenu brut : rien n'est lu comme une balise jusqu'à la fin.
    if (name === 'noparse' || name === 'code') {
      const end = src.toLowerCase().indexOf(`[/${lower}]`, last)
      const stop = end === -1 ? src.length : end
      top().children.push({ tag: name, attrs: {}, children: [src.slice(last, stop)] })
      last = end === -1 ? src.length : end + lower.length + 3
      re.lastIndex = last
      continue
    }

    const node: Node = { tag: name, arg: rawArg ? unescapeBrackets(unquote(rawArg.slice(1))) : undefined, attrs: parseAttrs(rawAttrs ?? ''), children: [] }
    if (name === '*') {
      // Nouveau point : ferme le précédent de la même liste.
      const item = lastIndex((n) => n.tag === '*')
      if (item > 0 && item > lastIndex((n) => LISTS.has(n.tag))) stack.length = item
    }
    top().children.push(node)
    if (!isLeaf(node)) stack.push(node)
  }
  if (last < src.length) top().children.push(src.slice(last))
  return root
}

// ---------- arbre → blocs ----------

type Marks = Omit<NewsSpan, 'text'>

const sameMarks = (a: Marks, b: Marks): boolean =>
  !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.strike === !!b.strike && a.href === b.href

function marksFor(node: Node, marks: Marks): Marks {
  switch (node.tag) {
    case 'b':
      return { ...marks, bold: true }
    case 'i':
      return { ...marks, italic: true }
    case 'u':
      return { ...marks, underline: true }
    case 's':
      return { ...marks, strike: true }
    case 'url': {
      const href = safeUrl(node.arg ?? node.attrs.href ?? unescapeBrackets(textOf(node)))
      return href ? { ...marks, href } : marks
    }
    default:
      return marks
  }
}

function textOf(node: Node): string {
  return node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('')
}

/** Espaces en trop, retours à la ligne gardés (au plus une ligne vide), rien au début ni à la fin. */
function tidy(spans: NewsSpan[]): NewsSpan[] {
  const merged: NewsSpan[] = []
  for (const s of spans) {
    const prev = merged[merged.length - 1]
    if (prev && sameMarks(prev, s)) prev.text += s.text
    else merged.push({ ...s })
  }
  for (const s of merged) s.text = s.text.replace(/[ \t ​]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n')
  // Bords : espaces et lignes vides retirés du premier et du dernier morceau non vides.
  while (merged.length && !merged[0].text.trim()) merged.shift()
  while (merged.length && !merged[merged.length - 1].text.trim()) merged.pop()
  if (merged.length) {
    merged[0].text = merged[0].text.replace(/^\s+/, '')
    merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/\s+$/, '')
  }
  return merged.filter((s) => s.text)
}

const span = (t: string, marks: Marks): NewsSpan => {
  const s: NewsSpan = { text: t }
  if (marks.bold) s.bold = true
  if (marks.italic) s.italic = true
  if (marks.underline) s.underline = true
  if (marks.strike) s.strike = true
  if (marks.href) s.href = marks.href
  return s
}

/** « [ MAPS ] » seul sur sa ligne : un intertitre, à la manière des notes de Counter-Strike 2. */
const BRACKET_TITLE = /^\[\s*([^[\]\n]{1,60}?)\s*\]$/

class Builder {
  blocks: NewsBlock[] = []
  /** Images qui ne sont que l'affiche d'une vidéo : vignette de l'annonce seulement s'il n'y a pas de vraie image. */
  posters = new Set<string>()
  private spans: NewsSpan[] = []
  private size = 0

  get full(): boolean {
    return this.size >= MAX_TEXT || this.blocks.length >= MAX_BLOCKS
  }

  add(block: NewsBlock, length = 0): void {
    if (this.full) return
    this.blocks.push(block)
    this.size += length
  }

  /** Texte au fil du paragraphe en cours ; une ligne vide termine le paragraphe. `verbatim` : échappements gardés tels quels. */
  text(raw: string, marks: Marks, verbatim = false): void {
    const parts = decodeEntities(verbatim ? raw : unescapeBrackets(raw)).split(/\n[ \t ]*\n\s*/)
    parts.forEach((part, i) => {
      if (i > 0) this.flush()
      if (part) this.spans.push(span(part, marks))
    })
  }

  inline(s: NewsSpan[]): void {
    this.spans.push(...s)
  }

  flush(): void {
    const spans = tidy(this.spans)
    this.spans = []
    if (!spans.length) return
    const length = spans.reduce((n, s) => n + s.text.length, 0)
    const title = spans.length === 1 && !spans[0].href ? BRACKET_TITLE.exec(spans[0].text) : null
    if (title) this.add({ type: 'heading', level: 3, spans: [{ text: title[1] }] }, length)
    else this.add({ type: 'paragraph', spans }, length)
  }
}

/** Texte d'une balise en morceaux mis en forme, sur une seule « ligne » de bloc (titres, points de liste, citations). */
function collectSpans(node: Node, marks: Marks, out: NewsSpan[] = [], skipLists = false): NewsSpan[] {
  for (const child of node.children) {
    if (typeof child === 'string') {
      out.push(span(decodeEntities(unescapeBrackets(child)), marks))
      continue
    }
    if (skipLists && LISTS.has(child.tag)) continue
    switch (child.tag) {
      case 'img':
      case 'video':
      case 'previewyoutube':
      case 'emoticon':
      case 'hr':
        break
      case 'dynamiclink': {
        const href = safeUrl(child.attrs.href)
        if (href) out.push(span(href, { ...marks, href }))
        break
      }
      case 'p':
      case 'h1':
      case 'h2':
      case 'h3':
      case 'quote':
      case 'list':
      case 'olist':
      case '*':
      case 'tr':
        out.push(span('\n', marks))
        collectSpans(child, child.tag.startsWith('h') ? { ...marks, bold: true } : marks, out, skipLists)
        out.push(span('\n', marks))
        break
      case 'td':
      case 'th':
        collectSpans(child, child.tag === 'th' ? { ...marks, bold: true } : marks, out, skipLists)
        out.push(span(' ', marks))
        break
      default:
        collectSpans(child, marksFor(child, marks), out, skipLists)
    }
  }
  return out
}

function spansLength(spans: NewsSpan[]): number {
  return spans.reduce((n, s) => n + s.text.length, 0)
}

function addList(node: Node, b: Builder, depth: number, items: { spans: NewsSpan[]; depth: number }[]): void {
  for (const child of node.children) {
    if (typeof child === 'string') {
      // Texte hors des points (rare) : il devient un point à part.
      const spans = tidy([span(decodeEntities(unescapeBrackets(child)), {})])
      if (spans.length) items.push({ spans, depth })
      continue
    }
    if (child.tag === '*') {
      const spans = tidy(collectSpans(child, {}, [], true))
      if (spans.length) items.push({ spans, depth })
      // Sous-listes du point, au niveau suivant.
      for (const sub of child.children) if (typeof sub !== 'string' && LISTS.has(sub.tag)) addList(sub, b, Math.min(depth + 1, 3), items)
    } else if (LISTS.has(child.tag)) {
      addList(child, b, Math.min(depth + 1, 3), items)
    } else {
      const spans = tidy(collectSpans(child, marksFor(child, {})))
      if (spans.length) items.push({ spans, depth })
    }
  }
}

function walk(node: Node, b: Builder, marks: Marks): void {
  for (const child of node.children) {
    if (b.full) return
    if (typeof child === 'string') {
      b.text(child, marks)
      continue
    }
    switch (child.tag) {
      case 'h1':
      case 'h2':
      case 'h3': {
        b.flush()
        const spans = tidy(collectSpans(child, marks))
        if (spans.length) b.add({ type: 'heading', level: Number(child.tag[1]) as 1 | 2 | 3, spans }, spansLength(spans))
        break
      }
      case 'p':
        b.flush()
        walk(child, b, marks)
        b.flush()
        break
      case 'list':
      case 'olist': {
        b.flush()
        const items: { spans: NewsSpan[]; depth: number }[] = []
        addList(child, b, 0, items)
        if (items.length) b.add({ type: 'list', ordered: child.tag === 'olist', items }, items.reduce((n, it) => n + spansLength(it.spans), 0))
        // Images et vidéos rangées dans les points : après la liste.
        for (const media of findAll(child, MEDIA)) addMedia(media, b)
        break
      }
      case 'quote': {
        b.flush()
        const spans = tidy(collectSpans(child, marks))
        if (spans.length) b.add({ type: 'quote', spans }, spansLength(spans))
        break
      }
      case 'table':
        // Une ligne de tableau = un paragraphe, cellules séparées par « · ».
        b.flush()
        for (const row of findAll(child, ['tr'])) {
          const cells = row.children
            .filter((c): c is Node => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th'))
            .map((cell) => tidy(collectSpans(cell, cell.tag === 'th' ? { ...marks, bold: true } : marks)))
            .filter((cell) => cell.length)
          const spans = tidy(cells.flatMap((cell, i) => (i ? [span(' · ', marks), ...cell] : cell)))
          if (spans.length) b.add({ type: 'paragraph', spans }, spansLength(spans))
        }
        break
      case 'hr':
        b.flush()
        b.add({ type: 'rule' })
        break
      case 'img':
      case 'video':
      case 'previewyoutube':
        b.flush()
        addMedia(child, b)
        break
      case 'code':
      case 'noparse':
        b.text(textOf(child), marks, true)
        break
      case 'dynamiclink': {
        const href = safeUrl(child.attrs.href)
        if (href) b.inline([span(href, { ...marks, href })])
        break
      }
      case 'emoticon':
        break
      case '*':
        // Point hors d'une liste : un paragraphe.
        b.flush()
        walk(child, b, marks)
        b.flush()
        break
      default:
        walk(child, b, marksFor(child, marks))
    }
  }
}

function findAll(node: Node, tags: string[], out: Node[] = []): Node[] {
  for (const c of node.children) {
    if (typeof c === 'string') continue
    if (tags.includes(c.tag)) out.push(c)
    else findAll(c, tags, out)
  }
  return out
}

const MEDIA = ['img', 'video', 'previewyoutube']

/**
 * Image ; vidéo d'une annonce (« [video mp4=… poster=…][/video] ») : pas de lecteur, son affiche en image (sans affiche,
 * rien) ; vidéo YouTube (« [previewyoutube=ID;full] ») : un lien.
 */
function addMedia(node: Node, b: Builder): void {
  if (node.tag === 'img') {
    const src = safeUrl(node.attrs.src ?? unescapeBrackets(textOf(node)))
    if (src) b.add({ type: 'image', src })
  } else if (node.tag === 'video') {
    const src = safeUrl(node.attrs.poster)
    if (!src) return
    b.posters.add(src)
    b.add({ type: 'image', src })
  } else {
    const id = (node.arg ?? '').split(';')[0]
    if (/^[\w-]{6,20}$/.test(id)) b.add({ type: 'video', url: `https://www.youtube.com/watch?v=${id}` })
  }
}

/** Balises HTML qui traînent dans certaines annonces : retirées (les retours à la ligne gardés). */
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div)(?:\s[^<>]*)?>/gi, '\n\n')
    .replace(/<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?>/gi, '')
}

function parse(contents: string): Builder {
  const src = stripHtml(contents.replace(/\r\n?/g, '\n').replace(/\{STEAM_CLAN(?:_LOC)?_IMAGE\}/g, CLAN_IMAGES))
  const b = new Builder()
  walk(parseTree(src), b, {})
  b.flush()
  return b
}

export function parseNewsContents(contents: string): NewsBlock[] {
  return parse(contents).blocks
}

/** Début du texte (paragraphes et points de liste), coupé à un mot. */
export function excerptOf(blocks: NewsBlock[], max = EXCERPT_LENGTH): string {
  const parts: string[] = []
  let length = 0
  const take = (spans: NewsSpan[]): void => {
    const t = spans
      .map((s) => s.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    if (!t) return
    parts.push(t)
    length += t.length + 1
  }
  for (const block of blocks) {
    if (length > max) break
    if (block.type === 'paragraph' || block.type === 'quote') take(block.spans)
    else if (block.type === 'list') for (const item of block.items) take(item.spans)
  }
  if (!parts.length) for (const block of blocks) if (block.type === 'heading') take(block.spans)
  const all = parts.join(' ')
  if (all.length <= max) return all
  const cut = all.slice(0, max + 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut.slice(0, max)).replace(/[\s,;:.–—-]+$/, '')}…`
}

export function toNewsPost(raw: RawNews): NewsPost {
  const { blocks, posters } = parse(raw.contents)
  // Vignette : la première vraie image, sinon l'affiche d'une vidéo.
  const images = blocks.flatMap((bl) => (bl.type === 'image' ? [bl.src] : []))
  const image = images.find((src) => !posters.has(src)) ?? images[0]
  return {
    id: raw.gid,
    title: raw.title,
    url: raw.url,
    date: raw.date,
    ...(raw.author ? { author: raw.author } : {}),
    patch: isPatchPost(raw.title, raw.tags),
    excerpt: excerptOf(blocks),
    ...(image ? { image } : {}),
    blocks
  }
}

// ---------- version française ----------
//
// GetNewsForApp n'a pas de langue : il donne le texte d'origine (presque toujours l'anglais). Quand l'éditeur a traduit son
// annonce avec l'outil d'événements de Steamworks, Steam montre la version française aux joueurs en français ; on la lit dans
// la liste d'événements du magasin (celle du site Steam : events/ajaxgetpartnereventspageable, l=french), puis on la pose sur
// l'annonce lue par GetNewsForApp. Sans traduction, Steam y renvoie l'anglais : l'annonce reste telle quelle.

/** « french » dans la numérotation des langues de Steam (ELanguage). */
export const STEAM_FRENCH = 2

export interface FrenchText {
  title: string
  contents: string
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * Textes français des annonces `raw`, par gid d'annonce. Un événement est rattaché à son annonce par son identifiant
 * (`news_post_gid`, ou le gid de son `announcement_body`), sinon par sa date de publication. Il n'est gardé que s'il est
 * vraiment en français : `language` = STEAM_FRENCH quand Steam le dit, sinon un titre ou un texte différent de l'anglais.
 */
export function frenchTexts(raw: RawNews[], events: unknown): Map<string, FrenchText> {
  const out = new Map<string, FrenchText>()
  if (!Array.isArray(events)) return out
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue
    const e = ev as Record<string, unknown>
    const b = e.announcement_body && typeof e.announcement_body === 'object' ? (e.announcement_body as Record<string, unknown>) : null
    if (!b) continue
    const title = text(b.headline, 200) ?? text(e.event_name, 200)
    const contents = typeof b.body === 'string' ? b.body.slice(0, 400_000) : ''
    if (!title || !contents.trim()) continue
    const ids = [e.news_post_gid, b.gid].filter((v) => typeof v === 'string' || typeof v === 'number').map(String)
    const at = typeof b.posttime === 'number' && b.posttime > 0 ? b.posttime * 1000 : 0
    const post = raw.find((r) => ids.includes(r.gid)) ?? (at ? raw.find((r) => r.date === at) : undefined)
    if (!post || out.has(post.gid)) continue
    const fr = { title: decodeEntities(unescapeBrackets(title)), contents }
    const french =
      typeof b.language === 'number' ? b.language === STEAM_FRENCH : squash(fr.title) !== squash(post.title) || squash(contents) !== squash(post.contents)
    if (french) out.set(post.gid, fr)
  }
  return out
}

/**
 * L'annonce avec son titre et son texte français. Le reste ne change pas : date, auteur, lien, et « notes de patch » (lu sur
 * l'annonce d'origine, ses étiquettes et son titre). Sans image dans la version française, l'image d'origine reste.
 */
export function frenchPost(post: NewsPost, fr: FrenchText): NewsPost {
  const { blocks, posters } = parse(fr.contents)
  if (!blocks.length) return post
  const images = blocks.flatMap((bl) => (bl.type === 'image' ? [bl.src] : []))
  const image = images.find((src) => !posters.has(src)) ?? images[0]
  return { ...post, title: fr.title, excerpt: excerptOf(blocks), ...(image ? { image } : {}), blocks }
}
