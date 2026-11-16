// Règles pures des musiques du montage (testées par editMusicRules.test.ts) : quels fichiers sont des musiques, et sous quel
// type l'aperçu de l'éditeur les lit (pxclip://music/<identifiant>, voir clipsProtocol.ts).

/** Les extensions que le sélecteur de musique propose. */
export const AUDIO_EXT: string[] = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'wma']

/** Un identifiant de musique : 12 caractères, comme editMusic.ts les fabrique. */
export const MUSIC_ID = /^[a-z0-9]{12}$/

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/mp4'
}

/** L'extension d'un nom de fichier, en minuscules, sans le point. */
export const extOf = (file: string): string => (file.split(/[\\/]/).pop() || '').split('.').slice(1).pop()?.toLowerCase() ?? ''

/** Le type servi pour ce fichier, ou null (extension inconnue, ou wma : le lecteur de la page ne sait pas le lire). */
export function musicMime(file: string): string | null {
  return MIME[extOf(file)] ?? null
}
