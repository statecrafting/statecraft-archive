// Spec 204 FR-001 / AC-1: the session-memory write gate, proven against the
// SAME shared fixture the factory substrate gate is proven against. Importing
// CARRIER_FIXTURE from @opc/carrier-gate is what makes AC-1's "shared rule
// set, shared fixture" real: if the two gates ever diverged, this test breaks.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CARRIER_FIXTURE, CLEAN_FIXTURE } from "@opc/carrier-gate";
import {
  MEMORY_MAX_BYTES,
  MemoryWriteRefused,
  runMemoryStoreGate,
  runMemoryWriteGate,
} from "./gate.js";
import { MemoryStorage } from "./storage/sqlite.js";
import { signalsToStoreInputs, type HarvestedSignal } from "./harvesting/engine.js";
import { MemoryServer } from "./server.js";

const zeroWidthSample = CARRIER_FIXTURE.find(
  (s) => s.ruleId === "gate.carrier.zero-width-bidi",
);
if (!zeroWidthSample) throw new Error("fixture missing gate.carrier.zero-width-bidi");

describe("spec 204 FR-001 memory write gate (AC-1 shared fixture)", () => {
  it.each(CARRIER_FIXTURE.map((s) => [s.label, s.ruleId, s.sample]))(
    "refuses %s with %s",
    (_label, ruleId, sample) => {
      const verdict = runMemoryWriteGate(sample as string);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.ruleId).toBe(ruleId);
      expect(verdict.detail.length).toBeGreaterThan(0);
    },
  );

  it.each(CLEAN_FIXTURE.map((s, i) => [i, s]))(
    "passes clean sample %i",
    (_i, sample) => {
      expect(runMemoryWriteGate(sample as string)).toEqual({ ok: true });
    },
  );

  it("refuses content over the memory size ceiling", () => {
    const oversized = "x".repeat(MEMORY_MAX_BYTES + 1);
    const verdict = runMemoryWriteGate(oversized);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.ruleId).toBe("gate.size-ceiling");
  });

  it("passes content exactly at the ceiling", () => {
    // 64-byte lines (63 'x' + newline) so the content is exactly at the
    // ceiling without forming a >2048-char base64-ish run (which the shared
    // encoded-blob carrier rule would otherwise refuse).
    const line = `${"x".repeat(63)}\n`;
    const atCeiling = line.repeat(MEMORY_MAX_BYTES / 64);
    expect(Buffer.byteLength(atCeiling, "utf8")).toBe(MEMORY_MAX_BYTES);
    expect(runMemoryWriteGate(atCeiling).ok).toBe(true);
  });

  it("measures the ceiling in BYTES, not string length (multi-byte UTF-8)", () => {
    // Each CJK char is 3 UTF-8 bytes but string length 1. A string whose
    // length is far under the ceiling but whose byte length exceeds it must be
    // refused; a string-length check would wrongly pass it.
    const overBytes = "日".repeat(Math.ceil(MEMORY_MAX_BYTES / 3) + 1);
    expect(overBytes.length).toBeLessThan(MEMORY_MAX_BYTES);
    expect(Buffer.byteLength(overBytes, "utf8")).toBeGreaterThan(MEMORY_MAX_BYTES);
    const verdict = runMemoryWriteGate(overBytes);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.ruleId).toBe("gate.size-ceiling");
  });
});

describe("runMemoryStoreGate also gates tags (re-injected into prompts)", () => {
  it("refuses a carrier-class tag with the carrier rule id", () => {
    const verdict = runMemoryStoreGate("clean content", [
      "ok-tag",
      zeroWidthSample.sample,
    ]);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.ruleId).toBe("gate.carrier.zero-width-bidi");
      expect(verdict.detail).toContain("tag");
    }
  });

  it("passes clean content and clean tags", () => {
    expect(runMemoryStoreGate("clean content", ["a", "b"])).toEqual({ ok: true });
  });
});

describe("storage.store is gated on every write (FR-001 chokepoint)", () => {
  let tempDir: string;
  let storage: MemoryStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gate-test-"));
    storage = new MemoryStorage(join(tempDir, "memory.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws MemoryWriteRefused for a carrier-class content sample", () => {
    expect(() =>
      storage.store({
        content: zeroWidthSample.sample,
        kind: "note",
        projectScope: "/proj",
      }),
    ).toThrow(MemoryWriteRefused);
  });

  it("throws MemoryWriteRefused for a carrier-class tag", () => {
    expect(() =>
      storage.store({
        content: "clean content",
        kind: "note",
        projectScope: "/proj",
        tags: [zeroWidthSample.sample],
      }),
    ).toThrow(MemoryWriteRefused);
  });

  it("carries the attributable rule id + detail on the thrown error", () => {
    try {
      storage.store({
        content: zeroWidthSample.sample,
        kind: "note",
        projectScope: "/proj",
      });
      expect.unreachable("store should have refused the carrier sample");
    } catch (err) {
      expect(err).toBeInstanceOf(MemoryWriteRefused);
      expect((err as MemoryWriteRefused).ruleId).toBe("gate.carrier.zero-width-bidi");
      expect((err as MemoryWriteRefused).detail.length).toBeGreaterThan(0);
    }
  });

  it("gates harvested-signal writes routed through store()", () => {
    // The harvested-signal persistence path (spec 056 harvesting engine) funnels
    // through store() like any other write, so it is gated identically.
    const signal: HarvestedSignal = {
      ruleId: "test-rule",
      kind: "note",
      importance: "short-term",
      content: `harvested ${zeroWidthSample.sample}`,
      matchText: "x",
    };
    const [input] = signalsToStoreInputs([signal], "/proj", "sess-1");
    expect(() => storage.store(input)).toThrow(MemoryWriteRefused);
  });

  it("stores clean content unchanged", () => {
    const entry = storage.store({
      content: "Prefer vitest for TS packages",
      kind: "preference",
      projectScope: "/proj",
    });
    expect(entry.id).toBeTruthy();
    expect(storage.getById(entry.id)?.content).toBe("Prefer vitest for TS packages");
  });
});

describe("the write gate is attributable through the MCP server surface", () => {
  let tempDir: string;
  let server: MemoryServer;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gate-mcp-test-"));
    server = new MemoryServer({
      projectScope: "/proj",
      databasePath: join(tempDir, "memory.db"),
    });
  });

  afterEach(() => {
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("memory_store of a carrier sample returns an error carrying the rule id", () => {
    const response = server.processRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "memory_store",
        arguments: { content: zeroWidthSample.sample, kind: "note" },
      },
    });
    expect(response.error).toBeDefined();
    expect(response.error?.message).toContain("gate.carrier.zero-width-bidi");
    expect(response.error?.data).toEqual({ ruleId: "gate.carrier.zero-width-bidi" });
  });
});
