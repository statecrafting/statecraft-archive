/**
 * Pure-function tests of the extraction stage (spec 021 §3.2): canonical
 * bytes and integrity hashing, the ceiling-coverage rule, and the meta
 * lowering helpers. The end-to-end pipeline (tsparser -> lower -> verify
 * -> seal -> oracle) is exercised by CI's `enrahitu-extract --check` gate
 * over the committed model.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  canonicalStringify,
  canonicalBytes,
  computeIntegrityHash,
  prettyStringify,
} from "./canonical.mjs";
import { accessString, pathString } from "./meta.mjs";
import { banViolations, covered, observeService, otelObserved } from "./usage.mjs";

describe("canonical serialization (spec 020 §3.5)", () => {
  it("sorts keys recursively with compact separators and a trailing newline", () => {
    const bytes = canonicalBytes({ b: 1, a: { z: 1, y: [2, 1] } });
    expect(bytes.toString("utf8")).toBe('{"a":{"y":[2,1],"z":1},"b":1}\n');
  });

  it("rejects non-integer numbers: the only cross-language-stable numbers", () => {
    expect(() => canonicalStringify({ ok: 1, bad: 0.5 })).toThrow(/non-integer/);
  });

  it("computes the integrity hash over the document with integrity removed", () => {
    const doc = { a: 1, integrity: { algorithm: "x", hash: "y" } };
    expect(computeIntegrityHash(doc)).toBe(computeIntegrityHash({ a: 1 }));
    expect(computeIntegrityHash(doc)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("pretty form parses back to the same canonical bytes", () => {
    const doc = { b: [3, 1], a: "x" };
    const reparsed = JSON.parse(prettyStringify(doc));
    expect(canonicalStringify(reparsed)).toBe(canonicalStringify(doc));
  });
});

describe("ceiling coverage (spec 021 §3.2 verify)", () => {
  const grants = [
    { kind: "db.read", resource: "app" },
    { kind: "kv.get", resource: "cache" },
    { kind: "secret.read", resource: "*" },
  ];

  it("matches exact kind with exact or wildcard resource", () => {
    expect(covered({ kind: "kv.get", resource: "cache" }, grants)).toBe(true);
    expect(covered({ kind: "kv.get", resource: "other" }, grants)).toBe(false);
    expect(covered({ kind: "secret.read", resource: "anything" }, grants)).toBe(true);
    expect(covered({ kind: "kv.put", resource: "cache" }, grants)).toBe(false);
  });

  it("matches db and egress touches at family level (v0.1 granularity)", () => {
    expect(covered({ family: "db" }, grants)).toBe(true);
    expect(covered({ family: "db" }, [{ kind: "kv.get", resource: "cache" }])).toBe(false);
    expect(covered({ family: "http.egress" }, grants)).toBe(false);
    expect(covered({ family: "http.egress" }, [{ kind: "http.egress", resource: "*" }])).toBe(
      true,
    );
  });
});

describe("the import walk over a fixture tree", () => {
  const roots: string[] = [];
  function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "extract-walk-"));
    roots.push(root);
    for (const [relPath, content] of Object.entries(files)) {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return root;
  }
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  const ledgerDriver = { "backend/core/ledger/driver.ts": "export interface LedgerDriver {}\nexport const x = 1;\n" };
  const obsWiring = {
    "backend/obs/tracer.ts": "export const tracer = 1;\n",
    "backend/obs/middleware.ts": 'import { tracer } from "./tracer";\nexport const obsMiddleware = tracer;\n',
  };

  it("counts a runtime CoreLedger import as a db touch, but not a type-only one", () => {
    const runtime = fixture({
      ...ledgerDriver,
      "backend/svc/api.ts": 'import { x } from "../core/ledger/driver";\nexport const y = x;\n',
    });
    expect(observeService(runtime, "backend/svc")).toEqual([
      { family: "db", via: "backend/svc/api.ts" },
    ]);

    const typeOnly = fixture({
      ...ledgerDriver,
      "backend/svc/api.ts":
        'import type { LedgerDriver } from "../core/ledger/driver";\nexport const y: LedgerDriver | null = null;\n',
    });
    expect(observeService(typeOnly, "backend/svc")).toEqual([]);
  });

  it("skips type-only elements of a mixed import but keeps the value names", () => {
    const root = fixture({
      "backend/kernel/hiq.ts": "export const kvGet = 1;\nexport type KvOpts = {};\n",
      "backend/svc/api.ts":
        'import { type KvOpts, kvGet } from "../kernel/hiq";\nexport const y = kvGet;\n',
    });
    expect(observeService(root, "backend/svc")).toEqual([
      { kind: "kv.get", resource: "cache", via: "backend/svc/api.ts" },
    ]);
  });

  it("maps state facade imports to their kinds, from the barrel or a submodule", () => {
    const barrel = fixture({
      "backend/state/index.ts": "export const query = 1;\nexport const txn = 2;\nexport const backup = 3;\n",
      "backend/svc/api.ts":
        'import { query, txn, backup } from "../state";\nexport const y = [query, txn, backup];\n',
    });
    expect(observeService(barrel, "backend/svc")).toEqual([
      { kind: "db.read", resource: "state", via: "backend/svc/api.ts" },
      { kind: "db.txn", resource: "state", via: "backend/svc/api.ts" },
      { kind: "bucket.write", resource: "state-backups", via: "backend/svc/api.ts" },
    ]);

    // Importing the submodule directly is the same reach and must observe the
    // same touch, which is why the facade terminates on the directory prefix
    // rather than on one barrel file.
    const submodule = fixture({
      "backend/state/lease.ts": "export const lock = 1;\n",
      "backend/svc/api.ts": 'import { lock } from "../state/lease";\nexport const y = lock;\n',
    });
    expect(observeService(submodule, "backend/svc")).toEqual([
      { kind: "lock.acquire", resource: "state", via: "backend/svc/api.ts" },
    ]);
  });

  it("lets both governed facades import hiq/init and no one else", () => {
    const hiqInit = { "backend/hiq/init.ts": "export const ready = 1;\nexport default {};\n" };

    const allowed = fixture({
      ...hiqInit,
      "backend/kernel/hiq.ts": 'import { ready } from "../hiq/init";\nexport const kvGet = ready;\n',
      "backend/state/sql.ts": 'import { ready } from "../hiq/init";\nexport const query = ready;\n',
    });
    expect(banViolations(allowed)).toEqual([]);

    const smuggled = fixture({
      ...hiqInit,
      "backend/svc/api.ts": 'import { ready } from "../hiq/init";\nexport const y = ready;\n',
    });
    expect(banViolations(smuggled)).toEqual([
      "backend/svc/api.ts: hiq/init import outside the governed facades backend/kernel/hiq.ts and backend/state/",
    ]);
  });

  it("observes otel when a service outside backend/obs/ reaches the tracer anchor", () => {
    const wired = fixture({
      ...obsWiring,
      "backend/svc/encore.service.ts":
        'import { obsMiddleware } from "../obs/middleware";\nexport const s = obsMiddleware;\n',
    });
    expect(otelObserved(wired, ["backend/svc", "backend/obs"])).toBe(true);
  });

  it("does not observe otel from backend/obs/ referencing itself or from no wiring", () => {
    const selfOnly = fixture({
      ...obsWiring,
      "backend/svc/encore.service.ts": "export const s = 1;\n",
    });
    expect(otelObserved(selfOnly, ["backend/svc", "backend/obs"])).toBe(false);

    const unwired = fixture({
      "backend/svc/encore.service.ts": "export const s = 1;\n",
    });
    expect(otelObserved(unwired, ["backend/svc"])).toBe(false);
  });

  it("does not observe otel through the enforcement plane or a type-only edge", () => {
    const throughKernel = fixture({
      ...obsWiring,
      "backend/kernel/boot.ts": 'import { tracer } from "../obs/tracer";\nexport const b = tracer;\n',
      "backend/svc/api.ts": 'import { b } from "../kernel/boot";\nexport const y = b;\n',
    });
    expect(otelObserved(throughKernel, ["backend/svc", "backend/obs"])).toBe(false);

    const typeOnly = fixture({
      ...obsWiring,
      "backend/svc/api.ts":
        'import type { tracer } from "../obs/tracer";\nexport const y: typeof tracer | null = null;\n',
    });
    expect(otelObserved(typeOnly, ["backend/svc", "backend/obs"])).toBe(false);
  });
});

describe("meta lowering helpers", () => {
  it("reconstructs encore path strings from segments", () => {
    expect(
      pathString({
        segments: [
          { type: "LITERAL", value: "auth" },
          { type: "WILDCARD", value: "rest" },
        ],
      }),
    ).toBe("/auth/*rest");
    expect(
      pathString({
        segments: [
          { type: "LITERAL", value: "hiq" },
          { type: "LITERAL", value: "kv" },
          { type: "PARAM", value: "key" },
        ],
      }),
    ).toBe("/hiq/kv/:key");
    expect(pathString({ segments: [{ type: "FALLBACK", value: "path" }] })).toBe("/!path");
  });

  it("maps access enums to the model vocabulary, private by default", () => {
    expect(accessString({ accessType: "PUBLIC" })).toBe("public");
    expect(accessString({ accessType: "AUTH" })).toBe("auth");
    expect(accessString({ accessType: "PRIVATE" })).toBe("private");
    expect(accessString({ accessType: "SOMETHING_NEW" })).toBe("private");
  });
});
