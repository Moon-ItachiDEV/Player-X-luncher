// Le Cockpit des stats, dans la vraie fenêtre Electron : les services de stats sont imités au niveau de l'IPC
// avec jeu-stats/cockpit.json (dates relatives à maintenant), le reste est le vrai code.
// Sortie : une ligne par défaut, puis « défauts N erreurs M captures K ». Code de sortie 1 s'il y a un défaut ou une erreur.
const fs = require('fs')
const path = require('path')
const { start, shot, settle, go } = require('./h.cjs')

const GAMES = ['cs2', 'bf6'], PERIODS = ['all', 'd30', 'd7']
const LEAK = /undefined|NaN|null|Infinity|\[object/
const DEPTH2_MAX = +process.env.CK_DEPTH2_MAX || 8 // panneaux de profondeur 2 ouverts par panneau (limite de durée)
const T = 4000 // délai court : un sélecteur absent est un défaut, pas une attente de 30 s

/* ---- Les données : décalages en ms depuis « maintenant », ramenés à l'heure de l'exécution ---- */
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'jeu-stats/cockpit.json'), 'utf8'))
function fixture(now) {
  const at = (o) => ({ ...o, at: now + o.at }), span = (r) => ({ ...r, startedAt: now + r.startedAt, endedAt: now + r.endedAt })
  return {
    cs2: { recaps: FX.cs2.recaps.map(span), lifetime: { ok: true, stats: FX.cs2.lifetime.stats, fetchedAt: now - 5 * 6e4, history: FX.cs2.lifetime.history.map(at) } },
    bf6: { stats: FX.bf6.stats, history: FX.bf6.history.map(at), recaps: FX.bf6.recaps.map(span), rivals: FX.bf6.rivals },
    now
  }
}

;module.exports = async function boot(body) {
  const defects = []
  let captures = 0
  const bad = (m) => { defects.push(m); console.log('DEFAUT ' + m) }
  const { app, p, errs } = await start({ name: 'stats-cockpit' })
  p.setDefaultTimeout(T)
  const snap = async (n) => { try { await shot(p, n); captures++ } catch (e) { bad(`capture ${n} : ${msg(e)}`) } }
  const msg = (e) => String(e?.message || e).split('\n')[0].slice(0, 200)
  // Une étape qui échoue est un défaut lisible, jamais un plantage
  const step = async (name, fn) => { try { await fn() } catch (e) { bad(`${name} : ${msg(e)}`) } }
  const wait = (ms) => p.waitForTimeout(ms)

  try {
    const fx = fixture(Date.now())
    await app.evaluate(({ ipcMain }, json) => {
      const F = JSON.parse(json)
      const swap = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn) }
      const keyOf = (a) => `${a.platform}:${a.personaId ?? a.name.toLowerCase()}`
      const NOT_FOUND = 'Aucune statistique Battlefield 6 pour ce joueur (pseudo introuvable ou profil privé).'
      const ME = { name: 'Testeur', platform: 'ea', personaId: '1000001' }
      let tracked = { me: ME, rivals: F.bf6.rivals.slice(0, 2).map(({ name, platform, personaId }) => ({ name, platform, personaId })) }
      const rival = (a) => F.bf6.rivals.find((r) => r.name === a.name)
      swap('cs2:state', () => ({ enabled: true, demo: false, config: 'ready', connected: false, live: null, recaps: [...F.cs2.recaps].sort((a, b) => b.endedAt - a.endedAt) }))
      swap('cs2:lifetime', () => F.cs2.lifetime)
      swap('cs2:recap-seen', () => undefined)
      swap('bf6:tracked', () => tracked)
      swap('bf6:set-tracked', (_e, t) => { tracked = { me: t.me, rivals: t.rivals }; return tracked })
      swap('bf6:stats', (_e, a) => {
        const r = rival(a)
        if (a.name === ME.name) return { stats: { ...F.bf6.stats, account: a }, fetchedAt: F.now }
        if (!r) throw new Error(NOT_FOUND)
        const s = JSON.parse(JSON.stringify(F.bf6.stats)), k = r.kills / F.bf6.stats.kills
        Object.assign(s, { account: a, kills: r.kills, killDeath: r.kd, deaths: Math.round(r.kills / r.kd), killsPerMinute: r.kpm, winPercent: r.winPct, secondsPlayed: Math.round(r.kills / r.kpm * 60), matches: Math.round(F.bf6.stats.matches * k) })
        return { stats: s, fetchedAt: F.now }
      })
      swap('bf6:history', (_e, a) => { const r = rival(a); if (!r) return F.bf6.history; const k = r.kills / F.bf6.stats.kills; return F.bf6.history.map((h) => ({ ...h, kills: Math.round(h.kills * k), deaths: Math.round(h.kills * k / r.kd) })) })
      swap('bf6:recaps', () => ({ enabled: true, pending: null, recaps: [...F.bf6.recaps].sort((a, b) => b.endedAt - a.endedAt) }))
      swap('bf6:recap-seen', () => undefined)
      swap('bf6:search', (_e, q) => F.bf6.rivals.filter((r) => r.name.toLowerCase() === String(q).toLowerCase()).map((r) => ({ name: r.name, platform: r.platform, personaId: r.personaId, kills: r.kills })))
      swap('bf6:art', () => ({}))
      swap('bf6:playerx', () => null)
    }, JSON.stringify(fx))
    // Les stockages du rendu repartent à zéro : la fenêtre relit tout par les services imités
    await p.reload(); await p.waitForLoadState('domcontentloaded'); await wait(9000)

    const seen = await p.evaluate(async () => { const s = await API.cs2State(), t = await API.bf6GetTracked(), l = await API.cs2Lifetime(), b = await API.bf6Recaps(); return { cs2: s.recaps.length, last: s.recaps[0]?.endedAt, life: l.ok, bf6: b.recaps.length, me: t.me?.name, rivals: t.rivals.length } })
    console.log('services imités ' + JSON.stringify(seen))
    if (seen.cs2 !== fx.cs2.recaps.length || seen.me !== 'Testeur') bad(`les services imités ne répondent pas avec la fixture (${JSON.stringify(seen)})`)
    await go(p, 'stats')
    // CK_PROBE=1 : montre seulement que la page actuelle reçoit la fixture (pour l'ancienne page, avant la fusion)
    if (process.env.CK_PROBE) {
      for (const g of GAMES) { await p.locator(`.sp-g[data-g=${g}]`).first().click({ timeout: T }); await settle(p, 1200); await snap(`probe-${g}`); console.log(g, (await p.evaluate(() => document.querySelector('#sc-stats').innerText)).replace(/\s+/g, ' ').slice(0, 500)) }
      for (const [g, t] of [['cs2', 'matches'], ['cs2', 'weapons'], ['bf6', 'arsenal'], ['bf6', 'board']]) { await p.evaluate(([g, t]) => { S.statsGame = g; S.statsTab = t; StatsPage.render() }, [g, t]); await settle(p, 1200); await snap(`probe-${g}-${t}`); console.log(g, t, (await p.evaluate(() => document.querySelector('#sc-stats').innerText)).replace(/\s+/g, ' ').slice(0, 400)) }
      await app.close().catch(() => {}); process.exit(0)
    }

    await body({ app, p, errs, wait, snap, step, bad, defects, fx })
  } catch (e) { bad(`scénario interrompu : ${msg(e)}`) }
  errs.forEach((e) => console.log('ERREUR ' + e))
  console.log(`défauts ${defects.length} erreurs ${errs.length}`)
  await app.close().catch(() => {})
  process.exit(defects.length || errs.length ? 1 : 0)
}
