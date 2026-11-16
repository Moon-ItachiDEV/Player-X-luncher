const { start, shot, settle, go } = require('./h.cjs')
// Le service de stats n'est pas joignable d'ici : ses réponses sont imitées au niveau de l'IPC, le reste est le vrai code
const row = (name, kills, extra = {}) => ({ id: name, name, kills, deaths: Math.round(kills / 1.6), killDeath: 1.6, kpm: .9, accuracy: 24.5, matches: Math.round(kills / 12), winPercent: 52, secondsPlayed: kills * 40, ...extra })
const stats = (name, platform, kd, kills) => ({ account: { name, platform }, kills, deaths: Math.round(kills / kd), killDeath: kd, killsPerMinute: .85 + kd / 10, wins: 120, losses: 100, winPercent: 54.5, accuracy: 21, headshots: 900, assists: 400, revives: 210, matches: 220, secondsPlayed: 500000, weapons: [row('M433', 1204), row('CZ3A1', 880), row('AK-205', 640), row('All', 9999)], vehicles: [], classes: [row('Assault', 2000), row('Engineer', 900), row('Support', 500), row('Recon', 100)], modes: [row('Conquest', 2000), row('Breakthrough', 800)], maps: [row('Empire State', 1500), row('Mirak Valley', 700), row('All', 4000)] })
;(async () => {
  const { app, p, errs } = await start({ name: 'a7', env: {} })
  try {
    await app.evaluate(({ ipcMain }, s) => {
      const S = JSON.parse(s)
      const swap = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn) }
      let tracked = { me: null, rivals: [] }
      swap('bf6:search', (_e, q) => (q === 'Inconnu' ? [] : [{ name: q, platform: 'ea', personaId: 'p' + q, kills: 4210 }, { name: q, platform: 'psn', kills: null }]))
      swap('bf6:stats', (_e, a) => { if (a.name === 'Fantome') throw new Error('Aucune statistique Battlefield 6 pour ce joueur (pseudo introuvable ou profil privé).'); const h = [...a.name].reduce((x, c) => x + c.charCodeAt(0), 0); const st = JSON.parse(JSON.stringify(S.base)); st.account = a; st.killDeath = 1 + (h % 200) / 100; st.kills = 2000 + h * 3; st.killsPerMinute = .5 + (h % 90) / 100; st.winPercent = 40 + h % 30; st.revives = h % 400; st.matches = 100 + h % 300; st.secondsPlayed = 300000 + h * 900; return { stats: st, fetchedAt: Date.now() } })
      swap('bf6:tracked-get', () => tracked); swap('bf6:tracked-set', (_e, t) => { tracked = t; return t })
      swap('bf6:history', () => Array.from({ length: 12 }, (_, i) => ({ at: Date.now() - (12 - i) * 864e5, kills: 2000 + i * 40, deaths: 1300 + i * 20, wins: 100 + i, losses: 90 + i, matches: 190 + i * 2, secondsPlayed: 300000 + i * 3000, killsPerMinute: .8, accuracy: 20 })))
      swap('bf6:recaps', () => ({ enabled: true, pending: null, recaps: [{ id: 'r1', account: { name: 'Breezy', platform: 'ea' }, startedAt: Date.now() - 9e6, endedAt: Date.now() - 3e6, kills: 62, deaths: 28, assists: 14, revives: 9, matches: 4, wins: 3, losses: 1, secondsPlayed: 4800, killDeath: 2.21, killsPerMinute: .78, vehicleKills: 4, average: { killDeath: 1.32, killsPerMinute: .61, winPercent: 51 }, weapon: { name: 'M433', kills: 31 }, role: { name: 'Assaut', kills: 40, seconds: 3000 }, maps: [{ name: 'Empire State', matches: 2, wins: 2 }, { name: 'Mirak Valley', matches: 2, wins: 1 }], modes: [{ name: 'Conquête', matches: 4, wins: 3 }] }] }))
    }, JSON.stringify({ base: stats('x', 'ea', 1.5, 3000) }))
    const names = await app.evaluate(({ ipcMain }) => [...ipcMain._invokeHandlers?.keys?.() || []].filter((k) => /bf6/.test(k)))
    console.log(names.join(' '))
    await p.reload(); await p.waitForTimeout(9000)
    await go(p, 'stats')
    await p.fill('.sf-search input', 'Inconnu'); await p.click('.ps-go'); await p.waitForTimeout(500); await shot(p, 'a7-none')
    await p.fill('.sf-search input', 'Breezy'); await p.click('.ps-go'); await p.waitForTimeout(500); await shot(p, 'a7-res')
    await p.click('[data-pick="0"]'); await p.waitForTimeout(2600); await shot(p, 'a7-over')
    for (const t of ['arsenal', 'maps']) { await p.click(`.sp-tabs [data-t=${t}]`); await p.waitForTimeout(1200); await shot(p, 'a7-' + t) }
    await p.click('.sp-tabs [data-t=board]'); await p.waitForTimeout(1200); await shot(p, 'a7-solo')
    await p.click('#rkAddBtn'); await p.waitForTimeout(300)
    for (const n of ['Draxx', 'Fantome', 'NeoKai']) {
      if (!(await p.evaluate(() => { const x = document.querySelector('#rkAdd'); return x && !x.hidden }))) await p.click('#rkAddBtn')
      await p.fill('#rkQ', n); await p.click('#rkGo'); await p.waitForTimeout(400); await p.click('#rkRes [data-pick="0"]'); await p.waitForTimeout(1400)
    }
    await shot(p, 'a7-board')
    await p.click('th[data-m=rev] .rk-s'); await p.waitForTimeout(900); await shot(p, 'a7-board2')
    console.log(await p.evaluate(() => ({ badge: Board.badge(), rank: Board.rankLine(), tracked: Real.st.tracked })))
    await p.click('#rkRefresh'); await p.waitForTimeout(1600)
    await p.click('.sp-tabs [data-t=overview]'); await p.waitForTimeout(1500); await shot(p, 'a7-over2')
    await p.click('#spLast .mt'); await p.waitForTimeout(1800); await shot(p, 'a7-recap1'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1200); await shot(p, 'a7-recap2'); await p.keyboard.press('Escape'); await p.waitForTimeout(600)
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n').slice(0, 3).join(' ')); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
