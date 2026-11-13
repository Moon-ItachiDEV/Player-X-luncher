// Le lancement réel : la routine défile sur la ligne, le moteur de Player X suit le jeu, et la barre reste la seule commande.
const Live = (() => {
  const COPY = Shared.launchCopy
  let timer = 0, liveData = null, routineSteps = null
  // Les lancements suivis ici : la fin d'un jeu fermé aussitôt arrive parfois après le dernier relevé
  const mine = new Set()

  function ticking(on) {
    clearInterval(timer); timer = 0
    if (!on) return
    timer = setInterval(paintTime, 1000); paintTime()
  }
  function paintTime() {
    const s = S.session; if (!s) return ticking(false)
    if (s.phase === 'game' && s.since) Bar.time(fmtHms((Date.now() - s.since) / 1000))
    else if (s.phase === 'launch' && s.status) Bar.time(COPY.elapsedLabel(s.status, Date.now(), 0) || '')
  }
  const fmtHms = (sec) => { sec = Math.max(0, sec | 0); const h = sec / 3600 | 0, m = (sec % 3600) / 60 | 0; return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` }

  function mount() {
    API.onLaunchStatus(onStatus)
    API.onRoutineStatus(onRoutine)
    // Un match vu par le jeu lui-même : la barre le suit, même si le relevé des programmes n'a pas encore vu CS2
    API.onCs2Live((live) => {
      liveData = live
      const c = G('cs2')
      if (live && c && (!S.session || (S.session.phase === 'game' && S.session.game !== 'cs2'))) enterGame(c, live.startedAt, null)
      else if (!live && S.session?.game === 'cs2' && !c?.running) return endUi()
      paintGame()
    })
    Real.on('games', syncRunning)
    API.listLaunches().then((list) => (list || []).forEach(onStatus)).catch(() => {})
    syncRunning()
  }

  function startLaunchUi(g, steps, routineName, launchId) {
    Sched.clear('live')
    S.session = { game: g.id, phase: 'launch', launchId, status: null }
    mine.add(launchId)
    Bar.setCover(g.id); Bar.setMode('launch')
    Bar.marks(Bar.nodes(steps, 0)); Bar.fill(0)
    Bar.text(g.name, esc(steps[0]?.t || `Lancement de ${g.name}`)); Bar.time('')
    Play.launchFx(true, steps, routineName); Fluid.dim(.72)
    routineSteps = steps
    Play.paintCta()
    ticking(true)
  }
  function launch(id, opts = {}) {
    const g = G(id); if (!g) return
    if (S.session?.phase === 'launch') return
    if (g.running && !opts.force) return toast(`${esc(g.name)} tourne déjà.`, { ms: 2200 })
    const r = opts.routine ? ROUTINES[opts.routine] : g.routine && !opts.via ? ROUTINES[g.routine] : null
    const steps = r ? r.steps.filter((x) => x.on) : [{ t: `Lancer ${g.name}`, ic: 'play' }]
    const launchId = `v3-${Date.now().toString(36)}`
    startLaunchUi(g, steps, r?.name, launchId)
    if (r) API.runRoutine(r.id, launchId).then((ok) => { if (!ok) { toast('Une routine tourne déjà : attends qu’elle finisse.', { ms: 3000 }); endUi() } }).catch(() => endUi())
    else API.launchGame(g.rid, { launchId, via: opts.via || 'play', ...(opts.force ? { force: true } : {}) }).catch(() => { endUi(); toast('Le lancement n’a pas pu partir. Réessaie.', { tone: 'warn', ms: 4000 }) })
  }
  function onRoutine(st) {
    const s = S.session
    if (!s || s.launchId !== st.launchId) return
    const nodes = $$('#bMarks .ln-node')
    nodes.forEach((n, j) => { n.classList.toggle('done', j < st.index); n.classList.toggle('cur', j === st.index) })
    Bar.fill(st.total > 1 ? Math.min(1, st.index / (st.total - 1)) : 1)
    Play.launchStep(st.index)
    const g = G(s.game)
    if (st.state !== 'done') Bar.text(g?.name || '', esc(st.text))
    if (st.state === 'fail') toast(esc(st.text), { tone: 'warn', ms: 3000 })
    // Routine finie sans que le jeu ait répondu : l'interface ne reste pas bloquée sur le lancement
    if (st.state === 'done') setTimeout(() => { const n = S.session; if (n?.launchId === st.launchId && n.phase === 'launch' && !n.status) endUi() }, 1500)
  }
  function onStatus(st) {
    const g = Real.byRid(st.gameId); if (!g) return
    const s = S.session
    const ours = mine.has(st.launchId) || (s && s.game === g.id)
    if (['sending', 'waiting', 'relay'].includes(st.phase)) {
      // Lancé ailleurs (menu près de l'horloge, liste de raccourcis) : la barre le suit aussi
      if (!s) startLaunchUi(g, [{ t: `Lancer ${g.name}`, ic: 'play' }], null, st.launchId)
      if (S.session?.game === g.id) {
        S.session.status = st; S.session.launchId = st.launchId; mine.add(st.launchId)
        const c = COPY.cardCopy(st, { name: g.name, now: Date.now() })
        Bar.text(g.name, esc(c.sub || c.kicker))
      }
      return
    }
    if (st.phase === 'running' || (st.phase === 'already' && ours)) return enterGame(g, st.detectedAt || st.runningSince || st.clickAt, st.launchId)
    if (st.phase === 'ended') { if (s?.game === g.id) endUi(); return }
    if (!ours) return
    // Fin sans jeu : l'interface revient au repos, et dit pourquoi avec les mots de Player X
    endUi()
    if (st.silent) return
    const c = COPY.cardCopy(st, { name: g.name, now: Date.now() })
    const act = c.action
    toast(`${esc(c.kicker)} : ${esc(c.sub)}`, {
      tone: c.tone === 'danger' || c.tone === 'warning' ? 'warn' : undefined, ms: 8000,
      action: act ? { label: act.label, fn: () => act.kind === 'rescan' ? Real.scan().then(() => launch(g.id, { via: 'rescan' })) : launch(g.id, { via: act.kind === 'relaunch' ? 'relaunch' : 'retry', force: act.kind === 'relaunch' }) } : undefined
    })
  }
  function enterGame(g, since, launchId) {
    const wasLaunch = S.session?.phase === 'launch'
    S.session = { game: g.id, phase: 'game', since: since || Date.now(), launchId, sawRunning: !!g.running }
    Bar.setCover(g.id); Bar.setMode('live'); Bar.fill(0, false); Bar.marks([])
    if (wasLaunch) {
      Play.launchGo(); $('#win').classList.add('is-launching'); Fluid.dim(.45)
      Sched.after('live', reduced() ? 60 : 520, () => { $('#win').classList.remove('is-launching'); Play.launchFx(false); Fluid.dim(1); Play.paintCta() })
    } else Play.paintCta()
    paintGame(); ticking(true)
  }
  function paintGame() {
    const s = S.session
    if (!s || s.phase !== 'game') return
    const g = G(s.game); if (!g) return
    const line = Bar.line()
    if (s.game === 'cs2' && liveData) {
      const l = liveData, score = l.score ? `${l.score.us}–${l.score.them}, ` : ''
      Bar.text(g.name, `${esc(Shared.cs2.mapLabel(l.map))}, ${score}${l.kills}/${l.deaths}/${l.assists}`)
      Bar.fill(Math.min(1, (l.round || 0) / 24))
      Bar.marks((l.rounds || []).filter((r) => r.kills).map((r) => `<i class="ln-x" style="left:calc(${Math.min(100, r.n / 24 * 100)}% - 6px)">${xm()}</i>`))
    } else Bar.text(g.name, 'En jeu')
    line?.classList.toggle('no-anim', false)
  }
  function endUi() {
    const s = S.session; if (!s) return
    Sched.clear('live'); ticking(false)
    S.session = null; liveData = null; routineSteps = null
    Play.launchFx(false); Fluid.dim(1); $('#win').classList.remove('is-launching')
    Bar.time(''); Bar.syncGame(); Play.paintCta()
  }
  // Un jeu peut démarrer sans passer par Jouer (Steam, un raccourci) ou s'arrêter sans prévenir
  function syncRunning() {
    const s = S.session
    const running = GAMES.filter((g) => g.running).sort((a, b) => (b.runningSince || 0) - (a.runningSince || 0))
    if (s?.phase === 'launch') return
    // Le relevé des programmes peut avoir un temps de retard sur la détection du lancement
    if (s?.phase === 'game') { const g = G(s.game); if (g?.running) s.sawRunning = true; else if (s.sawRunning || !g) return endUi(); return }
    if (!s && running[0]) enterGame(running[0], running[0].runningSince, null)
  }
  return {
    mount, launch,
    show() { const s = S.session; if (s) openGame(s.game) },
    cs2: () => liveData,
    stopFromBar() { const s = S.session; if (s?.phase === 'launch' && s.launchId) { API.cancelLaunch(s.launchId).catch(() => {}); endUi() } }
  }
})()
