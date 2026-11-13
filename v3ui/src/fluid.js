// Le fond de l'appli, au choix dans Paramètres.
// Verre : la vraie image, nette, sous des zones floutées. Lignes et Écran : une trame nette, calculée au pixel de l'écran, qui tire sa lumière de l'image du jeu.
const Fluid = (() => {
  const MODES = [
    { k: 'verre', t: 'Verre', d: 'Ton jeu net, avec du flou seulement sous l’interface.' },
    { k: 'cannele', t: 'Cannelé', d: 'Pareil, avec un verre strié sous le texte.' },
    { k: 'lignes', t: 'Lignes', d: 'La jaquette en lignes fines, façon écran à balayage.' },
    { k: 'ecran', t: 'Écran', d: 'La jaquette en points lumineux, façon mur de LED.' },
    { k: 'mur', t: 'Mur', d: 'Tes jaquettes en mur incliné.' },
    { k: 'fluide', t: 'Fluide', d: 'Le fond d’avant, pour comparer.' }
  ]
  const PRESET = {
    verre: { raster: true, shape: 2, pitch: 4, art: true, rmax: .44, dom: 'bgi' },
    cannele: { raster: true, shape: 2, pitch: 4, art: true, rmax: .44, dom: 'bgi' },
    lignes: { raster: true, shape: 2, pitch: 4, art: true, rmax: .44 },
    ecran: { raster: true, shape: 0, pitch: 6, art: true, rmax: .45 },
    mur: { dom: 'bgw' },
    fluide: { fluid: true }
  }
  let gl, P = {}, tex = [], raf = 0, last = 0, t = Math.random() * 40, cv, running = false, off = false, mode = 'verre', soft = false, built = false
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
  let curPal = ['#0a1430', '#5e1038', '#d0205c', '#ff7a45'], curArt = null, curHero = null, srcKey = '', srcToken = 0
  let cur = curPal.map(hex), from = cur, to = cur, mix = 1, wave = 1, dim = 1, dimTo = 1, pageK = 1, pageTo = 1, frozen = false, dirty = true
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, k: 0, kTo: 0, at: 0 }
  const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'
  const FS_FLUID = `precision mediump float;uniform vec2 r;uniform float t,dim;uniform vec3 c0,c1,c2,c3;
  vec2 hash(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return -1.+2.*fract(sin(p)*43758.5453);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(dot(hash(i),f),dot(hash(i+vec2(1,0)),f-vec2(1,0)),u.x),mix(dot(hash(i+vec2(0,1)),f-vec2(0,1)),dot(hash(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y)*.5+.5;}
  float blob(vec2 p,vec2 c,float s){vec2 d=p-c;return exp(-dot(d,d)/s);}
  void main(){vec2 uv=gl_FragCoord.xy/r;float a=r.x/r.y;vec2 p=uv*vec2(a,1.);
    vec2 w=vec2(n(p*.9+vec2(t*.03,1.7)),n(p*.9+vec2(4.3,-t*.026)))-.5;
    p+=w*.5;
    vec3 col=c0;
    col=mix(col,c1,blob(p,vec2(a*(.68+.09*sin(t*.11)),.62+.1*cos(t*.13)),.36)*.95);
    col=mix(col,c2,blob(p,vec2(a*(.84+.08*cos(t*.09+1.)),.32+.13*sin(t*.12+2.)),.15)*.62);
    col=mix(col,c3,blob(p,vec2(a*(.5+.1*sin(t*.07+4.)),.14+.08*cos(t*.1+1.)),.09)*.3);
    col=mix(col,c1,blob(p,vec2(a*(.97+.03*sin(t*.08)),.95),.1)*.55);
    vec2 q=(uv-vec2(.64,.56))*vec2(1.12,1.36);
    col*=mix(.3,1.,smoothstep(1.16,.16,length(q)));
    vec2 s=(uv-vec2(.08,.24))*vec2(1.,1.2);
    col*=1.-.66*exp(-dot(s,s)/.26);
    col*=dim;
    col+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.*2.;
    gl_FragColor=vec4(col,1.);}`
  // Une seule lecture d'image par pixel : le coût reste faible, même à la pleine résolution de l'écran
  const FS_RASTER = `precision highp float;uniform vec2 r,ctr;uniform float cell,wave,t,dim,shape,pg,rmax,breath,even;uniform sampler2D ta,tb;uniform vec3 base,mouse;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  void main(){
    vec2 px=gl_FragCoord.xy,g=px/cell,id=floor(g),f=g-id-.5;
    float isLine=step(1.5,shape);
    vec2 uv=mix((id+.5)*cell,vec2(px.x,(id.y+.5)*cell),isLine)/r;
    float h=hash(id),asp=r.x/r.y;
    vec3 a=texture2D(ta,uv).rgb,b=texture2D(tb,uv).rgb;
    float d=length((uv-ctr)*vec2(asp,1.));
    float front=wave*2.3-d-h*.14;
    vec3 col=mix(b,a,smoothstep(0.,.08,front));
    float crest=step(wave,.999)*exp(-front*front/.01);
    vec2 q=(uv-ctr)*vec2(.9,1.05);
    float L=smoothstep(.27,.62,uv.x)*(.62+.38*exp(-dot(q,q)/.2));
    L=mix(L,.46+.3*exp(-dot(q,q)/.34),even);
    L*=mix(.5,1.,smoothstep(1.,.84,uv.y));
    L*=1.+breath*sin(uv.x*2.4+uv.y*1.3-t*.22);
    L*=pg;
    float md=length(px-mouse.xy)/(cell*(14.+isLine*6.));
    L=clamp(L+mouse.z*exp(-md*md)*.34+crest*.55,0.,1.);
    float lum=dot(col,vec3(.3,.59,.11)),e=sqrt(lum),aa=.55/cell,v;
    if(shape<.5){float R=mix(.07,rmax,pow(L,.8)*(.5+.5*e));v=smoothstep(R+aa,R-aa,length(f));}
    else{float T=mix(.045,rmax,L*(.32+.68*e));v=smoothstep(T+aa,T-aa,abs(f.y));}
    vec3 lit=col*(.1+.92*L);
    gl_FragColor=vec4(mix(base*(.7+.8*L),lit,v)*dim,1.);}`

  function build(name, fs, names) {
    const sh = (ty, src) => { const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s); return s }
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return false
    const u = {}; for (const k of names) u[k] = gl.getUniformLocation(p, k)
    P[name] = { p, u }; return true
  }
  function setup() {
    if (!build('fluid', FS_FLUID, ['r', 't', 'dim', 'c0', 'c1', 'c2', 'c3'])) return false
    if (!build('raster', FS_RASTER, ['r', 'ctr', 'cell', 'wave', 't', 'dim', 'shape', 'pg', 'rmax', 'breath', 'even', 'ta', 'tb', 'base', 'mouse'])) return false
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    tex = [gl.createTexture(), gl.createTexture()]
    tex.forEach((x) => { gl.bindTexture(gl.TEXTURE_2D, x); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 6, 11, 255])); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v) })
    return true
  }
  function init(canvas) {
    cv = canvas
    domLayers()
    // Les jeux arrivent après le fond : le mur se (re)construit à chaque nouvelle liste
    Real.on('games', buildWall)
    mode = savedMode()
    const opts = { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false }
    const softOk = /[?&]softgl/.test(location.search)
    try { gl = cv.getContext('webgl', { ...opts, failIfMajorPerformanceCaveat: !softOk }) } catch { gl = null }
    // Sans carte graphique : on dessine seulement quand quelque chose change, jamais en continu
    if (!gl) { soft = true; try { gl = cv.getContext('webgl', opts) } catch { gl = null } }
    if (gl && !setup()) gl = null
    applyMode()
    if (soft) $('#win').classList.add('no-z')
    if (!gl) { $('#win').classList.add('no-gl', 'no-z'); return false }
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop() })
    cv.addEventListener('webglcontextrestored', () => { P = {}; if (setup()) { srcKey = ''; applySource(); size(); start() } })
    const ro = new ResizeObserver((en) => { const b = en[0].devicePixelContentBoxSize?.[0]; size(b && b.inlineSize, b && b.blockSize) })
    try { ro.observe(cv, { box: 'device-pixel-content-box' }) } catch { ro.observe(cv) }
    size()
    document.addEventListener('visibilitychange', () => document.hidden ? stop() : start())
    const w = $('#win')
    w.addEventListener('pointermove', (e) => { if (reduced()) return; const b = cv.getBoundingClientRect(), kx = cv.width / (b.width || 1), ky = cv.height / (b.height || 1); mouse.tx = (e.clientX - b.left) * kx; mouse.ty = cv.height - (e.clientY - b.top) * ky; if (!mouse.kTo) { mouse.x = mouse.tx; mouse.y = mouse.ty } mouse.kTo = 1; mouse.at = performance.now(); parallax(e, b); wake() }, { passive: true })
    w.addEventListener('pointerleave', () => { mouse.kTo = 0; wake() })
    start()
    return true
  }
  let bw = 0, bh = 0, evenK = 0
  function size(dw, dh) {
    if (!gl) return
    if (dw && dh) { bw = dw; bh = dh } else { const b = cv.getBoundingClientRect(), d = devicePixelRatio || 1; bw = Math.round(b.width * d); bh = Math.round(b.height * d) }
    const k = PRESET[mode].fluid ? .34 : 1
    const W = Math.max(64, bw * k | 0), H = Math.max(40, bh * k | 0)
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
    gl.viewport(0, 0, W, H); dirty = true; draw()
  }
  function draw() {
    if (!gl) return
    const p = PRESET[mode]
    if (p.dom) return
    dirty = false
    cur = from.map((c, i) => c.map((v, j) => lerp(v, to[i][j], mix)))
    if (p.fluid) {
      const { p: pr, u } = P.fluid; gl.useProgram(pr)
      gl.uniform2f(u.r, cv.width, cv.height); gl.uniform1f(u.t, t); gl.uniform1f(u.dim, dim * pageK)
      cur.forEach((c, i) => gl.uniform3f(u['c' + i], c[0], c[1], c[2]))
    } else {
      const { p: pr, u } = P.raster; gl.useProgram(pr)
      const dp = cv.width / (cv.clientWidth || cv.width)
      gl.uniform2f(u.r, cv.width, cv.height); gl.uniform2f(u.ctr, evenK ? .5 : .685, evenK ? .5 : .49); gl.uniform1f(u.even, evenK)
      gl.uniform1f(u.cell, Math.max(3, Math.round(p.pitch * dp)))
      gl.uniform1f(u.wave, wave); gl.uniform1f(u.t, t); gl.uniform1f(u.dim, dim); gl.uniform1f(u.shape, p.shape)
      gl.uniform1f(u.pg, gridPage()); gl.uniform1f(u.rmax, p.rmax); gl.uniform1f(u.breath, frozen || reduced() || soft ? 0 : .07)
      const c0 = cur[0]; gl.uniform3f(u.base, c0[0] * .16 + .012, c0[1] * .16 + .01, c0[2] * .16 + .014)
      gl.uniform3f(u.mouse, mouse.x, mouse.y, mouse.k)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[0]); gl.uniform1i(u.ta, 0)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex[1]); gl.uniform1i(u.tb, 1)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  // Sur les pages à lire, la trame se retire : elle reste une matière, jamais un motif derrière le texte
  const gridPage = () => clamp(.22 + (pageK - .72) / .28 * .78, .12, 1)
  // La trame respire au repos, sauf mouvement réduit, fond figé, rendu logiciel, ou pendant une partie
  const breathing = () => !reduced() && !frozen && !soft && S.session?.phase !== 'game'
  function loop(now) {
    if (!running) return
    const p = PRESET[mode]
    if (mouse.kTo && now - mouse.at > 1400) mouse.kTo = 0
    const moving = mix < 1 || wave < 1 || Math.abs(pageK - pageTo) > .004 || Math.abs(dim - dimTo) > .002 || Math.abs(mouse.k - mouse.kTo) > .004 || (mouse.kTo && (Math.abs(mouse.x - mouse.tx) > .5 || Math.abs(mouse.y - mouse.ty) > .5))
    const idle = breathing()
    // Rien à dessiner (Verre, Cannelé, Mur : des calques d'image), ou rien ne bouge et rien n'a changé : la boucle s'arrête, wake() la relance
    if (p.dom || (!moving && !idle && !dirty && !mouse.kTo)) { running = false; return }
    raf = requestAnimationFrame(loop)
    const gap = p.fluid ? 33 : moving ? 33 : idle ? 100 : 400
    if (now - last < gap) return
    const dt = Math.min(.1, (now - last) / 1000); last = now
    if (idle) t += dt
    if (pageK !== pageTo) pageK = Math.abs(pageTo - pageK) < .004 ? pageTo : pageK + (pageTo - pageK) * Math.min(1, dt * 4)
    if (mix < 1) mix = Math.min(1, mix + dt / .9)
    if (wave < 1) wave = Math.min(1, wave + dt / .85)
    if (dim !== dimTo) dim = Math.abs(dim - dimTo) < .002 ? dimTo : dim + (dimTo - dim) * Math.min(1, dt * 5)
    mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 12); mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 12); mouse.k += (mouse.kTo - mouse.k) * Math.min(1, dt * 6)
    if (moving || idle || dirty) draw()
  }
  function start() { off = false; wake() }
  function stop() { off = true; running = false; cancelAnimationFrame(raf) }
  // Quelque chose a changé (couleurs, image, souris, page, mode) : la boucle repart si elle s'était arrêtée
  function wake() { if (!gl || running || off) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop) }

  // Les sources de la trame : l'image du jeu recadrée, ou les couleurs du jeu quand il n'y a pas d'image
  const TW = 512, TH = 300, cache = new Map()
  const loadImg = (url) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = url })
  async function artCanvas(url) {
    const im = await loadImg(url)
    const c = document.createElement('canvas'); c.width = TW; c.height = TH
    const x = c.getContext('2d'), s = Math.max(TW / im.naturalWidth, TH / im.naturalHeight)
    const w = im.naturalWidth * s, h = im.naturalHeight * s
    x.imageSmoothingQuality = 'high'; x.filter = 'saturate(1.22) contrast(1.06)'
    x.drawImage(im, (TW - w) / 2, (TH - h) * (h > w ? .36 : .5), w, h)
    return c
  }
  function palCanvas(pal) {
    const c = document.createElement('canvas'); c.width = TW; c.height = TH
    const x = c.getContext('2d'); x.fillStyle = pal[0]; x.fillRect(0, 0, TW, TH)
    const blob = (col, fx, fy, r, a) => { const g = x.createRadialGradient(fx * TW, fy * TH, 0, fx * TW, fy * TH, r * TW); g.addColorStop(0, col + Math.round(a * 255).toString(16).padStart(2, '0')); g.addColorStop(1, col + '00'); x.fillStyle = g; x.fillRect(0, 0, TW, TH) }
    blob(pal[1], .68, .4, .62, 1); blob(pal[2], .86, .68, .42, .85); blob(pal[3], .5, .86, .34, .5); blob(pal[1], .98, .06, .3, .7); blob(pal[2], .62, .2, .26, .4)
    return c
  }
  function source(key) {
    if (!cache.has(key)) cache.set(key, key.startsWith('pal:') ? Promise.resolve(palCanvas(key.slice(4).split(','))) : artCanvas(key))
    return cache.get(key)
  }
  function applySource() {
    const p = PRESET[mode]
    if (!gl || !p.raster || p.dom === 'bgi') return
    const palKey = 'pal:' + curPal.join(',')
    const key = p.art && curArt ? curArt : palKey
    if (key === srcKey) return
    srcKey = key
    const tk = ++srcToken
    source(key).catch(() => source(palKey)).then((c) => { if (tk === srcToken) push(c) }).catch(() => {})
  }
  let first = true
  function push(c) {
    if (!gl || !P.raster) return
    tex.reverse()
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[0])
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c) } catch { /* Image interdite de lecture : on garde les couleurs */ tex.reverse(); return }
    wave = reduced() || soft || first ? 1 : 0; first = false
    dirty = true; if (wave === 1) draw()
    wake()
  }
  function set(pal, art, hero, cover) {
    const root = document.documentElement; root.style.setProperty('--game-a', pal[2]); root.style.setProperty('--game-b', pal[3])
    curPal = pal; curArt = art || null; curHero = hero || null; curCover = cover || null
    showHero()
    if (!gl) return
    from = cur; to = pal.map(hex); mix = reduced() || soft ? 1 : 0
    applySource()
    if (reduced() || soft) { dirty = true; draw() }
    wake()
  }
  const DEF = ['#1a0f18', '#5e1038', '#c9184f', '#3a1a55']
  function game(g, fb) {
    if (!g) return set(fb || DEF)
    const cover = realCover(g)
    if (g.pal && g.cover) { wallShift(g); return set(g.pal, A(g.heroWide || g.cover), g.hero ? A(g.hero) : null, cover) }
    set(g.pal || fb || DEF, null, null, cover)
  }

  // Mur de jaquettes et image en grand : de simples calques sous l'appli
  // Seulement une vraie jaquette : jamais le repli « nom sur sa teinte »
  const realCover = (g) => (g?.cover && !/^data:image\/svg/.test(A(g.cover)) ? A(g.cover) : null)
  let wallEl, heroEl, bgxEl, heroOn = 0, heroUrl = null, curCover = null, wallSig = ''
  function domLayers() {
    if (built) return; built = true
    const w = $('#win')
    wallEl = h('<div id="bgw" aria-hidden="true"><div class="bgw-p"><div class="bgw-g"></div></div><i class="bgw-tint"></i></div>')
    const grp = '<figure class="bgi-g"><img class="bgi-u" alt="" draggable="false"><img class="bgi-m" alt="" draggable="false"></figure>'
    heroEl = h(`<div id="bgi" aria-hidden="true">${grp}${grp}</div>`)
    // Aucun jeu ni image : le logo Player X en grand, très atténué, dans une lueur rose
    bgxEl = h(`<div id="bgx" aria-hidden="true">${logo('bgx-l')}</div>`)
    w.prepend(bgxEl, wallEl, heroEl)
    buildWall()
  }
  // Le mur se construit avec tes vraies jaquettes, une fois les jeux lus, et suit la liste. Aucun jeu : pas de mur.
  function buildWall() {
    if (!wallEl) return
    const covers = [...new Set(GAMES.filter((g) => !g.hidden).map(realCover).filter(Boolean))], n = covers.length, sig = covers.join('|')
    if (sig === wallSig) return
    wallSig = sig
    const col = (c) => Array.from({ length: 11 }, (_, r) => `<img src="${esc(covers[(c * 5 + (r % 4) * 3 + (c % 2) * 2) % n])}" alt="" decoding="async" draggable="false">`).join('')
    $('.bgw-g', wallEl).innerHTML = n ? Array.from({ length: 13 }, (_, c) => `<div class="bgw-c">${col(c)}</div>`).join('') : ''
    if (mode === 'mur') $('#win').classList.toggle('bg-none', !n)
  }
  const coveredByImage = () => PRESET[mode].dom === 'bgi'
  function measure(im) {
    try {
      const c = document.createElement('canvas'); c.width = 32; c.height = 18
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 32, 18)
      const d = x.getImageData(0, 0, 32, 18).data
      let left = 0, all = 0, nl = 0, na = 0
      for (let i = 0; i < 576; i++) { const l = (d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11) / 255; all += l; na++; if (i % 32 < 15 && i >= 192) { left += l; nl++ } }
      return { left: left / nl, all: all / na }
    } catch { return { left: .5, all: .5 } }
  }
  function showHero() {
    if (PRESET[mode].dom !== 'bgi') return
    // Repli : l'image héros, sinon la jaquette du jeu en grand (vraies couleurs, assombrie)
    const url = curHero || curCover, isCover = !curHero && !!curCover
    if (url === heroUrl) return
    heroUrl = url
    const gs = $$('.bgi-g', heroEl), w = $('#win')
    if (!url) { gs.forEach((g) => g.classList.remove('on')); w.classList.add('bg-none'); return }
    const next = gs[1 - heroOn], prev = gs[heroOn], probe = new Image()
    const show = () => {
      if (heroUrl !== url) return
      $$('img', next).forEach((i) => { i.src = url })
      next.classList.toggle('is-cover', isCover)
      next.classList.toggle('is-wide', !isCover && probe.naturalWidth / (probe.naturalHeight || 1) > 2.1 && probe.naturalWidth < 2600)
      const m = measure(probe), tone = clamp(.68 + (m.left - .2) * .8, .68, .94).toFixed(3)
      $$('.z').forEach((z) => z.style.setProperty('--z-tone', tone))
      heroEl.style.setProperty('--art-dim', clamp((m.all - .3) * .62, 0, .34).toFixed(3))
      next.classList.add('on'); prev.classList.remove('on'); heroOn = 1 - heroOn
      w.classList.remove('bg-none')
    }
    const none = () => { if (heroUrl !== url) return; if (!isCover && curCover && curCover !== url) { curHero = null; heroUrl = undefined; return showHero() } heroUrl = null; gs.forEach((g) => g.classList.remove('on')); w.classList.add('bg-none') }
    probe.src = url
    probe.decode().then(show, none)
  }
  function wallShift(g) { if (wallEl) wallEl.style.setProperty('--wy', `${(GAMES.indexOf(g) % 6) * -22}px`) }
  function parallax(e, b) {
    if (frozen || (mode !== 'mur' && PRESET[mode].dom !== 'bgi')) return
    const x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5
    const el = mode === 'mur' ? wallEl : heroEl
    el.style.setProperty('--px', (x * (mode === 'mur' ? -22 : -12)).toFixed(1) + 'px'); el.style.setProperty('--py', (y * (mode === 'mur' ? -14 : -8)).toFixed(1) + 'px')
  }
  function bgVars() {
    const root = document.documentElement
    root.style.setProperty('--bg-k', (clamp((pageTo - .72) / .28, 0, 1) * .72 + .28).toFixed(3)); root.style.setProperty('--bg-dim', dimTo.toFixed(3))
  }

  // Changer d'approche
  const savedMode = () => { let m = null; try { m = localStorage.getItem('pxv3-fond') } catch { /* stockage indisponible */ } return PRESET[m] ? m : 'verre' }
  function applyMode() {
    const w = $('#win'); w.dataset.bg = mode
    bgVars()
    heroUrl = undefined; srcKey = ''; w.classList.remove('wall-soft', 'bg-none')
    if (mode === 'mur') w.classList.toggle('bg-none', !wallSig)
    if (gl) { size(bw, bh); applySource() }
    showHero()
    wake()
    $$('[data-fond]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.fond === mode))
    const d = $('#pFondD'); if (d) d.textContent = MODES.find((x) => x.k === mode).d
  }
  function setMode(m) {
    if (!PRESET[m] || m === mode) return
    mode = m; try { localStorage.setItem('pxv3-fond', m) } catch { /* stockage indisponible */ }
    first = true
    applyMode()
  }
  return {
    init, set, game, stop, modes: MODES, mode: setMode, current: () => mode,
    next() { const i = MODES.findIndex((x) => x.k === mode), n = MODES[(i + 1) % MODES.length]; setMode(n.k); return n },
    dim: (v) => { dimTo = v; bgVars(); wake() },
    even: (v) => { evenK = v ? 1 : 0; dirty = true; if (gl) draw() },
    // Sur les pages à lire, le fond baisse : le texte reste lisible partout
    page: (v) => { pageTo = v; bgVars(); wake() }, rest: () => { const home = S.view === 'play' && !S.gameId; pageTo = home ? 1 : .72; $('#win').classList.toggle('is-home', home); bgVars(); showHero(); wake() },
    freeze: (v) => { frozen = v; $('#win').classList.toggle('bg-still', !!v); dirty = true; if (v) for (const e of [wallEl, heroEl]) { e?.style.removeProperty('--px'); e?.style.removeProperty('--py') } wake() }
  }
})()
