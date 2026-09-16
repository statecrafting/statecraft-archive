---
id: "221-oap-instance-bootstrap-cli"
title: "OAP fork-parameterization + oap-bootstrap pointer (FR-040)"
feature_branch: "feat/221-oap-instance-bootstrap-cli"
status: approved
implementation: complete
kind: capability
domain: platform
created: "2026-06-21"
authors: ["open-agentic-platform"]
language: en
risk: medium
summary: >
  The oap-bootstrap CLI (a Go tool that forks open-agentic-platform into a new
  GitHub org and stands up its Hetzner K3s estate) lives in its OWN repository,
  mirroring the spec-spine engine (217) and tenant-tail (219) separate-repo
  precedent. Its authoritative design is authored there. THIS spec is the OAP-side
  residue: (1) a pointer to that repo, and (2) FR-040, the small "make a fork need
  zero source edits" parameterization that necessarily lands in the OAP tree. The
  CLI design was first drafted here (full spec.md) while the implementation
  details were fresh; that body has been relocated to the oap-bootstrap repo and
  this entry slimmed to the pointer + footprint. The `references:` context edges
  remain so the contract surface the CLI consumes (env vars, K8s secret shapes,
  the GitHub webhook permission/event set, the Rauthy client shapes) stays
  visible to OAP-side drift review.
code_aliases: ["OAP_BOOTSTRAP", "OAP_FORK_PARAMETERIZATION"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI06", "ASI04"]
depends_on:
  - "106-rauthy-native-oidc-and-membership"
  - "151-declarative-cluster-reconciliation"
  - "137-tenant-environment-access-gates"
  - "143-presigned-upload-public-endpoint"
  - "072-multi-cloud-k8s-portability"
  - "116-supply-chain-policy-gates"
extends:
  # Same featuregraph-golden precedent specs 196/194/193/187/183/209/219/220 follow:
  # adding a new spec regenerates the golden fixture, so 221 co-owns it additively.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
co_authority:
  # FR-040: the flux-bootstrap owner/repo seam in the hetzner setup.sh `bootstrap`
  # section becomes fork-parameterizable. This is the one fork-blocking source
  # edit; it lands inside spec 151's `bootstrap` section, so 221 joins that
  # section's co-authority roster (151 + the four it lists).
  - with_specs:
      - "072-multi-cloud-k8s-portability"
      - "106-rauthy-native-oidc-and-membership"
      - "137-tenant-environment-access-gates"
      - "143-presigned-upload-public-endpoint"
      - "151-declarative-cluster-reconciliation"
    unit: { kind: section, file: platform/infra/hetzner/setup.sh, anchor: bootstrap }
references:
  # Contract surface the CLI consumes (context, not authority). Kept so OAP-side
  # review can see drift between this tree and the external bootstrapper. setup.sh
  # is deliberately NOT here: it is claimed above via co_authority (FR-040).
  - role: context
    unit: { kind: file, path: platform/services/statecraft/api/github/webhook.ts }
  - role: context
    unit: { kind: file, path: platform/services/statecraft/scripts/seed-rauthy.mjs }
  - role: context
    unit: { kind: file, path: platform/charts/statecraft/values-hetzner.yaml }
  - role: context
    unit: { kind: file, path: platform/charts/deployd-api/values-hetzner.yaml }
  - role: context
    unit: { kind: file, path: specs/219-tenant-tail-verifier-toolkit/spec.md }
---

# Feature Specification: OAP fork-parameterization + oap-bootstrap pointer

**Feature Branch**: `feat/221-oap-instance-bootstrap-cli`
**Created**: 2026-06-21
**Status**: Approved (OAP-side footprint complete; the CLI design is authoritative elsewhere)

## Where the CLI design lives

The full `oap-bootstrap` design (phases, config-by-provenance schema, the GitHub
App Manifest flow, the Rauthy/Cloudflare automation, the resolved design
decisions) is authored in the **oap-bootstrap repository** as its spec
`001-oap-instance-bootstrap-cli`. That is the authoritative record, following the
same separate-repo precedent as spec-spine (217) and tenant-tail (219).

This OAP-side entry is intentionally thin. It exists for two reasons:

1. **Traceability.** The id `221` keeps the OAP corpus aware that a governed
   external tool forks and stands up this platform, and preserves the design's
   point of origin (it was drafted here while the implementation details were
   fresh, then relocated).
2. **The OAP-side footprint (FR-040).** One small change must land in THIS tree
   to make a fork work without hand-editing source. That is the section below,
   and it is what `implementation: complete` refers to (FR-040 landed in #409).

## Requirements

### FR-040: a fork needs zero source edits (fork-parameterization)

A bootstrapper that forks `statecrafting/open-agentic-platform` into, say,
`acme-inc/open-agentic-platform` must be able to run the existing Hetzner
deployment under the new owner without editing tracked source. Auditing the
hardcoded `statecrafting/open-agentic-platform` references showed that almost
all of them are ALREADY fork-safe by existing design, and exactly one is not:

- **`platform/infra/hetzner/setup.sh`, `bootstrap` section (REQUIRES this spec).**
  `flux bootstrap github --owner/--repo` was hardcoded to the upstream owner/repo.
  Flux reconciles the cluster FROM that repo, so a fork pointed at the upstream
  would GitOps-reconcile the wrong tree. This spec makes owner/repo/branch
  env-driven (`FLUX_OWNER`/`FLUX_REPO`/`FLUX_BRANCH`) with the upstream values as
  defaults, so an unset `.env` is byte-for-byte equivalent to prior behavior and
  a fork sets three env vars. This is the single fork-blocking source edit and
  the only path this spec claims authority over.

- **Root `Makefile`, `axiomregent-build` (already fork-safe, NO change).**
  `AXIOMREGENT_REPO` is already `?=` overridable and auto-detects the repo from
  the local git remote, falling back to the upstream path only when detection is
  empty (a fresh fork with no CI artifacts of its own correctly reuses upstream's
  prebuilt sidecar). No edit needed.

- **`platform/Makefile`, `HETZNER_REGISTRY` (already overridable, NO change).**
  Declared with `?=`, so a fork sets `HETZNER_REGISTRY` in the environment. Only
  the local `make deploy-hetzner` path consults it; the automated path does not.

- **`platform/charts/{statecraft,deployd-api}/values-hetzner.yaml` image refs
  (CD-overridden, NO change).** The CD workflows pass
  `--set image.repository=ghcr.io/${{ github.repository }}`, so a fork's pipeline
  targets the fork's own registry. The hardcoded value is the non-CD fallback.
  These remain as `references: role: context` so drift stays visible; if a future
  need arises to env-drive them for the local manual path, that is a separate
  unit (it requires a new section anchor for the platform Makefile and whole-file
  YAML authority modeling, neither of which a fork's automated path needs today).

**Net:** FR-040 is satisfied by the single setup.sh `bootstrap` edit plus the
parameterization that already existed. The corrected audit (above) supersedes the
initial "five hardcoded references" framing carried in the design draft, which
predated checking that the Makefile and chart refs were already fork-safe.

## Non-Goals

- The CLI's own design, phases, and milestones (M1+). Those live in the
  oap-bootstrap repo's spec 001. Its M0 milestone IS this spec's FR-040.
- Reimplementing setup.sh, post-create.sh, or the Helm charts.
- Env-driving the CD-overridden registry refs for the local manual deploy path
  (a fork's automated path does not need it; tracked as a possible later unit).
