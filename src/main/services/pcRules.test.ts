// Tests de Mon PC (npm run test:pc) : versions des pilotes, liste NVIDIA, réponse d'AjaxDriverService, écrans.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore TS5097
import { compareVersions, isLowHz, LINKS, nvidiaDate, nvidiaLatest, nvidiaLookupUrl, nvidiaModel, nvidiaPfid, nvidiaUrl, nvidiaVersion, parseDisplayLines, parseNvidiaLookup, pcBadge, readDisplays, readGpus, vendorOf } from './pcRules.ts'

test('version NVIDIA : les cinq derniers chiffres de Windows', () => {
  assert.equal(nvidiaVersion('32.0.15.6636'), '566.36')
  assert.equal(nvidiaVersion('31.0.15.4633'), '546.33')
  assert.equal(nvidiaVersion('27.21.14.5671'), '456.71')
  assert.equal(nvidiaVersion('32.0.15.8157'), '581.57')
  assert.equal(nvidiaVersion(''), null)
  assert.equal(nvidiaVersion('566.36'), null)
  assert.equal(nvidiaVersion('abc'), null)
})

test('comparer deux versions', () => {
  assert.ok(compareVersions('566.36', '581.57') < 0)
  assert.ok(compareVersions('581.57', '581.57') === 0)
  assert.ok(compareVersions('590.01', '581.57') > 0)
  assert.ok(compareVersions('32.0.101.9175', '32.0.101.8509') > 0)
  assert.ok(compareVersions('581.8', '581.57') < 0, 'les décimales se comparent comme des nombres, pas comme du texte')
})

test('la marque vient de l’identifiant PCI, pas du nom', () => {
  assert.equal(vendorOf('PCI\\VEN_10DE&DEV_2684&SUBSYS_16F110DE'), 'nvidia')
  assert.equal(vendorOf('PCI\\VEN_1002&DEV_744C'), 'amd')
  assert.equal(vendorOf('PCI\\VEN_8086&DEV_56A0'), 'intel')
  assert.equal(vendorOf('PCI\\VEN_1414&DEV_008C'), 'other')
  assert.equal(vendorOf('', 'NVIDIA', 'NVIDIA GeForce RTX 4070'), 'nvidia')
  assert.equal(vendorOf('', 'Advanced Micro Devices, Inc.', 'AMD Radeon RX 7800 XT'), 'amd')
})

test('les cartes : NVIDIA d’abord, Arc avant la puce Intel, les virtuelles laissées de côté', () => {
  const gpus = readGpus(
    [
      { name: 'Intel(R) UHD Graphics 770', ver: '31.0.101.4502', date: '2024-05-02', pnp: 'PCI\\VEN_8086&DEV_4680' },
      { name: 'Microsoft Basic Display Adapter', ver: '10.0.22621.1', pnp: 'PCI\\VEN_1414&DEV_008C' },
      { name: 'Parsec Virtual Display Adapter', ver: '0.45.0.0', pnp: 'ROOT\\DISPLAY\\0000' },
      { name: 'NVIDIA GeForce RTX 4070 SUPER', ver: '32.0.15.6636', date: '2024-12-05', pnp: 'PCI\\VEN_10DE&DEV_2783', maker: 'NVIDIA' },
      { name: 'Intel(R) Arc(TM) A770 Graphics', ver: '32.0.101.9175', date: '2026-11-04', pnp: 'PCI\\VEN_8086&DEV_56A0' }
    ],
    [],
    false
  )
  assert.deepEqual(gpus.map((g) => g.name), ['NVIDIA GeForce RTX 4070 SUPER', 'Intel Arc A770 Graphics', 'Intel UHD Graphics 770'])
  assert.equal(gpus[0].version, '566.36')
  assert.equal(gpus[0].windowsVersion, '32.0.15.6636')
  assert.equal(gpus[0].date, '2024-12-05')
  assert.equal(gpus[0].link?.url, LINKS.nvidiaDrivers)
  assert.equal(gpus[1].version, '32.0.101.9175', 'Intel écrit sa version comme Windows')
  assert.equal(gpus[1].link?.url, LINKS.intel)
  assert.match(gpus[2].note ?? '', /processeur/)
})

test('AMD : la version Adrenalin du registre, sinon rien (la version Windows ne dit rien aux joueurs)', () => {
  const raw = [{ name: 'AMD Radeon RX 7800 XT', ver: '32.0.21025.10016', pnp: 'PCI\\VEN_1002&DEV_747E&SUBSYS_E3271DA2&REV_C8\\6&1F3B' }]
  const radeon = [{ match: 'pci\\ven_1002&dev_747e', radeon: '25.10.2' }]
  const [g] = readGpus(raw, radeon, false)
  assert.equal(g.vendor, 'amd')
  assert.equal(g.version, '25.10.2')
  assert.equal(g.windowsVersion, '32.0.21025.10016')
  assert.equal(g.link?.url, LINKS.amd)
  assert.match(g.note ?? '', /Auto-Detect/)
  assert.equal(readGpus(raw, [], false)[0].version, null)
  assert.equal(readGpus(raw, [{ match: 'pci\\ven_1002&dev_73bf', radeon: '25.10.2' }], false)[0].version, null, 'une autre carte AMD ne prête pas sa version')
})

test('Intel sur un portable : l’avertissement du fabricant du PC', () => {
  const [g] = readGpus([{ name: 'Intel(R) Arc(TM) Graphics', ver: '32.0.101.6913', pnp: 'PCI\\VEN_8086&DEV_7D55' }], [], true)
  assert.match(g.note ?? '', /portable/)
  assert.match(g.note ?? '', /fabricant du PC/)
})

test('une date de pilote bizarre est jetée', () => {
  const [g] = readGpus([{ name: 'NVIDIA GeForce RTX 3060', ver: '32.0.15.6636', date: '1601-01-01', pnp: 'PCI\\VEN_10DE&DEV_2504' }], [], false)
  assert.equal(g.date, null)
})

test('nom NVIDIA nettoyé comme dans la liste de NVIDIA', () => {
  assert.equal(nvidiaModel('NVIDIA GeForce RTX 4070 Super'), 'GeForce RTX 4070 SUPER')
  assert.equal(nvidiaModel('NVIDIA GeForce GTX 1060 6GB'), 'GeForce GTX 1060')
  assert.equal(nvidiaModel('NVIDIA GeForce GTX 760Ti (OEM)'), 'GeForce GTX 760Ti')
  assert.equal(nvidiaModel('NVIDIA GeForce RTX 2080 with Max-Q Design'), 'GeForce RTX 2080')
})

test('pfid : le nom exact, sinon une carte de la même série récente', () => {
  assert.deepEqual(nvidiaPfid('NVIDIA GeForce RTX 5090', false), { pfid: 1066, notebook: false, bySeries: false })
  assert.deepEqual(nvidiaPfid('NVIDIA GeForce RTX 3060', false), { pfid: 942, notebook: false, bySeries: false })
  // RTX 5060 sortie après la liste : même pilote que les autres RTX 50
  const r = nvidiaPfid('NVIDIA GeForce RTX 5060', false)
  assert.equal(r?.bySeries, true)
  assert.equal(r?.notebook, false)
  assert.ok(r && [1066, 1065, 1067, 1068, 1070, 1076].includes(r.pfid))
  // Un portable lit la liste des portables
  assert.deepEqual(nvidiaPfid('NVIDIA GeForce RTX 4060 Laptop GPU', true), { pfid: 1007, notebook: true, bySeries: false })
  assert.equal(nvidiaPfid('NVIDIA GeForce RTX 4060 Laptop GPU', false)?.notebook, true, 'le nom « Laptop GPU » suffit')
  // Une vieille carte hors liste n'est pas devinée
  assert.equal(nvidiaPfid('NVIDIA GeForce GT 710', false), null)
  assert.equal(nvidiaPfid('NVIDIA Quadro P2000', false), null)
})

test('adresse de recherche NVIDIA : Windows 10/11 64 bits, DCH', () => {
  assert.equal(nvidiaLookupUrl(1066), 'https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup&pfid=1066&osID=57&dch=1')
})

const PAYLOAD = {
  Success: '1',
  IDS: [
    {
      downloadInfo: {
        Success: '1',
        ID: '255000',
        Version: '581.57',
        Name: 'GeForce%20Game%20Ready%20Driver',
        ReleaseDateTime: 'Tue Oct 14, 2026',
        DetailsURL: 'https%3A%2F%2Fwww.nvidia.com%2Fdownload%2FdriverResults.aspx%2F255000%2Fen-us',
        DownloadURL: 'https://us.download.nvidia.com/Windows/581.57/581.57-desktop-win10-win11-64bit-international-dch-whql.exe'
      }
    }
  ]
}

test('réponse NVIDIA lue, adresses vérifiées', () => {
  const r = parseNvidiaLookup(PAYLOAD)
  assert.deepEqual(r, { version: '581.57', date: '2026-10-14', url: 'https://www.nvidia.com/download/driverResults.aspx/255000/en-us', name: 'GeForce Game Ready Driver', downloadUrl: 'https://us.download.nvidia.com/Windows/581.57/581.57-desktop-win10-win11-64bit-international-dch-whql.exe' })
  // Une adresse hors de NVIDIA est jetée, la version reste
  const bad = structuredClone(PAYLOAD)
  bad.IDS[0].downloadInfo.DetailsURL = 'https://nvidia.com.example.org/piege'
  assert.equal(parseNvidiaLookup(bad)?.url, null)
  assert.equal(nvidiaUrl('http://www.nvidia.com/x'), null)
  assert.equal(nvidiaUrl('https://www.nvidia.com/x'), 'https://www.nvidia.com/x')
})

test('réponse NVIDIA inattendue : rien (le lien vers nvidia.com reste)', () => {
  assert.equal(parseNvidiaLookup(null), null)
  assert.equal(parseNvidiaLookup('<html>'), null)
  assert.equal(parseNvidiaLookup({ Success: '0', IDS: [] }), null)
  assert.equal(parseNvidiaLookup({ Success: 1, IDS: [{}] }), null)
  assert.equal(parseNvidiaLookup({ Success: 1, IDS: [{ downloadInfo: { Version: 'pas une version' } }] }), null)
  assert.equal(parseNvidiaLookup({ Success: 1, IDS: [{ downloadInfo: { Version: '581.57' } }] })?.version, '581.57', 'Success en nombre accepté')
})

test('dates NVIDIA', () => {
  assert.equal(nvidiaDate('Tue Oct 14, 2026'), '2026-10-14')
  assert.equal(nvidiaDate('Wed Nov 4, 2026'), '2026-11-04')
  assert.equal(nvidiaDate('2026-11-04 00:00:00'), '2026-11-04')
  assert.equal(nvidiaDate('demain'), null)
})

test('à jour, mise à jour, plus récent', () => {
  const found = { version: '581.57', date: '2026-10-14', url: null }
  assert.equal(nvidiaLatest('566.36', found, false).status, 'update')
  assert.equal(nvidiaLatest('581.57', found, false).status, 'up-to-date')
  assert.equal(nvidiaLatest('590.01', found, false).status, 'newer')
  assert.equal(nvidiaLatest(null, found, false).status, 'unknown')
  assert.equal(nvidiaLatest('566.36', found, false).url, LINKS.nvidiaDrivers, 'sans page de détail, la page des pilotes')
  assert.equal(nvidiaLatest('566.36', found, true).bySeries, true)
})

test('écrans : lignes du script', () => {
  const t = 'J\t{}\r\nD\t0\t0\t2560\t1440\t60\t165\t1\r\nD\t2560\t0\t1920\t1080\t60\t60\t0\r\nD\tx\t0\t1\t1\t1\t1\t0\r\nautre\r\n'
  assert.deepEqual(parseDisplayLines(t), [
    { x: 0, y: 0, w: 2560, h: 1440, hz: 60, maxHz: 165, primary: true },
    { x: 2560, y: 0, w: 1920, h: 1080, hz: 60, maxHz: 60, primary: false }
  ])
})

test('écran sous sa fréquence max : 5 Hz d’écart au moins', () => {
  assert.equal(isLowHz(60, 144), true)
  assert.equal(isLowHz(59, 60), false)
  assert.equal(isLowHz(144, 144), false)
  assert.equal(isLowHz(120, 165), true)
  assert.equal(isLowHz(60, null), false)
  assert.equal(isLowHz(0, 144), false)
})

test('écrans : le nom d’Electron, la fréquence max de Windows, retrouvés par leur coin', () => {
  const electron = [
    { label: 'DELL S2721DGF', hz: 59.951, x: 2560, y: 0, w: 2560, h: 1440, primary: false },
    { label: 'AOC 24G2', hz: 144, x: 0, y: 0, w: 1920, h: 1080, primary: true }
  ]
  const windows = [
    { x: 0, y: 0, w: 1920, h: 1080, hz: 144, maxHz: 144, primary: true },
    { x: 2560, y: 0, w: 2560, h: 1440, hz: 59, maxHz: 165, primary: false }
  ]
  const d = readDisplays(electron, windows)
  assert.deepEqual(d.map((x) => [x.name, x.hz, x.maxHz, x.low, x.primary]), [
    ['AOC 24G2', 144, 144, false, true],
    ['DELL S2721DGF', 60, 165, true, false]
  ])
  // Windows muet : la fréquence reste, sans alerte
  assert.deepEqual(readDisplays(electron, []).map((x) => [x.hz, x.maxHz, x.low]), [[144, null, false], [60, null, false]])
})

test('sommaire : ce qui demande un geste d’abord', () => {
  const up = { name: 'x', vendor: 'nvidia' as const, version: '566.36', windowsVersion: null, date: null, link: null, latest: { version: '581.57', date: null, url: LINKS.nvidiaDrivers, status: 'update' as const, bySeries: false } }
  const low = { name: 'e', width: 1, height: 1, hz: 60, maxHz: 144, primary: true, low: true }
  assert.equal(pcBadge([up], [low]), 'Nouveau pilote')
  assert.equal(pcBadge([], [low]), 'Écran à régler')
  assert.equal(pcBadge([], []), '')
})

// ---------- lot 2 : mise à jour du pilote NVIDIA ----------
// @ts-ignore TS5097
import { cleanJournal, ELEVATE_SCRIPT, encodePs, installerName, installOutcome, installScript, nvidiaDownloadUrl, nvidiaSigned, parseInstallResult, psQuote } from './pcRules.ts'

test('fichier du pilote : seulement chez NVIDIA, en https, un .exe', () => {
  const u = 'https://us.download.nvidia.com/Windows/581.57/581.57-desktop-win10-win11-64bit-international-dch-whql.exe'
  assert.equal(nvidiaDownloadUrl(u), u)
  assert.equal(nvidiaDownloadUrl('https://international.download.nvidia.com/Windows/581.57/x.exe'), 'https://international.download.nvidia.com/Windows/581.57/x.exe')
  assert.equal(nvidiaDownloadUrl('http://us.download.nvidia.com/Windows/581.57/x.exe'), null)
  assert.equal(nvidiaDownloadUrl('https://download.nvidia.com.example.org/x.exe'), null)
  assert.equal(nvidiaDownloadUrl('https://www.nvidia.com/x.exe'), null, 'le site, pas le serveur de fichiers')
  assert.equal(nvidiaDownloadUrl('https://us.download.nvidia.com/Windows/581.57/notes.pdf'), null)
  assert.equal(nvidiaDownloadUrl('https://user:pw@us.download.nvidia.com/x.exe'), null)
  assert.equal(nvidiaDownloadUrl(42), null)
})

test('la réponse NVIDIA donne l’adresse du fichier, vérifiée', () => {
  const r = parseNvidiaLookup(PAYLOAD)
  assert.equal(r?.downloadUrl, 'https://us.download.nvidia.com/Windows/581.57/581.57-desktop-win10-win11-64bit-international-dch-whql.exe')
  const bad = structuredClone(PAYLOAD)
  bad.IDS[0].downloadInfo.DownloadURL = 'https://evil.example/581.57.exe'
  assert.equal(parseNvidiaLookup(bad)?.downloadUrl, null)
  assert.equal(nvidiaLatest('566.36', { version: '581.57', date: null, url: null, downloadUrl: r?.downloadUrl }, false).downloadUrl, r?.downloadUrl)
  assert.equal('downloadUrl' in nvidiaLatest('566.36', { version: '581.57', date: null, url: null, downloadUrl: null }, false), false)
})

test('nom du fichier sur le disque', () => {
  assert.equal(installerName('https://us.download.nvidia.com/Windows/581.57/581.57-desktop-win10-win11-64bit-international-dch-whql.exe', '581.57'), '581.57-desktop-win10-win11-64bit-international-dch-whql.exe')
  assert.doesNotMatch(installerName('https://us.download.nvidia.com/Windows/581.57/..%5C..%5Cx.exe', '581.57'), /[\\/]/)
  assert.equal(installerName('https://us.download.nvidia.com/Windows/581.57/.exe', '581.57'), 'nvidia-581.57.exe')
})

test('signature : valide et signée par NVIDIA Corporation', () => {
  const SUBJ = 'CN=NVIDIA Corporation, OU=2-J, O=NVIDIA Corporation, L=Santa Clara, S=California, C=US'
  assert.equal(nvidiaSigned('Valid', SUBJ), true)
  assert.equal(nvidiaSigned('HashMismatch', SUBJ), false)
  assert.equal(nvidiaSigned('NotSigned', ''), false)
  assert.equal(nvidiaSigned('Valid', 'CN=NVIDIA Corporation Fake, O=Someone'), false)
  assert.equal(nvidiaSigned('Valid', 'CN=Evil, O=NVIDIA Corporation Ltd'), false)
})

test('texte PowerShell : apostrophes doublées, y compris typographiques', () => {
  assert.equal(psQuote("C:\\Users\\Zoé\\AppData"), "'C:\\Users\\Zoé\\AppData'")
  assert.equal(psQuote("C:\\Users\\O'Neil"), "'C:\\Users\\O''Neil'")
  assert.equal(psQuote('C:\\Users\\O’Neil'), "'C:\\Users\\O’’Neil'")
})

test('script administrateur : signature revérifiée, point de restauration, installeur officiel', () => {
  const s = installScript({ exe: "C:\\Users\\O'Neil\\AppData\\Roaming\\x\\pilotes\\581.57.exe", resultFile: 'C:\\r.json', version: '581.57', restorePoint: true })
  assert.match(s, /Get-AuthenticodeSignature -LiteralPath \$exe/)
  assert.match(s, /\$exe='C:\\Users\\O''Neil\\AppData/)
  assert.match(s, /Checkpoint-Computer -Description 'Player X : avant le pilote NVIDIA 581\.57'/)
  assert.match(s, /-ArgumentList '-s','-noreboot','-noeula','-nofinish','-passive'/)
  assert.ok(s.indexOf('Get-AuthenticodeSignature') < s.indexOf('Checkpoint-Computer') && s.indexOf('Checkpoint-Computer') < s.indexOf('Start-Process'), 'dans cet ordre')
  const sans = installScript({ exe: 'C:\\a.exe', resultFile: 'C:\\r.json', version: '581.57', restorePoint: false })
  assert.doesNotMatch(sans, /Checkpoint-Computer/)
  assert.match(sans, /\$r\.restore='skipped'/)
  // Passé en base64 UTF-16 : relu à l'identique
  assert.equal(Buffer.from(encodePs(s), 'base64').toString('utf16le'), s)
  assert.match(ELEVATE_SCRIPT, /-Verb RunAs -Wait -PassThru/)
  assert.match(ELEVATE_SCRIPT, /\$env:PX_ELEV/)
})

test('résultat du processus administrateur', () => {
  assert.deepEqual(parseInstallResult('\uFEFF{"step":"install","restore":"ok","code":0}'), { step: 'install', restore: 'ok', code: 0, error: undefined })
  assert.equal(parseInstallResult('pas du json'), null)
  assert.equal(parseInstallResult('{"restore":"bizarre"}')?.restore, undefined)
  assert.equal(installOutcome(true, null), 'refused')
  assert.equal(installOutcome(false, null), 'failed')
  assert.equal(installOutcome(false, { error: 'signature' }), 'signature')
  assert.equal(installOutcome(false, { restore: 'failed', error: 'Service désactivé' }), 'restore-failed')
  assert.equal(installOutcome(false, { restore: 'ok', code: 0 }), 'ok')
  assert.equal(installOutcome(false, { restore: 'recent', code: 1 }), 'reboot')
  assert.equal(installOutcome(false, { restore: 'ok', code: 2 }), 'failed')
})

test('journal des pilotes : nettoyé, les plus récents d’abord, 20 au plus', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ at: 1000 + i, from: '566.36', to: '581.57', outcome: 'ok', restore: 'ok', after: '581.57' }))
  const j = cleanJournal([...many, { at: 5, to: 'x', outcome: 'ok' }, { at: 6, to: '581.57', outcome: 'pirate' }, null, 'texte'])
  assert.equal(j.length, 20)
  assert.equal(j[0].at, 1024)
  assert.equal(cleanJournal('rien').length, 0)
  assert.equal(cleanJournal([{ at: 1, from: null, to: '581.57', outcome: 'refused', restore: '??' }])[0].restore, undefined)
})
