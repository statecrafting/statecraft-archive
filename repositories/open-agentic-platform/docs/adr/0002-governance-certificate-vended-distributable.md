# ADR 0002: Governance certificate is a second vended distributable, not spec-spine subcommands

- **Status:** Proposed (investigation memo, 2026-06-15). Not ratified. Not committed by the investigation.
- **Scope:** Where the governance-certificate emitter/verifier should live so the tenant-side legs of specs 168, 203, 209, 210 become reachable.
- **Author:** Architecture investigation (read-only across OAP, `spec-spine`, `template`).
- **Verdict:** Hypothesis CONFIRMED. The certificate is run-provenance, not spec-spine's authority-ledger domain. The fix is a second vended distributable (the cert emitter/verifier extracted from factory-engine and published like spec-spine), pinned and integrity-checked in the tenant alongside spec-spine. Do NOT add cert subcommands to spec-spine.

> Every architectural claim below cites `path:line`. Paths are relative to the repo each fact lives in: OAP = `open-agentic-platform`, spec-spine = `spec-spine`, template = `template`.

---

## 0. The question and the hypothesis under test

The published `spec-spine` npm CLI (the tenant's entire vended spec toolchain) exposes exactly six commands and no certificate emit/verify. The cert binaries (`build-certificate`, `verify-certificate`) live in OAP's `factory-engine` and are not in any tenant distribution. The tenant-side legs of 209 FR-001 (verify) / FR-003 (emit), 203 FR-003, and 210 FR-002/003 therefore have no tenant cert tool to run against.

The hypothesis (to falsify, not assume): the certificate is a run-provenance concern outside spec-spine's bounded context, so the fix is a second vended distributable rather than new spec-spine subcommands.

The hypothesis survives every check below. Two premises behind it needed correction, and both corrections strengthen the conclusion (see §4 and §6).

---

## 1. Domain boundary: is the certificate in or out of spec-spine's bounded context?

### What spec-spine claims to own

spec-spine self-describes, verbatim and consistently, as an authority ledger over markdown specs:

- "A typed, hash-verifiable authority ledger over a markdown spec corpus. Installable Rust library + CLI" (spec-spine `README.md:6`).
- "spec-spine turns a markdown spec corpus into a typed, hash-verifiable authority ledger and refuses code that drifts from its owning spec at PR time. It is a three-crate Rust workspace publishing an installable library + CLI, plus npm and PyPI shims" (spec-spine `CLAUDE.md:7-10`).
- The architecture is a pure function of `(config, file contents)`: a compiler emits `registry.json`, an indexer emits `index.json`, a coupling gate joins them at PR time (spec-spine `docs/design/00-architecture.md:26-34`).

spec-spine explicitly enumerates what it deliberately does NOT own. The "Deliberately dropped from the generic core (overlay territory)" section names OAP's domain machinery as out of scope: "OAP's `kind` 16-value enum, `shape`/`category` dims, capability/registry/profile machinery ... `compliance`, `factoryProjects`, and the Claude `config-hash.json` gate are all OAP-specific. They are not in the generic core" (spec-spine `docs/design/00-architecture.md:658-663`; reinforced at `:726`, `docs/overlay-contract.md:8-11`, `docs/adoption-guide.md:239-244`). Run-provenance and certificate are not even concepts that appear in the spec-spine repo.

### What the certificate is

The governance certificate is a per-run, per-project provenance artifact. Spec 168's frontmatter domain is `platform`, and its summary frames the certificate as a property of pipeline runs crossing the tenant boundary: "Tenant projects produced by the substrate run their own factory pipelines ... and those runs need the same independently-verifiable governance chain. Without it, the trust chain breaks at the tenant boundary" (OAP `specs/168-per-project-governance-certificate/spec.md:96-103`). The certificate binds run outputs (`requirements_hash`, `build_spec_hash`, per-stage `artifact_hashes`, `signer`, self-hash, signature), not registry artifacts (OAP `crates/factory-engine/src/governance_certificate.rs:68-157`; spec `168 spec.md:171-180`).

The signer model is a run-identity model: an Ed25519 signing key resolved from operator env (`OAP_SIGNING_KEY` / `OAP_SIGNING_KEY_PATH`) or an ephemeral per-run key (OAP `governance_certificate.rs:732-769`), with a `Signer` identity (Rauthy JWT subject or agent identity) bound into the cert and a halt-if-no-signer gate for tenant emission (OAP `governance_certificate.rs:255-309, 658-663`). None of this is spec-spine machinery.

### Criteria and verdict

| Criterion | spec-spine domain | Certificate |
|---|---|---|
| Unit of truth | the markdown spec corpus | one pipeline run |
| Input | `(config, file contents)`, pure | run dir + artifacts + signing key + identity |
| Output | `registry.json` / `index.json`, deterministic over committed inputs | signed JSON over per-run artifact hashes |
| Time/identity | no clock, no env, no signing | wall-clock timestamp, ed25519 signing, run identity |
| Self-description | "authority ledger over a spec corpus" (`README.md:6`) | "independently-verifiable governance chain" for a run (`168 spec.md:96-103`) |

The certificate fails every test for membership in spec-spine's bounded context and matches the definition of run-provenance on every axis. spec 217 makes the corpus-level boundary explicit by what it deletes versus retains: it deletes OAP's in-tree generic spec-spine engine and replaces it with the published library, but "OAP retains only its overlay: the 16-kind enum, shape/category, compliance, factory/OWASP machinery ..." (OAP `specs/217-spec-spine-engine-swap-collapse/spec.md:13-26`, `:80-84`). The certificate / factory machinery is named in the retained OAP overlay, and `build-certificate`/`verify-certificate` appear nowhere in 217's deletion manifest or its post-migration CLI surface (`217 spec.md:277-293`).

**Verdict: the certificate is OUT of spec-spine's bounded context.** It is run-provenance; spec-spine is an authority ledger.

---

## 2. Coupling check (load-bearing): does cert logic depend on spec-spine internals?

This decides how clean a separate-tool extraction can be. The answer determines the whole memo, so it was traced by hand rather than delegated.

### The only seam

The entire 2420-line cert module (OAP `crates/factory-engine/src/governance_certificate.rs`) has exactly one dependency on spec-spine, and it is optional and warn-only:

- `validate_spec_id_resolution(cert, repo_root)` (OAP `governance_certificate.rs:1397-1426`) loads the registry and looks up the cert's `intent.spec_id`. It calls exactly two functions from the published spec-spine library: `spec_spine_core::load_registry(&registry_path)` (`:1410`) and `registry.find_by_id(spec_id)` (`:1419`). (spec 217: the in-tree typed-reader library is replaced by the published `spec-spine-core` crate.)
- These are the public consumer-API of the typed reader, not compiler internals. The cert code never touches `SHAPE_TABLE`, `KNOWN_KEYS`, or any compiler-side type. Those are spec-spine internals and do not appear in the cert module at all.
- The seam is documented as non-load-bearing: "the cert is authoritative independent of the registry's existence on this filesystem" (OAP `governance_certificate.rs:1376-1379`). When `intent.spec_id` is `None` the function returns empty (`:1406-1408`); a missing registry is a warning, not an error (`:1380-1383`). Findings land in a sibling `validation-warnings.json`, never inside the cert (`:1428-1449`), and hard-fail is opt-in via `OAP_REQUIRE_SPEC_ID_RESOLUTION` (`:1454-1459`).

The dependency was declared with that single purpose: "Cut D W-10 (spec 102 G-2 follow-up) - validate StageRecord.spec_id resolves against the spec spine via the typed-reader library." The pre-spec-217 Cargo.toml carried a path dependency on the in-tree registry-consumer crate (OAP `crates/factory-engine/Cargo.toml:18-20`); spec 217 migrated this to the published `spec-spine-core` crate.

### What the core paths actually depend on

- `CertificateBuilder::build()` / `build_tenant()` and `verify_certificate()` have zero spec-spine dependency. Their imports are crypto and serde only: `ed25519_dalek`, `sha2`, `base64`, `chrono`, `serde` (OAP `governance_certificate.rs:11-19`), plus factory-engine-internal modules `inter_stage_manifest` (spec 170 chain), `pipeline_state::FactoryPipelineState`, and `platform_jws` (spec 198 countersign).
- `platform_jws` is a self-contained Ed25519 JWS verifier ("Rust twin of statecraft's `api/factory/signing-pure.ts`"), importing only `base64`, `ed25519_dalek`, `serde` (OAP `crates/factory-engine/src/platform_jws.rs:3, 15-18`). No database, no statecraft import. Cleanly extractable.
- The two binaries confirm the same surface. `build_certificate.rs` imports the builder, persist, and `validate_spec_id_resolution` (OAP `crates/factory-engine/src/bin/build_certificate.rs:40-49, 218`). `verify_certificate.rs` imports `verify_certificate_with_platform`, `PlatformJwks`, and `validate_spec_id_resolution` (OAP `crates/factory-engine/src/bin/verify_certificate.rs:22-26, 119, 131`).
- There is one certificate implementation. The OPC-side path reuses it rather than reimplementing: "Reuses factory-engine's `GovernanceCertificate` (spec 102 / 168)" (OAP `crates/opc-decomposition-pipeline/src/certificate.rs:7, 24-26`).

### Conclusion

The extraction is clean. The only spec-spine seam is a single optional, warn-only, OAP-self-semantic function using a two-method public reader API. It can be dropped for tenants, gated behind a flag, or re-pointed at the tenant's own spec-spine reader. Notably, spec 217's migration table already re-points this exact dependency from `registry-consumer` to `spec-spine-core::load_registry` (OAP `specs/217-spec-spine-engine-swap-collapse/spec.md:173-182`), confirming the seam stays a public-library call even after the spec-spine swap.

---

## 3. Extraction surface: what is the cert tool, and how much is OAP-semantic?

The cert tool is:

- `governance_certificate.rs` (cert type, builder, hash, signer, verifier, inter-stage chain handling, platform-seal adjudication).
- `platform_jws.rs` (JWS verify for the spec 198 platform countersign).
- `inter_stage_manifest.rs` (spec 170 signed hand-off chain, embedded in the cert and replayed by the verifier; OAP `governance_certificate.rs:1232-1251`).
- The two `[[bin]]` targets `build-certificate` and `verify-certificate` (OAP `crates/factory-engine/Cargo.toml:59-65`).
- A thin slice of `factory_contracts::sandbox` (the `SandboxExecutionRecord::from_outcome` conversion; OAP `governance_certificate.rs:421-443`) and `FactoryPipelineState` used as a plain state carrier by `generate_certificate_*` (`:889-998`).

Generic (reusable run-provenance) versus OAP-semantic:

- **Generic:** the cert struct and its hash/signature, the verifier, the signer model, the inter-stage chain, the sandbox-execution record, and the platform-countersign JWS check. Spec 168 §2.4 already designed the format to be tenant-shaped: any stage representable as `(stage_id, artifact_hashes)` round-trips untouched, and tenants pass their own stage IDs or use filesystem discovery (OAP `governance_certificate.rs:904-932, 1281-1323` tests).
- **OAP-semantic, thin:** `OAP_STAGE_IDS` (the default s0..s5 list, overridable per §2.4; OAP `governance_certificate.rs:872-879`), `validate_spec_id_resolution` (§2 above), and the OWASP-ASI compliance frameworks field.

So the tool is overwhelmingly generic run-provenance with a thin OAP default layer, which is exactly the shape that fits a Cut-D-style standalone crate plus per-platform binary distributable mirroring spec-spine's `@spec-spine/cli-<platform>` packaging.

Spec 102 already anticipated this exact home: FR-007 specifies "`verify-certificate` CLI subcommand (in factory-engine or as a standalone binary)" (OAP `specs/102-governed-excellence/spec.md:212`). The standalone-binary option is pre-sanctioned, not a new departure.

---

## 4. Tenant distribution, pinning, and integrity

### How spec-spine is vended and integrity-checked today (template)

Premise correction (this strengthens the hypothesis): the OAP kernel template `crates/factory-engine/templates/kernel/toolchain.yaml.tmpl` describes two modes (vendor-binaries and pinned-toolchain) and installs the cert binaries via `cargo install --git ... --bin build-certificate --bin verify-certificate` (OAP `toolchain.yaml.tmpl:8-16, 22-26`). But the actual production tenant template has moved past that file. template has no `toolchain.yaml`, no `.tmpl`, and no `.kernel-version`; it deleted the vendored Rust toolchain and migrated to the published spec-spine npm package (template migration commit `e0b947b`; `specs/000-bootstrap/spec.md:63-64` "Governance is provided by the published `spec-spine` npm package ... prebuilt binaries, no extra toolchain required").

In template today:

- **Pin:** exact version in devDependencies, `"spec-spine": "0.2.0"` (template `package.json:68`).
- **Distribution shape (mirror target):** the main `spec-spine` npm package carries no binary; it declares five `optionalDependencies` `@spec-spine/cli-<platform>` keyed by `os`/`cpu`, and a pure exec-and-forward launcher `bin/spec-spine.js` resolves the platform package and runs it (spec-spine `npm/package.json:27-29, 44-50`; `npm/bin/spec-spine.js`; `npm/lib/platform.js`; platform packages assembled at publish time by `npm/scripts/generate-platform-packages.js`, never committed). Governed by spec-spine `specs/007-distribution/spec.md` (Python mirror: `008-python-distribution`).
- **Integrity:** npm-standard. `package-lock.json` carries `sha512` `integrity` for `spec-spine` and for each `@spec-spine/cli-*` platform package; `npm ci` verifies every locked package against its hash before install and aborts on mismatch (template `package-lock.json`; `.github/workflows/spec-spine.yml:35` `run: npm ci`). This mechanism is generic over every dependency, not spec-spine-specific.
- **CI enforcement:** `.github/workflows/spec-spine.yml` runs `npm ci` then `npx --no-install spec-spine {compile, lint --fail-on-warn, index check, couple}` (template `spec-spine.yml:35-60`), dispatched always-on from `ci.yml:105-107`. The `index check` staleness gate is parameterized by `spec-spine.toml [index] extra_hashed_inputs` (template `spec-spine.toml:37-45`).

### Where a second vended tool slots in, and the 209 FR-004 question

A second npm-published cert tool slots into four existing anchors with no new mechanism:

1. **Pin:** add `"<cert-tool>": "<version>"` to template `package.json` devDependencies, next to `spec-spine` (`package.json:68`).
2. **Integrity:** automatic. `npm install` writes `sha512` `integrity` for the tool and its `@scope/cli-<platform>` subpackages into `package-lock.json`; `npm ci` verifies them. This directly answers investigation point 4: yes, the existing integrity check already covers a second binary, because it is npm's generic lockfile verification, not a spec-spine-specific or single-tool check.
3. **CI invocation:** add `npx --no-install <cert-tool> verify-certificate ...` (and the emit call in the pipeline) to `spec-spine.yml` or a sibling workflow.
4. **Staleness (optional):** if the tool gains its own config file, add its path to `spec-spine.toml [index] extra_hashed_inputs`. spec-spine's `contentHash` gate does not cover a second tool's binary, and it does not need to: binary integrity is npm's job.

Premise correction on `.kernel-version`: 209 FR-004 specifies integrity "against `.kernel-version` (spec 167 FR-005's pinned-toolchain record)" (OAP `specs/209-tenant-kernel-ci-enforcement/spec.md:114-120`). That mechanism belongs to the retired vendor-binaries world. template has no `.kernel-version`; the live equivalent is the npm lockfile `integrity` field. 209's own frontmatter already records this owed rewrite: "the full premise rewrite (advisory to blocking on the npm CI; the `vended-binary-integrity` aspect to npm-pin/lockfile/provenance) is owed when 209 leaves draft" (OAP `209 spec.md:47-53`), and "209's enforcing-CI premise now targets the npm tenant CI ... which lives in template, not OAP" (`209 spec.md:44-54`). So the second-binary integrity story is already converging on the npm-lockfile model that covers it for free.

---

## 5. Candidate homes and tradeoffs

| Option | Bounded context | Reuses proven distribution | Effect on spec-spine Cut D | Coupling cost | Verdict |
|---|---|---|---|---|---|
| **A. New standalone npm-published cert tool (mirror spec-spine packaging)** | Clean: run-provenance stays separate from authority ledger | Yes: same optional-deps + npm-ci integrity pattern | None: spec-spine untouched | Drops the one optional seam or re-points it at the tenant reader | **CHOSEN** |
| B. Add `build-certificate`/`verify-certificate` subcommands to spec-spine CLI | Violated: forces run-provenance into the ledger | Yes (same binary) | Negative: grows spec-spine mid-minimization | Imports ed25519 + JWS + countersign + sandbox into a pure-function tool | Rejected |
| C. Keep cert as factory-engine `cargo install --git` binaries (status-quo template) | Clean | No: requires a tenant Rust toolchain | None | None | Rejected |
| D. Subcommand on a different existing tenant tool | n/a | n/a | n/a | n/a | Rejected (collapses to B) |
| E. Co-ship the cert binary inside the `@spec-spine/cli-<platform>` packages (second `bin`, no new CLI verb) | Blurred at the package boundary | Yes | Negative: spec-spine repo must build/own the cert binary | Re-imports factory machinery into the spec-spine repo; couples release cadence | Rejected |

One-line loss reasons:

- **B** lost because it pushes run-provenance into the exact bounded context spec-spine is actively shrinking (spec-spine `docs/design/00-architecture.md:658-663`; OAP `217 spec.md:80-84`).
- **C** lost because it depends on a tenant Rust toolchain the npm migration removed (template has no `rust-toolchain`, no `Cargo.toml`; `package.json:68` is the only governance pin).
- **D** lost because there is no second tenant-side tool to host it; spec-spine is the only one, so D reduces to B.
- **E** lost because co-shipping re-merges the two bounded contexts at the package boundary and drags spec-spine's repo and release cadence onto a run-provenance binary it has no reason to build.

---

## 6. Cross-repo ownership and sequencing

**Owner.** The cert tool's code stays OAP-owned. factory-engine is OAP, and spec 217 explicitly keeps "factory/OWASP machinery" in the OAP overlay rather than deleting it into spec-spine (OAP `217 spec.md:80-84`). Recommended shape: extract the cert core into its own OAP crate (so factory-engine and the standalone binaries share one source), then publish per-platform binaries plus an npm wrapper from OAP, mirroring how spec-spine publishes from the spec-spine repo.

**Dependency order:**

1. **Extract / confirm a standalone-buildable cert crate.** The core is already crypto+serde only (§2). The only decoupling work is the optional `validate_spec_id_resolution` seam and the thin `FactoryPipelineState` carrier. Decide: drop the seam for tenants, gate it behind a flag, or re-point it at `spec-spine-core::load_registry` (already the 217 target).
2. **Build and release per-platform binaries.** This leg is NOT done today. `release-tools.yml` historically built `spec-compiler`, `registry-consumer`, `spec-lint`, `codebase-indexer` (spec 217: `spec-compiler`, `registry-consumer`, `codebase-indexer` are now the published `spec-spine` CLI; only `spec-lint` remains in the OAP tools bundle). The cert binaries are not built or attached to any release. Add the two cert binaries to a release matrix (their own archive or a new `oap-cert-<triple>` artifact), with the same SBOM + SLSA attestation treatment the tools archive already gets (`release-tools.yml:246-268`).
3. **Author the npm wrapper packages.** Main package + `@scope/cli-<platform>` optionalDependencies + exec-forward launcher + a `generate-platform-packages.js` equivalent, copied from spec-spine's `npm/` (spec-spine `npm/package.json:44-50`, `npm/scripts/generate-platform-packages.js`).
4. **Pin in template.** Add the devDependency and the CI invocation to `spec-spine.yml` (template `package.json:68`, `spec-spine.yml:35-60`). Integrity is automatic via `npm ci`.
5. **Activate 209 enforcement** once the tool is pinned and emitting.

**Does this need its own spec?** Yes, a small one. The cert format and contract are already owned (102, 168, 198, 170); the unowned concern is the distribution/packaging/pinning of a second tenant tool, which is precisely the slice spec-spine handles in its own `007-distribution`. The new spec should be the cert analogue of `007-distribution`: it extends 102 FR-007 (which already blessed the standalone binary) and 168 FR-001 (emitter+verifier shipped to the tenant), formally retires the stale `cargo install --git` path in `toolchain.yaml.tmpl`, and re-expresses 209 FR-004's `.kernel-version` integrity against the npm-lockfile model. Authoring it does not require re-litigating the cert format.

**Effect on the spec-spine standalone release timeline:** none, and that is the point. Because the certificate does not enter spec-spine, the Cut D / spec 217 minimization proceeds unblocked, and the cert tool ships on OAP's own cadence (optionally paired per spec 193). Choosing option A removes a reason to grow spec-spine rather than adding one.

---

## 7. FR impact: what becomes reachable, and residuals

Once the second vended cert tool exists (npm-published, pinned in the tenant, integrity-checked by `npm ci`, invoked in tenant CI):

| FR | Statement | Status after Option A |
|---|---|---|
| 168 FR-001 | Tenant ships emitter + verifier | Reachable: the npm pin is the "pinned-toolchain reference" (`168 spec.md:235-238`) |
| 168 FR-002 | Auto-emit at run completion | Reachable: pipeline calls `build-certificate --tenant-mode` (`168 spec.md:239-243`) |
| 168 FR-004/005 | Offline verifier, field-named exit codes | Reachable: artifact-chain verify is offline; platform seal is opt-in (`168 spec.md:247-254`; OAP `verify_certificate.rs:14-19`) |
| 203 FR-003 | BOM + audit hashes enter cert artifact list; verify detects tamper | Reachable once the tool is vended and the SBOM/audit artifacts are written into the scanned run dir (`203 spec.md:99-103`) |
| 209 FR-001 | Tenant CI runs `verify-certificate`, blocking | Reachable: add `npx --no-install <cert-tool> verify-certificate` to `spec-spine.yml` (`209 spec.md:99-104`) |
| 209 FR-003 | Tenant-emit auto-fire | Reachable (same leg as 168 FR-002) (`209 spec.md:109-113`) |
| 209 FR-004 | Vended-tool integrity | Reachable and simplified: `npm ci` lockfile `sha512` covers a second binary generically; rewrite the FR's `.kernel-version` wording to the npm-pin model (`209 spec.md:114-120, 47-53`) |
| 210 FR-002 | Posture bound into cert | Reachable: additive field on `governance_certificate.rs`, shipped by the vended tool (`210 spec.md:105-107`) |
| 210 FR-003 | Verify cross-checks posture vs SBOM | Reachable: logic in `verify-certificate` or the 209 CI gate (`210 spec.md:108-115`) |

Residuals after the tool exists:

- The optional `validate_spec_id_resolution` seam: decide keep-flag / drop / re-point (§6 step 1).
- Retire or rewrite `toolchain.yaml.tmpl`'s `cargo install --git` path to the npm model (it currently contradicts template's npm-only reality).
- 210's SDK-watchlist home and watchlist-miss are a pre-existing stated residual unrelated to tool home (`210 spec.md:108-115`).
- The spec 198 FR-014 platform-seal verify path needs a JWKS (network or `--platform-jwks` file). That is opt-in and does not break the offline artifact-chain contract (OAP `verify_certificate.rs:48-62, 119`).

### Correction to the re-filing premise

The hypothesis assumed the tenant residual is currently "mis-filed as spec-spine needs subcommands." A corpus-wide search found no such mis-filing: every cert `establishes:` / `extends:` / `refines:` edge points at `crates/factory-engine/` (102 `:31`, 168 `:47-53`, 198 `:117-119`, 202 `:62`, 203 `:44`, 209 `:39`, 210 `:51`), and no spec requests a `spec-spine build-certificate`/`verify-certificate` subcommand. The spec corpus already files the certificate against factory-engine correctly. The real gap is not a mis-filing to correct; it is two missing/owed pieces: (a) a distribution spec for the second vended tool does not exist yet, and (b) 209 FR-004's integrity wording still references the retired `.kernel-version` mechanism instead of the npm lockfile. The constructive action is to open (a) and rewrite (b), not to move an existing claim off spec-spine.

---

## 8. Recommendation (summary)

- **Home:** a standalone, OAP-owned cert crate extracted from factory-engine, shipped as its own per-platform binaries and an npm wrapper package. Not spec-spine subcommands.
- **Packaging:** mirror spec-spine exactly: main npm package with `@scope/cli-<platform>` optionalDependencies (os/cpu match) and an exec-forward launcher, assembled from release archives at publish time.
- **Pin and integrity:** exact-version devDependency in the tenant `package.json`; integrity via the existing `npm ci` lockfile `sha512` verification, which already covers a second binary generically. No `.kernel-version` needed.
- **Sequencing:** extract crate -> add cert binaries to the release matrix (not built today) -> author npm wrapper -> pin in template + wire CI -> activate 209 enforcement.
- **New spec:** yes, a small distribution spec (the cert analogue of spec-spine `007-distribution`) that extends 102 FR-007 and 168 FR-001, retires the `cargo install --git` template path, and re-expresses 209 FR-004 against the npm-pin model.

Rejected, one line each: **B** (spec-spine subcommands) pollutes the bounded context spec-spine is actively shrinking; **C** (`cargo install --git`) needs a tenant Rust toolchain the npm migration deleted; **D** (subcommand on another tenant tool) has no second tool, so it collapses to B; **E** (co-ship in spec-spine packages) re-merges the two contexts at the package boundary and drags spec-spine's repo and cadence onto a run-provenance binary.

---

## 9. Open questions (not verifiable from the three repos in scope)

- Whether the cert crate extraction can shed `FactoryPipelineState` cleanly or whether that type carries factory-engine-internal coupling beyond the plain state fields used by `generate_certificate_*` (OAP `governance_certificate.rs:889-998`). Needs a read of `pipeline_state.rs`, not opened here.
- The exact npm scope/name and publish account for the new package (org policy; not in any repo read).
- Whether spec 193 (paired-release-cadence) intends to bind the cert tool's release to spec-spine's or to OAP's desktop/tools cadence. Referenced but not opened.
- Whether the tenant pipeline that would call `build-certificate --tenant-mode` exists yet in template (no pipeline-run harness was found there; only the spec-spine governance CI). The emit leg may depend on tenant-side pipeline work tracked elsewhere.
