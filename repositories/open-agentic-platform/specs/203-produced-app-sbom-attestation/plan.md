# Implementation Plan: Produced-App SBOM and Dependency-Audit Attestation (spec 203)

> Refines the FR sketch into firm decisions. The spec's FR-001..FR-005 and
> AC-1..AC-4 are "sketch, refine before implementation"; this plan makes them
> buildable. Every decision is grounded in the actual struct shape of
> `governance_certificate.rs` (as-shipped post-spec-218) and mirrors the
> "read, never recompute" discipline established in spec 218.

---

## Cross-lane handoff: kernel/emit findings for the Dev2 lane

Spec 203 has two surfaces. The **cert-binding / verify** surface
(`governance_certificate.rs`, `verify_certificate.rs`) is the audit-chain
lane's (specs 207/218/219); the **emission** surface (FR-001/FR-002, the
`emit.rs` / kernel / scaffold-stage path) belongs to the **kernel/emit (Dev2)
lane**. This session scoped the spec and settled the cert-side contract; the
emission half is handed to Dev2 with the findings below. They are also relevant
to spec 220 (Dev2), whose "fire the emitter as the terminal step of a tenant
run" hits the same completion-timing question.

**F1 (verified): `emit_kernel` is born-with *seeding*, not scaffold
completion.** `emit_project_kernel` -> `emit_kernel`
(`crates/factory-engine/src/kernel_emission/emit.rs:83`) creates `target_root`
fresh (`create_dir_all`, lines 89-90) and `refuse_existing_kernel` aborts if a
kernel already exists (lines 199-206). Its own doc states the pipeline timing is
the caller's responsibility and "the method itself is pure"
(`crates/factory-engine/src/engine.rs:340-342`). At seeding time the target has
no `package-lock.json`. Therefore FR-001's "BOM derived from the committed
lockfile of the scaffold output, at scaffold completion" MUST NOT hook inside
`emit_kernel`: doing so produces an empty/stub BOM on every run (satisfying
AC-3's absence path but silently defeating FR-001/AC-1). The first-draft Phase 2
below (hook = `emit_kernel` step 7) is corrected on this basis; see the
correction note at Phase 2 and Risk #3.

**F2 (open question Dev2 must resolve): lockfile timing.** Where, in the s0-s6
stage list, is `emit_project_kernel` actually called, and does a committed
`package-lock.json` exist in `scaffolded_paths` / the target tree at that point?
If the adapter scaffold commits a lockfile before emission, a completion-time
hook can read it. If the lockfile only appears after a later `npm install` step,
BOM emission must hook at/after that step (candidate: `s6h-final-validation`,
the terminal scaffold stage, `crates/factory-engine/src/engine.rs:448`). This
trace was intentionally left to the kernel/emit lane, not resolved here.

**F3 (coupling/authority implication).** Spec 203 frontmatter declares
`refines: kernel-sbom-vending -> crates/factory-engine/src/kernel_emission/emit.rs`.
If F2 resolves to "emission lives at a terminal scaffold stage" (engine.rs or a
stage handler) rather than `emit.rs`, the coupling gate (spec 127) fires on the
real hook file unless the authority edge is repointed there. Whoever implements
the emission must reconcile the `refines` edge with the actual hook site before
the PR.

**F4 (cert-side contract, settled this session, ready for Dev2 to feed).** The
verify/cert-binding half is decoupled from emission: a
`SbomArtifactBinding { bom_hash, audit_hash, bom_tool_version }` block parallel
to spec 218's `CorpusBinding`, a read-never-recompute `verify_sbom_binding()`
with the same four-outcome / fail-closed pattern as `verify_corpus_binding`, a
`--sbom-dir` flag on `verify-certificate`, and a cert version bump 1.6.0 ->
1.7.0. Dev2's emission produces the three values this binding consumes. See
Decision (e) and Phase 1.

---

## Ground state (what already exists, 2026-06-21)

After spec 218 merged, `GovernanceCertificate` (line 78) carries:

- `corpus_binding: Option<CorpusBinding>` (lines 136-144): the 218 binding
  block. This is the direct analogue for FR-003's sbom-artifact-binding.
- `CertificateBuilder::corpus_binding(hash, version)` (lines 698-714): the
  builder method.
- `verify_corpus_binding()` in `governance_certificate.rs` (shipped) and wired
  into `verify_certificate.rs` CLI (lines 136-155 of that file).

Spec 218's `CorpusBinding` pattern is the direct precedent for spec 203's
`SbomArtifactBinding`. The approach: add a parallel optional block to the cert,
bind two hashes (BOM content hash + audit artifact content hash), extend
`verify-certificate` with a `--sbom-dir <dir>` flag that checks both.

The kernel emission surface (`emit.rs`) is the hook point for FR-001 (BOM
emission at scaffold completion). `emit_kernel()` already writes `.factory/toolchain.yaml`
and `Makefile`; the BOM sidecar and audit artifact join this list.

---

## Decision summary

### Decision (a): BOM sidecar location + naming in the produced tree

**Decision:** `.factory/sbom.cdx.json`

Rationale: OAP's own BOMs are named `sbom-*.cdx.json` at repo root (specs 116/117);
the produced app's analogous artifact lives under `.factory/` alongside
`toolchain.yaml` (the spec 168 kernel artifacts). Keeping SBOM evidence in
`.factory/` co-locates all kernel-emitted governance artifacts in one directory,
making the audit trail coherent. Using `.factory/sbom.cdx.json` (singular, no
per-target suffix) is correct: the scaffold target is a single npm project at
this stage, unlike OAP's multi-platform release. The audit artifact is named
`.factory/audit.json`.

Rejected: placing at repo root (pollutes the produced project's own root);
naming `sbom-produced.cdx.json` (no precedent, more to type in the cert verify
path); per-stage subdirectory under `.factory/` (over-engineering for one npm
target).

### Decision (b): Scanner tool choice + how absence is represented

**Decision:** Use `npm audit --json` (built-in, no external binary pin required
at scaffold time) for the audit artifact. Use `@cyclonedx/cyclonedx-npm` for the
BOM (the same npm-native, lockfile-driven CycloneDX generator that the OAP
supply-chain flow already applies to npm workspaces).

Rationale for `@cyclonedx/cyclonedx-npm`:

- Reads from `package-lock.json` (or `pnpm-lock.yaml`) directly; no
  binary install beyond npx invocation; same tool family as OAP's
  `anchore/sbom-action` (which shells out to syft + cyclonedx-json format).
  The produced app is an npm project, so the npm-native generator is the
  natural fit.
- syft is NOT chosen for the produced-app kernel emission path because syft
  is a compiled binary that would need to be vendored or pinned separately.
  The kernel emission Rust code cannot shell out to syft at scaffold time on
  the user's machine without knowing syft is present. `@cyclonedx/cyclonedx-npm`
  is invocable via `npx` (the same mechanism the kernel already uses for
  spec-spine), zero additional binary dependency.
- Known gotcha from prior work: syft 1.43.0 `--exclude` is broken for
  `target/`; the OAP release workflow uses a jq post-filter. This complexity
  is irrelevant for an npm-only produced-app scan (no Rust `target/` directory
  in the scaffold output), but still a reason to avoid syft here.

**Absence representation:** The audit artifact is a typed JSON struct with a
discriminated union:

```
{ "tool": "...", "tool_version": "...", "ran_at": "<ISO-8601>",
  "status": "present" | "absent",
  "findings": [...], "severity_counts": {...},  // when status == "present"
  "reason": "<human-readable why>" }            // when status == "absent"
```

When `npm audit --json` is not available or fails non-audit-semantically (i.e.,
the binary is missing or the invocation errors before producing a report), the
artifact is written with `status: "absent"` and a `reason` field. A non-zero
exit from `npm audit --json` due to found vulnerabilities still produces a
`status: "present"` artifact (the exit code reports findings; findings are
evidence, not a skip signal). This honours the spec 200 FR-004 posture: absence
of a scanner is visible evidence of a gap, never a silent skip.

### Decision (c): Determinism mechanism

**Decision:** Two-layer determinism.

**Layer 1 (BOM content):** `@cyclonedx/cyclonedx-npm` with `--reproducible`
flag (available in cyclonedx-cyclonedx-npm >=1.3.0; strips `serialNumber` UUID
and `metadata.timestamp` from the output). Same lockfile input + same
`@cyclonedx/cyclonedx-npm` version + same `--reproducible` flag
yields byte-identical BOM. The `--reproducible` flag is the correct mechanism;
it is the CycloneDX ecosystem's answer to this problem and does not require
post-processing.

**Layer 2 (component sort):** `@cyclonedx/cyclonedx-npm` sorts components
deterministically by PURL when `--reproducible` is set (library behaviour, not
a post-filter). No jq post-sort is needed.

**What is NOT used:** The `canonical-json` Rust crate is unnecessary here; the
BOM is produced by a JS tool and hashed as bytes by factory-engine's Rust code
using the same `sha256_bytes()` helper already used in `governance_certificate.rs`
(line 1271). The "same lockfile" invariant is what spec 203 AC-4 requires; the
tool + flag combination is how that invariant is satisfied.

**Audit artifact determinism:** `npm audit --json` output is inherently
non-deterministic across database versions (the advisory database changes). The
content hash of the audit artifact reflects the state of the advisory database
at scaffold time, which is the intended semantics: it attests "scanned against
THIS advisory database at THIS time." This is not a violation of constitution
Principle IV because the audit artifact records a time-sensitive fact (findings),
not a reproducible build output. AC-4 applies only to the BOM, not the audit
artifact; this distinction is stated explicitly in the AC-4 test.

### Decision (d): Typed artifact schema(s)

**BOM artifact:** A CycloneDX 1.6 JSON file (standard format). Factory-engine
does not parse the BOM content; it reads it as bytes and hashes it.

**Audit artifact** (`SbomAuditRecord`): A new Rust struct in
`governance_certificate.rs` (beside the other artifact structs), serialised to
`.factory/audit.json`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SbomAuditRecord {
    pub tool: String,
    pub tool_version: Option<String>,
    pub ran_at: String,        // ISO-8601 UTC
    pub status: SbomAuditStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub findings: Option<Vec<SbomAuditFinding>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity_counts: Option<SbomSeverityCounts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,  // populated when status == Absent
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SbomAuditStatus { Present, Absent }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SbomSeverityCounts {
    pub critical: u32, pub high: u32, pub moderate: u32,
    pub low: u32, pub info: u32,
}

// SbomAuditFinding holds a minimal subset: advisory ID, severity, package name.
// Full npm audit JSON is NOT embedded; it is too large and non-deterministic.
// The audit record is evidence of scanning, not a policy gate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SbomAuditFinding {
    pub advisory_id: String,
    pub severity: String,
    pub package: String,
}
```

The audit artifact JSON is what factory-engine writes (via a Rust function that
invokes `npm audit --json`, parses the stdout, and serialises a `SbomAuditRecord`).
This keeps the emitted artifact's schema under factory-engine's ownership rather
than being an opaque blob of whatever `npm audit --json` returns (which changes
between npm versions).

### Decision (e): How the two hashes enter the cert (binding shape)

**Decision:** Parallel to `CorpusBinding` (spec 218), add a new
`SbomArtifactBinding` struct and an optional field on `GovernanceCertificate`.
Do NOT reuse or extend `CorpusBinding`; BOM + audit are distinct artifacts with
distinct semantics from the corpus attestation.

```rust
/// Spec 203 FR-003: the BOM + audit artifact content binding.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SbomArtifactBinding {
    /// SHA-256 hex of the byte content of `.factory/sbom.cdx.json`.
    pub bom_hash: String,
    /// SHA-256 hex of the byte content of `.factory/audit.json`.
    pub audit_hash: String,
    /// `@cyclonedx/cyclonedx-npm` semver used to generate the BOM.
    pub bom_tool_version: String,
}
```

Field on `GovernanceCertificate`:

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub sbom_artifact_binding: Option<SbomArtifactBinding>,
```

This field is INSIDE `certificate_hash` and `cert_signature` (bound at emission),
same as `corpus_binding`. Cert version bumps from `1.6.0` to `1.7.0`.
Backward compatibility: certs without the field still verify (skip_serializing_if).
The builder method is `sbom_artifact_binding(bom_hash, audit_hash, bom_tool_version)`.

**Why not the existing `artifact_hashes` BTreeMap on `StageRecord`?** The per-stage
`artifact_hashes` (line 402) records stage outputs indexed by `<stage_id>/<file>`.
The BOM + audit artifact are emitted at kernel-emission time, before any pipeline
stage runs. They are governance artifacts about the produced project's dependencies,
not stage output artifacts. Placing them in a top-level binding struct (parallel
to `corpus_binding`) gives them the correct semantic status and makes them legible
in the cert JSON without knowing the stage structure.

---

## Refined FR table

| FR | Aspect | Files (line anchors where known) | Authority status |
|----|--------|----------------------------------|-----------------|
| FR-001 | `kernel-sbom-vending`: emit BOM + audit artifact at scaffold completion | `crates/factory-engine/src/kernel_emission/emit.rs` (hook at line 160, after scaffold-claim retirement comment) | **In-authority** (spec 203 `refines:` declared) |
| FR-002 | `sbom-audit-artifact`: typed audit artifact struct + npm-audit invocation | `crates/factory-engine/src/governance_certificate.rs` (new structs after `CorpusBinding` at line ~214) and `crates/factory-engine/src/kernel_emission/emit.rs` (invocation logic) | **In-authority** for both (both declared in `refines:`). |
| FR-003 | `sbom-artifact-binding`: cert binding struct + builder + `verify-certificate` detection | `crates/factory-engine/src/governance_certificate.rs` | **In-authority** (spec 203 `refines: sbom-artifact-binding` declared) |
| FR-003 (verify) | `verify-certificate` SBOM binding check | `crates/factory-engine/src/bin/verify_certificate.rs` | **Needs frontmatter edge** (file NOT currently declared in spec 203). See Frontmatter Amendment section. |
| FR-004 | Tenant CI lockfile/BOM parity gate: EXTERNAL + 209-sequenced | Lives in the npm tenant CI template (external to OAP) per spec 203 frontmatter note lines 45-51 | **Out of OAP scope** in this PR. Define gate contract in spec prose; wire external CI in the 209-sequenced phase. See Blocked section. |
| FR-005 | Vended-tool pinning via `.kernel-version` mechanism | `crates/factory-engine/src/kernel_emission/version.rs` (read existing `CertificateToolchainRef`), `.kernel-version` stamp | BOM tool version recorded in `SbomArtifactBinding.bom_tool_version`; `.kernel-version` itself does NOT need a new field (deferred as residual R-1). No `version.rs` edit in this PR. |
| FR-005 (toolchain pin) | BOM tool invocation documented in `toolchain.yaml` | `crates/factory-engine/templates/kernel/toolchain.yaml.tmpl` | **Needs frontmatter edge** if that file is edited. See Frontmatter Amendment section. |

---

## Frontmatter amendment prerequisites

The following spec 203 frontmatter edges are MISSING and must be added to
`specs/203-produced-app-sbom-attestation/spec.md` BEFORE or IN the implementation
PR (the coupling gate fires on any file edited without a covering edge):

1. **`crates/factory-engine/src/bin/verify_certificate.rs`**: the `verify-certificate`
   CLI gains a `--sbom-dir` flag (FR-003 verify path). Not currently declared.
   Add:
   ```yaml
   refines:
     - aspect: "sbom-verify-path"
       unit: { kind: file, path: crates/factory-engine/src/bin/verify_certificate.rs }
   ```

2. **`crates/factory-engine/templates/kernel/toolchain.yaml.tmpl`**: if the BOM
   tool invocation is added to the rendered toolchain template (recommended: document
   the `@cyclonedx/cyclonedx-npm` npx invocation that the tenant CI will use). Add:
   ```yaml
   refines:
     - aspect: "sbom-toolchain-reference"
       unit: { kind: file, path: crates/factory-engine/templates/kernel/toolchain.yaml.tmpl }
   ```
   If the toolchain template is NOT edited (tool pin documented only in spec prose),
   this edge is not needed. Resolve during implementation.

3. **`crates/factory-engine/src/kernel_emission/templates.rs`**: if the toolchain
   template rewrite also changes render context or tests. Conditional on decision
   above.

The featuregraph golden (`crates/featuregraph/tests/golden/features_graph.json`)
is already declared via `extends: 034-featuregraph-registry-scanner-fix`.

---

## Phased task breakdown

### Phase 1: Cert struct + binding + verify (FR-002 schema, FR-003, AC-2, AC-3)

This is the core of spec 203 and is entirely within `governance_certificate.rs`
and `verify_certificate.rs`. No kernel emission changes yet; provides the typed
shape that Phase 2 will populate.

**Step 1a: `governance_certificate.rs`: new structs + cert field + builder**

Files: `crates/factory-engine/src/governance_certificate.rs`

- Add `SbomAuditFinding`, `SbomSeverityCounts`, `SbomAuditStatus`,
  `SbomAuditRecord` structs (the typed audit artifact schema). Add after
  `CorpusBinding` (line ~214).
- Add `SbomArtifactBinding` struct.
- Add `sbom_artifact_binding: Option<SbomArtifactBinding>` field to
  `GovernanceCertificate`. Place immediately after `corpus_binding` (line ~144).
  Wire into `build()` and `CertificateBuilder` struct.
- Add `sbom_artifact_binding(bom_hash, audit_hash, bom_tool_version)` builder
  method (after `corpus_binding()` method, line ~714).
- Bump `CERTIFICATE_VERSION` from `"1.6.0"` to `"1.7.0"`. Extend the
  CERTIFICATE_VERSION doc comment with the 1.7.0 entry (mirror the existing
  pattern for 1.6.0 at line 56).
- Wire `self.sbom_artifact_binding` into `GovernanceCertificate` construction
  inside `build()` (line ~766). It must be INSIDE the `certificate_hash` and
  `cert_signature` computation (same as `corpus_binding`).

Verify: `cargo test --manifest-path crates/factory-engine/Cargo.toml` (existing
round-trip tests for additive-field invariant must stay green).

**Step 1b: `verify_certificate.rs`: `--sbom-dir` flag + detection**

Files: `crates/factory-engine/src/bin/verify_certificate.rs`

Add to `Cli`:

```rust
/// Directory containing the produced app's SBOM artifacts (spec 203 FR-003).
/// When supplied and the cert carries a sbomArtifactBinding, the BOM file
/// (.factory/sbom.cdx.json) and audit file (.factory/audit.json) are read,
/// hashed, and compared against the binding. Present + match: VERIFIED.
/// Present + mismatch: fails (exit 1). Cert has binding but no dir supplied:
/// fails PRESENT-BUT-UNVERIFIED (exit 1, fail-closed). Cert has no binding:
/// reports UNBOUND (notice, exit 0).
#[arg(long)]
sbom_dir: Option<PathBuf>,
```

Add `verify_sbom_binding()` function to `governance_certificate.rs` (parallel to
`verify_corpus_binding()`, same four-outcome pattern):

```rust
pub enum SbomBindingOutcome {
    Unbound,
    Verified { bom_hash: String, audit_hash: String },
}

pub fn verify_sbom_binding(
    cert: &GovernanceCertificate,
    sbom_dir: Option<&Path>,
) -> Result<SbomBindingOutcome, String> { ... }
```

The four outcomes mirror spec 218 / `verify_corpus_binding`:

- No `sbom_artifact_binding`: `Ok(Unbound)` (notice, exit 0).
- Binding present + dir supplied + both hashes match: `Ok(Verified { ... })`.
- Binding present + dir supplied + any mismatch: `Err(...)` with named diagnostic
  (reports which file mismatched: BOM or audit).
- Binding present + no dir supplied: `Err(...)` "PRESENT-BUT-UNVERIFIED
  (supply --sbom-dir <dir> to verify the SBOM and audit artifact hashes)".
  Fail-closed; skip-as-pass forbidden per spec 200 FR-004 posture.

Wire into `verify_certificate.rs` `main()` after the corpus binding check.

Verify: `cargo build --release --manifest-path crates/factory-engine/Cargo.toml --bin verify-certificate`

**Step 1c: Phase 1 tests (AC-2, AC-3)**

Files: `crates/factory-engine/src/governance_certificate.rs` (new `mod sbom_binding_tests`)

- **AC-2 / four verify outcomes:** Use a tempdir with synthetic `.factory/sbom.cdx.json`
  and `.factory/audit.json` files. (a) Matching dir: expect `Verified`. (b) Tampered
  BOM: expect `Err` containing "bom hash mismatch". (c) Tampered audit: expect
  `Err` containing "audit hash mismatch". (d) Binding present, no dir: expect
  `Err` containing "PRESENT-BUT-UNVERIFIED". (e) No binding, no dir: expect `Unbound`.
- **AC-3 / binding inside cert hash + signature:** Build two certs, one with
  `.sbom_artifact_binding(...)`, one without. Assert `certificate_hash` values differ.
  Assert the bound cert's JSON contains `"sbomArtifactBinding"` (camelCase).
- **Additive invariant:** A cert built WITHOUT `.sbom_artifact_binding(...)` must
  NOT contain `"sbomArtifactBinding"` in its serialised JSON (guards
  `skip_serializing_if = "Option::is_none"`).
- **Legacy cert backward compat:** Deserialise a minimal cert JSON with no
  `"sbomArtifactBinding"` key and assert `verify_certificate` returns valid.
- **Version bump check:** Assert `CERTIFICATE_VERSION == "1.7.0"` and that the
  doc comment references spec 203 FR-003.

---

### Phase 2: Kernel emission (FR-001, FR-002 invocation, AC-1, AC-3, AC-4)

> **CORRECTION (Handoff F1/F2, kernel/emit lane).** This phase as first drafted
> hooks emission into `emit_kernel()` step 7. That is WRONG: `emit_kernel` is
> born-with *seeding* and runs before any lockfile exists, so the BOM would be
> an empty stub on every run. Do NOT implement this phase against `emit_kernel`.
> Resolve F2 (where `emit_project_kernel` fires in s0-s6, and whether a committed
> `package-lock.json` is present at scaffold completion) first, then hook
> emission at the terminal scaffold stage (candidate `s6h-final-validation`) and
> repoint the spec 203 `refines` authority edge to the real hook file (F3). The
> step text below is retained as the artifact shape (stub-BOM fallback, absence
> handling, hashing), NOT as the hook-point recommendation.

This phase wires the emission into the scaffold-completion path and adds the Rust
helper that invokes the npm tools.

**Step 2a: Emission helper**

Files: `crates/factory-engine/src/kernel_emission/emit.rs`

Add `emit_sbom_artifacts(target_root: &Path) -> Result<SbomArtifactBinding, KernelEmissionError>`.

The helper:

1. Checks whether `npx --no-install @cyclonedx/cyclonedx-npm` is available
   (probe via `npx --no-install @cyclonedx/cyclonedx-npm --version`; if absent,
   fall through to step 3 of the helper).
2. Runs `npx --no-install @cyclonedx/cyclonedx-npm --output-format JSON
   --output-file .factory/sbom.cdx.json --reproducible` in `target_root`.
   Captures stdout/stderr; on failure, writes a stub BOM (see below) and
   continues to step 3.
3. Runs `npm audit --json` in `target_root`, parses the output into a
   `SbomAuditRecord`, writes `.factory/audit.json`. If `npm audit` is absent or
   fails before producing JSON, writes `.factory/audit.json` with
   `status: "absent"` and a reason string.
4. Reads `.factory/sbom.cdx.json` as bytes; SHA-256 hashes it. Reads
   `.factory/audit.json` as bytes; SHA-256 hashes it.
5. Returns `SbomArtifactBinding { bom_hash, audit_hash, bom_tool_version }`.

If the BOM tool is absent, write a stub `sbom.cdx.json` that is a minimal valid
CycloneDX JSON with a single `metadata.component.type: "application"` and a
`metadata.tools` entry naming the absent tool and reason. This keeps the file
present and hash-stable for the cert binding (AC-3: cert still binds even when
scanner unavailable).

**Step 2b: Wire into `emit_kernel()`**

In `emit_kernel()` (line ~83 of `emit.rs`), after step 6 (toolchain.yaml write,
line ~158), add step 7:

```rust
// 7. Spec 203 FR-001 / FR-002: BOM + audit artifact emission.
//    Writes .factory/sbom.cdx.json and .factory/audit.json; returns
//    the content hashes for cert binding (FR-003).
//    Both files are written even when tools are absent. Absence is
//    visible evidence (spec 200 FR-004 posture), never a silent skip.
let sbom_binding = emit_sbom_artifacts(&cfg.target_root)?;
written.push(PathBuf::from(".factory/sbom.cdx.json"));
written.push(PathBuf::from(".factory/audit.json"));
```

The `KernelEmissionReport` is extended with an optional
`sbom_artifact_binding: Option<SbomArtifactBinding>` field so the caller can
wire it into the `CertificateBuilder`. The pipeline runner (not this plan's
scope) calls `.sbom_artifact_binding(...)` on the builder when constructing the
cert.

**Step 2c: `toolchain.yaml.tmpl`: document the BOM tool invocation**

Files: `crates/factory-engine/templates/kernel/toolchain.yaml.tmpl`

Add a `sbom:` block documenting the `@cyclonedx/cyclonedx-npm` invocation the
tenant CI will use (the tool pin is the version recorded at scaffold time). This
is documentation within the template, not a runnable CI step (that lives in the
external CI template, FR-004 deferred). Example shape:

```yaml
sbom:
  bom_tool: "@cyclonedx/cyclonedx-npm"
  bom_tool_version: "@@bom_tool_version@@"
  invoke: >
    npx --no-install @cyclonedx/cyclonedx-npm
      --output-format JSON
      --output-file .factory/sbom.cdx.json
      --reproducible
```

This makes the BOM tool version visible in the kernel's toolchain manifest and
gives spec 219's future `verify-sbom` verb a place to read the pinned version
from. The `@@bom_tool_version@@` placeholder is resolved by the template renderer
(extend `TenantToolchainContext` with a `bom_tool_version: String` field).

Update the render tests in `templates.rs` to assert the new `sbom:` block is
present in the rendered output.

**Step 2d: Phase 2 tests (AC-1, AC-3, AC-4)**

Files: `crates/factory-engine/tests/kernel_emission_integration.rs`

- **AC-1 / fresh scaffold contains BOM + audit:** Create a tempdir mimicking a
  scaffold output (with `package.json` + `package-lock.json`). Call `emit_kernel()`.
  Assert `.factory/sbom.cdx.json` and `.factory/audit.json` are in `written_paths`.
  Assert they exist on disk. Assert `sbom_artifact_binding` in the returned report
  is `Some(...)` with non-empty hashes.
- **AC-3 / scanner absent:** Set an env var or stub the tool invocation to simulate
  tool absence. Assert `.factory/sbom.cdx.json` exists (stub BOM) and
  `.factory/audit.json` exists with `"status": "absent"`. Assert hashes are
  non-empty (the absent files are still hashed).
- **AC-4 / byte-identical BOM:** Call `emit_sbom_artifacts` twice on the same
  tempdir (reset the artifacts between calls). Assert the two `bom_hash` values
  are identical. Note: the audit artifact hash is NOT required to be identical
  (it records a time-sensitive fact); assert only the BOM hash is identical.

---

### Phase 3: Determinism gate + regen (AC-4)

**Step 3a: Determinism property test**

Files: `crates/factory-engine/tests/kernel_emission_integration.rs` or a dedicated
`sbom_determinism_test.rs`.

The byte-identical BOM test from Phase 2 step 2d is the AC-4 test. Make it
explicit: two invocations of the BOM generator on the SAME `package-lock.json`
must produce the same SHA-256 hash. This test is the primary AC-4 verification;
it also guards against future regressions if the BOM tool changes.

**Step 3b: featuregraph golden + codebase index regen**

Files: `crates/featuregraph/tests/golden/features_graph.json`,
`.derived/codebase-index/by-spec/*.json`

After all Rust changes compile cleanly:

```bash
UPDATE_GOLDEN=1 cargo test --manifest-path crates/featuregraph/Cargo.toml
make pr-prep
```

Commit both the updated golden and the codebase index shards in the same commit.
Precedent: forgetting one of these fails the coupling and staleness gates in CI.
Reference: the `featuregraph golden skips post-217` project memory note, which
confirms the golden test guards on by-spec/ shards; both must be regenerated.

---

### Phase 4 (deferred): FR-004 external CI gate + 209-sequenced wiring

This phase is explicitly OUT OF THIS PR. See "Blocked / sequenced / out-of-this-PR"
below.

---

## Blocked / sequenced / out-of-this-PR

### FR-004: tenant CI lockfile/BOM parity gate (EXTERNAL + 209-sequenced)

The spec 203 frontmatter (lines 45-51) explicitly records that the
`lockfile-parity-gate` aspect was dropped from the in-OAP refines list because
it "now belongs to the npm tenant CI (the prebuilt template's `spec-spine.yml`,
external to OAP)."

The gate's contract: the tenant CI runs `@cyclonedx/cyclonedx-npm
--reproducible` against the committed lockfile and asserts the hash matches
the hash in `.factory/sbom.cdx.json`. Drift in either direction fails the
tenant PR with a named diagnostic.

This plan defines that contract (the determinism guarantee + the regenerable-BOM
invariant from Decision (c)) and leaves the external CI wiring to:

- The npm tenant CI template (`template-encore` repo), which is owned externally.
- Spec 209's enforcement activation, which gates on spec 209 landing.

**What is deliverable in this PR:** Add a new `## Gate contract (FR-004)` section
to `spec.md` (a spec prose addition, not a code change). This section becomes the
forward-reference that the external CI template author implements against.

### FR-005: `.kernel-version` BOM-tool pin field

The BOM tool version is recorded in `SbomArtifactBinding.bom_tool_version`
inside the cert. Whether it also needs to appear as a new field in
`KernelVersion` / `CertificateToolchainRef` (in `version.rs`) is deferred.
The cert binding already records the version used at scaffold time; adding it to
`.kernel-version` is useful for kernel-update propagation but is not required for
AC-1..AC-4. Flag as residual R-1 in the spec.

### Spec 219 `verify-sbom` verb (cross-repo, downstream)

Spec 219 `spec.md` (line 126) states: "`verify-sbom`, staged until spec 203 is
implemented." Once spec 203 ships, the `verify-sbom` verb in tenant-tail becomes
unblocked. It should:

- Accept a cert path and a `--sbom-dir <dir>` flag (the same flag as in
  `verify-certificate`).
- Call the extracted `verify_sbom_binding` logic (analogous to how tenant-tail's
  `verify-certificate` wraps the extracted cert core).

This is a tenant-tail cross-repo action, not an OAP action. Not scoped here;
flagged so the implementer knows spec 203 unblocks it.

---

## Test strategy (AC-1..AC-4 mapping)

| AC | Test | Location | What it asserts |
|----|------|----------|-----------------|
| AC-1 | `emit_kernel_sbom_artifacts_present` | `tests/kernel_emission_integration.rs` | Fresh scaffold: `.factory/sbom.cdx.json` + `.factory/audit.json` present; both hashes in cert binding; `verify-certificate` exits 0. |
| AC-2 (BOM tamper) | `sbom_binding_bom_tamper` | `governance_certificate.rs` `#[cfg(test)]` | BOM file bytes changed post-emission; `verify_sbom_binding` returns `Err` containing "bom hash mismatch"; `verify-certificate` exits 1. |
| AC-2 (audit tamper) | `sbom_binding_audit_tamper` | `governance_certificate.rs` `#[cfg(test)]` | Audit file bytes changed; `verify_sbom_binding` returns `Err` containing "audit hash mismatch". |
| AC-2 (lockfile tamper) | Lockfile tamper fails tenant CI parity gate | External CI template: described in FR-004 gate contract section. OUT OF THIS PR. |
| AC-3 | `sbom_absent_scanner` | `tests/kernel_emission_integration.rs` | Scanner unavailable: both artifact files present; audit artifact has `"status": "absent"` and `"reason"`; cert still binds; `verify-certificate` exits 0 (bound to absent-evidence, not to findings). |
| AC-4 | `sbom_bom_determinism` | `tests/kernel_emission_integration.rs` (or dedicated file) | Two calls with identical `package-lock.json` input produce identical `bom_hash` values. Audit hash NOT compared (time-sensitive). |

---

## Coupling-gate self-check

Every file the implementation touches, mapped to its spec 203 relationship edge:

| File | Edge | Status |
|------|------|--------|
| `crates/factory-engine/src/governance_certificate.rs` | `refines: sbom-artifact-binding` | DECLARED (spec 203 frontmatter line 43-44) |
| `crates/factory-engine/src/kernel_emission/emit.rs` | `refines: kernel-sbom-vending` | DECLARED (spec 203 frontmatter line 41-42) |
| `crates/featuregraph/tests/golden/features_graph.json` | `extends: 034-featuregraph-registry-scanner-fix, additive` | DECLARED (spec 203 frontmatter line 37-39) |
| `crates/factory-engine/src/bin/verify_certificate.rs` | `refines: sbom-verify-path` | MISSING: add to spec 203 frontmatter before implementation (see Frontmatter Amendment section) |
| `crates/factory-engine/templates/kernel/toolchain.yaml.tmpl` | `refines: sbom-toolchain-reference` | CONDITIONAL: add if toolchain template is edited |
| `crates/factory-engine/src/kernel_emission/templates.rs` | `refines: sbom-toolchain-render-tests` | CONDITIONAL: add if template context or tests change |
| `specs/203-produced-app-sbom-attestation/spec.md` | self (amendment) | Co-lands same PR (frontmatter edge additions + FR-004 gate contract section) |

Files explicitly NOT touched (and must not be):

- `deny.toml`: no new ban needed; `@cyclonedx/cyclonedx-npm` is an npm tool,
  not a Rust crate ban candidate.
- `clippy.toml`: no new disallowed-methods for this spec; the BOM tool is
  invoked via `std::process::Command`, not via a banned Rust function.
- `crates/factory-engine/Cargo.toml`: no new Rust deps required. SHA-256
  hashing uses the existing `sha2` crate (already in factory-engine deps,
  line 37 of Cargo.toml). JSON parsing uses existing `serde_json`. Process
  invocation uses std. No new crate.
- `crates/factory-engine/src/bin/factory_run.rs`: the cert builder call is in
  the pipeline runner. If that file is edited, a `refines:` edge must be added.
  Deferred judgment; may not be needed if the kernel emission path carries the
  binding back to the cert without touching `factory_run.rs`.

---

## Verification commands

```bash
# Full factory-engine test suite (includes new sbom-binding tests)
cargo test --manifest-path crates/factory-engine/Cargo.toml

# Build verify-certificate binary (confirm --sbom-dir flag compiles)
cargo build --release \
  --manifest-path crates/factory-engine/Cargo.toml \
  --bin verify-certificate

# Build factory-run binary (confirm sbom_artifact_binding wiring compiles)
cargo build --release \
  --manifest-path crates/factory-engine/Cargo.toml \
  --bin factory-run

# Determinism test in isolation
cargo test --manifest-path crates/factory-engine/Cargo.toml sbom_bom_determinism

# Regenerate featuregraph golden
UPDATE_GOLDEN=1 cargo test --manifest-path crates/featuregraph/Cargo.toml

# Regenerate codebase index and run coupling gate vs origin/main
make pr-prep
```

---

## Spec-prose amendments required (co-land in the implementation PR)

1. **Add `refines` edge for `verify_certificate.rs`** in spec 203 frontmatter.
2. **Add `refines` edge for `toolchain.yaml.tmpl`** if that file is edited.
3. **Add FR-004 gate contract section** to spec.md body (the external CI contract;
   makes the gate's definition attributable even though implementation is external).
4. **Add residual R-1** (BOM tool version in `.kernel-version`: deferred per FR-005
   analysis above).
5. **Flip `status: draft` to `status: approved`** once the above amendments are
   reviewed. Set `implementation: in-progress` on the Phase 1+2 PR; set
   `implementation: complete` when all AC-1..AC-4 are satisfied.

---

## Risks and open questions

1. **`--reproducible` flag availability.** `@cyclonedx/cyclonedx-npm` has had
   `--reproducible` since v1.3.0 (2022). Verify the exact version requirement
   before locking the invocation in the toolchain template. If an older version
   is resolved at scaffold time, the BOM will contain a non-deterministic
   `serialNumber` UUID and the AC-4 byte-identical test will fail.
   Mitigation: pin `@cyclonedx/cyclonedx-npm@>=1.3.0` in the toolchain template
   documentation; the `bom_tool_version` field in `SbomArtifactBinding` records
   what was actually used, making version drift visible in the cert.

2. **`npm audit --json` exit code semantics.** `npm audit --json` exits 1 when
   vulnerabilities are found, regardless of severity level. The Rust invocation
   must check `status.success()` only to detect tool-absence errors, NOT audit
   findings. Parse the JSON from stdout unconditionally on exit code 0 OR 1;
   treat any other exit code (e.g., 2 = tool error) as "absent" with reason.

3. **Scaffold target may not have `package-lock.json` yet (UPGRADED to Handoff
   F1/F2; this is the load-bearing design decision, not a residual risk).**
   `emit_kernel` is born-with seeding and runs on a fresh target with no
   lockfile, so hooking BOM emission there yields an empty stub every run.
   Emission must instead hook at scaffold completion, gated on F2 (does a
   committed lockfile exist at that stage). If a lockfile is genuinely absent at
   the chosen hook, the stub BOM + `reason: "no package-lock.json at scaffold
   time"` audit record is the correct visible-absence fallback (the cert still
   binds), but that path is the exception, not the steady state. Resolve the hook
   point (F2) before writing emission code.

4. **`factory_run.rs` edit scope.** The plan defers the judgment on whether
   `factory_run.rs` needs to be touched. If the `KernelEmissionReport` carries
   `sbom_artifact_binding: Option<SbomArtifactBinding>` back to the caller and
   the caller is in `factory_run.rs`, that file is edited and needs a `refines:`
   edge added to the frontmatter. Resolve during implementation.

5. **tenant-tail `verify-sbom` shape dependency.** Spec 219 records that
   `verify-sbom` "lands when its core exists (spec 203 ... its verify side extends
   the certificate core rather than standing alone)." This plan confirms that
   judgment: `verify_sbom_binding()` is added to `governance_certificate.rs`, so
   tenant-tail's `verify-sbom` extraction path is the same as `verify-certificate`
   (copy the function, no structural surprise). Flag to the tenant-tail maintainer
   when spec 203 ships.

---

## Addendum: what shipped, and the emission-leg re-plan (2026-07-01)

Two PRs landed the in-OAP factory-engine cert surface; the emission generation
is re-planned onto the tenant CI. This addendum supersedes the Phase 2
"hook into `emit_kernel`" recommendation (already flagged wrong by F1/F2) and
the Phase 4 "FR-004 external" placeholder with concrete decisions.

### Shipped (in-tree)

- **PR #466 (Phase 1, cert-side).** `SbomArtifactBinding`, the builder method,
  `verify_sbom_binding()`, the `verify-certificate --sbom-dir` flag, the
  `SbomAuditRecord` schema, and cert version 1.7.0. Fully tested; unblocks spec
  219 `verify-sbom`.
- **Emitter read-path (FR-003 consumption).** `build_certificate.rs` gained a
  `--sbom-dir` flag + `resolve_sbom_binding()` mirroring `resolve_corpus_binding`
  (read `<root>/.factory/{sbom.cdx.json,audit.json}`, hash both, lift the BOM
  tool version from the BOM's `metadata.tools`, bind via the public builder).
  Fail-soft on the emit side, fail-closed on the verify side. Integration test
  `sbom_binding_round_trips_fr003`. `build_certificate.rs` is co-claimed with
  spec 220 via the new `sbom-emitter-read-path` refines edge.

### Emission generation: re-planned onto the tenant CI (external)

F2 established the Rust `emit_kernel` hook is unwired in production. A second
trace weighed the two production-real candidates and decided **the tenant CI**,
not the statecraft scaffold (`perRequestScaffold.ts`), for generation:

- The scaffold pod runs `readOnlyRootFilesystem`; `@cyclonedx/cyclonedx-npm` is
  not a statecraft dependency and would fetch on demand into a writable cache, a
  real risk to production project creation. `spawnAndCapture` there also discards
  stdout and rejects on non-zero exit, wrong for `npm audit` (non-zero = vulns
  found = evidence, not failure).
- The tenant CI (external `spec-spine.yml`) already hosts spec 209's
  `verify-certificate` step and this spec's FR-004 gate, has network + writable
  FS, and lets generation -> emitter firing (spec 220 FR-002) -> verify compose
  in one run.

**External implementation (template-encore `spec-spine.yml`), the AC-1 closer:**

1. Generate: `npx --no-install @cyclonedx/cyclonedx-npm --output-format JSON
   --output-file .factory/sbom.cdx.json --reproducible` + an `npm audit --json`
   step serialised to `.factory/audit.json` (tolerating non-zero on findings;
   `absent` + reason when the scanner is unavailable).
2. Fire the emitter: `npx --no-install tenant-emit build-certificate <run-dir>
   --sbom-dir . --corpus-attestation attestation.json ...` binds the two hashes
   (the `--sbom-dir` read-path is now in-tree and mirrored into the `tenant-emit`
   distributable).
3. FR-004 gate: assert the committed `.factory/sbom.cdx.json` is regenerable from
   the lockfile to a matching hash, and the lockfile satisfies the manifest.

This composes with spec 220's FR-002 firing step (same CI file) and reaches
AC-1/AC-2/AC-4 once `tenant-emit` is published to npm and the CI lands.
