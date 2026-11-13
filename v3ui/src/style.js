// Boutons caméléon : l'accueil prend le style et la couleur du jeu affiché.
// La jaquette est lue une fois (60 × 90 pixels), le résultat est gardé ; les tags Steam viennent du processus principal.
// La règle (Shared.gameStyle) ne connaît aucun jeu : elle marche pour n'importe quelle bibliothèque.
const GameStyle = (() => {
  const KEY = 'pxv3-style-jeu', MEMO = 'pxv3-jaquettes-lues'
  let on = true
  try { on = localStorage.getItem(KEY) !== '0' } catch { /* stockage indisponible : allumé */ }
  // Ce qu'on a lu de chaque jaquette, par adresse (gardé entre deux ouvertures : pas de relecture au démarrage)
  let memo = {}
  try { memo = JSON.parse(localStorage.getItem(MEMO) || '{}') || {} } catch { memo = {} }
  const pending = new Map()
  let saveT = 0
  function keep(url, f) {
    memo[url] = f
    const keys = Object.keys(memo); if (keys.length > 300) delete memo[keys[0]]
    clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(MEMO, JSON.stringify(memo)) } catch { /* plein ou bloqué : gardé pour cette session */ } }, 800)
  }
  // Seulement une vraie jaquette : jamais le repli « nom sur sa teinte »
  const coverUrl = (g) => (g?.cover && !/^data:image\/svg/.test(A(g.cover)) ? A(g.cover) : null)
  function read(url) {
    if (url in memo) return Promise.resolve(memo[url])
    if (pending.has(url)) return pending.get(url)
    const p = new Promise((done) => {
      const im = new Image()
      // Sans CORS, l'image serait illisible pour le canvas : on la demande « anonyme » ; refusée, les tags décident seuls
      im.crossOrigin = 'anonymous'
      im.decoding = 'async'
      im.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = 60; c.height = 90
          const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 60, 90)
          const f = Shared.gameStyle.coverFeatures(x.getImageData(0, 0, 60, 90).data, 60, 90)
          keep(url, f); done(f)
        } catch { keep(url, null); done(null) }
      }
      im.onerror = () => done(null)
      im.src = url
    }).finally(() => pending.delete(url))
    pending.set(url, p)
    return p
  }
  const decide = (g, f) => Shared.gameStyle.decideStyle(f, g?.raw?.tags || g?.tags || [])
  /** Le style tout de suite si la jaquette est déjà lue, sinon null (et la lecture part). */
  function now(g) {
    if (!on || !g || g.id === '__all') return { style: 'neutre' }
    const url = coverUrl(g)
    if (!url) return decide(g, null)
    if (url in memo) return decide(g, memo[url])
    return null
  }
  /** Le style, une fois la jaquette lue. */
  async function of(g) {
    const s = now(g); if (s) return s
    return decide(g, await read(coverUrl(g)))
  }
  function paint(host, s) {
    if (!host) return
    const st = s?.style || 'neutre', prev = host.dataset.gs || 'neutre'
    if (st === 'neutre') { delete host.dataset.gs; host.style.removeProperty('--gs-acc'); host.style.removeProperty('--gs-on') }
    else { host.dataset.gs = st; host.style.setProperty('--gs-acc', s.accent); host.style.setProperty('--gs-on', s.onAccent) }
    // Changement de style : les boutons se redessinent dans un court fondu (la couleur, elle, glisse toute seule)
    if (st !== prev && !reduced()) { const a = $('.ht-acts', host); if (a) { a.classList.remove('gs-in'); void a.offsetWidth; a.classList.add('gs-in') } }
    return st !== prev
  }
  const restyleFns = []
  return {
    now, of, paint,
    styled: (host) => !!host?.dataset.gs,
    on: () => on,
    set(v) { on = !!v; try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* gardé pour cette session */ } restyleFns.forEach((f) => f()) },
    onChange(fn) { restyleFns.push(fn) }
  }
})()
