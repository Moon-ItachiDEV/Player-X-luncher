// États vides, pannes, période sans match, loadout supprimé, 1280 x 720 : ce que le scénario fourni ne couvre pas.
const boot = require('./stats-etats-pre.cjs')
const H = require('./h.cjs')
const LEAK = /undefined|NaN|null|Infinity|\[object/
const log = (...a) => console.log(...a)
boot(async ({ app, p, wait, snap, step, bad, fx }) => {
  const { go, settle } = H
  p.setDefaultTimeout(4000)
  const swap = (name, body, arg) => app.evaluate(({ ipcMain }, [ch, src, a]) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, new Function('_e', 'q', 'A', `return (${src})(q, A)`).bind(null)) ; globalThis.__A = globalThis.__A || {}; globalThis.__A[ch] = a }, [name, body.toString(), arg ?? null])
  // Plus simple : un handler qui renvoie une valeur JSON fixe
  const fixed = (ch, val) => app.evaluate(({ ipcMain }, [c, v]) => { ipcMain.removeHandler(c); ipcMain.handle(c, () => JSON.parse(v)) }, [ch, JSON.stringify(val)])
  const throws = (ch, msg) => app.evaluate(({ ipcMain }, [c, m]) => { ipcMain.removeHandler(c); ipcMain.handle(c, () => { throw new Error(m) }) }, [ch, msg])
  const text = (sel) => p.evaluate((s) => document.querySelector(s)?.innerText ?? '', sel)
  const check = async (what, sel = '#sc-stats') => { const t = await text(sel); const m = t.match(LEAK); if (m) bad(`${what} : mot interdit « ${m[0]} » (${t.slice(Math.max(0, t.search(LEAK) - 30), t.search(LEAK) + 30).replace(/\s+/g, ' ')})`); return t }
  const has = async (what, re, sel = '#sc-stats') => { const t = await check(what, sel); if (!re.test(t)) bad(`${what} : texte attendu ${re} absent`); return t }
  const rerender = async (g) => { await p.evaluate((g) => { S.statsGame = g; StatsPage.render() }, g); await settle(p, 1500) }
  const stateOf = () => p.evaluate(() => StatsPage.state())
  const panel = async (what) => { await wait(400); const i = await p.evaluate(() => { const v = [...document.querySelectorAll('.vl')].pop(); const h = v?.querySelector('.vl-h h2'); if (!h) return null; const r = h.getBoundingClientRect(), el = document.elementFromPoint(r.left + 2, r.top + r.height / 2); return { t: h.innerText.trim(), ok: !!el?.closest('.vl-h'), x: v.innerText } }); if (!i) return bad(`${what} : pas de volet`); if (!i.t) bad(`${what} : titre vide`); if (!i.ok) bad(`${what} : titre recouvert`); const m = i.x.match(LEAK); if (m) bad(`${what} : mot interdit « ${m[0]} »`); return i }
  await go(p, 'stats')

  /* 1. CS2 : aucun match enregistré */
  await step('cs2 zéro bilan', async () => {
    await fixed('cs2:state', { enabled: true, demo: false, config: 'ready', connected: false, live: null, recaps: [] })
    await rerender('cs2'); await has('cs2 zéro', /Aucun match pour l’instant/); await has('cs2 zéro armes', /tes armes/i)
    if (await p.locator('#sc-stats [data-period]').count()) bad('cs2 zéro : le sélecteur de période ne devrait pas apparaître sans données')
    await snap('st-cs2-zero')
    await fixed('cs2:state', { enabled: false, demo: false, config: 'ready', connected: false, live: null, recaps: [] })
    await rerender('cs2'); await has('cs2 coupé', /Le suivi de Counter-Strike 2 est coupé/)
    const b = p.locator('#sc-stats [data-act="settings"]'); if (!(await b.count())) bad('cs2 coupé : pas de bouton réglages')
    await snap('st-cs2-coupe')
  })
  /* 2. CS2 : Steam ne répond pas */
  await step('cs2 steam ko', async () => {
    await fixed('cs2:state', { enabled: true, demo: false, config: 'ready', connected: false, live: null, recaps: [...fx.cs2.recaps].sort((a, b) => b.endedAt - a.endedAt) })
    await fixed('cs2:lifetime', { ok: false, reason: 'no-key', message: 'La clé Steam manque.' })
    await rerender('cs2'); await has('cs2 steam ko', /Totaux de Counter-Strike 2 indisponibles/); await has('cs2 steam ko msg', /La clé Steam manque/)
    if (!(await p.locator('#sc-stats [data-act="fix"]').count())) bad('cs2 steam ko : pas d’action de réparation')
    await p.evaluate(() => StatsPage.open('weapons')); await panel('cs2 weapons ko')
    await snap('st-cs2-steam-ko')
    await p.evaluate(() => StatsPage.close()); await wait(300)
  })
  /* 3. CS2 : période sans match */
  await step('cs2 période vide', async () => {
    const old = fx.cs2.recaps.map((r) => ({ ...r, startedAt: r.startedAt - 90 * 864e5, endedAt: r.endedAt - 90 * 864e5 }))
    await fixed('cs2:state', { enabled: true, demo: false, config: 'ready', connected: false, live: null, recaps: old.sort((a, b) => b.endedAt - a.endedAt) })
    await fixed('cs2:lifetime', fx.cs2.lifetime)
    await rerender('cs2')
    for (const per of ['d7', 'd30', 'all']) {
      await p.evaluate((x) => StatsPage.setPeriod(x), per); await wait(500); await check('cs2 vieux ' + per)
      if (per !== 'all') await has('cs2 période vide ' + per, /Aucun match sur/)
      await snap('st-cs2-vide-' + per)
    }
    await p.evaluate(() => StatsPage.setPeriod('d7')); await wait(300)
    const t = await text('#sc-stats'); if (/undefined|NaN/.test(t)) bad('cs2 période vide : fuite')
    await p.evaluate(() => StatsPage.setPeriod('all'))
  })
  /* 4. CS2 : des bilans sans rounds */
  await step('cs2 sans rounds', async () => {
    const nr = fx.cs2.recaps.map((r) => { const c = { ...r, hasRounds: false, rounds: [], trackedKills: 0, roundsTracked: 0, damage: 0, multi: { k3: 0, k4: 0, k5: 0 } }; delete c.best; return c })
    await fixed('cs2:state', { enabled: true, demo: false, config: 'ready', connected: false, live: null, recaps: nr.sort((a, b) => b.endedAt - a.endedAt) })
    await rerender('cs2'); await check('cs2 sans rounds'); await snap('st-cs2-sans-rounds')
    for (const per of ['d30', 'd7', 'all']) { await p.evaluate((x) => StatsPage.setPeriod(x), per); await wait(400); await check('cs2 sans rounds ' + per) }
    const ids = await p.evaluate(() => [...new Set([...document.querySelectorAll('#sc-stats .ck [data-open]')].map((e) => e.dataset.open))])
    for (const t of ids.slice(0, 40)) { await p.evaluate((x) => StatsPage.open(x), t); await panel('cs2 sans rounds ' + t); await p.evaluate(() => StatsPage.close()); await wait(250) }
  })
  /* 5. BF6 : le service de stats tombe, puis revient */
  await step('bf6 panne', async () => {
    await fixed('cs2:state', { enabled: true, demo: false, config: 'ready', connected: false, live: null, recaps: [...fx.cs2.recaps].sort((a, b) => b.endedAt - a.endedAt) })
    await throws('bf6:stats', 'Le service est tombé.')
    await p.evaluate(() => { Real.st.tracked = { me: { name: 'Testeur', platform: 'ea', personaId: '1000001' }, rivals: [] } })
    await rerender('bf6'); await settle(p, 1500)
    await has('bf6 panne', /Stats indisponibles/); if (!(await p.locator('#sc-stats [data-act="retry"]').count())) bad('bf6 panne : pas de bouton réessayer')
    await snap('st-bf6-panne')
    await p.evaluate(() => StatsPage.open('arsenal')); await panel('bf6 panne arsenal'); await p.evaluate(() => StatsPage.close()); await wait(300)
    await p.evaluate(() => StatsPage.open('loadouts')); await panel('bf6 panne loadouts'); await p.evaluate(() => StatsPage.close()); await wait(300)
  })
  /* 6. BF6 pas relié */
  await step('bf6 pas relié', async () => {
    await fixed('bf6:tracked', { me: null, rivals: [] })
    await p.evaluate(() => { Real.st.tracked = { me: null, rivals: [] }; Board.reset() })
    await rerender('bf6'); await has('bf6 pas relié', /Relie ton profil Battlefield 6/)
    if (!(await p.locator('#sc-stats .sp-ux').count())) bad('bf6 pas relié : pas de .sp-ux')
    await wait(1500)
    const stale = await p.evaluate(() => ({ empty: document.querySelectorAll('#sc-stats .k-empty, #sc-stats .k-grid').length, ux: document.querySelectorAll('#sc-stats .sp-ux').length, text: /Stats indisponibles|service est tombé/.test(document.querySelector('#sc-stats').innerText) }))
    if (stale.empty || stale.text || stale.ux !== 1) bad(`bf6 pas relié : état résiduel ${JSON.stringify(stale)}`)
    await snap('st-bf6-pas-relie')
    await p.locator('#sc-stats [data-open="loadouts"]').first().click(); await panel('bf6 pas relié loadouts'); await snap('st-bf6-pas-relie-loadouts')
    await p.evaluate(() => StatsPage.open('board')); await wait(300)
    const st = await stateOf(); if (st.sheet.includes('board')) bad('bf6 pas relié : le classement s’ouvre sans profil')
    await p.evaluate(() => StatsPage.close()); await wait(300)
  })
  /* 7. 1280 x 720 : rien ne se chevauche, la page défile si besoin */
  await step('1280x720', async () => {
    await fixed('bf6:tracked', { me: { name: 'Testeur', platform: 'ea', personaId: '1000001' }, rivals: [] })
    await throws('bf6:stats', 'x'); await app.evaluate(({ ipcMain }, j) => { const F = JSON.parse(j); ipcMain.removeHandler('bf6:stats'); ipcMain.handle('bf6:stats', (_e, a) => ({ stats: { ...F.stats, account: a }, fetchedAt: Date.now() })) }, JSON.stringify(fx.bf6))
    await p.evaluate(() => { Real.st.tracked = { me: { name: 'Testeur', platform: 'ea', personaId: '1000001' }, rivals: [] }; Board.reset() })
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1280, 720) }); await wait(800)
    for (const g of ['cs2', 'bf6']) {
      await rerender(g); await wait(800)
      const r = await p.evaluate(() => {
        const ts = [...document.querySelectorAll('#sc-stats .ck .t')].map((e) => e.getBoundingClientRect()), out = []
        for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { const a = ts[i], b = ts[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push([i, j]) }
        // le contenu d'une tuile dépasse-t-il sa tuile ?
        const spill = [...document.querySelectorAll('#sc-stats .ck .t')].map((t, i) => { const tr = t.getBoundingClientRect(); return [...t.querySelectorAll('*')].some((c) => { const r = c.getBoundingClientRect(); return r.width && r.height && (r.bottom > tr.bottom + 2 || r.right > tr.right + 2) && getComputedStyle(c).position !== 'absolute' }) ? i : -1 }).filter((i) => i >= 0)
        const sc = document.querySelector('#sc-stats'); return { n: ts.length, over: out, spill, scroll: sc.scrollHeight - sc.clientHeight, w: innerWidth, h: innerHeight }
      })
      log('1280', g, JSON.stringify(r)); if (r.over.length) bad(`1280 ${g} : tuiles qui se chevauchent ${JSON.stringify(r.over)}`); if (r.spill.length) bad(`1280 ${g} : contenu qui dépasse de la tuile ${JSON.stringify(r.spill)}`)
      await snap(`st-1280-${g}`)
      await p.evaluate(() => { document.querySelector('#sc-stats').scrollTop = 9999 }); await wait(300); await snap(`st-1280-${g}-bas`)
      await p.evaluate(() => StatsPage.open(S.statsGame === 'cs2' ? 'matches' : 'board')); await panel('1280 volet ' + g); await snap(`st-1280-${g}-volet`); await p.evaluate(() => StatsPage.close()); await wait(300)
    }
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1600, 940) }); await wait(600)
  })
  /* 8. Un loadout supprimé par son bouton, avec la confirmation */
  await step('loadout supprimé', async () => {
    await rerender('bf6')
    const n0 = await p.evaluate(async () => (await API.getBf6Loadouts()).length)
    const target = await p.evaluate(() => { const b = BUILDS.find((x) => x.name === 'Build cockpit') || BUILDS.at(-1); return b ? { id: b.id, w: b.w, name: b.name } : null })
    if (!target) return bad('suppression : aucun loadout à supprimer')
    log('suppression de', JSON.stringify(target), 'sur', n0)
    await p.evaluate((w) => StatsPage.open('weapon:' + w), target.w); await wait(700)
    const box = p.locator(`.vl .lc-box[data-id="${target.id}"]`)
    if (!(await box.count())) return bad('suppression : la carte n’est pas dans le volet de l’arme')
    await snap('st-loadout-avant-suppression')
    await box.locator('[data-a=del]').click(); await wait(500)
    await snap('st-loadout-confirmation')
    await p.locator('dialog[open] #cfOk').click(); await wait(1500)
    const n1 = await p.evaluate(async () => (await API.getBf6Loadouts()).length)
    if (n1 !== n0 - 1) bad(`suppression : ${n0} avant, ${n1} après`)
    if (await p.locator(`.vl .lc-box[data-id="${target.id}"]`).count()) bad('suppression : la carte est encore à l’écran')
    await snap('st-loadout-apres-suppression')
    await p.evaluate(() => StatsPage.close()); await wait(300)
  })

  /* 9. Aucun bloc ne recouvre son voisin, dans chaque volet */
  const overlaps = () => p.evaluate(() => {
    const v = [...document.querySelectorAll('.vl')].pop(); if (!v) return ['pas de volet']
    const out = [], label = (e) => (e.className || e.tagName) + ':' + (e.innerText || '').trim().slice(0, 24).replace(/\s+/g, ' ')
    const walk = (el) => {
      const kids = [...el.children].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(k).position !== 'absolute' && (k.innerText || '').trim() })
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect(); const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 2 && h > 2) out.push(label(kids[i]) + ' x ' + label(kids[j])) }
      kids.forEach(walk)
    }
    walk(v.querySelector('.vl-s')); return out
  })
  await step('recouvrements dans les volets', async () => {
    await rerender('cs2'); await settle(p, 800)
    for (const g of ['cs2', 'bf6']) {
      await rerender(g); await wait(500)
      const tops = await p.evaluate(() => [...new Set([...document.querySelectorAll('#sc-stats .ck [data-open]')].map((e) => e.dataset.open))])
      let n = 0
      for (const t of tops) {
        await p.evaluate((x) => StatsPage.open(x), t); await wait(350)
        const o = await overlaps(); n++; if (o.length) bad(`recouvrement ${g} ${t} : ${o.slice(0, 3).join(' | ')}`)
        const kids = (await p.evaluate(() => { const v = [...document.querySelectorAll('.vl')].pop(); return v ? [...new Set([...v.querySelectorAll('[data-open]')].map((e) => e.dataset.open))] : [] })).filter((k) => k !== t && !k.startsWith('atelier')).slice(0, 6)
        for (const k of kids) { await p.evaluate((x) => StatsPage.open(x), k); await wait(300); const o2 = await overlaps(); n++; if (o2.length) bad(`recouvrement ${g} ${t} > ${k} : ${o2.slice(0, 3).join(' | ')}`); await p.evaluate(() => StatsPage.close()); await wait(200) }
        await p.evaluate(() => { while (StatsPage.state().sheet.length) StatsPage.close() }); await wait(250)
      }
      log('recouvrements', g, n, 'volets vérifiés')
    }
  })
  /* 10. La couleur du jeu suit jusque dans les volets */
  await step('couleur du jeu', async () => {
    for (const [g, tgt] of [['cs2', 'matches'], ['bf6', 'weapon:M433']]) {
      await rerender(g); await wait(600)
      await p.evaluate(() => GameStyle.paint(document.querySelector('.v-stats'), { style: 'tactique', accent: '#41d3c4', onAccent: '#04201d' }))
      await snap(`st-style-${g}-cockpit`)
      const first = await p.evaluate((g) => (g === 'cs2' ? document.querySelector('#sc-stats [data-open^="match:"]')?.dataset.open : 'weapon:M433'), g)
      await p.evaluate((x) => StatsPage.open(x), first); await wait(600)
      const r = await p.evaluate(() => {
        const ck = document.querySelector('#sc-stats .ck'), vl = [...document.querySelectorAll('.vl')].pop(), key = vl.querySelector('.k-b.is-key')
        const sp = ck.querySelector('.k-sp path'), bd = getComputedStyle(key)
        return { acc: getComputedStyle(ck).getPropertyValue('--ck-a').trim(), vacc: getComputedStyle(vl).getPropertyValue('--ck-a').trim(), keyBg: bd.backgroundColor, keyColor: bd.color, spark: sp ? getComputedStyle(sp).stroke : null }
      })
      log('couleur', g, JSON.stringify(r))
      if (r.acc !== '#41d3c4' || r.vacc !== '#41d3c4') bad(`couleur ${g} : --ck-a page ${r.acc} / volet ${r.vacc}`)
      if (r.keyColor !== 'rgb(4, 32, 29)') bad(`couleur ${g} : texte du bouton tactique ${r.keyColor}`)
      await snap(`st-style-${g}-volet`)
      await p.evaluate(() => { while (StatsPage.state().sheet.length) StatsPage.close() }); await wait(300)
    }
  })
  /* ---- Deuxième lot : entrées d'ailleurs, course au relien, comptes, Échap et menu, noms longs, piège du focus ---- */
  const ME = { name: 'Testeur', platform: 'ea', personaId: '1000001' }
  const stats2 = (delay) => app.evaluate(({ ipcMain }, [j, d]) => { const F = JSON.parse(j); ipcMain.removeHandler('bf6:stats'); ipcMain.handle('bf6:stats', async (_e, a) => { if (d && a.name === d.name) await new Promise((r) => setTimeout(r, d.ms)); return { stats: { ...F, account: a, kills: a.name === 'Testeur' ? F.kills : 4321 }, fetchedAt: Date.now() } }) }, [JSON.stringify(fx.bf6.stats), delay || null])
  const recaps2 = (mode) => app.evaluate(({ ipcMain }, [j, m]) => { const R = JSON.parse(j).sort((a, b) => b.endedAt - a.endedAt); ipcMain.removeHandler('bf6:recaps'); ipcMain.handle('bf6:recaps', () => ({ enabled: true, pending: null, recaps: R.map((r, i) => (m === 'all' || (m === 'half' && i % 2) ? { ...r, account: { name: 'Autre joueur', platform: 'ea' } } : m === 'long' && i === 0 ? { ...r, weapon: { ...(r.weapon || {}), name: 'W'.repeat(40) } } : r)) })) }, [JSON.stringify(fx.bf6.recaps), mode || 'none'])
  const base2 = async () => { await stats2(); await recaps2('none'); await fixed('bf6:tracked', { me: ME, rivals: [] }); await p.evaluate((m) => { Real.st.tracked = { me: m, rivals: [] }; Board.reset() }, ME); await rerender('bf6'); await wait(1200) }
  const sheet = async () => (await stateOf()).sheet
  const wide = () => p.evaluate(() => { const v = [...document.querySelectorAll('.vl')].pop(); if (!v) return ['pas de volet']; const R = v.getBoundingClientRect(), out = []; for (const e of v.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (r.width && r.height && r.right > R.right + 1) out.push((e.className?.baseVal ?? e.className ?? e.tagName) + ':' + Math.round(r.right - R.right)) } const s = v.querySelector('.vl-s'); if (s.scrollWidth > s.clientWidth + 1) out.push('défilement horizontal'); return out.slice(0, 5) })
  const spill2 = () => p.evaluate(() => [...document.querySelectorAll('#sc-stats .ck .t')].map((t, i) => { const tr = t.getBoundingClientRect(); return [...t.querySelectorAll('*')].some((c) => { const r = c.getBoundingClientRect(); return r.width && r.height && (r.right > tr.right + 1 || r.left < tr.left - 1) }) ? i : -1 }).filter((i) => i >= 0))

  /* 11. Entrée d'ailleurs avec un volet resté ouvert (point 2) */
  await step('entrée avec volet resté', async () => {
    await base2()
    await p.evaluate(() => StatsPage.open('arsenal')); await panel('arsenal')
    if (!(await sheet()).includes('arsenal')) bad('point 2 : arsenal ne s’ouvre pas')
    await p.evaluate(() => go('lib')); await wait(1500)
    await p.evaluate(() => { S.statsGame = 'bf6'; S.statsTab = 'loadouts'; S.loWeapon = null; go('stats') }); await settle(p, 1500); await wait(800)
    const a = await sheet(); log('entrée loadouts', JSON.stringify(a)); if (a.join() !== 'loadouts') bad(`point 2 : entrée Loadouts avec un volet resté : ${JSON.stringify(a)}`)
    await p.evaluate(() => StatsPage.open('arsenal')); await wait(500)
    await p.evaluate(() => go('lib')); await wait(1500)
    await p.evaluate(() => { S.statsGame = 'bf6'; S.statsTab = 'overview'; go('stats') }); await settle(p, 1500); await wait(800)
    const b = await sheet(); if (b.length) bad(`point 2 : retour sur Stats avec un ancien volet : ${JSON.stringify(b)}`)
    // la palette « Stats de Battlefield 6 » depuis un volet ouvert
    await p.evaluate(() => StatsPage.open('arsenal')); await wait(500)
    await p.keyboard.press('Control+k'); await wait(600); await p.keyboard.type('Stats de Battlefield'); await wait(500); await p.keyboard.press('Enter'); await wait(1500)
    // settings.js n'est pas touché par ce patch (d'autres fils le modifient) : la palette garde le volet ouvert du même jeu, on le note sans le compter
    const c = await sheet(); log('palette avec un volet ouvert', JSON.stringify(c)); await p.evaluate(() => StatsPage.close()); await wait(400)
    await snap('st-b2-entree-palette')
  })
  /* 12. Relien pendant une lecture lente (point 5) */
  await step('relien en course', async () => {
    await base2()
    await stats2({ name: 'Testeur', ms: 2500 })
    const B = { name: 'Rival Test', platform: 'ea', personaId: '2000002' }
    await p.evaluate(() => { S.statsGame = 'bf6'; StatsPage.render() }); await wait(400)
    await p.evaluate((b) => { Real.st.tracked = { me: b, rivals: [] }; Board.reset(); StatsPage.render() }, B)
    await wait(4500)
    const src = await text('#ckHR .k-src'); log('relien', src)
    if (!/Rival Test/.test(src) || /Testeur/.test(src)) bad(`point 5 : la lecture lente de l’ancien compte a écrasé le nouveau : « ${src} »`)
    await snap('st-b2-relien')
  })
  /* 13. Bilans d'un autre compte (point 6) */
  await step('bilans d’un autre compte', async () => {
    await base2()
    const rows = async () => { await p.evaluate(() => StatsPage.open('sessions')); await wait(600); const n = await p.locator('.vl .k-vl .k-vr').count(); await p.evaluate(() => StatsPage.close()); await wait(300); return n }
    const n0 = await rows()
    await recaps2('half'); await rerender('bf6'); await wait(1200); const n1 = await rows()
    await recaps2('all'); await rerender('bf6'); await wait(1200)
    const t = await has('autre compte : tuile', /Aucune session pour l’instant/)
    log('sessions : mes bilans', n0, ', la moitié', n1, ', aucun', /Aucune session/.test(t))
    if (!(n1 < n0)) bad(`point 6 : les bilans d’un autre compte comptent encore (${n0} -> ${n1})`)
    await snap('st-b2-autre-compte')
    await recaps2('none')
  })
  /* 14. Échap avec le menu Partager ouvert (point 7), retour du focus sur un ouvreur redessiné (point 8) */
  await step('Échap et menu', async () => {
    await base2()
    const w = await p.evaluate(() => BUILDS[0].w)
    await p.evaluate((x) => StatsPage.open('weapon:' + x), w); await wait(800)
    await p.locator('.vl [data-a=share]').first().click(); await wait(500)
    if (!(await p.evaluate(() => !!document.querySelector('#pxMenu:popover-open')))) bad('Échap : le menu Partager ne s’ouvre pas')
    await p.keyboard.press('Escape'); await wait(500)
    const a = await sheet(), open = await p.evaluate(() => !!document.querySelector('#pxMenu:popover-open'))
    log('échap menu', JSON.stringify(a), 'menu ouvert', open)
    if (!a.length) bad('point 7 : Échap ferme le volet alors que le menu Partager était ouvert')
    if (open) bad('point 7 : Échap n’a pas fermé le menu')
    await p.keyboard.press('Escape'); await wait(500)
    if ((await sheet()).length) bad('point 7 : le second Échap ne ferme pas le volet')
    // l'ouvreur redessiné
    await p.locator('#sc-stats [data-open="arsenal"].k-more').focus(); await p.keyboard.press('Enter'); await wait(700)
    if (!(await sheet()).includes('arsenal')) bad('point 8 : le bouton Toutes les armes n’ouvre pas l’arsenal')
    await p.evaluate(() => { const b = document.querySelector('#ckBody'); b.innerHTML = b.innerHTML }); await wait(200)
    await p.keyboard.press('Escape'); await wait(600)
    const f = await p.evaluate(() => ({ ok: document.activeElement?.matches?.('[data-open="arsenal"]') && document.activeElement.isConnected, el: document.activeElement?.outerHTML?.slice(0, 80) }))
    log('focus rendu', JSON.stringify(f)); if (!f.ok) bad(`point 8 : le focus ne revient pas sur l’ouvreur redessiné (${f.el})`)
  })
  /* 15. Rien d'autre ne prend le focus tant qu'un volet est ouvert (point 14) */
  await step('piège du focus', async () => {
    await base2()
    const nInert = () => p.evaluate(() => ({ marked: document.querySelectorAll('[data-ck-inert]').length, inert: document.querySelectorAll('[inert]').length, sc: document.querySelector('#sc-stats').inert, nav: !![...document.querySelectorAll('#win > *')].find((e) => e.inert) }))
    await p.evaluate(() => StatsPage.open('arsenal')); await wait(700)
    const o = await nInert(); log('piège ouvert', JSON.stringify(o)); if (!o.marked) bad('point 14 : rien n’est inerte hors du volet')
    const out = new Set()
    for (let i = 0; i < 40; i++) { await p.keyboard.press(i % 2 ? 'Tab' : 'Shift+Tab'); const r = await p.evaluate(() => { const a = document.activeElement; return a && a !== document.body && !a.closest('.vl, .t-ctrl, #toasts') ? (a.id || a.className || a.tagName) : '' }); if (r) out.add(String(r).slice(0, 40)) }
    for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); const r = await p.evaluate(() => { const a = document.activeElement; return a && a !== document.body && !a.closest('.vl, .t-ctrl, #toasts') ? (a.id || a.className || a.tagName) : '' }); if (r) out.add(String(r).slice(0, 40)) }
    if (out.size) bad(`point 14 : le focus sort du volet : ${[...out].join(', ')}`)
    const closers = [['Échap', () => p.keyboard.press('Escape')], ['croix', () => p.locator('.vl .vl-x').click()], ['fond', () => p.evaluate(() => document.querySelector('.vl-scrim').click())], ['page', () => p.evaluate(() => go('lib'))]]
    for (const [n, f] of closers) {
      await p.evaluate(() => { if (S.view !== 'stats') { S.statsGame = 'bf6'; S.statsTab = 'overview'; go('stats') } }); await settle(p, 1500); await wait(600)
      await p.evaluate(() => StatsPage.open('arsenal')); await wait(700)
      if (!(await nInert()).marked) bad(`point 14 (${n}) : rien d’inerte à l’ouverture`)
      await f(); await wait(1500)
      const z = await nInert(); log('piège après', n, JSON.stringify(z)); if (z.marked || z.sc || z.nav) bad(`point 14 : après ${n}, des éléments restent inertes ${JSON.stringify(z)}`)
    }
    await p.evaluate(() => { if (S.view !== 'stats') { S.statsGame = 'bf6'; go('stats') } }); await settle(p, 1500)
  })
  /* 16. Les noms longs : un pseudo de 64 signes, une arme et un loadout de 40 (point 13) */
  await step('noms longs', async () => {
    const LONG = 'J' + 'o'.repeat(63), W40 = 'Arme' + 'X'.repeat(36), N40 = 'Build' + 'Y'.repeat(35)
    await stats2(); await recaps2('long')
    const R = { name: LONG, platform: 'ea', personaId: '3000003' }
    await p.evaluate(([m, r]) => { Real.st.tracked = { me: m, rivals: [r] }; Board.reset() }, [ME, R])
    await p.evaluate(([w, n]) => { BUILDS.push({ ...BUILDS[0], id: 'long-test', w, name: n }) }, [W40, N40])
    await rerender('bf6'); await wait(2500)
    const sp = await spill2(); if (sp.length) bad(`noms longs : contenu qui dépasse de la tuile ${JSON.stringify(sp)}`)
    await snap('st-b2-longs-cockpit')
    const key = await p.evaluate(() => Board.rows().list.find((x) => !x.me)?.key)
    for (const t of ['board', `rival:${key}`, `weapon:${W40}`, 'sessions']) {
      await p.evaluate((x) => StatsPage.open(x), t); await wait(800)
      const o = await overlaps(), w = await wide(); log('longs', t, JSON.stringify([o.length, w]))
      if (o.length) bad(`noms longs ${t} : recouvrement ${o.slice(0, 2).join(' | ')}`)
      if (w.length) bad(`noms longs ${t} : déborde à droite ${w.join(' | ')}`)
      await snap('st-b2-longs-' + t.split(':')[0])
      await p.evaluate(() => { while (StatsPage.state().sheet.length) StatsPage.close() }); await wait(300)
    }
    await p.evaluate(() => { const i = BUILDS.findIndex((b) => b.id === 'long-test'); if (i >= 0) BUILDS.splice(i, 1) })
    await recaps2('none'); await p.evaluate((m) => { Real.st.tracked = { me: m, rivals: [] }; Board.reset(); S.statsGame = 'bf6'; StatsPage.render() }, ME); await wait(1500)
  })
})
