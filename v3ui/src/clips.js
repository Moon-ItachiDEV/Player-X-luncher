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
  // Bêta 46 : un clip filmé sous le seuil le dit (« Filmé à 46 images/s »). Rien pour les autres, ni pour les films.
  const slowOf = (c) => Shared.clipPace.paceNote(c.pace)
  // Un film monté à partir de clips est rangé avec eux (kind « film »). Sa fabrication se passe dans le processus principal :
  // la page envoie les identifiants des clips, puis suit l'avancement.
  let film = { status: 'idle' }
  // Choisir plusieurs clips dans la liste (pour les supprimer ou en monter un film) : null hors de ce mode
  let pick = null
  const isFilm = (c) => c.kind === 'film'
  const wordOf = (c) => (isFilm(c) ? 'film' : 'clip')
  // Un film ne part jamais tout seul : son favori ne promet rien de plus
  const starTip = (c) => (isFilm(c) ? 'Ajouter aux favoris' : 'Ajouter aux favoris, jamais effacé')
  // 0.6.2 : la page Clips a deux styles, au choix dans Paramètres > Enregistrement : « Viseur » (par défaut : un écran de caméra, les
  // réglages écrits dessus) et « Régie » (les réglages à gauche, tes clips à droite). Les réglages sont ceux de Paramètres : le même
  // code (Settings.QUAL, TRIG, kcap, bindKc, bindSeg, copyLog) et les mêmes enregistrements (Real.saveClips). La page ne lance aucun jeu.
  const STYLE_KEY = 'pxv3-clips-style'
  let styleMem = null
  const style = () => { if (styleMem) return styleMem; try { return localStorage.getItem(STYLE_KEY) === 'a' ? 'a' : 'b' } catch { return 'b' } }
  const here = () => !!el && S.view === 'clips' && !S.gameId && !player
  function setStyle(v) {
    styleMem = v === 'a' ? 'a' : 'b'
    try { localStorage.setItem(STYLE_KEY, styleMem) } catch { /* gardé pour cette session */ }
    pop = null
    if (here()) render()
  }
  // La bulle ouverte du Viseur (une seule), un curseur en cours de glissement, ce que la page montrait au dernier dessin
  let pop = null, dragging = false, pageSig = '', seenSince = 0
  const cs2Here = () => GAMES.some((g) => g.id === 'cs2' && g.installed)
  const cs2Live = () => Real.st.settings?.cs2Live !== false
  // Le jeu montré : celui que le moteur filme, sinon celui qui tourne, sinon le dernier joué, et seulement un jeu que l'enregistrement filme
  const heroGame = (cfg) => { const l = GAMES.filter((g) => g.installed && !g.hidden && (cfg?.games !== 'cs2bf6' || g.id === 'cs2' || g.id === 'bf6')); const live = Real.clipsLive?.game; return (live && l.find((g) => g.name === live)) || l.find((g) => g.running) || l[0] || null }
  // Seul CS2 dit ses kills à Player X (et seulement avec au moins un moment coché) : ailleurs, rien n'est gardé sans le raccourci
  const autoHere = (cfg, g) => { const live = Real.clipsLive?.game; return (live ? /counter-strike 2/i.test(live) : g?.id === 'cs2') && cs2Live() && Settings.TRIG.some(([k]) => cfg?.triggers?.[k]) }
  const keyHint = (cfg) => `Appuie sur ${esc(Shared.hotkey.hotkeyText(cfg.hotkey))} pour garder un moment`
  // Une vraie image du jeu, large d'abord ; jamais le repli « nom sur sa teinte »
  const realArt = (u) => (u && A(u) !== BLANK && !/^data:image\/svg/.test(A(u)) ? A(u) : null)
  const heroArt = (g) => [g?.heroWide, g?.hero, g?.cover].map(realArt).find(Boolean) || null
  // Le mur du Viseur : les vraies jaquettes de ta bibliothèque (installés, pas masqués)
  const wallCovers = () => [...new Set(GAMES.filter((g) => g.installed && !g.hidden && g.id !== '__all').map((g) => realArt(g.cover)).filter(Boolean))]
  function recState(cfg) {
    const s = Real.clipsLive
    if (!cfg?.enabled) return { k: 'off', word: 'Caméra coupée' }
    if (s?.status === 'error') return { k: 'err', word: 'Caméra en panne' }
    if (s?.status === 'recording') return { k: 'rec', word: 'Enregistre' }
    return { k: 'ready', word: 'Caméra prête' }
  }
  const between = (rid, from, to) => CLIPS.filter((c) => !isFilm(c) && (!rid || c.gameId === rid) && c.at >= from - 60000 && c.at <= to + 60000)
  // Les clips de la partie en cours : ceux du jeu filmé, depuis le début de la partie (la session de Player X, sinon le moment où la page a vu l'enregistrement)
  function sessionClips(cfg) {
    const g = heroGame(cfg); if (recState(cfg).k !== 'rec' || !g) return []
    return between(g.rid, S.session?.since || seenSince || Date.now(), Date.now()).sort((a, b) => b.at - a.at)
  }
  // Le dernier clip (jamais un film s'il y a un clip) ; sans clip, le dernier film
  const lastClip = () => { const by = (l) => l.reduce((m, c) => (!m || c.at > m.at ? c : m), null); return by(CLIPS.filter((c) => !isFilm(c))) || by(CLIPS) }
  const usedBytes = () => CLIPS.reduce((a, c) => a + (isFilm(c) ? 0 : c.sizeBytes || 0), 0)
  // Ce que la page montre : elle n'est redessinée que si l'une de ces choses change
  const sigOf = () => { const c = Real.clipsCfg, l = Real.clipsLive, g = heroGame(c); return JSON.stringify([style(), c, l && [l.status, l.error, l.game], Real.st.settings?.cs2Live, cs2Here(), g?.id, heroArt(g), wallCovers().length, CLIPS.length, sessionClips(c).map((x) => x.id)]) }
  function syncPage() {
    if (!here() || !$('#cxRoot', el) || dragging || sigOf() === pageSig) return
    render()
  }

  /* Les réglages : les mêmes blocs dans les bulles du Viseur et dans la Régie */
  const swHTML = (k, on, label) => `<button class="sw" role="switch" data-sw="${k}" data-fk="sw-${k}" aria-checked="${!!on}" aria-label="${esc(label)}"><i></i></button>`
  const qualLine = (c) => (c.capture === 'chrome' ? (Settings.QUAL[c.quality] || Settings.QUAL.balanced)[1] : Settings.QUAL_ENGINE[c.quality] || Settings.QUAL_ENGINE.balanced)
  const fpsOf = (c) => qualLine(c).split(', ').find((x) => /images\/s/.test(x)) || ''
  const sKey = () => `<div class="cx-lst"><div class="cx-row"><span>Raccourci</span>${Settings.kcap('clip', 'cx-rk')}</div></div>`
  const sTrig = (c) => { const live = cs2Live(); return `<div class="cx-grp"><p class="cx-lab">Clips automatiques sur Counter-Strike 2</p>${live ? '' : '<p class="cx-note">Le suivi des matchs est coupé : seul le raccourci garde un clip. <button class="cx-lnk cx-inl" data-act="live">Activer le suivi</button></p>'}<div class="pills${live ? '' : ' cx-inert'}" role="group" aria-label="Moments gardés sur Counter-Strike 2"${live ? '' : ' inert'}>${Settings.TRIG.map(([k, l]) => `<button class="pill" data-trig="${k}" data-fk="t-${k}" aria-pressed="${!!c.triggers[k]}">${ic('check')}${l}</button>`).join('')}</div></div>` }
  const sDur = (c) => `<div class="cx-grp"><p class="cx-lab">Durée</p><div class="cx-lst">
    <label class="cx-row"><span class="kn">Avant</span><input type="range" min="5" max="120" step="1" value="${c.before}" data-r="before" data-fk="r-before" aria-label="Avant le moment"><span class="kv num" data-val="before"></span></label>
    <label class="cx-row"><span class="kn">Après</span><input type="range" min="0" max="30" step="1" value="${c.after}" data-r="after" data-fk="r-after" aria-label="Après le moment"><span class="kv num" data-val="after"></span></label></div>
    <p class="cx-note num" data-res></p></div>`
  const sQual = (c) => `<div class="cx-grp"><p class="cx-lab">Qualité</p><div class="cx-seg" role="radiogroup" aria-label="Qualité">${Object.entries(Settings.QUAL).map(([k, [n]]) => `<button role="radio" data-q="${k}" data-fk="q-${k}" aria-checked="${c.quality === k}" tabindex="${c.quality === k ? 0 : -1}">${n}</button>`).join('')}</div><p class="cx-note num">${qualLine(c)}</p></div>`
  const sSon = (c) => `<div class="cx-lst"><div class="cx-row"><span>Son du PC</span>${swHTML('gameAudio', c.gameAudio, 'Son du PC')}</div><div class="cx-row"><span>Micro</span>${swHTML('mic', c.mic, 'Micro')}</div></div>`
  const tail = (c) => { const used = usedBytes(), lim = (c.limitGb || 0) * 1024 ** 3; return `<div class="cx-tail"><div class="cx-store"><span class="cx-g"><i style="width:${lim ? Math.min(100, used / lim * 100) : 0}%"></i></span><span class="num">${used ? esc(Shared.steamUpdate.formatBytes(used)) : '0 Go'} sur ${c.limitGb} Go</span></div><button class="cx-lnk" data-act="all">${ic('gear')}Tous les réglages</button></div>` }
  const corners = '<i class="cx-c cx-c1"></i><i class="cx-c cx-c2"></i><i class="cx-c cx-c3"></i><i class="cx-c cx-c4"></i>'
  // Le style caméléon du jeu (comme l'Accueil), posé dans le HTML pour que le fondu ne rejoue pas à chaque dessin
  const gsAttrs = (g) => { const s = g ? GameStyle.now(g) : null; return s && s.style !== 'neutre' && s.accent ? ` data-gs="${esc(s.style)}" style="--gs-acc:${esc(s.accent)};--gs-on:${esc(s.onAccent)}"` : '' }
  function paintGs() {
    const host = $('.cx-gs', el); if (!host) return
    const g = G(host.dataset.gid) || GAMES.find((x) => x.id === host.dataset.gid); if (!g) return void GameStyle.paint(host, null)
    const s = GameStyle.now(g)
    if (s) GameStyle.paint(host, s); else GameStyle.of(g).then((s2) => { if (host.isConnected) GameStyle.paint(host, s2) }).catch(() => {})
  }
  // Les boutons d'un clip : « Regarder » (le vrai bouton caméléon du jeu) et « Copier pour Discord »
  const watchBtn = (c, label) => `<button class="play-btn" data-act="watch" data-id="${esc(c.id)}" data-fk="watch"><span class="pb-ring" aria-hidden="true"></span><span class="pb-in">${ic('play')}<span>${label}</span></span></button>`
  const copyBtn = (c) => `<button class="dk-b" data-act="copy" data-id="${esc(c.id)}" data-fk="copy">${ic('copy')}<span>Copier pour Discord</span></button>`
  const logPill = () => `<button class="cx-pill" data-act="log" data-fk="log">Copier le journal</button>`
  const POPS = { dur: 'Durée d’un clip', qual: 'Qualité', trig: 'Clips automatiques sur Counter-Strike 2', more: 'Plus de réglages' }
  // Une bulle (Viseur) : le bouton, et une place pour sa bulle, remplie seulement quand elle est ouverte
  const pw = (id, btn, up) => `<span class="cx-pw" data-pw="${id}"${up ? ' data-up="1"' : ''}>${btn}<div class="cx-slot"></div></span>`
  const popBtn = (id, cls, inner, aria = '', extra = '') => `<button class="${cls}" data-pop="${id}" data-fk="pop-${id}" aria-expanded="${pop === id}" aria-haspopup="dialog"${aria ? ` aria-label="${aria}"` : ''}${extra}>${inner}</button>`
  function popHTML(id, up) {
    const c = Real.clipsCfg, off = !c.enabled, dim = (h) => `<div class="cx-set${off ? ' cx-inert' : ''}"${off ? ' inert' : ''}>${h}</div>`
    const body = id === 'dur' ? sDur(c) : id === 'qual' ? sQual(c) : id === 'trig' ? sTrig(c)
      : !zeroNow() ? `${dim(`${cs2Here() ? sTrig(c) : ''}${sSon(c)}`)}${tail(c)}` : `<div class="cx-sm-only">${dim(sSon(c))}</div>${tail(c)}`
    return `<div class="cx-pop${up ? ' up' : ''}" role="dialog" aria-label="${POPS[id]}" data-pop-for="${id}"><div class="cx-set">${body}</div></div>`
  }
  const zeroNow = () => !CLIPS.length
  function paintPops() {
    // La bulle ouverte n'existe plus dans cette page (disposition changée) : on l'oublie, sinon le prochain Échap serait avalé
    if (pop && !$(`[data-pw="${pop}"]`, el)) pop = null
    $$('.cx-pw', el).forEach((w) => {
      const id = w.dataset.pw, open = pop === id, slot = $('.cx-slot', w)
      $('[data-pop]', w)?.setAttribute('aria-expanded', open)
      if (!open) { slot.innerHTML = ''; return }
      if (slot.firstElementChild) return
      slot.innerHTML = popHTML(id, w.dataset.up)
      paintDur(slot)
      $$('.cx-seg', slot).forEach((s) => Settings.bindSeg(s, (v) => save({ quality: v })))
    })
  }
  function openPop(id, focus = true) {
    pop = pop === id ? null : id; paintPops()
    if (!pop) return $(`[data-pop="${id}"]`, el)?.focus({ preventScroll: true })
    // Le focus entre dans la bulle : sur le choix en cours s'il y en a un (qualité), sinon sur le premier réglage visible
    if (focus) { const l = $$('.cx-pop input:not([disabled]), .cx-pop button:not([disabled])', el).filter((x) => !x.closest('[inert]') && (x.checkVisibility?.() ?? x.offsetParent)); (l.find((x) => x.getAttribute('aria-checked') === 'true' && x.getAttribute('role') === 'radio') || l[0])?.focus({ preventScroll: true }) }
  }
  function closePop(giveBack) {
    if (!pop) return
    const id = pop; pop = null; paintPops()
    if (giveBack) $(`[data-pop="${id}"]`, el)?.focus({ preventScroll: true })
  }
  // Les durées, la taille d'un clip et le dessin « ce qu'un clip garde » : mis à jour sur place pendant qu'un curseur glisse
  function paintDur(root) {
    const c = Real.clipsCfg; if (!c) return
    const be = c.before, af = c.after, mo = Settings.clipMo(c)
    const span = Math.max(66, be + af + 14), pct = (x) => x / span * 100, x = span - af - 7
    $$('[data-born]', root).forEach((e) => { e.innerHTML = `<i class="t"></i><i class="c" style="left:${pct(x - be)}%;width:${pct(be + af)}%"></i><span class="x" style="left:${pct(x)}%">${xm()}</span><span class="l b" style="left:calc(${pct(x)}% - 26px)">${be} s avant</span><span class="l" style="left:calc(${pct(x)}% + 26px)">${af} s après</span>` })
    $$('[data-val=before]', root).forEach((e) => { e.textContent = be + ' s' }); $$('[data-val=after]', root).forEach((e) => { e.textContent = af + ' s' })
    $$('[data-res]', root).forEach((e) => { e.textContent = `${be + af} s par clip, environ ${mo} Mo` })
    $$('[data-tot]', root).forEach((e) => { e.textContent = `${be + af} s` })
    $$('[data-split]', root).forEach((e) => { e.textContent = `${be} avant, ${af} après` })
    $$('input[type=range]', root).forEach((i) => { i.style.setProperty('--pct', ((i.value - i.min) / (i.max - i.min) * 100) + '%'); if (+i.value !== c[i.dataset.r] && c[i.dataset.r] != null && document.activeElement !== i) i.value = c[i.dataset.r] })
  }
  async function save(patch) {
    try { await Real.saveClips(patch); Settings.syncBar(); Settings.sync() } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 5000 }); render() }
  }
  async function camSet(on, b) {
    if (b?.getAttribute('aria-busy') === 'true') return
    b?.setAttribute('aria-busy', 'true')
    try { await Real.saveClips({ enabled: on }) } catch (e) { b?.removeAttribute('aria-busy'); render(); return toast(esc(errText(e)), { tone: 'warn', ms: 4000 }) }
    Settings.syncBar(); Settings.sync()
    if (b?.isConnected) b.removeAttribute('aria-busy')
  }
  const act = {
    all() { closePop(); Settings.open('rec') },
    log() { Settings.copyLog() },
    async live() { try { await Real.saveSettings({ cs2Live: true }); render() } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 5000 }) } },
    async retry(b) { b.disabled = true; await Real.loadClipsCfg().catch(() => null); Settings.syncBar(); render() },
    on(b) { camSet(true, b) },
    watch(b) { const c = CLIPS.find((x) => x.id === b.dataset.id); if (c) openClip(c, null) },
    copy(b) { const c = CLIPS.find((x) => x.id === b.dataset.id); if (c) copy(c, b) }
  }
  function onClick(e) {
    const t = e.target
    const a = t.closest('[data-act]'); if (a) return void act[a.dataset.act]?.(a)
    const s = t.closest('[data-sw]')
    if (s) { const on = s.getAttribute('aria-checked') !== 'true'; s.setAttribute('aria-checked', on); return void (s.dataset.sw === 'en' ? camSet(on, s) : save({ [s.dataset.sw]: on })) }
    const tr = t.closest('[data-trig]')
    if (tr) { const on = tr.getAttribute('aria-pressed') !== 'true'; tr.setAttribute('aria-pressed', on); return void save({ triggers: { ...Real.clipsCfg.triggers, [tr.dataset.trig]: on } }) }
    const po = t.closest('[data-pop]'); if (po) openPop(po.dataset.pop)
  }
  const fkOf = (n) => (n.closest('.cx-pop') ? 'pop|' : '') + (n.dataset.fk || (n.dataset.key ? 'kc-' + n.dataset.key : n.dataset.act ? 'act-' + n.dataset.act : n.classList.contains('ct-tile') ? 'tile:' + n.dataset.id : n.dataset.f ? 'f:' + n.dataset.f : n.id || ''))
  const fkFind = (sc, k) => (!k ? null : k.startsWith('pop|') ? fkFind($('.cx-pop', sc) || sc, k.slice(4)) : k.startsWith('act-') ? $(`[data-act="${CSS.escape(k.slice(4))}"]`, sc) : k.startsWith('tile:') ? $(`.ct-tile[data-id="${CSS.escape(k.slice(5))}"]`, sc) : k.startsWith('kc-') ? $(`.kc[data-key="${CSS.escape(k.slice(3))}"]`, sc) : k.startsWith('f:') ? $(`[data-f="${CSS.escape(k.slice(2))}"]`, sc) : $(`[data-fk="${CSS.escape(k)}"]`, sc) || $('#' + CSS.escape(k), sc))

  /* La liste : la même dans les deux styles */
  function libHTML(cfg, st) {
    const F = filters(); if (!F.some(([k]) => k === S.clipFilter)) S.clipFilter = 'all'
    const shown = CLIPS.filter(filt), g = heroGame(cfg)
    const live = st.k === 'rec' && g ? sessionClips(cfg) : null
    const liveShown = live ? live.filter(filt) : []
    const liveIds = new Set((live || []).map((c) => c.id))
    // Une session de jeu, un groupe : les clips d'un même match restent ensemble. Un film se range à la fin du groupe de sa partie
    // (même sessionId) ; les autres films ont leur groupe, en dernier.
    const groups = new Map()
    shown.forEach((c) => { if (isFilm(c) || liveIds.has(c.id)) return; const k = c.sessionId || `${c.gameId}:${new Date(c.at).toDateString()}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c) })
    const loose = []
    shown.filter(isFilm).forEach((f) => { if (f.sessionId && groups.has(f.sessionId)) groups.get(f.sessionId).push(f); else loose.push(f) })
    const filmCtl = (k, list) => {
      if (film.status === 'running' && list.some((c) => c.id === film.fromClipId)) return `<div class="cm-a" id="cmRun" role="group" tabindex="-1" aria-label="Film en cours de fabrication"><span class="cm-run">Film en cours</span><progress class="cm-bar" id="cmBar" max="100" value="${film.percent || 0}" aria-label="Avancement du film"></progress><b class="cm-pct num" id="cmPct">${film.percent || 0} %</b><button class="btn sm" id="cmStop">Arrêter</button></div>`
      if (pick) return ''
      // Lot A : un groupe dont le montage est gardé propose de le reprendre (à la place de « Monter un film »)
      const d = Editor.draftOf(k)
      return d ? `<div class="cm-a"><button class="cx-lnk cm-go is-draft" data-k="${esc(k)}">${ic('film')}<span>Reprendre le montage <em class="num">· ${d.n} plan${d.n > 1 ? 's' : ''}, ${fmtTime(d.totalS)}</em></span></button></div>`
        : `<div class="cm-a"><button class="cx-lnk cm-go" data-k="${esc(k)}">${ic('film')}<span>Monter un film</span></button></div>`
    }
    const bar = pick ? `<div class="cl-bar"><div class="cl-sel" role="group" aria-label="Clips choisis"><span id="clSelN" class="num" aria-live="polite"></span><button class="btn sm" id="clSelFilm">${ic('film')}Monter un film</button><button class="btn sm danger" id="clSelDel">${ic('trash')}Supprimer</button><button class="btn sm" id="clSelEnd">Terminé</button></div></div>`
      : `<div class="cl-bar"><div class="pills" role="group" aria-label="Filtrer">${F.map(([k, l]) => `<button class="pill" data-f="${esc(k)}" aria-pressed="${S.clipFilter === k}">${esc(l)}</button>`).join('')}</div><div class="cl-sel"><button class="cx-lnk" id="clSel">Sélectionner</button></div></div>`
    const liveG = live && (liveShown.length || S.clipFilter === 'all') ? `<section class="cm cx-live" aria-label="Partie en cours"><header class="cm-h"><span class="cm-cov" data-name="${esc(g.name)}"><img src="${esc(A(g.cover) === BLANK ? Real.coverPh(g.name) : A(g.cover))}" alt=""></span><div class="cm-t"><h2><i class="cx-dot" aria-hidden="true"></i>${esc(liveShown[0] ? whereOf(liveShown[0]) : g.name)}</h2><p>En cours</p></div></header>
        <div class="ct-grid">${liveShown.map(tile).join('')}${S.clipFilter === 'all' ? '<div class="ct-tile cx-wait"><span class="ct-frame">Le prochain arrive ici</span></div>' : ''}</div></section>` : ''
    const head = (a, k, list) => `<header class="cm-h">
          <span class="cm-cov" data-name="${esc(a.gameName)}"><img src="${esc(A(gameOf(a)?.cover) === BLANK ? Real.coverPh(a.gameName) : A(gameOf(a).cover))}" alt=""></span>
          <div class="cm-t"><h2>${esc(whereOf(a))}</h2><p>${[a.score ? `${a.score.us ?? a.score[0]}–${a.score.them ?? a.score[1]}` : '', a.mode ? Shared.cs2.modeLabel(a.mode) : a.map ? '' : '', T.timeAgo(a.at)].filter(Boolean).map(esc).join(', ')}</p></div>
          ${filmCtl(k, list)}
        </header>`
    const html = `<div class="cx-lib">${bar}${liveG}
      ${[...groups.entries()].map(([k, list]) => `<section class="cm">${head(list[0], k, list)}<div class="ct-grid">${list.map(tile).join('')}</div></section>`).join('')}
      ${loose.length ? `<section class="cm" aria-label="Films"><header class="cm-h"><span class="cm-cov cm-ico">${ic('film')}</span><div class="cm-t"><h2>Films</h2></div></header><div class="ct-grid">${loose.map(tile).join('')}</div></section>` : ''}
      ${!shown.length && !liveG ? `<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucun clip ici</h2><p>Aucun clip ne correspond à ce filtre.</p><button class="btn sm" id="clReset">Effacer le filtre</button></div>` : ''}</div>`
    return { html, groups }
  }
  function bindLib(sc, groups) {
    $$('.pill[data-f]', sc).forEach((b) => b.onclick = () => { S.clipFilter = b.dataset.f; render() })
    $('#clReset', sc)?.addEventListener('click', () => { S.clipFilter = 'all'; render() })
    $$('.cm-go', sc).forEach((b) => b.onclick = () => (b.classList.contains('is-draft') ? resumeFilm(b, b.dataset.k) : makeFilm(b, groups.get(b.dataset.k) || [], b.dataset.k)))
    $('#clSel', sc)?.addEventListener('click', () => { pick = new Set(); render(); $('.ct-tile', sc)?.focus({ preventScroll: true }) })
    $('#clSelEnd', sc)?.addEventListener('click', () => { pick = null; render(); $('#clSel', sc)?.focus({ preventScroll: true }) })
    $('#clSelDel', sc)?.addEventListener('click', () => { const l = CLIPS.filter((c) => pick?.has(c.id)); if (!l.length) return toast('Choisis d’abord des clips.', { ms: 2200 }); deleteMany(l) })
    $('#clSelFilm', sc)?.addEventListener('click', (e) => { const l = CLIPS.filter((c) => pick?.has(c.id)); if (!l.length) return toast('Choisis d’abord des clips.', { ms: 2200 }); makeFilm(e.currentTarget, l) })
    paintPick()
    $('#cmStop', sc)?.addEventListener('click', (e) => { e.currentTarget.setAttribute('aria-busy', 'true'); API.editFilmStop().catch((x) => toast(esc(errText(x)), { tone: 'warn', ms: 4000 })) })
    bindTiles(sc, (c, t) => openClip(c, t))
  }

  /* Le Viseur */
  const wallHTML = () => { const cv = wallCovers(); return cv.length < 4 ? '' : `<div class="cx-wall" aria-hidden="true">${Array.from({ length: 10 }, (_, c) => `<div>${Array.from({ length: 5 }, (_, r) => `<img src="${esc(cv[(c * 2 + r) % cv.length])}" alt="" loading="lazy" decoding="async" draggable="false">`).join('')}</div>`).join('')}</div>` }
  const errLine = (live) => `<p class="cx-kick cx-bad">${ic('warn')}<span>${esc(live?.error || 'La caméra est en panne.')}</span></p>`
  function pageB(cfg, st) {
    const live = Real.clipsLive, off = st.k === 'off', g = heroGame(cfg), zero = !CLIPS.length
    const dim = off ? ' cx-inert' : '', inert = off ? ' inert' : ''
    const q = Settings.QUAL[cfg.quality] || Settings.QUAL.balanced, nT = Settings.TRIG.filter(([k]) => cfg.triggers[k]).length, ctx = `cx cx-b cx-s-${st.k}`
    const gear = (up) => pw('more', popBtn('more', 'cx-chip ico', ic('gear'), 'Plus de réglages'), up)
    const down = !!(st.k === 'err')
    if (zero) {
      const art = st.k === 'rec' ? heroArt(g) : null
      const pic = art ? `<img src="${esc(art)}" alt="" decoding="async" draggable="false">` : wallHTML()
      const lead = st.k === 'ready' ? 'Elle démarre toute seule avec ton jeu.' : off ? 'Aucun clip n’est gardé.' : st.k === 'rec' ? `En cours${live?.game ? ` sur ${esc(live.game)}` : ''}. ${autoHere(cfg, g) ? 'Tes clips arriveront ici.' : `${keyHint(cfg)} : ce jeu ne garde rien tout seul.`}` : esc(live?.error || 'La caméra est en panne.')
      const tiles = 3 + (cs2Here() ? 1 : 0)
      const cs2Tile = !cs2Here() ? '' : pw('trig', popBtn('trig', 'cx-tile', `<span class="lab">Counter-Strike 2</span><span class="val">${!cs2Live() ? 'Suivi coupé' : nT ? `${nT} moment${nT > 1 ? 's' : ''}` : 'Aucun'}</span><span class="sub">${!cs2Live() ? 'Raccourci seulement' : nT > 1 ? 'Clips automatiques' : nT ? 'Clip automatique' : 'Raccourci seulement'}</span>`), 1)
      return { groups: new Map(), html: `<div class="${ctx} cx-full" id="cxRoot"><figure class="cx-vf cx-band" aria-label="Caméra">
        <div class="cx-pic${pic ? '' : ' cx-plain'}">${pic}</div>${corners}
        <div class="cx-top" style="justify-content:flex-end">${gear(0)}</div>
        <div class="cx-txt"><span class="cx-shw">${logo(`cx-shield${off ? ' dark' : ''}${st.k === 'rec' ? ' rec' : ''}`)}</span>
          <h1 class="cx-tt sw-t">${st.word}${swHTML('en', cfg.enabled, 'Caméra')}</h1><p class="cx-lead">${lead}</p>
          ${down ? `<div class="cx-acts">${logPill()}<button class="cx-lnk" data-act="all">${ic('gear')}Tous les réglages</button></div>` : ''}</div>
        <div class="cx-deck${dim}" style="--n:${tiles}"${inert}>
          <div class="cx-tile cx-tile-k"><span class="lab">Raccourci</span><span class="val">${Settings.kcap('clip', 'cx-tk')}</span><span class="sub">Dans tous tes jeux</span></div>
          ${pw('dur', popBtn('dur', 'cx-tile', '<span class="lab">Durée</span><span class="val num" data-tot></span><span class="sub num" data-split></span>'), 1)}
          ${pw('qual', popBtn('qual', 'cx-tile', `<span class="lab">Qualité</span><span class="val">${q[0]}</span><span class="sub num">${esc(fpsOf(cfg))}</span>`), 1)}
          ${cs2Tile}
          <div class="cx-side">${sSon(cfg)}</div>
        </div></figure></div>` }
    }
    // Avec des clips : un bandeau viseur, la liste dessous
    const last = lastClip(), sess = st.k === 'rec' ? sessionClips(cfg) : null
    const gameC = st.k === 'rec' ? g : gameOf(last)
    const img = (st.k === 'rec' ? (sess?.[0]?.thumbUrl || heroArt(g)) : null) || last.thumbUrl
    let txt
    if (st.k === 'rec') {
      const m = sess?.[0]?.map ? Shared.cs2.mapLabel(sess[0].map) : ''
      txt = `<p class="cx-kick">${esc(g?.name || live?.game || 'Partie en cours')}${m ? `, ${esc(m)}` : ''}</p><h1 class="cx-title">${sess.length ? `${sess.length} clip${sess.length > 1 ? 's' : ''} dans cette partie` : autoHere(cfg, g) ? 'Le prochain clip arrive ici' : keyHint(cfg)}</h1>
        ${sess.length ? `<div class="ht-acts">${watchBtn(sess[0], 'Regarder le dernier')}</div>` : ''}`
    } else {
      txt = `${down ? `<div class="cx-kickrow">${errLine(live)}${logPill()}</div>` : `<p class="cx-kick">Dernier ${wordOf(last)}, ${esc(T.timeAgo(last.at))}</p>`}<h1 class="cx-title">${esc(last.title || 'Clip')}</h1>
        <div class="ht-acts">${watchBtn(last, 'Regarder')}${copyBtn(last)}</div>`
    }
    const stChip = `<span class="cx-chip cx-st cx-s-${st.k}"><i class="cx-dot" aria-hidden="true"></i>${st.k === 'rec' ? 'Enregistre' : st.k === 'err' ? 'En panne' : 'Caméra'}${swHTML('en', cfg.enabled, 'Caméra')}</span>`
    const lib = libHTML(cfg, st)
    return { html: `<div class="${ctx}" id="cxRoot"><figure class="cx-vf cx-band cx-gs" data-gid="${esc(gameC?.id || '')}"${gsAttrs(gameC)} aria-label="Caméra">
      <div class="cx-pic"><img src="${esc(img)}" alt="" decoding="async" draggable="false" style="--pos:50% 42%"></div>${corners}
      <div class="cx-top">${stChip}
        <div class="cx-chips">
          <span class="${dim}"${inert}>${Settings.kcap('clip', 'cx-chip')}</span>
          ${pw('dur', popBtn('dur', `cx-chip${dim}`, '<span>Clips de <span class="num" data-tot></span></span>', '', inert))}
          ${pw('qual', popBtn('qual', `cx-chip${dim}`, `Qualité ${esc(q[0].toLowerCase())}`, '', inert))}
          ${gear(0)}
        </div></div>
      <div class="cx-txt">${txt}</div>
    </figure>${lib.html}</div>`, groups: lib.groups }
  }

  /* La Régie */
  function pageA(cfg, st) {
    const live = Real.clipsLive, off = st.k === 'off', dim = off ? ' cx-inert' : '', inert = off ? ' inert' : ''
    const zero = !CLIPS.length
    const con = `<aside class="cx-con" aria-label="Caméra">
      <div class="cx-master"><span class="cx-mk">${logoS()}</span><div><b>Caméra</b>${st.k === 'rec' ? '<span><i class="cx-dot" aria-hidden="true"></i>Enregistre</span>' : ''}</div>${swHTML('en', cfg.enabled, 'Caméra')}</div>
      ${st.k === 'err' ? `<div class="cx-merr"><p>${esc(live?.error || 'La caméra est en panne.')}</p>${logPill()}</div>` : ''}
      <div class="cx-body"><div class="cx-set${dim}"${inert}>${sKey()}${cs2Here() ? sTrig(cfg) : ''}${sDur(cfg)}${sQual(cfg)}${sSon(cfg)}</div></div>
      <footer class="cx-foot">${tail(cfg)}</footer></aside>`
    if (!zero) { const lib = libHTML(cfg, st); return { html: `<div class="cx cx-a cx-s-${st.k}" id="cxRoot">${con}<div class="cx-rlib">${lib.html}</div></div>`, groups: lib.groups } }
    const lead = off ? 'La caméra est coupée.' : st.k === 'rec' && !autoHere(cfg, heroGame(cfg)) ? `${keyHint(cfg)} : ce jeu ne garde rien tout seul.` : 'Joue, ils arriveront ici.'
    const sub = cs2Here() ? `Un kill sur Counter-Strike 2, ou ${esc(Shared.hotkey.hotkeyText(cfg.hotkey))} dans n’importe quel jeu.` : `${esc(Shared.hotkey.hotkeyText(cfg.hotkey))} dans n’importe quel jeu.`
    return { groups: new Map(), html: `<div class="cx cx-a cx-s-${st.k}" id="cxRoot">${con}<div class="cx-rlib cx-empty"><div class="cx-mid"><h1 class="cx-tt">Aucun clip</h1><p class="cx-lead">${lead}</p>
      ${off ? `<div class="cx-off2"><button class="cx-pill" data-act="on" data-fk="on">Allumer la caméra</button></div>` : `<div class="cx-borncard"><div class="cx-born" data-born></div><p class="cx-note">${sub}</p></div>`}</div>
      <div class="cx-here" aria-hidden="true"><div><i class="cx-ghost"></i><i class="cx-ghost"></i><i class="cx-ghost"></i><i class="cx-ghost"></i></div></div></div></div>` }
  }
  const downHTML = () => `<div class="cx cx-b cx-down" id="cxRoot"><div class="empty"><h2>Enregistrement indisponible</h2><p>Le moteur d’enregistrement n’a pas répondu. Réessaie, ou relance Player X si ça continue.</p><button class="cx-pill" data-act="retry" data-fk="retry">${ic('refresh')}Réessayer</button></div></div>`
  async function boot() {
    if (!API.clipsGetSettings) return
    const [cfg, live, list] = await Promise.all([API.clipsGetSettings().catch(() => null), API.clipsState().catch(() => null), API.clipsList().catch(() => [])])
    Real.clipsCfg = cfg; Real.clipsLive = live; CLIPS = list || []
    if (live?.status === 'recording') seenSince = Date.now()
    if (API.editFilmState) { film = (await API.editFilmState().catch(() => null)) || film; API.onEditFilm(onFilm) }
    API.onClipsChanged(async () => {
      const before = new Set(CLIPS.map((c) => c.id))
      CLIPS = await API.clipsList().catch(() => CLIPS)
      const fresh = CLIPS.filter((c) => !before.has(c.id))
      // Un film qui arrive a son propre message (onFilm) : « Clip gardé » ne vaut que pour un clip
      if (fresh.length) { Bar.dot(S.view !== 'clips'); if (S.session && fresh.some((c) => !isFilm(c))) toast(`${xm()} Clip gardé`, { ms: 1600 }) }
      // Un montage ouvert : le brouillon est gardé et les plans dont le clip a disparu sont repeints
      Editor.sync()
      if (S.view === 'clips' && !S.gameId && !player) render()
    })
    // Un problème se dit une fois : pas de nouvelle alerte tant que c'est le même
    let lastErr = live?.error || ''
    // Bêta 46 : le rythme des clips se dit une fois, quand la partie finit (jamais pendant), et seulement s'il y a un souci
    let paceAt = live?.lastGame?.at || 0
    API.onClipsState((s) => {
      Real.clipsLive = s; seenSince = s.status === 'recording' ? seenSince || Date.now() : 0; Settings.sync(); syncPage()
      if (s.error && s.error !== lastErr) toast(esc(s.error), { tone: 'warn', ms: 7000, action: { label: 'Voir les réglages', fn: () => Settings.open('rec') } })
      lastErr = s.error || ''
      if (s.lastGame && s.lastGame.at > paceAt) {
        paceAt = s.lastGame.at
        const slow = Shared.clipPace.gamePaceAlert(s.lastGame)
        if (slow) toast(esc(slow), { tone: 'warn', ms: 9000, action: { label: 'Voir les réglages', fn: () => Settings.go('rec', 'r-capm') } })
      }
    })
    Real.applyGames()
    Real.on('games', syncPage); Real.on('settings', syncPage)
    GameStyle.onChange(() => { if (here()) paintGs() })
  }
  // Fabrication d'un film : l'avancement se met à jour sur place (la liste n'est pas redessinée, les vignettes ne sautent pas) ;
  // la fin, l'arrêt et l'échec se disent une fois, où que l'on soit dans l'appli
  function onFilm(s) {
    const was = film; film = s
    if (s.status === 'running' && was.status === 'running' && $('#cmPct')) {
      $('#cmPct').textContent = `${s.percent || 0} %`; $('#cmBar').value = s.percent || 0
      return
    }
    // Le montage gardé s'efface quand son film est prêt ; un film arrêté ou raté le laisse (sans la marque « en fabrication »)
    if (s.status === 'done') Editor.filmDone(s)
    else if (s.status === 'stopped' || s.status === 'failed') Editor.filmUndone(s)
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
  // groupKey : la clé du groupe d'où il part (null : une sélection). Le montage est gardé sous cette clé (« Reprendre le montage »).
  const afterEditor = () => { render(); ($('#cmRun') || $('.cm-go') || $('.ct-tile'))?.focus({ preventScroll: true }) }
  async function makeFilm(b, list, groupKey = null) {
    if (b?.getAttribute('aria-busy')) return
    const clips = list.filter((c) => !isFilm(c))
    if (!clips.length) return toast('Choisis au moins un clip (pas un film).', { ms: 2600 })
    b?.setAttribute('aria-busy', 'true')
    pick = null
    await Editor.open(clips.map((c) => c.id), el, afterEditor, groupKey)
    b?.removeAttribute('aria-busy')
  }
  async function resumeFilm(b, groupKey) {
    if (b?.getAttribute('aria-busy')) return
    b?.setAttribute('aria-busy', 'true')
    pick = null
    const ok = await Editor.resume(groupKey, el, afterEditor)
    b?.removeAttribute('aria-busy')
    if (!ok) render()
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
    el.addEventListener('click', onClick)
    el.addEventListener('input', (e) => { const r = e.target.closest?.('input[data-r]'); if (!r || !Real.clipsCfg) return; Real.clipsCfg[r.dataset.r] = +r.value; paintDur(el) })
    el.addEventListener('change', (e) => { const r = e.target.closest?.('input[data-r]'); if (!r) return; dragging = false; save({ [r.dataset.r]: +r.value }) })
    el.addEventListener('pointerdown', (e) => { if (e.target.closest?.('input[type=range]')) dragging = true })
    // Une image qui ne charge pas s'enlève : l'écran reste sombre, rien ne casse
    el.addEventListener('error', (e) => { const i = e.target; if (i?.tagName === 'IMG' && i.closest('.cx-pic')) i.remove() }, true)
    document.addEventListener('pointerup', () => { dragging = false }); document.addEventListener('pointercancel', () => { dragging = false })
    // Une bulle se ferme d'un clic dehors (le focus revient au bouton, sauf si on a cliqué sur autre chose qui le prend) et d'Échap
    document.addEventListener('click', (e) => { const t = e.target instanceof Element ? e.target : null; if (!pop || !here() || !t?.isConnected || t.closest('.cx-pw')) return; closePop(!t.closest('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])')) })
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !pop || !here() || el.querySelector('.kc.wait') || document.querySelector('[data-modal]:not([hidden]), dialog[open]')) return
      e.preventDefault(); e.stopPropagation(); closePop(true)
    }, true)
  }
  const filters = () => {
    const games = [...new Map(CLIPS.map((c) => [c.gameId, c.gameName])).entries()].slice(0, 4).map(([rid, n]) => ['g:' + rid, Real.byRid(rid)?.short || n])
    return [['all', 'Tout'], ['star', 'Favoris'], ...(CLIPS.some(isFilm) ? [['film', 'Films']] : []), ...(games.length > 1 ? games : [])]
  }
  function filt(c) {
    const f = S.clipFilter
    if (f === 'all') return true
    if (f.startsWith('g:')) return c.gameId === f.slice(2)
    if (f === 'film') return isFilm(c)
    if (f === 'star') return c.pinned
    return true
  }
  function tile(c) {
    const sel = pick ? ` is-pick" aria-pressed="${pick.has(c.id)}` : ''
    return `<button class="ct-tile${sel}" data-id="${esc(c.id)}" aria-label="${esc(c.title || 'Clip')}, ${Math.round(c.durationS)} secondes">
      <span class="ct-frame">${pick ? `<span class="ct-chk">${ic('check')}</span>` : ''}<img src="${esc(c.thumbUrl)}" alt="" loading="lazy" decoding="async" draggable="false" data-fb="1"><i class="ct-shade"></i>
        <span class="ct-time num">${fmtTime(c.durationS)}</span><span class="ct-flags">${isFilm(c) ? `<span class="ct-film">${ic('film')}</span>` : ''}${c.pinned ? `<span class="ct-star">${ic('starf')}</span>` : ''}</span>
      </span>
      <span class="ct-t"><b>${esc(c.title || 'Clip')}</b><span>${esc(isFilm(c) ? T.capitalize(T.timeAgo(c.at)) : [slowOf(c), noteOf(c) || whereOf(c)].filter(Boolean).join(' · '))}</span></span>
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
  function render(o = {}) {
    const sc = $('#clipScroll', el), cfg = Real.clipsCfg
    // Ce qui doit survivre au dessin : le focus, le défilement, une fabrication de film en cours
    const act0 = document.activeElement; let fk = act0 && sc.contains(act0) ? fkOf(act0) : null
    const hadRun = !!act0?.closest?.('#cmRun'), hadStop = act0?.id === 'cmStop'
    const ys = [sc.scrollTop, $('.cx-rlib', sc)?.scrollTop || 0, $('.cx-body', sc)?.scrollTop || 0]
    // Une capture de raccourci commencée sur cette page s'abandonne avec le dessin ; celle des Paramètres (ouverts par-dessus) continue
    if ($('.kc.wait', sc)) Settings.cancelKey()
    const st = recState(cfg), a = style(), zero = !CLIPS.length
    // Caméra coupée : une bulle de réglage (sauf « Plus de réglages ») devient inerte, on la ferme, et le focus qui s'y trouvait revient à l'interrupteur
    if (st.k === 'off' && pop && pop !== 'more') { pop = null; if (act0?.closest?.('.cx-pw:not([data-pw="more"])')) fk = 'sw-en' }
    let out
    if (!cfg) { const lib = CLIPS.length ? libHTML(null, st) : null; out = { html: `${downHTML()}${lib ? `<div class="cx cx-b">${lib.html}</div>` : ''}`, groups: lib?.groups || new Map() } }
    else out = a === 'a' ? pageA(cfg, st) : pageB(cfg, st)
    sc.classList.toggle('cx-sc-a', !!cfg && a === 'a'); sc.classList.toggle('cx-sc-b', !cfg || a === 'b'); sc.classList.toggle('cx-sc-full', !!cfg && a === 'b' && zero)
    sc.innerHTML = out.html
    pageSig = sigOf()
    $$('.cx-seg', sc).forEach((s) => Settings.bindSeg(s, (v) => save({ quality: v })))
    Settings.bindKc(sc)
    paintPops(); paintDur(sc); paintGs()
    bindLib(sc, out.groups)
    sc.scrollTop = ys[0]; const rl = $('.cx-rlib', sc), bd = $('.cx-body', sc); if (rl) rl.scrollTop = ys[1]; if (bd) bd.scrollTop = ys[2]
    // La fabrication vient de finir, son bloc a disparu : le focus revient sur un bouton de la liste. Tant qu'elle dure, il y reste.
    if (hadRun) ((hadStop && $('#cmStop', sc)) || $('#cmRun', sc) || $('.cm-go', sc) || $('.ct-tile', sc))?.focus({ preventScroll: true })
    else if (fk) fkFind(sc, fk)?.focus({ preventScroll: true })
  }

  function paintPick() {
    const n = pick ? pick.size : 0, el2 = $('#clSelN'); if (el2) el2.textContent = n ? `${n} choisi${n > 1 ? 's' : ''}` : 'Touche les clips à choisir'
  }

  // Lecteur
  function openClip(c, fromTile) {
    Settings.cancelKey()
    const shared = fromTile && $('.ct-frame', fromTile)
    if (shared) shared.style.viewTransitionName = 'clip-frame'
    vt(() => {
      if (shared) shared.style.viewTransitionName = ''
      paintPlayer(c)
    }, { done: () => $('#cpShare')?.focus({ preventScroll: true }) })
  }
  function paintPlayer(c) {
    Settings.cancelKey()
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
        ${slowOf(c) ? `<p class="cp-det cp-slow">${esc(slowOf(c))}</p>` : ''}
        <button class="cx-pill cp-share" id="cpShare">${ic('copy')}<span>Copier pour Discord</span></button>
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
  // Le fichier lui-même dans le presse-papiers : Ctrl V dans Discord l'envoie tel quel.
  // Bêta 46 : il doit passer sous la limite du compte Discord (Paramètres, Mon Discord). Un fichier trop lourd est copié en
  // plus léger : la copie se fabrique à côté, l'original ne change pas, et le bouton suit la fabrication. `original` : le
  // fichier d'origine quel que soit son poids (proposé quand la copie légère n'a pas pu se faire).
  const maxText = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`)
  async function copy(c, b, { original = false } = {}) {
    if (b.getAttribute('aria-busy')) return
    const lab = $('span', b) || b, old = lab.textContent
    const size = (n) => esc(Shared.steamUpdate.formatBytes(n || 0))
    b.setAttribute('aria-busy', 'true'); lab.textContent = 'Copie…'
    const off = original ? null : API.onClipsShare?.((s) => { if (s.id === c.id) lab.textContent = `Préparation… ${s.percent} %` })
    try {
      const r = /** @type {Awaited<ReturnType<typeof API.clipsShare>>} */ (original || !API.clipsShare ? ((await API.clipsCopyFile(c.id)) ? { status: 'copied', sizeBytes: c.sizeBytes, limitMb: 0 } : { status: 'failed' }) : await API.clipsShare(c.id))
      if (r.status === 'failed') throw new Error(`Le ${wordOf(c)} n’a pas pu aller dans le presse-papiers. Ouvre le dossier et glisse le fichier dans Discord.`)
      if (r.status === 'copied') {
        lab.textContent = 'Prêt : Ctrl V dans Discord'
        if (r.reduced) toast(`${ic('check')} Copie légère dans le presse-papiers : ${size(r.sizeBytes)}, ${r.reduced.width} × ${r.reduced.height}, ${r.reduced.fps} images/s`, { ms: 6000, action: { label: 'Mon Discord', fn: () => Settings.go('rec', 'r-disc') } })
        else toast(`${ic('check')} ${isFilm(c) ? 'Film' : 'Clip'} dans le presse-papiers, ${size(r.sizeBytes)}`, { ms: 2400 })
        setTimeout(() => { if (lab.isConnected) lab.textContent = old }, 2600)
      } else {
        // Rien n'a été copié : on dit pourquoi, et l'original reste à un clic
        lab.textContent = old
        const why = r.status === 'too-long' ? `Trop long pour ${r.limitMb} Mo : ${maxText(r.maxS)} au plus. ${isFilm(c) ? 'Refais-le plus court' : 'Raccourcis-le'}, ou copie l’original (${size(r.sizeBytes)}).`
          : `${r.reason === 'engine' ? 'Moteur vidéo absent ou modifié : pas de copie légère' : 'La copie légère n’a pas pu être fabriquée'}. L’original pèse ${size(r.sizeBytes)}, pour ${r.limitMb} Mo acceptés.`
        toast(why, { tone: 'warn', ms: 12000, action: { label: 'Copier l’original', fn: () => copy(c, b, { original: true }) } })
      }
    } catch (e) { lab.textContent = old; toast(esc(errText(e)), { tone: 'warn', ms: 5000 }) }
    off?.(); b.removeAttribute('aria-busy')
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
      // Un autre clip a été ouvert pendant la fermeture (Clips.open) : son lecteur est déjà peint, on ne le vide pas
      if (player) return
      $('#cp', el).hidden = true; $('#cp', el).innerHTML = ''; $('#clipScroll', el).style.visibility = ''
      leaveBar()
      Fluid.set(['#120a10', '#3a0f1c', '#b3112f', '#5a1420'])
      render()
    }, { done: () => ($(`.ct-tile[data-id="${CSS.escape(pc.id)}"]`, el) || $('.ct-tile', el) || $('.pill', el))?.focus({ preventScroll: true }) })
  }
  /* L'onglet Clips de la fiche d'un jeu */
  function gameTab(g, b) {
    const list = CLIPS.filter((c) => c.gameId === g.rid), cfg = Real.clipsCfg
    const on = !!cfg?.enabled
    b.innerHTML = list.length ? `<div class="ct-grid">${list.slice(0, 12).map(tile).join('')}</div>` : `<div class="empty"><span class="empty-x">${xm()}</span><h2>Pas encore de clip sur ce jeu</h2><p>${!on ? 'La caméra est coupée.' : g.id === 'cs2' ? 'Joue un match : chaque kill garde son clip tout seul.' : `En jeu, appuie sur ${esc(Shared.hotkey.hotkeyText(cfg.hotkey))} pour garder les dernières secondes.`}</p>${cfg && !on ? `<button class="cx-pill" id="gbOn">Allumer la caméra</button>` : ''}</div>`
    $('#gbOn', b)?.addEventListener('click', async (e) => { await camSet(true, e.currentTarget); if (b.isConnected && Real.clipsOn()) gameTab(g, b) })
    bindTiles(b, (c) => { const back = { game: g.id, prev: S.prevView }; S.gameId = null; openById(c.id, back) })
  }
  const openById = (id, back = null) => { const c = CLIPS.find((x) => x.id === id); if (!c) return; ret = null; go('clips'); setTimeout(() => { ret = back; paintPlayer(c) }, 320) }
  function onLeaveNow() { if (player) { leavePlayer(); $('#cp', el).hidden = true; $('#cp', el).innerHTML = ''; $('#clipScroll', el).style.visibility = ''; leaveBar() } }
  return {
    boot, mount, open: openById, close, playerToggle, copy, gameTab, sizeLabel, style, setStyle,
    isOpen: () => !!player,
    tileHTML: tile,
    // Les clips gardés pendant une session de jeu (un film fabriqué après coup n'en fait pas partie)
    between,
    onEnter() { if (!player && !Editor.isOpen()) { render({ enter: true }); Fluid.set(['#120a10', '#3a0f1c', '#b3112f', '#5a1420']) } Bar.dot(false) },
    onLeave() { ret = null; pick = null; pop = null; Settings.cancelKey(); if (Editor.isOpen()) { Editor.sync(); Editor.close() } onLeaveNow() }
  }
})()
