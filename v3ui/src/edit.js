// L'éditeur de films (bêta 35) : la musique, la bande des plans et leurs réglages, puis « Fabriquer le film ».
// Le projet ne contient que des identifiants (clips, musique) : le processus principal le revoit avant de fabriquer.
// La géométrie (pas, ralentis, coupes sur les temps) vient de Shared.editShots, la même que celle de la fabrication.
const Editor = (() => {
  const E = Shared.editShots
  let host = null, root = null, st = null, onDone = null
  // Le dernier projet ouvert, gardé tant que l'appli tourne : rouvrir le même groupe le retrouve tel quel
  let draft = null
  const clipOf = (id) => CLIPS.find((c) => c.id === id)
  const unit = () => E.unitOf(st.music?.bpm ?? null)
  const fmtS = (s) => `${(Math.round(s * 10) / 10).toLocaleString('fr-FR')} s`
  const nTemps = (n) => (st.music?.bpm ? `${n} temps` : fmtS(n * unit()))
  const kindWord = (c) => (!c ? 'Clip disparu' : c.kind === 'ace' ? 'Ace' : c.kind === 'multi' ? `${c.kills || 3} kills` : c.kind === 'hs' ? 'Headshot' : c.kind === 'manual' ? 'Gardé à la main' : 'Kill')

  async function open(ids, at, done) {
    host = at; onDone = done
    const key = [...ids].sort().join(',')
    if (draft && draft.key === key) { st = draft.st; mount(); return }
    const musics = await API.editMusicList().catch(() => [])
    const music = musics.find((m) => !m.missing) || null
    let r
    try { r = await API.editPlan(ids, music?.id || null) } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 6000 }); return }
    st = { key, ids: [...ids], project: r.project, musics, music, sel: 0, undo: [], redo: [] }
    draft = { key, st }
    if (r.skipped) toast(`${r.skipped} clip${r.skipped > 1 ? 's sont illisibles et sont laissés' : ' est illisible et est laissé'} de côté.`, { tone: 'warn', ms: 5000 })
    mount()
  }
  const isOpen = () => !!root

  function mount() {
    root?.remove()
    root = h(`<div class="ed" id="ed" role="region" aria-label="Monter un film"></div>`)
    host.append(root)
    $('#clipScroll', host).style.visibility = 'hidden'
    paint()
    $('#edMake', root)?.focus({ preventScroll: true })
  }
  function close() {
    if (!root) return
    stopPreview()
    root.remove(); root = null
    $('#clipScroll', host).style.visibility = ''
    onDone?.()
  }

  // ---------- changer le projet (annuler, rétablir) ----------
  const snap = () => JSON.stringify({ p: st.project, sel: st.sel, m: st.music?.id || null })
  function change(fn) {
    st.undo.push(snap()); if (st.undo.length > 100) st.undo.shift()
    st.redo = []
    fn()
    paint()
  }
  function back(from, to) {
    if (!from.length) return
    to.push(snap())
    const s = JSON.parse(from.pop())
    st.project = s.p; st.sel = s.sel; st.music = st.musics.find((m) => m.id === s.m) || null
    paint()
  }
  const fit = (s) => { const c = clipOf(s.clipId); return c ? E.fitShot(s, c.durationS, unit()) : s }

  // ---------- la musique ----------
  function setMusic(m) {
    const before = unit()
    change(() => {
      st.music = m
      const u = unit()
      // Les plans gardent leur longueur en secondes, ramenée au nouveau pas
      st.project.shots = st.project.shots.map((s) => fit({ ...s, lead: Math.round((s.lead * before) / u), tail: Math.round((s.tail * before) / u) }))
      st.project.music = m ? { id: m.id, startS: m.grid[0] || 0, volume: st.project.music?.volume ?? 0.9 } : null
      st.project.gameVolume = m ? (st.project.music && st.project.gameVolume < 1 ? st.project.gameVolume : 0.5) : 1
    })
  }
  async function pickMusic(b) {
    b?.setAttribute('aria-busy', 'true')
    const lab = b && $('span', b), old = lab?.textContent
    if (lab) lab.textContent = 'Lecture de la musique…'
    try {
      const m = await API.editMusicPick()
      if (m) { st.musics = [m, ...st.musics.filter((x) => x.id !== m.id)]; setMusic(m); if (!m.bpm) toast('Pas de tempo net dans ce morceau : les coupes ne seront pas calées dessus.', { tone: 'warn', ms: 6000 }) }
    } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 6000 }) }
    finally { if (root && b?.isConnected) { b.removeAttribute('aria-busy'); if (lab) lab.textContent = old } }
  }
  function musicMenu(b) {
    const items = st.musics.filter((m) => !m.missing && m.id !== st.music?.id).slice(0, 6).map((m) => ['film', m.name, () => setMusic(m)])
    menuAt(b, [['plus', 'Choisir un fichier…', () => pickMusic($('#edMusicBtn', root))], ...items, ...(st.music ? [['sep'], ['close', 'Sans musique', () => setMusic(null)]] : [])], { main: true })
  }
  // Où la musique commence : un temps plus tôt ou plus tard (par 4 temps, une mesure)
  function shiftMusic(d) {
    const g = st.music?.grid || []; if (!g.length) return
    const i = g.findIndex((t) => t >= st.project.music.startS - 1e-3)
    const j = clamp(i + d, 0, Math.max(0, g.length - 1))
    if (j === i) return
    change(() => { st.project.music.startS = g[j] })
  }

  // ---------- les plans ----------
  const cur = () => st.project.shots[st.sel]
  function edit(patch) { change(() => { st.project.shots[st.sel] = fit({ ...cur(), ...patch }) }) }
  function move(d) {
    const to = st.sel + d
    if (to < 0 || to >= st.project.shots.length) return
    change(() => { st.project.shots = E.moveItem(st.project.shots, st.sel, to); st.sel = to })
  }
  function remove() {
    if (st.project.shots.length <= 1) return toast('Un film garde au moins un plan.', { ms: 2600 })
    change(() => { st.project.shots.splice(st.sel, 1); st.sel = Math.min(st.sel, st.project.shots.length - 1) })
    toast(`${ic('trash')} Plan retiré`, { ms: 4000, action: { label: 'Annuler', fn: () => back(st.undo, st.redo) } })
  }
  async function replan() {
    try {
      const ids = [...new Set(st.project.shots.map((s) => s.clipId))]
      const r = await API.editPlan(ids, st.music?.id || null)
      change(() => { const vol = st.project.music?.volume; st.project = { ...r.project, gameVolume: st.project.gameVolume }; if (st.project.music && vol !== undefined) st.project.music.volume = vol; st.sel = 0 })
    } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 6000 }) }
  }
  function addClips() {
    const have = new Set(st.project.shots.map((s) => s.clipId))
    const list = CLIPS.filter((c) => c.kind !== 'film' && !have.has(c.id)).sort((a, b) => b.at - a.at).slice(0, 60)
    if (!list.length) return toast('Tous tes clips sont déjà dans ce film.', { ms: 2600 })
    const d = h(`<dialog class="cf ed-add" aria-labelledby="edAddT" closedby="any"><h2 id="edAddT">Ajouter des clips</h2>
      <div class="ed-addg">${list.map((c) => `<button class="ed-pick" data-id="${esc(c.id)}" aria-pressed="false"><span class="ed-pf"><img src="${esc(c.thumbUrl)}" alt="" loading="lazy" data-fb="1"><i>${ic('check')}</i></span><span><b>${esc(c.title)}</b><span>${esc([c.map ? Shared.cs2.mapLabel(c.map) : c.gameName, Shared.text.timeAgo(c.at)].filter(Boolean).join(', '))}</span></span></button>`).join('')}</div>
      <div class="cf-a"><button class="btn" id="edAddNo">Annuler</button><button class="btn rose" id="edAddOk">Ajouter</button></div></dialog>`)
    document.body.append(d)
    const end = () => setTimeout(() => d.remove(), 200)
    $$('.ed-pick', d).forEach((b) => b.onclick = () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'))
    $('#edAddNo', d).onclick = () => { d.close(); end() }
    $('#edAddOk', d).onclick = async () => {
      const ids = $$('.ed-pick[aria-pressed=true]', d).map((b) => b.dataset.id)
      if (!ids.length) return toast('Choisis au moins un clip.', { ms: 2200 })
      d.close(); end()
      try {
        const r = await API.editPlan(ids, st.music?.id || null)
        change(() => { st.project.shots.push(...r.project.shots.map(fit)); st.sel = st.project.shots.length - r.project.shots.length })
      } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 6000 }) }
    }
    d.addEventListener('keydown', (e) => e.stopPropagation())
    d.addEventListener('close', end)
    d.showModal()
  }

  // ---------- l'aperçu (sans la musique : elle n'est mélangée qu'à la fabrication) ----------
  let pv = null
  function stopPreview() { if (pv) { cancelAnimationFrame(pv.raf); pv.v.pause(); pv = null } paintPlay() }
  function preview(fromSel, all) {
    stopPreview()
    const v = $('#edVid', root); if (!v) return
    const u = unit()
    pv = { v, i: fromSel, all, raf: 0 }
    const start = () => {
      const s = st.project.shots[pv.i], c = s && clipOf(s.clipId)
      if (!s) return stopPreview()
      if (!c) { pv.i++; return pv.all ? start() : stopPreview() }
      if (pv.all) { st.sel = pv.i; paintStrip(); paintSide() }
      const parts = E.shotParts(s, u)
      pv.parts = parts; pv.k = 0
      const go = () => { v.currentTime = parts[0].fromS; v.playbackRate = parts[0].speed; v.play().catch(() => {}) }
      if (!v.src.endsWith(c.videoUrl)) { v.src = c.videoUrl; v.onloadedmetadata = () => { v.onloadedmetadata = null; go() } } else go()
    }
    const f = () => {
      if (!pv) return
      const p = pv.parts?.[pv.k]
      if (p && v.currentTime >= p.toS - 0.01) {
        pv.k++
        const n = pv.parts[pv.k]
        if (n) v.playbackRate = n.speed
        else if (pv.all && pv.i < st.project.shots.length - 1) { pv.i++; start() }
        else return stopPreview()
      }
      pv.raf = requestAnimationFrame(f)
    }
    start(); pv.raf = requestAnimationFrame(f); paintPlay()
  }
  function paintPlay() {
    const b1 = root && $('#edPlay', root), b2 = root && $('#edPlayAll', root)
    if (b1) b1.innerHTML = `${ic(pv && !pv.all ? 'pause' : 'play')}<span>${pv && !pv.all ? 'Arrêter' : 'Lire le plan'}</span>`
    if (b2) b2.innerHTML = `${ic(pv?.all ? 'pause' : 'play')}<span>${pv?.all ? 'Arrêter' : 'Lire le film'}</span>`
  }

  // ---------- fabriquer ----------
  async function make(b) {
    if (b.getAttribute('aria-busy')) return
    b.setAttribute('aria-busy', 'true')
    try {
      await API.editFilmStart(st.project)
      draft = null
      close()
    } catch (e) { b.removeAttribute('aria-busy'); toast(esc(errText(e)), { tone: 'warn', ms: 7000 }) }
  }

  // ---------- dessin ----------
  function paint() {
    if (!root) return
    const had = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : null
    root.innerHTML = `<header class="ed-head">
        <button class="btn sm" id="edBack" data-tip="Revenir, Échap" data-tip-b>${ic('back')}Revenir aux clips</button>
        <div class="ed-ttl"><h1>Monter un film</h1><p class="num" id="edSum"></p></div>
        <button class="btn rose" id="edMake">${ic('film')}<span>Fabriquer le film</span></button>
      </header>
      <div class="ed-body">
        <div class="ed-main">
          <div class="ed-frame"><video id="edVid" playsinline muted></video></div>
          <div class="ed-tr">
            <button class="btn sm" id="edPlay"></button><button class="btn sm" id="edPlayAll"></button>
            <span class="ed-hint">Aperçu sans la musique</span>
            <span class="ed-ur"><button class="btn sm" id="edReplan">${ic('refresh')}Refaire le montage</button><button class="btn sm icon" id="edUndo" aria-label="Annuler" data-tip="Annuler, Ctrl Z" data-tip-b>${ic('back')}</button><button class="btn sm icon ed-redo" id="edRedo" aria-label="Rétablir" data-tip="Rétablir, Ctrl Y" data-tip-b>${ic('back')}</button></span>
          </div>
        </div>
        <aside class="ed-side" id="edSide"></aside>
      </div>
      <div class="ed-strip" id="edStrip" role="listbox" aria-label="Les plans du film" aria-orientation="horizontal"></div>`
    $('#edBack', root).onclick = close
    $('#edMake', root).onclick = (e) => make(e.currentTarget)
    $('#edPlay', root).onclick = () => (pv && !pv.all ? stopPreview() : preview(st.sel, false))
    $('#edPlayAll', root).onclick = () => (pv?.all ? stopPreview() : preview(0, true))
    $('#edUndo', root).onclick = () => back(st.undo, st.redo)
    $('#edRedo', root).onclick = () => back(st.redo, st.undo)
    root.onkeydown = onKey
    paintPlay(); paintStrip(); paintSide(); paintSum()
    const v = $('#edVid', root), s = cur(), c = s && clipOf(s.clipId)
    if (c) { v.src = c.videoUrl; v.poster = c.thumbUrl; v.onloadedmetadata = () => { v.onloadedmetadata = null; v.currentTime = s.anchorS } }
    if (had && $('#' + had, root)) $('#' + had, root).focus({ preventScroll: true })
  }
  function paintSum() {
    const { totalS } = E.timeline(st.project.shots, unit())
    $('#edSum', root).textContent = `${st.project.shots.length} plan${st.project.shots.length > 1 ? 's' : ''}, ${fmtTime(totalS)}${st.music ? `, ${st.music.name}` : ''}`
    $('#edUndo', root).disabled = !st.undo.length; $('#edRedo', root).disabled = !st.redo.length
  }
  function paintStrip() {
    const u = unit(), { totalS } = E.timeline(st.project.shots, u)
    const strip = $('#edStrip', root)
    strip.innerHTML = st.project.shots.map((s, i) => {
      const c = clipOf(s.clipId), len = E.shotLength(s, u), k = E.anchorOffset(s, u) / len
      const slowA = s.slow ? (s.lead * u) / len : 0, slowW = s.slow ? (2 * u) / len : 0
      const ticks = st.music?.bpm ? Math.round(len / u) : 0
      return `<button class="ed-shot${c ? '' : ' is-gone'}" role="option" data-i="${i}" aria-selected="${i === st.sel}" aria-label="Plan ${i + 1}, ${esc(c?.title || 'clip disparu')}, ${fmtS(len)}${s.slow ? ', ralenti' : ''}" style="flex-grow:${len.toFixed(3)}">
        ${c ? `<img src="${esc(c.thumbUrl)}" alt="" loading="lazy" draggable="false" data-fb="1">` : ''}
        ${ticks ? `<i class="ed-beats" style="background-size:calc(100% / ${ticks}) 100%"></i>` : ''}
        ${s.slow ? `<i class="ed-slow" style="left:${(slowA * 100).toFixed(2)}%;width:${(slowW * 100).toFixed(2)}%"></i>` : ''}
        <i class="ed-k" style="left:${(k * 100).toFixed(2)}%"></i>
        <span class="ed-sn num">${i + 1}</span>
      </button>`
    }).join('') + `<button class="ed-addb" id="edAdd" aria-label="Ajouter des clips" data-tip="Ajouter des clips" data-tip-t>${ic('plus')}</button>`
    strip.dataset.total = totalS
    $$('.ed-shot', strip).forEach((b) => {
      b.onclick = () => { st.sel = +b.dataset.i; stopPreview(); paint() }
    })
    $('#edAdd', strip).onclick = addClips
    $('.ed-shot[aria-selected=true]', strip)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  function paintSide() {
    const s = cur(), c = s && clipOf(s.clipId), u = unit(), m = st.music
    const side = $('#edSide', root)
    const step = (id, label, n, lo, hi) => `<div class="ed-row"><span>${label}</span><div class="ed-step" role="group" aria-label="${label}">
      <button class="btn sm icon" data-step="${id}" data-d="-1" aria-label="Moins" ${n <= lo ? 'disabled' : ''}>−</button><b class="num">${nTemps(n)}</b><button class="btn sm icon" data-step="${id}" data-d="1" aria-label="Plus" ${n >= hi ? 'disabled' : ''}>${ic('plus')}</button></div></div>`
    side.innerHTML = `<section class="ed-sec" aria-labelledby="edMusT">
        <h2 id="edMusT">Musique</h2>
        <button class="ed-music" id="edMusicBtn" aria-haspopup="menu">${ic('film')}<span>${m ? esc(m.name) : 'Choisir une musique'}</span>${m ? `<em class="num">${m.bpm ? `${Math.round(m.bpm)} BPM` : 'pas de tempo'}</em>` : ''}</button>
        ${m ? `<div class="ed-row"><span>Début</span><div class="ed-step" role="group" aria-label="Début de la musique"><button class="btn sm icon" id="edMusPrev" aria-label="Une mesure plus tôt" ${m.grid.length ? '' : 'disabled'}>−</button><b class="num">${fmtTime(st.project.music.startS)}</b><button class="btn sm icon" id="edMusNext" aria-label="Une mesure plus tard" ${m.grid.length ? '' : 'disabled'}>${ic('plus')}</button></div></div>
        <label class="ed-row"><span>Musique</span><input type="range" class="ed-vol" id="edVolM" min="0" max="100" step="5" value="${Math.round(st.project.music.volume * 100)}"></label>
        <label class="ed-row"><span>Son du jeu</span><input type="range" class="ed-vol" id="edVolG" min="0" max="100" step="5" value="${Math.round(st.project.gameVolume * 100)}"></label>` : '<p class="ed-note">Avec une musique, chaque coupe et chaque kill tombent sur un temps.</p>'}
      </section>
      ${s ? `<section class="ed-sec" aria-labelledby="edShotT">
        <h2 id="edShotT">Plan ${st.sel + 1} <span>sur ${st.project.shots.length}</span></h2>
        <p class="ed-clip">${esc(c ? `${kindWord(c)}, ${c.title}` : 'Ce clip a disparu de ton dossier.')}</p>
        ${step('lead', 'Avant le kill', s.lead, E.LIMITS.leadMin, E.LIMITS.leadMax)}
        ${step('tail', 'Après le kill', s.tail, E.LIMITS.tailMin, E.LIMITS.tailMax)}
        <div class="ed-row"><span id="edSlowL">Ralenti sur le kill</span><button class="sw" role="switch" id="edSlow" aria-labelledby="edSlowL" aria-checked="${s.slow}"><i></i></button></div>
        <div class="ed-acts">
          <button class="btn sm icon" id="edLeft" aria-label="Avancer ce plan" data-tip="Avancer, Alt ←" data-tip-t ${st.sel ? '' : 'disabled'}>${ic('back')}</button>
          <button class="btn sm icon ed-redo" id="edRight" aria-label="Reculer ce plan" data-tip="Reculer, Alt →" data-tip-t ${st.sel < st.project.shots.length - 1 ? '' : 'disabled'}>${ic('back')}</button>
          <button class="btn sm" id="edDel">${ic('trash')}Retirer ce plan</button>
        </div>
      </section>` : ''}`
    $('#edMusicBtn', side).onclick = (e) => (st.musics.some((x) => !x.missing) || st.music ? musicMenu(e.currentTarget) : pickMusic(e.currentTarget))
    $('#edMusPrev', side)?.addEventListener('click', () => shiftMusic(-4))
    $('#edMusNext', side)?.addEventListener('click', () => shiftMusic(4))
    const vol = (id, set) => { const r = $(id, side); if (!r) return; r.onchange = () => change(() => set(+r.value / 100)) }
    vol('#edVolM', (x) => { st.project.music.volume = x })
    vol('#edVolG', (x) => { st.project.gameVolume = x })
    $$('[data-step]', side).forEach((b) => b.onclick = () => edit({ [b.dataset.step]: cur()[b.dataset.step] + +b.dataset.d }))
    $('#edSlow', side)?.addEventListener('click', () => {
      const want = !cur().slow
      edit({ slow: want })
      if (want && !cur().slow) toast('Pas assez d’image autour de ce kill pour un ralenti.', { ms: 3000 })
    })
    $('#edLeft', side)?.addEventListener('click', () => move(-1))
    $('#edRight', side)?.addEventListener('click', () => move(1))
    $('#edDel', side)?.addEventListener('click', remove)
    $('#edReplan', root).onclick = () => confirmDel({ title: 'Refaire le montage ?', text: 'Player X refait les plans de ces clips sur la musique choisie. Tes retouches sont perdues (Annuler les ramène).', verb: 'Refaire le montage', onOk: replan })
  }
  function onKey(e) {
    if (e.target.matches?.('input')) return
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); back(st.undo, st.redo) }
    else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); back(st.redo, st.undo) }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); move(1) }
    else if (e.target.closest?.('.ed-strip') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); st.sel = clamp(st.sel + (e.key === 'ArrowLeft' ? -1 : 1), 0, st.project.shots.length - 1); paint(); $('.ed-shot[aria-selected=true]', root)?.focus()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.closest?.('.ed-strip')) { e.preventDefault(); remove() }
  }

  return { open, close, isOpen }
})()
