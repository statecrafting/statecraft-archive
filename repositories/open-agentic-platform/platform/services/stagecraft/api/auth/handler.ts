/**
 * Encore auth handler — validates Rauthy JWTs on all authenticated API calls.
 * Spec 080 Phase 6: disabled-user enforcement added.
 *
 * All authenticated requests must present a valid Rauthy-issued JWT
 * in the Authorization header (Bearer) or __session cookie.
 * After JWT validation, the handler checks that the user is not disabled
 * (FR-025, cached for 60s to avoid per-request DB round-trips).
 */

import { Header, Gateway, APIError } from "encore.dev/api";
import { authHandler } from "encore.dev/auth";
import log from "encore.dev/log";
import { validateJwt } from "./rauthy";
import { db } from "../db/drizzle";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Disabled-user cache (FR-025)
// ---------------------------------------------------------------------------

const DISABLED_CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  disabled: boolean;
  fetchedAt: number;
}

const disabledCache = new Map<string, CacheEntry>();

async function isUserDisabled(userId: string): Promise<boolean> {
  const now = Date.now();
  const cached = disabledCache.get(userId);
  if (cached && now - cached.fetchedAt < DISABLED_CACHE_TTL_MS) {
    return cached.disabled;
  }

  const [row] = await db
    .select({ disabled: users.disabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const disabled = row?.disabled ?? false;
  disabledCache.set(userId, { disabled, fetchedAt: now });
  return disabled;
}

/** Evict a user from the disabled cache (call after toggling disabled status). */
export function evictDisabledCache(userId: string): void {
  disabledCache.delete(userId);
}

// ---------------------------------------------------------------------------
// Auth types
// ---------------------------------------------------------------------------

interface AuthParams {
  authorization?: Header<"Authorization">;
  cookie?: Header<"Cookie">;
}

// Spec 119: workspace collapsed into project. AuthData carries org-scoped
// session context only — every endpoint that needs project scope reads
// projectId from path/body and verifies it against `orgId` via
// `verifyProjectInOrg(projectId, orgId)`.
export interface AuthData {
  userID: string;
  orgId: string;
  orgSlug: string;
  githubLogin: string;       // may be empty for enterprise IdP users
  idpProvider: string;        // github | azure-ad | okta | google-workspace | etc.
  idpLogin: string;           // provider-specific login/display name
  platformRole: "owner" | "admin" | "member";
}

// ---------------------------------------------------------------------------
// Auth handler
// ---------------------------------------------------------------------------

export const auth = authHandler<AuthParams, AuthData>(async (params) => {
  // Extract JWT from Authorization header or session cookie
  let token: string | undefined;

  if (params.authorization) {
    const parts = params.authorization.split(" ");
    if (parts[0]?.toLowerCase() === "bearer" && parts[1]) {
      token = parts[1];
    }
  }

  if (!token && params.cookie) {
    // Parse __session cookie
    const match = params.cookie.match(/(?:^|;\s*)__session=([^\s;]+)/);
    if (match) {
      token = match[1];
    }
  }

  if (!token) {
    log.warn("auth handler: no token in Authorization header or __session cookie", {
      hasAuthorization: Boolean(params.authorization),
      hasCookie: Boolean(params.cookie),
      cookieHasSession: params.cookie?.includes("__session=") ?? false,
    });
    throw APIError.unauthenticated("No authentication token provided");
  }

  // Validate as a Rauthy user-session JWT. A null result is NOT a hard
  // rejection here. Encore runs this gateway auth handler for EVERY request
  // that carries an Authorization header, including requests to the platform's
  // `expose: true` M2M endpoints (audit, policy, grants, knowledge-sweep) that
  // present a `client_credentials` token. Those tokens carry a different
  // audience than the `statecraft-server` session client, so `validateJwt`
  // returns null for them, and the endpoints validate them themselves via
  // `validateM2mRequest` (scope-checked, no audience check). Returning null
  // (instead of throwing) makes Encore treat the request as unauthenticated:
  // `auth: true` user endpoints still reject it (no AuthData), while
  // `auth: false` M2M endpoints proceed to their own scope check. Throwing
  // here would 401 the M2M endpoints before their handler ever runs.
  const claims = await validateJwt(token);
  if (!claims) {
    // validateJwt logs the specific rejection reason; add the handler-level
    // breadcrumb so the cause is easy to locate in the Encore log stream.
    log.warn("auth handler: validateJwt returned null (no user session; may be an M2M token routed to an auth:false endpoint, see prior JWT rejected warning)");
    return null;
  }

  // FR-025: reject disabled users even if their JWT is still valid
  if (await isUserDisabled(claims.oap_user_id)) {
    throw APIError.permissionDenied("Account is disabled");
  }

  return {
    userID: claims.oap_user_id,
    orgId: claims.oap_org_id,
    orgSlug: claims.oap_org_slug,
    githubLogin: claims.github_login ?? "",
    idpProvider: claims.idp_provider ?? (claims.github_login ? "github" : ""),
    idpLogin: claims.idp_login ?? claims.github_login ?? "",
    platformRole: claims.platform_role as AuthData["platformRole"],
  };
});

// ---------------------------------------------------------------------------
// API Gateway — routes all external traffic through the auth handler
// ---------------------------------------------------------------------------

export const gateway = new Gateway({ authHandler: auth });
