---
id: "224-self-hosted-sweeper-cron-revival"
title: "Self-Hosted Sweeper Cron Revival (K8s CronJobs for Encore no-op sweepers)"
feature_branch: "224-self-hosted-sweeper-cron-revival"
status: approved
implementation: in-progress  # FR-001..FR-005 (factory-runs sweeper leg) delivered this PR: expose:true M2M endpoint + K8s CronJob + external-secret + setup.sh client wiring, scope platform:factory:sweep. FR-006 (systemic rule) codified. FR-007/FR-008 (spec 115 extraction + spec 087 connector-sync legs) STAGED, not delivered; tracked here so spec 143 §12 FU-003's "single sibling spec, keep the finding visible" intent holds without ballooning this PR. Operational rollout (create statecraft-factory-sweeper-m2m-app Rauthy client with Default Scope platform:factory:sweep, fill STATECRAFT_FACTORY_SWEEPER_CLIENT_ID/_SECRET, run setup.sh) is the documented deploy-time prerequisite, gated on the #480 M2M-auth-handler fix having reached the cluster.
kind: platform
domain: platform
created: "2026-07-01"
authors: ["open-agentic-platform"]
language: en
summary: >
  Resolve spec 143 §12 FU-003: the systemic finding that Encore's `CronJob`
  primitive is a silent no-op on self-hosted deployments (no Encore Cloud
  scheduler), so every staleness sweeper declared only as an Encore CronJob
  has never fired in production. Spec 143 FR-010 fixed this for its own
  orphan-imported sweeper by adding an `expose:true` M2M-gated endpoint plus
  a sibling K8s CronJob that curls it on cadence; this spec lands the same
  revival for the spec 124 factory-runs staleness sweeper (the leg unblocked
  by the #480 gateway M2M-auth fix, spec 143 §step-7 empirical correction),
  under a new per-purpose Rauthy client and the `platform:factory:sweep`
  scope. It also codifies the general rule (any FR that relies on Encore's
  `CronJob` on a self-hosted target MUST provision a sibling K8s CronJob) and
  stages the remaining affected sweepers (spec 115 extraction-staleness, spec
  087 connector-sync) as follow-on FRs so the systemic finding stays visible
  in one spec rather than fragmenting across three amendments.
code_aliases: ["SELF_HOSTED_SWEEPER_CRON_REVIVAL"]
depends_on:
  - "124-opc-factory-run-platform-integration"  # owns the factory-runs sweeper (runsScheduler.ts)
  - "143-presigned-upload-public-endpoint"  # FR-010 established the expose:true + K8s CronJob pattern; §12 FU-003 mandated this sibling spec
  - "087-unified-workspace-architecture"  # connector-sync sweeper (staged FR-008)
  - "115-knowledge-extraction-pipeline"  # extraction-staleness sweeper (staged FR-007)
  - "106-rauthy-native-oidc-and-membership"  # M2M client_credentials substrate
amends: ["124-opc-factory-run-platform-integration"]
establishes:
  - unit: { kind: file, path: platform/charts/statecraft/templates/cronjob-factory-runs-sweeper.yaml }
  - unit: { kind: file, path: platform/charts/statecraft/templates/external-secret-factory-sweeper.yaml }
extends:
  # The factory-runs staleness sweeper file. Spec 124 §6 established it in
  # prose ("The sweeper lives in api/factory/runsScheduler.ts") but never
  # claimed it in a relationship block. This spec additively extends it with
  # the expose:true M2M endpoint (the K8s CronJob target) and splits the
  # existing expose:false handler into the parameterless Encore-cron endpoint.
  - spec: "124-opc-factory-run-platform-integration"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/runsScheduler.ts }
  # A new spec adds a node to the featuregraph golden (same precedent as
  # specs 214, 222, 223); claimed additively against spec 034 so the golden
  # diff carries a 224 authority.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  # Hetzner bootstrap gains the per-purpose factory-sweeper Secret plus the
  # Rauthy-client provisioning instructions, mirroring spec 143 FR-010's
  # knowledge-sweeper wiring. No cross-purpose mount: separate Secret.
  - aspect: "self-hosted-sweeper-cron-revival"
    unit: { kind: file, path: platform/infra/hetzner/setup.sh }
references:
  - role: pattern-source
    unit: { kind: file, path: platform/charts/statecraft/templates/cronjob-orphan-sweeper.yaml }
  - role: pattern-source
    unit: { kind: file, path: platform/charts/statecraft/templates/external-secret-knowledge-sweeper.yaml }
  - role: m2m-auth-precedent
    unit: { kind: file, path: platform/services/statecraft/api/auth/m2mAuth.ts }
  - role: credential-plumbing
    unit: { kind: file, path: platform/infra/terraform/envs/dev/core/variables.tf }
  - role: systemic-finding-authority
    unit: { kind: file, path: specs/143-presigned-upload-public-endpoint/spec.md }
---

# Feature Specification: Self-Hosted Sweeper Cron Revival

**Feature Branch**: `224-self-hosted-sweeper-cron-revival`
**Created**: 2026-07-01
**Status**: Approved
**Input**: Resolve spec 143 §12 FU-003 for the spec 124 factory-runs sweeper; codify the systemic Encore-CronJob-self-hosted-no-op rule.

## Context: the systemic finding

Spec 143 FR-010's post-completion validation (§12 L-001) surfaced a bug that
is **not** specific to spec 143: Encore's `CronJob` declaration is only a
local-dev / future-Encore-Cloud entry point. On a self-hosted deployment
(this codebase's target since page one) there is no Encore scheduler, so a
sweeper wired *only* as an Encore `CronJob` never fires in production. The
handler exists, is unit-tested, and is correct; it is simply never called.

Spec 143 enumerated the affected sweepers (§12 L-001, each owner spec carries
the bug independently):

| Sweeper | Owner spec | Encore cron | Status before this spec |
|---|---|---|---|
| `factory-runs-staleness-sweeper` | 124 | every 1m | **silent no-op in prod** |
| `extraction-staleness-sweeper` | 115 FR-006 | every 1m | silent no-op in prod |
| `connector-sync-scheduler` | 087 §4.4 | every 15m | silent no-op in prod |
| `knowledge-orphan-imported-sweeper` | 143 FR-010 | every 30m | **fixed** (K8s CronJob shipped) |

Spec 143 §12 **FU-003** mandated the resolution path: "land a sibling spec,
i.e. write a new `specs/NNN-...` directory ... Best landed as a single
sibling spec ... to keep the systemic finding visible and the gates aligned."
This is that spec.

The factory-runs leg is landed first because it is the one the just-merged
#480 gateway auth fix unblocked: spec 143 §step-7's empirical correction
("gateway auth handler blocks M2M tokens") notes the auth-handler `null`
return "is the precondition for the spec 124 factory-runs sweeper's own
K8s-CronJob revival." That precondition is now met.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stuck factory runs get recovered on self-hosted (Priority: P1)

A desktop dies mid-run. The `factory_runs` row stays in `running` (or
`queued`), and the operator sees a permanently-stuck run in the Runs tab. On
Encore Cloud the `factory-runs-staleness-sweeper` cron would flip it to
`failed` after the staleness window; on the self-hosted Hetzner cluster that
cron never fires, so the row is stuck forever.

**Why this priority**: This is the delivered, operationally-driven leg. Stuck
runs are the visible symptom that motivated the #3 follow-up (OPC "Idle" /
"Processing" confusion, D2 factory stall). The sweep logic already exists
(`sweepStaleFactoryRuns`, spec 124 T062); only the self-hosted scheduling
path is missing.

**Independent Test**: Deploy the chart against a self-hosted cluster with the
`statecraft-factory-sweeper-credentials` Secret populated; seed a
`factory_runs` row in `running` with `last_event_at` older than
`STATECRAFT_FACTORY_RUN_STALE_AFTER_SEC`; wait one CronJob tick; assert the
row is `failed` with a `factory.run.swept` audit row under the system user.

**Acceptance Scenarios**:

1. **Given** a self-hosted cluster with the factory-sweeper Rauthy client
   provisioned (Default Scope `platform:factory:sweep`) and the Secret
   mounted, **When** the `factory-runs-sweeper` K8s CronJob fires, **Then**
   it mints a `client_credentials` JWT, POSTs `/internal/factory/runs-staleness-sweep`,
   the endpoint validates the `platform:factory:sweep` scope, and stale rows
   are swept.
2. **Given** a caller presenting no token or a token lacking
   `platform:factory:sweep`, **When** it POSTs the endpoint, **Then** the
   request is rejected (401/403) before any sweep runs.
3. **Given** the local-dev Encore process, **When** the parameterless
   `-cron` endpoint is invoked, **Then** the same sweep kernel runs without
   an Authorization header (Encore CronJob requires a parameterless handler).

### Edge Cases

- **Secret absent at deploy time.** If `statecraft-factory-sweeper-credentials`
  is not yet created (operator has not run the updated `setup.sh`), the
  CronJob pod fails to start (missing `envFrom` secretRef) or `curl` returns
  non-zero on the token fetch. This is the same fail-loud shape as the
  knowledge sweeper and is the documented deploy-ordering prerequisite, not a
  silent degradation.
- **Scope only in Allowed Scopes.** Per spec 143 §12 L-006, Rauthy 0.35
  `client_credentials` mints **Default** Scopes regardless of the `scope=`
  param; placing `platform:factory:sweep` only in *Allowed Scopes* is
  silently inert. The setup.sh instructions call this out.
- **Concurrent sweeps.** `sweepStaleFactoryRuns` is already idempotent
  (per-row transaction re-checks `status IN (queued, running)` under the
  transaction), so a K8s tick overlapping the residual local Encore path is
  safe.

## Requirements *(mandatory)*

### Functional Requirements: delivered this PR

- **FR-001**: The factory-runs staleness sweep MUST be reachable by an
  in-cluster HTTP caller. `api/factory/runsScheduler.ts` MUST expose an
  `expose:true`, `POST /internal/factory/runs-staleness-sweep` endpoint that
  gates on `validateM2mRequest(authorization, "platform:factory:sweep")`
  before running the sweep. (Mirrors spec 143 FR-010 `runOrphanImportedSweep`.)
- **FR-002**: The existing Encore `CronJob` MUST target a parameterless
  `expose:false` endpoint (`/internal/factory/runs-staleness-sweep-cron`) so
  the local-dev / future-Encore-Cloud path keeps working; both endpoints MUST
  call one shared sweep-and-log kernel. No behavioral change to
  `sweepStaleFactoryRuns`.
- **FR-003**: A K8s `CronJob` (`platform/charts/statecraft/templates/cronjob-factory-runs-sweeper.yaml`)
  MUST fetch a `client_credentials` JWT from Rauthy and POST the FR-001
  endpoint on a fixed cadence, mounting ONLY the per-purpose
  `statecraft-factory-sweeper-credentials` Secret (no cross-purpose mounts).
  It MUST mirror the orphan-sweeper template's security context and
  fail-loud `curl --fail` contract.
- **FR-004**: The per-purpose credential Secret MUST be provisioned two ways
  matching the knowledge-sweeper shape: an `ExternalSecret`
  (`external-secret-factory-sweeper.yaml`, ESO-backed clusters) and a direct
  `kubectl create secret` in `setup.sh` (Hetzner `secrets.provider: "k8s"`).
  Both MUST produce the same Secret name plus `CLIENT_ID`/`CLIENT_SECRET` keys
  so the CronJob stays cluster-agnostic.
- **FR-005**: `setup.sh` MUST list `STATECRAFT_FACTORY_SWEEPER_CLIENT_ID` /
  `_SECRET` in its Phase-2 required-var gate and print the
  `statecraft-factory-sweeper-m2m-app` Rauthy-client provisioning
  instructions (Default Scope `platform:factory:sweep`, §12 L-006 caveat).
  The Terraform credential variables already exist
  (`statecraft_factory_sweeper_client_id/_secret`, staged by FU-003) and need
  no change.

### Functional Requirements: systemic rule

- **FR-006**: Any FR that schedules recurring work via Encore's `CronJob` on
  a self-hosted deployment MUST provision a sibling K8s `CronJob` resource
  that curls the registered endpoint on the same cadence. An Encore `CronJob`
  declaration alone is a local-dev entry point, not a production scheduler.
  Spec review MUST verify deployment-target alignment for any FR that depends
  on an Encore platform primitive (spec 143 §12 L-002).

### Functional Requirements: staged (NOT delivered this PR)

- **FR-007** *(staged)*: Revive the spec 115 `extraction-staleness-sweeper`
  the same way (expose:true M2M endpoint + K8s CronJob + per-purpose Rauthy
  client). Deferred: worker-crash recovery is lower operational urgency than
  stuck factory runs, and no Terraform credential slot is pre-wired for it
  yet. Tracked here to keep the systemic finding in one spec.
- **FR-008** *(staged)*: Revive the spec 087 `connector-sync-scheduler` the
  same way. Deferred for the same reasons as FR-007.

## Key Entities

- **`statecraft-factory-sweeper-m2m-app`**: the Rauthy `client_credentials`
  client for this sweeper. Default Scope `platform:factory:sweep`. Its
  credential is bounded to exactly one surface (the factory-runs sweep
  endpoint); a leak does not cross into the knowledge sweeper's authority.
- **`statecraft-factory-sweeper-credentials`**: the K8s Secret carrying that
  client's `CLIENT_ID`/`CLIENT_SECRET`, the SOLE credential mounted into the
  CronJob pod.
- **`platform:factory:sweep`**: the OAuth scope the FR-001 endpoint requires.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a self-hosted cluster, a `factory_runs` row stuck in
  `running` past the staleness window is flipped to `failed` within one
  CronJob cadence plus the staleness grace, with a `factory.run.swept` audit
  row. (Was: never, indefinitely stuck.)
- **SC-002**: The FR-001 endpoint rejects any request lacking the
  `platform:factory:sweep` scope before running a sweep.
- **SC-003**: `helm template` renders the factory CronJob + ExternalSecret
  cleanly; `helm lint` passes; the coupling gate and spec-lint are green with
  spec 224 claiming the new plus extended paths.
- **SC-004**: No cross-purpose credential mount: the CronJob pod's `envFrom`
  references only `statecraft-factory-sweeper-credentials`.

## Amendment: spec 124

This spec amends spec 124 (`opc-factory-run-platform-integration`) by
recording that its factory-runs staleness sweeper, established in §6 as an
Encore `CronJob`, was a silent no-op on the self-hosted target and is revived
here via the FR-001..FR-005 K8s scheduling path. Spec 124's sweep kernel
(`sweepStaleFactoryRuns`) is unchanged; only the scheduling/reachability
surface is added. See spec 124's amendment callout.


## Security hardening amendment (2026-07-02)

Disabled service-account token automount on the factory-runs and orphan sweeper CronJob pods, which do not call the K8s API.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
