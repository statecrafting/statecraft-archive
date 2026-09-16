# Implementation Plan: Run Certificate Corpus Binding (spec 218)

> Refines the spec sketch into firm decisions. The spec's FR-001..FR-004 and
> AC-1..AC-5 are sharpened here. Where the spec prose contains a stale
> assumption (notably FR-002's dependency-boundary claim), that assumption is
> explicitly amended in the FR-002 section below and flagged as a required
> spec-prose update before merging.

## Decision summary

1. **CorpusBinding struct (FR-001).** A new `CorpusBinding` struct with two
   fields (`corpus_attestation_hash: String`, `spec_spine_version: String`)
   is added to `governance_certificate.rs`. It hangs on `GovernanceCertificate`
   as `corpus_binding: Option<CorpusBinding>` with
   `skip_serializing_if = "Option::is_none"`. The field is INSIDE the
   `certificate_hash` and `cert_signature` computation (same reasoning as
   `admitted_envelope_hash`, `goal_id`, `intent_capsule_hash`: content bound
   at emission). Version bumps from `1.5.0` to `1.6.0`. Builder method is
   `corpus_binding(hash: impl Into<String>, version: impl Into<String>) -> Self`.

2. **FR-002 boundary mechanism (the load-bearing design fork, now resolved).**
   The spec's "The invariant" prose refers to a crate named
   `open_agentic_spec_registry_reader` that no longer exists post-spec-217.
   factory-engine depends on `spec-spine-core = "0.8.0"`, which exports
   `attest`, `attest_json`, `verify_recompute`, AND `attestation_hash` from its
   root (all from the same `pub use attest::{...}` re-export in lib.rs). A
   crate-level cargo-deny ban cannot distinguish functions within the same crate.
   The chosen mechanism is both layers combined:
   - **(a) cargo-deny crate ban** on `spec-spine-cli` (the CLI emit binary
     crate; factory-engine must never drag in the CLI crate as a library dep).
     This is crate-granularity and fully expressible in `deny.toml`.
   - **(b) Symbol-level CI lint** (grep over `crates/factory-engine/src/**`)
     forbidding references to `attest(`, `attest_json(`, `verify_recompute(`
     while allowing `attestation_hash`. Added as a step in
     `ci-supply-chain.yml` (the governed supply-chain lane).
   The combination gives the crate-graph guarantee the spec intended (no emit
   binary dragged in) PLUS the symbol-level guarantee (no forbidden function
   called). Neither layer alone is sufficient. This diverges from the spec's
   literal "dependency-graph deny-rule" framing, which is stale because of the
   post-217 single-crate reality. A spec-prose amendment to "The invariant"
   and FR-002 is required; see the Checkpoints section at the end of this plan.

3. **Runtime read path (FR-002 builder reads, never recomputes).** The cert
   builder in `factory_run.rs` reads the upstream attestation from a path
   supplied via a new env var `OAP_CORPUS_ATTESTATION_PATH`. Precedent:
   `OAP_SIGNING_KEY` and `OAP_SIGNING_KEY_PATH` use this same pattern (env vars
   carrying optional proof material paths). The CI sequence is: step 1,
   `spec-spine attest --output <path>` writes the attestation JSON; step 2,
   `factory-run` reads `OAP_CORPUS_ATTESTATION_PATH`, deserialises the
   `CorpusAttestation`, calls `spec_spine_core::attest::attestation_hash`, takes
   the resulting hex string, and calls `.corpus_binding(hash, version)` on the
   builder. When `OAP_CORPUS_ATTESTATION_PATH` is not set, `corpus_binding` is
   left `None` and the cert emits in the "unbound" state (named notice, not an
   error).

4. **FR-003 / FR-004 verify path.** A new `--corpus-attestation <file>` flag is
   added to `verify-certificate`. The verifier deserialises the supplied
   attestation and calls `spec_spine_core::attest::attestation_hash`. It calls
   ONLY `attestation_hash` (pure payload hash on the supplied object); it never
   calls `attest` or `verify_recompute`. Verifying the attestation's own truth
   (corpus recompute or detached seal) is delegated to `spec-spine
   verify-attestation`. The four named outcomes are: absent binding produces
   `"corpus binding: UNBOUND"` as a notice (exit 0); present with matching hash
   produces `"corpus binding: VERIFIED"` as a notice; present with mismatched
   hash fails with `"corpus binding hash mismatch: ..."` (exit 1); present with
   no attestation supplied fails with `"corpus binding: PRESENT-BUT-UNVERIFIED
   (supply --corpus-attestation)"` (exit 1, fail-closed, skip-as-pass forbidden
   per spec 200 FR-004 posture).

## Single implementation PR

There is no phase split. FR-001, FR-002, FR-003, FR-004 are all self-contained
within factory-engine (Rust only, no cross-repo coordination, no platform
migration). All four land in one PR.

---

## Step-by-step implementation

### Step 1: `governance_certificate.rs`: new `CorpusBinding` struct and cert field (FR-001)

Files: `crates/factory-engine/src/governance_certificate.rs`

**Version history block.** Extend the doc-comment on `CERTIFICATE_VERSION`:

```text
1.6.0 (spec 218 FR-001) added the optional corpus_binding block:
  { corpus_attestation_hash, spec_spine_version }, recording by reference the
  spec-spine ledger-seal attestation (spec 023-ledger-seal) in effect at run
  emission. Inside the hash + signature (bound at emission). Absent certs still
  verify; absent is a named "unbound" state, not an error. Skipped in
  serialisation when absent so unbound certs remain byte-identical to 1.5.0
  payloads (only the version string differs).
```

**New struct.** Add after `PlatformCountersign` and before `ConsumedOverride`:

```rust
/// Spec 218 FR-001: the corpus attestation binding.
///
/// Records, by reference, the spec-spine ledger-seal attestation
/// (spec 023-ledger-seal) in effect at the time the run certificate was
/// emitted. The `corpus_attestation_hash` is the SHA-256 of the canonical
/// `CorpusAttestation` JSON (produced by calling
/// `spec_spine_core::attest::attestation_hash` on the supplied attestation).
/// The `spec_spine_version` is the tool version stamp embedded in the
/// attestation's `tool.version` field.
///
/// This field is INSIDE `certificate_hash` and `cert_signature` (bound at
/// emission), so tampering with the binding is caught by the cert's own
/// signature check. Contrast with `platform_countersign`, which is applied
/// POST-emission on sync-back and is explicitly EXCLUDED from both the hash
/// and the signature by zeroing it before canonicalisation.
///
/// When absent the cert is in the named "unbound" state. Promotion to
/// required is deferred (spec 218 Out-of-scope residual R-2).
/// Legacy certs without the field still verify.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CorpusBinding {
    /// SHA-256 hex of the canonical `CorpusAttestation` JSON.
    pub corpus_attestation_hash: String,
    /// `spec-spine` tool version that produced the attestation.
    pub spec_spine_version: String,
}
```

**Field on `GovernanceCertificate`.** Add immediately before `consumed_overrides`:

```rust
/// Spec 218 FR-001: chain edge to the spec-spine ledger seal. The cert
/// builder populates this from a hash it is GIVEN (via
/// `OAP_CORPUS_ATTESTATION_PATH`); the cert crate never recomputes the
/// corpus. Absent = "unbound" (named, legible, never silently equivalent
/// to bound + verified).
#[serde(default, skip_serializing_if = "Option::is_none")]
pub corpus_binding: Option<CorpusBinding>,
```

**CertificateBuilder.** Add `corpus_binding: Option<CorpusBinding>` to the
builder struct (defaulting to `None` in `new()`). Add the method:

```rust
/// Spec 218 FR-001: bind the corpus attestation hash and the spec-spine
/// tool version into the certificate (inside hash + signature). The hash is
/// the SHA-256 of the canonical `CorpusAttestation` JSON, produced by
/// calling `spec_spine_core::attest::attestation_hash` on the attestation
/// object. The builder DOES NOT call `attest` or `verify_recompute`; the
/// hash is always a supplied value, never derived inside this method.
pub fn corpus_binding(
    mut self,
    hash: impl Into<String>,
    spec_spine_version: impl Into<String>,
) -> Self {
    self.corpus_binding = Some(CorpusBinding {
        corpus_attestation_hash: hash.into(),
        spec_spine_version: spec_spine_version.into(),
    });
    self
}
```

Wire `self.corpus_binding` into the `GovernanceCertificate` construction
inside `build()`, alongside the other optional fields.

**Why inside the hash + signature:** `corpus_binding` is content bound at
emission, like `admitted_envelope_hash`. Contrast with `platform_countersign`:
that field is patched in POST-emission on sync-back and is excluded from
`compute_certificate_hash` and `compute_certificate_signature` by zeroing it
before canonicalisation. `corpus_binding` is populated BEFORE hashing so it
travels inside the Ed25519 signature. A regulator with the attestation file can
independently verify the hash link without trusting factory-engine's output.

Verify: `cargo test --manifest-path crates/factory-engine/Cargo.toml`
(existing round-trip test for additive-field invariant must stay green;
new tests added in Step 6).

### Step 2: `factory_run.rs`: env-var read path (FR-002 builder reads)

Files: `crates/factory-engine/src/bin/factory_run.rs`

Add a `resolve_corpus_binding()` helper (called inside `emit_certificate`
before the `CertificateBuilder` is finalised):

```rust
const ENV_CORPUS_ATTESTATION_PATH: &str = "OAP_CORPUS_ATTESTATION_PATH";

fn resolve_corpus_binding() -> Option<factory_engine::governance_certificate::CorpusBinding> {
    let path_str = std::env::var(ENV_CORPUS_ATTESTATION_PATH).ok()?;
    let raw = match std::fs::read_to_string(&path_str) {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "Warning: {ENV_CORPUS_ATTESTATION_PATH}={path_str} unreadable: {e}                  (cert will be unbound)"
            );
            return None;
        }
    };
    let attestation: spec_spine_types::attest::CorpusAttestation =
        match serde_json::from_str(&raw) {
            Ok(a) => a,
            Err(e) => {
                eprintln!(
                    "Warning: {ENV_CORPUS_ATTESTATION_PATH}={path_str} invalid JSON: {e}                      (cert will be unbound)"
                );
                return None;
            }
        };
    let hash = match spec_spine_core::attest::attestation_hash(&attestation) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Warning: attestation_hash failed: {e} (cert will be unbound)");
            return None;
        }
    };
    Some(factory_engine::governance_certificate::CorpusBinding {
        corpus_attestation_hash: hash,
        spec_spine_version: attestation.tool.version,
    })
}
```

Call `.corpus_binding(hash, version)` on the builder when
`resolve_corpus_binding()` returns `Some`. When it returns `None`, emit:

```
notice: corpus binding: UNBOUND (OAP_CORPUS_ATTESTATION_PATH not set; set to
the path of a spec-spine attestation artifact to bind the run cert to the corpus)
```

This follows the unsealed-notice pattern from `verify_certificate_with_platform`
(visible, never fatal at run time).

Rationale for env-var approach: `OAP_SIGNING_KEY` and `OAP_SIGNING_KEY_PATH`
are the direct precedents in this crate. Env vars carrying optional proof
material paths are the established OAP pattern for late-bound, operator-supplied
artifacts. The attestation is produced by a separate CI step or operator tool
invocation and handed to the run as an artifact path, exactly as signing keys
are.

Verify: `cargo build --release --manifest-path crates/factory-engine/Cargo.toml
--bin factory-run` plus the binding tests in Step 6.

### Step 3: `deny.toml`: cargo-deny ban on `spec-spine-cli` (FR-002 crate guard)

Files: `deny.toml`

Add to `[bans] deny`:

```toml
deny = [
    # Spec 218 FR-002: the spec-spine CLI crate contains corpus-compile
    # and attestation-emit functions (attest, verify_recompute). factory-engine
    # may depend on spec-spine-core (for attestation_hash, registry reads, and
    # type deserialisation) but must never depend on the CLI binary crate, which
    # would pull the full emit/compile surface into the dependency graph. This ban
    # is the crate-level layer of the FR-002 boundary gate; the symbol-level
    # layer lives in the ci-supply-chain lint step.
    { name = "spec-spine-cli", reason = "spec 218 FR-002: factory-engine reads (attestation_hash) but must not depend on the emit CLI" },
]
```

Confirm the exact published crate name before merging (the binary installs as
`spec-spine`; run `cargo search spec-spine` to check whether the Cargo package
name is `spec-spine-cli` or another variant).

Verify: `cargo deny --manifest-path Cargo.toml check bans` must pass with the
current dep graph. Manually adding `spec-spine-cli` as a dev-dependency and
re-running must FAIL the check.

### Step 4: `clippy.toml` disallowed-methods (FR-002 symbol guard)

> DECISION (checkpoint 1, user-selected 2026-06-21): the symbol-level layer is
> clippy `disallowed-methods`, NOT a grep step. It does real path resolution
> (no false matches on comments/strings) and rides the existing
> `-D warnings` clippy gate, so it needs NO workflow edit.

Files: `clippy.toml` (NEW, repo root)

```toml
# Spec 218 FR-002 (read, never recompute): the governance-cert crate may call
# the reader-side `spec_spine_core::attest::attestation_hash` (pure payload hash
# over a SUPPLIED attestation), but must NEVER call the corpus-recompute / emit
# functions. clippy resolves these by path, so this is a compile-time fact, not
# a review convention. Complements the cargo-deny crate ban on `spec-spine-cli`
# (deny.toml). Workspace-wide: no OAP crate should ever recompute a corpus.
disallowed-methods = [
    # attestation-emit (attest/verify_recompute are module-level; the *_json
    # wrappers are crate-root, so the paths differ). These four are
    # factory-engine-exclusive, so a workspace-wide ban constrains the cert crate.
    { path = "spec_spine_core::attest::attest", reason = "spec 218 FR-002" },
    { path = "spec_spine_core::attest::verify_recompute", reason = "spec 218 FR-002" },
    { path = "spec_spine_core::attest_json", reason = "spec 218 FR-002" },
    { path = "spec_spine_core::verify_attestation_json", reason = "spec 218 FR-002" },
]
```

The reader seam (`attestation_hash`, `load_committed_registry`) is deliberately
NOT banned. clippy matches by resolved DefId, so banning the canonical path
catches re-export aliases too.

NOTE (corpus-compile residual): `compile` / `compile_json` are NOT in the ban.
`clippy.toml` is workspace-wide, and `crates/opc-decomposition-pipeline`
legitimately compiles the corpus, so a workspace ban is impossible. The cert
crate's non-recompute of the corpus is assured architecturally
(`load_committed_registry`, never `compile`) plus the cargo-deny crate ban.
Caught in CI on the first push (workspace clippy), since `clippy.toml` bans apply
to every workspace member, not just factory-engine.

**Why no workflow edit.** CI gates `crates/**` via `.github/actions/rust-ci`
(`ci-crates.yml`), which runs `cargo clippy --workspace ... -- -D warnings`
(clippy-flags default `-D warnings`, verified action.yml:78). `clippy::disallowed_methods`
is warn-by-default (style group), so `-D warnings` promotes it to a hard error.
The Makefile `ci-rust` path (`cargo clippy --workspace --manifest-path crates/Cargo.toml -- -D warnings`)
matches. Both invoke from repo root, so a repo-root `clippy.toml` is honored by
both. `clippy.toml` is NOT a codebase-index hashed input, so it does not trip the
staleness gate (it still needs a coupling edge; see below).

Verify: add a throwaway `spec_spine_core::attest::attest(...)` call in
`factory-engine/src/`, run `cargo clippy --workspace --manifest-path crates/Cargo.toml -- -D warnings`,
confirm it FAILS naming `disallowed_methods`; remove the throwaway and confirm it
passes. Confirm repo-root placement is honored (if not, fall back to
`crates/clippy.toml`).

### Step 5: `verify_certificate.rs` and `governance_certificate.rs` (FR-003 / FR-004)

Files:
- `crates/factory-engine/src/governance_certificate.rs` (library function)
- `crates/factory-engine/src/bin/verify_certificate.rs` (CLI flag and dispatch)

**Library function.** Add to `governance_certificate.rs`:

```rust
/// Spec 218 FR-003 / FR-004 outcome variants.
#[derive(Debug, PartialEq, Eq)]
pub enum CorpusBindingOutcome {
    /// No `corpus_binding` field in the cert (named "unbound" state).
    Unbound,
    /// `corpus_binding` present and hash matches the supplied attestation.
    Verified { hash: String },
}

/// Spec 218 FR-003 / FR-004: verify the corpus binding link by reference.
///
/// Outcomes:
/// - Absent binding: `Ok(CorpusBindingOutcome::Unbound)` (notice, not error).
/// - Present + attestation supplied + hashes match: `Ok(Verified)`.
/// - Present + attestation supplied + mismatch: `Err(...)` with named diagnostic.
/// - Present + no attestation supplied: `Err(...)` "PRESENT-BUT-UNVERIFIED"
///   (fail-closed; skip-as-pass is forbidden per spec 200 FR-004 posture).
///
/// This function calls ONLY `spec_spine_core::attest::attestation_hash`.
/// It never calls `attest` or `verify_recompute`. Verifying the attestation's
/// own truth (corpus recompute or detached seal) is the caller's responsibility
/// via `spec-spine verify-attestation` separately.
pub fn verify_corpus_binding(
    cert: &GovernanceCertificate,
    attestation_path: Option<&Path>,
) -> Result<CorpusBindingOutcome, String> {
    match (&cert.corpus_binding, attestation_path) {
        (None, _) => Ok(CorpusBindingOutcome::Unbound),
        (Some(binding), Some(path)) => {
            let raw = std::fs::read_to_string(path)
                .map_err(|e| format!("cannot read corpus attestation {}: {e}", path.display()))?;
            let attestation: spec_spine_types::attest::CorpusAttestation =
                serde_json::from_str(&raw)
                    .map_err(|e| format!("invalid CorpusAttestation JSON: {e}"))?;
            let actual_hash = spec_spine_core::attest::attestation_hash(&attestation)
                .map_err(|e| format!("attestation_hash failed: {e}"))?;
            if actual_hash == binding.corpus_attestation_hash {
                Ok(CorpusBindingOutcome::Verified { hash: actual_hash })
            } else {
                Err(format!(
                    "corpus binding hash mismatch: cert claims {}, attestation hashes to {}",
                    binding.corpus_attestation_hash, actual_hash
                ))
            }
        }
        (Some(_), None) => Err(
            "corpus binding: PRESENT-BUT-UNVERIFIED              (supply --corpus-attestation <file> to verify the link;              spec-spine verify-attestation verifies the attestation's own truth)"
                .into(),
        ),
    }
}
```

**CLI flag.** Add to `Cli` in `verify_certificate.rs`:

```rust
/// Path to a CorpusAttestation JSON file (spec-spine ledger-seal output).
/// Present + matching hash: reports VERIFIED. Present + mismatched: fails
/// (exit 1). Cert has binding but no file supplied: fails (exit 1).
/// Cert has no binding: reports UNBOUND (notice, exit 0).
/// The attestation's OWN truth is verified by spec-spine verify-attestation,
/// not by this tool (spec 218 FR-003 / AC-5).
#[arg(long)]
corpus_attestation: Option<PathBuf>,
```

**Dispatch in `main()`.** After `verify_certificate_with_platform`:

```rust
let corpus_result = verify_corpus_binding(&cert, cli.corpus_attestation.as_deref());
match &corpus_result {
    Ok(CorpusBindingOutcome::Unbound) => {
        result.notices.push("corpus binding: UNBOUND".into());
    }
    Ok(CorpusBindingOutcome::Verified { hash }) => {
        result.notices.push(format!(
            "corpus binding: VERIFIED (attestation hash: {}...)",
            &hash[..16.min(hash.len())]
        ));
    }
    Err(e) => {
        result.errors.push(e.clone());
    }
}
result.valid = result.errors.is_empty();
```

Update the final summary output to print the corpus binding state, mirroring
the platform seal line already there.

Verify: `cargo build --release --manifest-path crates/factory-engine/Cargo.toml
--bin verify-certificate` must succeed.

### Step 6: Tests (AC-1 through AC-5)

Files: `crates/factory-engine/src/governance_certificate.rs` (new
`mod corpus_binding_tests` inside `#[cfg(test)]`)

- **AC-1 / corpus_binding is inside the hash + signature:** Build two certs
  identical except one has `.corpus_binding("abc...", "0.8.0")` and the other
  does not. Assert the two `certificate_hash` values differ. Assert the JSON
  of the bound cert contains `"corpusBinding"` (camelCase serialisation).
- **AC-2 / verify-certificate four outcomes:** Use a tempdir with a synthetic
  `CorpusAttestation` JSON (minimal valid struct). (a) Call `verify_corpus_binding`
  with a matching path: expect `Verified`. (b) Swap the attestation for one
  with different content: expect `Err` containing "mismatch". (c) Binding
  present, no path supplied: expect `Err` containing "PRESENT-BUT-UNVERIFIED".
  (d) No binding, no path: expect `Unbound`.
- **AC-3 / additive invariant:** A cert built WITHOUT `.corpus_binding(...)`
  must NOT contain `"corpusBinding"` in its serialised JSON (guards
  `skip_serializing_if = "Option::is_none"`).
- **AC-4 / legacy cert still verifies:** Deserialise a minimal cert JSON
  that has no `"corpusBinding"` key (a 1.5.0-era payload shape) and assert
  `verify_certificate` returns valid. This proves backward compatibility.
- **AC-5 / no recompute in verify path:** Document in the test comment that
  `verify_corpus_binding` calls only `attestation_hash`. The CI lint from
  Step 4 is the enforcement; the comment names the invariant for future readers.

### Step 7: featuregraph golden regen and codebase index

Files: `crates/featuregraph/tests/golden/features_graph.json`,
`.derived/codebase-index/by-spec/*.json`

Spec 218 adds a new spec row to the featuregraph golden (same precedent as specs
196, 194, 193, 187, 183, 209). After all Rust changes compile cleanly:

```bash
make pr-prep
```

This regenerates the codebase index and runs the coupling gate against
`origin/main`. Also regenerate the featuregraph golden per the standard flow
for specs declaring an `extends: 034` edge. Commit both the index shards and
the updated golden in the same commit (the coupling gate and the index staleness
gate both check these; bitten on PR #391 when the index shards were forgotten).

---

## Spec-prose amendment required (checkpoint item)

**Spec 218 "The invariant" and FR-002** contain the sentence:

> "Per ADR 0002 section 2 the cert crate already depends only on the registry
> reader (`open_agentic_spec_registry_reader`, the consumer API: `load` and
> `find_by_id`, declared at `crates/factory-engine/Cargo.toml:18-20`), never
> on the compiler."

This is stale post-spec-217. `open_agentic_spec_registry_reader` does not exist.
factory-engine depends on `spec-spine-core = "0.8.0"`, which re-exports `attest`,
`attest_json`, `verify_recompute`, and `attestation_hash` all from its crate root.

Required amendment: replace the stale crate-name reference with the post-217
reality and describe the two-layer enforcement (cargo-deny ban on `spec-spine-cli`
plus symbol-level lint). This is a legitimate spec refinement per the spec's own
"sketch, refine before implementation" language, not adversarial drift: the
change makes the spec more truthful about the mechanism, not less.

---

## Coupling edges (land in the implementation PR)

> CORRECTED 2026-06-21 after the governed `by-authority` read: `deny.toml` is
> `establishes:`-owned by spec 116, so the edge is `extends: 116` (additive),
> NOT `refines:` (the architect's first pass). The grep-in-workflow gap is gone
> (clippy.toml replaces it). `factory-engine/Cargo.toml` is dropped: the
> boundary now lives in `deny.toml` + `clippy.toml`, and we do not edit the cert
> crate's manifest (its deps are already correct: `spec-spine-core` +
> `spec-spine-types` present, `spec-spine-cli` absent).

Every file the implementation touches, mapped to its correct edge:

| File | Correct edge | Note |
|------|-----------------|------|
| `crates/factory-engine/src/governance_certificate.rs` | `extends: 168, additive` | Declared, ok |
| `crates/featuregraph/tests/golden/features_graph.json` | `extends: 034, additive` | Declared, ok |
| `crates/factory-engine/src/bin/verify_certificate.rs` | `refines: corpus-binding-verify` | Declared, ok |
| `crates/factory-engine/src/bin/factory_run.rs` | `refines: corpus-binding-read-path` | ADD aspect |
| `deny.toml` | `extends: 116, additive` | ADD edge (116 establishes it; ban list is its designed extension point, deny.toml:97-99) |
| `clippy.toml` (NEW) | `establishes:` | ADD (new file 218 brings into existence; unowned today) |
| `crates/factory-engine/Cargo.toml` | (removed) | DROP the stale `refines: read-not-recompute-dependency-gate` edge; file not edited |
| `specs/218-run-cert-corpus-binding/spec.md` | self (amendment) | Co-lands same PR |

### Required frontmatter for spec 218 (final shape)

```yaml
extends:
  - spec: "168-per-project-governance-certificate"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  - spec: "116-supply-chain-policy-gates"
    nature: additive
    unit: { kind: file, path: deny.toml }
establishes:
  - unit: { kind: file, path: clippy.toml }
refines:
  - aspect: "corpus-binding-verify"
    unit: { kind: file, path: crates/factory-engine/src/bin/verify_certificate.rs }
  - aspect: "corpus-binding-read-path"
    unit: { kind: file, path: crates/factory-engine/src/bin/factory_run.rs }
```

(`depends_on` and `references` unchanged. The stale `refines:
read-not-recompute-dependency-gate` on `factory-engine/Cargo.toml` is removed;
that aspect's intent is now carried structurally by the `extends: 116` deny.toml
row and the `establishes:` clippy.toml file.)

---

## Verification commands

```bash
# Full factory-engine test suite (includes new corpus-binding tests)
cargo test --manifest-path crates/factory-engine/Cargo.toml

# Build verify-certificate binary
cargo build --release \
  --manifest-path crates/factory-engine/Cargo.toml \
  --bin verify-certificate

# Build factory-run binary (confirm corpus binding wiring compiles)
cargo build --release \
  --manifest-path crates/factory-engine/Cargo.toml \
  --bin factory-run

# cargo-deny check (confirm spec-spine-cli ban is syntactically valid
# and the current dep graph does not violate it)
cargo deny --manifest-path Cargo.toml check bans

# Symbol-level lint (must produce no output; non-zero exit = violation)
grep -rn --include='*.rs' \
  -E '\battest\b\s*\(|\battest_json\b\s*\(|\bverify_recompute\b\s*\(' \
  crates/factory-engine/src/

# Regenerate codebase index and run coupling gate vs origin/main
make pr-prep
```

---

## Checkpoints (all resolved 2026-06-21)

**Checkpoint 1 (FR-002 mechanism): RESOLVED.** User selected clippy
`disallowed-methods` as the symbol-level layer (Step 4), on top of the
cargo-deny crate ban on `spec-spine-cli` (Step 3). Two layers; neither alone
sufficient. No CI workflow edit needed (the existing `-D warnings` clippy gate
promotes the warn-by-default lint to an error).

**Checkpoint 2 (spec-prose amendment): ACCEPTED, co-lands.** "The invariant"
and FR-002 get the stale `open_agentic_spec_registry_reader` reference replaced
with the post-217 reality (single published `spec-spine-core`) and the two-layer
mechanism described. Legitimate refinement (makes the spec more truthful), not
adversarial drift.

**Checkpoint 3 (coupling edges): RESOLVED, corrected.** The governed
`by-authority` read showed `deny.toml` is `establishes:`-owned by spec 116, so
the edge is `extends: 116` (additive, the ban list's designed extension point),
not `refines:`. `clippy.toml` is a new unowned file → `establishes:`.
`factory_run.rs` → `refines: corpus-binding-read-path`. The stale
`factory-engine/Cargo.toml` edge is dropped (file not edited). See the corrected
"Required frontmatter for spec 218 (final shape)" above.

**Checkpoint 4 (spec-spine-cli crate name): RESOLVED.** Confirmed `name =
"spec-spine-cli"` in the DevWork spec-spine `crates/spec-spine-cli/Cargo.toml`,
and factory-engine does not pull it transitively today, so the ban is clean
against the current graph.
