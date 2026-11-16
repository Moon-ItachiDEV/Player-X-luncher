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

;(async () => {
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

    /* ---- Le contrat de la page ---- */
    const api = await p.evaluate(() => ({ open: typeof StatsPage.open, close: typeof StatsPage.close, state: typeof StatsPage.state, setPeriod: typeof StatsPage.setPeriod }))
    const contract = Object.values(api).every((t) => t === 'function')
    if (!contract) bad(`contrat StatsPage absent : ${JSON.stringify(api)}`)
    const state = () => p.evaluate(() => (typeof StatsPage.state === 'function' ? StatsPage.state() : null))
    const ready = async (what) => { try { await p.waitForFunction(() => typeof StatsPage !== 'undefined' && StatsPage.state?.().ready === true, null, { timeout: 6000 }) } catch { bad(`${what} : StatsPage.state().ready ne passe jamais à true`) } }
    const noLeak = async (sel, what) => {
      const t = await p.evaluate((s) => document.querySelector(s)?.innerText ?? null, sel)
      if (t === null) return bad(`${what} : ${sel} introuvable`)
      const m = t.match(LEAK); if (m) bad(`${what} : mot interdit « ${m[0]} » dans ${sel} (…${t.slice(Math.max(0, t.search(LEAK) - 30), t.search(LEAK) + 30).replace(/\s+/g, ' ')}…)`)
    }
    const sane = (s) => s.replace(/[^\w.-]+/g, '_')
    const closeAll = async () => {
      for (let i = 0; i < 6; i++) { const st = await state(); if (!st || !st.sheet?.length) break; await p.evaluate(() => StatsPage.close()).catch(() => {}); await wait(350) }
      const st = await state(); if (st && st.sheet?.length) bad(`StatsPage.close() n'a pas fermé les panneaux (${JSON.stringify(st.sheet)})`)
    }
    // Le panneau du dessus existe, son titre n'est recouvert par rien
    // Une transition de vue en cours (le fondu de l'atelier) capte les clics et les tests de recouvrement : on attend sa fin, plus lente sous le rendu logiciel de xvfb
    const vtIdle = () => p.waitForFunction(() => !document.getAnimations().some((a) => String(a.effect?.pseudoElement || '').startsWith('::view-transition')), null, { timeout: 8000 }).catch(() => {})
    const panelOk = async (what) => {
      await vtIdle()
      const info = await p.evaluate(() => {
        const vl = [...document.querySelectorAll('.vl')].pop(); if (!vl) return { none: true }
        const h = vl.querySelector('.vl-h h2'); if (!h) return { title: false }
        const r = h.getBoundingClientRect(), el = document.elementFromPoint(r.left + 2, r.top + r.height / 2)
        return { title: h.innerText.trim(), covered: !(el && el.closest('.vl-h')), by: el ? (el.className || el.tagName) : null, text: vl.innerText }
      })
      if (info.none) return bad(`${what} : aucun .vl après l'ouverture`)
      if (info.title === false) return bad(`${what} : pas de titre .vl-h h2`)
      if (!info.title) bad(`${what} : titre vide`)
      if (info.covered) bad(`${what} : le titre est recouvert (par ${info.by})`)
      const m = info.text.match(LEAK); if (m) bad(`${what} : mot interdit « ${m[0]} » dans le panneau`)
    }
    const targetsIn = (root) => p.evaluate((sel) => [...new Set([...document.querySelectorAll(sel)].map((e) => e.dataset.open).filter(Boolean))], root)
    // Les liens [data-open] du panneau du dessus (le dernier .vl du document)
    const topKids = () => p.evaluate(() => { const vl = [...document.querySelectorAll('.vl')].pop(); return vl ? [...new Set([...vl.querySelectorAll('[data-open]')].map((e) => e.dataset.open))] : [] })
    const top = () => p.locator('.vl').last()
    const clickOpen = async (t, scope = '#sc-stats .ck') => {
      const loc = p.locator(`${scope} [data-open="${t}"]`).first()
      if (!(await loc.count())) throw new Error(`aucun élément [data-open="${t}"] dans ${scope}`)
      await loc.click({ timeout: T })
      await wait(500)
    }

    /* ---- Chaque jeu, chaque période ---- */
    for (const g of GAMES) {
      await step(`jeu ${g}`, async () => {
        await p.locator(`.sp-g[data-g=${g}]`).first().click({ timeout: T }); await settle(p, 900)
      })
      const root = await p.evaluate((g) => !!document.querySelector(`#sc-stats .ck[data-g="${g}"]`), g)
      if (!root) bad(`${g} : pas de .ck[data-g="${g}"] dans #sc-stats`)
      for (const per of PERIODS) {
        await step(`${g}/${per}`, async () => {
          const btn = p.locator(`#sc-stats [data-period="${per}"]`).first()
          if (!(await btn.count())) return bad(`${g}/${per} : pas de bouton [data-period="${per}"]`)
          await btn.click({ timeout: T }); await settle(p, 500)
          if (contract) await ready(`${g}/${per}`)
          await snap(`stats-${g}-${per}`)
          await noLeak('#sc-stats', `${g}/${per}`)
          if (contract) { const st = await state(); if (st && st.period !== per) bad(`${g}/${per} : state().period = ${st.period}`); if (st && st.g !== g) bad(`${g}/${per} : state().g = ${st.g}`) }
        })
      }
      // Retour à « tout » : les panneaux s'ouvrent sur la période par défaut
      await step(`${g} période all`, async () => { const b = p.locator('#sc-stats [data-period="all"]').first(); if (await b.count()) { await b.click({ timeout: T }); await settle(p, 400) } })

      /* ---- Les panneaux, un par un (clic réel), puis leurs propres liens (profondeur 2) ---- */
      const tops = await targetsIn('#sc-stats .ck [data-open]').catch(() => [])
      if (!tops.length) bad(`${g} : aucun [data-open] dans le Cockpit`)
      console.log(`${g} : ${tops.length} cibles ${tops.join(' ')}`)
      for (const t of tops.slice(0, 40)) {
        await step(`${g} panneau ${t}`, async () => {
          await closeAll()
          await clickOpen(t)
          await panelOk(`${g} ${t}`)
          if (contract) { const st = await state(); if (st && !st.sheet?.includes(t)) bad(`${g} ${t} : state().sheet = ${JSON.stringify(st.sheet)} ne contient pas la cible`) }
          await snap(`stats-${g}-v-${sane(t)}`)
          if (!contract) return
          const kids = (await topKids()).filter((k) => k !== t).slice(0, DEPTH2_MAX)
          for (const k of kids) {
            await step(`${g} ${t} > ${k}`, async () => {
              await p.evaluate((x) => StatsPage.open(x), k); await wait(500)
              await panelOk(`${g} ${t} > ${k}`)
              await snap(`stats-${g}-v-${sane(t)}--${sane(k)}`)
              const st = await state(); if (st && !st.sheet?.includes(k)) bad(`${g} ${t} > ${k} : state().sheet = ${JSON.stringify(st.sheet)}`)
              await p.evaluate(() => StatsPage.close()); await wait(350)
            })
          }
        })
      }
      await closeAll()
    }

    /* ---- Parcours par clics réels ---- */
    await step('retour sur bf6', async () => { await p.locator('.sp-g[data-g=bf6]').first().click({ timeout: T }); await settle(p, 800); await p.locator('#sc-stats [data-period="all"]').first().click({ timeout: 1500 }).catch(() => {}) })
    const keysN = () => p.evaluate(() => Board.keys().length)
    await step('suivre un joueur', async () => {
      await closeAll()
      const before = await keysN()
      await clickOpen('board'); await panelOk('board')
      await snap('stats-bf6-flow-board')
      // « Suivre » : un lien vers le panneau « follow » (data-open) ou un bouton d'action
      const opener = p.locator('.vl [data-open="follow"], .vl [data-act="follow"]').first()
      if (!(await opener.count())) throw new Error('pas de bouton « suivre » ([data-open="follow"] ou [data-act="follow"]) dans le panneau du classement')
      await opener.click({ timeout: T }); await wait(500)
      const input = top().locator('input[type=text], input:not([type]), .at-i').first()
      await input.fill('Rival3', { timeout: T }); await input.press('Enter'); await wait(600)
      const pick = p.locator('.vl [data-pick]').first()
      await pick.waitFor({ timeout: T }); await snap('stats-bf6-flow-search'); await pick.click(); await wait(1500)
      const after = await keysN()
      if (after !== before + 1) bad(`suivre : ${before} joueurs avant, ${after} après (attendu ${before + 1})`)
      const text = await p.evaluate(() => [...document.querySelectorAll('.vl')].map((v) => v.innerText).join('\n'))
      if (!/Rival3/.test(text)) {
        await p.keyboard.press('Escape'); await wait(400) // la fiche « suivre » se ferme parfois d'elle-même
        const t2 = await p.evaluate(() => [...document.querySelectorAll('.vl')].map((v) => v.innerText).join('\n'))
        if (!/Rival3/.test(t2)) bad('suivre : la ligne « Rival3 » n\'apparaît dans aucun panneau')
      }
      await snap('stats-bf6-flow-followed')
    })
    await step('ouvrir le rival, puis ne plus le suivre', async () => {
      const key = await p.evaluate(() => Board.rows().list.find((x) => x.name === 'Rival3')?.key)
      if (!key) throw new Error('Rival3 absent de Board.rows() après le suivi')
      await closeAll()
      await clickOpen('board'); await wait(300)
      await clickOpen(`rival:${key}`, '.vl'); await panelOk(`rival ${key}`)
      await snap('stats-bf6-flow-rival')
      const un = p.locator('.vl [data-act="unfollow"]').first()
      if (!(await un.count())) throw new Error('pas de bouton [data-act="unfollow"] dans la fiche du rival')
      const before = await keysN()
      await un.click({ timeout: T }); await wait(800)
      const ok = p.locator('.vl [data-act="unfollow-ok"], .vl [data-act="confirm"]').first() // une confirmation éventuelle
      if (await keysN() === before && await ok.count()) { await ok.click({ timeout: T }); await wait(800) }
      const after = await keysN()
      if (after !== before - 1) bad(`ne plus suivre : ${before} joueurs avant, ${after} après (attendu ${before - 1})`)
      await snap('stats-bf6-flow-unfollowed')
    })
    await step('nouveau loadout', async () => {
      await closeAll()
      await clickOpen('loadouts'); await panelOk('loadouts')
      const n0 = await p.evaluate(async () => (await API.getBf6Loadouts()).length)
      await clickOpen('atelier:new', 'body'); await settle(p, 900)
      await snap('stats-bf6-flow-atelier')
      // Le minimum de l'atelier : une arme et un nom (voir a9.cjs)
      await p.fill('#atW', 'M433'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter')
      await p.fill('#atName', 'Build cockpit'); await wait(600)
      await p.click('#atSave'); await wait(1500)
      const n1 = await p.evaluate(async () => (await API.getBf6Loadouts()).map((l) => l.name))
      if (n1.length !== n0 + 1 || !n1.includes('Build cockpit')) bad(`loadout : ${n0} avant, ${n1.length} après, noms ${JSON.stringify(n1)}`)
      await snap('stats-bf6-flow-saved')
      // La carte est dans le panneau des loadouts (ou la page y revient)
      let has = await p.evaluate(() => [...document.querySelectorAll('.vl, #sc-stats')].some((e) => /Build cockpit/.test(e.innerText)))
      if (!has) { await p.evaluate(() => StatsPage.open('loadouts')).catch(() => {}); await wait(600); has = await p.evaluate(() => [...document.querySelectorAll('.vl')].some((e) => /Build cockpit/.test(e.innerText))) }
      if (!has) bad('loadout : la carte « Build cockpit » n\'est pas visible après l\'enregistrement')
    })
    await step('Échap et flèche retour', async () => {
      if (!contract) throw new Error('contrat StatsPage absent')
      await closeAll()
      await p.evaluate(() => { StatsPage.open('board') }); await wait(500)
      await p.evaluate(() => { StatsPage.open('follow') }); await wait(500)
      let st = await state()
      if (st.sheet.length !== 2) bad(`pile de panneaux : ${JSON.stringify(st.sheet)} (attendu 2 panneaux)`)
      const back = top().locator('.vl-back').first()
      if (!(await back.count())) bad('pas de .vl-back sur le second panneau')
      else { await back.click({ timeout: T }); await wait(500); st = await state(); if (st.sheet.length !== 1 || st.sheet[0] !== 'board') bad(`.vl-back : sheet ${JSON.stringify(st.sheet)} (attendu [board])`) }
      await p.keyboard.press('Escape'); await wait(500); st = await state()
      if (st.sheet.length) bad(`Échap : sheet ${JSON.stringify(st.sheet)} (attendu vide)`)
      await p.evaluate(() => { StatsPage.open('board') }); await wait(400)
      await p.evaluate(() => { StatsPage.open('follow') }); await wait(400)
      await p.keyboard.press('Escape'); await wait(500); st = await state()
      if (st.sheet.length !== 1) bad(`Échap sur 2 panneaux : sheet ${JSON.stringify(st.sheet)} (attendu un seul restant)`)
      const x = p.locator('.vl-x').last(); if (await x.count()) { await x.click({ timeout: T }); await wait(500) } else bad('pas de .vl-x')
      await closeAll()
    })

    /* ---- Les anciens points d'entrée ---- */
    const entry = async (g, tab, expect) => step(`ancien accès ${g}/${tab}`, async () => {
      await closeAll()
      await p.evaluate(([g, tab]) => { S.statsGame = g; S.statsTab = tab; StatsPage.render() }, [g, tab]); await settle(p, 900)
      if (!contract) throw new Error('contrat StatsPage absent')
      const st = await state()
      if (expect ? !st.sheet.includes(expect) : false) bad(`ancien accès ${g}/${tab} : sheet ${JSON.stringify(st.sheet)} ne contient pas « ${expect} »`)
      if (!expect && st.g !== g) bad(`ancien accès ${g}/${tab} : state().g = ${st.g}`)
      await snap(`stats-entry-${g}-${tab}`)
    })
    await entry('bf6', 'loadouts', 'loadouts')
    await entry('bf6', 'board', 'board')
    await entry('cs2', 'matches', 'matches')
    await closeAll().catch(() => {})
  } catch (e) { bad(`scénario interrompu : ${msg(e)}`) }
  errs.forEach((e) => console.log('ERREUR ' + e))
  console.log(`défauts ${defects.length} erreurs ${errs.length} captures ${captures}`)
  await app.close().catch(() => {})
  process.exit(defects.length || errs.length ? 1 : 0)
})()
