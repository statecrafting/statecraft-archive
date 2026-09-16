---
id: "162-sandbox-execution-contract"
slug: sandbox-execution-contract
title: "Sandbox execution contract — ephemeral isolation invariants for factory-engine adapter codegen (ASI05)"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
amended: "2026-05-23"
kind: platform
domain: platform
risk: high
depends_on:
  - "075-factory-workflow-engine"  # factory-workflow-engine (the codegen producer)
  - "102-governed-excellence"  # governed-excellence (the certificate chain that records sandbox use)
  - "108-factory-as-platform-feature"  # factory-as-platform-feature
code_aliases: ["ASI05_SANDBOX", "SANDBOX_EXECUTION_CONTRACT", "FACTORY_CODEGEN_SANDBOX"]
establishes:
  - unit: { kind: file, path: crates/factory-contracts/src/sandbox.rs }
  - unit: { kind: directory, path: crates/factory-engine/src/sandbox }
amends:
  - "074-factory-ingestion"  # adds sandbox types module to the factory-contracts crate
constrains:
  - flavor: invariant-freeze
    unit: { kind: directory, path: crates/factory-engine }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: doctrine-source
    unit: { kind: file, path: docs/owasp/owasp_top_10_agentic_applications_summary.md }
  - role: producer-spec
    unit: { kind: file, path: specs/075-factory-workflow-engine/spec.md }
  - role: governance-receipt
    unit: { kind: file, path: specs/102-governed-excellence/spec.md }
  - role: existing-k8s-baseline
    unit: { kind: directory, path: platform/k8s/policies/namespace-baseline }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI05", "ASI10"]
summary: >
  OAP's single largest open OWASP ASI 2026 compliance gap is the
  absence of a hardened execution boundary for code the factory-engine
  emits and then exercises (lint/test/build/run-once). ASI05's
  prescription is **ephemeral micro-sandbox isolation** — and the
  prescription is substrate-agnostic: "hardened containers with rigid
  network policies and low time-to-live thresholds" is one example,
  not the only shape.

  Spec 162 establishes the substrate as a **contract**, not a
  deployment-topology choice. The contract is enforced uniformly
  whether the execution happens inside a developer's OPC laptop run
  (local-container backend, e.g. rootless Podman) or inside a
  CI / control-plane K8s cluster (K8s backend, e.g. gVisor /
  Firecracker / strict-network-policy pod). Both backends are peers
  under one trait surface. The contract is what closes the ASI05
  gap; backend choice is operational.

  This spec is the contract. Two companion specs (filed as
  follow-up drafts) own the backends: a local-container backend
  using rootless Podman/Docker via OCI primitives, and a K8s
  backend using kube-rs + admission policies + RuntimeClass
  selection. Both backends emit the same `sandbox-execution`
  stage record into the governance certificate so the verifier
  sees *how* a given execution was isolated (isolation tier,
  opaque runtime descriptor), not just *that* it was.

  Spec 162 constrains spec 075 (factory-workflow-engine) with an
  invariant: no adapter-emitted code is exercised outside the
  sandbox contract. Existing K8s baseline policies under
  `platform/k8s/policies/namespace-baseline/` remain a precedent
  for the K8s backend, not a normative source for the contract.
---

# 162 — Sandbox execution contract (ASI05)

## 1. Problem

The intent doc §7.3 is unambiguous:

> *"The single largest open compliance gap is the absence of a
> sandboxed execution substrate for code that the factory-engine
> emits and then exercises. Today, when an adapter generates code
> that needs to be linted, tested, or built, the execution happens
> on host runtimes without a hardened isolation boundary. ASI05's
> core prescription is **ephemeral micro-sandbox isolation** —
> gVisor / Firecracker / strict-network-policy K8s pods, with
> TTL ceilings, `pids_limit`, memory + CPU caps, and no host
> file-system or control-plane access."*

OWASP ASI 2026's ASI05 control names this exactly. The OAP coverage
matrix in the convergence doc §3 tagged it as **Primary gap** —
every other ASI control has at least one spec doing structural work
today; ASI05's mitigation does not.

### Two surfaces, one threat model

The gap appears on two execution surfaces — and they are the same
threat:

1. **Surface A — OPC local exercise.** A developer runs OPC on a
   laptop. OPC drives a factory-engine pipeline. An adapter emits
   code. The pipeline exercises that code (lint/test/build/
   run-once) on the developer's host. The threat surface is
   `~/.aws`, `~/.ssh`, browser keychains, dev-time cloud tokens,
   neighbouring source trees, and any container socket mounted
   into the dev environment.
2. **Surface B — Cluster exercise.** The same pipeline, the same
   adapter, the same exercise step — but invoked in CI or a
   deployed OAP control plane. The host is a K8s node. The
   threat surface is service-account tokens, cluster-internal
   endpoints, IRSA / Workload Identity / Azure Managed Identity
   handles, and neighbouring workloads.

Both surfaces face the *same* threat: attacker-controlled code on
a privileged execution context. ASI05's prescription treats them
identically — "ephemeral micro-sandbox environments (e.g.,
hardened containers with rigid network policies and low
time-to-live thresholds)." The "e.g." matters: containers are
an example of the contract, not the contract itself.

### What the gap actually is

1. **Factory-engine adapters emit code.** `acme-vue-node` produces
   Vue/Node scaffolds; future adapters produce other shapes. The
   emitted code typically needs lint/test/build cycles to verify
   it before the pipeline marks the stage complete.
2. **The execution happens on host runtimes today.** Whether the
   pipeline runs on a developer's workstation (OPC-driven local
   runs — Surface A) or in CI or a control plane (Surface B), the
   lint/test/build invocations execute against the host's package
   manager, the host's filesystem, the host's network. No
   isolation boundary exists.
3. **The risk is structural, not theoretical.** A poisoned
   knowledge source (per ASI06), a prompt-injection vector that
   reaches the adapter's code-generation step, a compromised
   upstream dependency in the adapter's template — any of these
   can place attacker-controlled code into the host execution
   context.
4. **Tenant projects inherit the gap.** Per intent doc §7.3 ("at
   both L1 and L2"), a tenant project born of a factory adapter
   carries the same gap. Closing it at the contract level closes
   it for every produced project by construction, regardless of
   which backend the tenant's OPC is configured for.

The K8s baseline policies under
`platform/k8s/policies/namespace-baseline/` already declare
network-deny defaults and resource quotas at the namespace level;
those primitives are necessary but not sufficient. Network deny
applies at the namespace boundary, not at per-execution boundary;
resource quotas cap total namespace consumption, not per-execution
spike. The contract is the per-execution boundary; the K8s
backend (companion spec, see §7) uses those primitives as part of
its implementation.

## 2. Decision — the contract

Establish the sandbox as a **contract** that any backend must
satisfy, then deliver backends as peers.

### 2.1 Contract invariants (every backend MUST satisfy)

Every adapter-emitted code block exercised by the factory-engine
runs through a `SandboxClient::execute` call whose backend
implementation guarantees:

- **Ephemerality.** The execution context exists only for the
  duration of one call. A TTL is enforced inside the backend
  (default 300 s; per-stage override bounded by a hard ceiling
  of 15 minutes). When the TTL fires, the execution is
  terminated and `deadline_hit: true` is reported.
- **Isolation.** No host filesystem visibility beyond a
  per-execution read-only input mount + a per-execution writable
  output mount. No service-account / credential injection. No
  host network identity. No `hostPath`, `hostNetwork`,
  `hostPID`, `hostIPC`, no privileged mode, no Linux capability
  additions.
- **Egress control.** Network egress is denied by default. The
  request declares a per-execution egress allowlist (TLS-verified
  hostnames, not IPs). Backends MUST enforce the allowlist
  in-kernel or via in-userspace proxy; a backend that cannot
  enforce egress allowlist semantics is a degraded backend and
  MUST mark the execution as `isolation_tier: 3` (forbidden) and
  refuse rather than emit a downgraded run.
- **Resource ceilings.** CPU limit, memory limit, and a PID
  ceiling (default 1024) are enforced. `requests ≤ limits`.
- **Non-root + read-only rootfs + seccomp default.** The execution
  runs as a non-root user, on a read-only root filesystem, with
  a default seccomp profile applied (the OCI/runc default at
  minimum; gVisor / Firecracker profiles where the backend
  supports them).
- **Auditable.** Every execution emits a `sandbox-execution`
  stage record into the governance certificate (spec 102 §FR-007)
  binding: the executed command, the input artifact hashes
  (pre-execution), the output artifact hashes (post-execution),
  the resource utilisation peak, the **isolation tier**, an
  **opaque runtime descriptor**, and whether the TTL fired.

### 2.2 Isolation tiers

The contract normalises isolation strength into three tiers,
emitted into the certificate so a verifier can reason about *how*
a given execution was isolated without parsing backend-specific
fields:

- **Tier 1 — sandbox runtime.** A purpose-built isolation runtime
  (gVisor, Firecracker, Kata) is present and used. Strongest
  isolation; the backend's `runtime_descriptor` names the runtime
  for diagnostic value but the verifier treats it as opaque.
- **Tier 2 — restricted OCI container.** Rootless OCI runtime
  (Podman, runc-restricted) with read-only rootfs, seccomp
  default, no host mounts beyond the per-execution input/output
  pair, strict network policy. The common case for both local and
  cluster backends when a sandbox runtime is unavailable.
- **Tier 3 — forbidden.** Reserved for "no usable isolation
  available." Any execution that would land at Tier 3 MUST be
  **refused**, not run. FR-009 codifies this as a contract
  invariant, not a backend-specific behaviour. There is no
  silent fallback to host execution at any tier.

### 2.3 Trait surface

The contract is realised in code as a backend-agnostic Rust trait
in `crates/factory-engine/src/sandbox/`:

```rust
#[async_trait]
pub trait SandboxClient: Send + Sync {
    async fn execute(
        &self,
        request: SandboxRequest,
    ) -> Result<SandboxExecution, SandboxError>;

    fn backend_descriptor(&self) -> BackendDescriptor;
}
```

Where:

- `SandboxRequest` carries the executed command, the input
  artifact handles (path + sha256), the egress allowlist
  (hostnames), the TTL, the resource ceilings, and the requested
  minimum isolation tier.
- `SandboxExecution` carries the output artifact handles, the
  resource peak, the *realised* isolation tier, an opaque
  `runtime_descriptor` byte string (backend identity + version,
  fingerprintable but not parsed by the verifier), and the
  `deadline_hit` flag.
- `SandboxError` distinguishes `Unavailable` (no backend can
  satisfy the request) from `AdmissionRejected` (a backend tried
  but the request violated the contract — over the TTL ceiling,
  unbounded egress, etc.) from `ExecutionFailure` (the run
  failed but the sandbox itself was healthy).

**`SandboxClient` is the contract.** It contains no K8s types, no
Podman types, no OCI types. Backends live in their own modules
and depend on the trait, not the other way around.

### 2.4 Default backend at contract landing

This spec lands the contract, the types, and a
`NullSandboxClient` that is **universally fail-closed** —
every `execute` call returns `SandboxError::Unavailable`. This
is the correct safe default: with no backend installed,
factory-engine refuses to exercise adapter-emitted code rather
than fall back to the host. FR-009 is a contract invariant, not
a backend choice.

The two operational backends are filed as companion specs
(see §7):

- **162-local-container backend** (separate spec, draft) —
  rootless Podman as default; Docker via `bollard` as an
  alternative for organisations already standardised on it.
  Hits the common developer path (OPC laptop runs) first.
- **162-k8s backend** (separate spec, draft) — kube-rs +
  PodSecurity admission + RuntimeClass selection (gVisor /
  Firecracker / standard runc with strict network policy). Hits
  the CI / control-plane path.

Backends register against the contract at runtime; the
factory-engine resolves which backend to use from configuration,
not from the trait surface.

## 3. Functional Requirements

All FRs apply to **the contract**, not a specific backend. A
backend satisfies the FR by implementing the trait such that the
invariant holds.

- **FR-001** Every adapter-emitted code block that the
  factory-engine exercises (lint / test / build / run-once for
  evaluation) is dispatched through `SandboxClient::execute`.
  Direct invocation of host processes for adapter-emitted code
  is a factory-engine violation surfaced at pipeline-time, not
  at audit-time.
- **FR-002** The egress allowlist on a `SandboxRequest` is the
  union of the stage manifest's declared egress hosts and the
  empty set; allowlist entries are TLS-verified hostnames
  (e.g., `registry.npmjs.org`, `ghcr.io`), never IPs. The
  default is the empty set (no egress).
- **FR-003** The TTL on a `SandboxRequest` defaults to 300 s. A
  stage manifest may declare an override bounded by a hard
  ceiling of 900 s (15 min). A request that exceeds the ceiling
  is rejected at request validation, before any backend call.
- **FR-004** Resource ceilings on a `SandboxRequest` are
  required: CPU limit (milli-CPU), memory limit (bytes), PID
  ceiling. The request validator rejects a request whose
  `requests > limits` or whose ceilings are absent.
- **FR-005** A backend MUST run the execution as a non-root user
  on a read-only root filesystem with the OCI default seccomp
  profile applied, no privileged mode, no Linux capability
  additions, and `automountServiceAccountToken: false` semantics
  (no credential injection). A backend that cannot satisfy
  these constraints for a given request MUST return
  `SandboxError::AdmissionRejected`.
- **FR-006** No `hostPath`-equivalent mounts; no host-network;
  no host-PID / host-IPC. The execution sees only the
  per-execution input mount (read-only), the per-execution
  output mount (writable), and whatever the backend's
  containerisation gives it.
- **FR-007** A backend selects the *strongest* isolation tier
  available to it. Tier selection is policy, not
  developer-discretionary. The realised tier is returned in
  `SandboxExecution.isolation_tier` and recorded in the
  certificate.
- **FR-008** Every `SandboxClient::execute` success path emits a
  `sandbox-execution` stage record into the governance
  certificate (spec 102 §FR-007), binding: the executed
  command, the input artifact hashes (pre-execution), the
  output artifact hashes (post-execution), the resource
  utilisation peak, the realised isolation tier, the opaque
  runtime descriptor, and the `deadline_hit` flag.
- **FR-009** When no backend can satisfy the request
  (`SandboxError::Unavailable`) OR the backend rejects on
  admission grounds (`SandboxError::AdmissionRejected`), the
  factory-engine halts the pipeline with an explicit
  diagnostic and does **not** fall back to host execution.
  FR-009 is a contract invariant: it applies to the
  `NullSandboxClient` (always-fail-closed), the local-container
  backend, and the K8s backend identically.
- **FR-010** A tenant project, born of the contract per spec
  167 (born-with kernel), inherits the contract: its own
  factory-engine runs against the same trait surface, the same
  certificate stage shape, and the same fail-closed posture.
  The tenant's backend choice is a configuration concern, not
  a contract concern.

## 4. Success Criteria

- **SC-001** With `NullSandboxClient` registered (no operational
  backend), a factory-engine pipeline that reaches a codegen
  exercise step halts with `SandboxError::Unavailable` and
  emits a certificate entry that records the halt. (Tested in
  this spec's landing PR.)
- **SC-002** An adversarial test — a deliberately malicious
  adapter template — is prevented from reaching the host. The
  pipeline halts; the governance certificate records the
  failure with diagnostic detail. (At contract landing this is
  vacuously true via `NullSandboxClient`; at backend landing the
  test moves to per-backend integration suites.)
- **SC-003** A pipeline run in an offline / degraded environment
  halts at the codegen-exercise step rather than silently
  falling back to host execution. (Tested by configuring the
  factory-engine with `NullSandboxClient` only and asserting
  halt.)
- **SC-004** `verify-certificate` on a `sandbox-execution`
  stage's entry confirms the `(executed_command, input_hashes,
  output_hashes, isolation_tier, runtime_descriptor)` binding;
  tampering with any of these fields fails verification with a
  specific diagnostic.

## 5. Scope

### In scope (this spec)

- The `SandboxClient` trait, `SandboxRequest`, `SandboxExecution`,
  `SandboxError`, `IsolationTier`, `ResourceCeilings`,
  `EgressAllowlistEntry` types (in `crates/factory-contracts/`
  and `crates/factory-engine/src/sandbox/`).
- The `NullSandboxClient` (universally fail-closed).
- The `sandbox-execution` governance-certificate stage shape
  (in `crates/factory-engine/src/governance_certificate.rs`,
  co-authored with spec 102).
- The factory-engine wiring that refuses to exercise
  adapter-emitted code without a successful
  `SandboxClient::execute` call (FR-009 enforcement at the
  exercise dispatcher).
- The certificate hash algorithm that includes the new fields
  (the certificate version was 1.2.0 at the time this spec was first
  drafted; spec 170's signed-manifest chain bumped it past that, so
  the landed code targets `certificate_version: 1.3.0`).
- Unit tests for: type serde round-trips, fail-closed contract
  test, certificate canonical-hash determinism with the new
  stage shape.

### Deferred to companion specs

- **Local-container sandbox backend** (companion spec, draft) —
  rootless Podman / Docker via `bollard`. AGPL-friendly
  default; hits OPC-laptop dev path.
- **K8s sandbox backend** (companion spec, draft) — kube-rs +
  PodSecurity admission policies under
  `platform/k8s/policies/sandbox/` + per-stage pod-spec
  templates under `platform/k8s/sandbox-templates/` +
  RuntimeClass selection (gVisor / Firecracker / standard
  runc). Hits CI / control-plane path.
- **WASM / V8 isolate backends.** Distinct threat-model
  assumptions; future work; out of scope at the contract layer
  too.
- **Audit-log retention.** The certificate records the
  execution; retention of underlying stdout/stderr is an
  operational concern.
- **Cost accounting.** Sandbox resource consumption appears in
  the certificate; aggregation across tenants is separate.

## 6. Compliance — load-bearing for ASI05 and ASI10

This spec is the canonical OAP mitigation for **ASI05**
(Unexpected Code Execution / RCE). Per OWASP ASI 2026 doctrine,
ephemeral micro-sandbox isolation is *the* prescribed
mitigation; spec 162 is the structural contract behind it. The
ASI05 gap closes the moment the **contract** is enforced — i.e.
the moment factory-engine cannot exercise adapter-emitted code
outside `SandboxClient::execute` — not the moment a specific
backend exists. Backends extend the contract's compliance
posture across more execution surfaces; they do not constitute
compliance by themselves.

It is also a co-mitigation for **ASI10** (Rogue Agents): a
compromised codegen agent cannot spin up parasite processes,
exhaust host resources, or persist artifacts outside the
sandbox because every execution is bounded by the §2 invariants
and audited via spec 102.

The intent doc §7.2 records ASI05 as "**NON-NEGOTIABLE GAP**" and
"**Critical** — must be specced as part of this convergence."
Spec 162 is that speccing, in its reframed form: the *contract*
is the structural mitigation; backends are operational delivery.

## 7. Cross-references

- **INTENT doc** §7.3, §9.4.
- **Spec 075** — factory-workflow-engine; constrained by this
  spec's exercise-step invariant. New `establishes:` paths in
  this spec sit alongside spec 075's retroactive ownership of
  `crates/factory-engine/`.
- **Spec 102** — governed-excellence; consumes
  `sandbox-execution` stage entries. The new stage shape is
  co-authored with spec 102 (this spec defines the shape;
  spec 102 defines the certificate envelope and verifier).
- **Spec 108** — factory-as-platform-feature; the sandbox
  contract is part of the platform-feature surface.
- **Spec 167** — born-with kernel emission; tenants inherit
  the contract via the kernel.
- **Spec 116** — supply-chain policy gates; complementary
  (sandbox protects against runtime exploitation; 116 protects
  against ingestion).
- **`platform/k8s/policies/namespace-baseline/`** — precedent
  for the K8s backend (network deny + resource quotas + limit
  range), not normative for the contract.
- **Spec 185 — local-container sandbox backend.** Rootless
  Podman / Docker via `bollard`. Lands the Surface A (developer
  workstation / OPC-laptop) execution path. Filed and landed
  together with this spec's frontmatter flip.
- **Companion (not yet filed) — K8s sandbox backend.** kube-rs
  + PodSecurity admission + RuntimeClass selection. Hits the
  Surface B (CI / control-plane) execution path. Distinct draft.

## 8. Reframe history (amendment record)

This spec was originally filed 2026-05-22 as "Dockerised
execution substrate" with §2 expressed entirely in K8s-pod terms
(PodSecurity admission, `runtimeClassName`,
`activeDeadlineSeconds`). On 2026-05-23, during the architect's
review of the contract-landing plan, the framing was identified
as conflating "the contract that closes ASI05" with "one backend
that delivers the contract." The reframe:

- Splits the §2 normative content into a backend-agnostic
  contract (this spec) and two backend specs (companion
  drafts).
- Pulls FR-001 / FR-008 / FR-009 into the contract, where
  they belong as invariants.
- Pushes admission policies, RuntimeClass selection, and
  K8s manifest authoring into the K8s backend spec.
- Introduces the `isolation_tier (1/2/3)` normalisation in
  the certificate stage shape so the verifier reasons about
  isolation strength without parsing backend-specific
  fields.
- Renames the spec slug from `dockerised-execution-substrate`
  to `sandbox-execution-contract` and the directory
  accordingly. Spec 170's reference is updated in the same
  commit.

The reframe preserves the spec's id (`162`), depends_on graph,
and ASI05 / ASI10 compliance claims. It restructures *how* the
mitigation is presented, not *what* it mitigates.


## Security hardening amendment (2026-07-02)

Acknowledging the 2026-07-02 security-hardening amendment to spec 075 (factory-workflow-engine). The resolver mutex-poison recovery and the documented run_command shell boundary reference this sandbox-execution contract as the isolation integration point for config and spec-derived command strings; the note satisfies the spec 127 coupling gate for the co-authored spec.md path.
