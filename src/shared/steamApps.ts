// Logiciels Steam (Wallpaper Engine, Blender…) : ils sont dans le compte Steam mais ne sont pas des jeux.
// La liste des logiciels du magasin vient de IStoreService/GetAppList (include_games=0, include_software=1), par pages.

/** Logiciels connus, masqués même sans clé Steam Web API (la liste du magasin la demande). */
export const KNOWN_SOFTWARE: readonly string[] = [
  '431960', // Wallpaper Engine
  '250820', // SteamVR
  '365670' // Blender
]

export interface AppListPage {
  ids: string[]
  /** Appid à passer en last_appid pour la page suivante ; 0 : dernière page. */
  next: number
}

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

/** Une page de GetAppList ; null si la réponse n'a pas la forme attendue (rien n'est alors masqué). */
export function parseAppListPage(json: unknown): AppListPage | null {
  const r = (json as { response?: unknown } | null)?.response as { apps?: unknown; have_more_results?: unknown; last_appid?: unknown } | undefined
  if (!r || typeof r !== 'object') return null
  // Page vide : la réponse n'a parfois aucun champ.
  if (r.apps === undefined) return { ids: [], next: 0 }
  if (!Array.isArray(r.apps)) return null
  const ids: string[] = []
  for (const a of r.apps as { appid?: unknown }[]) if (isId(a?.appid)) ids.push(String(a.appid))
  const next = r.have_more_results === true && isId(r.last_appid) ? r.last_appid : 0
  return { ids, next }
}

/** Nom affichable : vide pour les entrées sans nom (« », « ™ », espaces). */
export function hasName(name: string | undefined): boolean {
  return !!name && /[\p{L}\p{N}]/u.test(name)
}
