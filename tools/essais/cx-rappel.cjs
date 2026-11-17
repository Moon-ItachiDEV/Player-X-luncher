// Page Clips pendant une partie : sur BF6 (pas de clip automatique) elle dit le raccourci, sur CS2 elle garde son texte.
process.env.SUF = process.env.SUF || '-' + Date.now().toString(36)
const fs = require('fs'), path = require('path')
const { start, shot, settle, OUT } = require('./h.cjs')
fs.mkdirSync(OUT, { recursive: true })
// Les clips d'exemple de cx.cjs, repris tels quels
const src = fs.readFileSync(path.join(__dirname, 'cx.cjs'), 'utf8')
const PREP = src.slice(src.indexOf('const PREP = ') + 'const PREP = '.length, src.indexOf('\nconst SET = '))
let bad = 0
const check = (ok, what, d) => { console.log(ok ? 'OK ' : 'NON', what); if (!ok) { bad++; if (d) console.log('   ', d) } }
;(async () => {
  const { app, p, errs } = await start({ name: 'cxr' })
  try {
    await p.evaluate((s) => (0, eval)('(' + s + ')()'), PREP)
    const set = async (o) => {
      await p.evaluate(({ clips, game, style, trig }) => {
        CLIPS = clips ? window.__fake() : []
        Real.clipsCfg = { ...Real.clipsCfg, enabled: true, hotkey: 'Alt+C', ...(trig === false ? { triggers: Object.fromEntries(Object.keys(Real.clipsCfg.triggers).map((k) => [k, false])) } : {}) }
        Real.clipsLive = { status: 'recording', game }
        Clips.setStyle(style || 'b')
        Real.emit('games')
        if (S.view !== 'clips') go('clips')
      }, o)
      await settle(p, 900)
      return p.evaluate(() => (document.querySelector('#cxRoot')?.innerText || '').replace(/\s+/g, ' '))
    }
    let t = await set({ clips: false, game: 'Battlefield 6' }); await shot(p, 'cxr-bf6-vide')
    check(/Appuie sur Alt \+ C pour garder un moment : ce jeu ne garde rien tout seul/.test(t), 'Viseur sans clip, BF6 : le raccourci', t.slice(0, 200))
    t = await set({ clips: true, game: 'Battlefield 6' }); await shot(p, 'cxr-bf6-clips')
    check(/Appuie sur Alt \+ C pour garder un moment/.test(t), 'Viseur avec clips, BF6 : le raccourci en titre', t.slice(0, 200))
    t = await set({ clips: false, game: 'Battlefield 6', style: 'a' }); await shot(p, 'cxr-bf6-regie')
    check(/Appuie sur Alt \+ C pour garder un moment/.test(t), 'Régie sans clip, BF6 : le raccourci', t.slice(0, 200))
    t = await set({ clips: false, game: 'Counter-Strike 2' })
    check(/Tes clips arriveront ici/.test(t) && !/pour garder un moment/.test(t), 'Viseur, CS2 avec ses moments : texte inchangé', t.slice(0, 200))
    t = await set({ clips: true, game: 'Counter-Strike 2' })
    check(/Le prochain clip arrive ici|clips? dans cette partie/.test(t) && !/pour garder un moment/.test(t), 'Viseur avec clips, CS2 : texte inchangé', t.slice(0, 200))
    t = await set({ clips: false, game: 'Counter-Strike 2', trig: false })
    check(/pour garder un moment/.test(t), 'CS2 sans aucun moment coché : le raccourci', t.slice(0, 200))
    await p.evaluate(() => { Real.st.settings = { ...Real.st.settings, cs2Live: false } })
    t = await set({ clips: false, game: 'Counter-Strike 2' })
    check(/pour garder un moment/.test(t), 'CS2 avec le suivi des matchs coupé : le raccourci', t.slice(0, 200))
    await p.evaluate(() => { Real.st.settings = { ...Real.st.settings, cs2Live: true } })
    t = await set({ clips: false, game: 'Battlefield 6', style: 'b' })
    check(/pour garder un moment/.test(t), 'BF6 joué, même si le jeu montré par défaut serait CS2', t.slice(0, 200))
    check(!errs.length, 'aucune erreur de page', errs.join(' / '))
  } catch (e) { console.log('ERREUR', e.message); bad++ } finally { await app.close().catch(() => {}) }
  console.log(bad ? `${bad} raté(s)` : 'tout bon'); process.exit(bad ? 1 : 0)
})()
