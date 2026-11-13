// Textes français des loadouts : emplacements, catégories d'armes, classes. Les noms des accessoires restent ceux du jeu.
import type { SlotId, WeaponCategory } from './types'

export const SLOT_LABEL: Record<SlotId, string> = {
  optic: 'Optique',
  'optic-accessory': 'Accessoire optique',
  muzzle: 'Bouche',
  barrel: 'Canon',
  underbarrel: 'Sous le canon',
  magazine: 'Chargeur',
  ammo: 'Munitions',
  accessory: 'Accessoire supérieur',
  'left-accessory': 'Accessoire gauche',
  'right-accessory': 'Accessoire droit',
  ergonomics: 'Ergonomie'
}

/** Libellés courts (cartes, éditeur), mêmes mots que le menu de personnalisation du jeu. */
export const CATEGORY_LABEL: Record<WeaponCategory, string> = {
  'assault-rifle': 'Fusil d’assaut',
  carbine: 'Carabine',
  smg: 'Mitraillette',
  lmg: 'Mitrailleuse légère',
  dmr: 'Fusil de tireur d’élite',
  sniper: 'Fusil de précision',
  shotgun: 'Fusil à pompe',
  pistol: 'Pistolet'
}

export type Bf6ClassId = 'assault' | 'engineer' | 'support' | 'recon'
export const BF6_CLASSES: Bf6ClassId[] = ['assault', 'engineer', 'support', 'recon']
export const CLASS_LABEL: Record<Bf6ClassId, string> = { assault: 'Assaut', engineer: 'Ingénieur', support: 'Soutien', recon: 'Éclaireur' }
