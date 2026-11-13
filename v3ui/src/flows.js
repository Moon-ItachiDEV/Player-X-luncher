// Stories : le bilan de match se lit comme une story, et le grand « Quoi de neuf » aussi.
const Story = (() => {
  let el, st = null, back = null, hideT = 0
  function mount(win) {
    el = h(`<section id="story" hidden data-modal aria-label="Story"><div class="st-segs" id="stSegs"></div><button class="st-close btn sm icon" id="stClose" aria-label="Fermer" data-tip="Fermer, Échap" data-tip-b data-tip-r>${ic('close')}</button><div class="st-body" id="stBody"></div><button class="st-z st-prev" id="stPrev" aria-label="Précédent"></button><button class="st-z st-next" id="stNext" aria-label="Suivant"></button></section>`)
    win.append(el)
    $('#stClose', el).onclick = close
    const onBtn = (e) => e.target.closest?.('.st-slide button,.st-slide a,.st-close')
    el.addEventListener('pointerover', (e) => { if (onBtn(e)) pause() }); el.addEventListener('pointerout', (e) => { if (onBtn(e)) resume() })
    el.addEventListener('focusin', (e) => { if (onBtn(e) && e.target.matches(':focus-visible')) pause() }); el.addEventListener('focusout', (e) => { if (onBtn(e)) resume() })
    $('#stPrev', el).onclick = () => step(-1)
    $('#stNext', el).onclick = () => step(1)
    document.addEventListener('keydown', (e) => {
      if (!st) return
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
    })
  }
  let timer = 0, t0 = 0, left = 0
  function arm(ms) { left = ms; t0 = performance.now(); timer = setTimeout(() => show(st.i + 1), ms) }
  function seg() { return $('#stSegs .cur b', el) }
  function pause() { if (!timer) return; clearTimeout(timer); timer = 0; left -= performance.now() - t0; const s = seg(); if (s) s.style.animationPlayState = 'paused' }
  function resume() { if (timer || !st || !left) return; const s = seg(); if (s) s.style.animationPlayState = ''; arm(left) }
  function open({ slides, onClose, pal, hero, zones = true, closable = true }) {
    clearTimeout(hideT)
    st = { slides, i: -1, onClose }
    back = document.activeElement
    el.classList.toggle('no-zones', !zones)
    $('#stClose', el).hidden = !closable
    if (pal) Fluid.set(pal, null, hero || null)
    Fluid.page(1)
    el.hidden = false; void el.offsetWidth; el.classList.add('on'); $('#win').classList.add('is-story')
    $('#stSegs', el).innerHTML = slides.map(() => '<i><b></b></i>').join('')
    Bar.el().classList.add('is-hidden')
    show(0)
  }
  function show(i) {
    if (!st) return
    clearTimeout(timer); timer = 0; left = 0
    if (i < 0) i = 0
    if (i >= st.slides.length) { return }
    st.i = i
    const sl = st.slides[i]
    $$('#stSegs i', el).forEach((x, j) => { x.className = j < i ? 'done' : j === i ? (sl.hold ? 'done' : 'cur') : ''; const b = $('b', x); b.style.animationDuration = (sl.dur || 4500) + 'ms'; b.style.animationPlayState = '' })
    const body = $('#stBody', el)
    body.innerHTML = `<div class="st-slide ${sl.cls || ''}">${sl.html}</div>`
    sl.enter && sl.enter(body)
    if (i < st.slides.length - 1 && !sl.hold) arm(sl.dur || 4500)
    $('#stNext', el).hidden = i >= st.slides.length - 1
    $('#stPrev', el).hidden = i === 0
  }
  function step(d) { if (st) show(st.i + d) }
  function close() {
    if (!st) return
    clearTimeout(timer); timer = 0; left = 0; const cb = st.onClose; st = null
    Fluid.rest()
    el.classList.remove('on'); Bar.el().classList.remove('is-hidden'); $('#win').classList.remove('is-story')
    hideT = setTimeout(() => { el.hidden = true; $('#stBody', el).innerHTML = ''; giveFocus(back) }, 220)
    cb && cb()
  }
  return { mount, open, close }
})()

// Le bilan : celui du vrai match (CS2 l'envoie lui-même) ou de la vraie session (BF6 : comparaison des stats avant et après)
const Recap = (() => {
  const C = Shared.cs2, T = Shared.text
  const CS_MAPS = ['ancient', 'anubis', 'dust2', 'inferno', 'mirage', 'nuke', 'overpass', 'train', 'vertigo']
  const csImg = (map) => { const k = String(map).replace(/^(de|cs|ar)_/, ''); if (CS_MAPS.includes(k)) return A('cs_' + k); const g = Real.statGame('cs2'); return A(g.hero || g.cover) }
  // Adresses brutes : esc() à chaque attribut src (l'adresse sert aussi telle quelle au fond, via Story.open)
  const bfImg = (r) => { const g = Real.statGame('bf6'); return r.maps?.[0]?.image || A(g.hero || g.cover) }
  const kd = (n) => fr(n, 2)
  const clipsOf = (id, r) => Clips.between(Real.statGame(id).rid, r.startedAt, r.endedAt)
  const onClosed = (id) => () => { if (S.view === 'play') { Play.focusGame(id); Fluid.game(Play.focused()) } Bar.syncGame() }
  const statList = (rows) => `<ul class="sl-stats">${rows.map(([a, b], i) => `<li style="--i:${i}"><b class="num">${esc(b)}</b><span>${esc(a)}</span></li>`).join('')}</ul>`
  const adrOf = (r) => (r.hasRounds && r.roundsTracked ? Math.round(r.damage / r.roundsTracked) : null)
  const hsOf = (r) => (r.trackedKills ? Math.round(r.headshots / r.trackedKills * 100) : null)
  // Les deux dernières pages sont les mêmes : le meilleur clip, puis ce qui reste à partager
  function clipSlides(clips) {
    const best = clips.slice().sort((a, b) => (b.kills || 0) - (a.kills || 0) || b.at - a.at)[0]
    const keepActs = (b) => {
      $('#slShare', b)?.addEventListener('click', (e) => Clips.copy(best, e.currentTarget))
      $('#slClose', b)?.addEventListener('click', () => Story.close())
      $('#slAll', b)?.addEventListener('click', () => { Story.close(); go('clips') })
      $$('.ct-tile', b).forEach((t) => t.onclick = () => { const id = t.dataset.id; Story.close(); Clips.open(id) })
    }
    if (!best) return [{ hold: true, cls: 'sl-keep', html: `<div class="sl-in"><p class="sl-kick">À garder</p><h2 class="sl-h2">Pas de clip cette fois</h2><p class="su-lead">${Real.clipsOn?.() ? 'Aucun moment gardé sur cette partie. Le raccourci garde les dernières secondes quand tu veux.' : 'L’enregistrement est coupé : active-le dans Paramètres pour garder tes kills.'}</p><div class="sl-acts"><button class="btn rose" id="slClose">Fermer le bilan</button></div></div>`, enter: keepActs }]
    return [
      { dur: 8000, cls: 'sl-best', enter: (b) => { $('#slBestCopy', b).addEventListener('click', (e) => Clips.copy(best, e.currentTarget)); $('#slBestOpen', b).addEventListener('click', () => { Story.close(); Clips.open(best.id) }) }, html: `<div class="sl-in sl-two"><div class="sl-m"><p class="sl-kick">Ton meilleur moment</p><h2 class="sl-h2">${esc(best.title)}${best.round ? `, round ${best.round}` : ''}</h2><div class="sl-frame"><video src="${esc(best.videoUrl)}" poster="${esc(best.thumbUrl)}" muted loop ${reduced() ? '' : 'autoplay'} playsinline></video></div></div>
        <aside class="sl-side"><p class="sl-kmeta num">${fmtTime(best.durationS)}, ${esc(Clips.sizeLabel(best))}</p><button class="btn rose" id="slBestCopy">${ic('copy')}<span>Copier pour Discord</span></button><button class="btn" id="slBestOpen">Ouvrir le clip</button></aside></div>` },
      { hold: true, cls: 'sl-keep', enter: keepActs, html: `<div class="sl-in"><p class="sl-kick">À garder</p><h2 class="sl-h2">${clips.length} clip${clips.length > 1 ? 's' : ''} prêt${clips.length > 1 ? 's' : ''} à partager</h2><div class="sl-tiles">${clips.slice(0, 3).map((c) => Clips.tileHTML(c)).join('')}</div><div class="sl-acts"><button class="btn rose" id="slShare">${ic('copy')}<span>Copier le meilleur pour Discord</span></button><button class="btn" id="slAll">Voir tous mes clips</button><button class="btn quiet" id="slClose">Fermer le bilan</button></div></div>` }
    ]
  }
  function openCs2(r) {
    const g = Real.statGame('cs2'), img = csImg(r.map), clips = clipsOf('cs2', r), adr = adrOf(r), hs = hsOf(r)
    if (!r.seen && !r.sample) API.cs2RecapSeen(r.id).catch(() => {})
    const rows = [['K/D/A', `${r.kills}/${r.deaths}/${r.assists}`], ['K/D', kd(C.killDeath(r))], ...(adr != null ? [['ADR', String(adr)]] : []), ...(hs != null ? [['Headshots', `${hs} %`]] : []), ...(adr == null ? [['MVP', String(r.mvps)]] : [])]
    const slides = [{ dur: 4600, cls: 'sl-res', html: `<img class="sl-bg" src="${esc(img)}" alt=""><div class="sl-in"><p class="sl-kick">${esc(C.mapLabel(r.map))}, ${esc(C.modeLabel(r.mode))}</p><h1 class="sl-big">${esc(C.RESULT_LABEL[r.result])}</h1>${r.score ? `<p class="sl-score num" id="slScore">${r.score.us}–${r.score.them}</p>` : ''}${statList(rows)}${r.partial ? '<p class="demo">Match rejoint en cours : seuls les rounds suivis comptent.</p>' : ''}</div>` }]
    if (r.hasRounds && r.rounds.length) {
      const best = r.best
      slides.push({ dur: 5000, cls: 'sl-line', html: `<div class="sl-in"><p class="sl-kick">Ta ligne de match</p><h2 class="sl-h2">${best?.kills ? `Meilleur round : le ${best.n}e, ${best.kills} kill${best.kills > 1 ? 's' : ''}` : `${r.rounds.length} rounds`}</h2><div class="rl">${r.rounds.map((x, i) => `<div class="rl-c ${x.n === best?.n ? 'best' : ''}" style="--i:${i}"><div class="rl-x">${Array.from({ length: x.kills || 0 }, () => xm()).join('')}</div><i class="${x.side ? (x.winner === x.side ? 'w' : 'l') : ''}"></i><span class="num">${x.n}</span></div>`).join('')}</div><p class="sl-legend"><i class="w"></i>Gagné <i class="l"></i>Perdu <span class="sl-lx">${xm()}</span>Un kill</p></div>` })
    }
    Story.open({ pal: g.pal, hero: img, onClose: onClosed('cs2'), slides: [...slides, ...clipSlides(clips)] })
  }
  function openBf6(r) {
    const g = Real.statGame('bf6'), img = bfImg(r), clips = clipsOf('bf6', r), dur = (r.endedAt - r.startedAt) / 6e4
    if (!r.seen && !r.sample) API.bf6RecapSeen(r.id).catch(() => {})
    const diff = r.killDeath - r.average.killDeath
    const lines = [
      ['Ton K/D', `${kd(r.killDeath)}, ${Math.abs(diff) < .005 ? 'pile ta moyenne' : `${diff > 0 ? '+' : '−'}${kd(Math.abs(diff))} par rapport à ta moyenne`}`],
      ...(r.weapon ? [['Ton arme', `${r.weapon.name}, ${fr(r.weapon.kills)} élimination${r.weapon.kills > 1 ? 's' : ''}`]] : []),
      ...(r.role ? [['Ta classe', r.role.name]] : []),
      ...(r.maps.length ? [[r.maps.length > 1 ? 'Cartes' : 'Carte', r.maps.map((m) => (r.maps.length > 1 ? `${m.name} (${m.matches})` : m.name)).join(', ')]] : []),
      ...(r.revives ? [['Réanimations', fr(r.revives)]] : [])
    ]
    const rows = [['K/D/A', `${r.kills}/${r.deaths}/${r.assists}`], ['K/D', kd(r.killDeath)], ['Élim. par min', kd(r.killsPerMinute)], ['Parties', fr(r.matches)]]
    Story.open({
      pal: g.pal, hero: img, onClose: onClosed('bf6'),
      slides: [
        { dur: 4600, cls: 'sl-res', html: `<img class="sl-bg" src="${esc(img)}" alt=""><div class="sl-in"><p class="sl-kick">Session de ${esc(T.formatPlaytime(Math.max(1, Math.round(dur))))}, ${esc(T.timeAgo(r.endedAt))}</p><h1 class="sl-big">${r.wins || r.losses ? `${r.wins} victoire${r.wins > 1 ? 's' : ''}` : `${r.matches} partie${r.matches > 1 ? 's' : ''}`}</h1>${r.wins || r.losses ? `<p class="sl-score num" id="slScore">${r.wins}–${r.losses}</p>` : ''}${statList(rows)}${r.partial ? '<p class="demo">Le jeu tournait déjà : seules les parties d’après comptent.</p>' : ''}</div>` },
        { dur: 6000, cls: 'sl-wn', html: `<div class="sl-in"><p class="sl-kick">Ta session</p><h2 class="sl-h1">Ce qu’elle dit de toi</h2><ul class="wn-list">${lines.map(([a, b]) => `<li><b>${esc(a)}</b><span>${esc(b)}</span></li>`).join('')}</ul></div>` },
        ...clipSlides(clips)
      ]
    })
  }

  /* Les lignes de la liste : un match CS2, ou une session BF6 */
  const cs2Row = (r) => { const adr = adrOf(r), hs = hsOf(r), n = clipsOf('cs2', r).length; return `<li><button class="mt" data-id="${esc(r.id)}"><span class="mt-img"><img src="${esc(csImg(r.map))}" alt=""></span><span class="mt-a"><b>${esc(C.mapLabel(r.map))}</b><span>${esc(C.modeLabel(r.mode))}, ${esc(T.timeAgo(r.endedAt))}</span></span><span class="mt-r ${r.result === 'win' ? 'res-w' : 'res-l'}">${esc(C.RESULT_LABEL[r.result])}<b class="num">${r.score ? `${r.score.us}–${r.score.them}` : ''}</b></span><span class="mt-k num"><b>${r.kills}/${r.deaths}/${r.assists}</b><span>K/D/A</span></span><span class="mt-k num"><b>${kd(C.killDeath(r))}</b><span>K/D</span></span><span class="mt-k num"><b>${adr ?? '–'}</b><span>ADR</span></span><span class="mt-k num"><b>${hs != null ? `${hs} %` : '–'}</b><span>HS</span></span><span class="mt-c">${n ? `${xm()}<b class="num">${n}</b>` : ''}</span><span class='mt-go'>${ic('chev')}</span></button></li>` }
  // Une session peut passer par plusieurs cartes : le titre ne fait plus croire qu'il n'y en a eu qu'une
  const bf6Maps = (r) => {
    const m = (r.maps || []).filter((x) => x?.name)
    if (m.length < 2) return { title: m[0]?.name || 'Session', sub: '' }
    const names = m.slice(0, 2).map((x) => x.name).join(', ')
    return { title: `${m.length} cartes`, sub: m.length > 2 ? `${names} et ${m.length - 2} autre${m.length > 3 ? 's' : ''}` : names }
  }
  const bf6Img = (r) => {
    const im = (r.maps || []).map((x) => x?.image).filter(Boolean)
    return im.length > 1 ? `<span class="mt-img mt-split">${im.slice(0, 3).map((u) => `<img src="${esc(u)}" alt="">`).join('')}</span>` : `<span class="mt-img"><img src="${esc(bfImg(r))}" alt=""></span>`
  }
  const bf6Row = (r) => { const n = clipsOf('bf6', r).length, mp = bf6Maps(r); return `<li><button class="mt" data-id="${esc(r.id)}">${bf6Img(r)}<span class="mt-a"><b>${esc(mp.title)}</b><span>${mp.sub ? `${esc(mp.sub)} · ` : ''}${r.matches} partie${r.matches > 1 ? 's' : ''}, ${esc(T.timeAgo(r.endedAt))}</span></span><span class="mt-r ${r.wins >= r.losses ? 'res-w' : 'res-l'}">Victoires<b class="num">${r.wins}–${r.losses}</b></span><span class="mt-k num"><b>${r.kills}/${r.deaths}/${r.assists}</b><span>K/D/A</span></span><span class="mt-k num"><b>${kd(r.killDeath)}</b><span>K/D</span></span><span class="mt-k num"><b>${kd(r.killsPerMinute)}</b><span>Élim./min</span></span><span class="mt-k num"><b>${fr(r.revives)}</b><span>Réa.</span></span><span class="mt-c">${n ? `${xm()}<b class="num">${n}</b>` : ''}</span><span class='mt-go'>${ic('chev')}</span></button></li>` }
  // Remplit un bloc avec les derniers matchs (limit) ou tout l'historique
  async function listInto(b, id, limit = 0) {
    const empty = (t, s, a) => { b.innerHTML = `<div class="empty"><span class="empty-x">${xm()}</span><h2>${esc(t)}</h2><p>${esc(s)}</p>${a ? `<button class="btn sm" id="mtFix">${esc(a)}</button>` : ''}</div>`; $('#mtFix', b)?.addEventListener('click', () => Settings.open('general')) }
    if (id === 'cs2') {
      const st = await API.cs2State().catch(() => null); if (st) Real.st.cs2 = st
      if (!b.isConnected) return
      const list = (st?.recaps || []).slice(0, limit || undefined)
      if (!list.length) return st && !st.enabled ? empty('Le suivi de Counter-Strike 2 est coupé', 'Active-le pour garder le score et le bilan de chaque match.', 'Ouvrir les réglages') : empty('Aucun match pour l’instant', 'Joue un match de Counter-Strike 2 : son bilan arrive ici tout seul.')
      b.innerHTML = `<ul class="mt-list">${list.map(cs2Row).join('')}</ul>`
      $$('.mt', b).forEach((r) => r.onclick = () => openCs2(list.find((x) => x.id === r.dataset.id)))
    } else {
      const st = await API.bf6Recaps().catch(() => null)
      if (!b.isConnected) return
      const list = (st?.recaps || []).slice(0, limit || undefined)
      if (!list.length) return st && !st.enabled ? empty('Le bilan de Battlefield 6 est coupé', 'Active-le pour comparer tes stats avant et après chaque session.', 'Ouvrir les réglages') : empty(st?.pending ? 'Bilan en préparation' : 'Aucune session pour l’instant', st?.pending ? 'Le service de stats met parfois quelques minutes à compter tes dernières parties.' : 'Joue à Battlefield 6 avec ton profil relié : le bilan arrive ici après la partie.')
      b.innerHTML = `<ul class="mt-list">${list.map(bf6Row).join('')}</ul>`
      $$('.mt', b).forEach((r) => r.onclick = () => openBf6(list.find((x) => x.id === r.dataset.id)))
    }
  }
  function mount() {
    API.onCs2Recap((e) => {
      if (e.reason === 'open') return openCs2(e.recap)
      if (e.reason === 'ready') toast(`${ic('check')} ${esc(C.cs2RecapLine(e.recap))}`, { ms: 12000, action: { label: 'Voir le bilan', fn: () => openCs2(e.recap) } })
      if (S.view === 'stats' && S.statsGame === 'cs2' && !S.atelier) StatsPage.render()
    })
    API.onBf6Recap((e) => {
      if (e.reason === 'open') return openBf6(e.recap)
      if (e.reason === 'ready') toast(`${ic('check')} Bilan de session Battlefield 6 prêt : ${fr(e.recap.kills)} éliminations`, { ms: 12000, action: { label: 'Voir le bilan', fn: () => openBf6(e.recap) } })
    })
  }
  return { mount, listInto }
})()
