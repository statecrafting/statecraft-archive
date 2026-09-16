---
id: "226-project-teardown-completeness"
title: "Complete Project Teardown (opt-in repo delete, deployment teardown, namespace deletion)"
feature_branch: "226-project-teardown-completeness"
status: approved
implementation: pending  # Design spec. No code lands in this PR; the contract is captured so the follow-on implementation PRs (statecraft deleteProject flags + deployd namespace deletion) can promote the referenced paths to authoritative relationships and satisfy the coupling gate one subsystem at a time. This spec establishes no code path yet: its only in-PR code change is the featuregraph golden node (extends 034), matching the 214/222/223/224/225 new-spec precedent.
kind: platform
domain: platform
created: "2026-07-04"
authors: ["open-agentic-platform"]
language: en
summary: >
  `deleteProject` is a DB + storage delete only. It orphans two real-world
  resources: the GitHub repository (it drops the `project_repos` link row but
  never deletes the repo) and any live Kubernetes deployment (CASCADE removes
  the `environments` row but nothing calls deployd's teardown, so the helm
  release and tenant namespace linger). This spec makes project teardown
  complete by adding three opt-in, default-off destructive toggles to the
  delete request: (1) delete the GitHub repository (provenance-gated to repos
  OAP created), (2) tear down live deployments (helm uninstall across the
  project's environments), and (3) delete the tenant namespace(s). Each toggle
  is best-effort after the DB commit, mirroring the existing storage-sweep
  posture, and each is independently opt-in because all three are irreversible
  (repo restore is not guaranteed; namespace deletion with PVCs is permanent
  data loss). Toggle (3) promotes spec 225's deferred "Namespace deletion on
  teardown" item into a first-class, gated contract.
code_aliases: ["deleteRepo", "destroyDeployments", "deleteNamespaces"]
depends_on:
  - "119-project-as-unit-of-governance"  # owns `deleteProject` and the project/repo/environment hierarchy this teardown completes
  - "225-deployd-selfprovision-rbac"  # owns deployd's teardown path (`delete_deployment`) and the deferred "Namespace deletion on teardown" item toggle (3) promotes
  - "215-statecraft-deploy-trigger-ux"  # owns `deploydClient.ts` (`destroyPreviewDeployment`), the statecraft->deployd teardown trigger toggle (2) reuses
  - "214-tenant-app-chart-supersession"  # owns the forwarded `environments.k8sNamespace` the teardown resolves per env
  - "136-tenant-hello-demo-service"  # owns deployd's helm uninstall path (`uninstall_with_gate`)
  - "137-tenant-environment-access-gates"  # co-authors `uninstall_with_gate` (the universal teardown FR-006 routes through) with 073/136; the implementation PR promoting `routes.rs` needs this edge
  - "113-statecraft-projects-rename-and-clone"  # established `deleteGithubRepo` (clone rollback), the helper toggle (1) reuses; also the provenance rollback precedent
  - "080-github-identity-onboarding"  # owns `createProjectWithRepo` (the repo-provenance origin: a repo OAP created vs an imported one)
extends:
  # A new spec adds a node to the featuregraph golden (same precedent as
  # specs 214, 222, 223, 224, 225); claimed additively against spec 034 so the
  # golden diff carries a 226 authority. This is the only code path this
  # design-only PR changes.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
references:
  # Non-authoritative pointers to the code paths this spec governs. They are
  # deliberately NOT claimed via establishes/extends/refines in this PR: no
  # code changes here, so claiming them would over-fire the coupling gate.
  # The follow-on implementation PRs promote them (see the Implementation
  # staging section).
  - role: teardown-entry-point
    unit: { kind: file, path: platform/services/statecraft/api/projects/projects.ts }
  - role: repo-delete-helper
    unit: { kind: file, path: platform/services/statecraft/api/projects/cloneHelpers.ts }
  - role: deployment-teardown-trigger
    unit: { kind: file, path: platform/services/statecraft/api/deploy/deploydClient.ts }
  - role: deployd-teardown-handler
    unit: { kind: file, path: platform/services/deployd-api-rs/src/routes.rs }
  - role: deployd-namespace-capability
    unit: { kind: file, path: platform/services/deployd-api-rs/src/rbac.rs }
  - role: repo-provenance-schema
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
---

# Feature Specification: Complete Project Teardown

**Feature Branch**: `226-project-teardown-completeness`
**Created**: 2026-07-04
**Status**: Approved
**Input**: Project delete orphans the GitHub repo and any live deployment. Make teardown complete with three opt-in destructive toggles; promote spec 225's deferred namespace-deletion item into a gated contract.

## Context

`deleteProject` (`platform/services/statecraft/api/projects/projects.ts`, the
`DELETE /api/projects/:id` handler) is a **DB + object-storage delete only**.
It:

- CASCADE-deletes the project's child rows: `project_repos` (the *link*),
  `environments` (the *record*), `project_members`, factory pipelines and
  artifacts, policy bundles, PATs;
- explicitly purges `knowledge_objects` and sweeps their S3 bytes;
- writes a `project.delete` audit row and broadcasts a catalog tombstone.

It does **not** touch two real-world resources the project owns, so both are
silently orphaned by a delete:

1. **The GitHub repository.** The handler drops the `project_repos` link row,
   but the repo itself lives on. A best-effort `deleteGithubRepo(token,
   fullName)` helper already exists (`api/projects/cloneHelpers.ts`, spec 113)
   but is wired only into clone rollback (`cloneWorker.ts`, `cloneCore.ts`),
   never into delete.
2. **The live Kubernetes deployment(s).** CASCADE removes the `environments`
   rows, but nothing calls deployd's teardown, so every helm release and every
   tenant namespace the project deployed into stays running on the cluster.
   The teardown wire already exists: `destroyPreviewDeployment(releaseId)`
   (`api/deploy/deploydClient.ts`, spec 215) calls deployd
   `DELETE /v1/deployments/:id`, whose handler `delete_deployment`
   (`deployd-api-rs/src/routes.rs`) runs `helm uninstall` via
   `uninstall_with_gate` (the universal teardown authored by spec 137,
   co-claimed with specs 073/136). Today it is called **only** from
   `github/webhook.ts` on PR-close preview cleanup, not from project delete.

Even deployd's own teardown is incomplete: `delete_deployment` runs
`helm uninstall` but does **not** delete the tenant namespace. Spec 225
recorded this as a deferred item ("Namespace deletion on teardown ... a
teardown-semantics and blast-radius change that warrants its own decision
rather than a hygiene bundle"). This spec is that decision's home: namespace
deletion becomes toggle (3), gated and opt-in.

### Why three independent, opt-in toggles

All three actions are **irreversible** at materially different blast radii, so
none may be implicit and none may be bundled under a single confirm:

- Deleting a GitHub repo is hard to reverse (GitHub's restore window is
  time-boxed and admin-gated, not guaranteed).
- `helm uninstall` removes the running release; redeploy is possible but the
  live state is gone.
- **Deleting a namespace cascades everything in it, including PVCs**: an
  in-namespace database (deployd can provision a preview Postgres inside the
  tenant namespace via the `preview_database` flag, spec 214 FR-006) and any
  persistent volume is permanently destroyed.

The current design already commits the DB transaction first and then sweeps
storage best-effort (a hiccup leaves recoverable orphaned bytes rather than
rolling back a delete the user confirmed). The three toggles extend exactly
that posture: attempted after the DB commit, best-effort, logged, never a
blocking precondition and never a reason to roll back the delete.

### Toggle to resource to code-path mapping

The three toggles map to the three destroyed resources. The user's three named
entry points collapse onto them as follows (`destroyPreviewDeployment` and
deployd `delete_deployment` are the two ends of the *same* wire, so they are
one toggle, not two; the genuinely-distinct third toggle is namespace
deletion, the spec-225 deferred item):

| Toggle (request flag) | Destroyed resource | Code path |
|---|---|---|
| `deleteRepo` | GitHub repository | `deleteGithubRepo` (`cloneHelpers.ts`) |
| `destroyDeployments` | helm release(s) across the project's environments | `destroyPreviewDeployment` -> deployd `delete_deployment` -> `uninstall_with_gate` |
| `deleteNamespaces` | tenant namespace(s) + PVCs/residue | new deployd namespace-delete capability (extends spec 225's deferred item) |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Default delete stays a safe DB + storage purge (Priority: P1)

An operator deletes a project the ordinary way (no toggles set). Nothing on
GitHub or the cluster is touched: only the DB rows and object-storage bytes are
purged, exactly as today. This preserves the current behavior byte-for-byte as
the safe default and guarantees the destructive toggles are strictly additive.

**Why this priority**: Backwards compatibility and safety. A destructive action
must never be the default; every existing caller of `DELETE /api/projects/:id`
keeps its current semantics with no new irreversible side effects.

**Independent Test**: Call the delete with all three toggles absent/false;
assert the GitHub repo still exists, any helm release is still installed, the
namespace still exists, and the DB rows + storage are gone (today's behavior).

**Acceptance Scenarios**:

1. **Given** a project with a linked repo and a live deployment, **When**
   `deleteProject` runs with `deleteRepo`, `destroyDeployments`,
   `deleteNamespaces` all false (or absent), **Then** the DB rows and storage
   are purged, a `project.delete` audit row is written, and the repo,
   the helm release, and the namespace are all left intact.

### User Story 2 - Delete the GitHub repository, only when OAP created it (Priority: P1)

An operator tearing down a **factory-created** project (its repo was born from
`createProjectWithRepo`) opts into `deleteRepo` so the repo does not outlive the
project. For an **imported** project (the operator brought their own repo),
`deleteRepo` is refused: OAP must not delete a repository it did not create.

**Why this priority**: Repo deletion is the most surprising side effect. Gating
it on provenance is what makes it safe to offer at all: the toggle can only ever
delete a repo OAP itself provisioned.

**Independent Test**: For a factory-created project, delete with
`deleteRepo=true`; assert `DELETE /repos/:owner/:repo` was issued and the repo
is gone. For an imported project, delete with `deleteRepo=true`; assert the
request is refused (or the repo is left intact) and an audit row records the
refusal.

**Acceptance Scenarios**:

1. **Given** a project whose primary repo has recorded provenance
   `factory-created`, **When** `deleteProject` runs with `deleteRepo=true`,
   **Then** `deleteGithubRepo` is invoked best-effort for that repo, a 404 is
   treated as already-gone, and the outcome (deleted / already-gone / failed)
   is recorded in the `project.delete` audit metadata.
2. **Given** a project whose repo provenance is `imported` or `linked` (or an
   unrecorded / NULL origin, treated as `imported`), **When** `deleteProject`
   runs with `deleteRepo=true`, **Then** the repo is NOT deleted; the handler
   refuses the repo-delete leg with a clear cause and records the refusal, and
   the rest of the delete proceeds.
3. **Given** `deleteRepo=true` and a repo that GitHub returns 404 for (already
   deleted upstream), **When** the delete runs, **Then** the leg is a no-op
   success (idempotent), not a failure.

### User Story 3 - Tear down live deployments and (opt-in) the namespace (Priority: P1)

An operator deleting a project that has one or more live environments opts into
`destroyDeployments` to run `helm uninstall` for each, and optionally
`deleteNamespaces` to also delete the tenant namespace(s) for true
least-privilege cleanup (removing the self-provisioned RoleBinding and any
residue). `deleteNamespaces` requires `destroyDeployments` (you cannot delete a
namespace out from under a release you are leaving installed).

**Why this priority**: This closes the live-workload orphan. Uninstall alone
leaves an empty namespace + the spec-225 self-provisioned RoleBinding behind;
namespace deletion is the tail that makes teardown complete, at the cost of
irreversible PVC loss, hence its own toggle.

**Independent Test**: For a project with a live release in namespace `N`, delete
with `destroyDeployments=true`, `deleteNamespaces=false`; assert the release is
uninstalled and `N` still exists. Repeat with `deleteNamespaces=true`; assert
`N` is deleted (and its PVCs with it).

**Acceptance Scenarios**:

1. **Given** a project with live environments each carrying a recorded
   `k8sNamespace` and release id, **When** `deleteProject` runs with
   `destroyDeployments=true`, **Then** deployd teardown is invoked once per
   environment (best-effort, failures logged and recorded), each release is
   `helm uninstall`ed, and no namespace is deleted.
2. **Given** the same project, **When** the delete runs with
   `destroyDeployments=true` AND `deleteNamespaces=true`, **Then** once a
   namespace's releases are all uninstalled deployd deletes that tenant
   namespace, gated by `is_valid_tenant_namespace` (a reserved / platform
   namespace is never deleted) and best-effort (a failure is logged and
   recorded, the delete proceeds).
3. **Given** `deleteNamespaces=true` but `destroyDeployments=false`, **When**
   the delete request is validated, **Then** it is rejected as an invalid
   combination (namespace deletion requires deployment teardown) before any
   destructive action runs.
4. **Given** a namespace that is already gone at teardown time, **When**
   `deleteNamespaces=true`, **Then** the delete is a no-op success for that
   namespace (idempotent), not a failure, and the namespace is NOT recreated.

### Edge Cases

- **Partial failure after the DB commit.** The DB delete has already committed
  when the toggles run. If any toggle fails (GitHub unreachable, deployd
  unreachable, kube API error), the failure is logged and recorded in the
  audit metadata; the project delete still succeeds. Orphan-recovery tooling is
  the safety net (the existing admin purge-orphans path for storage; an
  operator re-runs the specific teardown for repo/deployment). A toggle failure
  must never resurrect the deleted project row.
- **deployd not configured (local dev).** `destroyPreviewDeployment` already
  short-circuits to a log line when deployd credentials are absent; the
  toggles inherit that: with no deployd configured, `destroyDeployments` /
  `deleteNamespaces` are recorded as skipped, not failed.
- **Reserved / platform namespace.** `deleteNamespaces` is gated by
  `is_valid_tenant_namespace` inside the deployd capability (the same
  defense-in-depth entry-point guard spec 225 FR-007 applies to the
  RoleBinding write), so a legacy `environments.k8sNamespace` resolving to
  `kube-system`, `rauthy-system`, `statecraft-system`, ... is never deleted
  regardless of the request.
- **Multiple environments.** A project may have several environments
  (development / preview / production) each with its own release and
  namespace. `destroyDeployments` iterates all of them; `deleteNamespaces`
  deletes each distinct tenant namespace once. A namespace shared by two
  environments (unusual) is deleted once and only after all its releases are
  uninstalled.
- **Concurrent PR-close cleanup.** The webhook preview-cleanup path may already
  be tearing a preview release down when a project delete lands. Both teardown
  calls are best-effort and idempotent (`helm uninstall` treats
  "release not found" as success; namespace delete treats "already gone" as
  success), and the ordering is safe by construction: deployd deletes the
  namespace only when no deployd-managed release remains in it (FR-007a), so two
  racing teardowns delete it exactly once, whichever finishes last, and never
  out from under a sibling still installed.
- **Repo provenance unrecorded on legacy rows.** `project_repos` predates the
  provenance column (FR-004), so existing rows have no origin. They are treated
  as `imported` (the conservative default): `deleteRepo` refuses them. An
  operator who knows a legacy repo was OAP-created can delete it out-of-band;
  the toggle will not guess.

## Requirements *(mandatory)*

### Functional Requirements: the delete contract

- **FR-001**: `deleteProject` MUST accept three opt-in boolean flags,
  `deleteRepo`, `destroyDeployments`, `deleteNamespaces`, each defaulting to
  **false**. With all three false the handler's observable behavior MUST be
  identical to today (DB + storage purge only). The flags ride the delete
  request; the transport (query params on the existing `DELETE
  /api/projects/:id`, or a dedicated `POST /api/projects/:id/teardown` with a
  JSON body) is an implementation choice, but the default-off, additive
  semantics are mandatory.
- **FR-002**: The three flags MUST be independent opt-ins surfaced to the user
  as three separate checkboxes (one per destroyed resource), NOT a single
  "delete everything" confirm. `deleteNamespaces` MUST require
  `destroyDeployments`; the request MUST be rejected as an invalid combination
  if `deleteNamespaces` is set without `destroyDeployments`.
- **FR-003**: Every toggle MUST run **after** the DB commit and be
  **best-effort**: a failure is logged and recorded in the teardown audit
  metadata (FR-009), and the project delete still succeeds. No toggle may be a
  blocking precondition of the delete, and no toggle failure may roll back the
  DB delete. This mirrors the existing post-commit storage sweep. Because the
  delete transaction CASCADEs the very rows the legs need (`project_repos`
  origin + repo full name; `environments.k8sNamespace` + the recorded deployd
  release id), the handler MUST **snapshot those teardown targets before
  opening the delete transaction** and drive the post-commit legs from that
  captured snapshot, exactly as the current handler collects knowledge /
  artifact storage keys before the transaction and sweeps them after commit.
  The snapshot is taken only when at least one toggle is set; a toggle-free
  delete skips the extra reads and behaves exactly as today.

### Functional Requirements: repo delete (toggle 1)

- **FR-004**: Repo deletion MUST be gated on recorded provenance that OAP
  created the repo. `project_repos` MUST gain an `origin` column
  (`factory-created` | `imported` | `linked`), set at creation
  (`createProjectWithRepo` / factory-create -> `factory-created`; import ->
  `imported`; add-repo link -> `linked`). Rows without a recorded origin
  (pre-migration) MUST be treated as `imported`. The `origin` value MUST be set
  exactly once at row creation and treated as **immutable** thereafter: no code
  path may relabel a repo's origin (e.g. flip an `imported` row to
  `factory-created`), because a mutable origin would silently bypass the
  provenance gate that makes `deleteRepo` safe to offer. Immutability MUST be
  enforced at the **database layer** (a trigger or equivalent write-once guard
  that rejects any UPDATE to `origin`), not application code alone, so an ad-hoc
  migration, a future handler, or a time-pressure hotfix cannot relabel a row.
- **FR-005**: When `deleteRepo=true`, the handler MUST delete **only** the
  project's linked repos whose recorded origin is `factory-created` (there may
  be more than one), via the existing best-effort `deleteGithubRepo` (404
  treated as already-gone). A repo whose origin is not `factory-created` MUST be
  refused (not deleted) with the refusal recorded. The audit metadata MUST
  record, per repo, the outcome (deleted / already-gone / refused-not-oap-created
  / failed).

### Functional Requirements: deployment teardown (toggle 2)

- **FR-006**: When `destroyDeployments=true`, the handler MUST, for each of the
  project's environments that has a recorded live release, invoke deployd
  teardown (the `destroyPreviewDeployment` -> deployd `delete_deployment`
  wire, `helm uninstall` via `uninstall_with_gate`), best-effort per
  environment. The per-environment release id captured in the FR-003 snapshot is
  the `:id` for the `DELETE /v1/deployments/:id` call. The teardowns run
  **synchronously after the DB commit with bounded concurrency** (mirroring the
  existing storage-sweep loop), and the delete returns once they settle; a
  project has few environments (typically 1-3), so a bounded synchronous fan-out
  is preferred over an async `202` + status-tracking surface. Moving to an async
  completion is a compatible future change if per-project environment counts
  grow. Each deployd call MUST carry a per-call timeout (recommended <= 30s per
  environment) and the leg a total wall-clock ceiling (recommended <= 120s), so
  "best-effort" means "attempted for at most T", never "blocked indefinitely on
  a hung or partitioned deployd". When deployd is not configured (local dev),
  the leg is recorded as skipped, not failed.

### Functional Requirements: namespace deletion (toggle 3, promotes spec 225 deferred item)

- **FR-007**: deployd MUST gain a namespace-delete capability that
  `delete_deployment` invokes **only when the caller requests it** (a new
  request flag on `DELETE /v1/deployments/:id`, off by default so preview
  cleanup and every existing caller keep uninstall-only semantics). The
  capability MUST: (a) delete the tenant namespace **only after** the release's
  `helm uninstall`, **and only when no other deployd-managed release remains in
  that namespace**: deployd, not the caller, owns the safe-to-delete
  determination: it lists the releases it manages in the namespace and deletes
  the namespace only when that set is empty. This makes the delete robust to a
  concurrent teardown (two callers racing) and to a failed sibling teardown
  (its release remains, so the namespace is non-empty and is not deleted). The
  check-then-delete need NOT be atomic (no distributed lock is required):
  because namespace DELETE is idempotent (FR-007c), two callers that both
  observe an empty namespace and both issue the delete is benign, one deletes
  and the other sees "already gone" as success. deployd MUST rely on this
  idempotency for the delete-once guarantee rather than a lock;
  (b) be gated by `is_valid_tenant_namespace` inside the capability itself
  (defense-in-depth, refusing reserved / malformed namespaces regardless of
  caller, matching spec 225 FR-007); (c) treat an already-absent namespace as
  success and never recreate it; and (d) be best-effort (a failure is logged and
  recorded, the teardown proceeds).
- **FR-008**: When `deleteNamespaces=true`, statecraft MUST set the FR-007 flag
  on **every** deployd teardown call it issues for the project; it MUST NOT try
  to compute which release is "last". deployd's empty-namespace check (FR-007a)
  is the single arbiter: whichever teardown leaves the namespace with no
  remaining deployd-managed releases performs the delete, idempotently (FR-007a:
  a racing double-delete is benign, so no cross-caller coordination is needed).
  This is why the ordering is correct under concurrent teardowns (a project
  delete racing a PR-close webhook) and under partial failure: if one
  environment's teardown fails or is skipped (FR-006), its release remains, the
  namespace is non-empty, and deployd declines to delete it. A namespace is
  deleted only when all its deployd-managed releases are gone, which subsumes
  "MUST NOT delete a namespace whose deployment teardown was skipped or
  refused".

### Functional Requirements: auditability

- **FR-009**: The audit trail MUST record which toggles were requested and the
  per-resource outcome of each (repos: deleted / already-gone / refused /
  failed; deployments: uninstalled / skipped / failed; namespaces: deleted /
  already-gone / skipped / refused / failed), so the destructive scope of a
  delete is reconstructable from the audit trail alone. Because these outcomes
  occur **after** the delete transaction has committed (FR-003), they MUST be
  recorded post-commit: a companion `project.teardown` audit event (or an
  update to the `project.delete` row's metadata) written once the legs finish,
  NOT the in-transaction `project.delete` row, which is committed before any leg
  runs. To fully close the crash window, the handler MUST record the
  **requested** toggles as intent **in the same transaction as the delete**
  (e.g. on the existing in-transaction `project.delete` audit row, which commits
  atomically with the delete), then record each per-resource outcome as its leg
  settles post-commit. A crash after the commit thus still leaves an atomic
  record of what was requested; only the best-effort outcomes may be lost, and
  those are recoverable by re-running the specific teardown.

### Functional Requirements: authorization

- **FR-010**: Setting any destructive toggle MUST require the same authority the
  base delete already enforces: `deleteProject` gates on `project:delete`, which
  is an admin/owner org permission, so an unauthenticated or non-admin caller
  cannot reach the handler and therefore cannot set a toggle. Because
  `project:delete` is already the top org tier, this spec does NOT invent a
  separate permission; the extra protection for the irreversible external
  actions (repo deletion, namespace deletion) is the per-action opt-in checkbox
  (FR-002) plus the typed confirmation (FR-011), not a new role. A request that
  sets a toggle without `project:delete` MUST be rejected before any destructive
  action. The org-membership scope that already bounds `deleteProject` (the
  handler loads the project by `(id, orgId = auth.orgId)`) applies to all three
  toggle legs: a `factory-created` repo under another org's GitHub installation,
  or a namespace in another org's environment, MUST NOT be acted on even if the
  caller holds `project:delete` in their own org. `project:delete` MUST be
  evaluated org-scoped, never as a global "admin somewhere" check.
- **FR-011**: Because namespace deletion is permanent data loss (PVCs, an
  in-namespace database), enabling `deleteNamespaces` MUST require a typed
  confirmation (the project slug) at the API boundary, not only in the UI: the
  handler MUST reject a `deleteNamespaces=true` request that does not carry the
  matching confirmation token. This is the CONST-001 destructive-operation
  posture made normative (promoted from the SHOULD in the confirmation
  contract). The exact token ergonomics are an implementation detail; that the
  server enforces it is not. The comparison MUST be exact, case-sensitive string
  equality against the project slug (never a substring or case-insensitive
  match).

## Key Entities

- **`deleteRepo` / `destroyDeployments` / `deleteNamespaces`**: the three
  opt-in, default-false request flags; the three user-facing checkboxes.
- **`project_repos.origin`**: the new provenance column (`factory-created` |
  `imported` | `linked`) that gates `deleteRepo`.
- **deployd namespace-delete request flag**: the new off-by-default flag on
  `DELETE /v1/deployments/:id` that makes `delete_deployment` delete the tenant
  namespace after uninstall (FR-007). Preview cleanup and legacy callers never
  set it.
- **`is_valid_tenant_namespace`** (`deployd-api-rs/src/rbac.rs`): the
  reserved/malformed-namespace guard reused as the namespace-delete safety
  gate.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A project delete with no toggles leaves the repo, the helm
  release, and the namespace intact and purges only DB + storage (identical to
  today). A regression test asserts the byte-for-byte default.
- **SC-002**: A factory-created project deleted with `deleteRepo=true` has its
  GitHub repo gone; an imported project deleted with `deleteRepo=true` keeps
  its repo, with the refusal recorded in the audit row.
- **SC-003**: A project deleted with `destroyDeployments=true` has each live
  release uninstalled; adding `deleteNamespaces=true` additionally deletes each
  tenant namespace; a reserved namespace is never deleted.
- **SC-004**: `deleteNamespaces` without `destroyDeployments` is rejected
  before any destructive action.
- **SC-005**: Every destructive leg is best-effort: injecting a GitHub /
  deployd / kube failure still returns a successful project delete with the
  failure recorded in the audit metadata; the project row is gone.
- **SC-006**: The coupling gate and spec-lint are green with spec 226 claiming
  the featuregraph golden node in this design PR, and (in the follow-on
  implementation PRs) the referenced code paths once promoted to authoritative
  relationships.
- **SC-007**: A request that sets any destructive toggle without `project:delete`
  is rejected before any destructive action runs (FR-010).
- **SC-008**: A `deleteNamespaces=true` request missing the typed confirmation
  token is rejected at the API boundary (FR-011) and no namespace is deleted.
- **SC-009**: A namespace with a still-installed sibling release (a failed or
  concurrent teardown) is NOT deleted; once every deployd-managed release in it
  is gone it is deleted exactly once, even under two racing teardowns
  (FR-007a / FR-008).

## Confirmation and irreversibility contract

Because the three toggles are irreversible at escalating blast radius, the UI
and API MUST make the destructive scope explicit and per-action:

1. **Three checkboxes, not one.** The delete dialog renders one checkbox per
   toggle, each labeled with what it destroys and that it cannot be undone.
   None is pre-checked.
2. **`deleteRepo` visibility follows provenance.** The repo checkbox is offered
   (enabled) when the project has at least one `factory-created` linked repo,
   and enabling it deletes **every** `factory-created` linked repo (FR-005,
   per-repo outcome recorded); a project whose only repos are `imported` /
   `linked` shows the checkbox disabled with the reason, so the operator learns
   why OAP will not delete their repo.
3. **`deleteNamespaces` depends on `destroyDeployments`.** The namespace
   checkbox is disabled until deployment teardown is checked; its label calls
   out permanent PVC / in-namespace-database loss.
4. **Typed confirmation for namespace deletion.** Because namespace deletion is
   permanent data loss, enabling `deleteNamespaces` **MUST** require a typed
   confirmation (e.g. the project slug), enforced at the API boundary per FR-011
   (not UI-only), consistent with CONST-001's destructive-operation posture. The
   exact confirmation ergonomics are an implementation detail; the requirement
   is that namespace deletion is not a single-click action and cannot be
   triggered by an API caller that bypasses the UI.

## Implementation staging

This spec is the **design home**; it lands design-only. The implementation is
naturally two independent PRs, each promoting the relevant `references:` paths
to authoritative relationships so the coupling gate is satisfied one subsystem
at a time:

- **PR A (statecraft)**: the three request flags on `deleteProject`, the
  pre-transaction snapshot of teardown targets (FR-003), the
  `project_repos.origin` migration + provenance wiring, the `deleteRepo` and
  `destroyDeployments` legs (reusing `deleteGithubRepo` and
  `destroyPreviewDeployment`), the post-commit teardown audit (FR-009), and the
  delete-dialog checkboxes. It also wires `deleteNamespaces` through to the
  deployd teardown call, guarded behind a **runtime capability probe** of deployd
  (a version / feature check on the deployd API): an older deployd that does not
  understand the FR-007 flag makes the checkbox unavailable rather than silently
  no-op, so correctness does not depend on deploy ordering. PR B ships FR-007;
  until a deployd carrying it is live, the probe keeps `deleteNamespaces` off.
  The probe result MAY be cached (short TTL, invalidated on a deployd version
  change) to avoid a round-trip on every delete. Promotes `projects.ts` /
  `cloneHelpers.ts` / `deploydClient.ts` / `schema.ts` to `extends`/`refines` of
  spec 226.
- **PR B (deployd)**: the namespace-delete capability and its off-by-default
  request flag on `delete_deployment` (FR-007). Promotes `routes.rs` / `rbac.rs`
  to `extends`/`refines` of spec 226. This is the delivery of spec 225's
  deferred "Namespace deletion on teardown" item; spec 225 remains its
  original design home and this spec is where the item is scheduled and gated.

Splitting delivery this way keeps each PR reviewable and lets toggle (2) ship
usefully even before toggle (3) lands (uninstall-without-namespace-delete is a
complete, safe teardown on its own).

## Review follow-ups (AI review of #515)

The automated review of the spec's landing PR (#515) raised design points on a
design-only spec. All are resolved here (this follow-up amends 226 in place),
mirroring how spec 225 recorded its own review follow-ups. Dispositions:

**Resolved by tightening the contract:**

- **Provenance immutability.** `project_repos.origin` is now MUST-immutable
  (FR-004): no path may relabel a repo, so the gate cannot be bypassed.
- **Typed confirmation elevated SHOULD -> MUST** and moved to the API boundary
  (FR-011 + confirmation contract item 4): namespace deletion cannot be
  triggered by a caller that bypasses the UI.
- **Authorization stated explicitly** (FR-010): destructive toggles inherit the
  base `project:delete` admin/owner gate; no new permission tier is invented
  because `project:delete` is already the top org tier.
- **Audit crash-window closed** (FR-009): requested toggles are recorded as
  intent at commit; per-resource outcomes are appended as legs settle, so a
  crash after commit still leaves an auditable record.
- **Conditional snapshot** (FR-003): the pre-transaction snapshot runs only when
  at least one toggle is set, so a toggle-free delete pays nothing.
- **Spec 137 added to `depends_on`**: it co-authors `uninstall_with_gate`, which
  FR-006 routes through; the implementation PR promoting `routes.rs` needs the
  edge.

**Resolved by architectural decision (delegated on this PR):**

- **Namespace-delete ordering owner -> deployd-side empty-namespace check**
  (FR-007a / FR-008). deployd, not statecraft, decides a namespace is safe to
  delete (no remaining deployd-managed release in it). This dissolves the
  "who is last?" race the review flagged and makes partial failure correct: a
  failed or concurrent sibling teardown leaves the namespace non-empty, so it is
  not deleted. statecraft just sets the flag on every teardown; deployd deletes
  it idempotently (a racing double-delete is benign).
- **Teardown execution shape -> synchronous, bounded-concurrent** (FR-006). A
  project has few environments, so a bounded synchronous fan-out (matching the
  existing storage-sweep loop) is preferred over an async `202` + status
  surface; async is a compatible future change if counts grow.
- **PR-ordering enforcement -> runtime capability probe** (Implementation
  staging). PR A gates `deleteNamespaces` behind a deployd capability probe
  rather than relying on deploy ordering, so an older deployd disables the
  checkbox instead of silently no-opping.

**Acknowledged, no change:** the review's Spec Compliance section (code_aliases
consistent, `implementation: pending` correct, derived shards present with
`ownership: true` only on the featuregraph golden) confirmed the staging intent
is correctly encoded.

## Review follow-ups (AI review of #516)

The AI review of the follow-up PR (#516) raised a second, more marginal round on
the same design-only spec. Resolved in place:

- **Crash window fully closed** (FR-009): intent is written **in the same
  transaction** as the delete (not merely "immediately after"), so a crash
  cannot lose the record of what was requested.
- **Delete-once is idempotency, not atomicity** (FR-007a / FR-008): the
  empty-namespace check need not be atomic; namespace DELETE is idempotent, so a
  racing double-delete is benign. The spec no longer over-claims "exactly once"
  or implies a distributed lock.
- **Org-scope reaffirmed against IDOR** (FR-010): the existing
  `(id, orgId = auth.orgId)` scope bounds all three toggle legs; `project:delete`
  is evaluated org-scoped, never as a global "admin somewhere" check.
- **Immutability enforced at the DB layer** (FR-004): a write-once trigger, not
  application code alone, so an ad-hoc migration cannot relabel `origin`.
- **Exact token match** (FR-011): the typed confirmation MUST be exact,
  case-sensitive string equality against the project slug.
- **Timeout ceiling on the synchronous fan-out** (FR-006): per-call (<= 30s) and
  total (<= 120s) bounds so best-effort cannot block indefinitely; the
  capability probe result MAY be cached.

**Acknowledged, no change:** the review confirmed derived-artifact consistency
(frontmatter, both shards, and the featuregraph golden all gain the `137` edge
together) and noted the permanent `Review follow-ups` section is a style choice;
it is retained deliberately, matching spec 225, and spec-lint accepts it.
