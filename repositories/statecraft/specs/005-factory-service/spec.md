---
id: "005-factory-service"
title: "Factory: stamp EnRaHiTu apps into customer orgs"
status: approved
created: "2026-07-14"
implementation: complete
depends_on:
  - "004-tenants-github-app"
establishes:
  - { kind: directory, path: "backend/factory/" }
summary: >
  The factory turns "customer wants an app named X" into a born-green
  repo in the customer's GitHub org: clone the pinned enrahitu template,
  read its template.toml contract (and nothing else), run the scaffold
  verb with the slot values, emit the born-with certificate and anchor it
  in the governance ledger, then land it: create a new repo and push
  (create mode) or open a pull request onto an existing repo (adopt mode),
  and watch the born-with verify workflow until green. Completes milestone
  M2 together with spec 004. The contract boundary is absolute: any
  factory behavior that depends on template internals beyond
  template.toml is a defect.
---

# 005: Factory service

## 1. Cross-repo dependencies (read first)

- enrahitu spec 014 (scaffold verb) and spec 012 (born-with cert) are
  the preferred substrate. If the pinned template's contract version
  is still 0.1.0 (no scaffold verb, no [provenance]), implement the v0
  fallback: factory-side substitution per the recipe in enrahitu spec
  014 §3 (steps 2, 3, 5) and skip cert emission with a logged warning.
  Gate each capability on the contract version actually read, so the
  factory upgrades itself when the template does.

## 2. Territory

`backend/factory/`: an Encore.ts service, under `backend/` per the
chassis convention spec 002 established and spec 008/004 followed (the
thesis's illustrative `factory/` path predates the slimmed layout;
corrected here before coding). Files: `encore.service.ts`, api
endpoints, CoreLedger entities, template cache, stamp pipeline.

## 3. Behavior

- **Template source**: `git@github.com:statecrafting/enrahitu.git`,
  pinned by config to a commit SHA (env `FACTORY_TEMPLATE_REF`,
  default a recorded known-good SHA; never floating main). A warmup
  step keeps a local bare-clone cache under the app's data dir and
  fetches on demand; stamping always exports from the pinned SHA
  (`git archive` semantics: tracked files only, no .git).
- **Contract read**: parse template.toml; enforce
  `[contract].version` within the supported range. The range is the
  major-0 line, `>=0.1.0 <1.0.0`, consistent with §4 (accept 0.1/0.2/0.3,
  reject 1.0); the pinned template is currently 0.5.0 (scaffold verb at
  v0.4, provenance at v0.3), so the earlier `^0.1` shorthand was stale and
  is corrected here before coding. Validate requested slots against
  `[slots]`. Reject stamps whose contract the factory does not support,
  with a precise error.
- **Entities**: `StampJob` (id, tenantId, installationId, appName,
  org, frontend, pages, templateRef, contractVersion, posture, status
  queued|stamping|pushing|verifying|green|failed, checksRunId?,
  certHash?, createdAt, updatedAt, error?). `posture` is persisted on
  the job because step 3 builds the cert from the request's posture and
  the pipeline runs asynchronously (it re-reads the job); added here
  before coding.
- **API** (auth as spec 004): `POST /tenants/:id/stamps` (appName,
  targetOrg, frontend?, posture, mode?, pages?) -> job id; `GET /stamps/:jobId`
  status; `GET /tenants/:id/stamps` list. `posture` is required
  (REQUEST-EXPLICIT, §3 step 3); the API rejects a stamp with no posture
  rather than defaulting it. `mode` is `create` (default) or `adopt`
  (§3.1); an unknown mode is rejected.
- **Pipeline** (async; Encore endpoint kicks it and the job records
  progress; keep it single-flight per job, resumable by status):
  1. Export pinned template to a temp workdir.
  2. Scaffold: run the contract's scaffold verb with slots; or v0
     fallback (§1).
  3. Cert (contract >= 0.2): build the born-with certificate per
     enrahitu spec 012 §3 (posture from the stamp request, default
     REQUEST-EXPLICIT: the API requires the caller to pass posture;
     never default it silently), keysorted-canonical sha256 hash,
     place at `.statecraft/born-with.json`, run the contract's
     provenance verify command, store certHash on the job. Then anchor
     the cert in the governance attestation ledger (spec 008): append a
     `stamp` attestation carrying the certHash and the stamp mode,
     *before* any repo mutation, so the repo-local cert and the platform
     ledger are mutually checkable (enrahitu spec 012 §4) and a stamp
     never lands a repo without its anchor.
  4-5. Land the stamped tree, per the §3.1 mode:
     - **create**: create the repo in the customer org via the
       installation token (POST /orgs/{org}/repos, private by default,
       default branch main) and push the stamped tree as the initial
       commit over https
       (`https://x-access-token:<token>@github.com/<org>/<repo>.git`);
       commit author "statecraft Factory".
     - **adopt**: verify the existing repo, clone its default branch,
       overlay the stamped chassis onto a `factory/adopt-<sha>` branch
       (chassis files land; files unique to the repo are preserved; the
       exported tree has no `.git`, so history is untouched), commit as
       "statecraft Factory", push the branch, and open a pull request
       into the default branch. The PR url is stored on the job.
  6. Verify born-green: poll the repo's workflow runs for the verify
     workflow on the pushed SHA (the initial commit, or the PR head)
     until success or a 30-min timeout; record status green|failed.
- **Idempotency**: re-POSTing the same appName for the same tenant
  while a job is live returns the live job; in create mode a repo-name
  collision fails the job with the GitHub error surfaced, and in adopt
  mode a missing or inaccessible repo fails the job the same way.

### 3.1 Stamp modes: create and adopt

A stamp lands one of two ways, selected by the request's `mode`:

- **create** (default): the app is born from the stamp. The factory
  creates a fresh repo and the stamped tree is its initial commit. This
  is the customer-onboarding path (M2).
- **adopt**: the chassis is stamped onto an *existing* repo. The factory
  clones the repo, overlays the stamped chassis on a
  `factory/adopt-<sha>` branch, and opens a pull request into the default
  branch. The overlay is a union: chassis files are added or overwrite
  same-path files, and files unique to the repo (an app's own crate, its
  CI) are preserved; because the exported template carries no `.git`, the
  repo's history is untouched. The pull-request diff is the reconciliation
  surface a human reviews before merge, and the born-green verify runs on
  the PR head.

**Provenance is identical across modes.** The born-with certificate is
byte-for-byte the same shape with `stampedBy.kind: "factory"` in both,
because the factory genuinely performs the stamp either way, and the
cert's two claims (what it was stamped from, and the agentic posture)
hold whether or not the target repo pre-existed. The create-vs-adopt
distinction is recorded in the governance ledger attestation payload and
on `StampJob.mode`, not by mutating the certificate. Adopt exists so an
existing repo can acquire genuine, factory-attested provenance without
being destroyed and re-created; re-creation (birth via `create`) stays
the higher-fidelity option when a fresh repo is acceptable.

Adopt is a *mode* of the one pinned chassis, not multi-template support
(still out of scope, §5): both modes stamp the same enrahitu template.

## 4. Acceptance

- Unit: contract parsing (accept 0.1/0.2/0.3 fixtures, reject 1.0),
  slot validation (including the frontend flavor default/allowed/reject),
  the frontend flavor round-trip on `StampJob`, job state machine
  transitions, cert hash matches an independently computed keysorted sha256
  fixture, the stamp-mode guard, and the ledger attestation payload shape.
- E2E (manual, documented): **create** stamps `smoke-<date>` into the
  test org from spec 004's installation and the job reaches `green` with
  a green verify run; **adopt** stamps the chassis onto an existing test
  repo and opens a PR whose verify run is green. Both are the M2 core
  loop.
- Spine gates + verify verb green.

COMPLETE 2026-07-15: unit tests cover contract parsing (accept 0.1/0.2/0.3,
reject 1.0), slot validation, the job state machine, and cert-hash equality
with the independently computed golden (byte-identical to the template's own
verify-born-with.mjs); StampJob persistence round-trips on libSQL and
Postgres; spine gates + `verify` green. The pinned template is contract
0.5.0, so the factory takes the scaffold + cert path. The E2E is manual and
documented (backend/factory/README.md, §4): running it live needs a real
installation and the App secrets, and creates a repo in the customer org, so
it is an operator step, not a CI gate. The pipeline's IO layer (git, scaffold,
GitHub) is implemented and typechecks/builds; it is exercised end-to-end only
by that manual run.

AMENDED 2026-07-15 (adopt mode + ledger anchor): added the `adopt` stamp
mode (§3.1) so an existing repo acquires genuine factory provenance via a
pull request instead of being re-created, and wired the born-with cert into
the governance attestation ledger (§3 step 3, previously a deferred soft
dependency; the recorder already carried a `certHash` field for exactly
this). New file `backend/factory/attest.ts` (pure attestation payload +
mode guard); `StampJob` gains `mode` + `prUrl`; the pipeline branches
create vs adopt and anchors every cert before any repo mutation. Unit tests
cover the mode guard, the attestation payload, and the job round-trip of the
new columns; the adopt IO path (clone/overlay/PR) is manual-E2E like
create's. typecheck + vitest + spine gates green.

AMENDED 2026-07-15 (frontend flavor wire-through): the tenant's `frontend`
choice now flows end to end. It was already declared on the create-stamp
request and validated by `validateSlots`, but the API handler dropped it: it
never reached the job or the scaffold verb, so every stamp used the template
default (vue). The handler now reads and normalizes `frontend`, `StampJob`
persists it (new `frontend` column, like `mode`/`prUrl` before it), and the
pipeline passes it into `validateSlots` (authoritative check against
`[slots].frontend.allowed`, enrahitu spec 015) and on to the scaffold verb's
`--frontend`. `StampJobView` exposes it for the status GETs. Unit tests: the
`StampJob` round-trip covers the new column; the `validateSlots` frontend cases
(default, allowed, reject) were already green. typecheck + vitest + spine gates
green.

AMENDED 2026-07-15 (opt-in Pages provisioning): a stamp may request GitHub
Pages on the new repo via `pages?: boolean` (default false; persisted on
`StampJob.pages`). In **create** mode only, a new pipeline step (6b, after push,
before verify) enables Pages with the GitHub Actions source
(`POST /repos/{org}/{repo}/pages`, `build_type: "workflow"`) and sets
`ENABLE_PAGES=true` (`POST/PATCH /repos/{org}/{repo}/actions/variables`) so the
born-with `pages.yml` (enrahitu spec 013) auto-publishes the SPA preview. It is
**best-effort**: the repo is already pushed and Pages is an optional preview, so
any failure is logged (`factory.pages_enable_failed`) and the stamp still runs
to born-green verify. Adopt is excluded (it lands via a PR, so
ENABLE_PAGES-on-push would not apply until merge). This step needs two GitHub
App permissions the App does not hold yet (**Pages: write**, **Variables:
write**); until they are granted the step 403s and is swallowed, so the code
ships dormant. The grant plus fleet-wide re-consent is a deliberate operator
step, tracked in spec 004's 2026-07-15 amendment. `StampJobView` exposes
`pages`. The new GitHub helpers (`enablePages`, `setRepoVariable`) are IO like
the rest of `github.ts`: exercised by the manual E2E, not unit-tested; the
`StampJob` round-trip covers the new boolean column. typecheck + vitest + spine
gates green. The default template pin (`FACTORY_TEMPLATE_REF`, config.ts) is the
enrahitu v0.2.0 release (`ec29aa7`), advanced from the earlier #16 pin (`4a4eab1`)
so the stamped tree carries both the born-with pages.yml base-path fix (enrahitu
spec 013) and the `export-ignore` that strips the ~190K-line vendored toolchain
from the stamp (enrahitu spec 018). An older pin enabled Pages on a repo with no
(or a base-path-buggy) pages.yml, or shipped the vendored build-source into the
customer tree. The pin is a tagged release, not a mid-branch SHA (spec 005 §3).

## 5. Out of scope

- Signed certificates (born-with certVersion 2, enrahitu spec 012 §7):
  emission through the vended tenant-emit CLI with a platform-minted
  Ed25519 key set as a repo CI secret at repo creation (the mint sits
  on the spec 004/005 boundary when this lands), repo-side
  re-verification via pinned tenant-tail, and the spec 008 ledger
  anchor as the countersign. Step 3 above is the unsigned v1 flow by
  design.
- Deployment of the stamped app (fleet, spec 006).
- Template authoring, flavors' contents (enrahitu repo).
- Multi-template support (one pinned chassis for now).
- GitHub Enterprise/GHES endpoints.

## Amendment (2026-07-21): spec 011 tenant lifecycle

Spec 011 makes one coordinated edit in this spec's `backend/factory/`
territory: `api.ts` adopts the shared `authorizeTenant` helper (spec 011
§3) in place of the `ownerUserId` check, so a platform operator and a
tenant member reach `stamp` on the ordinary endpoint (spec 011 §5.8). The
active-installation precondition on `createStamp` is unchanged. See
specs/011-tenant-lifecycle/spec.md §5.7, §5.8.

## Amendment (2026-07-22): spec 012, the contract 0.6.0 fixture

Spec 012 makes one coordinated edit in this spec's `backend/factory/`
territory: `fixtures/template.v0_6_0.toml` (the real enrahitu
template.toml at contract 0.6.0, which adds the `admin` slot and bumps
`requires.toolchain` to `^0.3`; enrahitu spec 023) joins the pinned
0.5.0 fixture, and `contract.test.ts` proves this spec's reader against
it: 0.6.0 sits inside the supported major-0 range, the unknown `admin`
slot parses and is ignored by `validateSlots`, and stamping rides the
slot's default. This closes the cross-repo arm of enrahitu spec 023
acceptance 4 that its §4.1 assigned to statecraft spec 012. No reader
code changed.
