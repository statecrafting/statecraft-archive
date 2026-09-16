---
id: "214-tenant-app-chart-supersession"
title: "Tenant App Chart Supersession (template scaffold becomes the reference tenant)"
feature_branch: "feat/214-tenant-app-chart-supersession"
status: approved
implementation: complete  # Stage 1 (additive acme-vue-encore deploy path) landed via #365; Stage 2 (tenant-hello retirement) landed 2026-06-16: chart-registry cutover to the sole acme-vue-encore shape, deployd default flip, ci.yml/ci-tenant-app.yml rewire, specs 136/137 amended; all locally-verifiable gates green (coupling, spec-lint, deployd cargo 35 tests + clippy, statecraft tsc + vitest, helm lint + renders, FR-011 gate-seam parity proven in Stage 1, featuregraph golden). DEFERRED (deploy-time / operational, not resolvable in-repo): FR-010's cd-tenant-app.yml reference-image build is workflow_dispatch-gated and fails loud until the cross-repo template source (vars.TENANT_APP_TEMPLATE_REPO/REF + read token) is wired; SC-001/SC-003/SC-005 need a live cluster (TLS endpoint, DB write round-trip, private-image pull) per the plan's Verification split.
kind: platform
domain: platform
created: "2026-06-12"
authors: ["open-agentic-platform"]
language: en
summary: >
  Supersede tenant-hello as the platform's reference tenant: the canonical
  deployable shape becomes the factory's own template scaffold
  (acme-vue-encore), so the surface CI proves and the surface tenants run
  are the same artifact. Today the chart registry has exactly one synthetic
  shape, the dispatch wire cannot carry application config, a pull secret,
  or the stored namespace, and an Encore.ts app deployed as-is would have
  no runtime infra config and no database. This spec adds the
  acme-vue-encore chart (single image serving the Encore API and bundled
  SPA, ConfigMap-mounted runtime config, opt-in preview-grade Postgres),
  extends the deployd dispatch contract (config_refs semantics,
  image_pull_secret_name, namespace forwarding), locks the tenant hostname
  convention as a single DNS label under tenants.{base}, ports the spec
  137 access-gate seam to the new chart with identical semantics, and
  retires the tenant-hello service, chart, and workflows once render
  parity on the gate seam is proven. The 2026-06-12 dual_stack manifest
  skew is the motivating incident: two surfaces that only meet at runtime
  drift; spec 212 closed that for the manifest contract, this spec closes
  it for the deploy path.
code_aliases: ["TENANT_APP_CHART_SUPERSESSION"]
depends_on:
  - "136-tenant-hello-demo-service"
  - "137-tenant-environment-access-gates"
  - "138-statecraft-create-realised-scaffold"
  - "119-project-as-unit-of-governance"
  - "199-factory-thin-consumer-sync"
amends: ["136-tenant-hello-demo-service", "137-tenant-environment-access-gates", "213-tenant-repo-image-build", "151-declarative-cluster-reconciliation"]
# Supersession of spec 136's tenant-hello units is recorded under references
# (role: superseded-removed) rather than as `supersedes:` units: this PR deletes
# those paths, and the spec-compiler's V-022/V-023 require relationship units in
# establishes/extends/supersedes/co_authority to exist in the worktree (deletion
# and rename handling is the spec-compiler's Tier 2 Segment 3 work). The partial
# supersession of 136 is documented in 136's amendment callout, this spec's User
# Story 4 / FR-011, and the `amends: 136` edge above.
extends:
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/deploy/chartSelector.ts }
  # The chartSelector test gains the acme-vue-encore listShapes case alongside
  # the selector change; claimed additively so this path carries a 214
  # authority (spec 160's full-id migration now resolves the test's authority).
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/deploy/chartSelector.test.ts }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/helm.rs }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/routes.rs }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/store.rs }
  - spec: "077-statecraft-factory-api"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/deploy/deploy.ts }
  # The spec-177 orchestrator gains a route dispatching the new ci-tenant-app
  # job (spec 191 / 211 precedent: a new CI job additively extends ci.yml).
  - spec: "177-ci-orchestrator-pr-gate"
    nature: additive
    unit: { kind: file, path: .github/workflows/ci.yml }
  # Same precedent as specs 202, 196, 194, 193, 187, 183: a new spec adds a
  # row to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  # Stage 2 SC-002 doc scrub: 214 co-authors the "Chart selection and deploy
  # wire contract" section of statecraft's CLAUDE.md (the sole-shape reality
  # after the tenant-hello retirement), additively extending 138's file claim
  # the same way 138/140 extend it.
  - spec: "138-statecraft-create-realised-scaffold"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/CLAUDE.md }
establishes:
  # Converted from references:planned-establishes as the implementation landed
  # these paths (spec 200 precedent). The deployResolve.* helpers and the
  # ghcr-pull reflector secret are net-new in Stage 1; cd-tenant-app.yml is
  # net-new in Stage 2 (the build+push workflow).
  - unit: { kind: file, path: .github/workflows/cd-tenant-app.yml }
  - unit: { kind: directory, path: platform/charts/acme-vue-encore }
  - unit: { kind: file, path: platform/services/statecraft/api/deploy/hostname.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/deploy/hostname.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/deploy/deployResolve.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/deploy/deployResolve.test.ts }
  - unit: { kind: file, path: .github/workflows/ci-tenant-app.yml }
  - unit: { kind: file, path: platform/infra/hetzner/manifests/ghcr-pull-secret.yaml }
references:
  # cd-tenant-app.yml graduated to establishes (Stage 2). The tenant-hello
  # service, chart, and CI/CD workflows that 136 established are superseded and
  # removed by this PR; recorded here as existence-exempt references (the units
  # no longer exist in the worktree) rather than `supersedes:` units. See the
  # note above the `extends:` block.
  - role: superseded-removed
    unit: { kind: directory, path: platform/services/tenant-hello }
  - role: superseded-removed
    unit: { kind: directory, path: platform/charts/tenant-hello }
  - role: superseded-removed
    unit: { kind: file, path: .github/workflows/ci-tenant-hello.yml }
  - role: superseded-removed
    unit: { kind: file, path: .github/workflows/cd-tenant-hello.yml }
  - role: scaffold-fixture-source
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/templateCache.ts }
  - role: variant-model-authority
    unit: { kind: crate, id: factory-contracts }
  - role: wildcard-tls-surface
    unit: { kind: file, path: platform/infra/hetzner/manifests/tenants-wildcard-certificate.yaml }
  - role: clarification-resolved
    unit: { kind: file, path: specs/137-tenant-environment-access-gates/spec.md }
  - role: lockstep-philosophy-precedent
    unit: { kind: file, path: specs/212-factory-schema-lockstep-ci/spec.md }
---

# Feature Specification: Tenant App Chart Supersession

**Feature Branch**: `214-tenant-app-chart-supersession`
**Created**: 2026-06-12
**Status**: Draft (second of the three deploy-path specs; siblings are 213
tenant-repo-image-build and 215 statecraft-deploy-trigger-ux)
**Input**: The 2026-06-12 deploy-path survey plus user direction of the
same day: rather than adding the acme-vue-encore chart alongside
tenant-hello and maintaining two tenant shapes forever, supersede
tenant-hello so the reference tenant IS the template scaffold,
"retro-fitting what's needed into what is" and eliminating the
two-surface drift class demonstrated that morning by the `dual_stack`
manifest skew (an installed OPC binary parsing yesterday's schema against
a manifest synced from today's upstream).

## Purpose

Spec 136 proved the mechanism with a synthetic stateless hello image:
helm-over-deployd, ingress, idempotent dispatch. Spec 137 layered
per-environment OIDC gates onto it. That value is realised; what remains
of tenant-hello is liability: every dispatch-contract addition would have
to be wired into the hello chart and then re-wired into the real shape,
and CI would keep proving a shape no tenant runs. Spec 212 made
manifest-contract lockstep a CI property between the factory repos; this
spec extends the same philosophy to the deploy path by making the
deployable reference and the factory output the same artifact.

A real factory-produced app (acme-vue-encore: Encore.ts API on port 4000,
Vue SPA bundled into the same image via `bundle_source: true`) needs four
things the mechanism does not yet provide: a chart for its shape, runtime
configuration reaching the pod, a database, and a hostname that the
platform (not the caller) decides. This spec supplies those, ports the
gate seam, and retires the synthetic tenant. It deliberately changes no
UI (spec 215) and assumes tenant-repo images already exist (spec 213; the
CI fixture of FR-010 covers this spec's own verification needs).

## Code reality (2026-06-12 survey)

- Charts are compiled into deployd-api via `include_str!` and materialised
  to a temp dir before `helm upgrade --install --wait` (`helm.rs:36-68`,
  `162-218`). Adding a chart means: files under `platform/charts/`,
  embedding in `helm.rs`, and a `CHART_REGISTRY` entry in
  `chartSelector.ts` (today exactly one entry, `tenant-hello`,
  `chartSelector.ts:43-45`).
- The dispatch wire (`POST /v1/deployments`, `routes.rs:21-47`) carries
  `desired_routes` (caller-invented hosts), optional `chart`, and the spec
  137 `access_gate`; statecraft's proxy (`deploy.ts:193`) already
  validates a `config_refs: Record<string, string>` field
  (`deploy.ts:37,113-116`) that nothing downstream consumes.
- Namespace is computed as `{app_id}-{env_id}` and not persisted
  (`routes.rs:175`); spec 119's convention stored on the environment row
  (`oap-{orgSlug}-{projectSlug}-dev`) is dead data.
- TLS is a single-level wildcard (`*.tenants.{base}`) replicated into
  tenant namespaces by kubernetes-reflector (spec 137 co_authority
  surface). A single-level wildcard cannot cover
  `<env>.<project>.<org>.tenants.{base}` (three labels); spec 137's
  clarification 4 sketch is therefore not implementable as written.
- The dual-stack variant model is owned by the adapter manifest contract
  (factory-contracts `adapter_manifest.rs`, realigned to
  `audience_to_variant`/`variants` on 2026-06-12): variants `public`
  (SAML auth, citizen SPA) and `internal` (Entra ID auth, staff SPA),
  each a full app copy.
- The tenant-hello CI surface is light: `ci-tenant-hello.yml` (61 lines:
  docker build without push, `helm lint`, two `helm template` renders)
  and `cd-tenant-hello.yml` (66 lines: build and push to GHCR). No
  live-cluster gate test is bound to them; spec 137's gate verification
  was cluster-side. The hello service itself is a Dockerfile,
  package.json, and src/.
- The platform already materialises template trees: the
  `_prebuilt-{minimal,public,internal,dual}` profile trees built by
  `templateCache.ts` (spec 138 lineage) are the same artifact the Create
  path copies into new tenant repos. The reference fixture of FR-010 is
  built from one of these trees, pinning the fixture to the exact
  template version the scaffold path ships.
- The tenant codebase contract (spec 136 C-001..C-005) requires
  statelessness; the real template is database-backed. The honest
  contract is "stateless pods, durable state only in the database"
  (FR-012).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deploy the scaffolded app and reach it (Priority: P1)

Given an existing image for the scaffolded commit (spec 213, or the
FR-010 fixture in CI), a dispatch through statecraft's deploy proxy
installs the acme-vue-encore chart into the environment's namespace, and
the returned endpoint URL serves the Vue SPA with the Encore API
answering behind it.

**Why this priority**: this is the literal definition of "deploy the
project as-is on deployd-api".

**Independent Test**: POST a deployment for a built scaffold image with
shape `acme-vue-encore`; curl the returned endpoint; the SPA shell loads
(HTTP 200) and the API health endpoint answers.

**Acceptance Scenarios**:

1. **Given** a built `public`-variant image, **When** dispatched with
   shape `acme-vue-encore`, **Then** helm exits 0, the pod passes
   readiness, and `endpoints[0]` serves the app over TLS under
   `tenants.{base}`.
2. **Given** the same dispatch repeated (same `{app_id}|{env_id}|
   {release_sha}`), **Then** the idempotent replay returns the existing
   release without a second install.
3. **Given** `access_gate.enabled: true` on the environment, **Then** the
   oauth2-proxy gate installs atomically alongside, exactly as it did for
   tenant-hello (spec 137 behavior is shape-independent).

### User Story 2 - Runtime config and a database reach the pod (Priority: P1)

The Encore self-hosted runtime receives its infra configuration (database
DSN, secret env names) from the chart, not from the image; preview-grade
environments get a per-namespace Postgres so the scaffold's `apps/api/db`
actually migrates and serves.

**Independent Test**: deploy with `previewDatabase.enabled: true`; the
app's DB-backed endpoint round-trips a write; kill the app pod; it
rejoins without re-provisioning.

**Acceptance Scenarios**:

1. **Given** a dispatch with `config_refs`, **When** the chart renders,
   **Then** each entry lands in the pod environment (or mounted runtime
   config; see FR-003) without a chart edit.
2. **Given** `previewDatabase.enabled: false` and no external DSN
   provided, **Then** the dispatch is rejected up front with a specific
   diagnostic (no crash-looping pod as the failure surface).

### User Story 3 - The platform owns the hostname (Priority: P2)

Statecraft derives the ingress host from org, project, environment, and
variant; the caller never invents one. Toggling the access gate or
redeploying never changes the host (spec 137's stability requirement).

**Independent Test**: derive hosts for a matrix of slugs including
edge-length cases; all are single labels under `tenants.{base}`, RFC-1123
valid, 63 chars or fewer, deterministic.

**Acceptance Scenarios**:

1. **Given** org `acme`, project `my-test-project-1`, env `dev`, variant
   `public`, **Then** the derived host is
   `acme--my-test-project-1--dev.tenants.{base}` and the wildcard cert
   covers it.
2. **Given** the internal variant of the same env, **Then** the host is
   `acme--my-test-project-1--dev--int.tenants.{base}`.
3. **Given** slugs whose joined label would exceed 63 characters, **Then**
   the label is truncated with a stable 6-character hash suffix, and the
   derivation is collision-checked against existing environments.

### User Story 4 - The synthetic tenant retires without regressing the mechanism (Priority: P1)

The access-gate seam, ingress shape, and dispatch semantics that
tenant-hello proved carry over to the superseding chart with identical
behavior; tenant-hello's service, chart, and workflows are removed in the
same landing, after parity is demonstrated, so no second tenant shape
survives to drift.

**Why this priority**: this is the supersession itself; without it the
spec degenerates to the rejected alongside-approach.

**Independent Test**: render parity check (FR-011): `helm template` of
the old chart and the new chart with gate enabled produces equivalent
gate-relevant objects (auth-url/auth-signin annotations, oauth2-proxy
wiring, TLS secret reference); then grep proves no tenant-hello reference
remains in `helm.rs`, `chartSelector.ts`, or workflows.

**Acceptance Scenarios**:

1. **Given** the new chart with `access_gate.enabled: true`, **When**
   rendered against the spec 137 gate fixture values, **Then** the
   Ingress carries the same auth annotations and the gate release wiring
   matches the oauth2-proxy-gate contract unchanged.
2. **Given** the implementing PR, **Then** `platform/services/
   tenant-hello/`, `platform/charts/tenant-hello/`, and both
   tenant-hello workflows are deleted in it, and `CHART_REGISTRY`
   contains `acme-vue-encore` as the sole shape.
3. **Given** the retirement, **Then** spec 136 carries the supersession
   callout and spec 137 carries the gate-anchor amendment, both landing
   in the same PR per the amendment convention.

### Edge Cases

- Image in a private GHCR package: the pod can only pull if
  `image_pull_secret_name` references a secret present in the namespace;
  the platform replicates a `ghcr-pull` secret via kubernetes-reflector
  (same pattern as the wildcard TLS secret).
- Stored `k8sNamespace` disagrees with `{app_id}-{env_id}`: the forwarded
  value wins and is persisted on the deployment row; the computed form
  remains the fallback for callers that omit it (back-compat with the
  existing webhook path until spec 215 migrates it).
- Helm timeout on first install (image pull + migration longer than 5
  minutes): the chart sets a realistic default and the dispatch surfaces
  the helm diagnostic verbatim, as today.

  *Amendment (helm wait timeout vs the dispatch fetch, 2026-06-30).* The
  deployd helm runner's default `--wait` timeout (`helm.rs::HelmRunner::
  from_env`) drops from `5m` to `3m`. Rationale: `create_deployment` holds
  the dispatch HTTP connection open for the whole `helm upgrade --install
  --wait`, and statecraft's fetch inherits undici's 300s headers timeout.
  At the old `5m` default those windows were equal, so a deploy that helm
  would report as FAILED (a tenant image stuck in ImagePullBackOff that
  never becomes Ready) raced statecraft's timeout and could surface as an
  opaque REQUEST_FAILED instead of the helm diagnostic this edge case
  promises "verbatim, as today". A `3m` default keeps deployd inside the
  fetch window so its FAILED + helm stderr wins. `DEPLOYD_HELM_TIMEOUT`
  still overrides for operators with genuinely slower rollouts. See spec
  215's matching edge-case amendment for the statecraft-side diagnostic.
- Dual-profile project: each variant is its own deployable unit (own
  image, own release, own host); a single dispatch never installs both.
- In-flight tenant-hello deployments at cutover: existing helm releases
  keep running (deployd-api records are inert strings); only NEW
  dispatches require the new shape. A `tenant-hello`-shaped dispatch
  after cutover fails with the chart-registry "unknown shape" diagnostic.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: New chart `platform/charts/acme-vue-encore/`: Deployment
  (one container, port 4000, liveness/readiness probes, non-root,
  `readOnlyRootFilesystem` with writable `/tmp`, resource requests and
  limits), Service, per-release ServiceAccount, Ingress gated on
  `desired_routes` with the spec 137 access-gate annotation seam
  preserved. The probe path defaults to `/healthz` and is a chart value
  (see Clarification 1).
- **FR-002**: Chart registry cutover: `CHART_REGISTRY` in
  `chartSelector.ts` gains `"acme-vue-encore" -> { chart:
  "acme-vue-encore", version: "0.1.0" }` and drops `"tenant-hello"` in the
  retirement step of the same PR; the new chart's files are embedded in
  `helm.rs` and the tenant-hello embedding is removed. Shape selection at
  dispatch time derives from the project's `factoryAdapterId`; unknown
  shapes (including `tenant-hello` post-cutover) still throw.
- **FR-003**: Runtime config: the chart renders a ConfigMap holding the
  Encore self-hosted infra configuration (database server list, secret
  env mapping) and mounts it into the container, with the path handed to
  the runtime per Encore's self-hosting contract (Clarification 2 pins
  the exact mechanism against Encore's docs; the spec contract is:
  config reaches the runtime via the chart, never baked into the image).
- **FR-004**: `config_refs` semantics (giving the existing dead field its
  meaning): each `{name: value}` entry becomes a container env var via
  the chart's `extraEnv`. Reserved prefixes (`ENCORE_`, `KUBERNETES_`)
  are rejected at the proxy with a field-specific diagnostic. Secrets do
  NOT travel through `config_refs` (values are stored on the deployment
  record); secret material arrives only as named K8s secret references
  (FR-005 pattern).
- **FR-005**: New optional dispatch field `image_pull_secret_name`
  (request + `build_values` + chart wiring). Platform side: a `ghcr-pull`
  dockerconfigjson secret is replicated into tenant namespaces via
  kubernetes-reflector annotations, mirroring the wildcard-TLS pattern;
  the default value of the new field is `ghcr-pull`.

  *Completion (deferred SC-005 wiring, 2026-07-01).* At 214 close the
  reflector source manifest `manifests/ghcr-pull-secret.yaml` existed but
  the setup.sh step that materialises it was never added, so on the live
  cluster the `kube-system/ghcr-pull` source secret was absent and every
  tenant pod sat in ImagePullBackOff (an unauthenticated pull of a private
  GHCR image returns `NotFound`, since GHCR masks private packages, which
  reads as a missing image). Two fixes: (1) setup.sh now builds the base64
  dockerconfigjson from `GHCR_PAT` and `sed`-substitutes it into the manifest
  before `kubectl apply` (matching how every other credential secret is
  materialised, so no `envsubst` dependency); (2) the manifest's
  `.dockerconfigjson` moved from `stringData` (which could not safely hold the
  raw JSON inside a quoted scalar) to `data` with the base64 value. Reflector
  then auto-clones `ghcr-pull` into every namespace, existing and future.
- **FR-006**: Preview-grade database: chart value `previewDatabase`
  (enabled, storage size, image) renders a single-replica Postgres
  StatefulSet + Service + generated-credentials Secret in the same
  namespace, and threads its DSN into FR-003's runtime config. Explicitly
  preview-grade: no HA, no backups, PVC small by default. Production
  database provisioning is out of scope (named deferral, see §Out of
  scope). When `previewDatabase.enabled: false`, an external DSN MUST be
  supplied via a named secret ref or the proxy rejects the dispatch
  (User Story 2, scenario 2).

  *Completion (trigger auto-provisioning + dispatch, 2026-07-01).* The chart
  and its `previewDatabase` block shipped, but nothing ever set
  `previewDatabase.enabled`, so a UI-triggered deploy of the acme-vue-encore
  scaffold (an Encore app with a `SQLDatabase`) came up with no database and
  crash-looped on `unable to initialize sqldb proxy: failed to resolve
  password: environment variable not found`. Wired end to end: (1) deployd-api
  `DeployExtras.preview_database` + `DeploymentRequest.preview_database` render
  `previewDatabase.enabled: true` in `build_values`; (2) statecraft's UI trigger
  (`buildTriggerDeploydBody`) sets `preview_database: true` for `development`
  and `preview` environments so an Encore tenant boots self-contained, and
  **rejects** `staging`/`production` deploys (which need an external DSN the
  trigger does not model yet) rather than dispatching a DB-less app, satisfying
  this FR's reject-when-no-DB requirement for the trigger path. The raw
  `/v1/deployments` proxy is unchanged (external callers manage their own DB);
  an external-DSN dispatch field is a follow-up.
- **FR-007**: Hostname convention (normative, resolves spec 137
  §Clarification 4): host label `{orgSlug}--{projectSlug}--{envSlug}`
  with `--int` appended for the internal variant, under `tenants.{base}`.
  Single label by construction (the single-level wildcard certificate is
  the binding constraint, which is why 137's multi-label sketch is
  rejected). Implemented once in
  `platform/services/statecraft/api/deploy/hostname.ts` with the 63-char
  truncate-plus-hash rule; `deploy.ts` derives `desired_routes` from it
  when the caller supplies none. Landing this FR amends spec 137
  (clarification); the amendment callout and `amended:` frontmatter on
  137 land with the implementing PR, per the amendment convention.
- **FR-008**: Namespace forwarding: new optional dispatch field
  `namespace`; statecraft forwards `environments.k8sNamespace`;
  deployd-api uses it when present (fallback: computed
  `{app_id}-{env_id}`) and persists the effective namespace on the
  deployment row (`store.rs` migration) so DELETE and status operate on
  recorded truth rather than recomputation.
- **FR-009**: Variant as deploy unit: the dispatch deploys exactly one
  variant; `app_slug` carries `{projectSlug}-{variant}` so helm release
  names and gate releases stay disjoint between variants of the same
  environment. The default variant for preview/development environments
  is `public`.
- **FR-010**: Reference fixture: new workflows `ci-tenant-app.yml`
  (build the fixture image without push; `helm lint` plus `helm
  template` renders of the new chart, default and gate-enabled) and
  `cd-tenant-app.yml` (build and push the reference image to GHCR),
  replacing the two tenant-hello workflows. The fixture tree is a
  materialised template profile from the same template version
  `templateCache.ts` pins for the scaffold path, so template upgrades
  and deploy-path verification move in lockstep (Clarification 4 decides
  the materialisation mode).
- **FR-011**: Supersession with parity evidence: before the retirement
  lands, a render-parity check MUST demonstrate the gate seam carries
  over: `helm template` of tenant-hello and of acme-vue-encore against
  the spec 137 gate fixture values produce equivalent gate-relevant
  output (auth-url/auth-signin annotations, gate release wiring, TLS
  secret reference). The implementing PR then deletes
  `platform/services/tenant-hello/`, `platform/charts/tenant-hello/`,
  `ci-tenant-hello.yml`, and `cd-tenant-hello.yml`, removes the
  tenant-hello chart embedding from `helm.rs`, and records the
  supersession callout on spec 136 plus the gate-anchor amendment on
  spec 137 (its `co_authority` units move from the tenant-hello chart
  files to the acme-vue-encore equivalents).
- **FR-012**: Tenant contract refinement: spec 136's statelessness
  requirement is refined to "stateless pods; durable state lives only in
  the declared database" so the contract matches the real template
  shape. The refinement is recorded as an amendment to spec 136's
  contract section in the implementing PR (amendment kind:
  clarification).

### Key Entities

- **acme-vue-encore chart**: the Helm shape for factory-produced
  Encore + Vue apps; the sole entry in the chart registry after cutover.
- **Reference fixture**: a materialised template profile tree
  built in CI; the deployable artifact that proves the chart against the
  exact template version the scaffold path ships.
- **Dispatch contract additions**: `config_refs` (env injection),
  `image_pull_secret_name`, `namespace`; all optional.
- **Tenant hostname**: a derived, stable, single-label FQDN owned by
  `hostname.ts`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A built scaffold image deploys to a green helm release and
  a TLS endpoint serving the SPA + API, with zero manual K8s or DNS
  steps.
- **SC-002**: Gate-seam render parity is demonstrated (FR-011 check
  green) and the retirement is total: post-merge, `grep -rn
  "tenant-hello"` over `platform/` and `.github/workflows/` returns only
  historical spec text and deployd-api DB fixtures, and CI has no
  tenant-hello jobs.
- **SC-003**: A DB-backed scaffold endpoint round-trips a write in a
  preview environment provisioned solely by the chart.
- **SC-004**: 100 random slug triples produce valid, collision-free,
  cert-covered hostnames (property test on `hostname.ts`).
- **SC-005**: Private-image deploys succeed in a fresh namespace with no
  per-namespace manual secret creation.
- **SC-006**: A template version bump that changes the app's
  deploy-relevant shape (port, health path, build output) fails
  `ci-tenant-app.yml` before any tenant deploy can hit it (the lockstep
  property, extending the spec 212 philosophy to the deploy path).

## Out of scope

- Production-grade database provisioning (HA Postgres, backups, restore
  drills): named deferral; candidate follow-up spec, and a prerequisite
  for promoting beyond preview/development environments.
- The deploy trigger, UI, and deployment records in statecraft: spec 215.
- Image production for tenant repos and the ref convention: spec 213.
- Per-adapter chart generation from adapter manifests (a chart per
  arbitrary future adapter): this spec hand-authors one chart for the
  one active adapter; generalisation waits for a second real shape.
- Multi-cluster placement, non-nginx ingress classes, non-GHCR
  registries.
- Migration of historical tenant-hello deployment records in deployd-api
  (inert strings; left as-is).

## Dependencies and sequencing

Independent of spec 213 (the FR-010 fixture covers this spec's own image
needs); both are prerequisites of spec 215. Touches deployd-api
request/store surfaces that specs 136/137/145 share; the `gate-overlay`
co-authority sections in `helm.rs`/`routes.rs` are preserved by FR-001/
FR-011 by construction, and spec 137's chart-file anchors are relocated
by amendment, not rewritten.

Sequencing note (accepted by design): supersession front-loads the
Encore-runtime unknowns (Clarifications 1 and 2) onto the critical path
of the whole deploy story, including the gate seam that works today.
That is the point: those unknowns must be resolved for the product to
exist at all, and discovering them on the reference fixture is cheaper
than discovering them on a tenant's first deploy.

## Clarifications

1. **Health endpoint of the scaffolded app**: the tenant contract (spec
   136 C-002) requires `/healthz`; verify the acme-vue-encore scaffold
   actually serves it (Encore default health surface vs an explicit
   endpoint in template) and pin the chart default accordingly.
2. **Encore self-hosted runtime config mechanism**: pin the exact
   file-path/env-var contract (`encore build docker` runtime config
   consumption) against Encore's self-hosting documentation for the
   build mode in use; cite the doc in the plan (per the established
   external-service-docs discipline). The chart contract in FR-003 is
   mechanism-agnostic on purpose.
3. **`{base}` domain value**: the concrete `tenants.{base}` apex in use
   on the Hetzner cluster is operational config; confirm where it is
   surfaced to statecraft (env var on the deploy service) and that the
   wildcard certificate's SAN matches.
4. **Fixture materialisation mode**: whether the FR-010 fixture tree is
   committed into the monorepo (a realised snapshot, regenerated on
   template bumps) or materialised at CI time from the pinned template
   ref (cross-repo fetch, SHA-pinned per the spec 158 workflow-ref
   discipline). The committed snapshot is simpler and diff-reviewable;
   the CI-time fetch cannot go stale. Decide at plan time.


## Security hardening amendment (2026-07-02)

Hardened the tenant app chart: added a default-deny plus scoped-allow NetworkPolicy, a container securityContext with a non-root user on the preview Postgres, and disabled service-account token automount where the workload does not call the K8s API.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
