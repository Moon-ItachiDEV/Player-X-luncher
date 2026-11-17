// Tests de la reprise d'une base abîmée, avec le vrai sql.js (npm run test:garde).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
// @ts-ignore TS5097
import { ensureSchema, salvage } from './dbSalvage.ts'

const WASM = join(import.meta.dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm')
const load = () => initSqlJs({ locateFile: () => WASM })

/** Générateur à graine fixe (mulberry32) : les dégâts sont les mêmes à chaque lancement. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const N = { kv: 100, games: 2000, launches: 800, sessions: 800 }
type Db = import('sql.js').Database
function fill(d: Db): void {
  d.run('BEGIN')
  for (let i = 0; i < N.kv; i++) d.run('INSERT INTO kv VALUES (?,?)', [`cle:${i}`, JSON.stringify({ i, t: 'é'.repeat((i % 20) * 10) })])
  for (let i = 0; i < N.games; i++) d.run('INSERT INTO games (id, store, store_id, name, install_dir, last_played, favorite, exe_path) VALUES (?,?,?,?,?,?,?,?)', [`steam:${i}`, 'steam', String(i), `Jeu ${i} ${'x'.repeat(40)}`, `C:\\Jeux\\${i}`, 1700000000000 + i, i % 5 ? 0 : 1, null])
  for (let i = 0; i < N.launches; i++) d.run('INSERT INTO launches (game_id, at) VALUES (?,?)', [`steam:${i % 50}`, 1700000000000 + i])
  for (let i = 0; i < N.sessions; i++) d.run('INSERT INTO sessions (game_id, started, ended) VALUES (?,?,?)', [`steam:${i % 50}`, 1700000000000 + i, 1700000000900 + i])
  d.run('COMMIT')
}
async function goodBase() {
  const SQL = await load()
  const d = new SQL.Database()
  ensureSchema(d)
  fill(d)
  const bytes = Buffer.from(d.export())
  d.close()
  return { SQL, bytes }
}
const checkOk = (d: Db): boolean => {
  const v = d.exec('PRAGMA quick_check')[0].values
  return v.length === 1 && v[0][0] === 'ok'
}
const count = (d: Db, t: string): number => d.exec(`SELECT count(*) FROM ${t}`)[0].values[0][0] as number
const damage = (bytes: Buffer, page: number, rnd: () => number): Buffer => {
  const junk = Buffer.alloc(4096)
  for (let i = 0; i < junk.length; i++) junk[i] = Math.floor(rnd() * 256)
  return Buffer.concat([bytes.subarray(0, page * 4096), junk, bytes.subarray((page + 1) * 4096)])
}

test('reprise : une base saine est reprise en entier', async () => {
  const { SQL, bytes } = await goodBase()
  const r = salvage(await load(), SQL, bytes)
  assert.ok(r)
  assert.deepEqual(r.counts, N)
  assert.ok(checkOk(r.db))
  assert.equal(count(r.db, 'games'), N.games)
  r.db.close()
})

test('reprise : une page abîmée au milieu d’une grosse table, les autres tables entières, celle-là reprise des deux bouts', async () => {
  const { SQL, bytes } = await goodBase()
  const rnd = seeded(7)
  let found = 0
  for (let p = 1; p < bytes.length / 4096; p++) {
    const bad = damage(bytes, p, rnd)
    const r = salvage(await load(), SQL, bad)
    if (!r || r.counts.games === N.games || r.counts.games === 0) { r?.db.close(); continue }
    if (r.counts.kv === N.kv && r.counts.launches === N.launches && r.counts.sessions === N.sessions) {
      assert.ok(checkOk(r.db))
      const has = (id: string): boolean => (r.db.exec('SELECT 1 FROM games WHERE id = ?', [id])[0]?.values.length ?? 0) === 1
      // Une page au milieu : le début et la fin sont repris, seul le trou manque.
      if (has('steam:0') && has(`steam:${N.games - 1}`)) found++
    }
    r.db.close()
  }
  assert.ok(found >= 1, 'aucune page ne donne une reprise partielle des jeux')
})

test('reprise : octets au hasard, fichier vide, rien de lisible : null', async () => {
  const { SQL } = await goodBase()
  const rnd = seeded(3)
  const junk = Buffer.alloc(50000)
  for (let i = 0; i < junk.length; i++) junk[i] = Math.floor(rnd() * 256)
  assert.equal(salvage(await load(), SQL, junk), null)
  assert.equal(salvage(await load(), SQL, Buffer.alloc(0)), null)
  const other = new SQL.Database()
  other.run("CREATE TABLE autre (a TEXT); INSERT INTO autre VALUES ('x')")
  assert.equal(salvage(await load(), SQL, other.export()), null)
  other.close()
})

test('reprise : un ancien schéma sans exe_path', async () => {
  const SQL = await load()
  const old = new SQL.Database()
  old.run(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE games (id TEXT PRIMARY KEY, store TEXT NOT NULL, store_id TEXT NOT NULL, name TEXT NOT NULL, install_dir TEXT, cover_url TEXT, hero_url TEXT, last_played INTEGER, favorite INTEGER DEFAULT 0);
    INSERT INTO kv VALUES ('a', 'b');
    INSERT INTO games (id, store, store_id, name) VALUES ('steam:1', 'steam', '1', 'Jeu');`)
  const r = salvage(await load(), SQL, old.export())
  old.close()
  assert.ok(r)
  assert.deepEqual(r.counts, { kv: 1, games: 1, launches: 0, sessions: 0 })
  assert.equal(r.db.exec("SELECT exe_path FROM games WHERE id = 'steam:1'")[0].values[0][0], null)
  assert.ok(checkOk(r.db))
  r.db.close()
})

test('reprise : les lignes aux mauvais types sont écartées', async () => {
  const SQL = await load()
  const loose = new SQL.Database()
  loose.run(`CREATE TABLE kv (key, value); CREATE TABLE games (id, store, store_id, name, last_played, favorite); CREATE TABLE launches (id INTEGER PRIMARY KEY, game_id, at);
    INSERT INTO kv VALUES ('bon', 'v'); INSERT INTO kv VALUES (1, 'nombre en clé'); INSERT INTO kv VALUES ('nul', NULL); INSERT INTO kv VALUES ('nombre', 5);
    INSERT INTO games VALUES ('g1', 's', '1', 'Jeu', 1700000000000, 0); INSERT INTO games VALUES ('g2', 's', '2', 'Jeu', 'hier', 0); INSERT INTO games VALUES ('g3', 's', '3', NULL, NULL, NULL);
    INSERT INTO launches VALUES (1, 'g1', 5); INSERT INTO launches VALUES (2, 'g1', 'tard'); INSERT INTO launches VALUES (3, NULL, 7);`)
  const r = salvage(await load(), SQL, loose.export())
  loose.close()
  assert.ok(r)
  assert.deepEqual(r.counts, { kv: 1, games: 1, launches: 1, sessions: 0 })
  r.db.close()
})

test('reprise : 150 dégâts au hasard (graine fixe), ne lève jamais, résultat sain, l’instance d’écriture marche encore', async () => {
  const { SQL, bytes } = await goodBase()
  const rnd = seeded(42)
  const pages = bytes.length / 4096
  const rn = (n: number): number => Math.floor(rnd() * n)
  let some = 0
  let none = 0
  for (let i = 0; i < 150; i++) {
    let b: Buffer = Buffer.from(bytes)
    const kind = i % 5
    if (kind === 0) for (let k = 0; k < 1 + rn(4); k++) b = damage(b, rn(pages), rnd)
    else if (kind === 1) b = b.subarray(0, rn(b.length))
    else if (kind === 2) for (let k = 0; k < 1 + rn(200); k++) b[rn(b.length)] ^= 1 << rn(8)
    else if (kind === 3) b.fill(0, rn(b.length), Math.min(b.length, rn(b.length) + rn(20000)))
    else for (let k = 0; k < 1 + rn(60); k++) b[rn(100)] = rn(256)
    const r = salvage(await load(), SQL, b)
    if (r) {
      some++
      assert.ok(checkOk(r.db), `dégât ${i} : résultat abîmé`)
      r.db.close()
    } else none++
    const probe = new SQL.Database()
    probe.run('CREATE TABLE t (a); INSERT INTO t VALUES (1)')
    assert.equal(probe.exec('SELECT a FROM t')[0].values[0][0], 1, `dégât ${i} : l’instance d’écriture est morte`)
    probe.close()
  }
  assert.equal(some + none, 150)
})

/** Lit un varint SQLite : [valeur, longueur]. */
const varint = (b: Uint8Array, o: number): [number, number] => {
  let v = 0
  for (let i = 0; i < 8; i++) {
    v = v * 128 + (b[o + i] & 0x7f)
    if (!(b[o + i] & 0x80)) return [v, i + 1]
  }
  return [v * 256 + b[o + 8], 9]
}

test('reprise : un rowid grossi dans la dernière cellule d’une feuille, la feuille suivante abîmée : la fin de la table est reprise', async () => {
  const SQL = await load()
  const d = new SQL.Database()
  ensureSchema(d)
  d.run('BEGIN')
  for (let i = 0; i < 3; i++) d.run('INSERT INTO kv VALUES (?,?)', [`cle:${i}`, `valeur ${i}`])
  for (let i = 0; i < 2000; i++) d.run('INSERT INTO sessions (game_id, started, ended) VALUES (?,?,?)', [`steam:${i % 50}`, 1700000000000 + i, 1700000000900 + i])
  d.run('COMMIT')
  const good = Buffer.from(d.export())
  d.close()
  // Les feuilles de table (premier octet 0x0d), avec le rowid de leur première et de leur dernière cellule
  const leaves: { p: number; n: number; first: number; last: number; lastAt: number; lastLen: number }[] = []
  for (let p = 1; p < good.length / 4096; p++) {
    const o = p * 4096
    if (good[o] !== 0x0d) continue
    const n = good.readUInt16BE(o + 3)
    const rowid = (k: number): { v: number; at: number; len: number } => {
      const cell = o + good.readUInt16BE(o + 8 + 2 * k)
      const [, l1] = varint(good, cell)
      const [v, len] = varint(good, cell + l1)
      return { v, at: cell + l1, len }
    }
    if (n) leaves.push({ p, n, first: rowid(0).v, last: rowid(n - 1).v, lastAt: rowid(n - 1).at, lastLen: rowid(n - 1).len })
  }
  const sessions = leaves.filter((l) => l.first > 100 && l.last - l.first === l.n - 1)
  const mid = sessions.find((l) => l.last >= 300 && l.last <= 900 && l.lastLen === 2)
  assert.ok(mid, 'feuille « mid » introuvable')
  const next = sessions.find((l) => l.first === mid.last + 1)
  assert.ok(next, 'feuille « next » introuvable')
  const bad = Buffer.from(good)
  bad[mid.lastAt] |= 0x40 // un bit de plus : le rowid grossit de 8 192
  assert.equal(varint(bad, mid.lastAt)[0], mid.last + 8192)
  damage(bad, next.p, seeded(11)).copy(bad)
  const r = salvage(await load(), SQL, new Uint8Array(bad))
  assert.ok(r)
  assert.equal(count(r.db, 'kv'), 3)
  const got = count(r.db, 'sessions')
  assert.ok(got >= 2000 - next.n - 1, `sessions reprises : ${got} sur 2000 (au moins ${2000 - next.n - 1} attendues, la feuille abîmée a ${next.n} lignes)`)
  assert.ok(checkOk(r.db))
  assert.equal(r.db.exec('SELECT count(*) FROM sessions WHERE id = 2000')[0].values[0][0], 1, 'la dernière ligne de la table est là')
  r.db.close()
})

/** La base des tests de pointeurs : 3 lignes dans `kv`, 2 000 dans `sessions`, dont on lit la page racine (page interne). */
async function sessionsBase() {
  const SQL = await load()
  const d = new SQL.Database()
  ensureSchema(d)
  d.run('BEGIN')
  for (let i = 0; i < 3; i++) d.run('INSERT INTO kv VALUES (?,?)', [`cle:${i}`, `valeur ${i}`])
  for (let i = 0; i < 2000; i++) d.run('INSERT INTO sessions (game_id, started, ended) VALUES (?,?,?)', [`steam:${i % 50}`, 1700000000000 + i, 1700000000900 + i])
  d.run('COMMIT')
  const root = d.exec("SELECT rootpage FROM sqlite_master WHERE name = 'sessions'")[0].values[0][0] as number
  const good = Buffer.from(d.export())
  d.close()
  const at = (root - 1) * 4096
  assert.equal(good[at], 0x05, 'la racine de sessions doit être une page interne')
  const cells = good.readUInt16BE(at + 3)
  assert.ok(cells >= 6, 'il faut au moins 6 cellules')
  const cell = (k: number): number => at + good.readUInt16BE(at + 12 + 2 * k)
  /** Numéro de page de la feuille de la cellule k, et son nombre de lignes. */
  const leaf = (k: number): { page: number; rows: number } => {
    const page = good.readUInt32BE(cell(k))
    return { page, rows: good.readUInt16BE((page - 1) * 4096 + 3) }
  }
  const redirect = (b: Buffer, k: number, to: number): void => {
    b.writeUInt32BE(to, cell(k))
  }
  return { SQL, good, leaf, redirect }
}

test('reprise : deux pointeurs d’une page interne redirigés vers la première feuille : seules les deux feuilles perdues manquent', async () => {
  const { SQL, good, leaf, redirect } = await sessionsBase()
  const bad = Buffer.from(good)
  const first = leaf(0).page
  const lost = leaf(2).rows + leaf(5).rows
  redirect(bad, 2, first)
  redirect(bad, 5, first)
  const r = salvage(await load(), SQL, new Uint8Array(bad))
  assert.ok(r)
  assert.equal(count(r.db, 'kv'), 3)
  assert.equal(count(r.db, 'sessions'), 2000 - lost, `sessions reprises : ${count(r.db, 'sessions')} sur 2000 (${lost} perdues attendues)`)
  assert.ok(checkOk(r.db))
  r.db.close()
})

test('reprise : une feuille abîmée, puis un pointeur redirigé vers la première feuille : le reste est repris par l’autre sens', async () => {
  const { SQL, good, leaf, redirect } = await sessionsBase()
  const bad = damage(good, leaf(2).page - 1, seeded(5))
  redirect(bad, 5, leaf(0).page)
  const lost = leaf(2).rows + leaf(5).rows
  const r = salvage(await load(), SQL, new Uint8Array(bad))
  assert.ok(r)
  assert.equal(count(r.db, 'kv'), 3)
  const got = count(r.db, 'sessions')
  assert.ok(got >= 2000 - lost, `sessions reprises : ${got} sur 2000 (au moins ${2000 - lost} attendues)`)
  assert.ok(checkOk(r.db))
  assert.equal(r.db.exec('SELECT count(*) FROM sessions WHERE id = 2000')[0].values[0][0], 1, 'la dernière ligne de la table est là')
  r.db.close()
})
