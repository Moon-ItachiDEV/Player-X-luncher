// Suite du pont : amis et membres du serveur, carnet de loadouts, profil, comptes, bilans.
;(() => {
  const T = Shared.text, FV = Shared.friendView, st = Real.st
  const PLATFORM = { steam: 'Steam', discord: 'Discord', psn: 'PlayStation' }
  const safe = (p, fb) => Promise.resolve(p).catch((e) => { console.error(e); return fb })

  /* ---------- Amis : mêmes règles que la vraie page (un membre Discord n'est en jeu que sur un jeu de ta bibliothèque) ---------- */
  // Toutes les minutes, la même liste revient le plus souvent : rien n'est redessiné si ce qui s'affiche n'a pas changé
  // (amis, statuts, jeux, vocal, « vu il y a », erreurs des comptes : la réponse entière et ce qu'on en tire)
  let shownSig = ''
  function applyFriends(res) {
    st.friendsRes = res
    const lib = FV.libraryIndex([...st.raw, ...st.owned])
    const channels = new Map((res.discordChannels || []).map((c) => [c.id, c.name]))
    const list = res.friends.map((f) => FV.classify(f, lib)).sort(FV.byStatus).map((e) => {
      const f = e.friend, g = e.lib ? Real.byRid(e.lib.id) : null
      return {
        id: f.id, n: f.name, hue: T.hue(f.name), avatar: f.avatarUrl || null,
        st: e.status === 'in-game' ? 'game' : e.status, on: PLATFORM[f.platform], member: f.platform === 'discord',
        game: g?.id || null, gameName: e.game || null, activity: e.activity || null, device: f.device || null,
        seen: FV.lastSeenLabel(f.lastSeen), since: FV.friendSinceLabel(f.since),
        voice: f.voice ? channels.get(f.voice.channelId) || 'Salon vocal' : null, voiceId: f.voice?.channelId || null, join: !!f.joinable, raw: f
      }
    })
    const sig = JSON.stringify([res, list.map(({ raw, ...x }) => x)])
    if (sig === shownSig) return
    shownSig = sig
    FRIENDS.splice(0, FRIENDS.length, ...list)
    VOICE.splice(0, VOICE.length, ...Shared.voice.voiceRooms(res.discordChannels, FRIENDS, (x) => x.raw).map((r) => ({ id: r.channel.id, name: r.channel.name, people: r.people })))
    if (!FRIENDS.some((f) => f.id === S.friend)) S.friend = FV.pickDefault(FRIENDS.map((f) => ({ friend: f.raw, status: f.raw.status })))?.friend.id || null
    Real.applyGames()
    Real.emit('friends')
  }
  async function loadFriends() {
    if (loadFriends.busy) return
    loadFriends.busy = true
    try { applyFriends(await API.getFriends()) } catch (e) { console.error(e) } finally { loadFriends.busy = false }
  }
  // La vraie appli relit toutes les minutes : les amis bougent, pas besoin de plus
  function startFriends() {
    loadFriends()
    setInterval(() => { if (!document.hidden) loadFriends() }, 60000)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadFriends() })
  }

  /* ---------- Profil Steam d'un ami : lu à la demande, gardé 5 minutes ---------- */
  const profs = new Map()
  async function friendProfile(id) {
    if (!/^steam:\d{17}$/.test(id || '')) return null
    const hit = profs.get(id)
    if (hit && Date.now() - hit.at < 300000) return hit.p
    const p = await safe(API.getFriendProfile(id), null)
    profs.set(id, { at: Date.now(), p })
    return p
  }
  const cachedProfile = (id) => profs.get(id)?.p
  // « Préviens-moi quand il lance un jeu » : la liste est gardée dans les réglages, l'alerte part du moteur
  const watched = (id) => (st.settings?.friendWatch || []).includes(id)
  async function setWatch(id, on) {
    const l = new Set(st.settings?.friendWatch || [])
    on ? l.add(id) : l.delete(id)
    await Real.saveSettings({ friendWatch: [...l] })
  }

  /* ---------- Loadouts : le vrai carnet, gardé sur ce PC ---------- */
  const CAT_FR = Shared.armoryLabels.CATEGORY_LABEL
  const CAT_KEY = Object.fromEntries(Object.entries(CAT_FR).map(([k, v]) => [v, k]))
  const GEAR = ['secondary', 'gadget1', 'gadget2', 'grenade', 'melee', 'training']
  const toUi = (l) => ({
    id: l.id, tier: l.tier || undefined, w: l.weapon, img: WEAPON_IMG[l.weapon] || null, cat: l.cat ? CAT_FR[l.cat] : '', cls: l.cls, name: l.name, ctx: l.context || undefined,
    parts: Object.fromEntries(Object.entries(l.parts || {}).map(([s, p]) => [s, [p.name, p.pts]])),
    gear: Object.fromEntries(GEAR.filter((k) => l[k]).map((k) => [k, l[k]])), notes: l.notes || undefined, armoryId: l.armoryId, updatedAt: l.updatedAt
  })
  const toReal = (b) => ({
    id: b.id, name: b.name, cls: b.cls, weapon: b.w, ...(b.ctx ? { context: b.ctx } : {}), ...(CAT_KEY[b.cat] ? { cat: CAT_KEY[b.cat] } : {}), ...(b.tier ? { tier: b.tier } : {}), ...(b.armoryId ? { armoryId: b.armoryId } : {}),
    parts: Object.fromEntries(Object.entries(b.parts).map(([s, p]) => [s, p[1] == null ? { name: p[0] } : { name: p[0], pts: p[1] }])),
    ...Object.fromEntries(GEAR.filter((k) => b.gear?.[k]).map((k) => [k, b.gear[k]])), ...(b.notes ? { notes: b.notes } : {})
  })
  const setBuilds = (list) => { BUILDS.splice(0, BUILDS.length, ...list.map(toUi)); return BUILDS }
  async function loadLoadouts() {
    const [list, mine] = await Promise.all([safe(API.getBf6Loadouts(), []), safe(API.getMyBf6Weapons(), [])])
    setBuilds(list); st.myWeapons = mine
  }
  // Les builds conseillés (relevés en jeu) arrivent tout seuls dans le carnet, une seule fois chacun :
  // un build que tu supprimes ne revient pas, un build que tu modifies reste le tien.
  const SEEDED = 'pxv3-reco-ajoutes'
  async function seedReco() {
    if (typeof BF6_RECO === 'undefined') return 0
    let done = []
    try { done = JSON.parse(localStorage.getItem(SEEDED) || '[]') } catch { done = [] }
    const key = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const CLS = { 'Mitraillette': 'engineer', 'Mitrailleuse légère': 'support', 'Fusil de précision': 'recon', 'Fusil de tireur d’élite': 'recon' }
    let n = 0
    for (const [w, list] of Object.entries(BF6_RECO)) {
      // La catégorie vient du catalogue des accessoires, sinon de la liste des armes (les fusils de précision n'ont pas encore leurs accessoires)
      const a = BF6_ARMORY.find((x) => key(x.n) === key(w)) || (typeof BF6_WEAPONS !== 'undefined' ? BF6_WEAPONS.find((x) => key(x.n) === key(w)) : null), cat = a?.c || ''
      for (const r of list) {
        if (done.includes(r.id)) continue
        const name = (r.title || r.name).slice(0, 40)
        // Déjà dans ton carnet, sous ce nom ou avec exactement les mêmes accessoires : on ne le double pas
        const same = (b) => key(b.w) === key(w) && (b.name === name || (Object.keys(b.parts).length === Object.keys(r.parts).length && Object.entries(r.parts).every(([sl, p]) => key(b.parts[sl]?.[0]) === key(p[0]))))
        if (!BUILDS.some(same)) {
          try { await saveLoadout({ w, name, cat, cls: CLS[cat] || 'assault', parts: r.parts, gear: {} }); n++ } catch (e) { console.error(e); continue }
        }
        done.push(r.id)
      }
    }
    try { localStorage.setItem(SEEDED, JSON.stringify(done)) } catch { /* stockage indisponible : on réessaiera au prochain lancement */ }
    return n
  }
  // Renvoie le loadout enregistré : le carnet le remet toujours en tête
  async function saveLoadout(b) {
    setBuilds(await API.saveBf6Loadout(toReal(b)))
    st.myWeapons = await safe(API.getMyBf6Weapons(), st.myWeapons)
    Real.applyGames()
    return BUILDS[0]
  }
  async function deleteLoadout(id) { setBuilds(await API.deleteBf6Loadout(id)); Real.applyGames() }
  const templates = () => Shared.workshop.BUILD_TEMPLATES
  const templateBuilds = () => templates().map((t) => toUi({ ...t.loadout, id: t.id }))
  async function addTemplates() {
    setBuilds(await API.saveBf6Loadouts(templates().map((t) => t.loadout)))
    st.myWeapons = await safe(API.getMyBf6Weapons(), st.myWeapons)
    Real.applyGames()
  }

  /* ---------- Profil ---------- */
  function me() {
    const s = st.settings || {}, id = Shared.profile.identity(st.accounts || [], s)
    return { name: id.name, avatar: id.avatarUrl || null }
  }

  /* ---------- Ce que la vraie appli sait de BF6 quand le jeu n'est pas installé ---------- */
  async function loadArt() { st.bf6Art = await safe(API.bf6Art(), {}) }
  // Stats : BF6 reste consultable sans le jeu sur ce PC, avec le visuel du catalogue Steam
  function statGame(id) {
    const g = G(id)
    if (g) return g
    const name = id === 'bf6' ? 'Battlefield 6' : 'Counter-Strike 2', art = id === 'bf6' ? st.bf6Art || {} : {}
    return { id, rid: null, name, short: id === 'bf6' ? 'BF6' : 'CS2', cover: art.coverUrl || Real.coverPh(name), hero: art.heroUrl || null, heroWide: art.heroUrl || null, pal: Real.palOf(name), absent: true }
  }

  /* ---------- Démarrage de cette partie ---------- */
  async function initExtras() {
    await Promise.all([loadLoadouts(), loadArt(), safe(API.bf6GetTracked(), { me: null, rivals: [] }).then((x) => { st.tracked = x })])
    if (!Real.st.settings?.demoMode) await safe(seedReco(), 0)
    Real.applyGames()
  }
  Object.assign(Real, { startFriends, loadFriends, applyFriends, friendProfile, cachedProfile, watched, setWatch, loadLoadouts, saveLoadout, deleteLoadout, templates, templateBuilds, addTemplates, me, statGame, initExtras, setHidden: async (rid, on) => { st.shelves = await API.setGameHidden(rid, on); Real.applyGames(); Real.emit('games') } })
})()
