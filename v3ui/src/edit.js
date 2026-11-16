// L'éditeur de films : la musique, la bande des plans et leurs réglages, puis « Fabriquer le film ».
// Le projet ne contient que des identifiants (clips, musique) : le processus principal le revoit avant de fabriquer.
// La géométrie (pas, ralentis, coupes sur les temps, tempo) vient de Shared.editShots, la même que celle de la fabrication.
//
// Lot A : (1) le montage est gardé tout seul (brouillons dans localStorage) ; (2) l'aperçu joue avec la musique, une seule commande
// lecture/pause et une tête de lecture ; (3) tout se glisse à la souris (bords des plans, repère du kill, ordre) ; (4) le tempo
// de la musique se corrige. L'éditeur est construit une fois (build) ; les changements ne repeignent que la bande, la règle, le
// panneau de droite et le résumé : la vidéo n'est jamais rechargée par un réglage.
Object.assign(PATHS, {
  undo: '<path d="M8.500 5.500 4 10l4.500 4.500"/><path d="M4 10h10a5 5 0 0 1 0 10h-3.500"/>',
  note: '<path d="M9 18V6l10-2.200V16"/><circle cx="6.500" cy="18" r="2.500"/><circle cx="16.500" cy="16" r="2.500"/>'
})
const Editor = (() => {
  const E = Shared.editShots
  let host = null, root = null, st = null, onDone = null
  const FPS = 60 // le format des films (FILM_FORMAT) : les coupes de l'aperçu sont celles de la fabrication
  const clipOf = (id) => CLIPS.find((c) => c.id === id)
  const unit = () => (st.music ? E.unitOf(st.music.bpm) : st.lost ? st.lost.unit : E.PLAIN_UNIT)
  const r1 = (s) => Math.floor(Math.max(0, s) * 10 + 1e-6) % 10
  const fmtT = (s) => `${fmtTime(s)},${r1(s)}`
  const fmtS = (s) => `${(Math.round(s * 10) / 10).toLocaleString('fr-FR')} s`
  const nTemps = (n) => (st.music?.bpm ? `${n} temps` : fmtS(n * unit()))
  const isManual = (s) => clipOf(s.clipId)?.kind === 'manual'
  const kw = (s) => (isManual(s) ? 'le moment' : 'le kill')
  const isGuess = (c) => !!c && !(Array.isArray(c.events) && c.events.length)
  // Le début de la musique se recale sur la grille après une correction du tempo : on garde le début d'origine (`startRef`, dans
  // les temps d'avant correction) et on prend le temps le plus proche (à égalité, le suivant). Un aller-retour rend le même début.
  const nearest = (grid, ref) => { let b = grid[0] ?? 0; for (const t of grid) if (Math.abs(t - ref) <= Math.abs(b - ref) + 1e-6) b = t; return b }
  const refOf = (mu) => (mu ? (Number.isFinite(mu.startRef) ? mu.startRef : mu.startS) : 0)
  const sumLabel = (n, totalS) => `${n} plan${n > 1 ? 's' : ''}, ${fmtTime(totalS)}`

  // ---------- les brouillons : le montage est gardé tout seul ----------
  // { v, key, groupKey, at, ids, project, musicId, musicName, tempo, sel, unit, making } ; 8 au plus, le plus récent d'abord.
  const DKEY = 'pxv3-ed-drafts'
  const okDraft = (d) => !!d && typeof d.key === 'string' && d.project && Array.isArray(d.project.shots) && d.project.shots.length > 0
  const readDrafts = () => { try { const l = JSON.parse(localStorage.getItem(DKEY) || '[]'); return Array.isArray(l) ? l.filter(okDraft).slice(0, 8) : [] } catch { return [] } }
  const writeDrafts = (l) => { try { localStorage.setItem(DKEY, JSON.stringify(l.slice(0, 8))) } catch {} }
  const dropDraft = (key) => writeDrafts(readDrafts().filter((d) => d.key !== key))
  let saveT = 0
  function saveNow() {
    clearTimeout(saveT); saveT = 0
    if (!st) return
    const m = st.music
    const rec = {
      v: 1, key: st.key, groupKey: st.groupKey ?? null, at: Date.now(), ids: st.ids, project: st.project, sel: st.sel, unit: unit(),
      musicId: st.project.music?.id || null, musicName: m?.name || st.lost?.name || null,
      tempo: m ? { factor: m.factor ?? 1, half: !!m.half } : st.lost?.tempo || null, ...(st.making ? { making: true } : {})
    }
    writeDrafts([rec, ...readDrafts().filter((d) => d.key !== st.key)])
  }
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 400) }
  // Pour la page Clips : le brouillon d'un groupe (le plus récent), et de quoi l'écrire sur le lien
  const latestDraft = (groupKey) => (groupKey ? readDrafts().find((d) => d.groupKey === groupKey) || null : null)
  function draftOf(groupKey) {
    const d = latestDraft(groupKey)
    return d ? { n: d.project.shots.length, totalS: E.timeline(d.project.shots, d.unit > 0 ? d.unit : E.PLAIN_UNIT).totalS } : null
  }
  // Le film demandé depuis ce brouillon est prêt : le brouillon s'efface (la fabrication marque le brouillon « making »)
  function filmDone(s) {
    const l = readDrafts(), id = s?.fromClipId
    writeDrafts(l.filter((d) => !(d.making && (!id || d.project.shots.some((x) => x.clipId === id)))))
  }
  // Un film arrêté ou raté : le montage reste, sans la marque
  function filmUndone(s) {
    const id = s?.fromClipId
    writeDrafts(readDrafts().map((d) => (d.making && (!id || d.project.shots.some((x) => x.clipId === id)) ? { ...d, making: false } : d)))
  }

  // ---------- ouvrir ----------
  let opening = false
  async function open(ids, at, done, groupKey = null) {
    if (opening || root) return
    opening = true
    try { await open2(ids, at, done, groupKey) } finally { opening = false }
  }
  async function open2(ids, at, done, groupKey) {
    host = at; onDone = done
    const key = [...ids].sort().join(',')
    const musics = await API.editMusicList().catch(() => [])
    const d = readDrafts().find((x) => x.key === key)
    if (d) { st = restore(d, musics, ids, groupKey); mount(); return }
    const music = musics.find((m) => !m.missing) || null
    let r
    try { r = await API.editPlan(ids, music?.id || null) } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 6000 }); return }
    st = { key, groupKey, ids: [...ids], project: r.project, musics, music, lost: null, sel: 0, undo: [], redo: [], warn: null, tempoOpen: false, click: false, tab: 'plan', making: false, busy: false }
    if (r.skipped) toast(`${r.skipped} clip${r.skipped > 1 ? 's sont illisibles et sont laissés' : ' est illisible et est laissé'} de côté.`, { tone: 'warn', ms: 5000 })
    mount()
  }
  // « Reprendre le montage » sur un groupe de la page Clips
  async function resume(groupKey, at, done) {
    if (opening || root) return true
    const d = latestDraft(groupKey)
    if (!d) return false
    opening = true
    try { return await resume2(d, groupKey, at, done) } finally { opening = false }
  }
  async function resume2(d, groupKey, at, done) {
    host = at; onDone = done
    const musics = await API.editMusicList().catch(() => [])
    st = restore(d, musics, Array.isArray(d.ids) && d.ids.length ? d.ids : d.key.split(','), groupKey)
    mount()
    return true
  }
  // Un brouillon rouvert : chaque plan repasse par fitShot avec la durée actuelle de son clip. Un clip supprimé laisse son plan
  // (hachuré), une musique introuvable reste dans le projet (« introuvable »). Rien ne change en silence : un bandeau le dit.
  function restore(d, musics, ids, groupKey) {
    const s = { key: d.key, groupKey: groupKey ?? d.groupKey ?? null, ids: [...ids], project: JSON.parse(JSON.stringify(d.project)), musics, music: null, lost: null, sel: 0, undo: [], redo: [], warn: null, tempoOpen: false, click: false, tab: 'plan', making: false, busy: false }
    const p = s.project, d0 = d.unit > 0 ? d.unit : E.PLAIN_UNIT
    const said = []
    if (p.music) {
      const m = musics.find((x) => x.id === p.music.id)
      if (m && !m.missing) s.music = m
      else { s.lost = { id: p.music.id, name: m?.name || d.musicName || 'Musique', unit: d0, tempo: d.tempo || null }; said.push('la musique n’est plus à sa place') }
    }
    const u = s.music ? E.unitOf(s.music.bpm) : s.lost ? d0 : E.PLAIN_UNIT
    const k = d0 / u
    let gone = 0, trimmed = 0
    p.shots = p.shots.map((sh) => {
      const c = CLIPS.find((x) => x.id === sh.clipId)
      const lead = Math.round(sh.lead * k), tail = Math.round(sh.tail * k)
      if (!c) { gone++; return { ...sh, lead, tail } }
      const f = { ...E.fitShot({ ...sh, lead, tail }, c.durationS, u), ...(sh.fixed ? { fixed: true } : {}) }
      if (f.lead !== lead || f.tail !== tail || f.slow !== sh.slow) trimmed++
      return f
    })
    if (s.music && p.music && s.music.grid.length) { const ref = refOf(p.music); p.music.startRef = ref; p.music.startS = nearest(s.music.grid, ref) }
    if (gone) said.unshift(gone === 1 ? 'un clip a été supprimé' : `${gone} clips ont été supprimés`)
    if (trimmed) said.push(trimmed === 1 ? 'un plan a été raccourci' : `${trimmed} plans ont été raccourcis`)
    if (said.length) s.warn = `Depuis la dernière fois, ${said.length > 1 ? `${said.slice(0, -1).join(', ')} et ${said[said.length - 1]}` : said[0]}. <span>Le reste de ton montage est là.</span>`
    s.sel = clamp(Number.isInteger(d.sel) ? d.sel : 0, 0, p.shots.length - 1)
    return s
  }
  const isOpen = () => !!root

  // Une vidéo qui ne sert plus lâche son fichier (sous Windows, un fichier gardé ouvert ne se supprime pas)
  const drop = (v) => { if (v.getAttribute('src') === null) return; try { v.pause() } catch {} v.removeAttribute('src'); v.load(); v._cid = null; v._pre = -1; v._seek = null }
  function mount() {
    if (root) $$('video', root).forEach(drop)
    root?.remove()
    root = h(`<div class="ed" id="ed" role="region" aria-label="Monter un film"></div>`)
    host.append(root)
    $('#clipScroll', host).style.visibility = 'hidden'
    P.t = 0; P.pi = -1; P.front = 0; P.dirty = true; P.tok++; P.playing = false; P.audBad = null; P.audId = null; P.headTxt = ''
    build()
    layout(); P.t = P.starts[st.sel] || 0
    paintAll()
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('keyup', onKeyUp, true)
    addEventListener('pagehide', saveNow)
    $('#edMake', root)?.focus({ preventScroll: true })
  }
  function close() {
    if (!root) return
    cancelGesture()
    pause()
    saveNow()
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('keyup', onKeyUp, true)
    removeEventListener('pagehide', saveNow)
    P.ro?.disconnect(); P.ro = null
    try { P.aud?.pause(); P.aud?.removeAttribute('src'); P.aud?.load() } catch {}
    P.aud = null
    try { P.ctx?.close() } catch {}
    P.ctx = null
    $$('video', root).forEach(drop)
    root.remove(); root = null
    $('#clipScroll', host).style.visibility = ''
    onDone?.()
  }
  // La liste des clips a changé (ou on quitte la page) : le brouillon est gardé, les plans dont le clip a disparu sont repeints
  function sync() {
    if (!root || !st) return
    saveNow()
    P.dirty = true
    paintAll()
  }

  // ---------- changer le projet (annuler, rétablir) ----------
  // Une entrée d'annulation = le projet, la sélection, la musique choisie (ou introuvable) et sa correction de tempo
  const snap = () => JSON.stringify({ p: st.project, sel: st.sel, m: st.music?.id || null, l: st.lost, tf: st.music ? { factor: st.music.factor ?? 1, half: !!st.music.half } : null })
  const touched = () => { P.dirty = true; saveSoon() }
  function change(fn, { keepPlay = false } = {}) {
    if (P.playing && !keepPlay) pause()
    st.undo.push(snap()); if (st.undo.length > 100) st.undo.shift()
    st.redo = []
    fn()
    afterChange()
  }
  // Le projet a changé : la tête de lecture reste dans le plan choisi, la bande, le panneau et le résumé sont repeints
  function afterChange() {
    touched(); layout()
    if (!P.playing) { P.t = clamp(P.t, 0, P.total); const i = shotAt(P.t); if (i !== st.sel) P.t = P.starts[st.sel] || 0 }
    paintAll()
  }
  async function back(from, to) {
    if (!from.length || st.busy) return
    if (P.playing) pause()
    st.busy = true
    try {
      const cur = snap()
      const s = JSON.parse(from[from.length - 1])
      let m = s.m ? st.musics.find((x) => x.id === s.m && !x.missing) || null : null
      // La correction du tempo se réapplique par le processus principal (elle est gardée avec la musique)
      if (m && s.tf && ((m.factor ?? 1) !== s.tf.factor || !!m.half !== s.tf.half)) {
        try { m = await API.editMusicTempo(m.id, s.tf); st.musics = st.musics.map((x) => (x.id === m.id ? m : x)) } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 5000 }); return }
      }
      from.pop(); to.push(cur)
      st.project = s.p; st.sel = s.sel; st.music = m; st.lost = m ? null : s.l || null
      afterChange()
    } finally { st.busy = false }
  }
  const fit = (s) => {
    const c = clipOf(s.clipId)
    return c ? { ...E.fitShot(s, c.durationS, unit()), ...(s.fixed ? { fixed: true } : {}) } : s
  }
  const reach = (s, side) => fit({ ...s, [side]: E.LIMITS[side + 'Max'] })[side]

  // ---------- la musique ----------
  function setMusic(m, { keepStart = false } = {}) {
    const before = unit()
    change(() => {
      const was = st.project.music
      st.music = m; st.lost = null
      const u = unit()
      // Les plans gardent leur longueur en secondes, ramenée au nouveau pas
      st.project.shots = st.project.shots.map((s) => fit({ ...s, lead: Math.round((s.lead * before) / u), tail: Math.round((s.tail * before) / u) }))
      st.project.music = m ? { id: m.id, startS: keepStart && was && m.grid.length ? nearest(m.grid, refOf(was)) : m.grid[0] || 0, volume: was?.volume ?? 0.9 } : null
      if (m && st.project.music) st.project.music.startRef = st.project.music.startS
      st.project.gameVolume = m ? (was && st.project.gameVolume < 1 ? st.project.gameVolume : 0.5) : 1
      st.tempoOpen = false; st.click = false
    })
  }
  async function pickMusic(b) {
    b?.setAttribute('aria-busy', 'true')
    const lab = b && $('span', b), old = lab?.textContent
    if (lab) lab.textContent = 'Lecture de la musique…'
    try {
      const m = await API.editMusicPick()
      if (m) {
        const lost = st.lost
        st.musics = [m, ...st.musics.filter((x) => x.id !== m.id)]
        setMusic(m, { keepStart: !!lost })
        if (!m.bpm) toast('Pas de tempo net dans ce morceau : les coupes ne seront pas calées dessus.', { tone: 'warn', ms: 6000 })
        // Une musique retrouvée a un nouvel identifiant : la correction du tempo faite avant n'est pas reprise
        else if (lost && m.id !== lost.id && lost.tempo && (lost.tempo.factor !== 1 || lost.tempo.half)) toast('Le tempo de cette musique a été relu : ta correction n’est pas gardée. Corrige-le encore si besoin.', { tone: 'warn', ms: 7000 })
      }
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
    // Le début choisi sur la grille corrigée est ramené aux temps d'origine (un décalage d'un demi-temps en moins)
    change(() => { st.project.music.startS = g[j]; st.project.music.startRef = g[j] - (st.music.half && st.music.bpm ? 30 / st.music.bpm : 0) })
  }

  // ---------- corriger le tempo ----------
  // Toujours une demande absolue { factor, half } : le processus principal recalcule depuis les temps d'origine. Les plans gardent
  // leur longueur en secondes (ramenée au nouveau pas), le début de la musique se recale sur la nouvelle grille.
  async function setTempo(next) {
    const m = st.music
    if (!m || st.busy) return
    if (P.playing) pause()
    st.busy = true
    try {
      const pre = snap(), before = unit()
      let nm
      try { nm = await API.editMusicTempo(m.id, next) } catch (e) { return toast(esc(errText(e)), { tone: 'warn', ms: 5000 }) }
      st.undo.push(pre); if (st.undo.length > 100) st.undo.shift()
      st.redo = []
      st.musics = st.musics.map((x) => (x.id === nm.id ? nm : x)); st.music = nm
      const u = unit()
      st.project.shots = st.project.shots.map((s) => fit({ ...s, lead: Math.round((s.lead * before) / u), tail: Math.round((s.tail * before) / u) }))
      if (st.project.music && nm.grid.length) { const ref = refOf(st.project.music); st.project.music.startRef = ref; st.project.music.startS = nearest(nm.grid, ref) }
      P.clickN = -1
      afterChange()
    } finally { st.busy = false }
  }
  const tempoNext = (dir) => {
    const f = st.music?.factor ?? 1, n = dir > 0 ? f * 2 : f / 2
    return n === 0.5 || n === 1 || n === 2 ? n : null
  }
  const tempoOk = (dir) => { const n = tempoNext(dir); return n !== null && E.tempoBpm(st.music.bpm0 ?? st.music.bpm, n) !== null }

  // ---------- les plans ----------
  const cur = () => st.project.shots[st.sel]
  function edit(patch) {
    // Un réglage qui ne change rien (le clip n'a plus d'image de ce côté) n'entre pas dans l'historique
    const next = fit({ ...cur(), ...patch })
    if (['lead', 'tail', 'slow', 'anchorS'].every((k) => next[k] === cur()[k])) return
    change(() => { st.project.shots[st.sel] = next })
  }
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
      const ids = [...new Set(st.project.shots.map((s) => s.clipId))].filter(clipOf)
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
      <div class="cf-a"><button class="btn" id="edAddNo">Annuler</button><button class="ed-pill" id="edAddOk">Ajouter</button></div></dialog>`)
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

  // ---------- le film, ses morceaux, l'horloge ----------
  // P : tout ce que l'aperçu sait. `pieces` vient de Shared.editShots.filmPieces : exactement la liste de la fabrication.
  const P = { t: 0, playing: false, tok: 0, dirty: true, pieces: [], starts: [], total: 0, totalS: 0, pps: 1, off: 0, pi: -1, fresh: false, front: 0, vids: [], aud: null, audId: null, audBad: null, useAud: false, base: null, lastA: null, raf: 0, lastFix: 0, ctx: null, clickN: -1, headTxt: '', ro: null }
  function layout() {
    if (!P.dirty && P.pieces) return
    const u = unit(), shots = st.project.shots
    let f = 0
    P.pieces = E.filmPieces(shots, u, FPS).map((p) => { const o = { ...p, t0: f / FPS, t1: (f + p.frames) / FPS }; f += p.frames; return o })
    P.total = f / FPS
    const tl = E.timeline(shots, u)
    // Les débuts de plans suivent les mêmes arrondis à l'image que les coupes (total des morceaux des plans d'avant)
    P.starts = shots.map((_, i) => (i ? E.filmPieces(shots.slice(0, i), u, FPS).reduce((n, x) => n + x.frames, 0) / FPS : 0))
    P.totalS = tl.totalS
    P.dirty = false
  }
  function shotAt(t) { let i = P.starts.length - 1; while (i > 0 && P.starts[i] > t + 1e-6) i--; return Math.max(0, i) }
  function pieceIndexAt(t) { const l = P.pieces; let i = l.length - 1; while (i > 0 && l[i].t0 > t + 1e-6) i--; return i }
  const clipTime = (p, t) => Math.min(p.outS, p.inS + Math.max(0, t - p.t0) * p.speed)
  const front = () => P.vids[P.front]

  // La vidéo d'un clip : `src` ne change que si le clip change ; un temps différent est une avance (seek), jamais un rechargement
  function cue(v, c, time) {
    if (v._cid !== c.id) {
      v._cid = c.id; v._seek = time; v._pre = -1
      v.poster = c.thumbUrl
      v.onloadedmetadata = () => { v.onloadedmetadata = null; if (v._seek != null) { v.currentTime = v._seek; v._seek = null } }
      v.src = c.videoUrl
    } else if (v.readyState >= 1) { v.currentTime = time; v._seek = null } else v._seek = time
  }
  const gameVol = () => clamp(st.project.gameVolume ?? 1, 0, 1)
  function show(v, on) { v.classList.toggle('is-front', on) }
  // Au repos : l'image du film au temps P.t (ou d'un clip précis, pendant qu'on glisse le repère)
  function showFrame(clipTimeOverride) {
    const pic = $('#edPic', root); if (!pic) return
    layout()
    const i = shotAt(P.t), s = st.project.shots[i], p = P.pieces[pieceIndexAt(P.t)]
    const c = clipOf((p && p.clipId) || s?.clipId)
    pic.classList.toggle('is-gone', !!s && !c)
    if (!c) { P.vids.forEach((v) => { show(v, false); drop(v) }); return }
    const v = front()
    cue(v, c, clipTimeOverride ?? (p ? clipTime(p, P.t) : s.anchorS))
    show(v, true); show(P.vids[1 - P.front], false)
  }
  function prepare(v, p, pi) {
    const c = clipOf(p.clipId); if (!c) return
    cue(v, c, p.inS)
    v.pause(); v.playbackRate = p.speed; v.volume = gameVol(); v._pre = pi
  }
  // Une coupe : la vidéo suivante (déjà préchargée) passe devant, l'autre se range. Au départ de la lecture, la vidéo déjà devant
  // sert tout de suite si c'est le même clip : pas de second chargement.
  function cutTo(pi) {
    const p = P.pieces[pi]; if (!p) return
    const c = clipOf(p.clipId), prevV = front()
    P.pi = pi
    $('#edPic', root).classList.toggle('is-gone', !c)
    if (!c) { P.vids.forEach((v) => { show(v, false); drop(v) }); return }
    let v
    if (P.fresh && prevV._cid === c.id) v = prevV
    else { v = P.vids[1 - P.front]; if (v._pre !== pi) prepare(v, p, pi) }
    P.fresh = false
    if (v !== prevV) { P.front = 1 - P.front; prevV.pause(); show(prevV, false) }
    show(v, true)
    v.volume = gameVol(); v.playbackRate = p.speed
    const want = clipTime(p, P.t)
    if (Math.abs(v.currentTime - want) > 0.15 || v._seek != null) cue(v, c, want)
    v.play().catch(() => {})
  }
  const clockNow = () => performance.now()
  function audioFor(m) {
    if (!m || P.audBad === m.id) return null
    if (!P.aud) {
      const a = new Audio(); a.preload = 'auto'
      a.addEventListener('error', () => {
        if (!P.audId || P.audBad === P.audId) return
        P.audBad = P.audId
        toast('Cette musique ne se lit pas dans l’aperçu. Le film, lui, la gardera.', { tone: 'warn', ms: 5000 })
        fallBack()
      })
      P.aud = a
    }
    if (P.audId !== m.id) { P.audId = m.id; P.aud.src = `pxclip://music/${m.id}`; P.audBad = null }
    P.aud.volume = clamp(st.project.music?.volume ?? 0.9, 0, 1)
    return P.aud
  }
  // L'horloge : la musique est le maître. Si elle échoue, cale ou finit avant le film, on repasse sur l'horloge de la page :
  // l'aperçu ne gèle jamais.
  const musicEnd = () => Math.min(st.music?.durationS || Infinity, Number.isFinite(P.aud?.duration) ? P.aud.duration : Infinity)
  function fallBack() {
    if (!P.useAud) return
    P.useAud = false
    P.base = { perf: clockNow(), t: P.t }
    try { P.aud.pause() } catch {}
  }
  function clockT() {
    const now = clockNow()
    if (P.useAud) {
      const a = P.aud
      if (a.ended || a.error || a.paused || a.currentTime >= musicEnd() - 0.02) fallBack()
      else if (a.currentTime !== P.lastA.ct) P.lastA = { ct: a.currentTime, perf: now }
      else if (now - P.lastA.perf > 700) fallBack()
      if (P.useAud) return a.currentTime - st.project.music.startS
    }
    return P.base.t + (now - P.base.perf) / 1000
  }
  function play() {
    if (P.playing || !st) return
    layout()
    if (!P.pieces.length) return
    if (P.t >= P.total - 0.05) P.t = 0
    const tok = ++P.tok
    P.playing = true; P.pi = -1; P.fresh = true; P.useAud = false; P.clickN = -1
    P.vids.forEach((v) => { v._pre = -1 })
    if (st.click) clickCtx()
    paintPlay()
    let a = st.music && st.project.music ? audioFor(st.music) : null
    // La tête est au-delà de la fin du morceau : pas de musique (elle repartirait de 0), l'horloge de la page
    if (a && st.project.music.startS + P.t >= musicEnd() - 0.05) a = null
    const begin = (withAudio) => {
      if (tok !== P.tok || !P.playing) return
      P.useAud = withAudio
      P.base = { perf: clockNow(), t: P.t }
      P.lastA = { ct: a ? a.currentTime : 0, perf: clockNow() }
      cutTo(pieceIndexAt(P.t))
      P.raf = requestAnimationFrame(tick)
    }
    if (!a) return begin(false)
    try { a.currentTime = st.project.music.startS + P.t } catch {}
    let over = false
    const go = () => { if (over) return; over = true; clearTimeout(tm); a.removeEventListener('playing', go); begin(true) }
    const bad = (slow) => {
      if (over) return; over = true; clearTimeout(tm); a.removeEventListener('playing', go); try { a.pause() } catch {}
      if (slow === true && !a.error) toast('La musique met du temps à démarrer : l’aperçu joue sans elle cette fois.', { ms: 3000 })
      begin(false)
    }
    const tm = setTimeout(() => bad(true), 1500)
    a.addEventListener('playing', go)
    a.play().catch(() => bad(false))
  }
  function pause() {
    P.tok++
    cancelAnimationFrame(P.raf)
    const was = P.playing
    P.playing = false; P.useAud = false
    if (was) { P.vids.forEach((v) => v.pause()); try { P.aud?.pause() } catch {} }
    if (root) { paintPlay(); paintHead() }
  }
  const toggle = () => (P.playing ? pause() : play())
  function tick() {
    if (!P.playing || !root) return
    const t = clockT()
    if (t >= P.total - 1e-3) { P.t = P.total; pause(); paintHead(); return }
    P.t = Math.max(0, t)
    const pi = pieceIndexAt(P.t)
    if (pi !== P.pi) cutTo(pi)
    const p = P.pieces[P.pi]
    if (p) {
      const v = front(), want = clipTime(p, P.t), now = clockNow()
      // La vidéo se recale si elle s'écarte de plus de 0,15 s, pas plus d'une fois par quart de seconde
      if (clipOf(p.clipId) && v.readyState >= 2 && Math.abs(v.currentTime - want) > 0.15 && now - P.lastFix > 250) { v.currentTime = want; P.lastFix = now }
      if (v.paused && clipOf(p.clipId)) v.play().catch(() => {})
      // La coupe suivante est préparée à l'avance, sur l'autre vidéo
      const nx = P.pieces[P.pi + 1], o = P.vids[1 - P.front]
      if (nx && p.t1 - P.t < 0.9 && o._pre !== P.pi + 1) prepare(o, nx, P.pi + 1)
    }
    const i = shotAt(P.t)
    if (i !== st.sel) { st.sel = i; paintStrip(); paintSide() }
    scheduleClicks()
    paintHead()
    P.raf = requestAnimationFrame(tick)
  }
  // Aller à ce temps du film (la lecture, si elle tournait, reprend de là)
  function seek(t, { keepSel = false, resume = false } = {}) {
    const was = P.playing && resume
    if (P.playing) pause()
    layout()
    P.t = clamp(t, 0, P.total)
    if (!keepSel) { const i = shotAt(P.t); if (i !== st.sel) { st.sel = i; paintStrip(); paintSide() } }
    showFrame(); paintHead()
    if (was) play()
  }

  // ---------- « Écouter les temps » : un clic court par temps, avec son propre AudioContext ----------
  // Le clic du temps n joue à n × pas dans le film : la musique commence sur un temps (startS), donc il tombe sur ses temps.
  function clickCtx() {
    if (!P.ctx) { try { P.ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { P.ctx = null } }
    P.ctx?.resume?.()
    return P.ctx
  }
  function blip(at, freq) {
    const c = P.ctx; if (!c) return
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'square'; o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.28, at + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04)
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.05)
  }
  function scheduleClicks() {
    if (!st.click || !P.ctx || !P.playing) return
    const u = unit(), t = P.t, ahead = 0.12
    if (P.clickN < 0) P.clickN = Math.ceil(t / u - 1e-6)
    while (P.clickN * u <= t + ahead) {
      const n = P.clickN++, tn = n * u
      if (tn < t - 0.03) continue
      blip(P.ctx.currentTime + Math.max(0, tn - t), n % 4 === 0 ? 2300 : 1700)
    }
  }

  // ---------- fabriquer ----------
  const goneN = () => st.project.shots.filter((s) => !clipOf(s.clipId)).length
  const blocked = () => goneN() > 0 || !!st.lost
  async function make(b) {
    if (b.getAttribute('aria-busy')) return
    if (blocked()) {
      const g = goneN() > 0, m = !!st.lost
      return toast(g && m ? 'Retire d’abord le plan vide et règle la musique.' : g ? 'Retire d’abord le plan dont le clip est supprimé.' : 'Règle d’abord la musique : retrouve le fichier, ou continue sans.', { tone: 'warn', ms: 4500 })
    }
    b.setAttribute('aria-busy', 'true')
    try {
      const project = { ...st.project, shots: st.project.shots.map(({ clipId, anchorS, lead, tail, slow }) => ({ clipId, anchorS, lead, tail, slow })) }
      await API.editFilmStart(project)
      // Le brouillon reste jusqu'à ce que le film soit prêt (la page Clips l'efface alors) ; marqué pour le retrouver
      st.making = true
      close()
    } catch (e) { b.removeAttribute('aria-busy'); toast(esc(errText(e)), { tone: 'warn', ms: 7000 }) }
  }

  // ---------- dessin ----------
  function build() {
    root.innerHTML = `<header class="ed-head">
        <button class="ed-lnk" id="edBack" data-tip="Revenir, Échap" data-tip-b>${ic('back')}Revenir aux clips</button>
        <div class="ed-ttl"><h1>Monter un film</h1><p class="num" id="edSum"></p></div>
        <button class="ed-pill" id="edMake">${ic('film')}<span>Fabriquer le film</span></button>
      </header>
      <div id="edWarnBox"></div>
      <div class="ed-body">
        <div class="ed-main">
          <div class="ed-frame"><div class="ed-pic" id="edPic"><video id="edVid" playsinline preload="auto"></video><video id="edVidB" playsinline preload="auto"></video><span class="ed-goneT">Ce clip a été supprimé</span><span class="ed-tag" id="edTag" hidden></span></div></div>
          <div class="ed-tr">
            <button class="ed-play" id="edPlay"></button>
            <span class="ed-time num" id="edTime"></span>
            <span class="ed-key" aria-hidden="true">Espace</span>
            <span class="ed-ur"><button class="ed-lnk" id="edReplan">${ic('refresh')}Refaire le montage</button><button class="ed-ib" id="edUndo" aria-label="Annuler" data-tip="Annuler, Ctrl Z" data-tip-b>${ic('undo')}</button><button class="ed-ib flip" id="edRedo" aria-label="Rétablir" data-tip="Rétablir, Ctrl Y" data-tip-b>${ic('undo')}</button></span>
          </div>
        </div>
        <aside class="ed-side" id="edSide"></aside>
      </div>
      <div class="ed-tl"><div class="ed-tb" id="edTb"><div class="ed-rule" id="edRule" data-scrub></div><div class="ed-track" id="edTrack" role="listbox" aria-label="Les plans du film" aria-orientation="horizontal"></div><div class="ed-ph" id="edPh"><b class="num"></b></div><div id="edOv"></div></div><button class="ed-addb" id="edAdd" aria-label="Ajouter des clips" data-tip="Ajouter des clips" data-tip-t>${ic('plus')}</button></div>`
    P.vids = [$('#edVid', root), $('#edVidB', root)]
    P.vids.forEach((v) => { v.volume = gameVol() })
    $('#edBack', root).onclick = close
    $('#edMake', root).onclick = (e) => make(e.currentTarget)
    $('#edPlay', root).onclick = toggle
    $('#edUndo', root).onclick = () => back(st.undo, st.redo)
    $('#edRedo', root).onclick = () => back(st.redo, st.undo)
    $('#edAdd', root).onclick = addClips
    $('#edReplan', root).onclick = () => confirmDel({ title: 'Refaire le montage ?', text: 'Player X refait les plans de ces clips sur la musique choisie. Tes retouches sont perdues (Annuler les ramène).', verb: 'Refaire le montage', onOk: replan })
    const tb = $('#edTb', root)
    tb.onpointerdown = onDown; tb.onpointermove = onMove; tb.onpointerup = onUp
    tb.onpointercancel = () => cancelGesture()
    tb.onlostpointercapture = () => { if (G && !G.done) cancelGesture() }
    P.ro?.disconnect()
    P.ro = new ResizeObserver(() => { if (root) paintStrip() })
    P.ro.observe(tb)
  }
  function paintAll() {
    if (!root) return
    layout()
    paintWarn(); paintSum(); paintPlay(); paintStrip(); paintSide(); if (!P.playing) showFrame()
    paintHead()
  }
  function paintWarn() {
    const box = $('#edWarnBox', root); if (!box) return
    if (!st.warn) { box.innerHTML = ''; return }
    if (box.dataset.w === st.warn) return
    box.dataset.w = st.warn
    box.innerHTML = `<div class="ed-warn" role="status">${ic('warn')}<p>${st.warn}</p><button class="ed-ib" id="edWarnX" aria-label="Fermer">${ic('close')}</button></div>`
    $('#edWarnX', box).onclick = () => { st.warn = null; box.dataset.w = ''; box.innerHTML = '' }
  }
  function paintSum() {
    const tb = P.totalS
    $('#edSum', root).innerHTML = `${sumLabel(st.project.shots.length, tb)}. <span class="ok">Ton montage est gardé tout seul.</span>`
    $('#edUndo', root).disabled = !st.undo.length; $('#edRedo', root).disabled = !st.redo.length
    $('#edMake', root).setAttribute('aria-disabled', blocked())
  }
  function paintPlay() {
    const b = root && $('#edPlay', root); if (!b) return
    b.innerHTML = ic(P.playing ? 'pause' : 'play'); b.setAttribute('aria-label', P.playing ? 'Pause' : 'Lecture')
  }
  // La tête de lecture, le temps, les points des temps, le texte sur l'image
  function paintHead() {
    if (!root) return
    const ph = $('#edPh', root), u = unit()
    ph.hidden = !!G && G.k !== 'scrub'
    ph.style.transform = `translateX(${(P.t * P.pps + P.off).toFixed(1)}px)`
    const txt = `${fmtTime(P.t)}|${fmtT(P.t)}|${fmtTime(P.totalS)}`
    if (txt !== P.headTxt) {
      P.headTxt = txt
      ph.firstElementChild.textContent = fmtTime(P.t)
      $('#edTime', root).innerHTML = `${fmtT(P.t)} <span>/ ${fmtTime(P.totalS)}</span>`
    }
    const dots = $('.ed-dots', root)
    if (dots) { const k = Math.floor(P.t / u + 1e-6); [...dots.children].forEach((e, j) => e.classList.toggle('on', P.playing && ((k % 4) + 4) % 4 === j)) }
    const tag = $('#edTag', root)
    let say = ''
    if (G?.k === 'kill') say = `L’image à ${fmtT(G.clipT).slice(3)} s du clip`
    else if (P.playing) { const p = P.pieces[P.pi]; if (p && p.speed < 1) say = 'Ralenti' }
    else { const p = P.pieces[pieceIndexAt(P.t)]; if (p && p.speed < 1) say = 'Ralenti' }
    tag.hidden = !say; if (say && tag.textContent !== say) tag.textContent = say
  }
  // La bande : les plans posés au pixel près (largeur = durée dans le film), la règle du temps, les poignées, le repère du kill
  function shotHTML(s, c) {
    return c
      ? `<img src="${esc(c.thumbUrl)}" alt="" draggable="false" data-fb="1"><i class="ed-beats"></i><i class="ed-slow"></i><i class="ed-k" data-h="k" role="slider" aria-label="Repère du moment"></i><i class="ed-g l" data-h="l" role="slider" aria-label="Début du plan"></i><i class="ed-g r" data-h="r" role="slider" aria-label="Fin du plan"></i><span class="ed-sn num"></span>`
      : `<span class="ed-gone">Clip supprimé</span><span class="ed-sn num"></span>`
  }
  function paintStrip() {
    const tb = $('#edTb', root); if (!tb) return
    const W = tb.clientWidth; if (!W) return
    layout()
    const u = unit(), shots = st.project.shots, g = G
    const tl = E.timeline(shots, u)
    const pps = g?.k === 'edge' && g.pps ? g.pps : W / Math.max(tl.totalS, 0.001)
    P.pps = pps
    P.off = g?.k === 'edge' && g.side === 'l' ? -(shots[g.i].lead - g.v0) * u * pps : 0
    const bp = u * pps
    // La règle : un repère de temps tous les 1, 2, 5, 10… s selon la place ; les temps de la musique pendant la correction du tempo
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300]
    const step = steps.find((x) => x * pps >= 78) || 600
    let rule = ''
    for (let s = 0; s < tl.totalS - 0.5; s += step) rule += `<span class="num" style="left:${(s * pps).toFixed(1)}px">${fmtTime(s)}</span>`
    if (st.tempoOpen && st.music?.bpm) for (let k = 0; k * u < tl.totalS; k++) rule += `<i class="${k % 4 ? '' : 'b1'}" style="left:${(k * bp).toFixed(1)}px"></i>`
    const rl = $('#edRule', tb)
    rl.className = `ed-rule${st.tempoOpen && st.music?.bpm ? ' is-beats' : ''}`
    rl.style.translate = `${P.off.toFixed(1)}px 0`
    rl.innerHTML = rule
    const tr = $('#edTrack', tb)
    tr.classList.toggle('no-anim', !!g)
    tr.style.translate = `${P.off.toFixed(1)}px 0`
    while (tr.children.length > shots.length) tr.lastElementChild.remove()
    shots.forEach((s, i) => {
      let el = tr.children[i]
      if (!el) { el = document.createElement('div'); el.className = 'ed-shot'; el.setAttribute('role', 'option'); tr.append(el) }
      const c = clipOf(s.clipId), len = E.shotLength(s, u), gone = !c
      const sig = `${s.clipId}|${gone ? 1 : 0}`
      if (el.dataset.sig !== sig) { el.dataset.sig = sig; el.innerHTML = shotHTML(s, c) }
      el.dataset.i = i
      el.className = `ed-shot${i === st.sel ? ' is-sel' : ''}${gone ? ' is-gone' : ''}${g?.k === 'move' && g.i === i ? ' is-lift' : ''}`
      el.setAttribute('aria-selected', i === st.sel); el.tabIndex = i === st.sel ? 0 : -1
      el.setAttribute('aria-label', `Plan ${i + 1}, ${gone ? 'clip supprimé' : c.title}`)
      el.style.left = `${(tl.starts[i] * pps).toFixed(1)}px`; el.style.width = `${Math.max(2, len * pps - 3).toFixed(1)}px`
      el.querySelector('.ed-sn').textContent = i + 1
      if (gone) return
      const bt = el.querySelector('.ed-beats')
      bt.hidden = !st.music?.bpm; bt.style.backgroundSize = `${bp.toFixed(3)}px 100%`
      const sl = el.querySelector('.ed-slow'); sl.hidden = !s.slow
      if (s.slow) { sl.style.left = `${((s.lead * u) / len * 100).toFixed(2)}%`; sl.style.width = `${((2 * u) / len * 100).toFixed(2)}%` }
      const kOn = g?.k === 'kill' && g.i === i
      const k = el.querySelector('.ed-k'), kpos = (E.anchorOffset(s, u) + (kOn ? g.dbS : 0)) / len
      k.style.left = `${(kpos * 100).toFixed(2)}%`
      k.classList.toggle('is-guess', isGuess(c) && !s.fixed); k.classList.toggle('is-on', kOn)
      const gl = el.querySelector('.ed-g.l'), gr = el.querySelector('.ed-g.r')
      gl.classList.toggle('is-on', g?.k === 'edge' && g.i === i && g.side === 'l'); gr.classList.toggle('is-on', g?.k === 'edge' && g.i === i && g.side === 'r')
      const tab = i === st.sel ? 0 : -1
      k.tabIndex = tab; gl.tabIndex = tab; gr.tabIndex = tab
    })
    // Ce qui se montre pendant un glisser : la bulle, l'ancienne place, le plan qui vole, le trait d'insertion
    let extra = ''
    if (g?.k === 'edge') {
      const s = shots[g.i], isL = g.side === 'l', x = (isL ? tl.starts[g.i] : tl.starts[g.i] + E.shotLength(s, u)) * pps + P.off
      const x0 = isL ? x + (s.lead - g.v0) * bp : x - (s.tail - g.v0) * bp
      const v = isL ? s.lead : s.tail
      extra = `<i class="ed-was" style="left:${x0.toFixed(1)}px"></i><div class="ed-bub num" style="left:${clamp(x, 110, W - 110).toFixed(1)}px">${isL ? 'Avant' : 'Après'} ${kw(s)} : ${nTemps(v)}${g.limited ? ' <span>(le clip s’arrête là)</span>' : ''}</div>`
    } else if (g?.k === 'kill') {
      const s = shots[g.i], x = (tl.starts[g.i] + E.anchorOffset(s, u) + g.dbS) * pps
      extra = `<div class="ed-bub num" style="left:${clamp(x, 110, W - 110).toFixed(1)}px">${isManual(s) ? 'Le moment' : 'Le kill'} : à ${fmtT(g.clipT).slice(3)} s du clip</div>`
    } else if (g?.k === 'move') {
      const s = shots[g.i], c = clipOf(s.clipId), w = E.shotLength(s, u) * pps - 3
      const xi = (g.to >= shots.length ? tl.totalS : tl.starts[g.to]) * pps
      const place = g.to > g.i ? g.to : g.to + 1
      extra = `<i class="ed-ins" style="left:${xi.toFixed(1)}px"></i><div class="ed-fly" style="left:${(g.x - g.grab).toFixed(1)}px;width:${w.toFixed(1)}px">${c ? `<img src="${esc(c.thumbUrl)}" alt="">` : ''}</div>
        <div class="ed-bub num" style="left:${clamp(g.x - g.grab + w / 2, 110, W - 110).toFixed(1)}px">${place === g.i + 1 ? `Plan ${g.i + 1}` : `Plan ${g.i + 1}, en place ${place}`}</div>`
    }
    $('#edOv', tb).innerHTML = extra
  }
  // Le panneau de droite : la musique (ou la correction du tempo), puis le plan choisi. À 1280 × 720, deux onglets.
  function paintSide() {
    const side = $('#edSide', root); if (!side) return
    const had = document.activeElement && side.contains(document.activeElement) ? document.activeElement.dataset.fk || document.activeElement.id : null
    const s = cur(), c = s && clipOf(s.clipId), u = unit(), m = st.music, n = st.project.shots.length, i = st.sel
    const gone = s && !c, k = s ? kw(s) : 'le kill'
    const step = (id, label, v, lo, hi) => `<div class="ed-row"><span>${label}</span><div class="ed-step" role="group" aria-label="${label}">
      <button class="ed-ib" id="edS-${id}-m" data-step="${id}" data-d="-1" aria-label="Moins" ${v <= lo ? 'disabled' : ''}>−</button><b class="num">${nTemps(v)}</b><button class="ed-ib" id="edS-${id}-p" data-step="${id}" data-d="1" aria-label="Plus" ${v >= hi ? 'disabled' : ''}>${ic('plus')}</button></div></div>`
    let mus
    if (st.lost) {
      mus = `<h2><b>Musique</b></h2>
        <button class="ed-music is-lost" id="edMusicBtn" aria-haspopup="false" disabled>${ic('warn')}<span>${esc(st.lost.name)}</span><em>introuvable</em></button>
        <p class="ed-note">Le fichier a été déplacé ou supprimé. Tes réglages de musique sont gardés.</p>
        <div class="ed-foot"><button class="ed-lnk" id="edFind">${ic('folder')}<span>Retrouver le fichier</span></button><button class="ed-lnk" id="edNoMus">${ic('close')}Continuer sans musique</button></div>`
    } else if (!m) {
      mus = `<h2><b>Musique</b></h2><button class="ed-music" id="edMusicBtn" aria-haspopup="menu">${ic('plus')}<span>Choisir une musique</span></button><p class="ed-note">Avec une musique, chaque coupe et chaque kill tombent sur un temps.</p>`
    } else if (st.tempoOpen && m.bpm) {
      mus = `<h2><b>Corriger le tempo</b><button class="ed-lnk" id="edTempoEnd">Terminé</button></h2>
        <p class="ed-note">Les coupes tombent à côté des temps ? Écoute le clic, puis corrige.</p>
        <div class="ed-row"><span id="edClickL">Écouter les temps</span><span style="display:flex;align-items:center"><span class="ed-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></span><button class="sw" role="switch" id="edClick" aria-labelledby="edClickL" aria-checked="${st.click}"><i></i></button></span></div>
        <div class="ed-row"><span>Tempo</span><div class="ed-step" role="group" aria-label="Tempo"><button class="ed-ib txt" id="edTfDiv" aria-label="Diviser par deux" ${tempoOk(-1) ? '' : 'disabled'}>÷2</button><b class="num">${Math.round(m.bpm)} BPM</b><button class="ed-ib txt" id="edTfMul" aria-label="Multiplier par deux" ${tempoOk(1) ? '' : 'disabled'}>×2</button></div></div>
        <div class="ed-row"><span id="edHalfL">Décaler d’un demi-temps</span><button class="sw" role="switch" id="edHalf" aria-labelledby="edHalfL" aria-checked="${!!m.half}"><i></i></button></div>`
    } else {
      mus = `<h2><b>Musique</b></h2>
        <button class="ed-music" id="edMusicBtn" aria-haspopup="menu">${ic('note')}<span>${esc(m.name)}</span>${ic('chevd')}</button>
        <div class="ed-row"><span>Tempo</span><span class="ed-tempo">${m.bpm ? `<b class="num">${Math.round(m.bpm)} BPM</b><button class="ed-lnk" id="edTempoOpen">Corriger</button>` : '<b>pas de tempo</b>'}</span></div>
        <div class="ed-row"><span>Début</span><div class="ed-step" role="group" aria-label="Début de la musique"><button class="ed-ib" id="edMusPrev" aria-label="Une mesure plus tôt" ${m.grid.length ? '' : 'disabled'}>−</button><b class="num">${fmtT(st.project.music.startS)}</b><button class="ed-ib" id="edMusNext" aria-label="Une mesure plus tard" ${m.grid.length ? '' : 'disabled'}>${ic('plus')}</button></div></div>
        <label class="ed-row"><span>Musique</span><input type="range" class="ed-vol" id="edVolM" min="0" max="100" step="5" value="${Math.round(st.project.music.volume * 100)}"></label>
        <label class="ed-row"><span>Son du jeu</span><input type="range" class="ed-vol" id="edVolG" min="0" max="100" step="5" value="${Math.round(st.project.gameVolume * 100)}"></label>`
    }
    const hint = !s || gone ? '' : isGuess(c) && !s.fixed ? 'Moment deviné. Glisse le repère s’il tombe à côté.' : isManual(s) && !s.fixed ? 'Glisse le repère rouge sur le moment à montrer.' : s.slow ? 'Le son du ralenti peut changer un peu dans le film.' : ''
    const lo = (side) => (!s.slow && (side === 'lead' ? s.tail : s.lead) === 0 ? 1 : E.LIMITS[side + 'Min'])
    const plan = !s ? '' : `<h2><b>Plan ${i + 1} <span>sur ${n}</span></b><button class="ed-ib" id="edLeft" aria-label="Avancer ce plan" data-tip="Avancer, Alt ←" data-tip-t ${i ? '' : 'disabled'}>${ic('back')}</button><button class="ed-ib flip" id="edRight" aria-label="Reculer ce plan" data-tip="Reculer, Alt →" data-tip-t ${i < n - 1 ? '' : 'disabled'}>${ic('back')}</button></h2>
      ${gone ? `<p class="ed-note ed-goneN">Le clip de ce plan a été supprimé de ton dossier. Le plan ne peut plus être montré.</p><div class="ed-foot"><button class="ed-lnk" id="edDel">${ic('trash')}Retirer ce plan</button></div>`
      : `<p class="ed-clip">${esc(`${c.title}${c.round ? `, round ${c.round}` : ''}`)}</p>
      ${step('lead', `Avant ${k}`, s.lead, lo('lead'), reach(s, 'lead'))}
      ${step('tail', `Après ${k}`, s.tail, lo('tail'), reach(s, 'tail'))}
      <div class="ed-row"><span id="edSlowL">Ralenti sur ${k}</span><button class="sw" role="switch" id="edSlow" aria-labelledby="edSlowL" aria-checked="${s.slow}"><i></i></button></div>
      ${hint ? `<p class="ed-note">${hint}</p>` : ''}
      <div class="ed-foot"><button class="ed-lnk" id="edDel">${ic('trash')}Retirer ce plan</button></div>`}`
    side.dataset.show = st.tab
    side.innerHTML = `<div class="ed-tabs pills" role="group" aria-label="Réglages"><button class="pill" data-tab="plan" aria-pressed="${st.tab === 'plan'}">Plan ${i + 1}</button><button class="pill" data-tab="mus" aria-pressed="${st.tab === 'mus'}">Musique</button></div>
      <section class="ed-sec ed-s-mus">${mus}</section>${plan ? `<section class="ed-sec ed-s-plan">${plan}</section>` : ''}`
    $$('[data-tab]', side).forEach((b) => b.onclick = () => { st.tab = b.dataset.tab; paintSide() })
    const mb = $('#edMusicBtn', side)
    if (mb && !st.lost) mb.onclick = (e) => (st.musics.some((x) => !x.missing) || st.music ? musicMenu(e.currentTarget) : pickMusic(e.currentTarget))
    $('#edFind', side)?.addEventListener('click', (e) => pickMusic(e.currentTarget))
    $('#edNoMus', side)?.addEventListener('click', () => { setMusic(null); toast('Le film se fera sans musique.', { ms: 2600 }) })
    $('#edMusPrev', side)?.addEventListener('click', () => shiftMusic(-4))
    $('#edMusNext', side)?.addEventListener('click', () => shiftMusic(4))
    // Les curseurs de volume s'entendent tout de suite ; le réglage entre dans l'historique au relâché
    const vol = (id, set, live) => { const r = $(id, side); if (!r) return; r.oninput = () => live(+r.value / 100); r.onchange = () => change(() => set(+r.value / 100), { keepPlay: true }) }
    vol('#edVolM', (x) => { st.project.music.volume = x }, (x) => { if (P.aud) P.aud.volume = x })
    vol('#edVolG', (x) => { st.project.gameVolume = x }, (x) => P.vids.forEach((v) => { v.volume = x }))
    $('#edTempoOpen', side)?.addEventListener('click', () => { st.tempoOpen = true; st.tab = 'mus'; paintSide(); paintStrip(); $('#edClick', root)?.focus({ preventScroll: true }) })
    $('#edTempoEnd', side)?.addEventListener('click', () => { st.tempoOpen = false; st.click = false; paintSide(); paintStrip(); $('#edTempoOpen', root)?.focus({ preventScroll: true }) })
    $('#edClick', side)?.addEventListener('click', () => { st.click = !st.click; if (st.click) { clickCtx(); P.clickN = -1; if (!P.playing) play() } paintSide() })
    $('#edTfDiv', side)?.addEventListener('click', () => setTempo({ factor: tempoNext(-1), half: !!st.music.half }))
    $('#edTfMul', side)?.addEventListener('click', () => setTempo({ factor: tempoNext(1), half: !!st.music.half }))
    $('#edHalf', side)?.addEventListener('click', () => setTempo({ factor: st.music.factor ?? 1, half: !st.music.half }))
    $$('[data-step]', side).forEach((b) => b.onclick = () => edit({ [b.dataset.step]: cur()[b.dataset.step] + +b.dataset.d }))
    $('#edSlow', side)?.addEventListener('click', () => {
      const want = !cur().slow
      edit({ slow: want })
      if (want && !cur().slow) toast('Pas assez d’image autour de ce kill pour un ralenti.', { ms: 3000 })
    })
    $('#edLeft', side)?.addEventListener('click', () => move(-1))
    $('#edRight', side)?.addEventListener('click', () => move(1))
    $('#edDel', side)?.addEventListener('click', remove)
    if (had) { const el = $('#' + had, side) || $(`[data-fk="${had}"]`, side); el?.focus({ preventScroll: true }) }
  }

  // ---------- glisser à la souris ----------
  // Un geste = pointer events + setPointerCapture sur la bande. Les bords et l'ordre changent le projet en direct ; une seule
  // entrée d'annulation (change) à la fin du geste. Échap pendant un glisser l'annule (voir onKey).
  let G = null
  const tbX = (ev) => ev.clientX - $('#edTb', root).getBoundingClientRect().left
  function onDown(ev) {
    if (G || (ev.pointerType === 'mouse' && ev.button !== 0)) return
    const tb = ev.currentTarget, t = ev.target
    const x = tbX(ev), sh = t.closest?.('.ed-shot')
    let hd = t.closest?.('[data-h]')?.dataset.h
    // Le repère du kill passe avant tout : sa zone de prise (9 px de chaque côté) est testée sur la géométrie, car les plans glissent
    // pendant leur animation et l'élément touché peut être le plan
    if (sh && !hd) {
      const j = +sh.dataset.i, sj = st.project.shots[j], cj = sj && clipOf(sj.clipId)
      if (cj) { const u0 = unit(); if (Math.abs(x - (P.starts[j] + E.anchorOffset(sj, u0)) * P.pps - P.off) <= 9) hd = 'k' }
    }
    ev.preventDefault()
    try { tb.setPointerCapture(ev.pointerId) } catch {}
    if (P.playing) pause()
    layout()
    if (!sh) { G = { k: 'scrub', id: ev.pointerId }; seek((x - P.off) / P.pps); return }
    const i = +sh.dataset.i, s = st.project.shots[i]
    sh.focus({ preventScroll: true })
    if (!clipOf(s.clipId) || !hd) { G = { k: 'wait', id: ev.pointerId, i, x0: x, grab: x - P.starts[i] * P.pps }; return }
    st.sel = i
    if (hd === 'l' || hd === 'r') {
      const v0 = hd === 'l' ? s.lead : s.tail
      G = { k: 'edge', id: ev.pointerId, i, side: hd, x0: x, v0, s0: s, pre: snap(), pps: P.pps, limited: false }
    } else G = { k: 'kill', id: ev.pointerId, i, x0: x, a0: s.anchorS, s0: s, pre: snap(), dbS: 0, clipT: s.anchorS }
    paintSide(); paintStrip(); paintHead()
  }
  function onMove(ev) {
    if (!G || ev.pointerId !== G.id) return
    const x = tbX(ev), u = unit()
    if (G.k === 'scrub') return seek((x - P.off) / P.pps)
    if (G.k === 'wait') {
      if (Math.abs(x - G.x0) < 6) return
      G.k = 'move'; G.to = G.i; G.x = x; G.pre = snap(); st.sel = G.i
      paintSide()
    }
    if (G.k === 'edge') {
      const bp = u * G.pps, n = Math.round((x - G.x0) / bp), isL = G.side === 'l', key = isL ? 'lead' : 'tail'
      const want = isL ? G.v0 - n : G.v0 + n
      const cand = fit({ ...G.s0, [key]: clamp(want, E.LIMITS[key + 'Min'], E.LIMITS[key + 'Max']) })
      G.limited = cand[key] < want
      if (cand[key] === st.project.shots[G.i][key] && cand.slow === st.project.shots[G.i].slow) { paintStrip(); return }
      st.project.shots[G.i] = cand; P.dirty = true; layout()
      paintStrip(); paintSum(); paintHead(); showFrame()
    } else if (G.k === 'kill') {
      const s = G.s0
      G.dbS = clamp((x - G.x0) / P.pps, -s.lead * u, s.tail * u)
      G.clipT = clamp(G.a0 + G.dbS, 0, clipOf(s.clipId).durationS)
      paintStrip(); paintHead(); showFrame(G.clipT)
    } else if (G.k === 'move') {
      const shots = st.project.shots, c = (x - G.grab) / P.pps + E.shotLength(shots[G.i], u) / 2
      let to = shots.length
      for (let j = 0; j < shots.length; j++) if (c < P.starts[j] + E.shotLength(shots[j], u) / 2) { to = j; break }
      if (to === G.i + 1) to = G.i
      G.to = to; G.x = x
      paintStrip(); paintHead()
    }
  }
  function onUp(ev) {
    if (!G || ev.pointerId !== G.id) return
    const g = G; g.done = true
    try { ev.currentTarget.releasePointerCapture(ev.pointerId) } catch {}
    G = null
    const u = unit()
    if (g.k === 'scrub') { paintStrip(); return }
    if (g.k === 'wait') { st.sel = g.i; st.tab = 'plan'; paintSide(); paintStrip(); seek(P.starts[g.i] || 0, { keepSel: true }); return }
    if (g.k === 'edge') {
      if (snap() !== g.pre) { st.undo.push(g.pre); if (st.undo.length > 100) st.undo.shift(); st.redo = []; touched() }
    } else if (g.k === 'kill') {
      const n = clamp(Math.round(g.dbS / u), -g.s0.lead, g.s0.tail)
      if (n !== 0) {
        st.undo.push(g.pre); if (st.undo.length > 100) st.undo.shift(); st.redo = []
        st.project.shots[g.i] = fit({ ...g.s0, anchorS: g.a0 + n * u, lead: g.s0.lead + n, tail: g.s0.tail - n, fixed: true })
        touched()
      }
    } else if (g.k === 'move') {
      if (g.to !== g.i) {
        st.undo.push(g.pre || snap()); st.redo = []
        const to = g.to > g.i ? g.to - 1 : g.to
        st.project.shots = E.moveItem(st.project.shots, g.i, to); st.sel = to
        touched()
      }
    }
    P.dirty = true; layout()
    if (g.k !== 'scrub') { const i = shotAt(P.t); if (i !== st.sel) P.t = P.starts[st.sel] || 0 }
    paintAll()
  }
  // Annule le geste en cours (Échap) : le projet revient comme avant le geste
  function cancelGesture() {
    if (!G) return false
    const g = G; g.done = true; G = null
    try { $('#edTb', root)?.releasePointerCapture(g.id) } catch {}
    if (g.k === 'edge') { const s = JSON.parse(g.pre); st.project = s.p; st.sel = s.sel }
    P.dirty = true
    if (root) { layout(); paintAll() }
    return true
  }
  // ---------- le clavier ----------
  // Écouté sur `document` tant que l'éditeur est ouvert (main.js ferme l'éditeur sur Échap : pendant un glisser, on l'annule
  // d'abord, en capture, et la fermeture n'a pas lieu).
  function onKey(e) {
    if (!root || !st) return
    if (e.key === 'Escape' && G) { e.preventDefault(); e.stopPropagation(); cancelGesture(); return }
    if (document.querySelector('dialog[open]') || document.querySelector('[data-modal]:not([hidden])') || $('#pxMenu:popover-open')) return
    const field = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '') || e.target.isContentEditable
    if (field) return
    const k = e.key.toLowerCase()
    // Espace : lecture ou pause, et rien d'autre (sinon le bouton qui a le focus se clique)
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault(); e.stopPropagation()
      if (!e.repeat) toggle()
      return
    }
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); back(st.undo, st.redo); return }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); e.stopPropagation(); back(st.redo, st.undo); return }
    if (!root.contains(e.target) && e.target !== document.body) return
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move(-1); return }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); move(1); return }
    const t = e.target
    const lr = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (lr && !e.ctrlKey && !e.metaKey) {
      const hd = t.closest?.('[data-h]')
      if (hd) {
        // Un pas à la fois : la poignée de gauche tire vers la gauche (plus de temps avant), celle de droite vers la droite
        e.preventDefault(); e.stopPropagation()
        const s = cur(), side = hd.dataset.h
        if (side === 'l') edit({ lead: s.lead - lr })
        else if (side === 'r') edit({ tail: s.tail + lr })
        else if (side === 'k') {
          const n = clamp(lr, -s.lead, s.tail)
          if (n) change(() => { st.project.shots[st.sel] = fit({ ...s, anchorS: s.anchorS + n * unit(), lead: s.lead + n, tail: s.tail - n, fixed: true }) })
        }
        ;(document.querySelector(`.ed-shot.is-sel [data-h="${side}"]`))?.focus({ preventScroll: true })
        return
      }
      if (t.closest?.('.ed-track')) {
        e.preventDefault(); e.stopPropagation()
        st.sel = clamp(st.sel + lr, 0, st.project.shots.length - 1)
        seek(P.starts[st.sel] || 0, { keepSel: true }); paintStrip(); paintSide()
        $('.ed-shot[aria-selected=true]', root)?.focus({ preventScroll: true })
        return
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && t.closest?.('.ed-track')) { e.preventDefault(); e.stopPropagation(); remove() }
  }
  // Espace sur un bouton : il se clique au relâché de la touche, on l'empêche aussi
  function onKeyUp(e) {
    if (!root || !st) return
    if ((e.key === ' ' || e.code === 'Space') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '') && !document.querySelector('dialog[open]') && !$('#pxMenu:popover-open')) { e.preventDefault(); e.stopPropagation() }
  }

  // Pour les essais (tools/essais/ed.cjs) : l'état utile, en lecture seule
  const probe = () => (st ? { t: P.t, playing: P.playing, useAud: P.useAud, sel: st.sel, unit: unit(), shots: JSON.parse(JSON.stringify(st.project.shots)), project: JSON.parse(JSON.stringify(st.project)), music: st.music ? { id: st.music.id, bpm: st.music.bpm, factor: st.music.factor ?? 1, half: !!st.music.half, grid: st.music.grid.length } : null, lost: !!st.lost, undo: st.undo.length, redo: st.redo.length, key: st.key, warn: !!st.warn } : null)

  return { open, resume, close, isOpen, sync, draftOf, filmDone, filmUndone, probe }
})()
