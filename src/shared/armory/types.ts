// Battlefield 6 : emplacements d'accessoires et catégories d'armes (atelier de loadouts).

export type SlotId = 'optic' | 'optic-accessory' | 'muzzle' | 'barrel' | 'underbarrel' | 'magazine' | 'ammo' | 'accessory' | 'left-accessory' | 'right-accessory' | 'ergonomics'

export type WeaponCategory = 'assault-rifle' | 'carbine' | 'smg' | 'lmg' | 'dmr' | 'sniper' | 'shotgun' | 'pistol'

/** Ordre des emplacements d'accessoires d'une arme (atelier de loadouts). */
export const SLOT_ORDER: SlotId[] = ['optic', 'optic-accessory', 'muzzle', 'barrel', 'underbarrel', 'magazine', 'ammo', 'accessory', 'left-accessory', 'right-accessory', 'ergonomics']
