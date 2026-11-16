// Bibliothèque, fiche du jeu (comme une page d'album) et Amis, sur les vraies données de Player X
const Pages = (() => {
  let host
  const T = Shared.text, SU = Shared.steamUpdate
  const nGames = (n) => `${n} jeu${n > 1 ? 'x' : ''}`
  const visible = () => GAMES.filter((g) => !g.hidden)
  // Les collections du vrai carnet, gardées sur ce PC
  const cols = () => (Real.st.shelves?.collections || []).map((c) => ({ id: c.id, n: c.name, rids: c.games, g: c.games.map(Real.byRid).filter(Boolean) }))

  // Nommer une collection et y ranger des jeux : deux champs, moins de dix secondes, donc une feuille qui garde la page derrière
  function colPanel(col, preset) {
    const back = document.activeElement, picked = new Set(col ? col.rids : preset ? [preset] : [])
    const el = h(`<div id="pn" data-modal><div class="pn-scrim" id="pnS"></div><form class="pn" role="dialog" aria-modal="true" aria-labelledby="pnT" novalidate>
      <header class="pn-h"><h2 id="pnT">${col ? `Modifier « ${esc(col.n)} »` : 'Nouvelle collection'}</h2><button type="button" class="btn sm icon" id="pnX" aria-label="Fermer" data-tip="Fermer, Échap" data-tip-b data-tip-r>${ic('close')}</button></header>
      <div class="pn-b">
        <div class="at-f"><label for="pnN">Nom</label><input class="at-i" id="pnN" maxlength="${Shared.shelves.MAX_NAME}" autocomplete="off" placeholder="Soirée entre potes" required><p class="at-err" id="pnE" role="alert" hidden></p></div>
        <fieldset class="pn-g"><legend>Jeux<span id="pnC"></span></legend><div class="pn-grid">${GAMES.map((g) => `<button type="button" class="pn-t" data-g="${esc(g.rid)}" data-name="${esc(g.name)}" aria-pressed="${picked.has(g.rid)}"><img src="${esc(A(g.cover))}" alt="" loading="lazy" decoding="async" draggable="false"><span>${esc(g.short || g.name)}</span><i>${ic('check')}</i></button>`).join('')}</div></fieldset>
      </div>
      <footer class="pn-f"><button type="button" class="btn sm" id="pnNo">Annuler</button><button type="submit" class="btn sm rose" id="pnOk">${col ? 'Enregistrer la collection' : 'Créer la collection'}</button></footer>
    </form></div>`)
    $('#win').append(el)
    const nm = $('#pnN', el), err = $('#pnE', el)
    nm.value = col ? col.n : ''
    const count = () => { $('#pnC', el).textContent = picked.size ? `${picked.size} choisi${picked.size > 1 ? 's' : ''}` : 'Aucun pour l’instant' }
    const problem = () => { const v = nm.value.trim(); if (!v) return 'Donne un nom, par exemple « Soirée entre potes ».'; return cols().some((c) => c.id !== col?.id && c.n.toLowerCase() === v.toLowerCase()) ? `« ${v} » existe déjà : choisis un autre nom.` : '' }
    const show = (m) => { err.textContent = m; err.hidden = !m; if (m) { nm.setAttribute('aria-invalid', 'true'); nm.setAttribute('aria-describedby', 'pnE') } else { nm.removeAttribute('aria-invalid'); nm.removeAttribute('aria-describedby') } }
    let keepErr = false, gone = false, busy = false
    nm.onblur = () => { if (!gone) show(problem()) }; nm.onfocus = () => { if (!keepErr) show('') }; nm.oninput = () => show('')
    $$('.pn-t', el).forEach((b) => b.onclick = () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); if (on) picked.add(b.dataset.g); else picked.delete(b.dataset.g); count() })
    const close = (focus) => { if (gone) return; gone = true; el.classList.remove('on'); setTimeout(() => { el.remove(); giveFocus(focus?.isConnected ? focus : back) }, 200) }
    // Un clic sur Annuler ne doit pas d'abord faire apparaître l'erreur du champ qu'on quitte
    for (const id of ['#pnX', '#pnNo']) { const b = $(id, el); b.onpointerdown = () => { gone = true }; b.onclick = () => { gone = false; close() } }
    $('#pnS', el).onclick = () => close()
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } })
    $('form', el).onsubmit = async (e) => {
      e.preventDefault()
      if (busy) return
      const m = problem()
      if (m) { show(m); keepErr = true; nm.focus(); keepErr = false; return }
      const name = nm.value.trim(), inLib = S.view === 'lib', ok = $('#pnOk', el)
      busy = true; ok.setAttribute('aria-busy', 'true')
      try {
        let id = col?.id
        if (col) {
          if (name !== col.n) await API.renameCollection(id, name)
          for (const rid of col.rids) if (!picked.has(rid)) await API.setInCollection(id, rid, false)
          for (const rid of picked) if (!col.rids.includes(rid)) await API.setInCollection(id, rid, true)
        } else {
          const had = new Set(cols().map((c) => c.id))
          const s = await API.createCollection(name)
          id = s.collections.find((c) => !had.has(c.id))?.id
          for (const rid of picked) await API.setInCollection(id, rid, true)
        }
        await Real.refreshShelves()
        if (inLib) { S.libFilter = 'col:' + id; renderLib() }
        close(inLib ? $('.lb-col.on', host) : back)
        toast(`${ic('check')} Collection « ${esc(name)} » enregistrée, ${nGames(picked.size)}`, { ms: 2400 })
      } catch (x) {
        console.error(x); busy = false; ok.removeAttribute('aria-busy')
        show('La collection n’a pas pu être enregistrée. Réessaie.')
      }
    }
    count()
    el.hidden = false; void el.offsetWidth; el.classList.add('on')
    nm.focus({ preventScroll: true })
  }
  function mount(h0) {
    host = h0
    Clips.mount(host)
    for (const [v, l] of [['lib', 'Bibliothèque'], ['game', 'Fiche'], ['stats', 'Stats'], ['friends', 'Amis']]) host.append(h(`<section class="v v-${v}" data-v="${v}" hidden aria-label="${l}" tabindex="-1"><div class="scroll" id="sc-${v}"></div></section>`))
  }
  // Les données changent toutes seules : on repeint sans perdre le focus ni la position
  function refresh(v) {
    if (document.querySelector('#pn')) return
    const a = document.activeElement, key = a?.dataset?.id || a?.dataset?.f, sc = $(`#sc-${v}`), y = sc?.scrollTop
    enter(v, true)
    if (sc) sc.scrollTop = y
    if (key && a !== document.activeElement) sc?.querySelector(`[data-id="${CSS.escape(key)}"],[data-f="${CSS.escape(key)}"]`)?.focus({ preventScroll: true })
  }
  // soft : un simple rafraîchissement des données (refresh), pas une arrivée sur la page
  function enter(v, soft) {
    if (v !== 'clips') Clips.onLeave()
    if (v === 'clips') Clips.onEnter()
    if (v === 'lib') renderLib(soft)
    if (v === 'stats') StatsPage.render()
    if (v === 'friends') renderFriends()
    if (v === 'game') renderGame()
  }

  /* ---------- Bibliothèque ---------- */
  const LIB_NOTE = {
    'no-account': ['Relie ton compte Steam pour voir aussi tes jeux pas installés.', 'Connecter Steam'],
    'no-key': ['Ajoute ta clé Steam Web API pour voir aussi tes jeux pas installés.', 'Ajouter la clé'],
    'key-refused': ['Steam refuse ta clé Web API : vérifie-la pour voir tes jeux pas installés.', 'Vérifier la clé'],
    private: ['Rends les détails de tes jeux publics sur Steam pour voir ceux qui ne sont pas installés.', 'Voir mes comptes'],
    offline: ['Steam ne répond pas : tes jeux pas installés reviendront tout seuls.', '']
  }
  const reportRows = () => (Real.st.report || []).map((r) => `<li><b>${esc({ steam: 'Steam', epic: 'Epic Games', ea: 'EA app', gog: 'GOG' }[r.store] || r.store)}</b><span>${esc(r.error ? `Erreur : ${r.error}` : r.found ? nGames(r.found) : r.absent ? 'Pas trouvé sur ce PC' : 'Aucun jeu')}</span>${r.checked.length ? `<code>${r.checked.map(esc).join('<br>')}</code>` : ''}</li>`).join('')
  async function rescan(btn) {
    if (btn?.getAttribute('aria-busy')) return
    btn?.setAttribute('aria-busy', 'true')
    const lab = btn && ($('b', btn) || btn), old = lab?.textContent
    if (lab) lab.textContent = 'Recherche…'
    try {
      await Real.scan()
      const n = GAMES.filter((g) => g.installed).length
      toast(n ? `${ic('check')} ${nGames(n)} sur ce PC` : 'Aucun jeu trouvé sur ce PC. Regarde les dossiers examinés.', { ms: 3200 })
    } catch (e) { console.error(e); toast('La recherche n’a pas abouti. Réessaie.', { tone: 'warn', ms: 4000 }) }
    if (btn?.isConnected) { btn.removeAttribute('aria-busy'); if (lab) lab.textContent = old }
  }
  // La bibliothèque se rafraîchit à chaque nouvelle liste de jeux (toutes les 20 s pendant un téléchargement Steam) :
  // rien ne bouge si ce qu'elle montre n'a pas changé, et une tuile dont seule la progression change est mise à jour en place.
  // En arrivant sur la page (soft absent), elle est toujours redessinée, comme avant.
  let libShell = null, libTiles = new Map(), libCol = null
  // Dans la trame de la page, chaque tuile est une marque (son id entre deux \u0000) ; dans une tuile, \u0001 marque la bande de mise à jour
  const TILE_AT = (id) => `\u0000${id}\u0000`, UPD_AT = '\u0001'
  function renderLib(soft = false) {
    Fluid.set(['#120c1c', '#3a1540', '#a81c50', '#2f1a5c'])
    const sc = $('#sc-lib'), C = cols()
    if (S.libFilter.startsWith('col:') && !C.some((c) => c.id === S.libFilter.slice(4))) S.libFilter = 'all'
    const f = S.libFilter, col = f.startsWith('col:') ? C.find((c) => c.id === f.slice(4)) : null, vis = visible()
    const pick = vis.filter((g) => f === 'all' || (f === 'fav' && g.fav) || (col && col.rids.includes(g.rid)))
    const inst = pick.filter((g) => g.installed), rest = pick.filter((g) => !g.installed), favs = vis.filter((g) => g.fav)
    const lib = Real.st.library, note = lib && LIB_NOTE[lib.state]
    const fan = (list) => `<span class="lb-fan">${list.slice(0, 3).map((g, i) => `<img src="${esc(A(g.cover))}" alt="" style="--i:${i}">`).join('')}</span>`
    libCol = col
    const tiles = new Map(pick.map((g) => [g.id, { base: tile(g, UPD_AT), upd: updOf(g) }]))
    const grid = (list) => list.map((g) => TILE_AT(g.id)).join('')
    const shell = `<header class="pg-head"><div><h1 class="pg-title">Bibliothèque</h1></div>${searchBtn()}</header>
      ${GAMES.length ? `<div class="lb-cols" role="group" aria-label="Collections">
        <button class="lb-col ${f === 'all' ? 'on' : ''}" data-f="all">${fan(vis)}<span><b>Tout</b><i>${nGames(vis.length)}</i></span></button>
        <button class="lb-col ${f === 'fav' ? 'on' : ''}" data-f="fav">${fan(favs)}<span><b>Favoris</b><i>${nGames(favs.length)}</i></span></button>
        ${C.map((c) => `<button class="lb-col ${f === 'col:' + c.id ? 'on' : ''}" data-f="col:${esc(c.id)}">${fan(c.g)}<span><b>${esc(c.n)}</b><i>${nGames(c.g.length)}</i></span></button>`).join('')}
        <button class="lb-col is-new" id="lbNew"><span class="lb-plus">${ic('plus')}</span><span><b>Créer une collection</b></span></button>
      </div>` : ''}
      ${col ? `<div class="lb-ca"><button class="btn sm" id="lbEdit">Modifier la collection</button><button class="btn sm" id="lbDel">Supprimer la collection</button></div>` : ''}
      ${!GAMES.length ? `<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucun jeu détecté</h2><p>Player X cherche les jeux installés avec Steam, Epic Games, l’EA app et GOG sur ce PC.</p><div class="at-e2"><button class="btn sm rose" id="lbRescan"><b>Relancer la recherche</b></button></div>${reportRows() ? `<details class="lb-rep"><summary>Voir les dossiers examinés</summary><ul>${reportRows()}</ul></details>` : ''}</div>` : ''}
      ${GAMES.length && !pick.length ? `<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucun jeu ici</h2><p>Mets un jeu en favori ou range-le dans cette collection pour le retrouver ici.</p><button class="btn sm" id="lbAll">Afficher tous mes jeux</button></div>` : ''}
      ${inst.length ? `<div class="lb-grid">${grid(inst)}${f === 'all' ? `<button class="lb-t lb-scan" id="lbScan"><span class="lb-c lb-ghost">${ic('refresh')}<b>Chercher mes jeux</b></span></button>` : ''}</div>` : ''}
      ${rest.length ? `<h2 class="lb-h">Pas installés sur ce PC</h2><div class="lb-grid">${grid(rest)}</div>` : ''}
      ${note && f === 'all' && GAMES.length ? `<div class="lb-note">${ic('info')}<p>${esc(note[0])}</p>${note[1] ? `<button class="btn sm" id="lbAcc">${esc(note[1])}</button>` : ''}</div>` : ''}`
    if (soft && shell === libShell && sc.firstElementChild) {
      for (const [id, t] of tiles) { const was = libTiles.get(id); if (was.base !== t.base) swapTile(sc, id, t); else if (was.upd !== t.upd) swapUpd(sc, id, t.upd) }
      libTiles = tiles
      return
    }
    libShell = shell; libTiles = tiles
    sc.innerHTML = shell.replace(/\u0000([^\u0000]*)\u0000/g, (_, id) => { const t = tiles.get(id); return t.base.replace(UPD_AT, () => t.upd) })
    $$('.lb-col[data-f]', sc).forEach((b) => b.onclick = () => { S.libFilter = b.dataset.f; renderLib() })
    $('#lbScan', sc)?.addEventListener('click', (e) => rescan(e.currentTarget))
    $('#lbRescan', sc)?.addEventListener('click', (e) => rescan(e.currentTarget))
    $('#lbAll', sc)?.addEventListener('click', () => { S.libFilter = 'all'; renderLib() })
    $('#lbAcc', sc)?.addEventListener('click', () => Settings.open('accounts'))
    $('#lbNew', sc)?.addEventListener('click', () => colPanel())
    $('#lbEdit', sc)?.addEventListener('click', () => colPanel(libCol))
    $('#lbDel', sc)?.addEventListener('click', () => { const col = libCol; confirmDel({ title: `Supprimer la collection « ${esc(col.n)} » ?`, text: 'Tes jeux restent dans ta bibliothèque : seule cette collection disparaît.', verb: 'Supprimer la collection', onOk: async () => { await API.deleteCollection(col.id); await Real.refreshShelves(); S.libFilter = 'all'; renderLib(); $('.lb-col.on', sc)?.focus({ preventScroll: true }); toast(`${ic('check')} Collection « ${esc(col.n)} » supprimée`, { ms: 2000 }) } }) })
    let lbT = 0, lbId = null
    const lbIntent = (e) => { const t = e.target.closest?.('.lb-t[data-id]'); if (!t || t.dataset.id === lbId) return; lbId = t.dataset.id; clearTimeout(lbT); lbT = setTimeout(() => { const g = G(lbId); if (g) Fluid.game(g) }, 180) }
    sc.onpointerover = lbIntent; sc.onfocusin = lbIntent
    $$('.lb-t[data-id]', sc).forEach(bindTile)
  }
  // Les écouteurs d'une tuile lisent le jeu au moment du geste : une tuile gardée d'un rendu à l'autre reste juste
  function bindTile(t) {
    const fr = $('.lb-c', t), g = () => G(t.dataset.id)
    t.onclick = () => openGame(t.dataset.id, fr)
    // Sous Linux le menu contextuel part au mousedown : on attend le relâché, sinon il fermerait aussitôt le menu
    t.oncontextmenu = (e) => {
      e.preventDefault()
      // Clic droit : au curseur ; touche Menu du clavier (pas de position) : au milieu de la jaquette
      const r = t.getBoundingClientRect(), at = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.left + r.width / 2, y: r.top + r.height / 3 }
      if (e.buttons) document.addEventListener('mouseup', () => setTimeout(() => tileMenu(g(), t, fr, at), 0), { once: true }); else tileMenu(g(), t, fr, at)
    }
    t.addEventListener('pointermove', (e) => { if (reduced()) return; const r = fr.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; fr.style.transform = `perspective(700px) rotateY(${x * 12}deg) rotateX(${-y * 12}deg) translateY(-4px)`; fr.style.setProperty('--sx', (x + .5) * 100 + '%'); fr.style.setProperty('--sy', (y + .5) * 100 + '%') })
    t.addEventListener('pointerleave', () => { fr.style.transform = '' })
  }
  const tileEl = (sc, id) => $(`.lb-t[data-id="${CSS.escape(id)}"]`, sc)
  function swapTile(sc, id, t) {
    const old = tileEl(sc, id); if (!old) return
    const nu = h(t.base.replace(UPD_AT, () => t.upd)), had = old === document.activeElement
    old.replaceWith(nu); bindTile(nu)
    if (had) nu.focus({ preventScroll: true })
  }
  // Seule la progression (ou l'étiquette) de la mise à jour a changé : la bande est remplacée, la tuile reste
  function swapUpd(sc, id, upd) {
    const c = $('.lb-c', tileEl(sc, id) || document.createElement('i')); if (!c) return
    const old = $(':scope > .lb-upd', c), nu = upd ? h(upd) : null
    if (old && nu) old.replaceWith(nu)
    else if (old) old.remove()
    else if (nu) ($(':scope > .lb-star', c) || $(':scope > .card-spec', c)).after(nu)
  }
  function tileMenu(g, t, fr, at) {
    const items = g.installed
      ? [['play', g.update ? (g.updateAction?.label || 'Mettre à jour') : `Lancer ${g.short || g.name}`, () => (g.update ? Real.openSteamDownloads() : launchFromSheet(g))]]
      : [['down', `Installer ${g.short || g.name}`, () => { openGame(g.id, fr); setTimeout(() => { const b = $('#gpPlay'); if (b) install(G(g.id) || g, b) }, 420) }]]
    items.push(['sep'])
    items.push(['info', 'Voir la fiche', () => openGame(g.id, fr)])
    items.push([g.fav ? 'starf' : 'star', g.fav ? 'Retirer des favoris' : 'Ajouter aux favoris', async () => { await Real.favorite(g); toast(`${ic(g.fav ? 'starf' : 'star')} ${esc(g.name)} ${g.fav ? 'ajouté aux favoris' : 'retiré des favoris'}`, { ms: 1800 }) }])
    if (g.installed) items.push(['folder', 'Ouvrir le dossier', () => API.openGameFolder(g.rid).catch(() => toast('Le dossier du jeu n’a pas pu s’ouvrir. Réessaie depuis la fiche.', { tone: 'warn', ms: 3000 }))])
    menuAt(t, items, { at, main: true, head: `<i class="mn-art" aria-hidden="true" style="background-image:url('${esc(A(g.cover))}')"></i><div class="mn-h"><img src="${esc(A(g.cover))}" alt=""><span><b>${esc(g.name)}</b>${g.time ? `<small>${esc(g.time)} de jeu</small>` : ''}</span></div>` })
    // Le menu du jeu : sa jaquette floutée en fond, et le style caméléon sur « Lancer » (style.js)
    const m = $('#pxMenu'); if (!m) return
    m.classList.add('mn-game')
    const st = GameStyle.now(g)
    if (st) GameStyle.paint(m, st)
    else GameStyle.of(g).then((r) => { if (m.isConnected) GameStyle.paint(m, r) })
  }
  const updOf = (g) => { if (!g.update) return ''; const pct = SU.updatePercent(g.update); return `<span class="lb-upd"><b>${esc(g.updateText)}</b>${pct != null ? `<i><i style="width:${pct}%"></i></i>` : ''}</span>` }
  // upd : la bande de mise à jour, ou la marque où renderLib la place
  function tile(g, upd = updOf(g)) {
    return `<button class="lb-t ${g.installed ? '' : 'is-off'}" data-id="${g.id}" data-name="${esc(g.name)}" aria-label="${esc(g.name)}">
      <span class="lb-c"><img src="${esc(A(g.cover))}" alt="" loading="lazy" draggable="false"><span class="card-spec"></span>
        ${g.fav ? `<span class="lb-star">${ic('starf')}</span>` : ''}
        ${upd}
        ${g.patch ? '<span class="lb-patch">Nouveau patch</span>' : ''}
        ${g.installed ? '' : `<span class="lb-inst">${ic('down')}Installer</span>`}
      </span>
      <span class="lb-n">${esc(g.name)}</span>
      <span class="lb-m">${esc(g.store)}${g.time ? `, ${esc(g.time)}` : ''}</span>
    </button>`
  }

  /* ---------- Fiche du jeu ---------- */
  // opts.tab : l'onglet à rouvrir ; opts.prev : la page où Revenir ramène (un clip ouvert depuis la fiche y revient)
  function openGame(id, from, opts = {}) {
    const g = G(id); if (!g) return
    if (from) from.style.viewTransitionName = 'game-cover'
    S.gameId = id; S.gameTab = opts.tab || (g.running ? 'overview' : 'news')
    vt(() => {
      if (from) from.style.viewTransitionName = ''
      S.prevView = opts.prev || (S.view === 'game' ? S.prevView : S.view)
      S.view = 'game'; $('#win').dataset.view = 'game'
      $$('.v', host).forEach((e) => { e.hidden = e.dataset.v !== 'game' })
      Clips.onLeave()
      renderGame()
      Bar.setNav(S.prevView === 'game' ? 'lib' : S.prevView)
      Bar.syncGame(); Fluid.game(g); Fluid.rest()
    }, { done: () => $('#gpBack')?.focus({ preventScroll: true }) })
  }
  function closeGame() {
    const back = S.prevView || 'play', id = S.gameId
    S.gameId = null
    vt(() => {
      S.view = back; $('#win').dataset.view = back
      $$('.v', host).forEach((e) => { e.hidden = e.dataset.v !== back })
      enter(back); Bar.setNav(back); Bar.syncGame(); Fluid.rest()
      if (back === 'play') { Play.refresh(); const f = Play.focused(); Fluid.game(f) }
    }, { done: () => { const t = back === 'lib' ? $(`.lb-t[data-id="${id}"]`, host) : back === 'play' ? $('.card.is-front', host) : null; (t || $(`.v[data-v=${back}]`, host))?.focus({ preventScroll: true }) } })
  }
  const TABS = {
    cs2: [['news', 'Actus'], ['overview', 'Aperçu'], ['matches', 'Matchs'], ['clips', 'Clips'], ['ach', 'Succès']],
    bf6: [['news', 'Actus'], ['overview', 'Aperçu'], ['matches', 'Sessions'], ['loadouts', 'Loadouts'], ['clips', 'Clips'], ['ach', 'Succès']]
  }
  const playLabel = (g) => (!g.installed ? 'Installer' : g.running ? 'En jeu' : g.updateAction?.label || 'Jouer')
  function launchFromSheet(g) {
    S.gameId = null
    Views.show('play')
    setTimeout(() => { Play.focusGame(g.id); setTimeout(() => Live.launch(g.id), 200) }, 300)
  }
  function renderGame() {
    const g = G(S.gameId); if (!g) return
    const sc = $('#sc-game')
    const tabs = TABS[g.id] || [['news', 'Actus'], ['overview', 'Aperçu'], ['clips', 'Clips'], ['ach', 'Succès']]
    if (!tabs.find(([k]) => k === S.gameTab)) S.gameTab = tabs[0][0]
    sc.innerHTML = `${g.hero ? `<img class="gp-hero" src="${esc(A(g.hero))}" alt="">` : ''}
      <div class="gp">
        <aside class="gp-side">
          <button class="gp-back btn sm" id="gpBack">${ic('back')}Revenir</button>
          <div class="gp-cover" id="gpCover" data-name="${esc(g.name)}" style="view-transition-name:game-cover"><img src="${esc(A(g.cover))}" alt="" draggable="false"></div>
          <div class="dock">
          <button class="play-btn gp-play" id="gpPlay" ${g.update ? `title="${esc(g.updateAction.title)}"` : ''}><span class="pb-ring"></span><span class="pb-in">${ic(g.installed && !g.update ? 'play' : 'down')}<span>${esc(playLabel(g))}</span><span class="pb-chev" aria-hidden="true"><b>›</b><b>›</b><b>›</b></span></span></button>
          <div class="gp-mini">
            <button class="dk-b" id="gpFav" aria-pressed="${!!g.fav}" data-tip="${g.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" data-tip-l><span class="ic-swap"><span class="a">${ic('star')}</span><span class="b">${ic('starf')}</span></span><span>Favori</span></button>
            <button class="dk-b" id="gpShelf" aria-haspopup="menu" aria-expanded="false" data-tip="Ranger dans une étagère">${ic('lib')}<span>Ranger</span></button>
            ${g.installed ? `<button class="dk-b" id="gpRt" aria-label="${ROUTINES[g.routine] ? 'Modifier la routine' : 'Créer une routine'}" data-tip="${ROUTINES[g.routine] ? `Routine « ${esc(ROUTINES[g.routine].name)} »` : 'Créer une routine : Discord, applis, avant de jouer'}">${ic('queue')}<span>Routine</span></button>` : ''}
            ${g.installed ? `<button class="dk-b" id="gpFolder" aria-label="Ouvrir le dossier" data-tip="Ouvrir le dossier" data-tip-r>${ic('folder')}<span>Dossier</span></button>` : ''}
          </div></div>
        </aside>
        <div class="gp-main">
          <p class="gp-kick">${esc(g.store)}${g.time ? `, ${esc(g.time)} de jeu` : ''}${g.running ? ', en cours' : g.last ? `, dernière partie ${esc(g.last)}` : ''}</p>
          <h1 class="gp-title" data-len="${g.name.length > 20 ? 'l' : 's'}">${esc(g.name)}</h1>
          <div class="pills gp-tabs" role="tablist">${tabs.map(([k, l]) => `<button class="pill" role="tab" data-t="${k}" aria-selected="${S.gameTab === k}">${l}${k === 'news' && g.patch ? '<em class="gp-new" aria-label="nouveau patch"></em>' : ''}</button>`).join('')}</div>
          <div class="gp-body" id="gpBody"></div>
        </div>
      </div>`
    $('#gpBack', sc).onclick = closeGame
    // Boutons caméléon : le grand bouton et le titre prennent le style du jeu, comme sur l'accueil (style.js)
    const gp = $('.gp', sc), st = GameStyle.now(g)
    if (st) GameStyle.paint(gp, st)
    else GameStyle.of(g).then((r) => { if (S.gameId === g.id && gp.isConnected) GameStyle.paint(gp, r) })
    $('#gpPlay', sc).onclick = (e) => {
      if (!g.installed) return install(g, e.currentTarget)
      if (g.update) { Real.openSteamDownloads(); return toast(`${ic('down')} ${esc(g.updateAction.title)}`, { ms: 3000 }) }
      if (g.running) return Live.show()
      launchFromSheet(g)
    }
    $('#gpRt', sc)?.addEventListener('click', () => Settings.routineFor(g.id))
    $('#gpFav', sc).onclick = async (e) => { const b = e.currentTarget; await Real.favorite(g); b.setAttribute('aria-pressed', g.fav); b.dataset.tip = g.fav ? 'Retirer des favoris' : 'Ajouter aux favoris' }
    $('#gpShelf', sc).onclick = (e) => menuAt(e.currentTarget, [...cols().map((c) => [c.rids.includes(g.rid) ? 'check' : 'lib', c.n, async () => {
      const has = c.rids.includes(g.rid)
      await API.setInCollection(c.id, g.rid, !has); await Real.refreshShelves()
      toast(`${ic('check')} ${esc(g.name)} ${has ? 'retiré de' : 'rangé dans'} « ${esc(c.n)} »`, { ms: 2000 })
    }]), ['plus', 'Créer une collection', () => colPanel(null, g.rid)], ['close', 'Masquer ce jeu', async () => {
      await Real.setHidden(g.rid, true)
      toast(`${esc(g.name)} masqué de l’accueil et de la bibliothèque`, { ms: 5000, action: { label: 'Annuler', fn: () => Real.setHidden(g.rid, false) } })
      closeGame()
    }]])
    $('#gpFolder', sc)?.addEventListener('click', () => API.openGameFolder(g.rid).catch(() => toast('Le dossier du jeu n’a pas pu s’ouvrir.', { tone: 'warn', ms: 3000 })))
    $$('.gp-tabs .pill', sc).forEach((b) => b.onclick = () => { S.gameTab = b.dataset.t; $$('.gp-tabs .pill', sc).forEach((x) => { x.setAttribute('aria-selected', x === b) }); gameBody(g) })
    gameBody(g)
  }
  // Installer : le bouton dit que Steam s'ouvre, puis que la suite se passe dans Steam. Une erreur propose de réessayer.
  async function install(g, b) {
    if (b.getAttribute('aria-busy')) return
    const lab = $('.pb-in span', b)
    b.setAttribute('aria-busy', 'true'); lab.textContent = 'Ouverture de Steam…'
    try {
      await API.installGame(g.rid)
      lab.textContent = 'Suite dans Steam'
      toast(`${ic('down')} Steam ouvre l’installation de ${esc(g.name)}. Le jeu arrivera ici une fois téléchargé.`, { ms: 5000 })
      setTimeout(() => { if (!b.isConnected) return; b.removeAttribute('aria-busy'); lab.textContent = playLabel(G(g.id) || g) }, 8000)
    } catch (e) {
      b.removeAttribute('aria-busy'); lab.textContent = playLabel(g)
      toast(`Steam ne s’est pas ouvert sur ${esc(g.name)}. ${esc(errText(e))}`, { tone: 'warn', ms: 7000, action: { label: 'Réessayer', fn: () => b.isConnected && install(g, b) } })
    }
  }
  const ACH_STATE = {
    'not-steam': ['Pas de succès à lire pour ce jeu', 'Player X lit les succès de Steam : ce jeu vient d’un autre store.', ''],
    none: ['Ce jeu n’a pas de succès', '', ''],
    'no-account': ['Relie ton compte Steam', 'Tes succès et leur rareté s’afficheront ici.', 'Connecter Steam'],
    'no-key': ['Ajoute ta clé Steam Web API', 'Elle permet de lire tes succès et leur rareté.', 'Ajouter la clé'],
    'key-refused': ['Steam refuse ta clé Web API', 'Vérifie-la dans tes comptes, puis réessaie.', 'Vérifier la clé'],
    private: ['Tes détails de jeux sont privés sur Steam', 'Rends-les publics dans ta confidentialité Steam pour lire tes succès.', 'Voir mes comptes']
  }
  async function achBody(g, b) {
    const me = (achBody.token = (achBody.token || 0) + 1)
    const sk = setTimeout(() => { if (me === achBody.token && b.isConnected) b.innerHTML = `<div class="gb-ach is-sk" aria-busy="true"><div class="gb-ring" style="--p:0"></div><span class="sr-only" role="status">Chargement des succès</span></div>` }, 100)
    let a = null
    try { a = await API.getAchievements(g.rid) } catch (e) { console.error(e) }
    clearTimeout(sk)
    if (me !== achBody.token || !b.isConnected || S.gameTab !== 'ach') return
    if (!a) { b.innerHTML = `<div class="empty"><h2>Succès indisponibles</h2><p>Steam ne répond pas pour le moment. Réessaie dans quelques minutes.</p><button class="btn sm" id="achR">${ic('refresh')}Réessayer</button></div>`; $('#achR', b).onclick = () => achBody(g, b); return }
    if (a.state !== 'ready') {
      const [t, s, act] = ACH_STATE[a.state] || ['Succès indisponibles', '', '']
      b.innerHTML = `<div class="empty"><span class="empty-x">${ic('trophy')}</span><h2>${esc(t)}</h2>${s ? `<p>${esc(s)}</p>` : ''}${act ? `<button class="btn sm" id="achA">${esc(act)}</button>` : ''}</div>`
      $('#achA', b)?.addEventListener('click', () => Settings.open('accounts'))
      return
    }
    const F = Shared.achFormat, unlocked = a.list.filter(F.isUnlocked), rare = unlocked.filter((x) => F.rarityOf(x.percent)).length
    const order = [...unlocked.sort((p, q) => (q.unlockedAt || 0) - (p.unlockedAt || 0)), ...a.list.filter((x) => !F.isUnlocked(x)).sort((p, q) => (q.percent || 0) - (p.percent || 0))]
    b.innerHTML = `<div class="gb-ach"><div class="gb-ring" style="--p:${F.completion(a.unlocked, a.total)}"><b class="num">${a.unlocked}</b><span>sur ${a.total}</span></div><div><b>Succès Steam</b><p>${rare ? `${rare} rare${rare > 1 ? 's' : ''} débloqué${rare > 1 ? 's' : ''}` : `${F.completion(a.unlocked, a.total)} % terminé`}</p></div></div>
      <ul class="gb-al">${order.map((x) => { const on = F.isUnlocked(x), ra = F.rarityOf(x.percent), icon = on ? x.icon : x.iconGray || x.icon; return `<li class="${on ? '' : 'off'} ${on && ra ? 'rare' : ''}"><span class="gb-ai">${icon ? `<img src="${esc(icon)}" alt="" loading="lazy">` : ic('trophy')}</span><div><b>${esc(x.name)}</b><span>${esc(x.description || (x.hidden ? 'Succès caché' : ''))}${x.percent != null ? `${x.description || x.hidden ? ', ' : ''}${F.formatPercent(x.percent)} des joueurs` : ''}</span></div>${on && x.unlockedAt ? `<time>${esc(T.formatDate(x.unlockedAt))}</time>` : ''}</li>` }).join('')}</ul>`
  }
  function overview(g, b) {
    const f = [['Temps de jeu', g.time || 'Aucune partie'], ['Dernière partie', g.running ? 'En cours' : g.last ? T.capitalize(g.last) : g.time ? 'Jamais avec Player X' : 'Jamais'], ['Store', g.store], ['État', g.installed ? (g.update ? SU.updateSentence(g.update) : 'Installé, à jour') : 'Pas installé']]
    if (g.raw.lastPatch) f.push(['Dernier patch', T.formatDate(g.raw.lastPatch.at)])
    const sv = Real.st.servers
    if (g.id === 'cs2' && sv?.ok) f.push(['Serveurs', Shared.servers.serversLabel(sv.servers)])
    const rec = Real.clipsLine?.(g); if (rec) f.push(['Clips', rec])
    const lv = g.id === 'cs2' ? Live.cs2() : null
    if (lv) f.unshift(['Match en cours', [Shared.cs2.mapLabel(lv.map), lv.score ? `${lv.score.us}–${lv.score.them}` : '', `${lv.kills}/${lv.deaths}/${lv.assists}`, lv.adr != null ? `ADR ${lv.adr}` : ''].filter(Boolean).join(', ')])
    const players = Real.st.friendsRes ? Shared.around.playersOf(g.raw, Real.st.friendsRes.friends) : []
    b.innerHTML = `<dl class="gb-facts" id="gbFacts">${f.map(([a, c]) => `<div><dt>${esc(a)}</dt><dd class="num">${esc(c)}</dd></div>`).join('')}</dl>${players.length ? `<h3 class="gb-h">${esc(Shared.around.playersLabel(players))}</h3><div class="gb-fr">${players.map((p) => `<button class="gb-f" data-id="${esc(p.id)}">${avatar(p.name, 34)}<span><b>${esc(p.name)}</b><span>${esc(p.platform === 'discord' ? 'Membre du serveur' : p.device || 'En jeu')}</span></span></button>`).join('')}</div>` : ''}`
    $$('.gb-f', b).forEach((x) => x.onclick = () => { S.friend = x.dataset.id; S.gameId = null; go('friends') })
    if (g.raw.store === 'steam') API.steamPlayers(g.rid).then((n) => { const box = $('#gbFacts', b); if (n && box) box.append(h(`<div><dt>Joueurs sur Steam</dt><dd class="num">${esc(Shared.servers.formatPlayers(n.count))}</dd></div>`)) }).catch(() => {})
  }
  async function gameBody(g) {
    const b = $('#gpBody'), t = S.gameTab
    achBody.token = (achBody.token || 0) + 1
    if (t === 'news') NewsView.render(g, b)
    else if (t === 'overview') overview(g, b)
    else if (t === 'matches') await Recap.listInto(b, g.id)
    else if (t === 'clips') Clips.gameTab(g, b)
    else if (t === 'loadouts') {
      b.innerHTML = BUILDS.length
        ? `<div class="gb-lo">${Loadouts.tiles()}</div><div class="gb-more gb-lo-a"><button class="btn sm rose" id="gbNew">${ic('plus')}Créer un loadout</button><button class="btn sm" id="gbLo">Gérer mes loadouts</button></div>`
        : `<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucun loadout pour l’instant</h2><p>Note ton premier build : tu le retrouves ici avant chaque partie.</p><div class="at-e2"><button class="btn sm rose" id="gbNew">${ic('plus')}Créer un loadout</button><button class="btn sm" id="gbLo">Ouvrir mes loadouts</button></div></div>`
      $('#gbNew', b).onclick = () => Atelier.create()
      $$('.lw', b).forEach((x) => x.onclick = () => { S.loWeapon = x.dataset.w; S.statsGame = 'bf6'; S.statsTab = 'loadouts'; S.gameId = null; go('stats') })
      $('#gbLo', b).onclick = () => { S.loWeapon = null; S.statsGame = 'bf6'; S.statsTab = 'loadouts'; S.gameId = null; go('stats') }
    } else if (t === 'ach') achBody(g, b)
  }

  /* ---------- Amis, et membres du serveur Discord : une rangée par jeu (Escouades), la fiche de l'ami à droite ---------- */
  let capOpen = { on: false, mb: false, off: false }, frQ = '', comAll = false, comFor = null, dsY = new Map()
  const amN = (n, one, many) => `${n} ${n > 1 ? many : one}`
  const CAP = 8
  const amWatchText = () => {
    const w = FRIENDS.filter((f) => !f.member && Real.watched(f.id)).map((f) => f.n)
    return w.length ? `Tu seras prévenu dès que ${w.length > 1 ? `${w.slice(0, -1).join(', ')} ou ${w[w.length - 1]}` : w[0]} lance un jeu.` : 'Choisis un ami et demande à être prévenu quand il lance un jeu.'
  }
  // Le défilement de la fiche est gardé par ami, hors du DOM : la fiche est redessinée à chaque relecture des amis
  // Le défilement du dossier / du panneau est gardé par disposition ET par ami
  const amKey = (lay, id) => `${lay}:${id}`
  function amSaveDs() { const box = $('#frCard'), el = box && $('.am-ds-sc, .am-c-duo', box); if (el && box.dataset.f) dsY.set(amKey(el.classList.contains('am-c-duo') ? 'c' : 'a', box.dataset.f), el.scrollTop) }
  // Réglage « style du jeu » changé : rangées et fiche se repeignent si la page est celle qu'on voit
  const amRestyle = () => {
    if (S.view !== 'friends' || S.gameId) return
    $$('#sc-friends [data-lane]').forEach((el) => amStyle(el, G(el.dataset.lane)))
    const d = $('#sc-friends .am-ds, #sc-friends .am-c'); if (d?.dataset.gid) amStyle(d, G(d.dataset.gid))
  }
  GameStyle.onChange(amRestyle)
  const amUrl = (u) => String(u).replace(/'/g, '%27')
  // Le style du jeu (boutons caméléon) : tout de suite s'il est connu, sinon quand la jaquette est lue ; jamais bloquant, un rendu plus récent l'emporte
  function amStyle(el, g) {
    if (!el || !g) return
    const s = GameStyle.now(g)
    if (s) { GameStyle.paint(el, s); return }
    GameStyle.of(g).then((r) => { if (el.isConnected) GameStyle.paint(el, r) }).catch(() => {})
  }
  const amGo = (icon, html, attrs = '', cls = '') => `<button class="gs-btn ${cls}" ${attrs}><span class="gs-in">${ic(icon)}<span class="am-gt">${html}</span></span></button>`
  const amLk = (icon, label, attrs = '', cls = '') => `<button class="am-lk ${cls}" ${attrs}>${icon ? ic(icon) : ''}${label}</button>`
  const amDot = (f) => f.st === 'game' ? 'var(--a)' : f.st === 'online' ? 'var(--ok)' : f.st === 'away' ? 'var(--warn)' : 'rgba(247,241,244,.36)'
  // La petite ligne d'un joueur : plateforme, puis ce qu'on peut faire avec lui
  const amLine = (f) => [f.on, f.join ? 'rejoignable' : f.raw?.voice?.deafened ? 'casque coupé' : f.raw?.voice?.muted ? 'micro coupé' : f.voice ? 'en vocal' : f.device || ''].filter(Boolean).join(' · ')
  // Sous le nom, dans les colonnes du bas : le vocal, « Absent », la dernière fois vu, sinon la plateforme
  const amSub = (f) => f.member
    ? f.activity || (f.voice ? (f.raw?.voice?.deafened ? `${f.voice} · casque coupé` : f.raw?.voice?.muted ? `${f.voice} · micro coupé` : `En vocal, ${f.voice}`) : f.st === 'away' ? 'Absent' : f.on)
    : f.st === 'away' ? 'Absent' : f.st === 'offline' ? (f.seen ? f.seen.replace('Vu pour la dernière fois', 'Vu') : f.on) : f.on
  // Deux dispositions au choix : « Escouades » (a) et « Portraits » (c). Le choix est gardé dans localStorage, tout autre contenu retombe sur « a »
  const AM_KEY = 'pxv3-amis'
  let amLay = 'a', cFil = '', cX = 0, cSel = null, cTimer = 0
  const amInflight = new Map()
  try { amLay = localStorage.getItem(AM_KEY) === 'c' ? 'c' : 'a' } catch { amLay = 'a' }
  const amSetLay = (v) => { amLay = v === 'c' ? 'c' : 'a'; try { localStorage.setItem(AM_KEY, amLay) } catch { /* stockage indisponible : gardé pour cette session */ } }
  // L'ami affiché : celui qu'on a choisi, sinon le premier en jeu, sinon le premier en ligne, sinon le premier de la liste
  const amPick = () => FRIENDS.find((x) => x.id === S.friend) || FRIENDS.find((f) => f.st === 'game') || FRIENDS.find((f) => !f.member && (f.st === 'online' || f.st === 'away')) || FRIENDS[0]
  const amSwitch = () => !FRIENDS.length ? '' : `<div class="am-sw" role="group" aria-label="Disposition de la page">${[['a', 'Escouades'], ['c', 'Portraits']].map(([k, l]) => `<button data-lay="${k}" aria-pressed="${amLay === k}">${l}</button>`).join('')}</div>`
  // Portraits : jamais de rose. La teinte d’une personne est ramenée dans 20..250 (orange, vert, bleu, violet) ; pour les avatars (.av : bas du dégradé à +34) dans 20..216, pour que le bas reste sous 250
  const amHue = (h, span = 230) => Math.round(20 + ((Number(h) || 0) % 360) * span / 360)
  const amCav = (html) => html.replace(/--h:(\d+)/, (_, h) => `--h:${amHue(h, 196)}`)
  const amAv = (n, size) => amCav(avatar(n, size))
  // Une seule demande de profil à la fois par ami
  const amProfile = (id) => { if (!amInflight.has(id)) amInflight.set(id, Promise.resolve(Real.friendProfile(id)).finally(() => amInflight.delete(id))); return amInflight.get(id) }
  // Un profil privé ne donne ni heures, ni nombre de jeux, ni jeux en commun (le niveau peut rester)
  const amPub = (p) => p?.gamesHidden ? { ...p, gameCount: 0, totalMinutes: 0, games: [], recent: [], badgeCount: 0 } : p
  // Où est le focus ? Une clé de sélecteur pour le retrouver après un nouveau dessin
  function amFocusKey(el, root) {
    if (!el || el === document.body || (root && !root.contains(el))) return null
    const q = (v) => CSS.escape(v)
    if (el.dataset?.lay) return `[data-lay="${el.dataset.lay}"]`
    if (el.dataset?.fil != null && el.closest('.am-c-fil')) return `[data-fil="${el.dataset.fil}"]`
    if (el.classList.contains('am-c-card')) return `.am-c-card[data-id="${CSS.escape(el.dataset.id)}"]`
    if (el.closest('#frCard')) return el.id ? `#frCard #${q(el.id)}` : el.dataset?.id ? `#frCard [data-id="${CSS.escape(el.dataset.id)}"]` : null
    return el.id === 'frRef' ? '#frRef' : null
  }
  // Une personne en petite ligne (colonnes de la disposition a, liste du salon de la disposition c)
  const amMini = (f, sel, o = {}) => `<button class="am-mini ${f.id === sel ? 'on' : ''} ${f.st === 'offline' ? 'off' : ''}" aria-pressed="${f.id === sel}" data-id="${esc(f.id)}" ${o.tag === false ? '' : `data-n="${esc(f.n.toLowerCase())}"`} ${o.more ? `data-x="1" data-g="${o.grp}"` : ''}><span class="am-avw">${amAv(f.n, 32)}<i style="background:${amDot(f)}"></i></span><span class="am-mt"><b title="${esc(f.n)}">${esc(f.n)}</b><small>${esc(o.sub ?? amSub(f))}</small></span></button>`
  const amLvColor = (l) => l >= 100 ? '#c9a14a' : ['#9b9b9b', '#c02942', '#d95b43', '#fecc23', '#467a3c', '#4e8ddb', '#7652c9', '#c252c9', '#8a5a6e', '#997c52'][Math.floor(l / 10)]
  const amRegion = (c) => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }).of(c) } catch { return c } }
  // Tout ce que les deux dispositions tirent d'un ami et de son profil Steam (mêmes données, mêmes règles)
  function amFacts(f, p0) {
    const p = amPub(p0)
    const g = f.game ? G(f.game) : null, steam = f.raw?.platform === 'steam'
    const line = f.st === 'game' ? `Joue à <b>${esc(f.gameName)}</b>` : f.member ? (f.activity ? esc(f.activity) : f.voice ? 'En vocal' : 'Membre du serveur Discord') : f.st === 'online' ? 'En ligne' : f.st === 'away' ? 'Absent' : esc(f.seen || 'Hors ligne')
    const kpi = [
      p?.gameCount && ['Jeux', p.gameCount.toLocaleString('fr-FR')],
      p?.totalMinutes && ['Heures de jeu', bigHours(p.totalMinutes)],
      p?.badgeCount && ['Badges', p.badgeCount.toLocaleString('fr-FR')],
      p?.friendCount && ['Amis', p.friendCount.toLocaleString('fr-FR')],
      f.since && ['Ami depuis', f.since.replace('Ami depuis ', '')],
      !steam && ['Sur', f.on], f.device && ['Appareil', f.device], f.voice && ['En vocal', f.voice]
    ].filter(Boolean)
    // Jeux en commun : ceux de ta bibliothèque Steam qu'il a aussi, les plus joués à vous deux d'abord
    const common = (p?.games || []).map((x) => ({ x, g: Real.byRid(`steam:${x.appId}`) })).filter((o) => o.g).map((o) => ({ ...o, me: o.g.raw?.playtime || 0 })).sort((a, b) => (b.x.minutes + b.me) - (a.x.minutes + a.me))
    return {
      g, steam, line, kpi, common, url: Shared.friendView.steamProfileUrl(f.raw),
      bg: p?.background || (g ? A(g.hero || g.cover) : ''),
      recent: (p?.recent || []).map((x) => ({ x, g: Real.byRid(`steam:${x.appId}`) })),
      watch: Real.watched(f.id), canWatch: !f.member && (steam || f.raw?.platform === 'psn'),
      meta: [p?.country && amRegion(p.country), p?.memberSince && `Membre depuis ${new Date(p.memberSince).getFullYear()}`].filter(Boolean),
      ava: p?.avatarAnimated || p?.avatarFull || f.avatar
    }
  }
  // Les actions secondaires, en liens sans cadre (skip : celle qui est déjà le bouton principal)
  const amLinks = (f, fa, skip = '') => [fa.steam && skip !== 'fcMsg' && amLk('chat', 'Écrire', 'id="fcMsg"'), fa.canWatch && amLk(fa.watch ? 'check' : 'bell', fa.watch ? 'Tu seras prévenu' : 'Préviens-moi quand il joue', `id="fcWatch" aria-pressed="${fa.watch}"`, fa.watch ? 'is-on' : ''), fa.url && amLk('link', 'Profil Steam', 'id="fcProfile"'), f.voiceId && skip !== 'fcVoice' && amLk('mic', 'Ouvrir le salon', 'id="fcVoice"'), f.member && amLk('close', 'Masquer ce membre', 'id="fcHide"')].filter(Boolean)
  const amDuel = (fa) => {
    if (!fa.common.length) return ''
    const shown = comAll ? fa.common.slice(0, 8) : fa.common.slice(0, 3), mx = Math.max(1, ...fa.common.flatMap(({ x, me }) => [x.minutes, me]))
    return `<section><h3 class="am-ds-h"><span>Jeux en commun</span><span class="num">${fa.common.length}</span></h3><ul class="am-duel">${shown.map(({ x, g: mg, me }) => `<li><button class="am-du" data-g="${esc(mg.id)}" aria-label="${esc(mg.name)} : lui ${esc(hoursOf(x.minutes) || '0 h')}, toi ${esc(hoursOf(me) || '0 h')}"><img src="${esc(A(mg.cover))}" alt="" loading="lazy" decoding="async"><span class="am-du-m"><b>${esc(mg.name)}</b><span class="am-bar"><i style="width:${x.minutes / mx * 100}%"></i></span><span class="am-bar b2"><i style="width:${me / mx * 100}%"></i></span></span><span class="am-du-n num"><span>Lui <b>${esc(hoursOf(x.minutes) || '0 h')}</b></span><span>Toi <b>${esc(hoursOf(me) || '0 h')}</b></span></span></button></li>`).join('')}</ul>${fa.common.length > 3 ? `<button class="am-more" id="fcCom" aria-expanded="${comAll}">${comAll ? 'Réduire' : `Voir les ${fa.common.length} jeux en commun`}</button>` : ''}</section>`
  }
  const amRecent = (fa) => fa.recent.length ? `<section><h3 class="am-ds-h"><span>Ces 2 dernières semaines</span></h3><ul class="am-rec">${fa.recent.map(({ x, g: mg }) => `<li><img src="${esc(mg ? A(mg.hero || mg.cover) : steamArt(x.appId))}" alt="" loading="lazy" decoding="async"><b>${esc(mg?.name || x.name || 'Jeu Steam')}</b><span class="num">${esc(hoursOf(x.recentMinutes))}</span></li>`).join('')}</ul></section>` : ''
  const amNotes = (f, p) => (p?.gamesHidden ? '<p class="am-note">Son profil Steam est privé : ses jeux et ses heures ne sont pas visibles.</p>' : '') + (f.raw?.platform === 'psn' ? '<p class="am-note">PlayStation ne donne que sa présence et son jeu.</p>' : f.member ? `<p class="am-note">Membre du serveur ${esc(Real.st.friendsRes?.discordServer || 'Discord')}, pas un ami : Discord ne donne que son statut, son activité et son salon vocal.</p>` : '')
  const amAva = (f, p, fa, c) => `<div class="am-ds-av">${fa.ava ? `<span class="am-ds-img"><img src="${esc(fa.ava)}" alt=""></span>` : amAv(f.n, 84)}${p?.avatarFrame ? `<img class="am-ds-fr" src="${esc(p.avatarFrame)}" alt="">` : ''}</div>`
  // Avatar ou cadre illisible : les initiales, ou rien du tout
  function amAvaFix(box, f, c) {
    const im = $('.am-ds-img img', box), fr = $('.am-ds-fr', box)
    const noAva = () => { const w = $('.am-ds-img', box); if (w) w.outerHTML = `<span class="av" style="--h:${amHue(f.hue, 196)}" aria-hidden="true">${esc(String(f.n)[0] || '?')}</span>` }
    if (im) { im.addEventListener('error', noAva, { once: true }); if (im.complete && !im.naturalWidth) noAva() }
    if (fr) { fr.addEventListener('error', () => { fr.hidden = true }, { once: true }); if (fr.complete && !fr.naturalWidth) fr.hidden = true }
  }
  // Les gestes de la fiche (dossier ou portrait) : mêmes appels dans les deux dispositions
  function amWire(box, f, p, fa, repaint) {
    const g = fa.g
    $('#fcPlay', box)?.addEventListener('click', () => launchFromSheet(g))
    $('#fcJoin', box)?.addEventListener('click', () => API.friendSteam('join', f.id).catch((e) => toast(esc(errText(e)), { tone: 'warn', ms: 4000 })))
    $('#fcMsg', box)?.addEventListener('click', () => API.friendSteam('message', f.id).catch(() => toast('Steam n’a pas pu s’ouvrir.', { tone: 'warn', ms: 3000 })))
    $('#fcWatch', box)?.addEventListener('click', async () => {
      const on = !Real.watched(f.id)
      try { await Real.setWatch(f.id, on); toast(on ? `${ic('bell')} Tu seras prévenu quand ${esc(f.n)} lance un jeu` : `Plus d’alerte pour ${esc(f.n)}`, { ms: 2400 }) } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 4000 }) }
      const cp = $('.am-calm-p'); if (cp) cp.textContent = amWatchText()
      if (amPick()?.id === f.id) repaint()
    })
    $('#fcCom', box)?.addEventListener('click', () => { comAll = !comAll; repaint(); $('#fcCom', box)?.focus() })
    $$('.am-du', box).forEach((b) => b.onclick = () => openGame(b.dataset.g, $('img', b)))
    $('#fcProfile', box)?.addEventListener('click', () => API.openExternal(fa.url))
    $('#fcVoice', box)?.addEventListener('click', () => API.openDiscordChannel(f.voiceId).catch(() => {}))
    $('#fcHide', box)?.addEventListener('click', async () => {
      Real.applyFriends(await API.setMemberHidden(f.n, true))
      toast(`${esc(f.n)} masqué de la liste`, { ms: 5000, action: { label: 'Annuler', fn: async () => Real.applyFriends(await API.setMemberHidden(f.n, false)) } })
    })
  }
  // La carte d'une personne sur l'étagère de la disposition c : son vrai avatar, sinon son initiale sur sa teinte
  function amCard(f, sel) {
    const p = f.raw?.platform === 'steam' ? Real.cachedProfile(f.id) : null, img = p?.avatarAnimated || p?.avatarFull || f.avatar
    const small = f.st === 'game' ? (f.join ? 'Rejoignable' : f.voice ? `Vocal ${f.voice}` : f.device || f.on) : f.member && !f.activity && f.voice ? `Vocal ${f.voice}` : amSub(f) || f.on
    const h = amHue(f.hue), on = f.id === sel
    return `<button class="am-c-card ${f.st === 'offline' ? 'x' : ''} ${on ? 'on' : ''}" aria-pressed="${on}" aria-label="${esc(`${f.n}, ${small}`)}" tabindex="${on ? 0 : -1}" data-id="${esc(f.id)}" data-n="${esc(f.n.toLowerCase())}" title="${esc(f.n)}" style="--h:${h};--h2:${Math.min(250, h + 30)}"><span class="am-c-ini" aria-hidden="true">${esc(String(f.n)[0]?.toUpperCase() || '?')}</span>${img ? `<img class="am-c-img" src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ''}<i class="am-c-s" style="background:${amDot(f)}"></i>${f.voice ? `<span class="am-c-m">${ic('mic')}</span>` : ''}<span class="am-c-t" aria-hidden="true"><b>${esc(f.n)}</b><small>${esc(small)}</small></span></button>`
  }
  // La disposition « Portraits » : colonne (comptes en erreur, scène avec héros + salons vocaux + panneau, étagère « Ton cercle »)
  function amPortraits(c) {
    const { sel, lanes, online, members, off, res, tools } = c
    const nIn = lanes.reduce((n, l) => n + l.list.length, 0)
    let gi = 0
    const grp = (key, title, list, img) => { if (!list.length) return ''; const id = `cg${gi++}`; return `<div class="am-c-g" data-grp="${key}" role="group" aria-labelledby="${id}"><div class="am-c-gh">${img ? `<img src="${esc(img)}" alt="">` : ''}<span id="${id}">${esc(title)} · ${list.length}</span></div><div class="am-c-gc">${list.map((f) => amCard(f, sel)).join('')}</div></div>` }
    const k = cFil
    const row = lanes.map((l) => grp('game', l.g?.short || l.name, l.list, l.g ? A(l.g.cover) : '')).join('') + grp('on', 'En ligne', online) + grp('mem', res.discordServer ? `Serveur ${res.discordServer}` : 'Serveur Discord', members) + grp('off', 'Hors ligne', off)
    const fil = [['', 'Tous'], ['game', `En jeu ${nIn}`], ['on', `En ligne ${online.length}`], ['mem', `Serveur ${members.length}`], ['off', `Hors ligne ${off.length}`]]
    const chips = VOICE.slice(0, 2).map((r) => `<button class="am-c-chip" data-voice="${esc(r.id)}" title="Ouvrir le salon dans Discord">${ic('mic')}<span class="am-c-cn"><b>${esc(r.name)}</b> · ${amN(r.people.length, 'membre', 'membres')}</span><span class="am-stk">${r.people.slice(0, 4).map((p) => amAv(p.n, 26)).join('')}</span></button>`).join('') + (VOICE.length > 2 ? `<span class="am-c-more" aria-label="${VOICE.length - 2} autres salons">+${VOICE.length - 2}</span>` : '')
    // Les comptes en erreur : une ligne chacun, deux au plus puis « +N », dans le flux de la page
    const ents = Object.entries(res.errors || {})
    const notes = ents.length ? `<div class="am-c-notes">${ents.slice(0, 2).map(([pf, m]) => `<div class="am-c-note">${ic('warn')}<p title="${esc(m)}"><b>${esc({ steam: 'Steam', discord: 'Discord', psn: 'PlayStation' }[pf] || pf)}</b> : ${esc(m)}</p><button class="am-lk" data-fix>Voir mes comptes</button></div>`).join('')}${ents.length > 2 ? `<p class="am-c-nm">+${ents.length - 2} autre${ents.length > 3 ? 's' : ''} compte${ents.length > 3 ? 's' : ''} en erreur</p>` : ''}</div>` : ''
    return `<div class="am-c"><div class="am-c-bg" id="cBg"></div><h1 class="am-c-h1">Amis</h1>
      ${notes}
      <div class="am-c-stage"><div id="frCard" class="am-c-fr"></div>${chips ? `<div class="am-c-voice" role="group" aria-label="Salons vocaux">${chips}</div>` : ''}</div>
      <div class="am-c-shelf"><div class="am-c-sh"><p class="am-eye"><i></i>Ton cercle<span>${amN(FRIENDS.length, 'personne', 'personnes')}, ceux qui jouent d’abord</span></p>
        <div class="am-c-fil" role="group" aria-label="Filtrer l’étagère">${fil.map(([key, l]) => `<button data-fil="${key}" aria-pressed="${k === key}">${l}</button>`).join('')}</div><div class="am-tools">${tools}</div></div>
        <div class="am-c-row" id="cRow">${row}<p class="am-c-0" hidden>Personne ici pour l’instant.</p><div class="am-none" id="frNone" hidden><p>Aucun ami ne s’appelle comme ça.</p>${amLk('', 'Effacer la recherche', 'id="frClr"')}</div></div></div></div>`
  }
  const amCards = (row) => $$('.am-c-card', row).filter((c) => !c.hidden && !c.closest('.am-c-g[hidden]'))
  // L'étagère est un seul arrêt de tabulation : la carte choisie (sinon la première visible)
  function amRove(row) {
    const cards = amCards(row), t = cards.find((c) => c.classList.contains('on')) || cards[0]
    $$('.am-c-card', row).forEach((c) => c.setAttribute('tabindex', c === t ? '0' : '-1'))
  }
  // Choisir quelqu'un sans refaire la page : seuls l'état des cartes, le héros, le fond et le panneau changent
  function amChoose(id, o = {}) {
    S.friend = id
    const row = $('#cRow')
    if (row) {
      $$('.am-c-card', row).forEach((x) => { const on = x.dataset.id === id; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on) })
      amRove(row)
      const c = $(`.am-c-card[data-id="${CSS.escape(id)}"]`, row)
      if (c && !c.hidden) { const r = row.getBoundingClientRect(), cr = c.getBoundingClientRect(); if (cr.left < r.left + 72) row.scrollLeft -= r.left + 72 - cr.left; else if (cr.right + 16 > r.right - 110) row.scrollLeft += cr.right + 16 - (r.right - 110) }
      cX = row.scrollLeft
    }
    cSel = id
    friendCard(o.delay || 0)
    if (o.focus) o.focus.focus({ preventScroll: true })
  }
  function renderFriends() {
    if (Real.st.friendsRes) amSaveDs()
    Fluid.set(['#071a24', '#0e3a4a', '#1f8a9c', '#4b2a72'])
    const sc = $('#sc-friends'), res = Real.st.friendsRes
    if (!res) {
      sc.classList.remove('am-on', 'am-c-on')
      sc.innerHTML = `<header class="am-hd"><div><p class="am-eye"><i></i>Amis</p><div class="am-ttl"><h1 class="am-title">Amis</h1><span class="am-sub" role="status">Lecture de tes comptes…</span></div></div></header><div class="am-sk" aria-hidden="true">${[0, 1, 2].map(() => '<div class="am-sq am-sk-r"><i></i><i></i></div>').join('')}</div>`
      return
    }
    const lay = FRIENDS.length ? amLay : 'a'
    sc.classList.add('am-on'); sc.classList.toggle('am-c-on', lay === 'c')
    const act = document.activeElement, typing = act?.id === 'frQ'
    const fkey = amFocusKey(act, sc)
    const oldRow = $('#cRow', sc); if (oldRow) cX = oldRow.scrollLeft
    const keepY = $('.am-main', sc)?.scrollTop || 0
    const sel = amPick()?.id
    const inGame = FRIENDS.filter((f) => f.st === 'game')
    const byGame = new Map()
    inGame.forEach((f) => { const k = f.gameName || '?'; if (!byGame.has(k)) byGame.set(k, []); byGame.get(k).push(f) })
    const lanes = [...byGame.entries()].map(([name, list]) => { const gid = list.find((f) => f.game)?.game; return { name, list, g: gid ? G(gid) : null } }).sort((a, b) => b.list.length - a.list.length)
    const online = FRIENDS.filter((f) => !f.member && (f.st === 'online' || f.st === 'away'))
    const members = FRIENDS.filter((f) => f.member && f.st !== 'game')
    const off = FRIENDS.filter((f) => !f.member && f.st === 'offline').sort((a, b) => (b.raw?.lastSeen || 0) - (a.raw?.lastSeen || 0))
    const nOff = lanes.length ? 3 : 6
    const nAm = inGame.filter((f) => !f.member).length, nMb = inGame.length - nAm
    const who = [nAm ? amN(nAm, 'ami', 'amis') : '', nMb ? amN(nMb, 'membre', 'membres') : ''].filter(Boolean).join(' et ')
    const sub = [online.length ? `${online.length} en ligne` : '', VOICE.length ? amN(VOICE.length, 'salon vocal', 'salons vocaux') : ''].filter(Boolean).join(' · ')
    const plaque = (f, big, line) => `<button class="am-pl ${f.id === sel ? 'on' : ''}" aria-pressed="${f.id === sel}" data-id="${esc(f.id)}" data-n="${esc(f.n.toLowerCase())}" ${big ? 'data-big' : ''}>${amAv(f.n, big ? 52 : 40)}<span class="am-pt"><b title="${esc(f.n)}">${esc(f.n)}</b><small>${f.voice && !line ? ic('mic') : ''}<span>${esc(line || amLine(f))}</span></small></span></button>`
    const lane = ({ name, list, g }, big) => {
      const j = list.find((f) => f.join), dev = list.find((f) => f.device)
      const rooms = VOICE.filter((r) => r.people.some((p) => list.some((f) => f.id === p.id)))
      const act = j ? amGo('play', `Rejoindre <b class="am-nm">${esc(j.n)}</b>`, `data-join="${esc(j.id)}" title="Rejoindre ${esc(j.n)}"`) : g && g.installed ? amGo('play', `Lancer <b class="am-nm">${esc(g.short)}</b>`, `data-play="${esc(g.id)}"`) : dev ? `<span class="am-dev">Il joue sur ${esc(dev.device)}</span>` : ''
      return `<section class="am-sq ${big ? 'big' : ''} ${g ? 'has-art' : ''}" aria-label="${esc(name)}" ${g ? `data-lane="${esc(g.id)}" style="--img:url('${amUrl(esc(A(g.hero || g.cover)))}')"` : ''}>${g ? '<div class="am-sq-art"></div>' : ''}
        <div class="am-sq-t"><h2 title="${esc(name)}">${esc(name)}</h2><p class="am-sq-n"><i></i>${amN(list.length, 'joueur', 'joueurs')}</p>${rooms.map((r) => `<button class="am-sq-v" data-voice="${esc(r.id)}" title="Ouvrir le salon dans Discord">${ic('mic')}<span>Salon ${esc(r.name)} · ${r.people.length} en vocal</span></button>`).join('')}</div>
        <div class="am-sq-p">${list.map((f) => plaque(f, big)).join('')}</div>
        <div class="am-sq-a">${act}</div></section>`
    }
    const mini = (f, grp, more) => amMini(f, sel, { grp, more })
    const room = (r) => `<div class="am-room" data-n="${esc(r.people.map((p) => p.n.toLowerCase()).join(' '))}">${ic('mic')}<span class="am-rt"><b title="${esc(r.name)}">${esc(r.name)}</b><small>${amN(r.people.length, 'membre', 'membres')}</small></span><span class="am-stk">${r.people.slice(0, 4).map((p) => amAv(p.n, 24)).join('')}</span>${r.people.length > 4 ? `<small>+${r.people.length - 4}</small>` : ''}${amLk('', 'Ouvrir', `data-voice="${esc(r.id)}" aria-label="Ouvrir le salon ${esc(r.name)} dans Discord"`, 'sm')}</div>`
    // Au-delà de n lignes, un lien « Voir les N … » ouvre le reste ; la recherche l'ouvre aussi
    const capList = (list, grp, n, what) => list.map((f, i) => mini(f, grp, i >= n)).join('') + (list.length > n ? amLk('', '', `data-act="cap" data-g="${grp}" data-total="${list.length}" data-what="${what}" aria-expanded="false"`, 'sm') : '')
    const col = (t, n, body) => `<section class="am-bc"><h2 class="am-bh"><span>${t}</span><b class="num">${n}</b></h2>${body}</section>`
    const calm = `<section class="am-sq am-calm" aria-label="Personne ne joue">${`<svg class="am-shield" viewBox="10 1 100 118" aria-hidden="true"><path d="${HX_SHIELD}"/></svg>`}
      <div class="am-sq-t"><h2>Personne ne joue pour l’instant</h2><p class="am-sq-n"><i></i>${online.length ? amN(online.length, 'ami connecté', 'amis connectés') : 'Aucun ami connecté'}</p></div>
      <p class="am-calm-p">${esc(amWatchText())}</p>
      ${online.length ? `<div class="am-sq-p">${online.map((f) => plaque(f, true, [f.on, f.st === 'away' ? 'absent' : 'en ligne'].join(' · '))).join('')}</div>` : ''}</section>`
    const errs = Object.entries(res.errors || {}).map(([p, m]) => `<div class="lb-note">${ic('warn')}<p><b>${esc({ steam: 'Steam', discord: 'Discord', psn: 'PlayStation' }[p])}</b> : ${esc(m)}</p><button class="am-lk" data-fix>Voir mes comptes</button></div>`).join('')
    const bench = [
      !lanes.length || !online.length ? '' : col('En ligne', online.length, capList(online, 'on', CAP, 'en ligne')),
      members.length ? col(res.discordServer ? `Serveur ${esc(res.discordServer)}` : 'Serveur Discord', members.length, capList(members, 'mb', CAP, members.length > 1 ? 'membres' : 'membre')) : '',
      VOICE.length ? col('Vocal', VOICE.reduce((n, r) => n + r.people.length, 0), VOICE.map(room).join('')) : '',
      off.length ? col('Hors ligne', off.length, capList(off, 'off', nOff, 'hors ligne')) : ''
    ].join('')
    const tools = `${amSwitch()}${FRIENDS.length > 6 ? `<label class="am-q">${ic('search')}<span class="vh">Chercher dans tes amis</span><input id="frQ" type="search" placeholder="Chercher un ami" autocomplete="off" spellcheck="false" value="${esc(frQ)}"></label>` : ''}<button class="am-ic" id="frRef" aria-label="Actualiser les amis" data-tip="Relire tes comptes" data-tip-b data-tip-r>${ic('refresh')}</button>`
    const head = `<header class="am-hd"><div><p class="am-eye"><i></i>Amis · ce soir</p><div class="am-ttl"><h1 class="am-title">${FRIENDS.length ? (who ? `${who} en jeu` : 'Soirée calme') : 'Amis'}</h1>${sub ? `<span class="am-sub">${sub}</span>` : ''}</div></div><div class="am-tools">${tools}</div></header>`
    sc.innerHTML = lay === 'c' ? amPortraits({ sel, lanes, online, members, off, res, tools }) : FRIENDS.length
      ? `<div class="am-page"><div class="am-main">${head}${errs}${lanes.length ? lanes.map((l, i) => lane(l, i === 0)).join('') : calm}
        ${bench ? `<div class="am-bn">${bench}</div>` : ''}
        <div class="am-none" id="frNone" hidden><p>Aucun ami ne s’appelle comme ça.</p>${amLk('', 'Effacer la recherche', 'id="frClr"')}</div></div>
        <aside class="am-side" aria-label="Fiche de l’ami"><div id="frCard"></div></aside></div>`
      : `<div class="am-page am-solo"><div class="am-main">${head}${errs}${!errs ? `<div class="empty"><span class="empty-x">${ic('users')}</span><h2>Vois qui joue, et à quoi</h2><p>Relie Steam, PlayStation ou un serveur Discord : tes amis et les membres du serveur s’affichent ici.</p><button class="gs-btn" id="frAcc"><span class="gs-in">Connecter un compte</span></button></div>` : ''}</div></div>`
    const main = $('.am-main', sc); if (main) main.scrollTop = keepY
    $$('[data-lane]', sc).forEach((el) => amStyle(el, G(el.dataset.lane)))
    $$('[data-lay]', sc).forEach((b) => b.onclick = () => { if (amLay === b.dataset.lay) return; amSetLay(b.dataset.lay); renderFriends() })
    $$('[data-id]', sc).forEach((b) => b.onclick = () => {
      // Portraits : le héros, le fond, le panneau et l'état des cartes changent, pas la page ; Escouades : seule la fiche
      if (lay === 'c') { amChoose(b.dataset.id); return }
      S.friend = b.dataset.id
      $$('[data-id]', sc).forEach((x) => { const on = x.dataset.id === S.friend; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on) }); friendCard()
    })
    const row = $('#cRow', sc)
    $$('[data-fil]', sc).forEach((b) => b.onclick = () => { cFil = b.dataset.fil; cX = 0; $$('[data-fil]', sc).forEach((x) => x.setAttribute('aria-pressed', x === b)); filterFriends(sc); if (row) row.scrollLeft = 0 })
    if (row) {
      row.scrollLeft = Math.min(cX, Math.max(0, row.scrollWidth - row.clientWidth))
      // La molette verticale fait défiler l'étagère de côté (écouteur non passif : on annule le défilement vertical)
      row.addEventListener('wheel', (e) => { if (row.scrollWidth > row.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); row.scrollLeft += e.deltaY } }, { passive: false })
      row.addEventListener('scroll', () => { cX = row.scrollLeft }, { passive: true })
      row.addEventListener('keydown', (e) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key) || !e.target.classList?.contains('am-c-card')) return
        const cards = amCards(row), i = cards.indexOf(e.target)
        const j = e.key === 'Home' ? 0 : e.key === 'End' ? cards.length - 1 : Math.max(0, Math.min(cards.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))
        e.preventDefault()
        if (j !== i && cards[j]) amChoose(cards[j].dataset.id, { focus: cards[j], delay: 150 })
      })
    }
    $$('[data-voice]', sc).forEach((b) => b.onclick = () => API.openDiscordChannel(b.dataset.voice).catch(() => toast('Discord n’a pas pu s’ouvrir sur ce salon.', { tone: 'warn', ms: 3000 })))
    $$('[data-join]', sc).forEach((b) => b.onclick = () => API.friendSteam('join', b.dataset.join).catch((e) => toast(esc(errText(e)), { tone: 'warn', ms: 4000 })))
    $$('[data-play]', sc).forEach((b) => b.onclick = () => { const g = G(b.dataset.play); if (g) launchFromSheet(g) })
    $$('[data-fix]', sc).forEach((b) => b.onclick = () => Settings.open('accounts'))
    $$('[data-act=cap]', sc).forEach((b) => b.addEventListener('click', () => { capOpen[b.dataset.g] = !capOpen[b.dataset.g]; filterFriends(sc) }))
    $('#frAcc', sc)?.addEventListener('click', () => Settings.open('accounts'))
    $('#frRef', sc).onclick = async (e) => { const b = e.currentTarget; b.setAttribute('aria-busy', 'true'); await Real.loadFriends(); b.removeAttribute('aria-busy') }
    const q = $('#frQ', sc)
    if (q) {
      q.oninput = () => { frQ = q.value; filterFriends(sc) }
      q.onkeydown = (e) => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = frQ = ''; filterFriends(sc) } }
      if (typing) { q.focus(); q.setSelectionRange(q.value.length, q.value.length) }
    }
    $('#frClr', sc)?.addEventListener('click', () => { frQ = ''; if (q) { q.value = ''; q.focus() } filterFriends(sc) })
    filterFriends(sc)
    friendCard()
    if (row) {
      const c = $('.am-c-card.on', row)
      if (c && !c.hidden && cSel !== sel) { const r = row.getBoundingClientRect(), cr = c.getBoundingClientRect(); if (cr.left < r.left + 72) row.scrollLeft -= r.left + 72 - cr.left; else if (cr.right > r.right - 110) row.scrollLeft += cr.right - (r.right - 110) }
      cSel = sel; cX = row.scrollLeft
    }
    if (fkey) $(fkey, sc)?.focus({ preventScroll: true })
  }
  // La recherche filtre les joueurs, les colonnes et les rangées (une rangée ou une colonne sans personne visible disparaît) ; les hors ligne s'ouvrent pendant qu'on cherche
  function filterFriends(sc) {
    const q = frQ.trim().toLowerCase()
    $$('[data-n]', sc).forEach((b) => { b.hidden = !!q ? !b.dataset.n.includes(q) : !!b.dataset.x && !capOpen[b.dataset.g] })
    $$('.am-sq, .am-bc', sc).forEach((g) => { g.hidden = !!q && !$$('[data-n]', g).some((b) => !b.hidden) })
    // Portraits : le filtre cache des groupes entiers, la recherche des cartes puis les groupes vides
    $$('.am-c-g', sc).forEach((g) => { g.hidden = (!!cFil && g.dataset.grp !== cFil) || (!!q && !$$('[data-n]', g).some((b) => !b.hidden)) })
    const row = $('#cRow', sc)
    if (row) {
      const z = $('.am-c-0', row); if (z) z.hidden = !(cFil && !$(`.am-c-g[data-grp="${cFil}"]`, row))
      amRove(row); row.scrollLeft = Math.min(row.scrollLeft, Math.max(0, row.scrollWidth - row.clientWidth))
    }
    const bn = $('.am-bn', sc); if (bn) bn.hidden = !$$('.am-bc', bn).some((c) => !c.hidden)
    $$('[data-act=cap]', sc).forEach((lk) => { const o = !!capOpen[lk.dataset.g]; lk.hidden = !!q; lk.textContent = o ? 'Réduire' : `Voir les ${lk.dataset.total} ${lk.dataset.what}`; lk.setAttribute('aria-expanded', o) })
    const none = $('#frNone', sc); if (none) none.hidden = !q || $$('[data-n]', sc).some((b) => !b.hidden && !b.closest('.am-c-g[hidden]'))
  }
  const hoursOf = (m) => Shared.text.formatPlaytime(m)
  const bigHours = (m) => `${Math.round(m / 60).toLocaleString('fr-FR')} h`
  const steamArt = (appId) => `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`
  // Le dessin de la fiche garde le focus là où il était (bouton, lien, personne du salon)
  function amPaint(f, p, loading) {
    const fk = amFocusKey(document.activeElement, $('#frCard'))
    amLay === 'c' ? paintHero(f, p, loading) : paintCard(f, p, loading)
    if (fk) $(fk)?.focus({ preventScroll: true })
  }
  // delay : après des flèches rapprochées, le profil n'est demandé qu'une fois la dernière posée
  function friendCard(delay = 0) {
    const f = amPick()
    clearTimeout(cTimer)
    if (!f) return
    if (comFor !== f.id) { comFor = f.id; comAll = false }
    const steam = f.raw?.platform === 'steam', lay = amLay, cached = steam ? Real.cachedProfile(f.id) : null
    amPaint(f, cached, steam && cached === undefined)
    if (!steam) return
    const load = async () => { const p = await amProfile(f.id); if (amPick() === f && amLay === lay) amPaint(f, p, false) }
    if (delay) cTimer = setTimeout(load, delay); else load()
  }
  function paintCard(f, p, loading) {
    const box = $('#frCard'); if (!box) return
    const fa = amFacts(f, p), { g, kpi } = fa
    const main = f.join ? amGo('play', 'Rejoindre sa partie', 'id="fcJoin"', 'wide') : g && g.installed ? amGo('play', `Lancer <b>${esc(g.short)}</b>`, 'id="fcPlay"', 'wide') : ''
    // Comme un profil Steam : son fond sur toute la fiche, son avatar (animé s'il en a un) dans son cadre, son pays, son ancienneté, son niveau avec le badge aux couleurs de Steam
    const lv = p?.level != null ? `<div class="am-ds-lv" aria-label="Niveau Steam ${p.level}"><span class="am-ds-b num" style="--lv:${amLvColor(p.level)}">${p.level}</span><div><b>Niveau Steam ${p.level}</b>${p.levelProgress != null ? `<span class="am-xp" title="${Math.round(p.levelProgress * 100)} % vers le niveau ${p.level + 1}"><i style="width:${Math.round(p.levelProgress * 100)}%"></i></span>` : ''}</div></div>` : ''
    const links = amLinks(f, fa)
    amSaveDs()
    const keepY = dsY.get(amKey('a', f.id)) || 0
    box.dataset.f = f.id
    box.innerHTML = `<article class="am-ds" ${g ? `data-gid="${esc(g.id)}"` : ''}>
      <div class="am-ds-sc">
        <div class="am-ds-art" ${fa.bg ? `style="background-image:url('${amUrl(esc(fa.bg))}')"` : ''}>${fa.bg ? '' : `<svg viewBox="10 1 100 118" aria-hidden="true"><path d="${HX_SHIELD}"/></svg>`}</div>
        <div class="am-ds-id">${amAva(f, p, fa)}
          <div class="am-ds-nm"><h2 title="${esc(f.n)}">${esc(f.n)}</h2>${fa.meta.length ? `<p class="am-ds-meta">${esc(fa.meta.join(' · '))}</p>` : ''}<p class="am-ds-st"><i style="background:${amDot(f)}"></i><span>${fa.line}</span></p></div></div>
        ${lv}
        ${kpi.length ? `<dl class="am-ds-k">${kpi.map(([k, v]) => `<div${k === 'Ami depuis' ? ' class="w2"' : ''}><dt>${esc(k)}</dt><dd class="num" title="${esc(String(v))}">${esc(String(v))}</dd></div>`).join('')}</dl>` : ''}
        ${main || links.length ? `<div class="am-ds-a">${main}${links.length ? `<div class="am-links">${links.join('')}</div>` : ''}</div>` : ''}
        ${loading ? '<div class="am-ds-load" aria-hidden="true"><i></i><i></i><i></i></div>' : ''}
        ${amDuel(fa)}${amRecent(fa)}${amNotes(f, p)}
      </div></article>`
    const sc2 = $('.am-ds-sc', box); if (sc2 && keepY) sc2.scrollTop = keepY
    amStyle($('.am-ds', box), g)
    amAvaFix(box, f)
    amWire(box, f, p, fa, () => amPaint(f, p, false))
  }
  // Disposition « Portraits » : fond, héros et panneau « Vous deux » de l'ami choisi
  function paintHero(f, p, loading) {
    const box = $('#frCard'); if (!box) return
    const fa = amFacts(f, p), { g } = fa, root = $('.am-c'), pp = amPub(p)
    const eye = f.st === 'game' ? `En jeu · ${f.gameName}` : f.member ? `Serveur ${Real.st.friendsRes?.discordServer || 'Discord'}` : f.st === 'online' ? 'En ligne' : f.st === 'away' ? 'Absent' : 'Hors ligne'
    const eyeSub = f.st === 'game' ? amLine(f) : f.member ? (f.activity || (f.voice ? `en vocal, ${f.voice}` : '')) : f.st === 'offline' ? (f.seen ? f.seen.replace('Vu pour la dernière fois', 'vu') : f.on) : f.on
    const meta = [...fa.meta, f.since && `Ami depuis ${f.since.replace('Ami depuis ', '')}`].filter(Boolean).join(' · ')
    const pills = [
      p?.level != null && `<span class="am-c-pill" aria-label="Niveau Steam ${p.level}"><span class="am-ds-b num" style="--lv:${amLvColor(p.level)}">${p.level}</span><b>Niveau ${p.level}</b>${p.levelProgress != null ? `<span class="am-xp" title="${Math.round(p.levelProgress * 100)} % vers le niveau ${p.level + 1}"><i style="width:${Math.round(p.levelProgress * 100)}%"></i></span>` : ''}</span>`,
      pp?.gameCount && `<span class="am-c-pill"><b class="num">${pp.gameCount.toLocaleString('fr-FR')}</b> jeux</span>`,
      pp?.totalMinutes && `<span class="am-c-pill"><b class="num">${bigHours(pp.totalMinutes)}</b> de jeu</span>`,
      pp?.badgeCount && `<span class="am-c-pill"><b class="num">${pp.badgeCount.toLocaleString('fr-FR')}</b> badges</span>`,
      f.voice && `<span class="am-c-pill">${ic('mic')}En vocal · <b>${esc(f.voice)}</b></span>`
    ].filter(Boolean).join('')
    // Un seul bouton plein : rejoindre, sinon lancer, sinon le salon, sinon écrire
    const mainK = f.join ? 'join' : g && g.installed ? 'play' : f.voiceId ? 'voice' : fa.steam ? 'msg' : ''
    const main = { join: () => amGo('play', 'Rejoindre sa partie', 'id="fcJoin"'), play: () => amGo('play', `Lancer <b>${esc(g.short)}</b>`, 'id="fcPlay"'), voice: () => amGo('mic', 'Ouvrir le salon', 'id="fcVoice"'), msg: () => amGo('chat', 'Écrire', 'id="fcMsg"') }[mainK]?.() || ''
    const links = amLinks(f, fa, mainK === 'voice' ? 'fcVoice' : mainK === 'msg' ? 'fcMsg' : '')
    const room = f.voiceId ? VOICE.find((r) => r.id === f.voiceId) : null
    const sel = f.id
    const roomHtml = room ? `<section><h3 class="am-ds-h"><span>Dans le salon ${esc(room.name)}</span><span class="num">${room.people.length}</span></h3>${room.people.map((x) => amMini(x, sel, { c: true, tag: false, sub: x.st === 'game' ? x.gameName : x.raw?.voice?.deafened ? 'Casque coupé' : x.raw?.voice?.muted ? 'Micro coupé' : 'En vocal' })).join('')}</section>` : ''
    const duo = amDuel(fa) + amRecent(fa) + roomHtml + amNotes(f, p) + (loading ? '<div class="am-ds-load" aria-hidden="true"><i></i><i></i><i></i></div>' : '')
    const px = PxType.ok(f.n) && f.n.length <= 16
    amSaveDs()
    const keepY = dsY.get(amKey('c', f.id)) || 0
    box.dataset.f = f.id
    box.innerHTML = `<div class="am-c-hero ${f.st === 'offline' ? 'off' : ''}">
        <p class="am-c-eye"><i></i>${esc(eye)}${eyeSub ? `<span>${esc(eyeSub)}</span>` : ''}</p>
        <div class="am-c-id">${amAva(f, p, fa, true)}<h2 class="am-c-name ${px ? '' : 'plain'}" title="${esc(f.n)}">${px ? `${PxType.html(f.n)}` : esc(f.n)}</h2></div>
        ${meta ? `<p class="am-c-meta">${esc(meta)}</p>` : ''}
        ${pills ? `<div class="am-c-pills">${pills}</div>` : ''}
        ${main || links.length ? `<div class="am-c-cta">${main}${links.join('')}</div>` : ''}
      </div>
      ${duo ? `<aside class="am-c-duo" aria-label="${p && !p.gamesHidden ? 'Vous deux' : 'Ce qu’on sait'}"><p class="am-c-eye"><i></i>${p && !p.gamesHidden ? 'Vous deux' : 'Ce qu’on sait'}</p>${duo}</aside>` : ''}`
    const d = $('.am-c-duo', box); if (d && keepY) d.scrollTop = keepY
    if (root) { root.dataset.gid = g ? g.id : ''; if (g) amStyle(root, g); else GameStyle.paint(root, { style: 'neutre' }) }
    const bg = $('#cBg')
    if (bg) { bg.className = fa.bg ? 'am-c-bg' : 'am-c-bg no'; bg.style.backgroundImage = fa.bg ? `url('${amUrl(fa.bg)}')` : ''; bg.innerHTML = fa.bg ? '' : `<svg viewBox="10 1 100 118" aria-hidden="true"><path d="${HX_SHIELD}"/></svg>` }
    amAvaFix(box, f, true)
    amWire(box, f, p, fa, () => amPaint(f, p, false))
    // Les gens du salon, dans le panneau : un clic les met à la une, sans refaire la page
    $$('[data-id]', box).forEach((b) => b.onclick = () => amChoose(b.dataset.id))
  }
  // La fiche ouverte suit l'état du jeu : mise à jour finie, jeu lancé ou fermé
  function syncSheet() {
    const g = G(S.gameId), b = $('#gpPlay'); if (!g || !b) return
    const lab = $('.pb-in span', b); if (lab) lab.textContent = playLabel(g)
    if (g.update) b.title = g.updateAction.title; else b.removeAttribute('title')
  }
  return { mount, enter, refresh, syncSheet, openGame, closeGame, cols, rescan }
})()
