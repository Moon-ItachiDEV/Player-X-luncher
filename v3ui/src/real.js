// Le pont vers le vrai moteur de Player X (window.launcher). Aucune donnée inventée : ce qui n'est pas connu reste vide.
// GAMES, FRIENDS, ROUTINES… gardent la forme que l'interface attend, et sont remplis ici depuis les vraies réponses.
const API = window.launcher
const Real = (() => {
  const T = Shared.text
  const STORE = { steam: 'Steam', epic: 'Epic', ea: 'EA', gog: 'GOG' }
  const listeners = {}
  const st = {
    raw: [], owned: [], library: null, settings: null, accounts: [], shelves: { collections: [], hidden: [] },
    updates: {}, cs2: null, servers: null, friendsRes: null, report: [], loaded: false
  }
  const on = (ev, fn) => { (listeners[ev] ??= []).push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn) } }
  const emit = (ev, data) => (listeners[ev] || []).forEach((f) => { try { f(data) } catch (e) { console.error(e) } })

  /* ---------- Couleurs et images ---------- */
  const hsl = (h, s, l) => {
    s /= 100; l /= 100
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0')
    return `#${f(0)}${f(8)}${f(4)}`
  }
  const palOf = (name) => { const h = T.hue(name); return [hsl(h, 55, 9), hsl(h, 60, 22), hsl((h + 24) % 360, 68, 46), hsl((h + 300) % 360, 40, 24)] }
  // Jaquette de remplacement quand Steam n'en donne aucune : le nom du jeu sur un fond à sa teinte
  function coverPh(name) {
    const h = T.hue(name), words = name.split(/\s+/), lines = []
    let cur = ''
    for (const w of words) { if ((cur + ' ' + w).trim().length > 14 && cur) { lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim() }
    if (cur) lines.push(cur)
    const safe = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(h, 50, 24)}"/><stop offset="1" stop-color="${hsl((h + 40) % 360, 45, 9)}"/></linearGradient></defs><rect width="600" height="900" fill="url(#g)"/><text x="48" y="${820 - (lines.length - 1) * 58}" font-family="Archivo,Arial,sans-serif" font-size="52" font-weight="700" fill="#f7f1f4">${lines.slice(0, 5).map((l, i) => `<tspan x="48" dy="${i ? 58 : 0}">${safe(l)}</tspan>`).join('')}</text></svg>`
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }
  // Une image distante qui ne charge pas ne laisse pas de trou : le nom du jeu sur sa teinte, ou rien
  document.addEventListener('error', (e) => {
    const im = e.target
    if (im?.tagName !== 'IMG' || im.dataset.fb === 'done') return
    im.dataset.fb = 'done'
    const name = im.closest('[data-name]')?.dataset.name || im.alt
    im.src = name ? coverPh(name) : BLANK
  }, true)

  /* ---------- Jeux ---------- */
  const shortOf = (name) => { if (name.length <= 14) return name; const head = name.split(/\s*:\s*/)[0], w = head.split(/\s+/); if (head.length <= 14) return head; for (let i = w.length - 1; i > 0; i--) { const x = w.slice(0, i).join(' '); if (x.length <= 14) return x } return w[0] }
  const updateOf = (r) => (r.store === 'steam' ? st.updates[r.storeId] : undefined)
  // Le bouton principal quand Steam a quelque chose à faire : il ouvre ses téléchargements, le jeu ne démarre pas
  function updateAction(u) {
    if (!u) return null
    if (Shared.steamUpdate.updateActive(u)) return { label: 'Voir dans Steam', title: 'Steam télécharge : ouvre ses téléchargements. Le jeu ne démarre pas.' }
    if (u.firstInstall) return { label: 'Installer', title: 'Ouvre les téléchargements de Steam pour reprendre le téléchargement. Le jeu ne démarre pas.' }
    return { label: 'Mettre à jour', title: 'Ouvre les téléchargements de Steam pour lancer la mise à jour. Le jeu ne démarre pas.' }
  }
  const updateText = (u) => Shared.steamUpdate.updateLabel(u).replace(' · ', ', ')
  function uiIdFor(r, usedBf6) {
    if (r.id === Shared.cs2.CS2_GAME_ID) return 'cs2'
    if (T.isBf6Name(r.name) && !usedBf6.v) { usedBf6.v = true; return 'bf6' }
    return r.id.replace(/[^a-zA-Z0-9]/g, '_')
  }
  function toUi(r, used, into) {
    const name = T.cleanName(r.name), u = updateOf(r)
    const g = into || {}
    Object.assign(g, {
      id: into?.id || uiIdFor(r, used), rid: r.id, raw: r, name, short: shortOf(name),
      cover: r.coverUrl || coverPh(name), hero: r.heroUrl || null, heroWide: r.heroUrl || null, logo: r.logoUrl || null,
      store: STORE[r.store] || r.store,
      time: r.playtime ? T.formatPlaytime(r.playtime) : '',
      last: r.running ? 'en cours' : r.lastPlayed ? T.timeAgo(r.lastPlayed) : '',
      runs: r.launches ? `lancé ${r.launches} fois` : '',
      installed: !r.notInstalled, fav: !!r.favorite, running: !!r.running, runningSince: r.runningSince || 0,
      hidden: st.shelves.hidden.includes(r.id),
      patch: !!r.newPatch, tag: r.newPatch ? 'Nouveau patch' : null, tagTone: r.newPatch ? 'lav' : null,
      needsUpdate: !!u, update: u || null, updateAction: updateAction(u), updateText: u ? updateText(u) : ''
    })
    if (!g.pal) g.pal = palOf(name)
    return g
  }
  function applyGames() {
    const prev = new Map(GAMES.map((g) => [g.rid, g]))
    const used = { v: [...prev.values()].some((g) => g.id === 'bf6') }
    const installed = [...st.raw].sort(Shared.pick.byRecent)
    const owned = [...st.owned].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || (b.playtime || 0) - (a.playtime || 0) || T.cleanName(a.name).localeCompare(T.cleanName(b.name), 'fr'))
    const next = [...installed, ...owned].map((r) => toUi(r, used, prev.get(r.id)))
    GAMES.splice(0, GAMES.length, ...next)
    for (const g of GAMES) { g.routine = routineFor(g); g.ready = readyOf(g) }
    applyServersTag()
    if (S.focus >= GAMES.length) S.focus = 0
  }
  // Une jaquette arrivée après coup (EA, Epic) remplace son repli partout où il est déjà affiché
  function swapPlaceholders() {
    const real = new Map(GAMES.filter((g) => g.raw?.coverUrl).map((g) => [coverPh(g.name), g.raw.coverUrl]))
    if (!real.size) return
    document.querySelectorAll('img[src^="data:image/svg+xml"]').forEach((im) => { const url = im.dataset.fb === 'done' ? null : real.get(im.getAttribute('src')); if (url) im.src = url })
  }
  async function loadGames(refresh = false) {
    const [list, lib] = await Promise.all([API.getGames(refresh), API.getSteamLibrary(false).catch(() => null)])
    st.raw = list || []; st.library = lib; st.owned = lib?.notInstalled || []
    applyGames(); swapPlaceholders(); emit('games')
    return GAMES
  }
  const byRid = (rid) => GAMES.find((g) => g.rid === rid)

  // Les lignes « prêt à jouer » de l'accueil : seulement ce qui est vrai maintenant
  function readyOf(g) {
    const out = []
    if (g.update) out.push({ ic: 'down', t: Shared.steamUpdate.updateSentence(g.update), go: 'steam' })
    if (!g.installed) return out
    // Le rappel Alt + C vit dans la pastille Enregistre ; ici, seulement l'état utile de CS2
    const rec = g.id === 'cs2' ? Real.clipsLine?.(g) : null; if (rec) out.push({ ic: 'x', t: rec, go: 'rec' })
    if (g.id === 'cs2' && st.cs2?.enabled) {
      const C = { ready: ['link', 'Match en direct relié'], restart: ['warn', 'Relance CS2 pour relier le match en direct'], blocked: ['warn', 'Windows bloque le lien avec CS2'], 'no-port': ['warn', 'Aucun port libre pour le match en direct'] }[st.cs2.config]
      if (C) out.push({ ic: C[0], t: C[1], go: 'general' })
    }
    // (Le meilleur loadout BF6 n'est plus rappelé ici : il est dans la fiche, onglet Loadouts.)
    if (st.friendsRes) {
      const players = Shared.around.playersOf(g.raw, st.friendsRes.friends)
      if (players.length) out.push({ t: Shared.around.playersLabel(players), friends: players.slice(0, 3).map((p) => p.name), go: 'friends' })
    }
    // Rien à signaler : pas de ligne « Prêt à lancer », le bouton Jouer le dit déjà
    return out.slice(0, 4)
  }
  function applyServersTag() {
    const c = G('cs2')
    if (!c || c.patch || !st.servers?.ok) return
    c.tag = Shared.servers.serversLabel(st.servers.servers); c.tagTone = Shared.servers.serversOk(st.servers.servers) ? 'ok' : 'warn'
  }

  /* ---------- Routines ---------- */
  const KIND = {
    app: { ic: 'folder', k: 'Appli', t: (s) => `Ouvrir ${s.name || 'une appli'}` },
    close: { ic: 'close', k: 'Appli', t: (s) => `Fermer ${s.name || s.value || 'une appli'}` },
    link: { ic: 'link', k: 'Lien', t: (s) => s.name || 'Ouvrir un lien' },
    wait: { ic: 'refresh', k: 'Attente', t: (s) => `Attendre ${s.value} secondes` },
    minimize: { ic: 'min', k: 'Player X', t: () => 'Réduire Player X' },
    game: { ic: 'play', k: 'Jeu', t: (_s, g) => `Lancer ${g?.name || 'le jeu'}` }
  }
  const stepUi = (s, g) => { const d = KIND[s.kind]; return { ...s, ic: d.ic, k: d.k, t: d.t(s, g), sim: d.t(s, g), fixed: s.kind === 'game' } }
  function loadRoutines(list) {
    Object.keys(ROUTINES).forEach((k) => delete ROUTINES[k])
    for (const r of list || []) {
      const g = byRid(r.gameId)
      ROUTINES[r.id] = { id: r.id, name: r.name, rid: r.gameId, game: g?.id || null, trigger: r.trigger, steps: r.steps.map((s) => stepUi(s, g)) }
    }
  }
  // Celle qui part avec Jouer : la dernière créée pour ce jeu, si elle se lance avec lui
  const routineFor = (g) => Object.values(ROUTINES).filter((r) => r.rid === g.rid && r.trigger === 'launch').pop()?.id || null
  let saveT = 0
  async function saveRoutinesNow() {
    const list = Object.values(ROUTINES).map((r) => ({ id: r.id, name: r.name, gameId: r.rid, trigger: r.trigger, steps: r.steps.map((s) => ({ id: s.id, kind: s.kind, value: s.value, name: s.name, on: s.on, force: s.force })) }))
    const saved = await API.saveRoutines(list)
    // Le moteur refuse une appli qui ne vient pas du sélecteur, ou un lien steam:// ou discord:// avec des arguments :
    // la liste affichée reprend alors ce qui est vraiment enregistré, et on le dit.
    const steps = (l) => (l || []).map((r) => r.steps.length).join(',')
    if (steps(saved) !== steps(list)) {
      loadRoutines(saved)
      toast('Une étape n’a pas été gardée : choisis l’appli avec « Ouvrir une appli », ou colle un lien sans arguments de lancement.', { tone: 'warn', ms: 4000 })
    }
    applyGames(); emit('games')
  }
  const saveRoutines = () => { clearTimeout(saveT); saveT = setTimeout(saveRoutinesNow, 200) }

  /* ---------- Démarrage ---------- */
  async function init() {
    const safe = (p, fb) => Promise.resolve(p).catch((e) => { console.error(e); return fb })
    ;[st.settings, st.accounts, st.shelves, st.updates, st.cs2] = await Promise.all([
      safe(API.getSettings(), {}), safe(API.getAccounts(), []), safe(API.getShelves(), { collections: [], hidden: [] }), safe(API.getSteamUpdates(), {}), safe(API.cs2State(), null)
    ])
    const routines = await safe(API.getRoutines(), [])
    await loadGames(false)
    loadRoutines(routines)
    applyGames()
    st.report = await safe(API.getScanReport(), [])
    st.loaded = true
    // Les changements venus du moteur
    let gT = 0
    API.onGamesChanged(() => { clearTimeout(gT); gT = setTimeout(() => loadGames(false).catch(console.error), 200) })
    API.onSteamUpdates((u) => { st.updates = u; applyGames(); emit('games') })
    API.onCs2State(async () => { st.cs2 = await safe(API.cs2State(), st.cs2); applyGames(); emit('cs2') })
    API.onGameReady((e) => { const g = byRid(e.gameId); toast(`${ic('check')} ${esc(g?.name || e.name)} est prêt`, { ms: 8000, action: g ? { label: 'Jouer', fn: () => { go('play'); setTimeout(() => { Play.focusGame(g.id); setTimeout(() => Live.launch(g.id), 200) }, 340) } } : undefined }) })
    API.onFriendAlert((alerts) => { for (const a of alerts.slice(0, 2)) toast(`${esc(a.friend.name)} ${a.kind === 'in-game' ? `joue à ${esc(a.friend.game || '')}` : 'est en ligne'}`, { ms: 3500 }) })
    API.onRareAchievements((list) => { for (const a of list.slice(0, 2)) toast(`${ic('trophy')} Succès rare : ${esc(a.name)}, ${esc(a.gameName)}`, { ms: 5000 }) })
    API.onEventStarted((e) => toast(`${ic('bolt')} ${esc(e.title)} commence sur ${esc(e.gameName)}`, { ms: 8000, action: { label: 'Voir sur Steam', fn: () => API.openExternal(e.url) } }))
    API.onShowFriends(() => go('friends'))
    // Serveurs CS2 : au démarrage puis toutes les 5 min, seulement si la clé Steam est là
    const servers = async () => { st.servers = await safe(API.cs2Servers(false), st.servers); applyServersTag(); if (st.servers?.ok) emit('games') }
    // CS2 présent au démarrage ou installé en cours de route : l'état de ses serveurs est relu toutes les 5 min dès qu'il est là
    let polling = false
    const pollServers = () => { if (polling || !G('cs2')) return; polling = true; servers(); setInterval(servers, 300000) }
    pollServers(); on('games', pollServers)
  }
  async function saveSettings(patch) {
    st.settings = await API.saveSettings(patch)
    emit('settings')
    return st.settings
  }
  async function loadSettingsOnly() { st.settings = await API.getSettings(); emit('settings') }
  async function refreshAccounts() { st.accounts = await API.getAccounts(); emit('accounts'); return st.accounts }
  async function refreshShelves() { st.shelves = await API.getShelves(); applyGames(); emit('shelves'); return st.shelves }
  async function scan() { await loadGames(true); st.report = await API.getScanReport(); return GAMES }
  async function favorite(g) { st.raw = await API.toggleFavorite(g.rid); applyGames(); emit('games'); return G(g.id)?.fav }
  const openSteamDownloads = () => API.openSteamDownloads()

  return { st, on, emit, init, loadGames, applyGames, byRid, coverPh, palOf, saveRoutines, saveRoutinesNow, stepUi, saveSettings, loadSettingsOnly, refreshAccounts, refreshShelves, scan, favorite, openSteamDownloads }
})()
