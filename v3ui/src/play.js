// Accueil « Jouer » : le texte à gauche, la pile de jaquettes en profondeur à droite. La molette fait voler à travers les jeux.
const Play = (() => {
  // La pile : tes jeux installés les plus récents (la bibliothèque a tout le reste)
  const PILE_MAX = 12
  let pinned = null
  const list = () => {
    const pile = GAMES.filter((g) => g.installed && !g.hidden).slice(0, PILE_MAX), p = pinned && G(pinned)
    if (p && !pile.includes(p)) pile.unshift(p)
    return [...pile, { id: '__all', get name() { return GAMES.length ? 'Toute ta bibliothèque' : 'Aucun jeu trouvé' }, cover: null }]
  }
  let introT = 1, introAt = 0, L, N, el, stack, cards = [], pos = 0, target = 0, vel = 0, raf = 0, mx = 0, my = 0, smx = 0, smy = 0, wheelAcc = 0, wheelT = 0, lastStep = 0, launching = false, firstDone = false
  let railBtns = [], railI = -1, peekT = 0, restT = 0, titleWait = false
  const restFns = []
  const wrap = (i) => ((i % N) + N) % N
  const focused = () => L[wrap(Math.round(target))]

  function mount(host) {
    L = list(); N = L.length
    el = h(`<section class="v v-play" data-v="play" aria-label="Accueil" tabindex="-1">
      <div class="hm-bg" id="hmBg" aria-hidden="true"></div>
      <div class="hm-fx" aria-hidden="true"><i class="hm-tint"></i><i class="hm-sweep" id="hmSweep"></i></div>
      <div class="ar-deco" aria-hidden="true"><div class="ar-sol"><i class="as-sheen"></i><i class="as-rays"></i><i class="as-fog f1"></i><i class="as-fog f2"></i><i class="as-dust d1"></i><i class="as-dust d2"></i></div><i class="ar-vig"></i><i class="ar-hor"></i><i class="ar-spot"></i><div class="ar-big" id="arBig"></div><div class="ar-hud"><i></i><i></i><i></i><i></i></div></div>
      <div class="ht">
        <p class="hv-kick" id="hvKick"></p>
        <p class="ht-kick" id="htKick"></p>
        <span class="ar-rank" id="arRank"></span>
        <h1 class="ht-title" id="htTitle"></h1>
        <p class="ht-meta" id="htMeta"></p>
        <div class="hv-chips" id="hvChips"></div>
        <div class="ht-acts">
          <button class="play-btn" id="htPlay"><span class="pb-ring" aria-hidden="true"></span><span class="pb-sh" aria-hidden="true"></span><span class="pb-in">${ic('play')}<span id="htPlayL">Jouer</span><kbd class="pb-k" aria-hidden="true">Entrée</kbd><span class="pb-chev" aria-hidden="true"><b>›</b><b>›</b><b>›</b></span></span></button>
          <button class="dk-b" id="htMore">${ic('info')}<span>Voir la fiche</span></button>
          <button class="dk-b dk-i" id="htFav" aria-label="Favori" aria-pressed="false" data-tip="Ajouter aux favoris"><span class="ic-swap"><span class="a">${ic('star')}</span><span class="b">${ic('starf')}</span></span></button>
        </div>
        <ul class="ht-ready" id="htReady"></ul>
        <p class="hv-news" id="hvNews"></p>
        <ol class="ht-steps" id="htSteps"></ol>
      </div>
      <div class="hv-shk" id="hvShk"></div>
      <div class="stack" id="stack" aria-label="Tes jeux. Molette ou flèches pour changer de jeu."></div>
      <div class="ar-ret" id="arRet" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
      <nav class="ar-idx" id="arIdx" aria-label="Ton arsenal"></nav>
      <aside class="ar-ready" id="arReady" aria-live="polite"></aside>
      <button class="ar-nav" data-step="-1" aria-label="Jeu précédent">${ic('back')}</button><button class="ar-nav ar-nr" data-step="1" aria-label="Jeu suivant">${ic('chev')}</button>
      <div class="rail" id="rail" aria-hidden="false"></div>
      <button class="hm-fr" id="hmFr" data-tip="Voir tes amis" data-tip-b data-tip-r hidden></button>
    </section>`)
    host.append(el)
    stack = $('#stack', el)
    buildCards()
    $$('.ar-nav', el).forEach((b) => b.onclick = () => step(+b.dataset.step))

    el.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return
      e.preventDefault()
      const now = performance.now()
      if (now - wheelT > 220) wheelAcc = 0
      wheelT = now
      wheelAcc += e.deltaY
      const th = Math.abs(e.deltaY) >= 60 ? 60 : 40
      if (Math.abs(wheelAcc) >= th && now - lastStep > 120) { step(Math.sign(wheelAcc)); wheelAcc = 0; lastStep = now }
    }, { passive: false })
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect()
      mx = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1); my = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1)
      kick()
    })
    el.addEventListener('pointerleave', () => { mx = 0; my = 0; kick() })
    $('#htPlay', el).onclick = () => { const g = focused(); if (g.id === '__all') return allAction(); if (S.session?.game === g.id) return Live.show(); if (S.session?.phase === 'launch') return; if (g.needsUpdate) { Real.openSteamDownloads(); toast(`${ic('down')} ${esc(g.updateAction?.title || 'Steam s’ouvre sur ses téléchargements.')}`, { ms: 3200 }); return } Live.launch(g.id) }
    $('#hmFr', el).onclick = () => go('friends')
    $('#htMore', el).onclick = () => { const g = focused(); g.id === '__all' ? go('lib') : openGame(g.id, cards[wrap(Math.round(target))]) }
    $('#htFav', el).onclick = async (e) => { const b = e.currentTarget, g = focused(); await Real.favorite(g); b.setAttribute('aria-pressed', g.fav); b.dataset.tip = g.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'; toast(`${ic(g.fav ? 'starf' : 'star')} ${esc(g.name)} ${g.fav ? 'ajouté aux favoris' : 'retiré des favoris'}`, { ms: 1800 }) }
    const pb = $('#htPlay', el)
    el.addEventListener('pointermove', (e) => {
      if (reduced()) return
      const r = pb.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy)
      const near = d < 170
      pb.style.translate = near ? `${(dx / 170 * 7).toFixed(1)}px ${(dy / 170 * 5).toFixed(1)}px` : ''
    })
    const tt = $('#htTitle', el)
    tt.addEventListener('animationend', (e) => { if (e.target !== tt || !tt.classList.contains('is-in')) return; tt.textContent = tt.getAttribute('aria-label') || tt.textContent; tt.removeAttribute('aria-label') })
    render(true); layout(); paintText(true)
    // Le jeu affiché au démarrage a droit, lui aussi, à ses succès, ses actus et au viseur d'Arsenal
    armRest()
  }
  // « Toute ta bibliothèque » : les vraies jaquettes d'abord, entières, et elle suit celles qui arrivent après coup
  function paintAll() {
    const c = cards.find((x) => x.classList.contains('card-all')); if (!c) return
    // Les jeux installés sont déjà dans la pile : la carte montre d'abord ceux de ton compte qui ne sont pas installés
    const seen = GAMES.filter((x) => !x.hidden), art = (x) => !!(x.raw?.coverUrl || x.ownCover), cov = (l) => [...l.filter(art), ...l.filter((x) => !art(x))]
    const pick = [...cov(seen.filter((x) => !x.installed)), ...cov(seen.filter((x) => x.installed))]
    const n = pick.length >= 9 ? 3 : 2, shown = pick.slice(0, n * n), sig = shown.map((x) => x.cover).join()
    if (c.dataset.sig !== sig) {
      c.dataset.sig = sig
      const box = $('.ca-in', c)
      box.style.setProperty('--n', n)
      box.innerHTML = shown.map((x) => `<img src="${esc(A(x.cover))}" alt="" data-name="${esc(x.name)}" draggable="false" decoding="async">`).join('')
    }
    $('.ca-t>span', c).textContent = seen.length ? `${seen.length} jeu${seen.length > 1 ? 'x' : ''}` : 'Lance une recherche'
  }
  function buildCards() {
    L = list(); N = L.length
    stack.innerHTML = ''
    cards = L.map((g, i) => {
      const c = h(g.id === '__all'
        ? `<button class="card card-all" data-i="${i}" aria-label="${esc(g.name)}"><span class="ca-grid"><span class="ca-in"></span></span><span class="ca-t"><b>${esc(g.name)}</b><span></span></span></button>`
        : `<button class="card" data-i="${i}" data-name="${esc(g.name)}" aria-label="${esc(g.name)}"><img src="${esc(A(g.cover))}" alt="${esc(g.name)}" draggable="false"><span class="card-spec" aria-hidden="true"></span></button>`)
      stack.append(c)
      if (g.cover) c.dataset.cover = g.cover
      c.addEventListener('click', () => {
        const d = wrapD(i)
        if (Math.abs(d) < .5) g.id === '__all' ? allAction() : openGame(g.id, c)
        else goTo(i, home === 'r')
      })
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); if (g.id !== '__all') openGame(g.id, c) })
      return c
    })
    paintAll()
    const rail = $('#rail', el)
    rail.hidden = L.length < 2
    rail.innerHTML = L.map((g, i) => `<button class="rail-t" data-i="${i}" aria-label="${esc(g.name)}"><i></i><span>${esc(g.short || 'Tout')}</span></button>`).join('')
    railBtns = $$('.rail-t', rail); railI = -1
    railBtns.forEach((b) => b.onclick = () => goTo(+b.dataset.i))
    // Arsenal : la liste numérotée de la pile ; Vitrine : le titre de l'étagère et ses flèches
    const idx = $('#arIdx', el), inst = L.filter((g) => g.id !== '__all').length
    idx.innerHTML = `<p class="hv-k st"><i></i>Ton arsenal</p>${L.map((g, i) => `<button class="ar-ix${g.id === '__all' ? ' ar-all' : ''}" data-i="${i}" tabindex="-1"><b>${g.id === '__all' ? ic('lib') : String(i + 1).padStart(2, '0')}</b><span>${esc(g.name)}</span></button>`).join('')}`
    $$('.ar-ix', idx).forEach((b) => b.onclick = () => { const t = Math.round(target); to(t + Math.round(wrapS(+b.dataset.i, t))) })
    const shk = $('#hvShk', el)
    shk.innerHTML = `<i></i>Ta pile<span>${inst ? `${inst} jeu${inst > 1 ? 'x' : ''} installé${inst > 1 ? 's' : ''}, les plus récents d’abord` : 'Aucun jeu installé'}</span><button class="hv-nav" data-step="-1" aria-label="Jeu précédent">${ic('back')}</button><button class="hv-nav" data-step="1" aria-label="Jeu suivant">${ic('chev')}</button>`
    $$('.hv-nav', shk).forEach((b) => b.onclick = () => step(+b.dataset.step))
    if (!$('#hvDia', stack)) stack.insertAdjacentHTML('beforeend', '<i class="hv-dia" id="hvDia" aria-hidden="true"></i>')
    idxI = -1
  }
  // Rien de trouvé : le grand bouton relance la recherche
  const allAction = () => (GAMES.length ? go('lib') : Real.scan().then(() => toast(GAMES.length ? `${ic('check')} ${GAMES.length} jeux trouvés` : 'Aucun jeu trouvé sur ce PC.', { ms: 3000 })))
  // La vraie bibliothèque change : on garde le jeu affiché
  function sync() {
    if (!stack || launching) return
    const cur = focused()?.id
    const ids = list().map((g) => g.id).join()
    if (ids !== L.map((g) => g.id).join()) {
      buildCards()
      const i = Math.max(0, L.findIndex((g) => g.id === cur))
      pos = target = i; vel = 0
    } else L = list()
    // Une jaquette arrivée après coup (Epic, EA) prend sa place sans refaire la pile
    cards.forEach((c, i) => { const g = L[i], im = $('img', c); if (!g?.cover || !im || c.dataset.cover === g.cover) return; c.dataset.cover = g.cover; delete im.dataset.fb; im.src = A(g.cover) })
    paintAll()
    paintText(false, true); layout(); paintFriends()
    // L'image du jeu affiché peut arriver après lui : le fond la prend tout de suite
    if (S.view === 'play' && !S.gameId) { if (focused()?.hero !== heroSeen) render(); else Bar.syncGame() }
  }
  // Qui est là, autour du jeu affiché : amis, ou membres du serveur quand il n'y a qu'eux
  function paintFriends() {
    const b = $('#hmFr', el), g = focused(), res = Real.st.friendsRes; if (!b) return
    const a = res && Shared.around.whoIsAround(g?.raw || { id: '', store: 'steam', storeId: '', name: '' }, res.friends)
    b.hidden = !a
    if (!a) return
    const n = a.people.length, ing = a.people.filter((p) => p.status === 'in-game').length
    b.innerHTML = `${a.people.slice(0, 3).map((p) => avatar(p.name, 28)).join('')}<span><b>${a.kind === 'members' ? `${n} membre${n > 1 ? 's' : ''} du serveur` : `${n} en ligne`}</b>${a.here.size ? `${a.here.size} sur ce jeu` : a.kind === 'members' ? '' : ing ? `${ing} en jeu` : ''}</span>`
    b.dataset.tip = Shared.around.aroundLabel(a)
  }
  const wrapD = (i, from = pos) => { let d = ((i - from) % N + N) % N; if (d > N - 1.5) d -= N; return d }
  // Aller à un jeu précis : compté depuis là où la pile va (target), pas depuis là où elle passe encore (pos).
  // Vitrine et Arsenal prennent le plus court chemin (deux jeux en arrière : deux crans, pas le tour complet) ;
  // l'accueil Actuel garde son sens de la 0.6.1.
  const goTo = (i, short = home !== '0') => { const t = Math.round(target); to(t + Math.round(short ? wrapS(i, t) : wrapD(i, t))) }
  function layout() {
    if (!stack || launching) return
    if (home === 'v') return layoutShelf()
    if (home === 'r') return layoutArc()
    const ch = stack.offsetHeight * .8, cw = ch * 2 / 3
    stack.style.setProperty('--cw', cw + 'px'); stack.style.setProperty('--ch', ch + 'px')
    stack.style.transform = `rotateY(${smx * -2.4}deg) rotateX(${smy * 1.8}deg) translate3d(${smx * -9}px,${smy * -6}px,0)`
    const near = Math.round(pos)
    cards.forEach((c, i) => {
      const d = wrapD(i)
      const front = Math.abs(d) < .5
      const vis = d > -1.05 && d < 4.4
      c.style.visibility = vis ? 'visible' : 'hidden'
      c.classList.toggle('is-front', front)
      c.tabIndex = front ? 0 : -1
      if (!vis) return
      const p = Math.max(0, d), n = Math.max(0, -d)
      const x = p * cw * .37 - n * cw * 1.25
      const y = -p * ch * .07 + n * ch * .26
      const iz = 1 - Math.pow(1 - introT, 3)
      const z = -p * 300 + n * 560 - (1 - iz) * (900 + p * 260)
      const ry = lerp(-11, -26, clamp(p / 3, 0, 1)) + n * 24 + (front ? smx * 7 : 0)
      const rx = front ? smy * -5 : 0
      c.style.transform = `translate3d(${x}px,${y}px,${z}px) rotateY(${ry}deg) rotateX(${rx}deg)`
      c.style.opacity = (n > 0 ? clamp(1 - n * 1.5, 0, 1) : clamp((3 - p) / .6, 0, 1)) * clamp(iz * 1.6, 0, 1)
      // Derrière, les jeux s'éteignent : on voit qu'ils sont là, aucun ne crie plus fort que la jaquette de face
      setF(c, reduced() ? '' : `${n > 0 ? `blur(${(n * 12).toFixed(1)}px) ` : ''}brightness(${clamp(1 - p * .66, .34, 1).toFixed(2)}) saturate(${clamp(1 - p * .55, .45, 1).toFixed(2)})`)
      c.style.zIndex = String(100 - Math.round(p * 10) + Math.round(n * 5))
      if (front) { c.style.setProperty('--sx', (50 + smx * 46) + '%'); c.style.setProperty('--sy', (40 + smy * 46) + '%') }
    })
    railMark(wrap(Math.round(pos)))
  }
  // N'écrit le filtre que s'il a changé (le recalcul du flou coûte cher)
  function setF(c, v) { if (c._f !== v) { c._f = v; c.style.filter = v } }
  // Le rail : le jeu courant toujours nommé, ses deux voisins prêts à s'afficher
  function railMark(i) {
    if (i === railI || !railBtns.length) return
    railI = i
    railBtns.forEach((b, j) => { b.classList.toggle('on', j === i); b.classList.toggle('nb', N > 2 && (j === wrap(i - 1) || j === wrap(i + 1))) })
  }
  // Pile arrêtée depuis 150 ms : un seul minuteur, partagé (Play.onRest ou l'évènement px:rest)
  function armRest() {
    clearTimeout(restT)
    restT = setTimeout(() => {
      restT = 0
      const g = focused()
      restFns.forEach((f) => { try { f(g) } catch (e) { console.error(e) } })
      el?.dispatchEvent(new CustomEvent('px:rest', { bubbles: true, detail: { id: g?.id } }))
    }, 150)
  }
  function kick() { if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick) } }
  let lastT = 0
  function tick(now) {
    const dt = Math.min(.034, (now - lastT) / 1000 || .016); lastT = now
    const k = 110, c = 17
    vel += (target - pos) * k * dt; vel *= Math.exp(-c * dt); pos += vel * dt
    smx += (mx - smx) * Math.min(1, dt * 7); smy += (my - smy) * Math.min(1, dt * 7)
    if (reduced()) { pos = target; vel = 0; smx = smy = 0 }
    if (introT < 1) introT = reduced() ? 1 : clamp((now - introAt) / 1050, 0, 1)
    layout()
    const moving = introT < 1 || Math.abs(target - pos) > .0008 || Math.abs(vel) > .0008 || Math.abs(mx - smx) > .002 || Math.abs(my - smy) > .002
    raf = moving && S.view === 'play' ? requestAnimationFrame(tick) : 0
    if (!moving) { pos = target }
  }
  function to(i, burst = false) { if (launching) return; target = i; kick(); render(); paintText(false, false, burst); armRest() }
  // Molette ou flèche : le titre change sans animation, et les voisins s'affichent sur le rail pendant 1 s
  function step(dir) {
    const r = $('#rail', el); r?.classList.add('peek'); clearTimeout(peekT); peekT = setTimeout(() => r?.classList.remove('peek'), 1000)
    to(Math.round(target) + dir, true)
  }
  let shown = null
  let heroSeen
  function render(first) { const g = focused(); if (!g) return; heroSeen = g.hero; if (g.id !== '__all') S.focus = GAMES.indexOf(g); Fluid.game(g, ['#1a0f18', '#5e1038', '#c9184f', '#3a1a55']); Bar.syncGame && Bar.syncGame() }
  function paintText(first, refresh = false, burst = false) {
    // Les données ont changé sur le même jeu : on repeint sans rejouer l'entrée du titre
    const g = focused(), same = shown === g.id; if (same && !first && !refresh) return; shown = g.id; paintFriends()
    const t = $('#htTitle', el), kick = $('#htKick', el), meta = $('#htMeta', el), ready = $('#htReady', el), fav = $('#htFav', el), more = $('#htMore', el), pl = $('#htPlayL', el)
    const isAll = g.id === '__all'
    t.dataset.len = g.name.length > 20 ? 'l' : g.name.length > 14 ? 'm' : 's'
    // Le style du jeu d'abord : le titre en dépend (lettrage Player X ou police du style)
    if (!same || first || refresh) applyStyle(g)
    if (!same || first) titleIn(t, g.name, first, burst)
    kick.innerHTML = `${isAll ? '<span class="ht-k">Bibliothèque</span>' : ''}${g.tag ? `<span class="ht-tag tone-${g.tagTone}"><i></i>${esc(g.tag)}</span>` : ''}`
    meta.textContent = isAll ? (GAMES.length ? `${GAMES.filter((x) => x.installed).length} installés, ${GAMES.filter((x) => !x.installed).length} sur ton compte` : 'Installe un jeu Steam, Epic ou EA, ou relance la recherche.') : [g.time ? `${g.time} de jeu` : 'Jamais lancé ici', g.running ? 'en cours' : g.last ? `dernière partie ${g.last}` : ''].filter(Boolean).join(', ')
    paintCta()
    more.hidden = isAll; fav.hidden = isAll; fav.setAttribute('aria-pressed', !!g.fav); fav.dataset.tip = g.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'
    ready.innerHTML = (g.ready || []).map((r) => {
      const inner = `${r.friends ? `<span class="r-avs">${r.friends.map((n) => avatar(n, 24)).join('')}</span>` : `<span class="r-ic">${r.ic === 'x' ? xm() : ic(r.ic)}</span>`}<b>${esc(r.t)}</b>`
      return r.go ? `<li><button class="r-row" data-go="${r.go}">${inner}</button></li>` : `<li><span class="r-row">${inner}</span></li>`
    }).join('')
    $$('[data-go]', ready).forEach((b) => b.onclick = () => openReady(b.dataset.go))
    if (!same || first) { ready.classList.remove('r-in'); void ready.offsetWidth; ready.classList.add('r-in') }
    paintHome(g, !same || first)
  }
  // Boutons caméléon : le style vient de la jaquette et des tags Steam du jeu (style.js). Jaquette pas encore lue : l'ancien style reste le temps de la lire.
  function applyStyle(g) {
    const s = GameStyle.now(g)
    if (s) return setStyle(g, s)
    GameStyle.of(g).then((r) => { if (focused() === g) setStyle(g, r, true) })
  }
  function setStyle(g, s, late) {
    const changed = GameStyle.paint(el, s)
    // Arrivé après coup sur un autre style : le titre change de lettrage dans un fondu
    if (changed && late && !launching) { const t = $('#htTitle', el); if (!t.classList.contains('is-wait')) titleIn(t, g.name, false, false) }
  }
  GameStyle.onChange(() => { if (el) { shown = null; paintText(false) } })
  // Le titre entre en vraie largeur (116 % → 88 %) une fois la pile arrêtée. Pendant la molette, il change sans animation.
  function titleIn(t, name, first, burst) {
    t.removeAttribute('aria-label'); t.classList.remove('is-in', 'is-fade', 'is-wait'); t.style.animationDelay = ''
    // Le titre dessiné en lettrage Player X (comme le mot du logo) ; un caractère inconnu : texte normal
    const px = PxType.ok(name) && !GameStyle.styled(el)
    t.classList.toggle('is-px', px)
    if (px) t.innerHTML = PxType.html(name); else t.textContent = name
    if (burst && !reduced()) { t.classList.add('is-wait'); titleWait = true; return }
    titleWait = false
    titleGo(t, first ? 120 : 0)
  }
  function titleGo(t, delay = 0) {
    t.classList.remove('is-wait')
    // Titre long, vue cachée (on ne peut pas mesurer ses lignes) ou mouvement réduit : simple fondu
    const wide = t.dataset.len !== 'l' && !t.classList.contains('is-px') && !reduced() && t.offsetParent !== null
    if (wide) lockLines(t)
    if (delay) t.style.animationDelay = delay + 'ms'
    void t.offsetWidth; t.classList.add(wide ? 'is-in' : 'is-fade')
  }
  // Fige les lignes à la largeur finale : l'élargissement ne provoque aucun saut de retour à la ligne
  function lockLines(t) {
    const words = t.textContent.split(' ')
    t.innerHTML = words.map((w) => `<span>${esc(w)}</span>`).join(' ')
    const lines = []; let top = null
    $$('span', t).forEach((s, i) => { if (s.offsetTop !== top) { lines.push([]); top = s.offsetTop } lines[lines.length - 1].push(words[i]) })
    t.innerHTML = lines.map((l) => `<span class="ht-ln">${esc(l.join(' '))}</span>`).join('')
    t.setAttribute('aria-label', words.join(' '))
  }
  onRest(() => { const t = el && $('#htTitle', el); if (titleWait && t) { titleWait = false; titleGo(t) } })
  function onRest(fn) { restFns.push(fn) }
  // Le grand bouton dit toujours ce qu'il va faire
  function paintCta() {
    const g = focused(), pl = $('#htPlayL', el), b = $('#htPlay', el); if (!g) return
    const isAll = g.id === '__all', mine = S.session?.game === g.id, launching = S.session?.phase === 'launch'
    pl.textContent = mine ? (launching ? 'Lancement…' : 'En jeu') : isAll ? (GAMES.length ? 'Ouvrir' : 'Chercher mes jeux') : g.needsUpdate ? (g.updateAction?.label || 'Mettre à jour') : 'Jouer'
    b.disabled = launching
    b.classList.toggle('is-upd', !mine && !!g.needsUpdate)
    const glyph = isAll ? (GAMES.length ? 'lib' : 'search') : 'play'
    if (b.dataset.glyph !== glyph) { b.dataset.glyph = glyph; $('.pb-in .ic', b).outerHTML = ic(glyph) }
  }
  // ---- Style de l'accueil (essai 0.6.2) : Actuel, Vitrine (« v »), Arsenal (« r »). Choisi dans Paramètres > Général.
  // data-home sur <html> : le CSS (playhome.css) place tout. Seules les vraies données s'affichent ; une case sans donnée reste vide.
  const HOME_KEY = 'pxv3-accueil2', HOMES = ['0', 'v', 'r']
  let home = 'v'
  try { const v = localStorage.getItem(HOME_KEY); if (HOMES.includes(v)) home = v } catch { /* stockage indisponible : Vitrine */ }
  document.documentElement.dataset.home = home
  const achMemo = new Map(), newsMemo = new Map(), badImg = new Set()
  let idxI = -1, hxId = 0
  // Distance symétrique au jeu choisi (la roue d'Arsenal a des voisins des deux côtés)
  const wrapS = (i, from = pos) => { let d = ((i - from) % N + N) % N; if (d > N / 2) d -= N; return d }
  // Tout est dessiné pour 1600 × 940 ; une fenêtre plus petite réduit l'ensemble
  const kOf = () => clamp(Math.min((el?.clientWidth || 1600) / 1600, (el?.clientHeight || 940) / 940), .55, 1)
  const along = (a, p) => { const i = Math.min(Math.floor(a), p.length - 2); return p[i] + (p[i + 1] - p[i]) * clamp(a - i, 0, 1) }
  // Vitrine : la pile devient une étagère ; la jaquette choisie grandit, ses voisines glissent, la rangée défile si elle dépasse
  function layoutShelf() {
    const k = kOf(), bw = 166 * k, sw = 134 * k, gap = 16 * k, E = bw - sw
    el.style.setProperty('--k', k.toFixed(3))
    stack.style.setProperty('--cw', bw + 'px'); stack.style.setProperty('--ch', bw * 1.5 + 'px')
    const iz = 1 - Math.pow(1 - introT, 3)
    const ws = cards.map((c, i) => sw + E * clamp(1 - Math.abs(wrapD(i)), 0, 1)), xs = []
    let x = 0; ws.forEach((w) => { xs.push(x); x += w + gap })
    const total = x - gap, avail = stack.clientWidth || 1, ai = wrap(Math.round(target))
    const want = total > avail ? clamp(xs[ai] - sw - gap, 0, total - avail) : 0
    if (stack._sx !== want) { stack._sx = want; stack.style.transform = `translate3d(${(-want).toFixed(1)}px,0,0)` }
    cards.forEach((c, i) => {
      const d = wrapD(i), a = Math.abs(d), front = a < .5, f = clamp(1 - a, 0, 1), vx = xs[i] - want
      const vis = vx > -ws[i] - 40 && vx < avail + 40
      c.style.visibility = vis ? 'visible' : 'hidden'
      c.classList.toggle('is-front', front); c.tabIndex = front ? 0 : -1
      if (!vis) return
      const t = `translate3d(${xs[i].toFixed(1)}px,${((1 - iz) * (40 + i * 14)).toFixed(1)}px,0) scale(${(ws[i] / bw).toFixed(4)})`
      c._t = t; c.style.transform = t
      const edge = vx + ws[i] > avail ? clamp((avail - vx) / ws[i], 0, 1) : vx < 0 ? clamp(1 + vx / ws[i], 0, 1) : 1
      c.style.opacity = (edge * clamp(iz * 1.6, 0, 1)).toFixed(3)
      setF(c, reduced() ? '' : `brightness(${(.58 + .42 * f).toFixed(2)}) saturate(${(.8 + .2 * f).toFixed(2)})`)
      c.style.zIndex = String(100 - Math.round(a * 10))
    })
    const dia = $('#hvDia', stack); if (dia) dia.style.translate = `${(xs[ai] + ws[ai] / 2).toFixed(1)}px 0`
    railMark(wrap(Math.round(pos))); idxMark()
  }
  // Arsenal : la roue. Le jeu choisi devant, deux voisins de chaque côté qui reculent et se tournent vers lui
  function layoutArc() {
    const k = kOf(), cw = 224 * k
    el.style.setProperty('--k', k.toFixed(3))
    stack.style.setProperty('--cw', cw + 'px'); stack.style.setProperty('--ch', cw * 1.5 + 'px')
    if (stack._sx !== 'r') { stack._sx = 'r'; stack.style.transform = '' }
    const iz = 1 - Math.pow(1 - introT, 3)
    cards.forEach((c, i) => {
      const d = wrapS(i), a = Math.abs(d), s = Math.sign(d), front = a < .5, vis = a < 2.7
      c.style.visibility = vis ? 'visible' : 'hidden'
      c.classList.toggle('is-front', front); c.tabIndex = front ? 0 : -1
      if (!vis) return
      const x = s * along(a, [0, 290, 485, 600]) * k, z = -along(a, [0, 260, 520, 700]) * k - (1 - iz) * 900, ry = -s * along(a, [0, 34, 52, 60])
      const t = `translate3d(${x.toFixed(1)}px,0,${z.toFixed(1)}px) rotateY(${ry.toFixed(2)}deg) scale(${(1 + .14 * clamp(1 - a, 0, 1)).toFixed(4)})`
      c._t = t; c.style.transform = t
      c.style.opacity = (clamp(2.6 - a, 0, 1) * clamp(iz * 1.6, 0, 1)).toFixed(3)
      setF(c, reduced() ? '' : `brightness(${along(a, [1, .55, .3, .2]).toFixed(2)}) saturate(${(1 - .25 * clamp(a, 0, 1)).toFixed(2)})`)
      c.style.zIndex = String(100 - Math.round(a * 10))
    })
    railMark(wrap(Math.round(pos))); idxMark()
  }
  // La liste d'Arsenal suit le jeu choisi (défile seule si la pile est longue)
  function idxMark() {
    const i = wrap(Math.round(pos)); if (i === idxI) return; idxI = i
    const box = $('#arIdx', el), bs = $$('.ar-ix', box)
    bs.forEach((b) => b.classList.toggle('on', +b.dataset.i === i))
    const b = bs.find((x) => +x.dataset.i === i); if (!b || home !== 'r') return
    if (b.offsetTop < box.scrollTop + 40) box.scrollTop = b.offsetTop - 40
    else if (b.offsetTop + b.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = b.offsetTop + b.offsetHeight - box.clientHeight + 4
  }
  // Le grade : les chevrons du logo, d'après tes heures (1 dès 10 h, 2 dès 50 h, 3 dès 100 h)
  function gradeOf(g) { const hr = (g.raw?.playtime || 0) / 60; return hr >= 100 ? [3, 'Vétéran'] : hr >= 50 ? [2, 'Confirmé'] : hr >= 10 ? [1, 'Habitué'] : [0, ''] }
  const gradeSvg = (n) => { const id = 'hxg' + ++hxId; return `<svg viewBox="10 1 100 118" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e8264f"/><stop offset="1" stop-color="#c4123a"/></linearGradient></defs><path d="${HX_SHIELD}" fill="#140709" stroke="url(#${id})" stroke-width="7" stroke-linejoin="round"/>${[[90, 70], [68, 48], [46, 26]].slice(0, n).map(([a, b]) => `<polyline points="36,${a} 60,${b} 84,${a}" fill="none" stroke="url(#${id})" stroke-width="10"/>`).join('')}</svg>` }
  const rankOf = (g) => { const [n, name] = gradeOf(g); return n ? `<span class="hv-chip rk">${gradeSvg(n)}<span><b>${name}</b> · ${esc(g.time)}</span></span>` : g.time ? `<span class="hv-chip pl"><span><b>${esc(g.time)}</b> de jeu</span></span>` : '' }
  const herePlayers = (g) => { const res = Real.st.friendsRes; return res && g.raw ? Shared.around.playersOf(g.raw, res.friends) : [] }
  const pct = (a) => Math.round(a.u / a.t * 100)
  // Pastilles de Vitrine : grade, succès (si Steam les donne), amis sur ce jeu
  function chipsOf(g) {
    const a = achMemo.get(g.id), here = herePlayers(g)
    return rankOf(g)
      + (a?.t ? `<span class="hv-chip"><span class="hv-ach">${ic('trophy')}</span><span><b>${a.u}</b> / ${a.t} succès</span><span class="hv-pb"><i style="width:${pct(a)}%"></i></span></span>` : '')
      + (here.length ? `<span class="hv-chip"><span class="r-avs">${here.slice(0, 3).map((p) => avatar(p.name, 26)).join('')}</span><span><b>${esc(Shared.around.playersLabel(here))}</b></span><button class="hv-jn" data-hj="friends">Rejoindre</button></span>` : '')
  }
  // La dernière actu Steam du jeu, en une ligne (la mise à jour à faire est déjà dans les lignes « prêt »)
  function newsOf(g) {
    const p = !g.needsUpdate && newsMemo.get(g.id); if (!p) return ''
    return `<button class="hv-nw" data-hj="news"><em>${p.patch ? 'Patch' : 'Actu'}</em><b>${esc(p.title)}</b><span>${esc(Shared.text.timeAgo(p.date))}</span></button>`
  }
  // Le panneau « Prêt à jouer » d'Arsenal
  function readyPanel(g) {
    if (!g || g.id === '__all') { const n = GAMES.filter((x) => !x.hidden).length; return `<p class="hv-k"><i></i>Ta bibliothèque</p><div class="ar-rd"><small>Sur ce PC et ton compte</small><b>${n} jeu${n > 1 ? 'x' : ''}</b></div>` }
    const a = achMemo.get(g.id), here = herePlayers(g), p = here[0]
    return `<p class="hv-k"><i></i>${g.running ? 'En cours' : 'Prêt à jouer'}</p>
      <div class="ar-rd"><small>Dernière partie</small><b>${esc(g.last ? cap(g.last) : 'Jamais lancé ici')}</b></div>
      ${g.time || g.runs ? `<div class="ar-rd"><small>Temps de jeu</small><b>${esc([g.time, g.runs].filter(Boolean).join(' · '))}</b></div>` : ''}
      ${a?.t ? `<div class="ar-rd"><small>Succès</small><div class="ar-ln"><b>${a.u} / ${a.t}</b><span class="hv-pb"><i style="width:${pct(a)}%"></i></span><em>${pct(a)} %</em></div></div>` : ''}
      ${g.needsUpdate ? `<div class="ar-fr"><span class="ar-ic">${ic('down')}</span><div><b>${esc(g.updateText || 'Mise à jour à faire')}</b></div><button class="k" data-hj="update">${esc(g.updateAction?.label || 'Mettre à jour')}</button></div>` : ''}
      ${p ? `<div class="ar-fr">${avatar(p.name, 34)}<div><b>${esc(p.name)}</b><small>${esc(here.length > 1 ? `et ${here.length - 1} autre${here.length > 2 ? 's' : ''} sur ce jeu` : 'Sur ce jeu')}</small></div><button class="k" data-hj="friends">Rejoindre</button></div>` : ''}`
  }
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s
  function paintHome(g, changed) {
    if (!el || home === '0' || !g) return
    const isAll = g.id === '__all'
    paintBg(g)
    if (changed) {
      const sw = $('#hmSweep', el); sw.classList.remove('go'); void sw.offsetWidth; if (!reduced() && home === 'v') sw.classList.add('go')
      $('#arRet', el).classList.remove('go'); $$('.card.ar-flash', stack).forEach((x) => x.classList.remove('ar-flash'))
    }
    $('#hvKick', el).innerHTML = isAll ? `<i></i>Ta bibliothèque<span>· ${GAMES.length} jeu${GAMES.length > 1 ? 'x' : ''}</span>` : `<i></i>${g.running ? 'En cours' : 'Prêt à jouer'}${g.running ? '' : `<span>· ${g.last ? `Dernière partie ${esc(g.last)}` : 'Jamais lancé ici'}</span>`}`
    $('#hvChips', el).innerHTML = isAll ? '' : chipsOf(g)
    $('#hvNews', el).innerHTML = isAll ? '' : newsOf(g)
    $('#arRank', el).innerHTML = isAll ? '' : rankOf(g)
    $('#arReady', el).innerHTML = readyPanel(g)
    const big = $('#arBig', el), bn = isAll ? 'Bibliothèque' : g.name.split(':')[0].trim()
    if (big.textContent !== bn) {
      big.textContent = bn; big.style.setProperty('--fs', Math.min(170, Math.round(1550 / (bn.length * .9))))
      big.classList.remove('in'); void big.offsetWidth; if (!reduced()) big.classList.add('in')
    }
    $$('[data-hj]', el).forEach((b) => b.onclick = () => { const k = b.dataset.hj; if (k === 'friends') go('friends'); else if (k === 'update') Real.openSteamDownloads(); else if (k === 'news' && !isAll) openGame(g.id, cards[wrap(Math.round(target))]) })
  }
  // Le fond : l'image du jeu en grand (Vitrine) ou floue et sombre (Arsenal). Sans grande image : la jaquette nette sur son propre flou.
  const realCov = (g) => (g?.cover && !/^data:image\/svg/.test(A(g.cover)) ? A(g.cover) : null)
  function paintBg(g) {
    const box = $('#hmBg', el); if (!box) return
    const isAll = g.id === '__all', hero = !isAll && g.hero && !badImg.has(A(g.hero)) ? A(g.hero) : null, cov = isAll ? null : realCov(g)
    const src = hero || (cov && !badImg.has(cov) ? cov : null), key = `${home}|${src || ''}`
    if (box.dataset.k === key) return
    box.dataset.k = key
    const drop = () => $$('.hb.on', box).forEach((o) => { o.classList.remove('on'); setTimeout(() => o.remove(), 900) })
    if (!src) return drop()
    const lay = h(home === 'r' ? '<div class="hb hb-a"><img alt="" draggable="false"><img class="hb-m" alt="" draggable="false"></div>' : hero ? '<div class="hb hb-w"><img alt="" draggable="false"></div>' : '<div class="hb hb-c"><img class="hb-u" alt="" draggable="false"><img class="hb-t" alt="" draggable="false"></div>')
    box.append(lay)
    const im = new Image(); im.src = src
    im.decode().then(() => {
      if (box.dataset.k !== key) return lay.remove()
      $$('img', lay).forEach((x) => { x.src = src })
      drop(); requestAnimationFrame(() => lay.classList.add('on'))
    }, () => { lay.remove(); badImg.add(src); if (box.dataset.k === key) { box.dataset.k = ''; paintBg(g) } })
  }
  // Arsenal : le viseur se verrouille quand la roue s'arrête, et un reflet passe sur la jaquette
  function lockOn() {
    if (home !== 'r' || !el) return
    const r = $('#arRet', el); r.classList.remove('go'); void r.offsetWidth; r.classList.add('go')
    const c = cards[wrap(Math.round(target))]; if (!c || reduced()) return
    $$('.card.ar-flash', stack).forEach((x) => x.classList.remove('ar-flash')); void c.offsetWidth; c.classList.add('ar-flash')
  }
  // Succès et actus Steam : lus une fois par jeu, seulement quand la pile s'arrête (pas à chaque cran de molette)
  function askAch(g) {
    if (!g || g.id === '__all' || achMemo.has(g.id) || g.raw?.store !== 'steam' || !API.getAchievements) return
    achMemo.set(g.id, null)
    API.getAchievements(g.rid).then((a) => { if (a?.state === 'ready' && a.total) { achMemo.set(g.id, { u: a.unlocked, t: a.total }); if (focused() === g) paintHome(g, false) } }).catch(() => {})
  }
  function askNews(g) {
    if (!g || g.id === '__all' || newsMemo.has(g.id) || g.raw?.store !== 'steam' || !API.getGameNews) return
    newsMemo.set(g.id, null)
    API.getGameNews(g.rid, false).then((x) => { if (x?.posts?.[0]) { newsMemo.set(g.id, x.posts[0]); if (focused() === g) paintHome(g, false) } }).catch(() => {})
  }
  onRest((g) => { if (home === '0') return; askAch(g); askNews(g); lockOn() })
  // Le sol de l'Arsenal : Brume par défaut, Laqué au choix (Paramètres > Général, ou F2 sur l'accueil). Un ancien choix (Carreaux, Plateau) revient à Brume
  const SOL_KEY = 'pxv3-sol', SOLS = ['brume', 'laque'], SOL_T = { brume: 'Brume', laque: 'Laqué' }
  let sol = 'brume'
  try { const v = localStorage.getItem(SOL_KEY); if (SOLS.includes(v)) sol = v } catch { /* stockage indisponible : Brume */ }
  document.documentElement.dataset.sol = sol
  function setSol(v) {
    if (!SOLS.includes(v)) v = 'brume'
    sol = v; document.documentElement.dataset.sol = v
    try { localStorage.setItem(SOL_KEY, v) } catch { /* gardé pour cette session */ }
  }
  function setHome(v) {
    if (!HOMES.includes(v)) v = '0'
    home = v; document.documentElement.dataset.home = v
    try { localStorage.setItem(HOME_KEY, v) } catch { /* gardé pour cette session */ }
    if (!el) return
    stack._sx = null; idxI = -1; $('#hmBg', el).dataset.k = ''
    const g = focused(); layout(); kick()
    if (g && v !== '0') { paintHome(g, true); askAch(g); askNews(g); lockOn() }
  }
  function openReady(k) {
    if (k === 'rec') Settings.open('rec')
    else if (k === 'overlay') Settings.open('overlay')
    else if (k === 'friends') go('friends')
    else if (k === 'steam') Real.openSteamDownloads()
    else if (k === 'loadouts') { S.statsGame = 'bf6'; S.statsTab = 'loadouts'; S.loWeapon = null; go('stats') }
  }
  // Le lancement : le titre reste, les étapes de la routine prennent la place des boutons, et la jaquette vient vers toi
  function launchFx(on, steps = [], name = '') {
    const c = cards[wrap(Math.round(target))]; if (!c) return
    if (on) {
      launching = true
      c.classList.add('is-hold')
      c.style.transform = home === 'v' ? `${c._t} translateY(-14px)` : home === 'r' ? `${c._t} translateZ(140px)` : 'translate3d(-6%,0,120px) rotateY(-5deg)'; c.style.opacity = '1'; c.style.filter = 'none'; c._f = 'none'
      el.classList.add('launching')
      $('#htKick', el).innerHTML = `<span class="ht-k">${name ? `Routine ${esc(name)}` : 'Lancement direct'}</span>`
      $('#htSteps', el).innerHTML = steps.map((s, i) => `<li class="hs ${i === 0 ? 'cur' : ''}" style="--i:${i}"><i>${ic(s.ic || 'play')}</i><span>${esc(s.t || s.sim)}</span></li>`).join('')
      // Les boutons laissent la place aux étapes : le focus reste sur l'accueil au lieu de tomber nulle part (Tab mène à la barre, qui arrête l'attente)
      const a = document.activeElement
      if (a === document.body || $('.ht-acts', el).contains(a)) el.focus({ preventScroll: true })
    } else {
      launching = false
      c.classList.remove('is-hold', 'is-launch'); c.classList.add('is-back'); setTimeout(() => c.classList.remove('is-back'), 320)
      el.classList.remove('launching', 'launch-go'); shown = null; paintText(false); layout()
      // Et il revient au grand bouton quand l'accueil réapparaît
      const a = document.activeElement
      if (S.view === 'play' && !S.gameId && (a === el || a === document.body) && !document.querySelector('[data-modal]:not([hidden])')) $('#htPlay', el)?.focus({ preventScroll: true })
    }
  }
  function launchStep(i) { $$('.hs', el).forEach((x, j) => { x.classList.toggle('done', j < i); x.classList.toggle('cur', j === i) }) }
  function launchGo() {
    const c = cards[wrap(Math.round(target))]; if (!c) return
    c.classList.remove('is-hold'); c.classList.add('is-launch')
    c.style.transform = home === 'v' ? `${c._t} translateY(-80px) scale(1.35)` : home === 'r' ? `${c._t} translateZ(760px)` : 'translate3d(-14%,4%,900px) rotateY(0deg)'; c.style.opacity = '0'; c.style.filter = 'blur(10px)'; c._f = 'blur(10px)'
    el.classList.add('launch-go')
  }
  return {
    mount, focused, setHome, home: () => home, setSol, sol: () => sol, nextSol: () => { setSol(SOLS[(SOLS.indexOf(sol) + 1) % SOLS.length]); return SOL_T[sol] }, launchFx, launchStep, launchGo, paintCta, sync, onRest,
    // Une seule entrée orchestrée : la pile arrive du fond à l'ouverture
    intro() { if (reduced() || !stack) return; if (S.view !== 'play') { introT = 1; return } introT = 0; introAt = performance.now(); kick(); paintText(true) },
    focusGame(id) {
      let i = L.findIndex((g) => g.id === id)
      if (i < 0 && G(id)?.installed) { pinned = id; buildCards(); i = L.findIndex((g) => g.id === id); pos = target = i; vel = 0; shown = null; layout(); paintText(false); render(); return }
      if (i >= 0) goTo(i)
    },
    keys(e) {
      if (['ArrowDown', 'ArrowRight'].includes(e.key)) { e.preventDefault(); step(1) }
      else if (['ArrowUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); step(-1) }
      else if (e.key === 'Enter' && !/INPUT|BUTTON/.test(document.activeElement?.tagName || '')) { e.preventDefault(); $('#htPlay', el).click() }
    },
    refresh() { layout(); kick() }
  }
})()

function avatar(n, size = 28) {
  const f = FRIENDS.find((x) => x.n === n) || { hue: Shared.text.hue(String(n)) }
  const style = `--h:${f.hue};width:${size}px;height:${size}px;font-size:${Math.max(12, Math.round(size * .42))}px`
  return f.avatar ? `<span class="av" style="${style}" aria-hidden="true"><img src="${esc(f.avatar)}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block"></span>` : `<span class="av" style="${style}" aria-hidden="true">${esc(String(n)[0] || '?')}</span>`
}
