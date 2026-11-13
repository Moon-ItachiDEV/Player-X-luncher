const { start, shot, settle, go } = require('./h.cjs')
;(async () => {
  const { app, p, errs } = await start({ name: 'a12c', w: 1240, h: 720, env: { PX_CS2_SIM: 'manual', PX_CLIP_TEST_SOURCE: '640x360' } })
  const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x).slice(0, 700))))
  try {
    await p.evaluate(() => Real.saveClips({ before: 6, after: 2, merge: 2, quality: 'light' }))
    await app.evaluate(() => { globalThis.pxCs2Sim.running(true) })
    let rec = false
    for (let i = 0; i < 50; i++) {
      await p.waitForTimeout(1000)
      const s = await p.evaluate(() => ({ s: S.session?.phase, t2: document.querySelector('#bT2').textContent, live: Real.clipsLive }))
      if (i % 5 === 0) log(i, s)
      if (s.live?.status === 'recording' && (s.live.bufferSeconds || 0) >= 7) { rec = true; break }
    }
    log('enregistre', rec)
    await app.evaluate(() => { globalThis.pxCs2Sim.play() })
    let recap = false
    for (let i = 0; i < 70; i++) {
      await p.waitForTimeout(1000)
      const s = await p.evaluate(() => ({ s: S.session?.phase, t2: document.querySelector('#bT2').textContent, clips: CLIPS.length, toast: [...document.querySelectorAll('.toast')].map((x) => x.textContent).filter((x) => /Voir le bilan/.test(x)), story: !document.querySelector('#story').hidden }))
      if (i % 6 === 0) log(i, s)
      if (i === 14) await shot(p, 'a12-live')
      if (s.toast.length) { recap = true; break }
      if (s.story) { recap = true; break }
    }
    log('bilan', recap)
    await p.waitForTimeout(4000)
    log(await p.evaluate(() => CLIPS.map((c) => ({ t: c.title, d: c.durationS, s: c.sizeBytes, w: c.width, k: c.kind, kills: c.kills, hs: c.headshots, r: c.round, m: c.map }))))
    if (await p.$('.toast-a')) { await p.evaluate(() => { [...document.querySelectorAll('.toast-a')].find((x) => /bilan/.test(x.textContent))?.click() }); await p.waitForTimeout(1500) }
    await p.evaluate(() => Story.step(1)); await p.waitForTimeout(200); await p.evaluate(() => Story.step(1)); await p.waitForTimeout(1500); await shot(p, 'a12-best')
    await p.evaluate(() => Story.step(1)); await p.waitForTimeout(1500); await shot(p, 'a12-keep')
    await p.evaluate(() => Story.close()); await p.waitForTimeout(800)
    await p.evaluate(() => { go('clips') }); await settle(p, 1500); await shot(p, 'a12-list')
    await p.click('.ct-tile'); await settle(p, 2500); await shot(p, 'a12-player')
    log(await p.evaluate(() => { const v = document.querySelector('#cpVid'); return { dur: v.duration, t: v.currentTime, rs: v.readyState, err: v.error?.message, w: v.videoWidth, paused: v.paused, time: document.querySelector('#bTime').textContent, mode: document.querySelector('#bar').dataset.mode, size: document.querySelector('#cpSize').textContent } }))
    await p.evaluate(() => { document.querySelector('#grA').focus() }); for (let i = 0; i < 2; i++) await p.keyboard.press('ArrowRight'); await p.waitForTimeout(400); await shot(p, 'a12-trim')
    log(await p.evaluate(() => ({ cut: !document.querySelector('#cpCut').hidden, size: document.querySelector('#cpSize').textContent })))
    const before = await p.evaluate(async () => (await API.clipsList()).length)
    await p.click('#cpCut'); await p.waitForTimeout(3500)
    log('coupe', before, await p.evaluate(async () => { const l = await API.clipsList(); return { n: l.length, top: l.slice(0, 2).map((c) => [c.title, c.durationS, c.pinned]), shown: document.querySelector('#cpTitle').textContent, cut: !document.querySelector('#cpCut').hidden, folder: !document.querySelector('#cpFolder').hidden, share: document.querySelector('#cpShare span').textContent, thumb: l[0].thumbUrl } }))
    log('vignette', await p.evaluate(async () => { const l = await API.clipsList(); const r = await fetch(l[0].thumbUrl); return [r.status, r.headers.get('content-type'), (await r.blob()).size] }))
    await shot(p, 'a12-cut')
    const tops = () => p.evaluate(() => ['.cp-kick', '.cp-det', '#cpShare', '#cpSize', '#cpStar'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [q, +r.top.toFixed(1), +r.left.toFixed(1)] }))
    const t0 = await tops()
    await p.click('#cpTitle'); await p.waitForTimeout(150); const t1 = await tops(); await shot(p, 'a12-edit'); await p.keyboard.type('Mon clip'); await p.keyboard.press('Enter'); await p.waitForTimeout(600)
    log('renommer sans bouger', JSON.stringify(t0) === JSON.stringify(t1), JSON.stringify(t0) === JSON.stringify(t1) ? '' : [t0, t1])
    await p.click('#cpStar'); await p.waitForTimeout(500); await shot(p, 'a12-renamed')
    log(await p.evaluate(async () => (await API.clipsList()).filter((c) => c.pinned).map((c) => [c.title, c.pinned])))
    await p.click('#cpShare'); await p.waitForTimeout(1500); log('copie (Linux : refusée)', await p.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent)))
    // Une coupe en attente, puis Copier : la coupe d'abord, l'original intact
    await p.evaluate(() => { document.querySelector('#grB').focus() }); for (let i = 0; i < 2; i++) await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(400)
    log('attente', await p.evaluate(() => ({ share: document.querySelector('#cpShare span').textContent, cut: !document.querySelector('#cpCut').hidden })))
    await p.click('#cpShare'); await p.waitForTimeout(3500)
    log('apres copie', await p.evaluate(async () => (await API.clipsList()).slice(0, 3).map((c) => [c.title, c.durationS])))
    await p.click('#cpDel'); await p.waitForTimeout(300); await shot(p, 'a12-del'); await p.click('#cfOk'); await settle(p, 1500); await shot(p, 'a12-after')
    log('apres suppression', await p.evaluate(async () => (await API.clipsList()).length), await p.evaluate(() => document.activeElement?.className))
    await p.keyboard.press('Control+,'); await settle(p, 600); await p.evaluate(() => Settings.go('accounts')); await settle(p, 600)
    const near = () => p.evaluate(() => { const r = document.querySelector('#r-me .sr-t>span').getBoundingClientRect(); const c = document.querySelector('#meCell').getBoundingClientRect(); return [+r.top.toFixed(1), +r.left.toFixed(1), +c.height.toFixed(1)] })
    const n0 = await near(); await p.click('#meName'); await p.waitForTimeout(150); const n1 = await near(); await shot(p, 'a12-me-edit'); await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    log('pseudo sans bouger', JSON.stringify(n0) === JSON.stringify(n1), n0, n1, await p.evaluate(() => document.activeElement?.id))
    await p.evaluate(() => Settings.close()); await settle(p, 300)
    log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 2).join(' ')); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
