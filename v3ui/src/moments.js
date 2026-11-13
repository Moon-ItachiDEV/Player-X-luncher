// La première ouverture, dans une seule petite fenêtre : le vrai scan de tes jeux, tes clips, tes comptes. Puis la fenêtre s'ouvre sur l'accueil.
// Un écran = un titre court, une phrase au plus, une action principale. Tout se change plus tard dans Paramètres.
const ROSE_PAL = ['#1c0a14', '#8e1640', '#ff5c86', '#ff8a80']
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const SETUP_KEY = 'pxv3-setup'

const Install = (() => {
  let el, token = 0, onEnd = null, step = 0, steps = [], favs = new Set(), favs0 = '', busy = false, ptr = false
  const win = () => $('#win')
  const iw = () => $('#iw', el)
  const WALL_MAX = 21
  const SIZES = { games: ['min(1080px,94cqw)', 'min(690px,90cqh)'], none: ['min(860px,94cqw)', 'min(400px,90cqh)'], rec: ['min(720px,94cqw)', 'min(280px,90cqh)'], acc: ['min(720px,94cqw)', 'min(480px,90cqh)'] }
  const NAMES = { games: 'Jeux', rec: 'Clips', acc: 'Comptes' }
  function mount(w) {
    el = h(`<section id="inst" hidden data-modal role="dialog" aria-modal="true" aria-labelledby="iwT"><div class="iw" id="iw"></div></section>`); w.append(el)
    // Échap : on passe, l'accueil s'ouvre tel quel
    document.addEventListener('keydown', (e) => { ptr = false; iw()?.classList.remove('ptr'); if (e.key === 'Escape' && !el.hidden && !busy) { e.stopPropagation(); finish() } }, true)
    // À la souris, le focus déplacé d'un écran à l'autre ne dessine pas d'anneau ; au clavier, il reste visible
    el.addEventListener('pointerdown', () => { ptr = true; iw().classList.add('ptr') }, true)
    // La fenêtre change de taille pendant l'étape des jeux : le mur se recalcule
    addEventListener('resize', () => { const wall = !el.hidden && $('#iwWall', iw()), n = wall ? $$('.iw-cell', wall).length : 0; if (n) setWall(wall, sizeWall(n)) })
  }
  function size(k, hh) { const [a, b] = SIZES[k]; win().style.setProperty('--iw', a); win().style.setProperty('--ih', hh || b) }
  const plural = (n, a, b) => `${n} ${n > 1 ? b : a}`
  // Le mur garde des jaquettes entières (2/3) : on choisit le nombre de colonnes qui les fait les plus grandes, puis la fenêtre épouse le mur
  const PAD_H = 220, GAP = 12, CW_MAX = 190
  function wallFit(n) {
    const ww = win().offsetWidth, wh = win().offsetHeight
    const W = Math.min(1080, ww * 0.94) - 64, H = Math.min(690, wh * 0.9) - PAD_H
    // par nombre de rangées, des rangées équilibrées ; une rangée de plus seulement si les jaquettes y gagnent vraiment (15 %)
    let best = null
    for (let r = 1; r <= Math.max(1, n); r++) {
      const c = Math.ceil(n / r), w = Math.min(CW_MAX, (W - (c - 1) * GAP) / c, ((H - (r - 1) * GAP) / r) * 2 / 3)
      if (!best || w > best.w * 1.15) best = { r, w }
    }
    const w = Math.floor(best.w), r = best.r
    return { w, c: Math.ceil(n / r), h: Math.ceil(r * w * 1.5 + (r - 1) * GAP + PAD_H) }
  }
  function sizeWall(n) { const f = wallFit(n); size('games', `min(${f.h}px,90cqh)`); return f }
  const wallStyle = (f) => `--cw:${f.w}px;--ww:${f.c * f.w + (f.c - 1) * GAP}px`
  const setWall = (wall, f) => { wall.style.setProperty('--cw', f.w + 'px'); wall.style.setProperty('--ww', f.c * f.w + (f.c - 1) * GAP + 'px') }
  const slot = (inner) => `<div class="iw-cell">${inner}</div>`

  // Le cadre commun : en-tête (logo, titre, étapes), contenu, pied (retour à gauche, actions à droite)
  function frame({ title, lead = '', body = '', back = false, acts = '', status = false, still = false }) {
    const k = steps[step]
    const dots = steps.length > 1 ? `<ol class="iw-steps" aria-label="Étape ${step + 1} sur ${steps.length}">${steps.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'cur' : ''}"${i === step ? ' aria-current="step"' : ''}><i></i><span>${NAMES[s]}</span></li>`).join('')}</ol>` : ''
    iw().className = 'iw s2 st-' + k + (ptr ? ' ptr' : '') + (still ? ' still' : '')
    iw().innerHTML = `<header class="iw-h"><div class="iw-logo mini">${logo('il')}</div><div class="iw-tt">${dots}<h1 id="iwT">${title}</h1>${lead ? `<p id="iwC"${status ? ' role="status"' : ''}>${lead}</p>` : ''}</div></header>
      <div class="iw-b">${body}</div>
      <footer class="iw-f">${back ? `<button class="btn quiet" id="iwBack">${ic('back')}Retour</button>` : ''}<div class="iw-acts">${acts}</div></footer>`
    $('#iwBack', iw())?.addEventListener('click', () => go(step - 1))
  }
  const main = () => $('[data-main]', iw())
  const focusMain = () => main()?.focus({ preventScroll: true })

  async function open(done) {
    onEnd = done; const t = ++token; busy = false
    favs = new Set(GAMES.filter((g) => g.fav).map((g) => g.rid)); favs0 = [...favs].sort().join()
    steps = ['games', ...(API.clipsSaveSettings ? ['rec'] : []), 'acc']; step = 0
    win().classList.add('is-inst', 'no-trans'); const f0 = sizeWall(7); void win().offsetWidth; win().classList.remove('no-trans')
    Fluid.set(ROSE_PAL); Fluid.dim(1); Fluid.even(true)
    el.hidden = false
    // Pendant le scan : le logo travaille, rien à cliquer
    // Le scan peut durer quelques secondes : des emplacements vides à la place des jaquettes, sans saut quand elles arrivent
    frame({ title: 'On cherche tes jeux', lead: 'Steam, Epic Games, EA app et GOG', body: `<div class="iw-wall is-sk" id="iwWall" aria-hidden="true" style="${wallStyle(f0)}">${slot('<i class="iw-sk"></i>').repeat(7)}</div>`, status: true })
    const lg = $('.il', iw()); lg.classList.add('busy')
    iw().setAttribute('aria-busy', 'true')
    try { await Real.scan() } catch (e) { console.error(e) }
    if (t !== token) return
    lg.classList.remove('busy'); iw().removeAttribute('aria-busy')
    const list = GAMES.filter((g) => g.installed), shown = list.slice(0, WALL_MAX)
    if (list.length) {
      const wall = $('#iwWall', iw())
      wall.classList.remove('is-sk'); wall.removeAttribute('aria-hidden'); setWall(wall, sizeWall(shown.length))
      wall.innerHTML = shown.map((g, i) => cover(g, i)).join('')
      const cs = $$('.iw-c', wall)
      for (let i = 0; i < cs.length; i++) { await wait(reduced() ? 0 : Math.min(110, 1400 / cs.length)); if (t !== token) return; cs[i].classList.add('in') }
      await wait(reduced() ? 0 : 320); if (t !== token) return
    }
    games(true)
  }
  const cover = (g, i) => slot(`<button class="iw-c" style="--i:${i}" data-g="${esc(g.rid)}" data-name="${esc(g.name)}" aria-pressed="${favs.has(g.rid)}" aria-label="${esc(g.name)}, favori"><img src="${esc(A(g.cover))}" alt="" draggable="false"><span class="iw-fv" aria-hidden="true">${ic('starf')}</span></button>`)

  // 1. Tes jeux : ce que le scan a vraiment trouvé. Toucher une jaquette la met en favori.
  function games(first) {
    step = 0
    const list = GAMES.filter((g) => g.installed)
    const fit = list.length ? sizeWall(Math.min(list.length, WALL_MAX)) : (size('none'), null)
    if (!list.length) {
      const rep = (s) => (Real.st.report || []).find((r) => r.store === s)
      const state = (r) => (!r ? 'Pas encore cherché' : r.error ? 'Lecture impossible' : r.absent ? 'Pas sur ce PC' : 'Aucun jeu installé')
      frame({
        title: 'Aucun jeu trouvé', lead: 'Installe un jeu avec Steam, Epic Games ou l’EA app : il arrivera ici tout seul.',
        body: `<ul class="iw-stores">${[['steam', 'Steam'], ['epic', 'Epic Games'], ['ea', 'EA app'], ['gog', 'GOG']].map(([s, n]) => `<li><b>${n}</b><span>${state(rep(s))}</span></li>`).join('')}</ul>`,
        acts: '<button class="btn quiet" id="iwAgain">' + ic('refresh') + 'Relancer la recherche</button><button class="btn rose" data-main>Continuer</button>', status: first, still: first
      })
      $('#iwAgain', iw()).onclick = () => open(onEnd)
    } else {
      frame({
        title: `${plural(list.length, 'jeu trouvé', 'jeux trouvés')}`, lead: 'Touche ceux que tu lances le plus pour les garder en favoris.',
        body: '<div class="iw-wall" id="iwWall"></div>', acts: '<button class="btn rose" data-main>Continuer</button>', status: first, still: first
      })
      const wall = $('#iwWall', iw())
      setWall(wall, fit)
      wall.innerHTML = list.slice(0, WALL_MAX).map((g, i) => cover(g, i)).join('')
      $$('.iw-c', wall).forEach((c) => { c.classList.add('in', 'now'); c.onclick = () => { const on = c.getAttribute('aria-pressed') !== 'true'; c.setAttribute('aria-pressed', on); if (on) favs.add(c.dataset.g); else favs.delete(c.dataset.g) } })
    }
    main().onclick = () => go(1)
    focusMain()
  }

  // 2. Les clips : un vrai choix, dit simplement
  function rec() {
    size('rec')
    const c = Real.clipsCfg, key = c?.hotkey ? Shared.hotkey.hotkeyText(c.hotkey) : '', cs = G('cs2')?.installed
    const how = cs ? `Un kill sur Counter-Strike 2${key ? ` ou ${esc(key)} dans tes jeux` : ''}` : key ? `${esc(key)} dans tes jeux` : 'Un raccourci'
    frame({
      title: 'Garder tes meilleurs moments ?', lead: `${how} garde les dernières secondes en clip. Rien ne sort de ton PC.`, back: true,
      acts: `<button class="btn quiet" data-rec="0">Ne rien enregistrer</button><button class="btn rose" data-main data-rec="1">${xm()}${c?.enabled ? 'Garder les clips' : 'Activer les clips'}</button>`
    })
    $$('[data-rec]', iw()).forEach((x) => x.onclick = async () => {
      const on = x.dataset.rec === '1'
      if (!!c?.enabled !== on) { x.setAttribute('aria-busy', 'true'); try { await Real.saveClips({ enabled: on }) } catch (e) { toast(esc(Settings.errText(e)), { tone: 'warn', ms: 5000 }); x.removeAttribute('aria-busy'); return } }
      go(step + 1)
    })
    focusMain()
  }

  // 3. Les comptes : tous facultatifs, le bouton principal ouvre l'accueil
  function accRows() {
    const s = Real.st.settings, acc = (p) => Real.st.accounts.find((a) => a.platform === p)
    const ok = (name) => `<span class="iw-ok">${ic('check')}${esc(name)}</span>`
    const row = (n, why, right) => `<li><div><b>${esc(n)}</b><span>${esc(why)}</span></div>${right}</li>`
    const rows = [row('Steam', 'Amis, succès, jeux pas installés', acc('steam') ? ok(acc('steam').name) : '<button class="btn sm" data-acc="steam">Connecter Steam</button>')]
    const dcApp = s.discordClientId && s.discordClientSecret
    rows.push(row('Discord', 'Vocal et membres de ton serveur', acc('discord') ? ok(acc('discord').name) : `<button class="btn sm" data-acc="discord">${dcApp ? 'Connecter Discord' : 'Régler Discord'}</button>`))
    if (G('bf6')) rows.push(row('Battlefield 6', 'Stats et classement', Real.st.tracked?.me ? ok(Real.st.tracked.me.name) : '<button class="btn sm" data-acc="bf6">Relier mon profil</button>'))
    rows.push(row('PlayStation', 'Amis PlayStation', acc('psn') ? ok(acc('psn').name) : '<button class="btn sm" data-acc="psn">Régler PlayStation</button>'))
    return rows.join('')
  }
  function accounts() {
    const n = 3 + (G('bf6') ? 1 : 0)
    size('acc', `min(${232 + n * 64}px,90cqh)`)
    frame({
      title: 'Relie tes comptes', lead: 'Facultatif. Tu peux aussi le faire plus tard dans Paramètres.', back: true,
      body: `<ul class="iw-acc">${accRows()}</ul>`,
      acts: '<button class="btn rose" data-main>Ouvrir l’accueil</button>'
    })
    bindAcc()
    main().onclick = () => finish()
    focusMain()
  }
  function bindAcc() {
    $$('[data-acc]', iw()).forEach((x) => x.onclick = async () => {
      const p = x.dataset.acc, s = Real.st.settings
      // Ce qui se règle avec un formulaire (jeton, application Discord, recherche de profil) : l'accueil s'ouvre, puis Paramètres au bon endroit
      if (p === 'bf6' || p === 'psn' || (p === 'discord' && !(s.discordClientId && s.discordClientSecret))) return finish(() => Settings.go('accounts', 'r-' + p))
      x.setAttribute('aria-busy', 'true'); x.disabled = true; x.textContent = 'Termine dans ton navigateur…'
      try { await API.login(p); await Real.refreshAccounts(); Real.loadFriends(); Real.loadGames(true).catch(() => {}) } catch (e) { toast(esc(Settings.errText(e)), { tone: 'warn', ms: 5000 }) }
      if (el.hidden || steps[step] !== 'acc') return
      $('.iw-acc', iw()).innerHTML = accRows(); bindAcc(); focusMain()
    })
  }

  async function go(i) {
    if (i < 0) return
    if (i >= steps.length) return finish()
    // en quittant l'étape des jeux : les favoris choisis
    if (steps[step] === 'games' && [...favs].sort().join() !== favs0) { favs0 = [...favs].sort().join(); API.setFavorites([...favs]).then(() => Real.loadGames(false)).catch(() => {}) }
    step = i
    const k = steps[i]
    if (k === 'games') games(false); else if (k === 'rec') rec(); else accounts()
  }

  // La fin : la petite fenêtre devient Player X, sur l'accueil avec tes jeux
  function finish(after) {
    if (busy || el.hidden) return
    busy = true; token++
    if (steps[step] === 'games' && [...favs].sort().join() !== favs0) API.setFavorites([...favs]).then(() => Real.loadGames(false)).catch(() => {})
    const w = iw()
    w.classList.add('fly')
    $$('.iw-c', w).forEach((c) => c.style.setProperty('--fly', 1))
    setTimeout(() => {
      const x = win(); x.classList.remove('is-inst'); x.classList.add('is-grow'); Fluid.even(false)
      setTimeout(() => {
        x.classList.remove('is-grow'); el.hidden = true; w.innerHTML = ''; busy = false
        Play.sync(); Play.intro(); Fluid.game(Play.focused(), ROSE_PAL); Bar.syncGame()
        onEnd?.(); if (after) setTimeout(after, 200)
        else if (!ptr) setTimeout(() => $('#htPlay')?.focus({ preventScroll: true }), 60)
      }, reduced() ? 60 : 620)
    }, reduced() ? 60 : 380)
  }
  return { mount, open, active: () => !el.hidden }
})()

const Setup = (() => {
  const done = () => { try { localStorage.setItem(SETUP_KEY, '1') } catch { /* stockage indisponible : l'accueil reviendra au prochain lancement */ } }
  const seen = () => { try { return localStorage.getItem(SETUP_KEY) !== null } catch { return true } }
  // « Revoir l'accueil » (Paramètres) rouvre le même parcours, avec un nouveau scan
  function open() { if (!Install.active()) Install.open(done) }
  function maybeOpen() { if (!seen()) open() }
  return { open, maybeOpen }
})()
