// Atelier des loadouts BF6 : ce qui évite de tout ressaisir. Règles pures (testées) :
// - « Mes armes » : chaque loadout enregistré apprend son arme (catégorie, accessoires et points par emplacement) ;
//   l'atelier les propose ensuite, comme les relevés de l'Armurerie.
// - Le brouillon : l'éditeur en cours, gardé à chaque modification, repris après une fermeture ou un plantage.
// - Les modèles : les builds de Breezydev (profil équipement de l'appli BF6), pour partir d'une config réelle.
import { SLOT_ORDER, type SlotId, type WeaponCategory } from './armory/types'
import { NAME_MAX, TEXT_MAX, isCategory, type Bf6ClassId, type Bf6Loadout, type Bf6LoadoutPart } from './bf6Loadouts'

export const MAX_MY_WEAPONS = 80
export const MAX_PER_SLOT = 40

/** Clé d'une arme : « Z84M », « z84 m » et « Z-84M » sont la même. */
export const myWeaponKey = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()

export interface MyWeaponPart {
  name: string
  pts?: number
}

export interface MyWeapon {
  key: string
  /** Nom tel que le joueur l'a écrit la dernière fois. */
  name: string
  cat?: WeaponCategory
  parts: Partial<Record<SlotId, MyWeaponPart[]>>
  updatedAt: number
}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/\s+/g, ' ').trim().slice(0, max)
  return s || undefined
}
const isPts = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100

function cleanParts(raw: unknown): MyWeapon['parts'] {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: MyWeapon['parts'] = {}
  for (const s of SLOT_ORDER) {
    const list = src[s]
    if (!Array.isArray(list)) continue
    const seen = new Set<string>()
    const items: MyWeaponPart[] = []
    for (const it of list) {
      const o = it && typeof it === 'object' ? (it as Record<string, unknown>) : {}
      const name = text(o.name, TEXT_MAX)
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      items.push(isPts(o.pts) ? { name, pts: o.pts } : { name })
      if (items.length >= MAX_PER_SLOT) break
    }
    if (items.length) out[s] = items
  }
  return out
}

export function cleanMyWeapon(raw: unknown): MyWeapon | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = text(r.name, TEXT_MAX)
  if (!name) return null
  const key = myWeaponKey(name)
  if (!key) return null
  const w: MyWeapon = { key, name, parts: cleanParts(r.parts), updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0 }
  if (isCategory(r.cat)) w.cat = r.cat
  return w
}

/** Liste relue : armes valides, sans doublon, les plus récentes d'abord. */
export function cleanMyWeapons(raw: unknown): MyWeapon[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: MyWeapon[] = []
  for (const item of raw) {
    const w = cleanMyWeapon(item)
    if (!w || seen.has(w.key)) continue
    seen.add(w.key)
    out.push(w)
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_MY_WEAPONS)
}

/**
 * Apprend l'arme d'un loadout : ses accessoires rejoignent ceux déjà retenus (les points notés remplacent les anciens,
 * l'accessoire remonte en tête de son emplacement). Une arme de l'Armurerie n'est pas apprise : ses relevés font foi.
 */
export function learnWeapon(list: MyWeapon[], l: Pick<Bf6Loadout, 'weapon' | 'parts' | 'cat' | 'armoryId'>, now: number): MyWeapon[] {
  if (l.armoryId) return list
  const name = text(l.weapon, TEXT_MAX)
  if (!name) return list
  const key = myWeaponKey(name)
  if (!key) return list
  const cur = list.find((w) => w.key === key)
  const parts: MyWeapon['parts'] = { ...(cur?.parts ?? {}) }
  for (const s of SLOT_ORDER) {
    const p: Bf6LoadoutPart | undefined = l.parts[s]
    if (!p?.name?.trim()) continue
    const item: MyWeaponPart = p.pts === undefined ? { name: p.name.trim() } : { name: p.name.trim(), pts: p.pts }
    const old = (parts[s] ?? []).find((x) => x.name.toLowerCase() === item.name.toLowerCase())
    if (item.pts === undefined && old?.pts !== undefined) item.pts = old.pts
    parts[s] = [item, ...(parts[s] ?? []).filter((x) => x.name.toLowerCase() !== item.name.toLowerCase())].slice(0, MAX_PER_SLOT)
  }
  const next: MyWeapon = { key, name, parts, updatedAt: now }
  const cat = l.cat ?? cur?.cat
  if (cat) next.cat = cat
  return cleanMyWeapons([next, ...list.filter((w) => w.key !== key)])
}

/* ---------- modèles : les builds de Breezydev ---------- */

export interface BuildTemplate {
  id: string
  /** Groupe affiché (l'arme). */
  weapon: string
  /** Nom du build. */
  label: string
  loadout: Partial<Bf6Loadout> & { cls: Bf6ClassId; weapon: string; parts: Bf6Loadout['parts'] }
}

type P = [string, number]
const parts = (o: Partial<Record<SlotId, P>>): Bf6Loadout['parts'] => Object.fromEntries(Object.entries(o).map(([s, [name, pts]]) => [s, { name, pts }])) as Bf6Loadout['parts']
const tpl = (id: string, weapon: string, cls: Bf6ClassId, cat: WeaponCategory, label: string, p: Partial<Record<SlotId, P>>, context?: string): BuildTemplate => ({
  id,
  weapon,
  label,
  loadout: { name: label.slice(0, NAME_MAX), cls, cat, weapon, parts: parts(p), ...(context ? { context } : {}) }
})

export const BUILD_TEMPLATES: BuildTemplate[] = [
  tpl('cz-close', 'CZ3A1', 'engineer', 'smg', 'Courte portée', {
    muzzle: ['Long Suppressor', 25],
    barrel: ['7.7" Pencil', 20],
    'right-accessory': ['5 MW Green', 10],
    underbarrel: ['Slim Angled', 20],
    magazine: ['30RND Fast Mag', 10],
    ammo: ['FMJ', 5],
    optic: ['Mini Flex 1.00x', 10]
  }),
  tpl('cz-versa', 'CZ3A1', 'engineer', 'smg', 'Polyvalent', {
    muzzle: ['Lightened Suppressor', 30],
    barrel: ['16.2" Cut', 5],
    'right-accessory': ['50 MW Blue', 20],
    underbarrel: ['Slim Angled', 20],
    magazine: ['30RND Fast Mag', 10],
    ammo: ['FMJ', 5],
    optic: ['Mini Flex 1.00x', 10]
  }),
  tpl('cz-long', 'CZ3A1', 'engineer', 'smg', 'Longue portée', {
    muzzle: ['Lightened Suppressor', 30],
    barrel: ['16.2" Cut', 5],
    underbarrel: ['Classic Vertical', 35],
    magazine: ['35RND Magazine', 15],
    ammo: ['FMJ', 5],
    optic: ['RO-M 1.75x', 10]
  }),
  tpl('mk24-reco', 'MK 24', 'assault', 'assault-rifle', 'Recommandé', {
    barrel: ['Heavy Ext.', 10],
    underbarrel: ['Low-Profile Stubby', 45],
    ammo: ['FMJ', 5],
    muzzle: ['Hybrid Suppressor [L]', 30],
    optic: ['CCO 2.00X', 10]
  }),
  tpl('mk24-ads', 'MK 24', 'assault', 'assault-rifle', 'Visée rapide', {
    barrel: ['Cryo', 20],
    underbarrel: ['Low-Profile Stubby', 45],
    ammo: ['FMJ', 5],
    muzzle: ['Compensator', 10],
    accessory: ['50 MW Violet', 10],
    optic: ['CCO 2.00X', 10]
  }),
  tpl('mk24-recul', 'MK 24', 'assault', 'assault-rifle', 'Recul minimal', {
    barrel: ['Heavy Ext.', 10],
    underbarrel: ['Classic Vertical', 35],
    ammo: ['FMJ', 5],
    muzzle: ['Compensator', 10],
    'right-accessory': ['50 MW Violet', 10],
    'left-accessory': ['50 MW Violet', 10],
    accessory: ['50 MW Violet', 10],
    optic: ['CCO 2.00X', 10]
  }),
  tpl('mk24-hanche', 'MK 24', 'assault', 'assault-rifle', 'Tir à la hanche', {
    barrel: ['Short', 15],
    ammo: ['Polymer Case', 10],
    ergonomics: ['Improved Mag Catch', 5],
    'right-accessory': ['50 MW Green', 20],
    'left-accessory': ['50 MW Green', 20],
    accessory: ['50 MW Green', 20],
    optic: ['CCO 2.00X', 10]
  }),
  tpl('z84-reco', 'Z84M', 'support', 'lmg', 'Recommandé', {
    barrel: ['Heavy Ext.', 10],
    underbarrel: ['Classic Vertical', 35],
    ammo: ['FMJ', 5],
    muzzle: ['Hybrid Suppressor [S]', 40],
    optic: ['CCO 2.00X', 10]
  }),
  tpl('z84-ads', 'Z84M', 'support', 'lmg', 'Visée rapide', {
    barrel: ['Cryo', 20],
    underbarrel: ['Low-Profile Stubby', 45],
    ammo: ['FMJ', 5],
    muzzle: ['Compensator', 10],
    'left-accessory': ['50 MW Violet', 10],
    optic: ['CCO 2.00X', 10]
  }),
  tpl('z84-recul', 'Z84M', 'support', 'lmg', 'Recul minimal', {
    barrel: ['Heavy Ext.', 10],
    underbarrel: ['Classic Vertical', 35],
    ammo: ['FMJ', 5],
    muzzle: ['Compensator', 10],
    'right-accessory': ['50 MW Violet', 10],
    accessory: ['50 MW Violet', 10],
    'left-accessory': ['50 MW Violet', 10],
    optic: ['CCO 2.00X', 10]
  }),
  tpl('z84-hanche', 'Z84M', 'support', 'lmg', 'Tir à la hanche', {
    barrel: ['Short', 15],
    ammo: ['Polymer Case', 10],
    ergonomics: ['Improved Mag Catch', 5],
    'right-accessory': ['50 MW Green', 20],
    accessory: ['50 MW Green', 20],
    'left-accessory': ['50 MW Green', 20],
    optic: ['CCO 2.00X', 10]
  }),
  // Le loadout recommandé de l'appli BF6 (mis à jour le 16/10/2026, arme niveau 40), aux noms du menu du jeu :
  // « Silencieux combat rapproché » = Silencieux CR, « 29" Full » = Standard 737 mm (mêmes points).
  tpl('elr-sniper', 'ELR-40', 'recon', 'sniper', 'Sniper', {
    muzzle: ['Silencieux CR', 30],
    barrel: ['Standard 737 mm', 10],
    'optic-accessory': ['Revêtement antireflet', 10],
    underbarrel: ['Poignée angulaire fine', 15],
    magazine: ['Single Shot', 5],
    ammo: ['Balle chemisée', 5],
    optic: ['1P86 LPVO', 20],
    ergonomics: ['Arrêtoir de chargeur amélioré', 5]
  }),
  // Loadouts recommandés pour RedSec (appli BF6, captures de Breezydev du 02/11/2026).
  tpl(
    'kts-redsec-long',
    'KTS100 MK8',
    'support',
    'lmg',
    'Longue portée · RedSec',
    {
      muzzle: ['Silencieux allégé', 30],
      barrel: ['MK8 508 mm', 10],
      underbarrel: ['Poignée verticale classique', 35],
      magazine: ['Chargeur rapide 45 coups', 10],
      ammo: ['Balle chemisée', 5],
      optic: ['Baker 3.00X', 10]
    },
    'RedSec'
  ),
  tpl(
    'sgx-redsec-court',
    'SGX',
    'engineer',
    'smg',
    'Courte portée · RedSec',
    {
      muzzle: ['Silencieux allégé', 30],
      barrel: ['Long 203 mm', 5],
      'right-accessory': ['Laser bleu 50 MW', 20],
      underbarrel: ['Poignée angulaire fine', 20],
      magazine: ['Chargeur 36 coups', 15],
      ammo: ['Balle chemisée', 5],
      optic: ['Mire métallique', 5]
    },
    'RedSec'
  ),
  tpl(
    'rpk-redsec-long',
    'RPK-74M',
    'support',
    'lmg',
    'Longue portée · RedSec',
    {
      muzzle: ['Silencieux allégé', 30],
      barrel: ['Usine 590 mm', 10],
      underbarrel: ['Poignée angulaire fine', 25],
      magazine: ['Chargeur 30 coups', 5],
      ammo: ['Pointe synthétique', 20],
      optic: ['Baker 3.00X', 10]
    },
    'RedSec'
  )
]

/* ---------- les accessoires d'une arme, relevés dans le menu de personnalisation du jeu ---------- */

type Catalog = Partial<Record<SlotId, (string | P)[]>>
/** Accessoires connus par arme (clé : myWeaponKey). Les points ne sont notés que lorsqu'ils sont lisibles. */
export const WEAPON_PARTS: Record<string, Catalog> = {
  // ELR-40, vidéo de Breezydev du 02/11/2026.
  elr40: {
    muzzle: [
      ['Frein de bouche multi-ports', 10],
      ['Cache-flamme', 10],
      ['Silencieux long', 25],
      ['Silencieux CR', 30]
    ],
    barrel: [
      ['Personnalisé 813 mm', 5],
      ['Usine 737 mm', 20],
      ['Standard 737 mm', 10]
    ],
    underbarrel: [
      ['Poignée courte d’infiltration', 10],
      ['Poignée pleinement angulaire', 5],
      ['Bipied', 10],
      ['Poignée bipied rapide', 10],
      'Poignée bipied classique',
      'Module actionné',
      ['Poignée angulaire fine', 15]
    ],
    magazine: [['Single Shot', 5]],
    ammo: [
      ['Balle chemisée', 5],
      ['Noyau en tungstène', 5],
      ['Fragmentation', 20]
    ],
    optic: [
      ['Mire métallique', 15],
      ['Mini Flex 1X', 10],
      ['OSA-7 1X', 10],
      ['RO-S 1.25X', 10],
      ['2PRO 1.25X', 10],
      'SU-123 1.5X',
      'RO-M 1.75X',
      'CCO 2X',
      'BF-2M 2.5X',
      'SDO 3.5X',
      ['1P86 LPVO', 20],
      'LERT 8X'
    ],
    'optic-accessory': [['Revêtement antireflet', 10]],
    'right-accessory': [
      ['Lampe tactique visée', 5],
      ['Lampe-torche', 10],
      ['Lampe tactique au jugé', 15],
      ['Télémètre', 15]
    ],
    accessory: [['Laser rouge 5 MW', 10], ['Laser violet 50 MW', 10], ['Laser vert 5 MW', 10], ['Laser vert 50 MW', 20], 'Laser bleu 50 MW', 'Laser bleu 120 MW'],
    ergonomics: [
      ['Arrêtoir de chargeur amélioré', 5],
      ['Protection de rail', 5],
      ['Culasse à manœuvre rectiligne', 30]
    ]
  }
}

/** Les accessoires connus d'une arme pour un emplacement. */
export function catalogParts(weapon: string, slot: SlotId): MyWeaponPart[] {
  return (WEAPON_PARTS[myWeaponKey(weapon)]?.[slot] ?? []).map((p) => (typeof p === 'string' ? { name: p } : { name: p[0], pts: p[1] }))
}

/** Armes connues par les modèles, apprises comme si chaque modèle avait été enregistré (le plus ancien d'abord). */
export function templateWeapons(): MyWeapon[] {
  let list: MyWeapon[] = []
  BUILD_TEMPLATES.forEach((t, i) => (list = learnWeapon(list, t.loadout, i)))
  return list
}

/** Suggestions pour un emplacement : tes accessoires retenus, puis ceux des modèles, puis ceux relevés dans le jeu, sans doublon. */
export function suggestParts(mine: MyWeapon[], weapon: string, slot: SlotId): MyWeaponPart[] {
  const key = myWeaponKey(weapon)
  if (!key) return []
  const out: MyWeaponPart[] = []
  const seen = new Set<string>()
  for (const list of [...[mine, templateWeapons()].map((src) => src.find((w) => w.key === key)?.parts[slot] ?? []), catalogParts(weapon, slot)]) {
    for (const p of list) {
      if (seen.has(p.name.toLowerCase())) continue
      seen.add(p.name.toLowerCase())
      out.push(p)
    }
  }
  return out
}

/* ---------- les armes principales du jeu (relevées par Breezydev dans le menu des classes, 02/11/2026) ---------- */

export const BF6_WEAPONS: { name: string; cat: WeaponCategory }[] = [
  ...(['M433', 'B36A4', 'SOR-556 MK2', 'AK4D', 'TR-7', 'KORD 6P67', 'NVO-228E', 'L85A3', 'VCR-2', 'M16A4', 'EF88', 'MK 24'] as const).map((name) => ({
    name,
    cat: 'assault-rifle' as const
  })),
  ...(['M4A1', 'M277', 'AK-205', 'M417 A2', 'GRT-BC', 'QBZ-192', 'SG 553R', 'SOR-300SC', 'BROD 3'] as const).map((name) => ({ name, cat: 'carbine' as const })),
  ...(['SGX', 'PW5A3', 'PW7A2', 'UMG-40', 'USG-90', 'KV9', 'SCW-10', 'SL9', 'CZ3A1', 'PP-19', 'RSPR'] as const).map((name) => ({ name, cat: 'smg' as const })),
  ...(['L110', 'DRS-IAR', 'M/60', 'RPKM', 'M123K', 'M250', 'KTS100 MK8', 'M240L', 'M121 A2', 'RPK-74M', 'Z84M'] as const).map((name) => ({ name, cat: 'lmg' as const })),
  ...(['M39 EMR', 'LMR27', 'SVK-8.6', 'SVDM', 'GRT-CPS', 'VSSM'] as const).map((name) => ({ name, cat: 'dmr' as const })),
  ...(['M2010 ESR', 'SV-98', 'PSR', 'Mini Scout', 'L115', 'Interdictor', 'ELR-40'] as const).map((name) => ({ name, cat: 'sniper' as const })),
  ...(['M87A1', 'M1014', '18.5KS-K', 'DB-12'] as const).map((name) => ({ name, cat: 'shotgun' as const }))
]

/** Catégorie connue d'une arme (tes armes, puis les modèles, puis la liste du jeu). */
export function knownCategory(mine: MyWeapon[], weapon: string): WeaponCategory | undefined {
  const key = myWeaponKey(weapon)
  return mine.find((w) => w.key === key)?.cat ?? templateWeapons().find((w) => w.key === key)?.cat ?? BF6_WEAPONS.find((w) => myWeaponKey(w.name) === key)?.cat
}
