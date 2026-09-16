---
id: "138-statecraft-create-realised-scaffold"
slug: statecraft-create-realised-scaffold
title: "Statecraft Create — realised scaffold subflow (amendment of 112)"
status: approved
implementation: complete
owner: bart
created: "2026-05-04"
approved: "2026-05-04"
closed: "2026-05-04"
kind: amendment
domain: platform
risk: low
amends: ["112-factory-project-lifecycle"]
depends_on:
  - "112-factory-project-lifecycle"  # factory-project-lifecycle (parent)
  - "108-factory-as-platform-feature"  # factory-as-platform-feature (factory_adapters/manifest shape)
  - "109-factory-pat-and-pubsub-sync"  # factory-pat-and-pubsub-sync (factory_upstream_pats consumed by warmup)
code_aliases: ["STATECRAFT_CREATE_REALISED"]
extends:
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/create.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffoldReadiness.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/templateCache.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/scheduler.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/perRequestScaffold.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/gitInitAndPush.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/moduleCatalog.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.projects.new.tsx }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/charts/statecraft/templates/workspace-pvc.yaml }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/syncPipeline.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/syncWorker.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/translator.test.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/github/repoInit.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/projects-api.server.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/CLAUDE.md }
summary: >
  Spec 112 §5 specified Create at the contract level but left four points
  where the landed implementation diverged from the literal spec text:
  (1) the prebuild profile set is statecraft-owned, not adapter-driven;
  (2) the Create transaction also inserts an `environments` row;
  (3) the form gates on a new `GET /api/projects/scaffold-readiness`
  endpoint; (4) the workspace dir is backed by an RWO PVC. None of these
  contradicts spec 112's design — they refine load-bearing details the
  spec deferred. This amendment captures those refinements so spec 112's
  narrative matches the landed code.
---

# 138 — Statecraft Create — Realised Scaffold Subflow

## 1. Why this amendment

Spec 112 §5 was authored before the absorbed scaffold subflow was
implemented. When the implementation landed (alongside this spec), four
points of drift between the spec narrative and the code surfaced. None
contradicts spec 112's design. Each is a load-bearing detail the spec
deferred to "the production implementation" — now that the production
implementation exists, the spec spine should reflect what it does.

This is an `amends:` (spec 119 protocol), not a supersession. Spec 112
remains the authoritative description of the lifecycle; this spec
clarifies the four points listed below and back-links them.

## 2. The four refinements

### 2.1 Profile set is statecraft-owned (§5.3 row 2)

**Was:** Spec 112 §5.3 row 2 said the prebuild profile set is "declared
… from the adapter manifest §8".

**Is:** The four profiles (`minimal`, `public`, `internal`, `dual`) are
hardcoded in `api/projects/scaffold/moduleCatalog.ts`, mirroring
`template-distributor/src/server.ts:108-232`. They are properties of
the *template repo's* `setup-{app,dual-app}.ts` scripts — not of the
adapter manifest. `pickProfileFromModules(variant, modules)` derives
the chosen profile from the form input.

**Why:** §5.3 row 3 already binds the per-request scaffold to the
template repo's `setup-*.ts` shape (Node-24 only, §10). Profiles are
inherent to that shape; the adapter manifest's `scaffold.profiles` field
is a forward-compat declaration for adapters that may someday point at
a different upstream template repo with a different profile vocabulary.
Today there is one such adapter (`acme-vue-node`) and one such template
repo, so the hardcoded set is the source of truth.

**Manifest §8 status:** unchanged. `scaffold.profiles` remains a
backward-compatible manifest extension declared in spec 112 §8 for
non-template adapters that may land in the future. Statecraft Create
does not consult it in the MVP.

### 2.2 environments row in the Create transaction (§5.2 step 7)

**Was:** Spec 112 §5.2 step 7 listed "rows into `projects` and
`project_repos`".

**Is:** `create.ts` inserts a `kind=development` row in the
`environments` table within the same `db.transaction(...)` block as
`projects`/`project_repos`/`project_members`. Namespace is the
deterministic string `oap-{orgSlug}-{projectSlug}-dev`. The audit log
metadata and the API response carry `devEnvironmentId`.

**Why:** Without this insert, `POST /api/projects/:id/factory/deploy`
and the PR webhook's `findOrCreatePreviewEnv` path would diverge — one
expects an existing env row, the other lazy-creates. The insert puts
both paths on the same target row from project birth. No actual K8s
namespace is created at Create time; it materialises lazily on first
deploy via deployd-api. **This does not relax spec 112 §11's deployd-api
non-goal** — only the row is provisioned, the dispatch envelope and
deploy gate remain in a follow-up spec.

### 2.3 Scaffold-readiness endpoint contract (new §5.1.1)

**New:** `GET /api/projects/scaffold-readiness` — public, auth-required,
read-only. The Create form's loader fetches it alongside the adapter
list to gate the submit button and render an actionable banner.

```json
{
  "ready": boolean,
  "step": "idle" | "cloning" | "cache-installing" |
          "building-minimal" | "building-public" |
          "building-internal" | "building-dual" |
          "ready" | "error",
  "progress": 0,                   // integer 0-100
  "error": string | null,
  "hasFactoryAdapter": boolean,    // org has at least one factory_adapters row
  "hasUpstreamPat": boolean,       // org has factory_upstream_pats configured
  "canCreate": boolean,            // = ready && hasFactoryAdapter && hasUpstreamPat
  "blocker": "warming-up" | "warmup-error" |
             "no-factory-adapter" | "no-upstream-pat" | null
}
```

`canCreate` is the AND of warmup readiness, adapter presence, and PAT
presence. `blocker` is the first-missing precondition in resolution
order (`no-factory-adapter` → `no-upstream-pat` → `warmup-error` →
`warming-up`); the UI uses it to drive banner copy without having to
re-derive priority.

**Why governed-state:** without this endpoint, the only signal the form
had was a 200ms `APIError.failedPrecondition` from `create.ts` after
submit — which the React Router action handler then translated to "an
internal error occurred" because Encore wraps non-public messages.
Surfacing readiness server-side at load time means the form disables
submit pre-emptively with a typed banner, and the user sees the cause
before clicking.

### 2.4 Workspace PVC backs ${STATECRAFT_WORKSPACE_DIR} (§5.3 deployment note)

**Was:** Spec 112 §5.3 said warmup runs at startup; storage backing
was unspecified.

**Is:** `platform/charts/statecraft/templates/workspace-pvc.yaml`
declares a `ReadWriteOnce` PVC sized 10Gi mounted at the path in
`${STATECRAFT_WORKSPACE_DIR}` (default `/var/statecraft/workspace`).
`workspace.persistence.enabled` (default true) toggles between PVC and
emptyDir; `workspace.persistence.storageClass` (default `""` →
cluster-default) lets per-cloud values files override.

The chart fails at `helm install/upgrade` time when
`replicaCount > 1` while persistence is enabled — RWO is incompatible
with horizontal scaling. The error message points at the two valid
fixes (pin replicas to 1, or disable persistence).

**Why explicit:** the prior `readOnlyRootFilesystem: true` pod posture
made the lack of a writable workspace mount a silent failure mode —
warmup would attempt to clone into an unwritable path and fail in a
hard-to-diagnose way. Declaring the PVC contract in the spec makes the
storage-class decision a deliberate operator choice, not an accident.

## 3. What does NOT change

Spec 112's overall design is unchanged:

- Three entry points (Open / Create / Import) — unchanged.
- ACP-conformant `.factory/pipeline-state.json` as the canonical state
  marker — unchanged.
- "Birth on statecraft, life on OPC" boundary — unchanged.
- §10 Create-eligibility gate (Node-24 only) — unchanged; still enforced
  via a `manifest.scaffold.runtime` check in `create.ts` that passes
  when the field is absent or `"node-24"` and rejects anything else
  with `APIError.failedPrecondition`.
- §11 deployd-api terminal stage — still non-goal. The environments-row
  insert (§2.2 above) is a precursor, not the deploy itself.

## 4. Risks and follow-ups

- **Multi-tenant cache.** §2.4's PVC stores the cache + four prebuilts
  for one set of `(templateRemote, branch, PAT)`. Multi-org deployments
  with different upstream templates are not supported; the warmup
  resolver picks the first eligible org. Future work: per-org subdirs
  keyed by `factory_adapters.source_sha`.

- **Profile-set widening.** §2.1 hardcodes the four profiles. Adapters
  built against non-template upstreams (a hypothetical Next.js or
  Rust-axum template) would need either a new code path or genuine
  consultation of `manifest.scaffold.profiles`. Today's single-adapter
  reality means no urgency; spec 112 §8 keeps the door open.

- **Phase 7 environments-row reclaim.** If the Create transaction
  succeeds but the user later deletes the project, the env row needs
  cascade behaviour. Out of scope here; tracked under spec 119's
  project lifecycle.

## 5. Audit trail

- 2026-06-11 — module-catalog cutover (spec 199 FR-007 hygiene). The
  `moduleCatalog.ts` this spec's Create surface consumes — and the web
  form's inline mirror in `app.projects.new.tsx` — stop describing the
  retired template-distributor catalog (10 entries incl.
  express-session-era `session-store-*` and module-shaped `auth-*` ids)
  and mirror template's real `modules/` directory: `security-core`,
  `api-gateway` (requires security-core), `data-postgres`, `data-redis`,
  `user-management`, with manifest-truthful descriptions. Two
  template facts reshape the helpers: profiles select AUTH_DRIVER
  (auth is not a module) and no module ships by default — so
  `PROFILE_MODULES`/`PRESETS` are empty by design, `detectProfile` (which
  keyed on the retired `auth-*` ids) is removed, and
  `pickProfileFromModules` maps variants only, falling back to `minimal`.
  Previously, a Create selecting a phantom module failed at
  `add-module.ts` (`Module "<id>" not found at <path>`); operator-observed
  2026-06-11
  during spec 199 AC-2/AC-3 verification.
- 2026-05-04 — implementation lands (Phase 1-7 of the brief at
  `specs/138-statecraft-create-realised-scaffold/`).
- 2026-05-04 — this amendment lands; spec 112 frontmatter records
  `amended: "2026-05-04"` / `amendment_record: "138-statecraft-create-realised-scaffold"`.
- 2026-05-04 — post-deploy fix-up: scheduler now reports a precise
  blocker when warmup context is unresolvable (no adapters, stale
  manifest with no `template_remote`, no upstream PAT) instead of
  silently leaving the readiness endpoint at `step: idle (0%)`. The
  syncWorker triggers `runScaffoldWarmup` immediately on
  `factory.upstreams.sync_ok` so existing adapter rows that pre-date
  the spec 138 §2.1 translator change unlock the Create form within
  seconds of the next /factory-sync, not on the 30-min cron tick.
  Readiness response gains `hasTemplateRemote` and a new
  `stale-adapter-manifest` blocker; the UI banner points at
  `/app/factory` for the manual sync trigger.
- 2026-05-04 — second post-deploy fix-up: npm subprocess env routes
  through writable workspace paths. The container runs as uid 10001
  with no `$HOME` on a `readOnlyRootFilesystem: true` pod, so npm's
  default `$HOME/.npm` resolves to `/.npm` and `mkdir` returns
  ENOENT/EROFS — `npm install` against the cloned template fails
  immediately. `templateCache.tooledEnv()` now stamps `HOME`,
  `npm_config_cache`, and `XDG_CACHE_HOME` at `${STATECRAFT_WORKSPACE_DIR}`
  subdirs (`.home`, `.npm-cache`, `.xdg-cache`) created on first
  warmup. `perRequestScaffold` mirrors the env so per-request
  add-module + lockfile refresh hit the same writable cache.
