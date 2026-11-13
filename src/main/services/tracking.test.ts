// Tests du rattachement des programmes aux jeux (npm run test:launch) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { coalesce, exeName, GENERIC_EXE, matchGames, memoAsync, parseProcLines, runningGameIds, usableDir, watchNames } from './tracking.ts'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('parseProcLines : nom, id et chemin, fins de ligne Windows', () => {
  const out = parseProcLines('steam\t1204\tC:\\Program Files (x86)\\Steam\\steam.exe\r\ncs2\t8812\t\r\n\r\n')
  assert.deepEqual(out, [
    { name: 'steam', pid: 1204, path: 'C:\\Program Files (x86)\\Steam\\steam.exe' },
    { name: 'cs2', pid: 8812, path: '' }
  ])
})

test('parseProcLines : noms et chemins accentués, BOM, lignes sans id ignorées', () => {
  const out = parseProcLines('\uFEFFÉlan\t42\tD:\\Jeux\\Élan Studio\\Élan.exe\nSystem Idle Process\t0\t\nligne cassée\n\t12\t\nbad\tx1\tC:\\a.exe')
  assert.deepEqual(out, [
    { name: 'Élan', pid: 42, path: 'D:\\Jeux\\Élan Studio\\Élan.exe' },
    { name: 'System Idle Process', pid: 0, path: '' }
  ])
})

const GAMES = [
  { id: 'steam:730', installDir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive' },
  { id: 'ea:bf6', installDir: 'C:\\Program Files\\EA Games\\Battlefield 6', exePath: 'C:\\Program Files\\EA Games\\Battlefield 6\\bf6.exe' },
  // Dossier imbriqué : le plus précis gagne.
  { id: 'steam:1', installDir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\tools' },
  // Dossier trop court : jamais rattaché par son chemin.
  { id: 'epic:short', installDir: 'C:\\Games' }
]

test('matchGames : par chemin d’abord, noms des programmes rattachés en minuscules', () => {
  const procs = [
    { name: 'cs2', pid: 1, path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe' },
    { name: 'Tool', pid: 2, path: 'c:/program files (x86)/steam/steamapps/common/counter-strike global offensive/tools/tool.exe' },
    { name: 'thing', pid: 3, path: 'C:\\Games\\thing.exe' }
  ]
  const m = matchGames(procs, GAMES)
  assert.deepEqual([...m.keys()].sort(), ['steam:1', 'steam:730'])
  assert.deepEqual([...m.get('steam:730')!], ['cs2'])
  assert.deepEqual([...m.get('steam:1')!], ['tool'])
  assert.deepEqual(runningGameIds(procs, GAMES), new Set(['steam:730', 'steam:1']))
})

test('matchGames : chemin illisible (anti-triche) → nom de l’exécutable connu ou trouvé dans le dossier', () => {
  const procs = [
    { name: 'BF6', pid: 10, path: '' },
    { name: 'csgo_launcher_x', pid: 11, path: '' },
    { name: 'cs2', pid: 12, path: '' }
  ]
  const m = matchGames(procs, GAMES, new Map([['steam:730', new Set(['cs2'])]]))
  assert.deepEqual([...m.keys()].sort(), ['ea:bf6', 'steam:730'])
  assert.deepEqual([...m.get('ea:bf6')!], ['bf6'])
  // Sans liste de noms, un chemin vide ne se rattache qu'à l'exécutable connu.
  assert.deepEqual([...matchGames(procs, GAMES).keys()], ['ea:bf6'])
})

test('matchGames : un chemin lisible hors de tout dossier ne se rattache pas par son nom', () => {
  const procs = [{ name: 'cs2', pid: 5, path: 'D:\\Ailleurs\\cs2.exe' }]
  assert.equal(matchGames(procs, GAMES, new Map([['steam:730', new Set(['cs2'])]])).size, 0)
})

test('GENERIC_EXE : outils et lanceurs écartés, vrais jeux gardés', () => {
  // UnrealCEFSubProcess et QtWebEngineProcess : livrés avec des jeux, et lancés en permanence par Epic Games et l'EA app.
  for (const n of ['unins000', 'UnityCrashHandler64', 'EasyAntiCheat_EOS', 'EADesktopLauncher', 'vc_redist.x64', 'CrashReportClient', 'start_protected_game', 'cefsharp.browsersubprocess', 'UnrealCEFSubProcess', 'QtWebEngineProcess'])
    assert.equal(GENERIC_EXE.test(n), true, n)
  for (const n of ['cs2', 'bf6', 'eldenring', 'witcher3', 'Cyberpunk2077']) assert.equal(GENERIC_EXE.test(n), false, n)
})

test('watchNames : le navigateur intégré d’un jeu (rattaché par son dossier) n’est pas suivi par son nom', () => {
  const games = [{ id: 'epic:ue', installDir: 'C:\\Program Files\\Epic Games\\UEGame' }]
  const procs = [
    { name: 'UEGame-Win64-Shipping', pid: 1, path: 'C:\\Program Files\\Epic Games\\UEGame\\Binaries\\Win64\\UEGame-Win64-Shipping.exe' },
    { name: 'UnrealCEFSubProcess', pid: 2, path: 'C:\\Program Files\\Epic Games\\UEGame\\Engine\\Binaries\\Win64\\UnrealCEFSubProcess.exe' },
    // La copie d'Epic Games, qui tourne tant que le lanceur est ouvert.
    { name: 'UnrealCEFSubProcess', pid: 3, path: 'C:\\Program Files (x86)\\Epic Games\\Launcher\\Engine\\Binaries\\Win64\\UnrealCEFSubProcess.exe' }
  ]
  const matched = matchGames(procs, games).get('epic:ue')!
  // Le rattachement (pastilles, sessions) garde tout ; le suivi d'un lancement ne cherche que le jeu.
  assert.deepEqual([...matched].sort(), ['uegame-win64-shipping', 'unrealcefsubprocess'])
  assert.deepEqual([...watchNames(matched)], ['uegame-win64-shipping'])
  assert.deepEqual([...watchNames(['qtwebengineprocess', 'crashpad_handler', 'cs2'])], ['cs2'])
  assert.equal(watchNames([]).size, 0)
})

test('exeName et usableDir : chemins Windows, même sous Linux', () => {
  assert.equal(exeName('C:\\Program Files\\EA Games\\Battlefield 6\\BF6.exe'), 'bf6')
  assert.equal(exeName('D:/Jeux/Élan/Élan.EXE'), 'élan')
  assert.equal(usableDir('C:\\Games'), false)
  assert.equal(usableDir('C:\\Games\\Hades'), true)
})

test('coalesce : rejoint le relevé en cours et n’en ajoute qu’un seul après', async () => {
  let runs = 0
  const pending: (() => void)[] = []
  const run = coalesce(
    () =>
      new Promise<number>((resolve) => {
        const n = ++runs
        pending.push(() => resolve(n))
      })
  )
  const a = run()
  const b = run()
  const c = run()
  assert.equal(runs, 1)
  pending.shift()!()
  assert.equal(await a, 1)
  await flush()
  // Un seul relevé de plus pour toutes les demandes arrivées pendant le premier.
  assert.equal(runs, 2)
  pending.shift()!()
  assert.equal(await b, 2)
  assert.equal(await c, 2)
  // Plus rien en cours : un nouvel appel relance tout de suite.
  const d = run()
  assert.equal(runs, 3)
  pending.shift()!()
  assert.equal(await d, 3)
})

test('coalesce : un relevé en échec ne bloque pas le suivant', async () => {
  let runs = 0
  const run = coalesce(async () => {
    if (++runs === 1) throw new Error('boom')
    return runs
  })
  const a = run()
  const b = run()
  await assert.rejects(a)
  assert.equal(await b, 2)
})

test('memoAsync : un appel pendant le calcul attend le résultat complet ; refresh recalcule', async () => {
  let runs = 0
  const pending: (() => void)[] = []
  // Parcours d'un dossier : la liste se remplit peu à peu, elle n'est complète qu'à la fin.
  const names = memoAsync(async (dir: string) => {
    const n = ++runs
    const out = new Set([`${dir}-${n}-a`])
    await new Promise<void>((resolve) => pending.push(resolve))
    out.add(`${dir}-${n}-b`)
    return out
  })
  const a = names('cs2')
  const b = names('cs2')
  assert.equal(runs, 1)
  pending.shift()!()
  assert.deepEqual([...(await b)], ['cs2-1-a', 'cs2-1-b'])
  assert.equal(await a, await b)
  // Relecture du dossier : un relevé qui arrive pendant le parcours attend la nouvelle liste complète.
  const c = names('cs2', true)
  const d = names('cs2')
  assert.equal(runs, 2)
  await flush()
  pending.shift()!()
  assert.deepEqual([...(await d)], ['cs2-2-a', 'cs2-2-b'])
  assert.equal(await c, await d)
  assert.equal(await names('cs2'), await d)
  assert.equal(runs, 2)
})

test('memoAsync : un échec n’est pas gardé', async () => {
  let runs = 0
  const get = memoAsync(async () => {
    if (++runs === 1) throw new Error('illisible')
    return runs
  })
  await assert.rejects(get('x'))
  assert.equal(await get('x'), 2)
  assert.equal(await get('x'), 2)
})
