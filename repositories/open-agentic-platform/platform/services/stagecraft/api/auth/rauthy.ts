/**
 * Rauthy OIDC integration client.
 *
 * Handles user provisioning, custom-attribute writes, token exchange/refresh,
 * session revocation, and JWT validation against the Rauthy identity provider.
 *
 * Spec 106 FR-003: the admin surface was corrected after verifying Rauthy 0.35
 * source. Admin endpoints live under `/auth/v1/users*` (not `/admin/users*`),
 * session revocation is `/auth/v1/sessions/{user_id}`, and the admin auth
 * scheme is `API-Key <name>$<secret>` rather than `Bearer`. Custom claims
 * are scope-driven (spec 106 FR-002): `validateJwt` reads them from
 * `payload.custom.*` first, falling back to legacy top-level keys for the
 * transition window.
 */

import { secret } from "encore.dev/config";
import log from "encore.dev/log";
import { createHash, createPublicKey, createVerify, randomBytes, verify as cryptoVerify } from "crypto";
import { errorForLog } from "./errorLog";
import { extractOapClaims, type OapClaims } from "./rauthy-pure";

export { extractOapClaims, type OapClaims } from "./rauthy-pure";

// Rauthy configuration secrets
export const rauthyUrl = secret("RAUTHY_URL"); // e.g. https://rauthy.localdev.online
const rauthyClientId = secret("RAUTHY_CLIENT_ID"); // Statecraft OIDC client ID
const rauthyClientSecret = secret("RAUTHY_CLIENT_SECRET"); // Statecraft OIDC client secret
const rauthyAdminToken = secret("RAUTHY_ADMIN_TOKEN"); // Rauthy admin API-Key secret (either `name$secret` or raw secret)
const rauthyAdminTokenName = secret("RAUTHY_ADMIN_TOKEN_NAME"); // Optional API-Key name if RAUTHY_ADMIN_TOKEN is the raw secret

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RauthyUser {
  id: string;
  email: string;
  given_name?: string;
  family_name?: string;
  enabled: boolean;
}

export interface RauthyTokens {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * The OAP custom-attribute set written to a Rauthy user. Keys map 1:1 onto
 * the attributes declared by the FR-002 seeder and onto the `oap` scope
 * `attr_include_access` / `attr_include_id` list.
 *
 * Spec 119: workspace collapsed into project. The legacy oap workspace
 * claim was removed from the JWT — projectId is supplied per-request by
 * API path/body and verified against `oap_org_id`.
 */
export interface OapUserAttributes {
  oap_user_id: string;
  oap_org_id: string;
  oap_org_slug: string;
  github_login?: string;
  idp_provider?: string;
  idp_login?: string;
  avatar_url?: string;
  platform_role: string;
}

// ---------------------------------------------------------------------------
// Admin auth header (spec 106 FR-003)
// ---------------------------------------------------------------------------

/**
 * Build the `API-Key <name>$<secret>` header Rauthy requires for admin calls.
 * Accepts either a fully-formed `name$secret` string in RAUTHY_ADMIN_TOKEN
 * (seeder-compatible) or a raw secret paired with RAUTHY_ADMIN_TOKEN_NAME.
 */
export function buildRauthyAdminAuth(): string {
  const token = rauthyAdminToken();
  if (token.includes("$")) {
    return `API-Key ${token}`;
  }
  const name = rauthyAdminTokenName();
  if (!name) {
    throw new Error("RAUTHY_ADMIN_TOKEN does not contain a `name$secret` pair and RAUTHY_ADMIN_TOKEN_NAME is empty");
  }
  return `API-Key ${name}$${token}`;
}

// ---------------------------------------------------------------------------
// JWKS cache for JWT validation
// ---------------------------------------------------------------------------

interface JwkKey {
  kty: string;
  kid: string;
  alg?: string;
  use?: string;
  // RSA
  n?: string;
  e?: string;
  // OKP (Ed25519)
  crv?: string;
  x?: string;
}

interface JwksAndIssuer {
  keys: JwkKey[];
  issuer: string;
  fetchedAt: number;
}

let jwksCache: JwksAndIssuer | null = null;
const JWKS_CACHE_TTL_MS = 3600_000; // 1 hour

/**
 * Fetch Rauthy's JWKS + canonical issuer via OIDC discovery.
 *
 * Previously this hit `/auth/v1/.well-known/jwks.json` which Rauthy 0.35 does
 * not serve (JWKS lives at `/auth/v1/oidc/certs`). Discovery avoids pinning
 * the path: we read `jwks_uri` and `issuer` from the discovery doc so any
 * future Rauthy path/issuer change is picked up automatically. This matches
 * what `deployd-api-rs/src/auth.rs` does for the same reason.
 */
async function fetchJwksAndIssuer(): Promise<JwksAndIssuer> {
  const base = rauthyUrl().replace(/\/+$/, "");
  const discoveryUrl = `${base}/auth/v1/.well-known/openid-configuration`;
  const discoveryResp = await fetch(discoveryUrl);
  if (!discoveryResp.ok) {
    throw new Error(`Failed to fetch OIDC discovery: ${discoveryResp.status} ${discoveryUrl}`);
  }
  const discovery = (await discoveryResp.json()) as { jwks_uri?: string; issuer?: string };
  if (!discovery.jwks_uri || !discovery.issuer) {
    throw new Error("OIDC discovery is missing jwks_uri or issuer");
  }

  const jwksResp = await fetch(discovery.jwks_uri);
  if (!jwksResp.ok) {
    throw new Error(`Failed to fetch JWKS: ${jwksResp.status} ${discovery.jwks_uri}`);
  }
  const jwksBody = (await jwksResp.json()) as { keys: JwkKey[] };

  return {
    keys: jwksBody.keys,
    issuer: discovery.issuer,
    fetchedAt: Date.now(),
  };
}

export async function getJwksAndIssuer(): Promise<JwksAndIssuer> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache;
  }
  jwksCache = await fetchJwksAndIssuer();
  return jwksCache;
}

/** Backward-compat export for any external callers that only need the keys. */
export async function getJwks(): Promise<JwkKey[]> {
  return (await getJwksAndIssuer()).keys;
}

// ---------------------------------------------------------------------------
// JWT Validation
// ---------------------------------------------------------------------------

/**
 * Validate a Rauthy JWT and extract OAP claims.
 * Returns null if the token is invalid or expired.
 */
export async function validateJwt(token: string): Promise<OapClaims | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      log.warn("JWT rejected: malformed token (expected 3 parts)", { parts: parts.length });
      return null;
    }

    const headerJson = Buffer.from(parts[0], "base64url").toString();
    const payloadJson = Buffer.from(parts[1], "base64url").toString();
    const header = JSON.parse(headerJson) as { alg: string; kid?: string };
    const payload = JSON.parse(payloadJson) as Record<string, unknown> & {
      iss?: string;
      aud?: string | string[];
      exp?: number;
    };

    // Require and check expiry
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      log.warn("JWT rejected: expired or missing exp", { exp: payload.exp, now });
      return null;
    }

    // Fetch JWKS and the canonical issuer from Rauthy's OIDC discovery doc.
    // The issuer check uses the advertised value so a trailing-slash or path
    // drift in RAUTHY_URL doesn't invalidate every session.
    const stripSlash = (s: string) => s.replace(/\/+$/, "");
    const { keys, issuer: expectedIssuer } = await getJwksAndIssuer();
    const tokenIssuer = typeof payload.iss === "string" ? stripSlash(payload.iss) : "";
    const normalizedExpected = stripSlash(expectedIssuer);
    if (!tokenIssuer || tokenIssuer !== normalizedExpected) {
      log.warn("JWT rejected: issuer mismatch", { iss: payload.iss, expected: expectedIssuer });
      return null;
    }

    // Validate audience
    const expectedAud = rauthyClientId();
    const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if (!aud.includes(expectedAud)) {
      log.warn("JWT rejected: audience mismatch", { aud, expected: expectedAud });
      return null;
    }

    // Locate signing key by kid
    const key = header.kid ? keys.find((k) => k.kid === header.kid) : keys.find((k) => k.alg === header.alg || k.use === "sig");

    if (!key) {
      log.warn("JWT rejected: no matching JWKS key", {
        kid: header.kid,
        alg: header.alg,
        jwksKids: keys.map((k) => k.kid),
      });
      return null;
    }

    const signatureInput = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], "base64url");

    let valid = false;
    if (header.alg === "RS256" && key.kty === "RSA" && key.n && key.e) {
      const pubKey = jwkToPem(key);
      const verifier = createVerify("RSA-SHA256");
      verifier.update(signatureInput);
      valid = verifier.verify(pubKey, signature);
    } else if (header.alg === "EdDSA" && key.kty === "OKP" && key.crv === "Ed25519" && key.x) {
      const pubKey = createPublicKey({ key: key as unknown as import("crypto").webcrypto.JsonWebKey, format: "jwk" });
      valid = cryptoVerify(null, signatureInput, pubKey, signature);
    } else {
      log.warn("JWT rejected: unsupported alg / JWK combination", {
        alg: header.alg,
        kty: key.kty,
        crv: key.crv,
      });
      return null;
    }

    if (!valid) {
      log.warn("JWT rejected: signature verification failed", {
        alg: header.alg,
        kty: key.kty,
        kid: header.kid,
      });
      return null;
    }

    const claims = extractOapClaims(payload);
    if (!claims) {
      const custom = (payload.custom as Record<string, unknown> | undefined) ?? {};
      log.warn("JWT rejected: missing required OAP claims", {
        hasCustom: payload.custom !== undefined,
        customKeys: Object.keys(custom),
        topLevelHasOapUserId: typeof payload.oap_user_id === "string",
      });
      return null;
    }
    return claims;
  } catch (err) {
    log.error("JWT validation threw", { error: errorForLog(err) });
    return null;
  }
}

function jwkToPem(jwk: JwkKey): string {
  // Build DER-encoded RSA public key from n and e components
  const n = Buffer.from(jwk.n!, "base64url");
  const e = Buffer.from(jwk.e!, "base64url");

  const nEncoded = derEncodeUint(n);
  const eEncoded = derEncodeUint(e);

  const seq = Buffer.concat([Buffer.from([0x30]), derLength(nEncoded.length + eEncoded.length), nEncoded, eEncoded]);

  // Wrap in BIT STRING inside SEQUENCE with RSA OID
  const rsaOid = Buffer.from("300d06092a864886f70d0101010500", "hex");
  const bitString = Buffer.concat([Buffer.from([0x03]), derLength(seq.length + 1), Buffer.from([0x00]), seq]);
  const outer = Buffer.concat([Buffer.from([0x30]), derLength(rsaOid.length + bitString.length), rsaOid, bitString]);

  const b64 = outer.toString("base64");
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function derEncodeUint(buf: Buffer): Buffer {
  // Prepend 0x00 if high bit is set (to keep it positive)
  const padded = buf[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), buf]) : buf;
  return Buffer.concat([Buffer.from([0x02]), derLength(padded.length), padded]);
}

function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

// ---------------------------------------------------------------------------
// User provisioning — Rauthy admin API (spec 106 FR-003)
// ---------------------------------------------------------------------------

/**
 * Find or create a user in Rauthy. Returns the Rauthy user ID.
 *
 * Endpoints used (Rauthy 0.35):
 *   GET  /auth/v1/users/email/{email}   — 200 returns the user, 404 = unknown
 *   POST /auth/v1/users                 — create (email + minimal profile)
 */
export async function provisionRauthyUser(opts: {
  email: string;
  name: string;
  loginHint?: string; // GitHub login, enterprise username, etc. (fallback for given_name)
  githubLogin?: string; // kept for backward compat — alias for loginHint
}): Promise<string> {
  const baseUrl = rauthyUrl();
  const adminAuth = buildRauthyAdminAuth();
  const hint = opts.loginHint ?? opts.githubLogin ?? "";

  // Look up by email
  const lookupResp = await fetch(`${baseUrl}/auth/v1/users/email/${encodeURIComponent(opts.email)}`, {
    headers: { Authorization: adminAuth, Accept: "application/json" },
  });

  if (lookupResp.ok) {
    const existing = (await lookupResp.json()) as RauthyUser;
    if (existing?.id) {
      log.info("Found existing Rauthy user", { rauthyUserId: existing.id });
      return existing.id;
    }
  } else if (lookupResp.status !== 404) {
    const body = await lookupResp.text();
    throw new Error(`Rauthy user lookup failed: ${lookupResp.status} ${body.slice(0, 300)}`);
  }

  // Create new user
  const [givenName, ...familyParts] = opts.name.split(" ");
  const createResp = await fetch(`${baseUrl}/auth/v1/users`, {
    method: "POST",
    headers: {
      Authorization: adminAuth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: opts.email,
      given_name: givenName || hint,
      family_name: familyParts.join(" ") || "",
      enabled: true,
    }),
  });

  if (!createResp.ok) {
    const body = await createResp.text();
    throw new Error(`Rauthy user creation failed: ${createResp.status} ${body.slice(0, 300)}`);
  }

  const created = (await createResp.json()) as RauthyUser;
  log.info("Created Rauthy user", { rauthyUserId: created.id });
  return created.id;
}

/**
 * Write the full OAP custom-attribute set for a Rauthy user.
 *
 * Uses `PUT /auth/v1/users/{id}/attr`. Rauthy 0.35 expects
 * `UserAttrValuesUpdateRequest` = `{ values: [{ key, value }, ...] }` where
 * `value` is any `serde_json::Value` (we send strings). Called on first
 * login and whenever the user's org, workspace, or role context changes.
 * The attribute keys must match the ones seeded in FR-002 and the ones
 * mapped by the `oap` scope.
 */
export async function setRauthyUserAttributes(rauthyUserId: string, attrs: OapUserAttributes): Promise<void> {
  const baseUrl = rauthyUrl();
  const adminAuth = buildRauthyAdminAuth();

  // Rauthy stores attribute values as JSON; empty strings are allowed.
  const values: Array<{ key: string; value: string }> = [
    { key: "oap_user_id", value: attrs.oap_user_id },
    { key: "oap_org_id", value: attrs.oap_org_id },
    { key: "oap_org_slug", value: attrs.oap_org_slug },
    { key: "github_login", value: attrs.github_login ?? "" },
    { key: "idp_provider", value: attrs.idp_provider ?? "" },
    { key: "idp_login", value: attrs.idp_login ?? "" },
    { key: "avatar_url", value: attrs.avatar_url ?? "" },
    { key: "platform_role", value: attrs.platform_role },
  ];

  const resp = await fetch(`${baseUrl}/auth/v1/users/${rauthyUserId}/attr`, {
    method: "PUT",
    headers: {
      Authorization: adminAuth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ values }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Rauthy attribute write failed: ${resp.status} ${body.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// OIDC token endpoints (standard flow — spec 106 FR-003)
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for Rauthy tokens.
 * Used in the OAuth callback after Rauthy-driven login.
 *
 * Spec 106 sequence diagram step 4: the token exchange MUST carry the
 * PKCE `code_verifier` that matches the `code_challenge` sent at the
 * authorize step. The `statecraft-server` Rauthy client requires PKCE.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  codeVerifier?: string
): Promise<RauthyTokens> {
  const baseUrl = rauthyUrl();

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("client_id", rauthyClientId());
  body.set("client_secret", rauthyClientSecret());
  if (codeVerifier) body.set("code_verifier", codeVerifier);

  const resp = await fetch(`${baseUrl}/auth/v1/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Rauthy token exchange failed: ${resp.status} ${text}`);
  }

  return (await resp.json()) as RauthyTokens;
}

/**
 * Generate an RFC 7636 PKCE pair (S256). The verifier is a 32-byte
 * base64url-encoded random value; the challenge is `base64url(sha256(verifier))`.
 */
export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

/**
 * Build the Rauthy authorization URL for initiating login.
 *
 * `opts.idpHint`, when set, MUST be a Rauthy upstream-provider **id** (the
 * random 24-char value assigned at provider creation), not its name. It is
 * emitted as `idp_hint`, the query param Rauthy's authorize page consumes to
 * skip its own provider-selection screen and forward straight to that
 * upstream provider (Rauthy Book: "Direct Login with idp_hint"). Resolve a
 * provider name to its id with `resolveUpstreamProviderId` before calling.
 */
export function buildAuthorizationUrl(opts: {
  redirectUri: string;
  state: string;
  scopes?: string[];
  idpHint?: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256";
}): string {
  const baseUrl = rauthyUrl();
  const scopes = opts.scopes ?? ["openid", "profile", "email"];

  const params = new URLSearchParams({
    response_type: "code",
    client_id: rauthyClientId(),
    redirect_uri: opts.redirectUri,
    scope: scopes.join(" "),
    state: opts.state,
  });

  if (opts.idpHint) params.set("idp_hint", opts.idpHint);
  if (opts.codeChallenge) {
    params.set("code_challenge", opts.codeChallenge);
    params.set("code_challenge_method", opts.codeChallengeMethod ?? "S256");
  }

  return `${baseUrl}/auth/v1/oidc/authorize?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Upstream auth-provider id resolution
// ---------------------------------------------------------------------------

interface ProviderIdCache {
  byName: Map<string, string>;
  fetchedAt: number;
}

let providerIdCache: ProviderIdCache | null = null;
const PROVIDER_CACHE_TTL_MS = 3600_000; // 1 hour, mirrors the JWKS cache

/**
 * List Rauthy's configured upstream auth providers and return a name->id map.
 * Rauthy 0.35 serves the provider list at `POST /auth/v1/providers` (not GET),
 * under admin API-Key auth; this mirrors `scripts/seed-rauthy.mjs`.
 */
async function fetchUpstreamProviders(): Promise<Map<string, string>> {
  const baseUrl = rauthyUrl().replace(/\/+$/, "");
  const adminAuth = buildRauthyAdminAuth();

  const resp = await fetch(`${baseUrl}/auth/v1/providers`, {
    method: "POST",
    headers: {
      Authorization: adminAuth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: "{}",
  });
  if (!resp.ok) {
    throw new Error(`Failed to list Rauthy upstream providers: ${resp.status}`);
  }

  const list = (await resp.json()) as Array<{ id?: string; name?: string }>;
  const byName = new Map<string, string>();
  for (const p of Array.isArray(list) ? list : []) {
    if (p?.name && p?.id) byName.set(p.name, p.id);
  }
  return byName;
}

/**
 * Resolve an upstream auth-provider *name* (e.g. "github") to its Rauthy
 * provider *id*. The authorize-endpoint direct-login hint is
 * `idp_hint=<provider id>`; the provider name does not match (the id is a
 * random string assigned at creation). Result is cached for an hour.
 *
 * Returns null when the provider is unknown or the lookup fails. Callers then
 * omit the hint, so Rauthy renders its normal provider-selection page: the
 * pre-fix behaviour, never worse.
 */
export async function resolveUpstreamProviderId(name: string): Promise<string | null> {
  try {
    if (!providerIdCache || Date.now() - providerIdCache.fetchedAt >= PROVIDER_CACHE_TTL_MS) {
      providerIdCache = { byName: await fetchUpstreamProviders(), fetchedAt: Date.now() };
    }
    return providerIdCache.byName.get(name) ?? null;
  } catch (err) {
    log.warn("Upstream provider id resolution failed; omitting idp_hint", {
      name,
      error: errorForLog(err),
    });
    return null;
  }
}

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshTokens(refreshToken: string): Promise<RauthyTokens> {
  const baseUrl = rauthyUrl();

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", rauthyClientId());
  body.set("client_secret", rauthyClientSecret());

  const resp = await fetch(`${baseUrl}/auth/v1/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Rauthy token refresh failed: ${resp.status} ${text}`);
  }

  return (await resp.json()) as RauthyTokens;
}

/**
 * @deprecated Spec 106 FR-003 removed the admin-mint endpoint — Rauthy 0.35
 * has no `POST /auth/v1/admin/users/:id/sessions` surface. This function is
 * kept as a hard-failing stub so the module surface stays stable while
 * FR-004 rewires call sites (`api/auth/github.ts`, `api/auth/oidc.ts`,
 * `api/auth/desktop.ts`) onto `setRauthyUserAttributes` + `refreshTokens`.
 * Any runtime call is a programmer error and must be fixed at the caller.
 */
export async function issueRauthySession(_opts: {
  rauthyUserId: string;
  oapUserId: string;
  orgId: string;
  orgSlug: string;
  githubLogin?: string;
  idpProvider?: string;
  idpLogin?: string;
  avatarUrl?: string;
  platformRole: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  throw new Error(
    "issueRauthySession was removed in spec 106 FR-003. Rauthy 0.35 has no admin-mint endpoint. Use setRauthyUserAttributes + refreshTokens via /auth/rauthy/callback (FR-004)."
  );
}

/**
 * Revoke all active Rauthy sessions for a user.
 * Uses `DELETE /auth/v1/sessions/{user_id}` with admin API-Key auth.
 */
export async function revokeSession(rauthyUserId: string): Promise<void> {
  const baseUrl = rauthyUrl();
  const adminAuth = buildRauthyAdminAuth();

  const resp = await fetch(`${baseUrl}/auth/v1/sessions/${rauthyUserId}`, {
    method: "DELETE",
    headers: { Authorization: adminAuth },
  });

  if (!resp.ok && resp.status !== 404) {
    log.warn("Failed to revoke Rauthy sessions", {
      rauthyUserId,
      status: resp.status,
    });
  }
}
