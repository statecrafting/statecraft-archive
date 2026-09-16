---
id: "080-github-identity-onboarding"
title: "GitHub Identity and Org Onboarding — App Installation, OAuth Login, Rauthy Sessions"
feature_branch: "feat/080-github-identity-onboarding"
status: approved
implementation: complete
kind: platform
domain: platform
created: "2026-04-06"
authors: ["open-agentic-platform"]
language: en
summary: >
  Replaces local email/password auth with GitHub-centered identity. GitHub App
  installation provides org trust anchor, GitHub OAuth provides user identity,
  Rauthy issues platform sessions and claims. Enables self-service project
  creation for authenticated org members.
code_aliases: ["GITHUB_IDENTITY", "ORG_ONBOARDING"]
owner: bart
risk: medium
establishes:
  - unit: { kind: directory, path: platform/services/statecraft/api/github }
  - unit: { kind: directory, path: platform/services/statecraft/api/auth }
---

# Feature Specification: GitHub Identity and Org Onboarding

## Phases

| Phase | Title | Status |
|-------|-------|--------|
| phase-1 | GitHub App + OAuth Login + Rauthy Sessions | active |
| phase-2 | Self-Service Project Creation | active |
| phase-3 | Team Role Mapping + Sync | active |
| phase-4 | Enterprise OIDC Federation | active |
| phase-5 | Desktop OIDC + Admin UI + Auth Hardening | active |
| phase-6 | Session Lifecycle, User Governance + Auth Hardening | active |

## Purpose

Statecraft currently uses local email/password auth with separate user/admin cookie tracks, a hardcoded default org, and no real org membership model. This blocks meaningful multi-user collaboration and governed project creation.

This spec replaces that model with GitHub-centered identity where:

- **GitHub App installation** proves org connection and grants integration authority
- **GitHub OAuth login** proves individual human identity
- **Rauthy** issues the actual platform session, tokens, and claims
- **OAP membership** derives from GitHub org membership against installed apps

This turns org membership into a first-class primitive and makes login the entry point into governed self-service.

## Design Principles

1. **GitHub proves identity and membership; Rauthy owns the session.** GitHub is not the IdP. It is the upstream trust source. Rauthy is the platform OIDC authority.

2. **App installation does not equal user authorization.** Installation proves org connection. Platform roles are still controlled by OAP policy.

3. **Two distinct GitHub integrations.** App installation (org-level, server-to-server) and OAuth login (user-level, browser flow) are related but separate primitives.

4. **Server-side membership resolution.** Never rely on client-side org lists. Resolve membership server-side after GitHub login using the App installation token.

5. **Platform claims are OAP-owned.** GitHub provides the membership basis; OAP governance assigns roles, permissions, and approval authority.

## Current State

| Component | Today | Target |
|-----------|-------|--------|
| Auth | Local email/password, Argon2id | GitHub OAuth + Rauthy OIDC sessions |
| Sessions | Two cookies (`__session`, `__admin_session`) | Single Rauthy-issued JWT with org context |
| Org model | Hardcoded `DEFAULT_ORG_ID` | GitHub App installation creates real org |
| Membership | None (users exist in isolation) | GitHub org membership mapped to OAP org |
| Roles | `user` / `admin` system roles | Platform roles (org-level + project-level) |
| User surface | Uptime monitoring only | Full project lifecycle self-service |
| GitHub App | Webhook + token brokering only | Trust anchor for org + identity + integration |
| Rauthy | Deployed (Helm chart) but not wired | Platform OIDC provider, session authority |

## Architecture

### Identity Stack

```
GitHub OAuth ──→ Rauthy (upstream provider) ──→ Platform Session + Claims
                        │
GitHub App ────→ Org Trust Anchor ──→ Membership Verification
```

### Integration Topology

```
┌──────────────────────────────────────────────────────────────┐
│  GitHub                                                       │
│                                                               │
│  ┌─────────────┐              ┌──────────────┐               │
│  │ GitHub App  │              │ GitHub OAuth  │               │
│  │ Installation│              │ App           │               │
│  └──────┬──────┘              └───────┬──────┘               │
│         │ webhooks, API               │ auth code flow       │
└─────────┼─────────────────────────────┼──────────────────────┘
          │                             │
          ▼                             ▼
┌──────────────────────────────────────────────────────────────┐
│  Statecraft                                                   │
│                                                               │
│  ┌─────────────────────────┐  ┌────────────────────────────┐ │
│  │ GitHub Service          │  │ Auth Service               │ │
│  │ • webhook handler       │  │ • OAuth callback           │ │
│  │ • installation registry │  │ • membership resolution    │ │
│  │ • token brokering       │  │ • Rauthy user provisioning │ │
│  └─────────────────────────┘  └──────────────┬─────────────┘ │
│                                              │               │
│                                              ▼               │
│                               ┌────────────────────────────┐ │
│                               │ Rauthy                     │ │
│                               │ • OIDC/OAuth2 provider     │ │
│                               │ • Session issuance         │ │
│                               │ • Custom claims (org, role)│ │
│                               │ • Token refresh            │ │
│                               └────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## Phase 1: GitHub App + OAuth Login + Rauthy Sessions

### Scope

- GitHub App installation webhook creates OAP org record
- GitHub OAuth login flow in OPC and Statecraft web
- Server-side org membership resolution
- Rauthy-backed session issuance with org context
- Basic membership sync on login
- Deprecate local email/password auth

### Data Model

#### New Tables

```sql
-- GitHub App installations (org trust anchor)
CREATE TABLE github_installations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_org_id   BIGINT NOT NULL UNIQUE,
  github_org_login TEXT NOT NULL,
  installation_id  BIGINT NOT NULL UNIQUE,
  installation_state TEXT NOT NULL DEFAULT 'active',  -- active | suspended | deleted
  allowed_repos   TEXT,       -- 'all' or comma-separated repo list
  org_id          UUID REFERENCES organizations(id),  -- linked OAP org
  installed_by    TEXT,       -- GitHub login of installer
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User identity linkage
CREATE TABLE user_identities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  provider        TEXT NOT NULL DEFAULT 'github',
  provider_user_id TEXT NOT NULL,       -- GitHub user ID (numeric string)
  provider_login  TEXT NOT NULL,         -- GitHub login handle
  provider_email  TEXT,                  -- primary email if available
  avatar_url      TEXT,
  access_token_enc TEXT,                 -- encrypted OAuth access token (for API calls)
  refresh_token_enc TEXT,                -- encrypted OAuth refresh token
  token_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_user_id)
);

-- Org membership linkage
CREATE TABLE org_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  source          TEXT NOT NULL DEFAULT 'github',  -- github | manual | rauthy
  github_role     TEXT,           -- admin | member (from GitHub org API)
  platform_role   TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member
  status          TEXT NOT NULL DEFAULT 'active',  -- active | suspended | removed
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, org_id)
);
```

#### Modified Tables

```sql
-- users: add GitHub identity fields, make password optional
ALTER TABLE users
  ADD COLUMN github_user_id BIGINT UNIQUE,
  ADD COLUMN github_login TEXT,
  ADD COLUMN avatar_url TEXT,
  ADD COLUMN rauthy_user_id TEXT UNIQUE,
  ALTER COLUMN password_hash DROP NOT NULL;  -- OAuth users have no password

-- organizations: add GitHub linkage
ALTER TABLE organizations
  ADD COLUMN github_org_id BIGINT UNIQUE,
  ADD COLUMN github_org_login TEXT,
  ADD COLUMN github_installation_id BIGINT;
```

### FR-001: GitHub App Installation Webhook

When the Statecraft GitHub App is installed into a GitHub organization:

1. `installation.created` webhook fires (already handled in `api/github/webhook.ts`)
2. Handler creates or updates `github_installations` row with:
   - `github_org_id` from `payload.installation.account.id`
   - `github_org_login` from `payload.installation.account.login`
   - `installation_id` from `payload.installation.id`
   - `installation_state = 'active'`
   - `allowed_repos` from `payload.repositories` or `'all'`
3. Handler creates or links an `organizations` row:
   - If org with matching `github_org_id` exists: link it
   - Otherwise: create new org with `slug = github_org_login`
4. Emit audit log entry: `org.github_app_installed`

On `installation.deleted`:
- Set `github_installations.installation_state = 'deleted'`
- Do NOT delete the org or any data — soft transition only
- Emit audit log entry: `org.github_app_uninstalled`

On `installation.suspend` / `installation.unsuspend`:
- Update `installation_state` accordingly

### FR-002: GitHub OAuth Login Flow

**Prerequisites:**
- Register a GitHub OAuth App (separate from the GitHub App)
- Configure Rauthy with GitHub as an upstream authentication provider

**Flow:**

```
Browser                  Statecraft              GitHub              Rauthy
  │                         │                      │                   │
  ├─ GET /auth/github ──────►                      │                   │
  │                         ├─ redirect ───────────►                   │
  │  ◄──────────────────────┤  (OAuth authorize)   │                   │
  │                         │                      │                   │
  │  (user authorizes)      │                      │                   │
  │                         │                      │                   │
  ├─ GET /auth/github/cb ──►│                      │                   │
  │  (with ?code=xxx)       ├─ POST token ─────────►                   │
  │                         │  ◄───────────────────┤ access_token      │
  │                         │                      │                   │
  │                         ├─ GET /user ──────────►                   │
  │                         │  ◄───────────────────┤ github identity   │
  │                         │                      │                   │
  │                         ├─ resolve org membership (server-side)    │
  │                         │                      │                   │
  │                         ├─ provision/link Rauthy user ────────────►│
  │                         │  ◄──────────────────────────────────────┤│
  │                         │                          session tokens  │
  │                         │                                          │
  │  ◄──────────────────────┤  Set-Cookie (Rauthy session)            │
  │                         │                                          │
```

**Server-side steps after receiving GitHub access token:**

1. Call `GET https://api.github.com/user` to get GitHub identity
2. Call `GET https://api.github.com/user/orgs` to get org memberships
3. Match orgs against `github_installations` where `installation_state = 'active'`
4. Find or create `users` row (match by `github_user_id` or email)
5. Upsert `user_identities` row with provider tokens
6. Upsert `org_memberships` for each matching installed org
7. Provision or link user in Rauthy (via Rauthy admin API)
8. Request Rauthy to issue session with custom claims:
   - `sub`: Rauthy user ID
   - `oap_user_id`: internal user ID
   - `oap_org_id`: selected org ID
   - `oap_org_slug`: org slug
   - `github_login`: GitHub handle
   - `platform_role`: org-level role
9. If exactly one org match: auto-select
10. If multiple matches: redirect to org picker (`/auth/org-select`)
11. If zero matches: show "no connected org" error page (`/auth/no-org`)

**Error handling:**

Each stage of the callback produces a specific error code on failure, redirecting to `/signin?error=<code>`. This replaces a single catch-all so users see actionable messages:

| Error code | Stage | User-facing message | Cause |
|------------|-------|---------------------|-------|
| `github_denied` | OAuth authorize | "GitHub login was denied." | User cancelled or GitHub returned `?error` |
| `no_email` | GitHub identity | "Could not retrieve your email." | No verified email on GitHub account |
| `token_failed` | Token exchange | "GitHub authentication failed." | Code expired, secret misconfigured |
| `github_api_failed` | GitHub API | "Could not reach GitHub." | GitHub API unreachable or returned error |
| `account_error` | User upsert | "Failed to create or link your account." | Database error during user/identity creation |
| `membership_failed` | Org resolution | "Could not resolve your organization memberships." | DB or GitHub API error during membership resolution |
| `rauthy_unavailable` | Rauthy provision | "Identity service is temporarily unavailable." | Rauthy unreachable or admin API error |
| `session_expired` | Org select | "Session expired." | `__pending_org` cookie missing or invalid |
| `oauth_failed` | Session creation | "GitHub login failed." | Final catch-all for session/cookie failures |

**Frontend auth routes:**

The OAuth callback redirects to these frontend pages (React Router, registered in `web/app/routes.ts`):

| Path | Component | Purpose |
|------|-----------|---------|
| `/signin` | `routes/signin.tsx` | Login page; displays `?error=<code>` messages |
| `/auth/no-org` | `routes/auth.no-org.tsx` | Zero org matches — prompts user to request app installation |
| `/auth/org-select` | `routes/auth.org-select.tsx` | Multi-org picker; reads `__pending_org` cookie |

### FR-003: Rauthy Integration

Rauthy is already deployed (`platform/charts/rauthy/`) but not wired to Statecraft. This phase wires it:

**Rauthy Configuration:**
- Register GitHub as upstream authentication provider
- Configure custom scopes/claims for OAP context (`oap_org_id`, `platform_role`)
- Register Statecraft as an OIDC client (for web app)
- Register OPC as an OIDC client (for desktop app — PKCE flow)

**Session Model:**
- Replace dual-cookie model with single Rauthy-issued session
- Access token (short-lived) + refresh token (long-lived) via httpOnly cookies
- All API endpoints validate the Rauthy JWT via Encore auth handler
- Claims carry org context so every request is org-scoped

**Encore Auth Handler:**
```typescript
// Wire Encore's auth handler to validate Rauthy JWTs
import { authHandler } from "encore.dev/auth";

interface AuthData {
  userId: string;
  orgId: string;
  orgSlug: string;
  githubLogin: string;
  platformRole: "owner" | "admin" | "member";
}

export const auth = authHandler(async (params): Promise<AuthData> => {
  // Validate Rauthy JWT from Authorization header or cookie
  // Extract and return OAP claims
});
```

**Amendment (M2M-token pass-through, 2026-07-01).** The gateway auth handler
(`api/auth/handler.ts`) runs for **every** request that carries an
Authorization header, including requests to the platform's `auth: false`
machine-to-machine endpoints (audit, policy, grants, spec 143's
knowledge-sweep) that present a `client_credentials` token. Those tokens carry
a different audience than the `statecraft-server` session client, so
`validateJwt` returns null for them. The handler now **returns `null`
(unauthenticated) instead of throwing** in that case: Encore then rejects
`auth: true` user endpoints (no AuthData) while letting `auth: false` M2M
endpoints proceed to their own scope-checked `validateM2mRequest`. Previously
the handler threw, which 401'd every M2M seam before its handler ran (observed
as the knowledge-orphan sweeper's 30-minute `aud`-mismatch 401s). The
disabled-user check (Phase 6) is unchanged: it still applies to the valid
user-session path. Regression cover: `api/auth/handler.test.ts` (encore lane).

### FR-004: OPC Login

OPC (Tauri desktop app) uses PKCE OAuth flow:

1. OPC opens system browser to `https://rauthy.{domain}/authorize` with PKCE challenge
2. Rauthy shows GitHub login (upstream provider)
3. User authenticates with GitHub
4. Rauthy redirects to OPC custom scheme (`opc://auth/callback`)
5. OPC exchanges code for tokens via Rauthy token endpoint
6. OPC stores tokens securely (Tauri secure storage)
7. All OPC API calls to Statecraft include Rauthy access token
8. OPC refreshes tokens automatically using refresh token

### FR-005: Org Membership Resolution

Membership is resolved server-side on every login:

```typescript
async function resolveOrgMemberships(githubAccessToken: string, userId: string) {
  // 1. Get user's GitHub org memberships
  const orgs = await githubApi.getUserOrgs(githubAccessToken);

  // 2. Match against installed GitHub Apps
  const installations = await db.select().from(githubInstallations)
    .where(eq(githubInstallations.installationState, 'active'));

  const matchedOrgs = installations.filter(inst =>
    orgs.some(org => org.id === inst.githubOrgId)
  );

  // 3. Upsert org_memberships for matches
  for (const match of matchedOrgs) {
    const githubOrg = orgs.find(o => o.id === match.githubOrgId);
    await db.insert(orgMemberships).values({
      userId,
      orgId: match.orgId,
      source: 'github',
      githubRole: githubOrg.role,  // 'admin' or 'member'
      platformRole: 'member',      // default; elevated by OAP policy
      status: 'active',
      syncedAt: new Date(),
    }).onConflictDoUpdate({
      target: [orgMemberships.userId, orgMemberships.orgId],
      set: { githubRole: githubOrg.role, syncedAt: new Date(), status: 'active' },
    });
  }

  // 4. Mark stale memberships (user left org)
  // ...

  return matchedOrgs;
}
```

### Non-Functional Requirements

- **NFR-001:** OAuth tokens stored encrypted at rest (user_identities.access_token_enc)
- **NFR-002:** Rauthy access tokens have max 15-minute TTL; refresh tokens 14 days
- **NFR-003:** Login-time membership resolution must complete in < 3 seconds
- **NFR-004:** Local email/password auth preserved as fallback during migration but hidden from UI

### Migration Strategy

1. Deploy new schema (additive — no breaking changes)
2. Wire Rauthy as OIDC provider
3. Add GitHub OAuth endpoints alongside existing auth
4. Switch UI to GitHub login (hide email/password forms)
5. Migrate existing admin users by linking GitHub identities
6. Remove old auth endpoints after transition period

---

## Phase 2: Self-Service Project Creation

### Scope

Authenticated org members can create projects through Statecraft, including repo creation, GitHub Actions wiring, and deployment preparation.

### FR-006: Project Creation Flow

```
Member signs in ──→ Org context established ──→ Create Project
                                                     │
                                   ┌─────────────────┼──────────────────┐
                                   │                 │                  │
                                   ▼                 ▼                  ▼
                            Create/link repo   Wire GH Actions   Provision deploy
                                   │                 │                  │
                                   └─────────────────┼──────────────────┘
                                                     ▼
                                              Project ready for
                                              governed pipeline
```

**Steps:**

1. User navigates to project creation in Statecraft
2. Statecraft checks `org_memberships` and org-level permission `project:create`
3. User provides: project name, description, adapter selection
4. Statecraft uses GitHub App installation token to:
   - Create repository in the org (or connect existing)
   - Seed repo with adapter template (from Factory adapters)
   - Configure branch protection rules
   - Create GitHub Actions workflow files
   - Set required secrets/variables
5. Statecraft creates:
   - `projects` row (linked to org)
   - `project_repos` row (linked to GitHub repo + installation)
   - `environments` rows (default: development, staging, production)
   - `project_members` row (creator as project admin)
6. Emit audit log entry: `project.created`
7. Return project dashboard URL

### FR-007: Org-Level Permissions

New permission model at org level:

| Permission | Default for `member` | Default for `admin` | Default for `owner` |
|------------|---------------------|---------------------|---------------------|
| `project:create` | yes | yes | yes |
| `project:delete` | no | yes | yes |
| `org:manage_members` | no | yes | yes |
| `org:manage_policies` | no | no | yes |
| `org:manage_billing` | no | no | yes |
| `factory:init` | yes | yes | yes |
| `factory:confirm` | no | yes | yes |
| `deploy:production` | no | no | yes |

These are stored as policy in the org context and evaluated at request time. The default can be overridden by OAP policy configuration.

### FR-008: GitHub Repo Initialization

When creating a new repo through Statecraft:

```typescript
async function createProjectRepo(orgInstallation: GitHubInstallation, params: {
  repoName: string;
  adapter: string;
  isPrivate: boolean;
}) {
  const installToken = await brokerInstallationToken(orgInstallation.installationId, {
    contents: 'write',
    administration: 'write',
    actions: 'write',
  });

  // 1. Create the repo
  const repo = await githubApi.createRepo(installToken, {
    org: orgInstallation.githubOrgLogin,
    name: params.repoName,
    private: params.isPrivate,
    auto_init: true,
  });

  // 2. Push adapter template contents
  await seedRepoFromAdapter(installToken, repo, params.adapter);

  // 3. Configure branch protection
  await githubApi.updateBranchProtection(installToken, repo, 'main', {
    required_status_checks: { strict: true, contexts: ['oap/verify'] },
    required_pull_request_reviews: { required_approving_review_count: 1 },
  });

  // 4. Create GitHub Actions workflow
  await createOapWorkflow(installToken, repo);

  return repo;
}
```

---

## Phase 3: Team Role Mapping + Sync

### Scope

- Map GitHub teams to OAP project/workspace roles
- Background membership sync job
- Revocation and session invalidation on org removal

### FR-009: GitHub Team to OAP Role Mapping

```sql
CREATE TABLE github_team_role_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  github_team_slug TEXT NOT NULL,
  github_team_id  BIGINT NOT NULL,
  target_scope    TEXT NOT NULL,    -- 'org' | 'project'
  target_id       UUID,            -- NULL for org-level, project_id for project-level
  role            TEXT NOT NULL,    -- platform_role or project_member_role
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, github_team_slug, target_scope, target_id)
);
```

Admin configures mappings:
- GitHub team `engineering` -> org role `member` (default)
- GitHub team `platform-leads` -> org role `admin`
- GitHub team `project-x-devs` -> project `X` role `developer`
- GitHub team `deploy-approvers` -> project `X` role `deployer`

### FR-010: Membership Sync Job

- Runs on configurable schedule (default: every 6 hours)
- For each active installation:
  - Fetch org members via GitHub App API
  - Compare against `org_memberships`
  - Add new members, mark removed members as `status = 'removed'`
  - Fetch team memberships for mapped teams
  - Update project-level roles accordingly
- Emit audit events for all changes

### FR-011: Revocation

When a user is removed from a GitHub org (detected via sync or webhook):
- Set `org_memberships.status = 'removed'`
- Revoke active Rauthy sessions for that user+org combination
- Emit audit log entry: `membership.revoked`
- Do NOT delete user data or project contributions

### FR-012: Org Picker (Multi-Org Users)

When a user belongs to multiple installed orgs:
- After GitHub login, redirect to `/auth/org-select`
- Display list of available orgs with roles
- User selects org -> Rauthy session claims updated with selected org context
- Org selection persisted in session; switchable from app header

---

## Phase 4: Enterprise OIDC Federation

### Scope

- Support additional upstream identity providers via Rauthy (Azure AD, Okta, Google Workspace)
- SAML-to-OIDC bridge for enterprise SSO (deferred — requires Rauthy SAML upstream support or sidecar proxy)
- JIT provisioning from enterprise IdPs
- Custom claims mapping per enterprise tenant
- Email-domain-based IdP routing on the sign-in page
- Admin API for OIDC provider and group-to-role mapping CRUD
- Desktop PKCE flow generalization (route through Rauthy for enterprise IdPs)

### Data Model

#### New Tables

```sql
-- Per-org OIDC provider registration
CREATE TABLE oidc_providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  name            TEXT NOT NULL,                            -- display name
  provider_type   TEXT NOT NULL DEFAULT 'oidc',             -- oidc | azure-ad | okta | google-workspace | saml-bridge
  issuer          TEXT NOT NULL,                            -- OIDC issuer URL
  client_id       TEXT NOT NULL,
  client_secret_enc TEXT NOT NULL,                          -- encrypted client secret
  scopes          TEXT NOT NULL DEFAULT 'openid profile email',
  claims_mapping  JSONB NOT NULL DEFAULT '{}',              -- map IdP claim names to OAP fields
  email_domain    TEXT,                                     -- for domain-based IdP routing
  auto_provision  BOOLEAN NOT NULL DEFAULT true,            -- JIT user provisioning
  status          TEXT NOT NULL DEFAULT 'active',           -- active | disabled | pending
  UNIQUE(org_id, issuer)
);

-- Map IdP groups to OAP roles (analogous to github_team_role_mappings)
CREATE TABLE oidc_group_role_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  provider_id     UUID NOT NULL REFERENCES oidc_providers(id) ON DELETE CASCADE,
  idp_group_id    TEXT NOT NULL,        -- group ID from the IdP
  idp_group_name  TEXT,                 -- display name
  target_scope    target_scope NOT NULL, -- 'org' | 'project'
  target_id       UUID,                 -- NULL for org-level
  role            TEXT NOT NULL,
  UNIQUE(org_id, provider_id, idp_group_id, target_scope, target_id)
);
```

#### Modified Tables

```sql
ALTER TYPE membership_source ADD VALUE 'oidc';
ALTER TABLE desktop_refresh_tokens ALTER COLUMN github_login DROP NOT NULL;
ALTER TABLE users ADD COLUMN idp_provider TEXT;
ALTER TABLE users ADD COLUMN idp_subject TEXT;
```

### FR-013: Enterprise OIDC Login Flow

```
Browser                  Statecraft              Rauthy              Enterprise IdP
  │                         │                      │                      │
  ├─ GET /auth/oidc ────────►                      │                      │
  │  (?provider=X&email=Y)  │                      │                      │
  │                         ├─ redirect ───────────►                      │
  │  ◄──────────────────────┤  (authorize + hint)  │                      │
  │                         │                      ├─ redirect ───────────►
  │                         │                      │  (upstream IdP)      │
  │  (user authenticates)   │                      │                      │
  │                         │                      │  ◄───────────────────┤
  │  ◄─────────────────────────────────────────────┤  callback + code    │
  │                         │                      │                      │
  ├─ GET /auth/oidc/cb ────►│                      │                      │
  │  (with ?code=xxx)       ├─ exchange code ──────►                      │
  │                         │  ◄───────────────────┤ tokens (id_token)    │
  │                         │                      │                      │
  │                         ├─ JIT provision user                        │
  │                         ├─ resolve OIDC group memberships            │
  │                         ├─ issue Rauthy session                      │
  │                         │                                             │
  │  ◄──────────────────────┤  Set-Cookie (__session)                    │
```

**Server-side steps after receiving Rauthy tokens:**

1. Decode the ID token to extract user claims (email, name, sub, groups)
2. Apply `claims_mapping` from the `oidc_providers` row to normalize claim names
3. JIT provision: find or create OAP user by IdP subject, then email
4. Upsert `user_identities` row with provider tokens
5. Resolve org membership from OIDC group claims using `oidc_group_role_mappings`
6. If no group mappings exist, assign default "member" role in provider's org
7. Ensure Rauthy user exists (provision via admin API if needed)
8. Issue Rauthy session with custom claims (including `idp_provider`, `idp_login`)
9. Route by org count (same as GitHub flow: 0 → no-org, 1 → auto, N → picker)

### FR-014: Email-Domain IdP Routing

The sign-in page presents both GitHub login and an enterprise email field:

1. User enters their work email address
2. Frontend calls `GET /auth/oidc/discover?email=user@company.com`
3. Server looks up `oidc_providers` where `email_domain = 'company.com'` and `status = 'active'`
4. If found: redirect to `/auth/oidc?provider=<id>&email=<email>`
5. If not found: show "no enterprise provider configured" message

### FR-015: OIDC Group-to-Role Mapping

Enterprise IdPs send group membership in the ID token (typically the `groups` claim). Admins configure mappings via the admin API:

- `POST /admin/orgs/:orgId/oidc-providers/:providerId/group-mappings`
- Each mapping: IdP group ID → OAP role (org-level or project-level)
- At login, the highest-privilege matching role wins for org-scope
- Project-scope mappings upsert `project_members`
- If no group mappings are configured, default to `member` role

### FR-016: JIT User Provisioning

When a user logs in via enterprise OIDC for the first time:

1. Check `user_identities` for existing `(provider, sub)` match → link if found
2. Check `users` for email match → link IdP identity if found
3. If no match and `auto_provision = true` on the provider: create new user
4. If no match and `auto_provision = false`: reject with "user not pre-provisioned" error
5. Set `users.idp_provider` and `users.idp_subject` for future lookups

### FR-017: OIDC Provider Admin API

Full CRUD for org-scoped OIDC providers:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/orgs/:orgId/oidc-providers` | GET | List all providers |
| `/admin/orgs/:orgId/oidc-providers` | POST | Create provider |
| `/admin/orgs/:orgId/oidc-providers/:id` | PUT | Update provider |
| `/admin/orgs/:orgId/oidc-providers/:id` | DELETE | Delete provider (cascades group mappings) |
| `/admin/orgs/:orgId/oidc-providers/:id/group-mappings` | GET | List group mappings |
| `/admin/orgs/:orgId/oidc-providers/:id/group-mappings` | POST | Create group mapping |
| `/admin/orgs/:orgId/oidc-providers/:id/group-mappings/:id` | DELETE | Delete group mapping |

All admin endpoints require `admin` or `owner` platform role in the target org.

### FR-018: Desktop PKCE Enterprise Support

Desktop PKCE flow accepts an optional `idp_hint` parameter:

- `GET /auth/desktop/authorize?...&idp_hint=<email-or-provider-id>`
- If `idp_hint` resolves to an OIDC provider: route through Rauthy authorize
- If not: fall back to GitHub OAuth (existing behavior)
- Deep-link callback and token exchange remain the same

### FR-019: Generalized Auth Types

All auth types made provider-agnostic:

- `OapClaims`: `github_login` → optional; add `idp_provider`, `idp_login`
- `AuthData`: `githubLogin` → always present but may be empty; add `idpProvider`, `idpLogin`
- `AuthUser` (Rust): `github_login` → `#[serde(default)]`; add `idp_provider`, `idp_login`
- `AuthOrg` (Rust): add `org_display_name` for provider-agnostic display
- Frontend types updated accordingly

### Non-Functional Requirements

- **NFR-005:** OIDC client secrets stored encrypted in `oidc_providers.client_secret_enc`
- **NFR-006:** JIT provisioning must complete in < 3 seconds (same SLA as GitHub login)
- **NFR-007:** Rauthy upstream provider config injected via Helm values and K8s secrets
- **NFR-008:** SAML-to-OIDC bridge deferred pending Rauthy native support or sidecar evaluation

### Rauthy Helm Chart Changes

- `values.yaml`: new `upstreamProviders` array for upstream IdP configuration
- `configmap.yaml`: renders `[[upstream_auth_provider]]` TOML blocks
- `statefulset.yaml`: injects upstream client ID/secret as env vars from K8s secrets

---

## Phase 5: Desktop OIDC + Admin UI + Auth Hardening

### Scope

- Fix desktop OIDC callback routing (FR-018 gap from Phase 4)
- Add `idp_hint` parameter to desktop auth command
- Fix keychain key consistency for `auth_get_status`
- Admin UI for OIDC provider and group-mapping management
- Status enum validation on OIDC provider updates

### FR-020: Desktop OIDC Callback Routing

The Phase 4 OIDC callback (`/auth/oidc/callback`) only handled the web flow. When a desktop flow initiated via `/auth/desktop/authorize?idp_hint=...` reached the OIDC callback, it would redirect to the web app instead of issuing an `opc://` deep-link.

**Fix:** The OIDC callback now checks `pendingDesktopFlows` (from `desktop-state.ts`) before routing. If the state belongs to a desktop flow, it generates a one-time auth code via `storeDesktopSession()` and redirects to the `opc://auth/callback` deep-link — identical to the GitHub desktop path.

### FR-021: Desktop Enterprise Login Command

The Tauri `auth_start_login` command now accepts an optional `idp_hint` parameter (email address or OIDC provider ID). When provided, the `/auth/desktop/authorize` endpoint routes through Rauthy's OIDC authorization instead of GitHub OAuth.

The desktop `AuthContext` exposes `login(idpHint?: string)` so the frontend can trigger either GitHub or enterprise login.

### FR-022: Keychain Consistency

All Tauri auth commands (`auth_handle_callback`, `auth_select_org`, `auth_refresh_token`) now write both the `session` and `refresh_token` keychain entries. Previously only `refresh_token` was written during login, causing `auth_get_status` (which reads `session`) to always return `unauthenticated` after a fresh login.

### FR-023: OIDC Provider Admin UI

New route `/admin/oidc-providers` provides CRUD for enterprise OIDC providers and group-to-role mappings:

- List all OIDC providers with status badges
- Create new provider (name, type, issuer, client ID, secret, email domain, auto-provision toggle)
- Enable/disable providers
- Delete providers (cascades group mappings)
- Select a provider to view/manage its group-to-role mappings
- Create and delete group-to-role mappings with scope-appropriate role selection

### FR-024: Status Enum Validation

`updateOidcProvider` now validates the `status` field against the allowed set (`active`, `disabled`, `pending`) and returns a 400 error for invalid values.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| GitHub org membership visibility requires specific OAuth scopes | Login fails silently | Request `read:org` scope; fail explicitly with actionable error |
| App installation does not auto-authorize all members | Over-permissioning | Default to `member` role; sensitive roles require explicit OAP assignment |
| Rauthy upstream provider config complexity | Deployment friction | Provide tested Helm values and init scripts |
| Sync lag between GitHub org changes and OAP state | Stale access | Login-time re-sync + background job + webhook for immediate revocation |
| GitHub rate limits on membership API calls | Sync failures for large orgs | Cache membership, use conditional requests (ETags), exponential backoff |
| OAuth token storage security | Token theft | Encrypt at rest, short-lived access tokens, audit token usage |

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Rauthy deployment | Deployed (Helm chart in `platform/charts/rauthy/`) | Needs upstream provider config |
| GitHub App | Configured (webhook + token brokering working) | Needs OAuth App registration |
| Encore auth handler | Stub exists (`AuthData = null`) | Must be wired to Rauthy JWT validation |
| Drizzle migrations | Infrastructure exists | New migration for identity tables |

## Test Plan

### Phase 1

- [ ] GitHub App installation creates `github_installations` + `organizations` row
- [ ] GitHub App uninstall sets `installation_state = 'deleted'`, preserves data
- [ ] GitHub OAuth login creates user, resolves org membership, issues Rauthy session
- [ ] Login with zero matching orgs redirects to `/auth/no-org` with login handle
- [ ] Login with one matching org auto-selects and redirects to `/app`
- [ ] Login with multiple matching orgs redirects to `/auth/org-select`
- [ ] Token exchange failure shows "GitHub authentication failed" (`token_failed`)
- [ ] GitHub API failure shows "Could not reach GitHub" (`github_api_failed`)
- [ ] Account DB error shows "Failed to create or link your account" (`account_error`)
- [ ] Rauthy unavailable shows "Identity service is temporarily unavailable" (`rauthy_unavailable`)
- [ ] Membership resolution failure shows actionable error (`membership_failed`)
- [ ] Rauthy JWT carries correct OAP claims (`oap_org_id`, `platform_role`)
- [ ] Encore auth handler rejects expired/invalid JWTs
- [ ] All existing API endpoints enforce auth via Encore auth handler
- [ ] OPC PKCE flow issues valid Rauthy tokens
- [ ] Token refresh works without re-login

### Phase 2

- [ ] Member with `project:create` can create project
- [ ] Member without `project:create` gets 403
- [ ] Repo creation in GitHub org succeeds with correct template
- [ ] Branch protection configured on new repo
- [ ] GitHub Actions workflow created
- [ ] Project + repo + env + member records created atomically
- [ ] Audit log captures project creation with actor identity

### Phase 3

- [ ] Team-to-role mapping correctly assigns project roles
- [ ] Sync job detects and processes membership changes
- [ ] Org removal revokes sessions and marks membership removed
- [ ] Org picker works for multi-org users
- [ ] Org switch updates session claims

### Phase 4

- [ ] OIDC provider CRUD: create, list, update, delete via admin API
- [ ] OIDC group mapping CRUD: create, list, delete via admin API
- [ ] Email-domain discovery: `/auth/oidc/discover` returns provider for known domain
- [ ] Email-domain discovery: returns `found: false` for unknown domain
- [ ] Enterprise login redirect: `/auth/oidc?provider=X` redirects to Rauthy authorize
- [ ] OIDC callback: code exchange with Rauthy returns valid tokens
- [ ] JIT provisioning: new user created on first OIDC login
- [ ] JIT provisioning: existing user linked by email on OIDC login
- [ ] JIT provisioning: existing user linked by IdP subject on OIDC login
- [ ] JIT provisioning: rejected when `auto_provision = false` and user not found
- [ ] OIDC group claims: mapped to org-level platform role via group mappings
- [ ] OIDC group claims: mapped to project-level role via group mappings
- [ ] OIDC group claims: highest-privilege org role wins when multiple groups match
- [ ] OIDC group claims: default `member` role when no group mappings exist
- [ ] OIDC login with zero matching orgs redirects to `/auth/no-org`
- [ ] OIDC login with one org auto-selects and redirects to `/app`
- [ ] OIDC login with multiple orgs redirects to org picker
- [ ] Rauthy JWT carries `idp_provider` and `idp_login` claims for enterprise users
- [ ] Rauthy JWT omits `github_login` for enterprise users
- [ ] Auth handler populates `idpProvider` and `idpLogin` in `AuthData`
- [ ] Existing GitHub login flow unaffected (backward compatible)
- [ ] Sign-in page shows both GitHub button and enterprise email field
- [ ] Org picker displays `orgDisplayName` (not just `githubOrgLogin`)
- [ ] No-org page shows correct messaging for enterprise IdP users
- [ ] Desktop PKCE with `idp_hint` routes through Rauthy for enterprise IdP
- [ ] Desktop PKCE without `idp_hint` routes through GitHub (backward compatible)
- [ ] `desktop_refresh_tokens.github_login` nullable — enterprise users store empty
- [ ] Helm chart renders upstream provider TOML blocks from `upstreamProviders` values
- [ ] Helm chart injects upstream client secrets from K8s secret refs
- [ ] Admin endpoints enforce org-admin permission (403 for members)
- [ ] Audit log captures OIDC provider and group mapping CRUD events
- [ ] Audit log captures `user.oidc_login` events with provider metadata

### Phase 5

- [ ] Desktop OIDC callback generates `opc://` deep-link (not web redirect)
- [ ] Desktop OIDC callback stores session via `storeDesktopSession()` for PKCE exchange
- [ ] Desktop OIDC with zero orgs returns error code in deep-link
- [ ] Desktop OIDC with multiple orgs sets `multi_org=true` in deep-link
- [ ] `auth_start_login` accepts optional `idp_hint` parameter
- [ ] `idp_hint` with email routes through enterprise OIDC
- [ ] `idp_hint` with provider ID routes through enterprise OIDC
- [ ] `idp_hint` absent routes through GitHub (backward compatible)
- [ ] `auth_get_status` returns `authenticated` after fresh login (keychain fixed)
- [ ] `auth_handle_callback` writes both `session` and `refresh_token` to keychain
- [ ] `auth_select_org` writes both `session` and `refresh_token` to keychain
- [ ] `auth_refresh_token` updates `session` keychain entry
- [ ] Admin UI: `/admin/oidc-providers` route loads for admin users
- [ ] Admin UI: create OIDC provider form submits successfully
- [ ] Admin UI: provider list displays with status badges
- [ ] Admin UI: enable/disable toggle updates provider status
- [ ] Admin UI: delete provider removes it and cascades group mappings
- [ ] Admin UI: group-mapping CRUD (create, list, delete)
- [ ] Admin UI: scope-aware role dropdown (org roles vs project roles)
- [ ] `updateOidcProvider` rejects invalid status values with 400

## Phase 6: Session Lifecycle, User Governance + Auth Hardening

Phase 5 completed the authentication flows. Phase 6 closes the operational gaps: admins cannot see or revoke active sessions, the `users.disabled` column is never enforced, signout only clears cookies without revoking server-side state, the audit log has no pagination or filtering, and auth endpoints have no rate limiting.

### FR-025: Enforce `users.disabled`

The `users.disabled` column exists in the schema but is never checked. Phase 6 wires it into the auth flow and provides admin controls:

1. **Auth handler check**: After JWT validation succeeds, the auth handler queries the `users` table to verify `disabled = false`. A disabled user's valid JWT is rejected with 403. The check uses a short-lived in-memory cache (60s TTL) to avoid a DB round-trip on every request.
2. **Admin disable/enable endpoint**: `POST /admin/users/set-disabled` accepts `{ userId, disabled }`. On disable, it also revokes all Rauthy sessions and deletes all desktop refresh tokens for the user.
3. **Admin UI toggle**: The users list shows a disable/enable button. Disabling shows a confirmation prompt.
4. **Audit**: `user.disabled` and `user.enabled` events logged with actor identity.

### FR-026: Active Session Management

The `sessions` table exists but is unused. Phase 6 repurposes the `desktop_refresh_tokens` table (which already tracks active desktop sessions) and adds a new admin API for session visibility:

1. **Admin session listing**: `GET /admin/users/:userId/sessions` returns all active desktop refresh tokens for a user (device info derived from `idpProvider`, creation time, expiry).
2. **Admin force-revoke**: `DELETE /admin/users/:userId/sessions` revokes all Rauthy sessions for the user and deletes all desktop refresh tokens. Audit-logged as `user.sessions_revoked`.
3. **Admin revoke single session**: `DELETE /admin/users/:userId/sessions/:tokenId` deletes one desktop refresh token.

### FR-027: Server-Side Signout

The current signout endpoints only clear the `__session` cookie. Phase 6 makes signout actually revoke server-side state:

1. **Web signout** (`POST /auth/signout`): Now authenticated. Reads the user ID from the JWT, calls `revokeSession(rauthyUserId)` to invalidate all Rauthy sessions, deletes all `desktop_refresh_tokens` for the user, then clears the cookie.
2. **Audit**: `user.signout` event logged.

### FR-028: Audit Log Pagination and Filtering

The current audit API returns a hard-coded 200 rows with no filtering. Phase 6 adds:

1. **Cursor pagination**: `GET /admin/audit?cursor=<id>&limit=50` — default limit 50, max 200. Returns `nextCursor` when more rows exist.
2. **Filters**: `action`, `actorUserId`, `targetType`, `targetId`, `from` (ISO date), `to` (ISO date). All optional, AND-combined.
3. **Admin UI update**: Adds filter dropdowns for action and target type, a date range picker, and infinite-scroll pagination.

### FR-029: Auth Endpoint Rate Limiting

In-memory sliding-window rate limiter protecting auth endpoints from brute force:

1. **IP-based rate limit**: 20 requests per minute per IP on `/auth/github`, `/auth/github/callback`, `/auth/oidc`, `/auth/oidc/callback`, `/auth/desktop/authorize`, `/auth/desktop/token`, `/auth/desktop/refresh`.
2. **Implementation**: Lightweight in-memory Map with 1-minute window. Returns 429 with `Retry-After` header when exceeded.
3. **Cleanup**: Expired entries pruned every 5 minutes.

### FR-030: Org-Scoped Admin User Listing

The current `listUsers` endpoint returns all users across all orgs:

1. **Scope to caller's org**: `GET /admin/users` filters by the caller's `orgId` — joins through `org_memberships` to return only users who are members of the caller's org.
2. **User detail enrichment**: Each user row now includes `lastLoginAt` and active session count (count of non-expired desktop refresh tokens).

---

### Phase 6 Test Plan

- [ ] Auth handler rejects JWT for a disabled user with 403
- [ ] Auth handler allows JWT for an enabled user
- [ ] Disabled-user cache expires after 60s (re-enabled user can authenticate)
- [ ] `POST /admin/users/set-disabled` disables a user
- [ ] `POST /admin/users/set-disabled` enables a previously disabled user
- [ ] Disabling a user revokes their Rauthy sessions
- [ ] Disabling a user deletes their desktop refresh tokens
- [ ] Disabling a user emits `user.disabled` audit event
- [ ] Enabling a user emits `user.enabled` audit event
- [ ] Admin cannot disable themselves
- [ ] `GET /admin/users/:userId/sessions` returns active desktop sessions
- [ ] `DELETE /admin/users/:userId/sessions` revokes all sessions for user
- [ ] `DELETE /admin/users/:userId/sessions/:tokenId` revokes single session
- [ ] Session revocation emits `user.sessions_revoked` audit event
- [ ] `POST /auth/signout` revokes Rauthy sessions (authenticated)
- [ ] `POST /auth/signout` deletes desktop refresh tokens
- [ ] `POST /auth/signout` clears `__session` cookie
- [ ] `POST /auth/signout` emits `user.signout` audit event
- [ ] `GET /admin/audit?cursor=X&limit=50` returns paginated results
- [ ] `GET /admin/audit?action=user.github_login` filters by action
- [ ] `GET /admin/audit?actorUserId=X` filters by actor
- [ ] `GET /admin/audit?targetType=user` filters by target type
- [ ] `GET /admin/audit?from=2026-04-01&to=2026-04-13` filters by date range
- [ ] Audit response includes `nextCursor` when more rows exist
- [ ] Rate limiter returns 429 after 20 requests/minute to auth endpoints
- [ ] Rate limiter includes `Retry-After` header in 429 response
- [ ] Rate limiter allows requests after window expires
- [ ] `GET /admin/users` returns only users in caller's org
- [ ] `GET /admin/users` includes `lastLoginAt` per user
- [ ] `GET /admin/users` includes active session count per user
- [ ] Admin UI: disable/enable toggle on user list
- [ ] Admin UI: session list and revoke buttons on user detail
- [ ] Admin UI: audit log filter controls and pagination
