// Essai 0.6.2 : les styles d'accueil Vitrine et Arsenal (Paramètres > Général > Style de l'accueil), dans la vraie fenêtre en mode démo.
// IMG_DIR (facultatif) : un dossier de jaquettes .jpg (cyber, fc, db, bf, cs) et d'images larges (bf_hero, cs_hero) posées sur les jeux de démo, pour voir le rendu avec de vraies images.
const { start, shot, settle } = require('./h.cjs')
const fs = require('fs'), path = require('path')
;(async () => {
  const { app, p, errs } = await start({ name: 'hx' })
  const ok = (c, m) => console.log(c ? 'OK' : 'NON', m)
  try {
    // Un sol retiré (Plateau, gardé par la beta.4) revient à Brume, le sol par défaut
    await p.evaluate(() => localStorage.setItem('pxv3-sol', 'plateau')); await p.reload(); await p.waitForTimeout(6000)
    ok((await p.evaluate(() => document.documentElement.dataset.sol)) === 'brume', 'sol de l’Arsenal par défaut : Brume (un ancien Plateau revient à Brume)')
    ok(await p.evaluate(() => !document.querySelector('.ar-floor, .as-disc')), 'plus de carreaux ni de plateau dans la page')
    await p.evaluate(() => Settings.open('general')); await p.waitForTimeout(900)
    await p.evaluate(() => document.querySelector('#r-home')?.scrollIntoView({ block: 'center' })); await p.waitForTimeout(300)
    await shot(p, 'hx-reglage')
    for (const v of ['0', 'r', 'v']) {
      await p.click(`#r-home [data-v="${v}"]`); await p.waitForTimeout(200)
      const st = await p.evaluate(() => [document.documentElement.dataset.home, localStorage.getItem('pxv3-accueil2')])
      ok(st[0] === v && st[1] === v, `réglage ${v} ${st}`)
    }
    await p.keyboard.press('Escape'); await settle(p, 800)
    const D = process.env.IMG_DIR
    if (D) {
      const img = (n) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(D, n + '.jpg')).toString('base64')
      const pics = { cov: ['cyber', 'fc', 'db', 'bf', 'cs'].map(img), hero: [null, null, null, img('bf_hero'), img('cs_hero')] }
      await p.evaluate((pics) => { GAMES.filter((g) => g.installed && !g.hidden).slice(0, 5).forEach((g, i) => { g.cover = pics.cov[i]; g.hero = pics.hero[i]; g.raw.coverUrl = pics.cov[i]; if (g.raw) g.raw.playtime = [6720, 3480, 780, 2700, 11820][i] }); Play.sync(); Play.setHome('v') }, pics)
      await p.waitForTimeout(2500)
    }
    for (const v of ['v', 'r']) {
      await p.evaluate((v) => Play.setHome(v), v); await p.mouse.move(700, 450); await p.waitForTimeout(2600)
      await shot(p, `hx-${v}-1`)
      const info = await p.evaluate(() => ({ home: document.documentElement.dataset.home, kick: document.querySelector('#hvKick')?.textContent, chips: document.querySelectorAll('#hvChips .hv-chip').length, bg: document.querySelectorAll('#hmBg .hb.on').length, idx: document.querySelectorAll('#arIdx .ar-ix').length, on: document.querySelector('#arIdx .ar-ix.on span')?.textContent, ready: document.querySelector('#arReady')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 90), ret: document.querySelector('#arRet')?.classList.contains('go'), gs: document.querySelector('.v-play')?.dataset.gs || 'neutre', front: document.querySelector('.card.is-front')?.getAttribute('aria-label') }))
      console.log('mode', v, JSON.stringify(info))
      for (const k of [2, 3, 4]) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(2200); await shot(p, `hx-${v}-${k}`) }
      const after = await p.evaluate(() => ({ front: document.querySelector('.card.is-front')?.getAttribute('aria-label'), on: document.querySelector('#arIdx .ar-ix.on span')?.textContent, gs: document.querySelector('.v-play')?.dataset.gs || 'neutre', ret: document.querySelector('#arRet')?.classList.contains('go') }))
      console.log('après 3 crans', v, JSON.stringify(after))
      // La molette fait aussi tourner
      // Le rendu logiciel est lent (plus de 2 s par cran sur une machine chargée) : on attend jusqu'à 8 s que la carte de devant change
      await p.mouse.move(800, 400); await p.mouse.wheel(0, 120)
      let moved = false
      for (let k = 0; k < 20 && !moved; k++) { await p.waitForTimeout(400); moved = (await p.evaluate(() => document.querySelector('.card.is-front')?.getAttribute('aria-label'))) !== after.front }
      ok(moved, `molette change de jeu (${v})`)
    }
    // Petite fenêtre
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720)); await p.waitForTimeout(1500)
    for (const v of ['v', 'r']) { await p.evaluate((v) => Play.setHome(v), v); await p.waitForTimeout(2200); await shot(p, `hx-${v}-petit`) }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 940)); await p.waitForTimeout(1200)
    // Retour à l'accueil actuel : la pile reprend sa place
    await p.evaluate(() => Play.setHome('0')); await p.waitForTimeout(2000); await shot(p, 'hx-0')
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#hvChips')).display === 'none' && getComputedStyle(document.querySelector('#arIdx')).display === 'none' && getComputedStyle(document.querySelector('#rail')).display !== 'none'), 'Actuel : rien des essais ne reste affiché')
    // Le choix tient après un rechargement
    // Un ancien choix de fond (ici Mur) est oublié : Verre partout depuis la 0.6.2
    await p.evaluate(() => { Play.setHome('r'); localStorage.setItem('pxv3-fond', 'mur') }); await p.reload(); await p.waitForTimeout(7000)
    ok((await p.evaluate(() => document.documentElement.dataset.home)) === 'r', 'choix gardé au redémarrage')
    ok(await p.evaluate(() => document.querySelector('#win').dataset.bg === 'verre' && localStorage.getItem('pxv3-fond') === null), 'fond Verre, ancien choix oublié')
    await p.evaluate(() => Settings.open('general')); await p.waitForTimeout(900)
    ok(await p.evaluate(() => !document.querySelector('#r-fond, [data-fond]') && !!document.querySelector('#r-accueil #r-home')), 'Paramètres : plus de « Fond de l’accueil »')
    await shot(p, 'hx-reglage-sans-fond'); await p.keyboard.press('Escape'); await p.waitForTimeout(400)
    await p.keyboard.press('F2'); await p.waitForTimeout(400)
    ok((await p.evaluate(() => document.querySelector('#win').dataset.bg)) === 'verre', 'F2 ne change plus le fond')
    // Essai beta.4 : le sol de l'Arsenal, au réglage et à F2
    await p.evaluate(() => Settings.open('general')); await p.waitForTimeout(900)
    for (const s of ['laque', 'brume']) {
      await p.click(`#r-sol [data-v="${s}"]`); await p.waitForTimeout(200)
      ok(await p.evaluate((s) => document.documentElement.dataset.sol === s && localStorage.getItem('pxv3-sol') === s, s), `réglage du sol : ${s}`)
    }
    await shot(p, 'hx-reglage-sol'); await p.keyboard.press('Escape'); await p.waitForTimeout(500)
    const s0 = await p.evaluate(() => document.documentElement.dataset.sol)
    await p.keyboard.press('F2'); await p.waitForTimeout(400)
    const s1 = await p.evaluate(() => document.documentElement.dataset.sol)
    ok(s0 === 'brume' && s1 === 'laque', `F2 passe au sol suivant (${s0} → ${s1})`)
    await p.waitForTimeout(2500); await shot(p, 'hx-r-laque')
    await shot(p, 'hx-r-relance')
    console.log('ERREURS', errs.length); errs.slice(0, 20).forEach((e) => console.log(e))
  } catch (e) { console.log('ECHEC', e.message.split('\n')[0]); console.log(errs.slice(0, 20).join('\n')) }
  await app.close()
})()
