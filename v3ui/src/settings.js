// Paramètres : une page à part, opaque. Un sommaire en texte, une seule colonne de réglages, une recherche, et tout s'enregistre seul.
// Chaque réglage est le vrai : il part dans le processus principal de Player X et il agit tout de suite.
const Settings = (() => {
  let newFor = null
  let el, sec = 'rec', routine = null, back = null, savedT = 0, q = '', hit = 0, waiting = null, addKind = null
  // Rangé par intention : en jeu, l'appli, toi. Le troisième champ (icône) n'est plus affiché, gardé pour les autres listes
  const NAV = [
    [['rec', 'Enregistrement', 'clip'], ['edit', 'Montage', 'clip'], ['overlay', 'Overlay', 'overlay'], ['routine', 'Routines', 'queue']],
    [['general', 'Général', 'gear'], ['library', 'Bibliothèque', 'lib'], ['keys', 'Raccourcis', 'keys']],
    [['accounts', 'Comptes', 'users'], ['about', 'À propos', 'info']]
  ]
  // Une phrase seulement quand elle aide à décider : ici, coller une clé
  const META = {
    accounts: ['Comptes', 'Tes clés restent sur ce PC.'],
    rec: ['Enregistrement', ''],
    edit: ['Montage', ''],
    overlay: ['Overlay', ''],
    routine: ['Routines', 'Avant ton jeu : ouvrir Discord, fermer Chrome… Tout part avec Jouer.'],
    library: ['Bibliothèque', ''],
    general: ['Général', ''],
    keys: ['Raccourcis', ''],
    about: ['À propos', '']
  }
  const OVSTYLE = { b: 'Verre', a: 'Apple', c: 'Player X' }
  // La recherche lit les noms des réglages et quelques synonymes
  const IDX = [
    ['accounts', 'r-steam', 'Steam', 'compte clé api web key déconnecter clé web api'], ['accounts', 'r-discord', 'Discord', 'serveur vocal membres client secret widget id serveur application avancé'], ['accounts', 'r-bf6', 'Profil Battlefield 6', 'ea stats compte bf6 pseudo'], ['accounts', 'r-psn', 'PlayStation', 'psn compte npsso sony jeton'], ['accounts', 'r-epic', 'Epic Games, EA app et GOG', 'origin compte gog galaxy'], ['accounts', 'r-me', 'Pseudo et photo', 'profil nom avatar'],
    ['rec', 'r-rec', 'Garder mes moments', 'autorecord enregistrement rec clip nvidia highlights kills'], ['rec', 'r-dur', 'Durée d’un clip', 'avant après secondes longueur'], ['rec', 'r-merge', 'Réunir les kills proches', 'doublé fusion multi'], ['rec', 'r-trig', 'Ce qui garde un clip', 'déclencheurs kill headshot triple quadra ace mort automatique'], ['rec', 'r-qual', 'Qualité', 'bitrate mbit résolution fps images légère équilibrée haute'], ['rec', 'r-capm', 'Capture de l’image', 'moteur vidéo chrome obs carte graphique fluide fenêtre du jeu'], ['rec', 'r-game', 'Son du PC', 'audio son du jeu discord'], ['rec', 'r-mic', 'Micro', 'voix microphone piste'], ['rec', 'r-folder', 'Dossier des clips', 'emplacement vidéos chemin'], ['rec', 'r-limit', 'Place maximale', 'stockage disque go espace effacer favoris'], ['rec', 'r-disp', 'Écran filmé', 'moniteur display'], ['rec', 'r-gms', 'Jeux filmés', 'jeux enregistrés tous cs2 bf6'], ['rec', 'r-log', 'Copier le journal', 'diagnostic erreur log souci problème'], ['rec', 'r-cap', 'Essayer la capture comme OBS', 'obs fluide images par seconde saccade freeze essai capture'],
    ['overlay', 'r-ovcs', 'Overlay de Counter-Strike 2', 'cs2 hud style verre apple'],
    ['edit', 'r-eng', 'Moteur vidéo', 'montage film frag movie export rendu ffmpeg encodeur carte graphique nvidia amd intel essai tester'], ['about', 'r-ffm', 'Licence du moteur vidéo', 'ffmpeg lgpl sources logiciel libre'],
    ['routine', 'r-rt', 'Créer une routine', 'étapes jouer discord salon fermer appli lancer ordre'],
    ['library', 'r-news', 'Actus des jeux', 'patch événements nouvelles badge'], ['library', 'r-hid', 'Jeux masqués', 'cacher réafficher'], ['library', 'r-col', 'Collections', 'ranger'], ['library', 'r-scan', 'Chercher mes jeux', 'scan analyse détecter dossiers'],
    ['general', 'r-fond', 'Fond de l’accueil', 'verre cannelé lignes écran mur fluide apparence image thème'], ['general', 'r-motion', 'Fond qui suit la souris', 'animation mouvement parallaxe'], ['general', 'r-win', 'Démarrer avec Windows', 'lancement session démarrage'], ['general', 'r-tray', 'Quand je ferme la fenêtre', 'croix quitter horloge zone de notification'], ['general', 'r-launch', 'Quand un jeu démarre', 'réduire rester fenêtre'], ['general', 'r-fr', 'Alertes d’amis', 'steam playstation psn notification connexion'], ['general', 'r-ready', 'Jeu prêt après une mise à jour', 'alerte steam téléchargement notification'], ['general', 'r-live', 'Suivre mes matchs de Counter-Strike 2', 'gsi score direct bilan clips auto'], ['general', 'r-cs2open', 'Ouvrir le bilan à la fin du match', 'counter-strike story résumé'], ['general', 'r-bfrecap', 'Bilan après chaque session de Battlefield 6', 'résumé stats'],
    ['keys', 'k-clip', 'Clipper à la main', 'raccourci touche clip'], ['keys', 'k-overlay', 'Masquer l’overlay', 'raccourci touche hud'], ['keys', 'k-search', 'Tout rechercher', 'raccourci touche palette'], ['keys', 'k-find', 'Chercher un réglage', 'raccourci touche'], ['keys', 'k-rt', 'Lancer une routine', 'raccourci touche'], ['keys', 'k-set', 'Ouvrir les paramètres', 'raccourci touche'],
    ['about', 'r-ver', 'Version installée', 'build test mise à jour'], ['about', 'r-setup', 'Revoir l’accueil', 'première ouverture'],
    ['rec', 'r-hot', 'Clipper à la main', 'raccourci touche clip manuel'], ['overlay', 'r-ovkey', 'Masquer ou afficher l’overlay', 'raccourci touche hud']
  ]
  const QUAL = { light: ['Légère', '1080p, 30 images/s', 10.13], balanced: ['Équilibrée', '1080p, 60 images/s', 20.16], high: ['Haute', 'Ton écran, 60 images/s', 40.19] }
  // Bêta 42 : avec le moteur vidéo, l'image garde la taille de l'écran ; la qualité règle les images par seconde et le débit.
  const QUAL_ENGINE = { light: '30 images/s, 10 Mb/s', balanced: '60 images/s, 20 Mb/s', high: '60 images/s, 40 Mb/s' }
  // Un moment n'a qu'un genre : un kill à la tête compte comme headshot, le 3e et le 4e kill d'un round comme triple ou quadra, le 5e comme ACE
  const TRIG = [['kill', 'Kill'], ['hs', 'Headshot'], ['multi', 'Triple ou quadra'], ['ace', 'ACE'], ['death', 'Ta mort']]
  const FIXED = { search: ['Ctrl', 'K'], find: ['Ctrl', 'F'], settings: ['Ctrl', ','] }
  const FLUID = 'pxv3-fond-fixe'
  const fluidOn = () => { try { return localStorage.getItem(FLUID) !== '1' } catch { return true } }
  const s = () => Real.st.settings
  const norm = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const kbds = (a) => a.map((x) => `<kbd class="kb">${esc(x)}</kbd>`).join('')
  const keysOf = (accel) => kbds(Shared.hotkey.hotkeyLabel(accel))

  function mount(win) {
    el = h(`<div id="sheet" hidden data-modal><section class="sh" role="dialog" aria-modal="true" aria-labelledby="shName">
      <header class="sh-top"><h2 id="shName">Paramètres</h2>
        <label class="sh-q" for="shQ">${ic('search')}<span class="sh-q-l">Chercher un réglage</span><input id="shQ" type="search" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="shRes"><kbd class="kb">Ctrl F</kbd></label>
        <div class="sh-end"><button class="btn sm icon" id="shX" aria-label="Fermer les paramètres" data-tip="Fermer, Échap" data-tip-b data-tip-r>${ic('close')}</button></div></header>
      <nav class="sh-nav" id="shNav" aria-label="Rubriques"></nav>
      <div class="sh-main"><div class="sh-head"><h1 id="shTitle"></h1><span class="sh-saved" id="shSaved" role="status"></span></div><div class="sh-body" id="shBody" tabindex="-1"></div>
        <div class="sh-res" id="shRes" role="listbox" aria-label="Réglages trouvés" hidden></div><p class="vh" id="shResN" role="status"></p></div></section></div>`)
    win.append(el)
    if (!fluidOn()) Fluid.freeze(true)
    syncBar()
    $('#shX', el).onclick = () => close()
    $('#shNav', el).innerHTML = NAV.map((g) => `<div class="sh-g">${g.map(([k, l]) => `<button class="sh-t" data-s="${k}" tabindex="-1"><span>${l}</span><em data-st="${k}"></em></button>`).join('')}</div>`).join('')
    $$('.sh-t', el).forEach((b) => { b.onclick = () => { clearSearch(); show(b.dataset.s) } })
    // Le sommaire : une seule tabulation, puis les flèches. La rubrique suit le focus
    $('#shNav', el).addEventListener('keydown', (e) => {
      const l = $$('.sh-t', el), i = l.indexOf(document.activeElement); if (i < 0) return
      const j = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: l.length - 1 }[e.key]; if (j === undefined) return
      e.preventDefault(); const n = l[(j + l.length) % l.length]; clearSearch(); show(n.dataset.s); n.focus()
    })
    const input = $('#shQ', el)
    input.oninput = () => { q = norm(input.value.trim()); hit = 0; paintRes() }
    input.onkeydown = (e) => {
      const r = results()
      if (e.key === 'Escape' && input.value) { e.stopPropagation(); clearSearch() }
      else if (e.key === 'ArrowDown' && r.length) { e.preventDefault(); hit = Math.min(r.length - 1, hit + 1); markRes() }
      else if (e.key === 'ArrowUp' && r.length) { e.preventDefault(); hit = Math.max(0, hit - 1); markRes() }
      else if (e.key === 'Enter' && r[hit]) { e.preventDefault(); pick(r[hit]) }
    }
    document.addEventListener('keydown', (e) => {
      if (el.hidden || document.querySelector('dialog[open]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); input.focus(); input.select(); return }
      // Échap défait d'abord la recherche, puis ferme
      if (e.key === 'Escape' && !waiting) { if (q) { clearSearch(); input.focus() } else close() }
    })
    // Choisir un raccourci : la touche suivante est pour nous, pas pour l'appli
    document.addEventListener('keydown', captureKey, true)
    Real.on('friends', () => { if (!el.hidden && sec === 'accounts' && !el.contains(document.activeElement?.closest?.('input'))) repaint() })
    // L'essai du moteur vidéo avance : seule sa ligne change, le focus ne bouge pas
    API.onEditEngineStep((st) => { engStep = st; const t = $('#eSt', el); if (t) t.textContent = stepText(st) })
  }
  function repaint() { const b = $('#shBody', el), y = b.scrollTop; paint(); b.scrollTop = y; paintNav() }
  function open(p) {
    if (!el.hidden && !p) return
    if (el.hidden) back = document.activeElement
    const gr = GAMES[S.focus]?.routine; if (p === 'routine' && gr && !newFor && ROUTINES[gr] && !open.keep) routine = gr
    if (p) { sec = p === 'interface' ? 'general' : p; $('#shBody', el).scrollTop = 0 }
    el.hidden = false; void el.offsetWidth; el.classList.add('on'); clearSearch(); paintNav(); paint(); navBtn().focus({ preventScroll: true })
    // L'état du moteur vidéo se demande à la première ouverture des paramètres, pas au démarrage de l'appli
    if (!eng && !engLoad) loadEngine()
  }
  function close(silent) { if (el.hidden) return; el.classList.remove('on'); setTimeout(() => { el.hidden = true; if (silent !== true) giveFocus(back) }, 200) }
  function show(p, rowId) {
    sec = p; paintNav(); paint(); const b = $('#shBody', el); b.scrollTop = 0
    if (rowId) {
      const r = document.getElementById(rowId); if (!r) return
      // Un réglage trouvé par la recherche peut être replié : on déplie d'abord, pour le mesurer et lui donner le focus
      const d = r.closest('details[data-more]'); if (d && !d.open) d.open = true
      // Seule la page défile : scrollIntoView déplacerait aussi la fenêtre, même en overflow hidden
      const br = b.getBoundingClientRect(), rr = r.getBoundingClientRect()
      b.scrollTo({ top: b.scrollTop + rr.top - br.top - Math.max(80, (br.height - rr.height) / 2), behavior: reduced() ? 'auto' : 'smooth' })
      r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 900)
      const f = r.querySelector('button,input,select'); if (f) f.focus({ preventScroll: true })
    }
  }
  const navBtn = () => $(`.sh-t[data-s="${sec}"]`, el)
  // L'état de chaque rubrique se lit dans le sommaire, sans l'ouvrir
  function paintNav() {
    $$('.sh-t', el).forEach((b) => { const on = b.dataset.s === sec; if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); b.tabIndex = on ? 0 : -1 })
    const ov = s().cs2Overlay, n = (Real.st.accounts || []).length
    const st = {
      rec: Real.clipsCfg ? (Real.clipsOn?.() ? '<i class="dot"></i>Activé' : 'Coupé') : '',
      edit: !eng ? '' : engRun ? 'Essai en cours' : eng.status !== 'ready' ? 'À réparer' : eng.test && !eng.test.best ? 'Essai raté' : 'Prêt',
      overlay: ov === 'off' ? 'Coupé' : OVSTYLE[ov] || '',
      accounts: n ? Shared.text.plural(n, 'relié', 'reliés') : ''
    }
    $$('[data-st]', el).forEach((e) => { const t = st[e.dataset.st] || ''; e.innerHTML = t; e.classList.toggle('off', t === 'Coupé') })
  }
  function saved() {
    const m = $('#shSaved', el); m.innerHTML = `${ic('check')}Enregistré`; m.classList.add('on')
    clearTimeout(savedT); savedT = setTimeout(() => { m.classList.remove('on'); setTimeout(() => { if (!m.classList.contains('on')) m.textContent = '' }, 300) }, 1800); paintNav()
  }
  const failed = (e) => toast(esc(errText(e)), { tone: 'warn', ms: 5000 })
  // Un vrai enregistrement : le « Enregistré » ne s'affiche qu'une fois le réglage accepté
  const save = (patch) => Real.saveSettings(patch).then((r) => { saved(); syncBar(); return r }).catch((e) => { failed(e); repaint() })
  const saveClips = (patch) => Real.saveClips(patch).then((r) => { saved(); syncBar(); return r }).catch((e) => { failed(e); repaint() })
  function syncBar() {
    const rec = $('#bRec'), ov = $('#bOv'); if (!rec || !ov) return
    const r = !!Real.clipsOn?.(), o = s().cs2Overlay !== 'off'
    rec.setAttribute('aria-pressed', r); rec.dataset.tip = r ? `Couper l’enregistrement. ${Shared.hotkey.hotkeyText(Real.clipsCfg?.hotkey)} garde les dernières secondes` : 'Activer l’enregistrement'
    ov.setAttribute('aria-pressed', o); ov.dataset.tip = o ? 'Couper l’overlay' : 'Activer l’overlay'
  }
  /* Recherche */
  // Le nom d'abord : « micro » met « Micro » avant les réglages qui ne le citent qu'en synonyme
  const results = () => (q ? IDX.filter(([, , t, k]) => norm(t + ' ' + k).includes(q)).sort(([, , a], [, , b]) => (norm(b).includes(q) ? 1 : 0) - (norm(a).includes(q) ? 1 : 0)).slice(0, 8) : [])
  function pick([p, id]) { clearSearch(); show(p, id) }
  function clearSearch() { const i = $('#shQ', el); i.value = ''; q = ''; paintRes() }
  function paintRes() {
    const box = $('#shRes', el), i = $('#shQ', el), r = results()
    box.hidden = !q; $('.sh-main', el).classList.toggle('finding', !!q); $('.sh-q', el).classList.toggle('has', !!i.value); i.setAttribute('aria-expanded', !!q && r.length > 0)
    $('#shResN', el).textContent = q ? (r.length ? Shared.text.plural(r.length, 'réglage trouvé', 'réglages trouvés') : 'Aucun réglage trouvé') : ''
    i.removeAttribute('aria-activedescendant')
    if (!q) { box.innerHTML = ''; return }
    box.innerHTML = r.length
      ? r.map(([p, , t], n) => `<button class="sh-r" id="shR${n}" role="option" data-i="${n}" tabindex="-1"><b>${esc(t)}</b><span>${esc(META[p][0])}</span></button>`).join('')
      : `<div class="sh-0"><p>Aucun réglage pour « ${esc(i.value)} ». Essaie « micro », « clé » ou « fond ».</p><button class="btn sm" id="shClr">Effacer la recherche</button></div>`
    $$('.sh-r', box).forEach((b) => { b.onclick = () => pick(r[+b.dataset.i]); b.onpointermove = () => { hit = +b.dataset.i; markRes() } })
    $('#shClr', box)?.addEventListener('click', () => { clearSearch(); i.focus() })
    markRes()
  }
  function markRes() { $$('.sh-r', el).forEach((b) => { const on = +b.dataset.i === hit; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); if (on) $('#shQ', el).setAttribute('aria-activedescendant', b.id) }) }

  /* Les briques */
  const sw = (id, on, label = '') => `<button class="sw" id="${id}" role="switch" aria-checked="${!!on}" ${label ? `aria-label="${esc(label)}"` : ''}><i></i></button>`
  const row = (id, t, sub, ctrl) => `<div class="sr" ${id ? `id="${id}"` : ''}><div class="sr-t"><b>${t}</b>${sub ? `<span>${sub}</span>` : ''}</div>${ctrl ? `<div class="sr-c">${ctrl}</div>` : ''}</div>`
  const group = (title, inner, note) => `<section class="sg">${title ? `<h2>${title}</h2>` : ''}<div class="sg-l">${inner}</div>${note ? `<p class="sg-n">${note}</p>` : ''}</section>`
  const seg = (name, opts, v) => `<div class="seg" role="radiogroup" aria-label="${esc(name)}">${opts.map(([k, l]) => `<button role="radio" data-v="${k}" aria-checked="${k === v}" tabindex="${k === v ? 0 : -1}">${esc(l)}</button>`).join('')}</div>`
  const ON = (id, fn) => { const b = $('#' + id, el); if (b) b.onclick = () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', v); fn && fn(v) } }
  function bindSeg(root, fn) {
    const l = $$('[role=radio]', root)
    const choose = (x) => { l.forEach((y) => { y.setAttribute('aria-checked', y === x); y.tabIndex = y === x ? 0 : -1 }); fn(x.dataset.v ?? x.dataset.q) }
    l.forEach((x, i) => {
      x.onclick = () => choose(x)
      x.onkeydown = (e) => { const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return; e.preventDefault(); const n = l[(i + d + l.length) % l.length]; n.focus(); n.click() }
    })
  }
  // Un champ enregistré quand on le quitte : l'erreur n'apparaît qu'après, et part dès qu'on y retourne
  const field = (id, label, value, { secret, placeholder = '', help = '', auto = 'off' } = {}) => `<div class="at-f sf ${secret ? 'sf-s' : ''}"><div class="sf-l"><label for="${id}">${label}</label>${secret && value ? `<button type="button" class="sr-lnk" data-clear="${id}">Effacer</button>` : ''}</div><div class="sf-w"><input class="at-i" id="${id}" type="${secret ? 'password' : 'text'}" value="${secret ? '' : esc(value || '')}" placeholder="${esc(secret && value ? `Enregistré, se termine par ${String(value).replace(/^•+/, '') || '••••'}` : placeholder)}" autocomplete="${auto}" spellcheck="false">${secret ? `<button type="button" class="sf-eye" data-eye="${id}" aria-label="Afficher ${esc(label)}" aria-pressed="false" data-tip="Afficher" data-tip-r>${ic('eye')}</button>` : ''}</div><p class="at-err" id="${id}-e" role="alert" hidden></p>${help ? `<p class="sf-h">${help}</p>` : ''}</div>`
  function bindField(b, id, { validate, onSave }) {
    const i = $('#' + id, b), err = $(`#${id}-e`, b); if (!i) return
    let last = i.value
    const show1 = (m) => { err.textContent = m || ''; err.hidden = !m; if (m) { i.setAttribute('aria-invalid', 'true'); i.setAttribute('aria-describedby', err.id) } else { i.removeAttribute('aria-invalid'); i.removeAttribute('aria-describedby') } }
    i.onfocus = i.oninput = () => show1('')
    i.onblur = async () => {
      const v = i.value.trim()
      if (v === last) return
      const m = v && validate ? validate(v) : null
      if (m) return show1(m)
      try { await onSave(v); last = v; i.value = v } catch (e) { show1(errText(e)) }
    }
    i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur() } }
    const clr = $(`[data-clear="${id}"]`, b)
    if (clr) clr.onclick = () => { const name = $(`label[for="${id}"]`, b).textContent; confirmDel({ title: `Effacer « ${esc(name)} » ?`, text: 'Il faudra le coller de nouveau pour que cette connexion remarche.', verb: 'Effacer', onOk: async () => { try { await onSave('') } catch (e) { show1(errText(e)) } } }) }
    const eye = $(`[data-eye="${id}"]`, b)
    if (eye) eye.onclick = () => { const on = i.type === 'password'; i.type = on ? 'text' : 'password'; eye.setAttribute('aria-pressed', on); eye.dataset.tip = on ? 'Masquer' : 'Afficher' }
  }
  function paint() {
    const b = $('#shBody', el), [t, d] = META[sec]
    $('#shTitle', el).textContent = t
    ;({ rec: pRec, edit: pEdit, routine: pRoutine, overlay: pOverlay, accounts: pAccounts, library: pLibrary, general: pGeneral, keys: pKeys, about: pAbout })[sec](b, d ? `<p class="sh-d">${d}</p>` : '')
  }

  /* Les replis « Plus de réglages » : ce qu'on règle une fois. Ouverts ou fermés, ils le restent d'un passage à l'autre */
  const moreOpen = new Set()
  const more = (k, what, inner, title = 'Plus de réglages') => `<section class="sg rc-more"><details data-more="${k}" ${moreOpen.has(k) ? 'open' : ''}><summary><h2>${title}</h2><span>${what}</span>${ic('chevd')}</summary><div class="sg-l">${inner}</div></details></section>`
  function bindMore(b) {
    $$('details[data-more]', b).forEach((d) => {
      d.ontoggle = () => { if (d.open) moreOpen.add(d.dataset.more); else moreOpen.delete(d.dataset.more) }
    })
  }
  // Une ligne sans texte dessous : la place reste prête pour un message d'erreur du raccourci
  const noSub = '<i class="rc-0">&#8203;</i>'
  const markNoSub = (b) => $$('.rc-0', b).forEach((i) => i.parentElement.classList.add('rc-h'))

  /* Enregistrement : d'abord ce qu'on change souvent, le reste replié */
  function pRec(b, d) {
    const c = Real.clipsCfg
    if (!c) {
      b.innerHTML = `${d}<div class="empty"><h2>Enregistrement indisponible</h2><p>Le moteur d’enregistrement n’a pas répondu. Réessaie, ou relance Player X si ça continue.</p><button class="btn sm" id="rRetry">${ic('refresh')}Réessayer</button></div>`
      $('#rRetry', b).onclick = async (e) => { e.currentTarget.disabled = true; await Real.loadClipsCfg().catch(() => null); repaint() }
      return
    }
    const stt = Real.clipsLive, on = c.enabled, live = Real.st.settings?.cs2Live !== false
    const stateTxt = !on ? 'Coupé, aucun clip n’est gardé'
      : stt?.error ? `<em class="rc-err">${esc(stt.error)}</em> <button class="sr-lnk" id="rLog2">Copier le journal</button>`
      : stt?.status === 'recording' ? `En cours${stt.game ? ` sur ${esc(stt.game)}` : ''}${stt.audio === 'none' ? ', sans le son' : ''}`
      : 'Prêt, démarre avec ton jeu'
    b.innerHTML = `${d}${group('', row('r-rec', 'Garder mes moments', stateTxt, sw('rMaster', on, 'Garder mes moments')))}
      <div class="rec-rest ${on ? '' : 'off'}" ${on ? '' : 'inert'}>
      ${group('Ce qui garde un clip', `${row('r-hot', KEYNAME.clip, 'Dans tous tes jeux', kcap('clip'))}
        <div class="sb rc-trig" id="r-trig"><p class="sb-t">Tout seul sur Counter-Strike 2</p>
          ${live ? '' : '<p class="rc-off">Le suivi des matchs est coupé : seul le raccourci garde un clip. <button class="sr-lnk" id="rLiveOn">Activer le suivi</button></p>'}
          <div class="pills ${live ? '' : 'rc-dim'}" role="group" aria-label="Moments gardés sur Counter-Strike 2" ${live ? '' : 'inert'}>${TRIG.map(([k, l]) => `<button class="pill" id="t0${k}" aria-pressed="${!!c.triggers[k]}">${ic('check')}${l}</button>`).join('')}</div></div>`)}
      ${group('Durée d’un clip', `<div class="sb" id="r-dur"><div class="rd" id="rd1"></div>
          <div class="rd-sl"><label for="rBefore"><span>Avant le moment</span><b class="num" id="rBeforeV"></b><input id="rBefore" type="range" min="5" max="120" step="1" value="${c.before}"></label>
          <label for="rAfter"><span>Après le moment</span><b class="num" id="rAfterV"></b><input id="rAfter" type="range" min="0" max="30" step="1" value="${c.after}"></label></div>
          <p class="rd-res num" id="rdRes"></p></div>`)}
      ${group('Image et son', `<div class="sb" id="r-qual"><div class="seg3" role="radiogroup" aria-label="Qualité">${Object.entries(QUAL).map(([k, [n, f]]) => `<button class="seg3-b" role="radio" data-q="${k}" aria-checked="${c.quality === k}" tabindex="${c.quality === k ? 0 : -1}"><b>${n}</b><span>${c.capture === 'chrome' ? f : QUAL_ENGINE[k]}</span></button>`).join('')}</div></div>
        ${row('r-capm', 'Capture de l’image', c.capture === 'chrome' ? 'Par Chrome : moins fluide quand le jeu tourne à fond.' : 'Par la carte graphique, comme OBS. Seule la fenêtre du jeu est filmée.', seg('Capture de l’image', [['engine', 'Moteur vidéo'], ['chrome', 'Chrome']], c.capture || 'engine'))}
        ${row('r-game', 'Son du PC', '', sw('rGame', c.gameAudio, 'Son du PC'))}
        ${row('r-mic', 'Micro', '', sw('rMic', c.mic, 'Micro'))}`)}
      ${group('Essai', row('r-cap', 'Essayer la capture comme OBS', '<span id="rCapS">Pendant une partie : lance l’essai, retourne dans ton jeu, il filme 30 s.</span>', '<button class="btn sm" id="rCap">Lancer l’essai</button>'))}
      ${more('rec', 'Jeux filmés, kills proches, dossier, place', `${row('r-gms', 'Jeux filmés', '', seg('Jeux filmés', [['all', 'Tous mes jeux'], ['cs2bf6', 'CS2 et Battlefield 6']], c.games))}
        <div id="rDispBox" hidden></div>
        <div class="sb" id="r-merge"><div class="rd-sl one"><label for="rMerge"><span>Réunir les kills à moins de</span><b class="num" id="rMergeV"></b><input id="rMerge" type="range" min="0" max="30" step="1" value="${c.merge}"></label></div><p class="rd-res" id="rdRes2"></p></div>
        ${row('r-folder', 'Dossier des clips', esc(c.folder || 'Vidéos, Player X'), '<button class="btn sm" id="rOpen">Ouvrir le dossier</button><button class="btn sm" id="rFolder">Changer</button>')}
        <div class="sb" id="r-limit"><div class="rd-sl one"><label for="rLimit"><span>Place maximale</span><b class="num" id="rLimitV"></b><input id="rLimit" type="range" min="1" max="100" step="1" value="${c.limitGb}"></label></div><p class="rd-res">Les plus anciens partent en premier, jamais tes favoris.</p></div>
        ${row('r-log', 'En cas de souci', '', '<button class="btn sm" id="rLog">Copier le journal</button>')}`)}
      </div>`
    ON('rMaster', (v) => saveClips({ enabled: v }).then(() => { const y = b.scrollTop; paint(); b.scrollTop = y; $('#rMaster', el).focus() }))
    ON('rGame', (v) => saveClips({ gameAudio: v })); ON('rMic', (v) => saveClips({ mic: v }))
    TRIG.forEach(([k]) => { const x = $('#t0' + k, b); x.onclick = () => { const v = x.getAttribute('aria-pressed') !== 'true'; x.setAttribute('aria-pressed', v); saveClips({ triggers: { ...Real.clipsCfg.triggers, [k]: v } }) } })
    bindSeg($('.seg3', b), (v) => { saveClips({ quality: v }); Real.clipsCfg.quality = v; diag() })
    bindSeg($('#r-gms .seg', b), (v) => saveClips({ games: v }))
    bindSeg($('#r-capm .seg', b), (v) => saveClips({ capture: v }).then(() => { const y = b.scrollTop; paint(); b.scrollTop = y; $('#r-capm [aria-checked=true]', el)?.focus() }))
    // Chaque enregistrement remplace Real.clipsCfg : le curseur écrit dans la version du moment, pas dans celle de l'ouverture
    const bind = (id, key) => { const i = $('#' + id, b); i.oninput = () => { Real.clipsCfg[key] = +i.value; diag() }; i.onchange = () => saveClips({ [key]: +i.value }).then(diag) }
    bind('rBefore', 'before'); bind('rAfter', 'after'); bind('rMerge', 'merge'); bind('rLimit', 'limitGb')
    bindKc(b); bindMore(b)
    $('#rLiveOn', b)?.addEventListener('click', async () => { try { await Real.saveSettings({ cs2Live: true }); saved(); repaint() } catch (e) { failed(e) } })
    $('#rFolder', b).onclick = async () => { const f = await API.clipsChooseFolder().catch((e) => { failed(e); return null }); if (f) { await Real.loadClipsCfg(); saved(); repaint() } }
    $('#rOpen', b).onclick = () => API.clipsOpenFolder().catch(failed)
    const copyLog = async () => { const t = await API.clipsLogTail().catch(() => ''); try { await navigator.clipboard.writeText(t || 'Journal vide'); toast(`${ic('check')} Journal copié`, { ms: 1800 }) } catch { toast('Le journal n’a pas pu être copié. Réessaie dans un instant.', { tone: 'warn', ms: 3000 }) } }
    $('#rLog', b).onclick = copyLog; $('#rLog2', b)?.addEventListener('click', copyLog)
    // Essai « capture comme OBS » : avancement dans la ligne, résultat dans la ligne et dans un message
    $('#rCap', b).onclick = async (e) => {
      const btn = e.currentTarget, st = () => $('#rCapS', el)
      if (btn.getAttribute('aria-busy')) return
      btn.setAttribute('aria-busy', 'true'); btn.disabled = true
      const off = API.onEditCaptureStep((s) => {
        const t = st(); if (!t) return
        t.textContent = s.phase === 'wait' ? `Retourne dans ton jeu : l’essai commence dans ${s.seconds} s.` : s.phase === 'run' ? `Essai ${s.index} sur ${s.total} : ${s.label}…` : 'Essai fini.'
      })
      try {
        const r = await API.editCaptureTest()
        const line = r.trials.map((x) => (x.ok ? `${x.label} : ${String(x.fps).replace('.', ',')} images/s` : `${x.label} : raté`)).join(' · ')
        if (st()) st().textContent = `${line}${r.game ? '' : ' (aucun jeu en cours)'}. Vidéos dans « Essais capture ».`
        toast(`${ic('check')} Essai fini. ${esc(line)}`, { ms: 12000 })
      } catch (err) { if (st()) st().textContent = errText(err); failed(err) }
      finally { off(); btn.removeAttribute('aria-busy'); btn.disabled = false }
    }
    // Plusieurs écrans seulement : avec un seul, il n'y a rien à choisir
    API.clipsDisplays().then((list) => {
      const box = $('#rDispBox', b); if (!box || !list || list.length < 2) return
      box.outerHTML = row('r-disp', 'Écran filmé', '', `<select class="sel" id="rDisp" aria-label="Écran filmé"><option value="0">Écran principal</option>${list.map((x) => `<option value="${x.id}">${esc(x.label)}, ${x.width} × ${x.height}</option>`).join('')}</select>`)
      const sel = $('#rDisp', b); sel.value = String(c.display || 0); sel.onchange = () => saveClips({ display: +sel.value })
    }).catch(() => {})
    diag()
  }
  function diag() {
    const b = $('#shBody', el); if (!$('#rd1', b)) return
    const c = Real.clipsCfg
    $$('input[type=range]', b).forEach((i) => i.style.setProperty('--pct', ((i.value - i.min) / (i.max - i.min) * 100) + '%'))
    const be = c.before, af = c.after, m = c.merge
    const span = Math.max(66, be + af + 14), pct = (x) => x / span * 100
    const x = span - af - 7
    $('#rd1', b).innerHTML = `<i class="rd-t"></i><i class="rd-c" style="left:${pct(x - be)}%;width:${pct(be + af)}%"></i><span class="rd-l" style="left:${pct(x - be / 2)}%">${be} s</span><span class="rd-l" style="left:${pct(x + af / 2)}%">${af} s</span><span class="rd-x big" style="left:${pct(x)}%">${xm()}</span>`
    const tot = be + af, mo = tot * QUAL[c.quality][2] / 8
    $('#rdRes', b).innerHTML = `<b>${tot} s</b> par clip, environ <b>${Math.round(mo)} Mo</b>`
    $('#rBeforeV', b).textContent = be + ' s'; $('#rAfterV', b).textContent = af + ' s'; $('#rMergeV', b).textContent = m ? m + ' s' : 'jamais'
    // Deux kills à 6 s d'écart : un clip ou deux, selon le réglage
    const gap = 6
    $('#rdRes2', b).innerHTML = !m ? 'Chaque kill garde son propre clip.' : gap <= m ? `Deux kills à ${gap} s d’écart : <b>un seul clip de ${be + gap + af} s</b>` : `Deux kills à ${gap} s d’écart : <b>deux clips</b>`
    const rl = $('#rLimitV', b); if (rl) rl.textContent = `${c.limitGb} Go, environ ${fr(Math.round(c.limitGb * 1024 / mo))} clips`
  }

  /* Montage : pour l'instant, le moteur vidéo (FFmpeg, livré avec l'appli) et son essai sur ce PC. Les réglages des films viendront ici */
  let eng = null, engLoad = null, engErr = '', engRun = false, engStep = null
  // [nom dans une liste, nom dans une phrase]
  const ENC = {
    h264_nvenc: ['Carte NVIDIA', 'Ta carte NVIDIA'], h264_amf: ['Carte AMD', 'Ta carte AMD'], h264_qsv: ['Puce Intel', 'Ta puce Intel'],
    h264_mf: ['Encodeur de Windows', 'L’encodeur de Windows'], libopenh264: ['Sans carte graphique', 'Ton processeur'], demarrage: ['Démarrage du moteur', '']
  }
  const encName = (id) => ENC[id]?.[0] || id
  const stepText = (st) => `Essai ${st.index} sur ${st.total} : ${st.what === 'clip' ? 'ton dernier clip' : encName(st.what).toLowerCase()}`
  // Le temps qu'il faudrait pour une minute de film, d'après un essai de quelques secondes
  const perMinute = (seconds, sampleS) => { const x = Math.max(1, Math.round(seconds * 60 / sampleS)); return x < 60 ? `${x} s` : `${Math.floor(x / 60)} min${x % 60 ? ' ' + String(x % 60).padStart(2, '0') : ''}` }
  function loadEngine() {
    engLoad = API.editEngine().then((e) => { eng = e; engErr = ''; engRun = e.testing }, (e) => { engErr = errText(e) })
      .then(() => { paintNav(); if (!el.hidden && (sec === 'edit' || sec === 'about')) repaint() })
    return engLoad
  }
  async function testEngine() {
    if (engRun) return
    // Un jeu filmé en ce moment : l'essai attendra, il gênerait la partie
    if (Real.clipsLive?.status === 'recording') return toast('Un jeu tourne. Teste le moteur après ta partie.', { tone: 'warn', ms: 4000 })
    engRun = true; engStep = null; paintNav(); if (sec === 'edit') { repaint(); $('#eStop', el)?.focus({ preventScroll: true }) }
    let reload = false
    try { eng = await API.editEngineTest(); toast(`${ic('check')} Essai terminé`, { ms: 1800 }) }
    catch (e) { const m = errText(e), stopped = m === 'Essai arrêté.'; reload = !stopped; toast(esc(m), stopped ? { ms: 1800 } : { tone: 'warn', ms: 6000 }) }
    engRun = false; engStep = null
    // Un refus (moteur absent, modifié) a pu changer l'état : on le relit
    if (reload) await loadEngine(); else paintNav()
    if (!el.hidden && sec === 'edit') { repaint(); $('#eTest', el)?.focus({ preventScroll: true }) }
  }
  function pEdit(b, d) {
    if (!eng) {
      b.innerHTML = engErr
        ? `${d}<div class="empty"><h2>Le moteur vidéo n’a pas répondu</h2><p>${esc(engErr)}</p><button class="btn sm" id="eRetry">${ic('refresh')}Réessayer</button></div>`
        : `${d}${group('', row('r-eng', 'Moteur vidéo', '<span role="status">Vérification du moteur…</span>', ''))}`
      const r = $('#eRetry', b); if (r) r.onclick = () => { engErr = ''; repaint(); loadEngine() }
      return
    }
    if (eng.status !== 'ready') {
      const gone = eng.status === 'missing'
      b.innerHTML = `${d}<div class="empty" id="r-eng"><h2>${gone ? 'Le moteur vidéo manque' : 'Le moteur vidéo a été modifié'}</h2><p>${gone ? 'Son fichier n’est plus dans le dossier de Player X.' : 'Son fichier n’est plus celui de l’installation.'} Réinstalle Player X V3 Test pour le remettre : tes réglages et tes clips restent.</p></div>`
      return
    }
    const t = eng.test, when = t ? `${new Date(t.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}, ${String(new Date(t.at).getHours()).padStart(2, '0')} h ${String(new Date(t.at).getMinutes()).padStart(2, '0')}` : ''
    // Un essai où rien ne marche n'est pas « Prêt » : le fichier est là, mais il ne fabriquera rien tel quel
    const state = engRun ? (engStep ? stepText(engStep) : 'Essai en cours…') : !t ? 'Prêt. Il fabriquera le fichier de tes films.' : t.best ? `Prêt. Essai du ${when}.` : `Essai du ${when} : raté.`
    const ctrl = engRun ? '<button class="btn sm" id="eStop">Arrêter l’essai</button>' : `<button class="btn sm ${t ? '' : 'rose'}" id="eTest">${t ? 'Refaire l’essai' : 'Tester le moteur'}</button>`
    let res = ''
    if (t && !engRun) {
      const best = t.encoders.find((e) => e.id === t.best), clip = t.clip
      // Seul l'essai sur un vrai clip dit la vitesse : la mire de 5 s dit si un encodeur marche, pas combien de temps il met
      const speed = clip?.ok ? perMinute(clip.seconds, clip.sampleS) : ''
      const head = best ? `${esc(ENC[best.id]?.[1] || best.id)} fabriquera tes films` : t.encoders[0]?.id === 'demarrage' ? 'Le moteur ne démarre pas sur ce PC' : 'Aucun encodeur ne marche sur ce PC'
      const sub = !best ? 'Copie le résultat et envoie-le : il dit pourquoi.'
        : clip && !clip.ok ? '<em class="rc-err">Il n’a pas réussi à lire ton dernier clip.</em> Copie le résultat et envoie-le.'
        : speed ? `Une minute de film en ${speed} environ${best.id === 'libopenh264' ? ', sans carte graphique' : ''}.`
        : 'Pour connaître la vitesse, refais l’essai quand tu auras gardé un clip.'
      const line = (name, r, clipS) => row('', esc(name), '', `<span class="ed-v ${r.ok ? '' : 'no'}">${r.ok ? (clipS ? `${perMinute(r.seconds, clipS)} la minute` : 'marche') : clipS ? 'pas lu' : 'ne marche pas ici'}</span>`)
      const ok = t.encoders.filter((e) => e.ok).length
      res = `${group('Sur ce PC', row('r-engres', head, sub, '<button class="btn sm" id="eCopy">Copier le résultat</button>'))}
        ${more('edit', `${ok} sur ${t.encoders.length} ${ok > 1 ? 'marchent' : 'marche'}`, `<div class="ed-list">${t.encoders.map((e) => line(encName(e.id), e, 0)).join('')}${clip ? line('Ton dernier clip', clip, clip.sampleS) : ''}</div>`, 'Détail de l’essai')}`
    }
    b.innerHTML = `${d}${group('', row('r-eng', 'Moteur vidéo', `<span id="eSt" role="status">${state}</span>`, ctrl))}${res}`
    bindMore(b)
    const test = $('#eTest', b); if (test) test.onclick = testEngine
    const stop = $('#eStop', b); if (stop) stop.onclick = () => API.editEngineStop().catch(failed)
    const copy = $('#eCopy', b); if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(eng.report || ''); toast(`${ic('check')} Résultat copié`, { ms: 1800 }) } catch { toast('Le résultat n’a pas pu être copié. Réessaie dans un instant.', { tone: 'warn', ms: 3000 }) } }
  }

  /* Routines : une file « À suivre » */
  const NEW_RT = '__new'
  const rtPills = () => `<div class="rt-pick"><div class="pills" role="group" aria-label="Routine">${Object.entries(ROUTINES).map(([k, v]) => `<button class="pill" data-r="${esc(k)}" aria-pressed="${routine === k}">${esc(v.name)}</button>`).join('')}<button class="pill" id="rtNew" aria-label="Créer une routine" aria-pressed="${routine === NEW_RT}" data-tip="Créer une routine">${ic('plus')}</button></div></div>`
  function bindRtPills(b) {
    $$('[data-r]', b).forEach((x) => x.onclick = () => { routine = x.dataset.r; newFor = null; addKind = null; pRoutine(b) })
    const nw = $('#rtNew', b); if (!nw) return
    nw.onclick = () => { routine = NEW_RT; newFor = null; addKind = null; pRoutine(b); $('#rtN', b)?.focus({ preventScroll: true }) }
  }
  // Une routine, c'est un jeu (son lancement est déjà dedans) et, si tu veux, un nom : le reste s'ajoute après
  function pRoutineNew(b, d) {
    const list = GAMES.filter((g) => g.installed)
    if (!list.length) { b.innerHTML = `${d}<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucun jeu à lancer pour l’instant</h2><p>Une routine part avec un jeu installé sur ce PC.</p><button class="btn sm" id="rtScan">Chercher mes jeux</button></div>`; $('#rtScan', b).onclick = (e) => Pages.rescan(e.currentTarget); return }
    const first = newFor || list.find((g) => !g.routine)?.id || list[0].id
    const has = Object.keys(ROUTINES).length > 0
    // Sans routine, pas de rangée de pastilles : un « + » seul n'apprend rien
    b.innerHTML = `${d}${has ? rtPills() : ''}<section class="sg" id="r-rt"><h2>${has ? 'Nouvelle routine' : 'Ta première routine'}</h2><form class="sg-l rt-new" id="rtForm" novalidate>
      <div class="at-f"><label for="rtG">Jeu</label><select class="at-i at-sel" id="rtG">${list.map((g) => `<option value="${g.id}" ${g.id === first ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
      <div class="at-f"><label for="rtN">Nom <small>facultatif</small></label><input class="at-i" id="rtN" maxlength="32" autocomplete="off" spellcheck="false"><p class="at-err" id="rtE" role="alert" hidden></p></div>
      <p class="rt-w" id="rtW"></p>
      <div class="rt-a"><button type="submit" class="btn sm rose">${ic('plus')}Créer la routine</button>${has ? '<button type="button" class="btn sm" id="rtNo">Annuler</button>' : ''}</div>
    </form></section>`
    bindRtPills(b)
    const nm = $('#rtN', b), err = $('#rtE', b), sel = $('#rtG', b)
    const taken = (v) => Object.values(ROUTINES).some((r) => r.name.toLowerCase() === v.toLowerCase())
    // Sans nom, la routine prend celui du jeu (« Counter-Strike 2 », puis « Counter-Strike 2 (2) »)
    const auto = () => { const base = G(sel.value).name.slice(0, 27); let n = base, i = 2; while (taken(n)) n = `${base} (${i++})`; return n }
    const problem = () => { const v = nm.value.trim(); return v && taken(v) ? `« ${v} » existe déjà. Choisis un autre nom.` : '' }
    const show1 = (m) => { err.textContent = m; err.hidden = !m; if (m) { nm.setAttribute('aria-invalid', 'true'); nm.setAttribute('aria-describedby', 'rtE') } else { nm.removeAttribute('aria-invalid'); nm.removeAttribute('aria-describedby') } }
    let keepErr = false
    nm.onblur = () => show1(problem()); nm.onfocus = () => { if (!keepErr) show1('') }; nm.oninput = () => show1('')
    const warn = () => { const g = G(sel.value), cur = ROUTINES[g.routine]; nm.placeholder = auto(); $('#rtW', b).textContent = cur ? `« ${cur.name} » part déjà avec ${g.name} : elle passera au raccourci.` : '' }
    sel.onchange = warn; warn()
    $('#rtNo', b)?.addEventListener('click', () => { routine = Object.keys(ROUTINES)[0]; newFor = null; pRoutine(b) })
    $('#rtForm', b).onsubmit = (e) => {
      e.preventDefault()
      const m = problem()
      if (m) { show1(m); keepErr = true; nm.focus(); keepErr = false; return }
      const g = G(sel.value), id = `r${Date.now().toString(36)}`
      if (ROUTINES[g.routine]) ROUTINES[g.routine].trigger = 'hotkey'
      ROUTINES[id] = { id, name: nm.value.trim() || auto(), rid: g.rid, game: g.id, trigger: 'launch', steps: [Real.stepUi({ id: 'game', kind: 'game', on: true }, g)] }
      g.routine = id; routine = id; newFor = null
      // La suite logique : choisir sa première étape, le menu est déjà ouvert
      addKind = ''
      Real.saveRoutines(); pRoutine(b); Bar.syncGame(); saved()
      $('#rtMenu [data-add]', b)?.focus({ preventScroll: true })
    }
  }
  // Ce qu'il faut pour ajouter une étape : un seul champ à la fois, ou le sélecteur de fichiers de Windows
  // « discord://-/channels/… » donnait « - » : un salon et Steam se nomment, un site garde son domaine
  const linkName = (v) => (/^discord:/i.test(v) ? 'Salon Discord' : /^steam:/i.test(v) ? 'Steam' : v.replace(/^[a-z]+:\/\/(www\.)?/i, '').split(/[/?#]/)[0] || v)
  const ADD = {
    link: { t: 'Ouvrir un lien ou un salon', ic: 'link', label: 'Adresse', ph: 'https://, discord:// ou steam://', err: 'Colle une adresse https://, discord:// ou steam://, sans arguments de lancement.', ok: (v) => /^https:\/\/[^\s"'<>\\%]+$/i.test(v) || /^steam:\/\/[a-z]+(\/[^/\s"'<>\\%]+)*\/?$/i.test(v) || /^discord:\/\/[\w.-]+(\/[\w.-]+)*\/?$/i.test(v), make: (v) => ({ kind: 'link', value: v, name: linkName(v) }) },
    // « chrome » suffit : le .exe s'ajoute tout seul
    close: { t: 'Fermer une appli', ic: 'close', label: 'Programme', help: 'Fermé de force au bout de 2 secondes s’il ne répond pas.', ph: 'chrome.exe', err: 'Écris le nom du programme, par exemple chrome.exe.', ok: (v) => /^[\w .()-]{1,120}$/i.test(v), make: (v) => { const x = /\.exe$/i.test(v) ? v : `${v}.exe`; return { kind: 'close', value: x, name: x.replace(/\.exe$/i, ''), force: true } } },
    wait: { t: 'Attendre', ic: 'refresh', label: 'Secondes', ph: '5', err: 'Écris un nombre de secondes, de 1 à 120.', ok: (v) => /^\d{1,3}$/.test(v) && +v >= 1 && +v <= 120, make: (v) => ({ kind: 'wait', value: String(+v) }) }
  }
  // Un lien s'affiche avec son verbe, comme les autres étapes
  const stepT = (x) => (x.kind !== 'link' ? x.t : x.name === 'Salon Discord' ? 'Ouvrir un salon Discord' : `Ouvrir ${x.name || 'un lien'}`)
  function pRoutine(b, d = META.routine[1] ? `<p class="sh-d">${META.routine[1]}</p>` : '') {
    if (routine !== NEW_RT && !ROUTINES[routine]) routine = Object.keys(ROUTINES)[0] || NEW_RT
    if (newFor) routine = NEW_RT
    if (routine === NEW_RT) return pRoutineNew(b, d)
    const r = ROUTINES[routine], g = Real.byRid(r.rid)
    const add = addKind && ADD[addKind]
    b.innerHTML = `${d}${rtPills()}
      <section class="sg" id="r-rt"><div class="sg-l"><div class="rt-meta"><span class="rt-c" data-name="${esc(g?.name || '')}"><img src="${esc(A(g?.cover))}" alt=""></span><div><b>${esc(g?.name || 'Jeu introuvable sur ce PC')}</b>
        <label class="rt-trig" for="rtTrig">Se lance <select id="rtTrig"><option value="launch" ${r.trigger === 'launch' ? 'selected' : ''}>quand je lance le jeu</option><option value="hotkey" ${r.trigger === 'hotkey' ? 'selected' : ''}>avec un raccourci</option></select><span id="rtKey" class="rt-key"></span></label></div>
        ${g?.installed ? `<button class="btn sm" id="rtRun">${ic('play')}Lancer la routine</button>` : ''}</div>
      <ol class="rt" id="rtList">${r.steps.map((x) => { const t = stepT(x); return `<li class="rt-s ${x.on ? '' : 'off'}" data-id="${esc(x.id)}"><i class="rt-n"></i><button class="rt-d" aria-label="Déplacer l’étape ${esc(t)}" data-tip="Déplacer, flèches haut et bas" data-tip-l>${ic('drag')}</button><span class="rt-i">${ic(x.ic)}</span><span class="rt-t"><b>${esc(t)}</b></span>${x.fixed ? '<em>Toujours</em>' : `${sw('st' + x.id, x.on, t)}<button class="btn sm icon quiet rt-x" data-del="${esc(x.id)}" aria-label="Retirer l’étape ${esc(t)}" data-tip="Retirer l’étape" data-tip-r>${ic('close')}</button>`}</li>` }).join('')}</ol></div>
      <div class="rt-acts"><button class="btn sm rt-add" id="rtAdd" aria-expanded="${addKind !== null}" aria-controls="rtMenu">${ic('plus')}Ajouter une étape</button><button class="btn sm rt-del" id="rtDel">Supprimer la routine</button></div>
      <div class="rt-menu ${add ? 'rt-menu-f' : ''}" id="rtMenu" ${addKind === null ? 'hidden' : ''}>${add ? `<form class="rt-f2" id="rtAddF" novalidate><p class="rt-f2-t">${ic(add.ic)}${add.t}</p><div class="at-f"><label for="rtV">${add.label}</label><input class="at-i" id="rtV" placeholder="${esc(add.ph)}" autocomplete="off" spellcheck="false"><p class="at-err" id="rtVE" role="alert" hidden></p>${add.help ? `<p class="sf-h">${add.help}</p>` : ''}</div><div class="rt-f2-a"><button class="btn sm rose" type="submit">Ajouter l’étape</button><button class="btn sm" type="button" id="rtAddNo">Annuler</button></div></form>` : [['app', 'folder', 'Ouvrir une appli'], ['link', 'link', 'Ouvrir un lien ou un salon'], ['close', 'close', 'Fermer une appli'], ['wait', 'refresh', 'Attendre'], ['minimize', 'min', 'Réduire Player X']].map(([k, i, t]) => `<button data-add="${k}">${ic(i)}${t}</button>`).join('')}</div></section>`
    bindRtPills(b)
    API.routineHotkeys().then((m) => { const k = $('#rtKey', b); if (k && m[r.id]) k.innerHTML = keysOf(m[r.id].replace('Control', 'Ctrl')) }).catch(() => {})
    $('#rtDel', b).onclick = () => confirmDel({ title: `Supprimer la routine « ${esc(r.name)} » ?`, text: `${esc(g?.name || 'Le jeu')} se lancera directement, sans ces étapes.`, verb: 'Supprimer la routine', onOk: () => {
      const k = routine
      delete ROUTINES[k]; GAMES.forEach((x) => { if (x.routine === k) x.routine = null })
      routine = Object.keys(ROUTINES)[0] || NEW_RT
      Real.saveRoutines(); pRoutine(b); Bar.syncGame(); saved()
    } })
    r.steps.forEach((x) => { if (!x.fixed) ON('st' + x.id, (v) => { x.on = v; $(`.rt-s[data-id="${x.id}"]`, b).classList.toggle('off', !v); Real.saveRoutines(); Bar.syncGame(); saved() }) })
    $$('[data-del]', b).forEach((x) => x.onclick = () => { r.steps.splice(r.steps.findIndex((y) => y.id === x.dataset.del), 1); Real.saveRoutines(); pRoutine(b); Bar.syncGame(); saved(); $('#rtAdd', b).focus({ preventScroll: true }) })
    $('#rtAdd', b).onclick = () => { addKind = addKind === null ? '' : null; pRoutine(b); $('#rtAdd', b).focus({ preventScroll: true }) }
    // L'étape arrive juste avant le lancement du jeu : c'est là qu'on la veut presque toujours
    const push = (step) => {
      const at = r.steps.findIndex((y) => y.kind === 'game')
      r.steps.splice(at < 0 ? r.steps.length : at, 0, Real.stepUi({ id: 's' + Date.now().toString(36), on: true, ...step }, g))
      addKind = null; Real.saveRoutines(); pRoutine(b); Bar.syncGame(); saved(); $('#rtAdd', b).focus({ preventScroll: true })
    }
    $$('[data-add]', b).forEach((x) => x.onclick = async () => {
      const k = x.dataset.add
      if (k === 'minimize') return push({ kind: 'minimize' })
      if (k === 'app') { const f = await API.chooseRoutineApp().catch((e) => { failed(e); return null }); if (f) push({ kind: 'app', value: f.path, name: f.name }); return }
      addKind = k; pRoutine(b); $('#rtV', b).focus({ preventScroll: true })
    })
    if (add) {
      const i = $('#rtV', b), e0 = $('#rtVE', b)
      if (addKind === 'wait') i.value = '5'
      const show1 = (m) => { e0.textContent = m; e0.hidden = !m; if (m) { i.setAttribute('aria-invalid', 'true'); i.setAttribute('aria-describedby', 'rtVE') } else { i.removeAttribute('aria-invalid'); i.removeAttribute('aria-describedby') } }
      let gone = false
      i.onblur = () => { if (!gone && i.value.trim() && !add.ok(i.value.trim())) show1(add.err) }
      i.onfocus = i.oninput = () => show1('')
      $('#rtAddNo', b).onpointerdown = () => { gone = true }
      $('#rtAddNo', b).onclick = () => { addKind = null; pRoutine(b); $('#rtAdd', b).focus({ preventScroll: true }) }
      $('#rtAddF', b).onsubmit = (e) => { e.preventDefault(); const v = i.value.trim(); if (!add.ok(v)) { show1(add.err); i.focus(); show1(add.err); return } push(add.make(v)) }
    }
    $('#rtTrig', b).onchange = (e) => { r.trigger = e.target.value; Real.saveRoutinesNow().then(() => { saved(); pRoutine(b) }); Bar.syncGame() }
    $('#rtRun', b)?.addEventListener('click', () => { close(true); Views.show('play'); setTimeout(() => { Play.focusGame(g.id); setTimeout(() => Live.launch(g.id, { routine: r.id }), 200) }, 300) })
    drag(r, b)
  }
  function drag(r, b) {
    const list = $('#rtList', b)
    $$('.rt-d', list).forEach((d) => {
      d.onpointerdown = (e) => {
        e.preventDefault(); const li = d.closest('.rt-s'); const items = $$('.rt-s', list); const from = items.indexOf(li); const H = li.offsetHeight
        const y0 = e.clientY; let to = from
        const zoomK = list.getBoundingClientRect().height / list.offsetHeight || 1
        li.classList.add('drag'); d.setPointerCapture(e.pointerId)
        d.onpointermove = (ev) => {
          const dy = (ev.clientY - y0) / zoomK; li.style.transform = `translateY(${dy}px)`
          to = clamp(from + Math.round(dy / H), 0, items.length - 1)
          items.forEach((o, i) => { if (o === li) return; let t = 0; if (from < to && i > from && i <= to) t = -H; if (from > to && i < from && i >= to) t = H; o.style.transform = t ? `translateY(${t}px)` : '' })
        }
        d.onpointerup = () => {
          d.onpointermove = d.onpointerup = null
          const [m] = r.steps.splice(from, 1); r.steps.splice(to, 0, m)
          if (to !== from) { Real.saveRoutines(); saved() }
          pRoutine(b); Bar.syncGame()
        }
      }
      d.onkeydown = (e) => {
        const li = d.closest('.rt-s'), i = r.steps.findIndex((x) => x.id === li.dataset.id), j = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1
        if (j < 0 || j >= r.steps.length) return
        e.preventDefault();[r.steps[j], r.steps[i]] = [r.steps[i], r.steps[j]]
        Real.saveRoutines(); pRoutine(b); Bar.syncGame(); saved(); $$('.rt-d', $('#rtList', b))[j].focus()
      }
    })
  }

  /* Overlay */
  function pOverlay(b, d) {
    const v = s().cs2Overlay, on = v !== 'off'
    b.innerHTML = `${d}
      <section class="sg" id="r-ovcs"><div class="sg-l"><div class="ovc"><div class="ovc-img"><img src="${esc(A('cs_dust2'))}" alt=""></div>
        <div class="ovc-t"><div class="ovc-h"><h2>Counter-Strike 2</h2>${sw('oOn', on, 'Overlay de Counter-Strike 2')}</div>${on ? `${seg('Style de l’overlay', [['b', 'Verre'], ['a', 'Apple'], ['c', 'Player X']], v)}<button class="btn sm rc-prev" id="oPrev" data-tip="Quelques secondes, avec des chiffres d’exemple">${ic('play')}Voir l’aperçu</button>` : '<p>Coupé</p>'}</div></div>
        ${on ? row('r-ovkey', 'Masquer ou afficher en jeu', noSub, kcap('overlay')) : ''}</div></section>`
    ON('oOn', (x) => save({ cs2Overlay: x ? (pOverlay.last || 'b') : 'off' }).then(() => pOverlay(b, d)))
    if (on) { bindSeg($('.seg', b), (x) => { pOverlay.last = x; save({ cs2Overlay: x }) }); $('#oPrev', b).onclick = () => API.cs2OverlayPreview().catch(failed); markNoSub(b); bindKc(b) }
  }

  /* Comptes */
  const PRIVACY = 'https://steamcommunity.com/my/edit/settings', STEAM_KEY = 'https://steamcommunity.com/dev/apikey', NPSSO = 'https://ca.account.sony.com/api/v1/ssocookie', REDIRECT = 'http://127.0.0.1:47823/discord/callback'
  let pendingLogin = null
  const did = (v) => (/^\d{15,22}$/.test(v) ? null : 'Un identifiant Discord ne contient que des chiffres (17 à 20 en général).')
  async function pickPhoto(file) {
    if (!/^image\/(png|jpeg|webp|gif|bmp|avif)$/.test(file.type)) throw new Error('Choisis une image : PNG, JPEG, WebP ou GIF.')
    const bmp = await createImageBitmap(file), side = Math.min(bmp.width, bmp.height), c = document.createElement('canvas')
    c.width = c.height = 256
    c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256)
    const out = c.toDataURL('image/webp', .86)
    return out.startsWith('data:image/webp') ? out : c.toDataURL('image/jpeg', .88)
  }

  // Un réglage dont le service a besoin s'affiche tout de suite ; sinon il se replie sous son nom.
  // Ce que tu as ouvert ou fermé toi-même reste ainsi d'un repaint à l'autre.
  const accOpen = {}
  // Player X (la version GitHub) installé sur ce PC avec des connexions : undefined = pas encore regardé
  let pxConn
  // PlayStation : connexion en cours, et la dernière erreur (affichée sur la ligne, pas seulement dans un message qui part)
  let psnBusy = false, psnErr = ''
  const accMore = (id, label, inner, need, keep) => (need && !keep ? `<div class="sb ac-need">${inner}</div>` : `<details class="ac-more" data-more="${id}" ${accOpen[id] ?? need ? 'open' : ''}><summary>${ic('chevd')}<span>${label}</span></summary><div class="ac-more-b">${inner}</div></details>`)
  function pAccounts(b, d) {
    const accs = Real.st.accounts, acc = (p) => accs.find((a) => a.platform === p), errs = Real.st.friendsRes?.errors || {}, me = Real.me(), S0 = s()
    const count = (p) => (Real.st.friendsRes?.friends || []).filter((f) => f.platform === p).length
    const plural = Shared.text.plural
    const dot = (t) => `<span class="ac-d ${t}"></span>`
    // Un service, une ligne : son état d'un coup d'œil et une seule action
    const line = (id, name, sub, tone, btn) => `<div class="sr" id="${id}">${dot(tone)}<div class="sr-t"><b>${esc(name)}</b><span class="${tone === 'err' ? 'err' : ''}">${sub}</span></div>${btn ? `<div class="sr-c">${btn}</div>` : ''}</div>`
    const tone = (p, on) => (errs[p] && on ? 'err' : on ? 'ok' : '')
    const pend = (p) => pendingLogin === p
    const WAIT = 'Termine la connexion dans ton navigateur…'
    const btn = (n, attr, label, rose) => `<button class="btn sm ${rose ? 'rose' : ''}" ${attr} aria-label="${label} ${n}">${label}</button>`
    const cancel = (n) => btn(n, 'data-cancel', 'Annuler', false)
    const out = (p, n) => btn(n, `data-out="${p}"`, 'Déconnecter', false)
    const link = (href, t) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${t}</a>`
    const amis = (p) => plural(count(p), 'ami', 'amis')

    const steam = acc('steam'), sKey = !!S0.steamApiKey
    const steamSub = pend('steam') ? WAIT : errs.steam ? esc(errs.steam) : !steam ? 'Tes amis, tes succès, tes jeux' : !sKey ? `Connecté : ${esc(steam.name)}. Ajoute ta clé pour voir tes amis` : `Connecté : ${esc(steam.name)}, ${amis('steam')}`
    const disc = acc('discord'), guild = !!S0.discordGuildId, hasApp = S0.discordClientId && S0.discordClientSecret, halfApp = !hasApp && (S0.discordClientId || S0.discordClientSecret)
    const discSub = pend('discord') ? WAIT : errs.discord ? esc(errs.discord) : guild ? plural(count('discord'), 'membre en ligne', 'membres en ligne') + (disc ? `, connecté : ${esc(disc.name)}` : '') : disc ? `Connecté : ${esc(disc.name)}. Ajoute ton serveur pour voir ses membres` : 'Le vocal et les membres de ton serveur'
    const psn = acc('psn'), tok = !!S0.psnNpsso
    const psnSub = psnBusy ? 'Connexion à PlayStation…' : psnErr ? esc(psnErr) : errs.psn ? esc(errs.psn) : psn ? `Connecté : ${esc(psn.name)}, ${amis('psn')}` : tok ? 'Jeton enregistré : tu peux connecter' : 'Tes amis PlayStation'
    const bf = Real.st.tracked?.me
    const rep = (st0) => (Real.st.report || []).find((r) => r.store === st0)
    const stErr = ['epic', 'ea', 'gog'].map((k) => rep(k)?.error).find(Boolean)
    const found = (rep('epic')?.found || 0) + (rep('ea')?.found || 0) + (rep('gog')?.found || 0)
    const hidden = Real.st.friendsRes?.hidden || []
    if (pxConn === undefined) { pxConn = null; API.playerXConnections?.().then((v) => { pxConn = v; if (v && !el.hidden && sec === 'accounts') repaint() }).catch(() => {}) }
    const missing = !disc || !guild || !hasApp || !steam || !sKey || (!psn && !tok)
    const pxRow = pxConn && missing ? group('', line('r-px', 'Reprendre de Player X', 'Ton serveur Discord, ta clé Steam et tes comptes, sans rien retaper', '', '<button class="btn sm rose" id="pxImp">Reprendre mes connexions</button>')) : ''
    b.innerHTML = `${d}
      ${group('', `<div class="sr" id="r-me"><span class="ac-av" id="acAv">${me.avatar ? `<img src="${esc(me.avatar)}" alt="">` : `<span class="av me" style="--h:338;width:44px;height:44px;font-size:18px">${esc(me.name[0].toUpperCase())}</span>`}</span><div class="sr-t"><div class="cell-edit" id="meCell"><button type="button" class="cell-display" id="meName" aria-label="Changer ton pseudo : ${esc(me.name)}"><b>${esc(me.name)}</b>${ic('edit', 'cell-ic')}</button><input class="cell-input" id="meInput" hidden maxlength="${Shared.profile.PROFILE_NAME_MAX}" value="${esc(s().profileName || me.name)}" aria-label="Ton pseudo dans Player X" autocomplete="off" spellcheck="false"></div><span>Ton profil dans Player X</span></div><div class="sr-c"><label class="btn sm" for="mePhoto">Changer la photo</label><input id="mePhoto" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>${S0.profileAvatar ? '<button class="btn sm" id="meNoPhoto">Retirer la photo</button>' : ''}</div></div>`)}
      ${pxRow}
      ${group('', `${line('r-steam', 'Steam', steamSub, tone('steam', steam), pend('steam') ? cancel('Steam') : steam ? out('steam', 'Steam') : btn('Steam', 'data-in="steam"', 'Connecter', !pxRow))}
        ${accMore('steam', 'Clé Steam Web API', field('fSteamKey', 'Clé Steam Web API', S0.steamApiKey, { secret: true, placeholder: '32 caractères', help: `Gratuite. Ta liste d’amis Steam doit être publique. ${link(STEAM_KEY, 'Obtenir ma clé')}${errs.steam ? ` ou ${link(PRIVACY, 'ouvrir ma confidentialité Steam')}` : ''}` }), (steam && !sKey) || !!errs.steam)}`)}
      ${group('', `${line('r-discord', 'Discord', discSub, tone('discord', disc || guild), pend('discord') ? cancel('Discord') : disc ? out('discord', 'Discord') : hasApp ? btn('Discord', 'data-in="discord"', 'Connecter', true) : '')}
        ${accMore('dcSrv', hidden.length ? `Serveur et membres masqués (${hidden.length})` : 'Serveur', `${field('fGuild', 'ID du serveur', S0.discordGuildId, { placeholder: '17 à 20 chiffres', help: 'Dans ton serveur : Paramètres, Widget. Active le widget, puis copie l’ID du serveur.' })}${hidden.length ? `<div class="ac-hid"><p class="at-k">Membres masqués</p>${hidden.map((x) => `<div class="ac-hid-r">${avatar(x.name, 32)}<div class="sr-t"><b>${esc(x.name)}</b><span>${x.reason === 'bot' ? 'Bot connu' : 'Masqué par toi'}${x.online ? ', en ligne' : ''}</span></div><button class="btn sm" data-show="${esc(x.name)}" aria-label="Afficher ${esc(x.name)}">Afficher</button></div>`).join('')}</div>` : ''}`, !guild)}
        ${accMore('dcApp', 'Réglages avancés : relier ton compte', `<div class="sf-grid">${field('fDcId', 'Client ID de ton application', S0.discordClientId, { placeholder: '17 à 20 chiffres' })}${field('fDcSecret', 'Client Secret', S0.discordClientSecret, { secret: true })}<div class="at-f ac-wide"><span class="at-k">Redirection à ajouter à ton application</span><div class="sf-code"><code>${REDIRECT}</code><button class="btn sm" id="dcCopy">${ic('copy')}Copier l’adresse</button></div></div></div>`, !!halfApp, true)}`)}
      ${group('', `${line('r-psn', 'PlayStation', psnSub, psnErr && !psnBusy ? 'err' : tone('psn', psn), psn ? out('psn', 'PlayStation') : tok ? (psnBusy ? '<button class="btn sm rose" disabled aria-busy="true">Connexion…</button>' : btn('PlayStation', 'data-psn', psnErr ? 'Réessayer' : 'Connecter', true)) : '')}
        ${accMore('psn', 'Jeton NPSSO', field('fNpsso', 'Jeton NPSSO', S0.psnNpsso, { secret: true, placeholder: '64 caractères', help: `Garde-le comme un mot de passe. Connecte-toi sur playstation.com, ${link(NPSSO, 'ouvre cette page')} et copie la valeur « npsso ». Service non officiel de Sony.` }), !psn && !tok)}`)}
      ${group('', `${line('r-bf6', 'Battlefield 6', bf ? `Relié : ${esc(bf.name)}` : 'Tes stats et le classement', bf ? 'ok' : '', bf ? '<button class="btn sm" id="bfOut" aria-label="Délier le profil Battlefield 6">Délier</button>' : '')}${bf ? '' : '<div class="sb" id="bfSearch"></div>'}`)}
      ${group('', line('r-epic', 'Epic Games, EA app et GOG', stErr ? esc(stErr) : found ? `Rien à relier, ${plural(found, 'jeu trouvé', 'jeux trouvés')} sur ce PC` : 'Rien à relier : Player X lit les jeux installés', stErr ? 'err' : found ? 'ok' : '', ''))}`
    $$('[data-more]', b).forEach((x) => { $('summary', x).onclick = () => { accOpen[x.dataset.more] = !x.open } })
    const after = async () => { await Real.refreshAccounts(); await Real.loadFriends(); Real.loadGames(true).catch(() => {}); repaint() }
    $$('[data-in]', b).forEach((x) => x.onclick = async () => {
      const p = x.dataset.in; pendingLogin = p; repaint()
      try { await API.login(p); pendingLogin = null; await after(); toast(`${ic('check')} ${p === 'steam' ? 'Steam' : 'Discord'} connecté`, { ms: 2000 }) } catch (e) { pendingLogin = null; repaint(); if (!/annul/i.test(String(e?.message))) failed(e) }
    })
    $$('[data-cancel]', b).forEach((x) => x.onclick = () => API.cancelLogin().catch(() => {}))
    $('#pxImp', b)?.addEventListener('click', async (e) => {
      const x = e.currentTarget; x.setAttribute('aria-busy', 'true')
      try { const got = await API.importPlayerXConnections(); await Real.loadSettingsOnly(); await after(); toast(`${ic('check')} Repris de Player X : ${esc(got.join(', '))}`, { ms: 3000 }) } catch (err) { x.removeAttribute('aria-busy'); failed(err) }
    })
    $('[data-psn]', b)?.addEventListener('click', async () => {
      psnBusy = true; psnErr = ''; repaint()
      try { await API.connectPsn(); psnBusy = false; await after(); toast(`${ic('check')} PlayStation connecté`, { ms: 2000 }) } catch (x) { psnBusy = false; psnErr = errText(x); failed(x); repaint() }
    })
    const OUT = { steam: ['Steam', 'Tes amis Steam n’apparaîtront plus dans Player X. Tu pourras te reconnecter à tout moment.'], discord: ['Discord', 'Ton compte Discord sera retiré de Player X. Les membres du serveur restent affichés tant que l’ID du serveur est renseigné.'], psn: ['PlayStation', 'Tes amis PlayStation n’apparaîtront plus dans Player X, et ton jeton NPSSO sera effacé.'] }
    $$('[data-out]', b).forEach((x) => x.onclick = () => { const [n, t] = OUT[x.dataset.out]; confirmDel({ title: `Déconnecter ${n} ?`, text: t, verb: `Déconnecter ${n}`, onOk: async () => { try { await API.logout(x.dataset.out); await Real.loadSettingsOnly(); await after(); toast(`${n} déconnecté`, { ms: 2000 }) } catch (e) { failed(e) } } }) })
    const put = (k, ok) => async (v) => { await Real.saveSettings({ [k]: v }); saved(); toast(`${ic('check')} ${ok}`, { ms: 1800 }); await Real.loadFriends(); Real.loadGames(true).catch(() => {}); repaint() }
    bindField(b, 'fSteamKey', { validate: (v) => (/^[0-9a-f]{32}$/i.test(v) ? null : 'Une clé Steam Web API fait 32 caractères, chiffres et lettres de A à F.'), onSave: put('steamApiKey', 'Clé Steam enregistrée') })
    bindField(b, 'fGuild', { validate: (v) => did(Shared.text.discordGuildIdFrom(v)), onSave: async (v) => put('discordGuildId', 'Serveur enregistré')(v ? Shared.text.discordGuildIdFrom(v) : '') })
    bindField(b, 'fDcId', { validate: did, onSave: put('discordClientId', 'Client ID enregistré') })
    bindField(b, 'fDcSecret', { onSave: put('discordClientSecret', 'Client Secret enregistré') })
    bindField(b, 'fNpsso', { onSave: (v) => { psnErr = ''; return put('psnNpsso', 'Jeton enregistré')(v) } })
    $('#dcCopy', b).onclick = async () => { try { await navigator.clipboard.writeText(REDIRECT); toast(`${ic('check')} Adresse copiée`, { ms: 1800 }) } catch { toast('L’adresse n’a pas pu être copiée.', { tone: 'warn', ms: 3000 }) } }
    $$('[data-show]', b).forEach((x) => x.onclick = async () => { Real.applyFriends(await API.setMemberHidden(x.dataset.show, false)); repaint(); toast(`${esc(x.dataset.show)} s’affiche de nouveau`, { ms: 2000 }) })
    // Le pseudo se change sur place : rien ne bouge autour
    const disp = $('#meName', b), inp = $('#meInput', b)
    const edit = (on) => { disp.style.visibility = on ? 'hidden' : ''; inp.hidden = !on; if (on) { inp.focus(); inp.select() } else disp.focus({ preventScroll: true }) }
    disp.onclick = () => edit(true)
    inp.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); inp.value = s().profileName || me.name; edit(false) } else if (e.key === 'Enter') { e.preventDefault(); inp.blur() } }
    inp.onblur = async () => { const v = Shared.profile.cleanProfileName(inp.value); await save({ profileName: v }); $('b', disp).textContent = Real.me().name; disp.setAttribute('aria-label', `Changer ton pseudo : ${Real.me().name}`); disp.style.visibility = ''; inp.hidden = true }
    $('#mePhoto', b).onchange = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await save({ profileAvatar: await pickPhoto(f) }); repaint() } catch (x) { failed(x) } }
    $('#meNoPhoto', b)?.addEventListener('click', async () => { await save({ profileAvatar: '' }); repaint() })
    // Profil Battlefield 6 : « Reprendre ce profil » (import-px.js) passe avant la recherche par pseudo
    if (Real.st.tracked === undefined) API.bf6GetTracked().then((t) => { Real.st.tracked = t; if (sec === 'accounts') repaint() }).catch(() => {})
    $('#bfOut', b)?.addEventListener('click', () => confirmDel({ title: `Délier le profil « ${esc(Real.st.tracked.me.name)} » ?`, text: 'Tes stats ne s’afficheront plus jusqu’à ce que tu relies un profil. Tes joueurs suivis et tes loadouts restent.', verb: 'Délier le profil', onOk: async () => { Real.st.tracked = await API.bf6SetTracked({ me: null, rivals: Real.st.tracked.rivals }); repaint() } }))
    const box = $('#bfSearch', b)
    if (box) PlayerSearch.mount(box, { action: 'C’est moi', importPx: true, exclude: [], onPick: async (a) => { Real.st.tracked = await API.bf6SetTracked({ me: a, rivals: Real.st.tracked?.rivals || [] }); saved(); repaint() } })
  }

  /* Bibliothèque */
  function pLibrary(b, d) {
    const hid = GAMES.filter((g) => g.hidden), C = Pages.cols(), rep = Real.st.report || [], plural = Shared.text.plural
    const stores = { steam: 'Steam', epic: 'Epic Games', ea: 'EA app', gog: 'GOG' }
    // La dernière recherche tient sur une ligne, sous son bouton
    const last = rep.map((r) => `${stores[r.store] || r.store} : ${r.error ? esc(r.error) : r.found ? plural(r.found, 'jeu', 'jeux') : r.absent ? 'pas installé' : 'aucun jeu'}`).join(', ')
    b.innerHTML = `${d}${group('', row('r-news', 'Actus des jeux', 'Patchs et événements dans la fiche d’un jeu', sw('lNews', s().gameNews, 'Actus des jeux')))}
      ${group('', `${row('r-scan', 'Chercher mes jeux', `<span class="${rep.some((r) => r.error) ? 'err' : ''}">${last || 'Steam, Epic Games, EA app et GOG'}</span>`, '<button class="btn sm" id="lScan">Relancer la recherche</button>')}${row('r-col', 'Collections', C.length ? plural(C.length, 'collection', 'collections') : 'Aucune pour l’instant', '<button class="btn sm" id="lCol">Ouvrir la bibliothèque</button>')}`)}
      ${group(hid.length ? `Jeux masqués (${hid.length})` : 'Jeux masqués', hid.length ? hid.map((g, i) => `<div class="sr" ${i ? '' : 'id="r-hid"'}><span class="rt-c" data-name="${esc(g.name)}"><img src="${esc(A(g.cover))}" alt="" loading="lazy" decoding="async"></span><div class="sr-t"><b>${esc(g.name)}</b></div><div class="sr-c"><button class="btn sm" data-hid="${esc(g.rid)}" aria-label="Réafficher ${esc(g.name)}">Réafficher</button></div></div>`).join('') : row('r-hid', 'Aucun jeu masqué', 'Dans la fiche d’un jeu : Ranger, puis Masquer ce jeu'))}`
    ON('lNews', (v) => save({ gameNews: v }))
    $('#lCol', b).onclick = () => { close(); S.libFilter = 'all'; go('lib') }
    $('#lScan', b).onclick = async (e) => { await Pages.rescan(e.currentTarget); repaint() }
    $$('[data-hid]', b).forEach((x) => x.onclick = async () => { await Real.setHidden(x.dataset.hid, false); saved(); repaint() })
  }

  /* Général */
  const fondThumb = (k) => {
    if (k === 'fluide') return ''
    if (k !== 'mur') return `--im:url('${A('bf_redsec')}')`
    const c = GAMES.map((g) => A(g.cover)); if (!c.length) return ''
    const at = [[0, 0], [33.33, 0], [66.66, 0], [100, 0], [0, 100], [33.33, 100], [66.66, 100], [100, 100]]
    return `background:${at.map(([x, y], i) => `url("${c[(i * 3) % c.length]}") ${x}% ${y}%/25% auto no-repeat`).join(',')},#0b0810`
  }
  // Ce que fait chaque fond : dans l'infobulle de sa vignette, plus sous la grille
  const fondHelp = (k) => Fluid.modes.find((m) => m.k === k)?.d || ''
  function pGeneral(b, d) {
    const v = s(), live = v.cs2Live !== false
    b.innerHTML = `${d}
      <section class="sg" id="r-fond"><h2>Fond de l’accueil</h2><div class="sg-l"><div class="sb"><div class="fd" role="group" aria-label="Fond de l’accueil">${Fluid.modes.map((m) => `<button class="fd-b" data-fond="${m.k}" aria-pressed="${m.k === Fluid.current()}" data-tip="${esc(fondHelp(m.k))}"><i class="fd-p fd-${m.k}" style="${esc(fondThumb(m.k))}" aria-hidden="true"></i><b>${m.t}</b></button>`).join('')}</div></div>
        ${row('r-motion', 'Fond qui suit la souris', '', sw('iFluid', fluidOn(), 'Fond qui suit la souris'))}
        ${row('r-gstyle', 'Boutons au style du jeu', 'Couleur et lettrage tirés de la jaquette et des tags Steam', sw('iGStyle', GameStyle.on(), 'Boutons au style du jeu'))}</div></section>
      ${group('Alertes', `${row('r-fr', 'Amis Steam et PlayStation', '', `<select class="sel" id="iFr" aria-label="Alertes d’amis Steam et PlayStation"><option value="all" ${v.friendAlerts === 'all' ? 'selected' : ''}>Quand ils se connectent ou jouent</option><option value="games" ${v.friendAlerts === 'games' ? 'selected' : ''}>Quand ils lancent un jeu</option><option value="off" ${v.friendAlerts === 'off' ? 'selected' : ''}>Jamais</option></select><button class="btn sm" id="iFrT" data-tip="Envoie une alerte d’exemple">Essayer</button>`)}
        ${row('r-ready', 'Jeu prêt après une mise à jour Steam', '', sw('iReady', v.gameReadyAlert, 'Jeu prêt après une mise à jour Steam'))}`)}
      ${group('Matchs', `${row('r-live', 'Suivre mes matchs de Counter-Strike 2', 'Score en direct, bilan et clips automatiques', sw('iLive', v.cs2Live, 'Suivre mes matchs de Counter-Strike 2'))}
        ${row('r-cs2open', 'Ouvrir le bilan à la fin du match', '<span id="iOpenS"></span>', sw('iOpen', v.cs2RecapOpen, 'Ouvrir le bilan de Counter-Strike 2 à la fin du match'))}
        ${row('r-bfrecap', 'Bilan après chaque session de Battlefield 6', '', sw('iBf', v.bf6Recap, 'Bilan après chaque session de Battlefield 6'))}`)}
      ${more('general', 'Fenêtre et démarrage', `${row('r-win', 'Démarrer avec Windows', '<span id="iWinS"></span>', sw('iWin', v.startWithWindows, 'Démarrer avec Windows'))}
        ${row('r-tray', 'Quand je ferme la fenêtre', '', seg('Quand je ferme la fenêtre', [['tray', 'Rester en arrière-plan'], ['quit', 'Quitter']], v.closeToTray ? 'tray' : 'quit'))}
        ${row('r-launch', 'Quand un jeu démarre', '', seg('Quand un jeu démarre', [['minimize', 'Se réduire'], ['stay', 'Rester ouvert']], v.launchWindow))}`)}`
    // Le bilan de CS2 vient du suivi des matchs : sans lui, il n'y a rien à ouvrir
    const openRow = () => { const on = s().cs2Live !== false, r = $('#r-cs2open', b); r.classList.toggle('rc-dim', !on); r.toggleAttribute('inert', !on); $('#iOpenS', b).textContent = on ? (s().cs2RecapOpen ? '' : 'Sinon, une notification') : 'Demande le suivi des matchs' }
    openRow()
    $$('[data-fond]', b).forEach((x) => x.onclick = () => { Fluid.mode(x.dataset.fond); $$('[data-fond]', b).forEach((y) => y.setAttribute('aria-pressed', y === x)); saved() })
    ON('iGStyle', (x) => { GameStyle.set(x); saved() })
    ON('iFluid', (x) => { try { localStorage.setItem(FLUID, x ? '0' : '1') } catch { /* gardé pour cette session */ } Fluid.freeze(!x); saved() })
    ON('iWin', (x) => save({ startWithWindows: x }).then(startup)); ON('iReady', (x) => save({ gameReadyAlert: x })); ON('iBf', (x) => save({ bf6Recap: x }))
    ON('iLive', (x) => save({ cs2Live: x }).then(openRow)); ON('iOpen', (x) => save({ cs2RecapOpen: x }).then(openRow))
    bindSeg($('#r-tray .seg', b), (x) => save({ closeToTray: x === 'tray' })); bindSeg($('#r-launch .seg', b), (x) => save({ launchWindow: x }))
    $('#iFr', b).onchange = (e) => save({ friendAlerts: e.target.value })
    $('#iFrT', b).onclick = () => API.testFriendAlert().catch(failed)
    bindMore(b)
    function startup() {
      API.getStartupState().then((st) => {
        const t = $('#iWinS', b), sw0 = $('#iWin', b); if (!t) return
        if (st === 'blocked') { t.textContent = 'Bloqué par Windows : réactive Player X dans le Gestionnaire des tâches, onglet Applications de démarrage'; t.classList.add('err') } else if (st === 'unavailable') { t.textContent = 'Disponible avec Player X installé sur Windows'; sw0.hidden = true }
      }).catch(() => {})
    }
    startup()
  }

  /* Raccourcis : deux se changent, les autres sont fixes */
  const KEYNAME = { clip: 'Clipper à la main', overlay: 'Masquer l’overlay', search: 'Tout rechercher', find: 'Chercher un réglage', settings: 'Ouvrir les paramètres', rt: 'Lancer une routine' }
  const accelOf = (k) => (k === 'clip' ? Real.clipsCfg?.hotkey : s().overlayHotkey)
  const kcap = (k) => `<button class="kc" data-key="${k}" aria-label="${KEYNAME[k]} : ${esc(Shared.hotkey.hotkeyText(accelOf(k)))}. Changer le raccourci" data-tip="Changer le raccourci" data-tip-r>${keysOf(accelOf(k))}</button>`
  // Un raccourci se change là où il s'affiche : ici, dans Enregistrement et dans Overlay
  function bindKc(b) {
    $$('.kc[data-key]', b).forEach((x) => x.onclick = () => {
      waiting = x.dataset.key; $$('.kc', b).forEach((y) => y.classList.remove('wait')); x.classList.add('wait'); x.innerHTML = 'Appuie sur les touches'
      helpOf(x)
    })
  }
  function pKeys(b, d) {
    const fixed = (k) => `<span class="kc-f">${kbds(k)}</span>`
    b.innerHTML = `${d}
      ${group('En jeu', `${Real.clipsCfg ? row('k-clip', KEYNAME.clip, noSub, kcap('clip')) : ''}${row('k-overlay', KEYNAME.overlay, noSub, kcap('overlay'))}${row('k-rt', KEYNAME.rt, '', fixed(['Ctrl', 'Alt', 'F1 à F3']))}`)}
      ${group('Dans Player X', `${row('k-search', KEYNAME.search, '', fixed(FIXED.search))}${row('k-find', KEYNAME.find, '', fixed(FIXED.find))}${row('k-set', KEYNAME.settings, '', fixed(FIXED.settings))}`)}`
    markNoSub(b); bindKc(b)
  }
  function helpOf(x, msg) {
    const r = x.closest('.sr'), t = $('.sr-t span', r)
    if (!t.dataset.h) t.dataset.h = t.textContent
    t.textContent = msg || t.dataset.h; t.classList.toggle('err', !!msg)
  }
  async function captureKey(e) {
    if (!waiting || el.hidden) return
    e.preventDefault(); e.stopPropagation()
    const btn = $(`.kc[data-key=${waiting}]`, el), key = waiting, stop = () => { waiting = null; btn.classList.remove('wait'); btn.innerHTML = keysOf(accelOf(key)); btn.setAttribute('aria-label', `${KEYNAME[key]} : ${Shared.hotkey.hotkeyText(accelOf(key))}. Changer le raccourci`); btn.focus() }
    if (e.key === 'Escape') { helpOf(btn); stop(); return }
    const got = Shared.hotkey.hotkeyFromPress(e)
    if (!got) return
    if (got.problem) { helpOf(btn, got.problem); return }
    const other = key === 'clip' ? s().overlayHotkey : Real.clipsCfg?.hotkey
    if (other === got.accel) { helpOf(btn, `Déjà pris par « ${KEYNAME[key === 'clip' ? 'overlay' : 'clip']} ». Essaie une autre touche.`); return }
    const busy = await API.cs2OverlayHotkeyCheck(got.accel).catch(() => null)
    if (busy && accelOf(key) !== got.accel) { helpOf(btn, busy); return }
    try {
      if (key === 'clip') await Real.saveClips({ hotkey: got.accel }); else await Real.saveSettings({ overlayHotkey: got.accel })
      helpOf(btn); stop(); saved()
    } catch (x) { helpOf(btn, errText(x)) }
  }

  /* À propos */
  function pAbout(b, d) {
    b.innerHTML = `${d}${group('', `<div class="sr ab" id="r-ver"><div class="ab-l">${logo('ab-logo')}</div><div class="sr-t"><b>Player X V3 Test</b><span>Version ${esc(API.version)}. À part de ton Player X, sans mise à jour automatique.</span></div></div>
      ${row('r-setup', 'Première ouverture', '', '<button class="btn sm" id="abSetup">Revoir l’accueil</button>')}
      ${row('r-ffm', 'Moteur vidéo', `FFmpeg${eng ? ' ' + esc(eng.version) : ''}, un logiciel libre (licence LGPL).`, '<button class="btn sm" id="abFf">Ouvrir sa licence</button>')}`)}`
    $('#abSetup', b).onclick = () => { close(true); go('play'); setTimeout(() => Setup.open(), 340) }
    $('#abFf', b).onclick = () => API.editEngineFolder().catch(failed)
  }
  return {
    mount, open, close, syncBar, errText,
    // Depuis la fiche d'un jeu : sa routine, ou une nouvelle pour lui
    routineFor(id) { const r = G(id)?.routine; if (r && ROUTINES[r]) { routine = r; newFor = null; open.keep = 1; open('routine'); open.keep = 0 } else { routine = NEW_RT; newFor = id; open('routine') } },
    // Ctrl F de partout : les paramètres s'ouvrent sur leur recherche
    find() { if (el.hidden) open(); const i = $('#shQ', el); setTimeout(() => { i.focus({ preventScroll: true }); i.select() }, 0) },
    index: () => IDX, titleOf: (p) => META[p][0], go: (p, id) => { open(p); show(p, id) },
    sync() { if (el && !el.hidden && sec === 'rec') repaint() }
  }
})()

// Recherche Ctrl K : elle sort de nulle part, sans animation, parce qu'on l'ouvre cent fois
const Palette = (() => {
  let el, items = [], sel = 0, shown = []
  const norm = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  function mount(win) {
    el = h(`<div id="pal" hidden data-modal><div class="pal-scrim" id="palS"></div><div class="pal" role="dialog" aria-modal="true" aria-label="Recherche"><div class="pal-in"><label class="pal-l" for="palI">${ic('search')}<span>Rechercher</span></label><input id="palI" placeholder="un jeu, un ami, une arme" autocomplete="off"><kbd class="kb">Échap</kbd></div><div class="pal-r" id="palR" role="listbox"></div></div></div>`)
    win.append(el)
    $('#palS', el).onclick = close
    // Échap ferme aussi quand le focus est sur un résultat
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } })
    const i = $('#palI', el)
    i.oninput = paint
    i.onkeydown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); mark() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark() }
      else if (e.key === 'Enter') { e.preventDefault(); shown[sel]?.fn() }
    }
  }
  const launch = (g) => { close(); Views.show('play'); setTimeout(() => { Play.focusGame(g.id); setTimeout(() => Live.launch(g.id), 260) }, 300) }
  const build = () => {
    const out = [], inst = GAMES.filter((g) => g.installed && !g.hidden)
    GAMES.filter((g) => !g.hidden).forEach((g) => { out.push({ g: 'Jeux', t: g.name, s: g.installed ? '' : 'Pas installé', cover: g.cover, top: inst.indexOf(g) > -1 && inst.indexOf(g) < 3, fn: () => { close(); openGame(g.id) } }) })
    // Tous tes jeux installés se lancent d'ici : les trois derniers s'affichent d'office, les autres dès que tu tapes leur nom
    inst.forEach((g, i) => out.push({ g: 'Actions', t: `Lancer ${g.name}`, s: g.routine ? `Avec ${ROUTINES[g.routine]?.name}` : '', icon: 'play', launch: true, more: i >= 3, fn: () => launch(g) }))
    if (Real.clipsCfg) out.push({ g: 'Actions', t: Real.clipsOn() ? 'Couper l’enregistrement' : 'Activer l’enregistrement', s: 'Garder mes moments', icon: 'clip', fn: () => { close(); $('#bRec').click() } })
    // Le dernier clip, pas le dernier film (un film est rangé avec les clips)
    const lastClip = CLIPS.find((c) => c.kind !== 'film')
    if (lastClip) out.push({ g: 'Actions', t: 'Voir le dernier clip', s: lastClip.title, icon: 'clip', fn: () => { close(); Clips.open(lastClip.id) } })
    out.push({ g: 'Actions', t: 'Chercher mes jeux', s: 'Steam, Epic Games, EA app et GOG', icon: 'refresh', fn: () => { close(); go('lib'); Pages.rescan() } })
    ;[['Bibliothèque', 'lib', 'lib'], ['Clips', 'clips', 'clip'], ['Stats', 'stats', 'stats'], ['Amis', 'friends', 'users']].forEach(([t, v, i]) => out.push({ g: 'Pages', t, s: '', icon: i, fn: () => { close(); go(v) } }))
    ;[['Stats de Battlefield 6', 'bf6'], ['Stats de Counter-Strike 2', 'cs2']].forEach(([t, id]) => out.push({ g: 'Pages', t, s: '', icon: 'stats', fn: () => { close(); S.statsGame = id; S.statsTab = 'overview'; if (S.view === 'stats' && !S.gameId) StatsPage.render(); else go('stats') } }))
    out.push({ g: 'Pages', t: 'Classement', s: 'Battlefield 6', icon: 'trophy', fn: () => { close(); S.statsGame = 'bf6'; S.statsTab = 'board'; if (S.view === 'stats' && !S.gameId) StatsPage.render(); else go('stats') } })
    out.push({ g: 'Pages', t: 'Mes loadouts', s: 'Battlefield 6', icon: 'gun', fn: () => { close(); S.loWeapon = null; S.statsGame = 'bf6'; S.statsTab = 'loadouts'; if (S.view === 'stats' && !S.gameId) StatsPage.render(); else go('stats') } })
    ;[...new Set(BUILDS.map((b) => b.w))].forEach((w) => { const n = BUILDS.filter((b) => b.w === w).length; out.push({ g: 'Loadouts', t: w, s: `${n} loadout${n > 1 ? 's' : ''}`, icon: 'gun', fn: () => { close(); S.loWeapon = w; S.statsGame = 'bf6'; S.statsTab = 'loadouts'; if (S.view === 'stats' && !S.gameId) StatsPage.render(); else go('stats') } }) })
    Settings.index().forEach(([p, id, t, k]) => out.push({ g: 'Paramètres', t, s: Settings.titleOf(p), k, icon: 'gear', fn: () => { close(); Settings.go(p, id) } }))
    FRIENDS.forEach((f) => out.push({ g: f.member ? 'Membres du serveur' : 'Amis', t: f.n, s: f.st === 'game' ? `Sur ${f.gameName}` : f.st === 'offline' ? 'Hors ligne' : f.member ? 'Membre du serveur' : 'En ligne', av: f.n, fn: () => { close(); S.friend = f.id; if (S.view === 'friends' && !S.gameId) Pages.enter('friends'); else go('friends') } }))
    return out
  }
  function paint() {
    const q = norm($('#palI', el).value.trim())
    // Un mot qui commence par ce que tu tapes (« age » trouve Age of Empires, plus « Mirage » ni « démarrage ») ; lancer passe en premier
    const hit = (x) => { const t = norm(x.t + ' ' + x.s + ' ' + (x.k || '')); return t.startsWith(q) || t.includes(' ' + q) || t.includes('-' + q) || t.includes('’' + q) || t.includes('(' + q) }
    shown = q ? items.filter(hit).sort((a, b) => (b.launch ? 1 : 0) - (a.launch ? 1 : 0)) : items.filter((x) => (x.g === 'Actions' && !x.more) || x.top)
    sel = 0
    const groups = [...new Set(shown.map((x) => x.g))]
    // L'ordre à l'écran est celui des flèches
    shown = groups.flatMap((g) => shown.filter((x) => x.g === g))
    $('#palR', el).innerHTML = shown.length ? groups.map((g) => `<h3>${g}</h3>` + shown.filter((x) => x.g === g).map((x) => `<button class="pal-i" role="option" data-i="${shown.indexOf(x)}" data-name="${esc(x.t)}">${x.cover ? `<img src="${esc(A(x.cover))}" alt=""${shown.indexOf(x) >= 8 ? ' loading="lazy" decoding="async"' : ''}>` : x.av ? avatar(x.av, 26) : `<span class="pal-ic">${ic(x.icon)}</span>`}<b>${esc(x.t)}</b><span>${esc(x.s || '')}</span></button>`).join('')).join('') : `<div class="pal-0"><p>Rien pour « ${esc($('#palI', el).value)} ». Essaie un jeu, un ami ou une arme.</p><button class="btn sm" id="palClr">Effacer la recherche</button></div>`
    $('#palClr', el)?.addEventListener('click', () => { const i = $('#palI', el); i.value = ''; paint(); i.focus() })
    $$('.pal-i', el).forEach((b) => { b.onclick = () => shown[+b.dataset.i].fn(); b.onpointermove = () => { sel = +b.dataset.i; mark(false) } })
    mark()
  }
  function mark(scroll = true) { $$('.pal-i', el).forEach((b) => { const on = +b.dataset.i === sel; b.classList.toggle('on', on); if (on && scroll) b.scrollIntoView({ block: 'nearest' }) }) }
  let back = null
  function open() { back = document.activeElement; if (!$('#sheet').hidden) { back = $('#bGear'); Settings.close(true) } items = build(); el.hidden = false; const i = $('#palI', el); i.value = ''; paint(); i.focus() }
  function close() { if (el.hidden) return; el.hidden = true; giveFocus(back) }
  return { mount, open }
})()
