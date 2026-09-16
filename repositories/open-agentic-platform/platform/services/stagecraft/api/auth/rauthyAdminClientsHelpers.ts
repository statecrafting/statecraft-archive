// Spec 137 Phase 3 — pure helpers for the Rauthy admin client surface.
//
// Lives separate from the network-bound wrapper so vitest can drive the
// request-shape construction without the Encore native runtime. Mirrors
// the cloneAvailabilityHelpers + accessGatesHelpers pattern.
//
// Rauthy 0.35 client schema (14 fields) was captured empirically by the
// spec 137 T003 smoke (2026-05-15). The constants here are anchored to
// that schema; if Rauthy adds a required field in a future version, the
// T003 smoke is the authoritative re-validation surface.

import type { FederatedProvider } from "../environments/accessGatesHelpers";

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/**
 * Subset of the Rauthy 0.35 client record statecraft writes when
 * provisioning a tenant gate. Other fields (`force_mfa`, etc.) are
 * either Rauthy-defaulted or out of scope for v1.
 */
export interface RauthyClientPayload {
  id: string;
  name: string;
  enabled: boolean;
  confidential: boolean;
  redirect_uris: string[];
  allowed_origins?: string[];
  flows_enabled: string[];
  access_token_alg: "EdDSA" | "RS256";
  id_token_alg: "EdDSA" | "RS256";
  auth_code_lifetime: number;
  access_token_lifetime: number;
  scopes: string[];
  default_scopes: string[];
  challenges: string[];
  force_mfa?: boolean;
}

/**
 * Input shape consumed by statecraft's tenant-gate provisioning path.
 * Captures what the API surface (or the future UI) needs to hand off
 * to the Rauthy admin client wrapper.
 */
export interface TenantGateClientSpec {
  /** Stable deterministic id (e.g. `tenant-gate-<environmentId>`). */
  clientId: string;
  /** Human-readable name shown in the Rauthy admin UI. */
  name: string;
  /** Single-environment hostname; produces the redirect URI + origin. */
  tenantHostname: string;
  /** True if magic-link login is enabled for this gate. */
  magicLinkEnabled: boolean;
  /** Non-null when federated login is configured. */
  federatedProvider: FederatedProvider | null;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Stable client id for a given environment. Determinism lets the
 * provisioning path idempotently look up + reconcile the client without
 * a side table mapping environment → rauthy client id.
 */
export function tenantGateClientId(environmentId: string): string {
  return `tenant-gate-${environmentId}`;
}

/**
 * The OAuth2 redirect URI the oauth2-proxy in front of the tenant
 * environment will use to complete the OIDC code flow. Hostname
 * convention is locked in `clarifications-resolved.md` §Decision 4.
 */
export function tenantGateRedirectUri(tenantHostname: string): string {
  return `https://${tenantHostname}/oauth2/callback`;
}

/**
 * Coerce a human-readable client name to Rauthy 0.35's name validation
 * contract. Rauthy validates the client `name` against
 * `[a-zA-Z0-9À-ɏ\-\s]{2,128}` and rejects the entire create/update with a
 * 400 otherwise. Punctuation that reads fine in statecraft's own UI (the
 * `·` separator, slashes, em/en dashes) sits outside that class, so a name
 * built by interpolating an environment id MUST be sanitized before the
 * network hop or "Enable gate" 400s. Disallowed runs collapse to a single
 * space; the result is trimmed and clamped to 128 chars. If sanitizing
 * leaves fewer than 2 chars, fall back to the (already-valid) client id so
 * the field is never empty.
 *
 * The allowed range `À-ɏ` is U+00C0–U+024F (Latin-1 supplement +
 * extended-A), matching Rauthy's regex byte-for-byte.
 */
export function sanitizeRauthyClientName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9À-ɏ\-\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 128);
  return cleaned.length >= 2 ? cleaned : fallback.slice(0, 128);
}

/**
 * Build the Rauthy admin client payload for create + update. Hard-codes
 * the load-bearing FR-004 invariant: `flows_enabled` NEVER contains
 * `"password"`. Magic link is implicit in `authorization_code` (Rauthy
 * surfaces both auth options via the same login flow).
 */
export function buildTenantGateClientPayload(
  spec: TenantGateClientSpec,
): RauthyClientPayload {
  // FR-004 invariant: password grant type is never present. The
  // `flows_enabled` array is the only mechanism Rauthy 0.35 exposes for
  // this (per T003 — there is no scalar `password_login_enabled`).
  const flows: string[] = ["authorization_code"];
  // Refresh tokens are out for v1: each call to the tenant gate
  // produces a fresh OIDC flow. Adding refresh tokens later is a
  // simple `flows.push("refresh_token")` without schema change.

  return {
    id: spec.clientId,
    name: sanitizeRauthyClientName(spec.name, spec.clientId),
    enabled: true,
    confidential: true,
    redirect_uris: [tenantGateRedirectUri(spec.tenantHostname)],
    allowed_origins: [`https://${spec.tenantHostname}`],
    flows_enabled: flows,
    access_token_alg: "EdDSA",
    id_token_alg: "EdDSA",
    // 60s authorization code lifetime mirrors the statecraft-server
    // client (T003 reference schema readback). Long enough for the
    // oauth2-proxy round-trip, short enough to limit replay window.
    auth_code_lifetime: 60,
    // 30-minute access token lifetime mirrors the statecraft-server
    // pattern. Refresh isn't enabled so this is also the gate session
    // lifetime; users re-auth every 30 minutes.
    access_token_lifetime: 1800,
    scopes: ["openid", "email", "profile"],
    default_scopes: ["openid"],
    challenges: ["S256"],
    force_mfa: false,
  };
}

/**
 * Guard the FR-004 invariant at the payload boundary. Called on every
 * provisioning request before the network hop, so a future code path
 * that constructs a payload by hand still cannot accidentally enable
 * password login.
 *
 * Throws on any flow that grants password authentication. Caller catches
 * and surfaces as a typed APIError.
 */
export function assertNoPasswordFlow(payload: RauthyClientPayload): void {
  if (payload.flows_enabled.includes("password")) {
    throw new Error(
      `FR-004 invariant violation: tenant gate client '${payload.id}' would enable password grant`,
    );
  }
}
