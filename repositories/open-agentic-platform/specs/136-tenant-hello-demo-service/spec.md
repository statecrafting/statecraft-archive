---
id: "136-tenant-hello-demo-service"
title: "Tenant-hello — statecraft-deployable tenant reference service"
status: approved
implementation: complete  # Phase 0 (T001–T005) and Phase 1 (T010–T017) landed 2026-05-06; Phase 2 code (T020–T022) landed 2026-05-15. T023 happy path + T030/T031 negative-path passes ran on the Hetzner K3s dev cluster 2026-05-17 against `cd-tenant-hello.yml` workflow_dispatch run 25987117916 (image source = main @ b3c0ddcf). Evidence: `execution/verification.md`. SC-002 both halves evidenced — positive (running pod, /healthz → 200) and negative (three C-clause violation passes each producing a localised failure: read-only-fs mkdir error for C-001, probe HTTP 404 for C-002, probe connection-refused for C-003).
owner: bart
created: "2026-05-04"
approved: "2026-05-06"
completed: "2026-05-17"
amended: "2026-06-16"
amendment_record: |
  Amended 2026-06-16 by 214-tenant-app-chart-supersession (Stage 2): records
  the partial supersession of the tenant-hello service, chart, and CI/CD
  workflows (declared in 214's supersedes) now that acme-vue-encore is the sole
  tenant shape, and refines the C-004 statelessness clause to "stateless pods;
  durable state lives only in the declared database" (FR-012) so the contract
  matches the real database-backed template shape. The C-001..C-005 contract
  text otherwise stands as the tenant-codebase reference.
kind: platform
domain: platform
risk: low
depends_on:
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (statecraft as the web governance plane)
  - "078-platform-completion-plan"  # platform-completion-plan (the broader platform-finishing context)
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/deploy/chartSelector.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/deploy/chartSelector.test.ts }
# The tenant-hello service, chart, and CI/CD workflows 136 established were
# superseded and removed by spec 214 Stage 2. They move from establishes to
# references (existence-exempt) since they no longer exist in the worktree; the
# spec-compiler's V-022/V-023 forbid non-existent units on establishes/extends/
# supersedes/co_authority (deletion handling is its Tier 2 Segment 3 work). The
# supersession is documented in the amendment callout below and in spec 214.
references:
  - role: superseded-removed
    unit: { kind: directory, path: platform/services/tenant-hello }
  - role: superseded-removed
    unit: { kind: directory, path: platform/charts/tenant-hello }
  - role: superseded-removed
    unit: { kind: file, path: .github/workflows/cd-tenant-hello.yml }
  - role: superseded-removed
    unit: { kind: file, path: .github/workflows/ci-tenant-hello.yml }
extends:
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/helm.rs }
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/k8s.rs }
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/routes.rs }
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/main.rs }
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/Dockerfile }
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: .github/workflows/cd-deployd-api-rs.yml }
  - spec: "073-axiomregent-unification"
    nature: additive
    unit: { kind: file, path: .github/workflows/ci-deployd-api-rs.yml }
summary: >
  Document `platform/services/tenant-hello` as the deliberately-minimal
  reference of what a project codebase looks like when statecraft is
  responsible for deploying it. The express service itself is trivial; the
  spec exists to pin the contract a tenant codebase must honour to round-trip
  through statecraft (containerised entrypoint, health probe, port-from-env,
  no privileged dependencies) and to call out the current gap between
  "tenant codebase exists" and "statecraft can deploy it end-to-end."
---

# Feature Specification: Tenant-hello demo service

**Feature Branch**: `136-tenant-hello-demo-service`
**Created**: 2026-05-04
**Status**: Draft
**Input**: Repurpose the existing `platform/services/tenant-hello` express
service from "an example tenant" into a governed reference: this is the
codebase shape that statecraft deployment is meant to handle, and
tenant-hello is the always-green fixture used to demonstrate (and
regression-test) the tenant-deploy pipeline.

> **Amended by spec 214 (2026-06-16, Stage 2).** The tenant-hello service,
> Helm chart, and `ci-tenant-hello.yml` / `cd-tenant-hello.yml` workflows are
> superseded (partial) by spec 214: the factory's own template scaffold
> (`acme-vue-encore`) is now the reference tenant, so the surface CI proves and
> the surface tenants run are the same artifact. The C-001..C-005 tenant
> codebase contract below remains the authoritative reference; spec 214 FR-012
> refines C-004 (see the note on that clause). The deleted directories live on
> only in git history and in 214's `supersedes:` edges.

## Purpose and charter

`tenant-hello` is an Express 4 service with a `/healthz` probe, a JSON
root, and a single-stage Dockerfile (`platform/services/tenant-hello/Dockerfile`).
It does not have business logic; that is deliberate. Its job in the OAP
tree is to answer one question: **what is the contract a project codebase
must honour for statecraft to take it from "source on disk" to "running
behind the platform's ingress" without bespoke per-tenant work?**

This spec captures that contract and uses tenant-hello as its
canonical-reference fixture.

**Explicitly in scope:**

- The shape any tenant codebase must present so statecraft + deployd-api
  can deploy it (containerisation contract, health/readiness contract,
  environment contract).
- Pinning tenant-hello as the always-green reference fixture for that
  contract — i.e. if statecraft deployment of tenant-hello is broken,
  the tenant-deploy pipeline is broken.

**Explicitly out of scope:**

- Tenant-hello-specific business behaviour (there is none, by design).
- The statecraft-side deployment UI / UX — covered by spec 087 and the
  factory-as-platform-feature thread (spec 108).
- Multi-service tenant codebases (tenant-hello stands in for the
  single-service shape; multi-service is a future expansion, not this
  spec).

## Current state vs intent

**Current state (2026-05-04):**

- `platform/services/tenant-hello/src/index.js` exists and serves the two
  routes documented above.
- `platform/services/tenant-hello/Dockerfile` builds a runnable image
  (`node:20-alpine` base, port 8080 exposed).
- There is **no** Helm chart for tenant-hello in `platform/charts/`
  (charts are present only for `statecraft`, `deployd-api`, and `rauthy`).
- `deployd-api-rs` (`platform/services/deployd-api-rs/`) is the
  rust-axum K8s deployment orchestrator that would be responsible for
  applying a tenant chart through statecraft.

**Intent (this spec's aspiration):**

The end-to-end loop *from a statecraft user clicking "deploy" on a project
that points at this codebase, to a running pod responding on the cluster*
must work without per-tenant scaffolding. tenant-hello's role is to be
the smallest codebase that exercises that loop end-to-end.

The gap between current state and intent — namely, the missing
`platform/charts/tenant-hello/` Helm chart and the
statecraft-side wiring that selects a chart per tenant — is real and is
declared as the implementation-in-progress surface of this spec.

## Tenant codebase contract *(normative)*

Any tenant codebase that wants to deploy through statecraft MUST present:

- **C-001 (containerised entrypoint):** A `Dockerfile` at the codebase
  root that produces a runnable image with no privileged build steps.
  Multi-stage builds are allowed; the final image MUST run as a
  non-root user-by-policy (deferred to `platform/charts/` baseline values
  rather than enforced by tenant-hello itself).
- **C-002 (health probe):** An HTTP `GET /healthz` endpoint that returns
  HTTP 200 and a non-empty body when the service is ready to handle
  traffic. Used by the platform's k8s readiness probe.
- **C-003 (port from environment):** The service MUST bind to the port
  specified by the `PORT` environment variable. A documented default
  (tenant-hello uses `8080`) is fine for local development; the platform
  injects `PORT` at deploy time.
- **C-004 (stateless or externalised state):** The service image MUST be
  treated as ephemeral. Any persistent state lives in
  platform-managed backing services (PostgreSQL / object store /
  rauthy session store), not on the pod's local disk.
  *(Refined by spec 214 FR-012, 2026-06-16: stateless pods; durable state
  lives only in the declared database. The real template shape is
  database-backed, so the honest contract is statelessness at the pod, not
  the absence of a database.)*
- **C-005 (declared dependencies):** Every runtime dependency must be
  installable via the codebase's package manifest (`package.json`,
  `Cargo.toml`, `pyproject.toml`, etc.). Vendored binaries and out-of-band
  install steps fall outside this spec's reference.

tenant-hello satisfies C-001, C-002, C-003, and C-004 today; C-005
trivially holds since it has only one dependency (`express`).

## Functional Requirements *(MVP)*

- **FR-001:** `platform/services/tenant-hello/` MUST remain present as
  the canonical reference of the C-001…C-005 contract. Removing it
  requires either superseding this spec or providing a replacement
  reference fixture.
- **FR-002:** The service MUST expose `/healthz` returning 200 with a
  non-empty body and a JSON root response identifying itself, so the
  pipeline can assert "request reached the pod" deterministically.
- **FR-003:** The service MUST honour the `PORT` env var with a documented
  default for local dev, matching the contract's C-003 requirement.
- **FR-004:** A future deliverable in this spec's implementation plan is
  the `platform/charts/tenant-hello/` Helm chart and the statecraft-side
  wiring needed to deploy a project bound to this reference. Until that
  ships, `implementation: in-progress` is honest.
- **FR-005:** The `oap.spec` field in
  `platform/services/tenant-hello/package.json` MUST point at this spec
  (`136-tenant-hello-demo-service`), so the codebase-indexer's spec/code
  coupling sees tenant-hello as governed code, not orphaned.

## Success Criteria

- **SC-001:** A reader of this spec can identify the C-001…C-005 contract
  any tenant codebase must honour without reading any other spec.
- **SC-002:** When the statecraft tenant-deploy loop ships (FR-004),
  invoking it against `platform/services/tenant-hello/` deploys a running
  pod whose `/healthz` returns 200 — and the same pipeline run against a
  codebase that *violates* one of C-001…C-005 fails with a localised
  error, not a generic platform crash.
- **SC-003:** `codebase-indexer compile` lists
  `platform/services/tenant-hello` against this spec under Layer 2
  traceability (no longer in the untraced/orphaned columns).

## Clarifications

### Session 2026-05-04

- The user-stated framing for this spec is *"what statecraft deployment
  should enable us to perform when it comes to the codebase of the
  project."* tenant-hello is therefore not a feature in its own right;
  it is the smallest possible witness of the platform's tenant-deploy
  obligation. The contract section (C-001…C-005) is the actual content;
  the express service is the fixture.
- This spec is filed as `draft` rather than `approved` because the
  contract clauses (C-001…C-005) are first authoring and benefit from
  one reviewer pass before lock-in. The fixture itself is unchanged.

### Session 2026-07-09: deployd-api builder/runtime glibc parity

- The `platform/services/deployd-api-rs/Dockerfile` this spec extends is a
  two-stage build: a `rust:*` builder and a `debian:bookworm-slim` runtime.
  These two images MUST share a compatible glibc. A binary linked against a
  newer glibc than the runtime provides fails at container start with
  `libc.so.6: version 'GLIBC_2.xx' not found` and the pod enters
  CrashLoopBackOff. This is a runtime failure the Docker build and CI cannot
  catch; it only surfaces at deploy time (`deploy-hetzner`).
- Concretely: the bare `rust:1.95` tag tracks Debian Trixie (glibc 2.41),
  while `bookworm-slim` is glibc 2.36. The builder is therefore pinned to
  `rust:1.95-bookworm`, not `rust:1.95`. When #558 bumped the builder
  `1.88 -> 1.95` for the hiqlite 0.14 MSRV it silently moved the builder base
  OS from Bookworm to Trixie and broke this parity (the `1.88` tag was still
  Bookworm-based, which is why the deploy had been green). **When bumping the
  builder Rust version or the runtime base image, keep both on the same
  Debian release (or an older builder glibc than the runtime).**
