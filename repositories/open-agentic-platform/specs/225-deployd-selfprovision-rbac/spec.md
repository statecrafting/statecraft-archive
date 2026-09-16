---
id: "225-deployd-selfprovision-rbac"
title: "deployd Self-Provisioned Per-Namespace RBAC (drop the cluster-wide workloads grant)"
feature_branch: "225-deployd-selfprovision-rbac"
status: approved
implementation: complete  # Mechanism (ClusterRole split + ensure_workload_rbac + env/grants) shipped in #503 under a Spec-Drift-Waiver; this spec is its design home and lands the validated flip: the chart template now suppresses the cluster-wide workloads ClusterRoleBinding when rbac.selfProvision is true, and values-hetzner.yaml enables it. The bind-verb escalation was validated on the real oap-hetzner-master1 K3s cluster on 2026-07-04 before the fallback-drop was wired (see Validation). A follow-up lands the FR-007 teardown self-provision (`rbac::ensure_workload_rbac_for_teardown`, called from `delete_deployment` in routes.rs), so this spec now also authoritatively claims those two deployd-api-rs paths, retiring #503's Spec-Drift-Waiver on them.
kind: platform
domain: platform
created: "2026-07-04"
authors: ["open-agentic-platform"]
language: en
summary: >
  deployd-api creates tenant/preview namespaces on demand and runs
  `helm upgrade --install` inside them. Its workload permissions
  (secrets, deployments, services, ...) were granted CLUSTER-WIDE via a
  single ClusterRoleBinding, so deployd could touch workloads in every
  namespace on the cluster, not just the ones it manages. #503 split the
  RBAC into a cluster-scoped `deployd-controller-namespaces` role (namespace
  CRUD only) and a namespaced `deployd-controller-workloads` role, and added
  an opt-in self-provisioning mechanism (`DEPLOYD_SELF_PROVISION_RBAC`): when
  on, deployd grants its own ServiceAccount the workloads role via a
  RoleBinding it creates in each target namespace, right before helm runs
  there. #503 deliberately left the cluster-wide fallback in place because
  dropping it was gated on real-cluster validation of the `bind`-verb
  escalation. This spec is the design home for that mechanism and lands the
  validated flip: with `rbac.selfProvision: true` the chart no longer renders
  the cluster-wide workloads ClusterRoleBinding, so deployd's standing
  workload authority is reduced from every namespace to only the namespaces
  it actually deploys into. The chart default is unchanged (fallback intact);
  the flip is enabled per-environment via values.
code_aliases: ["DEPLOYD_SELF_PROVISION_RBAC"]
depends_on:
  - "136-tenant-hello-demo-service"  # deployd's helm-upgrade deploy path (Phase 3 cluster-validation-gating precedent)
  - "145-deployd-durability"  # co-owns values-hetzner.yaml (persistence); this spec refines it with the rbac block
establishes:
  - unit: { kind: file, path: platform/charts/deployd-api/templates/rbac.yaml }
  # FR-007 delivery retires #503's Spec-Drift-Waiver on the mechanism module:
  # this spec is the design home for deployd self-provisioning, so it now
  # authoritatively claims the module #503 created. No other spec claims
  # rbac.rs (W-4: a path has at most one establisher).
  - unit: { kind: file, path: platform/services/deployd-api-rs/src/rbac.rs }
refines:
  # Add the rbac.selfProvision block to the Hetzner overlay. Additive concern
  # (RBAC scoping) on a file 143 refines (sweeper secret) and 145 extends
  # (persistence); this refines a distinct aspect, no overlap.
  - aspect: "deployd-selfprovision-rbac"
    unit: { kind: file, path: platform/charts/deployd-api/values-hetzner.yaml }
extends:
  # A new spec adds a node to the featuregraph golden (same precedent as
  # specs 214, 222, 223, 224); claimed additively against 034.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  # FR-007 additively wires the teardown self-provision into routes.rs (the
  # deploy/delete handlers), matching the additive-extends pattern specs 136
  # and 214 already use on this file; the edit lands outside 137's
  # `gate-overlay` co-authored region.
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/routes.rs }
---

# Feature Specification: deployd Self-Provisioned Per-Namespace RBAC

**Feature Branch**: `225-deployd-selfprovision-rbac`
**Created**: 2026-07-04
**Status**: Approved
**Input**: Give the deployd self-provisioning RBAC mechanism (shipped mechanism-only in #503) a spec home, and land the cluster-validated flip that drops the cluster-wide workloads grant.

## Context

A security review (recorded in the `rbac.yaml` header) found that
deployd-api held **cluster-wide** CRUD on `secrets` and every other workload
resource: every namespace on the cluster (`kube-system`, `monitoring`,
`rauthy-system`, ...), not just the tenant namespaces it manages. #503 split
the single ClusterRole into two:

- **`deployd-controller-namespaces`** (cluster-scoped, always bound
  cluster-wide): only `namespaces` CRUD, which cannot be narrowed below
  cluster scope because `Namespace` is not a namespaced resource.
- **`deployd-controller-workloads`** (namespaced): everything deployd needs
  inside a target namespace to run `helm upgrade --install`.

The workloads role was still bound **cluster-wide** by default, because
deployd creates tenant/preview namespaces on demand and had no way to grant
itself workload rights in a namespace it just created. #503 closed that gap
with an opt-in mechanism (`DEPLOYD_SELF_PROVISION_RBAC`,
`deployd-api-rs/src/rbac.rs`): when on, deployd creates a RoleBinding
referencing `deployd-controller-workloads` in each target namespace, right
before helm runs there. Creating that RoleBinding requires the Kubernetes
privilege-escalation guards `create` on `rolebindings` **and** the `bind`
verb on that specific ClusterRole, both granted by the chart when
self-provisioning is enabled.

#503 shipped the mechanism opt-in and **default-off**, and deliberately did
**not** drop the cluster-wide fallback: doing so was gated on validating the
`bind`-verb escalation on a real cluster (only kind-proven at the time, per
the `rbac.yaml` header and the spec 136 Phase 3 precedent). #503 handled all
its coupling with Spec-Drift-Waivers rather than a spec. This spec is the
design home for the mechanism and lands the now-validated flip.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - deployd's blast radius is bounded to the namespaces it manages (Priority: P1)

An operator runs deployd on a shared cluster that also hosts identity
(`rauthy-system`), monitoring, and other unrelated workloads. deployd should
be able to install tenant charts in the namespaces it creates, and nowhere
else. Before this flip, a compromised or buggy deployd could read/modify
`secrets` in every namespace on the cluster.

**Why this priority**: This is the security posture the RBAC split was for.
The split alone did not reduce standing authority (the workloads role was
still bound cluster-wide); only dropping that binding does. The mechanism
that makes dropping it safe (self-provisioning) is what needed real-cluster
validation.

**Independent Test**: Render the chart with `rbac.selfProvision: true` and no
`rbac.namespaces`; assert no cluster-wide `ClusterRoleBinding` for
`deployd-controller-workloads` is produced. On a live cluster, assert
deployd's ServiceAccount cannot list secrets in a namespace it has not
deployed into, but self-provisions access on its next deploy there.

**Acceptance Scenarios**:

1. **Given** `rbac.selfProvision: true` and an empty `rbac.namespaces`,
   **When** the chart renders, **Then** the cluster-wide workloads
   `ClusterRoleBinding` is NOT produced (only the `namespaces`
   ClusterRoleBinding remains), and the deployment carries
   `DEPLOYD_SELF_PROVISION_RBAC=true`.
2. **Given** deployd processes a deploy into namespace `N` with
   self-provisioning on, **When** the deploy handler runs, **Then** deployd
   ensures `N` exists and creates the `deployd-controller-workloads`
   RoleBinding in `N` (idempotent, 409-tolerant) before `helm upgrade
   --install`, so helm has workload rights in `N`.
3. **Given** the chart default (`rbac.selfProvision: false`,
   `rbac.namespaces: []`), **When** the chart renders, **Then** the
   cluster-wide workloads `ClusterRoleBinding` IS produced, exactly as before
   this spec, preserving the working fallback untouched.
4. **Given** an explicit `rbac.namespaces` allowlist, **When** the chart
   renders, **Then** one per-namespace `RoleBinding` is produced for each
   listed namespace and no cluster-wide binding, regardless of
   `rbac.selfProvision`.
5. **Given** BOTH `rbac.selfProvision: true` AND a non-empty
   `rbac.namespaces` (the transitional-cutover configuration), **When** the
   chart renders and deployd runs, **Then** the chart produces the static
   per-namespace `RoleBinding`s from the allowlist (the `if .namespaces`
   branch wins) AND the deployment still carries
   `DEPLOYD_SELF_PROVISION_RBAC=true`, so deployd also self-provisions at
   deploy time. The two coexist safely: the self-provision RoleBinding create
   is 409-tolerant, so a namespace that already has a static binding is a
   no-op. This is the supported transitional state the Cutover section
   recommends for operators who cannot redeploy every tenant at cutover.
6. **Given** `rbac.selfProvision: true` and a DELETE for a tenant whose
   namespace `N` exists but was never self-provisioned (created before the
   flip), **When** `delete_deployment` runs, **Then** deployd creates the
   `deployd-controller-workloads` RoleBinding in `N` (best-effort,
   409-tolerant) before `helm uninstall`, so the uninstall has workload rights
   and tears `N` down cleanly; **And** if `N` is absent, is a reserved /
   platform namespace (`is_valid_tenant_namespace` rejects it), or the RBAC
   step fails, no RoleBinding is written and the delete still proceeds
   best-effort (the failure, if any, is recorded as a `rbac_warning` event).

   **Independent Test**: the disabled short-circuit is unit-tested
   (`teardown_ensure_is_a_noop_when_disabled`); the enabled cluster paths
   (existing-namespace provision, absent-namespace skip, reserved-namespace
   skip) require a live or mocked apiserver and share the deploy path's
   existing coverage boundary (no in-crate kube mock harness yet).

### Edge Cases

- **Existing namespace at cutover.** When the fallback is dropped, deployd
  loses standing workload authority in namespaces it created *before* the
  flip (they have no self-provisioned RoleBinding yet). This is benign:
  deployd only touches workloads during a deploy, and `ensure_workload_rbac`
  runs before helm on every deploy, so the FIRST deploy to such a namespace
  self-heals it (the RoleBinding create is idempotent). Cutover procedure:
  optionally redeploy existing tenants once after the flip to pre-provision
  their RoleBindings, or let them self-heal on next deploy.
- **`bind` verb missing.** If the escalation grant is absent, the RoleBinding
  create returns Forbidden ("attempting to grant RBAC permissions not
  currently held"); the deploy handler fails fast with that specific cause
  (`routes.rs`) instead of an opaque mid-helm "forbidden". This is the
  load-bearing check the negative control on kind proved.
- **Namespace deployd did not create.** `ensure_workload_rbac` creates the
  RoleBinding regardless of who created the namespace (namespace create is
  409-tolerant), so an externally-created target is self-provisioned on first
  deploy too.
- **Teardown path self-provisions (FR-007, delivered).** `delete_deployment`
  (`routes.rs`) now calls `ensure_workload_rbac_for_teardown` before `helm
  uninstall` / `uninstall_with_gate`, so a DELETE of a namespace created
  before the flip and never redeployed (hence never self-provisioned)
  provisions the workloads RoleBinding first and tears down cleanly instead of
  hitting `Forbidden` on uninstall. Three deliberate differences from the
  deploy path keep the delete safe: the teardown variant provisions only into
  an **existing** namespace (a namespace already gone is left alone, so
  teardown never resurrects an orphan); the RBAC write is **gated on
  `is_valid_tenant_namespace` inside the self-provision entry point**
  (defense-in-depth for every caller, the same reserved-name check
  `create_deployment` applies up front), because the delete path derives the
  namespace from the recorded column or the `app_id-env_id` fallback for legacy
  rows and does not otherwise revalidate it, and the chart's `bind` grant is
  cluster-wide, so a legacy row resolving to `kube-system` must not receive a
  deployd RoleBinding; and the call is **best-effort** (a failure is logged and
  recorded as a `rbac_warning` event, not fatal) so the delete stays
  idempotent: the DB row is still marked destroyed on a transient RBAC error,
  exactly as the surrounding best-effort uninstall already behaves. On a
  deployd image predating FR-007, the original gap stands and the Cutover
  procedure below is the mitigation.

## Requirements *(mandatory)*

### Functional Requirements: mechanism (shipped in #503, documented here)

- **FR-001**: The chart MUST split deployd's permissions into a
  cluster-scoped `deployd-controller-namespaces` ClusterRole (namespace CRUD
  only, always bound cluster-wide) and a namespaced
  `deployd-controller-workloads` ClusterRole (the helm workload verb set).
- **FR-002**: When `rbac.selfProvision` is true, the
  `deployd-controller-namespaces` ClusterRole MUST additionally grant
  `create`/`patch` on `rolebindings` and the `bind` verb on
  `deployd-controller-workloads`, and the deployment MUST project
  `DEPLOYD_SELF_PROVISION_RBAC=true` plus the ServiceAccount name, pod
  namespace (downward API), and workloads-ClusterRole-name env the code reads.
- **FR-003**: When `DEPLOYD_SELF_PROVISION_RBAC` is on, deployd-api-rs MUST,
  before `helm upgrade --install` in a target namespace, ensure that
  namespace exists and create a RoleBinding referencing
  `deployd-controller-workloads` binding its own ServiceAccount (idempotent,
  409-tolerant), and MUST fail the deploy fast with a clear cause if that
  RBAC step is rejected (`ensure_workload_rbac`, wired in `routes.rs`).

### Functional Requirements: the flip (this PR)

- **FR-004**: When `rbac.selfProvision` is true and no explicit
  `rbac.namespaces` allowlist is supplied, the chart MUST NOT render the
  cluster-wide `deployd-controller-workloads` ClusterRoleBinding. deployd's
  standing workload authority is then exactly the set of namespaces it has
  self-provisioned, not the whole cluster.
- **FR-005**: The chart default MUST leave `rbac.selfProvision: false` and
  `rbac.namespaces: []`, preserving the cluster-wide fallback untouched. The
  flip is enabled per-environment via values (`values-hetzner.yaml` sets
  `rbac.selfProvision: true`), never by changing the chart default.
- **FR-006**: The `bind`-verb escalation MUST be validated on the real target
  cluster before the fallback-drop is enabled for that environment. An
  operator MUST NOT enable `rbac.selfProvision` on a cluster where deployd's
  ServiceAccount has not been shown to successfully self-provision a
  workloads RoleBinding (see Validation for the Hetzner evidence).

### Functional Requirements: the teardown follow-up (delivered)

- **FR-007** *(delivered, code follow-up)*: The teardown path
  (`delete_deployment` in `routes.rs`) calls
  `ensure_workload_rbac_for_teardown` for the target namespace before `helm
  uninstall` / `uninstall_with_gate`, so a namespace that was never
  self-provisioned can still be torn down cleanly once the cluster-wide
  fallback is gone. Three design differences from the deploy path's
  `ensure_workload_rbac` keep the delete safe and idempotent: (a) it provisions
  **only into a namespace that already exists** (a namespace already deleted is
  left untouched, because recreating it just to attach a RoleBinding would
  orphan an empty namespace, the very leak this closes); (b) the RBAC write is
  **gated on `is_valid_tenant_namespace` inside the self-provision entry point
  itself** (defense-in-depth: every caller is covered, not just the delete call
  site), because the delete path derives the namespace from the recorded column
  or the `app_id-env_id` fallback and the chart's `bind` grant is cluster-wide,
  so an untrusted value resolving to a reserved namespace must not receive a
  deployd RoleBinding (the same reserved-name check `create_deployment` applies,
  now shared from `rbac.rs`); and (c) the call is
  **best-effort** (a failure is logged, recorded as a `rbac_warning` event, and
  the delete continues), so a transient RBAC error still marks the DB row
  destroyed rather than wedging the deployment, matching the best-effort
  posture of the uninstall it precedes. Landed as a deployd-api-rs code change
  (new `rbac::ensure_workload_rbac_for_teardown`, wired in `routes.rs`) plus an
  image rebuild; before it landed, the Cutover procedure below covered existing
  tenants. A deployd image predating this change retains the original teardown
  gap, so the Cutover mitigation still applies there.

## Key Entities

- **`deployd-controller-namespaces`** / **`deployd-controller-workloads`**:
  the two ClusterRoles the RBAC split produced.
- **`rbac.selfProvision`** (chart value, default `false`): master switch for
  the self-provisioning grants + env and (per FR-004) the fallback-drop.
- **`DEPLOYD_SELF_PROVISION_RBAC`**: the env the running deployd reads
  (`SelfProvisionConfig::from_env`) to decide whether to self-provision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `helm template` with `rbac.selfProvision: true` + empty
  `rbac.namespaces` renders exactly one `ClusterRoleBinding` (the namespaces
  one); the chart default renders two (namespaces + workloads fallback); an
  explicit allowlist renders one per-namespace `RoleBinding` per entry.
- **SC-002**: On the real target cluster, deployd's ServiceAccount can create
  the `deployd-controller-workloads` RoleBinding in a namespace it creates
  (the `bind`-gated operation succeeds). Validated 2026-07-04 on
  `oap-hetzner-master1` (see Validation).
- **SC-003**: The coupling gate and spec-lint are green with spec 225
  claiming the new/changed paths: `rbac.yaml` and `values-hetzner.yaml` (the
  chart flip), plus `rbac.rs` (establishes) and `routes.rs` (extends) once the
  FR-007 teardown follow-up retires #503's waiver on the mechanism code.
- **SC-004**: A tenant namespace created before the flip regains deployd
  workload access on its next deploy with no manual RBAC step (self-heal via
  the idempotent `ensure_workload_rbac`).

## Cutover

When the flip reaches a cluster (CD deploy of this chart with
`rbac.selfProvision: true`), helm deletes the cluster-wide workloads
ClusterRoleBinding. From that instant, deployd's standing workload authority
is only the namespaces it has already self-provisioned (initially none). This
is safe for the deploy path (self-heals per FR-003) but leaves the teardown
gap (FR-007). The recommended cutover, ordered:

1. Merge and let CD deploy the flip.
2. Immediately redeploy each currently-live tenant once (there is exactly one
   on Hetzner today: `oap-statecrafting-single-simple-dev`). Each redeploy
   runs `ensure_workload_rbac`, provisioning that namespace's RoleBinding, so
   both future deploys AND deletes have workload rights there.
3. FR-007 has landed, so a delete now self-provisions the workloads RoleBinding
   before uninstall and tears the namespace down cleanly even if it was never
   redeployed since the flip. This self-heal requires a deployd image carrying
   FR-007; on an image predating it, avoid deleting an un-redeployed tenant (its
   uninstall would be silently best-effort and orphan resources).

An operator who cannot redeploy all tenants at cutover can instead list them
in `rbac.namespaces` as a transitional allowlist (the chart still renders
per-namespace RoleBindings from it even with `selfProvision: true`), then
remove them once each has been redeployed.

## Validation (2026-07-04, oap-hetzner-master1)

The flip was gated on validating the `bind`-verb escalation on real
Kubernetes (kind had proved it; the production K3s target had not). On
2026-07-04, with `rbac.selfProvision: true` applied to the live deployd
release (rev 80, image `sha-918b0c7`, the #503 binary), the exact operation
`ensure_workload_rbac` performs was exercised by impersonating deployd's
ServiceAccount (`system:serviceaccount:deployd-system:deployd-api-sa`):

1. Created a throwaway namespace as the SA (tests the `namespaces` grant): OK.
2. Created a RoleBinding referencing `deployd-controller-workloads` in it as
   the SA (tests `rolebindings` create + the `bind` escalation): OK.
3. Verified the RoleBinding's roleRef/subject; deleted the namespace.

The `bind`-gated create succeeded, confirming the grant authorizes deployd to
self-provision on this cluster. The kind negative control (no `bind` verb ->
Forbidden) established the grant is load-bearing. The deployd Rust code path
is unchanged from #503, so the mechanism validated on kind runs identically
here. This satisfies FR-006 for the Hetzner environment.

## Review follow-ups (2026-07-04)

Acknowledged from the automated review of this PR; none block the flip, all
tracked here so they are not lost:

- **Teardown-gap severity elevates post-flip (FR-007), resolved.** Before the
  flip a teardown `Forbidden` was masked by the cluster-wide grant; after it, a
  never-self-provisioned namespace's `helm uninstall` fails and is swallowed
  as best-effort, silently orphaning resources. FR-007 (self-provision in the
  teardown path) is the durable fix and is now delivered: `delete_deployment`
  provisions the RoleBinding (into the existing namespace, best-effort) before
  uninstall, so a never-redeployed namespace tears down cleanly on its first
  delete under a deployd image carrying FR-007. The Cutover procedure remains
  the mitigation for images predating it. Low residual risk regardless: no
  tenant predates the flip once the clean-slate cluster is the starting point.
- **Self-provision subject comes from env, not a literal.**
  `workload_rolebinding` takes the RoleBinding subject from
  `DEPLOYD_SERVICE_ACCOUNT` / `DEPLOYD_POD_NAMESPACE` (downward API). The
  `bind` grant is scoped to `deployd-controller-workloads` only, so a
  poisoned projection could at worst grant THAT role to an unintended
  subject, not arbitrary escalation. Hardening follow-up: assert the pod's
  own downward-API namespace is authoritative rather than trusting a literal
  env override.
- **No statecraft `audit_log` row for self-provisioned RoleBindings.** They
  appear only in the Kubernetes audit log. If the OAP audit trail is treated
  as the authority for privilege grants, this is a completeness gap. Candidate
  follow-on FR: emit a `deployd.rbac.self_provisioned` audit row.
- **Feature-annotation traceability.** The mechanism's code (`rbac.rs`,
  `routes.rs`) carries no `// Feature: DEPLOYD_SELF_PROVISION_RBAC`
  annotations (it shipped under #503's waiver), so the featuregraph records
  `impl_files: []` for this spec even though it is `implementation: complete`
  on the chart surface it establishes. Adding those annotations is the
  natural companion to retiring #503's Spec-Drift-Waiver; the `code_aliases`
  entry is aligned to the env-var token so a future annotation matches.

### Post-delivery hygiene (follow-up to the FR-007 PR)

The automated review of the FR-007 PR raised several non-blocking nits.
Delivered as a hygiene follow-up:

- **63-char boundary test** for `is_valid_tenant_namespace` (the max
  DNS-1123 label length is accepted, guarding the `> 63` bound against an
  off-by-one drift).
- **Event-detail sanitization.** The RBAC-failure event details on both the
  deploy and teardown paths now pass the untrusted error cause
  (`kube::Error::to_string()`, which can embed an API response body) through
  `sanitize_event_detail`, which flattens (by category, not a codepoint
  enumeration) control characters, all Unicode whitespace and line / paragraph
  separators except a plain space (U+2028, U+2029, ...), and the non-whitespace
  bidi / zero-width / format chars (U+202A-202E, U+2066-2069, U+200B-200F,
  U+FEFF), and caps length, so an error cannot inject a line break, spoof a
  line via a directional override, or write unbounded content into the
  append-only event store (a `TEXT` column). The already-validated `namespace`
  (`[a-z0-9-]`) is interpolated directly; only the untrusted cause is
  sanitized.

Deferred with rationale (tracked, not delivered):

- **Shared kube `Client` in `AppState`.** Both self-provision paths call
  `Client::try_default()` per request. A shared client would avoid the
  repeat config read, but it trades the current lazy/probe pattern (which
  tolerates deployd booting without cluster access) for startup coupling to
  cluster availability. Deletes are not latency-sensitive, so this is a
  deliberate non-change.
- **Namespace deletion on teardown.** Deleting the tenant namespace (not just
  `helm uninstall`) would remove the self-provisioned RoleBinding and any
  residue (true least-privilege cleanup), but it is a teardown-semantics and
  blast-radius change that warrants its own decision rather than a hygiene
  bundle; the current uninstall-only teardown is intentionally conservative.
- **TOCTOU error variant.** If a namespace vanishes between the existence
  check and the RoleBinding create, the create's 404 surfaces as
  `RbacError::RoleBinding` rather than a "namespace gone" outcome. Cosmetic
  (best-effort teardown proceeds either way); distinguishing it would
  complicate the shared create helper the deploy path also uses.
