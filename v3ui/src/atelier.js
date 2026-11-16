// L'atelier : créer ou modifier un loadout, avec la carte en direct à côté. Les mêmes règles que la vraie appli :
// - rien ne se perd : chaque modification est gardée en brouillon et se reprend après une fermeture ;
// - rien ne se ressaisit : les accessoires d'une arme déjà notée, relevés en jeu ou de tes builds sont proposés avec leurs points ;
// - nom et arme obligatoires, une erreur ne s'affiche qu'après avoir quitté le champ ou essayé d'enregistrer.
const Atelier = (() => {
  const DRAFT = 'pxv3-loadout-draft', { NAME_MAX, TEXT_MAX, NOTES_MAX } = Shared.loadouts
  const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const armoryOf = (w) => BF6_ARMORY.find((a) => key(a.n) === key(w))
  // Les 4 stats que le jeu affiche, et ce qu'un accessoire y change
  const STATS = [['ctl', 'Contrôle'], ['acc', 'Précision'], ['mob', 'Mobilité'], ['hip', 'Tir au jugé']]
  const sgn = (v) => (v > 0 ? `+${v}` : `−${-v}`)
  const fx = (st) => STATS.filter(([k]) => st?.[k]).map(([k, l]) => `${l} ${sgn(st[k])}`).join(', ')
  const recoOf = (w) => Object.entries(typeof BF6_RECO === 'undefined' ? {} : BF6_RECO).find(([n]) => key(n) === key(w))?.[1] || []
  // Stats en jeu d'un build : l'arme d'usine, plus ce que change chaque accessoire choisi
  function statsOf(w, parts) {
    const a = armoryOf(w); if (!a?.base) return null
    // Un build déjà relevé tel quel dans le jeu : on affiche les chiffres du jeu. Les bonus des accessoires ne sont pas
    // des nombres ronds, donc la somme arrondie peut avoir 1 point d'écart (Contrôle 54 calculé, 55 en jeu).
    const nameOf = (p) => (Array.isArray(p) ? p[0] : p?.n) || ''
    const filled = Object.entries(parts).filter(([, p]) => nameOf(p).trim())
    const seen = recoOf(w).find((r) => r.game && filled.length === Object.keys(r.parts).length && filled.every(([sl, p]) => key(r.parts[sl]?.[0] || '') === key(nameOf(p))))
    if (seen) return { ...seen.game }
    const out = { ...a.base }
    Object.entries(parts).forEach(([s, p]) => { const n = Array.isArray(p) ? p[0] : p?.n; const x = (a.parts[s] || []).find((y) => key(y.n) === key(n)); STATS.forEach(([k]) => { out[k] += x?.s?.[k] || 0 }) })
    return out
  }
    let form = null, editId = null, sc = null, touched = new Set(), status = 'clean', savedAt = 0, dirty = false, timer = 0, keyBound = false, keepErr = false

  /* Le formulaire et le loadout */
  const blank = (preset) => ({ name: '', named: false, cls: 'assault', ctx: '', w: preset?.w || '', cat: preset?.cat || '', tier: '', parts: {}, gear: {}, notes: '' })
  // Un build d'arme, pas une classe : son nom par défaut se compte arme par arme (Build 1, Build 2…)
  const suggestName = (w) => { const used = new Set(BUILDS.filter((b) => key(b.w) === key(w)).map((b) => b.name.toLowerCase())); for (let i = 1; ; i++) { const n = `Build ${i}`; if (!used.has(n.toLowerCase())) return n } }
  const fromBuild = (b) => ({ name: b.name, named: true, cls: b.cls, ctx: b.ctx || '', w: b.w, cat: b.cat || '', tier: b.tier || '', parts: Object.fromEntries(Object.entries(b.parts).map(([s, p]) => [s, { n: p[0], p: p[1] == null ? '' : String(p[1]) }])), gear: { ...(b.gear || {}) }, notes: b.notes || '' })
  const ptsOf = (s) => { const t = String(s ?? '').trim(); if (!t) return undefined; return /^\d{1,3}$/.test(t) && +t <= 100 ? +t : null }
  function toBuild(f, id) {
    const parts = {}
    Loadouts.SLOTS.forEach((s) => { const p = f.parts[s]; if (!p || !p.n.trim()) return; const v = ptsOf(p.p); parts[s] = [p.n.trim(), typeof v === 'number' ? v : undefined] })
    const w = f.w.trim(), mine = BUILDS.find((b) => key(b.w) === key(w) && b.img)
    return { id, tier: f.tier || undefined, w, img: WEAPON_IMG[w] || mine?.img, cat: f.cat, cls: f.cls, name: f.name.trim(), ctx: f.ctx.trim() || undefined, parts, gear: Object.fromEntries(Object.entries(f.gear).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)), notes: f.notes.trim() || undefined }
  }
  const isEmpty = (f) => !f.w.trim() && !f.named && !f.ctx.trim() && !f.notes.trim() && !Object.keys(f.parts).length

  /* Le brouillon */
  const keyFor = (id) => (id ? `${DRAFT}:${id}` : DRAFT)
  const readDraft = (id) => { try { const d = JSON.parse(localStorage.getItem(keyFor(id)) || 'null'); return d?.form ? d : null } catch { return null } }
  const dropDraft = (id) => { try { localStorage.removeItem(keyFor(id)) } catch { /* rien à retirer */ } }
  function keepDraft() {
    try { localStorage.setItem(keyFor(editId), JSON.stringify({ form, editId, at: Date.now() })); savedAt = Date.now(); status = 'kept' } catch { status = 'error' }
    paintStatus()
  }
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j` }
  function drafts() {
    const out = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k !== DRAFT && !k.startsWith(DRAFT + ':')) continue
        const d = JSON.parse(localStorage.getItem(k))
        if (d?.form) out.push(d)
      }
    } catch { /* stockage indisponible : aucun brouillon à montrer */ }
    return out.sort((p, q) => q.at - p.at).map((d) => {
      const orig = d.editId && BUILDS.find((b) => b.id === d.editId)
      const bits = [d.form.w, d.form.name].map((v) => String(v || '').trim()).filter(Boolean)
      const f = d.form, parts = Object.values(f.parts || {}).filter((x) => String(x?.n || '').trim()), w = String(f.w || '').trim()
      return {
        id: d.editId || d.park || null, edit: !!orig, title: orig ? `Modification de « ${orig.name} »` : 'Brouillon en cours', label: bits.join(', ') || 'Sans arme ni nom', when: ago(d.at),
        w, name: String(f.name || '').trim(), cat: f.cat || '', img: WEAPON_IMG[w] || BUILDS.find((b) => key(b.w) === key(w) && b.img)?.img || null,
        n: parts.length, pts: parts.reduce((t, x) => t + (ptsOf(x.p) || 0), 0)
      }
    })
  }

  /* Entrer et sortir */
  function start(f, id = null, resumed = false, at = 0) {
    form = f; editId = id; touched = new Set(); dirty = resumed; status = resumed ? 'kept' : 'clean'; savedAt = at
    S.atelier = true; S.statsGame = 'bf6'; S.statsTab = 'loadouts'; S.gameId = null
    if (S.view !== 'stats') go('stats'); else vt(StatsPage.render)
  }
  // Un brouillon neuf qui attend est mis de côté sous sa propre clé : « Créer un loadout » repart de zéro sans rien perdre
  function park() {
    const d = readDraft(); if (!d) return
    const pid = 'new-' + d.at
    try { localStorage.setItem(keyFor(pid), JSON.stringify({ ...d, park: pid })); localStorage.removeItem(DRAFT) } catch { /* stockage indisponible */ }
  }
  function create(preset, fresh = false) {
    const d = readDraft()
    if (d && !fresh) { start(d.form, null, true, d.at); toast(`${ic('refresh')} Brouillon repris${d.form.w ? ` : ${esc(d.form.w)}` : ''}`, { ms: 1800 }); return }
    if (d) park()
    start(blank(preset))
  }
  function edit(b) {
    const d = readDraft(b.id)
    if (d) { start(d.form, b.id, true, d.at); toast(`${ic('refresh')} Brouillon repris`, { ms: 1800 }); return }
    start(fromBuild(b), b.id)
  }
  const resume = (id) => {
    const d = readDraft(id); if (!d) return
    // Un brouillon mis de côté reprend la place du brouillon neuf (qui, lui, passe de côté)
    if (String(id || '').startsWith('new-')) { park(); try { localStorage.setItem(DRAFT, JSON.stringify({ form: d.form, editId: null, at: d.at })); localStorage.removeItem(keyFor(id)) } catch { /* stockage indisponible */ } return start(d.form, null, true, d.at) }
    start(d.form, id, true, d.at)
  }
  function leave() {
    clearTimeout(timer)
    if (dirty && !isEmpty(form)) { keepDraft(); toast(`${ic('check')} Brouillon gardé : reprends-le depuis Mes loadouts`, { ms: 2600 }) } else if (!editId) dropDraft()
    S.atelier = false; sc.scrollTop = 0
    vt(StatsPage.render, { done: () => ($('[data-dgo]', sc) || $('#loNew', sc) || $('#loAll', sc))?.focus({ preventScroll: true }) })
  }
  async function save() {
    clearTimeout(timer)
    const errs = errors()
    if (Object.keys(errs).length) {
      Object.keys(errs).forEach((k) => touched.add(k)); paintErrors()
      const first = errs.w ? $('#atW', sc) : errs.name ? $('#atName', sc) : document.getElementById('atN-' + Object.keys(errs)[0].slice(4))
      keepErr = true; first?.focus(); keepErr = false
      return
    }
    const known = BUILDS.some((b) => key(b.w) === key(form.w)), btn = $('#atSave', sc), orig = editId && BUILDS.find((x) => x.id === editId)
    btn.setAttribute('aria-busy', 'true')
    let b
    try { b = await Real.saveLoadout({ ...toBuild(form, editId || undefined), armoryId: orig?.armoryId }) } catch (e) {
      btn.removeAttribute('aria-busy'); keepDraft()
      toast(`Le loadout n’a pas pu être enregistré. ${esc(errText(e))} Ton brouillon est gardé.`, { tone: 'warn', ms: 6000 })
      return
    }
    dropDraft(editId)
    dirty = false; S.atelier = false; S.loWeapon = b.w; sc.scrollTop = 0
    toast(`${ic('check')} Loadout « ${esc(b.name)} » enregistré${known ? '' : `, ${esc(b.w)} retenue dans Mes armes`}`, { ms: 3000 })
    StatsPage.render()
    const box = $(`.lc-box[data-id="${b.id}"]`, sc)
    if (box) { box.classList.add('is-new'); box.scrollIntoView({ block: 'nearest' }); $('[data-a=edit]', box)?.focus({ preventScroll: true }); setTimeout(() => box.classList.remove('is-new'), 1400) }
  }

  /* Ce qui est proposé dans les listes */
  // Les armes rangées par catégorie : la catégorie choisie d'abord, seule ; en tapant, on cherche dans toutes.
  // Dans chaque catégorie, tes armes passent devant.
  function weaponOptions() {
    const seen = new Set(), all = []
    const add = (v, cat, mine) => { const k = key(v); if (!k || seen.has(k)) return; seen.add(k); all.push({ v, cat: cat || '', mine }) }
    BUILDS.forEach((b) => add(b.w, b.cat, true))
    ;(Real.st.myWeapons || []).forEach((w) => add(w.name, w.cat ? Shared.armoryLabels.CATEGORY_LABEL[w.cat] : '', true))
    BF6_ARMORY.forEach((a) => add(a.n, a.c))
    BF6_WEAPONS.forEach((w) => add(w.n, w.c))
    const order = [...BF6_CATS, ''], at = (c) => { const i = order.findIndex((o) => key(o) === key(c)); return i < 0 ? order.length : i }
    const sorted = all.slice().sort((x, y) => at(x.cat) - at(y.cat) || (y.mine ? 1 : 0) - (x.mine ? 1 : 0))
    const items = sorted.map((x) => ({ v: x.v, sub: x.mine ? 'Une de tes armes' : '', g: Loadouts.catPl(x.cat) }))
    const cat = form.cat
    const mineOnly = cat ? items.filter((x, i) => key(sorted[i].cat) === key(cat)) : items
    return { title: cat ? Loadouts.catPl(cat) : 'Toutes les armes', source: cat ? 'Change de catégorie à gauche' : '', items: mineOnly, all: items, hint: cat ? `Aucune arme connue dans « ${cat} ». Écris son nom.` : '' }
  }
  function partOptions(s) {
    const a = armoryOf(form.w)
    if (a) {
      let list = a.parts[s] || []
      if (s === 'optic-accessory') { const o = (a.parts.optic || []).find((x) => x.n === form.parts.optic?.n); list = o?.e ? list.filter((x) => o.e.includes(x.n)) : [] }
      return { title: SLOT[s], source: `Relevé en jeu, ${a.n}`, items: list.map((x) => ({ v: x.n, sub: [x.t, fx(x.s)].filter(Boolean).join(' · '), pts: x.p })), hint: s === 'optic-accessory' ? 'Choisis d’abord une optique qui accepte un accessoire.' : '' }
    }
    const seen = new Set(), items = [], w = key(form.w)
    const push = (n, pts) => { const k = n.toLowerCase(); if (seen.has(k)) return; seen.add(k); items.push({ v: n, pts }) }
    BUILDS.filter((b) => key(b.w) === w).forEach((b) => { const p = b.parts[s]; if (p) push(p[0], p[1]) })
    ;(Real.st.myWeapons || []).filter((m) => key(m.name) === w).forEach((m) => (m.parts[s] || []).forEach((p) => push(p.name, p.pts)))
    ;(BF6_PARTS[w]?.[s] || []).forEach((p) => (typeof p === 'string' ? push(p) : push(p[0], p[1])))
    return { title: SLOT[s], source: items.length ? `Mes armes, ${form.w.trim()}` : '', items, hint: form.w.trim() ? `Écris le nom : il sera proposé la prochaine fois sur ${form.w.trim()}.` : 'Choisis l’arme : ses accessoires connus seront proposés avec leurs points.' }
  }
  /* Un champ avec suggestions : se filtre en tapant, se pilote au clavier, la saisie libre reste possible */
  function bindCombo(input, o) {
    const wrap = input.closest('.at-c'), pop = document.createElement('div')
    pop.className = 'at-pop'; pop.id = input.id + '-l'; pop.setAttribute('role', 'listbox'); pop.setAttribute('aria-label', o.label); pop.hidden = true
    wrap.append(pop)
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', pop.id)
    let items = [], act = -1, typed = false
    const close = () => { pop.hidden = true; pop.classList.remove('up'); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); act = -1 }
    const mark = (scroll) => {
      $$('[role=option]', pop).forEach((e, i) => { e.classList.toggle('on', i === act); e.setAttribute('aria-selected', i === act); if (i === act) { input.setAttribute('aria-activedescendant', e.id); if (scroll) { const box = pop.querySelector('.at-opts'); if (e.offsetTop < box.scrollTop) box.scrollTop = e.offsetTop; else if (e.offsetTop + e.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = e.offsetTop + e.offsetHeight - box.clientHeight } } })
      if (act < 0) input.removeAttribute('aria-activedescendant')
    }
    const hl = (t, q) => { if (!q) return esc(t); const i = norm(t).indexOf(q); return i < 0 ? esc(t) : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}` }
    function paint() {
      const d = o.get(), q = typed ? norm(input.value.trim()) : ''
      items = q ? (d.all || d.items).filter((x) => norm(x.v).includes(q)) : d.items
      const clear = o.onClear && input.value.trim()
      const opts = items.map((x, i) => `${x.g != null && x.g !== items[i - 1]?.g && (q || !d.all || d.items === d.all) ? `<div class="at-og" role="presentation">${esc(x.g)}</div>` : ''}<div class="at-o" role="option" id="${pop.id}-${i}" data-i="${i}" aria-selected="false"><span><b>${hl(x.v, q)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>${x.pts != null ? `<em class="num">${x.pts}</em>` : ''}</div>`).join('')
      pop.innerHTML = `${(d.title || d.source) && !(q && d.all) ? `<div class="at-ph"><b>${esc(d.title || '')}</b>${d.source ? `<span>${esc(d.source)}</span>` : ''}</div>` : ''}${items.length ? `<div class="at-opts" tabindex="-1">${opts}</div>` : `<p class="at-none">${esc(d.hint || 'Rien de connu pour l’instant.')}</p>`}${clear ? `<button type="button" class="at-o at-empty" tabindex="-1">${ic('close')}Vider l’emplacement</button>` : ''}`
      act = -1
    }
    function open() {
      paint(); pop.hidden = false; input.setAttribute('aria-expanded', 'true')
      // Pas de place sous le champ, au-dessus de la barre du bas : la liste s'ouvre vers le haut
      const r = input.getBoundingClientRect(), box = sc.getBoundingClientRect(), k = (box.height / sc.offsetHeight) || 1, h = pop.offsetHeight * k
      pop.classList.toggle('up', r.bottom + h + 8 > box.bottom - 96 * k && r.top - h - 8 > box.top + 120 * k)
    }
    input.addEventListener('focus', () => { if (keepErr) return; typed = false; open() })
    input.addEventListener('click', () => { if (pop.hidden) { typed = false; open() } })
    input.addEventListener('blur', close)
    input.addEventListener('input', () => { typed = true; o.onType(input.value); if (pop.hidden) open(); else paint() })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (pop.hidden) open()
        if (items.length) { act = e.key === 'ArrowDown' ? (act + 1) % items.length : (act <= 0 ? items.length : act) - 1; mark(true) }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (!pop.hidden && act >= 0) { o.onPick(items[act]); typed = false; close() } else close()
      } else if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); close()
      } else if (e.key === 'Tab') close() // Avant que le navigateur cherche le champ suivant : la liste ouverte ne doit pas recevoir le focus
    })
    pop.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      const x = e.target.closest('.at-o'); if (!x) return
      if (x.classList.contains('at-empty')) { o.onClear(); close(); return }
      o.onPick(items[+x.dataset.i]); typed = false; close()
    })
    pop.addEventListener('pointermove', (e) => { const x = e.target.closest('[role=option]'); if (x && +x.dataset.i !== act) { act = +x.dataset.i; mark(false) } })
  }
  // Groupe de boutons exclusifs : un seul arrêt de tabulation, les flèches changent le choix
  function bindRadios(box, fn) {
    const l = $$('[role=radio]', box)
    const pick = (x) => { l.forEach((y) => { y.setAttribute('aria-checked', y === x); y.tabIndex = y === x ? 0 : -1 }); fn(x.dataset.v) }
    l.forEach((x, i) => {
      x.onclick = () => pick(x)
      x.onkeydown = (e) => { const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return; e.preventDefault(); const n = l[(i + d + l.length) % l.length]; n.focus(); pick(n) }
    })
  }

  /* La page */
  const changed = () => {
    dirty = true; status = 'pending'; paintStatus(); paintLive()
    clearTimeout(timer); timer = setTimeout(keepDraft, 600)
  }
  function errors() {
    const e = {}
    if (!form.w.trim()) e.w = 'Écris l’arme, par exemple « MK 24 ».'
    if (!form.name.trim()) e.name = 'Donne un nom, par exemple « Rush Conquête ».'
    Loadouts.SLOTS.forEach((s) => { if (form.parts[s] && ptsOf(form.parts[s].p) === null) e['pts-' + s] = 'Points de 0 à 100.' })
    return e
  }
  function paintErrors() {
    if (!sc?.isConnected || !$('.at', sc)) return
    const e = errors()
    ;[['w', '#atW', '#atEw'], ['name', '#atName', '#atEname']].forEach(([k, inp, msg]) => {
      const m = touched.has(k) ? e[k] : '', input = $(inp, sc), box = $(msg, sc)
      box.textContent = m || ''; box.hidden = !m
      input.toggleAttribute('aria-invalid', !!m); if (m) input.setAttribute('aria-invalid', 'true')
      if (m) input.setAttribute('aria-describedby', box.id); else input.removeAttribute('aria-describedby')
    })
    Loadouts.SLOTS.forEach((s) => { const bad = touched.has('pts-' + s) && e['pts-' + s], i = document.getElementById('atN-' + s); if (bad) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid') })
  }
  function paintStatus() {
    const st = sc && $('#atSt', sc); if (!st) return
    const text = status === 'pending' ? 'Modification…' : status === 'kept' ? `Brouillon gardé ${ago(savedAt)}` : status === 'error' ? 'Brouillon non gardé' : editId ? 'Aucune modification' : 'Rien de saisi'
    st.className = `at-st is-${status}`; st.innerHTML = `<i aria-hidden="true"></i>${text}`
    $('#atLeave', sc).textContent = dirty ? 'Fermer' : 'Annuler'
  }
  function paintLive() {
    if (!sc?.isConnected || !$('.at', sc)) return
    const b = toBuild(form, editId || 'new'), tot = Loadouts.total(b), a = armoryOf(form.w), w = form.w.trim()
    const miss = Object.values(b.parts).filter((p) => p[1] == null).length
    $('#atCard', sc).innerHTML = Loadouts.cardHTML({ ...b, name: b.name || 'Sans nom', w: w || 'Arme' })
    const on = Math.min(10, Math.round(tot / 10))
    $('#atMeter', sc).className = `at-meter ${tot > 100 ? 'over' : ''}`
    $('#atMeter', sc).innerHTML = `<span class="lc-hatch" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span><b class="num">${tot}</b><small class="num">/ 100</small>`
    $('#atMeter', sc).setAttribute('aria-label', `${tot} points sur 100`)
    const note = $('#atNote', sc)
    note.classList.toggle('warn', tot > 100)
    note.textContent = tot > 100 ? `${tot - 100} points de trop : le jeu refusera ce loadout.` : miss ? `${miss} accessoire${miss > 1 ? 's' : ''} sans points : le total n’en tient pas compte.` : a ? `${a.n} : ses accessoires et leurs points sont relevés en jeu.` : w ? `Enregistre ce loadout : ${w} et ses accessoires seront proposés la prochaine fois.` : 'Choisis l’arme : ses accessoires connus seront proposés avec leurs points.'
    paintStats(b); paintReco()
    // Une arme relevée en jeu : ses emplacements seulement (la MK 24 n'a ni accessoire d'optique ni accessoire gauche)
    Loadouts.SLOTS.forEach((s) => { const r = $(`.at-slot[data-s="${s}"]`, sc), filled = !!form.parts[s]?.n.trim(); r.hidden = !!a && !(a.parts[s] || []).length && !filled; r.classList.toggle('on', filled); const c = $('.at-clr', r); c.tabIndex = filled ? 0 : -1 })
    paintErrors()
  }
  // À côté de la carte : les 4 stats du jeu, avec l'écart par rapport à l'arme d'usine
  function paintStats(b) {
    const box = $('#atStats', sc); if (!box) return
    const a = armoryOf(form.w), st = statsOf(form.w, b.parts)
    box.hidden = !st; if (!st) return
    box.innerHTML = `<h3>Dans le jeu</h3>${STATS.map(([k, l]) => { const d = st[k] - a.base[k]; return `<div class="at-sr"><span>${l}</span><i class="at-sb" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, st[k]))}%"></i>${d ? `<i class="at-sd ${d > 0 ? 'up' : 'dn'}" style="left:${Math.min(st[k], a.base[k])}%;width:${Math.abs(d)}%"></i>` : ''}</i><b class="num">${st[k]}</b><em class="num ${d > 0 ? 'up' : d < 0 ? 'dn' : ''}">${d ? sgn(d) : ''}</em></div>` }).join('')}<p>Écart avec ${a.baseLabel ? esc(a.baseLabel) : `la ${esc(a.n)} d’usine`}. ${esc(a.src || '')}</p>`
  }
  // Les builds conseillés de l'arme : deux choix tout faits, qu'on applique puis qu'on modifie à sa guise
  function paintReco() {
    const box = $('#atReco', sc); if (!box) return
    const list = recoOf(form.w), sig = list.map((r) => r.id).join('|') + (editId ? 'e' : '')
    if (box.dataset.sig === sig) { $$('[data-reco]', box).forEach((x) => x.setAttribute('aria-pressed', isApplied(list.find((r) => r.id === x.dataset.reco)))); return }
    box.dataset.sig = sig; box.hidden = !list.length; if (!list.length) { box.innerHTML = ''; return }
    const a = armoryOf(form.w)
    box.innerHTML = `<div class="at-gh"><h2>Builds conseillés</h2><span class="at-rs">Choisis-en un, puis change ce que tu veux</span></div><div class="at-rl">${list.map((r) => {
      const st = statsOf(form.w, r.parts), pts = Object.values(r.parts).reduce((t, p) => t + (p[1] || 0), 0)
      return `<button type="button" class="at-rc" data-reco="${esc(r.id)}" aria-pressed="false"><b>${esc(r.title || r.name)}</b><span>${esc(r.why)}</span><span class="at-rk">${STATS.map(([k, l]) => `<em><small>${l}</small><span class="num">${st[k]}</span>${st[k] !== a.base[k] ? `<i class="num ${st[k] > a.base[k] ? 'up' : 'dn'}">${sgn(st[k] - a.base[k])}</i>` : ''}</em>`).join('')}</span><span class="at-rp num">${pts}/100</span></button>`
    }).join('')}</div>`
    $$('[data-reco]', box).forEach((x) => {
      const r = list.find((y) => y.id === x.dataset.reco)
      x.setAttribute('aria-pressed', isApplied(r))
      x.onclick = () => applyTemplate({ ...r, w: armoryOf(form.w)?.n || form.w, cat: a?.c || form.cat, cls: form.cls })
    })
  }
  const isApplied = (r) => !!r && Loadouts.SLOTS.every((s) => (r.parts[s]?.[0] || '') === (form.parts[s]?.n.trim() || ''))
  const fill = (id, v) => { const e = document.getElementById(id); if (e && e.value !== v) e.value = v }
  function fillAll() {
    fill('atW', form.w); fill('atName', form.name); fill('atCtx', form.ctx); fill('atCat', form.cat); fill('atNotes', form.notes)
    Loadouts.SLOTS.forEach((s) => { fill('atP-' + s, form.parts[s]?.n || ''); fill('atN-' + s, form.parts[s]?.p || '') })
    $$('#atTier [role=radio]', sc).forEach((x) => { const on = x.dataset.v === form.tier; x.setAttribute('aria-checked', on); x.tabIndex = on ? 0 : -1 })
  }
  const setPart = (s, patch) => {
    const cur = form.parts[s] || { n: '', p: '' }, next = { ...cur, ...patch }
    if (!next.n.trim() && !String(next.p).trim()) delete form.parts[s]; else form.parts[s] = next
    if (s === 'optic' && armoryOf(form.w) && form.parts['optic-accessory']) {
      const o = armoryOf(form.w).parts.optic?.find((x) => x.n === next.n)
      if (!(o?.e || []).includes(form.parts['optic-accessory'].n)) { delete form.parts['optic-accessory']; fill('atP-optic-accessory', ''); fill('atN-optic-accessory', '') }
    }
  }
  function setWeapon(v) {
    form.w = v
    if (!form.named) { form.name = suggestName(v); fill('atName', form.name) }
    const mine = (Real.st.myWeapons || []).find((m) => key(m.name) === key(v))
    const hit = BUILDS.find((b) => key(b.w) === key(v)) || (mine?.cat ? { cat: Shared.armoryLabels.CATEGORY_LABEL[mine.cat] } : null) || BF6_ARMORY.find((a) => key(a.n) === key(v)) || BF6_WEAPONS.find((w) => key(w.n) === key(v))
    const cat = hit?.cat ?? hit?.c
    if (cat) { form.cat = cat; fill('atCat', cat) }
  }
  function applyTemplate(t) {
    const before = JSON.parse(JSON.stringify(form)), f = fromBuild(t)
    form = { ...f, ctx: form.ctx, gear: form.gear, notes: form.notes }
    fillAll(); changed()
    toast(`Build « ${esc(t.w)}, ${esc(t.name)} » appliqué`, { ms: 5000, action: { label: 'Annuler', fn: () => { form = before; fillAll(); changed() } } })
  }
  function render(root) {
    sc = root
    if (!form) form = blank()
    if (!form.named && !form.name) form.name = suggestName(form.w)
    if (!keyBound) { keyBound = true; document.addEventListener('keydown', (e) => { if (S.atelier && S.view === 'stats' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }) }
    const orig = editId && BUILDS.find((b) => b.id === editId)
    const seeds = [...BUILDS, ...Loadouts.seed().filter((t) => !BUILDS.some((b) => key(b.w) === key(t.w) && b.name === t.name))], weapons = [...new Set(seeds.map((b) => b.w))]
    const cats = [...new Set([...BF6_CATS, form.cat].filter(Boolean))]
    root.innerHTML = `<div class="at">
      <header class="at-head">
        <button class="btn sm" id="atBack">${ic('back')}Mes loadouts</button>
        <div class="at-tt"><h1>${orig ? `Modifier « ${esc(orig.name)} »` : 'Nouveau loadout'}</h1><span class="at-st" id="atSt" role="status"></span></div>
        <button class="btn sm" id="atLeave"></button>
        <button class="btn sm rose" id="atSave" data-tip="Ctrl S" data-tip-b data-tip-r>${ic('check')}${orig ? 'Enregistrer' : 'Enregistrer le loadout'}</button>
      </header>
      <div class="at-grid">
        <form class="at-form" id="atForm" novalidate>
          ${orig ? '' : `<details class="at-g at-from"><summary><span>Partir d’un de tes builds</span><small>${seeds.length} builds sur ${weapons.length} armes</small>${ic('chevd')}</summary><div class="at-tpls">${weapons.map((w) => `<div class="at-tpl"><b>${esc(w)}</b><div>${seeds.filter((t) => t.w === w).map((t) => `<button type="button" class="at-chip" data-t="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div></div>`).join('')}</div></details>`}
          <section class="at-g"><h2>Arme</h2><div class="at-l at-fields">
            <div class="at-f"><label for="atCat">Catégorie</label><select class="at-i at-sel" id="atCat"><option value="">Toutes les catégories</option>${cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
            <div class="at-f"><label for="atW">Arme<small>obligatoire</small></label><div class="at-c"><input class="at-i" id="atW" maxlength="${TEXT_MAX}" autocomplete="off" spellcheck="false" required></div><p class="at-err" id="atEw" role="alert" hidden></p></div>
          </div></section>
          <section class="at-g at-reco" id="atReco" hidden></section>
          <section class="at-g"><div class="at-gh"><h2>Accessoires</h2><span class="at-meter" id="atMeter" role="img"></span></div>
            <div class="at-l"><div class="at-slh" aria-hidden="true"><span>Emplacement</span><span>Accessoire</span><span id="atSlhP">Points</span></div>${Loadouts.SLOTS.map((s) => `<div class="at-slot" data-s="${s}"><label for="atP-${s}" id="atL-${s}">${SLOT[s]}</label><div class="at-c"><input class="at-i" id="atP-${s}" maxlength="${TEXT_MAX}" autocomplete="off" spellcheck="false" placeholder="Vide"></div><input class="at-i at-pts num" id="atN-${s}" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="–" aria-labelledby="atSlhP atL-${s}"><button type="button" class="at-clr" aria-label="Vider : ${SLOT[s]}" data-tip="Vider" data-tip-r tabindex="-1">${ic('close')}</button></div>`).join('')}</div>
            <p class="at-note" id="atNote"></p></section>
          <section class="at-g"><h2>Nom et classement</h2><div class="at-l at-fields">
            <div class="at-f"><label for="atName">Nom<small>obligatoire</small></label><input class="at-i" id="atName" maxlength="${NAME_MAX}" autocomplete="off" required><p class="at-err" id="atEname" role="alert" hidden></p></div>
            <div class="at-f"><label for="atCtx">Mode ou carte</label><input class="at-i" id="atCtx" maxlength="${TEXT_MAX}" autocomplete="off" placeholder="Facultatif"></div>
            <div class="at-f"><span class="at-k" id="atTierL">Classement</span><div class="at-seg at-tiers" id="atTier" role="radiogroup" aria-labelledby="atTierL">${['S', 'A', 'B', 'C', ''].map((t) => `<button type="button" role="radio" data-v="${t}" aria-checked="false" aria-label="${t ? `${t} tier` : 'Sans classement'}">${t || '–'}</button>`).join('')}</div></div>
            <div class="at-f at-wide"><label for="atNotes">Notes</label><textarea class="at-i at-ta" id="atNotes" rows="3" maxlength="${NOTES_MAX}"></textarea></div>
          </div></section>
        </form>
        <aside class="at-side" aria-label="Aperçu de la carte"><p class="at-live"><i aria-hidden="true"></i>En direct</p><div class="at-card" id="atCard"></div></aside>
      </div>
    </div>`
    fillAll()
    $('#atBack', root).onclick = leave; $('#atLeave', root).onclick = leave; $('#atSave', root).onclick = save
    $('#atForm', root).onsubmit = (e) => { e.preventDefault(); save() }
    $$('.at-chip', root).forEach((b) => b.onclick = () => applyTemplate(seeds.find((t) => t.id === b.dataset.t)))
    bindRadios($('#atTier', root), (v) => { form.tier = v; changed() })
    const named = $('#atName', root)
    named.oninput = () => { form.name = named.value; form.named = true; changed() }
    named.onblur = () => { touched.add('name'); paintErrors() }; named.onfocus = () => { if (keepErr) return; touched.delete('name'); paintErrors() }
    $('#atCtx', root).oninput = (e) => { form.ctx = e.target.value; changed() }
    $('#atCat', root).onchange = (e) => {
      form.cat = e.target.value
      const wc = weaponOptions().all.find((x) => key(x.v) === key(form.w))
      if (form.cat && form.w && wc && key(wc.g) !== key(Loadouts.catPl(form.cat)) && !Object.keys(form.parts).length) { setWeapon(''); fill('atW', ''); form.cat = e.target.value }
      changed(); $('#atW', root).focus()
    }
    $('#atNotes', root).oninput = (e) => { form.notes = e.target.value; changed() }
    $('#atNotes', root).addEventListener('focus', (e) => e.target.scrollIntoView({ block: 'nearest' })) // Une zone de texte ne suit que son curseur : sans ça, elle reste sous la barre du bas
    const w = $('#atW', root)
    bindCombo(w, { label: 'Arme principale', get: weaponOptions, onType: (v) => { setWeapon(v); changed() }, onPick: (o) => { w.value = o.v; setWeapon(o.v); changed() } })
    w.addEventListener('blur', () => { touched.add('w'); paintErrors() }); w.addEventListener('focus', () => { if (keepErr) return; touched.delete('w'); paintErrors() })
    Loadouts.SLOTS.forEach((s) => {
      const nm = document.getElementById('atP-' + s), pt = document.getElementById('atN-' + s)
      const clear = () => { setPart(s, { n: '', p: '' }); nm.value = ''; pt.value = ''; touched.delete('pts-' + s); changed() }
      bindCombo(nm, {
        label: SLOT[s], get: () => partOptions(s),
        onType: (v) => { const hit = partOptions(s).items.find((o) => o.v.toLowerCase() === v.trim().toLowerCase()); setPart(s, hit && hit.pts != null ? { n: v, p: String(hit.pts) } : { n: v }); fill('atN-' + s, form.parts[s]?.p || ''); changed() },
        onPick: (o) => { nm.value = o.v; setPart(s, { n: o.v, p: o.pts != null ? String(o.pts) : (form.parts[s]?.p || '') }); fill('atN-' + s, form.parts[s]?.p || ''); changed() },
        onClear: clear
      })
      pt.oninput = () => { pt.value = pt.value.replace(/[^\d]/g, ''); setPart(s, { p: pt.value }); changed() }
      pt.onblur = () => { touched.add('pts-' + s); paintErrors() }; pt.onfocus = () => { if (keepErr) return; touched.delete('pts-' + s); paintErrors() }
      $(`.at-slot[data-s="${s}"] .at-clr`, root).onclick = () => { clear(); nm.focus() }
    })
    paintStatus(); paintLive()
    setTimeout(() => { // Au tour suivant : la page vient peut-être d'être rendue visible
      if (!w.isConnected) return
      keepErr = true; (form.w.trim() ? named : w).focus({ preventScroll: true }); keepErr = false
    }, 0)
  }
  // « Il y a 2 min » reste juste
  setInterval(() => { if (S.atelier && status === 'kept') paintStatus() }, 30000)
  // Les 4 stats du jeu en une ligne, pour la carte d'un loadout (armes relevées en jeu seulement)
  function statsHTML(w, parts) {
    const a = armoryOf(w), st = statsOf(w, parts); if (!st) return ''
    return `<div class="lc-st">${STATS.map(([k, l]) => { const d = st[k] - a.base[k]; return `<span data-k="${k}" data-v="${st[k]}" style="--v:${Math.max(0, Math.min(100, st[k]))}"><small>${l}</small><em><b class="num">${st[k]}</b>${d ? `<i class="num ${d > 0 ? 'up' : 'dn'}" title="Écart avec ${a.baseLabel ? esc(a.baseLabel) : `la ${esc(a.n)} d’usine`}">${sgn(d)}</i>` : ''}</em></span>` }).join('')}</div>`
  }
  // On quitte Stats par la barre : le brouillon est gardé, et Stats ne rouvre pas l'atelier au retour
  function away() { if (!S.atelier) return; clearTimeout(timer); if (dirty && form && !isEmpty(form)) keepDraft(); else if (!editId) dropDraft(); S.atelier = false }
  return { render, create, edit, resume, drafts, dropDraft, statsHTML, leave, away }
})()
