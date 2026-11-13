import { app, nativeImage, net, Notification } from 'electron'
import { join } from 'node:path'
import type { Friend, FriendAlert, FriendAlertMode, FriendPlatform, FriendsResult, GameReady, RareUnlock } from '@shared/types'
import { getSettings } from './settings'
import { focusedAppWindow, mainWindow, sendTo, showMainAndSend } from '../windows'

// Alertes d'amis : on compare chaque nouvelle liste d'amis à la précédente. Seuls Steam et PlayStation comptent
// (sur Discord, ce sont les membres d'un serveur, pas des amis). Fenêtre au premier plan : carte dans Player X ;
// sinon notification Windows (Windows les retient pendant une partie en plein écran).

const PLATFORMS: FriendPlatform[] = ['steam', 'psn']
/** Pas deux alertes du même genre pour le même ami en moins de 10 minutes (connexions qui clignotent). */
const COOLDOWN_MS = 10 * 60_000
/** Au-delà, une seule notification Windows résume le lot. */
const MAX_NATIVE = 3

/** Dernier état connu par plateforme. Absent = pas encore de référence, donc pas d'alerte. */
const known = new Map<FriendPlatform, Map<string, Friend>>()
const lastAlert = new Map<string, number>()

const isOn = (f: Friend | undefined): boolean => !!f && f.status !== 'offline'

function diffFriends(prev: Map<string, Friend> | undefined, next: Friend[], mode: FriendAlertMode, now: number, watch: ReadonlySet<string> = new Set()): FriendAlert[] {
  if (!prev || (mode === 'off' && !watch.size)) return []
  const out: FriendAlert[] = []
  for (const f of next) {
    const before = prev.get(f.id)
    let kind: FriendAlert['kind'] | null = null
    // Coupé, sauf pour les amis surveillés (« Préviens-moi quand il lance un jeu ») : eux, seulement quand ils lancent un jeu.
    const watched = watch.has(f.id)
    if (mode === 'off' && !watched) continue
    // Nouveau jeu, ou passage en jeu.
    if (f.status === 'in-game' && f.game && (before?.status !== 'in-game' || before.game !== f.game)) kind = 'in-game'
    else if (mode === 'all' && isOn(f) && !isOn(before)) kind = 'online'
    if (!kind) continue
    const key = `${f.id}:${kind}:${kind === 'in-game' ? f.game : ''}`
    if (now - (lastAlert.get(key) ?? 0) < COOLDOWN_MS) continue
    lastAlert.set(key, now)
    out.push({ key: `${key}:${now}`, friend: f, kind, at: now })
  }
  return out
}

/** À appeler avec chaque liste d'amis fraîche. */
export function checkFriends(result: FriendsResult): void {
  const now = Date.now()
  const mode = getSettings().friendAlerts
  const alerts: FriendAlert[] = []
  for (const p of PLATFORMS) {
    // Plateforme pas interrogée (aucun compte relié) : pas de référence. Sinon, en reliant le compte plus tard,
    // tous les amis déjà en ligne déclencheraient « est en ligne ».
    if (!result.queried?.includes(p)) {
      known.delete(p)
      continue
    }
    // Plateforme en erreur : on garde l'ancienne référence, sinon tout le monde « se reconnecterait » au retour.
    if (result.errors[p]) continue
    const prev = known.get(p)
    // Présence illisible : on garde l'état connu, pour ne pas croire à une déconnexion puis une reconnexion.
    const list = result.friends.filter((f) => f.platform === p).map((f) => (f.presenceUnknown ? (prev?.get(f.id) ?? f) : f))
    alerts.push(
      ...diffFriends(
        prev,
        list.filter((f) => !f.presenceUnknown),
        mode,
        now,
        new Set(getSettings().friendWatch ?? [])
      )
    )
    known.set(p, new Map(list.map((f) => [f.id, f])))
  }
  if (alerts.length) void deliver(alerts)
}

/** Repart de zéro (compte relié ou déconnecté, bascule du mode démo). */
export function resetFriendAlerts(platform?: FriendPlatform): void {
  if (platform) known.delete(platform)
  else known.clear()
}

/** Notifications affichées : gardées tant qu'elles vivent, sinon le clic est perdu si l'objet est collecté. */
const live = new Set<Notification>()

function show(n: Notification): void {
  live.add(n)
  const drop = (): boolean => live.delete(n)
  n.on('click', () => {
    drop()
    showWindow()
  })
  n.on('close', drop)
  n.on('failed', drop)
  n.show()
}

function alertText(a: FriendAlert): string {
  return a.kind === 'in-game' ? `${a.friend.name} a lancé ${a.friend.game}` : `${a.friend.name} est en ligne`
}

async function avatarImage(url: string | undefined): Promise<Electron.NativeImage | undefined> {
  if (!url?.startsWith('https://')) return undefined
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(3_000) })
    if (!res.ok) return undefined
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
    return img.isEmpty() ? undefined : img
  } catch {
    return undefined
  }
}

const appIcon = (): string => join(app.getAppPath(), 'resources', 'icon.png')

function showWindow(): void {
  const win = mainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  sendTo(win, 'friends:show')
}

async function native(alerts: FriendAlert[]): Promise<void> {
  if (!Notification.isSupported()) return
  const shown = alerts.length > MAX_NATIVE ? [] : alerts
  for (const a of shown) {
    const n = new Notification({
      title: alertText(a),
      body: a.kind === 'in-game' ? 'Rejoins la partie depuis ton launcher.' : 'Dis-lui bonjour !',
      icon: (await avatarImage(a.friend.avatarUrl)) ?? appIcon(),
      silent: false
    })
    show(n)
  }
  if (!shown.length) {
    const names = alerts.slice(0, 2).map((a) => a.friend.name)
    const n = new Notification({
      title: `${names.join(', ')} et ${alerts.length - 2} autres sont actifs`,
      body: 'Ouvre Player X pour voir qui joue à quoi.',
      icon: appIcon()
    })
    show(n)
  }
}

async function deliver(alerts: FriendAlert[], forceNative = false): Promise<void> {
  const win = focusedAppWindow()
  if (win) sendTo(win, 'friends:alert', alerts)
  if (!win || forceNative) await native(alerts)
}

/** Paramètres › Interface › « Tester » : montre les deux formes d'alerte. */
export async function testFriendAlert(friends: Friend[]): Promise<void> {
  const pick = friends.find((f) => f.platform !== 'discord' && f.status === 'in-game') ?? friends.find((f) => f.platform !== 'discord')
  const friend: Friend = pick ?? { id: 'test:1', platform: 'steam', name: 'Player X', status: 'in-game', game: 'ton jeu préféré' }
  const at = Date.now()
  await deliver(
    [{ key: `test:${at}`, friend: { ...friend, status: 'in-game', game: friend.game ?? 'ton jeu préféré' }, kind: 'in-game', at, sample: true }],
    true
  )
}

/** Mode démo : une alerte fictive peu après l'arrivée, pour voir à quoi ça ressemble. */
let demoShown = false
export function demoFriendAlert(friends: Friend[]): void {
  if (demoShown) return
  demoShown = true
  const friend = friends.find((f) => f.status === 'online' && f.platform !== 'discord')
  if (!friend) return
  setTimeout(() => {
    if (!getSettings().demoMode || getSettings().friendAlerts === 'off') return
    const at = Date.now()
    void deliver([{ key: `demo:${at}`, friend: { ...friend, status: 'in-game', game: 'Hades' }, kind: 'in-game', at, sample: true }])
  }, 20_000)
}

// ---------- jeu prêt après une mise à jour (Prêt à jouer) ----------

/** Steam a fini : carte dans Player X au premier plan (avec « Jouer »), sinon notification Windows. */
export function deliverReady(e: GameReady): void {
  const win = focusedAppWindow()
  if (win) {
    sendTo(win, 'games:ready', e)
    return
  }
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: `${e.name} est prêt`,
    body: e.firstInstall ? 'Steam a fini de le télécharger. Clique pour ouvrir Player X.' : 'Steam a fini la mise à jour. Clique pour ouvrir Player X.',
    icon: appIcon()
  })
  live.add(n)
  const drop = (): boolean => live.delete(n)
  n.on('click', () => {
    drop()
    showMainAndSend('games:ready', e)
  })
  n.on('close', drop)
  n.on('failed', drop)
  n.show()
}

// ---------- succès rares ----------

/** « 3,2 % » : une décimale sous 10 %, comme dans l'interface. */
const pct = (p: number): string => `${(p < 10 ? Math.round(p * 10) / 10 : Math.round(p)).toString().replace('.', ',')} %`

/** Succès rares débloqués : carte dorée dans Player X au premier plan, sinon notification Windows. */
export function deliverRare(list: RareUnlock[]): void {
  const win = focusedAppWindow()
  if (win) {
    sendTo(win, 'achievements:rare', list)
    return
  }
  if (!Notification.isSupported()) return
  const top = list[0]
  const n = new Notification({
    title: list.length > 1 ? `${list.length} succès rares débloqués` : 'Succès rare débloqué',
    body: list.length > 1 ? list.map((a) => `${a.name} (${pct(a.percent)})`).join(', ') : `${top.name} · ${top.gameName} · ${pct(top.percent)} des joueurs`,
    icon: appIcon()
  })
  live.add(n)
  const drop = (): boolean => live.delete(n)
  n.on('click', () => {
    drop()
    showMainAndSend('achievements:rare', list)
  })
  n.on('close', drop)
  n.on('failed', drop)
  n.show()
}
