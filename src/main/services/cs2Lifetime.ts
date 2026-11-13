import { app, net } from 'electron'
import { CS2_APPID, CS2_GAME_ID } from '@shared/cs2'
import { addPoint, cleanHistory, lifetimeOf, pointOf, readUserStats } from '@shared/cs2Lifetime'
import type { Cs2Lifetime, Cs2LifetimePoint, Cs2LifetimeReason, Cs2LifetimeResult } from '@shared/types'
import { getKv, listGames, setKv } from '../db'
import { getAccounts, getSettings } from './settings'

// Counter-Strike 2 : stats à vie de Valve, avec la clé Steam Web API du joueur (Paramètres › Avancé) et son compte
// Steam relié. ISteamUserStats/GetUserStatsForGame (appid 730) donne les totaux depuis ses débuts (CS:GO et CS2
// confondus, tous modes), les éliminations par arme et les rounds par carte. Il faut que les « Détails des jeux » du
// profil soient publics.
// La lecture est gardée 1 h. Chaque lecture réussie ajoute un relevé du jour (un par jour, 400 jours au plus), pour
// les écarts sur 7 et 30 jours et une future courbe. La dernière réponse brute est gardée pour vérifier les vrais
// noms des champs (ils viennent de CS:GO et n'ont pas encore été vus sur une réponse de CS2).
// Le calcul est dans @shared/cs2Lifetime (testé sans Electron). Rien en mode démo.

const URL_BASE = 'https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2/'
const TIMEOUT_MS = 15_000
const FRESH_MS = 3600_000
/** Relevé automatique si le dernier a plus de 20 h (Player X ouvert sans passer par la page). */
const AUTO_AFTER_MS = 20 * 3600_000
/** Réponse brute gardée : bornée, au cas où Steam renverrait autre chose qu'attendu. */
const MAX_RAW = 256_000

const CACHE_KEY = 'cs2Lifetime'
const HISTORY_KEY = 'cs2LifetimeHistory'
const RAW_KEY = 'cs2LifetimeRaw'

const MESSAGES: Record<Cs2LifetimeReason, string> = {
  demo: 'Les stats à vie de Steam ne s’affichent pas en mode démo.',
  'no-account': 'Tes stats à vie viennent de ton profil Steam : connecte-le dans Paramètres › Comptes.',
  'no-key': 'Ajoute ta clé Steam dans Paramètres › Avancé : avec elle, Player X lit tes stats à vie.',
  'key-refused': 'Vérifie ta clé Steam Web API dans Paramètres › Avancé, puis réessaie.',
  private: 'Rends « Détails des jeux » public dans la confidentialité de ton profil Steam, puis réessaie.',
  none: 'Steam n’a aucune stat Counter-Strike pour ton compte.',
  network: 'Connexion à Steam impossible : vérifie ta connexion internet.',
  error: 'Steam ne répond pas pour le moment. Réessaie dans quelques minutes.'
}
/** Erreur 500 : panne passagère, ou profil privé (Steam ne le dit pas toujours clairement). */
const ERROR_500 = 'Steam n’a pas renvoyé tes stats. Si ton profil cache « Détails des jeux », rends-le public ; sinon réessaie dans quelques minutes.'

interface Cache {
  steamId: string
  fetchedAt: number
  stats: Cs2Lifetime
}

type Fail = Extract<Cs2LifetimeResult, { ok: false }>

const fail = (reason: Cs2LifetimeReason, message = MESSAGES[reason]): Fail => ({ ok: false, reason, message })

const steamId = (): string | undefined => getAccounts().find((a) => a.platform === 'steam')?.id

// ---------- relevés ----------

function history(id: string): Cs2LifetimePoint[] {
  return cleanHistory(getKv<Record<string, unknown>>(HISTORY_KEY, {})[id])
}

function record(id: string, stats: Cs2Lifetime, at: number): Cs2LifetimePoint[] {
  const all = getKv<Record<string, unknown>>(HISTORY_KEY, {})
  const list = addPoint(cleanHistory(all[id]), pointOf(stats, at))
  setKv(HISTORY_KEY, { ...all, [id]: list })
  return list
}

// ---------- lecture de Steam ----------

let inflight: { who: string; run: Promise<Cs2LifetimeResult> } | null = null

async function fetchLifetime(id: string, key: string, cached: Cache | null): Promise<Cs2LifetimeResult> {
  const url = `${URL_BASE}?appid=${CS2_APPID}&key=${encodeURIComponent(key)}&steamid=${id}`
  let status: number
  let text: string
  try {
    const res = await net.fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    status = res.status
    text = await res.text()
  } catch {
    // Hors ligne : la dernière lecture vaut mieux que rien, en le disant.
    return cached ? { ok: true, stats: cached.stats, fetchedAt: cached.fetchedAt, history: history(id), stale: MESSAGES.network } : fail('network')
  }
  // Réponse brute, sans la clé : pour vérifier plus tard les vrais noms des champs.
  setKv(RAW_KEY, { at: Date.now(), status, body: text.slice(0, MAX_RAW) })

  const read = readUserStats(status, text)
  if (read.kind === 'private') return fail('private')
  if (read.kind === 'key') return fail('key-refused')
  if (read.kind === 'none') return fail('none')
  if (read.kind === 'error') {
    const message = read.status === 500 ? ERROR_500 : MESSAGES.error
    return cached ? { ok: true, stats: cached.stats, fetchedAt: cached.fetchedAt, history: history(id), stale: message } : fail('error', message)
  }
  const stats = lifetimeOf(read.values)
  const fetchedAt = Date.now()
  setKv(CACHE_KEY, { steamId: id, fetchedAt, stats } satisfies Cache)
  return { ok: true, stats, fetchedAt, history: record(id, stats, fetchedAt) }
}

/** Stats à vie : gardées 1 h, sauf `force` (« Réessayer », « Actualiser »). Une seule lecture à la fois. */
export async function getCs2Lifetime(force = false): Promise<Cs2LifetimeResult> {
  const sim = simMode()
  if (sim) return simulated(sim)
  if (getSettings().demoMode) return fail('demo')
  const id = steamId()
  if (!id) return fail('no-account')
  const key = getSettings().steamApiKey
  if (!key) return fail('no-key')

  const saved = getKv<Cache | null>(CACHE_KEY, null)
  const cached = saved && saved.steamId === id && saved.stats && typeof saved.fetchedAt === 'number' ? saved : null
  if (cached && !force && Date.now() - cached.fetchedAt < FRESH_MS) return { ok: true, stats: cached.stats, fetchedAt: cached.fetchedAt, history: history(id) }

  const who = `${id}:${key}`
  if (inflight?.who === who) return inflight.run
  const run = fetchLifetime(id, key, cached).finally(() => {
    if (inflight?.run === run) inflight = null
  })
  inflight = { who, run }
  return run
}

/** Au démarrage puis toutes les 6 h : un relevé, pour que les écarts avancent même sans ouvrir la page. */
export function startCs2LifetimeRecorder(): void {
  const run = (): void => {
    const s = getSettings()
    if (simMode() || s.demoMode || !s.steamApiKey) return
    const id = steamId()
    // Seulement pour un joueur de CS2 (le jeu est dans la bibliothèque de ce PC).
    if (!id || !listGames().some((g) => g.id === CS2_GAME_ID)) return
    const last = history(id).at(-1)
    if (last && Date.now() - last.at < AUTO_AFTER_MS) return
    getCs2Lifetime(true).catch(() => {})
  }
  setTimeout(run, 120_000)
  setInterval(run, 6 * 3600_000)
}

// ---------- développement (cs2LifetimeSim.ts) ----------

/**
 * PX_CS2_STATS_SIM=1 : la fixture au lieu de Steam (sans clé ni compte relié), avec 30 relevés fictifs.
 * PX_CS2_STATS_SIM=private | key | network : l'état d'erreur correspondant. Jamais dans la version installée.
 */
function simMode(): string | null {
  return !app.isPackaged && process.env.PX_CS2_STATS_SIM ? process.env.PX_CS2_STATS_SIM : null
}

async function simulated(mode: string): Promise<Cs2LifetimeResult> {
  if (mode === 'private') return fail('private')
  if (mode === 'key') return fail('key-refused')
  if (mode === 'network') return fail('network')
  const sim = await import('./cs2LifetimeSim')
  const read = readUserStats(200, sim.fixtureText())
  if (read.kind !== 'ok') return fail('error')
  const stats = lifetimeOf(read.values)
  const fetchedAt = Date.now()
  return { ok: true, stats, fetchedAt, history: sim.fixtureHistory(stats, fetchedAt), sample: true }
}
