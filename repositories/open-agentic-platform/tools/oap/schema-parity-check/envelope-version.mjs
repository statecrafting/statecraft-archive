// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/189-duplex-envelope-version-parity/spec.md — §3.1
//
// Scalar parity for the protocol-wide duplex envelope schema version.
//
// `ENVELOPE_SCHEMA_VERSION` is declared independently on each end of the
// duplex stream and enforced with strict equality at both boundaries, so a
// one-line skew silently breaks the whole stream (the spec-119 → spec-183
// regression fixed in PR #257). These pure helpers read the integer literal
// from each source file with an anchored pattern and compare them.
//
// Source-read (not import) is deliberate: `types.ts` pulls in Encore stream
// types that are fragile to import from a bare runtime, and a regex over the
// declaration has no transitive-import surface — consistent with spec 125's
// dependency-free, Encore-parser-stable walker. The brittleness cost (a
// rename) is neutralised by throwing loudly when the anchored pattern does
// not match exactly once.

// Rust: `pub const ENVELOPE_SCHEMA_VERSION: u8 = 2;` (any integer type).
const RUST_RE =
  /^\s*pub\s+const\s+ENVELOPE_SCHEMA_VERSION\s*:\s*\w+\s*=\s*(\d+)\s*;/gm;
// TS: `export const ENVELOPE_SCHEMA_VERSION: EnvelopeSchemaVersion = 2;`
// `[^=\n]*` tolerates an optional type annotation but never spans a newline
// or an `=`, so a `type EnvelopeSchemaVersion = 2` alias or a comment mention
// is never matched.
const TS_RE =
  /^\s*export\s+const\s+ENVELOPE_SCHEMA_VERSION\b[^=\n]*=\s*(\d+)\s*;/gm;

/**
 * Extract the single `ENVELOPE_SCHEMA_VERSION` integer literal from `source`.
 * Throws (loud failure) when the constant is absent or declared more than
 * once, so a rename/duplication can never silently pass the gate.
 *
 * @param {string} source  file contents
 * @param {{ label: string, kind: "rust" | "ts" }} opts
 * @returns {number}
 */
export function extractEnvelopeVersion(source, { label, kind }) {
  const re = kind === "rust" ? RUST_RE : TS_RE;
  const matches = [...source.matchAll(re)];
  if (matches.length === 0) {
    throw new Error(
      `${label}: no \`ENVELOPE_SCHEMA_VERSION\` const declaration found`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${label}: ${matches.length} \`ENVELOPE_SCHEMA_VERSION\` declarations found (expected exactly 1)`,
    );
  }
  const value = Number(matches[0][1]);
  if (!Number.isInteger(value)) {
    throw new Error(`${label}: \`ENVELOPE_SCHEMA_VERSION\` is not an integer`);
  }
  return value;
}

/**
 * Compare the desktop (Rust) and server (TS) envelope versions.
 *
 * @param {{ desktopSource: string, serverSource: string, desktopLabel: string, serverLabel: string }} args
 * @returns {{ ok: boolean, desktop: number, server: number }}
 */
export function compareEnvelopeVersions({
  desktopSource,
  serverSource,
  desktopLabel,
  serverLabel,
}) {
  const desktop = extractEnvelopeVersion(desktopSource, {
    label: desktopLabel,
    kind: "rust",
  });
  const server = extractEnvelopeVersion(serverSource, {
    label: serverLabel,
    kind: "ts",
  });
  return { ok: desktop === server, desktop, server };
}
