/**
 * SSR session helpers (spec 087 Phase 5).
 *
 * The __session cookie now contains a Rauthy-issued JWT. For SSR, we decode
 * the JWT payload to extract claims for rendering. Cryptographic verification
 * happens in the Encore auth handler for all API calls — the cookie is
 * HttpOnly/SameSite so it cannot be tampered with by client-side JS.
 */

import { redirect } from "react-router";

const USER_COOKIE = "__session";

function parseCookie(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=").trim() || "");
  }
  return out;
}

/** Decoded Rauthy JWT claims for SSR rendering. */
interface JwtClaims {
  sub: string;
  oap_user_id: string;
  oap_org_id: string;
  oap_org_slug: string;
  github_login?: string;
  idp_provider?: string;
  idp_login?: string;
  platform_role: "owner" | "admin" | "member";
  email?: string;
  name?: string;
  exp: number;
  iat: number;
}

/**
 * Decode the JWT payload without cryptographic verification.
 *
 * Rauthy emits OAP custom claims under `payload.custom.*` (spec 106 FR-002).
 * Legacy admin-mint tokens put the same keys at the top level; flatten
 * either layout into the shape the rest of the SSR code expects.
 *
 * Returns null if the token is malformed or expired.
 */
function decodeJwtPayload(token: string): JwtClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const raw = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;

    const exp = typeof raw.exp === "number" ? raw.exp : 0;
    if (!exp || exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    const custom = (raw.custom as Record<string, unknown> | undefined) ?? {};
    const pick = (key: string): string | undefined => {
      const v = custom[key] ?? raw[key];
      return typeof v === "string" && v.length > 0 ? v : undefined;
    };

    const oapUserId = pick("oap_user_id");
    const oapOrgId = pick("oap_org_id");
    const oapOrgSlug = pick("oap_org_slug");
    const platformRole = pick("platform_role");
    if (!oapUserId || !oapOrgId || !oapOrgSlug || !platformRole) {
      return null;
    }
    if (platformRole !== "owner" && platformRole !== "admin" && platformRole !== "member") {
      return null;
    }

    return {
      sub: typeof raw.sub === "string" ? raw.sub : "",
      oap_user_id: oapUserId,
      oap_org_id: oapOrgId,
      oap_org_slug: oapOrgSlug,
      github_login: pick("github_login"),
      idp_provider: pick("idp_provider"),
      idp_login: pick("idp_login"),
      platform_role: platformRole,
      email: pick("email"),
      name: pick("name"),
      exp,
      iat: typeof raw.iat === "number" ? raw.iat : 0,
    };
  } catch {
    return null;
  }
}

export async function requireUser(request: Request) {
  const cookies = parseCookie(request.headers.get("Cookie"));
  const token = cookies[USER_COOKIE];
  if (!token) throw redirect("/signin");

  const claims = decodeJwtPayload(token);
  if (!claims) throw redirect("/signin");

  return {
    userId: claims.oap_user_id,
    email: claims.email ?? "",
    name: claims.name ?? claims.idp_login ?? claims.github_login ?? "",
    role: claims.platform_role === "owner" ? ("admin" as const) : ("user" as const),
    kind: "user" as const,
    orgId: claims.oap_org_id,
    orgSlug: claims.oap_org_slug,
    githubLogin: claims.github_login ?? "",
    idpProvider: claims.idp_provider ?? (claims.github_login ? "github" : ""),
    idpLogin: claims.idp_login ?? claims.github_login ?? "",
    platformRole: claims.platform_role,
  };
}

export async function requireAdmin(request: Request) {
  const cookies = parseCookie(request.headers.get("Cookie"));
  const token = cookies[USER_COOKIE];
  if (!token) throw redirect("/signin");

  const claims = decodeJwtPayload(token);
  if (!claims) throw redirect("/signin");

  if (claims.platform_role !== "owner" && claims.platform_role !== "admin") {
    throw redirect("/signin");
  }

  return {
    userId: claims.oap_user_id,
    email: claims.email ?? "",
    name: claims.name ?? claims.idp_login ?? claims.github_login ?? "",
    role: "admin" as const,
    kind: "admin" as const,
    orgId: claims.oap_org_id,
    orgSlug: claims.oap_org_slug,
    githubLogin: claims.github_login ?? "",
    idpProvider: claims.idp_provider ?? (claims.github_login ? "github" : ""),
    idpLogin: claims.idp_login ?? claims.github_login ?? "",
    platformRole: claims.platform_role,
  };
}

export function getCookieToken(request: Request, kind: "user" | "admin"): string | undefined {
  const cookies = parseCookie(request.headers.get("Cookie"));
  // Both user and admin sessions now use the same __session JWT
  return cookies[USER_COOKIE];
}
