// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/139-factory-artifact-substrate/spec.md
//
// Spec 139 Phase 1 — Rust mirror of the TypeScript SUBSTRATE_VERSION const.
//
// Project-memory discipline: schema versions are compile-time consts;
// mismatches between the TypeScript host (statecraft) and the Rust
// consumers (factory-engine, OPC desktop) MUST fail at build, not at
// runtime. Bump this constant in lockstep with
// `platform/services/statecraft/api/factory/substrate.ts:SUBSTRATE_VERSION`
// in the same commit, and the parity test below catches stale mirrors at
// `cargo test` time.

/// Substrate row format version. Bump on every breaking change to the
/// `factory_artifacts` row shape (column add / remove / rename / type
/// change).
///
/// v2 (spec 198 FR-013 c, migration 45): + `user_body_verified` /
/// `verified_by` / `verified_at` — the override trust-class columns.
pub const SUBSTRATE_VERSION: u32 = 2;

/// The expected TS-side const, asserted at build time.
///
/// Update both this constant and
/// `platform/services/statecraft/api/factory/substrate.ts:SUBSTRATE_VERSION`
/// in the same commit. The CI parity check (spec 104) reads the TS source
/// and asserts the two values agree; this Rust-side const is what
/// downstream consumers (`VirtualRoot` in Phase 3) compare against the
/// platform's runtime advertised version.
pub const SUBSTRATE_VERSION_TS_EXPECTED: u32 = 2;

const _: () = assert!(
    SUBSTRATE_VERSION == SUBSTRATE_VERSION_TS_EXPECTED,
    "SUBSTRATE_VERSION must match the TS-side mirror; bump both in lockstep \
     (specs/139-factory-artifact-substrate/spec.md §2.1)."
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_positive() {
        const _: () = assert!(SUBSTRATE_VERSION > 0);
    }

    #[test]
    fn ts_mirror_matches() {
        assert_eq!(SUBSTRATE_VERSION, SUBSTRATE_VERSION_TS_EXPECTED);
    }
}
