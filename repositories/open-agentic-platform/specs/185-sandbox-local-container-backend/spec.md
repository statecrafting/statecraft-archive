---
id: "185-sandbox-local-container-backend"
slug: sandbox-local-container-backend
title: "Local-container sandbox backend — rootless Podman / Docker via bollard (companion to spec 162 ASI05)"
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
code_aliases: ["SANDBOX_LOCAL_CONTAINER_BACKEND", "LOCAL_CONTAINER_SANDBOX_CLIENT"]
establishes:
  - unit: { kind: directory, path: crates/sandbox-local-container }
references:
  - role: contract-spec
    unit: { kind: file, path: specs/162-sandbox-execution-contract/spec.md }
  - role: producer-spec
    unit: { kind: file, path: specs/075-factory-workflow-engine/spec.md }
  - role: governance-receipt
    unit: { kind: file, path: specs/102-governed-excellence/spec.md }
  - role: doctrine-source
    unit: { kind: file, path: docs/owasp/owasp_top_10_agentic_applications_summary.md }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI05", "ASI10"]
summary: >
  Concrete local-container backend that satisfies the `SandboxClient`
  contract established by spec 162. Targets the OPC-laptop / developer-
  workstation execution surface (Surface A in spec 162 §1): a developer
  runs OPC, OPC drives a factory-engine pipeline, an adapter emits code,
  the pipeline exercises that code, and *every* exercise step routes
  through this backend rather than the host.

  The backend uses `bollard` (typed Docker Engine API client) against
  either a Docker daemon socket OR a rootless Podman socket (Podman
  exposes a Docker-compatible API surface). Podman is the AGPL-friendly
  default per spec 162 §2.4; Docker is supported for organisations
  already standardised on it. Backend identity, version, and selected
  runtime are emitted into the certificate's opaque
  `runtime_descriptor`.

  This is the first of the two backends spec 162 §5 deferred. The K8s
  backend (kube-rs + PodSecurity + RuntimeClass selection) remains a
  separate companion draft.
---

# 185 — Local-container sandbox backend

## 1. Problem

Spec 162 landed the backend-agnostic sandbox contract: `SandboxClient`
trait, `NullSandboxClient` fail-closed default, certificate
`sandbox-execution` stage shape, and the `exercise()` dispatcher that
honours FR-001 / FR-009 uniformly. With only the null backend
registered, factory-engine refuses to exercise adapter-emitted code at
all — which is the correct safe default but unblocks no actual
adapter exercise.

This spec lands the first operational backend, hitting the **OPC-laptop
/ developer-workstation** path (spec 162 §1 Surface A). The user
journey:

1. Developer runs OPC on a laptop.
2. OPC drives a factory-engine pipeline against an adapter (e.g.,
   `acme-vue-node`).
3. The adapter emits a Vue/Node scaffold.
4. The pipeline needs to lint / typecheck / test / `build` the emitted
   code to verify it before the stage marks complete.
5. **Today (with only the null backend):** the engine halts at the
   exercise step.
6. **With this spec landed:** the engine routes each exercise step
   through `LocalContainerSandboxClient`, which spins up an ephemeral
   rootless container (Podman preferred; Docker as alternative),
   executes the command under the spec 162 invariants, captures
   stdout / output artifacts / resource peak / exit code, tears down
   the container, and returns a `SandboxExecution` ready for the
   certificate.

The cluster surface (Surface B, CI / control-plane) is the K8s
backend's job (separate companion spec, not filed in this PR).

## 2. Decision

### 2.1 Runtime — bollard against a Docker-compatible socket

Use `bollard` (the standard typed Rust client for the Docker Engine
API). bollard speaks the Docker Engine REST API; both **Docker Desktop
/ Docker Engine** and **rootless Podman** expose this API on a Unix
socket:

| Runtime                       | Default socket path                                            |
|-------------------------------|----------------------------------------------------------------|
| Docker Engine / Docker Desktop | `/var/run/docker.sock`                                         |
| Rootless Podman               | `${XDG_RUNTIME_DIR:-/run/user/$UID}/podman/podman.sock`         |
| `DOCKER_HOST` override        | honoured (e.g., `unix:///path/to/socket`, `tcp://host:port`)    |

The backend probes (in order):

1. `DOCKER_HOST` env override.
2. Rootless Podman socket at the XDG runtime path.
3. Docker default socket at `/var/run/docker.sock`.

The first reachable socket wins. The runtime is identified via the
`/info` and `/version` endpoints; Podman is distinguished from Docker
by the presence of `Podman Engine` in `ServerVersion` (or the
`X-Podman-API-Version` response header). Both are treated as
**Tier 2 (restricted container)** unless a future capability probe
identifies a sandbox runtime (gVisor, Kata) registered as the
runtime class — in which case the realised tier MAY be Tier 1 (see
§3 FR-007 for the strongest-tier-by-policy rule).

### 2.2 Image

Adapter-emitted code is exercised in a small, deterministic base image.
For Phase 1 the operator selects the base image via the `SandboxRequest`
(carried in an environment variable or convention; see follow-up
§5). A reasonable default is `gcr.io/distroless/cc-debian12` or
`docker.io/library/alpine:3.20` — both are public, small, and contain
no shell beyond the bare runtime. Image selection itself is not a
contract concern; it is operator configuration.

The backend does NOT manage image registries, signing, or pull
policies beyond passing the image reference through to the runtime.
Image provenance is spec 116's surface (supply-chain policy gates).

### 2.3 Per-execution lifecycle

Every `LocalContainerSandboxClient::execute(request)` call performs the
following sequence:

1. **Validate** the request via `SandboxRequest::validate` (cheap,
   local). On error → `SandboxError::RequestValidation`.
2. **Admission**. Check the request against backend-enforced
   admission rules — see §3 FR-A1..FR-A4. On rejection →
   `SandboxError::AdmissionRejected`.
3. **Materialise inputs**. Write each `InputArtifact` to a temporary
   directory; compute SHA-256 over the materialised bytes and verify
   it matches `InputArtifact.sha256`. Mismatch → `AdmissionRejected`.
4. **Create container** with: image, argv (no shell interpretation),
   read-only rootfs, drop ALL capabilities, no-new-privileges,
   non-root UID, default seccomp profile, network none (Phase 1; see
   §5 for egress proxy follow-up), CPU/memory/PID limits, read-only
   bind mount for inputs, writable bind mount for outputs,
   `AutoRemove` after wait completes, env vars from `request.env`.
5. **Start container**.
6. **Poll resource usage** at fixed cadence (≥ 1 Hz) into a peak
   tracker; the polling task ends when the container exits.
7. **Wait** for container exit with a TTL deadline. On deadline →
   send SIGKILL via Docker API, mark `deadline_hit: true`, treat
   exit code as 137 (SIGKILL).
8. **Read logs** (stdout / stderr) for diagnostic purposes; the
   contract does NOT bind these into the certificate, but they are
   preserved in factory-engine's run directory for debugging.
9. **Materialise outputs**. Walk the output mount, compute SHA-256
   over each file, populate `SandboxExecution.output_artifact_hashes`.
10. **Construct `runtime_descriptor`**: a base64-encoded compact JSON
    `{"backend":"local-container","version":<crate version>,"runtime":<docker|podman>,"runtime_version":<…>}`.
    Verifier treats it as opaque; the JSON shape inside is for
    diagnostic value only.
11. **Tear down**. Container is `AutoRemove`'d. Best-effort cleanup of
    input/output mount directories (operator-configured retention is
    a follow-up).

### 2.4 Egress posture (Phase 1)

Phase 1 supports only the **empty egress allowlist** case
(`SandboxRequest.egress_allowlist == []`). Any non-empty allowlist is
rejected with `SandboxError::AdmissionRejected` and the diagnostic
`"non-empty egress allowlist requires the egress-proxy follow-up
(spec 185 FU-001)"`. This is contract-compliant: spec 162 §2.1 and
FR-009 explicitly allow a backend to refuse rather than emit a
downgraded run.

Egress-allowlist support requires a userspace HTTPS proxy that
terminates TLS in front of the sandboxed container and filters
hostnames against the allowlist. That is mechanism, not contract; it
lands as FU-001 in this spec.

## 3. Functional Requirements

All FRs below apply **in addition to** the spec 162 contract
invariants. The backend's job is to satisfy spec 162's FR-001..FR-010
*as a backend*; these FRs describe how the local-container backend
implements them.

### Backend behaviour

- **FR-001** `LocalContainerSandboxClient::new()` probes for a
  reachable Docker-compatible socket in the order specified in §2.1.
  If none is reachable, the client is constructed in an `Unavailable`
  state; subsequent `execute()` calls return
  `SandboxError::Unavailable` with a diagnostic naming the probed
  socket paths.
- **FR-002** `backend_descriptor()` returns `BackendDescriptor`
  whose `name` is `"local-container"` and whose `version` is the
  crate version. The runtime identity (docker / podman + version)
  appears in `runtime_descriptor`, not in `backend_descriptor`.
- **FR-003** Every successful `execute()` reports
  `isolation_tier: IsolationTier::RestrictedContainer` (Tier 2). A
  future capability probe MAY upgrade to Tier 1 when a sandbox
  runtime (gVisor / Kata) is registered as the default; this MUST
  NOT be silently downgraded.
- **FR-004** The container creation request sets:
  `ReadonlyRootfs: true`; `CapDrop: ["ALL"]`; `SecurityOpt: ["no-new-privileges:true", "seccomp=default"]`;
  `NetworkMode: "none"` (Phase 1); `User: "65534:65534"` (or another
  non-root UID); `PidsLimit: request.resource_ceilings.pid_limit`;
  `Memory: request.resource_ceilings.memory_bytes_limit`;
  `NanoCpus: request.resource_ceilings.cpu_milli_limit * 1_000_000`
  (the bollard NanoCpus field is in nanoseconds-per-second; 1
  milli-CPU == 1_000_000 nanoCPUs).
- **FR-005** Argv is passed as `Cmd: request.command.clone()`. The
  backend MUST NOT shell-interpret. If the operator's intent is "run
  a shell pipeline", the operator wraps it in `sh -c "..."` at the
  *request* layer (where it is auditable in the certificate), not at
  the backend layer.
- **FR-006** Host mounts MUST be limited to two `BindMount` entries:
  the per-execution input directory (read-only) and the per-execution
  output directory (writable). Both directories are created by the
  backend in a per-execution temp root. No other host mounts; no
  `hostPath`-equivalent.
- **FR-007** TTL enforcement: the backend waits on the container with
  a deadline of `request.ttl_seconds`. On deadline, it sends
  `kill --signal SIGKILL` via the Docker API and reports
  `deadline_hit: true` with `exit_code: 137`. The TTL ceiling defined
  in `factory_contracts::sandbox::TTL_HARD_CEILING_SECONDS` is
  enforced at request validation; the backend does not re-validate.
- **FR-008** Resource peak is captured by polling the Docker stats
  endpoint at ≥ 1 Hz for the lifetime of the container; the polling
  task records `max(cpu_milli_observed)`, `max(memory_bytes_observed)`,
  `max(pid_observed)` into a `ResourcePeak` returned in the
  `SandboxExecution`. Polling cadence is approximate; the certificate
  binds the *observed peak*, not a continuous time series.
- **FR-009** Output materialisation: after container exit, the
  backend walks the output mount directory recursively, computes
  SHA-256 over each file's bytes, and records the
  `<relative-path, sha256-hex>` pairs in
  `SandboxExecution.output_artifact_hashes`. Directories are not
  hashed; empty files are hashed (SHA-256 of zero bytes).
- **FR-010** `runtime_descriptor` is a base64-standard-encoded UTF-8
  JSON byte string with the keys
  `{"backend","version","runtime","runtime_version"}` in that fixed
  insertion order. The verifier treats it as opaque; the keys are
  documented here for diagnostic introspection only.

### Backend admission rules

- **FR-A1** Non-empty `egress_allowlist` ⇒ `AdmissionRejected`
  with the FU-001 diagnostic (Phase 1; see §5).
- **FR-A2** `request.minimum_isolation_tier ==
  IsolationTier::SandboxRuntime` AND the backend has not detected a
  sandbox runtime ⇒ `AdmissionRejected` with the diagnostic
  `"requested minimum isolation tier sandbox-runtime; backend
  realises restricted-container (tier 2)"`.
- **FR-A3** Image reference resolution failure (image not present
  locally and no pull permission) ⇒ `AdmissionRejected` with the
  diagnostic naming the image reference. Detected at
  `create_container` time when the runtime responds with
  `404 No such image`.
- **FR-A4** Input artifact hash mismatch ⇒ `AdmissionRejected` with
  the diagnostic `"input artifact <path>: declared sha256 <a> but
  materialised bytes hash to <b>"`. Caught at materialisation
  (before container start) so the engine can fail-fast cleanly.
  Currently subsumed by FR-A5 — input materialisation surface lands
  with FU-006; until then no input bytes are accepted at all.
- **FR-A5** Non-empty `input_artifacts` ⇒ `AdmissionRejected` with
  the FU-006 diagnostic. Spec 162's `InputArtifact` carries a path +
  sha256 but no bytes source; Phase 1 of this backend rejects
  rather than guess at the source convention. FU-006 defines the
  materialisation surface and demotes this rule to a soft path-check
  before FR-A4 takes over hash verification.

## 4. Success Criteria

- **SC-001** With a reachable Docker / Podman socket,
  `LocalContainerSandboxClient::new()` constructs successfully and
  `backend_descriptor()` returns the expected name + version.
- **SC-002** A request to run `["echo","hello"]` against a minimal
  image succeeds; the resulting `SandboxExecution` carries
  `command == ["echo","hello"]`, `exit_code == 0`,
  `deadline_hit == false`, a non-empty `runtime_descriptor`, and
  `isolation_tier == IsolationTier::RestrictedContainer`.
- **SC-003** A request that runs `["sleep","9999"]` with
  `ttl_seconds: 2` exits within the TTL bound; the resulting
  `SandboxExecution` carries `deadline_hit == true` and
  `exit_code == 137`.
- **SC-004** A request with a non-empty `egress_allowlist` is rejected
  with `AdmissionRejected` and the FU-001 diagnostic.
- **SC-005** A request with `minimum_isolation_tier:
  IsolationTier::SandboxRuntime` is rejected with `AdmissionRejected`
  (no sandbox runtime probe in Phase 1).
- **SC-006** A request whose `InputArtifact.sha256` does not match the
  materialised bytes is rejected with `AdmissionRejected` before
  container start.
- **SC-007** When the socket is unreachable, `execute()` returns
  `SandboxError::Unavailable` with a diagnostic naming the probed
  socket paths.
- **SC-008** End-to-end with the spec 162 `exercise()` dispatcher:
  `exercise(&client, request).await` returns
  `SandboxExecutionRecord` whose `isolation_tier == 2` and whose
  fields match the underlying `SandboxExecution`.

SC-002 / SC-003 / SC-007 require a live runtime and are gated by the
env var `OAP_SANDBOX_LOCAL_INTEGRATION=1` in the test suite. All
other criteria are exercised by unit tests using injected
test-double sockets where appropriate.

## 5. Scope

### In scope (this spec)

- The `crates/sandbox-local-container` crate.
- `LocalContainerSandboxClient` + `SandboxClient` impl.
- Runtime detection (Docker / Podman socket probing).
- bollard-based container lifecycle (create / start / wait /
  kill / inspect / remove).
- Resource peak polling.
- Input artifact materialisation + hash verification.
- Output artifact walking + hashing.
- Unit tests (no live runtime needed) + integration tests
  (env-var-gated).

### Deferred to follow-up units in this spec

- **FU-001** Egress allowlist via userspace HTTPS proxy. Adds an
  `mitmproxy`-style sidecar (or a Rust-native `rustls`-based proxy)
  that terminates TLS in front of the sandbox and filters hostnames
  against the allowlist. Until FU-001 lands, non-empty allowlists
  are rejected per FR-A1.
- **FU-002** Sandbox-runtime detection. Probe `docker info` /
  `podman info` for registered runtime classes (`runsc`, `kata-runtime`)
  and upgrade the realised tier to Tier 1 when present.
- **FU-003** Image-reference allowlist. Spec 116-aligned policy gate
  enforcing that only signed / approved images may be used as the
  sandbox base. Today the operator picks any image; FU-003 turns this
  into a policy surface.
- **FU-004** Resource-peak via cgroup-direct read. Phase 1 polls the
  Docker stats API at ≥ 1 Hz; FU-004 reads `memory.peak` and
  `cpu.stat` from the container's cgroup directly for higher fidelity
  on Linux. macOS / Docker Desktop have no cgroup visibility, so
  FU-004 is Linux-only.
- **FU-005** Operator configuration surface for image, retention,
  output-mount cleanup policy, polling cadence, and `DOCKER_HOST`
  tcp:// support. Today these are compile-time constants and only
  unix:// `DOCKER_HOST` URIs are honoured; FU-005 lifts them into a
  typed configuration struct. Also includes Podman Machine socket
  discovery on macOS / Windows (`podman system connection list`),
  which Phase 1 omits — those platforms fall through to the
  Docker default socket today.
- **FU-006** Input materialisation surface. Spec 162's `InputArtifact`
  declares `(path, sha256)` but no bytes source; this FU defines the
  surface (likely a per-execution staging directory the caller
  pre-populates) and switches the backend from "reject non-empty"
  (FR-A5) to "materialise + verify + mount read-only" (FR-A4).

### Out of scope (separate spec)

- **K8s sandbox backend** — kube-rs + PodSecurity admission +
  RuntimeClass selection. Hits CI / control-plane path. Distinct
  draft.
- **WASM / V8 isolate backends** — distinct threat model; out of
  scope at the contract layer too per spec 162 §5.
- **Backend registry** — spec 162 §2.4 mentions backends register at
  runtime via configuration. For Phase 1 the backend is just a type
  the caller instantiates and passes as `&dyn SandboxClient`. A
  separate spec will land the configuration-driven backend registry
  if and when more than one operational backend coexists at runtime.

## 6. Compliance — extends spec 162's ASI05 / ASI10 coverage

Spec 162 closed the ASI05 gap by *establishing* the contract.
Spec 185 *extends* that coverage by providing the first operational
backend for the **Surface A** path (developer workstation / OPC
laptop). The K8s companion will extend it to Surface B.

The structural mitigation is unchanged: factory-engine cannot
exercise adapter-emitted code outside `SandboxClient::execute`. What
spec 185 adds is the *capacity* to actually run that exercise under
the contract, rather than halting at every step.

## 7. Cross-references

- **Spec 162** — sandbox-execution-contract. The contract this
  backend implements; FR-001..FR-010 here specialise spec 162's
  invariants for the local-container substrate.
- **Spec 075** — factory-workflow-engine. The producer that calls
  `SandboxClient::execute` via the spec 162 `exercise()`
  dispatcher.
- **Spec 102** — governed-excellence. Consumes the resulting
  `SandboxExecutionRecord` into the run certificate.
- **Spec 116** — supply-chain-policy-gates. Future FU-003 binds
  image-reference allowlists to spec 116's policy surface.
- **Companion (not yet filed)** — K8s sandbox backend. kube-rs +
  PodSecurity + RuntimeClass selection. Distinct draft.
- **`bollard`** — typed Docker Engine API client. Docker Engine
  protocol is the lingua franca; Podman speaks it natively via its
  Docker-compat socket.


## Security hardening amendment (2026-07-02)

Acknowledging the 2026-07-02 security-hardening amendment to spec 162 (sandbox-execution-contract), which this backend implements. The factory-engine shell-boundary documentation recorded there points at the sandbox contract as the isolation integration point; this note satisfies the spec 127 coupling gate for the co-authored spec.md path and requires no change to the local-container backend behavior.
