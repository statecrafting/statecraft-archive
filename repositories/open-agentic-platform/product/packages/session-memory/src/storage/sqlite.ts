/**
 * SQLite storage layer for session memory (NF-001).
 *
 * Provides CRUD operations over a project-scoped SQLite database.
 * Each project gets its own .session-memory/memory.db file at the project root.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type {
  ActorKind,
  ImportanceLevel,
  ListMemoryInput,
  MemoryEntry,
  MemoryKind,
  QueryMemoryInput,
  StoreMemoryInput,
  TrustClass,
} from "../types.js";
import {
  EXPIRY_DEFAULTS,
  MACHINE_HARVESTED_CEILING,
  isHumanTrusted,
  requiresHumanTrust,
} from "../types.js";
import { MemoryWriteRefused, runMemoryStoreGate } from "../gate.js";
import { applyMigrations } from "./migrations.js";

/** Row shape returned from SQLite (snake_case). */
interface MemoryRow {
  id: string;
  content: string;
  kind: string;
  importance: string;
  expires_at: number | null;
  project_scope: string;
  tags: string;
  source_session_id: string;
  access_count: number;
  created_at: number;
  updated_at: number;
  actor_kind: string;
  source_attribution: string | null;
  content_hash: string;
  trust_class: string;
  quarantined: number;
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    content: row.content,
    kind: row.kind as MemoryKind,
    importance: row.importance as ImportanceLevel,
    expiresAt: row.expires_at,
    projectScope: row.project_scope,
    tags: JSON.parse(row.tags) as string[],
    sourceSessionId: row.source_session_id,
    accessCount: row.access_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    actorKind: row.actor_kind as ActorKind,
    sourceAttribution: row.source_attribution,
    contentHash: row.content_hash,
    trustClass: row.trust_class as TrustClass,
    quarantined: row.quarantined !== 0,
  };
}

/** SHA-256 hex of content (FR-002 content hash). */
function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Actor kinds accepted at the storage boundary (runtime guard; enum validity
 * is not a SQLite CHECK constraint, so the storage layer enforces it). */
const VALID_ACTOR_KINDS: ReadonlySet<string> = new Set([
  "human",
  "agent",
  "harvester",
]);

/** Resolve the database path for a project. */
export function dbPath(projectScope: string): string {
  return join(projectScope, ".session-memory", "memory.db");
}

export class MemoryStorage {
  private db: Database.Database;

  constructor(databasePath: string) {
    mkdirSync(join(databasePath, ".."), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    applyMigrations(this.db);
    this.backfillContentHashes();
  }

  /**
   * FR-002: rows written before the provenance migration (v2) carry an empty
   * content_hash. Compute the real SHA-256 for them once, on open. New writes
   * always stamp a hash, so this converges to a no-op.
   */
  private backfillContentHashes(): void {
    const rows = this.db
      .prepare("SELECT id, content FROM memory_entries WHERE content_hash = ''")
      .all() as Array<{ id: string; content: string }>;
    if (rows.length === 0) return;
    const update = this.db.prepare(
      "UPDATE memory_entries SET content_hash = ? WHERE id = ?",
    );
    this.db.transaction(() => {
      for (const row of rows) {
        update.run(hashContent(row.content), row.id);
      }
    })();
  }

  /** Create from a project root path (convenience). */
  static forProject(projectScope: string): MemoryStorage {
    return new MemoryStorage(dbPath(projectScope));
  }

  /** Store a new memory entry (FR-001 memory_store). */
  store(input: StoreMemoryInput): MemoryEntry {
    // Spec 204 FR-001: the deterministic write gate refuses carrier-class,
    // secret, and oversized content on every write path (this is the single
    // persistence chokepoint, so a harvested-signal write routed through
    // store() is gated identically to an explicit memory_store). Content and
    // tags are both gated: both are persisted and re-injected into later
    // sessions' prompts. Fail-closed with an attributable rule id.
    const verdict = runMemoryStoreGate(input.content, input.tags);
    if (!verdict.ok) {
      throw new MemoryWriteRefused(verdict.ruleId, verdict.detail);
    }

    const now = Math.floor(Date.now() / 1000);

    // storage.store is the TRUSTED write API. `actorKind` is set by trusted
    // callers only: the harvester (`harvester`), a cockpit human action
    // (`human`), or it defaults to `agent`. The untrusted MCP `memory_store`
    // tool does NOT expose actorKind, so an agent cannot self-assert `human`
    // to launder its output to a higher trust class (FR-005). The trust class
    // is derived from the actor: only `human` yields human-curated;
    // `agent`/`harvester` are always machine-harvested. `verified` is reachable
    // only through an explicit human verify action (markVerified, a trusted
    // storage method never exposed via MCP).
    const actorKind: ActorKind = input.actorKind ?? "agent";
    if (!VALID_ACTOR_KINDS.has(actorKind)) {
      throw new Error(`invalid actorKind: ${JSON.stringify(actorKind)}`);
    }
    const trustClass: TrustClass =
      actorKind === "human" ? "human-curated" : "machine-harvested";

    // FR-003 AC-3 retention boundary enforced at the WRITE path, not just at
    // promotion: a machine-harvested write is clamped to the machine-harvested
    // ceiling. This closes the write-time bypass, including the untrusted MCP
    // `importance` input AND the harvester's builtin rules that request
    // permanent/long-term. Reaching a human-gated tier requires human-curated
    // or verified trust (or an explicit human verify + promotion afterward).
    const requested = input.importance ?? "medium-term";
    const importance: ImportanceLevel =
      !isHumanTrusted(trustClass) && requiresHumanTrust(requested)
        ? MACHINE_HARVESTED_CEILING
        : requested;
    const expiryDelta = EXPIRY_DEFAULTS[importance];
    const expiresAt = expiryDelta === null ? null : now + expiryDelta;

    const entry: MemoryEntry = {
      id: randomUUID(),
      content: input.content,
      kind: input.kind,
      importance,
      expiresAt,
      projectScope: input.projectScope ?? "",
      tags: input.tags ?? [],
      sourceSessionId: input.sourceSessionId ?? "",
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
      actorKind,
      sourceAttribution: input.sourceAttribution ?? null,
      contentHash: hashContent(input.content),
      trustClass,
      // New entries are never quarantined; the column default (0) matches.
      quarantined: false,
    };

    this.db.prepare(`
      INSERT INTO memory_entries (id, content, kind, importance, expires_at, project_scope, tags, source_session_id, access_count, created_at, updated_at, actor_kind, source_attribution, content_hash, trust_class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.content,
      entry.kind,
      entry.importance,
      entry.expiresAt,
      entry.projectScope,
      JSON.stringify(entry.tags),
      entry.sourceSessionId,
      entry.accessCount,
      entry.createdAt,
      entry.updatedAt,
      entry.actorKind,
      entry.sourceAttribution,
      entry.contentHash,
      entry.trustClass,
    );

    return entry;
  }

  /** Get a single entry by ID. */
  getById(id: string): MemoryEntry | null {
    const row = this.db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(id) as MemoryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  /** Query memories with filtering (FR-005). */
  query(input: QueryMemoryInput): MemoryEntry[] {
    // FR-006: quarantined entries are excluded from all reads pending review.
    const conditions: string[] = ["project_scope = ?", "quarantined = 0"];
    const params: unknown[] = [input.projectScope];

    if (input.kind) {
      conditions.push("kind = ?");
      params.push(input.kind);
    }

    if (input.importance) {
      conditions.push("importance = ?");
      params.push(input.importance);
    }

    if (input.tags && input.tags.length > 0) {
      // Tag matching: at least one tag must match (OR semantics)
      const tagConditions = input.tags.map(() => "tags LIKE ?");
      conditions.push(`(${tagConditions.join(" OR ")})`);
      for (const tag of input.tags) {
        params.push(`%"${tag}"%`);
      }
    }

    if (input.text) {
      conditions.push("content LIKE ?");
      params.push(`%${input.text}%`);
    }

    const limit = input.limit ?? 50;
    params.push(limit);

    const sql = `SELECT * FROM memory_entries WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params) as MemoryRow[];

    // Bump access count and updatedAt for returned entries (FR-007)
    const now = Math.floor(Date.now() / 1000);
    const updateStmt = this.db.prepare(
      "UPDATE memory_entries SET access_count = access_count + 1, updated_at = ? WHERE id = ?",
    );
    const bumpTransaction = this.db.transaction(() => {
      for (const row of rows) {
        updateStmt.run(now, row.id);
      }
    });
    bumpTransaction();

    return rows.map((row) => ({
      ...rowToEntry(row),
      accessCount: row.access_count + 1,
      updatedAt: now,
    }));
  }

  /** List memories with pagination. */
  list(input: ListMemoryInput): MemoryEntry[] {
    // FR-006: quarantined entries are excluded from all reads pending review.
    const conditions: string[] = ["project_scope = ?", "quarantined = 0"];
    const params: unknown[] = [input.projectScope];

    if (input.kind) {
      conditions.push("kind = ?");
      params.push(input.kind);
    }

    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    params.push(limit, offset);

    const sql = `SELECT * FROM memory_entries WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * Delete a memory entry by ID. Returns true if deleted. FR-006: a quarantined
   * entry is FROZEN pending human review and cannot be deleted here (including
   * via the agent-facing memory_delete tool, so a poisoning agent cannot destroy
   * the evidence). Release it first (releaseSession) to delete it.
   */
  delete(id: string): boolean {
    const result = this.db.prepare(
      "DELETE FROM memory_entries WHERE id = ? AND quarantined = 0",
    ).run(id);
    return result.changes > 0;
  }

  /** Delete all expired entries. Returns count of deleted entries (SC-004).
   * FR-006: quarantined entries are frozen and not swept until released. */
  sweepExpired(): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare(
      "DELETE FROM memory_entries WHERE expires_at IS NOT NULL AND expires_at <= ? AND quarantined = 0",
    ).run(now);
    return result.changes;
  }

  /** Update importance level for a specific entry. */
  updateImportance(id: string, importance: ImportanceLevel, newExpiresAt: number | null): boolean {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare(
      "UPDATE memory_entries SET importance = ?, expires_at = ?, updated_at = ? WHERE id = ?",
    ).run(importance, newExpiresAt, now, id);
    return result.changes > 0;
  }

  /** Get entries eligible for importance promotion (access_count >= threshold).
   * FR-006: quarantined entries are frozen and never promoted. */
  getPromotionCandidates(threshold: number): MemoryEntry[] {
    const rows = this.db.prepare(
      `SELECT * FROM memory_entries
       WHERE access_count >= ?
         AND importance NOT IN ('long-term', 'permanent')
         AND quarantined = 0
       ORDER BY access_count DESC`,
    ).all(threshold) as MemoryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * Entries eligible for trust-weighted decay (FR-004): machine-harvested and
   * not re-accessed since `staleBefore` (updated_at is bumped on every query).
   * Verified and human-curated entries are exempt and never returned; FR-006:
   * quarantined entries are frozen and never decayed.
   */
  getDecayCandidates(staleBefore: number): MemoryEntry[] {
    const rows = this.db.prepare(
      `SELECT * FROM memory_entries
       WHERE trust_class = 'machine-harvested'
         AND updated_at < ?
         AND quarantined = 0
       ORDER BY updated_at ASC`,
    ).all(staleBefore) as MemoryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * FR-003: the explicit human-verify action. Sets an entry's trust class to
   * `verified`, which lets it cross the retention boundary and exempts it from
   * trust-weighted decay. Like `store`'s actorKind, this is a TRUSTED storage
   * method: it is never exposed by any MCP tool (the server exposes only
   * store/query/delete/list), so an agent cannot reach it to self-verify. Only
   * a cockpit human action calls it. Returns true if the row was updated
   * (idempotent: re-verifying an already-verified row still matches it).
   */
  markVerified(id: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare(
      "UPDATE memory_entries SET trust_class = 'verified', updated_at = ? WHERE id = ?",
    ).run(now, id);
    return result.changes > 0;
  }

  /** Mark an entry expired as of `now` (FR-004 decay floor); the expiry sweeper
   * then deletes it. Returns true if the row was updated. */
  expireNow(id: string, now: number): boolean {
    const result = this.db.prepare(
      "UPDATE memory_entries SET expires_at = ?, updated_at = ? WHERE id = ?",
    ).run(now, now, id);
    return result.changes > 0;
  }

  /**
   * FR-006: enumerate every entry authored by an origin session, INCLUDING
   * quarantined ones (this is the review/revocation surface). Not
   * project-scoped: a poisoned session may have written across projects, and
   * all of its writes must be enumerable for bulk revocation. Newest first.
   */
  getBySession(sourceSessionId: string): MemoryEntry[] {
    const rows = this.db.prepare(
      "SELECT * FROM memory_entries WHERE source_session_id = ? ORDER BY created_at DESC",
    ).all(sourceSessionId) as MemoryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * FR-006 (AC-5): bulk-quarantine every entry from a (poisoned) session.
   * Quarantined entries are excluded from all reads pending human review.
   * Returns the number newly quarantined.
   */
  quarantineSession(sourceSessionId: string): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare(
      "UPDATE memory_entries SET quarantined = 1, updated_at = ? WHERE source_session_id = ? AND quarantined = 0",
    ).run(now, sourceSessionId);
    return result.changes;
  }

  /**
   * FR-006: release a session's entries from quarantine after human review.
   * Returns the number released.
   */
  releaseSession(sourceSessionId: string): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare(
      "UPDATE memory_entries SET quarantined = 0, updated_at = ? WHERE source_session_id = ? AND quarantined = 1",
    ).run(now, sourceSessionId);
    return result.changes;
  }

  /** Count entries for a project scope. */
  count(projectScope: string): number {
    // FR-006: quarantined entries are excluded, consistent with query/list, so
    // the count reflects readable entries and does not leak the poisoned count.
    const row = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM memory_entries WHERE project_scope = ? AND quarantined = 0",
    ).get(projectScope) as { cnt: number };
    return row.cnt;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
