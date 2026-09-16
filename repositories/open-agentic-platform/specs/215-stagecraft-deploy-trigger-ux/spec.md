---
id: "215-statecraft-deploy-trigger-ux"
title: "Statecraft Deploy Trigger UX (Preview in Deployd / View Deployd)"
feature_branch: "feat/215-statecraft-deploy-trigger-ux"
status: approved
implementation: complete  # All five FRs landed in one PR: deployd client consolidation + environment_deployments record module + M2M proxy guard (215b); authenticated trigger + latest endpoints with lazy reconciliation (215c); webhook preview-destroy fix keyed to the stored release id (215d); success-page row + env deployment UI + web client (215e). Locally verified: statecraft tsc clean (api/), pure deploy vitest (34) green, deployments.test.ts registered in the spec-211 encore lane. DEFERRED (deploy-time / live-cluster, not resolvable in-repo): SC-001/SC-002/SC-004 need a live cluster + a built image (helm rollout, preview destroy, endpoint URLs); the automated factory terminal deploy stage remains the spec 112 §11 deferral.
kind: platform
domain: platform
created: "2026-06-12"
authors: ["open-agentic-platform"]
language: en
summary: >
  Give the project-created page its deployment row: "Preview in Deployd"
  dispatches the scaffolded commit to the auto-provisioned development
  environment, and "View Deployd" lands on an environment page that shows
  real deployment state and the live URL. Underneath the buttons: a
  createDeployment client path, a statecraft-side record of every dispatch
  (fixing the preview-destroy release-id bug, where the webhook deletes a
  release id it never stored), authorization on the deploy proxy (today
  auth: false), and one consolidated deployd client replacing the two
  parallel M2M implementations. This is the manual precursor of the
  factory pipeline's automated terminal deploy stage, which remains the
  deferral recorded in spec 112 §11.
code_aliases: ["STATECRAFT_DEPLOY_TRIGGER_UX"]
depends_on:
  - "213-tenant-repo-image-build"
  - "214-tenant-app-chart-supersession"
  - "112-factory-project-lifecycle"
  - "137-tenant-environment-access-gates"
establishes:
  # FR-003 record module + its migration (49), and the FR-002/FR-008 endpoint
  # test. The owning edges land with the implementation PR per the draft's
  # planned-establishes note (spec 200 precedent).
  - unit: { kind: file, path: platform/services/statecraft/api/deploy/deployments.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/deploy/deployments.test.ts }
extends:
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.projects.new.tsx }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/projects-api.server.ts }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
  - spec: "137-tenant-environment-access-gates"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.deploys.$envId.tsx }
  - spec: "137-tenant-environment-access-gates"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.deploys.tsx }
  # Post-merge fix: register the env-detail route so FR-004 (deployment card)
  # and FR-006 (trigger), plus spec 137's access-gate UI, are reachable. The
  # detail file existed since 137 but was never wired into the route table, so
  # /deploys/:envId 404'd. Extends the app route table established by spec 087.
  - spec: "087-unified-workspace-architecture"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes.ts }
  # Same precedent as specs 202, 196, 194, 193, 187, 183: a new spec adds a
  # row to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  - aspect: "preview-release-id-tracking"
    unit: { kind: file, path: platform/services/statecraft/api/github/webhook.ts }
  - aspect: "deploy-trigger-authorization"
    unit: { kind: file, path: platform/services/statecraft/api/deploy/deploy.ts }
  - aspect: "deployd-client-consolidation"
    unit: { kind: file, path: platform/services/statecraft/api/deploy/deploydClient.ts }
  - aspect: "deployd-client-consolidation"
    unit: { kind: file, path: platform/services/statecraft/api/deploy/oidcM2m.ts }
  # AC: deployments.test.ts joins the spec 211 encore-test lane (the
  # vite.config.ts exclude list IS the lane assignment).
  - aspect: "encore-test-lane-assignment"
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
references:
  - role: deferral-source
    unit: { kind: file, path: specs/112-factory-project-lifecycle/spec.md }
  - role: ux-precedent
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId._index.tsx }
  - role: deploy-promotion-vision
    unit: { kind: file, path: specs/087-unified-workspace-architecture/spec.md }
---

# Feature Specification: Statecraft Deploy Trigger UX

**Feature Branch**: `215-statecraft-deploy-trigger-ux`
**Created**: 2026-06-12
**Status**: Draft (third of the three deploy-path specs; consumes 213
tenant-repo-image-build and 214 tenant-app-chart-supersession)
**Input**: The project-created success page renders three rows (GitHub
repo, Clone URL, Open in OPC with the "Launch Factory Cockpit" deep
link); the requested fourth row is the deployment path: "Preview in
Deployd" / "View Deployd". Spec 087 Phase 3 lists a deploy status and
promotion UI with no implementing spec; spec 112 §11 defers the automated
deploy stage; this spec implements the manual, human-triggered slice.

## Purpose

With specs 213 (an image exists and is resolvable) and 214 (a chart
exists and the dispatch contract carries config, pull secret, namespace,
and a derived hostname), the remaining work is plumbing and truth-keeping
in statecraft: a button that dispatches, a page that shows what happened,
a record of what was dispatched (today statecraft fires preview deploys
and forgets them, then tries to destroy a release id it invented rather
than stored), and an answer to "who is allowed to press this".

## Code reality (2026-06-12 survey)

- `CreateSuccess` (`app.projects.new.tsx:699-755`) renders the three
  rows; the action payload already returns `projectId`,
  `devEnvironmentId`, and the scaffold commit SHA, so the new row needs
  no creation-flow changes.
- `projects-api.server.ts` has `listEnvironments`/`createEnvironment` but
  no deployment functions.
- The env detail page (`app.project.$projectId.deploys.$envId.tsx`, spec
  137) shows namespace, kind, and the access-gate toggle; no deployment
  status, no URL.
- `deploy.ts:194` exposes the dispatch proxy with `auth: false`; the only
  guard is deployd-api's own M2M scope check downstream.
- `webhook.ts:172` destroys `preview-{projectId}-pr-{n}`, but deployd-api
  release ids are `rel_<uuid>` returned at create and never persisted by
  statecraft; the DELETE 404s silently and preview releases leak.
- `deploy.ts` and `deploydClient.ts` duplicate M2M secret resolution and
  token caching (`oidcM2m.ts` is shared but wired twice).
- deployd-api endpoints: status and logs exist
  (`GET /v1/deployments/{id}/status`, `/logs`); `endpoints` (the live
  URLs) are returned at create and stored in deployd's own DB.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One click from created to running (Priority: P1)

Right after creating a project, the operator clicks "Preview in Deployd"
on the success page. Statecraft resolves the artifact for the scaffolded
commit, dispatches to the development environment, and replaces the
button with live status; when the rollout lands, the row shows the
endpoint URL.

**Why this priority**: this is the requested UX and the integral test of
the whole 213/214/215 chain.

**Independent Test**: create a project, wait for the build, click the
button; within the helm timeout the row shows ROLLED_OUT plus a clickable
URL that serves the app.

**Acceptance Scenarios**:

1. **Given** a created project whose `oap-build` run has not finished,
   **When** the success page renders, **Then** the button is disabled
   with "image not built yet" (artifact existence check from spec 213),
   and enables on refresh once the image exists.
2. **Given** the image exists, **When** the operator clicks Preview in
   Deployd, **Then** a deployment record is created, the dispatch carries
   `release_sha = scaffold commit`, the derived hostname, and the
   environment's namespace, and the UI reflects PENDING through
   ROLLED_OUT or FAILED states from the record.
3. **Given** a second click after success, **Then** the idempotent replay
   is surfaced as "already deployed at this commit" with the existing
   URL, not as a new rollout.

### User Story 2 - View Deployd shows the truth (Priority: P1)

"View Deployd" (success page and project dashboard) lands on
`/app/project/:projectId/deploys/:envId`, which now shows: latest
deployment (sha, artifact ref, status, requested-by, timestamp), live
endpoint links, the event trail proxied from deployd-api, and the
existing access-gate controls.

**Independent Test**: after any dispatch, the env page renders the
deployment row and the deployd event list without browser access to
deployd-api (all server-side proxied).

**Acceptance Scenarios**:

1. **Given** an environment with no deployments, **Then** the page shows
   an explicit empty state ("never deployed") rather than gate config
   alone.
2. **Given** a FAILED deployment, **Then** the helm diagnostic from the
   dispatch response is visible verbatim on the page.

### User Story 3 - Preview environments stop leaking (Priority: P2)

PR preview deploys are recorded like any other dispatch; on PR close, the
destroy uses the recorded `rel_<uuid>`, and the environment row reflects
DESTROYED.

**Independent Test**: open and close a PR on a seeded repo; deployd-api's
DELETE returns success (not 404) and no orphaned helm release remains in
the preview namespace.

**Acceptance Scenarios**:

1. **Given** a preview deployment created by the webhook, **Then** an
   `environment_deployments` row exists with the returned release id.
2. **Given** PR close, **Then** destroy targets that stored id and the
   row transitions to DESTROYED.

### User Story 4 - Pressing the button requires permission (Priority: P2)

Only authenticated members of the project's org can trigger or destroy
deployments through statecraft; environments with `requiresApproval` set
refuse direct dispatch.

**Independent Test**: an unauthenticated request and a cross-org request
to the trigger endpoint both fail with 401/403; a `requiresApproval`
environment returns a specific "approval required" error.

**Acceptance Scenarios**:

1. **Given** the legacy raw proxy contract (`auth: false`), **When** this
   spec lands, **Then** UI-originated dispatches flow through an
   authenticated endpoint and the raw proxy either gains the same guard
   or is restricted to M2M callers only (decision recorded in FR-006).

### Edge Cases

- Artifact existence is indeterminate (registry rate limit): the button
  renders enabled with a warning, and dispatch failure surfaces the pull
  error; never a silent retry loop.
- The dispatch HTTP call times out while helm is still running: the
  record stays PENDING and the page's refresh path reconciles from
  deployd-api status on next load (the dispatch is idempotent on replay).
- deployd-api unreachable: the record is created in REQUEST_FAILED state
  with the connection diagnostic; no phantom PENDING rows.

  *Amendment (deploy timeout race + diagnostic, 2026-06-30).* deployd's
  `create_deployment` is synchronous (it holds the HTTP connection during
  `helm upgrade --install --wait`), and statecraft's `fetch` inherits
  undici's 300s headers timeout. With deployd's old 5m `--wait` default
  those two 300s windows raced: when undici lost, a deploy that helm would
  have reported as FAILED (e.g. a tenant image stuck in ImagePullBackOff
  that never becomes Ready) instead surfaced as an opaque REQUEST_FAILED
  whose diagnostic was the bare Node string `fetch failed`. Two corrections:
  (1) deployd's default `helm --wait` timeout drops below 300s (spec 136
  helm runner) so deployd reliably wins the race and its FAILED + helm
  stderr reaches the UI; (2) statecraft's REQUEST_FAILED diagnostic now
  unwraps `err.cause` (`describeTransportError` in `deploydClient.ts`), so a
  genuine transport failure reads e.g. `fetch failed (ECONNREFUSED: ...)`
  or `fetch failed (UND_ERR_HEADERS_TIMEOUT: ...)` instead of `fetch
  failed`. The reconcile-on-refresh path above is unchanged.

  *Amendment (build-body precondition surfacing, 2026-07-01).* A companion
  to the above. When `triggerDeployment` cannot assemble the dispatch body
  (`buildTriggerDeploydBody` returns `{ ok: false }`, e.g. a gate-enabled
  environment with `RAUTHY_ISSUER_URL` unset), it recorded the real reason on
  the deployment record's `diagnostic` (so the card showed it) but threw
  `APIError.internal(message)`. Encore sanitizes `internal` errors to "an
  internal error occurred" before they reach the client, so the redeploy
  **toast** showed that opaque string while the card showed the truth. This
  is an unmet deploy precondition, not an internal fault, so the throw is now
  `APIError.failedPrecondition(message)` (message forwarded to the client),
  matching the FR-001 `image not built yet` precondition throw. The record's
  `diagnostic` is unchanged.
- Dual-profile projects: the success-page button deploys the default
  `public` variant (spec 214 FR-009); the env page offers the internal
  variant as a separate action.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `CreateSuccess` gains a fourth row, "Preview in Deployd":
  a trigger button (disabled-with-reason until the artifact exists) and a
  "View Deployd" link to `/app/project/:projectId/deploys/:devEnvId`.
  The project dashboard's deploys nav remains the steady-state entry
  point; the success-page row is the post-create accelerator.
- **FR-002**: New server-side client functions in
  `projects-api.server.ts`: `createDeployment`, `getLatestDeployment`,
  `getDeploymentStatus`; all call statecraft API endpoints (never
  deployd-api directly from the web tier), which in turn use the
  consolidated client (FR-007) with M2M credentials.
- **FR-003**: New table `environment_deployments` (`schema.ts` +
  migration): `id`, `environmentId`, `projectId`, `releaseId` (deployd's
  `rel_<uuid>`, nullable until the response arrives), `releaseSha`,
  `artifactRef`, `variant`, `status` (REQUESTED | PENDING | ROLLED_OUT |
  FAILED | REQUEST_FAILED | DESTROYED), `endpoints` (JSON), `dispatchedBy`
  (user id or `webhook`), `diagnostic`, timestamps. Every dispatch path
  (UI trigger, PR webhook) MUST write through this table; module
  `platform/services/statecraft/api/deploy/deployments.ts` owns it.
- **FR-004**: The env detail page renders deployment state from
  `environment_deployments` plus a server-proxied deployd-api status/event
  read; the deploys list page shows per-environment latest status badges.
- **FR-005**: Preview destroy fix: `webhook.ts` PR-close resolves the
  stored `releaseId` from `environment_deployments` and destroys that;
  the constructed-string destroy is deleted. A missing record falls back
  to a logged no-op (never a fabricated id).
- **FR-006**: Authorization: the UI trigger endpoint requires an
  authenticated org member of the owning org (statecraft session auth);
  `requiresApproval` environments reject direct dispatch with a specific
  error (the approval flow itself is out of scope and stays with the
  spec 087 promotion vision). The raw `POST /v1/deployments` proxy stops
  being anonymous: it MUST validate a Rauthy M2M token (the existing
  `validateM2mRequest` pattern) so machine callers keep working while
  browser-reachable anonymity ends.
- **FR-007**: Client consolidation: one deployd client module supersedes
  the parallel `deploy.ts`-internal and `deploydClient.ts` implementations
  (single M2M secret resolution + token cache via `oidcM2m.ts`); the
  webhook path and the new trigger path share it. `deploydClient.ts` is
  reduced to that module or deleted in its favor.
- **FR-008**: Status reconciliation: a `getLatestDeployment` read that
  finds a PENDING record older than the helm timeout MUST reconcile
  against deployd-api status before answering (lazy reconciliation; no
  background poller in this spec).

### Key Entities

- **environment_deployments**: statecraft's durable record of every
  dispatch, keyed to deployd-api's release id; the page's source of truth
  and the destroy path's lookup.
- **Deploy trigger action**: the authenticated path from button to
  dispatch, binding artifact resolution (213), contract assembly (214),
  and the record (FR-003).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From project creation to a clickable running-app URL using
  only statecraft UI actions: under 20 minutes including the build, with
  zero terminal commands.
- **SC-002**: PR open/close on a seeded repo creates and then destroys
  its preview release with zero orphaned helm releases (the 404-destroy
  class is eliminated; measured by `helm list` delta in the preview
  namespace).
- **SC-003**: No anonymous browser-reachable path can trigger a
  deployment (verified by an unauthenticated request test in CI).
- **SC-004**: The env detail page answers "what is running here, since
  when, at what URL" for 100% of dispatches made after this spec lands.

## Out of scope

- The automated factory terminal deploy stage (deploy as an ACP pipeline
  stage with promotion gates): remains the spec 112 §11 deferral; this
  spec's trigger is its manual precursor and its record schema is
  designed to be the stage's write target later.
- Approval workflows for `requiresApproval` environments (spec 087
  promotion vision; this spec only refuses).
- Rollbacks, deploy history beyond latest-per-environment rendering
  (records are kept; richer history UI is future work).
- OPC desktop surfacing of deployments (duplex/SSE wiring; spec 087
  FR-SYNC items remain open).

## Dependencies and sequencing

Lands after specs 213 and 214 (artifact resolution and dispatch contract
are consumed, not redefined here). The three-spec chain replaces the
unowned deferrals recorded in spec 112 §11 (partially: manual slice),
spec 137 line 363 (via 213), and spec 087 Phase 3 (the status slice of
the promotion UI).
