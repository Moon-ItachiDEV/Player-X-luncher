// Petits utilitaires de texte partagés entre le processus principal et l'interface.

/** Nom affichable sans ™/®/© ni suffixe d'édition. */
export function cleanName(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .replace(/\s*[-–:]?\s*(Standard|Deluxe|Ultimate|Gold|Premium|Complete|Definitive|Game of the Year)\s+Edition$/i, '')
    .trim()
}

/** Clé de comparaison : minuscules, sans accents ni ponctuation. Sert à rapprocher un ami en jeu d'un jeu de la bibliothèque. */
export function norm(name: string): string {
  return cleanName(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Battlefield 6, quel que soit le nom exact du store (« Battlefield™ 6 »…). */
export function isBf6Name(name: string): boolean {
  return norm(name).includes('battlefield6')
}

/** Teinte stable (0-359) dérivée d'un nom, pour les jaquettes générées. */
export function hue(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** « il y a 2 h », « à l'instant »… (sans majuscule, pour s'insérer dans une phrase). */
export function timeAgo(ts: number, now = Date.now()): string {
  const min = Math.round((now - ts) / 60_000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  if (min < 1440) return `il y a ${Math.round(min / 60)} h`
  const days = Math.round(min / 1440)
  if (days < 30) return `il y a ${days} j`
  const months = Math.round(days / 30)
  if (months < 12) return `il y a ${months} mois`
  const years = Math.round(months / 12)
  return `il y a ${years} an${years > 1 ? 's' : ''}`
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

/** « 17 oct. 2026, 21:14 » */
export function formatDate(ts: number): string {
  return dateFmt.format(ts)
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** « 1 jeu », « 3 jeux » */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`
}

/** Identifiant d'un serveur Discord, retrouvé dans ce qui a été collé (ID seul, lien « JSON API » ou lien du widget). */
export function discordGuildIdFrom(input: string): string {
  const t = input.trim()
  return (t.match(/guilds\/(\d{15,22})/) ?? t.match(/[?&]id=(\d{15,22})/) ?? t.match(/^(\d{15,22})$/))?.[1] ?? t
}

const hoursFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

/** « 42 min », « 3 h 05 », « 128 h » */
export function formatPlaytime(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h >= 100) return `${hoursFmt.format(h)} h`
  const rest = m % 60
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`
}
