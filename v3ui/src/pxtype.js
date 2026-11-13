// Lettrage « Player X » : les titres des jeux dessinés dans le même style que le mot du logo (large, penché, angles vifs, A sans barre, E en trois traits).
// Chaque mot devient un petit SVG : les mots passent à la ligne comme du texte. Un caractère inconnu : le titre reste en texte normal.
const PxType = (() => {
  const H = 20, S = 3, T = 4.2, TRACK = 4.2, SPACE = 8, SK = Math.tan((12 * Math.PI) / 180)
  // Les titres sont plus longs que « PLAYER X » : les lettres sont un peu resserrées (le trait vertical garde son épaisseur)
  const XS = 0.8
  const R = (a, b, c, d) => [[a, b], [c, b], [c, d], [a, d]]
  const M1 = (H - S) / 2, M2 = (H + S) / 2
  const G = {}
  const g = (ch, w, ...shapes) => { G[ch] = [w, shapes] }
  let W = 18
  g('A', W, [[0, 5.5], [5.5, 0], [W, 0], [W, S], [6.7, S], [S, 6.7], [S, H], [0, H]], R(W - S, S, W, H), R(S + 2.6, 10.3, W - S, 13.3))
  g('B', W, R(0, 0, S, H), R(S, 0, W, S), R(W - S, S, W, M1), R(S, M1, W, M2), R(W - S, M2, W, H - S), R(S, H - S, W, H))
  g('C', W, R(0, 0, S, H), R(S, 0, W, S), R(S, H - S, W, H))
  g('D', W, R(0, 0, S, H), R(S, 0, W - 5, S), [[W - 5, 0], [W, 5], [W, H - S], [W - S, H - S], [W - S, 6.2], [W - 6.2, S], [W - 5, S]], R(S, H - S, W, H))
  g('E', W, R(0, 0, W, S), R(3.4, M1, W, M2), R(0, H - S, W, H))
  g('F', W, R(0, 0, S, H), R(S, 0, W, S), R(S + 2.6, M1, W - 2, M2))
  g('G', W, R(0, 0, S, H), R(S, 0, W, S), R(S, H - S, W, H), R(W - S, 10, W, H - S), R(W - 8, 10, W - S, 13))
  g('H', W, R(0, 0, S, H), R(W - S, 0, W, H), R(S, M1, W - S, M2))
  g('I', S, R(0, 0, S, H))
  g('J', W, R(W - S, 0, W, H - S), R(0, H - S, W, H), R(0, 12, S, H - S))
  g('K', W, R(0, 0, S, H), [[S, 10.2], [S + T, 10.2], [W, 0], [W - T, 0]], [[S, 9.8], [S + T, 9.8], [W, H], [W - T, H]])
  g('L', W, R(0, 0, S, H), R(S, H - S, W, H))
  W = 22; g('M', W, R(0, 0, S, H), R(W - S, 0, W, H), R(S, 0, W - S, S), R(W / 2 - S / 2, S, W / 2 + S / 2, 13))
  W = 20; g('N', W, R(0, 0, S, H), R(W - S, 0, W, H), [[0, 0], [T, 0], [W, H], [W - T, H]])
  W = 18
  g('O', W, R(0, 0, S, H), R(W - S, 0, W, H), R(S, 0, W - S, S), R(S, H - S, W - S, H))
  g('P', W, R(0, 0, S, H), R(S, 0, W, S), R(W - S, S, W, 11.3), R(S + 3, 8.3, W, 11.3))
  g('Q', W, R(0, 0, S, H), R(W - S, 0, W, H - S), R(S, 0, W - S, S), R(S, H - S, W + 3, H))
  g('R', W, ...G.P[1], [[W - 8.5, 11.3], [W - 5, 11.3], [W, 16.6], [W, H], [W - 3.6, H]])
  g('S', W, R(0, 0, W, S), R(0, S, S, M1), R(0, M1, W, M2), R(W - S, M2, W, H - S), R(0, H - S, W, H))
  g('T', W, R(0, 0, W, S), R(W / 2 - S / 2, S, W / 2 + S / 2, H))
  g('U', W, R(0, 0, S, H), R(W - S, 0, W, H), R(S, H - S, W - S, H))
  W = 20; g('V', W, [[0, 0], [T, 0], [W / 2 + T / 2, H], [W / 2 - T / 2, H]], [[W - T, 0], [W, 0], [W / 2 + T / 2, H], [W / 2 - T / 2, H]])
  W = 22; g('W', W, R(0, 0, S, H), R(W - S, 0, W, H), R(S, H - S, W - S, H), R(W / 2 - S / 2, 7, W / 2 + S / 2, H - S))
  W = 20; g('X', W, [[0, 0], [T, 0], [W, H], [W - T, H]], [[W - T, 0], [W, 0], [T, H], [0, H]])
  W = 18
  g('Y', W, R(0, 0, S, M2), R(W - S, 0, W, M2), R(S, M1, W - S, M2), R(W / 2 - S / 2, M2, W / 2 + S / 2, H))
  g('Z', W, R(0, 0, W, S), R(0, H - S, W, H), [[W - T, S], [W, S], [T, H - S], [0, H - S]])
  W = 16
  g('0', W, ...G.O[1].map((p) => p.map(([x, y]) => [x * 16 / 18, y])))
  g('1', 8, R(5, 0, 8, H), R(0, 0, 5, S))
  g('2', W, R(0, 0, W, S), R(W - S, S, W, M1), R(0, M1, W, M2), R(0, M2, S, H - S), R(0, H - S, W, H))
  g('3', W, R(0, 0, W, S), R(3.4, M1, W, M2), R(0, H - S, W, H), R(W - S, 0, W, H))
  g('4', W, R(0, 0, S, M2), R(S, M1, W, M2), R(W - S, 0, W, H))
  g('5', W, R(0, 0, W, S), R(0, S, S, M1), R(0, M1, W - 3, M2), R(W - S, M2 - 0.01, W, H - S), R(0, H - S, W, H), R(W - S - 3, M1, W - S, M2))
  g('6', W, R(0, 0, W, S), R(0, S, S, H), R(S, M1, W, M2), R(W - S, M2, W, H), R(S, H - S, W, H))
  g('7', W, R(0, 0, W, S), [[W - T, S], [W, S], [W / 2 + 1, H], [W / 2 + 1 - T, H]])
  g('8', W, R(0, 0, S, H), R(W - S, 0, W, H), R(S, 0, W - S, S), R(S, M1, W - S, M2), R(S, H - S, W - S, H))
  g('9', W, R(0, 0, W, S), R(0, S, S, M2), R(S, M1, W, M2), R(W - S, S, W, H), R(0, H - S, W, H))
  g('-', 10, R(0, M1, 10, M2))
  g(':', S, R(0, 4, S, 7), R(0, H - S, S, H))
  g('!', S, R(0, 0, S, 13.5), R(0, H - S, S, H))
  g('.', S, R(0, H - S, S, H))
  g(',', S, R(0, H - S, S, H + 2))
  g("'", S, R(0, 0, S, 6))
  g('&', 14, R(0, M1, 14, M2), R(5.5, 3, 8.5, 17))
  g('+', 14, R(0, M1, 14, M2), R(5.5, 3, 8.5, 17))
  g('/', 12, [[12 - T, 0], [12, 0], [T, H], [0, H]])

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`´]/g, "'").replace(/[–—]/g, '-').replace(/[®™©]/g, '').toUpperCase()
  const ok = (name) => { const t = norm(name).trim(); return !!t && [...t].every((c) => c === ' ' || G[c]) }
  let uid = 0
  // Un mot : ses lettres, penchées vers l'avant, remplies d'un dégradé argent
  function word(w) {
    let x = 0
    const d = []
    for (const c of w) {
      const [cw, shapes] = G[c]
      for (const p of shapes) d.push('M' + p.map(([px, py]) => `${(px * XS + x + (H - py) * SK).toFixed(2)},${py.toFixed(2)}`).join('L') + 'Z')
      x += cw * XS + TRACK
    }
    const width = x - TRACK + H * SK
    const id = 'pxt' + ++uid
    return `<svg class="pxt-w" viewBox="-0.5 -0.5 ${(width + 1).toFixed(2)} ${H + 3}" style="aspect-ratio:${((width + 1) / (H + 3)).toFixed(4)}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#FFFFFF"/><stop offset=".72" stop-color="#E4DCE1"/><stop offset="1" stop-color="#B9AEB5"/></linearGradient></defs><path d="${d.join('')}" fill="url(#${id})"/></svg>`
  }
  // Le titre complet : le texte reste pour les lecteurs d'écran, les mots dessinés sont cachés pour eux
  function html(name) {
    const words = norm(name).trim().split(/\s+/)
    return `<span class="vh">${esc(name)}</span>${words.map(word).join(' ')}`
  }
  return { ok, html }
})()
