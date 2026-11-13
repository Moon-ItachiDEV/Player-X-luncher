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
      <div class="ht">
        <p class="ht-kick" id="htKick"></p>
        <h1 class="ht-title" id="htTitle"></h1>
        <p class="ht-meta" id="htMeta"></p>
        <div class="ht-acts">
          <button class="play-btn" id="htPlay"><span class="pb-ring" aria-hidden="true"></span><span class="pb-in">${ic('play')}<span id="htPlayL">Jouer</span><span class="pb-chev" aria-hidden="true"><b>›</b><b>›</b><b>›</b></span></span></button>
          <button class="dk-b" id="htMore">${ic('info')}<span>Voir la fiche</span></button>
          <button class="dk-b dk-i" id="htFav" aria-label="Favori" aria-pressed="false" data-tip="Ajouter aux favoris"><span class="ic-swap"><span class="a">${ic('star')}</span><span class="b">${ic('starf')}</span></span></button>
        </div>
        <ul class="ht-ready" id="htReady"></ul>
        <ol class="ht-steps" id="htSteps"></ol>
      </div>
      <div class="stack" id="stack" aria-label="Tes jeux. Molette ou flèches pour changer de jeu."></div>
      <div class="rail" id="rail" aria-hidden="false"></div>
      <button class="hm-fr" id="hmFr" data-tip="Voir tes amis" data-tip-b data-tip-r hidden></button>
    </section>`)
    host.append(el)
    stack = $('#stack', el)
    buildCards()

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
  }
  // « Toute ta bibliothèque » : les vraies jaquettes d'abord, entières, et elle suit celles qui arrivent après coup
  function paintAll() {
    const c = cards.find((x) => x.classList.contains('card-all')); if (!c) return
    // Les jeux installés sont déjà dans la pile : la carte montre d'abord ceux de ton compte qui ne sont pas installés
    const seen = GAMES.filter((x) => !x.hidden), cov = (l) => [...l.filter((x) => x.raw?.coverUrl), ...l.filter((x) => !x.raw?.coverUrl)]
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
        else to(Math.round(target) + Math.round(d))
      })
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); if (g.id !== '__all') openGame(g.id, c) })
      return c
    })
    paintAll()
    const rail = $('#rail', el)
    rail.hidden = L.length < 2
    rail.innerHTML = L.map((g, i) => `<button class="rail-t" data-i="${i}" aria-label="${esc(g.name)}"><i></i><span>${esc(g.short || 'Tout')}</span></button>`).join('')
    railBtns = $$('.rail-t', rail); railI = -1
    railBtns.forEach((b) => b.onclick = () => { const i = +b.dataset.i; to(Math.round(target) + Math.round(wrapD(i))) })
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
    const a = res && (g?.raw ? Shared.around.whoIsAround(g.raw, res.friends) : Shared.around.whoIsAround({ name: '' }, res.friends))
    b.hidden = !a
    if (!a) return
    const n = a.people.length, ing = a.people.filter((p) => p.status === 'in-game').length
    b.innerHTML = `${a.people.slice(0, 3).map((p) => avatar(p.name, 28)).join('')}<span><b>${a.kind === 'members' ? `${n} membre${n > 1 ? 's' : ''} du serveur` : `${n} en ligne`}</b>${a.here.size ? `${a.here.size} sur ce jeu` : a.kind === 'members' ? '' : ing ? `${ing} en jeu` : ''}</span>`
    b.dataset.tip = Shared.around.aroundLabel(a)
  }
  const wrapD = (i) => { let d = ((i - pos) % N + N) % N; if (d > N - 1.5) d -= N; return d }
  function layout() {
    if (!stack || launching) return
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
      c.style.transform = 'translate3d(-6%,0,120px) rotateY(-5deg)'; c.style.opacity = '1'; c.style.filter = 'none'; c._f = 'none'
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
    c.style.transform = 'translate3d(-14%,4%,900px) rotateY(0deg)'; c.style.opacity = '0'; c.style.filter = 'blur(10px)'; c._f = 'blur(10px)'
    el.classList.add('launch-go')
  }
  return {
    mount, focused, launchFx, launchStep, launchGo, paintCta, sync, onRest,
    // Une seule entrée orchestrée : la pile arrive du fond à l'ouverture
    intro() { if (reduced() || !stack) return; if (S.view !== 'play') { introT = 1; return } introT = 0; introAt = performance.now(); kick(); paintText(true) },
    focusGame(id) {
      let i = L.findIndex((g) => g.id === id)
      if (i < 0 && G(id)?.installed) { pinned = id; buildCards(); i = L.findIndex((g) => g.id === id); pos = target = i; vel = 0; shown = null; layout(); paintText(false); render(); return }
      if (i >= 0) to(Math.round(target) + Math.round(wrapD(i)))
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
