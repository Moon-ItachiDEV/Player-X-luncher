// Stats : CS2 et Battlefield 6 ont chacun leur monde, avec leurs couleurs. Les loadouts vivent ici.
// Battlefield 6 : le service de stats gametools.network, avec ton pseudo EA. Counter-Strike 2 : les totaux de Valve et tes bilans de match.
const StatsPage = (() => {
  const T = Shared.text, L = Shared.cs2Lifetime
  const TABS = { bf6: [['overview', 'Vue d’ensemble'], ['arsenal', 'Arsenal'], ['maps', 'Cartes et modes'], ['board', 'Classement'], ['loadouts', 'Loadouts']], cs2: [['overview', 'Vue d’ensemble'], ['matches', 'Matchs'], ['weapons', 'Armes'], ['maps', 'Cartes']] }
  const FREE = ['loadouts']
  const HAS = ['bf6', 'cs2'], MAX_RAIL = 4
  // Sans profil BF6 relié, seuls ces onglets ont quelque chose à montrer (les loadouts sont à toi, pas au service de stats)
  const OPEN = ['overview', 'loadouts']
  const linked = (g) => g !== 'bf6' || !!Real.st.tracked?.me
  // Les jeux joués le plus récemment d'abord : la rangée garde tes 4 derniers, le reste passe dans « +N »
  const gamesOf = () => HAS.map((id) => Real.statGame(id)).sort((a, b) => (b.raw?.lastPlayed || 0) - (a.raw?.lastPlayed || 0))
  const isTotal = (r) => /^(all|tous|toutes|total)$/i.test(r.name.trim())
  const entries = (list) => (list || []).filter((r) => !isTotal(r))
  const PLAT = { ea: 'EA', pc: 'PC', steam: 'Steam', psn: 'PlayStation', xbox: 'Xbox' }
  const duration = (sec) => (sec < 3600 ? `${fr(Math.round(sec / 60))} min` : `${fr(Math.round(sec / 3600))} h`)
  let token = 0
  function railOf(all, cur) {
    if (all.length <= MAX_RAIL) return all
    const r = all.slice(0, MAX_RAIL - 1)
    if (!r.some((x) => x.id === cur.id)) r[r.length - 1] = cur
    return r
  }
  // Le clic au-dehors de « Tous tes jeux » : un seul écouteur, retiré à la fermeture, au rendu suivant ou quand la liste a quitté la page
  let awayAc = null
  function render() {
    awayAc?.abort(); awayAc = null
    const all = gamesOf(), cur = all.find((x) => x.id === S.statsGame) || all[0]
    S.statsGame = cur.id
    const g = cur.id
    Fluid.game(cur); Bar.syncGame()
    if (S.atelier && g === 'bf6') { $('#sc-stats').scrollTop = 0; return Atelier.render($('#sc-stats')) }
    const tabs = (TABS[g] || []).filter(([k]) => linked(g) || OPEN.includes(k))
    if (tabs.length && !tabs.find(([k]) => k === S.statsTab)) S.statsTab = 'overview'
    const rail = railOf(all, cur), rest = all.length - rail.length
    const sc = $('#sc-stats')
    sc.innerHTML = `<header class="sp-head">
        <h1 class="sp-title" data-len="${cur.name.length > 20 ? 'l' : cur.name.length > 14 ? 'm' : 's'}">${esc(cur.name)}</h1>
        <div class="sp-pickw"><div class="sp-pick">
          <div class="sp-rail" role="tablist" aria-label="Jeu">${rail.map((x) => `<button class="sp-g" role="tab" data-g="${x.id}" data-name="${esc(x.name)}" aria-selected="${x.id === cur.id}" aria-label="${esc(x.name)}" data-tip="${esc(x.name)}" data-tip-b data-tip-r><img src="${esc(A(x.cover))}" alt="" draggable="false"></button>`).join('')}</div>
          ${rest > 0 ? `<button class="sp-more num" id="spMore" aria-expanded="false" aria-controls="spAll" aria-label="Voir tous tes jeux, ${all.length} en tout" data-tip="Tous tes jeux" data-tip-b data-tip-r>+${rest}</button>
          <div class="sp-all" id="spAll" role="dialog" aria-label="Tous tes jeux" hidden>
            ${all.length >= 8 ? `<label class="sp-q" for="spQ">${ic('search')}<span>Rechercher un jeu</span><input id="spQ" type="search" autocomplete="off" spellcheck="false" placeholder=" "></label>` : ''}
            <div class="sp-list" id="spList"></div>
          </div>` : ''}
        </div></div>
      </header>
      ${tabs.length ? `<div class="sp-nav"><div class="pills sp-tabs" role="tablist" aria-label="Sections">${tabs.map(([k, l]) => `<button class="pill" role="tab" data-t="${k}" aria-selected="${S.statsTab === k}">${l}${k === 'board' ? `<em>${Board.badge()}</em>` : ''}</button>`).join('')}</div><div class="sp-who" id="spWho"></div></div>` : ''}
      <div id="spBody"></div>`
    const pick = (id) => { if (S.statsGame === id) return; S.statsGame = id; S.statsTab = 'overview'; vt(render) }
    $$('.sp-g', sc).forEach((b) => b.onclick = () => pick(b.dataset.g))
    $$('.sp-tabs .pill', sc).forEach((b) => b.onclick = () => { S.statsTab = b.dataset.t; $$('.sp-tabs .pill', sc).forEach((x) => x.setAttribute('aria-selected', x === b)); body() })
    if (rest > 0) allGames(sc, all, cur, pick)
    if (g === 'bf6' && Real.st.tracked?.me) Board.ensure()
    body()
  }
  // Toute la liste : tout se retrouve, même à 50 jeux, et la jaquette choisie rejoint la rangée
  function allGames(sc, all, cur, pick) {
    const btn = $('#spMore', sc), box = $('#spAll', sc), list = $('#spList', sc), q = $('#spQ', sc)
    const row = (x) => `<button class="sp-li" data-g="${x.id}" data-name="${esc(x.name)}" ${x.id === cur.id ? 'aria-current="true"' : ''}><img src="${esc(A(x.cover))}" alt="" draggable="false" loading="lazy"><span><b>${esc(x.name)}</b><span>${!linked(x.id) ? 'Relie ton compte pour voir tes stats' : x.time ? `${esc(x.time)} de jeu` : 'Pas encore joué'}</span></span>${x.id === cur.id ? ic('check') : ''}</button>`
    const paint = () => {
      const t = q ? q.value.trim().toLowerCase() : '', shown = all.filter((x) => x.name.toLowerCase().includes(t))
      // Rangés en deux : les jeux déjà reliés, puis ceux qui attendent ton compte
      const on = shown.filter((x) => linked(x.id)), off = shown.filter((x) => !linked(x.id))
      const grp = (t, xs) => (xs.length ? `<p class="sp-gh">${t}</p>${xs.map(row).join('')}` : '')
      list.innerHTML = shown.length ? (off.length ? grp('Reliés', on) + grp('À relier', off) : shown.map(row).join('')) : `<div class="sp-none"><p>Aucun jeu ne contient « ${esc(q.value)} ».</p><button class="btn sm" id="spClr">Effacer la recherche</button></div>`
      $$('.sp-li', list).forEach((b) => b.onclick = () => { close(); pick(b.dataset.g) })
      $('#spClr', list)?.addEventListener('click', () => { q.value = ''; paint(); q.focus() })
    }
    const away = (e) => { if (!box.isConnected) { awayAc?.abort(); awayAc = null; return } if (!e.target.closest('#spAll,#spMore')) close(false) }
    function close(giveBack = true) { if (box.hidden) return; box.hidden = true; btn.setAttribute('aria-expanded', 'false'); awayAc?.abort(); awayAc = null; if (giveBack) btn.focus() }
    btn.onclick = () => {
      if (!box.hidden) return close()
      box.hidden = false; btn.setAttribute('aria-expanded', 'true'); if (q) q.value = ''; paint()
      ;(q || $('.sp-li', list))?.focus(); awayAc?.abort(); awayAc = new AbortController(); document.addEventListener('pointerdown', away, { capture: true, signal: awayAc.signal })
    }
    q?.addEventListener('input', paint)
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = [...(q ? [q] : []), ...$$('.sp-li', list)], i = items.indexOf(document.activeElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
    })
  }
  const skel = (b) => { b.innerHTML = `<div class="sp-sk" aria-busy="true"><span class="sr-only" role="status">Lecture de tes stats</span><div class="sp-big" aria-hidden="true">${[0, 1, 2, 3].map(() => '<div class="sp-n"><i></i><i></i></div>').join('')}</div><i class="sp-skc" aria-hidden="true"></i></div>` }
  const head = (rows) => `<div class="sp-big">${rows.map(([l, v, d, u, x]) => `<div class="sp-n"><b class="num odo-host" data-v="${v}" data-d="${d}" data-u="${u || ''}"></b><span>${esc(l)}</span>${x || ''}</div>`).join('')}</div>`
  function runHead(b) { $$('.odo-host', b).forEach((e, i) => setTimeout(() => odo(e, +e.dataset.v, +e.dataset.d, e.dataset.u), i * 30)) }
  const failedBox = (b, msg, retry) => { b.innerHTML = `<div class="empty"><span class="empty-x">${ic('warn')}</span><h2>Stats indisponibles</h2><p>${esc(msg)}</p><button class="btn sm" id="spRetry">${ic('refresh')}Réessayer</button></div>`; $('#spRetry', b).onclick = retry }

  /* ---------- Battlefield 6 ---------- */
  function linkCard(b) {
    const g = Real.statGame('bf6')
    b.innerHTML = `<section class="sp-link"><div class="sp-link-t"><h2>Relie ton profil Battlefield 6</h2><p>Entre ton pseudo EA, celui affiché en jeu. Player X retrouve ton compte, même si tu joues sur Steam, PlayStation ou Xbox.</p><div id="spSearch"></div></div>${g.cover ? `<span class="sp-link-c" data-name="${esc(g.name)}"><img src="${esc(A(g.cover))}" alt=""></span>` : ''}</section>`
    PlayerSearch.mount($('#spSearch', b), { action: 'C’est moi', importPx: true, exclude: [], autofocus: true, onPick: async (a) => {
      try { Real.st.tracked = await API.bf6SetTracked({ me: a, rivals: Real.st.tracked?.rivals || [] }) } catch (e) { return toast(`Ton profil n’a pas pu être relié. ${esc(errText(e))}`, { tone: 'warn', ms: 6000 }) }
      Board.reset(); render(); toast(`${ic('check')} Profil relié : ${esc(a.name)}`, { ms: 3200 })
    } })
  }
  // Profil pas encore relié : la carte de liaison, et à côté ce qu'elle débloque, sans aucun chiffre
  const UNLOCK = [['Vue d’ensemble', 'Ton K/D, tes victoires et l’évolution de ton K/D, relevés sur ton profil.'], ['Arsenal, cartes et modes', 'Tes armes, tes cartes et tes modes, rangés par éliminations et par victoires.'], ['Classement', 'Toi face aux joueurs que tu suis, sur les mêmes chiffres.']]
  function unlinked(b) {
    b.innerHTML = `<div class="sp-ux"><div id="spLk"></div><aside class="sp-unl" aria-labelledby="spUnlH"><h2 id="spUnlH">Ce que tu débloques</h2><ul>${UNLOCK.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ul></aside></div>`
    linkCard($('#spLk', b))
  }
  // État de liaison pas encore lu : un squelette, puis le bon écran
  function waitLink(b) {
    skel(b)
    API.bf6GetTracked().then((t) => { if (Real.st.tracked === undefined) Real.st.tracked = t; if (S.view === 'stats' && S.statsGame === 'bf6' && b.isConnected) render() })
      .catch(() => { if (b.isConnected) failedBox(b, 'Player X n’a pas pu lire ton profil Battlefield 6. Réessaie dans un instant.', body) })
  }
  async function bf6Snap(refresh) { return API.bf6Stats(Real.st.tracked.me, refresh) }
  function paintWho(snap) {
    const w = $('#spWho'); if (!w) return
    const m = Real.st.tracked.me
    w.innerHTML = `<span>${esc(snap?.stats.account.name || m.name)}, ${esc(PLAT[m.platform] || m.platform)}${snap ? `, relu ${esc(T.timeAgo(snap.fetchedAt))}` : ''}</span><button class="btn sm icon" id="spRef" aria-label="Actualiser mes stats" data-tip="Actualiser mes stats" data-tip-b data-tip-r>${ic('refresh')}</button>`
    $('#spRef', w).onclick = async (e) => { const x = e.currentTarget; x.setAttribute('aria-busy', 'true'); try { await bf6Snap(true) } catch (err) { toast(esc(errText(err)), { tone: 'warn', ms: 4000 }) } x.removeAttribute('aria-busy'); body() }
  }
  async function bf6Body(b, t, me) {
    const sk = setTimeout(() => { if (me === token && b.isConnected) skel(b) }, 100)
    let snap = null, msg = ''
    try { snap = await bf6Snap(false) } catch (e) { msg = errText(e) }
    clearTimeout(sk)
    if (me !== token || !b.isConnected) return
    paintWho(snap)
    if (!snap) return failedBox(b, msg || 'Le service de stats ne répond pas. Réessaie dans quelques minutes.', body)
    const st = snap.stats, warn = snap.stale ? `<div class="lb-note">${ic('warn')}<p>${esc(snap.stale)} Dernières stats connues affichées.</p></div>` : ''
    if (t === 'overview') {
      const rank = Board.rankLine() ? `<button class="sp-rk" id="spRk"><span>${Board.rankLine()}</span>${ic('chev')}</button>` : ''
      const classes = entries(st.classes), total = classes.reduce((a, c) => a + (c.secondsPlayed || c.kills || 0), 0) || 1
      const KIND = (n) => { const x = T.norm(n); return x.includes('assau') ? 'assault' : x.includes('ingen') || x.includes('engin') ? 'engineer' : x.includes('soutien') || x.includes('support') ? 'support' : x.includes('eclair') || x.includes('recon') ? 'recon' : null }
      b.innerHTML = `${warn}${head([['K/D', st.killDeath, 2, '', rank], ['Élim. par minute', st.killsPerMinute, 2], ['Victoires', Math.round(st.winPercent), 0, ' %'], ['Éliminations', st.kills, 0]])}
        <div id="spChart"></div>
        <h2 class="sp-h">Dernières sessions</h2><div id="spLast"></div>
        ${classes.length ? `<h2 class="sp-h">Tes classes</h2><div class="sp-cl">${classes.map((c) => { const k = KIND(c.name), cl = k && CLASS[k], p = Math.round((c.secondsPlayed || c.kills || 0) / total * 100); return `<div class="sp-c"><span class="sp-ci" style="color:${cl?.c || 'currentColor'}">${cl ? CLASS_ICONS[cl.icon] : ic('users')}</span><b>${esc(cl?.n || c.name)}</b><span class="sp-cb"><i style="--w:${p}%"></i></span><span class="num">${p} %</span></div>` }).join('')}</div>` : ''}`
      $('#spRk', b)?.addEventListener('click', () => $('.sp-tabs [data-t=board]').click())
      runHead(b)
      Recap.listInto($('#spLast', b), 'bf6', 3)
      API.bf6History(Real.st.tracked.me).then((pts) => { const box = $('#spChart', b); if (box && me === token) historyChart(box, pts.map((p) => ({ at: p.at, v: p.deaths ? p.kills / p.deaths : p.kills })), 'K/D') }).catch(() => {})
    } else if (t === 'arsenal') {
      const list = entries(st.weapons).sort((x, y) => (y.kills || 0) - (x.kills || 0)).slice(0, 12), max = list[0]?.kills || 1
      b.innerHTML = list.length ? `${warn}<div class="ar-row">${list.map((w, i) => `<article class="ar" style="--i:${i}">${w.image ? `<img src="${esc(w.image)}" alt=""${i >= 4 ? ' loading="lazy" decoding="async"' : ''} draggable="false" data-fb="1">` : ''}<div class="ar-t"><h3>${esc(w.name)}</h3><p>${w.accuracy != null && w.accuracy <= 100 ? `${fr(w.accuracy, 1)} % de précision` : w.secondsPlayed ? duration(w.secondsPlayed) : ''}</p></div><dl><div><dd class="num">${fr(w.kills || 0)}</dd><dt>Éliminations</dt></div><div><dd class="num">${w.killDeath != null ? fr(w.killDeath, 2) : w.kpm != null ? fr(w.kpm, 2) : '–'}</dd><dt>${w.killDeath != null ? 'K/D' : 'Élim./min'}</dt></div></dl><i class="ar-u" style="--w:${(w.kills || 0) / max}"></i></article>`).join('')}</div>` : `<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucune arme pour l’instant</h2><p>Le service de stats n’a encore rien compté pour ce profil.</p></div>`
    } else if (t === 'maps') {
      // Cartes : une grille serrée, le nom et le % de victoires sur l'image, une barre fine pour le % ; le nombre de parties en petit.
      // Modes : une liste, leur icône (noire chez le service) éclaircie, sans « Official » qui n'est que le total, et sans doublon.
      const pct = (m) => (m.winPercent != null ? Math.round(m.winPercent) : null)
      const parties = (m) => `${fr(m.matches || 0)} partie${(m.matches || 0) > 1 ? 's' : ''}`
      const maps = entries(st.maps).sort((x, y) => (y.matches || 0) - (x.matches || 0))
      const byName = new Map()
      entries(st.modes).filter((m) => !/^official$/i.test(String(m.name || '').trim())).forEach((m) => {
        const k = String(m.name || '').trim().toLowerCase(), o = byName.get(k)
        if (!o) { byName.set(k, { ...m }); return }
        const n = (o.matches || 0) + (m.matches || 0)
        if (o.winPercent != null && m.winPercent != null && n) o.winPercent = ((o.winPercent * (o.matches || 0)) + (m.winPercent * (m.matches || 0))) / n
        o.matches = n; o.image = o.image || m.image
      })
      const modes = [...byName.values()].sort((x, y) => (y.matches || 0) - (x.matches || 0))
      const tile = (m) => `<article class="mq">${m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy" data-fb="1">` : ''}<div class="mq-t"><h3>${esc(m.name)}</h3>${pct(m) != null ? `<b class="num">${pct(m)} %</b>` : ''}</div><p class="num">${parties(m)}</p>${pct(m) != null ? `<i class="mq-bar" style="--w:${pct(m) / 100}"></i>` : ''}</article>`
      const row = (m) => `<li class="mr">${m.image ? `<span class="mr-ic"><img src="${esc(m.image)}" alt="" loading="lazy" data-fb="1"></span>` : '<span class="mr-ic"></span>'}<span class="mr-n"><b>${esc(m.name)}</b><small class="num">${parties(m)}</small></span>${pct(m) != null ? `<i class="mr-bar"><i style="--w:${pct(m) / 100}"></i></i><b class="mr-p num">${pct(m)} %</b>` : '<span></span><span></span>'}</li>`
      b.innerHTML = maps.length || modes.length ? `${warn}${maps.length ? `<div class="mq-h"><h2 class="sp-h">Cartes</h2><span>% de victoires</span></div><div class="mq-grid">${maps.map(tile).join('')}</div>` : ''}${modes.length ? `<div class="mq-h"><h2 class="sp-h">Modes</h2><span>% de victoires</span></div><ol class="mr-list">${modes.map(row).join('')}</ol>` : ''}` : `<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucune carte pour l’instant</h2><p>Le service de stats n’a encore rien compté pour ce profil.</p></div>`
    } else if (t === 'board') Board.render(b)
  }

  /* ---------- Counter-Strike 2 ---------- */
  const LIFE_FIX = { 'no-account': 'Connecter Steam', 'no-key': 'Ajouter la clé', 'key-refused': 'Vérifier la clé', private: 'Voir mes comptes' }
  async function cs2Body(b, t, me) {
    if (t === 'matches') return Recap.listInto(b, 'cs2')
    const sk = setTimeout(() => { if (me === token && b.isConnected) skel(b) }, 100)
    const res = await API.cs2Lifetime().catch((e) => ({ ok: false, reason: 'error', message: errText(e) }))
    clearTimeout(sk)
    if (me !== token || !b.isConnected) return
    const who = $('#spWho')
    if (who) who.innerHTML = res.ok ? `<span>Totaux de Steam, relus ${esc(T.timeAgo(res.fetchedAt))}</span><button class="btn sm icon" id="spRef" aria-label="Actualiser mes stats" data-tip="Actualiser mes stats" data-tip-b data-tip-r>${ic('refresh')}</button>` : ''
    $('#spRef', who)?.addEventListener('click', async (e) => { const x = e.currentTarget; x.setAttribute('aria-busy', 'true'); await API.cs2Lifetime(true).catch(() => {}); x.removeAttribute('aria-busy'); body() })
    const noData = () => `<div class="empty"><span class="empty-x">${xm()}</span><h2>Totaux de Counter-Strike 2 indisponibles</h2><p>${esc(res.message || 'Steam ne répond pas pour le moment.')}</p>${LIFE_FIX[res.reason] ? `<button class="btn sm" id="spFix">${LIFE_FIX[res.reason]}</button>` : `<button class="btn sm" id="spRetry">${ic('refresh')}Réessayer</button>`}</div>`
    const bind = () => { $('#spFix', b)?.addEventListener('click', () => Settings.open('accounts')); $('#spRetry', b)?.addEventListener('click', body) }
    const warn = res.ok && res.stale ? `<div class="lb-note">${ic('warn')}<p>${esc(res.stale)} Derniers totaux connus affichés.</p></div>` : ''
    const sample = res.ok && res.sample ? '<p class="demo">Chiffres d’exemple</p>' : ''
    if (t === 'overview') {
      const tt = res.ok ? res.stats.totals : null, kd = tt && L.kdOf(tt), hs = tt && L.headshotPct(tt), win = tt && L.matchWinPct(tt), hours = tt && L.hoursOf(tt)
      const rows = res.ok ? [kd != null && ['K/D', kd, 2], hs != null && ['Headshots', Math.round(hs), 0, ' %'], win != null && ['Victoires', Math.round(win), 0, ' %'], hours != null && ['Heures de jeu', Math.round(hours), 0]].filter(Boolean) : []
      b.innerHTML = `${warn}${res.ok ? `${head(rows)}${sample}<div id="spChart"></div>` : noData()}<h2 class="sp-h">Derniers matchs</h2><div id="spLast"></div>`
      bind(); runHead(b)
      Recap.listInto($('#spLast', b), 'cs2', 3)
      if (res.ok) historyChart($('#spChart', b), (res.history || []).filter((p) => p.kills != null && p.deaths).map((p) => ({ at: p.at, v: p.kills / p.deaths })), 'K/D')
    } else if (t === 'weapons') {
      if (!res.ok) { b.innerHTML = noData(); return bind() }
      const list = res.stats.weapons, ids = new Set(list.map((w) => w.id)), max = list[0]?.kills || 1, base = L.weaponBase(res.stats) || 1
      b.innerHTML = list.length ? `${warn}<ol class="bd wp">${list.slice(0, 24).map((w, i) => `<li style="--i:${i}"><span class="bd-r num">${i + 1}</span><b>${esc(L.weaponLabel(w.id, ids))}</b><span class="bd-b"><i style="--w:${w.kills / max}"></i></span><span class="bd-v num">${fr(w.kills)}</span><span class="bd-h num">${fr(w.kills / base * 100, 1)} %</span></li>`).join('')}</ol>${sample}` : `<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucune arme pour l’instant</h2><p>Steam n’a encore rien compté pour ce compte.</p></div>`
    } else if (t === 'maps') {
      if (!res.ok) { b.innerHTML = noData(); return bind() }
      const CS = ['ancient', 'anubis', 'dust2', 'inferno', 'mirage', 'nuke', 'overpass', 'train', 'vertigo']
      const img = (id) => { const k = id.replace(/^(de|cs|ar)_/, ''); return CS.includes(k) ? `<img src="${esc(A('cs_' + k))}" alt="" loading="lazy">` : '' }
      const list = res.stats.maps
      b.innerHTML = list.length ? `${warn}<div class="mp-grid">${list.slice(0, 24).map((m) => { const p = L.mapWinPct(m); return `<article class="mp">${img(m.id)}<div><h3>${esc(Shared.cs2.mapLabel(m.id))}</h3><p class="num">${p != null ? `${fr(Math.round(p))} % de rounds gagnés, ` : ''}${fr(m.rounds || 0)} round${(m.rounds || 0) > 1 ? 's' : ''}</p></div></article>` }).join('')}</div>${sample}` : `<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucune carte pour l’instant</h2><p>Steam n’a encore rien compté pour ce compte.</p></div>`
    }
  }
  function body() {
    const g = S.statsGame, b = $('#spBody'), t = S.statsTab, me = ++token
    if (!b) return
    if (t === 'loadouts') { $('#spWho') && ($('#spWho').innerHTML = ''); return Loadouts.render(b) }
    if (g === 'bf6') {
      if (Real.st.tracked === undefined) return waitLink(b)
      if (!Real.st.tracked?.me) { $('#spWho') && ($('#spWho').innerHTML = ''); return unlinked(b) }
      return bf6Body(b, t, me)
    }
    cs2Body(b, t, me)
  }
  // La courbe, un relevé par jour : ton vrai K/D à vie, tel que Player X l'a relevé
  function historyChart(box, pts, unit) {
    if (!box) return
    if (pts.length < 2) { box.innerHTML = `<p class="sp-note">${ic('stats')}La courbe de ton ${esc(unit)} apparaîtra après deux jours de relevés.</p>`; return }
    const last = pts.slice(-30), dayFr = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
    box.innerHTML = `<figure class="sp-chart"><figcaption>Ton ${esc(unit)}, relevé par relevé</figcaption>${chart(last.map((p) => p.v), unit, last.map((p) => dayFr.format(p.at)))}</figure>`
    requestAnimationFrame(() => requestAnimationFrame(() => $('.ch', box)?.classList.add('in')))
    chartHover($('#chBox', box), last.map((p) => dayFr.format(p.at)))
  }
  // La courbe : une ligne fine, une grille discrète, et au survol la valeur de chaque relevé
  function chart(v, unit, labels) {
    const W = 1000, H = 200, pad = 8, padL = 34
    const lo0 = Math.min(...v), hi0 = Math.max(...v), span = Math.max(hi0 - lo0, Math.max(.04, hi0 * .02)), min = lo0 - span * .35, max = hi0 + span * .35
    const x = (i) => padL + i * (W - padL - pad) / (v.length - 1), y = (n) => H - pad - (n - min) / (max - min) * (H - pad * 2)
    const pts = v.map((n, i) => [x(i), y(n)])
    const d = pts.map(([a, b], i) => { if (!i) return `M${a},${b}`; const [p, q] = pts[i - 1]; const c = (a - p) / 2; return `C${p + c},${q} ${a - c},${b} ${a},${b}` }).join(' ')
    const best = v.indexOf(hi0), lastP = pts.at(-1)
    const raw = (max - min) / 3, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw) || raw
    const ticks = []; for (let n = Math.ceil(min / step) * step; n <= max + 1e-9; n += step) ticks.push(n)
    const dec = step < .1 ? 2 : 1
    return `<div class="ch" id="chBox" role="img" aria-label="${esc(unit)} sur ${v.length} relevés : ${v.map((n) => fr(n, 2)).join(', ')}" data-v="${v.join(',')}" data-x="${pts.map((p) => p[0] / W * 100).join(',')}" data-y="${pts.map((p) => p[1] / H * 100).join(',')}" data-u="${esc(unit)}">
        ${ticks.map((n) => `<i class="ch-gl" style="top:${y(n) / H * 100}%"><span class="num">${fr(n, dec)}</span></i>`).join('')}
        <svg class="ch-area" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="chF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path d="${d} L${W - pad},${H} L${padL},${H} Z" fill="url(#chF)"/></svg>
        <svg class="ch-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="ch-line" d="${d}" fill="none" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
        <i class="ch-cross" aria-hidden="true"></i>
        ${pts.map(([a, b], i) => `<span class="ch-pt ${i === best ? 'best' : ''}" style="left:${a / W * 100}%;top:${b / H * 100}%">${i === best ? xm() : '<i></i>'}</span>`).join('')}
        <div class="ch-tip" aria-hidden="true"></div>
        <b class="ch-end num" style="top:${lastP[1] / H * 100}%">${fr(v.at(-1), 2)}</b>
      </div><div class="ch-x"><span>${esc(labels[0])}</span><span>${esc(labels.at(-1))}</span></div>`
  }
  function chartHover(box, labels) {
    if (!box) return
    const V = box.dataset.v.split(',').map(Number), X = box.dataset.x.split(',').map(Number), Y = box.dataset.y.split(',').map(Number), tip = $('.ch-tip', box), cross = $('.ch-cross', box), pts = $$('.ch-pt', box)
    const off = () => { box.classList.remove('hov'); pts.forEach((p) => p.classList.remove('on')) }
    box.addEventListener('pointerleave', off)
    box.addEventListener('pointermove', (e) => {
      const r = box.getBoundingClientRect(), f = (e.clientX - r.left) / r.width * 100
      let k = 0; X.forEach((x, i) => { if (Math.abs(x - f) < Math.abs(X[k] - f)) k = i })
      box.classList.add('hov'); pts.forEach((p, i) => p.classList.toggle('on', i === k))
      cross.style.left = X[k] + '%'
      tip.style.left = X[k] + '%'; tip.style.top = Y[k] + '%'
      tip.classList.toggle('flip', X[k] > 84); tip.classList.toggle('flipl', X[k] < 14)
      tip.innerHTML = `<b class="num">${fr(V[k], 2)}</b><span>${esc(labels[k])}</span>`
    })
  }
  return { render }
})()

// Loadouts, comme décidé le 2 novembre : rangés par arme, classés S, A, B, C. La carte est le « mix », sans pied.
const Loadouts = (() => {
  const SLOTS = ['optic', 'optic-accessory', 'muzzle', 'barrel', 'underbarrel', 'magazine', 'ammo', 'accessory', 'left-accessory', 'right-accessory', 'ergonomics']
  const TIERS = ['S', 'A', 'B', 'C']
  const CAT_PL = { 'Mitraillette': 'Mitraillettes', 'Fusil d’assaut': 'Fusils d’assaut', 'Mitrailleuse légère': 'Mitrailleuses légères', 'Fusil de précision': 'Fusils de précision', 'Carabine': 'Carabines', 'Fusil de tireur d’élite': 'Fusils de tireur d’élite', 'Fusil à pompe': 'Fusils à pompe', '': 'Sans catégorie' }
  const rank = (t) => { const i = TIERS.indexOf(t); return i < 0 ? 9 : i }
  const total = (x) => Object.values(x.parts).reduce((a, p) => a + (p[1] || 0), 0)
  const textOf = (d) => `${d.w}, ${d.name}${d.tier ? `, ${d.tier} tier` : ''} (${total(d)}/100)\n` + SLOTS.filter((s) => d.parts[s]).map((s) => `${SLOT[s]} : ${d.parts[s][0]}${d.parts[s][1] != null ? ` (${d.parts[s][1]})` : ''}`).join('\n')
  const groups = () => { const m = new Map(); BUILDS.forEach((x) => { if (!m.has(x.w)) m.set(x.w, { w: x.w, cat: x.cat, img: x.img, list: [] }); m.get(x.w).list.push(x) }); return [...m.values()].map((g) => ({ ...g, list: g.list.slice().sort((a, b) => rank(a.tier) - rank(b.tier)), best: g.list.map((x) => x.tier).sort((a, b) => rank(a) - rank(b))[0] })) }
  let host = null, cat = 'all'
  // Les vraies images des armes, celles de l'onglet Arsenal (service de stats), dès que ton profil BF6 est relié.
  // Sinon, l'image gardée dans l'appli, puis le dessin.
  const wkey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const WIMG = new Map()
  let wimgAsked = false
  function loadWimg() {
    if (wimgAsked || !Real.st.tracked?.me) return
    wimgAsked = true
    API.bf6Stats(Real.st.tracked.me, false).then((snap) => {
      ;(snap?.stats?.weapons || []).forEach((w) => { if (w.image && w.name) WIMG.set(wkey(w.name), w.image) })
      if (WIMG.size && host?.isConnected && !S.atelier) render(host)
    }).catch(() => { wimgAsked = false })
  }
  function art(g) {
    const r = WIMG.get(wkey(g.w))
    if (r) return `<img src="${esc(r)}" alt="" draggable="false" data-fb="1">`
    if (g.img) return `<img src="${esc(A(g.img))}" alt="" draggable="false">`
    if (!$('#lwaDefs')) document.body.append(h(`<svg id="lwaDefs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${WEAPON_ART.DEFS_A}</defs></svg>`))
    return `<svg viewBox="0 0 512 256" aria-hidden="true">${g.cat === 'Fusil de précision' || g.cat === 'Fusil de tireur d’élite' ? WEAPON_ART.SNIPER_A : WEAPON_ART.RIFLE_A}</svg>`
  }
  const tierTag = (t, cls = '') => t ? `<span class="lc-tier is-${t} ${cls}">${t}</span>` : ''
  // Une arme : son image, son nom, son meilleur rang s'il y en a un, et le nombre de loadouts en petite pastille
  const tile = (g) => `<button class="lw" data-w="${esc(g.w)}" aria-label="${esc(g.w)}, ${g.list.length} loadout${g.list.length > 1 ? 's' : ''}${g.best ? `, meilleur ${g.best} tier` : ''}"><span class="lw-art">${art(g)}</span>${tierTag(g.best, 'lw-tier')}<span class="lw-t"><b>${esc(g.w)}</b></span><span class="lw-n num" aria-hidden="true">${g.list.length}</span><span class="lw-go">${ic('chev')}</span></button>`
  // Un brouillon pas encore enregistré : il attend ici, avec de quoi le reprendre ou le jeter
  // Un brouillon pas encore enregistré : une carte en attente, pointillée, qui dit ce qu'il y a dedans. Un clic n'importe où la reprend.
  const draftCard = (d) => {
    const meta = [d.n ? `${d.n} accessoire${d.n > 1 ? 's' : ''}` : 'Aucun accessoire', d.n ? `${d.pts}/100` : '', `gardé ${d.when}`].filter(Boolean).join(', ')
    const on = Math.min(10, Math.round(d.pts / 10))
    return `<div class="lo-dc">
      <button class="lo-dc-main" data-dgo="${esc(d.id || '')}" aria-label="Reprendre ${esc(d.edit ? d.title : `le brouillon ${d.label}`)}">
        <span class="lo-dc-art">${d.w ? art({ img: d.img, cat: d.cat }) : ic('plus')}</span>
        <span class="lo-dc-t"><em>${d.edit ? 'Modification non enregistrée' : 'Brouillon'}</em><b>${esc(d.w || 'Arme pas encore choisie')}${d.name ? `<span>${esc(d.name)}</span>` : ''}</b><small>${esc(meta)}</small>${d.n ? `<i class="lc-hatch" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</i>` : ''}</span>
        <span class="lo-dc-go">Reprendre${ic('chev')}</span>
      </button>
      <button class="lo-dc-x" data-ddrop="${esc(d.id || '')}" aria-label="Jeter ce brouillon" data-tip="Jeter le brouillon" data-tip-r>${ic('trash')}</button>
    </div>`
  }
  const draftBar = () => { const l = Atelier.drafts(); return l.length ? `<div class="lo-drafts">${l.map(draftCard).join('')}</div>` : '' }
  function bindDraft() {
    $$('[data-dgo]', host).forEach((b) => b.onclick = () => Atelier.resume(b.dataset.dgo || null))
    $$('[data-ddrop]', host).forEach((b) => b.onclick = () => {
      const id = b.dataset.ddrop || null, d = Atelier.drafts().find((x) => x.id === id)
      confirmDel({ title: `Jeter le brouillon « ${esc(d?.label || '')} » ?`, text: 'Ce que tu as saisi disparaît. Tes loadouts enregistrés ne changent pas.', verb: 'Jeter le brouillon', onOk: () => { Atelier.dropDraft(id); render(host) } })
    })
  }
  function render(b) {
    loadWimg()
    host = b
    const g = S.loWeapon && groups().find((x) => x.w === S.loWeapon)
    g ? weaponPage(g) : overview()
  }
  function overview() {
    const G0 = groups(), cats = [...new Set(G0.map((g) => g.cat))]
    if (cat !== 'all' && !cats.includes(cat)) cat = 'all'
    if (!G0.length) {
      // Un brouillon attend : c'est lui la suite logique, pas une page vide
      const dl = Atelier.drafts()
      const seed = `<button class="btn sm" id="loSeed">Ajouter mes ${Real.templates().length} builds</button>`
      host.innerHTML = dl.length
        ? `<div class="empty lo-dempty"><h2>${dl.length > 1 ? 'Tes loadouts en cours t’attendent' : 'Ton premier loadout t’attend'}</h2><p>${dl.length > 1 ? 'Reprends-en un là où tu l’as laissé' : 'Reprends-le là où tu l’as laissé'}, ou commence-en un autre.</p><div class="lo-drafts">${dl.map(draftCard).join('')}</div><div class="at-e2"><button class="btn sm" id="loNew0">${ic('plus')}Créer un autre loadout</button>${seed}</div></div>`
        : `<div class="empty"><span class="empty-x">${xm()}</span><h2>Aucun loadout pour l’instant</h2><p>Note ton premier build : tu le retrouves ici avant chaque partie.</p><div class="at-e2"><button class="btn sm rose" id="loNew0">${ic('plus')}Créer un loadout</button>${seed}</div></div>`
      $('#loNew0', host).onclick = () => Atelier.create(null, true)
      $('#loSeed', host).onclick = async (e) => { e.currentTarget.setAttribute('aria-busy', 'true'); try { await Real.addTemplates(); render(host); toast(`${ic('check')} Tes ${Real.templates().length} builds sont dans ton carnet`, { ms: 2200 }) } catch (x) { toast(esc(errText(x)), { tone: 'warn', ms: 4000 }); render(host) } }
      bindDraft()
      return
    }
    const shown = cats.filter((c) => cat === 'all' || c === cat)
    host.innerHTML = `${draftBar()}<div class="lo-top"><div class="pills lo-cats" role="group" aria-label="Type d’arme"><button class="pill sm" data-c="all" aria-pressed="${cat === 'all'}">Toutes</button>${cats.map((c) => `<button class="pill sm" data-c="${esc(c)}" aria-pressed="${cat === c}">${esc(CAT_PL[c] || c)}</button>`).join('')}</div><button class="btn sm" id="loNew">${ic('plus')}Créer un loadout</button></div>
      <div class="lo-all">${shown.flatMap((c) => G0.filter((g) => g.cat === c)).map(tile).join('')}</div>`
    $$('[data-c]', host).forEach((x) => x.onclick = () => { cat = x.dataset.c; overview() })
    $$('.lw', host).forEach((x) => x.onclick = () => { S.loWeapon = x.dataset.w; vt(() => render(host)) })
    $('#loNew', host).onclick = () => Atelier.create(null, true)
    bindDraft()
  }
  // Une arme : son image, son nom, « Créer un loadout » à côté. Puis ses loadouts, du meilleur au moins bon, sans titres de section : le rang est sur la carte.
  function weaponPage(g) {
    host.innerHTML = `${draftBar()}<div class="lv-h"><button class="lv-back" id="loAll" aria-label="Toutes les armes" title="Toutes les armes">${ic('back')}</button><div class="lv-art">${art(g)}</div><div class="lv-tt"><h2>${esc(g.w)}</h2></div><button class="btn sm rose lv-new" id="loNewW">${ic('plus')}Créer un loadout</button></div>
      <div class="lo-grid">${g.list.map(cardBox).join('')}</div>`
    $('#loAll', host).onclick = () => { S.loWeapon = null; vt(() => render(host)) }
    $('#loNewW', host).onclick = () => Atelier.create({ w: g.w, cat: g.cat }, true)
    // Plusieurs loadouts : seule la meilleure valeur de chaque stat reste en blanc, les autres s'effacent un peu
    if (g.list.length > 1) ['ctl', 'acc', 'mob', 'hip'].forEach((k) => { const els = $$(`.lc-st [data-k="${k}"]`, host), vals = els.map((x) => +x.dataset.v), max = Math.max(...vals); if (vals.some((v) => v !== max)) els.forEach((x) => x.classList.toggle('dim', +x.dataset.v !== max)) })
    bindDraft()
    bindCards()
  }
  const cardBox = (x) => `<div class="lc-box" data-id="${x.id}">${cardHTML(x)}${actsHTML(x)}</div>`
  // La carte : petite image de l'arme, nom, points. Les stats du jeu quand l'arme est relevée. Puis les accessoires avec leurs points, rien d'autre.
  // C'est aussi elle que « Copier l'image » colle sur Discord : elle se suffit à elle-même.
  function cardHTML(d) {
    const tot = total(d), filled = SLOTS.filter((s) => d.parts[s]), st = typeof Atelier !== 'undefined' ? Atelier.statsHTML(d.w, d.parts) : ''
    return `<article class="lc ${tot > 100 ? 'over' : ''}">
      <header class="lc-h"><span class="lc-th">${art(d)}</span><div class="lc-ht"><h3>${tierTag(d.tier)}<span>${esc(d.name)}</span></h3><p class="lc-wn">${esc(d.w)}</p>${d.ctx ? `<p class="lc-cx">${esc(d.ctx)}</p>` : ''}</div><b class="lc-tot num">${tot}<small>/100</small></b></header>
      ${st}
      ${filled.length ? `<ol class="lc-rows">${filled.map((s) => { const p = d.parts[s]; return `<li title="${esc(SLOT[s])}"><b>${esc(p[0])}</b>${p[1] != null ? `<span class="num">${p[1]}</span>` : ''}</li>` }).join('')}</ol>` : '<p class="lc-none">Aucun accessoire pour l’instant.</p>'}
      ${d.notes ? `<p class="lc-notes">${esc(d.notes)}</p>` : ''}
      ${tot > 100 ? `<p class="lc-err">${ic('info')} ${tot - 100} points de trop : retire un accessoire.</p>` : ''}
    </article>`
  }
  const actsHTML = (d) => `<div class="lc-acts" role="group" aria-label="Actions du loadout ${esc(d.name)}"><button data-a="edit" class="lc-a1">Modifier</button><button data-a="share" aria-expanded="false">Partager${ic('chevd')}</button><button data-a="dup">Dupliquer</button><button data-a="del" class="is-del" aria-label="Supprimer ${esc(d.name)}" title="Supprimer">${ic('trash')}</button></div>`
  // La carte seule, telle qu'à l'écran, dans le presse-papiers : Ctrl V dans Discord
  async function copyCard(box) {
    box.classList.add('is-shot'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const c = $('.lc', box), r = c.getBoundingClientRect()
    try { await API.copyAreaImage({ x: r.left, y: r.top, width: r.width, height: r.height }); toast(`${ic('check')} Image de la carte copiée : Ctrl V dans Discord`, { ms: 2400 }) } catch (e) { toast(esc(errText(e)), { tone: 'warn', ms: 4000 }) }
    box.classList.remove('is-shot')
  }
  function bindCards() {
    $$('.lc-box', host).forEach((box) => {
      const d = BUILDS.find((x) => x.id === box.dataset.id)
      const bind = () => {
        $('[data-a=edit]', box).onclick = () => Atelier.edit(d)
        $('.lc', box).ondblclick = () => Atelier.edit(d)
        $('[data-a=share]', box).onclick = (e) => menuAt(e.currentTarget, [
          ['copy', 'Copier l’image', () => copyCard(box)],
          ['chat', 'Copier le texte', async () => { try { await navigator.clipboard.writeText(textOf(d)); toast(`${ic('check')} Texte du loadout copié`, { ms: 2000 }) } catch { toast('Le texte n’a pas pu être copié. Réessaie.', { tone: 'warn', ms: 3000 }) } }]
        ])
        $('[data-a=dup]', box).onclick = async () => { const c = JSON.parse(JSON.stringify(d)); delete c.id; c.name = `${d.name} (copie)`.slice(0, 40); try { await Real.saveLoadout(c); render(host); toast(`${ic('copy')} « ${esc(d.name)} » dupliqué`, { ms: 1800 }) } catch (x) { toast(esc(errText(x)), { tone: 'warn', ms: 4000 }) } }
        $('[data-a=del]', box).onclick = () => confirmDel({ title: `Supprimer « ${esc(d.name)} » ?`, text: `Le loadout ${esc(d.w)} disparaît de ta liste. Ton arme dans le jeu ne change pas.`, verb: 'Supprimer le loadout', onOk: async () => { try { await Real.deleteLoadout(d.id) } catch (x) { return toast(esc(errText(x)), { tone: 'warn', ms: 4000 }) } Atelier.dropDraft(d.id); if (!BUILDS.some((x) => x.w === d.w)) S.loWeapon = null; render(host); toast(`${ic('trash')} Loadout « ${esc(d.name)} » supprimé`, { ms: 2200 }) } })
      }
      bind()
    })
  }
  return { render, tiles: () => groups().map(tile).join(''), SLOTS, total, cardHTML, catPl: (c) => CAT_PL[c] || c || CAT_PL[''], seed: () => Real.templateBuilds() }
})()
