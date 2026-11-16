// Passage d'audit : chaque écran à la plus petite fenêtre (1024 x 640) et à 1280 x 800. Débordements, tailles de texte, cibles.
const { start, shot, settle, go } = require('./h.cjs')
const probe = () => {
  const doc = document.documentElement
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null; const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return null; return r }
  const inView = (r) => r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight
  const small = new Set(), heavy = new Set(), tiny = new Set(), cut = new Set()
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.textContent.trim(); if (!t) continue
    const e = n.parentElement; if (!e || e.closest('[hidden],[inert],svg,script,style')) continue
    const r = vis(e); if (!r || !inView(r)) continue
    const s = getComputedStyle(e)
    if (parseFloat(s.fontSize) < 12) small.add(`${parseFloat(s.fontSize)}px ${t.slice(0, 26)} <${e.className || e.tagName}>`)
    if (+s.fontWeight > 650) heavy.add(`${s.fontWeight} ${t.slice(0, 26)} <${e.className || e.tagName}>`)
    if (e.scrollWidth > e.clientWidth + 1 && s.overflow === 'visible' && s.display !== 'inline' && e.clientWidth > 0) cut.add(`${t.slice(0, 30)} <${e.className || e.tagName}> ${e.scrollWidth}>${e.clientWidth}`)
  }
  for (const b of document.querySelectorAll('button,a[href],[role=switch],[role=radio],input,select')) {
    if (b.closest('[hidden],[inert]')) continue
    const r = vis(b); if (!r || !inView(r)) continue
    if (r.width < 24 || r.height < 24) continue
    if (r.height < 40 && !/at-i|sr-lnk|ln-grip/.test(b.className)) tiny.add(`${Math.round(r.width)}x${Math.round(r.height)} ${(b.getAttribute('aria-label') || b.textContent).trim().slice(0, 26)} <${b.className || b.tagName}>`)
  }
  return { over: doc.scrollWidth - doc.clientWidth, overB: document.body.scrollWidth - document.body.clientWidth, small: [...small].slice(0, 8), heavy: [...heavy].slice(0, 8), tiny: [...tiny].slice(0, 10), cut: [...cut].slice(0, 8) }
}
;(async () => {
  const [w, h] = (process.argv[2] || '1024x640').split('x').map(Number)
  const tag = `${w}`
  const { app, p, errs } = await start({ name: 'a14', w, h, env: { PX_NEWS_SIM: 'auto', PX_READY_SIM: 'auto', PX_SERVERS_SIM: 'normal', PX_CS2_STATS_SIM: 'auto', PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' } })
  const report = async (n) => { const r = await p.evaluate(probe); console.log(n, JSON.stringify(r)); await shot(p, `a14-${tag}-${n}`) }
  try {
    await settle(p, 800); await report('home')
    await go(p, 'lib'); await settle(p, 800); await report('lib')
    await p.evaluate(() => Pages.openGame('cs2')); await settle(p, 1500); await report('fiche')
    await p.evaluate(() => Pages.closeGame()); await settle(p, 500)
    await go(p, 'clips'); await settle(p, 800); await report('clips')
    await go(p, 'stats'); await settle(p, 1500); await report('stats')
    await go(p, 'friends'); await settle(p, 1500); await report('amis')
    await p.keyboard.press('Control+,'); await settle(p, 800)
    for (const s of ['rec', 'overlay', 'routine', 'library', 'general', 'keys', 'accounts', 'about']) { await p.evaluate((x) => Settings.go(x), s); await settle(p, 500); await report('set-' + s) }
    await p.evaluate(() => Settings.close()); await settle(p, 500)
    await p.keyboard.press('Control+k'); await settle(p, 500); await report('palette'); await p.keyboard.press('Escape')
    console.log('ERREURS', errs.length); errs.slice(0, 12).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 12).join('\n')) }
  await app.close()
})()
