// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/125-schema-parity-walker-rebuild/spec.md — §3.2 (Phase 3 / T035)
//
// Standalone unit test for `walkDescriptor`. Run via:
//
//   node tools/schema-parity-check/walk-descriptor.test.mjs
//
// Pure JS — no zod, no .ts imports — so the test runs under plain Node
// without needing bun, and remains stable even when statecraft's
// node_modules is empty. Asserts that the descriptor walker:
//
//   1. Produces the canonical `{ kind, ... }` fingerprint shape that
//      matches what the Rust mirror in
//      `crates/factory-contracts/src/knowledge.rs` emits.
//   2. Sorts `object` field lists alphabetically by name (order
//      independence — input order must not affect output).
//   3. Sorts `enum` values lexicographically (likewise).
//   4. Preserves positional order on `tuple.items` (positional, not
//      alphabetical).
//   5. Throws a clear error on a malformed node so descriptor authoring
//      bugs fail loudly at the parity gate.

import assert from "node:assert/strict";
import { walkDescriptor } from "./walk-descriptor.mjs";

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok  ${label}\n`);
  } catch (err) {
    failed += 1;
    process.stdout.write(`  fail ${label}\n${err.stack ?? err.message}\n`);
  }
}

// 1. Canonical fingerprint shape — primitives, array, object, map, enum,
//    tuple, discriminatedUnion all emit { kind, ... } leaves matching
//    what crates/factory-contracts/src/knowledge.rs serialises.
check("primitives pass through with kind only", () => {
  for (const k of ["string", "int", "number", "boolean", "unknown"]) {
    assert.deepEqual(walkDescriptor({ kind: k }), { kind: k });
  }
});

check("object emits sorted fields with required flag preserved", () => {
  const node = {
    kind: "object",
    fields: [
      { name: "zeta", required: false, type: { kind: "string" } },
      { name: "alpha", required: true, type: { kind: "int" } },
      { name: "mu", required: true, type: { kind: "boolean" } },
    ],
  };
  assert.deepEqual(walkDescriptor(node), {
    kind: "object",
    fields: [
      { name: "alpha", required: true, type: { kind: "int" } },
      { name: "mu", required: true, type: { kind: "boolean" } },
      { name: "zeta", required: false, type: { kind: "string" } },
    ],
  });
});

check("object sort is order-independent", () => {
  const fields = [
    { name: "b", required: true, type: { kind: "string" } },
    { name: "a", required: true, type: { kind: "string" } },
  ];
  const fp1 = walkDescriptor({ kind: "object", fields });
  const fp2 = walkDescriptor({ kind: "object", fields: [...fields].reverse() });
  assert.deepEqual(fp1, fp2);
});

check("array recurses into element", () => {
  assert.deepEqual(
    walkDescriptor({ kind: "array", element: { kind: "int" } }),
    { kind: "array", element: { kind: "int" } },
  );
});

check("map recurses into key/value", () => {
  assert.deepEqual(
    walkDescriptor({
      kind: "map",
      key: { kind: "string" },
      value: { kind: "unknown" },
    }),
    { kind: "map", key: { kind: "string" }, value: { kind: "unknown" } },
  );
});

check("enum values sort lexicographically", () => {
  assert.deepEqual(
    walkDescriptor({ kind: "enum", values: ["pdf", "image", "text"] }),
    { kind: "enum", values: ["image", "pdf", "text"] },
  );
});

check("tuple preserves positional order", () => {
  assert.deepEqual(
    walkDescriptor({
      kind: "tuple",
      items: [{ kind: "string" }, { kind: "int" }, { kind: "boolean" }],
    }),
    {
      kind: "tuple",
      items: [{ kind: "string" }, { kind: "int" }, { kind: "boolean" }],
    },
  );
});

check("discriminatedUnion sorts variants and per-variant fields", () => {
  const node = {
    kind: "discriminatedUnion",
    discriminator: "mode",
    variants: [
      {
        tag: "z-mode",
        fields: [{ name: "y", required: true, type: { kind: "int" } }],
      },
      {
        tag: "a-mode",
        fields: [
          { name: "n", required: false, type: { kind: "string" } },
          { name: "m", required: true, type: { kind: "boolean" } },
        ],
      },
    ],
  };
  assert.deepEqual(walkDescriptor(node), {
    kind: "discriminatedUnion",
    discriminator: "mode",
    variants: [
      {
        tag: "a-mode",
        fields: [
          { name: "m", required: true, type: { kind: "boolean" } },
          { name: "n", required: false, type: { kind: "string" } },
        ],
      },
      {
        tag: "z-mode",
        fields: [{ name: "y", required: true, type: { kind: "int" } }],
      },
    ],
  });
});

// 2. Drift detection — the walker output of a knowledge-shaped descriptor
//    matches a hand-written expected fingerprint structurally. This is
//    the local equivalent of the descriptor-↔-Rust comparison the parity
//    tool performs at runtime.
check("knowledge-shaped mock matches expected fingerprint", () => {
  const tokenSpend = {
    kind: "object",
    fields: [
      { name: "input", required: true, type: { kind: "int" } },
      { name: "output", required: true, type: { kind: "int" } },
      { name: "cacheRead", required: false, type: { kind: "int" } },
      { name: "cacheWrite", required: false, type: { kind: "int" } },
    ],
  };
  const root = {
    kind: "object",
    fields: [
      { name: "text", required: true, type: { kind: "string" } },
      {
        name: "metadata",
        required: true,
        type: {
          kind: "map",
          key: { kind: "string" },
          value: { kind: "unknown" },
        },
      },
      { name: "tokenSpend", required: true, type: tokenSpend },
    ],
  };
  const expected = {
    kind: "object",
    fields: [
      {
        name: "metadata",
        required: true,
        type: {
          kind: "map",
          key: { kind: "string" },
          value: { kind: "unknown" },
        },
      },
      { name: "text", required: true, type: { kind: "string" } },
      {
        name: "tokenSpend",
        required: true,
        type: {
          kind: "object",
          fields: [
            { name: "cacheRead", required: false, type: { kind: "int" } },
            { name: "cacheWrite", required: false, type: { kind: "int" } },
            { name: "input", required: true, type: { kind: "int" } },
            { name: "output", required: true, type: { kind: "int" } },
          ],
        },
      },
    ],
  };
  assert.deepEqual(walkDescriptor(root), expected);
});

// 3. Loud failure on malformed input.
check("throws on null", () => {
  assert.throws(() => walkDescriptor(null), /malformed node/);
});

check("throws on missing kind", () => {
  assert.throws(() => walkDescriptor({}), /malformed node/);
});

check("throws on unknown kind", () => {
  assert.throws(
    () => walkDescriptor({ kind: "definitelyNotAKind" }),
    /unhandled descriptor kind/,
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
