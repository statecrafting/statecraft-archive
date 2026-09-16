/**
 * SQLite schema migrations for session memory (NF-001).
 */

export interface Migration {
  version: number;
  description: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial memory entries table",
    up: `
      CREATE TABLE IF NOT EXISTS memory_entries (
        id            TEXT PRIMARY KEY,
        content       TEXT NOT NULL,
        kind          TEXT NOT NULL CHECK (kind IN ('decision', 'correction', 'pattern', 'note', 'preference')),
        importance    TEXT NOT NULL CHECK (importance IN ('ephemeral', 'short-term', 'medium-term', 'long-term', 'permanent')),
        expires_at    INTEGER,
        project_scope TEXT NOT NULL,
        tags          TEXT NOT NULL DEFAULT '[]',
        source_session_id TEXT NOT NULL,
        access_count  INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_project_scope ON memory_entries (project_scope);
      CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory_entries (kind);
      CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_entries (importance);
      CREATE INDEX IF NOT EXISTS idx_memory_expires_at ON memory_entries (expires_at);
      CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory_entries (created_at DESC);

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
      INSERT INTO schema_version (version) VALUES (1);
    `,
  },
  {
    version: 2,
    description: "Provenance + trust class columns (spec 204 FR-002 / FR-003)",
    // Additive. New columns carry constant defaults so ADD COLUMN is legal on
    // an existing table. Enum validity (actor_kind, trust_class) is enforced at
    // write time by `MemoryStorage.store` and by the TypeScript types, rather
    // than by SQLite CHECK constraints, so the storage layer stays the single
    // validation authority. `applyMigrations` runs this whole block in a
    // transaction, so a crash mid-migration rolls back (ADD COLUMN is not
    // idempotent and would otherwise brick the DB on retry). Existing rows get
    // content_hash='' and are backfilled with a real hash by MemoryStorage on
    // open; the partial index makes that backfill probe O(1) once it converges.
    up: `
      ALTER TABLE memory_entries ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'agent';
      ALTER TABLE memory_entries ADD COLUMN source_attribution TEXT;
      ALTER TABLE memory_entries ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
      ALTER TABLE memory_entries ADD COLUMN trust_class TEXT NOT NULL DEFAULT 'machine-harvested';

      CREATE INDEX IF NOT EXISTS idx_memory_trust_class ON memory_entries (trust_class);
      CREATE INDEX IF NOT EXISTS idx_memory_source_session ON memory_entries (source_session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_unhashed ON memory_entries (content_hash) WHERE content_hash = '';

      INSERT INTO schema_version (version) VALUES (2);
    `,
  },
  {
    version: 3,
    description: "Quarantine flag for session-scoped bulk revocation (spec 204 FR-006)",
    // Additive. `quarantined` marks entries excluded from all reads pending
    // human review (a poisoned session's writes are enumerable and
    // bulk-revocable). Runs in a transaction like every migration.
    up: `
      ALTER TABLE memory_entries ADD COLUMN quarantined INTEGER NOT NULL DEFAULT 0;

      -- Composite so the read filter (project_scope = ? AND quarantined = 0) is
      -- index-served; a standalone boolean index would be near-useless.
      CREATE INDEX IF NOT EXISTS idx_memory_scope_quarantined ON memory_entries (project_scope, quarantined);

      INSERT INTO schema_version (version) VALUES (3);
    `,
  },
];

export function getCurrentVersion(db: { prepare: (sql: string) => { get: () => { version: number } | undefined } }): number {
  try {
    const row = db.prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get();
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

interface MigrationDb {
  exec: (sql: string) => void;
  prepare: (sql: string) => { get: () => { version: number } | undefined };
  transaction: (fn: () => void) => () => void;
}

export function applyMigrations(db: MigrationDb): void {
  const current = getCurrentVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      // Run each migration atomically: schema changes + the schema_version
      // bump commit together or not at all. ALTER TABLE ADD COLUMN is not
      // idempotent, so a crash between statements would otherwise leave a
      // half-migrated table that throws "duplicate column" on every retry.
      db.transaction(() => db.exec(migration.up))();
    }
  }
}
