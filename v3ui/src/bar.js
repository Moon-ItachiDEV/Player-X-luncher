// La barre de transport : la seule commande de l'appli. Elle change de rôle sans jamais changer de place.
const Bar = (() => {
  const TABS = [['play', 'Accueil', 'stack'], ['lib', 'Bibliothèque', 'lib'], ['clips', 'Clips', 'clip'], ['stats', 'Stats', 'stats'], ['friends', 'Amis', 'users']]
  let el, mode = 'idle'
  const line = () => $('#bLine', el)

  function mount(host) {
    el = h(`<nav id="bar" aria-label="Barre Player X" data-mode="idle">
      <div class="b-tabs" id="bTabs" role="navigation">
        <i class="b-pill" id="bPill" aria-hidden="true"></i>
        ${TABS.map(([v, l, i], n) => `<button class="b-tab" data-go="${v}" aria-label="${l}" aria-keyshortcuts="Control+${n + 1}" data-tip="${l}, Ctrl ${n + 1}">${ic(i)}<span class="b-tl"><span>${l}</span></span>${v === 'clips' ? '<i class="b-dot" id="bClipsDot"></i>' : v === 'friends' ? '<i class="b-n" id="bFriendsN" hidden></i>' : ''}</button>`).join('')}
      </div>
      <div class="b-mid">
        <button class="b-play" id="bPlay" aria-label="Jouer" data-tip="Jouer"><span class="ic-swap"><span class="a">${ic('play')}</span><span class="b">${ic('stop')}</span></span></button>
        <span class="b-lbl" id="bLbl"></span>
        <button class="b-now" id="bNow"><span class="b-cover" id="bCover"></span><span class="b-txt"><b id="bT1"></b><span id="bT2"></span></span></button>
        <div class="ln" id="bLine"><div class="ln-track"><div class="ln-fill" id="bFill"></div></div><div class="ln-marks" id="bMarks"></div><i class="ln-head" id="bHead"></i></div>
        <span class="b-time num" id="bTime"></span>
        <button class="b-voice" id="bVoice" hidden></button>
      </div>
      <div class="b-right">
        <button class="b-ic b-rec" id="bRec" aria-label="Enregistrement des moments" aria-pressed="false" data-tip="Activer l’enregistrement"><i class="b-rd" aria-hidden="true"></i><span class="b-rl" aria-hidden="true"><span class="on">Enregistre</span><span class="off">Coupé</span></span></button>
        <button class="b-ic" id="bOv" aria-label="Overlay en jeu" aria-pressed="false" data-tip="Activer l’overlay">${ic('overlay')}</button>
        <button class="b-ic" id="bSearch" aria-label="Rechercher (Ctrl K)" data-tip="Rechercher, Ctrl K">${ic('search')}</button>
        <button class="b-ic" id="bGear" aria-label="Ouvrir les paramètres" data-tip="Ouvrir les paramètres">${ic('gear')}</button>
        <button class="b-me" id="bMe" aria-label="Voir mes comptes" data-tip="Voir mes comptes" data-tip-r>${avatarMe()}</button>
      </div>
    </nav>`)
    host.append(el)
    $$('.b-tab', el).forEach((b) => b.onclick = () => go(b.dataset.go))
    $('#bPlay', el).onclick = () => {
      if (S.session?.phase === 'launch') return Live.stopFromBar()
      if (S.session) return Live.show()
      if (mode === 'clip') return Clips.playerToggle()
      if (S.gameId && G(S.gameId)?.installed) return $('#gpPlay')?.click()
      go('play'); setTimeout(() => $('#htPlay')?.click(), S.view === 'play' ? 0 : 320)
    }
    $('#bNow', el).onclick = () => {
      if (S.session) return Live.show()
      if (mode === 'clip') return
      Queue.toggle()
    }
    $('#bRec', el).onclick = async () => {
      if (!Real.clipsCfg) return Settings.open('rec')
      const on = !Real.clipsOn()
      try { await Real.saveClips({ enabled: on }); toast(on ? 'Enregistrement activé' : 'Enregistrement coupé', { ms: 1600 }); Settings.syncBar(); Settings.sync() } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 4000 }) }
    }
    let lastOv = 'b'
    $('#bOv', el).onclick = async () => {
      const cur = Real.st.settings.cs2Overlay, on = cur === 'off'
      if (!on) lastOv = cur
      try { await Real.saveSettings({ cs2Overlay: on ? lastOv : 'off' }); toast(on ? 'Overlay activé' : 'Overlay coupé', { ms: 1600 }); Settings.syncBar() } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 4000 }) }
    }
    // Au repos, chaque étape de la routine est un bouton (souris et clavier) qui ouvre la routine
    $('#bMarks', el).addEventListener('click', (e) => { if (mode === 'idle' && e.target.closest('.ln-node')) Settings.open('routine') })
    $('#bVoice', el).onclick = (e) => { const id = e.currentTarget.dataset.ch; if (id) API.openDiscordChannel(id).catch(() => toast('Discord n’a pas pu s’ouvrir sur ce salon.', { tone: 'warn', ms: 3000 })) }
    Real.on('friends', voice)
    $('#bSearch', el).onclick = () => Palette.open()
    $('#bGear', el).onclick = () => Settings.open()
    $('#bMe', el).onclick = () => Settings.open('accounts')
    el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); el.style.setProperty('--lx', (e.clientX - r.left) + 'px'); el.style.setProperty('--ly', (e.clientY - r.top) + 'px') })
    new ResizeObserver(() => { pill(); liquid() }).observe(el)
    const ro = new ResizeObserver(() => pill()); $$('.b-tab', el).forEach((b) => ro.observe(b))
    setNav('play')
    syncGame()
  }
  function liquid() {
    if (!('chrome' in window) && !navigator.userAgentData) return
    if (reduced() || !CSS.supports('backdrop-filter', 'blur(1px)')) return
    const zoomed = !!$('#win').style.zoom
    const W = el.offsetWidth, H = el.offsetHeight
    if (zoomed || W < 300) { el.style.backdropFilter = ''; return }
    if (liquid.w === W && liquid.h === H) return
    liquid.w = W; liquid.h = H
    const R = 24, B = 15, c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d'), im = x.createImageData(W, H), d = im.data
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      // Distance au bord d'un rectangle arrondi, et direction vers l'intérieur
      const qx = Math.max(R - i, i - (W - 1 - R), 0), qy = Math.max(R - j, j - (H - 1 - R), 0)
      const dist = R - Math.hypot(qx, qy)
      const edgeX = Math.min(i, W - 1 - i), edgeY = Math.min(j, H - 1 - j)
      const de = qx > 0 && qy > 0 ? dist : Math.min(edgeX, edgeY)
      let nx = 0, ny = 0
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (i < R ? 1 : -1) * qx / l; ny = (j < R ? 1 : -1) * qy / l }
      else if (edgeX < edgeY) nx = i < W / 2 ? 1 : -1
      else ny = j < H / 2 ? 1 : -1
      const f = de >= B ? 0 : Math.pow(1 - clamp(de, 0, B) / B, 2.2)
      const o = (j * W + i) * 4
      d[o] = 128 + nx * f * 127; d[o + 1] = 128 + ny * f * 127; d[o + 2] = 128; d[o + 3] = 255
    }
    x.putImageData(im, 0, 0)
    let svg = $('#lgSvg')
    if (!svg) { svg = h('<svg id="lgSvg" width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="lgF" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b"/><feImage id="lgI" x="0" y="0" preserveAspectRatio="none" result="m"/><feDisplacementMap in="b" in2="m" scale="34" xChannelSelector="R" yChannelSelector="G" result="d"/><feColorMatrix in="d" type="saturate" values="1.7"/></filter></svg>'); document.body.append(svg) }
    const fi = $('#lgI'); fi.setAttribute('width', W); fi.setAttribute('height', H); fi.setAttribute('href', c.toDataURL())
    el.style.backdropFilter = 'url(#lgF)'; el.style.webkitBackdropFilter = 'url(#lgF)'
  }
  const avatarMe = () => { const m = Real.me(); return m.avatar ? `<span class="av me" style="--h:338"><img src="${esc(m.avatar)}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block"></span>` : `<span class="av me" style="--h:338">${esc(m.name[0].toUpperCase())}</span>` }
  function pill() {
    const cur = $('.b-tab[aria-current=page]', el); const p = $('#bPill', el); if (!cur) { p.style.opacity = 0; return }
    p.style.opacity = 1
    // largeur finale, label ouvert : mesurée après la mise en page
    p.style.width = cur.offsetWidth + 'px'; p.style.transform = `translateX(${cur.offsetLeft}px)`
  }
  function setNav(v) {
    $$('.b-tab', el).forEach((b) => b.dataset.go === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'))
    pillFollow()
  }
  function pillFollow() { pill() }

  function marks(items) { $('#bMarks', el).innerHTML = items.join('') }
  function fill(p, animate = true) { const l = line(); l.classList.toggle('no-anim', !animate); l.style.setProperty('--p', p) }
  function setCover(id) { const g = G(id); $('#bCover', el).innerHTML = g ? `<img src="${esc(A(g.cover))}" alt="">` : '' }
  // Second texte : du HTML. Ce qui vient de l'extérieur (noms de jeux, de clips, d'étapes) y passe par esc()
  function text(a, b) { const t1 = $('#bT1', el), t2 = $('#bT2', el); if (t1.textContent !== a) t1.textContent = a; if (t2.innerHTML !== b) t2.innerHTML = b }
  function setMode(m) { mode = m; el.dataset.mode = m; if (m !== 'idle') el.classList.remove('is-split'); el.classList.remove('no-route'); $('#bPlay', el).classList.toggle('is-b', m === 'launch') ; const pl = m === 'launch' ? 'Ne plus attendre' : m === 'live' ? 'Voir le jeu en cours' : m === 'clip' ? 'Mettre en pause ou reprendre' : 'Jouer'; $('#bPlay', el).setAttribute('aria-label', pl); $('#bPlay', el).dataset.tip = pl }

  // Une étape de routine sur la ligne : son icône, son nom au survol. open : un vrai bouton qui ouvre la routine (au repos) ; sinon un simple repère (pendant le lancement)
  const nodes = (steps, cur = -1, open = false) => steps.map((s, i) => {
    const tag = open ? 'button' : 'i', a = open ? ` type="button" aria-label="${esc(s.t || `Étape ${i + 1}`)}, ouvrir la routine"` : ''
    return `<${tag} class="ln-node ${i === cur ? 'cur' : ''}"${a} style="left:${steps.length > 1 ? `calc(12px + (100% - 24px)*${i / (steps.length - 1)})` : '12px'}" data-tip="${esc(s.t || '')}">${ic(s.ic || 'play')}</${tag}>`
  })
  // Au repos, le milieu ne montre que ce qui se passe : la routine du jeu de l'accueil, le vocal de ton serveur.
  // Le reste du temps, il disparaît et la barre se coupe en deux îlots (onglets, boutons).
  function syncGame() {
    if (!el || S.session || mode === 'clip') return
    setMode('idle')
    el.dataset.ctx = S.view === 'game' ? 'sheet' : S.view === 'play' ? 'home' : ''
    $('#bTime', el).textContent = ''; fill(0)
    const g = Play.focused?.() || GAMES[S.focus], gm = g && g.id !== '__all' ? G(g.id) : null
    const r = S.view === 'play' && gm?.installed ? ROUTINES[gm.routine] : null
    const steps = r ? r.steps.filter((x) => x.on) : []
    el.classList.toggle('has-rt', !!steps.length)
    $('#bLbl', el).textContent = steps.length ? `Routine « ${r.name} »` : ''
    if (gm) { setCover(gm.id); text(gm.name, '') }
    marks(steps.length ? nodes(steps, -1, true) : [])
    compact()
  }
  // Tes amis du serveur Discord en vocal : avatars, salon, et un clic l'ouvre dans Discord
  function voice() {
    if (!el) return
    const b = $('#bVoice', el), room = [...VOICE].sort((a, z) => z.people.length - a.people.length)[0]
    b.hidden = !room
    if (room) {
      const n = room.people.length
      b.dataset.ch = room.id
      b.dataset.tip = `Ouvrir « ${room.name} » dans Discord`
      b.setAttribute('aria-label', `${n} en vocal sur ${room.name}, ouvrir dans Discord`)
      b.innerHTML = `<span class="bv-av">${room.people.slice(0, 3).map((p) => avatar(p.n, 24)).join('')}</span><span class="bv-t"><b>${n} en vocal</b><span>${esc(room.name)}</span></span><span class="bv-go">Rejoindre</span>`
    }
    compact()
  }
  function compact() {
    el.classList.toggle('is-split', mode === 'idle' && !el.classList.contains('has-rt') && $('#bVoice', el).hidden)
  }
  return {
    mount, setNav, setMode, fill, marks, text, setCover, syncGame, nodes,
    el: () => el,
    time: (t) => { $('#bTime', el).textContent = t },
    dot: (on) => { $('#bClipsDot', el).classList.toggle('on', on) },
    friendsCount: (n) => { const b = $('#bFriendsN', el); if (b) { b.hidden = !n; b.textContent = n } },
    avatar: () => { const b = $('#bMe', el); if (b) b.innerHTML = avatarMe() },
    line
  }
})()

const Queue = { toggle() { Settings.open('routine') } }
