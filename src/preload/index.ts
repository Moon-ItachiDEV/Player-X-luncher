import { contextBridge, ipcRenderer } from 'electron'
import type { LaunchStatus } from '@shared/launch'
import type { RoutineStatus } from '@shared/routines'
import type {
  Bf6RecapEvent,
  ClipsState,
  Cs2Live,
  Cs2OverlayConfig,
  Cs2RecapEvent,
  EditEngineStep,
  CaptureTestStep,
  FilmState,
  FriendAlert,
  GameEventStarted,
  GameReady,
  LauncherApi,
  RareUnlock,
  SteamUpdates,
} from '@shared/types'

declare const __APP_VERSION__: string

const api: LauncherApi = {
  getGames: (refresh) => ipcRenderer.invoke('games:list', refresh),
  launchGame: (id, opts) => ipcRenderer.invoke('games:launch', id, opts),
  cancelLaunch: (launchId) => ipcRenderer.invoke('launch:cancel', launchId),
  listLaunches: () => ipcRenderer.invoke('launch:list'),
  onLaunchStatus: (cb) => {
    const listener = (_e: unknown, s: LaunchStatus): void => cb(s)
    ipcRenderer.on('launch:status', listener)
    return () => ipcRenderer.removeListener('launch:status', listener)
  },
  toggleFavorite: (id) => ipcRenderer.invoke('games:favorite', id),
  setFavorites: (ids) => ipcRenderer.invoke('games:set-favorites', ids),
  getScanReport: () => ipcRenderer.invoke('games:report'),
  onGamesChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('games:changed', listener)
    return () => ipcRenderer.removeListener('games:changed', listener)
  },
  getFriends: () => ipcRenderer.invoke('friends:list'),
  getFriendProfile: (id) => ipcRenderer.invoke('friends:profile', id),
  playerXConnections: () => ipcRenderer.invoke('accounts:playerx'),
  importPlayerXConnections: () => ipcRenderer.invoke('accounts:import-playerx'),
  friendSteam: (action, id) => ipcRenderer.invoke('friends:steam', action, id),
  setMemberHidden: (name, hidden) => ipcRenderer.invoke('friends:hide-member', name, hidden),
  getAccounts: () => ipcRenderer.invoke('accounts:list'),
  login: (platform) => ipcRenderer.invoke('accounts:login', platform),
  connectPsn: () => ipcRenderer.invoke('accounts:psn'),
  logout: (platform) => ipcRenderer.invoke('accounts:logout', platform),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  openGameFolder: (id) => ipcRenderer.invoke('games:open-folder', id),
  cancelLogin: () => ipcRenderer.invoke('accounts:cancel'),
  bf6Search: (name) => ipcRenderer.invoke('bf6:search', name),
  bf6Stats: (account, refresh) => ipcRenderer.invoke('bf6:stats', account, refresh),
  bf6Art: () => ipcRenderer.invoke('bf6:art'),
  bf6GetTracked: () => ipcRenderer.invoke('bf6:tracked'),
  bf6PlayerX: () => ipcRenderer.invoke('bf6:playerx'),
  bf6ImportPlayerX: () => ipcRenderer.invoke('bf6:import-playerx'),
  bf6SetTracked: (tracked) => ipcRenderer.invoke('bf6:set-tracked', tracked),
  bf6History: (account) => ipcRenderer.invoke('bf6:history', account),
  bf6Recaps: () => ipcRenderer.invoke('bf6:recaps'),
  bf6RecapSeen: (id) => ipcRenderer.invoke('bf6:recap-seen', id),
  onBf6Recap: (cb) => {
    const listener = (_e: unknown, e: Bf6RecapEvent): void => cb(e)
    ipcRenderer.on('bf6:recap', listener)
    return () => ipcRenderer.removeListener('bf6:recap', listener)
  },
  cs2State: () => ipcRenderer.invoke('cs2:state'),
  cs2RecapSeen: (id) => ipcRenderer.invoke('cs2:recap-seen', id),
  cs2Lifetime: (force) => ipcRenderer.invoke('cs2:lifetime', force === true),
  onCs2Live: (cb) => {
    const listener = (_e: unknown, live: Cs2Live | null): void => cb(live)
    ipcRenderer.on('cs2:live', listener)
    return () => ipcRenderer.removeListener('cs2:live', listener)
  },
  onCs2State: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('cs2:state', listener)
    return () => ipcRenderer.removeListener('cs2:state', listener)
  },
  onCs2Recap: (cb) => {
    const listener = (_e: unknown, e: Cs2RecapEvent): void => cb(e)
    ipcRenderer.on('cs2:recap', listener)
    return () => ipcRenderer.removeListener('cs2:recap', listener)
  },
  cs2OverlayConfig: () => ipcRenderer.invoke('cs2:overlay-config'),
  cs2OverlayPreview: () => ipcRenderer.invoke('cs2:overlay-preview'),
  cs2OverlayHotkeyCheck: (accel: string) => ipcRenderer.invoke('cs2:overlay-hotkey-check', accel),
  cs2OverlayReady: () => ipcRenderer.invoke('cs2:overlay-ready'),
  onCs2OverlayConfig: (cb) => {
    const listener = (_e: unknown, c: Cs2OverlayConfig): void => cb(c)
    ipcRenderer.on('cs2:overlay-config', listener)
    return () => ipcRenderer.removeListener('cs2:overlay-config', listener)
  },
  onFriendAlert: (cb) => {
    const listener = (_e: unknown, alerts: FriendAlert[]): void => cb(alerts)
    ipcRenderer.on('friends:alert', listener)
    return () => ipcRenderer.removeListener('friends:alert', listener)
  },
  onRareAchievements: (cb) => {
    const listener = (_e: unknown, list: RareUnlock[]): void => cb(list)
    ipcRenderer.on('achievements:rare', listener)
    return () => ipcRenderer.removeListener('achievements:rare', listener)
  },
  onShowFriends: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('friends:show', listener)
    return () => ipcRenderer.removeListener('friends:show', listener)
  },
  testFriendAlert: () => ipcRenderer.invoke('friends:test-alert'),
  getGameNews: (id, refresh) => ipcRenderer.invoke('news:game', id, refresh),
  markNewsSeen: (id, upTo) => ipcRenderer.invoke('news:seen', id, upTo),
  getSteamLibrary: (refresh) => ipcRenderer.invoke('steam:library', refresh),
  installGame: (id) => ipcRenderer.invoke('steam:install', id),
  getAchievements: (id, refresh) => ipcRenderer.invoke('achievements:game', id, refresh),
  getStartupState: () => ipcRenderer.invoke('app:startup'),
  getSteamUpdates: () => ipcRenderer.invoke('steam:updates'),
  onSteamUpdates: (cb) => {
    const listener = (_e: unknown, u: SteamUpdates): void => cb(u)
    ipcRenderer.on('steam:updates', listener)
    return () => ipcRenderer.removeListener('steam:updates', listener)
  },
  onGameReady: (cb) => {
    const listener = (_e: unknown, e: GameReady): void => cb(e)
    ipcRenderer.on('games:ready', listener)
    return () => ipcRenderer.removeListener('games:ready', listener)
  },
  openSteamDownloads: () => ipcRenderer.invoke('steam:open-downloads'),
  openDiscordChannel: (channelId) => ipcRenderer.invoke('discord:open-channel', channelId),
  cs2Servers: (force) => ipcRenderer.invoke('servers:cs2', force === true),
  steamPlayers: (gameId) => ipcRenderer.invoke('servers:players', gameId),
  getGameEvents: (gameId) => ipcRenderer.invoke('events:game', gameId),
  setEventReminder: (gameId, eventId, on) => ipcRenderer.invoke('events:remind', gameId, eventId, on),
  onEventStarted: (cb) => {
    const listener = (_e: unknown, e: GameEventStarted): void => cb(e)
    ipcRenderer.on('events:started', listener)
    return () => ipcRenderer.removeListener('events:started', listener)
  },
  getShelves: () => ipcRenderer.invoke('shelves:get'),
  createCollection: (name, gameId) => ipcRenderer.invoke('shelves:create', name, gameId),
  renameCollection: (id, name) => ipcRenderer.invoke('shelves:rename', id, name),
  deleteCollection: (id) => ipcRenderer.invoke('shelves:delete', id),
  setInCollection: (id, gameId, on) => ipcRenderer.invoke('shelves:toggle', id, gameId, on),
  setGameHidden: (gameId, hidden) => ipcRenderer.invoke('shelves:hide', gameId, hidden),
  getRoutines: () => ipcRenderer.invoke('routines:get'),
  saveRoutines: (list) => ipcRenderer.invoke('routines:save', list),
  chooseRoutineApp: () => ipcRenderer.invoke('routines:choose-app'),
  runRoutine: (id, launchId) => ipcRenderer.invoke('routines:run', id, launchId),
  routineHotkeys: () => ipcRenderer.invoke('routines:hotkeys'),
  onRoutineStatus: (cb) => {
    const listener = (_e: unknown, s: RoutineStatus): void => cb(s)
    ipcRenderer.on('routines:status', listener)
    return () => ipcRenderer.removeListener('routines:status', listener)
  },
  getBf6Loadouts: () => ipcRenderer.invoke('loadouts:get'),
  saveBf6Loadout: (loadout) => ipcRenderer.invoke('loadouts:save', loadout),
  deleteBf6Loadout: (id) => ipcRenderer.invoke('loadouts:delete', id),
  saveBf6Loadouts: (list) => ipcRenderer.invoke('loadouts:save-many', list),
  getMyBf6Weapons: () => ipcRenderer.invoke('loadouts:weapons'),
  copyAreaImage: (rect) => ipcRenderer.invoke('window:copy-area', rect),
  clipsList: () => ipcRenderer.invoke('clips:list'),
  clipsDelete: (id) => ipcRenderer.invoke('clips:delete', id),
  clipsRename: (id, name) => ipcRenderer.invoke('clips:rename', id, name),
  clipsPin: (id, on) => ipcRenderer.invoke('clips:pin', id, on),
  clipsOpenFolder: (id) => ipcRenderer.invoke('clips:open-folder', id),
  clipsCopyFile: (id) => ipcRenderer.invoke('clips:copy-file', id),
  clipsTrim: (id, startS, endS) => ipcRenderer.invoke('clips:trim', id, startS, endS),
  clipsState: () => ipcRenderer.invoke('clips:state'),
  clipsGetSettings: () => ipcRenderer.invoke('clips:settings-get'),
  clipsSaveSettings: (patch) => ipcRenderer.invoke('clips:settings-save', patch),
  clipsChooseFolder: () => ipcRenderer.invoke('clips:choose-folder'),
  clipsDisplays: () => ipcRenderer.invoke('clips:displays'),
  clipsLogTail: () => ipcRenderer.invoke('clips:log-tail'),
  onClipsChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('clips:changed', listener)
    return () => ipcRenderer.removeListener('clips:changed', listener)
  },
  onClipsState: (cb) => {
    const listener = (_e: unknown, s: ClipsState): void => cb(s)
    ipcRenderer.on('clips:state', listener)
    return () => ipcRenderer.removeListener('clips:state', listener)
  },
  editEngine: () => ipcRenderer.invoke('edit:engine'),
  editEngineTest: () => ipcRenderer.invoke('edit:engine-test'),
  editEngineStop: () => ipcRenderer.invoke('edit:engine-stop'),
  editEngineFolder: () => ipcRenderer.invoke('edit:engine-folder'),
  onEditEngineStep: (cb) => {
    const listener = (_e: unknown, s: EditEngineStep): void => cb(s)
    ipcRenderer.on('edit:engine-step', listener)
    return () => ipcRenderer.removeListener('edit:engine-step', listener)
  },
  editFilmStart: (clipIds) => ipcRenderer.invoke('edit:film-start', clipIds),
  editMusicList: () => ipcRenderer.invoke('edit:music-list'),
  editMusicPick: () => ipcRenderer.invoke('edit:music-pick'),
  editMusicForget: (id) => ipcRenderer.invoke('edit:music-forget', id),
  editPlan: (clipIds, musicId) => ipcRenderer.invoke('edit:plan', clipIds, musicId),
  editCaptureTest: () => ipcRenderer.invoke('edit:capture-test'),
  onEditCaptureStep: (cb) => {
    const listener = (_e: unknown, s: CaptureTestStep): void => cb(s)
    ipcRenderer.on('edit:capture-step', listener)
    return () => ipcRenderer.removeListener('edit:capture-step', listener)
  },
  editFilmState: () => ipcRenderer.invoke('edit:film-state'),
  editFilmStop: () => ipcRenderer.invoke('edit:film-stop'),
  onEditFilm: (cb) => {
    const listener = (_e: unknown, s: FilmState): void => cb(s)
    ipcRenderer.on('edit:film', listener)
    return () => ipcRenderer.removeListener('edit:film', listener)
  },
  platform: process.platform,
  version: __APP_VERSION__
}

contextBridge.exposeInMainWorld('launcher', api)
