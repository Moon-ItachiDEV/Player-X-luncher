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
    menuAt(t, items, { at, main: true, head: `<div class="mn-h"><img src="${esc(A(g.cover))}" alt=""><span><b>${esc(g.name)}</b>${g.time ? `<small>${esc(g.time)} de jeu</small>` : ''}</span></div>` })
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
          <button class="play-btn gp-play" id="gpPlay" ${g.update ? `title="${esc(g.updateAction.title)}"` : ''}><span class="pb-ring"></span><span class="pb-in">${ic(g.installed && !g.update ? 'play' : 'down')}<span>${esc(playLabel(g))}</span></span></button>
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

  /* ---------- Amis, et membres du serveur Discord ---------- */
  let offOpen = null, frQ = ''
  function renderFriends() {
    Fluid.set(['#071a24', '#0e3a4a', '#1f8a9c', '#4b2a72'])
    const sc = $('#sc-friends'), res = Real.st.friendsRes
    if (!res) {
      sc.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Amis</h1><p class="pg-sub" role="status">Lecture de tes comptes…</p></div></header><div class="fr-grid" aria-hidden="true"><div class="fr-list">${[0, 1, 2, 3].map(() => '<div class="fr fr-sk"><i></i><span><i></i><i></i></span></div>').join('')}</div></div>`
      return
    }
    const typing = document.activeElement?.id === 'frQ'
    const inGame = FRIENDS.filter((f) => f.st === 'game')
    const byGame = new Map()
    inGame.forEach((f) => { const k = f.gameName || '?'; if (!byGame.has(k)) byGame.set(k, []); byGame.get(k).push(f) })
    const online = FRIENDS.filter((f) => !f.member && (f.st === 'online' || f.st === 'away'))
    const members = FRIENDS.filter((f) => f.member && f.st !== 'game')
    const off = FRIENDS.filter((f) => !f.member && f.st === 'offline')
    // Sous le nom, seulement ce que la ligne ne dit pas déjà : le vocal, « Absent », la dernière fois vu. La plateforme est à droite, le statut dans le titre du groupe.
    const subOf = (f) => (f.member ? f.activity || (f.voice ? `En vocal, ${f.voice}` : '') : f.st === 'away' ? 'Absent' : f.st === 'online' ? '' : f.seen ? f.seen.replace('Vu pour la dernière fois', 'Vu') : '')
    const row = (f) => `<button class="fr ${S.friend === f.id ? 'on' : ''}" data-id="${esc(f.id)}" data-n="${esc(f.n.toLowerCase())}">${avatar(f.n, 36)}<i class="fr-s st-${f.st === 'away' ? 'online' : f.st}"></i><span class="fr-t"><b>${esc(f.n)}</b>${subOf(f) ? `<span>${esc(subOf(f))}</span>` : ''}</span><span class="fr-on">${esc(f.on)}</span></button>`
    // Les amis en jeu d'abord, en grandes cartes : la jaquette du jeu, et qui y joue
    const card = ([name, list]) => { const g = list[0].game ? G(list[0].game) : null; return `<article class="fn ${g ? 'has-art' : ''}">${g ? `<img class="fn-art" src="${esc(A(g.hero || g.cover))}" alt="">` : ''}<div class="fn-in"><h3>${esc(name)}</h3><div class="fn-p">${list.map((f) => `<button class="fn-f ${S.friend === f.id ? 'on' : ''}" data-id="${esc(f.id)}" data-n="${esc(f.n.toLowerCase())}">${avatar(f.n, 28)}<span>${esc(f.n)}</span><em>${esc(f.on)}</em></button>`).join('')}</div></div></article>` }
    const errs = Object.entries(res.errors || {}).map(([p, m]) => `<div class="lb-note">${ic('warn')}<p><b>${esc({ steam: 'Steam', discord: 'Discord', psn: 'PlayStation' }[p])}</b> : ${esc(m)}</p><button class="btn sm" data-fix>Voir mes comptes</button></div>`).join('')
    sc.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Amis</h1></div><div class="fr-tools">${FRIENDS.length > 6 ? `<label class="fr-q">${ic('search')}<span class="vh">Chercher dans tes amis</span><input id="frQ" type="search" placeholder="Chercher un ami" autocomplete="off" spellcheck="false" value="${esc(frQ)}"></label>` : ''}<button class="btn sm" id="frRef" data-tip="Relire tes comptes" data-tip-b data-tip-r>${ic('refresh')}Actualiser les amis</button></div></header>
      ${errs}
      ${byGame.size ? `<section class="fr-now" aria-label="En jeu maintenant"><h2>En jeu maintenant <span class="fr-c">${inGame.length}</span></h2><div class="fn-row">${[...byGame.entries()].map(card).join('')}</div></section>` : ''}
      ${FRIENDS.length ? `<div class="fr-grid">
        <div class="fr-list">
          ${online.length ? `<section class="fr-g"><header><h2>En ligne</h2><span class="fr-c">${online.length}</span></header>${online.map(row).join('')}</section>` : ''}
          ${members.length ? `<section class="fr-g"><header><h2>Membres du serveur${res.discordServer ? ` ${esc(res.discordServer)}` : ''}</h2><span class="fr-c">${members.length}</span></header>${members.map(row).join('')}</section>` : ''}
          ${off.length ? `<details class="fr-g fr-off" ${offOpen ?? !(online.length + inGame.length) ? 'open' : ''}><summary><h2>Hors ligne</h2><span class="fr-c">${off.length}</span>${ic('chevd')}</summary>${off.map(row).join('')}</details>` : ''}
          ${!online.length && !members.length && !off.length ? '<p class="fr-none">Tous tes amis connectés sont en jeu.</p>' : ''}
          <div class="fr-none" id="frNone" hidden><p>Aucun ami ne s’appelle comme ça.</p><button class="btn sm" id="frClr">Effacer la recherche</button></div>
        </div>
        <div class="fr-side">
          <div id="frCard"></div>
          ${VOICE.length ? `<section class="vc"><h2>Vocal sur ton serveur Discord</h2>${VOICE.map((v) => `<div class="vc-r"><span class="vc-i">${ic('mic')}</span><div class="vc-t"><b>${esc(v.name)}</b><span>${v.people.length} membre${v.people.length > 1 ? 's' : ''}</span></div><span class="vc-av">${v.people.slice(0, 5).map((p) => avatar(p.n, 26)).join('')}</span><button class="btn sm" data-voice="${esc(v.id)}">Ouvrir dans Discord</button></div>`).join('')}</section>` : ''}
        </div>
      </div>` : !errs ? `<div class="empty"><span class="empty-x">${ic('users')}</span><h2>Vois qui joue, et à quoi</h2><p>Relie Steam, PlayStation ou un serveur Discord : tes amis et les membres du serveur s’affichent ici.</p><button class="btn sm rose" id="frAcc">Connecter un compte</button></div>` : ''}`
    $('.fr-off', sc)?.addEventListener('toggle', (e) => { if (!frQ) offOpen = e.currentTarget.open })
    $$('.fr, .fn-f', sc).forEach((b) => b.onclick = () => { S.friend = b.dataset.id; $$('.fr, .fn-f', sc).forEach((x) => x.classList.toggle('on', x.dataset.id === S.friend)); friendCard() })
    $$('[data-voice]', sc).forEach((b) => b.onclick = () => API.openDiscordChannel(b.dataset.voice).catch(() => toast('Discord n’a pas pu s’ouvrir sur ce salon.', { tone: 'warn', ms: 3000 })))
    $$('[data-fix]', sc).forEach((b) => b.onclick = () => Settings.open('accounts'))
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
  }
  // La recherche filtre les cartes « en jeu » et la liste ; les hors ligne s'ouvrent pendant qu'on cherche
  function filterFriends(sc) {
    const q = frQ.trim().toLowerCase()
    $$('.fr, .fn-f', sc).forEach((b) => { b.hidden = !!q && !(b.dataset.n || '').includes(q) })
    $$('.fr-g', sc).forEach((g) => { g.hidden = !!q && !$$('.fr', g).some((b) => !b.hidden) })
    $$('.fn', sc).forEach((c) => { c.hidden = !!q && !$$('.fn-f', c).some((b) => !b.hidden) })
    const off = $('.fr-off', sc); if (off && q) off.open = true; else if (off && offOpen !== null) off.open = offOpen
    const none = $('#frNone', sc); if (none) none.hidden = !q || $$('.fr, .fn-f', sc).some((b) => !b.hidden)
    const list = $('.fr-list', sc); if (list) list.classList.toggle('is-empty', !!q && !$$('.fr', list).some((b) => !b.hidden) && $$('.fn-f', sc).some((b) => !b.hidden))
  }
  const hoursOf = (m) => Shared.text.formatPlaytime(m)
  const bigHours = (m) => `${Math.round(m / 60).toLocaleString('fr-FR')} h`
  const steamArt = (appId) => `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`
  async function friendCard() {
    const f = FRIENDS.find((x) => x.id === S.friend) || FRIENDS[0]
    if (!f) return
    const steam = f.raw?.platform === 'steam'
    paintCard(f, steam ? Real.cachedProfile(f.id) : null, steam && Real.cachedProfile(f.id) === undefined)
    if (!steam) return
    const p = await Real.friendProfile(f.id)
    if ((FRIENDS.find((x) => x.id === S.friend) || FRIENDS[0]) === f) paintCard(f, p, false)
  }
  function paintCard(f, p, loading) {
    const box = $('#frCard'); if (!box) return
    const g = f.game ? G(f.game) : null, url = Shared.friendView.steamProfileUrl(f.raw), steam = f.raw?.platform === 'steam'
    const line = f.st === 'game' ? `Joue à <b>${esc(f.gameName)}</b>` : f.member ? (f.activity ? esc(f.activity) : f.voice ? 'En vocal' : 'Membre du serveur Discord') : f.st === 'online' ? 'En ligne' : f.st === 'away' ? 'Absent' : esc(f.seen || 'Hors ligne')
    const bg = p?.background || (g ? A(g.hero || g.cover) : '')
    const kpi = [
      p?.gameCount && ['Jeux', p.gameCount.toLocaleString('fr-FR')],
      p?.totalMinutes && ['Heures de jeu', bigHours(p.totalMinutes)],
      p?.badgeCount && ['Badges', p.badgeCount.toLocaleString('fr-FR')],
      p?.friendCount && ['Amis', p.friendCount.toLocaleString('fr-FR')],
      f.since && ['Ami', f.since.replace('Ami depuis ', 'Depuis ')],
      !steam && ['Sur', f.on], f.device && ['Appareil', f.device], f.voice && ['En vocal', f.voice]
    ].filter(Boolean)
    // Jeux en commun : ceux de ta bibliothèque Steam qu'il a aussi, les plus joués à vous deux d'abord
    const common = (p?.games || []).map((x) => ({ x, g: Real.byRid(`steam:${x.appId}`) })).filter((o) => o.g).map((o) => ({ ...o, me: o.g.raw?.playtime || 0 })).sort((a, b) => (b.x.minutes + b.me) - (a.x.minutes + a.me))
    const recent = (p?.recent || []).map((x) => ({ x, g: Real.byRid(`steam:${x.appId}`) }))
    const watch = Real.watched(f.id), canWatch = !f.member && (steam || f.raw?.platform === 'psn')
    const main = f.join ? `<button class="btn rose sm" id="fcJoin">${ic('play')}Rejoindre sa partie</button>` : g && g.installed ? `<button class="btn rose sm" id="fcPlay">${ic('play')}Lancer ${esc(g.short)}</button>` : ''
    // Comme un profil Steam : son fond sur toute la fiche, son avatar (animé s'il en a un) dans son cadre, son pays, son ancienneté, son niveau avec le badge aux couleurs de Steam
    const region = (c) => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }).of(c) } catch { return c } }
    const meta = [p?.country && region(p.country), p?.memberSince && `Membre depuis ${new Date(p.memberSince).getFullYear()}`].filter(Boolean)
    const ava = p?.avatarAnimated || p?.avatarFull || f.avatar
    const lvColor = (l) => l >= 100 ? '#c9a14a' : ['#9b9b9b', '#c02942', '#d95b43', '#fecc23', '#467a3c', '#4e8ddb', '#7652c9', '#c252c9', '#8a5a6e', '#997c52'][Math.floor(l / 10)]
    const lv = p?.level != null ? `<div class="sp-lv" aria-label="Niveau Steam ${p.level}"><span class="sp-badge num" style="--lv:${lvColor(p.level)}">${p.level}</span><div><b>Niveau ${p.level}</b>${p.levelProgress != null ? `<span class="sp-xp" title="${Math.round(p.levelProgress * 100)} % vers le niveau ${p.level + 1}"><i style="width:${Math.round(p.levelProgress * 100)}%"></i></span>` : ''}</div></div>` : ''
    box.innerHTML = `<article class="fc fc2 ${bg ? 'has-art' : ''} ${p?.background ? 'sp-bg' : ''}">${bg ? `<img class="fc-art" src="${esc(bg)}" alt="">` : ''}<div class="fc-in">
      <div class="sp-top"><div class="fc-av sp-av">${ava ? `<span class="sp-img"><img src="${esc(ava)}" alt=""></span>` : avatar(f.n, 96)}${p?.avatarFrame ? `<img class="fc-fr" src="${esc(p.avatarFrame)}" alt="">` : ''}</div>
      <div class="sp-id"><h2>${esc(f.n)}</h2>${meta.length ? `<p class="sp-meta">${esc(meta.join(' · '))}</p>` : ''}<p class="sp-st is-${f.st}">${line}</p></div>${lv}</div>
      ${kpi.length ? `<dl class="fc-d">${kpi.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(String(v))}</dd></div>`).join('')}</dl>` : ''}
      <div class="fc-a">${main}${steam ? `<button class="btn sm" id="fcMsg">${ic('chat')}Écrire</button>` : ''}${canWatch ? `<button class="btn sm fc-w" id="fcWatch" aria-pressed="${watch}">${ic(watch ? 'check' : 'bell')}${watch ? 'Tu seras prévenu' : 'Préviens-moi quand il joue'}</button>` : ''}${url ? '<button class="btn sm" id="fcProfile">Profil Steam</button>' : ''}${f.voiceId ? '<button class="btn sm" id="fcVoice">Ouvrir le salon</button>' : ''}${f.member ? '<button class="btn sm" id="fcHide">Masquer ce membre</button>' : ''}</div></div>
      ${loading ? '<div class="fc-sec fc-load" aria-hidden="true"><i></i><i></i><i></i></div>' : ''}
      ${recent.length ? `<section class="fc-sec"><h3>Ces 2 dernières semaines</h3><ul class="fc-rec">${recent.map(({ x, g: mg }) => `<li><img src="${esc(mg ? A(mg.hero || mg.cover) : steamArt(x.appId))}" alt="" loading="lazy" decoding="async"><b>${esc(mg?.name || x.name || 'Jeu Steam')}</b><span class="num">${esc(hoursOf(x.recentMinutes))}</span></li>`).join('')}</ul></section>` : ''}
      ${common.length ? `<section class="fc-sec"><h3>Jeux en commun <span class="fr-c">${common.length}</span></h3><div class="fc-com">${common.slice(0, 8).map(({ x, g: mg, me }) => `<button class="fc-cg" data-g="${esc(mg.id)}" aria-label="${esc(mg.name)} : lui ${esc(hoursOf(x.minutes) || '0 h')}, toi ${esc(hoursOf(me) || '0 h')}"><img src="${esc(A(mg.cover))}" alt="" loading="lazy" decoding="async"><span><em>Lui</em> ${esc(hoursOf(x.minutes) || '0 h')}</span><span><em>Toi</em> ${esc(hoursOf(me) || '0 h')}</span></button>`).join('')}</div></section>` : ''}
      ${p?.gamesHidden ? '<p class="fc-priv">Son profil Steam est privé : ses jeux et ses heures ne sont pas visibles.</p>' : ''}
    </article>`
    $('#fcPlay', box)?.addEventListener('click', () => launchFromSheet(g))
    $('#fcJoin', box)?.addEventListener('click', () => API.friendSteam('join', f.id).catch((e) => toast(esc(errText(e)), { tone: 'warn', ms: 4000 })))
    $('#fcMsg', box)?.addEventListener('click', () => API.friendSteam('message', f.id).catch(() => toast('Steam n’a pas pu s’ouvrir.', { tone: 'warn', ms: 3000 })))
    $('#fcWatch', box)?.addEventListener('click', async () => {
      const on = !Real.watched(f.id)
      try { await Real.setWatch(f.id, on); toast(on ? `${ic('bell')} Tu seras prévenu quand ${esc(f.n)} lance un jeu` : `Plus d’alerte pour ${esc(f.n)}`, { ms: 2400 }) } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 4000 }) }
      paintCard(f, p, false)
    })
    $$('.fc-cg', box).forEach((b) => b.onclick = () => openGame(b.dataset.g, $('img', b)))
    $('#fcProfile', box)?.addEventListener('click', () => API.openExternal(url))
    $('#fcVoice', box)?.addEventListener('click', () => API.openDiscordChannel(f.voiceId).catch(() => {}))
    $('#fcHide', box)?.addEventListener('click', async () => {
      Real.applyFriends(await API.setMemberHidden(f.n, true))
      toast(`${esc(f.n)} masqué de la liste`, { ms: 5000, action: { label: 'Annuler', fn: async () => Real.applyFriends(await API.setMemberHidden(f.n, false)) } })
    })
  }
  // La fiche ouverte suit l'état du jeu : mise à jour finie, jeu lancé ou fermé
  function syncSheet() {
    const g = G(S.gameId), b = $('#gpPlay'); if (!g || !b) return
    const lab = $('.pb-in span', b); if (lab) lab.textContent = playLabel(g)
    if (g.update) b.title = g.updateAction.title; else b.removeAttribute('title')
  }
  return { mount, enter, refresh, syncSheet, openGame, closeGame, cols, rescan }
})()
