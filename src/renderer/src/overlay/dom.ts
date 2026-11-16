// Petit outil DOM de l'overlay CS2, sans dépendance : h() fabrique un arbre neuf à chaque rendu, patch() ne change que ce
// qui diffère dans l'arbre affiché. Un élément garde son nœud (et donc son animation d'entrée en cours) tant que sa balise
// et sa clé restent les mêmes à la même place ; une autre clé le remplace par un nœud neuf, qui rejoue son entrée.

export type Child = Node | string | number | false | null | undefined
type Attrs = Record<string, string | number | false | null | undefined>

const keys = new WeakMap<Node, string>()
const SVG_NS = 'http://www.w3.org/2000/svg'

function build<E extends Element>(el: E, attrs: Attrs | null, children: Child[]): E {
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue
      if (k === 'key') keys.set(el, String(v))
      else el.setAttribute(k, String(v))
    }
  }
  for (const c of children) {
    if (c === false || c === null || c === undefined || c === '') continue
    el.append(typeof c === 'object' ? c : String(c))
  }
  return el
}

/** Élément HTML. `key` n'est pas un attribut : il dit seulement si l'élément est « le même » d'un rendu à l'autre. */
export function h(tag: string, attrs: Attrs | null = null, ...children: Child[]): HTMLElement {
  return build(document.createElement(tag), attrs, children)
}

/** Élément SVG. */
export function s(tag: string, attrs: Attrs | null = null, ...children: Child[]): SVGElement {
  return build(document.createElementNS(SVG_NS, tag) as SVGElement, attrs, children)
}

const same = (a: Node, b: Node): boolean =>
  a.nodeType === b.nodeType && (a.nodeType !== Node.ELEMENT_NODE || (a.nodeName === b.nodeName && keys.get(a) === keys.get(b)))

function morph(cur: Element, next: Element): void {
  for (const { name } of [...cur.attributes]) if (!next.hasAttribute(name)) cur.removeAttribute(name)
  for (const { name, value } of [...next.attributes]) if (cur.getAttribute(name) !== value) cur.setAttribute(name, value)
  patch(cur, [...next.childNodes])
}

/** Donne à `parent` les enfants `next` (nœuds neufs, pas encore affichés), en gardant les nœuds actuels qui correspondent. */
export function patch(parent: Element, next: Node[]): void {
  const cur = [...parent.childNodes]
  next.forEach((n, i) => {
    const c = cur[i]
    if (!c) parent.append(n)
    else if (!same(c, n)) parent.replaceChild(n, c)
    else if (c.nodeType === Node.ELEMENT_NODE) morph(c as Element, n as Element)
    else if (c.nodeValue !== n.nodeValue) c.nodeValue = n.nodeValue
  })
  for (const c of cur.slice(next.length)) c.remove()
}
