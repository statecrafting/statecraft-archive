# Implementation Plan: Tenant-hello demo service

**Branch**: `136-tenant-hello-demo-service` | **Date**: 2026-05-04 | **Spec**: [`spec.md`](./spec.md)

## Summary

Lock the existing `platform/services/tenant-hello` express service in as the
canonical fixture for statecraft's tenant-deploy contract (C-001…C-005),
then close the gap between "tenant codebase exists" and "statecraft can
deploy it end-to-end." The codebase contract is already authored in `spec.md`;
this plan covers the deferred deliverables and the order they land in.

## Technical context

- **Language/Stack:** Express 4 on Node 20 (tenant-hello), Helm/Kubernetes (the
  missing chart), Encore.ts (statecraft-side wiring), `deployd-api-rs`
  (axum + hiqlite, the deploy orchestrator).
- **Repo footprint:** `platform/services/tenant-hello/`, future
  `platform/charts/tenant-hello/`, statecraft API surface for chart selection.
- **Out-of-band dependencies:** existing `platform/charts/statecraft/` and
  `platform/charts/deployd-api/` baselines (security context, ingress
  conventions) are the reference for chart shape.

## Constitution check

- **Principle I (markdown-only authored truth):** `spec.md`, `plan.md`,
  `tasks.md` are markdown; no standalone YAML beyond Helm chart values
  (Helm is tooling output, not authored OAP truth).
- **Principle II (compiler-owned JSON machine truth):** This spec adds
  no JSON authoring; only the spec compiler emits machine truth.
- **Principle III (spec-first):** The Helm chart and statecraft wiring
  are blocked behind this spec's approval. No code added under FR-004
  before `status: approved`.
- **CONST-005:** Authoring this spec is forward documentation, not
  retroactive justification of an action. The fixture pre-exists the
  spec, but the spec is not edited to accommodate the fixture — the
  contract clauses are designed first and the fixture is verified to
  honour them. Any future violation by tenant-hello is treated as a
  fixture bug, not as licence to weaken the contract.

## Phased delivery

### Phase 0 — Lock the contract *(this PR; gates approval)*

- Spec text frozen on review (C-001…C-005, FR-001…FR-005, SC-001…SC-003).
- `oap.spec` field on `platform/services/tenant-hello/package.json`.
- Codebase-indexer extended (`discover_npm_packages`) to scan
  `platform/services/tenant-hello/`. Layer 1 + Layer 2 tables show the
  fixture against this spec.
- `status: draft, implementation: in-progress` honest until the chart
  and wiring land.

### Phase 1 — Helm chart for tenant-hello

- `platform/charts/tenant-hello/Chart.yaml`, `values.yaml`,
  `templates/{deployment,service,ingress,serviceaccount}.yaml`.
- Modelled after `platform/charts/statecraft/`'s baseline: non-root
  `runAsUser`, readiness probe pointing at `/healthz` (the
  contract clause C-002), `PORT` env injection (C-003), no PVC mounts
  (C-004 stateless).
- Chart linted via `helm lint` and rendered via `helm template` with the
  default values into `charts/tenant-hello/test-render.yaml` for golden
  comparison.

### Phase 2 — statecraft chart-per-tenant wiring

- `services/statecraft/api/projects/` gains a `chartSelector` rule that
  resolves a chart for a registered project. For projects bound to the
  tenant-hello reference shape, this resolves to `tenant-hello`.
- `deployd-api-rs` invocation path accepts the resolved chart name from
  statecraft and applies it via Helm.
- One end-to-end happy-path: statecraft "deploy" UI button on a project
  pointing at this codebase → pod live behind the cluster's ingress →
  `/healthz` returns 200 from the running pod.

### Phase 3 — Negative-path validation

- A purpose-built fixture codebase (or a tenant-hello variant on a
  branch) that violates one C-clause at a time. The deploy pipeline must
  fail with a localised error citing the violated clause, not a generic
  platform crash. This is SC-002's "fails with localised error"
  obligation.

### Phase 4 — Status flip

- After Phase 1+2+3 land, amend this spec to `implementation: complete`
  and `status: approved`. Per the spec/code coupling protocol, the
  amender PR is the one that flips the lifecycle fields — never an
  unrelated PR.

## Gating order

Phase 0 → 1 → 2 → 3 → 4. Phases 1 and 2 are not parallelisable: the
chart shape is the input to the statecraft selector. Phase 3 depends on
both. Phase 4 is the lifecycle bookkeeping after the deliverables land.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Helm chart drifts from `statecraft`/`deployd-api` baseline | medium | Treat existing charts as the reference; review chart values against their `_helpers.tpl` and `values.yaml`. |
| statecraft `chartSelector` becomes a bespoke per-tenant switch statement | medium | Selector takes a project's manifest descriptor (image name + chart shape) as input; tenant-hello is the single shape this spec governs. Multi-shape support is a separate spec. |
| Negative-path fixture explodes in scope | low | Phase 3 picks one C-clause violation per pass; SC-002 needs *evidence*, not exhaustive coverage. |
| FR-004 status flip is taken before evidence lands | medium | The spec/code coupling gate (specs 127, 130, 133) blocks status flips that are not supported by code change. Phase 4 is the *only* PR that touches the lifecycle frontmatter. |

## Out of scope (this spec)

- Multi-service tenant codebases (single-service-per-project only here).
- Tenant codebase autoscaling, multi-region, or HA topology — values
  defaults stay single-replica.
- Tenant-side observability beyond the platform's existing logging
  conventions.
- Per-tenant secret injection workflow — that lives in the rauthy /
  KeyVault path covered by other specs (see 106-rauthy-native-oidc-and-membership).
