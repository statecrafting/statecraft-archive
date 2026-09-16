#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/120-factory-extraction-stage/spec.md — FR-003, FR-004
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-007 (extension)
// Spec: specs/125-schema-parity-walker-rebuild/spec.md — §3.2 (descriptor walker)
// Spec: specs/189-duplex-envelope-version-parity/spec.md — §3.2 (envelope-version scalar parity)
//
// Schema parity check.
//
// Compares the structural fingerprint of each statecraft TS schema (the
// source of truth) with the fingerprint emitted by the matching Rust
// mirror in `crates/factory-contracts/` during `cargo test`. Drift on
// either side fails CI before any runtime divergence can ship.
//
// Walker (spec 125). Every TS schema is walked through `walkDescriptor`
// (in `./walk-descriptor.mjs`), which consumes a plain-data `SchemaNode`
// exported next to a hand-rolled validator. This is the only walker the
// tool carries: it is dependency-free and stable under Encore.ts's TS
// parser, which crashes on `zod/v4/classic/schemas.d.cts` if zod is
// imported from any file the API tree transitively touches (see the
// file header on `extractionOutput.ts`). Any future TS mirror authored
// at one of the reserved paths below MUST export a `SchemaNode`
// descriptor (not a zod tree).
//
// Reserved-mode behaviour: when a TS mirror file does not exist (specs
// 121 §8 / 122 reserved the paths but did not author the files), the
// parity check records the Rust-side fingerprint and emits an
// informational line — it does NOT fail. Once a TS mirror lands as a
// descriptor, the comparison activates automatically (existence flip).
//
// Run order:
//   1. cargo test --manifest-path crates/factory-contracts/Cargo.toml
//      (writes .derived/schema-parity/{rust-knowledge,rust-provenance,rust-stakeholder-doc}-schema.json)
//   2. bun run tools/oap/schema-parity-check/index.mjs   (this file — needs
//      a runtime that can import .ts, hence bun)
//
// Exit codes:
//   0  all configured fingerprints match (or recorded for later comparison)
//   1  fingerprints differ — drift detected
//   2  internal error (rust file missing, walk failed, missing exports, etc.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkDescriptor } from "./walk-descriptor.mjs";
import { compareEnvelopeVersions } from "./envelope-version.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// Repo root is three levels up from tools/oap/schema-parity-check/. The
// `..,..` form predated the spec-spine crate split (#176), which relocated
// this tool from tools/schema-parity-check/ into tools/oap/ without updating
// the climb — leaving every path resolved under tools/ and the gate silently
// non-functional. (spec 189 §3.0)
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");

// Guard (spec 189 §3.0): fail loudly if REPO_ROOT no longer resolves to the
// repository root — e.g. a future relocation of this tool, the exact failure
// mode that left the gate dark from #176 until this spec. Without it, a wrong
// root surfaces only as a confusing "fingerprint not found" several checks in.
for (const marker of ["crates/factory-contracts", "platform/services/statecraft"]) {
  if (!fs.existsSync(path.join(REPO_ROOT, marker))) {
    fail(
      2,
      `schema-parity-check: REPO_ROOT does not resolve to the repo root\n` +
        `  resolved: ${REPO_ROOT}\n` +
        `  missing marker: ${marker}\n` +
        `  This tool likely moved; update the \`..\` climb in index.mjs.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Spec: specs/189-duplex-envelope-version-parity/spec.md
//
// Protocol-wide duplex envelope schema-version parity (a scalar, not a
// structural fingerprint). Runs FIRST and independently of the
// structural-fingerprint checks below — it neither reads the Rust fingerprint
// files nor imports any statecraft TS, so it reports even when an unrelated
// structural check would later error. The desktop (Rust) and server (TS)
// `ENVELOPE_SCHEMA_VERSION` constants are enforced with strict equality at
// both wire boundaries, so a one-line skew silently breaks the whole duplex
// (the spec-119 → spec-183 regression fixed in PR #257).
// ---------------------------------------------------------------------------
const DESKTOP_ENVELOPE_PATH = path.join(
  REPO_ROOT,
  "product/apps/opc/src-tauri/src/commands/sync_client.rs",
);
const SERVER_ENVELOPE_PATH = path.join(
  REPO_ROOT,
  "platform/services/statecraft/api/sync/types.ts",
);
{
  let envelopeResult;
  try {
    envelopeResult = compareEnvelopeVersions({
      desktopSource: fs.readFileSync(DESKTOP_ENVELOPE_PATH, "utf8"),
      serverSource: fs.readFileSync(SERVER_ENVELOPE_PATH, "utf8"),
      desktopLabel: path.relative(REPO_ROOT, DESKTOP_ENVELOPE_PATH),
      serverLabel: path.relative(REPO_ROOT, SERVER_ENVELOPE_PATH),
    });
  } catch (e) {
    fail(2, `schema-parity-check: envelope-version read failed — ${e.message}`);
  }
  if (!envelopeResult.ok) {
    process.stderr.write(
      `schema-parity-check: envelope-version DRIFT — desktop and server disagree on ENVELOPE_SCHEMA_VERSION\n` +
        `  desktop v=${envelopeResult.desktop}  ${path.relative(REPO_ROOT, DESKTOP_ENVELOPE_PATH)}\n` +
        `  server  v=${envelopeResult.server}  ${path.relative(REPO_ROOT, SERVER_ENVELOPE_PATH)}\n\n` +
        `The duplex stream enforces strict equality on meta.v; a skew drops every\n` +
        `frame (incl. sync.hello) and stalls the OPC boot gate (spec 183 FR-T2(b)).\n` +
        `Align the desktop constant to the server's wire version, then rebuild OPC.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `schema-parity-check: envelope-version OK (v=${envelopeResult.desktop})\n` +
      `  desktop: ${path.relative(REPO_ROOT, DESKTOP_ENVELOPE_PATH)}\n` +
      `  server:  ${path.relative(REPO_ROOT, SERVER_ENVELOPE_PATH)}\n`,
  );
}

const TS_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "platform/services/statecraft/api/knowledge/extractionOutput.ts",
);
const RUST_FINGERPRINT_PATH = path.join(
  REPO_ROOT,
  ".derived/schema-parity/rust-knowledge-schema.json",
);
const RUST_MIRROR_PATH = path.join(
  REPO_ROOT,
  "crates/factory-contracts/src/knowledge.rs",
);

const TS_PROVENANCE_PATH = path.join(
  REPO_ROOT,
  "platform/services/statecraft/api/governance/provenancePolicy.ts",
);
const RUST_PROVENANCE_FINGERPRINT_PATH = path.join(
  REPO_ROOT,
  ".derived/schema-parity/rust-provenance-schema.json",
);
const RUST_PROVENANCE_MIRROR_PATH = path.join(
  REPO_ROOT,
  "crates/factory-contracts/src/provenance.rs",
);

// Spec 122 — stakeholder-doc grammar.
const TS_STAKEHOLDER_DOC_PATH = path.join(
  REPO_ROOT,
  "platform/services/statecraft/api/governance/stakeholderDocPolicy.ts",
);
const RUST_STAKEHOLDER_DOC_FINGERPRINT_PATH = path.join(
  REPO_ROOT,
  ".derived/schema-parity/rust-stakeholder-doc-schema.json",
);
const RUST_STAKEHOLDER_DOC_MIRROR_PATH = path.join(
  REPO_ROOT,
  "crates/factory-contracts/src/stakeholder_docs.rs",
);

function fail(code, message) {
  process.stderr.write(message + "\n");
  process.exit(code);
}

if (!fs.existsSync(RUST_FINGERPRINT_PATH)) {
  fail(
    2,
    `schema-parity-check: rust fingerprint not found at ${path.relative(REPO_ROOT, RUST_FINGERPRINT_PATH)}\n` +
      `  Run: cargo test --manifest-path crates/factory-contracts/Cargo.toml`,
  );
}

if (!fs.existsSync(RUST_PROVENANCE_FINGERPRINT_PATH)) {
  fail(
    2,
    `schema-parity-check: provenance rust fingerprint not found at ${path.relative(REPO_ROOT, RUST_PROVENANCE_FINGERPRINT_PATH)}\n` +
      `  Run: cargo test --manifest-path crates/factory-contracts/Cargo.toml`,
  );
}

if (!fs.existsSync(RUST_STAKEHOLDER_DOC_FINGERPRINT_PATH)) {
  fail(
    2,
    `schema-parity-check: stakeholder-doc rust fingerprint not found at ${path.relative(REPO_ROOT, RUST_STAKEHOLDER_DOC_FINGERPRINT_PATH)}\n` +
      `  Run: cargo test --manifest-path crates/factory-contracts/Cargo.toml`,
  );
}

const statecraftDir = path.join(REPO_ROOT, "platform/services/statecraft");
let extractionOutputDescriptor;
let tsSchemaVersion;
try {
  const mod = await import(TS_SCHEMA_PATH);
  extractionOutputDescriptor = mod.extractionOutputDescriptor;
  tsSchemaVersion = mod.KNOWLEDGE_SCHEMA_VERSION;
} catch (e) {
  fail(
    2,
    `schema-parity-check: failed to import ${path.relative(REPO_ROOT, TS_SCHEMA_PATH)}\n  ${e.message}\n` +
      `  Run from a runtime that handles .ts (e.g. \`node --experimental-strip-types\` 22+, or \`bun run\`).\n` +
      `  Or run \`cd ${path.relative(REPO_ROOT, statecraftDir)} && npm install\` then retry under bun.`,
  );
}

if (
  !extractionOutputDescriptor ||
  typeof extractionOutputDescriptor.kind !== "string" ||
  typeof tsSchemaVersion !== "string"
) {
  fail(
    2,
    `schema-parity-check: ${path.relative(REPO_ROOT, TS_SCHEMA_PATH)} is missing exports\n` +
      `  Required: extractionOutputDescriptor (a SchemaNode with a string \`kind\`), KNOWLEDGE_SCHEMA_VERSION`,
  );
}

let tsFingerprint;
try {
  tsFingerprint = {
    version: tsSchemaVersion,
    root: walkDescriptor(extractionOutputDescriptor),
  };
} catch (e) {
  fail(2, `schema-parity-check: knowledge descriptor walk failed — ${e.message}`);
}

const rustFingerprint = JSON.parse(
  fs.readFileSync(RUST_FINGERPRINT_PATH, "utf8"),
);

function diff(a, b, pathParts = []) {
  const here = pathParts.join(".") || "<root>";
  if (typeof a !== typeof b) {
    return [`${here}: TS is ${typeof a}, Rust is ${typeof b}`];
  }
  if (a === null || b === null || typeof a !== "object") {
    return a === b ? [] : [`${here}: TS=${JSON.stringify(a)}, Rust=${JSON.stringify(b)}`];
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return [`${here}: TS array=${Array.isArray(a)}, Rust array=${Array.isArray(b)}`];
  }
  if (Array.isArray(a)) {
    const issues = [];
    if (a.length !== b.length) {
      issues.push(`${here}: TS has ${a.length} entries, Rust has ${b.length}`);
    }
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const tsEntry = a[i];
      const rustEntry = b[i];
      if (tsEntry === undefined) {
        issues.push(`${here}[${i}]: present in Rust only — ${JSON.stringify(rustEntry)}`);
        continue;
      }
      if (rustEntry === undefined) {
        issues.push(`${here}[${i}]: present in TS only — ${JSON.stringify(tsEntry)}`);
        continue;
      }
      const label = tsEntry?.name ?? rustEntry?.name ?? String(i);
      issues.push(...diff(tsEntry, rustEntry, [...pathParts, label]));
    }
    return issues;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const issues = [];
  for (const k of keys) {
    if (!(k in a)) {
      issues.push(`${here}.${k}: present in Rust only — ${JSON.stringify(b[k])}`);
      continue;
    }
    if (!(k in b)) {
      issues.push(`${here}.${k}: present in TS only — ${JSON.stringify(a[k])}`);
      continue;
    }
    issues.push(...diff(a[k], b[k], [...pathParts, k]));
  }
  return issues;
}

const issues = diff(tsFingerprint, rustFingerprint);
if (issues.length === 0) {
  process.stdout.write(
    `schema-parity-check: knowledge OK (version ${tsSchemaVersion})\n` +
      `  ts: ${path.relative(REPO_ROOT, TS_SCHEMA_PATH)}\n` +
      `  rs: ${path.relative(REPO_ROOT, RUST_MIRROR_PATH)}\n`,
  );
} else {
  process.stderr.write(
    `schema-parity-check: DRIFT detected between\n` +
      `  ts: ${path.relative(REPO_ROOT, TS_SCHEMA_PATH)} (version=${tsSchemaVersion})\n` +
      `  rs: ${path.relative(REPO_ROOT, RUST_MIRROR_PATH)} (version=${rustFingerprint.version})\n\n`,
  );
  for (const issue of issues) {
    process.stderr.write(`  - ${issue}\n`);
  }
  process.stderr.write(
    `\nIf the TS schema changed, mirror the change in ${path.relative(REPO_ROOT, RUST_MIRROR_PATH)}.\n` +
      `If the Rust types changed, mirror them in ${path.relative(REPO_ROOT, TS_SCHEMA_PATH)}.\n` +
      `Then bump KNOWLEDGE_SCHEMA_VERSION on both sides if the change is breaking.\n`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Provenance schema (spec 121).
//
// The TS mirror at provenancePolicy.ts is reserved by the spec but not yet
// authored. While it is absent, this block records the Rust fingerprint as
// already emitted by `cargo test` and emits an informational message — it
// does NOT fail CI. Once the TS file lands and exports
// `provenanceClaimSchema` + `PROVENANCE_SCHEMA_VERSION`, the comparison
// activates automatically.
// ---------------------------------------------------------------------------

const provenanceRustFingerprint = JSON.parse(
  fs.readFileSync(RUST_PROVENANCE_FINGERPRINT_PATH, "utf8"),
);

let provenanceHandled = false;
if (!fs.existsSync(TS_PROVENANCE_PATH)) {
  process.stdout.write(
    `schema-parity-check: provenance rust fingerprint recorded (version ${provenanceRustFingerprint.version})\n` +
      `  rs: ${path.relative(REPO_ROOT, RUST_PROVENANCE_MIRROR_PATH)}\n` +
      `  ts: ${path.relative(REPO_ROOT, TS_PROVENANCE_PATH)} — not yet authored (spec 121 §8 reserves the path)\n` +
      `  comparison will activate automatically when the TS mirror lands.\n`,
  );
  provenanceHandled = true;
}

if (!provenanceHandled) {
  let provenanceDescriptor;
  let provenanceTsVersion;
  try {
    const mod = await import(TS_PROVENANCE_PATH);
    provenanceDescriptor =
      mod.provenanceClaimDescriptor ?? mod.provenanceDescriptor;
    provenanceTsVersion = mod.PROVENANCE_SCHEMA_VERSION;
  } catch (e) {
    fail(
      2,
      `schema-parity-check: failed to import ${path.relative(REPO_ROOT, TS_PROVENANCE_PATH)}\n  ${e.message}`,
    );
  }

  if (
    !provenanceDescriptor ||
    typeof provenanceDescriptor.kind !== "string" ||
    typeof provenanceTsVersion !== "string"
  ) {
    fail(
      2,
      `schema-parity-check: ${path.relative(REPO_ROOT, TS_PROVENANCE_PATH)} is missing exports\n` +
        `  Required: provenanceClaimDescriptor (a SchemaNode with a string \`kind\`), PROVENANCE_SCHEMA_VERSION`,
    );
  }

  let provenanceTsFingerprint;
  try {
    provenanceTsFingerprint = {
      version: provenanceTsVersion,
      claim: walkDescriptor(provenanceDescriptor),
    };
  } catch (e) {
    fail(2, `schema-parity-check: provenance walk failed — ${e.message}`);
  }

  const provenanceClaimRustFp = {
    version: provenanceRustFingerprint.version,
    claim: provenanceRustFingerprint.claim,
  };
  const provenanceIssues = diff(provenanceTsFingerprint, provenanceClaimRustFp);
  if (provenanceIssues.length === 0) {
    process.stdout.write(
      `schema-parity-check: provenance OK (version ${provenanceTsVersion})\n` +
        `  ts: ${path.relative(REPO_ROOT, TS_PROVENANCE_PATH)}\n` +
        `  rs: ${path.relative(REPO_ROOT, RUST_PROVENANCE_MIRROR_PATH)}\n`,
    );
  } else {
    process.stderr.write(
      `schema-parity-check: provenance DRIFT detected between\n` +
        `  ts: ${path.relative(REPO_ROOT, TS_PROVENANCE_PATH)} (version=${provenanceTsVersion})\n` +
        `  rs: ${path.relative(REPO_ROOT, RUST_PROVENANCE_MIRROR_PATH)} (version=${provenanceRustFingerprint.version})\n\n`,
    );
    for (const issue of provenanceIssues) {
      process.stderr.write(`  - ${issue}\n`);
    }
    process.stderr.write(
      `\nIf the TS schema changed, mirror the change in ${path.relative(REPO_ROOT, RUST_PROVENANCE_MIRROR_PATH)}.\n` +
        `If the Rust types changed, mirror them in ${path.relative(REPO_ROOT, TS_PROVENANCE_PATH)}.\n` +
        `Then bump PROVENANCE_SCHEMA_VERSION on both sides if the change is breaking.\n`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Stakeholder-doc schema (spec 122).
//
// The TS mirror at stakeholderDocPolicy.ts is reserved by spec 122 but
// not yet authored. While it is absent, this block records the Rust
// fingerprint as already emitted by `cargo test` and emits an
// informational message — it does NOT fail CI. Once the TS file lands
// and exports `stakeholderDocSchema` + `STAKEHOLDER_DOC_SCHEMA_VERSION`,
// the comparison activates automatically.
// ---------------------------------------------------------------------------

const stakeholderRustFingerprint = JSON.parse(
  fs.readFileSync(RUST_STAKEHOLDER_DOC_FINGERPRINT_PATH, "utf8"),
);

if (!fs.existsSync(TS_STAKEHOLDER_DOC_PATH)) {
  process.stdout.write(
    `schema-parity-check: stakeholder-doc rust fingerprint recorded (version ${stakeholderRustFingerprint.version})\n` +
      `  rs: ${path.relative(REPO_ROOT, RUST_STAKEHOLDER_DOC_MIRROR_PATH)}\n` +
      `  ts: ${path.relative(REPO_ROOT, TS_STAKEHOLDER_DOC_PATH)} — not yet authored (spec 122 §8 reserves the path)\n` +
      `  comparison will activate automatically when the TS mirror lands.\n`,
  );
  process.exit(0);
}

let stakeholderDescriptor;
let stakeholderTsVersion;
try {
  const mod = await import(TS_STAKEHOLDER_DOC_PATH);
  stakeholderDescriptor =
    mod.stakeholderDocDescriptor ?? mod.stakeholderDescriptor;
  stakeholderTsVersion = mod.STAKEHOLDER_DOC_SCHEMA_VERSION;
} catch (e) {
  fail(
    2,
    `schema-parity-check: failed to import ${path.relative(REPO_ROOT, TS_STAKEHOLDER_DOC_PATH)}\n  ${e.message}`,
  );
}

if (
  !stakeholderDescriptor ||
  typeof stakeholderDescriptor.kind !== "string" ||
  typeof stakeholderTsVersion !== "string"
) {
  fail(
    2,
    `schema-parity-check: ${path.relative(REPO_ROOT, TS_STAKEHOLDER_DOC_PATH)} is missing exports\n` +
      `  Required: stakeholderDocDescriptor (a SchemaNode with a string \`kind\`), STAKEHOLDER_DOC_SCHEMA_VERSION`,
  );
}

let stakeholderTsFingerprint;
try {
  stakeholderTsFingerprint = {
    version: stakeholderTsVersion,
    stakeholderDoc: walkDescriptor(stakeholderDescriptor),
  };
} catch (e) {
  fail(
    2,
    `schema-parity-check: stakeholder-doc walk failed — ${e.message}`,
  );
}

const stakeholderRustFp = {
  version: stakeholderRustFingerprint.version,
  stakeholderDoc: stakeholderRustFingerprint.stakeholderDoc,
};
const stakeholderIssues = diff(stakeholderTsFingerprint, stakeholderRustFp);
if (stakeholderIssues.length === 0) {
  process.stdout.write(
    `schema-parity-check: stakeholder-doc OK (version ${stakeholderTsVersion})\n` +
      `  ts: ${path.relative(REPO_ROOT, TS_STAKEHOLDER_DOC_PATH)}\n` +
      `  rs: ${path.relative(REPO_ROOT, RUST_STAKEHOLDER_DOC_MIRROR_PATH)}\n`,
  );
} else {
  process.stderr.write(
    `schema-parity-check: stakeholder-doc DRIFT detected between\n` +
      `  ts: ${path.relative(REPO_ROOT, TS_STAKEHOLDER_DOC_PATH)} (version=${stakeholderTsVersion})\n` +
      `  rs: ${path.relative(REPO_ROOT, RUST_STAKEHOLDER_DOC_MIRROR_PATH)} (version=${stakeholderRustFingerprint.version})\n\n`,
  );
  for (const issue of stakeholderIssues) {
    process.stderr.write(`  - ${issue}\n`);
  }
  process.stderr.write(
    `\nIf the TS schema changed, mirror the change in ${path.relative(REPO_ROOT, RUST_STAKEHOLDER_DOC_MIRROR_PATH)}.\n` +
      `If the Rust types changed, mirror them in ${path.relative(REPO_ROOT, TS_STAKEHOLDER_DOC_PATH)}.\n` +
      `Then bump STAKEHOLDER_DOC_SCHEMA_VERSION on both sides if the change is breaking.\n`,
  );
  process.exit(1);
}
