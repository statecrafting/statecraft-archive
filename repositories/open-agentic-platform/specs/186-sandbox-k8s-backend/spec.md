---
id: "186-sandbox-k8s-backend"
slug: sandbox-k8s-backend
title: "K8s sandbox backend — kube-rs + PodSecurity + RuntimeClass selection (companion to spec 162 ASI05)"
status: approved
implementation: complete
owner: bart
created: "2026-05-26"
kind: capability
domain: platform
risk: medium
depends_on:
  - "162-sandbox-execution-contract"  # sandbox-execution-contract (the contract this backend satisfies)
  - "075-factory-workflow-engine"  # factory-workflow-engine (the engine that calls SandboxClient)
  - "102-governed-excellence"  # governed-excellence (cert binds the resulting sandbox-execution record)
code_aliases: ["SANDBOX_K8S_BACKEND", "K8S_SANDBOX_CLIENT"]
establishes:
  - unit: { kind: directory, path: crates/sandbox-k8s }
references:
  - role: contract-spec
    unit: { kind: file, path: specs/162-sandbox-execution-contract/spec.md }
  - role: peer-backend-spec
    unit: { kind: file, path: specs/185-sandbox-local-container-backend/spec.md }
  - role: producer-spec
    unit: { kind: file, path: specs/075-factory-workflow-engine/spec.md }
  - role: governance-receipt
    unit: { kind: file, path: specs/102-governed-excellence/spec.md }
  - role: doctrine-source
    unit: { kind: file, path: docs/owasp/owasp_top_10_agentic_applications_summary.md }
  - role: existing-k8s-baseline
    unit: { kind: directory, path: platform/k8s/policies/namespace-baseline }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI05", "ASI10"]
summary: >
  Concrete K8s backend that satisfies the `SandboxClient` contract
  established by spec 162. Targets the CI / control-plane execution
  surface (Surface B in spec 162 §1): the same factory-engine pipeline
  that runs on a developer laptop runs against a cluster, and every
  adapter-emitted-code exercise step routes through this backend rather
  than the host runner.

  The backend uses `kube-rs` against the operator's kubeconfig (in-cluster
  service account when deployed inside a Pod, `KUBECONFIG` otherwise). It
  synthesises a per-execution Pod manifest carrying every spec 162 §2.1
  invariant (non-root, read-only rootfs, seccomp default, capabilities
  drop ALL, no host*, automountServiceAccountToken=false,
  activeDeadlineSeconds=ttl, resource ceilings) and a per-execution
  NetworkPolicy that default-denies egress. It probes installed
  `RuntimeClass` resources to pick the strongest available isolation
  (gVisor / Kata / Firecracker → Tier 1; default runc → Tier 2). Backend
  identity, kube version, and selected `RuntimeClass` are emitted into
  the certificate's opaque `runtime_descriptor`.

  This is the second of the two backends spec 162 §5 deferred. The
  local-container backend (spec 185) covers the OPC-laptop / developer
  workstation surface; this spec covers the cluster surface. Both are
  peers under one trait surface.
---

# 186 — K8s sandbox backend (companion to 162)

## 1. Problem

Spec 162 §1 names two execution surfaces sharing one threat model:
**Surface A** — a developer's OPC laptop driving a factory-engine
pipeline; **Surface B** — the same pipeline invoked in CI or a deployed
OAP control plane against a Kubernetes node. Surface A is covered by
spec 185 (rootless Podman / Docker via `bollard`). Surface B is the
domain of this spec.

The threat on Surface B is concrete: a K8s node-local service account,
cluster-internal endpoints (the API server, the kubelet, the metadata
service), IRSA / Workload Identity / Azure Managed Identity handles
mounted on the node, and any neighbouring tenant workload sharing the
node. An adapter-emitted-code execution running on a CI runner today
can reach any of those without going through a hardened boundary.

The K8s primitives that close this — PodSecurity admission, restricted
SecurityContext fields, NetworkPolicy, RuntimeClass — already exist in
the platform. What is missing is the **contract-level wiring**: a
`SandboxClient` implementation that takes a backend-agnostic
`SandboxRequest` and translates it into a per-execution Pod +
NetworkPolicy pair that satisfies every spec 162 §2.1 invariant, then
runs it, hashes its outputs, and emits the `sandbox-execution`
certificate record.

This spec is that wiring. It is a peer of spec 185 under the spec 162
trait; neither backend is privileged over the other at the contract
layer. Backend selection is operational configuration.

## 2. Decision

### 2.1 Substrate — kube-rs against the operator's cluster

The backend uses [`kube`](https://crates.io/crates/kube) — the canonical
async Kubernetes client for Rust — as its substrate. Client construction
follows kube-rs's `Client::try_default()` order: in-cluster service
account when the backend runs inside a Pod
(`/var/run/secrets/kubernetes.io/serviceaccount/`); kubeconfig otherwise
(`KUBECONFIG` env var, `~/.kube/config` fallback).

When neither path yields a working client, the backend stays in
`Unavailable` state and every `execute()` returns
`SandboxError::Unavailable` with a diagnostic that names the failure
mode (no kubeconfig, kubeconfig present but apiserver unreachable, etc.).
This matches spec 162 FR-009 verbatim — no host fallback under any
error.

The operator pre-creates the **execution namespace** (default
`oap-sandbox`) with PodSecurity admission labels enforcing the
`restricted` profile:

```yaml
pod-security.kubernetes.io/enforce: restricted
pod-security.kubernetes.io/enforce-version: latest
```

The backend does not create or mutate the namespace. If the namespace
is absent, `execute()` returns `SandboxError::Unavailable`. This is
deliberate: namespace creation is an operator concern, and the
PodSecurity labels are the cluster-side belt to the backend's
braces — they reject anything the backend would synthesise that drifts
from the restricted profile.

### 2.2 Per-execution Pod synthesis

For every `SandboxClient::execute` call the backend synthesises a Pod
manifest with name `oap-sbx-<uuid-v4>`, labels
`oap.io/sandbox=<uuid>` + `oap.io/backend=k8s`, and the following
non-negotiable fields:

| Field | Value | Spec 162 anchor |
|---|---|---|
| `spec.runtimeClassName` | Selected RuntimeClass (§2.4) | FR-007 |
| `spec.activeDeadlineSeconds` | `request.ttl_seconds` (≤ 900) | FR-003 |
| `spec.restartPolicy` | `Never` | (Pod is single-shot) |
| `spec.automountServiceAccountToken` | `false` | FR-005 |
| `spec.hostNetwork` | `false` | FR-006 |
| `spec.hostPID` | `false` | FR-006 |
| `spec.hostIPC` | `false` | FR-006 |
| `spec.securityContext.runAsNonRoot` | `true` | FR-005 |
| `spec.securityContext.runAsUser` | `65534` (nobody) | FR-005 |
| `spec.securityContext.seccompProfile.type` | `RuntimeDefault` | FR-005 |
| `containers[0].securityContext.readOnlyRootFilesystem` | `true` | FR-005 |
| `containers[0].securityContext.allowPrivilegeEscalation` | `false` | FR-005 |
| `containers[0].securityContext.capabilities.drop` | `["ALL"]` | FR-005 |
| `containers[0].securityContext.privileged` | `false` | FR-005 |
| `containers[0].resources.requests.cpu` | `<cpu_milli_request>m` | FR-004 |
| `containers[0].resources.limits.cpu` | `<cpu_milli_limit>m` | FR-004 |
| `containers[0].resources.requests.memory` | `<memory_bytes_request>` | FR-004 |
| `containers[0].resources.limits.memory` | `<memory_bytes_limit>` | FR-004 |
| Volumes | input (emptyDir, readOnly mount), output (emptyDir, writable mount), tmpfs `/tmp` (emptyDir, writable) | FR-005, FR-006 |
| `containers[0].command` | `request.command` (argv) | FR-001 |
| `containers[0].env` | `request.env` (sorted) | (deterministic emission) |

PID ceiling enforcement is **runtime-class dependent**. K8s exposes
`pids_limit` as a kubelet flag, not a Pod field, so the backend
records the requested ceiling in a `oap.io/pid-limit-requested`
annotation on the Pod. RuntimeClasses backed by gVisor / Kata enforce
process count via their own admission paths and honour the annotation;
classic runc inherits the kubelet's `--pod-max-pids` setting. This
limitation is documented in FU-001 and surfaced in the `runtime_descriptor`
so the certificate records what the realised PID ceiling actually was.

### 2.3 Per-execution NetworkPolicy

The backend creates a NetworkPolicy in the execution namespace that
selects on `oap.io/sandbox=<uuid>` and applies a **default-deny**
posture for ingress and egress. The execution sees no inbound traffic
from neighbouring pods and no outbound traffic except what the
NetworkPolicy explicitly allows:

```yaml
podSelector:
  matchLabels:
    oap.io/sandbox: <uuid>
policyTypes: [Ingress, Egress]
egress: []   # phase 1 — see §2.5 for the FQDN allowlist deferral
```

The default-deny posture is `Tier 2` isolation per spec 162 §2.2 — the
in-kernel CNI enforces the boundary. The certificate emits
`isolation_tier: 2` unless the selected RuntimeClass is a Tier 1
sandbox runtime (§2.4).

### 2.4 RuntimeClass selection

At backend construction the client lists `RuntimeClass` resources in
the cluster (`kube::Api::<RuntimeClass>::all`). The selection map is:

| RuntimeClass `metadata.name` (case-insensitive) | Realised tier | Rationale |
|---|---|---|
| `gvisor`, `runsc`, `gvisor-runsc` | Tier 1 | gVisor user-space kernel |
| `kata`, `kata-qemu`, `kata-clh`, `kata-fc` | Tier 1 | Kata VM-isolated container |
| `firecracker`, `firecracker-runc` | Tier 1 | Firecracker microVM |
| (no RuntimeClass set, or any other name) | Tier 2 | Default runc + the §2.2 restricted SecurityContext |

The backend picks the **strongest** RuntimeClass present, deterministic
on name (alphabetical tie-break). When none of the Tier 1 names are
installed the backend selects `None` (no `runtimeClassName` on the Pod)
and reports Tier 2. The cluster's PodSecurity admission still enforces
the restricted profile under runc, so Tier 2 is contract-compliant —
just weaker than a sandbox runtime.

`SandboxRequest.minimum_isolation_tier`:

- `SandboxRuntime` (Tier 1) — admission rejects when no Tier 1
  RuntimeClass is available.
- `RestrictedContainer` (Tier 2) — admission accepts under runc + the
  restricted profile.
- `Forbidden` (Tier 3) — rejected at `SandboxRequest::validate` (spec
  162 §3 FR-009), before the backend sees the request.

### 2.5 Phase boundaries — Phase 1 admission constraints

This spec lands Phase 1 of the K8s backend. Three input-shape
constraints are enforced at admission and deferred as named FU items:

- **FU-001 — Non-empty egress allowlist.** Core NetworkPolicy does
  not natively express FQDN egress rules; FQDN allowlisting requires a
  CNI extension (Cilium FQDN-aware policy, Calico GlobalNetworkPolicy
  with DNS resolution) or an in-namespace egress proxy that terminates
  TLS and enforces SNI. Phase 1 rejects `egress_allowlist` non-empty at
  admission. Phase 2 (separate spec) wires the FQDN policy path under
  whichever CNI the operator deploys.
- **FU-002 — Non-empty input artifacts.** Loading per-execution input
  artifacts into an emptyDir requires either a streaming `kubectl
  cp`-equivalent (kube-rs's `AttachedProcess` against `tar -x`) or a
  pre-execution ConfigMap mount (ConfigMaps cap at 1MiB). Phase 1
  rejects `input_artifacts` non-empty at admission. Phase 2 wires the
  streaming-tar path.
- **FU-003 — Resource-peak sampling.** Phase 1 reports
  `resource_peak: ResourcePeak::default()` (zero across all axes).
  Phase 2 polls `metrics.k8s.io` (metrics-server) for the running Pod
  and records the observed peak. Until then the cert binds zero, which
  is honest about what the backend measured.

Each FU is captured as a follow-up unit in §5; the spec is feature-
complete *for what it lands*, with FU items naming the unfinished work
explicitly rather than implying partial closure.

### 2.6 Backend lifecycle (per `execute` call)

1. **Validate** the request (spec 162's `SandboxRequest::validate`).
2. **Admission** (this backend's own rules):
   - Reject if `egress_allowlist` is non-empty (FU-001).
   - Reject if `input_artifacts` is non-empty (FU-002).
   - Reject if `minimum_isolation_tier == SandboxRuntime` and no
     Tier 1 RuntimeClass is installed.
3. **Synthesise** the per-execution Pod and NetworkPolicy.
4. **Apply** the NetworkPolicy first, then the Pod (order matters: the
   policy must exist before the Pod is scheduled so the CNI installs
   the egress-deny path before any container starts).
5. **Watch** the Pod via kube-rs's `watcher` stream with the
   `activeDeadlineSeconds` ceiling. Branches:
   - `Phase == Succeeded` — collect exit code 0; harvest the output
     emptyDir contents via `kube::Api::<Pod>::exec` running `tar c
     /out`; SHA-256 each artifact.
   - `Phase == Failed` with `reason == DeadlineExceeded` — set
     `deadline_hit: true`; collect exit code from container status;
     attempt output harvest (best-effort — the Pod is shutting down).
   - `Phase == Failed` other — collect exit code from container
     status; harvest outputs.
   - kube-rs returns a watcher error — `SandboxError::ExecutionFailure`
     with the watcher diagnostic.
6. **Cleanup**:
   - Delete the Pod explicitly via `kube::Api::<Pod>::delete` after
     harvest. (`ttlSecondsAfterFinished` is a `JobSpec` field, not a
     `PodSpec` field — Pods do not self-GC after terminal phase. The
     spec 186 backend uses Pods directly rather than Jobs to keep the
     watcher loop one-resource wide; that choice trades the Job's
     built-in GC for explicit lifecycle ownership in `lifecycle.rs`.)
   - Delete the NetworkPolicy explicitly (it has no TTL field).
7. **Emit** the `SandboxExecution` outcome with the realised tier,
   the `runtime_descriptor` (kube-rs version + selected RuntimeClass
   name + cluster apiserver version, JSON-encoded then base64), and
   the `deadline_hit` flag.

### 2.7 Default backend identity

The backend's [`BackendDescriptor`] is `{ name: "k8s", version:
CARGO_PKG_VERSION }`. The `runtime_descriptor` emitted into the cert is
a base64-encoded JSON object:

```json
{
  "backend": "k8s",
  "backendVersion": "<crate version>",
  "kubeVersion": "<apiserver version, e.g. v1.31.2>",
  "runtimeClass": "<selected RuntimeClass name or 'default-runc'>",
  "isolationTier": <1|2>
}
```

The verifier treats the descriptor as opaque per spec 162 §FR-008 —
the JSON shape is for diagnostic value at certificate-read time, not
for verifier policy.

## 3. Functional Requirements

All FRs apply to **this backend's implementation** of the spec 162
contract. The spec 162 §3 FRs apply to the contract; backend-side FRs
below pin the specific shape this backend takes.

### Backend behaviour

- **FR-001** `K8sSandboxClient::new()` MUST attempt the kube-rs default
  client construction sequence (in-cluster → kubeconfig → none). When
  none of the paths yield a working client OR the execution namespace
  is absent OR the cluster's apiserver returns a non-200 on the
  initial `RuntimeClass.list`, the client transitions to `Unavailable`
  and every `execute()` returns `SandboxError::Unavailable` with a
  diagnostic naming the failure mode. There is no fallback to host
  execution.

- **FR-002** [`BackendDescriptor`] MUST be `{ name: "k8s", version:
  CARGO_PKG_VERSION }`. The `runtime_descriptor` in
  [`SandboxExecution`] MUST be a base64-encoded canonical-JSON object
  per §2.7.

- **FR-003** The per-execution Pod MUST set every field listed in §2.2
  table verbatim. Any field whose value is computed from the request
  (resources, command, env, TTL) MUST be derived only from
  `SandboxRequest` fields after `validate()` returns Ok — admission
  reads no out-of-band state.

- **FR-004** The per-execution NetworkPolicy MUST default-deny ingress
  AND egress. Phase 1 emits an empty `egress` rule list (Phase 2's
  FQDN allowlist is the FU-001 deferral).

- **FR-005** RuntimeClass selection MUST follow §2.4: list installed
  classes, pick the strongest match against the §2.4 table
  (alphabetical tie-break inside a tier), record the realised tier on
  the `SandboxExecution`, and reject at admission when
  `minimum_isolation_tier == SandboxRuntime` but no Tier 1 class is
  present.

- **FR-006** Successful `execute()` MUST populate
  `SandboxExecution.isolation_tier` from the realised tier (not from
  `request.minimum_isolation_tier`) and MUST set
  `runtime_descriptor` to the §2.7 base64 JSON. `resource_peak`
  reports zero across all axes (FU-003 wires metrics-server polling).

- **FR-007** Pod cleanup MUST be an explicit `kube::Api::<Pod>::delete`
  call after artifact harvest. NetworkPolicy cleanup MUST also be
  explicit (the resource has no TTL field). Cleanup failures MUST be
  logged but MUST NOT mask the execution outcome — a successful run
  with a failed NetworkPolicy delete is still a successful `execute()`;
  the cert binds the outcome, the orchestrator handles GC retries.

- **FR-008** When the watcher reports `Phase == Failed` with `reason
  == DeadlineExceeded`, the backend MUST set `deadline_hit: true` on
  the `SandboxExecution` outcome. Other `Phase == Failed` reasons
  MUST NOT set the flag.

- **FR-009** Spec 162 §FR-009 applies verbatim: any error from
  `execute()` is mapped to one of `SandboxError::Unavailable`,
  `AdmissionRejected`, or `ExecutionFailure` and the pipeline halts.
  There is no host-execution fallback under any condition.

### Backend admission rules (Phase 1)

- **FR-A1** Non-empty `egress_allowlist` is rejected at admission with
  a diagnostic naming **FU-001**.
- **FR-A2** Non-empty `input_artifacts` is rejected at admission with
  a diagnostic naming **FU-002**.
- **FR-A3** `minimum_isolation_tier == SandboxRuntime` with no
  installed Tier 1 RuntimeClass is rejected at admission with a
  diagnostic naming the missing class set.

## 4. Success Criteria

- **SC-001** With a working kube-rs client + namespace present + no
  Tier 1 RuntimeClass installed, a `SandboxRequest` with
  `minimum_isolation_tier == RestrictedContainer` runs end-to-end,
  emits `isolation_tier: 2`, and the resulting `SandboxExecution`
  passes through the spec 162 `exercise()` dispatcher into a
  `SandboxExecutionRecord`.
- **SC-002** The same request with `minimum_isolation_tier ==
  SandboxRuntime` fails admission with a diagnostic that names the
  missing RuntimeClass set.
- **SC-003** A request whose command exceeds `ttl_seconds` causes the
  Pod's `activeDeadlineSeconds` to fire; the watcher reports
  `Phase == Failed` with `reason == DeadlineExceeded`; the
  `SandboxExecution` carries `deadline_hit: true`.
- **SC-004** With no kubeconfig and not running inside a Pod,
  `K8sSandboxClient::new()` returns an `Unavailable` client; every
  `execute()` call returns `SandboxError::Unavailable` with a
  diagnostic that names spec 186; the spec 162 `exercise()`
  dispatcher maps the error to a `SandboxRefusal { category:
  "unavailable" }`.
- **SC-005** Unit tests exercise the pure builders (Pod synthesis,
  NetworkPolicy synthesis, RuntimeClass selection) without a live
  cluster; integration tests exercise the full lifecycle gated by
  `KUBE_SANDBOX_INTEGRATION=1` against an operator-provided cluster.

## 5. Scope

### In scope (this spec)

- `crates/sandbox-k8s` workspace crate, modules:
  - `lib.rs` — `K8sSandboxClient` (public surface), `SandboxClient`
    impl, `BackendDescriptor`.
  - `admission.rs` — Phase 1 admission rules (FR-A1..A3).
  - `pod_spec.rs` — pure `SandboxRequest → Pod` builder (full §2.2
    invariants).
  - `network_policy.rs` — pure `SandboxRequest → NetworkPolicy`
    builder (full §2.3 invariants).
  - `runtime_class.rs` — pure RuntimeClass selection function (§2.4)
    plus a cluster-aware probe wrapper.
  - `runtime.rs` — kube-rs client construction + namespace +
    RuntimeClass probe (`Unavailable` state when any of these fail).
  - `descriptor.rs` — `runtime_descriptor` JSON-then-base64 encoder.
  - `lifecycle.rs` — `execute()` lifecycle (apply NP → apply Pod →
    watch → harvest → cleanup → outcome).
  - `hashing.rs` — SHA-256 hashing of output artifacts harvested via
    `pods/<name>/exec` (`tar c /out` stream).
- Wire `crates/sandbox-k8s` into the workspace.
- Unit tests on every pure builder, the admission rules, the
  RuntimeClass selection table, and the descriptor encoder.
- Integration test scaffolding (`tests/integration_lifecycle.rs`) gated
  by `KUBE_SANDBOX_INTEGRATION=1` exercising the apply+watch+harvest
  path against an operator-provided cluster.

### Deferred to follow-up units in this spec

- **FU-001 — FQDN egress allowlist.** Wire NetworkPolicy egress rules
  for `request.egress_allowlist` under whichever CNI the operator has
  installed (Cilium FQDN-aware, Calico GlobalNetworkPolicy DNS, or
  in-namespace egress proxy). Lift the admission rejection in FR-A1.
- **FU-002 — Input artifact streaming.** Stream input artifacts into
  the per-execution emptyDir via `kube::Api::<Pod>::exec` against
  `tar -x`. Lift the admission rejection in FR-A2.
- **FU-003 — Resource-peak sampling.** Poll metrics.k8s.io for the
  running Pod and record the observed peak in `resource_peak`. Honour
  the request's `pid_limit` via the §2.2 annotation path.
- **FU-004 — Image policy.** Operator-configurable image reference +
  pull policy + (eventually) image signing verification. Mirrors spec
  185 FU-003 / FU-005.
- **FU-005 — Namespace creation.** Optionally manage the execution
  namespace lifecycle from the backend (with PodSecurity labels) when
  operators opt in; today the namespace is operator-managed only.

### Out of scope (separate spec)

- **Multi-cluster routing.** A backend that picks among multiple
  clusters based on request metadata is a distinct concern; spec 186
  binds to one cluster at construction.
- **Pod log streaming to OPC.** The cert records command outcomes;
  human-readable log streaming is a separate UX surface.
- **Cost / quota accounting per tenant.** Aggregation of per-execution
  resource consumption across tenants is operational analytics, not a
  contract-level concern.

## 6. Compliance — extends spec 162's ASI05 / ASI10 coverage

This backend, together with spec 185, gives spec 162's ASI05 / ASI10
mitigation **two operational surfaces** — the developer workstation
and the cluster. The contract closes the gap; the backends extend
that closure across the surfaces where adapter-emitted code actually
runs. Per the spec 162 §6 doctrine, neither backend is privileged: a
factory-engine configured with this backend is contract-compliant; a
factory-engine configured with spec 185's backend is contract-
compliant; both rely on the same `SandboxClient` trait and the same
certificate stage shape.

The K8s backend interacts cleanly with the existing K8s baseline under
`platform/k8s/policies/namespace-baseline/`:

- `networkpolicy-default-deny.yaml` is the namespace-wide default-deny
  posture. This backend's per-execution NetworkPolicy adds a
  per-Pod-scope policy on top of the namespace policy — the union
  still default-denies; the per-execution policy is what the verifier
  binds to via the `runtime_descriptor`.
- `resourcequota.yaml` caps namespace-wide consumption; the backend's
  per-execution `requests/limits` are the per-Pod-scope ceiling.
  ResourceQuota admission rejects a Pod whose accumulated namespace
  usage would exceed the quota — that rejection surfaces as a
  `SandboxError::ExecutionFailure` (the kube-rs apply call fails),
  which the spec 162 dispatcher treats as a halt.

## 7. Cross-references

- **Spec 162** — the contract. Every backend FR above is a *backend
  shape* of an FR in spec 162 §3.
- **Spec 185** — the peer backend (local-container). This spec is its
  cluster-side counterpart. Where shapes overlap (admission diagnostics
  shape, `runtime_descriptor` encoding, scaffolding shape) they follow
  spec 185's pattern verbatim.
- **Spec 075** — factory-workflow-engine; consumes this backend
  through the spec 162 trait surface; sees no kube-rs types.
- **Spec 102** — governed-excellence; binds the `sandbox-execution`
  stage record this backend emits.
- **Spec 108** — factory-as-platform-feature; the cluster-surface
  backend is part of the platform-feature surface.
- **`platform/k8s/policies/namespace-baseline/`** — operational
  precedent. Not normative for the contract, but the union with
  per-execution policies is what the verifier sees.


## Security hardening amendment (2026-07-02)

Acknowledging the 2026-07-02 security-hardening amendments to spec 162 (sandbox-execution-contract) and spec 185 (sandbox-local-container-backend), which this K8s backend shares the sandbox contract with. The factory-engine shell-boundary documentation recorded there references the sandbox contract as the isolation integration point; this note satisfies the spec 127 coupling gate for the co-authored spec.md paths and requires no change to the K8s backend behavior.
