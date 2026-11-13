// Tests de la lecture des annonces Steam (npm run test:news) : lanceur intégré à Node, aucune dépendance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { cleanRawNews, decodeEntities, excerptOf, frenchPost, frenchTexts, isPatchPost, parseNewsContents, safeUrl, STEAM_FRENCH, toNewsPost, unescapeBrackets } from './newsFormat.ts'

const textOf = (spans: { text: string }[]): string => spans.map((s) => s.text).join('')

test('ancien format : « [ MAPS ] » en intertitre, crochets inconnus gardés, listes imbriquées', () => {
  const blocks = parseNewsContents('[ MAPS ]\n[list]\n[*]Vertigo\n[list][*]Fixed a bug where players could see through walls[/list]\n[*][PC] Ancient: fixed lighting\n[/list]')
  assert.deepEqual(blocks[0], { type: 'heading', level: 3, spans: [{ text: 'MAPS' }] })
  assert.equal(blocks[1].type, 'list')
  if (blocks[1].type !== 'list') return
  assert.equal(blocks[1].ordered, false)
  assert.deepEqual(
    blocks[1].items.map((it) => [textOf(it.spans), it.depth]),
    [
      ['Vertigo', 0],
      ['Fixed a bug where players could see through walls', 1],
      ['[PC] Ancient: fixed lighting', 0]
    ]
  )
  // Un crochet suivi de texte reste du texte.
  assert.deepEqual(parseNewsContents('[PC] Fixed lighting\n[ not a title ] here'), [{ type: 'paragraph', spans: [{ text: '[PC] Fixed lighting\n[ not a title ] here' }] }])
})

test("nouvel éditeur Steam : [p], titres, images, liens, gras", () => {
  const src =
    '[p][img src="{STEAM_CLAN_IMAGE}/45130000/abc123.png"][/img][/p]\n[h2]Patch Notes[/h2][p]Hello [b]soldiers[/b], read the [url="https://www.ea.com/games/battlefield"]full notes[/url].[/p][olist][*][p]First[/p][/*][*][p]Second[/p][/*][/olist][hr][/hr][p]Bye[/p]'
  const blocks = parseNewsContents(src)
  assert.deepEqual(blocks[0], { type: 'image', src: 'https://clan.akamai.steamstatic.com/images/45130000/abc123.png' })
  assert.deepEqual(blocks[1], { type: 'heading', level: 2, spans: [{ text: 'Patch Notes' }] })
  assert.deepEqual(blocks[2], {
    type: 'paragraph',
    spans: [{ text: 'Hello ' }, { text: 'soldiers', bold: true }, { text: ', read the ' }, { text: 'full notes', href: 'https://www.ea.com/games/battlefield' }, { text: '.' }]
  })
  assert.deepEqual(blocks[3], {
    type: 'list',
    ordered: true,
    items: [
      { spans: [{ text: 'First' }], depth: 0 },
      { spans: [{ text: 'Second' }], depth: 0 }
    ]
  })
  assert.deepEqual(blocks[4], { type: 'rule' })
  assert.deepEqual(blocks[5], { type: 'paragraph', spans: [{ text: 'Bye' }] })
  assert.equal(blocks.length, 6)
})

test('paragraphes séparés par une ligne vide, retours à la ligne gardés', () => {
  const blocks = parseNewsContents('Line one\nline two\n\n\n  Next paragraph  ')
  assert.deepEqual(blocks, [
    { type: 'paragraph', spans: [{ text: 'Line one\nline two' }] },
    { type: 'paragraph', spans: [{ text: 'Next paragraph' }] }
  ])
})

test('entités et HTML : décodés en texte, jamais réinterprétés', () => {
  const blocks = parseNewsContents('Tom &amp; Jerry &#39;quoted&#39; &lt;b&gt;not bold&lt;/b&gt;<br>next<i>x</i>')
  assert.deepEqual(blocks, [{ type: 'paragraph', spans: [{ text: "Tom & Jerry 'quoted' <b>not bold</b>\nnextx" }] }])
  assert.equal(decodeEntities('&#x1F3AE; &unknown; &#0;'), '🎮 &unknown; ')
})

test('liens : https seulement, steam://openurl ramené à son adresse', () => {
  assert.equal(safeUrl('javascript:alert(1)'), undefined)
  assert.equal(safeUrl('http://example.com'), undefined)
  assert.equal(safeUrl('steam://openurl/https://store.steampowered.com/app/730'), 'https://store.steampowered.com/app/730')
  assert.equal(safeUrl('"https://a.b/c"'), 'https://a.b/c')
  assert.equal(safeUrl('https://a.b/c d'), undefined)
  const blocks = parseNewsContents('[url=javascript:alert(1)]click[/url] and [url]https://x.example/p[/url]')
  assert.deepEqual(blocks, [{ type: 'paragraph', spans: [{ text: 'click and ' }, { text: 'https://x.example/p', href: 'https://x.example/p' }] }])
})

test('vidéos YouTube en lien, images non https ignorées, contenu brut non lu', () => {
  const blocks = parseNewsContents('[previewyoutube=dQw4w9WgXcQ;full][/previewyoutube][previewyoutube="bad id!"][/previewyoutube][img]http://insecure.example/a.png[/img][noparse][b]raw[/b][/noparse]')
  assert.deepEqual(blocks, [
    { type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    { type: 'paragraph', spans: [{ text: '[b]raw[/b]' }] }
  ])
})

test('tableau : une ligne par paragraphe, en-têtes en gras', () => {
  const blocks = parseNewsContents('[table][tr][th]Weapon[/th][th]Change[/th][/tr][tr][td]M4A1[/td][td]-5% recoil[/td][/tr][/table]')
  assert.deepEqual(blocks, [
    { type: 'paragraph', spans: [{ text: 'Weapon', bold: true }, { text: ' · ' }, { text: 'Change', bold: true }] },
    { type: 'paragraph', spans: [{ text: 'M4A1 · -5% recoil' }] }
  ])
})

test('balises mal fermées et majuscules : le texte reste lisible', () => {
  const blocks = parseNewsContents('[B]bold [I]both[/B] plain[/I] [H3]Title[/h3]')
  assert.equal(blocks[0].type, 'paragraph')
  if (blocks[0].type !== 'paragraph') return
  assert.deepEqual(blocks[0].spans, [
    { text: 'bold ', bold: true },
    { text: 'both', bold: true, italic: true },
    { text: ' plain' }
  ])
  assert.deepEqual(blocks[1], { type: 'heading', level: 3, spans: [{ text: 'Title' }] })
})

test('annonce très longue : coupée sans planter', () => {
  const blocks = parseNewsContents(`[list]${'[*]Fixed something important in the game\n'.repeat(5000)}[/list]${'[p]More text here[/p]'.repeat(3000)}`)
  const size = blocks.reduce((n, b) => n + (b.type === 'list' ? b.items.length * 40 : b.type === 'paragraph' ? 15 : 0), 0)
  assert.ok(blocks.length <= 600)
  assert.ok(size <= 200_000)
})

test('notes de patch : marque Steam ou titre de mise à jour', () => {
  assert.equal(isPatchPost('Counter-Strike 2 Update', ['patchnotes']), true)
  assert.equal(isPatchPost('Battlefield 6 Update 1.1.2.0', []), true)
  assert.equal(isPatchPost('Patch Notes - Season 1', []), true)
  assert.equal(isPatchPost('Hotfixes are live', []), true)
  assert.equal(isPatchPost('Mise à jour 1.3', []), true)
  assert.equal(isPatchPost('Notes de version de la saison 2', []), true)
  assert.equal(isPatchPost('v1.04 is out', []), false)
  assert.equal(isPatchPost('Version 1.04 is out', []), true)
  assert.equal(isPatchPost('Season 2 Roadmap', []), false)
  assert.equal(isPatchPost('Community Update: what is next', []), false)
  assert.equal(isPatchPost('Dispatches from the dev team', []), false)
})

test('extrait : paragraphes et points, sans les titres, coupé à un mot', () => {
  const blocks = parseNewsContents(`[h1]Big title[/h1][p]${'word '.repeat(80)}[/p]`)
  const excerpt = excerptOf(blocks, 50)
  assert.ok(excerpt.endsWith('…'))
  assert.ok(!excerpt.includes('Big title'))
  assert.ok(excerpt.length <= 51)
  assert.equal(excerptOf(parseNewsContents('[h2]Only a title[/h2]')), 'Only a title')
  assert.equal(excerptOf(parseNewsContents('[list][*]One[*]Two[/list]')), 'One Two')
})

test('annonce brute : champs vérifiés, date en millisecondes', () => {
  const ok = cleanRawNews({
    gid: '5124356789012345678',
    title: ' Update 1.2 &amp; more ',
    url: 'https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5124356789012345678',
    author: 'DICE',
    contents: '[p]Hi[/p]',
    date: 1760000000,
    feedname: 'steam_community_announcements',
    tags: ['patchnotes', 3]
  })
  assert.deepEqual(ok, {
    gid: '5124356789012345678',
    title: 'Update 1.2 & more',
    url: 'https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5124356789012345678',
    author: 'DICE',
    contents: '[p]Hi[/p]',
    date: 1_760_000_000_000,
    tags: ['patchnotes']
  })
  assert.equal(cleanRawNews({ ...ok, gid: 'abc', date: 1 }), null)
  assert.equal(cleanRawNews({ gid: '1', title: 'x', url: 'http://insecure', date: 1 }), null)
  assert.equal(cleanRawNews(null), null)
  const post = toNewsPost({ ...ok!, contents: '[img]{STEAM_CLAN_IMAGE}/1/a.jpg[/img][p]Body text[/p]' })
  assert.equal(post.patch, true)
  assert.equal(post.image, 'https://clan.akamai.steamstatic.com/images/1/a.jpg')
  assert.equal(post.excerpt, 'Body text')
  assert.equal(post.id, '5124356789012345678')
})

test('crochets échappés par Steam (Counter-Strike 2) : du texte, jamais une balise, ni une barre oblique affichée', () => {
  const src =
    '[p]\\[ MAPS ][/p][list][*][p]\\[ UI ] Demo/Replay viewer improvements: Added a progress bar[/p][/*][*][p][b]Fixed[/b] a bug where \\[b]tags\\[/b] showed up[/p][/*][/list]' +
    '[p]\\[ MISC ] Read the [url=https://example.com/maps/de_dust2\\[1\\]]map notes[/url] and [url]https://example.com/a\\[2\\][/url][/p]'
  const blocks = parseNewsContents(src)
  assert.deepEqual(blocks[0], { type: 'heading', level: 3, spans: [{ text: 'MAPS' }] })
  assert.deepEqual(blocks[1], {
    type: 'list',
    ordered: false,
    items: [
      { spans: [{ text: '[ UI ] Demo/Replay viewer improvements: Added a progress bar' }], depth: 0 },
      { spans: [{ text: 'Fixed', bold: true }, { text: ' a bug where [b]tags[/b] showed up' }], depth: 0 }
    ]
  })
  assert.deepEqual(blocks[2], {
    type: 'paragraph',
    spans: [
      { text: '[ MISC ] Read the ' },
      { text: 'map notes', href: 'https://example.com/maps/de_dust2[1]' },
      { text: ' and ' },
      { text: 'https://example.com/a[2]', href: 'https://example.com/a[2]' }
    ]
  })
  assert.equal(blocks.length, 3)
  // Ancien format sans [p] : intertitre retrouvé, extrait sans barre oblique.
  const post = toNewsPost({
    gid: '1',
    title: '\\[ PATCH ] Counter-Strike 2 Update',
    url: 'https://store.steampowered.com/news/app/730/view/1',
    contents: '\\[ UI ]\n[list][*]Demo/Replay viewer improvements[/list]\n\\[ MISC ]\n[list][*]Added a ping icon[/list]',
    date: 1_760_000_000_000,
    tags: ['patchnotes']
  })
  assert.deepEqual(
    post.blocks.filter((b) => b.type === 'heading').map((b) => (b.type === 'heading' ? b.spans[0].text : '')),
    ['UI', 'MISC']
  )
  assert.equal(post.excerpt, 'Demo/Replay viewer improvements Added a ping icon')
  assert.equal(cleanRawNews({ gid: '2', title: '\\[ UI ] Fixes', url: 'https://a.b/c', date: 1 })?.title, '[ UI ] Fixes')
  // Une barre oblique devant autre chose reste du texte ; le contenu brut ([noparse]) aussi.
  assert.deepEqual(parseNewsContents('C:\\Games\\CS2 \\* not a list [noparse]\\[raw][/noparse]'), [{ type: 'paragraph', spans: [{ text: 'C:\\Games\\CS2 \\* not a list \\[raw]' }] }])
  assert.equal(unescapeBrackets('\\[x\\] \\y'), '[x] \\y')
})

test('vidéos des annonces d’événement : l’affiche en image, jamais la balise en texte', () => {
  // Forme réelle de l'éditeur de Steam : attributs entre guillemets, noms avec des chiffres (mp4).
  const steam =
    '[video mp4="{STEAM_CLAN_IMAGE}/45/a1.mp4" webm="{STEAM_CLAN_IMAGE}/45/a1.webm" poster="{STEAM_CLAN_IMAGE}/45/a1.png" autoplay="true" controls="false"][/video]\n' +
    '[p]Season 2 starts today.[/p]'
  assert.deepEqual(parseNewsContents(steam), [
    { type: 'image', src: 'https://clan.akamai.steamstatic.com/images/45/a1.png' },
    { type: 'paragraph', spans: [{ text: 'Season 2 starts today.' }] }
  ])
  // Sans guillemets, en majuscules, dans un paragraphe ou un point de liste, ou sans affiche : jamais de texte « [video … ] ».
  for (const src of [
    '[VIDEO MP4=https://x.example/a.mp4 POSTER=https://x.example/a.png][/VIDEO] Live now',
    '[p][video mp4="https://x.example/a.mp4" poster="https://x.example/a.png"][/video]Live now[/p]',
    '[list][*]Live now [video webm="https://x.example/a.webm" poster="https://x.example/a.png"][/video][/list]',
    '[video mp4="https://x.example/a.mp4" webm="https://x.example/a.webm"][/video]Live now'
  ]) {
    const blocks = parseNewsContents(src)
    assert.equal(excerptOf(blocks), 'Live now', src)
    assert.ok(!JSON.stringify(blocks).includes('video'), src)
  }
  // Une affiche non https est ignorée, comme une image.
  assert.deepEqual(parseNewsContents('[video mp4="https://x.example/a.mp4" poster="http://x.example/a.png"][/video]'), [])
  // YouTube dans un point de liste : le lien vient après la liste, l'identifiant n'apparaît pas dans le texte.
  assert.deepEqual(parseNewsContents('[list][*]Trailer [previewyoutube=dQw4w9WgXcQ;full][/previewyoutube][/list]'), [
    { type: 'list', ordered: false, items: [{ spans: [{ text: 'Trailer' }], depth: 0 }] },
    { type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
  ])
})

test('vignette : la première vraie image, sinon l’affiche d’une vidéo', () => {
  const post = (contents: string) => toNewsPost({ gid: '1', title: 'Event', url: 'https://store.steampowered.com/news/app/1/view/1', contents, date: 1, tags: [] })
  const video = '[video mp4="https://x.example/v.mp4" poster="https://x.example/poster.png"][/video]'
  assert.equal(post(`${video}[p]Text[/p]`).image, 'https://x.example/poster.png')
  assert.equal(post(`${video}[p]Text[/p][img src="https://x.example/real.png"][/img]`).image, 'https://x.example/real.png')
  assert.equal(post('[p]Text[/p]').image, undefined)
  assert.equal(post(`${video}[p]Text[/p]`).excerpt, 'Text')
})

// ---------- version française (liste d'événements du magasin, l=french) ----------

const rawEn = (gid: string, title: string, contents: string, date: number, tags: string[] = []) => ({ gid, title, url: `https://store.steampowered.com/news/app/1/view/${gid}`, contents, date, tags })
const event = (body: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ gid: '900', event_name: 'Event name', announcement_body: body, ...extra })

test('frenchTexts : rattachée par news_post_gid, par gid ou par date ; gardée seulement si elle est en français', () => {
  const raw = [
    rawEn('101', 'Patch Notes 1.2', '[p]Fixed crashes.[/p]', 1_700_000_000_000, ['patchnotes']),
    rawEn('102', 'Community Update', '[p]Hello everyone.[/p]', 1_700_000_100_000),
    rawEn('103', 'Season 5', '[p]New maps.[/p]', 1_700_000_200_000)
  ]
  const fr = frenchTexts(raw, [
    // Steam dit « français » : gardée, rattachée par news_post_gid.
    event({ gid: 'x1', headline: 'Notes de patch 1.2', body: '[p]Plantages corrigés.[/p]', posttime: 1_700_000_000, language: STEAM_FRENCH }, { news_post_gid: '101' }),
    // Steam dit « anglais » (pas de traduction) : ignorée.
    event({ gid: '102', headline: 'Community Update', body: '[p]Hello everyone.[/p]', posttime: 1_700_000_100, language: 0 }),
    // Sans champ de langue, rattachée par la date : texte différent de l'anglais, donc gardée.
    event({ gid: 'x3', headline: 'Saison 5', body: '[p]Nouvelles cartes.[/p]', posttime: 1_700_000_200 })
  ])
  assert.deepEqual([...fr.keys()].sort(), ['101', '103'])
  assert.equal(fr.get('101')?.title, 'Notes de patch 1.2')
  assert.equal(fr.get('103')?.contents, '[p]Nouvelles cartes.[/p]')
})

test('frenchTexts : sans langue et identique à l\'anglais, ou réponse inattendue : rien', () => {
  const raw = [rawEn('101', 'Patch Notes 1.2', '[p]Fixed crashes.[/p]', 1_700_000_000_000)]
  assert.equal(frenchTexts(raw, [event({ gid: '101', headline: 'Patch Notes 1.2', body: '[p]Fixed  crashes.[/p]\n', posttime: 1_700_000_000 })]).size, 0)
  assert.equal(frenchTexts(raw, null).size, 0)
  assert.equal(frenchTexts(raw, [null, 3, 'x', { announcement_body: 'x' }, event({ gid: '101', headline: '', body: '' })]).size, 0)
  // Annonce inconnue : rien à rattacher.
  assert.equal(frenchTexts(raw, [event({ gid: '999', headline: 'Autre', body: '[p]Autre.[/p]', posttime: 1, language: STEAM_FRENCH })]).size, 0)
})

test('frenchPost : titre, extrait et texte français ; date, lien et « patch » de l\'annonce d\'origine ; image d\'origine gardée', () => {
  const post = toNewsPost(rawEn('101', 'Patch Notes 1.2', '[img]https://clan.akamai.steamstatic.com/images/1/a.png[/img][p]Fixed crashes.[/p]', 1_700_000_000_000))
  const fr = frenchPost(post, { title: 'Mise à jour du jour', contents: '[p]Plantages corrigés.[/p]' })
  assert.equal(fr.title, 'Mise à jour du jour')
  assert.equal(fr.excerpt, 'Plantages corrigés.')
  assert.equal(fr.patch, post.patch)
  assert.equal(fr.patch, true)
  assert.equal(fr.date, post.date)
  assert.equal(fr.url, post.url)
  assert.equal(fr.image, post.image)
  // Texte français vide après lecture : l'annonce d'origine reste entière.
  assert.equal(frenchPost(post, { title: 'X', contents: '[p][/p]' }), post)
})

