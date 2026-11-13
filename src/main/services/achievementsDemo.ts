import type { Achievement, Game, GameAchievements } from '@shared/types'
import { isUnlocked } from './achievementsFormat'

// Succès fictifs des jeux Steam du mode démo (demo.ts), sans icônes : l'interface dessine leur emblème.
// [nom, description (vide : succès caché sans description), % des joueurs, débloqué il y a combien de jours (null : pas encore), caché]
type Row = [string, string, number, number | null, boolean?]

const DEMO: Record<string, { name: string; minutes: number; rows: Row[] }> = {
  '1245620': {
    name: 'ELDEN RING',
    minutes: 7_390,
    rows: [
      ['Seigneur d’Elden', 'Atteindre la fin « Seigneur d’Elden »', 21.6, null],
      ['L’âge des étoiles', 'Atteindre la fin « L’âge des étoiles »', 14.2, null],
      ['Seigneur de la Flamme frénétique', '', 13.9, null, true],
      ['Margit le Funeste', 'Vaincre Margit le Funeste', 68.0, 165],
      ['Porteur de Godrick', 'Vaincre Godrick le Greffé', 63.4, 160],
      ['Porteuse de Rennala', 'Vaincre Rennala, reine de la Pleine Lune', 49.8, 140],
      ['Porteur de Radahn', 'Vaincre Radahn, Fléau des étoiles', 44.1, 120],
      ['Porteur de Rykard', 'Vaincre Rykard, seigneur du Blasphème', 37.5, 90],
      ['Porteur de Morgott', 'Vaincre Morgott, roi des Réprouvés', 35.2, 60],
      ['Armes légendaires', 'Obtenir toutes les armes légendaires', 9.4, 30],
      ['Porteur de Mohg', 'Vaincre Mohg, seigneur du Sang', 24.3, 9],
      ['Seigneur dragon Placidusax', 'Vaincre le seigneur dragon Placidusax', 11.6, 5],
      ['Porteuse de Malenia', 'Vaincre Malenia, lame de Miquella', 18.7, 2],
      ['Liche-dragon Fortissax', 'Vaincre la liche-dragon Fortissax', 19.9, null],
      ['Talismans légendaires', 'Obtenir tous les talismans légendaires', 6.8, null],
      ['Elden Ring', 'Obtenir tous les succès', 4.1, null]
    ]
  },
  '730': {
    name: 'Counter-Strike 2',
    minutes: 11_820,
    rows: [['Un nouveau départ', 'Jouer une partie de Counter-Strike 2', 71.3, 300]]
  },
  // Joués hors de Player X dans la démo (demo.ts) : quelques succès, tous débloqués avant la dernière partie.
  '1091500': {
    name: 'Cyberpunk 2077',
    minutes: 4_210,
    rows: [
      ['Le Mat', 'Devenir mercenaire à Night City', 91.0, 40],
      ['Les Amoureux', 'Réussir le casse du Konpeki Plaza', 74.0, 12],
      ['L’Ermite', 'Retrouver Hanako Arasaka', 46.5, 2],
      ['La Roue de Fortune', 'Terminer le contrat de Johnny', 30.2, null],
      ['À couper le souffle', 'Réunir tous les objets légendaires', 3.2, null],
      ['Le Monde', '', 12.8, null, true]
    ]
  },
  '1086940': {
    name: "Baldur's Gate 3",
    minutes: 1_960,
    rows: [
      ['Descente depuis l’Averne', 'Échapper au nautiloïde', 92.8, 190],
      ['Erreur de débutant', 'Tomber dans un piège évident', 41.2, 185],
      ['Coup critique', 'Réussir un coup critique', 33.0, 178],
      ['L’intrigue se corse', 'Terminer l’acte I', 51.0, 160],
      ['Marteau des ennemis', '', 9.8, 150, true],
      ['Mauvais remède', 'Soigner un camp de réfugiés malades', 22.0, null],
      ['Héros de la Porte de Baldur', 'Terminer l’histoire', 18.4, null],
      ['Mode honneur', 'Terminer le jeu en mode honneur', 1.9, null]
    ]
  },
  '413150': {
    name: 'Stardew Valley',
    minutes: 385,
    rows: [
      ['Novice', 'Gagner 15 000 g', 78.0, 500],
      ['Vacher', 'Gagner 50 000 g', 60.0, 495],
      ['Commis', 'Accomplir 10 demandes d’aide', 55.0, 490],
      ['Propriétaire', 'Gagner 250 000 g', 32.0, 480],
      ['Maison pleine', 'Se marier et avoir deux enfants', 9.0, 470],
      ['Millionnaire', 'Gagner 1 000 000 g', 12.4, null],
      ['Légende locale', 'Restaurer le centre communautaire', 22.5, null],
      ['Maître pêcheur', 'Pêcher toutes les espèces de poissons', 4.3, null]
    ]
  },
  '1145360': {
    name: 'Hades',
    minutes: 1_420,
    rows: [
      ['Évadé du Tartare', 'Vaincre Mégère', 89.0, 30],
      ['Ami de Cerbère', 'Caresser Cerbère', 76.4, 10],
      ['Évasion', 'S’échapper des Enfers', 52.1, null],
      ['Fin', '', 14.6, null, true]
    ]
  },
  '367520': {
    name: 'Hollow Knight',
    minutes: 2_350,
    rows: [
      ['Épreuve de résolution', 'Vaincre le Faux Chevalier', 64.0, 310],
      ['Mensonge', 'Vaincre Hornet au Mausolée vert', 66.0, 308],
      ['Professeur', 'Détruire le premier gardien', 30.0, 305],
      ['Témoin', 'Voir le fond du Bassin ancien', 34.0, 302],
      ['Frère et sœur scellés', '', 6.5, null, true],
      ['Âme d’acier', 'Terminer le mode Âme d’acier', 1.4, null],
      ['Course 1', 'Terminer en moins de 10 heures', 2.6, null]
    ]
  },
  '105600': {
    name: 'Terraria',
    minutes: 4_980,
    rows: [
      ['Timber!!', 'Couper ton premier arbre', 87.0, 800],
      ['Banc d’essai', 'Fabriquer ton premier établi', 80.0, 799],
      ['Un œil sur toi', 'Vaincre l’Œil de Cthulhu', 48.0, 780],
      ['Shinobi glissant', 'Utiliser un grappin', 36.0, 760],
      ['Agent immobilier', 'Loger tous les PNJ en même temps', 12.0, 650],
      ['Toujours faim', 'Vaincre le Mur de chair', 22.0, 700],
      ['Champion de Terraria', 'Vaincre le Seigneur de la Lune', 5.4, null],
      ['Tueur de mondes', 'Vaincre tous les boss', 2.9, null]
    ]
  },
  '620': {
    name: 'Portal 2',
    minutes: 1_140,
    rows: [
      ['Réveil brutal', 'Survivre au manoir', 95.0, 722],
      ['Pas découragé', 'Terminer le premier test', 80.0, 721],
      ['Pont sur eau trouble', 'Terminer le chapitre 3', 77.0, 720],
      ['Sabotage', 'Interrompre la chaîne de production', 72.0, 716],
      ['Partenaire d’impasse', 'Appuyer sur le bouton', 60.0, 714],
      ['Expérience des deux puits', 'Faire le test dans la vieille Aperture', 41.0, 712],
      ['Le passage où il te tue', '', 66.0, 711, true],
      ['Tu es un monstre', 'Placer GLaDOS dans une pomme de terre', 84.0, 710],
      ['Lunatique', 'Atteindre la Lune', 69.0, 708],
      ['Patate en balade', 'Emporter la patate partout', 13.2, 705]
    ]
  },
  '2379780': {
    name: 'Balatro',
    minutes: 650,
    rows: [
      ['Mise de départ', 'Atteindre la mise 4', 92.0, 40],
      ['Contourne-règles', 'Utiliser un joker interdit', 31.0, 14],
      ['Quinte flush royale', 'Jouer une quinte flush royale', 15.5, 12],
      ['Rétrograde', 'Gagner avec le jeu d’or', 1.2, null],
      ['Collectionneur', 'Découvrir toutes les cartes', 0.8, null]
    ]
  },
  // Jamais joué (non installé, demo.ts) : le jeu « Pas commencé » de la page Trophées.
  '546560': {
    name: 'Half-Life: Alyx',
    minutes: 0,
    rows: [
      ['Premier contact', 'Terminer le premier chapitre', 78.5, null],
      ['Gravité zéro', 'Attraper un objet au vol avec les gants', 64.0, null],
      ['Résistant', 'Terminer l’histoire', 41.3, null]
    ]
  }
}

const DAY = 24 * 3600_000

function listFor(appId: string, now: number): Achievement[] | null {
  const g = DEMO[appId]
  if (!g) return null
  return g.rows.map(([name, description, percent, days, hidden], i) => ({
    id: `demo_${appId}_${i}`,
    name,
    hidden: !!hidden,
    ...(description ? { description } : {}),
    // Heure fixe dans la journée : la liste ne bouge pas d'une ouverture à l'autre.
    ...(days !== null ? { unlockedAt: Math.floor((now - days * DAY) / DAY) * DAY + (i % 12) * 3600_000 } : {}),
    percent
  }))
}

export function demoAchievements(game: Game, now = Date.now()): GameAchievements {
  if (game.store !== 'steam') return { state: 'not-steam', list: [], unlocked: 0, total: 0 }
  const list = listFor(game.storeId, now)
  if (!list) return { state: 'none', list: [], unlocked: 0, total: 0 }
  return { state: 'ready', list, unlocked: list.filter(isUnlocked).length, total: list.length }
}

