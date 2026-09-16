---
id: "007-governance-webapp"
title: "Governance UI: Vite + React Router v7 webapp"
status: approved
created: "2026-07-14"
implementation: complete
depends_on:
  - "004-tenants-github-app"
establishes:
  - { kind: directory, path: "frontend/" }
# The SPA lives at `frontend/`, matching the enrahitu chassis convention. The
# 2026-07-16 realignment moved it here from `webapp/` in one PR (owned paths and
# this spec move together); spec 002's phantom `frontend/` edge was retired in
# the same realignment. See the 2026-07-18 Update.
summary: >
  Replaces the chassis's placeholder Vue SPA with the control plane's
  real face: a Vite + React Router v7 single-page app served by the
  chassis web service from web/dist, same-origin with the API and the
  embedded rauthy IdP. v1 surface: login, tenant list/create, GitHub
  App install flow, stamp launcher + job progress, fleet table with
  operation buttons. The platform UI is deliberately NOT a template
  flavor: it owes nothing to template stack choices (thesis §3).
---

# 007: Governance webapp

## 1. Territory

`frontend/` is this spec's territory (the Vue placeholder from the
chassis import, spec 002, is deleted). Package name
`@statecraft/frontend`, matching the enrahitu chassis (`@enrahitu/frontend`);
spec-spine manifest key -> this spec. Keep the build contract identical:
`npm --prefix frontend run build` emits into `backend/web/dist` (the path
the chassis web static service serves); that static service is untouched.

The `webapp/` -> `frontend/` rename also disturbs governance-owned build
and CI surfaces (spec 002, plus `spec-spine.toml`, which spec 000 owns),
carried in this PR under a `Spec-Drift-Waiver:` (007 supersedes the 002
placeholder; those owning specs are not amended to ratify a rename they
did not author):

- the root configs repoint their SPA-directory reference from
  `webapp` to `frontend`: `package.json` (`dev:web` / `build:web`
  scripts), `tsconfig.json` (the `exclude` entry that keeps the SPA out
  of the backend `tsc`), `vitest.config.ts` (the test `exclude` glob),
  `.dockerignore`, and `.gitignore`.
- `.github/workflows/verify.yml` and `image.yml`: the SPA cache path and
  the `npm --prefix frontend ci` steps, plus the `frontend`
  component-test step (§3).
- `spec-spine.toml`: `standalone_npm_packages` swaps `webapp` for
  `frontend`.

## 2. Behavior

- Stack: React 19, React Router v7 in SPA/data-router mode
  (createBrowserRouter; no SSR), Vite, TypeScript strict. Styling:
  keep it minimal and dependency-light (CSS modules or vanilla-extract;
  no component framework in v1).
- Auth: session cookie from the chassis auth service; login page offers
  rauthy (same-origin /auth/v1 flow) and, in dev, the mock driver.
  CSRF header on mutating fetches, matching the chassis lib contract.
  A root loader hits `GET /api/v1/auth/me`; unauthenticated users land
  on /login.
- Routes:
  - `/` dashboard: tenants overview.
  - `/tenants/new`, `/tenants/:id` (installations, repos via spec 004
    endpoints, install-App call-to-action when none).
  - `/tenants/:id/stamps/new` (appName, org picker from installations,
    frontend flavor select, REQUIRED explicit agentic posture select
    with no preselected value), `/stamps/:jobId` live progress
    (poll GET /stamps/:jobId; states from spec 005's machine).
  - `/tenants/:id/fleet` table (spec 006 endpoints; deploy form,
    update/backup/remove actions with the confirm-name guard surfaced
    honestly in the UI).
  - Degrade gracefully when factory/fleet services are not yet
    deployed (404s from missing services render as "not enabled yet",
    not crashes), so this spec is implementable right after 004.
- API access: plain fetch wrappers with typed response shapes copied
  from the service specs; no codegen dependency in v1.

## 3. Acceptance

- `npm --prefix frontend run build` emits web/dist; `npm run dev` serves
  the SPA; login (mock driver) -> create tenant -> tenant detail works
  against a locally running control plane.
- With spec 005 present: launching a stamp shows live job progression.
- vitest component tests for the auth loader redirect and one route
  module; the chassis suite stays green.
- Spine gates green (frontend package repointed in spec-spine.toml if
  the standalone list names change).

## 4. Out of scope

- Approvals inbox rendering (spec 008 adds the data; a follow-up spec
  adds the UI once the shape exists).
- Design-system investment, theming, mobile polish.
- Admin/ops views beyond the fleet table.

## 5. Status (2026-07-15)

Implementation landed, built, unit-tested, and gated; kept `in-progress`
pending two acceptance items that need state this session could not
produce.

Verified against a live local control plane (`encore run` on :4000, the
webapp dev server on :5173, CoreLedger on Postgres, mock auth driver):

- The full §3 login-to-detail request/response contract, end to end:
  unauthenticated `GET /api/v1/auth/me` 401 (the root loader's redirect
  trigger); mock login 302 + session cookies; authenticated `me`;
  `GET /api/v1/auth/csrf-token`; `POST /api/v1/tenants` (CSRF
  double-submit); `GET /api/v1/tenants`; `GET /api/v1/tenants/:id`;
  `GET .../github/install-url`. Every response shape matches the
  webapp's typed client exactly.
- `npm --prefix webapp run build` emits `backend/web/dist`; both the dev
  server (:5173) and the served bundle (:4000) render the SPA.
- vitest component tests (auth-loader redirect + login route) pass; the
  spine gates (compile, index check, lint, couple with the waiver) and
  the CI govern gate are green.

### Update 2026-07-15 (live verification -> `implementation: complete`)

Both remaining items were exercised in-browser against a live local
control plane (Chrome via the automation extension; `encore run` on :4000
with the real GitHub App secrets sourced, the webapp dev server on :5173,
CoreLedger on the dev Postgres, mock auth driver). Acceptance holds in
full:

- **§3.1 in-browser click-through** (real data): unauthenticated load
  redirects to `/login`; mock sign-in lands on the tenants dashboard;
  `New tenant` -> create -> tenant detail. The detail page then bound the
  real org-wide `statecraft-ing` installation (`125344051`, the spec 004
  e2e installation) through the real `/github/setup` App-JWT path and
  rendered the active installation plus the live repository list read
  through the installation token.
- **§3.2 launching a stamp shows live job progression** (real factory):
  from the stamp launcher (`/tenants/:id/stamps/new`) a create-mode stamp
  (`july-15-stampcheck`, org `statecraft-ing`, posture `none`) launched
  and the progress view (`/stamps/:jobId`) polled every 2s, advancing the
  stepper live queued -> stamping -> pushing -> verifying -> (terminal).
  The factory really cloned the pinned template, stamped, created the
  private repo `statecrafting/july-15-stampcheck`, minted a born-with
  cert, triggered the repo's born-green CI, and the UI rendered the honest
  terminal state. The stamp finished `failed` because the stamped repo's
  born-green CI did not pass (`npm --prefix frontend-react ci` -> EUSAGE:
  the pinned template ref lacks a `frontend-react` lockfile). That is a
  factory/template concern (the pin, spec 005 / enrahitu), not a webapp
  defect: §3.2 asks that the UI *show live job progression*, which it did
  through to the terminal state, including the failure surface. Tracked
  for the factory separately; it does not gate this webapp spec.

Everything else (build, served bundle, vitest, spine + govern gates) was
already green (above) and stays green.

### Update 2026-07-16 (chassis realignment: `webapp/` -> `frontend/`, back to `in-progress`)

The SPA lives at `webapp/`, and it should not. statecraft is stamped from the
enrahitu chassis and is supposed to look like it: enrahitu's slimmed chassis is
two directories, `backend/` + `frontend/` (with a `frontend-react/` variant),
and this repo imported it as `backend/` + `webapp/`. The divergence bought
nothing. This spec's territory therefore moves to `frontend/` and the
implementation flips back to `in-progress` until the move lands.

The repo currently holds the divergence in a confusing shape (verified
2026-07-16):

- `frontend/` **exists but is empty of authored code**: zero git-tracked files.
  What is on disk is 860 gitignored `node_modules` files, a husk left by the
  chassis import. Spec 002 nonetheless `establishes` it, so the corpus owns a
  directory with no content while the real SPA sits in a directory named
  something else.
- `webapp/` holds the 23 tracked files that are actually the SPA.

So the move also retires the phantom: spec 002 drops its `frontend/` edge (see
its 2026-07-16 note) and this spec picks the path up. Ownership stays with the
governance UI either way; only the name changes.

**Blast radius for the implementing session.** The rename is mechanical but
wide: `package.json` (including the explicit `npm --prefix webapp ci` added by
009 stage 1), `tsconfig.json`, `vitest.config.ts`, `.dockerignore`,
`.gitignore`, `spec-spine.toml` (its `standalone_npm_packages` list and the
comment explaining the old placement), the prose in `README.md`, `CLAUDE.md`,
and `AGENTS.md`, and cross-references in specs 001, 002, 004, and 009.
`spec-spine.toml` is spec 000 territory, so that touch lands as a coordinated
000 edit or a cited waiver.

**Two traps, both verified 2026-07-16.** First, the on-disk
`frontend/node_modules` husk must be cleared before `git mv webapp frontend` or
the move collides. Second, and less obvious: **that husk masks the gate.**
Flipping this spec's `establishes` to `frontend/` before the code moves looks
green locally, because the husk makes `frontend/` a real directory on a
developer's disk. On CI's fresh clone `frontend/` does not exist (zero tracked
files), so the same edge raises `I-007 [frontend/] ... is not a directory`, the
007 shard goes stale on blocking diagnostics, and `govern` fails. Proven by
moving the husk aside and re-running `spec-spine index`. So the edge and the
code move in one commit, and the husk is deleted in that same commit rather than
left to make future local runs lie.

**Acceptance for this update** (in addition to §3, which is unchanged because
this is a pure move with no behavior change): no `webapp` reference survives
outside git history; `frontend/` is this spec's territory and 002 no longer
claims it; typecheck, vitest, the SPA build into `backend/web/dist`, and the
image build are all green; spine gates and `couple` pass.

### Update 2026-07-18 (`webapp/` -> `frontend/` landed; `implementation: complete`)

The realignment is done. `git mv webapp frontend` moved all 23 tracked files;
the `frontend/node_modules` husk was deleted in the same commit (the trap in the
2026-07-16 note), the package was renamed `@statecraft/webapp` ->
`@statecraft/frontend` (mirroring `@enrahitu/frontend`), and every SPA-directory
reference was repointed: `package.json`, `tsconfig.json`, `vitest.config.ts`,
`.dockerignore`, `.gitignore`, both CI workflows (`verify.yml`, `image.yml`),
and `spec-spine.toml` (`standalone_npm_packages`, spec 000 territory, under the
PR's `Spec-Drift-Waiver:`), plus the service-map prose in specs 001/004/009,
`README.md`, `CLAUDE.md`, and `AGENTS.md`. Spec 002's phantom `frontend/` edge
was already retired (its 2026-07-16 note), so this spec picks the path up
cleanly and now `establishes` `frontend/`.

The 2026-07-16 acceptance holds: no *live* `webapp` reference survives in code,
configuration, or the service-map docs. The only remaining `webapp` tokens are
in this spec's and spec 002's dated history logs and in git history, which are
the record of the rename rather than live references, and in the spec id
`007-governance-webapp` itself (the manifest key, unchanged). `frontend/` is
this spec's territory and 002 no longer claims it; the spine gates (compile,
index check, lint, couple with the waiver) pass, and the chassis `verify` gates
(root typecheck + vitest, the frontend typecheck + component tests, the SPA
build into `backend/web/dist`, and the image build) are green. Flipped to
`implementation: complete`.

## Amendment (2026-07-21): spec 011 tenant lifecycle

Spec 011 establishes a new nested-ownership route subtree it owns,
`frontend/src/routes/operator/` (the operator console). Coordinated edits
inside this spec's `frontend/` territory: `lib/api.ts` gains the operator,
uninstall, delete-tenant, reconcile, and tenant-less install-url client
methods plus the `isOperator` helper; `routes/root.tsx` adds an Operators
nav entry gated on `me.roles` (the SPA's first consumer of roles);
`routes/tenant-detail.tsx` adds uninstall and delete-tenant actions and
disables Stamp when the tenant has no active installation;
`routes/fleet.tsx` disables the deploy form under the same condition;
`routes.tsx` wires the operator route and the tenant-detail action. See
specs/011-tenant-lifecycle/spec.md §5.7, §5.8.

## Amendment (2026-07-22): DELETE transport encoding + the self-serve install entry

Two fixes from spec 011's live acceptance walk, in this spec's `frontend/`
territory. `lib/api.ts`: Encore decodes DELETE payloads from the query
string, so `apiSend` now encodes DELETE bodies as query parameters (tenant
delete, fleet remove, and operator membership revoke were all unusable
from the SPA before this). `routes/dashboard.tsx` plus a `page-actions`
rule in `styles.css`: the tenant-less install URL (spec 011 §5.6) gains
its UI entry, with the empty state leading on "Install the GitHub App"
and the page header offering "Install into a new org"; GitHub's own
install picker does the org selection, so no in-app org chooser exists.
See specs/011-tenant-lifecycle/spec.md §9.
