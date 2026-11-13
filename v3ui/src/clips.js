// Clips : les vraies vidéos gardées sur ce PC, et le lecteur qui prend la barre de transport comme timeline.
Object.assign(Real, {
  clipsCfg: null, clipsLive: null,
  clipsOn: () => !!Real.clipsCfg?.enabled,
  async loadClipsCfg() { Real.clipsCfg = await API.clipsGetSettings(); return Real.clipsCfg },
  async saveClips(patch) { Real.clipsCfg = await API.clipsSaveSettings(patch); Real.applyGames(); Real.emit('games'); return Real.clipsCfg },
  // La ligne honnête de l'accueil : CS2 dit ses kills, les autres jeux se clippent au raccourci
  clipsLine(g) {
    const c = Real.clipsCfg; if (!c?.enabled) return null
    if (g.id === 'cs2') return 'Autorecord des kills prêt'
    if (g.id === 'bf6' || c.games === 'all') return `Clip à la main avec ${Shared.hotkey.hotkeyText(c.hotkey)}`
    return null
  }
})

const Clips = (() => {
  let el, player = null
  // Un clip ouvert depuis la fiche d'un jeu : Revenir y ramène, sur l'onglet Clips
  let ret = null
  const T = Shared.text
  const sizeLabel = (c) => Shared.steamUpdate.formatBytes(c.sizeBytes || 0)
  const gameOf = (c) => Real.byRid(c.gameId)
  const whereOf = (c) => (c.map ? Shared.cs2.mapLabel(c.map) : c.gameName)
  const noteOf = (c) => [c.round ? `Round ${c.round}` : '', c.kills ? `${c.kills} kill${c.kills > 1 ? 's' : ''}` : c.kind === 'manual' ? 'Gardé à la main' : '', c.headshots ? `${c.headshots} à la tête` : ''].filter(Boolean).join(', ')
  // Un film monté à partir de clips est rangé avec eux (kind « film »). Sa fabrication se passe dans le processus principal :
  // la page envoie les identifiants des clips, puis suit l'avancement.
  let film = { status: 'idle' }
  // Choisir plusieurs clips dans la liste (pour les supprimer ou en monter un film) : null hors de ce mode
  let pick = null
  const isFilm = (c) => c.kind === 'film'
  const wordOf = (c) => (isFilm(c) ? 'film' : 'clip')
  // Un film ne part jamais tout seul : son favori ne promet rien de plus
  const starTip = (c) => (isFilm(c) ? 'Ajouter aux favoris' : 'Ajouter aux favoris, jamais effacé')
  async function boot() {
    if (!API.clipsGetSettings) return
    const [cfg, live, list] = await Promise.all([API.clipsGetSettings().catch(() => null), API.clipsState().catch(() => null), API.clipsList().catch(() => [])])
    Real.clipsCfg = cfg; Real.clipsLive = live; CLIPS = list || []
    if (API.editFilmState) { film = (await API.editFilmState().catch(() => null)) || film; API.onEditFilm(onFilm) }
    API.onClipsChanged(async () => {
      const before = new Set(CLIPS.map((c) => c.id))
      CLIPS = await API.clipsList().catch(() => CLIPS)
      const fresh = CLIPS.filter((c) => !before.has(c.id))
      // Un film qui arrive a son propre message (onFilm) : « Clip gardé » ne vaut que pour un clip
      if (fresh.length) { Bar.dot(S.view !== 'clips'); if (S.session && fresh.some((c) => !isFilm(c))) toast(`${xm()} Clip gardé`, { ms: 1600 }) }
      if (S.view === 'clips' && !S.gameId && !player) render()
    })
    // Un problème se dit une fois : pas de nouvelle alerte tant que c'est le même
    let lastErr = live?.error || ''
    API.onClipsState((s) => {
      Real.clipsLive = s; Settings.sync()
      if (s.error && s.error !== lastErr) toast(esc(s.error), { tone: 'warn', ms: 7000, action: { label: 'Voir les réglages', fn: () => Settings.open('rec') } })
      lastErr = s.error || ''
    })
    Real.applyGames()
  }
  // Fabrication d'un film : l'avancement se met à jour sur place (la liste n'est pas redessinée, les vignettes ne sautent pas) ;
  // la fin, l'arrêt et l'échec se disent une fois, où que l'on soit dans l'appli
  function onFilm(s) {
    const was = film; film = s
    if (s.status === 'running' && was.status === 'running' && $('#cmPct')) {
      $('#cmPct').textContent = `${s.percent || 0} %`; $('#cmBar').value = s.percent || 0
      return
    }
    if (s.status === 'done') {
      const left = s.skipped ? ` ${s.skipped} clip${s.skipped > 1 ? 's n’ont' : ' n’a'} pas pu être monté${s.skipped > 1 ? 's' : ''}.` : ''
      toast(`${ic('check')} Film prêt.${left}`, { ms: 9000, action: { label: 'Voir le film', fn: () => openFilm(s.clipId) } })
    } else if (s.status === 'stopped') toast(esc(s.message || 'Film arrêté.'), s.message && s.message !== 'Film arrêté.' ? { tone: 'warn', ms: 7000 } : { ms: 2200 })
    else if (s.status === 'failed') {
      const copy = async () => { try { await navigator.clipboard.writeText(s.report); toast(`${ic('check')} Erreur copiée`, { ms: 1800 }) } catch { toast('L’erreur n’a pas pu être copiée.', { tone: 'warn', ms: 4000 }) } }
      toast(esc(s.message || 'Le film n’a pas pu être fabriqué.'), { tone: 'warn', ms: 15000, ...(s.report ? { action: { label: 'Copier l’erreur', fn: copy } } : {}) })
    }
    if (S.view === 'clips' && !S.gameId && !player) render()
  }
  // Monter un film : l'éditeur s'ouvre avec ces clips (bêta 35). Le film se fabrique ensuite depuis l'éditeur, et son
  // avancement revient ici, dans le groupe du premier clip.
  async function makeFilm(b, list) {
    if (b?.getAttribute('aria-busy')) return
    const clips = list.filter((c) => !isFilm(c))
    if (!clips.length) return toast('Choisis au moins un clip (pas un film).', { ms: 2600 })
    b?.setAttribute('aria-busy', 'true')
    pick = null
    await Editor.open(clips.map((c) => c.id), el, () => { render(); ($('#cmRun') || $('.cm-go') || $('.ct-tile'))?.focus({ preventScroll: true }) })
    b?.removeAttribute('aria-busy')
  }
  // Supprimer plusieurs clips d'un coup, après une confirmation qui dit combien
  function deleteMany(list) {
    if (!list.length) return
    const nF = list.filter(isFilm).length, nC = list.length - nF
    const what = [nC ? `${nC} clip${nC > 1 ? 's' : ''}` : '', nF ? `${nF} film${nF > 1 ? 's' : ''}` : ''].filter(Boolean).join(' et ')
    confirmDel({ title: `Supprimer ${what} ?`, text: 'Les fichiers partent de ton dossier, ils ne reviendront pas.', verb: `Supprimer ${what}`, onOk: async () => {
      let ok = 0, ko = 0
      for (const c of list) { try { await API.clipsDelete(c.id); ok++; CLIPS = CLIPS.filter((x) => x.id !== c.id) } catch { ko++ } }
      pick = null; render()
      toast(ko ? `${ok} supprimé${ok > 1 ? 's' : ''}, ${ko} n’ont pas pu l’être (fichier ouvert ailleurs ?).` : `${ic('trash')} ${what.charAt(0).toUpperCase() + what.slice(1)} supprimé${list.length > 1 ? 's' : ''}`, { tone: ko ? 'warn' : '', ms: 3200 })
    } })
  }
  // Clic droit sur un clip : ses actions sans l'ouvrir
  function tileMenu(c, t, e) {
    e.preventDefault()
    menuAt(t, [
      ['play', `Ouvrir le ${wordOf(c)}`, () => openClip(c, t)],
      ...(isFilm(c) ? [] : [['film', 'Monter un film avec ce clip', () => makeFilm(null, [c])]]),
      ['check', 'Sélectionner', () => { pick = new Set([c.id]); render() }],
      ['sep'],
      ['trash', `Supprimer le ${wordOf(c)}`, () => deleteMany([c])]
    ], { at: { x: e.clientX, y: e.clientY } })
  }
  // Le film vient d'être rangé : la liste peut ne pas l'avoir encore
  async function openFilm(id) {
    if (!CLIPS.some((c) => c.id === id)) CLIPS = await API.clipsList().catch(() => CLIPS)
    if (player) onLeaveNow()
    openById(id)
  }
  function mount(host) {
    el = h(`<section class="v v-clips" data-v="clips" hidden aria-label="Clips" tabindex="-1">
      <div class="scroll" id="clipScroll"></div>
      <div class="cp" id="cp" hidden></div>
    </section>`)
    host.append(el)
  }
  const filters = () => {
    const games = [...new Map(CLIPS.map((c) => [c.gameId, c.gameName])).entries()].slice(0, 4).map(([rid, n]) => ['g:' + rid, Real.byRid(rid)?.short || n])
    return [['all', 'Tout'], ...(games.length > 1 ? games : []), ...(CLIPS.some(isFilm) ? [['film', 'Films']] : []), ['star', 'Favoris'], ['multi', '3 kills et plus'], ['hs', 'Headshots']]
  }
  function filt(c) {
    const f = S.clipFilter
    if (f === 'all') return true
    if (f.startsWith('g:')) return c.gameId === f.slice(2)
    if (f === 'film') return isFilm(c)
    if (f === 'star') return c.pinned
    if (f === 'multi') return (c.kills || 0) >= 3
    if (f === 'hs') return (c.headshots || 0) > 0
    return true
  }
  function tile(c) {
    const sel = pick ? ` is-pick" aria-pressed="${pick.has(c.id)}` : ''
    return `<button class="ct-tile${sel}" data-id="${esc(c.id)}" aria-label="${esc(c.title)}, ${Math.round(c.durationS)} secondes">
      <span class="ct-frame">${pick ? `<span class="ct-chk">${ic('check')}</span>` : ''}<img src="${esc(c.thumbUrl)}" alt="" loading="lazy" decoding="async" draggable="false" data-fb="1"><i class="ct-shade"></i>
        <span class="ct-time num">${fmtTime(c.durationS)}</span><span class="ct-flags">${isFilm(c) ? `<span class="ct-film">${ic('film')}</span>` : ''}${c.pinned ? `<span class="ct-star">${ic('starf')}</span>` : ''}</span>
      </span>
      <span class="ct-t"><b>${esc(c.title)}</b><span>${esc(isFilm(c) ? T.capitalize(T.timeAgo(c.at)) : noteOf(c) || whereOf(c))}</span></span>
    </button>`
  }
  // Survoler un clip le lit sans le son : l'image fixe ne dit pas tout
  function bindTiles(root, onOpen) {
    $$('.ct-tile', root).forEach((t) => {
      const c = CLIPS.find((x) => x.id === t.dataset.id); if (!c) return
      t.onclick = () => {
        if (pick && t.classList.contains('is-pick')) { if (pick.has(c.id)) pick.delete(c.id); else pick.add(c.id); t.setAttribute('aria-pressed', pick.has(c.id)); paintPick(); return }
        onOpen(c, t)
      }
      if (t.closest('#clipScroll')) t.oncontextmenu = (e) => tileMenu(c, t, e)
      if (reduced() || pick) return
      const fr0 = $('.ct-frame', t); let timer = 0, vid = null
      t.addEventListener('pointerenter', () => { timer = setTimeout(() => { vid = h(`<video class="ct-vid" src="${esc(c.videoUrl)}" muted loop autoplay playsinline aria-hidden="true"></video>`); fr0.insertBefore(vid, $('.ct-shade', fr0)) }, 220) })
      t.addEventListener('pointerleave', () => { clearTimeout(timer); vid?.remove(); vid = null })
    })
  }
  function render() {
    const sc = $('#clipScroll', el), cfg = Real.clipsCfg
    const F = filters(); if (!F.some(([k]) => k === S.clipFilter)) S.clipFilter = 'all'
    // Un film ne compte pas dans la place réservée aux clips, et ne part jamais tout seul
    const shown = CLIPS.filter(filt), used = CLIPS.reduce((a, c) => a + (isFilm(c) ? 0 : c.sizeBytes || 0), 0), limit = (cfg?.limitGb || 0) * 1024 ** 3
    const films = shown.filter(isFilm)
    // Une session de jeu, un groupe : les clips d'un même match restent ensemble. Les films ont leur groupe à eux, en tête.
    const groups = new Map()
    shown.forEach((c) => { if (isFilm(c)) return; const k = c.sessionId || `${c.gameId}:${new Date(c.at).toDateString()}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c) })
    const n = shown.length
    const zero = !CLIPS.length
    // Le film d'un groupe : les clips affichés, mis bout à bout. Pendant sa fabrication, le groupe d'où il a été demandé la suit.
    const filmCtl = (k, list) => {
      if (film.status === 'running' && list.some((c) => c.id === film.fromClipId)) return `<div class="cm-a" id="cmRun" role="group" tabindex="-1" aria-label="Film en cours de fabrication"><span class="cm-run">Film en cours</span><progress class="cm-bar" id="cmBar" max="100" value="${film.percent || 0}" aria-label="Avancement du film"></progress><b class="cm-pct num" id="cmPct">${film.percent || 0} %</b><button class="btn sm" id="cmStop">Arrêter</button></div>`
      return pick ? '' : `<div class="cm-a"><button class="btn sm cm-go" data-k="${esc(k)}">${ic('film')}<span>Monter un film</span></button></div>`
    }
    // Le focus était sur la fabrication en cours (ou sur « Arrêter ») : il reviendra sur le bouton du groupe quand elle finit
    const hadRun = !!document.activeElement?.closest?.('#cmRun'), hadStop = document.activeElement?.id === 'cmStop'
    sc.innerHTML = `<header class="pg-head">
        <div><h1 class="pg-title">Clips</h1></div>
        ${cfg ? `<button class="cl-store" id="clStore" aria-label="Réglages de l’enregistrement"><span class="cl-g"><i style="width:${limit ? Math.min(100, used / limit * 100) : 0}%"></i></span><span><b class="num">${used ? esc(Shared.steamUpdate.formatBytes(used)) : '0 Go'}</b> sur ${cfg.limitGb} Go</span></button>` : ''}
      </header>
      ${zero ? '' : pick ? `<div class="cl-bar"><div class="cl-sel" role="group" aria-label="Clips choisis"><span id="clSelN" class="num" aria-live="polite"></span><button class="btn sm" id="clSelFilm">${ic('film')}Monter un film</button><button class="btn sm danger" id="clSelDel">${ic('trash')}Supprimer</button><button class="btn sm" id="clSelEnd">Terminé</button></div></div>` : `<div class="cl-bar"><div class="pills" role="group" aria-label="Filtrer">${F.map(([k, l]) => `<button class="pill" data-f="${esc(k)}" aria-pressed="${S.clipFilter === k}">${esc(l)}</button>`).join('')}</div><div class="cl-sel"><button class="btn sm" id="clSel">${ic('check')}Sélectionner</button>${searchBtn()}</div></div>`}
      ${films.length ? `<section class="cm" aria-label="Films">
        <header class="cm-h"><span class="cm-cov cm-ico">${ic('film')}</span><div class="cm-t"><h2>Films</h2></div></header>
        <div class="ct-grid">${films.map(tile).join('')}</div>
      </section>` : ''}
      ${[...groups.entries()].map(([k, list]) => { const a = list[0], g = gameOf(a); return `<section class="cm">
        <header class="cm-h">
          <span class="cm-cov" data-name="${esc(a.gameName)}"><img src="${esc(A(g?.cover) === BLANK ? Real.coverPh(a.gameName) : A(g.cover))}" alt=""></span>
          <div class="cm-t"><h2>${esc(whereOf(a))}</h2><p>${[a.score ? `${a.score.us ?? a.score[0]}–${a.score.them ?? a.score[1]}` : '', a.mode ? Shared.cs2.modeLabel(a.mode) : a.map ? '' : '', T.timeAgo(a.at)].filter(Boolean).map(esc).join(', ')}</p></div>
          ${filmCtl(k, list)}
        </header>
        <div class="ct-grid">${list.map(tile).join('')}</div>
      </section>` }).join('')}
      ${zero ? `<div class="empty"><span class="empty-x">${xm()}</span>${cfg?.enabled ? `<h2>Aucun clip pour l’instant</h2><p>Sur Counter-Strike 2, chaque kill garde son clip tout seul. Partout ailleurs, appuie sur ${esc(Shared.hotkey.hotkeyText(cfg.hotkey))} pour garder les dernières secondes.</p><button class="btn sm" id="clGo">Régler l’enregistrement</button>` : `<h2>L’enregistrement est coupé</h2><p>Active-le pour garder tes kills et tes meilleurs moments, sur ce PC.</p><button class="btn sm rose" id="clOn">Activer l’enregistrement</button>`}</div>` : ''}
      ${!zero && !n ? `<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucun clip ici</h2><p>Aucun clip ne correspond à ce filtre.</p><button class="btn sm" id="clReset">Effacer le filtre</button></div>` : ''}`
    $$('.pill', sc).forEach((b) => b.onclick = () => { S.clipFilter = b.dataset.f; render() })
    $('#clReset', sc)?.addEventListener('click', () => { S.clipFilter = 'all'; render() })
    $('#clStore', sc)?.addEventListener('click', () => Settings.open('rec'))
    $('#clGo', sc)?.addEventListener('click', () => Settings.open('rec'))
    $('#clOn', sc)?.addEventListener('click', async () => { await Real.saveClips({ enabled: true }).catch((e) => toast(esc(errText(e)), { tone: 'warn', ms: 4000 })); Settings.syncBar(); render() })
    $$('.cm-go', sc).forEach((b) => b.onclick = () => makeFilm(b, groups.get(b.dataset.k) || []))
    $('#clSel', sc)?.addEventListener('click', () => { pick = new Set(); render(); $('.ct-tile', sc)?.focus({ preventScroll: true }) })
    $('#clSelEnd', sc)?.addEventListener('click', () => { pick = null; render(); $('#clSel', sc)?.focus({ preventScroll: true }) })
    $('#clSelDel', sc)?.addEventListener('click', () => { const l = CLIPS.filter((c) => pick?.has(c.id)); if (!l.length) return toast('Choisis d’abord des clips.', { ms: 2200 }); deleteMany(l) })
    $('#clSelFilm', sc)?.addEventListener('click', (e) => { const l = CLIPS.filter((c) => pick?.has(c.id)); if (!l.length) return toast('Choisis d’abord des clips.', { ms: 2200 }); makeFilm(e.currentTarget, l) })
    paintPick()
    $('#cmStop', sc)?.addEventListener('click', (e) => { e.currentTarget.setAttribute('aria-busy', 'true'); API.editFilmStop().catch((x) => toast(esc(errText(x)), { tone: 'warn', ms: 4000 })) })
    // La fabrication vient de finir, son bloc a disparu : le focus revient sur un bouton de la liste. Tant qu'elle dure, il y reste.
    if (hadRun) ((hadStop && $('#cmStop', sc)) || $('#cmRun', sc) || $('.cm-go', sc) || $('.ct-tile', sc))?.focus({ preventScroll: true })
    bindTiles(sc, (c, t) => openClip(c, t))
  }

  function paintPick() {
    const n = pick ? pick.size : 0, el2 = $('#clSelN'); if (el2) el2.textContent = n ? `${n} choisi${n > 1 ? 's' : ''}` : 'Touche les clips à choisir'
  }

  // Lecteur
  function openClip(c, fromTile) {
    const shared = fromTile && $('.ct-frame', fromTile)
    if (shared) shared.style.viewTransitionName = 'clip-frame'
    vt(() => {
      if (shared) shared.style.viewTransitionName = ''
      paintPlayer(c)
    }, { done: () => $('#cpShare')?.focus({ preventScroll: true }) })
  }
  function paintPlayer(c) {
    const g = gameOf(c)
    if (g) Fluid.game(g)
    const cp = $('#cp', el); cp.hidden = false
    $('#clipScroll', el).style.visibility = 'hidden'
    const near = CLIPS.filter((x) => x.id !== c.id && x.sessionId && x.sessionId === c.sessionId).slice(0, 3)
    cp.innerHTML = `<button class="btn sm cp-back" id="cpBack" data-tip="Revenir, Échap" data-tip-b>${ic('back')}${ret ? `Revenir à ${esc(G(ret.game)?.short || 'la fiche')}` : 'Revenir aux clips'}</button>
      <div class="cp-main">
        <div class="cp-frame" id="cpFrame" style="view-transition-name:clip-frame">
          <video id="cpVid" src="${esc(c.videoUrl)}" poster="${esc(c.thumbUrl)}" autoplay playsinline></video>
          <button class="cp-bigplay" id="cpBig" aria-label="Reprendre la lecture" data-tip="Reprendre la lecture">${ic('play')}</button>
          <p class="cp-err" id="cpErr" hidden>Cette vidéo n’a pas pu être lue. Ouvre le dossier pour vérifier le fichier.</p>
        </div>
      </div>
      <aside class="cp-side">
        <p class="cp-kick">${esc(g?.short || c.gameName)}${c.map ? `, ${esc(Shared.cs2.mapLabel(c.map))}` : ''}</p>
        <div class="cell-edit cp-tt" id="cpCell"><button type="button" class="cell-display cp-title" id="cpTitle" data-tip="Renommer le ${wordOf(c)}" data-tip-l>${esc(c.title)}</button><input class="cell-input cp-title" id="cpTitleI" hidden maxlength="80" value="${esc(c.title)}" aria-label="Nom du ${wordOf(c)}" autocomplete="off" spellcheck="false"></div>
        <p class="cp-det">${esc(T.capitalize(T.timeAgo(c.at)))}</p>
        ${noteOf(c) ? `<p class="cp-det">${esc(noteOf(c))}</p>` : ''}
        <button class="btn rose cp-share" id="cpShare">${ic('copy')}<span>Copier pour Discord</span></button>
        <p class="cp-size num" id="cpSize"></p>
        <div class="cp-acts">
          <button class="btn sm icon" id="cpStar" aria-label="Favori" aria-pressed="${!!c.pinned}" data-tip="${c.pinned ? 'Retirer des favoris' : starTip(c)}" data-tip-l><span class="ic-swap"><span class="a">${ic('star')}</span><span class="b">${ic('starf')}</span></span></button>
          <button class="btn sm" id="cpFolder">${ic('folder')}Ouvrir le dossier</button>
          <button class="btn sm" id="cpCut" hidden>${ic('cut')}Garder cette coupe</button>
          <button class="btn sm icon" id="cpDel" aria-label="Supprimer le ${wordOf(c)}" data-tip="Supprimer le ${wordOf(c)}" data-tip-r>${ic('trash')}</button>
        </div>
        ${near.length ? `<div class="cp-next"><span>Dans cette session</span>${near.map((x) => `<button class="cp-n" data-id="${esc(x.id)}"><span class="cp-nf"><img src="${esc(x.thumbUrl)}" alt="" loading="lazy" decoding="async" data-fb="1"></span><span><b>${esc(x.title)}</b><span class="num">${fmtTime(x.durationS)}</span></span></button>`).join('')}</div>` : ''}
      </aside>`
    const vid = $('#cpVid', cp)
    player = { c, vid, inS: 0, outS: c.durationS, raf: 0 }
    Bar.dot(false)
    vid.onerror = () => { $('#cpErr', cp).hidden = false }
    vid.onplay = paintBtn; vid.onpause = paintBtn
    vid.onloadedmetadata = () => { if (Number.isFinite(vid.duration) && vid.duration > 0 && player?.c === c) { player.outS = Math.min(player.outS || vid.duration, vid.duration); player.dur = vid.duration; setupBar(c); sizeText() } }
    $('#cpBack', cp).onclick = close
    $('#cpBig', cp).onclick = playerToggle
    $('#cpFrame', cp).onclick = (e) => { if (e.target.id === 'cpFrame' || e.target === vid) playerToggle() }
    $$('.cp-n', cp).forEach((b) => b.onclick = () => { const nx = CLIPS.find((x) => x.id === b.dataset.id); leavePlayer(); vt(() => paintPlayer(nx)) })
    // Une coupe en attente : on copie ce qui est à l'écran, pas le clip entier
    $('#cpShare', cp).onclick = async (e) => {
      const b = e.currentTarget
      if (!cutPending()) return copy(c, b)
      const nc = await keepCut($('#cpCut', cp))
      if (nc) copy(nc, $('#cpShare'))
    }
    $('#cpStar', cp).onclick = async (e) => {
      const b = e.currentTarget, on = !c.pinned
      try { await API.clipsPin(c.id, on); c.pinned = on; b.setAttribute('aria-pressed', on); b.dataset.tip = on ? 'Retirer des favoris' : starTip(c); toast(`${ic(on ? 'starf' : 'star')} ${on ? (isFilm(c) ? 'Ajouté aux favoris' : 'Ce clip ne sera jamais effacé') : 'Retiré des favoris'}`, { ms: 1800 }) } catch (x) { toast(esc(errText(x)), { tone: 'warn', ms: 4000 }) }
    }
    $('#cpFolder', cp).onclick = () => API.clipsOpenFolder(c.id).catch((x) => toast(esc(errText(x)), { tone: 'warn', ms: 4000 }))
    $('#cpDel', cp).onclick = () => confirmDel({ title: `Supprimer le ${wordOf(c)} « ${esc(c.title)} » ?`, text: isFilm(c) ? 'Le fichier part de ton dossier de films, il ne reviendra pas. Tes clips restent là.' : 'Le fichier part de ton dossier de clips, il ne reviendra pas.', verb: `Supprimer le ${wordOf(c)}`, onOk: async () => {
      // La vidéo lâche le fichier d'abord : sous Windows, un fichier ouvert ne s'efface pas
      vid.pause(); vid.removeAttribute('src'); vid.load()
      try { await API.clipsDelete(c.id); CLIPS = CLIPS.filter((x) => x.id !== c.id); close(); toast(`${ic('trash')} ${isFilm(c) ? 'Film' : 'Clip'} « ${esc(c.title)} » supprimé`, { ms: 2200 }) } catch (x) { vid.src = c.videoUrl; vid.load(); toast(esc(errText(x)), { tone: 'warn', ms: 5000 }) }
    } })
    $('#cpCut', cp).onclick = (e) => keepCut(e.currentTarget)
    // Renommer : sur place, rien ne bouge autour
    const disp = $('#cpTitle', cp), inp = $('#cpTitleI', cp)
    disp.onclick = () => { disp.style.visibility = 'hidden'; inp.hidden = false; inp.focus(); inp.select() }
    let cancel = false
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') { cancel = true; inp.blur() } else if (e.key === 'Enter') { e.preventDefault(); inp.blur() } }
    inp.onblur = async () => {
      const v = inp.value.trim(), keep = cancel || !v || v === c.title; cancel = false
      if (!keep) { try { await API.clipsRename(c.id, v); c.title = v; disp.textContent = v; Bar.text(c.title, esc(`${g?.short || c.gameName}${c.map ? `, ${Shared.cs2.mapLabel(c.map)}` : ''}`)) } catch (x) { toast(esc(errText(x)), { tone: 'warn', ms: 4000 }) } }
      inp.value = c.title; inp.hidden = true; disp.style.visibility = ''; disp.focus({ preventScroll: true })
    }
    setupBar(c)
    sizeText()
    tick()
  }
  const durOf = () => player.dur || player.c.durationS
  const cutPending = () => !!player && (player.inS >= .05 || player.outS <= durOf() - .05)
  async function keepCut(b) {
    if (b.getAttribute('aria-busy')) return null
    b.setAttribute('aria-busy', 'true')
    const { c } = player
    try {
      const nc = await API.clipsTrim(c.id, player.inS, player.outS)
      CLIPS = await API.clipsList().catch(() => CLIPS)
      const shown = CLIPS.find((x) => x.id === nc?.id) || c
      toast(`${ic('check')} Coupe de ${Math.round(shown.durationS)} s gardée dans un nouveau clip. L’original reste là.`, { ms: 3000 })
      leavePlayer(); paintPlayer(shown)
      return shown
    } catch (x) { b.removeAttribute('aria-busy'); toast(esc(errText(x)), { tone: 'warn', ms: 5000 }); return null }
  }
  function setupBar(c) {
    const g = gameOf(c)
    Bar.setMode('clip'); if (g) Bar.setCover(g.id); Bar.text(c.title, esc(`${g?.short || c.gameName}${c.map ? `, ${Shared.cs2.mapLabel(c.map)}` : ''}`))
    const line = Bar.line()
    Bar.marks([])
    // Un film ne se coupe pas ici (il se refait depuis ses clips) : sa ligne sert à se déplacer, sans poignées
    const grips = !isFilm(c)
    if (grips) $('#bMarks').insertAdjacentHTML('beforeend', `<i class="ln-dim ld-a" id="ldA"></i><i class="ln-dim ld-b" id="ldB"></i><button class="ln-grip gr-a" id="grA" aria-label="Couper le début" data-tip="Couper le début"></button><button class="ln-grip gr-b" id="grB" aria-label="Couper la fin" data-tip="Couper la fin"></button>`)
    line.onpointerdown = (e) => {
      if (e.target.classList.contains('ln-grip')) return grip(e, e.target.id === 'grA' ? 'inS' : 'outS')
      scrub(e); line.setPointerCapture(e.pointerId)
      line.onpointermove = scrub
      line.onpointerup = () => { line.onpointermove = null; line.onpointerup = null }
    }
    if (grips) for (const [id, key] of [['#grA', 'inS'], ['#grB', 'outS']]) $(id).onkeydown = (e) => { const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); setTrim(key, player[key] + d) }
    paintTrim()
  }
  const tAt = (e) => { const r = Bar.line().getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * durOf() }
  function scrub(e) { seek(tAt(e)) }
  function setTrim(key, t) {
    if (key === 'inS') player.inS = clamp(t, 0, player.outS - 2); else player.outS = clamp(t, player.inS + 2, durOf())
    if (player.vid.currentTime < player.inS || player.vid.currentTime > player.outS) seek(player.inS)
    paintTrim(); sizeText()
  }
  function grip(e, key) {
    e.preventDefault(); const g = e.target; g.setPointerCapture(e.pointerId)
    g.onpointermove = (ev) => setTrim(key, tAt(ev))
    g.onpointerup = () => { g.onpointermove = null; g.onpointerup = null }
  }
  function paintTrim() {
    if (!player) return; const { inS, outS } = player, d = durOf()
    const a = inS / d * 100, b = outS / d * 100
    const set = (id, prop, v) => { const e = $(id); if (e) e.style[prop] = v }
    set('#ldA', 'width', a + '%'); set('#ldB', 'width', (100 - b) + '%'); set('#grA', 'left', a + '%'); set('#grB', 'left', b + '%')
    // La coupe prend la place d'Ouvrir le dossier : rien ne bouge autour
    const on = cutPending(), cut = $('#cpCut'), folder = $('#cpFolder'), share = $('#cpShare span')
    if (cut) { cut.hidden = !on; folder.hidden = on }
    if (share && !$('#cpShare').getAttribute('aria-busy')) share.textContent = on ? 'Copier la coupe' : 'Copier pour Discord'
  }
  function sizeText() {
    const { c, inS, outS } = player, d = outS - inS, whole = durOf()
    const full = `${Math.round(whole)} s, ${sizeLabel(c)}${c.width ? `, ${c.width} × ${c.height}` : ''}.`
    $('#cpSize').textContent = d < whole - .05 ? `${full} Coupe : environ ${Math.round(d)} s.` : full
  }
  // Le fichier lui-même dans le presse-papiers : Ctrl V dans Discord l'envoie tel quel
  async function copy(c, b) {
    if (b.getAttribute('aria-busy')) return
    const lab = $('span', b) || b, old = lab.textContent
    b.setAttribute('aria-busy', 'true'); lab.textContent = 'Copie…'
    try {
      if (!(await API.clipsCopyFile(c.id))) throw new Error(`Le ${wordOf(c)} n’a pas pu aller dans le presse-papiers. Ouvre le dossier et glisse le fichier dans Discord.`)
      lab.textContent = 'Prêt : Ctrl V dans Discord'
      toast(`${ic('check')} ${isFilm(c) ? 'Film' : 'Clip'} dans le presse-papiers, ${esc(sizeLabel(c))}`, { ms: 2400 })
      setTimeout(() => { if (lab.isConnected) lab.textContent = old }, 2600)
    } catch (e) { lab.textContent = old; toast(esc(errText(e)), { tone: 'warn', ms: 5000 }) }
    b.removeAttribute('aria-busy')
  }
  function seek(t) { if (!player) return; player.vid.currentTime = clamp(t, player.inS, player.outS) }
  function playerToggle() { if (!player) return; const v = player.vid; if (v.paused) v.play().catch(() => {}); else v.pause() }
  function paintBtn() {
    if (!player) return
    const on = !player.vid.paused, b = $('#bPlay')
    b.innerHTML = on ? ic('pause') : ic('play', 'opt')
    $('#cpBig')?.classList.toggle('show', !on)
  }
  // La barre suit la vidéo, et la lecture reste dans la coupe
  function tick() {
    if (!player) return
    const { vid } = player
    const f = () => {
      if (!player || player.vid !== vid) return
      const d = durOf(), t = vid.currentTime
      if (t >= player.outS || (vid.ended && player.outS >= d)) { vid.currentTime = player.inS; if (vid.paused && vid.ended) vid.play().catch(() => {}) }
      Bar.fill(clamp(t / d, 0, 1), false); Bar.time(`${fmtTime(t)} / ${fmtTime(d)}`)
      player.raf = requestAnimationFrame(f)
    }
    player.raf = requestAnimationFrame(f); paintBtn()
  }
  function leaveBar() {
    Bar.line().onpointerdown = null; Bar.line().onpointermove = null
    $('#bPlay').innerHTML = `<span class="ic-swap"><span class="a">${ic('play')}</span><span class="b">${ic('stop')}</span></span>`
    Bar.setMode('idle'); Bar.syncGame()
  }
  function leavePlayer() { if (!player) return; cancelAnimationFrame(player.raf); player.vid.pause(); player.vid.removeAttribute('src'); player.vid.load(); player = null }
  function close() {
    if (!player) return
    const pc = player.c
    if (ret) { const r = ret; ret = null; onLeaveNow(); return Pages.openGame(r.game, null, { tab: 'clips', prev: r.prev }) }
    leavePlayer()
    vt(() => {
      $('#cp', el).hidden = true; $('#cp', el).innerHTML = ''; $('#clipScroll', el).style.visibility = ''
      leaveBar()
      Fluid.set(['#150c1c', '#47123a', '#c21c55', '#3b1a66'])
      render()
    }, { done: () => ($(`.ct-tile[data-id="${pc.id}"]`, el) || $('.ct-tile', el) || $('.pill', el))?.focus({ preventScroll: true }) })
  }
  /* L'onglet Clips de la fiche d'un jeu */
  function gameTab(g, b) {
    const list = CLIPS.filter((c) => c.gameId === g.rid), cfg = Real.clipsCfg
    b.innerHTML = list.length ? `<div class="ct-grid">${list.slice(0, 12).map(tile).join('')}</div>` : `<div class="empty"><span class="empty-x">${xm()}</span><h2>Pas encore de clip sur ce jeu</h2><p>${g.id === 'cs2' && cfg?.enabled ? 'Joue un match : chaque kill garde son clip tout seul.' : cfg?.enabled ? `En jeu, appuie sur ${esc(Shared.hotkey.hotkeyText(cfg.hotkey))} pour garder les dernières secondes.` : 'L’enregistrement est coupé : active-le dans Paramètres.'}</p>${g.installed ? `<button class="btn sm" id="gbPlay">${ic('play')}Lancer ${esc(g.short)}</button>` : ''}</div>`
    $('#gbPlay', b)?.addEventListener('click', () => $('#gpPlay').click())
    bindTiles(b, (c) => { const back = { game: g.id, prev: S.prevView }; S.gameId = null; openById(c.id, back) })
  }
  const openById = (id, back = null) => { const c = CLIPS.find((x) => x.id === id); if (!c) return; ret = null; go('clips'); setTimeout(() => { ret = back; paintPlayer(c) }, 320) }
  function onLeaveNow() { if (player) { leavePlayer(); $('#cp', el).hidden = true; $('#cp', el).innerHTML = ''; $('#clipScroll', el).style.visibility = ''; leaveBar() } }
  return {
    boot, mount, open: openById, close, playerToggle, copy, gameTab, sizeLabel,
    isOpen: () => !!player,
    tileHTML: tile,
    // Les clips gardés pendant une session de jeu (un film fabriqué après coup n'en fait pas partie)
    between: (rid, from, to) => CLIPS.filter((c) => !isFilm(c) && (!rid || c.gameId === rid) && c.at >= from - 60000 && c.at <= to + 60000),
    onEnter() { if (!player && !Editor.isOpen()) { render(); Fluid.set(['#150c1c', '#47123a', '#c21c55', '#3b1a66']) } Bar.dot(false) },
    onLeave() { ret = null; pick = null; if (Editor.isOpen()) Editor.close(); onLeaveNow() }
  }
})()
