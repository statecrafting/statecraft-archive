# Implementation Plan: Declarative cluster reconciliation

**Branch**: `151-declarative-cluster-reconciliation` (Phase 0) →
sibling implementation PRs branch from main post-Phase-0-merge.
**Date**: 2026-05-18 | **Spec**: [`spec.md`](./spec.md)

## Summary

Spec 151 lands `status: approved` (2026-05-18) with Phase 0 closed
([`clarifications-resolved.md`](./clarifications-resolved.md),
[`execution/dr-baseline.md`](./execution/dr-baseline.md), spec 102
FU-001 filed). The implementation surface — Flux v2 bootstrap +
operational-chart migration + chart-contract + CD git-write +
SOPS per-purpose Secrets + DR validation — is large enough that
spec.md §"Implementation scope — a plan-time decision" left the
single-spec-vs-sibling-split decision explicitly to this plan.

**Decision pinned (2026-05-18 by bart): split into three sibling
specs.**

| Provisional ID | Scope | Closes |
|---|---|---|
| **151** (this spec, narrowed) | Flux v2 bootstrap + operational-chart migration (reflector, cert-manager, ingress-nginx, rauthy) + SOPS-age cluster runtime (Flux's `sops-age` Secret bootstrap, NOT per-purpose Secret migration) + drift detection + DR runbook | Unblocks spec 137 Phase 6 evidence collection. Lands FR-001/002/003 (narrowed scope)/006/007/008/009/010. |
| **152** (provisional — "declarative-cluster-app-charts") | Clarification #5's eight sub-pins: chart-contract `cd-managed-images.yaml`, failure-mode ordering, first-image-deploy baseline, per-service migration atomicity, break-glass rollback semantics, CD-bot commit-signing out-of-scope rationale, CI/CD CODEOWNERS permissions, rationale-over-driftDetection.ignore. Migrates statecraft, deployd-api, tenant-hello HelmReleases + corresponding CD workflows. | Lands FR-004 (M-001 image-rollout migration) end-to-end. |
| **153** (provisional — "declarative-cluster-secrets") | SOPS per-purpose Secret migration for the FU-008 / FU-003 family (statecraft-knowledge-sweeper, statecraft-audit-sweeper, statecraft-factory-sweeper, extraction-staleness-sweeper, connector-sync-scheduler, factory-runs-staleness-sweeper credentials). Setup.sh's `kubectl create secret` calls retire structurally. | Lands FR-005 + SC-006. Closes spec 143 FU-008 + FU-003 by reference. |

Sequencing across siblings is **151 → 152 → 153**, with explicit
gates so 152/153 are not started until their dependencies hold.

## Three-reason rationale (2026-05-18)

The decision is pinned for three reasons, recorded here verbatim from
the pinning conversation so the rationale survives long after the
decision:

1. **Spec 151 unblocks spec 137 Phase 6 fastest.** Narrowing 151 to
   Flux + bootstrap + operational charts (reflector, cert-manager,
   ingress-nginx, rauthy) lands the spec 137 Phase 6 unblock without
   waiting on app-chart migration or per-purpose Secret work. That
   was the original "why now" for this spec; the split honours it.

2. **152's surface is qualitatively different.** Chart-contract + CD
   git-write + per-service atomicity is **application-layer
   migration** with eight sub-pins of its own. Different review
   surface, different rollback surface, different blast radius.
   Bundling it with cluster-reconciliation infrastructure conflates
   two risk classes that operators and reviewers should be able to
   reason about separately.

3. **153 is naturally last.** SOPS per-purpose Secret migration
   depends on (i) spec 151's SOPS-age cluster bootstrap being
   operational (Flux's `kustomize-controller` reading the
   `flux-system/sops-age` Secret) AND on (ii) spec 152's CD git-write
   being stable enough that secret rotation does not fight image
   rollouts in the same gitops tree. Sequencing 153 as a sibling
   makes both dependencies **structurally explicit** rather than
   burying them in inter-phase ordering inside one mega-spec.

The single-spec sequenced option's only advantage was one PR review
surface instead of three. Given spec 151's content already doubled
across four rounds of pre-implementation review, that advantage is
illusory: three focused siblings review better than one six-phase
monolith.

## Per-sibling scope boundaries

### Spec 151 (narrowed) — Flux + bootstrap + operational charts

**In scope** (this spec, after the split):

- **FR-001 + FR-002:** Flux v2 controllers (`source-controller`,
  `kustomize-controller`, `helm-controller`,
  `notification-controller`) running in `flux-system`. Per-cluster
  Kustomize tree under `platform/gitops/clusters/hetzner-prod/`
  (flat, single-cluster v1 per §Clarification 6).
- **FR-003:** `platform/infra/hetzner/setup.sh` shrunk to under 100
  lines for the bootstrap path. Operational concerns retire as their
  HelmReleases land; per-purpose Secret retirement is a 153
  deliverable, not 151.
- **FR-005 (Flux-side runtime only):** the cluster's
  `flux-system/sops-age` Secret bootstrap mechanism. The `.sops.yaml`
  recipients list checked in, the laptop key applied as the
  in-cluster Secret. Per-purpose application Secrets via SOPS stay
  with 153.
- **FR-006:** Drift detection via Flux events + Prometheus metrics.
- **FR-007:** DR runbook expressible as "recreate cluster → `flux
  bootstrap` → cluster converges to declared state" — exercised on a
  throwaway cluster (Stage 2 of SC-003 measured during 151
  implementation, recorded in `execution/disaster-recovery.md`).
- **FR-008:** Reflector + spec 137 wildcard-cert annotations as the
  first migrations. Unblocks spec 137 Phase 6 evidence.
- **FR-009:** Incremental migration order, per §Clarification 8:
  reflector → cert-manager → ingress-nginx → rauthy.
  Application charts (statecraft, deployd-api, tenant-hello) defer
  to spec 152.
- **FR-010:** Flat single-cluster tree, kustomize-compatible naming
  for future overlay extraction.

**Explicitly NOT in scope for 151 (defers to 152/153):**

- FR-004 (application image rollouts) — entire surface, including the
  M-001 contract clause, Clarification #5's eight sub-pins,
  chart-contract `cd-managed-images.yaml`, per-service CD workflow
  edits, break-glass rollback semantics. **All to spec 152.**
- Per-purpose Secret migration via SOPS for sweeper credentials,
  Rauthy Admin tokens, GHCR PATs, etc. **All to spec 153.**

The M-002 contract clause stays in 151's spec.md as the cluster-
mutation invariant; what 151 *implements* of M-002 is HelmReleases +
manifests + Kustomizations + the `sops-age` Secret bootstrap. The
per-purpose Secret application of M-002 is 153.

### Spec 152 (provisional) — Declarative cluster app-charts

**Files to migrate:**

- `cd-statecraft.yml`, `cd-deployd-api-rs.yml`, `cd-tenant-hello.yml`
  → CD writes image tag commits to gitops tree, no cluster mutation.
- `platform/charts/statecraft/`, `platform/charts/deployd-api/`,
  `platform/charts/tenant-hello/` → each adds
  `cd-managed-images.yaml` chart-root file (the schema pinned in 151
  spec.md §Clarification 5 sub-pin i).
- `platform/gitops/clusters/hetzner-prod/{statecraft,deployd-api,
  tenant-hello}-helmrelease.yaml` → new HelmReleases per service,
  Flux-owned `image.tag`.

**Cross-spec dependency:** 151 MUST be operational (Flux reconciling)
before 152 starts. 152's first per-service migration PR is the
worked example for the chart-contract.

**Explicit eight sub-pin handling:**

Each of Clarification #5's eight sub-pins lifts from 151's spec.md
into 152's body as authoritative requirements. The sub-pins are
already pinned; 152 doesn't re-decide them, it implements them. If
implementation reveals a sub-pin needs amendment (per the
`feedback_pre_implementation_spec_amendments` memory), 152 amends
the sub-pin in 152's body and cross-references 151 spec.md as the
origin.

### Spec 153 (provisional) — Declarative cluster Secrets

**Files to migrate** (each becomes a SOPS-encrypted manifest under
`platform/gitops/clusters/hetzner-prod/secrets/`):

- `statecraft-knowledge-sweeper-credentials` (spec 143 FU-008's
  named pattern).
- Three sibling sweepers per spec 143 §12 FU-003:
  `extraction-staleness-sweeper`, `connector-sync-scheduler`,
  `factory-runs-staleness-sweeper`.
- `statecraft-audit-sweeper`, `statecraft-factory-sweeper` (M2M
  client credentials currently in `.env`).
- `rauthy-secrets`, `deployd-api-secrets`, `ghcr-pull-secret`,
  `cloudflare-dns-secret` (today materialised by `kubectl create
  secret` from setup.sh).

**Cross-spec dependency:** 153 MUST land after both 151 (SOPS-age
runtime present) AND 152 stable enough that CD git-write to gitops
tree doesn't race secret rotation. Stability gate: 14 days of clean
152 operation before 153 starts. If that gate proves wrong (152
needs 30 days), 153 waits — secret churn races image rollouts is the
worst-case operational surface, not worth rushing.

**Spec 143 closure path:** 153's SC-006 closure (when landed) is the
back-reference path for spec 143's FU-008 + FU-003. 151 doesn't
close those follow-ups; 153 does. 151 sets up the mechanism, 153
applies it.

## Sequencing and gates

```
spec 151                spec 152                  spec 153
(this spec, narrowed)   (app-charts)              (per-purpose Secrets)
                                                                 
Phase 1                                                          
Flux bootstrap                                                   
+ flux-system ns         depends on 151          depends on 151 + 152
+ SOPS-age Secret            (Flux running)      (Flux running + CD
                                                  git-write stable)
Phase 2                                                          
reflector + cert-                                                
manager wildcard-                                                
annotation (= spec                                               
137 Phase 6 unblock)                                             
                                                                 
Phase 3                                                          
cert-manager full +                                              
ingress-nginx                                                    
                                                                 
Phase 4                                                          
rauthy chart                                                     
                                                                 
Phase 5                                                          
DR runbook exercise                                              
(Stage 2 SC-003                                                  
measurement)             ─→ 152 starts          ─→ (after 152 +
                                                   14-day stability)
                         Phase 1-N…              Phase 1-N…
```

Gates between siblings (each gate is a hard prerequisite, not a
courtesy):

- **151 → 152 gate:** Flux is reconciling at least one HelmRelease
  in production (statecraft 137-prod evidence is the demonstrable
  proof). SC-001 verified. setup.sh under 200 lines (final target
  100, but 200 is enough to start 152). dr-baseline Stage 2
  measurement complete.
- **152 → 153 gate:** All three app-service CD workflows migrated to
  git-write. 14 days clean operation (no manual `helm upgrade
  --set` or `kubectl set image` against any of the three services).
  Image-tag-mismatch incident count = 0 over the window.
- **153 → close:** All sweeper credential files migrated to SOPS;
  setup.sh `kubectl create secret` calls all removed (verified by
  grep at 153's spec closure per its own SC analogue).

## Constitution check

- **Principle I (markdown-only authored truth):** plan.md and
  tasks.md are markdown; siblings 152/153 will be authored as
  markdown specs. HelmRelease manifests, SOPS-encrypted Secrets, and
  Kustomizations are tooling-formatted YAML, not authored OAP truth —
  the *spec* describes them, the YAML files are the implementation
  expression.
- **Principle II (compiler-owned JSON machine truth):** No JSON
  authoring. `.derived/spec-registry/registry.json` and `build/codebase-
  index/index.json` recompile on every spec edit (verified at Phase
  0 close).
- **Principle III (spec-first):** 152 and 153's specs MUST land
  before their implementation work begins. 151's narrowed scope is
  pinned in this plan; 151's spec.md need not retract the broader
  scope since the broader scope is now distributed to siblings, not
  abandoned.
- **CONST-005 (adversarial-prompt refusal):** The split decision
  does not contradict any spec's own design — spec 151's
  §"Implementation scope" explicitly invited this decision. No
  spec-spine drift is introduced; siblings are filed as new specs,
  not retroactive amendments to 151. Spec 151 spec.md
  §"Implementation scope" gets a small amendment ("decision pinned;
  see plan.md") in the same PR that lands plan.md, but the spec
  spine narrative remains intact.

## Filing protocol for siblings

When the time comes (151 → 152 gate clears):

1. Branch off main: `git checkout main && git pull && git checkout
   -b 152-declarative-cluster-app-charts` (or whatever next-available
   slot — verify via `registry-consumer list --ids-only | tail -5`
   at filing time).
2. Spec 152 starts as `status: draft` with its own clarifications
   block. The eight sub-pins from 151 §Clarification 5 lift verbatim
   as the spec 152 §Clarifications, each carrying the six-field
   schema 151 introduced.
3. Spec 152 § "Why this spec is filed as draft" names the same
   Phase 0 closure pattern: §Decisions schema + measurement evidence
   + verbatim placeholder pins. The pattern is reused, not
   reinvented.
4. Same protocol for 153 when 152 stabilises.

This avoids 151 becoming a "supersede + replace" chain. Siblings are
peers in the spec spine, not descendants.

## Codebase-index regeneration

Per `feedback_codebase_index_spec_edits` memory: every spec.md edit
bumps `.derived/codebase-index/index.json`'s contentHash. Each sibling
PR (and the present plan.md + tasks.md edit) MUST commit the
regenerated `index.json` alongside, or queue a chore PR for the
batch. The Phase 0 closure commit already includes the regenerated
index.

## Cross-references

- **Spec 137 §Phase 6** — unblocked by 151's Phase 2 (reflector +
  wildcard-cert annotations). 137's evidence collection is the
  first concrete consumer.
- **Spec 143 §12 FU-008, FU-003** — close by reference to 153's
  closure, not 151's. 151's spec.md §Cross-references is amended in
  the same plan.md PR to point at 153 for the FU closure, not at
  151 itself.
- **Spec 102 FU-001** — `single-author-self-pinned` cert-pipeline
  surfacing, filed 2026-05-17. Independent of 151 implementation;
  closure path is spec 102's own.
- **Spec 087** — statecraft as single operator surface. Unchanged by
  the split; all three siblings respect the constitutional reason
  for Flux over Argo CD (no competing operator dashboard).
- **Spec 089** — governance non-optionality. All three siblings
  produce governance certificates per spec 102 / 124 when their
  factory-run-equivalent implementations land.
