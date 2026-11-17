// Tests des règles de secours de la base (npm run test:garde).
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { asideName, readRetry, rescuePlan, salvageText, stuckLog, stuckText, toPrune, unreadText, withUnread, type FileState } from './dbRescue.ts'

const plan = (main: FileState, tmp: FileState, bak: FileState) => rescuePlan({ main, tmp, bak })

test('base saine : rien à faire, rien à dire', () => {
  const p = plan('ok', 'absent', 'absent')
  assert.deepEqual(p, { source: 'main', aside: [], drop: [], salvage: [], notice: null, log: null })
})

test('premier démarrage : base neuve, pas de message, pas de ligne', () => {
  const p = plan('absent', 'absent', 'absent')
  assert.deepEqual(p, { source: 'new', aside: [], drop: [], salvage: [], notice: null, log: null })
})

test('principal absent + secours ok : on reprend la copie de secours', () => {
  const p = plan('absent', 'absent', 'ok')
  assert.equal(p.source, 'bak')
  assert.equal(p.notice, 'secours')
  assert.deepEqual(p.aside, [])
  assert.ok(p.log)
})

test('principal vide + secours ok : le principal reste (le premier persist() le remplace), secours repris', () => {
  const p = plan('vide', 'absent', 'ok')
  assert.equal(p.source, 'bak')
  assert.deepEqual(p.drop, [])
  assert.deepEqual(p.aside, [])
  assert.equal(p.notice, 'secours')
})

test('principal illisible + secours ok : principal de côté, secours repris', () => {
  const p = plan('illisible', 'absent', 'ok')
  assert.equal(p.source, 'bak')
  assert.deepEqual(p.aside, ['main'])
  assert.deepEqual(p.drop, [])
  assert.equal(p.notice, 'secours')
  assert.match(p.log ?? '', /^Base principale illisible : reprise depuis la copie de secours/)
})

test('principal illisible + provisoire ok : on reprend le provisoire, sans message', () => {
  const p = plan('illisible', 'ok', 'ok')
  assert.equal(p.source, 'tmp')
  assert.deepEqual(p.aside, ['main'])
  assert.equal(p.notice, null)
  assert.ok(p.log)
})

test('principal et secours illisibles : base neuve, les deux de côté, message « zéro »', () => {
  const p = plan('illisible', 'absent', 'illisible')
  assert.equal(p.source, 'new')
  assert.deepEqual(p.aside, ['main', 'bak'])
  assert.equal(p.notice, 'zero')
  assert.ok(p.log)
})

test('principal illisible seul : base neuve, message « zéro »', () => {
  const p = plan('illisible', 'absent', 'absent')
  assert.equal(p.source, 'new')
  assert.deepEqual(p.aside, ['main'])
  assert.equal(p.notice, 'zero')
})

test('principal vide seul : rien à supprimer, message « zéro »', () => {
  const p = plan('vide', 'absent', 'absent')
  assert.equal(p.source, 'new')
  assert.deepEqual(p.drop, [])
  assert.deepEqual(p.aside, [])
  assert.equal(p.notice, 'zero')
})

test('principal absent + secours illisible : secours de côté, message « zéro »', () => {
  const p = plan('absent', 'absent', 'illisible')
  assert.equal(p.source, 'new')
  assert.deepEqual(p.aside, ['bak'])
  assert.equal(p.notice, 'zero')
})

test('provisoire illisible seul : premier démarrage interrompu, pas de message, provisoire jamais de côté', () => {
  const p = plan('absent', 'illisible', 'absent')
  assert.deepEqual(p, { source: 'new', aside: [], drop: [], salvage: [], notice: null, log: null })
})

test('principal ok + secours illisible : le principal gagne, la secours est de côté', () => {
  const p = plan('ok', 'absent', 'illisible')
  assert.equal(p.source, 'main')
  assert.equal(p.notice, null)
  assert.equal(p.log, null)
  assert.deepEqual(p.aside, ['bak'])
})

test('copie de secours vide : supprimée, jamais mise de côté', () => {
  const p = plan('absent', 'absent', 'vide')
  assert.deepEqual(p.drop, ['bak'])
  assert.deepEqual(p.aside, [])
  assert.equal(p.notice, 'zero')
  assert.deepEqual(plan('vide', 'absent', 'vide').drop, ['bak'])
})

test('journal : ce qui est trouvé et repris, sans « Mis de côté » ni état répété entre parenthèses', () => {
  for (const m of ['absent', 'vide', 'illisible', 'ok'] as FileState[])
    for (const t of ['absent', 'vide', 'illisible', 'ok'] as FileState[])
      for (const b of ['absent', 'vide', 'illisible', 'ok'] as FileState[]) {
        const log = plan(m, t, b).log
        if (log !== null) assert.ok(!/Mis de côté|\(launcher\.db (vide|illisible)/.test(log), log)
      }
  assert.equal(plan('illisible', 'ok', 'absent').log, 'Base principale illisible : reprise depuis le dernier fichier provisoire (launcher.db.tmp).')
})

test('le provisoire n’est jamais mis de côté', () => {
  for (const t of ['absent', 'vide', 'illisible', 'ok'] as FileState[])
    for (const m of ['absent', 'vide', 'illisible', 'ok'] as FileState[])
      for (const b of ['absent', 'vide', 'illisible', 'ok'] as FileState[]) assert.ok(!(plan(m, t, b).aside as string[]).includes('tmp'))
})

test('asideName : AAAAMMJJ-HHMMSS à l’heure locale', () => {
  assert.equal(asideName('/d/launcher.db', new Date(2026, 10, 16, 9, 5, 3)), '/d/launcher.db.illisible-20261116-090503')
  assert.equal(asideName('launcher.db.bak', new Date(2026, 0, 2, 23, 59, 59)), 'launcher.db.bak.illisible-20260102-235959')
})

test('toPrune : garde les 6 plus récents, ne touche à aucun autre nom', () => {
  const names = ['launcher.db', 'launcher.db.bak', 'launcher.db.tmp', 'erreurs.log', 'launcher.db.illisible-20261116-090503x']
  const old = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => `launcher.db.illisible-2026110${d}-120000`)
  const out = toPrune([...names, ...old.slice().reverse()])
  assert.deepEqual(out.sort(), [old[0], old[1]])
  assert.deepEqual(toPrune([...names, ...old.slice(0, 6)]), [])
  assert.deepEqual(toPrune(names), [])
})

test('toPrune : chaque fichier d’origine garde ses propres 6', () => {
  const a = [1, 2, 3, 4, 5, 6, 7].map((d) => `launcher.db.illisible-2026110${d}-120000`)
  const b = [1, 2].map((d) => `launcher.db.bak.illisible-2026110${d}-120000`)
  assert.deepEqual(toPrune([...a, ...b]), [a[0]])
})

test('salvage : seulement quand aucun fichier n’est sain, le principal d’abord', () => {
  assert.deepEqual(plan('illisible', 'absent', 'illisible').salvage, ['main', 'bak'])
  assert.deepEqual(plan('absent', 'absent', 'illisible').salvage, ['bak'])
  assert.deepEqual(plan('vide', 'absent', 'illisible').salvage, ['bak'])
  assert.deepEqual(plan('illisible', 'ok', 'illisible').salvage, [])
  assert.deepEqual(plan('illisible', 'absent', 'ok').salvage, [])
  assert.deepEqual(plan('absent', 'illisible', 'absent').salvage, [])
})

test('readRetry : réessaie EBUSY, EPERM, EACCES, jusqu’à 4 lectures', async () => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    let n = 0
    const waits: number[] = []
    const v = await readRetry(() => { if (++n < 3) throw Object.assign(new Error('pris'), { code }); return 'lu' }, async (ms) => { waits.push(ms) })
    assert.equal(v, 'lu')
    assert.equal(n, 3)
    assert.deepEqual(waits, [300, 300])
  }
})

test('readRetry : la dernière erreur est relevée après 4 lectures', async () => {
  let n = 0
  await assert.rejects(readRetry(() => { n++; throw Object.assign(new Error(`essai ${n}`), { code: 'EBUSY' }) }, async () => {}), /essai 4/)
  assert.equal(n, 4)
})

test('readRetry : une autre erreur n’est pas réessayée', async () => {
  let n = 0
  await assert.rejects(readRetry(() => { n++; throw Object.assign(new Error('dossier'), { code: 'EISDIR' }) }, async () => {}), /dossier/)
  assert.equal(n, 1)
  n = 0
  await assert.rejects(readRetry(() => { n++; throw new Error('sans code') }, async () => {}), /sans code/)
  assert.equal(n, 1)
})

test('stuckText : un ou deux fichiers', () => {
  assert.equal(stuckText(['launcher.db']), 'Le fichier launcher.db ne peut être ni lu ni mis de côté : un autre programme l’utilise peut-être. Redémarre ton PC, puis rouvre Player X.')
  assert.equal(stuckText(['launcher.db', 'launcher.db.bak']), 'Les fichiers launcher.db et launcher.db.bak ne peuvent être ni lus ni mis de côté : un autre programme les utilise peut-être. Redémarre ton PC, puis rouvre Player X.')
})

test('salvageText : la ligne du journal', () => {
  assert.equal(
    salvageText('launcher.db', { kv: 3, games: 2, launches: 10, sessions: 4 }),
    'Aucun fichier sain : reprise de ce qui était encore lisible dans launcher.db (réglages : 3 lignes, jeux : 2, lancements : 10, sessions : 4).'
  )
})

test('stuckLog : sans et avec des fichiers gardés', () => {
  assert.equal(stuckLog(['launcher.db.bak'], []), 'Impossible de mettre de côté : launcher.db.bak. Player X s’arrête sans toucher à la base.')
  assert.equal(
    stuckLog(['launcher.db', 'launcher.db.bak'], ['launcher.db.tmp.illisible-20261116-090503']),
    'Impossible de mettre de côté : launcher.db, launcher.db.bak. Gardé de côté : launcher.db.tmp.illisible-20261116-090503. Player X s’arrête sans toucher à la base.'
  )
})

test('unreadText : la phrase du journal pour un fichier qu’on n’a pas pu lire', () => {
  assert.equal(unreadText('launcher.db', 'EBUSY'), 'Lecture impossible : launcher.db (EBUSY).')
  assert.equal(unreadText('launcher.db.bak', 'erreur'), 'Lecture impossible : launcher.db.bak (erreur).')
})

test('withUnread : les phrases vont après la première phrase de chacune des lignes possibles', () => {
  const u1 = unreadText('launcher.db', 'EBUSY')
  const u2 = unreadText('launcher.db.bak', 'EPERM')
  const tmp = plan('illisible', 'ok', 'absent').log ?? ''
  const bak = plan('illisible', 'absent', 'ok').log ?? ''
  const neuve = plan('illisible', 'absent', 'illisible').log ?? ''
  const reprise = salvageText('launcher.db', { kv: 3, games: 2, launches: 10, sessions: 4 })
  // Une seule phrase : à la fin
  assert.equal(withUnread(tmp, [u1]), 'Base principale illisible : reprise depuis le dernier fichier provisoire (launcher.db.tmp). Lecture impossible : launcher.db (EBUSY).')
  assert.equal(withUnread(neuve, [u1, u2]), 'Ni la base ni la copie de secours ne sont lisibles : Player X repart d’une base neuve. Lecture impossible : launcher.db (EBUSY). Lecture impossible : launcher.db.bak (EPERM).')
  assert.equal(withUnread(reprise, [u1]), 'Aucun fichier sain : reprise de ce qui était encore lisible dans launcher.db (réglages : 3 lignes, jeux : 2, lancements : 10, sessions : 4). Lecture impossible : launcher.db (EBUSY).')
  // Deux phrases : juste après la première
  assert.equal(withUnread(bak, [u1]), 'Base principale illisible : reprise depuis la copie de secours. Lecture impossible : launcher.db (EBUSY). Les changements récents peuvent manquer.')
  assert.equal(withUnread(bak, [u1, u2]), 'Base principale illisible : reprise depuis la copie de secours. Lecture impossible : launcher.db (EBUSY). Lecture impossible : launcher.db.bak (EPERM). Les changements récents peuvent manquer.')
  // Le démarrage arrêté : sans puis avec des fichiers gardés
  assert.equal(withUnread(stuckLog(['launcher.db.bak'], []), [u1]), 'Impossible de mettre de côté : launcher.db.bak. Lecture impossible : launcher.db (EBUSY). Player X s’arrête sans toucher à la base.')
  assert.equal(
    withUnread(stuckLog(['launcher.db.bak'], ['launcher.db.illisible-20261116-090503']), [u1]),
    'Impossible de mettre de côté : launcher.db.bak. Lecture impossible : launcher.db (EBUSY). Gardé de côté : launcher.db.illisible-20261116-090503. Player X s’arrête sans toucher à la base.'
  )
})

test('withUnread : rien à ajouter, la ligne reste telle quelle', () => {
  for (const line of [plan('illisible', 'absent', 'ok').log ?? '', stuckLog(['launcher.db'], ['x']), 'Une phrase.']) assert.equal(withUnread(line, []), line)
})
