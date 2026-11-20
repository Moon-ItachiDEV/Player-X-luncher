import type { Database, SqlJsStatic } from 'sql.js'

// Reprise de ce qui se lit encore d'une base abîmée (sans Electron ni fichiers, testée par dbSalvage.test.ts), et le schéma de la base.

/** Le schéma de la base : à un seul endroit. Appelée à chaque démarrage, sur une base neuve, reprise ou existante. */
export function ensureSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, store TEXT NOT NULL, store_id TEXT NOT NULL, name TEXT NOT NULL,
      install_dir TEXT, cover_url TEXT, hero_url TEXT, last_played INTEGER, favorite INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS launches (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_launches_game ON launches(game_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_game ON sessions(game_id);
  `)
  // Migrations : colonnes ajoutées après la première version.
  for (const col of ['exe_path TEXT', 'launch_args TEXT', 'work_dir TEXT']) {
    try {
      db.run(`ALTER TABLE games ADD COLUMN ${col}`)
    } catch {
      /* déjà présente */
    }
  }
}

export interface SalvageCounts {
  kv: number
  games: number
  launches: number
  sessions: number
}

type Kind = 'text' | 'int'
/** Chaque colonne : son type attendu et si `null` est permis (comme dans le schéma). */
const SHAPE: Record<keyof SalvageCounts, Record<string, { kind: Kind; nullable: boolean }>> = {
  kv: { key: { kind: 'text', nullable: false }, value: { kind: 'text', nullable: false } },
  games: {
    id: { kind: 'text', nullable: false },
    store: { kind: 'text', nullable: false },
    store_id: { kind: 'text', nullable: false },
    name: { kind: 'text', nullable: false },
    install_dir: { kind: 'text', nullable: true },
    cover_url: { kind: 'text', nullable: true },
    hero_url: { kind: 'text', nullable: true },
    last_played: { kind: 'int', nullable: true },
    favorite: { kind: 'int', nullable: true },
    exe_path: { kind: 'text', nullable: true },
    launch_args: { kind: 'text', nullable: true },
    work_dir: { kind: 'text', nullable: true }
  },
  launches: { id: { kind: 'int', nullable: false }, game_id: { kind: 'text', nullable: false }, at: { kind: 'int', nullable: false } },
  sessions: {
    id: { kind: 'int', nullable: false },
    game_id: { kind: 'text', nullable: false },
    started: { kind: 'int', nullable: false },
    ended: { kind: 'int', nullable: false }
  }
}
/**
 * Au plus tant de lignes par table et par sens de lecture : une base abîmée qui fait relire les mêmes lignes ne doit pas
 * retarder le démarrage de plus de quelques secondes. Les vraies tables sont bien plus petites ; une plus grande garde ses deux bouts.
 */
const MAX_ROWS = 250_000

const fits = (v: unknown, c: { kind: Kind; nullable: boolean }): boolean => (v === null ? c.nullable : c.kind === 'text' ? typeof v === 'string' : typeof v === 'number' && Number.isFinite(v))

/**
 * Reprend table par table ce qui se lit encore dans `bytes`. `reader` ouvre le fichier abîmé (instance jetable, à jeter après) ;
 * `writer` crée la base neuve et saine qu'on garde. Chaque table est lue ligne par ligne jusqu'à la première erreur, puis de
 * la fin vers le début. Aucune autre règle d'arrêt : une règle d'arrêt perd des lignes quand un pointeur abîmé renvoie vers une
 * zone déjà lue ; lire deux fois une table saine coûte peu, et ce chemin ne sert que quand aucun fichier n'est sain.
 * Les lignes aux mauvais types sont écartées. Ne lève jamais ; rend null si rien n'a pu être repris.
 */
export function salvage(reader: SqlJsStatic, writer: SqlJsStatic, bytes: Uint8Array): { db: Database; counts: SalvageCounts } | null {
  let src: Database | null = null
  let out: Database | null = null
  try {
    src = new reader.Database(bytes)
    out = new writer.Database()
    ensureSchema(out)
    const counts: SalvageCounts = { kv: 0, games: 0, launches: 0, sessions: 0 }
    out.run('BEGIN')
    for (const table of Object.keys(SHAPE) as (keyof SalvageCounts)[]) {
      const shape = SHAPE[table]
      let cols: string[]
      try {
        cols = (src.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((r) => String(r[1])).filter((c) => c in shape)
      } catch {
        continue
      }
      if (cols.length === 0) continue
      const ins = out.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      try {
        for (const dir of ['ASC', 'DESC']) {
          let st: ReturnType<Database['prepare']> | null = null
          let n = 0
          try {
            st = src.prepare(`SELECT rowid, ${cols.join(', ')} FROM ${table} ORDER BY rowid ${dir}`)
            while (st.step() && n++ < MAX_ROWS) {
              const row = st.get()
              const rowid = row[0]
              if (typeof rowid !== 'number') break
              const values = row.slice(1)
              if (!values.every((v, i) => fits(v, shape[cols[i]]))) continue
              try {
                ins.run(values)
              } catch {
                continue // ligne refusée par la base neuve : elle ne compte pas
              }
              if (out.getRowsModified() > 0) counts[table]++
            }
          } catch {
            /* page abîmée : on s'arrête là pour ce sens */
          } finally {
            try {
              st?.free()
            } catch {
              /* déjà libérée */
            }
          }
        }
      } finally {
        try {
          ins.free()
        } catch {
          /* déjà libérée */
        }
      }
    }
    out.run('COMMIT')
    if (counts.kv + counts.games + counts.launches + counts.sessions === 0) {
      out.close()
      return null
    }
    return { db: out, counts }
  } catch {
    try {
      out?.close()
    } catch {
      /* rien à fermer */
    }
    return null
  } finally {
    try {
      src?.close()
    } catch {
      /* rien à fermer */
    }
  }
}
