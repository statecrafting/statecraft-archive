---
id: "107-rauthy-client-redirect-convergence"
title: "Rauthy OIDC Client Redirect URI Convergence"
feature_branch: "feat/107-rauthy-client-redirect-convergence"
status: approved
implementation: complete
owner: bart
created: "2026-04-18"
kind: platform
domain: platform
risk: medium
depends_on:
  - "080-github-identity-onboarding"  # github-identity-onboarding (desktop PKCE scheme, error codes)
  - "106-rauthy-native-oidc-and-membership"  # rauthy-native-oidc-and-membership (seeder + client grants)
code_aliases: ["RAUTHY_CLIENT_REDIRECTS"]
extends:
  - spec: "106-rauthy-native-oidc-and-membership"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/scripts/seed-rauthy.mjs }
refines:
  - aspect: "redirect-uri-ownership"
    unit: { kind: file, path: platform/services/statecraft/web/README.md }
summary: >
  Close spec 106 FR-002's remaining manual gap: the seeder grants the `oap`
  scope to statecraft-server / SPA / OPC clients but does not manage their
  allowed `redirect_uris`. A production outage on 2026-04-18 showed why —
  Rauthy rejected `/authorize` with "Invalid redirect uri" because the
  statecraft-server client's allow-list did not include the current
  `APP_BASE_URL` callback. This spec extends the seeder to converge
  redirect URIs for every OIDC client statecraft owns, deriving the target
  set from `APP_BASE_URL` and the OPC desktop deep-link scheme, and
  merging them with any operator-added entries (so localhost dev URIs are
  preserved).
---

# 107 — Rauthy OIDC Client Redirect URI Convergence

## 1. Problem Statement

Spec 106 FR-002 added an idempotent statecraft → Rauthy seeder that ensures
the GitHub upstream IDP, OAP custom attributes, the `oap` scope, and scope
grants onto the statecraft-server / SPA / OPC OIDC clients. The seeder
stops at scope grants. It never inspects or converges each client's
`redirect_uris` allow-list.

That gap bit us on 2026-04-18: the `statecraft-server` client's
`redirect_uris` in `auth.statecraft.ing` did not contain
`https://statecraft.ing/auth/rauthy/callback`, so every production login
hit the Rauthy authorize endpoint and returned `400 Invalid redirect uri`.
The fix required an operator to add the URI manually in the Rauthy admin
UI. The same class of failure is reproducible on any new deployment, any
`APP_BASE_URL` change, and any helm-re-install that loses local state —
and none of those steps are guarded by CI.

Root cause: the seeder's contract ends one field short of what Rauthy
actually validates at `/oidc/authorize`. The authorize check is:

```
request.redirect_uri ∈ client.redirect_uris
```

If the right side of that set-membership test is left for humans to
maintain, every deploy is one `APP_BASE_URL` change away from a login
outage.

## 2. Design

### 2.1 Single source of truth

Redirect URIs are derived from environment values already present in
`statecraft-api-secrets`:

- `APP_BASE_URL` — the canonical public origin for statecraft (e.g.
  `https://statecraft.ing`). Used to compute the two web callbacks.
- `OPC_REDIRECT_URI` (new, optional, default `opc://auth/callback`) —
  the OPC desktop deep-link. Hard-coded default matches
  `product/apps/opc/` PKCE scheme.

No new top-level secrets. No chart-values changes.

### 2.2 Per-client target set

| Client env var | Target `redirect_uris` (required subset) |
|---|---|
| `RAUTHY_CLIENT_ID` (statecraft-server, confidential) | `${APP_BASE_URL}/auth/rauthy/callback`, `${APP_BASE_URL}/auth/oidc/callback` |
| `OPC_CLIENT_ID` (OPC desktop, public, optional) | `${OPC_REDIRECT_URI}` |
| `OIDC_SPA_CLIENT_ID` (SPA, public, optional) | **unmanaged** in this spec; the SPA does not initiate `/authorize` in the current codebase. When it does, a follow-up spec adds its target set. |

The statecraft-server confidential client is the only non-optional
target. OPC is converged when `OPC_CLIENT_ID` is set in the env. SPA is
explicitly left alone.

### 2.3 Merge-over-replace

The seeder **merges** the target URIs into the existing
`redirect_uris` array rather than replacing it. Justification:

- Operators legitimately add localhost entries for dev flows (see
  `platform/services/statecraft/web/README.md` lines 53–56).
- The seeder has no opinion on a developer's laptop; it should only
  *guarantee* the prod URIs, not police the full set.
- Merge preserves any manually added SAML/test URIs while closing the
  specific outage we saw.

Stale entry cleanup remains an operator concern via the Rauthy admin
UI. A future spec can add a fully-declarative mode controlled by a
`REDIRECT_URIS_STRICT=1` env flag.

### 2.4 No-op when already correct

The seeder reads the current client via `GET /auth/v1/clients` (same
call it already makes for scope grants), computes the diff against the
required set, and issues `PUT /auth/v1/clients/{id}` only when at least
one required URI is missing. This keeps warm-start runs silent and
avoids gratuitous writes to hiqlite.

## 3. Functional Requirements

### FR-001: Client redirect URI convergence step

Extend `platform/services/statecraft/scripts/seed-rauthy.mjs` with a new
`ensureClientRedirectUris()` step, inserted **before**
`ensureClientScopeGrants()` in `main()`. The step:

1. Reads `APP_BASE_URL`, `RAUTHY_CLIENT_ID`, and optionally
   `OPC_CLIENT_ID`, `OPC_REDIRECT_URI`.
2. Builds the target redirect-URI set per client per §2.2.
3. Issues `GET /auth/v1/clients` (reuses the listing already fetched by
   `ensureClientScopeGrants` if both steps share a cache; otherwise a
   second GET is acceptable).
4. For each target client present in the listing, computes
   `missing = target \ existing.redirect_uris`. If `missing` is empty,
   logs a one-line no-op and continues. Otherwise issues
   `PUT /auth/v1/clients/{id}` with `{ ...existing, redirect_uris: [...existing.redirect_uris, ...missing] }`.
5. A target client absent from the listing is a hard error for
   `RAUTHY_CLIENT_ID` (fail-loud: the seeder cannot proceed). For
   `OPC_CLIENT_ID` it is a warn-and-skip (the desktop app may not be
   provisioned on every cluster).

Auth header: `API-Key <name>$<secret>` per spec 106 FR-003. Error
handling: any non-2xx response aborts the seeder with an operator-
facing message that names the client id and the Rauthy status code.

### FR-002: Validation step extended

`validateSeed()` is extended to re-read the statecraft-server client and
assert every target URI is present. If a URI the seeder just wrote back
is missing on re-read, abort with
`Validation: redirect_uris for ${clientId} missing ${uri}`. This catches
a silent Rauthy normalisation (trailing slash, case folding) at deploy
time instead of at first login.

### FR-003: APP_BASE_URL must be present

If `APP_BASE_URL` is unset or does not parse as an absolute `https://`
or `http://` URL, the seeder aborts before touching Rauthy with
`APP_BASE_URL missing or not absolute`. The chart already injects it via
`envFrom: statecraft-api-secrets`; this is a defensive fence against a
broken secret.

### FR-004: Docs record ownership

`platform/services/statecraft/web/README.md` is updated to note that
prod redirect URIs are auto-managed by the seeder; the existing
localhost guidance stays (operators still register those manually for
dev flows).

## 4. Non-Functional Requirements

- **NFR-001** Convergence step adds at most two round-trips per target
  client (GET list reuse + single PUT) and is skipped when already
  converged — p95 < 200 ms on a healthy Rauthy.
- **NFR-002** Seeder logs each client's final redirect URI *count*, not
  the URIs themselves. URIs are not secret but the seeder already
  follows log-minimalism; keep it consistent.
- **NFR-003** Idempotent on warm start (no writes when the URI set is
  already a superset of the target).

## 5. Security

| Risk | Mitigation |
|---|---|
| Seeder widens redirect allow-list to attacker-controlled URIs | URIs are derived only from `APP_BASE_URL` (sealed in KeyVault-backed secret) and a hard-coded `opc://` scheme — no user input path. |
| Merge-over-replace lets stale URIs linger and become an open redirect | Documented in §2.3; strict mode deferred to a follow-up spec. Admin UI remains the cleanup path. |
| Seeder crash leaves client in half-written state | Rauthy's `PUT /auth/v1/clients/{id}` is atomic; the pre-PUT GET means we never write a partial client. |

## 6. Migration

1. Ship the updated seeder image. First `helm upgrade` runs the job,
   which either confirms URIs are already present (after today's manual
   fix) or appends any missing ones.
2. No data migration. No downtime.
3. Rollback: revert the seeder change; the admin-UI-managed state from
   before this spec remains valid.

## 7. Supersedes / Amends

- **106 FR-002** — this spec **extends** step 4/5 (the client grant
  step) to also manage `redirect_uris`, not just `scopes`. The scope
  grant logic stays untouched. The seeder comment block is updated to
  describe the new responsibility.
- **080 FR-006** — no change. OPC's `opc://auth/callback` scheme is
  consumed by this spec as-is.

## 8. Test Plan

### Seeder
- [x] Cold start on empty Rauthy (client exists but without URIs):
      seeder PUTs with the target set; validation passes.
- [x] Warm start: seeder reports "already current" for every client.
- [x] `APP_BASE_URL` changes (prod → staging rebrand): next deploy
      appends the new URI; old URI stays (merge semantics).
- [x] `RAUTHY_CLIENT_ID` client missing: seeder aborts with a clear
      "statecraft-server client not found in Rauthy" error.
- [x] `OPC_CLIENT_ID` client missing: seeder logs a warning and
      continues (non-fatal).
- [x] Rauthy returns a 5xx mid-run: seeder aborts with Rauthy status
      code included in the log.

### Login flow
- [x] After seeder run on a fresh Hetzner cluster, first GitHub login
      via `https://statecraft.ing/auth/rauthy` succeeds without manual
      admin-UI intervention.
- [x] OPC desktop PKCE flow lands on `opc://auth/callback` without a
      manual redirect-URI add.

### Unit
- [x] `computeTargetRedirectUris("https://statecraft.ing")` returns the
      two expected callbacks in a deterministic order.
- [x] `diffRequired(existing, target)` returns only missing entries.
- [x] Merge is idempotent on a client that already contains the target
      set plus operator extras.

## Implementation Status

Landed across commits:

- `94fb795` — `feat(statecraft): seeder owns Rauthy client redirect URIs (spec 107)`
  added `computeTargetRedirectUris`, `convergeClient`, merge-over-replace
  semantics, and the extended `validateSeed` re-read.
- `aae87f8` — `fix(statecraft): seeder also converges flows_enabled on Rauthy clients`
  extended the same convergence step to cover `flows_enabled`
  (`authorization_code` + `refresh_token`) after first-login broke on a
  freshly-created client whose default flow list was
  `authorization_code` only.
- Subsequent Rauthy-adjacent hardening (`d59f847`, `0d7b8fd`, `7fef349`)
  fixed EdDSA JWT acceptance and trailing-slash `iss` matching on the
  validator side, unblocking the full spec 106 + 107 login path.

See `platform/services/statecraft/scripts/seed-rauthy.mjs` lines 269–475
for the converged implementation.

## 9. Out of scope

- **Strict-replace mode** that wipes operator-added URIs. A future spec
  may gate this behind `REDIRECT_URIS_STRICT=1`.
- **SPA client `redirect_uris`.** The SPA is not a `/authorize`
  initiator in the current code; add its target set when that changes.
- **`post_logout_redirect_uris` and `allowed_origins` convergence.**
  Same merge pattern would apply; scope kept to the URI that caused
  the 2026-04-18 outage.
- **Rotating RAUTHY_CLIENT_SECRET.** Secret rotation is a platform
  operations concern; this spec only touches redirect URIs.
