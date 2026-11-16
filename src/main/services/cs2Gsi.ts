// Liaison avec Counter-Strike 2 (Game State Integration de Valve) : le fichier que CS2 lit à son démarrage, et le tri des
// requêtes reçues sur le petit serveur local. Module pur, sans Electron : testé par `npm run test:cs2`.
import { timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'

/** Nom du fichier : CS2 lit tous les gamestate_integration_*.cfg de son dossier cfg. */
export const GSI_FILE = 'gamestate_integration_playerxv3test.cfg'
/** Port préféré, puis les suivants s'il est pris. */
export const BASE_PORT = 47770
export const PORT_TRIES = 10
/** Bien au-delà d'un vrai envoi (quelques Ko sans les armes ni les autres joueurs). */
export const MAX_BODY = 256 * 1024
export const GSI_PATH = '/cs2'

/** Dossier cfg de CS2 dans son dossier d'installation (steamapps/common/Counter-Strike Global Offensive). */
export const cfgDir = (installDir: string): string => join(installDir, 'game', 'csgo', 'cfg')

/**
 * Contenu du fichier (format KeyValues de Valve). Sans BOM : CS2 ignore un fichier qui en a un.
 * Envois : au plus toutes les 0,5 s, et toutes les 10 s même sans changement (sert à voir un match coupé).
 * Seulement ce qu'il faut : ni les armes, ni la position, ni les autres joueurs (réservés aux spectateurs de toute façon).
 */
export function cfgText(port: number, token: string): string {
  return [
    '// Player X : ton match Counter-Strike 2 en direct et ton bilan. Rien ne sort de ton PC (127.0.0.1).',
    '// Retiré par Player X quand tu coupes « Match Counter-Strike 2 » dans ses Paramètres.',
    '"Player X"',
    '{',
    `\t"uri"\t\t"http://127.0.0.1:${port}${GSI_PATH}"`,
    '\t"timeout"\t"5.0"',
    '\t"buffer"\t"0.1"',
    '\t"throttle"\t"0.5"',
    '\t"heartbeat"\t"10.0"',
    '\t"auth"',
    '\t{',
    `\t\t"token"\t"${token}"`,
    '\t}',
    '\t"data"',
    '\t{',
    '\t\t"provider"\t\t\t"1"',
    '\t\t"map"\t\t\t\t"1"',
    '\t\t"map_round_wins"\t\t"1"',
    '\t\t"round"\t\t\t\t"1"',
    '\t\t"player_id"\t\t\t"1"',
    '\t\t"player_state"\t\t"1"',
    '\t\t"player_match_stats"\t"1"',
    '\t}',
    '}',
    ''
  ].join('\r\n')
}

/** Jeton aléatoire : seulement des caractères sûrs dans le fichier de Valve (pas de guillemet). */
export const isToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(t)

export interface RequestHead {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
}

/**
 * Requête acceptée (`null`) ou code de refus. Une page web ouverte dans un navigateur peut viser 127.0.0.1 : elle envoie
 * toujours un en-tête Origin, CS2 jamais. Le jeton, vérifié ensuite, est la vraie protection.
 */
export function refuse(req: RequestHead): number | null {
  if (req.method !== 'POST') return 405
  if ((req.url ?? '').split('?')[0] !== GSI_PATH) return 404
  if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) return 403
  const len = Number(req.headers['content-length'] ?? 0)
  if (!Number.isFinite(len) || len > MAX_BODY) return 413
  return null
}

/** Le jeton de l'envoi (auth.token) est le nôtre : comparaison à temps constant. */
export function tokenMatches(body: unknown, token: string): boolean {
  const auth = body && typeof body === 'object' ? (body as { auth?: { token?: unknown } }).auth : undefined
  const got = typeof auth?.token === 'string' ? Buffer.from(auth.token) : null
  const want = Buffer.from(token)
  return !!got && got.length === want.length && timingSafeEqual(got, want)
}
