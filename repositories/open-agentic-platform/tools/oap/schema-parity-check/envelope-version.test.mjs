// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/189-duplex-envelope-version-parity/spec.md — §3.3
//
// Standalone unit test for the envelope-version scalar parity helpers. Run:
//
//   node tools/oap/schema-parity-check/envelope-version.test.mjs
//
// Pure JS — no .ts imports — so it runs under plain Node without bun and
// without statecraft's node_modules. Asserts the parser is precise (accepts
// real declarations, ignores type aliases and comments) and that the
// comparator surfaces drift.

import assert from "node:assert/strict";
import {
  extractEnvelopeVersion,
  compareEnvelopeVersions,
} from "./envelope-version.mjs";

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

// Representative snippets mirroring the real source files.
const RUST_OK = `
/// The duplex protocol version this client speaks.
pub const ENVELOPE_SCHEMA_VERSION: u8 = 2;
pub const AGENT_CATALOG_ENVELOPE_VERSION: u8 = 2;
`;
const TS_OK = `
export type EnvelopeSchemaVersion = 2;
export const ENVELOPE_SCHEMA_VERSION: EnvelopeSchemaVersion = 2;
// later: if (m.v !== ENVELOPE_SCHEMA_VERSION) return false;
`;

check("reads the Rust const (with type annotation)", () => {
  assert.equal(
    extractEnvelopeVersion(RUST_OK, { label: "rs", kind: "rust" }),
    2,
  );
});

check("reads the TS const, ignoring the `type` alias and comment", () => {
  assert.equal(extractEnvelopeVersion(TS_OK, { label: "ts", kind: "ts" }), 2);
});

check("accepts a usize/u16 Rust type annotation", () => {
  assert.equal(
    extractEnvelopeVersion(
      "pub const ENVELOPE_SCHEMA_VERSION: u16 = 7;",
      { label: "rs", kind: "rust" },
    ),
    7,
  );
});

check("equal versions compare ok", () => {
  const r = compareEnvelopeVersions({
    desktopSource: "pub const ENVELOPE_SCHEMA_VERSION: u8 = 2;",
    serverSource: "export const ENVELOPE_SCHEMA_VERSION = 2;",
    desktopLabel: "rs",
    serverLabel: "ts",
  });
  assert.deepEqual(r, { ok: true, desktop: 2, server: 2 });
});

check("unequal versions surface both values", () => {
  const r = compareEnvelopeVersions({
    desktopSource: "pub const ENVELOPE_SCHEMA_VERSION: u8 = 1;",
    serverSource: "export const ENVELOPE_SCHEMA_VERSION: EnvelopeSchemaVersion = 2;",
    desktopLabel: "rs",
    serverLabel: "ts",
  });
  assert.deepEqual(r, { ok: false, desktop: 1, server: 2 });
});

check("absent constant throws (loud failure, not silent pass)", () => {
  assert.throws(
    () => extractEnvelopeVersion("// nothing here", { label: "rs", kind: "rust" }),
    /no .*ENVELOPE_SCHEMA_VERSION.* const declaration found/,
  );
});

check("duplicate declaration throws", () => {
  const dup =
    "pub const ENVELOPE_SCHEMA_VERSION: u8 = 2;\npub const ENVELOPE_SCHEMA_VERSION: u8 = 3;";
  assert.throws(
    () => extractEnvelopeVersion(dup, { label: "rs", kind: "rust" }),
    /expected exactly 1/,
  );
});

check("TS `type` alias alone is not mistaken for the const", () => {
  assert.throws(
    () =>
      extractEnvelopeVersion("export type EnvelopeSchemaVersion = 2;", {
        label: "ts",
        kind: "ts",
      }),
    /no .*ENVELOPE_SCHEMA_VERSION.* const declaration found/,
  );
});

process.stdout.write(`\nenvelope-version.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
