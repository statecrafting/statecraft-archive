// Spec 204 FR-002 (provenance stamp) + FR-003 (trust class schema), AC-2.

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage/sqlite.js";
import { handleMemoryStore } from "./tools/store.js";
import { signalsToStoreInputs, type HarvestedSignal } from "./harvesting/engine.js";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("spec 204 FR-002 provenance + FR-003 trust class", () => {
  let tempDir: string;
  let storage: MemoryStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "provenance-test-"));
    storage = new MemoryStorage(join(tempDir, "memory.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stamps a content hash on every write (FR-002)", () => {
    const entry = storage.store({
      content: "Use ESM everywhere",
      kind: "decision",
      projectScope: "/proj",
    });
    expect(entry.contentHash).toBe(sha256("Use ESM everywhere"));
    expect(storage.getById(entry.id)?.contentHash).toBe(entry.contentHash);
  });

  it("records origin session id and source attribution (FR-002)", () => {
    const entry = storage.store({
      content: "harvested claim",
      kind: "note",
      projectScope: "/proj",
      sourceSessionId: "sess-42",
      actorKind: "harvester",
      sourceAttribution: "user-pasted-doc.md",
    });
    expect(entry.sourceSessionId).toBe("sess-42");
    expect(entry.sourceAttribution).toBe("user-pasted-doc.md");
    expect(entry.actorKind).toBe("harvester");
  });

  it("defaults actor to agent and trust to machine-harvested (FR-003)", () => {
    const entry = storage.store({
      content: "an agent wrote this",
      kind: "note",
      projectScope: "/proj",
    });
    expect(entry.actorKind).toBe("agent");
    expect(entry.trustClass).toBe("machine-harvested");
    expect(entry.sourceAttribution).toBeNull();
  });

  it("derives human-curated ONLY from a human actor, never from input (FR-003/FR-005)", () => {
    const human = storage.store({
      content: "a human wrote this",
      kind: "decision",
      projectScope: "/proj",
      actorKind: "human",
    });
    expect(human.trustClass).toBe("human-curated");

    // storage.store is the TRUSTED API, so it derives human-curated from a
    // human actor. Agent/harvester writes are always machine-harvested. The
    // no-laundering guarantee (an agent cannot self-assert human) is enforced
    // at the untrusted MCP boundary, tested separately below.
    for (const actorKind of ["agent", "harvester"] as const) {
      const machine = storage.store({
        content: `machine ${actorKind}`,
        kind: "note",
        projectScope: "/proj",
        actorKind,
      });
      expect(machine.trustClass).toBe("machine-harvested");
    }
  });

  it("exposes provenance + trust via the query surface (AC-2)", () => {
    storage.store({
      content: "queryable entry",
      kind: "pattern",
      projectScope: "/proj",
      actorKind: "human",
      sourceSessionId: "sess-q",
    });
    const [found] = storage.query({ projectScope: "/proj", text: "queryable" });
    expect(found).toMatchObject({
      actorKind: "human",
      trustClass: "human-curated",
      sourceSessionId: "sess-q",
      contentHash: sha256("queryable entry"),
    });
  });

  it("rejects an invalid actorKind at the storage boundary", () => {
    expect(() =>
      storage.store({
        content: "x",
        kind: "note",
        projectScope: "/proj",
        // deliberately invalid; simulates a bad direct (non-MCP) caller.
        actorKind: "root" as never,
      }),
    ).toThrow(/invalid actorKind/);
  });

  it("MCP memory_store cannot launder trust: caller-claimed provenance is ignored (FR-005)", () => {
    // An agent could smuggle actorKind / sourceSessionId into the raw tool
    // args; the untrusted handler must ignore them and record agent provenance
    // with the server's trusted session id.
    const entry = handleMemoryStore(
      storage,
      {
        content: "agent trying to launder",
        kind: "note",
        actorKind: "human",
        sourceSessionId: "forged-session",
      } as never,
      { projectScope: "/proj", sourceSessionId: "trusted-session" },
    );
    expect(entry.actorKind).toBe("agent");
    expect(entry.trustClass).toBe("machine-harvested");
    expect(entry.sourceSessionId).toBe("trusted-session");
  });

  it("stamps harvester provenance on harvested signals (FR-002)", () => {
    const signal: HarvestedSignal = {
      ruleId: "decision-rule",
      kind: "decision",
      importance: "short-term",
      content: "a harvested decision",
      matchText: "x",
    };
    const [input] = signalsToStoreInputs([signal], "/proj", "sess-h");
    const entry = storage.store(input);
    expect(entry.actorKind).toBe("harvester");
    expect(entry.trustClass).toBe("machine-harvested");
    expect(entry.sourceAttribution).toBe("harvest-rule:decision-rule");
  });

  it("backfills content_hash for rows written before the v2 migration", () => {
    // Simulate a v1 database: create only the v1 schema, insert a row, then
    // open it with MemoryStorage (which runs v2 + the backfill).
    const dbFile = join(tempDir, "legacy.db");
    const raw = new Database(dbFile);
    // Run only migration v1 by hand.
    raw.exec(`
      CREATE TABLE memory_entries (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, kind TEXT NOT NULL,
        importance TEXT NOT NULL, expires_at INTEGER, project_scope TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]', source_session_id TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (1);
      INSERT INTO memory_entries (id, content, kind, importance, project_scope, source_session_id, created_at, updated_at)
      VALUES ('legacy-1', 'old content', 'note', 'medium-term', '/proj', 'old-sess', 1, 1);
    `);
    raw.close();

    const upgraded = new MemoryStorage(dbFile);
    try {
      const entry = upgraded.getById("legacy-1");
      expect(entry?.contentHash).toBe(sha256("old content"));
      expect(entry?.actorKind).toBe("agent");
      expect(entry?.trustClass).toBe("machine-harvested");
    } finally {
      upgraded.close();
    }
  });

  it("re-opening a migrated database is a no-op (idempotent)", () => {
    const dbFile = join(tempDir, "reopen.db");
    const first = new MemoryStorage(dbFile);
    const e1 = first.store({ content: "x", kind: "note", projectScope: "/proj" });
    first.close();
    const second = new MemoryStorage(dbFile);
    try {
      // Data persists, re-running migrations does not error, and a fresh write
      // still stamps provenance.
      expect(second.getById(e1.id)?.contentHash).toBe(sha256("x"));
      const e2 = second.store({ content: "y", kind: "note", projectScope: "/proj" });
      expect(e2.trustClass).toBe("machine-harvested");
      expect(second.count("/proj")).toBe(2);
    } finally {
      second.close();
    }
  });
});
