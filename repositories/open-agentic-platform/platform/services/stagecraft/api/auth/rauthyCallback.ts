/**
 * Rauthy-native login entry + callback (spec 106 FR-004).
 *
 * GET /auth/rauthy            — redirect to Rauthy /oidc/authorize with
 *                               scope=openid profile email oap, idp_hint=github
 * GET /auth/rauthy/callback   — exchange code, resolve membership via the
 *                               layered A2c resolver (spec 106 FR-005),
 *                               write OAP attributes, refresh to JWT #2,
 *                               set cookie (web) / deep-link opc:// (desktop).
 *
 * Replaces the spec 080 direct-GitHub callback; the legacy `/auth/github`
 * routes were removed in spec 106 FR-008.
 */

import { api } from "encore.dev/api";
import log from "encore.dev/log";
import crypto from "crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { applyRateLimit } from "./rate-limit";
import { db } from "../db/drizzle";
import {
  users,
  userIdentities,
  organizations,
  auditLog,
  orgMemberships,
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  generatePkcePair,
  provisionRauthyUser,
  resolveUpstreamProviderId,
  type RauthyTokens,
} from "./rauthy";
import { mintSessionForOrg } from "./sessionMint";
import { resolveMembership } from "./membershipResolver";
import { errorCodeForReason } from "./rauthyCallback-pure";
import { readIncumbentPlatformRole, type PlatformRole } from "./rauthy-pure";
import type { ResolvedOrg } from "./membership";

export { errorCodeForReason } from "./rauthyCallback-pure";
import { appBaseUrl } from "./github";
import {
  consumeDesktopFlow,
  storeDesktopSession,
  cleanupDesktopState,
  pendingDesktopSessions,
  type PendingDesktopSession,
} from "./desktop-state";
import { errorForLog } from "./errorLog";

// ---------------------------------------------------------------------------
// State maps
// ---------------------------------------------------------------------------

interface PendingRauthyState {
  createdAt: number;
  codeVerifier: string;
}

/** CSRF state for /auth/rauthy web entry. */
export const pendingRauthyStates = new Map<string, PendingRauthyState>();
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanupStaleStates() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [key, val] of pendingRauthyStates) {
    if (val.createdAt < cutoff) pendingRauthyStates.delete(key);
  }
}

/**
 * Multi-org pending data for web flows (attached to the __pending_org cookie).
 *
 * The callback stashes the refresh token here so that `orgSelectComplete`
 * can run the deferred `setRauthyUserAttributes + refreshTokens` pair with
 * the user-picked org context.
 */
export interface PendingRauthyOrgData {
  userId: string;
  rauthyUserId: string;
  email: string;
  name: string;
  githubLogin: string;
  idpProvider: string;
  idpLogin: string;
  avatarUrl: string;
  orgs: ResolvedOrg[];
  rauthyRefreshToken: string;
  createdAt: number;
}

export const pendingRauthyOrgSelections = new Map<string, PendingRauthyOrgData>();
const PENDING_ORG_TTL_MS = 5 * 60 * 1000;

function cleanupStalePendingOrgs() {
  const cutoff = Date.now() - PENDING_ORG_TTL_MS;
  for (const [key, val] of pendingRauthyOrgSelections) {
    if (val.createdAt < cutoff) pendingRauthyOrgSelections.delete(key);
  }
}

// ---------------------------------------------------------------------------
// GET /auth/rauthy, GET /auth/google: initiate Rauthy-native login (web)
//
// Both routes run the identical PKCE + state flow and share the
// /auth/rauthy/callback handler; they differ only in which upstream provider
// Rauthy is hinted to forward to (idp_hint). This lets the signin page offer a
// direct "Continue with GitHub" and "Continue with Google" without first
// landing on Rauthy's own provider-selection screen. If the provider id can't
// be resolved the hint is omitted (Rauthy shows its selector), never worse
// than no hint.
// ---------------------------------------------------------------------------

async function startUpstreamLogin(
  providerName: string,
  req: IncomingMessage,
  resp: ServerResponse,
): Promise<void> {
  if (applyRateLimit(req, resp)) return;
  cleanupStaleStates();

  const state = crypto.randomBytes(32).toString("base64url");
  const { codeVerifier, codeChallenge } = generatePkcePair();
  pendingRauthyStates.set(state, { createdAt: Date.now(), codeVerifier });

  const url = buildAuthorizationUrl({
    redirectUri: `${appBaseUrl()}/auth/rauthy/callback`,
    state,
    scopes: ["openid", "profile", "email", "oap"],
    idpHint: (await resolveUpstreamProviderId(providerName)) ?? undefined,
    codeChallenge,
    codeChallengeMethod: "S256",
  });

  resp.writeHead(302, { Location: url });
  resp.end();
}

export const rauthyLogin = api.raw(
  { expose: true, method: "GET", path: "/auth/rauthy", auth: false },
  async (req, resp) => startUpstreamLogin("github", req, resp),
);

export const googleLogin = api.raw(
  { expose: true, method: "GET", path: "/auth/google", auth: false },
  async (req, resp) => startUpstreamLogin("google", req, resp),
);

// ---------------------------------------------------------------------------
// GET /auth/rauthy/callback — unified Rauthy callback
// ---------------------------------------------------------------------------

export const rauthyCallback = api.raw(
  { expose: true, method: "GET", path: "/auth/rauthy/callback", auth: false },
  async (req, resp) => {
    if (applyRateLimit(req, resp)) return;
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      log.warn("Rauthy callback error", { error });
      resp.writeHead(302, { Location: "/signin?error=rauthy_denied" });
      resp.end();
      return;
    }

    if (!code || !state) {
      resp.writeHead(400, { "Content-Type": "text/plain" });
      resp.end("Missing code or state parameter");
      return;
    }

    // Detect flow type — desktop flows are registered in pendingDesktopFlows
    // by /auth/desktop/authorize; web flows come from /auth/rauthy.
    const desktopFlow = consumeDesktopFlow(state);
    const webFlowState = pendingRauthyStates.get(state);

    if (!desktopFlow && !webFlowState) {
      resp.writeHead(400, { "Content-Type": "text/plain" });
      resp.end("Invalid or expired state parameter");
      return;
    }

    if (webFlowState) pendingRauthyStates.delete(state);

    const codeVerifier = desktopFlow?.rauthyCodeVerifier ?? webFlowState?.codeVerifier;

    // Step 1: exchange code for JWT #1 + refresh #1
    let tokens: RauthyTokens;
    try {
      tokens = await exchangeCodeForTokens(
        code,
        `${appBaseUrl()}/auth/rauthy/callback`,
        codeVerifier
      );
    } catch (err) {
      log.error("Rauthy token exchange failed", { error: errorForLog(err) });
      return redirectError(resp, desktopFlow, "token_failed");
    }

    // Step 2: decode JWT #1 payload for upstream identity claims
    const idClaims = decodeIdToken(tokens.id_token);
    if (!idClaims) {
      log.error("Rauthy ID token could not be decoded");
      return redirectError(resp, desktopFlow, "token_failed");
    }

    const rauthySub = typeof idClaims.sub === "string" ? idClaims.sub : "";
    const email = typeof idClaims.email === "string" ? idClaims.email.toLowerCase() : "";
    const name = typeof idClaims.name === "string" ? idClaims.name : "";
    const avatarUrl = typeof idClaims.picture === "string" ? idClaims.picture : "";
    // `preferred_username` is Rauthy's standard handle claim. For the
    // `/auth/rauthy` flow it is populated from the upstream GitHub login
    // (the route hard-codes `idp_hint=github`).
    const idpLogin = typeof idClaims.preferred_username === "string"
      ? idClaims.preferred_username
      : "";

    // `github_login` is a custom OAP attribute emitted under `payload.custom.*`
    // by the `oap` scope (spec 106 FR-002). On first login it is unpopulated
    // because `setRauthyUserAttributes` runs only after membership resolution
    // succeeds (`sessionMint.ts`). To break the chicken-and-egg, fall back to
    // `preferred_username` which, for the GitHub-via-Rauthy path, already
    // carries the GitHub handle. Top-level `github_login` is also accepted
    // for legacy admin-mint sessions during the spec 106 cutover window.
    const customClaims = (idClaims.custom as Record<string, unknown> | undefined) ?? {};
    const githubLoginFromScope =
      typeof customClaims.github_login === "string" ? customClaims.github_login : "";
    const githubLoginTopLevel =
      typeof idClaims.github_login === "string" ? idClaims.github_login : "";
    const githubLogin = githubLoginFromScope || githubLoginTopLevel || idpLogin;

    if (!email || !rauthySub) {
      log.error("Rauthy ID token missing required claims", {
        hasEmail: !!email,
        hasSub: !!rauthySub,
      });
      return redirectError(resp, desktopFlow, "no_email");
    }

    // Step 3: find-or-create OAP user, keyed by rauthy_user_id (JWT sub)
    let user: { id: string; rauthyUserId: string | null };
    try {
      user = await findOrCreateUserByRauthySub({
        rauthySub,
        email,
        name,
        githubLogin,
        avatarUrl,
      });

      if (githubLogin) {
        await db
          .insert(userIdentities)
          .values({
            userId: user.id,
            provider: "github",
            providerUserId: rauthySub, // Rauthy is the issuer now
            providerLogin: githubLogin,
            providerEmail: email,
            avatarUrl: avatarUrl || null,
          })
          .onConflictDoUpdate({
            target: [userIdentities.provider, userIdentities.providerUserId],
            set: {
              providerLogin: githubLogin,
              providerEmail: email,
              avatarUrl: avatarUrl || null,
              updatedAt: new Date(),
            },
          });
      }
    } catch (err) {
      log.error("Account creation/linking failed", { error: errorForLog(err) });
      return redirectError(resp, desktopFlow, "account_error");
    }

    // Step 3b: ensure the local user row points at a Rauthy user. If Rauthy
    // auto-created the user in its own DB the JWT sub is already the Rauthy
    // ID. If an older local-only user row needed one, back-fill it via the
    // admin API.
    let rauthyUserId = user.rauthyUserId;
    try {
      if (!rauthyUserId) {
        // Best-effort: the JWT's sub IS the Rauthy user ID, so normally we
        // just record it. If the local row predates Rauthy entirely,
        // provisionRauthyUser is the idempotent lookup-then-create path.
        rauthyUserId = rauthySub || await provisionRauthyUser({
          email,
          name: name || githubLogin || email,
          loginHint: idpLogin,
        });
        await db.update(users).set({ rauthyUserId }).where(eq(users.id, user.id));
      }
    } catch (err) {
      log.error("Rauthy provisioning failed", { error: errorForLog(err) });
      return redirectError(resp, desktopFlow, "rauthy_unavailable");
    }

    // Step 4: resolve org memberships via the layered A2c resolver
    let matched: Awaited<ReturnType<typeof resolveMembership>>;
    try {
      matched = await resolveMembership(githubLogin, user.id);
    } catch (err) {
      log.error("Membership resolution failed", { error: errorForLog(err) });
      return redirectError(resp, desktopFlow, "membership_failed");
    }

    // Rauthy's `platform_role` user attribute is the source of truth for role
    // elevation (spec 106 FR-002 + FR-005). If Rauthy already carries a role,
    // apply it to every matched org and mirror it into org_memberships so
    // admin/list UIs stay in sync with the JWT claim. On first login the
    // attribute is unpopulated; mintSessionForOrg will seed it.
    const incumbentRole = readIncumbentPlatformRole(idClaims);
    if (incumbentRole && matched.orgs.length > 0) {
      await applyIncumbentRole(user.id, matched.orgs, incumbentRole);
    }

    // Bookkeeping (non-fatal).
    try {
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await db.insert(auditLog).values({
        actorUserId: user.id,
        action: "user.rauthy_login",
        targetType: "user",
        targetId: user.id,
        metadata: {
          github_login: githubLogin,
          orgs_matched: matched.orgs.length,
          reason: matched.reason,
          source: desktopFlow ? "desktop" : "web",
        },
      });
    } catch (err) {
      log.warn("Post-login bookkeeping failed (non-fatal)", { error: errorForLog(err) });
    }

    // Step 5: route by match count
    if (matched.orgs.length === 0) {
      const code = errorCodeForReason(matched.reason);
      return redirectNoOrg(resp, desktopFlow, code, githubLogin || idpLogin);
    }

    if (matched.orgs.length === 1) {
      const org = matched.orgs[0];
      let sessionTokens: RauthyTokens;
      try {
        sessionTokens = await mintSessionForOrg(
          {
            rauthyUserId,
            oapUserId: user.id,
            orgId: org.orgId,
            orgSlug: org.orgSlug,
            githubLogin: githubLogin || undefined,
            idpProvider: "github",
            idpLogin: idpLogin || githubLogin,
            avatarUrl,
            platformRole: org.platformRole,
          },
          tokens.refresh_token
        );
      } catch (err) {
        log.error("Single-org session mint failed", { error: errorForLog(err) });
        return redirectError(resp, desktopFlow, "oauth_failed");
      }

      if (desktopFlow) {
        return finishDesktop(resp, desktopFlow, {
          session: makeDesktopSession({
            user,
            rauthyUserId,
            email,
            name: name || githubLogin || email,
            githubLogin,
            idpProvider: "github",
            idpLogin: idpLogin || githubLogin,
            avatarUrl,
            org,
            tokens: sessionTokens,
            codeChallenge: desktopFlow.codeChallenge,
          }),
        });
      }

      return finishWebSingle(resp, sessionTokens);
    }

    // Multi-org
    if (desktopFlow) {
      return finishDesktop(resp, desktopFlow, {
        session: makeDesktopSession({
          user,
          rauthyUserId,
          email,
          name: name || githubLogin || email,
          githubLogin,
          idpProvider: "github",
          idpLogin: idpLogin || githubLogin,
          avatarUrl,
          orgs: matched.orgs,
          rauthyRefreshToken: tokens.refresh_token,
          codeChallenge: desktopFlow.codeChallenge,
        }),
        multiOrg: true,
      });
    }

    return finishWebMulti(resp, {
      userId: user.id,
      rauthyUserId,
      email,
      name: name || githubLogin || email,
      githubLogin,
      idpProvider: "github",
      idpLogin: idpLogin || githubLogin,
      avatarUrl,
      orgs: matched.orgs,
      rauthyRefreshToken: tokens.refresh_token,
      createdAt: Date.now(),
    });
  }
);

// ---------------------------------------------------------------------------
// Helpers — user provisioning
// ---------------------------------------------------------------------------

async function findOrCreateUserByRauthySub(opts: {
  rauthySub: string;
  email: string;
  name: string;
  githubLogin: string;
  avatarUrl: string;
}): Promise<{ id: string; rauthyUserId: string | null }> {
  // 1. Lookup by existing rauthy_user_id linkage
  if (opts.rauthySub) {
    const [byRauthy] = await db
      .select({ id: users.id, rauthyUserId: users.rauthyUserId })
      .from(users)
      .where(eq(users.rauthyUserId, opts.rauthySub))
      .limit(1);
    if (byRauthy) {
      if (opts.githubLogin || opts.name || opts.avatarUrl) {
        await db
          .update(users)
          .set({
            githubLogin: opts.githubLogin || undefined,
            avatarUrl: opts.avatarUrl || undefined,
            name: opts.name || undefined,
          })
          .where(eq(users.id, byRauthy.id));
      }
      return byRauthy;
    }
  }

  // 2. Fallback: lookup by email, link Rauthy ID
  const [byEmail] = await db
    .select({ id: users.id, rauthyUserId: users.rauthyUserId })
    .from(users)
    .where(eq(users.email, opts.email))
    .limit(1);
  if (byEmail) {
    await db
      .update(users)
      .set({
        rauthyUserId: opts.rauthySub,
        githubLogin: opts.githubLogin || undefined,
        avatarUrl: opts.avatarUrl || undefined,
        name: opts.name || undefined,
      })
      .where(eq(users.id, byEmail.id));
    return { ...byEmail, rauthyUserId: opts.rauthySub };
  }

  // 3. Create new user
  const [created] = await db
    .insert(users)
    .values({
      email: opts.email,
      name: opts.name || opts.githubLogin || opts.email,
      githubLogin: opts.githubLogin || null,
      avatarUrl: opts.avatarUrl || null,
      rauthyUserId: opts.rauthySub || null,
    })
    .returning({ id: users.id, rauthyUserId: users.rauthyUserId });
  return created;
}

/**
 * Mutate each ResolvedOrg and upsert org_memberships so the Rauthy-managed
 * role is reflected everywhere statecraft reads role state. The membership
 * rows exist by this point (afterResolution inserted them) so a plain UPDATE
 * is enough.
 */
async function applyIncumbentRole(
  userId: string,
  orgs: ResolvedOrg[],
  role: PlatformRole
): Promise<void> {
  for (const org of orgs) {
    org.platformRole = role;
    await db
      .update(orgMemberships)
      .set({ platformRole: role, updatedAt: new Date() })
      .where(
        and(
          eq(orgMemberships.userId, userId),
          eq(orgMemberships.orgId, org.orgId),
          eq(orgMemberships.status, "active")
        )
      );
  }
}

// ---------------------------------------------------------------------------
// Helpers — JWT payload decoding (no sig check; validateJwt handles that on
// subsequent API calls). The ID token's signature was already verified by
// our auth handler's JWKS check when we called validateJwt downstream.
// ---------------------------------------------------------------------------

function decodeIdToken(idToken: string): Record<string, unknown> | null {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers — response redirection
// ---------------------------------------------------------------------------

function redirectError(
  resp: import("http").ServerResponse,
  desktopFlow: import("./desktop-state").PendingDesktopFlow | undefined,
  errorCode: string
): void {
  if (desktopFlow) {
    const params = new URLSearchParams({ error: errorCode, state: desktopFlow.desktopState });
    resp.writeHead(302, { Location: `${desktopFlow.redirectUri}?${params}` });
  } else {
    resp.writeHead(302, { Location: `/signin?error=${encodeURIComponent(errorCode)}` });
  }
  resp.end();
}

function redirectNoOrg(
  resp: import("http").ServerResponse,
  desktopFlow: import("./desktop-state").PendingDesktopFlow | undefined,
  errorCode: string,
  loginHint: string
): void {
  if (desktopFlow) {
    return redirectError(resp, desktopFlow, errorCode === "no_orgs" ? "no_orgs" : errorCode);
  }
  const params = new URLSearchParams({ error: errorCode, login: loginHint });
  resp.writeHead(302, { Location: `/auth/no-org?${params}` });
  resp.end();
}

function finishWebSingle(
  resp: import("http").ServerResponse,
  tokens: RauthyTokens
): void {
  const maxAge = Math.min(tokens.expires_in, 14 * 24 * 60 * 60);
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  resp.writeHead(302, {
    Location: "/app",
    "Set-Cookie": [
      `__session=${tokens.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge};${secure}`,
      `__refresh=${tokens.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 60 * 60};${secure}`,
    ],
  });
  resp.end();
}

function finishWebMulti(
  resp: import("http").ServerResponse,
  data: PendingRauthyOrgData
): void {
  cleanupStalePendingOrgs();
  const pendingId = crypto.randomBytes(32).toString("base64url");
  pendingRauthyOrgSelections.set(pendingId, data);
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  resp.writeHead(302, {
    Location: "/auth/org-select",
    "Set-Cookie": `__pending_org=${pendingId}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=300;${secure}`,
  });
  resp.end();
}

interface MakeDesktopOpts {
  user: { id: string };
  rauthyUserId: string;
  email: string;
  name: string;
  githubLogin: string;
  idpProvider: string;
  idpLogin: string;
  avatarUrl: string;
  codeChallenge: string;
  // Single-org path: minted tokens already carry the selected org.
  org?: ResolvedOrg;
  tokens?: RauthyTokens;
  // Multi-org path: raw refresh token to be finalized after user picks.
  orgs?: ResolvedOrg[];
  rauthyRefreshToken?: string;
}

function makeDesktopSession(opts: MakeDesktopOpts): PendingDesktopSession {
  const matched: PendingDesktopSession["matchedOrgs"] = opts.org
    ? [
        {
          orgId: opts.org.orgId,
          orgSlug: opts.org.orgSlug,
          githubOrgLogin: opts.org.githubOrgLogin,
          orgDisplayName: opts.org.orgDisplayName,
          platformRole: opts.org.platformRole,
        },
      ]
    : (opts.orgs ?? []).map((o) => ({
        orgId: o.orgId,
        orgSlug: o.orgSlug,
        githubOrgLogin: o.githubOrgLogin,
        orgDisplayName: o.orgDisplayName,
        platformRole: o.platformRole,
      }));

  return {
    userId: opts.user.id,
    rauthyUserId: opts.rauthyUserId,
    email: opts.email,
    name: opts.name,
    githubLogin: opts.githubLogin,
    idpProvider: opts.idpProvider,
    idpLogin: opts.idpLogin,
    avatarUrl: opts.avatarUrl,
    codeChallenge: opts.codeChallenge,
    matchedOrgs: matched,
    createdAt: Date.now(),
    // Spec 106 FR-004 additions:
    rauthyAccessToken: opts.tokens?.access_token,
    rauthyRefreshToken: opts.tokens?.refresh_token ?? opts.rauthyRefreshToken,
    rauthyExpiresIn: opts.tokens?.expires_in,
  };
}

function finishDesktop(
  resp: import("http").ServerResponse,
  desktopFlow: import("./desktop-state").PendingDesktopFlow,
  opts: { session: PendingDesktopSession; multiOrg?: boolean }
): void {
  cleanupDesktopState();
  const authCode = storeDesktopSession(opts.session);
  const params = new URLSearchParams({
    code: authCode,
    state: desktopFlow.desktopState,
  });
  if (opts.multiOrg) params.set("multi_org", "true");
  resp.writeHead(302, { Location: `${desktopFlow.redirectUri}?${params}` });
  resp.end();
}

// ---------------------------------------------------------------------------
// Re-exports for orgSelectComplete
// ---------------------------------------------------------------------------

export async function finalizeRauthyOrgSelection(
  pendingId: string,
  selectedOrgId: string
): Promise<{ tokens: RauthyTokens; data: PendingRauthyOrgData } | null> {
  const data = pendingRauthyOrgSelections.get(pendingId);
  if (!data) return null;
  pendingRauthyOrgSelections.delete(pendingId);

  const org = data.orgs.find((o) => o.orgId === selectedOrgId);
  if (!org) return null;

  // Verify membership still active (defence in depth — resolver already did).
  const [ok] = await db
    .select({ status: orgMemberships.status })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.userId, data.userId),
        eq(orgMemberships.orgId, org.orgId),
        eq(orgMemberships.status, "active")
      )
    )
    .limit(1);
  if (!ok) return null;

  const [orgRow] = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, org.orgId))
    .limit(1);

  const tokens = await mintSessionForOrg(
    {
      rauthyUserId: data.rauthyUserId,
      oapUserId: data.userId,
      orgId: org.orgId,
      orgSlug: orgRow?.slug ?? org.orgSlug,
      githubLogin: data.githubLogin || undefined,
      idpProvider: data.idpProvider,
      idpLogin: data.idpLogin,
      avatarUrl: data.avatarUrl,
      platformRole: org.platformRole,
    },
    data.rauthyRefreshToken
  );

  return { tokens, data };
}

/**
 * Finalize org selection for desktop flows (multi-org path). The pending
 * session carries the raw refresh token produced by /auth/rauthy/callback;
 * after the user picks an org, desktopOrgSelect calls this helper to write
 * attrs + refresh so the final tokens carry the selected oap_* claims.
 */
export async function finalizeDesktopRauthyOrg(
  session: PendingDesktopSession,
  selectedOrgId: string
): Promise<RauthyTokens | null> {
  const org = session.matchedOrgs.find((o) => o.orgId === selectedOrgId);
  if (!org) return null;
  const refreshToken = session.rauthyRefreshToken;
  if (!refreshToken) return null;

  return mintSessionForOrg(
    {
      rauthyUserId: session.rauthyUserId,
      oapUserId: session.userId,
      orgId: org.orgId,
      orgSlug: org.orgSlug,
      githubLogin: session.githubLogin || undefined,
      idpProvider: session.idpProvider,
      idpLogin: session.idpLogin,
      avatarUrl: session.avatarUrl,
      platformRole: org.platformRole as "owner" | "admin" | "member",
    },
    refreshToken
  );
}

// Keep lint quiet on unused imports kept for the spec 087 session shape.
void pendingDesktopSessions;
