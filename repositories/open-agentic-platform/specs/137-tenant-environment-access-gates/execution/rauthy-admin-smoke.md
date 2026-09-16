# Rauthy admin API smoke — spec 137 T003 evidence

**Date:** 2026-05-15
**Cluster:** oap-hetzner-master1
**Rauthy version:** 0.35 (per `rauthy.ts:7` source comment + observed
client schema)
**Execution path:** `statecraft-api-958cc6495-gp6nl` pod →
`http://rauthy.rauthy-system.svc.cluster.local:8080` (in-cluster;
required because Rauthy `PROXY_MODE=true` rejects external admin
requests with `400 BadRequest "Invalid IP Address"`).

Raw JSON evidence: [`rauthy-admin-smoke.json`](./rauthy-admin-smoke.json)

## Summary

| Assumption | Result |
|---|---|
| (a) Admin API tolerates ≥10 clients | **PASS** — 10/10 clients created; response times 2–59ms (first-call JIT warmup; steady-state 2–3ms) |
| (b) `DELETE /clients/{id}` is clean | **PASS** — status 200; immediate GET returns 404 "no rows returned" |
| (c) Toggle `password_login_enabled` is PATCHable (not recreate-only) | **PASS via PUT** — but the field doesn't exist; see correction below |
| (d) `auth_provider_id` reference on client creation | **N/A** — no upstream Auth Providers configured in this Rauthy instance at smoke time |

## Empirical findings

### Rauthy 0.35 has NO `password_login_enabled` field

The spec.md §"Access-gate contract" lists `password_login_enabled:
false` as a Rauthy client field and FR-004 names it the load-bearing
constraint. The empirical client schema is:

```
[access_token_alg, access_token_lifetime, auth_code_lifetime,
 challenges, confidential, default_scopes, enabled, flows_enabled,
 force_mfa, id, id_token_alg, name, redirect_uris, scopes]
```

(14 fields; observed read-back of the `statecraft-server` client.)

**Password login is controlled via `flows_enabled` array.** A client
with `flows_enabled: ["authorization_code"]` (omitting `"password"`)
cannot complete a password login. A client with `flows_enabled:
["authorization_code", "password"]` permits both. There is no scalar
flag separate from the flows array.

This is a correction to the spec, not a softening: the
load-bearing intent (platform never sees passwords) is preserved
verbatim; the *mechanism* is `flows_enabled` not
`password_login_enabled`. Pre-implementation spec amendment lands
alongside this evidence (see
[`feedback_pre_implementation_spec_amendments`](../../../../../.claude/projects/-Users-bart-Dev2-open-agentic-platform/memory/feedback_pre_implementation_spec_amendments.md)
discipline).

### PUT is the update verb; no PATCH endpoint

The (c) probe rotated `flows_enabled` `[authorization_code]` →
`[authorization_code, password]` → `[authorization_code]` via two
`PUT /auth/v1/clients/{id}` calls with the full client object in
the body. Both PUTs returned status 200. There is no `PATCH
/auth/v1/clients/{id}` endpoint in Rauthy 0.35; updates are
full-object PUTs.

### Provider binding shape — N/A until first provider lands

Rauthy lists upstream providers via `POST /auth/v1/providers` (Rauthy
0.35 quirk: POST returns the list, not GET — confirmed by
`seed-rauthy.mjs:140-141` and by this smoke). At smoke time the
list was empty — no GitHub / Google / Microsoft providers are
configured yet on this Rauthy instance. Decision 3 (d) cannot be
empirically validated against zero providers; binding-shape
verification is deferred to the Phase 3 PR that provisions the
first Auth Provider.

The reference-schema readback on the existing `statecraft-server`
client does NOT include any `auth_provider_id` or `provider_id`
field, which suggests provider binding may NOT live on the client
record at all in Rauthy 0.35 — instead, providers are listed
per-login at the OIDC authorize endpoint and the user picks one.
This is a meaningful architecture observation: the spec's
§"Access-gate contract" `provider_client_ref` field may not map
to a Rauthy client field; instead, the upstream IdP choice
happens at login time, scoped by the configured providers list.
Phase 3 confirms or amends this when it lands a probe against
the first non-empty providers list.

## Latency profile

10-client volume probe:

```
First call:  59 ms (Node fetch JIT warmup)
Subsequent:  2–3 ms each
Steady-state mean: 8 ms (driven by the first-call outlier)
```

Hetzner cluster pod-to-pod hop is ~1ms; the remaining ~1–2ms is
Rauthy's hiqlite write path. At an estimated 10 gated environments
in the first year, gate provisioning latency is not a concern.
Decision 1's per-env topology stays correct.

## Cleanup

All 10 smoke clients were deleted at end of run. Post-cleanup
verification: `0` remaining `spec-137-smoke-*` clients in the
corpus. Rauthy state restored to pre-smoke baseline.

## Disposition

- Decision 3 (a) (b) (c) **resolved** with empirical evidence (PASS).
- Decision 3 (d) **deferred** to Phase 3 (`auth_provider_id` binding
  shape verification when first provider is provisioned).
- Decision 5 collision-handling clause **amended** in
  `clarifications-resolved.md` to reflect `flows_enabled` semantics
  (no `password_login_enabled` field).
- Spec.md §"Access-gate contract" + FR-004 **amended** to replace
  `password_login_enabled: false` with `flows_enabled: subset
  excluding "password"` framing.
- T003 ticked; T007 (status: draft → approved) now unblocked.
