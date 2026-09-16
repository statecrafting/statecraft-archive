/**
 * Pure Rauthy claim helpers (spec 106 FR-002).
 *
 * Split out from `rauthy.ts` so unit tests can exercise claim extraction
 * without loading the Encore runtime (which `rauthy.ts` needs for secrets
 * and logging).
 */

/**
 * Statecraft-visible claim shape. Rauthy emits custom scope attributes under
 * `payload.custom.*`; legacy top-level layouts are still accepted for the
 * spec 106 cutover window.
 *
 * Spec 119: workspace collapsed into project. The JWT no longer carries an
 * active-workspace claim — orgId scopes the session, projectId is supplied
 * per-request by API path/body.
 */
export interface OapClaims {
  sub: string; // Rauthy user ID
  oap_user_id: string; // internal OAP user ID
  oap_org_id: string; // selected org ID
  oap_org_slug: string; // org slug
  github_login?: string; // GitHub handle (absent for enterprise IdP users)
  idp_provider?: string; // identity provider type (github | azure-ad | okta | etc.)
  idp_login?: string; // provider-specific login/display name
  avatar_url?: string; // avatar URL
  platform_role: string; // owner | admin | member
  exp: number;
  iat: number;
}

/**
 * Pull OAP custom claims out of a raw JWT payload.
 *
 * Rauthy emits scope-mapped attributes under `payload.custom.<name>` (spec
 * 106 FR-002). Older admin-mint sessions put the same keys at the top level;
 * accept both to keep in-flight sessions valid across the cutover.
 */
export function extractOapClaims(payload: Record<string, unknown>): OapClaims | null {
  const custom = (payload.custom as Record<string, unknown> | undefined) ?? {};

  const read = (key: string): string | undefined => {
    const v = custom[key] ?? payload[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  const iat = typeof payload.iat === "number" ? payload.iat : 0;

  const oapUserId = read("oap_user_id");
  const oapOrgId = read("oap_org_id");
  const oapOrgSlug = read("oap_org_slug");
  const platformRole = read("platform_role");

  if (!oapUserId || !oapOrgId || !oapOrgSlug || !platformRole) {
    return null;
  }

  return {
    sub,
    oap_user_id: oapUserId,
    oap_org_id: oapOrgId,
    oap_org_slug: oapOrgSlug,
    github_login: read("github_login"),
    idp_provider: read("idp_provider"),
    idp_login: read("idp_login"),
    avatar_url: read("avatar_url"),
    platform_role: platformRole,
    exp,
    iat,
  };
}

export type PlatformRole = "owner" | "admin" | "member";

/**
 * Read the Rauthy-managed `platform_role` attribute from a raw JWT payload.
 *
 * Rauthy is the authoritative store for role elevation: an admin edits the
 * `platform_role` user attribute in the Rauthy UI, and statecraft respects
 * that value on each login instead of hardcoding "member" for every resolved
 * org. Returns null when the claim is absent or set to an unrecognised value
 * (e.g. the first login before `setRauthyUserAttributes` has populated it).
 */
export function readIncumbentPlatformRole(
  payload: Record<string, unknown>
): PlatformRole | null {
  const custom = (payload.custom as Record<string, unknown> | undefined) ?? {};
  const raw = custom.platform_role ?? payload.platform_role;
  if (raw === "owner" || raw === "admin" || raw === "member") return raw;
  return null;
}
