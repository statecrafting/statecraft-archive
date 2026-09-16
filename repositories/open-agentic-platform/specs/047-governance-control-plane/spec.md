---
id: "047-governance-control-plane"
title: "governance control plane (policy compiler)"
feature_branch: "047-governance-control-plane"
status: approved
implementation: complete
amended: "2026-05-02"
amendment_record: "131-adversarial-prompt-refusal-policy"
kind: platform
domain: tooling
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Compile CLAUDE.md policy files into structured policy bundles containing a constitution
  (always-loaded core rules) and task-scoped shards (retrieved by intent/domain). Includes a
  Rust WASM kernel for deterministic policy enforcement, enforcement gates (destructive ops,
  secrets scanning, tool allowlist, diff size), coherence scheduler with privilege degradation
  (full/restricted/read-only/suspended based on drift), and cryptographic proof chains for
  audit trails.
code_aliases: ["GOVERNANCE_CONTROL_PLANE", "POLICY_COMPILER"]
compliance:
  - framework: "owasp-asi-2026"
    # Coherence scheduler + privilege-degradation + secrets scanner.
    # ASI01 via FR-008 drift-driven privilege degradation; ASI03 via
    # monotonic degradation (no self-promotion); ASI05 via secrets-scanner
    # gate (FR-007); ASI10 via coherence-scoring drift detection.
    controls: ["ASI01", "ASI03", "ASI05", "ASI10"]
origin:
  retroactive: true
---

# Feature Specification: governance control plane (policy compiler)

## Purpose

The existing spec-compiler (Feature 001) compiles `spec.md` files into a deterministic `registry.json` that describes the feature landscape. It is a **build-time** tool: it reads specs, validates frontmatter, and emits a static registry. It has no runtime enforcement role.

Separately, axiomregent (Feature 033) and the governed execution path (Feature 035) enforce permission flags and safety tiers at tool-dispatch time. However, the policy definitions driving those decisions are hardcoded in Rust source (`safety.rs`, `permissions.rs`) rather than derived from a compilable, auditable policy source.

A gap remains: there is no system that compiles human-authored policy documents (CLAUDE.md files, project rules, org-level constraints) into structured, machine-enforceable policy bundles that can be loaded at runtime and enforced deterministically. Teams cannot define org-specific rules, project-scoped constraints, or task-domain guardrails without modifying application code.

This feature introduces the **governance control plane** — a policy compiler that reads CLAUDE.md policy files and emits structured policy bundles consumed by a deterministic WASM enforcement kernel at runtime.

### Relationship to existing spec-compiler (Feature 001)

The spec-compiler and the policy compiler are complementary but distinct:

| Dimension | Spec compiler (001) | Policy compiler (044) |
|-----------|---------------------|-----------------------|
| Input | `specs/*/spec.md` (feature specifications) | `CLAUDE.md`, `.claude/policies/*.md` (behavioral rules) |
| Output | `registry.json` (feature registry) | Policy bundles (constitution + shards) |
| Phase | Build-time | Build-time compilation, runtime enforcement |
| Consumer | CI, governance UI, humans | WASM enforcement kernel, axiomregent router |
| Concern | "What features exist and their status" | "What an agent is allowed to do and how" |

The policy compiler reuses the spec-compiler's frontmatter parsing and validation pipeline where applicable but produces a fundamentally different artifact class.

## Scope

### In scope

- **Policy compilation pipeline** — parse CLAUDE.md and policy markdown files, extract rules, classify into constitution vs shards, emit structured policy bundles.
- **Constitution and shard model** — define the two-tier policy structure and the rules governing classification.
- **Rust WASM enforcement kernel** — a deterministic, sandboxed module that evaluates policy decisions given a tool call context and loaded policy bundle.
- **Enforcement gates** — four gate types (destructive operation guard, secrets scanner, tool allowlist, diff size limiter) enforced by the kernel.
- **Coherence scheduler** — monitors agent behavior drift against loaded policy and degrades privilege level (full, restricted, read-only, suspended).
- **Proof chain / audit trail** — cryptographic hash chain linking every policy decision to the policy bundle version, input context, and decision output.
- **Integration points** with axiomregent (Feature 033/035) and the spec-compiler (Feature 001).

### Out of scope

- **Replacing the spec-compiler** — Feature 001 continues to own feature registry compilation. This feature does not modify `registry.json` output.
- **UI for policy authoring** — a visual editor for CLAUDE.md rules is a follow-on feature. This feature defines the compilation and enforcement machinery.
- **Dynamic policy hot-reload** — initial implementation requires recompilation to update policy bundles. Hot-reload is a future enhancement.
- **Cross-org policy federation** — policies are scoped to a single repository/workspace. Multi-org policy inheritance is out of scope.
- **Tier assignment changes** — safety tier definitions remain governed by Feature 036. The policy compiler consumes tier data but does not redefine it.

## Requirements

### Functional

- **FR-001**: The policy compiler discovers policy source files from well-known paths: `CLAUDE.md` (repo root), `.claude/policies/*.md`, and `CLAUDE.md` files in workspace subdirectories. Discovery order defines precedence (repo root > `.claude/policies/` > subdirectory).
- **FR-002**: Each policy source file is parsed into a set of **policy rules**. A rule has: an identifier, a human-readable description, an enforcement mode (`enforce`, `warn`, `log`), a scope (`global`, `domain:<name>`, `task:<pattern>`), and a gate type (if applicable).
- **FR-003**: Rules scoped `global` with mode `enforce` are classified as **constitution** rules. All other rules are classified as **shard** rules and tagged with their scope for retrieval.
- **FR-004**: The compiler emits a **policy bundle** containing: (a) a constitution section (always loaded), (b) a shard index mapping scope tags to shard content, (c) a bundle metadata block (version, content hash, compilation timestamp, source file manifest).
- **FR-005**: The policy bundle format is deterministic — identical inputs produce byte-identical output (excluding the compilation timestamp in metadata, consistent with Feature 001's `builtAt` treatment).
- **FR-006**: The Rust WASM enforcement kernel loads a policy bundle and exposes a single evaluation function: `evaluate(context: ToolCallContext, policy: PolicyBundle) -> PolicyDecision`.
- **FR-007**: The kernel enforces four gate types:
  - **Destructive operation guard** — blocks or requires confirmation for operations classified as destructive (file deletion, `git reset --hard`, `rm -rf`, etc.) unless the constitution explicitly permits them for the current context.
  - **Secrets scanner** — scans tool call arguments and proposed file content for patterns matching secrets (API keys, tokens, private keys, connection strings). Blocks commit or write operations containing matches.
  - **Tool allowlist** — restricts available tools to those explicitly permitted by the loaded policy for the current scope. Tools not on the allowlist return `PolicyDenied`.
  - **Diff size limiter** — rejects file write operations where the diff exceeds a policy-defined threshold (line count or byte count), forcing decomposition into smaller changes.
- **FR-008**: The coherence scheduler periodically evaluates agent behavior against the loaded policy and assigns a privilege level:
  - **Full** — all permitted operations available. Assigned when behavior aligns with policy (coherence score >= 0.8).
  - **Restricted** — destructive operations require confirmation. Assigned when moderate drift detected (0.5 <= coherence < 0.8).
  - **Read-only** — only read operations permitted. Assigned when significant drift detected (0.2 <= coherence < 0.5).
  - **Suspended** — all operations blocked pending human review. Assigned when severe drift detected (coherence < 0.2).
- **FR-009**: Every policy decision (allow, deny, degrade) produces a **proof record** containing: decision ID (UUID), timestamp, policy bundle content hash, rule ID(s) consulted, input context hash, decision outcome, and a chained hash linking to the previous proof record.
- **FR-010**: The proof chain is append-only and can be verified independently: given the chain and the policy bundle, any third party can replay decisions and confirm the chain integrity.

> **Amendment 2026-05-11 — Proof-chain Anchor Signing (companion to spec 102 FR-008.6).**
> The chain's `policy_bundle_hash` genesis link is a self-referential
> anchor: an adversary who can regenerate the chain produces a
> consistent-looking sequence of `record_hash`/`previous_record_hash`
> pairs with no external trust root. Spec 102's HIAS-driven amendment
> introduces an Ed25519 signature over the governance certificate; the
> same finding applies one level deeper to this chain. Shipping a
> signed certificate that vouches for a chain rooted in an unsigned
> bundle hash is the kind of inconsistency a reviewer surfaces
> immediately. This amendment closes that gap.
>
> - **FR-009.1** (Chain anchor signature). The `ProofChain` (and the
>   builder that constructs it) MUST carry a `genesis_signature` field
>   (base64 Ed25519 signature) over the canonical-JSON serialisation
>   of `{ chain_id, policy_bundle_hash, genesis_timestamp }` — the
>   trio identifying the chain's starting point. The signing key
>   resolution is shared with spec 102 FR-008.1 (`OAP_SIGNING_KEY` /
>   `OAP_SIGNING_KEY_PATH` / ephemeral fallback).
>
> - **FR-009.2** (Anchor verification). The proof-chain verifier
>   (`verify_proof_chain` in `policy-kernel/src/bin/`) MUST verify the
>   `genesis_signature` against the chain's embedded
>   `genesis_public_key` (FR-009.3) before walking the per-record
>   hash chain. Signature failure MUST cause verification to exit 1
>   with a specific diagnostic distinguishing "chain genesis is
>   unsigned" from "chain genesis signature is invalid."
>
> - **FR-009.3** (Anchor public-key embedding). The chain MUST carry
>   a `genesis_public_key` (base64, 32 bytes) and a
>   `genesis_attestation` taxonomy field mirroring spec 102 FR-008.3
>   (`ephemeral` | `operator` | `sigstore-rekor`). HIAS-strict
>   verification (deferred companion to spec 102 FR-008.5) MUST reject
>   chains whose `genesis_attestation.kind` is not `"sigstore-rekor"`.

- **FR-011**: The policy compiler validates all policy source files and reports errors using a violation code scheme consistent with the spec-compiler (V-series codes).

### Non-functional

- **NF-001**: WASM kernel evaluation completes in < 5ms p99 for a single tool call decision (excluding I/O).
- **NF-002**: Policy bundle compilation for a repository with up to 50 policy source files completes in < 2 seconds.
- **NF-003**: The WASM kernel has no access to filesystem, network, or system calls — all inputs are passed via the evaluation function interface.
- **NF-004**: Proof chain storage grows at most linearly with the number of decisions; each record is fixed-size (< 1KB excluding the input context hash).

## Architecture

### Policy compilation pipeline

```
CLAUDE.md (repo root)
.claude/policies/*.md
subdirectory/CLAUDE.md
        |
        v
  +-----------------+
  | Policy Discovery |  -- enumerate well-known paths, apply precedence
  +-----------------+
        |
        v
  +-----------------+
  | Rule Extraction  |  -- parse markdown, extract structured rules
  +-----------------+
        |
        v
  +-----------------+
  | Classification   |  -- constitution vs shard, scope tagging
  +-----------------+
        |
        v
  +-----------------+
  | Bundle Emission  |  -- deterministic serialization, content hash
  +-----------------+
        |
        v
  policy-bundle.json (or .msgpack for binary transport)
```

### Constitution vs shard model

The two-tier model separates always-enforced invariants from context-dependent guidance:

**Constitution** (always loaded):
- Contains rules that apply universally regardless of task or domain.
- Examples: "never commit secrets", "never run `rm -rf /`", "always use the project's preferred language version".
- Loaded into the WASM kernel at session start and never unloaded.
- Typically small (< 100 rules) to minimize evaluation overhead.

**Shards** (loaded by intent/domain):
- Contains rules scoped to specific task types or code domains.
- Examples: "when editing database migrations, require a rollback step", "in the payments module, log all state transitions".
- Retrieved by matching the current task context against shard scope tags.
- Multiple shards may be active simultaneously.
- Shard loading is additive — a shard can tighten but never relax constitution rules.

### Enforcement gate detail

| Gate | Trigger | Default action | Override |
|------|---------|---------------|----------|
| Destructive op guard | Tool call matches destructive pattern list | Block | Constitution rule with `allow_destructive: true` for specific context |
| Secrets scanner | Regex/entropy match in arguments or content | Block | No override — constitution-level invariant |
| Tool allowlist | Tool name not in policy-permitted set | Deny | Shard rule adding tool to permitted set for a domain |
| Diff size limiter | Write operation exceeds threshold | Block | Shard rule with elevated threshold for specific file patterns |

### Coherence scoring

The coherence scheduler maintains a rolling window of recent agent actions and computes a score reflecting alignment with loaded policy:

```
coherence_score = (actions_aligned / total_actions) * decay_factor

where:
  actions_aligned = actions that required no policy intervention
  total_actions   = all actions in the rolling window (default: last 50)
  decay_factor    = time-weighted decay favoring recent actions (lambda = 0.95)
```

Privilege transitions are **monotonically degrading** within a session unless a human explicitly restores a higher level. An agent cannot self-promote from restricted to full.

### Privilege degradation levels

```
Full (>= 0.8)
  |  drift detected
  v
Restricted (>= 0.5)
  |  continued drift
  v
Read-only (>= 0.2)
  |  severe drift
  v
Suspended (< 0.2)
  |
  [human intervention required to restore]
```

### Proof chain structure

Each proof record:

```json
{
  "id": "uuid-v4",
  "timestamp": "2026-03-29T12:00:00Z",
  "policy_bundle_hash": "sha256:abcdef...",
  "rule_ids": ["R-001", "R-042"],
  "input_context_hash": "sha256:123456...",
  "decision": "allow | deny | degrade",
  "privilege_level": "full | restricted | read-only | suspended",
  "previous_record_hash": "sha256:fedcba...",
  "record_hash": "sha256:aabbcc..."
}
```

`record_hash = SHA-256(canonical_json(record without record_hash field))`

The chain is rooted at a genesis record whose `previous_record_hash` is the policy bundle's content hash, binding the chain to a specific policy version.

### WASM kernel role

The WASM kernel is the **single enforcement point** for policy decisions:

- Compiled from Rust to `wasm32-wasi` (or `wasm32-unknown-unknown` if WASI is unnecessary given NF-003).
- Loaded by axiomregent's router as a policy evaluator module.
- Receives `ToolCallContext` (tool name, arguments summary, caller identity, current privilege level) and the active policy bundle.
- Returns `PolicyDecision` (allow/deny/degrade + reason + applicable rule IDs).
- **Deterministic**: identical inputs always produce identical outputs. No internal randomness, no clock access, no I/O.
- The kernel is versioned alongside the policy bundle. A bundle is compiled against a specific kernel version; version mismatches are rejected at load time.

### Integration with existing components

**With spec-compiler (Feature 001):**
- The policy compiler is a **separate binary** under `tools/oap/policy-compiler/`, following the same project structure as `tools/spec-spine/spec-compiler/`.
- It reuses the spec-compiler's frontmatter YAML parser (extracted as a shared crate `tools/shared/frontmatter-parser/` or vendored).
- Policy bundles are emitted to `.derived/policy-bundles/` alongside `.derived/spec-registry/`.
- The spec-compiler's `registry.json` gains an optional `policyBundleHash` field per feature, linking features to the policy version that governs them.

**With axiomregent (Feature 033/035):**
- axiomregent's router loads the WASM kernel and active policy bundle at session start.
- Tool dispatch (Feature 035 FR-001) adds a policy evaluation step after tier and permission checks: `check_tier() -> check_permissions() -> evaluate_policy() -> dispatch`.
- Policy denial is surfaced as `AxiomRegentError::PolicyDenied` (new variant alongside `PermissionDenied`).

**With safety tiers (Feature 036):**
- Safety tiers and policy gates are complementary. Tier checks are coarse-grained (tool-level), policy gates are fine-grained (argument-level, content-level).
- A tool may pass tier checks but fail a policy gate (e.g., `workspace.write_file` is Tier 2, but the content contains a secret — secrets scanner blocks it).

## Success criteria

- **SC-001**: The policy compiler reads a CLAUDE.md file and emits a valid policy bundle with constitution and shard sections.
- **SC-002**: A golden test demonstrates byte-identical policy bundle output for identical inputs (excluding compilation timestamp).
- **SC-003**: The WASM kernel, given a policy bundle and a tool call context matching a destructive operation, returns `deny` with the applicable rule ID.
- **SC-004**: The WASM kernel, given a tool call context containing a string matching a secrets pattern, returns `deny` regardless of other policy rules.
- **SC-005**: The WASM kernel, given a tool name not in the allowlist, returns `deny`.
- **SC-006**: The WASM kernel, given a write operation exceeding the diff size threshold, returns `deny`.
- **SC-007**: The coherence scheduler degrades privilege from full to restricted after a configurable number of policy-violating actions in the rolling window.
- **SC-008**: Privilege degradation is monotonic — no path from restricted back to full without human intervention.
- **SC-009**: A proof chain of 100 decisions can be independently verified: recomputing each record hash and chain link confirms integrity.
- **SC-010**: The WASM kernel evaluation latency is < 5ms p99 on a benchmark of 1000 synthetic tool call evaluations.
- **SC-011**: `execution/verification.md` records commands and results for all criteria.

## Contract notes

- The policy bundle format is an internal contract between the policy compiler and the WASM kernel. It is not a public API. Format changes require coordinated version bumps.
- The `PolicyDenied` error variant must be distinguishable from `PermissionDenied` (Feature 035) at the wire level so that clients can present appropriate remediation guidance (policy denial = "this rule forbids it" vs permission denial = "this agent lacks the permission flag").
- Constitution rules are **append-only** across policy bundle versions within a session. A new compilation cannot remove a constitution rule that was active when the session started — this prevents policy downgrade attacks. New sessions load the latest bundle.
- The secrets scanner pattern set is part of the constitution and is not overridable by shards. This is a deliberate design constraint: no task-scoped rule should be able to create an exception for secret leakage.
- Coherence score thresholds (0.8, 0.5, 0.2) are initial defaults and should be configurable per-repository via `.claude/governance.toml` or equivalent. The thresholds chosen here are starting points informed by the ruflo design document.
- The WASM kernel's `wasm32` target means it can run in browsers, server-side runtimes, and edge environments without recompilation — this is intentional for future multi-environment enforcement.

## Risk

- **R-001**: CLAUDE.md files have no standardized structure today. Extracting machine-readable rules from freeform markdown may produce inconsistent results. Mitigation: define a lightweight rule-annotation syntax (e.g., `<!-- policy: ... -->` or a fenced code block with `policy` language tag) and document it. Freeform prose is compiled as advisory (mode: `log`) rather than enforced.
- **R-002**: The WASM kernel adds a new dependency to axiomregent's critical path. Mitigation: NF-001 latency budget; kernel is pre-loaded at session start, not compiled on-demand. Fallback: if kernel load fails, axiomregent degrades to tier+permission enforcement only (Feature 035 behavior).
- **R-003**: Coherence scoring is inherently heuristic. Aggressive degradation may frustrate users; lenient thresholds may miss genuine drift. Mitigation: configurable thresholds, detailed audit trail to explain why degradation occurred, human override path.
- **R-004**: Proof chain storage may grow large for long-running agent sessions. Mitigation: NF-004 bounds record size; chain can be checkpointed and archived periodically with a summary record.
- **R-005**: Shared frontmatter parser extraction (from spec-compiler) may introduce coupling. Mitigation: the shared crate exposes only the YAML-in-markdown parsing interface; no spec-compiler business logic leaks.

## Amendment record

**Amendment 2026-05-02 (record: 131-adversarial-prompt-refusal-policy).**
Added `spec_code_coherence` to the policy-compiler's recognised-gate
allowlist (the `V-106 invalid gate` check) so spec 131's CONST-005
policy block compiles without error. The kernel does not yet evaluate
the gate at tool-call time — CONST-005 is a behavioral policy enforced
by the orchestrated-workflow protocol via
`.claude/rules/adversarial-prompt-refusal.md`. A future spec may add a
`gate_spec_code_coherence` function to `crates/policy-kernel/` if call-
time blocking becomes desirable; the present amendment limits change
to the compiler's gate vocabulary.

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical path rename
`product/apps/desktop/*` → `product/apps/opc/*`. No semantic change
to this spec's claims; owned paths inherit the new prefix.
