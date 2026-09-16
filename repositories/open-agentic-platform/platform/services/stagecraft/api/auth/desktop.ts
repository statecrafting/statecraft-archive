/**
 * Desktop (OPC) OAuth endpoints (spec 080 Phase 1, rewired by spec 106 FR-004).
 *
 * The desktop flow now routes through Rauthy for *every* login (GitHub users
 * included) — there is no direct-GitHub path anymore (spec 106 FR-008). OPC
 * opens a browser to `/auth/desktop/authorize`, which issues a Rauthy
 * authorize redirect with `idp_hint=github` (unless an enterprise OIDC
 * provider is matched). The callback lands on `/auth/rauthy/callback`
 * (spec 106 FR-004); that endpoint performs A2c membership resolution,
 * mints the session (or stashes the Rauthy refresh token for multi-org
 * selection), and deep-links back to OPC with a one-time auth code.
 *
 * Endpoints:
 *   GET  /auth/desktop/authorize   — initiate desktop PKCE flow (→ Rauthy)
 *   POST /auth/desktop/token       — exchange auth code for pre-minted tokens
 *   POST /auth/desktop/org-select  — finalize org selection (multi-org)
 *   POST /auth/desktop/refresh     — refresh access token via Rauthy
 */

import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import crypto from "crypto";
import { applyRateLimit, checkRateLimit } from "./rate-limit";
import { db } from "../db/drizzle";
import { oidcProviders } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { buildAuthorizationUrl, generatePkcePair, refreshTokens, resolveUpstreamProviderId } from "./rauthy";
import {
  pendingDesktopFlows,
  pendingDesktopSessions,
  consumeDesktopSession,
  cleanupDesktopState,
} from "./desktop-state";
import { appBaseUrl } from "./github";
import { pendingRauthyStates } from "./rauthyCallback";
import { finalizeDesktopRauthyOrg } from "./rauthyCallback";
import { pendingOidcStates } from "./oidc";
import { errorForLog } from "./errorLog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DesktopUser {
  id: string;
  email: string;
  name: string;
  githubLogin: string;
  idpProvider: string;
  idpLogin: string;
  avatarUrl: string;
}

interface DesktopOrg {
  orgId: string;
  orgSlug: string;
  githubOrgLogin: string;
  orgDisplayName: string;
  platformRole: string;
}

interface DesktopTokenResult {
  type: "authenticated" | "org_selection";
  user: DesktopUser;
  // Present when type === "authenticated"
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  org?: DesktopOrg;
  // Present when type === "org_selection"
  pendingId?: string;
  orgs?: DesktopOrg[];
}

interface DesktopRefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ---------------------------------------------------------------------------
// GET /auth/desktop/authorize — initiate desktop PKCE flow
// ---------------------------------------------------------------------------

export const desktopAuthorize = api.raw(
  { expose: true, method: "GET", path: "/auth/desktop/authorize", auth: false },
  async (req, resp) => {
    if (applyRateLimit(req, resp)) return;
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const codeChallenge = url.searchParams.get("code_challenge");
    const codeChallengeMethod = url.searchParams.get("code_challenge_method");
    const desktopState = url.searchParams.get("state");
    const redirectUri = url.searchParams.get("redirect_uri");
    const idpHint = url.searchParams.get("idp_hint");   // optional: OIDC provider ID or email domain

    // Validate required params
    if (!codeChallenge || !codeChallengeMethod || !desktopState || !redirectUri) {
      resp.writeHead(400, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "Missing required parameters: code_challenge, code_challenge_method, state, redirect_uri" }));
      return;
    }

    if (codeChallengeMethod !== "S256") {
      resp.writeHead(400, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "Only S256 code_challenge_method is supported" }));
      return;
    }

    if (!redirectUri.startsWith("opc://")) {
      resp.writeHead(400, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "redirect_uri must use the opc:// scheme" }));
      return;
    }

    cleanupDesktopState();

    // Enterprise OIDC hint — route through Rauthy's /oidc/callback which
    // carries enterprise-IdP claim extraction + group-based membership.
    if (idpHint) {
      let providerRow;
      if (idpHint.includes("@")) {
        const domain = idpHint.split("@")[1].toLowerCase();
        [providerRow] = await db
          .select()
          .from(oidcProviders)
          .where(and(eq(oidcProviders.emailDomain, domain), eq(oidcProviders.status, "active")))
          .limit(1);
      } else {
        [providerRow] = await db
          .select()
          .from(oidcProviders)
          .where(and(eq(oidcProviders.id, idpHint), eq(oidcProviders.status, "active")))
          .limit(1);
      }

      if (providerRow) {
        const rauthyState = crypto.randomBytes(32).toString("base64url");
        const rauthyPkce = generatePkcePair();
        pendingDesktopFlows.set(rauthyState, {
          codeChallenge,
          codeChallengeMethod,
          redirectUri,
          desktopState,
          createdAt: Date.now(),
          rauthyCodeVerifier: rauthyPkce.codeVerifier,
        });
        pendingOidcStates.set(rauthyState, {
          providerId: providerRow.id,
          orgId: providerRow.orgId,
          createdAt: Date.now(),
          codeVerifier: rauthyPkce.codeVerifier,
        });

        const authUrl = buildAuthorizationUrl({
          redirectUri: `${appBaseUrl()}/auth/oidc/callback`,
          state: rauthyState,
          scopes: providerRow.scopes.split(" ").filter(Boolean),
          idpHint: (await resolveUpstreamProviderId(providerRow.name)) ?? undefined,
          codeChallenge: rauthyPkce.codeChallenge,
          codeChallengeMethod: "S256",
        });

        const authUrlObj = new URL(authUrl);
        if (idpHint.includes("@")) authUrlObj.searchParams.set("login_hint", idpHint);

        resp.writeHead(302, { Location: authUrlObj.toString() });
        resp.end();
        return;
      }
    }

    // Default: route through Rauthy with the GitHub upstream IdP. The
    // unified /auth/rauthy/callback (spec 106 FR-004) detects desktop state
    // via pendingDesktopFlows and finalises the deep-link back to OPC.
    const rauthyState = crypto.randomBytes(32).toString("base64url");
    const rauthyPkce = generatePkcePair();
    pendingDesktopFlows.set(rauthyState, {
      codeChallenge,
      codeChallengeMethod,
      redirectUri,
      desktopState,
      createdAt: Date.now(),
      rauthyCodeVerifier: rauthyPkce.codeVerifier,
    });
    // The rauthyCallback handler also consults pendingRauthyStates to
    // distinguish web vs desktop. Desktop flows MUST not be present there;
    // the consumeDesktopFlow check is enough. We therefore deliberately do
    // NOT register the state in pendingRauthyStates.
    void pendingRauthyStates;

    const authUrl = buildAuthorizationUrl({
      redirectUri: `${appBaseUrl()}/auth/rauthy/callback`,
      state: rauthyState,
      scopes: ["openid", "profile", "email", "oap"],
      idpHint: (await resolveUpstreamProviderId("github")) ?? undefined,
      codeChallenge: rauthyPkce.codeChallenge,
      codeChallengeMethod: "S256",
    });

    resp.writeHead(302, { Location: authUrl });
    resp.end();
  }
);

// ---------------------------------------------------------------------------
// POST /auth/desktop/token — exchange one-time auth code for pre-minted tokens
// ---------------------------------------------------------------------------

interface DesktopTokenRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export const desktopToken = api<DesktopTokenRequest, DesktopTokenResult>(
  { expose: true, method: "POST", path: "/auth/desktop/token", auth: false },
  async (req) => {
    const retryAfter = checkRateLimit("desktop-token-global");
    if (retryAfter !== null) {
      throw APIError.resourceExhausted(`Rate limited. Retry after ${retryAfter}s`);
    }

    const { code, codeVerifier, redirectUri } = req;

    if (!code || !codeVerifier || !redirectUri) {
      throw APIError.invalidArgument("Missing required fields: code, codeVerifier, redirectUri");
    }

    // Consume the pending session
    const session = consumeDesktopSession(code);
    if (!session) {
      throw APIError.invalidArgument("Invalid or expired auth code");
    }

    // PKCE verification: SHA256(code_verifier) must match the stored code_challenge
    const expectedChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    if (expectedChallenge !== session.codeChallenge) {
      throw APIError.invalidArgument("PKCE verification failed: code_verifier does not match code_challenge");
    }

    const user: DesktopUser = {
      id: session.userId,
      email: session.email,
      name: session.name,
      githubLogin: session.githubLogin,
      idpProvider: session.idpProvider,
      idpLogin: session.idpLogin,
      avatarUrl: session.avatarUrl,
    };

    // Multi-org: return org list for picker. Keep the session alive so
    // desktopOrgSelect can pick up the stashed rauthyRefreshToken.
    if (session.matchedOrgs.length > 1) {
      const pendingId = crypto.randomBytes(32).toString("base64url");
      pendingDesktopSessions.set(pendingId, session);

      return {
        type: "org_selection" as const,
        pendingId,
        orgs: session.matchedOrgs.map((o) => ({
          orgId: o.orgId,
          orgSlug: o.orgSlug,
          githubOrgLogin: o.githubOrgLogin,
          orgDisplayName: o.orgDisplayName,
          platformRole: o.platformRole,
        })),
        user,
      };
    }

    // Single-org: rauthyCallback pre-minted tokens during FR-004 step 6.
    const accessToken = session.rauthyAccessToken;
    const refreshToken = session.rauthyRefreshToken;
    const expiresIn = session.rauthyExpiresIn;
    if (!accessToken || !refreshToken || expiresIn === undefined) {
      log.error("Desktop session missing pre-minted Rauthy tokens");
      throw APIError.internal("Session is missing Rauthy tokens");
    }

    const org = session.matchedOrgs[0];
    return {
      type: "authenticated" as const,
      accessToken,
      refreshToken,
      expiresIn,
      user,
      org: {
        orgId: org.orgId,
        orgSlug: org.orgSlug,
        githubOrgLogin: org.githubOrgLogin,
        orgDisplayName: org.orgDisplayName,
        platformRole: org.platformRole,
      },
    };
  }
);

// ---------------------------------------------------------------------------
// POST /auth/desktop/org-select — finalize org selection for multi-org users
// ---------------------------------------------------------------------------

interface DesktopOrgSelectRequest {
  pendingId: string;
  orgId: string;
}

export const desktopOrgSelect = api<DesktopOrgSelectRequest, DesktopTokenResult>(
  { expose: true, method: "POST", path: "/auth/desktop/org-select", auth: false },
  async (req) => {
    const { pendingId, orgId } = req;

    if (!pendingId || !orgId) {
      throw APIError.invalidArgument("Missing required fields: pendingId, orgId");
    }

    const session = pendingDesktopSessions.get(pendingId);
    if (!session) {
      throw APIError.invalidArgument("Invalid or expired pending ID");
    }
    pendingDesktopSessions.delete(pendingId);

    const org = session.matchedOrgs.find((o) => o.orgId === orgId);
    if (!org) {
      throw APIError.invalidArgument("Selected org not in matched org list");
    }

    const tokens = await finalizeDesktopRauthyOrg(session, orgId);
    if (!tokens) {
      throw APIError.internal("Failed to mint Rauthy session for selected org");
    }

    return {
      type: "authenticated" as const,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      user: {
        id: session.userId,
        email: session.email,
        name: session.name,
        githubLogin: session.githubLogin,
        idpProvider: session.idpProvider,
        idpLogin: session.idpLogin,
        avatarUrl: session.avatarUrl,
      },
      org: {
        orgId: org.orgId,
        orgSlug: org.orgSlug,
        githubOrgLogin: org.githubOrgLogin,
        orgDisplayName: org.orgDisplayName,
        platformRole: org.platformRole,
      },
    };
  }
);

// ---------------------------------------------------------------------------
// POST /auth/desktop/refresh — refresh access token via Rauthy
// ---------------------------------------------------------------------------

interface DesktopRefreshRequest {
  refreshToken: string;
}

export const desktopRefresh = api<DesktopRefreshRequest, DesktopRefreshResponse>(
  { expose: true, method: "POST", path: "/auth/desktop/refresh", auth: false },
  async (req) => {
    const retryAfter = checkRateLimit("desktop-refresh-global");
    if (retryAfter !== null) {
      throw APIError.resourceExhausted(`Rate limited. Retry after ${retryAfter}s`);
    }

    const { refreshToken } = req;

    if (!refreshToken) {
      throw APIError.invalidArgument("Missing refreshToken");
    }

    try {
      const tokens = await refreshTokens(refreshToken);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
      };
    } catch (err) {
      log.warn("Desktop refresh failed", { error: errorForLog(err) });
      throw APIError.unauthenticated("Invalid or expired refresh token");
    }
  }
);
