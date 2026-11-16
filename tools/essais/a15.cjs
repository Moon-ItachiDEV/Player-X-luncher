// Clip à la main, coupe au plus près, coupe trop petite, renommer le pseudo sans rien bouger.
const { start, shot, settle, go } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a15', w: 1240, h: 720, env: { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' } })
  const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : String(JSON.stringify(x)).slice(0, 700))))
  try {
    await p.evaluate(() => Real.saveClips({ before: 16, after: 1, merge: 0, quality: 'light' }))
    await app.evaluate(() => { globalThis.pxCs2Sim.running(true) })
    for (let i = 0; i < 40; i++) { await p.waitForTimeout(1000); const b = await p.evaluate(() => Real.clipsLive?.bufferSeconds || 0); if (b >= 18) break }
    log('garde', await app.evaluate(() => globalThis.pxClipsTest.saveNow()))
    for (let i = 0; i < 25; i++) { await p.waitForTimeout(1000); if (await p.evaluate(async () => (await API.clipsList()).length)) break }
    await p.evaluate(() => { go('clips') }); await settle(p, 1500)
    await p.click('.ct-tile'); await settle(p, 2500)
    const dur = await p.evaluate(() => document.querySelector('#cpVid').duration)
    log('duree', dur)
    const cut = async (n) => {
      await p.evaluate(() => { document.querySelector('#grA').focus() })
      for (let i = 0; i < n; i++) await p.keyboard.press('ArrowRight')
      await p.waitForTimeout(300)
      const asked = await p.evaluate(() => document.querySelector('#cpSize').textContent)
      await p.click('#cpCut'); await p.waitForTimeout(3000)
      return { asked, toast: await p.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).slice(-1)[0]), top: await p.evaluate(async () => (await API.clipsList()).slice(0, 2).map((c) => [c.title, +c.durationS.toFixed(2)])), shown: await p.evaluate(() => document.querySelector('#cpTitle').textContent) }
    }
    log('un pas', await cut(1))
    await shot(p, 'a15-petit')
    await p.evaluate(() => Clips.close()); await settle(p, 800)
    await p.click('.ct-tile'); await settle(p, 2000)
    log('sept pas', await cut(7))
    await shot(p, 'a15-coupe')
    log('lecture', await p.evaluate(() => { const v = document.querySelector('#cpVid'); return [v.duration, v.readyState, v.error?.message] }))
    await p.evaluate(() => Clips.close()); await settle(p, 800)
    await p.keyboard.press('Control+,'); await settle(p, 1200); await p.evaluate(() => Settings.go('accounts')); await settle(p, 1500); await p.waitForTimeout(1500)
    const near = () => p.evaluate(() => { const r = document.querySelector('#r-me .sr-t>span').getBoundingClientRect(); const c = document.querySelector('#meCell').getBoundingClientRect(); const b = document.querySelector('#r-me .sr-c').getBoundingClientRect(); return [+r.top.toFixed(1), +r.left.toFixed(1), +c.height.toFixed(1), +b.left.toFixed(1)] })
    const n0 = await near(); await p.click('#meName'); await p.waitForTimeout(250); const n1 = await near(); await shot(p, 'a15-me'); await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    log('pseudo sans bouger', JSON.stringify(n0) === JSON.stringify(n1), n0, n1, await p.evaluate(() => document.activeElement?.id))
    log('ERREURS', errs.length); errs.slice(0, 12).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 12).join('\n')) }
  await app.close()
})()
