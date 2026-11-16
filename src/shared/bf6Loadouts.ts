// Mes loadouts Battlefield 6 : un carnet tenu par le joueur, gardé sur ce PC. Le jeu ne laisse lire ni modifier ses
// loadouts : ici, le joueur note les siens (classe, arme et accessoires, équipement). Règles pures : nettoyage de ce qui
// arrive du stockage ou de l'interface, ajout, suppression, total des points et texte à copier.
import { BF6_CLASSES, CLASS_LABEL, SLOT_LABEL, type Bf6ClassId } from './armory/labels'
import { SLOT_ORDER, type SlotId, type WeaponCategory } from './armory/types'

export type { Bf6ClassId }

export interface Bf6LoadoutPart {
  name: string
  /** Points de l'accessoire, s'il les a notés (ou s'ils viennent de l'Armurerie). */
  pts?: number
}

export interface Bf6Loadout {
  id: string
  name: string
  cls: Bf6ClassId
  /** Mode ou carte où il le joue (« Conquête », « Percée sur Mirak »…). */
  context?: string
  /** Arme principale. */
  weapon: string
  /** Arme de l'Armurerie quand ses accessoires viennent de ses relevés. */
  armoryId?: string
  /** Catégorie de l'arme (silhouette de la carte, « Mes armes »). */
  cat?: WeaponCategory
  /** Classement donné par le joueur (S le meilleur). */
  tier?: Bf6Tier
  parts: Partial<Record<SlotId, Bf6LoadoutPart>>
  secondary?: string
  gadget1?: string
  gadget2?: string
  grenade?: string
  melee?: string
  training?: string
  notes?: string
  updatedAt: number
}

export const MAX_LOADOUTS = 60
export const NAME_MAX = 40
export const TEXT_MAX = 60
export const NOTES_MAX = 400

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/\s+/g, ' ').trim().slice(0, max)
  return s || undefined
}

export type Bf6Tier = 'S' | 'A' | 'B' | 'C'
export const TIERS: Bf6Tier[] = ['S', 'A', 'B', 'C']
export const isTier = (v: unknown): v is Bf6Tier => typeof v === 'string' && (TIERS as string[]).includes(v)
/** Rang pour trier : S d'abord, sans classement en dernier. */
export const tierRank = (t?: Bf6Tier): number => (t ? TIERS.indexOf(t) : TIERS.length)

export const WEAPON_CATEGORIES: WeaponCategory[] = ['assault-rifle', 'carbine', 'smg', 'lmg', 'dmr', 'sniper', 'shotgun', 'pistol']
export const isCategory = (v: unknown): v is WeaponCategory => typeof v === 'string' && (WEAPON_CATEGORIES as string[]).includes(v)

const isClass = (v: unknown): v is Bf6ClassId => typeof v === 'string' && (BF6_CLASSES as string[]).includes(v)

/** Un loadout propre, ou null s'il lui manque l'essentiel (nom, classe, arme). */
export function cleanLoadout(raw: unknown): Bf6Loadout | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' && /^[a-z0-9]{1,24}$/i.test(r.id) ? r.id : null
  const name = text(r.name, NAME_MAX)
  const weapon = text(r.weapon, TEXT_MAX)
  if (!id || !name || !weapon || !isClass(r.cls)) return null
  const parts: Bf6Loadout['parts'] = {}
  const src = r.parts && typeof r.parts === 'object' ? (r.parts as Record<string, unknown>) : {}
  for (const s of SLOT_ORDER) {
    const p = src[s]
    if (!p || typeof p !== 'object') continue
    const pn = text((p as Record<string, unknown>).name, TEXT_MAX)
    if (!pn) continue
    const pts = (p as Record<string, unknown>).pts
    parts[s] = typeof pts === 'number' && Number.isInteger(pts) && pts >= 0 && pts <= 100 ? { name: pn, pts } : { name: pn }
  }
  const notes = typeof r.notes === 'string' ? r.notes.replace(/\r\n?/g, '\n').trim().slice(0, NOTES_MAX) || undefined : undefined
  const out: Bf6Loadout = {
    id,
    name,
    cls: r.cls,
    weapon,
    parts,
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0
  }
  const opt = {
    context: text(r.context, TEXT_MAX),
    armoryId: text(r.armoryId, 24),
    cat: isCategory(r.cat) ? r.cat : undefined,
    tier: isTier(r.tier) ? r.tier : undefined,
    secondary: text(r.secondary, TEXT_MAX),
    gadget1: text(r.gadget1, TEXT_MAX),
    gadget2: text(r.gadget2, TEXT_MAX),
    grenade: text(r.grenade, TEXT_MAX),
    melee: text(r.melee, TEXT_MAX),
    training: text(r.training, TEXT_MAX),
    notes
  }
  for (const [k, v] of Object.entries(opt)) if (v) (out as unknown as Record<string, unknown>)[k] = v
  return out
}

/** Liste relue : loadouts valides, sans doublon d'identifiant, les plus récents d'abord, MAX_LOADOUTS au plus. */
export function cleanLoadouts(raw: unknown): Bf6Loadout[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Bf6Loadout[] = []
  for (const item of raw) {
    const l = cleanLoadout(item)
    if (!l || seen.has(l.id)) continue
    seen.add(l.id)
    out.push(l)
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LOADOUTS)
}

/** Ajoute ou remplace (même identifiant). Refuse au-delà de MAX_LOADOUTS. */
export function withLoadout(list: Bf6Loadout[], raw: unknown, now: number): Bf6Loadout[] {
  const l = cleanLoadout(raw)
  if (!l) throw new Error('Loadout incomplet : il lui faut un nom, une classe et une arme principale.')
  const others = list.filter((x) => x.id !== l.id)
  if (others.length >= MAX_LOADOUTS) throw new Error(`Tu as déjà ${MAX_LOADOUTS} loadouts : supprimes-en un pour en ajouter un autre.`)
  return cleanLoadouts([{ ...l, updatedAt: now }, ...others])
}

export const withoutLoadout = (list: Bf6Loadout[], id: string): Bf6Loadout[] => list.filter((x) => x.id !== id)

/** Total des points notés ; `missing` : accessoires sans points. */
export function loadoutPoints(l: Pick<Bf6Loadout, 'parts'>): { total: number; missing: number; count: number } {
  let total = 0
  let missing = 0
  let count = 0
  for (const s of SLOT_ORDER) {
    const p = l.parts[s]
    if (!p) continue
    count++
    if (p.pts === undefined) missing++
    else total += p.pts
  }
  return { total, missing, count }
}

/** Le loadout en texte, pour le coller sur Discord. */
export function loadoutText(l: Bf6Loadout): string {
  const lines = [`${l.name} · ${CLASS_LABEL[l.cls]}${l.context ? ` · ${l.context}` : ''}`, `${l.weapon}`]
  for (const s of SLOT_ORDER) {
    const p = l.parts[s]
    if (p) lines.push(`  ${SLOT_LABEL[s]} : ${p.name}${p.pts !== undefined ? ` (${p.pts} pts)` : ''}`)
  }
  const pts = loadoutPoints(l)
  if (pts.count && !pts.missing) lines.push(`  Total : ${pts.total} / 100 pts`)
  const gear: [string, string | undefined][] = [
    ['Arme secondaire', l.secondary],
    ['Gadgets', [l.gadget1, l.gadget2].filter(Boolean).join(', ') || undefined],
    ['Grenade', l.grenade],
    ['Mêlée', l.melee],
    ['Voie d’entraînement', l.training]
  ]
  for (const [k, v] of gear) if (v) lines.push(`${k} : ${v}`)
  if (l.notes) lines.push('', l.notes)
  return lines.join('\n')
}

/** Nom proposé pour un nouveau loadout : « Assaut 1 », « Assaut 2 »… sans doublon. */
export function suggestName(list: Bf6Loadout[], cls: Bf6ClassId): string {
  const used = new Set(list.map((l) => l.name.toLowerCase()))
  for (let i = 1; ; i++) {
    const name = `${CLASS_LABEL[cls]} ${i}`
    if (!used.has(name.toLowerCase())) return name
  }
}
