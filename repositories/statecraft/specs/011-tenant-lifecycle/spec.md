---
id: "011-tenant-lifecycle"
title: "Tenant lifecycle and org-derived access"
status: approved
created: "2026-07-21"
implementation: in-progress
depends_on:
  - "001-statecraft-thesis"
  - "004-tenants-github-app"
  - "008-governance-attestation"
  - "009-control-plane-deploy"
# Nested-ownership pattern (the corpus norm: 002 owns backend/ while 004, 005,
# 006, and 008 own subdirectories inside it; 009 owns a subtree inside 010's
# infra/). This spec owns new modules inside spec 004's service directory and
# a new route subtree inside spec 007's frontend/.
establishes:
  - { kind: directory, path: "backend/tenants/access/" }
  - "backend/auth/github-identity.ts"
  - { kind: directory, path: "frontend/src/routes/operator/" }
summary: >
  Completes the tenant model that spec 004 opened: create gains delete,
  install gains uninstall, and ownership-by-creator grows into a
  two-tier authorization model. Tier one is the global
  statecraft_operator rauthy role (the platform operator: sees all
  tenants, can do everything); tier two is per-tenant membership derived
  from GitHub org roles (org admin -> tenant admin, org member ->
  tenant member), never from a rauthy role, so a customer who installs
  the App can never escalate to platform power. Self-serve onboarding
  turns on: rauthy auto_onboarding mints federated users from GitHub
  sign-in, an install with no pre-existing tenant auto-creates one
  bound to the chosen org, and login-time reconciliation grants a
  second org admin tenant access without an install. Provisioning
  verbs (stamp, fleet deploy/update/backup) gate on an active
  installation; teardown verbs (uninstall, fleet remove, tenant
  delete) never do. Destructive lifecycle acts run through the spec
  008 action gate and land in the attestation ledger.
---

# 011: Tenant lifecycle and org-derived access

## 1. Purpose

Spec 004 built the tenancy spine one-directionally: a user creates a
tenant, installs the GitHub App, and the webhook passively mirrors
GitHub-side state into `Installation.status`. Live bring-up (spec 009,
2026-07-21) surfaced what is missing the moment a second human shows
up: there is no delete, no active uninstall, no notion of "who else may
touch this tenant", and the only authorization anywhere is
`ownerUserId` equality. Meanwhile the platform's GitHub upstream login
worked end to end but refused unknown identities, because the provider
was seeded with `auto_onboarding: false`.

This spec closes the loop in both directions:

- **Lifecycle symmetry.** Every entry surface gets an exit surface:
  create/delete for tenants, install/uninstall for the GitHub App
  linkage, and both directions are first-class UI, not webhook
  side effects.
- **Two-tier authorization.** The platform operator and the tenant
  admin are different kinds of power and must never share a role
  (the privilege-escalation trap caught on the whiteboard,
  2026-07-21). Tier one: `statecraft_operator`, global, seeded by
  spec 009, wired here into `requireRole`. Tier two: per-tenant
  membership rows derived from GitHub org roles.
- **Self-serve entry.** GitHub sign-in onboards a customer
  automatically; installing the App with no pre-existing tenant
  creates one, bound to the org the customer chose; a second org
  admin gets tenant access at login without installing anything.

## 2. Identity groundwork (verified against rauthy 0.36.0 source, 2026-07-21)

The design leans on verified rauthy behavior, not assumptions:

- **`auto_onboarding` creates; `auto_link` links.** With
  `auto_onboarding: true`, an upstream GitHub identity with no linked
  rauthy user and no same-email rauthy user gets a brand-new federated
  user: enabled, no password, no passkey, `roles` empty, groups none.
  A same-email but unlinked rauthy user is rejected outright unless
  `auto_link` is on or an explicit link-account flow was used; rauthy
  hardens this path against account takeover. We keep
  `auto_link: false`; the bootstrap admin stays a local account, and
  operators who want a GitHub-linked identity use rauthy's explicit
  account-linking flow.
- **No default-role mechanism exists for onboarding.** The only role
  rauthy can grant at onboarding is `rauthy_admin` via
  `admin_claim_path`, which we do not use. Consequence: a freshly
  onboarded federated user carries no rauthy roles, and
  `statecraft_operator` can never be conferred by sign-in. The app's
  own `RAUTHY_DEFAULT_ROLE` fallback (chassis auth) assigns the app
  role `user`. This is exactly the escalation guard tier two needs.
- **The GitHub numeric id is admin-API-only.** rauthy stores the
  upstream account id as `federation_uid` on the user row but exposes
  it neither in token claims nor in `/userinfo`; only
  `preferred_username` (the GitHub login, when captured and not
  already taken) reaches the app. The robust way to learn "who is
  this user on GitHub" is rauthy's admin API
  (`GET /auth/v1/users/{id}` returns `auth_provider_id` +
  `federation_uid`).
- **The upstream access token is transient.** rauthy discards the
  GitHub OAuth token right after login; a `read:org` login scope can
  never feed org data into claims. Org-role reconciliation therefore
  runs app-side, through the GitHub App's installation tokens, which
  spec 004 already grants org **Members** permission for.

## 3. The authorization model

Two tiers, deliberately different mechanisms:

- **Platform operator: `statecraft_operator`** (global rauthy role,
  seeded per spec 009). Gates the operator console, the all-tenants
  view, and lets its holder perform any tenant/installation/lifecycle
  action on any tenant. Wired through the existing but so far unused
  `requireRole`/`hasRole` (`backend/lib/roles.ts`). Granted only by
  hand in rauthy admin (break-glass: `rauthy_admin` administers the
  IdP itself and stays out of app surfaces).
- **Tenant membership: app-level rows, org-derived.** A
  `tenant_membership` records `(tenantId, githubUserId, role)` where
  role is `admin` or `member`, mirroring the user's GitHub org role
  for the org the tenant is linked to. Derived at install time, at
  login-time reconciliation, or granted manually by an operator.
  Never stored in rauthy; never global.
- **Access rule.** For any tenant-scoped verb the caller must be
  (a) a platform operator, (b) a member with sufficient role
  (admin for mutating verbs, member for read), or (c) the legacy
  `ownerUserId` (the creator; kept as an access path so pre-011
  tenants and non-GitHub accounts keep working). One helper owns this
  decision; ad-hoc `ownerUserId` equality checks are retired.

## 4. Territory

New, owned here:

- `backend/tenants/access/`: membership entity + store, the
  authorization helper, GitHub org-role reconciliation, lifecycle
  operations (uninstall, delete) and their operator API surface.
- `backend/auth/github-identity.ts`: resolution of a rauthy-federated
  user's GitHub identity (`federation_uid` via rauthy admin API,
  login via GitHub API) onto `user_account`.
- `frontend/src/routes/operator/`: the operator console routes.

Coordinated edits in other specs' territory (each implementing PR
pairs them with a dated pointer amendment in the owning spec, per the
coupling gate):

- Spec 004 (`backend/tenants/`): `api.ts` (new endpoints + authz
  helper adoption), `setup.ts` (tenant auto-create path), `webhook.ts`
  (installation.created auto-create, membership attach), `store.ts`,
  `entities.ts` (no column changes to existing tables; new tables live
  in `access/`).
- Spec 002/chassis (`backend/auth/`): `rauthy.ts` callback hook for
  identity resolution + reconciliation; `me.ts` untouched (roles
  already flow).
- Spec 006 (`backend/fleet/api.ts`): active-installation gate on
  provisioning verbs.
- Spec 007 (`frontend/`): tenant detail linkage UI, gating, operator
  nav entry.

## 5. Behavior

### 5.1 GitHub identity on the app user

`user_account` gains two nullable columns: `githubUserId` (string,
indexed) and `githubLogin` (string). CoreLedger schema init is
CREATE-only, so the deploy runs a documented manual `ALTER TABLE`
(precedent: spec 005's `stamp_job` columns). On first rauthy-driver
login of a federated user (and once for existing rows), the backend
resolves `federation_uid` through the embedded rauthy admin API using
a dedicated API key (`RAUTHY_API_KEY`, read-users scope; see §6), then
resolves the login from the numeric id via the GitHub API using an
installation token when one exists, else unauthenticated. Non-federated
accounts (the bootstrap admin, mock driver) simply keep both columns
null and skip everything downstream of them.

### 5.2 Membership model

`TenantMembership` (new table, in `backend/tenants/access/`):
`id` (uuid), `tenantId` (indexed), `githubUserId` (indexed),
`userAccountId` (nullable, indexed; attached when that GitHub identity
first logs in), `role` (`admin` | `member`), `source` (`install` |
`reconcile` | `operator`), `createdAt`, `updatedAt`,
`lastReconciledAt` (nullable). Invariant: one row per
`(tenantId, githubUserId)`, enforced at the model boundary inside a
ledger transaction.

Derivation rules:

- Installing the App grants the installing user an `admin` membership
  on the bound tenant (`source: install`).
- Reconciliation (§5.3) maps GitHub org role to membership role:
  org admin -> `admin`, org member -> `member`, no org membership ->
  membership row removed (unless `source: operator`).
- Operators may grant or revoke memberships manually
  (`source: operator`); reconciliation never downgrades or removes an
  operator-granted row.

### 5.3 Login-time reconciliation

On session establishment through the rauthy driver (and via
`POST /api/v1/auth/reconcile` for an explicit refresh), for a user
with a resolved `githubUserId`:

1. Attach pending rows: memberships carrying this `githubUserId` with
   `userAccountId` null get the user attached.
2. For each **active** `Installation`, check
   `GET /orgs/{org}/memberships/{login}` with that installation's
   token; upsert or remove the membership per the derivation rules.
   The sweep is bounded by the number of active installations, which
   is small in this phase; a push-based refinement rides org-webhook
   events later (out of scope, §8).

This is what gives the second org admin tenant access from a plain
GitHub sign-in, with no install and no manual grant.

### 5.4 Uninstall (the exit for the link)

`DELETE /api/v1/tenants/:id/github/installation` (auth; tenant admin
or operator): calls GitHub's `DELETE /app/installations/{id}` with the
App JWT, then marks the installation `removed` without waiting for the
webhook (which will also arrive and be idempotent). The tenant page
reflects `linked`/`removed` state truthfully in both directions. An
uninstall performed on GitHub's side keeps working exactly as today
(webhook flips status), and the UI shows the same end state.

### 5.5 Delete tenant (the exit for the tenant)

`DELETE /api/v1/tenants/:id` (auth; tenant admin or operator, with a
typed name confirmation like fleet remove):

- Refused with `failedPrecondition` while the tenant has fleet apps;
  remove them first (teardown verbs never gate on linkage, so this is
  always reachable).
- Runs through the spec 008 action gate (`gateOrDeny`) and writes an
  attestation record; tenant deletion is a privileged act.
- If an installation is still active, performs the §5.4 uninstall
  first, then hard-deletes the tenant, its installations, and its
  memberships in one ledger transaction. History survives in the
  attestation ledger and audit log, not as soft-delete flags.

### 5.6 Self-serve entry: install creates the tenant

- `GET /api/v1/github/install-url` (auth): a tenant-less variant of
  spec 004's install URL whose signed state binds only `{userId}`.
  The setup callback, seeing a tenant-less state, fetches the
  installation, creates a tenant named after the org, binds the
  installation, and grants the caller an `admin` membership, all in
  one transaction. The existing tenant-bound flow is unchanged.
- `installation.created` webhooks with an unknown installation id and
  no app-side state (a direct install from GitHub's App page) create
  the tenant and installation from the payload and record a pending
  `admin` membership keyed by the sender's GitHub id; it attaches to a
  `user_account` when that identity first signs in (§5.3 step 1).
- Either way the customer lands on a tenant page that is already
  linked, satisfying: GitHub sign-in -> install -> operating surface,
  with no manual tenant step.

### 5.7 Linkage gating

Provisioning verbs require an active installation; teardown verbs
never do:

- Factory `createStamp` already refuses without an active installation
  for the org (spec 005 behavior; unchanged).
- Fleet `deploy`, `update`, and `backup` gain the same
  `failedPrecondition` check. Fleet `remove` stays ungated (cleanup
  must always be reachable; it already demands typed confirmation).
- Frontend: on the tenant page, Stamp and Fleet actions render
  disabled (with the reason) unless the tenant has an active
  installation, and re-enable when a link returns. Fleet removal of
  existing apps remains reachable for unlinked tenants.

### 5.8 Operator surfaces

- `GET /api/v1/operator/tenants` (all tenants with installation
  status, membership counts, fleet app counts) and
  `POST/DELETE /api/v1/operator/tenants/:id/memberships` (manual
  grant/revoke), all behind `requireRole(auth, "statecraft_operator")`.
  Every other verb an operator needs (create, delete, install,
  uninstall, stamp, fleet) is the ordinary endpoint, whose access rule
  (§3) already admits operators on any tenant.
- Frontend: an Operators section appears in the nav only when
  `me.roles` contains `statecraft_operator` (the first consumer of
  `roles` in the SPA), leading to the console at `/operator/tenants`:
  the all-tenants table with drill-down to the ordinary tenant page,
  where the operator can do anything and everything, including
  creating many tenants and linking each to an org.
- Server-side enforcement is the truth; UI gating is convenience.

## 6. Operator prerequisites

- Create a rauthy API key (read-users scope) in the embedded rauthy
  admin UI and add it to the secret set as `RAUTHY_API_KEY`; this is a
  catalog delta against spec 010's documented secret source (33 -> 34
  keys) and rides a pointer amendment there.
- Flip the GitHub upstream provider to `auto_onboarding: true` in
  rauthy admin (spec 009 seeded it false); leave `auto_link: false`.
- Confirm the GitHub App's org **Members** permission is granted
  (spec 004 §1 already lists it) and that the App's setup URL points
  at `/github/setup` with "Request user authorization" off.

## 7. Acceptance

1. A GitHub identity never seen before signs in and lands in the app
   as a federated user with app role `user`, no rauthy roles, and
   populated `githubUserId`/`githubLogin`.
2. That user installs the App into their org from the tenant-less
   install URL: a tenant named after the org exists, the installation
   is active, and the user holds an `admin` membership; Stamp and
   Fleet are enabled on the tenant page.
3. A second admin of the same org signs in via GitHub without
   installing anything and holds an `admin` membership on the same
   tenant after login.
4. Uninstall from the tenant page removes the installation on
   GitHub's side (verified there), the page shows the unlinked state,
   Stamp/deploy refuse with `failedPrecondition`, and the UI disables
   them; re-installing re-enables both.
5. Deleting a tenant with fleet apps is refused; after fleet removal
   it succeeds, the installation is uninstalled, memberships and
   installations are gone, and a gate Decision plus attestation
   record exist for the deletion.
6. A non-operator calling `GET /api/v1/operator/tenants` receives
   `permissionDenied`; an operator receives every tenant including
   ones they do not own and can run any lifecycle verb on them.
7. Org-derived grants confer no platform power: a tenant admin
   without `statecraft_operator` cannot reach any operator endpoint.
8. `spec-spine compile && spec-spine index && spec-spine lint
   --fail-on-warn && spec-spine index check` and the chassis npm gates
   (typecheck + vitest) stay green.

## 8. Out of scope

- Push-based membership sync from org webhooks (`organization`
  member events); the login-time sweep is the v1 mechanism.
- Tenant end-user identity: tenant apps carry their own embedded
  rauthy (thesis §3.1); nothing here touches it.
- The platform operator dashboard (frontend-admin) and observability
  surfaces: spec 012 and the enrahitu 022/023 line.
- Billing, quotas, tenant transfer between owners, and org rename
  reconciliation beyond what the webhook already conveys.

## 9. Status (2026-07-21): in-progress

The code for this spec has landed across its own territory
(`backend/tenants/access/`, `backend/auth/github-identity.ts`,
`frontend/src/routes/operator/`) and the coordinated edits in specs 002,
004, 005, 006, 007, and 008 (each paired with a dated pointer amendment in
the owning spec). Implemented: the two-tier authorization model behind the
single `authorizeTenant` helper (operator role, org-derived membership,
legacy owner), login-time GitHub-identity resolution and org-role
reconciliation, uninstall and gated tenant delete, the tenant-less and
direct-install self-serve entry paths, the linkage gate on provisioning
verbs, and the operator console with its role-gated nav.

Acceptance item 8 (the local gates) holds: `spec-spine compile && index &&
lint --fail-on-warn && index check` and the chassis npm gates (backend and
frontend typecheck + vitest) are green, with new unit tests for the authz
rule, org-role derivation, and membership dedup/attach.

Acceptance items 1-7 are live-behavior checks that require the deployed
control plane (spec 009, in-progress) plus the operator prerequisites of
§6, which are deploy-time acts, not code:

- Run the documented one-time `ALTER TABLE user_account ADD COLUMN
  github_user_id TEXT; ALTER TABLE user_account ADD COLUMN github_login
  TEXT;` on the deployed database (CoreLedger schema init is CREATE-only;
  §5.1, precedent spec 005). Fresh databases and the test suite get the
  columns from the entity.
- Create a rauthy API key (read-users scope) and bind it as
  `RAUTHY_API_KEY` (the 33 -> 34 secret-catalog delta against spec 010).
- Flip the GitHub upstream provider to `auto_onboarding: true` in rauthy
  admin (leave `auto_link: false`).
- Seed at least one `statecraft_operator` role holder in rauthy admin.

This spec flips to `implementation: complete` once items 1-7 are exercised
against the live cluster.

## Status (2026-07-22): live acceptance walk, items 1-2 and 4-7 verified

The operator-driven walk ran against app.statecraft.ing with the org
`aigated` as the customer-side subject. Every §6 prerequisite was
re-verified live first; two were found broken and fixed before item 1:
the mounted `RAUTHY_API_KEY` carried literal shell quotes copied from an
env line (rauthy answered 404 no-rows-returned; fixed at the SOPS source,
PR #59), and the GitHub App's Setup + Webhook URLs pointed at the
statecraft.ing marketing site (Pages 404/405 on every delivery since the
App was created; both re-pointed at app.statecraft.ing, a webhook
redelivery then verified green end to end).

Verified live, in walk order:

1. **Item 1.** A never-seen GitHub identity signed in through the
   upstream provider: rauthy minted a federated account (empty rauthy
   roles), the app row carries role `user`, and §5.1 resolution
   populated `githubUserId`/`githubLogin` through the fixed API key.
2. **Item 2.** The tenant-less install URL led to GitHub's own org
   picker; installing into `aigated` auto-created the tenant named
   after the org, an active installation, and an `admin` membership
   (`source: install`, keyed by `userAccountId`); the explicit §5.3
   reconcile then attached `githubUserId` and re-derived `admin` from
   the live org role. Stamp and Fleet rendered enabled. The
   `installation.created` webhook, redelivered to the fixed URL, was
   absorbed idempotently against the setup-created rows.
3. **Item 4.** In-app unlink removed the installation on GitHub
   (verified in org settings), the row flipped `removed`, stamp and
   fleet deploy both refused `failedPrecondition`, the UI disabled
   Stamp; reinstalling through the tenant-bound URL re-activated
   everything, with the fixed Setup URL landing the callback directly.
4. **Item 5.** With a fleet app present the delete refused ("tenant has
   1 fleet app(s)"). Fleet remove then succeeded through the full stack
   (typed confirm, gate allow, k8s teardown), and the delete completed
   the §5.5 sequence: GitHub-side uninstall (verified), tenant +
   installations + memberships hard-deleted in one transaction, and
   hash-chained `remove` and `tenant_delete` ledger records carrying
   the gate's configHash and actor.
5. **Items 6 and 7.** The org-derived tenant admin got
   `permission_denied` (`ROLE_REQUIRED: statecraft_operator`) on both
   operator endpoints and no Operators nav; the operator saw every
   tenant including the not-owned one and ran remove + delete on it.

Three production defects surfaced by the walk were fixed and deployed
mid-walk (PRs #60-#62, image `aeefe203`): fleet remove never forwarded
`subject_name`/`confirm_name` to the gate's confirm-name-required check
(spec 006 amendment), the SPA sent DELETE payloads as JSON bodies where
Encore decodes the query string, the dashboard lacked the §5.6 install
entry (spec 007 amendment), and the pod lacked fleet RBAC entirely
(spec 009 amendment; placement and teardown both died Forbidden).

**Item 3 remains the sole open item**: it needs a second GitHub account
holding admin on the same org, which does not exist yet. The mechanism
it exercises (login-time org-role reconciliation over active
installations) ran live via the explicit reconcile in item 2, but the
item's own scenario (a second human, no install, admin membership at
login) has not. Implementation stays `in-progress` until a second org
admin exists and walks it. Chassis follow-up recorded for enrahitu: app
sign-out never ends the rauthy session (RP-initiated logout without
`id_token_hint` renders a confirmation page and the driver never sends
one), so session switching requires the rauthy account-page logout.
