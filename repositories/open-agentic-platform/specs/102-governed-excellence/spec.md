---
id: "102-governed-excellence"
title: "Governed Excellence — Production Hardening for the Best Governed OS for AI-Native Delivery"
status: approved
implementation: complete
owner: bart
created: "2026-04-14"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler that provided the registry-freshness seam this spec extended was deleted; that logic is now in spec-spine-core. The spec-compiler edge is stripped (path deleted); all other extends edges (factory-engine, tool-registry, policy-kernel, orchestrator) survive.
kind: process
domain: platform
risk: high
depends_on:
  - "089-governed-convergence-plan"
  - "100-post-convergence-remediation"
  - "101-codebase-index-mvp"
code_aliases:
  - GOVERNED_EXCELLENCE
  - GOV_CERT
  - OWASP_ASI_COVERAGE
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI01", "ASI03", "ASI05", "ASI07", "ASI09", "ASI10"]
summary: >
  Meta-spec that formalises the refinement of OAP from a working governed platform
  into the definitive governed operating system for AI-native delivery. Central
  deliverable: a Governance Certificate — a single JSON artifact proving the full
  intent-to-spec-to-code-to-audit chain. Closes ten validated gaps across factory
  compilation, certificate output, stage gate configs, tool-registry policy bridge,
  compliance mapping, traceability unification, OWASP ASI 2026 coverage, policy
  composition, registry freshness, and platform policy seams.
establishes:
  - unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
references:
  - role: planned
    unit: { kind: file, path: factory/contract/schemas/governance-certificate.schema.json }
  - role: planned
    unit: { kind: directory, path: factory/contract/checks }
extends:
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/lib.rs }
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/bin/factory_run.rs }
  - spec: "067-tool-definition-registry"
    nature: additive
    unit: { kind: crate, id: tool-registry }
  - spec: "068-permission-runtime"
    nature: additive
    unit: { kind: file, path: crates/policy-kernel/src/lib.rs }
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/lib.rs }
# 217 deleted the in-tree spec-compiler; the registry-freshness seam this spec
# extended (FR registry freshness) is now spec-spine-core::compile. The
# spec-compiler/src/lib.rs edge is stripped (path deleted); all other extends edges
# (factory-engine, tool-registry, policy-kernel, orchestrator) survive. Amended by 217.
co_authority:
  - with_specs:
      - "102-governed-excellence"
      - "104-makefile-ci-parity-contract"
      - "127-spec-code-coupling-gate"
      - "134-fast-local-ci-mode"
      - "135-fast-ci-as-default"
    unit: { kind: section, file: Makefile, anchor: registry }
---

# 102 — Governed Excellence

**Feature Branch**: `102-governed-excellence`
**Created**: 2026-04-14
**Status**: Draft
**Input**: Ground-truth assessment of all four OAP layers (factory, governance, desktop, platform) against the Refinement Blueprint of 2026-04-14.

---

## Purpose

OAP is architecturally complete. A four-layer assessment on 2026-04-14 confirmed:

- **Factory engine**: library compiles with 77 passing tests; all contract types (BuildSpec, AdapterManifest, PipelineState, VerificationContract) are production-quality Rust types; SHA-256 Build Spec hashing is implemented; 4 adapters have real manifests with 26+ machine-executable invariants.
- **Policy kernel**: 5-tier settings merge, SHA-256 proof chains with standalone verifier, permission runtime with glob matching, JSONL audit logger with rotation, coherence scheduler, 6 policy gates. 40+ tests.
- **Orchestrator**: DAG validation with topological sort, JSON + SQLite state persistence, checkpoint + approval gates with escalation, verify+retry loop, SSE via Axum with replay. 50+ tests.
- **Spec compiler**: deterministic (golden-tested), JSON Schema validated, 102 features compiled.
- **Desktop**: 100+ Tauri commands, real PKCE auth, GateDialog (512 LOC), BuildSpecStructuredView (618 LOC), full factory pipeline UI.
- **Platform**: Statecraft with 16 DB migrations, 17 API modules, 28 web routes. deployd-api-rs functional. Azure infrastructure production-ready.

However, ten validated gaps stand between "working system" and "the bridge the whole town can use on day one." This spec closes them, with the Governance Certificate as the central deliverable that creates a category of one.

---

## Competitive Context

No other system connects intent to spec to governed code to auditable deployment as a single traceable chain.

| System | What it does | What it lacks |
|---|---|---|
| **Microsoft Agent Governance Toolkit** (MIT, April 2026) | Runtime policy engine, cryptographic agent identity (DIDs), trust scoring, execution rings, kill switch | No spec system. No intent-to-code pipeline. No traceability. Governance is middleware — it intercepts, it doesn't generate governed work. |
| **NVIDIA Agent Toolkit + OpenShell** | Policy-based security guardrails, network/privacy enforcement | Runtime-only. No design-time governance. No code generation. |
| **LangGraph / LangChain** | Agent orchestration, state machines, tool calling | Zero governance. No audit trail. No approval gates. |
| **n8n** ($2.3B raise) | Visual workflow automation, low-code agents | No governed delivery. No audit. Visual-first, not contract-first. |

OAP's structural advantage: governance is the execution model, not a sidecar. The spec spine makes this architecturally true. The governance certificate makes it provable.

---

## Central Deliverable: The Governance Certificate

The governance certificate is a single JSON artifact produced at the end of every successful factory pipeline run. It is the document a CTO hands to an auditor and says: "this is how we know what our AI built and why."

No other tool on the market produces this artifact.

### Content Model

```json
{
  "certificateVersion": "1.0.0",
  "pipelineRunId": "uuid",
  "timestamp": "ISO-8601",
  "status": "complete | incomplete",

  "intent": {
    "requirementsHash": "sha256 of input requirements document(s)",
    "specId": "the governing spec ID",
    "specHash": "sha256 of spec.md at pipeline start"
  },

  "buildSpec": {
    "hash": "sha256 of frozen Build Spec YAML",
    "approvalRecord": {
      "approvedBy": "identity",
      "approvedAt": "ISO-8601",
      "gateType": "approval",
      "timeout": "seconds"
    }
  },

  "stages": [
    {
      "stageId": "s0-preflight",
      "status": "passed | failed | skipped",
      "artifactHashes": { "artifact-name": "sha256" },
      "gateResult": { "passed": true, "checksRun": 3, "checksFailed": 0 },
      "durationMs": 1234
    }
  ],

  "verification": {
    "compile": "passed | failed | skipped",
    "test": "passed | failed | skipped",
    "lint": "passed | failed | skipped",
    "typecheck": "passed | failed | skipped",
    "securityScan": "passed | failed | skipped"
  },

  "traceability": [
    {
      "generatedFile": "src/models/user.ts",
      "governingRequirement": "FR-003",
      "specId": "102-governed-excellence",
      "buildSpecSection": "data_model.entities[0]"
    }
  ],

  "proofChain": {
    "recordCount": 42,
    "firstRecordHash": "sha256",
    "lastRecordHash": "sha256",
    "chainIntegrity": "verified"
  },

  "compliance": {
    "frameworks": ["owasp-asi-2026"],
    "mappings": [
      { "control": "ASI01", "mechanism": "Build Spec freeze + hash", "status": "covered" }
    ]
  },

  "certificateHash": "sha256 of this document excluding this field"
}
```

### Generation Pipeline

1. Factory pipeline completes (all stages pass or pipeline halts with partial certificate).
2. The certificate generator collects: requirements hash, Build Spec hash and approval record from PipelineState, all stage artifact hashes, all gate results, verification outcomes, proof chain summary from policy-kernel, and traceability links.
3. The certificate is hashed (SHA-256 of canonical JSON excluding the `certificateHash` field).
4. The certificate is persisted alongside pipeline outputs and emitted via SSE.

### Verification

The `verify-certificate` command independently re-derives all hashes from source artifacts and validates the proof chain. If any hash mismatches or chain links are broken, verification fails with a specific diagnostic.

---

## Requirements *(mandatory)*

### Phase A — Factory Fix + Certificate Foundation (FR-001 to FR-010)

*Unblock the factory binary and build the governance certificate as the central output.*

- **FR-001**: System MUST compile the `factory-run` binary by supplying `on_gate_checkpoint: None` to all `DispatchOptions` construction sites in `crates/factory-engine/src/bin/factory_run.rs` (lines 310 and 418).

- **FR-002**: System MUST define a `GovernanceCertificate` JSON Schema at `factory/contract/schemas/governance-certificate.schema.json` conforming to the content model in this spec.

- **FR-003**: System MUST generate a `GovernanceCertificate` at the end of every factory pipeline run, containing at minimum: `pipelineRunId`, `timestamp`, `status`, `intent` (requirements hash, spec ID, spec hash), `buildSpec` (hash, approval record), `stages` (per-stage status, artifact hashes, gate results), `verification` (compile/test/lint/typecheck/security), `proofChain` (record count, first/last hash, integrity status), and `certificateHash`.

- **FR-004**: The governance certificate MUST include the proof chain summary from policy-kernel, with `recordCount`, `firstRecordHash`, `lastRecordHash`, and `chainIntegrity` derived from `verify_proof_chain()`.

- **FR-005**: The governance certificate MUST include SHA-256 hashes of all stage output artifacts, computed at the time of certificate generation.

- **FR-006**: The governance certificate MUST include gate pass/fail results for every stage gate that executed during the pipeline run.

- **FR-007**: System MUST provide a `verify-certificate` CLI subcommand (in factory-engine or as a standalone binary) that validates a governance certificate by re-deriving artifact hashes and checking proof chain integrity, exiting 0 on success and 1 on any mismatch.

- **FR-008**: The governance certificate MUST be self-authenticating: `certificateHash` is the SHA-256 of the canonical JSON representation of the certificate with the `certificateHash` field set to empty string, so that any post-generation tampering is detectable.

- **FR-009**: System MUST persist the governance certificate to the pipeline's artifact output directory as `governance-certificate.json`.

- **FR-010**: System MUST emit a `governance-certificate-generated` SSE event via the orchestrator's `LocalEventNotifier` when a certificate is successfully produced.

> **Amendment 2026-05-11 — Cryptographic Provenance over Self-Hash.**
> An external HIAS readiness assessment surfaced FR-008's `certificateHash`
> as insufficient cryptographic provenance: a self-referential SHA-256 over
> the certificate's own canonical JSON is tamper-evident against accidental
> corruption but **not** against an adversary who can write the certificate
> file. Any process with write access can modify any field, recompute the
> hash with `certificateHash` zeroed, write the new hash back, and the
> verifier accepts the tampered cert as valid. The reviewer-facing summary
> is the hash-vs-signature category error: hashing is a binding (this byte
> stream produced this digest); signing is a provenance claim (this private
> key vouched for these bytes). FR-008 conflated the two; this amendment
> separates them.
>
> The amendment is **additive** — FR-008's `certificateHash` is retained
> as a content-binding fingerprint *inside the signed payload* (still
> useful for content-addressing and accidental-corruption detection).
> Authoritative provenance now lives in a new Ed25519 signature.
>
> - **FR-008.1** (Ed25519 signature). The governance certificate MUST
>   carry a `cert_signature` field (base64) containing an Ed25519
>   signature over the canonical JSON of the certificate with
>   `cert_signature` set to empty string and `certificate_hash` already
>   populated. The signing key is resolved at certificate-generation
>   time from `OAP_SIGNING_KEY` (base64-encoded 32-byte seed) or
>   `OAP_SIGNING_KEY_PATH` (file path to a base64-encoded seed); if
>   neither is set, an ephemeral key is generated for the lifetime of
>   the pipeline run and the certificate is marked
>   `signing_attestation.kind: "ephemeral"` (see FR-008.3).
>
> - **FR-008.2** (Public-key embedding). The certificate MUST carry a
>   `signing_public_key` field (base64, 32 bytes) so the verifier can
>   check the signature without external key infrastructure. This makes
>   the cert self-attesting *for the binding cert↔public_key*; the
>   verifier's trust in the public key itself is established by the
>   `signing_attestation` taxonomy below.
>
> - **FR-008.3** (Signing attestation taxonomy). The certificate MUST
>   carry a `signing_attestation` object describing what the public key
>   means:
>   - `kind: "ephemeral"` — key generated for this run only; trust is
>     "the run produced consistent claims," nothing more. Suitable for
>     local dev. Rejected by HIAS-strict verification.
>   - `kind: "operator"` — key supplied via `OAP_SIGNING_KEY` or
>     `OAP_SIGNING_KEY_PATH` by an operator outside the agent's write
>     scope. Trust is "the operator who provisioned this key vouches
>     for runs using it." Suitable for non-CI signed environments.
>   - `kind: "sigstore-rekor"` — anchored to the Sigstore transparency
>     log via the CI workflow's GitHub Actions OIDC identity; trust is
>     "an auditor can independently verify this binding without trusting
>     OAP infrastructure." Required by HIAS-strict verification.
>     (Implemented by a companion spec amendment — see deferred work
>     below.)
>
> - **FR-008.4** (Verifier signature check). `verify_certificate` MUST
>   verify `cert_signature` against `signing_public_key` and the
>   canonical JSON before any other check; signature failure MUST cause
>   `verify_certificate` to exit 1 with a specific diagnostic. The
>   self-hash check (FR-008 original) remains but is no longer the
>   authoritative provenance check — it is a redundant content-binding
>   assertion.
>
> - **FR-008.5** (HIAS-strict mode — deferred to follow-up amendment).
>   `verify_certificate` MUST grow a `--hias-strict` flag that rejects
>   any certificate whose `signing_attestation.kind` is not
>   `"sigstore-rekor"`, and additionally validates the Rekor inclusion
>   proof. The default (non-strict) mode accepts `"ephemeral"`,
>   `"operator"`, and `"sigstore-rekor"` certificates as cryptographically
>   valid (subject to signature verification) but does not anchor the
>   public key's trust externally. This FR is **scoped out of the
>   initial Ed25519 landing** — it is the contract for a follow-up
>   change that adds the CI workflow Sigstore step + Rekor-aware
>   verifier. Landing the Ed25519 signing first establishes the
>   substrate (canonical-bytes layout, signature field placement,
>   verifier hook) that the Sigstore step layers over.
>
> - **FR-008.6** (Proof-chain anchor signing). The proof-chain
>   `policy_bundle_hash` initial-record anchor has the same self-
>   referential weakness as the original FR-008 (the chain re-derives
>   its own hashes; an adversary who can regenerate the chain produces
>   a consistent-looking chain with no external anchor). Spec 047's
>   ProofChain MUST carry an Ed25519 signature over the genesis link
>   using the same key resolution as FR-008.1, so a signed certificate
>   anchored to a chain rooted in an unsigned bundle hash is not a
>   shippable inconsistency. The chain-side change is contracted by an
>   amendment to spec 047 (FR-009-1, FR-009-2) landing in the same PR.
>
> **Scope of the immediate landing (P0-3a).** FR-008.1, FR-008.2,
> FR-008.3 (kinds `ephemeral` and `operator` only), FR-008.4,
> FR-008.6, and the companion spec 047 amendment. FR-008.3
> (`sigstore-rekor` kind) and FR-008.5 (HIAS-strict mode) are
> contracted but unbuilt; they land in P0-3b alongside the CI workflow
> Sigstore step.

### Phase B — Governance Plumbing Completion (FR-011 to FR-020)

*Wire the policy bridge, author stage gate configs, compose evaluation paths, harden platform seams.*

- **FR-011**: System MUST implement a concrete `PolicyEvaluator` struct that bridges `tool-registry`'s `PolicyKernelHandle` to `policy-kernel`'s `evaluate()` function, usable by any crate that depends on both.

- **FR-012**: System MUST author stage gate check YAML configs for all 6 factory process stages (s0 through s5) at `factory/contract/checks/{stage-id}.checks.yaml`.

- **FR-013**: Stage gate check configs MUST cover at minimum: `artifact-exists` (output files present), `schema-validation` (JSON Schema conformance for structured outputs), and `grep-absent` (no forbidden patterns such as TODO placeholders) check types.

- **FR-014**: System MUST compose the two policy evaluation paths: when a tool call passes through `tool-registry`, the `PolicyEvaluator` bridge calls `policy-kernel evaluate()`, which appends a `ProofRecord` to the proof chain. The decision (Allow/Deny/Ask) flows back through the bridge to the tool-registry's `can_use()` gate.

- **FR-015**: The `ToolCallContext` passed to `policy-kernel evaluate()` MUST include `feature_ids` identifying which specs govern the current execution context, derived from the active workflow manifest or factory pipeline state.

- **FR-016**: Platform's policy bundle endpoint (`platform/services/statecraft/api/policy/policy.ts`) MUST enforce OIDC M2M JWT validation, rejecting unauthenticated requests with HTTP 401.

- **FR-017**: Platform's grants endpoint (`platform/services/statecraft/api/grants/grants.ts`) MUST enforce OIDC JWT validation, rejecting unauthenticated requests with HTTP 401.

- **FR-018**: Every permission decision made through the `PolicyEvaluator` bridge MUST produce a `ProofRecord` in the proof chain, including the tool name, decision, and governing spec IDs.

- **FR-019**: Stage gate check configs MUST be discoverable: the `verify_harness` module loads them by convention from `factory/contract/checks/{stage-id}.checks.yaml`, falling back to adapter-specific overrides if present.

- **FR-020**: The `tool-registry` MUST default to deny (not ask) when no `PolicyKernelHandle` is configured, enforcing fail-closed semantics for ungoverned execution contexts.

### Phase C — Traceability Unification + Compliance (FR-021 to FR-030)

*Unify the traceability path, add compliance vocabulary to the spec compiler, automate registry freshness.*

- **FR-021**: The `codebase-indexer` MUST be designated as the single authoritative source of structural spec-to-code traceability. This convention MUST be documented in `CONTRIBUTING.md`.

- **FR-022**: The `featuregraph` crate MUST consume traceability mappings from `.derived/codebase-index/index.json` rather than performing independent source-file scanning. The `// Feature:` header convention becomes optional enrichment, not the primary path.

- **FR-023**: The spec-compiler MUST support an optional `compliance` frontmatter key with structure: `compliance: [{framework: "owasp-asi-2026", controls: ["ASI01", "ASI02"]}]`.

- **FR-024**: The spec-compiler MUST emit `compliance` data in `registry.json` as a structured field per feature when present in frontmatter, passing JSON Schema validation.

- **FR-025**: System MUST provide a `compliance-report` CLI command (in registry-consumer or as a new tool) that generates a framework-to-requirement mapping from the compiled registry, showing which specs cover which controls.

- **FR-026**: System MUST provide a `Makefile` target (`make registry`) or equivalent that recompiles `registry.json` and `index.json` from current sources, runnable in CI and locally.

- **FR-027**: The governance certificate's `traceability` section MUST map generated files to their governing spec requirements, sourced from the codebase index and Build Spec structure.

- **FR-028**: The spec-compiler MUST validate that all `depends_on` references resolve to existing spec IDs, emitting violation `V-008` for unresolved references.

- **FR-029**: The spec-compiler MUST emit warning `W-008` when a spec has `implementation: complete` but no `implements` paths exist in the codebase index for that spec ID.

- **FR-030**: The `compliance` frontmatter key MUST support at minimum these framework identifiers: `owasp-asi-2026`, `soc2`, `iso-27001`, `eu-ai-act`, `nist-ai-rmf`. The set MUST be extensible without code changes (data-driven, not hardcoded enum).

### Phase D — OWASP ASI 2026 + Security Hardening (FR-031 to FR-040)

*Address the OWASP Top 10 for Agentic Systems with concrete mechanisms.*

- **FR-031**: Every agent execution session MUST have a unique, traceable identity tuple (`agent_id`, `session_id`, `workspace_id`) recorded in all proof-chain records produced during that session. (Addresses ASI01 — Agent Goal Hijack: traceable identity enables drift detection.)

- **FR-032**: The orchestrator MUST implement a circuit breaker that suspends agent execution after N consecutive tool-call failures (configurable, default 5) within a sliding window. (Addresses ASI07 — Cascading Failures.)

- **FR-033**: System MUST filter agent output through a content-safety scan before writing artifacts to disk, checking for secrets patterns (AWS keys, Azure connection strings, private keys, JWT tokens, API keys matching `sk-`, `AKIA`, `-----BEGIN`). (Addresses ASI05 — Information Disclosure.)

- **FR-034**: The factory pipeline's final validation stage (s6g equivalent) MUST include a security verification pass that runs adapter-specific security scan commands and fails the stage on any finding. (Addresses ASI09 — Unsafe Code Execution.)

- **FR-035**: The circuit breaker MUST emit a `circuit-breaker-tripped` SSE event and append a `ProofRecord` with `decision: Deny` and `reason: "circuit-breaker"` when triggered. (Addresses ASI07.)

- **FR-036**: Agent identity (`agent_id`, `session_id`, `workspace_id`) MUST be immutable for the duration of a pipeline run. Any attempt to modify identity mid-run MUST be rejected. (Addresses ASI03 — Privilege Escalation.)

- **FR-037**: Output filtering MUST be configurable per adapter via a `security.output_filter_patterns` key in the adapter manifest, allowing adapters to extend the default pattern set. (Addresses ASI05.)

- **FR-038**: The governance certificate MUST include an `owasp_asi` section listing which ASI controls are covered by the pipeline run and which mechanisms enforced them. (Addresses ASI10 — Agent Behavior Drift: the certificate itself becomes the drift-detection record.)

- **FR-039**: System MUST provide a `security-scan` check type in the gate framework (`checks.rs`) that executes adapter-declared security scan commands with timeout and captures structured results. (Addresses ASI09.)

- **FR-040**: All security verification failures MUST be recorded as structured audit events in the orchestrator's SQLite event store, including the check type, command, output, and governing spec ID. (Addresses ASI09.)

---

## Non-Functional Requirements

- **NF-001**: Governance certificate generation MUST add less than 500ms to pipeline completion time.

- **NF-002**: Certificate verification (`verify-certificate`) MUST complete in under 2 seconds for pipelines with up to 50 stage artifacts.

- **NF-003**: All certificate fields MUST be deterministic — identical pipeline inputs produce identical certificate content (excluding `timestamp` and `pipelineRunId`).

- **NF-004**: The `PolicyEvaluator` bridge MUST add less than 5ms p99 latency per tool call.

- **NF-005**: Circuit breaker state MUST survive process restart (persisted to the orchestrator's SQLite workflow state).

- **NF-006**: All changes MUST maintain backward compatibility with existing pipeline manifests and adapter manifests. No breaking changes to the `DispatchOptions`, `WorkflowManifest`, or `AdapterManifest` types.

- **NF-007**: The compliance mapping MUST be extensible to additional regulatory frameworks without code changes — framework identifiers are data-driven strings, not hardcoded enums.

- **NF-008**: OWASP ASI 2026 coverage MUST address at minimum: ASI01 (Agent Goal Hijack), ASI03 (Privilege Escalation), ASI05 (Information Disclosure), ASI07 (Cascading Failures), ASI09 (Unsafe Code Execution), ASI10 (Agent Behavior Drift).

- **NF-009**: Output filtering MUST process content at a rate of at least 10 MB/s to avoid becoming a pipeline bottleneck.

- **NF-010**: Registry recompilation (`make registry`) MUST complete in under 5 seconds for 150 specs.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `cargo build -p factory-engine --bin factory-run` compiles without errors.

- **SC-002**: A complete factory pipeline run produces a `governance-certificate.json` in the artifact output directory.

- **SC-003**: `verify-certificate governance-certificate.json` returns exit code 0 for an untampered certificate and exit code 1 for a certificate with any modified artifact hash.

- **SC-004**: The governance certificate passes JSON Schema validation against `factory/contract/schemas/governance-certificate.schema.json`.

- **SC-005**: `tool-registry` calls `policy-kernel evaluate()` for every tool dispatch, verified by proof-chain record count matching tool-call count in a test pipeline.

- **SC-006**: All 6 factory process stages (s0-s5) have corresponding gate check YAML configs in `factory/contract/checks/`.

- **SC-007**: `featuregraph` resolves traceability from `.derived/codebase-index/index.json` — no independent file scanning for spec mappings.

- **SC-008**: `registry.json` contains `compliance` data for at least 5 specs tagged with OWASP ASI mappings.

- **SC-009**: Circuit breaker trips after the configured threshold of consecutive failures and emits `circuit-breaker-tripped` event.

- **SC-010**: Agent sessions have immutable `agent_id` + `session_id` + `workspace_id` in all proof-chain records for a pipeline run.

- **SC-011**: Output filter detects and flags at minimum: AWS access keys (`AKIA`), private keys (`-----BEGIN`), `sk-` prefixed API keys, and Azure connection strings.

- **SC-012**: Platform policy and grants endpoints reject unauthenticated requests with HTTP 401.

- **SC-013**: `make registry` recompiles both `registry.json` and `index.json` and the result includes spec 102.

- **SC-014**: `compliance-report --framework owasp-asi-2026` produces a valid mapping of controls to implementing spec IDs.

- **SC-015**: No regressions in existing factory-engine tests (77), policy-kernel tests (40+), orchestrator tests (50+), or spec-compiler tests.

---

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — Factory Pipeline Produces Governance Certificate (Priority: P1)

A developer runs the factory pipeline to generate a governed application. The governance certificate proves the full chain.

**Why this priority**: The governance certificate is the single artifact that differentiates OAP from every other system on the market. Without it, OAP is a good tool. With it, OAP is a category of one.

**Independent Test**: Run `factory-run` end-to-end with the `acme-vue-node` adapter and verify certificate output.

**Acceptance Scenarios**:

1. **Given** a configured factory pipeline with the `acme-vue-node` adapter and valid business requirements, **When** the pipeline runs to completion (all stages pass gates), **Then** a `governance-certificate.json` exists in the artifact output directory with a valid schema, containing the requirements hash, Build Spec hash, approval record, all stage results, verification outcomes, proof chain summary, and a self-authenticating `certificateHash`.

2. **Given** a completed pipeline run, **When** the governance certificate is read, **Then** the `proofChain.recordCount` is greater than zero, `proofChain.chainIntegrity` is `"verified"`, and every stage in `stages` has a non-empty `artifactHashes` map.

3. **Given** a pipeline run where a stage gate fails, **When** the pipeline halts, **Then** a governance certificate is still emitted with `status: "incomplete"`, the failing stage's `gateResult.passed` is false, and subsequent stages have `status: "skipped"`.

---

### Scenario 2 — Certificate Independently Verifiable (Priority: P1)

An auditor receives a governance certificate and wants to verify it without trusting the system that produced it.

**Why this priority**: Independent verifiability is what makes the certificate trustworthy. A certificate that can only be validated by the system that produced it is not an audit artifact — it is marketing.

**Independent Test**: Run `verify-certificate` against a real certificate and a tampered certificate.

**Acceptance Scenarios**:

1. **Given** a governance certificate and the corresponding pipeline artifacts on disk, **When** `verify-certificate governance-certificate.json` is run, **Then** it recomputes all artifact hashes and proof-chain links and exits with code 0.

2. **Given** a governance certificate where one output artifact has been modified after generation, **When** `verify-certificate` is run, **Then** it reports the specific artifact whose hash mismatches and exits with code 1.

3. **Given** a governance certificate where the `certificateHash` has been recalculated after modifying a field, **When** `verify-certificate` is run with access to the original proof chain, **Then** it detects the proof-chain integrity failure (the chain records the original hashes).

---

### Scenario 3 — Tool Dispatch Enforced via Policy Bridge (Priority: P1)

Every tool call in a governed context passes through the policy kernel, producing an auditable proof record.

**Why this priority**: Without the bridge, tool-registry and policy-kernel are two independent systems. The bridge makes governance operational, not theoretical.

**Independent Test**: Run a factory pipeline and verify proof-chain records match tool-call count.

**Acceptance Scenarios**:

1. **Given** a `tool-registry` with a `PolicyKernelHandle` configured, **When** a tool call is dispatched, **Then** `policy-kernel evaluate()` is called before execution and a `ProofRecord` is appended to the chain with the tool name, decision, and governing spec IDs.

2. **Given** a `tool-registry` with no `PolicyKernelHandle`, **When** a tool call is dispatched, **Then** the dispatch is denied with a `PolicyKernelNotConfigured` error — fail-closed, not fail-open.

3. **Given** a policy rule that denies `file_write` for tools operating under a draft spec, **When** a tool call targets a file governed by a draft spec, **Then** the tool call is denied and a `Deny` proof record is written with reason `"spec-status-draft"`.

---

### Scenario 4 — Stage Gates Block Non-Compliant Artifacts (Priority: P2)

Stage gate check configs validate that each pipeline stage produces correct, complete outputs before the next stage begins.

**Why this priority**: The verification infrastructure is fully built (7 check runners, all tested). The configs that feed it are the missing piece. Without configs, verification passes vacuously.

**Independent Test**: Run the factory harness against a stage with intentionally missing artifacts.

**Acceptance Scenarios**:

1. **Given** a factory stage s1 (business requirements) with gate check config requiring `entity-model.json` to exist and pass schema validation, **When** the stage completes without producing a valid `entity-model.json`, **Then** the gate fails and the pipeline halts with diagnostic output identifying the failing check.

2. **Given** all 6 factory stage gate configs loaded, **When** the factory harness runs `gate-check s3`, **Then** it executes all checks declared in `factory/contract/checks/s3-data-model.checks.yaml` and reports pass/fail per check.

---

### Scenario 5 — Compliance Mapping in Spec Compiler Output (Priority: P2)

The spec compiler recognises compliance frontmatter and produces a compliance matrix alongside the registry.

**Why this priority**: Enterprise procurement teams evaluate whether a system can demonstrate regulatory coverage. A machine-compiled compliance matrix from specs to framework controls is the unlock.

**Independent Test**: Add compliance frontmatter to 5 specs and run the compiler.

**Acceptance Scenarios**:

1. **Given** a spec with frontmatter `compliance: [{framework: "owasp-asi-2026", controls: ["ASI01", "ASI05"]}]`, **When** the spec compiler runs, **Then** `registry.json` includes the compliance data in that feature's entry, and it passes JSON Schema validation.

2. **Given** the compiled registry with compliance data on 5+ specs, **When** `compliance-report --framework owasp-asi-2026` is run, **Then** it outputs a mapping of each OWASP ASI control to the spec IDs that declare coverage, with any uncovered controls flagged.

---

### Scenario 6 — Unified Traceability Query (Priority: P2)

The featuregraph uses the codebase-indexer's output as its traceability source, eliminating the competing convention.

**Why this priority**: Two traceability paths create confusion about which is authoritative. Unification makes governance queries reliable.

**Independent Test**: Run `governance_preflight` and confirm it resolves specs from the codebase index.

**Acceptance Scenarios**:

1. **Given** a compiled codebase index and featuregraph running, **When** `governance_preflight` is called for a set of changed files, **Then** the affected spec IDs are resolved from `.derived/codebase-index/index.json` traceability mappings.

2. **Given** a spec with `implements: [{path: crates/factory-engine}]`, **When** the codebase index is compiled, **Then** the index contains a bidirectional mapping from that spec ID to the package at `crates/factory-engine`.

---

### Scenario 7 — OWASP ASI Agent Identity Enforcement (Priority: P3)

Every agent execution carries an immutable identity recorded in the proof chain, enabling attribution and drift detection.

**Why this priority**: Agent identity is foundational for ASI01 (goal hijack detection) and ASI03 (privilege escalation prevention). It is a prerequisite for the other OWASP controls.

**Independent Test**: Run a factory pipeline and inspect proof-chain records for identity fields.

**Acceptance Scenarios**:

1. **Given** a factory pipeline run, **When** proof-chain records are examined, **Then** every record contains `agent_id`, `session_id`, and `workspace_id` fields with non-empty values.

2. **Given** a pipeline run in progress, **When** the agent identity is queried at two different stages, **Then** the identity tuple is identical at both points — no mid-run identity change.

---

### Scenario 8 — Circuit Breaker Halts Runaway Agent (Priority: P3)

The circuit breaker prevents cascading failures by suspending execution when an agent enters a failure loop.

**Why this priority**: Without blast-radius containment, a failing agent retries forever and can produce cascading damage. The circuit breaker is the ASI07 mitigation.

**Independent Test**: Unit test with mock executor producing N consecutive failures.

**Acceptance Scenarios**:

1. **Given** a circuit breaker threshold of 5 consecutive failures, **When** an agent produces 5 consecutive tool-call failures within the sliding window, **Then** execution is suspended, a `circuit-breaker-tripped` event is emitted via SSE, and a `Deny` proof record is written with reason `"circuit-breaker"`.

2. **Given** a tripped circuit breaker, **When** the process is restarted and the pipeline is resumed, **Then** the circuit breaker state is loaded from SQLite and the agent remains suspended until explicitly reset.

---

## Phasing and Dependencies

```
Week 1: Phase A — Factory Fix + Certificate Foundation
  FR-001 ──→ FR-002..FR-010
  │           (certificate schema, generation, verification, SSE)
  │
  ▼
Week 2: Phase B — Governance Plumbing
  FR-011 ──→ FR-014 ──→ FR-018
  │           (policy bridge → composition → proof records)
  FR-012 ──→ FR-013 ──→ FR-019
  │           (gate configs → check types → discoverability)
  FR-016, FR-017
  │           (platform seam auth)
  FR-020
  │           (fail-closed default)
  │
  ▼
Week 3: Phase C — Traceability + Compliance
  FR-021 ──→ FR-022 ──→ FR-027
  │           (designate indexer → featuregraph consumes → certificate traceability)
  FR-023 ──→ FR-024 ──→ FR-025, FR-030
  │           (compliance key → registry output → CLI report, frameworks)
  FR-026, FR-028, FR-029
  │           (registry freshness, validation improvements)
  │
  ▼
Week 4: Phase D — OWASP ASI + Security
  FR-031 ──→ FR-036
  │           (agent identity → immutability)
  FR-032 ──→ FR-035
  │           (circuit breaker → events + proof)
  FR-033 ──→ FR-037
  │           (output filter → adapter-configurable)
  FR-034 ──→ FR-039 ──→ FR-040
  │           (security verification → check type → audit events)
  FR-038
              (OWASP in certificate)
```

### Phase Dependencies

- **Phase A has no blockers.** FR-001 is a 2-line fix. The rest builds on existing factory-engine and policy-kernel types.
- **Phase B depends on Phase A** (FR-011 needs the factory to compile for integration testing).
- **Phase C depends on Phase A** (FR-027 needs the certificate to exist for traceability embedding).
- **Phase D depends on Phase B** (FR-031 needs the proof-chain bridge from FR-014/FR-018 to record identity).

---

## Out of Scope

- **Desktop app UI changes beyond existing surfaces.** The GateDialog, BuildSpecStructuredView, and ScaffoldMonitor already exist. This spec does not add new panels or views.
- **Multi-cloud infrastructure beyond Azure.** AWS, GCP, DO, and Hetzner Terraform paths exist as module stubs. Completing them is a separate effort.
- **Platform admin UI for grants/policy management.** The API seams are hardened (FR-016, FR-017) but no new admin screens are added.
- **Licensing decision.** The AGPL-3 vs Apache-2.0/BSL choice is a business decision that should be made alongside this spec but is not a technical requirement.
- **The orchestrator dispatch loop.** The factory-engine binary wires the orchestrator primitives into a working loop. Extracting a reusable `run_workflow()` into the orchestrator crate is a separate architectural decision.
- **Real-time governance drift monitoring.** FR-022 unifies the traceability source. Continuous drift monitoring (watching for divergence on every commit) is a follow-on capability.
- **Agent execution identities with cryptographic signing (DIDs).** FR-031/FR-036 establish traceable identity tuples. Full DID-based cryptographic agent identity is a future enhancement.

---

## Closure record — Phase A pipeline emission (G-2)

Phase A's certificate emission path (FR-003 / FR-009) is wired in
`factory-run` (`crates/factory-engine/src/bin/factory_run.rs`):

- A single `emit_certificate` helper calls `generate_certificate` +
  `persist_certificate` from the `factory_engine::governance_certificate`
  module. The helper is invoked at every termination point — Phase 1
  dispatch failure, Phase 1→2 transition failure, Phase 2 dispatch
  failure, and successful pipeline completion — so an `incomplete`
  certificate is emitted on halt and a `complete` certificate on
  success.
- `intent.requirementsHash` is the SHA-256 of the concatenated
  `--business-docs` byte streams, computed once at start.
- The certificate is persisted as
  `<project>/.factory/runs/<run-id>/governance-certificate.json`,
  alongside the per-stage artifact directories that the verification
  path walks.

A sister binary `build-certificate`
(`crates/factory-engine/src/bin/build_certificate.rs`) generates a
certificate from an existing run directory without re-running the
pipeline — useful for retroactive certification and for the demo flow
documented at the repo root (`make build-certificate FILE=<run-dir>`,
`make verify-certificate FILE=<cert-json>`).

Items still open within spec 102 after this closure:

- **FR-002** — explicit JSON Schema artifact at
  `factory/contract/schemas/governance-certificate.schema.json`. The
  Rust `serde` types are the de-facto schema today; an external schema
  file would let non-Rust consumers validate without rebuilding.
- **FR-010** — `governance-certificate-generated` SSE event via the
  orchestrator's `LocalEventNotifier`. The certificate is written to
  disk; eventing is the remaining wire-up.
- **Phase B / C / D requirements** (FR-011 onward) remain partially
  wired; their closure is tracked by the per-FR success criteria above
  and by the convergence-plan specs (089, 100).

## Follow-ups

Follow-up tracker (parking lot):

- **FU-001 — Surface `single-author-self-pinned` review class
  distinctly in emitted governance artifacts.** Spec 151's
  clarifications-resolved.md schema introduces a `Review:` field on
  every pinned §Decision with one of three values:
  `single-author-self-pinned`, `external-reviewer`, or
  `multi-party-review`. Spec 151 §Clarifications preamble
  "Downstream-treatment contract" requires the governance certificate
  pipeline (this spec, 102) to surface `single-author-self-pinned`
  *distinctly* in emitted artifacts — either as a flagged field in the
  certificate JSON or as a separate evidence class — so downstream
  consumers (auditors, compliance frameworks consuming the
  certificate, future SaaS governance front-ends) do not read a
  self-pinned decision as equivalent to an externally-reviewed pin.
  Self-pinning is a legitimate state for a single-author project; the
  certificate must not claim social proof it does not have.

  *Concrete scope (subject to re-validation against source at
  implementation time per the FU-stub-template-revalidation memory):*
  - Extend the governance certificate JSON Schema (FR-002 — once it
    lands as an explicit artifact at
    `factory/contract/schemas/governance-certificate.schema.json` —
    or the de-facto serde shape until then) to carry a per-decision
    `reviewClass` field with the three enumerated values from spec
    151's schema (`single-author-self-pinned`, `external-reviewer`,
    `multi-party-review`).
  - When the pipeline ingests a spec's `clarifications-resolved.md`
    file (if/when that ingestion lands; today the cert pipeline
    primarily walks `registry.json` + run artifacts, not per-spec
    clarifications), `reviewClass` values MUST be propagated verbatim
    from the source `Review:` field, never inferred.
  - The verifier (`make verify-certificate`) MUST treat
    `single-author-self-pinned` as a flagged class — either by
    counting them in a separate evidence-class bucket in the verify
    output or by emitting a structured advisory diagnostic on the
    verify path (non-fatal, informational). The verifier MUST NOT
    silently aggregate self-pinned and externally-reviewed decisions
    into a single "pinned" count.
  - Downstream consumers of the certificate (OPC desktop, statecraft
    governance UI, OWASP ASI compliance-report renderer) MUST be able
    to filter or sort by `reviewClass` without re-parsing source spec
    files. The certificate is the canonical surface; the field exists
    so downstream is not forced to reach back to source.

  *Why this is a spec 102 follow-up rather than a spec 151
  deliverable:* spec 151 defines the requirement (clarifications-
  resolved.md `Review:` field with three values, downstream-treatment
  contract); spec 102 owns the certificate pipeline and the verifier.
  Implementing the differential surfacing is mechanical once spec
  102 picks it up; landing it in spec 151 would mean spec 151 ships
  a pipeline change in addition to its declarative-reconciliation
  surface, which violates the spec/code-coupling separation.

  *Provisional done-when (re-validate at implementation):*
  (a) `factory/contract/schemas/governance-certificate.schema.json`
  (or the de-facto serde shape, whichever is canonical at
  implementation time) carries a `reviewClass` field on the
  per-decision shape with the three-value enum;
  (b) `make verify-certificate` surfaces self-pinned decisions
  distinctly (counted separately or flagged via informational
  advisory) — verifier exit code unchanged for self-pinned (which is
  a legitimate state, not a failure);
  (c) at least one consumer of the certificate (registry-consumer
  `compliance-report` is the obvious first; OPC desktop's certificate
  surface is acceptable as alternative) renders the `reviewClass`
  field visibly so the differential is reachable end-to-end;
  (d) spec 151's clarifications-resolved.md is the first artifact
  consumed end-to-end (currently nine `single-author-self-pinned`
  decisions) — verified by running the verifier against the spec 151
  Phase 0 artifact set.

  *Cross-reference:* spec 151 §Clarifications preamble (six-field
  schema, specifically the `Review:` field's downstream-treatment
  contract clause) is the originating requirement. Spec 151 Phase 0
  closes by reference to this FU stub existing as named, per spec
  151's schema-preamble clause: "If spec 102 has not added the
  surfacing by spec 151's Phase 0 close, a stub follow-up filed
  against spec 102 is acceptable evidence — the requirement is
  named, not silently assumed."

  *Filed:* 2026-05-17 by bart, against spec 151 Phase 0 closure.
