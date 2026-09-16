/**
 * Spec 111 Phase 1 — content_hash stability tests.
 *
 * Covers the spec §6 invariant: "content_hash stability under frontmatter
 * key ordering". The hash drives optimistic locking, duplex snapshot
 * directory diffing, and local-cache keying — any non-determinism here
 * would silently mask or fabricate catalog drift.
 */

import { describe, expect, test } from "vitest";

// The db modules pull in `encore.dev/storage/sqldb`, which requires the
// Encore native runtime; stub them so importing the module under test does
// not detonate. Pattern mirrors api/sync/relay.test.ts.
import { vi } from "vitest";
vi.mock("../db/drizzle", () => ({ db: {} }));
vi.mock("../db/schema", () => ({
  agentCatalog: {},
  agentCatalogAudit: {},
}));

import { computeContentHash } from "./catalog";

describe("computeContentHash", () => {
  test("is stable across frontmatter key ordering", () => {
    const a = computeContentHash(
      { name: "triage", model: "opus", tools: ["read", "edit"] },
      "# body",
    );
    const b = computeContentHash(
      { tools: ["read", "edit"], model: "opus", name: "triage" },
      "# body",
    );
    expect(a).toBe(b);
  });

  test("is stable across nested object key ordering", () => {
    const a = computeContentHash(
      { meta: { owner: "bart", tier: 2 }, name: "n" },
      "x",
    );
    const b = computeContentHash(
      { name: "n", meta: { tier: 2, owner: "bart" } },
      "x",
    );
    expect(a).toBe(b);
  });

  test("preserves array order (arrays are sequences, not sets)", () => {
    const a = computeContentHash({ tools: ["a", "b"] }, "x");
    const b = computeContentHash({ tools: ["b", "a"] }, "x");
    expect(a).not.toBe(b);
  });

  test("differs when body_markdown changes", () => {
    const a = computeContentHash({ name: "n" }, "# one");
    const b = computeContentHash({ name: "n" }, "# two");
    expect(a).not.toBe(b);
  });

  test("differs when a frontmatter value changes", () => {
    const a = computeContentHash({ name: "n", model: "opus" }, "x");
    const b = computeContentHash({ name: "n", model: "sonnet" }, "x");
    expect(a).not.toBe(b);
  });

  test("produces a 64-char lowercase hex sha-256 digest", () => {
    const h = computeContentHash({ name: "n" }, "body");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("distinguishes null from missing keys", () => {
    // Canonical JSON encodes `{ foo: null }` and `{}` differently.
    const withNull = computeContentHash({ foo: null }, "x");
    const empty = computeContentHash({}, "x");
    expect(withNull).not.toBe(empty);
  });

  test("treats deeply nested structures deterministically", () => {
    const a = computeContentHash(
      {
        z: { b: [1, 2, { inner: "v", other: "w" }], a: true },
        a: { y: "y", x: "x" },
      },
      "body",
    );
    const b = computeContentHash(
      {
        a: { x: "x", y: "y" },
        z: { a: true, b: [1, 2, { other: "w", inner: "v" }] },
      },
      "body",
    );
    expect(a).toBe(b);
  });
});
