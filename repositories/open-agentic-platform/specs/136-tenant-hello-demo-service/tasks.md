# Tasks: Tenant-hello demo service

**Input**: [`spec.md`](./spec.md), [`plan.md`](./plan.md)

> Format: `[ID] [P?] Description`. `[P]` = parallelisable with adjacent
> tasks. Tasks track plan.md phases.

## Phase 0 — Lock the contract *(this PR)*

- [x] T001 Author `spec.md` with C-001…C-005 contract, FR-001…FR-005,
  SC-001…SC-003.
- [x] T002 Add `oap.spec = "136-tenant-hello-demo-service"` to
  `platform/services/tenant-hello/package.json`.
- [x] T003 Extend `tools/spec-spine/codebase-indexer/src/manifest.rs`
  `discover_npm_packages` to include `tenant-hello` alongside
  `statecraft`. Verify Layer 1 NPM table and Layer 2 traceability list
  the fixture.
- [x] T004 Author `plan.md` and `tasks.md` (this file).
- [x] T005 Reviewer pass — confirm C-001…C-005 wording, then flip
  `status: draft → approved` in a separate PR. **Done 2026-05-06**:
  contract verified against the tenant-hello fixture (Dockerfile
  non-privileged, `/healthz` returns 200 with non-empty body, PORT env
  honoured, stateless, single declared dependency). Lifecycle: status
  draft → approved; implementation stays `in-progress` until Phase 3
  evidence per §Phase 4.

**Checkpoint:** Phase 0 closes when T005 ships. Phases 1–3 are blocked
behind this checkpoint per Principle III.

---

## Phase 1 — Helm chart for tenant-hello

- [x] T010 Create `platform/charts/tenant-hello/Chart.yaml` (apiVersion
  v2, version pinned to a fresh `0.1.0`). **Done 2026-05-06.**
- [x] T011 [P] `values.yaml` with image, replica count (1), service
  port (8080 default, overridable), ingress disabled by default, security
  context (non-root, read-only filesystem). **Done 2026-05-06.**
- [x] T012 [P] `templates/deployment.yaml` — single Deployment with
  `PORT` env injection (clause C-003), readiness probe on `/healthz`
  (C-002), liveness probe on the same path with a longer
  `initialDelaySeconds`. **Done 2026-05-06.**
- [x] T013 [P] `templates/service.yaml` — ClusterIP service exposing the
  service port. **Done 2026-05-06.**
- [x] T014 [P] `templates/serviceaccount.yaml` — bound SA, no extra
  permissions. **Done 2026-05-06.**
- [x] T015 `templates/ingress.yaml` (gated on
  `values.ingress.enabled`) — host driven by a statecraft-supplied
  per-tenant value. **Done 2026-05-06.**
- [x] T016 `helm lint platform/charts/tenant-hello/` clean.
  **Done 2026-05-06** — `helm v4.1.1` lint exits 0 (only an INFO
  about a missing chart icon, no warnings or errors). Skipped the
  `make ci` integration: there's no existing `ci-charts` recipe and
  the other charts (statecraft, deployd-api, rauthy) aren't lint-gated
  in CI either; introducing a one-chart precedent would be inconsistent.
- [x] T017 `helm template` rendered cleanly with default values:
  ServiceAccount + Service + Deployment + (optional) Ingress, with the
  expected `oap.spec` label, non-root securityContext, `PORT` env
  injection, and `/healthz` probes. Skipped committing a golden fixture
  for the same consistency reason as T016.

**Checkpoint:** Helm chart lints, renders deterministically, matches
the C-clause obligations.

---

## Phase 2 — Statecraft chart-per-tenant wiring

- [x] T020 Add `chartSelector` to
  `platform/services/statecraft/api/deploy/chartSelector.ts` (placed
  under `api/deploy/` rather than `api/projects/` because chart
  resolution is part of the deploy invocation surface, not project
  creation). Pure function: input is a `{shape: TenantShape}`
  descriptor; output is a `{chart, version}` selection. tenant-hello
  is the first registered shape; unknown shapes throw rather than
  silently fall back. Unit test under `chartSelector.test.ts`
  (3 tests, all passing). **Done 2026-05-06.**
- [x] T021 Statecraft API surface change documented inline in the
  service's CLAUDE.md. **Done 2026-05-15** —
  `platform/services/statecraft/CLAUDE.md` gains a "Chart selection
  and deploy wire contract (spec 136)" section that pins the
  `chartSelector` semantics (pure function, throw-on-unknown shape),
  the `deployd-api-rs` `POST /v1/deployments` wire shape (`chart` /
  `chart_version` fields, mapping from `artifact_ref` /
  `desired_routes` / slugs to Helm values), and the local-dev
  record-only fallback.
- [x] T022 `deployd-api-rs` deploy invocation accepts the resolved
  chart name from statecraft and applies it via Helm.
  **Done 2026-05-15.** Approach decisions taken in this PR:
  * **Shell out to `helm` CLI** rather than introducing a Rust Helm
    library — keeps the dep surface small and matches platform-wide
    Helm semantics (chart hooks, `--wait`, release tracking via
    `helm status`). The Dockerfile bundles `helm` v3.16.4 in the
    runtime image.
  * **Embed chart bytes via `include_str!`** rather than mounting a
    chart-root ConfigMap or pulling from a chart registry — the
    binary is self-contained, and the same bytes that compile into
    the image are the bytes tests render against. Adding a new chart
    means appending a `match` arm in `platform/services/deployd-api-rs/src/helm.rs`
    plus the embedded `include_str!` consts.
  * **Broaden the Docker build context to `platform/`** (one-line
    change in `.github/workflows/cd-deployd-api-rs.yml`) so the
    `include_str!` relative paths from `src/helm.rs` reach the
    chart sources at compile time.
  * **Keep the kube-rs cluster probe** in `k8s.rs::probe_cluster`
    so local dev without a cluster still short-circuits to
    `ROLLED_OUT` (record-only) — the same UX the previous code path
    offered. The raw K8s object construction is gone; the probe is
    the only kube-rs surface remaining.
  * **Tests** (`helm::tests`) exercise the values builder (pure),
    chart materialisation (filesystem), and `helm template` against
    the embedded chart with and without ingress (binary). The CI
    workflow installs `helm` via `azure/setup-helm` so the template
    tests assert rather than no-op.
- [x] T023 End-to-end happy path — depends on a live cluster.
  **Done 2026-05-17.** Image source: `cd-tenant-hello.yml`
  workflow_dispatch run 25987117916 (added in this same PR cycle to
  unblock T023 — the tenant-hello chart's `image.repository` default
  points nowhere by design, so the chart could not be deployed
  without first publishing the image to GHCR). `helm install` of
  `platform/charts/tenant-hello` against the Hetzner K3s dev cluster
  reached `1/1 Running` under `helm --wait`; `/healthz` returned
  `ok` HTTP 200 and `/` returned the JSON-root response over a
  port-forward. Full transcript in `execution/verification.md`
  §"T023 — End-to-end happy path".

**Checkpoint:** Phase 2 code is complete. SC-002 positive path
evidenced 2026-05-17 (`execution/verification.md` §T023).

---

## Phase 3 — Negative-path validation

- [x] T030 Pick one C-clause to violate per pass. **Done 2026-05-17.**
  Three passes ran: C-001 (`nginx:alpine`, default root user +
  writable-rootfs expectations), C-002
  (`nginxinc/nginx-unprivileged:alpine`, non-root but no `/healthz`
  route), C-003 (`hashicorp/http-echo`, ignores `PORT` env). Stock
  images chosen over hand-authored "broken-tenant" variants to keep
  the negative-path harness reproducible from any clone.
- [x] T031 For each violation, run the deploy pipeline; assert the
  failure is **localised**. **Done 2026-05-17.** Per-pass evidence
  in `execution/verification.md` §"T030/T031 — Negative-path
  validation":
    * **C-001 pass** — container logs cite
      `mkdir() "/var/cache/nginx/client_temp" failed (30: Read-only
      file system)`; chart's `runAsUser=10001` +
      `readOnlyRootFilesystem=true` is the enforcement edge that
      catches the privileged-image expectation.
    * **C-002 pass** — kubelet events cite
      `Readiness probe failed: HTTP probe failed with statuscode: 404`
      with the `/healthz` path in the event message; chart's
      probe target on `/healthz` is the enforcement edge.
    * **C-003 pass** — kubelet events cite
      `Get "http://<pod-ip>:9090/healthz": dial tcp ... connect:
      connection refused`; chart's `PORT` env injection + probe
      port-targeting is the enforcement edge.
  Each failure leaves a cleanly-uninstallable failed release; no
  generic platform crash, no orphan resources after
  `helm uninstall`.

**Checkpoint:** SC-002 second half evidenced 2026-05-17
(`execution/verification.md` §"Negative-path summary").

---

## Phase 4 — Status flip *(this PR)*

- [x] T040 Amend `spec.md` frontmatter. **Done 2026-05-17.**
  `implementation: in-progress → complete` with the per-phase
  landing note inline; `completed: "2026-05-17"` added.
  `status` is already `approved` (flipped at end of Phase 0,
  2026-05-06) and intentionally not re-flipped — T040's original
  `status: draft → approved` reference is stale from when the spec
  was first authored.
- [x] T041 Delivery record. **Done 2026-05-17.** Inline in the
  `implementation:` frontmatter line plus the full transcript at
  `execution/verification.md`, modelling spec 137's
  `execution/rauthy-admin-smoke.md` pattern. No separate
  `delivery-record.md` companion — the frontmatter note + the
  verification artifact carry the same information.
- [x] T042 Spec-code coupling gate. **Done 2026-05-17.** The PR
  that flips the lifecycle also adds
  `.github/workflows/cd-tenant-hello.yml` +
  `.github/workflows/ci-tenant-hello.yml` (registered under
  `implements:` in the same edit) and the
  `execution/verification.md` evidence file; `make pr-prep`
  reports the coupling gate clean.

**Checkpoint:** spec 136 is closed.

---

## Dependencies & ordering

- T001–T004: complete.
- T005 unblocks T010+ (Principle III: no implementation under draft).
- T010–T015 are mostly parallel (different chart files); T016/T017 wait
  on the chart skeleton.
- T020 depends on T010+ (statecraft needs a chart to point at). T022
  depends on T020.
- Phase 3 depends on a complete Phase 1+2.
- Phase 4 depends on Phase 3 evidence being captured.

## Notes

- Tasks marked `[P]` touch separate files within the chart and can be
  drafted in parallel by one or many hands.
- "Spec evidence" in this project means a file under
  `execution/verification.md` per spec 005-verification-reconciliation-mvp;
  not a separate test framework.
- Avoid skipping T005. The reviewer pass is the lone defence against
  the C-clauses being weakened on contact with chart values.

### Operational gates added post-PR #141

- **PR-time Dockerfile validation** (`.github/workflows/ci-deployd-api-rs.yml`
  `docker-build` job). The Phase 2.b PR #141 introduced an apt-resolver
  regression that only surfaced in the post-merge `cd-deployd-api-rs` run
  (helm install layer failed to install `tar` against bookworm-slim where
  it is already a dpkg-essential). Hotfix landed in PR #142; the
  preventative gate runs `docker buildx build --load` against the same
  context the CD workflow uses, so the next regression of that class
  fails at PR review time instead of after main-merge.
