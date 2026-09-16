// Spec 137 Phase 3 — Rauthy admin client provisioning for tenant gates.
//
// Wraps the four-verb Rauthy admin API (GET / POST / PUT / DELETE on
// `/auth/v1/clients`) with statecraft's idempotent provision +
// deprovision flows for per-environment OIDC clients.
//
// Empirical contract (spec 137 T003, 2026-05-15):
// - Auth: `Authorization: API-Key <name>$<secret>` (not Bearer).
// - Update verb: full-object PUT (no PATCH endpoint exists).
// - Delete: 200 OK (not 204).
// - 14-field client schema; no `password_login_enabled` / `auth_provider_id`.
// - Admin endpoints are cluster-internal-only (PROXY_MODE rejects
//   external origins). In tests we point fetchOverride at a stub
//   server; in production statecraft-api runs in the trusted CIDR.

import log from "encore.dev/log";
import { rauthyUrl, buildRauthyAdminAuth } from "./rauthy";
import {
  assertNoPasswordFlow,
  buildTenantGateClientPayload,
  type RauthyClientPayload,
  type TenantGateClientSpec,
} from "./rauthyAdminClientsHelpers";

export {
  tenantGateClientId,
  tenantGateRedirectUri,
  buildTenantGateClientPayload,
  assertNoPasswordFlow,
  type TenantGateClientSpec,
  type RauthyClientPayload,
} from "./rauthyAdminClientsHelpers";

// ---------------------------------------------------------------------------
// Low-level admin verbs (fetch-injectable for tests)
// ---------------------------------------------------------------------------

type FetchLike = typeof globalThis.fetch;

interface AdminCallOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  authHeader?: string;
}

function resolveAdminContext(opts?: AdminCallOptions): {
  baseUrl: string;
  auth: string;
  fetchImpl: FetchLike;
} {
  return {
    baseUrl: (opts?.baseUrl ?? rauthyUrl()).replace(/\/+$/, ""),
    auth: opts?.authHeader ?? buildRauthyAdminAuth(),
    fetchImpl: opts?.fetchImpl ?? globalThis.fetch,
  };
}

export async function getRauthyClient(
  clientId: string,
  opts?: AdminCallOptions,
): Promise<RauthyClientPayload | null> {
  const { baseUrl, auth, fetchImpl } = resolveAdminContext(opts);
  const resp = await fetchImpl(
    `${baseUrl}/auth/v1/clients/${encodeURIComponent(clientId)}`,
    { headers: { Authorization: auth, Accept: "application/json" } },
  );
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`getRauthyClient ${clientId} failed: ${resp.status} ${body.slice(0, 300)}`);
  }
  return (await resp.json()) as RauthyClientPayload;
}

/**
 * POST /auth/v1/clients, then recover the freshly-minted confidential
 * client's secret.
 *
 * Rauthy 0.35 contract (verified against rauthy v0.35.0 source, 2026-06-30):
 * `POST /auth/v1/clients` returns a `ClientResponse` that does NOT carry a
 * secret field. The secret of a confidential client is exposed only by a
 * dedicated endpoint, `POST /auth/v1/clients/{id}/secret` (a POST on purpose
 * so the read gets a CSRF check), which returns
 * `ClientSecretResponse { id, confidential, secret }`. So we create, then
 * read the secret back.
 *
 * Back-compat: an older or forked Rauthy that inlines the secret on the
 * create response is still honoured by trying `secret` / `client_secret` on
 * the POST body first. Only when that is absent do we fall back to the
 * secret endpoint. If neither yields a secret we fail loud at the boundary:
 * the deploy descriptor cannot be assembled without it and a silent fallback
 * would surface as a useless oauth2-proxy that 401s every request.
 */
export async function createRauthyClient(
  payload: RauthyClientPayload,
  opts?: AdminCallOptions,
): Promise<{ clientSecret: string }> {
  assertNoPasswordFlow(payload);
  const { baseUrl, auth, fetchImpl } = resolveAdminContext(opts);
  const resp = await fetchImpl(`${baseUrl}/auth/v1/clients`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`createRauthyClient ${payload.id} failed: ${resp.status} ${body.slice(0, 400)}`);
  }
  // The create response on 0.35 carries no secret, but parse it anyway so a
  // version that does inline one still works. A non-JSON / empty body is not
  // an error here: the secret endpoint below is the canonical source.
  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  let secret = extractClientSecret(body);
  if (!secret) {
    // Canonical 0.35 path: read the secret back from the dedicated endpoint.
    secret = await fetchRauthyClientSecret(payload.id, opts);
  }
  if (!secret) {
    throw new Error(
      `createRauthyClient ${payload.id} succeeded but no client secret could be ` +
        `recovered from the create response or POST /auth/v1/clients/${payload.id}/secret. ` +
        `A confidential client must expose a secret; verify the client was created with ` +
        `confidential=true and that this Rauthy version supports the secret endpoint.`,
    );
  }
  return { clientSecret: secret };
}

/**
 * POST /auth/v1/clients/{id}/secret. Reads (does NOT rotate) a confidential
 * client's secret. Verified against rauthy v0.35.0: the route is a POST (a
 * deliberate CSRF check on a sensitive read), the handler `get_client_secret`
 * only reads, and the response is
 * `ClientSecretResponse { id, confidential, secret: Option<String> }`.
 *
 * Returns the secret string, or `null` when the client is absent (404) or is
 * a public (non-confidential) client with no secret. Throws on other non-ok
 * responses so callers see the real admin error.
 */
export async function fetchRauthyClientSecret(
  clientId: string,
  opts?: AdminCallOptions,
): Promise<string | null> {
  const { baseUrl, auth, fetchImpl } = resolveAdminContext(opts);
  const resp = await fetchImpl(
    `${baseUrl}/auth/v1/clients/${encodeURIComponent(clientId)}/secret`,
    { method: "POST", headers: { Authorization: auth, Accept: "application/json" } },
  );
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `fetchRauthyClientSecret ${clientId} failed: ${resp.status} ${body.slice(0, 300)}`,
    );
  }
  let parsed: unknown = null;
  try {
    parsed = await resp.json();
  } catch {
    return null;
  }
  return extractClientSecret(parsed);
}

function extractClientSecret(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const candidates = [obj.secret, obj.client_secret, obj.clientSecret];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

export async function putRauthyClient(
  payload: RauthyClientPayload,
  opts?: AdminCallOptions,
): Promise<void> {
  assertNoPasswordFlow(payload);
  const { baseUrl, auth, fetchImpl } = resolveAdminContext(opts);
  const resp = await fetchImpl(
    `${baseUrl}/auth/v1/clients/${encodeURIComponent(payload.id)}`,
    {
      method: "PUT",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`putRauthyClient ${payload.id} failed: ${resp.status} ${body.slice(0, 400)}`);
  }
}

export async function deleteRauthyClient(
  clientId: string,
  opts?: AdminCallOptions,
): Promise<{ existed: boolean }> {
  const { baseUrl, auth, fetchImpl } = resolveAdminContext(opts);
  const resp = await fetchImpl(
    `${baseUrl}/auth/v1/clients/${encodeURIComponent(clientId)}`,
    { method: "DELETE", headers: { Authorization: auth } },
  );
  if (resp.status === 404) return { existed: false };
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`deleteRauthyClient ${clientId} failed: ${resp.status} ${body.slice(0, 400)}`);
  }
  return { existed: true };
}

// ---------------------------------------------------------------------------
// Tenant gate domain operations (idempotent)
// ---------------------------------------------------------------------------

export interface ProvisionResult {
  clientId: string;
  /** `created` on first provision, `updated` on subsequent runs against an existing client. */
  action: "created" | "updated";
  /**
   * Non-null on `action === "created"` only. The secret is recovered at
   * create time via the dedicated secret endpoint (see
   * [`createRauthyClient`]); the caller SHOULD persist it (descriptor row)
   * to avoid re-reading on every assemble. On `"updated"` this is null and
   * the caller keeps its previously-persisted value, or recovers it
   * on demand via [`fetchRauthyClientSecret`].
   */
  clientSecret: string | null;
}

/**
 * Idempotent create-or-update of a tenant gate Rauthy client. Returns
 * the client_id statecraft writes into
 * `environment_access_gates.rauthy_client_ref`.
 *
 * Two branches:
 *   - Client absent → POST /auth/v1/clients (action="created")
 *   - Client present → PUT  /auth/v1/clients/:id with the full
 *                            statecraft-authoritative payload
 *                            (action="updated"). Per T003, Rauthy 0.35
 *                            has no PATCH endpoint; PUT is the only
 *                            non-destructive update verb.
 *
 * FR-004 guard: assertNoPasswordFlow runs inside both create and put,
 * so even a future code path that builds a payload by hand without
 * `buildTenantGateClientPayload` cannot accidentally enable password
 * grant.
 */
export async function provisionTenantGateClient(
  spec: TenantGateClientSpec,
  opts?: AdminCallOptions,
): Promise<ProvisionResult> {
  const payload = buildTenantGateClientPayload(spec);
  const existing = await getRauthyClient(spec.clientId, opts);
  if (existing === null) {
    const { clientSecret } = await createRauthyClient(payload, opts);
    log.info("rauthy.tenant_gate.client.created", { clientId: spec.clientId });
    return { clientId: spec.clientId, action: "created", clientSecret };
  }
  await putRauthyClient(payload, opts);
  log.info("rauthy.tenant_gate.client.updated", { clientId: spec.clientId });
  return { clientId: spec.clientId, action: "updated", clientSecret: null };
}

/**
 * Idempotent delete. Returns `{ existed }` so the caller can audit
 * "we tried, here's whether there was anything to remove."
 */
export async function deprovisionTenantGateClient(
  clientId: string,
  opts?: AdminCallOptions,
): Promise<{ existed: boolean }> {
  const result = await deleteRauthyClient(clientId, opts);
  log.info("rauthy.tenant_gate.client.deprovisioned", {
    clientId,
    existed: result.existed,
  });
  return result;
}
