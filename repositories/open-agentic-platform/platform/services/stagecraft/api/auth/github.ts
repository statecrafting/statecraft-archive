/**
 * Org selection + org-switch endpoints (spec 106).
 *
 * Rauthy-native login lives in `./rauthy.ts` and `./rauthyCallback.ts`.
 * This module owns the IdP-agnostic org-pick/switch surface that dispatches
 * across the Rauthy-native and enterprise OIDC pending maps.
 */

import { api, APIError } from "encore.dev/api";
import { secret } from "encore.dev/config";
import log from "encore.dev/log";
import { getAuthData } from "~encore/auth";
import { db } from "../db/drizzle";
import { users, orgMemberships, organizations } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { getUserOrgRole } from "./membership";
import { type RauthyTokens } from "./rauthy";
import { mintSessionForOrg } from "./sessionMint";
import {
  pendingOidcOrgSelections,
  buildOidcSessionCookies,
} from "./oidc";
import {
  pendingRauthyOrgSelections,
  finalizeRauthyOrgSelection,
} from "./rauthyCallback";
import { errorForLog } from "./errorLog";

// Base URL for constructing callback URLs (consumed by rauthyCallback).
export const appBaseUrl = secret("APP_BASE_URL"); // e.g. https://statecraft.localdev.online

// ---------------------------------------------------------------------------
// GET /auth/pending-orgs — resolve pending org data for org-select page
// ---------------------------------------------------------------------------

export const getPendingOrgs = api.raw(
  { expose: true, method: "GET", path: "/auth/pending-orgs", auth: false },
  async (req, resp) => {
    const cookieHeader = req.headers.cookie || "";
    const match = cookieHeader.match(/(?:^|;\s*)__pending_org=([^\s;]+)/);

    if (!match) {
      resp.writeHead(404, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "no pending org selection" }));
      return;
    }

    const rauthyData = pendingRauthyOrgSelections.get(match[1]);
    const oidcData = !rauthyData ? pendingOidcOrgSelections.get(match[1]) : undefined;

    if (!rauthyData && !oidcData) {
      resp.writeHead(404, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "pending org selection expired" }));
      return;
    }

    const data = rauthyData ?? oidcData!;
    const displayName = rauthyData?.githubLogin
      || oidcData?.idpLogin
      || data.name
      || data.email;

    resp.writeHead(200, { "Content-Type": "application/json" });
    resp.end(
      JSON.stringify({
        githubLogin: rauthyData?.githubLogin ?? "",
        displayName,
        orgs: data.orgs.map((o) => ({
          orgId: o.orgId,
          orgSlug: o.orgSlug,
          githubOrgLogin: o.githubOrgLogin,
          orgDisplayName: o.orgDisplayName,
          platformRole: o.platformRole,
        })),
      })
    );
  }
);

// ---------------------------------------------------------------------------
// GET /auth/org-select/complete — finalize org selection
// ---------------------------------------------------------------------------

export const orgSelectComplete = api.raw(
  {
    expose: true,
    method: "GET",
    path: "/auth/org-select/complete",
    auth: false,
  },
  async (req, resp) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const selectedOrgId = url.searchParams.get("org");

    if (!selectedOrgId) {
      resp.writeHead(400, { "Content-Type": "text/plain" });
      resp.end("Missing org parameter");
      return;
    }

    // Parse pending org ID from cookie
    const cookieHeader = req.headers.cookie || "";
    const match = cookieHeader.match(/(?:^|;\s*)__pending_org=([^\s;]+)/);
    if (!match) {
      resp.writeHead(302, { Location: "/signin?error=session_expired" });
      resp.end();
      return;
    }

    try {
      const pendingId = match[1];

      // Two active pending-data maps after spec 106:
      //   pendingRauthyOrgSelections — GitHub-via-Rauthy flow (FR-004)
      //   pendingOidcOrgSelections   — enterprise OIDC flow
      // Each stashes the Rauthy refresh token from the initial OIDC
      // exchange so we can mint the post-pick JWT via the standard
      // setRauthyUserAttributes + refreshTokens pair.
      const rauthyPending = pendingRauthyOrgSelections.get(pendingId);
      const oidcPending = !rauthyPending ? pendingOidcOrgSelections.get(pendingId) : undefined;

      if (!rauthyPending && !oidcPending) {
        resp.writeHead(302, { Location: "/signin?error=session_expired" });
        resp.end();
        return;
      }

      const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
      const clearCookie = `__pending_org=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0;${secure}`;

      // Path A: GitHub-via-Rauthy multi-org selection
      if (rauthyPending) {
        const result = await finalizeRauthyOrgSelection(pendingId, selectedOrgId);
        if (!result) {
          resp.writeHead(400, { "Content-Type": "text/plain" });
          resp.end("Invalid org selection");
          return;
        }
        const { tokens } = result;
        const maxAge = Math.min(tokens.expires_in, 14 * 24 * 60 * 60);
        resp.writeHead(302, {
          Location: "/app",
          "Set-Cookie": [
            `__session=${tokens.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge};${secure}`,
            `__refresh=${tokens.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 60 * 60};${secure}`,
            clearCookie,
          ],
        });
        resp.end();
        return;
      }

      // Path B: enterprise OIDC multi-org selection
      const pendingData = oidcPending!;
      pendingOidcOrgSelections.delete(pendingId);

      const selectedOrg = pendingData.orgs.find((o) => o.orgId === selectedOrgId);
      if (!selectedOrg) {
        resp.writeHead(400, { "Content-Type": "text/plain" });
        resp.end("Invalid org selection");
        return;
      }

      const sessionCookies = await buildOidcSessionCookies(
        {
          id: pendingData.userId,
          rauthyUserId: pendingData.rauthyUserId,
          email: pendingData.email,
          name: pendingData.name,
          idpProvider: pendingData.idpProvider,
          idpLogin: pendingData.idpLogin,
          avatarUrl: pendingData.avatarUrl,
        },
        selectedOrg,
        pendingData.rauthyRefreshToken
      );

      resp.writeHead(302, {
        Location: "/app",
        "Set-Cookie": [...sessionCookies, clearCookie],
      });
      resp.end();
    } catch (err) {
      log.error("Org select complete failed", { error: errorForLog(err) });
      resp.writeHead(302, { Location: "/signin?error=session_expired" });
      resp.end();
    }
  }
);

// ---------------------------------------------------------------------------
// POST /auth/org-switch — switch org context for authenticated user (FR-012)
// ---------------------------------------------------------------------------

export const orgSwitch = api(
  { expose: true, auth: true, method: "POST", path: "/auth/org-switch" },
  async (req: {
    orgId: string;
    refreshToken: string;
  }): Promise<{
    ok: true;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> => {
    const auth = getAuthData()!;

    if (!req.refreshToken) {
      throw APIError.invalidArgument("refreshToken is required");
    }

    // Verify user has active membership in the target org
    const role = await getUserOrgRole(auth.userID, req.orgId);
    if (!role) {
      throw APIError.permissionDenied("No active membership in this organization");
    }

    // Get user details
    const [user] = await db
      .select({
        id: users.id,
        rauthyUserId: users.rauthyUserId,
        email: users.email,
        name: users.name,
        githubLogin: users.githubLogin,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, auth.userID))
      .limit(1);

    if (!user || !user.rauthyUserId) {
      throw APIError.internal("User account not properly configured");
    }

    // Resolve org slug and workspace
    const [org] = await db
      .select({ id: organizations.id, slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, req.orgId))
      .limit(1);

    if (!org) {
      throw APIError.notFound("Organization not found");
    }

    // Write OAP attributes and refresh — Rauthy emits the new org context
    // under `custom.oap_*` on the returned access + ID tokens.
    let tokens: RauthyTokens;
    try {
      tokens = await mintSessionForOrg(
        {
          rauthyUserId: user.rauthyUserId,
          oapUserId: user.id,
          orgId: req.orgId,
          orgSlug: org.slug,
          githubLogin: user.githubLogin || undefined,
          idpProvider: auth.idpProvider,
          idpLogin: auth.idpLogin,
          avatarUrl: user.avatarUrl ?? "",
          platformRole: role,
        },
        req.refreshToken
      );
    } catch (err) {
      log.warn("Org switch refresh failed", { error: errorForLog(err) });
      throw APIError.unauthenticated("Refresh token is invalid or expired");
    }

    log.info("Org switch completed", {
      userId: auth.userID,
      fromOrgId: auth.orgId,
      toOrgId: req.orgId,
    });

    return {
      ok: true,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    };
  }
);

// ---------------------------------------------------------------------------
// GET /auth/user-orgs — list orgs available to the current user (FR-012)
// ---------------------------------------------------------------------------

export type UserOrgRow = {
  orgId: string;
  orgSlug: string;
  platformRole: "owner" | "admin" | "member";
};

export const listUserOrgs = api(
  { expose: true, auth: true, method: "GET", path: "/auth/user-orgs" },
  async (): Promise<{ orgs: UserOrgRow[] }> => {
    const auth = getAuthData()!;

    const rows = await db
      .select({
        orgId: orgMemberships.orgId,
        orgSlug: organizations.slug,
        platformRole: orgMemberships.platformRole,
      })
      .from(orgMemberships)
      .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
      .where(
        and(
          eq(orgMemberships.userId, auth.userID),
          eq(orgMemberships.status, "active")
        )
      );

    return { orgs: rows };
  }
);

// ---------------------------------------------------------------------------
// POST /auth/org-switch/cookie — org switch for web (sets __session cookie)
// ---------------------------------------------------------------------------

export const orgSwitchCookie = api.raw(
  { expose: true, method: "POST", path: "/auth/org-switch/cookie", auth: true },
  async (req, resp) => {
    const auth = getAuthData()!;

    // Pull the Rauthy refresh token from the __refresh cookie set by
    // /auth/rauthy/callback (spec 106 FR-004). Rauthy rotates the refresh
    // token on each /oidc/token call, so we emit a fresh one alongside the
    // new access token.
    const cookieHeader = req.headers.cookie || "";
    const refreshMatch = cookieHeader.match(/(?:^|;\s*)__refresh=([^\s;]+)/);
    if (!refreshMatch) {
      resp.writeHead(401, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "Missing refresh cookie" }));
      return;
    }
    const currentRefreshToken = refreshMatch[1];

    // Read orgId from body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    let orgId: string;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      orgId = body.orgId;
    } catch {
      resp.writeHead(400, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "Invalid request body" }));
      return;
    }

    if (!orgId) {
      resp.writeHead(400, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "orgId is required" }));
      return;
    }

    // Verify membership
    const role = await getUserOrgRole(auth.userID, orgId);
    if (!role) {
      resp.writeHead(403, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "No active membership in this organization" }));
      return;
    }

    // Get user details
    const [user] = await db
      .select({
        id: users.id,
        rauthyUserId: users.rauthyUserId,
        email: users.email,
        name: users.name,
        githubLogin: users.githubLogin,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, auth.userID))
      .limit(1);

    if (!user?.rauthyUserId) {
      resp.writeHead(500, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "User not configured" }));
      return;
    }

    // Resolve org
    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    try {
      const tokens = await mintSessionForOrg(
        {
          rauthyUserId: user.rauthyUserId,
          oapUserId: user.id,
          orgId,
          orgSlug: org?.slug ?? "",
          githubLogin: user.githubLogin || undefined,
          idpProvider: auth.idpProvider,
          idpLogin: auth.idpLogin,
          avatarUrl: user.avatarUrl ?? "",
          platformRole: role,
        },
        currentRefreshToken
      );

      const maxAge = Math.min(tokens.expires_in, 14 * 24 * 60 * 60);
      const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";

      resp.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": [
          `__session=${tokens.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge};${secure}`,
          `__refresh=${tokens.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 60 * 60};${secure}`,
        ],
      });
      resp.end(JSON.stringify({ ok: true }));
    } catch (err) {
      log.error("Org switch cookie failed", { error: errorForLog(err) });
      resp.writeHead(500, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "Failed to switch org" }));
    }
  }
);
