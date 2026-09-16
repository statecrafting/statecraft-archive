/**
 * Enterprise OIDC login flow (spec 080 Phase 4–5).
 *
 * Routes enterprise users through Rauthy's OIDC authorization endpoint,
 * which federates to the configured upstream IdP (Azure AD, Okta, Google
 * Workspace, or any generic OIDC provider). Statecraft receives the
 * callback from Rauthy and performs JIT user provisioning + org membership
 * resolution from OIDC group claims.
 *
 * Endpoints:
 *   GET  /auth/oidc             — redirect to Rauthy authorize (with IdP hint)
 *   GET  /auth/oidc/callback    — exchange Rauthy code for tokens, JIT provision
 *   GET  /auth/oidc/discover    — resolve IdP from email domain
 */

import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import crypto from "crypto";
import { applyRateLimit, checkRateLimit } from "./rate-limit";
import { db } from "../db/drizzle";
import {
  users,
  userIdentities,
  organizations,
  oidcProviders,
  auditLog,
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  generatePkcePair,
  provisionRauthyUser,
  resolveUpstreamProviderId,
  validateJwt,
  type RauthyTokens,
} from "./rauthy";
import { mintSessionForOrg } from "./sessionMint";
import { resolveOidcMemberships, type ResolvedOrg } from "./membership";
import { appBaseUrl } from "./github";
import {
  consumeDesktopFlow,
  storeDesktopSession,
  cleanupDesktopState,
  type PendingDesktopFlow,
} from "./desktop-state";
import { errorForLog } from "./errorLog";

// ---------------------------------------------------------------------------
// Ephemeral state for OIDC CSRF protection
// ---------------------------------------------------------------------------

export interface PendingOidcState {
  providerId: string;
  orgId: string;
  createdAt: number;
  codeVerifier: string;
}

export const pendingOidcStates = new Map<string, PendingOidcState>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cleanupStaleOidcStates() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [key, val] of pendingOidcStates) {
    if (val.createdAt < cutoff) pendingOidcStates.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Pending org data store for multi-org OIDC users
// ---------------------------------------------------------------------------

export interface PendingOidcOrgData {
  userId: string;
  rauthyUserId: string;
  email: string;
  name: string;
  idpProvider: string;
  idpLogin: string;
  avatarUrl: string;
  orgs: ResolvedOrg[];
  /**
   * Rauthy refresh token from the OIDC exchange. Stashed here so that
   * `orgSelectComplete` (web) / desktop org-select can mint the post-pick
   * JWT via `setRauthyUserAttributes + refreshTokens` (spec 106 FR-004).
   */
  rauthyRefreshToken: string;
  createdAt: number;
}

export const pendingOidcOrgSelections = new Map<string, PendingOidcOrgData>();
const PENDING_ORG_TTL_MS = 5 * 60 * 1000;

function cleanupStalePendingOidc() {
  const cutoff = Date.now() - PENDING_ORG_TTL_MS;
  for (const [key, val] of pendingOidcOrgSelections) {
    if (val.createdAt < cutoff) pendingOidcOrgSelections.delete(key);
  }
}

// ---------------------------------------------------------------------------
// GET /auth/oidc/discover — resolve IdP from email domain
// ---------------------------------------------------------------------------

export const oidcDiscover = api(
  { expose: true, method: "GET", path: "/auth/oidc/discover", auth: false },
  async (req: { email: string }): Promise<{ found: boolean; providerId?: string; providerName?: string }> => {
    // Minimal mitigation for the email-domain-to-SSO enumeration oracle: this
    // is an unauthenticated, unkeyed endpoint whose entire purpose is to
    // answer "does this email have SSO", so a generic response shape would
    // defeat the feature rather than fix the leak. Rate limiting (global,
    // matching the desktopToken/desktopRefresh precedent in desktop.ts,
    // since typed api() handlers have no per-IP hook the way api.raw()
    // handlers do via applyRateLimit) at least slows domain enumeration.
    // A fuller fix (per-IP throttling, CAPTCHA, or removing the oracle by
    // routing all sign-in through a single generic form) is out of scope
    // for this pass.
    const retryAfter = checkRateLimit("oidc-discover-global");
    if (retryAfter !== null) {
      throw APIError.resourceExhausted(`Rate limited. Retry after ${retryAfter}s`);
    }

    if (!req.email || !req.email.includes("@")) {
      throw APIError.invalidArgument("Valid email address required");
    }

    const domain = req.email.split("@")[1].toLowerCase();

    const [provider] = await db
      .select({
        id: oidcProviders.id,
        name: oidcProviders.name,
      })
      .from(oidcProviders)
      .where(
        and(
          eq(oidcProviders.emailDomain, domain),
          eq(oidcProviders.status, "active")
        )
      )
      .limit(1);

    if (!provider) {
      return { found: false };
    }

    return { found: true, providerId: provider.id, providerName: provider.name };
  }
);

// ---------------------------------------------------------------------------
// GET /auth/oidc — initiate enterprise OIDC login
// ---------------------------------------------------------------------------

export const oidcLogin = api.raw(
  { expose: true, method: "GET", path: "/auth/oidc", auth: false },
  async (req, resp) => {
    if (applyRateLimit(req, resp)) return;
    cleanupStaleOidcStates();

    const url = new URL(req.url!, `http://${req.headers.host}`);
    const providerId = url.searchParams.get("provider");
    const email = url.searchParams.get("email");

    // Resolve provider: either by explicit ID or by email domain
    let providerRow;
    if (providerId) {
      [providerRow] = await db
        .select()
        .from(oidcProviders)
        .where(and(eq(oidcProviders.id, providerId), eq(oidcProviders.status, "active")))
        .limit(1);
    } else if (email && email.includes("@")) {
      const domain = email.split("@")[1].toLowerCase();
      [providerRow] = await db
        .select()
        .from(oidcProviders)
        .where(and(eq(oidcProviders.emailDomain, domain), eq(oidcProviders.status, "active")))
        .limit(1);
    }

    if (!providerRow) {
      resp.writeHead(302, { Location: "/signin?error=no_provider" });
      resp.end();
      return;
    }

    // Generate CSRF state with provider context
    const state = crypto.randomBytes(32).toString("base64url");
    const { codeVerifier, codeChallenge } = generatePkcePair();
    pendingOidcStates.set(state, {
      providerId: providerRow.id,
      orgId: providerRow.orgId,
      createdAt: Date.now(),
      codeVerifier,
    });

    // Build Rauthy authorization URL with the upstream-provider direct-login
    // hint. Rauthy's `idp_hint` takes the provider *id* (random string), not
    // its name, so resolve the configured name to its Rauthy id first.
    const redirectUri = `${appBaseUrl()}/auth/oidc/callback`;
    const authUrl = buildAuthorizationUrl({
      redirectUri,
      state,
      scopes: providerRow.scopes.split(" ").filter(Boolean),
      idpHint: (await resolveUpstreamProviderId(providerRow.name)) ?? undefined,
      codeChallenge,
      codeChallengeMethod: "S256",
    });

    // Append login_hint (email) to pre-fill the upstream provider's form.
    const authUrlObj = new URL(authUrl);
    if (email) authUrlObj.searchParams.set("login_hint", email);

    resp.writeHead(302, { Location: authUrlObj.toString() });
    resp.end();
  }
);

// ---------------------------------------------------------------------------
// GET /auth/oidc/callback — handle Rauthy OIDC callback
// ---------------------------------------------------------------------------

export const oidcCallback = api.raw(
  { expose: true, method: "GET", path: "/auth/oidc/callback", auth: false },
  async (req, resp) => {
    if (applyRateLimit(req, resp)) return;
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Handle OIDC errors
    if (error) {
      log.warn("OIDC callback error", { error });
      resp.writeHead(302, { Location: "/signin?error=oidc_denied" });
      resp.end();
      return;
    }

    if (!code || !state) {
      resp.writeHead(400, { "Content-Type": "text/plain" });
      resp.end("Missing code or state parameter");
      return;
    }

    // Validate CSRF state
    const pendingState = pendingOidcStates.get(state);
    if (!pendingState) {
      resp.writeHead(400, { "Content-Type": "text/plain" });
      resp.end("Invalid or expired state parameter");
      return;
    }
    pendingOidcStates.delete(state);

    // Desktop flow detection — if this state was initiated by
    // /auth/desktop/authorize with an idp_hint, route to opc:// deep-link
    // instead of setting a web session cookie.
    // Note: desktopAuthorize registers the state in BOTH pendingDesktopFlows
    // and pendingOidcStates so that CSRF validation above succeeds.
    const desktopFlow = consumeDesktopFlow(state);

    // Load the OIDC provider config
    const [provider] = await db
      .select()
      .from(oidcProviders)
      .where(eq(oidcProviders.id, pendingState.providerId))
      .limit(1);

    if (!provider) {
      resp.writeHead(302, { Location: "/signin?error=no_provider" });
      resp.end();
      return;
    }

    // Stage 1: Exchange authorization code for Rauthy tokens
    let rauthyTokens;
    try {
      rauthyTokens = await exchangeCodeForTokens(
        code,
        `${appBaseUrl()}/auth/oidc/callback`,
        pendingState.codeVerifier
      );
    } catch (err) {
      log.error("OIDC token exchange failed", { error: errorForLog(err) });
      resp.writeHead(302, { Location: "/signin?error=token_failed" });
      resp.end();
      return;
    }

    // Stage 2: Validate the ID token signature via JWKS and extract claims.
    // The access token is validated later by the auth handler, but we must
    // verify the ID token here because we extract identity claims from it.
    let idTokenClaims: Record<string, unknown>;
    try {
      const verified = await validateJwt(rauthyTokens.id_token);
      if (!verified) {
        throw new Error("ID token signature verification failed");
      }
      // validateJwt returns typed OapClaims, but the ID token from Rauthy
      // carries upstream IdP claims too — re-decode the full payload.
      const parts = rauthyTokens.id_token.split(".");
      idTokenClaims = JSON.parse(
        Buffer.from(parts[1], "base64url").toString()
      );
    } catch (err) {
      log.error("Failed to validate ID token", { error: errorForLog(err) });
      resp.writeHead(302, { Location: "/signin?error=token_failed" });
      resp.end();
      return;
    }

    // Extract identity fields from claims (using claims_mapping if configured)
    const claimsMap = (provider.claimsMapping as Record<string, string>) ?? {};
    const email = String(
      idTokenClaims[claimsMap.email ?? "email"] ?? ""
    ).toLowerCase();
    const name = String(
      idTokenClaims[claimsMap.name ?? "name"] ??
      idTokenClaims[claimsMap.preferred_username ?? "preferred_username"] ??
      email.split("@")[0]
    );
    const sub = String(idTokenClaims.sub ?? "");
    const avatarUrl = String(idTokenClaims[claimsMap.picture ?? "picture"] ?? "");
    const groups = extractGroups(idTokenClaims, claimsMap);
    const idpLogin = String(
      idTokenClaims[claimsMap.preferred_username ?? "preferred_username"] ??
      email
    );

    if (!email || !sub) {
      log.error("OIDC ID token missing required claims", { claims: Object.keys(idTokenClaims) });
      resp.writeHead(302, { Location: "/signin?error=no_email" });
      resp.end();
      return;
    }

    // Stage 3: JIT provision — find or create OAP user
    let user: { id: string; rauthyUserId: string | null };
    try {
      user = await jitProvisionUser({
        email,
        name,
        sub,
        idpProvider: provider.providerType,
        idpLogin,
        avatarUrl,
        autoProvision: provider.autoProvision,
      });

      // Upsert identity linkage
      await db
        .insert(userIdentities)
        .values({
          userId: user.id,
          provider: provider.providerType,
          providerUserId: sub,
          providerLogin: idpLogin,
          providerEmail: email,
          avatarUrl: avatarUrl || null,
          accessTokenEnc: rauthyTokens.access_token,
          refreshTokenEnc: rauthyTokens.refresh_token || null,
          tokenExpiresAt: rauthyTokens.expires_in
            ? new Date(Date.now() + rauthyTokens.expires_in * 1000)
            : null,
        })
        .onConflictDoUpdate({
          target: [userIdentities.provider, userIdentities.providerUserId],
          set: {
            providerLogin: idpLogin,
            providerEmail: email,
            avatarUrl: avatarUrl || null,
            accessTokenEnc: rauthyTokens.access_token,
            refreshTokenEnc: rauthyTokens.refresh_token || null,
            tokenExpiresAt: rauthyTokens.expires_in
              ? new Date(Date.now() + rauthyTokens.expires_in * 1000)
              : null,
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      log.error("OIDC account provisioning failed", { error: errorForLog(err) });
      resp.writeHead(302, { Location: "/signin?error=account_error" });
      resp.end();
      return;
    }

    // Stage 4: Resolve org memberships from OIDC group claims
    let matchedOrgs: ResolvedOrg[];
    try {
      matchedOrgs = await resolveOidcMemberships(
        user.id,
        provider.id,
        provider.orgId,
        groups
      );
    } catch (err) {
      log.error("OIDC org membership resolution failed", { error: errorForLog(err) });
      resp.writeHead(302, { Location: "/signin?error=membership_failed" });
      resp.end();
      return;
    }

    // Stage 5: Ensure Rauthy user exists
    let rauthyUserId = user.rauthyUserId;
    try {
      if (!rauthyUserId) {
        rauthyUserId = await provisionRauthyUser({
          email,
          name,
          loginHint: idpLogin,
        });
        await db
          .update(users)
          .set({ rauthyUserId })
          .where(eq(users.id, user.id));
      }
    } catch (err) {
      log.error("Rauthy provisioning failed for OIDC user", { error: errorForLog(err) });
      resp.writeHead(302, { Location: "/signin?error=rauthy_unavailable" });
      resp.end();
      return;
    }

    // Bookkeeping (non-fatal)
    try {
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await db.insert(auditLog).values({
        actorUserId: user.id,
        action: "user.oidc_login",
        targetType: "user",
        targetId: user.id,
        metadata: {
          idp_provider: provider.providerType,
          idp_login: idpLogin,
          orgs_matched: matchedOrgs.length,
          provider_name: provider.name,
        },
      });
    } catch (err) {
      log.warn("OIDC post-login bookkeeping failed (non-fatal)", { error: errorForLog(err) });
    }

    // Desktop OIDC flow — redirect to opc:// deep-link instead of web session
    if (desktopFlow) {
      try {
        const redirectDesktopError = (errorCode: string) => {
          const params = new URLSearchParams({ error: errorCode, state: desktopFlow.desktopState });
          resp.writeHead(302, { Location: `${desktopFlow.redirectUri}?${params}` });
          resp.end();
        };

        if (matchedOrgs.length === 0) {
          return redirectDesktopError("no_orgs");
        }

        cleanupDesktopState();

        // Single-org: mint immediately so the deep-link carries ready-to-use
        // tokens. Multi-org: stash the refresh token and let desktopOrgSelect
        // finalise after the user picks.
        let sessionTokens: RauthyTokens | null = null;
        if (matchedOrgs.length === 1) {
          const org = matchedOrgs[0];
          sessionTokens = await mintSessionForOrg(
            {
              rauthyUserId: rauthyUserId!,
              oapUserId: user.id,
              orgId: org.orgId,
              orgSlug: org.orgSlug,
              idpProvider: provider.providerType,
              idpLogin,
              avatarUrl,
              platformRole: org.platformRole,
            },
            rauthyTokens.refresh_token
          );
        }

        const authCode = storeDesktopSession({
          userId: user.id,
          rauthyUserId: rauthyUserId!,
          email,
          name,
          githubLogin: "",
          idpProvider: provider.providerType,
          idpLogin,
          avatarUrl,
          codeChallenge: desktopFlow.codeChallenge,
          matchedOrgs: matchedOrgs.map((o) => ({
            orgId: o.orgId,
            orgSlug: o.orgSlug,
            githubOrgLogin: o.githubOrgLogin,
            orgDisplayName: o.orgDisplayName,
            platformRole: o.platformRole,
          })),
          createdAt: Date.now(),
          rauthyAccessToken: sessionTokens?.access_token,
          rauthyRefreshToken: sessionTokens?.refresh_token ?? rauthyTokens.refresh_token,
          rauthyExpiresIn: sessionTokens?.expires_in,
        });

        const params = new URLSearchParams({
          code: authCode,
          state: desktopFlow.desktopState,
        });
        if (matchedOrgs.length > 1) {
          params.set("multi_org", "true");
        }
        resp.writeHead(302, { Location: `${desktopFlow.redirectUri}?${params}` });
        resp.end();
      } catch (err) {
        log.error("OIDC desktop session creation failed", { error: errorForLog(err) });
        const params = new URLSearchParams({ error: "oauth_failed", state: desktopFlow.desktopState });
        resp.writeHead(302, { Location: `${desktopFlow.redirectUri}?${params}` });
        resp.end();
      }
      return;
    }

    // Web flow — route based on matched orgs
    try {
      if (matchedOrgs.length === 0) {
        resp.writeHead(302, {
          Location: "/auth/no-org?login=" + encodeURIComponent(idpLogin) + "&provider=" + encodeURIComponent(provider.providerType),
        });
        resp.end();
        return;
      }

      if (matchedOrgs.length === 1) {
        const org = matchedOrgs[0];
        const cookies = await buildOidcSessionCookies(
          {
            id: user.id,
            rauthyUserId: rauthyUserId!,
            email,
            name,
            idpProvider: provider.providerType,
            idpLogin,
            avatarUrl,
          },
          org,
          rauthyTokens.refresh_token
        );
        resp.writeHead(302, {
          Location: "/app",
          "Set-Cookie": cookies,
        });
        resp.end();
        return;
      }

      // Multiple orgs — store pending data and redirect to picker
      cleanupStalePendingOidc();
      const pendingId = crypto.randomBytes(32).toString("base64url");
      pendingOidcOrgSelections.set(pendingId, {
        userId: user.id,
        rauthyUserId: rauthyUserId!,
        email,
        name,
        idpProvider: provider.providerType,
        idpLogin,
        avatarUrl,
        orgs: matchedOrgs,
        rauthyRefreshToken: rauthyTokens.refresh_token,
        createdAt: Date.now(),
      });

      const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
      resp.writeHead(302, {
        Location: "/auth/org-select",
        "Set-Cookie": `__pending_org=${pendingId}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=300;${secure}`,
      });
      resp.end();
    } catch (err) {
      log.error("OIDC session creation failed", { error: errorForLog(err) });
      resp.writeHead(302, { Location: "/signin?error=oauth_failed" });
      resp.end();
    }
  }
);

// Note: OIDC org-select completion is handled by the unified
// /auth/org-select/complete endpoint in github.ts, which checks both
// pendingOrgSelections and pendingOidcOrgSelections. Similarly,
// /auth/pending-orgs returns data for both GitHub and OIDC flows.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract group claims from the OIDC ID token.
 * Azure AD uses "groups", Okta uses "groups", Google Workspace uses custom claims.
 */
function extractGroups(
  claims: Record<string, unknown>,
  claimsMap: Record<string, string>
): string[] {
  const groupClaimName = claimsMap.groups ?? "groups";
  const raw = claims[groupClaimName];

  if (Array.isArray(raw)) {
    return raw.map(String);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * JIT (Just-In-Time) provision an OAP user from OIDC claims.
 */
async function jitProvisionUser(opts: {
  email: string;
  name: string;
  sub: string;
  idpProvider: string;
  idpLogin: string;
  avatarUrl: string;
  autoProvision: boolean;
}): Promise<{ id: string; rauthyUserId: string | null }> {
  // Try to find by IdP subject (most specific match)
  const [byIdentity] = await db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, opts.idpProvider),
        eq(userIdentities.providerUserId, opts.sub)
      )
    )
    .limit(1);

  if (byIdentity) {
    const [user] = await db
      .select({ id: users.id, rauthyUserId: users.rauthyUserId })
      .from(users)
      .where(eq(users.id, byIdentity.userId))
      .limit(1);

    if (user) {
      // Update profile fields
      await db
        .update(users)
        .set({
          name: opts.name,
          avatarUrl: opts.avatarUrl || undefined,
          idpProvider: opts.idpProvider,
          idpSubject: opts.sub,
        })
        .where(eq(users.id, user.id));
      return user;
    }
  }

  // Try to find by email
  const [byEmail] = await db
    .select({ id: users.id, rauthyUserId: users.rauthyUserId })
    .from(users)
    .where(eq(users.email, opts.email))
    .limit(1);

  if (byEmail) {
    // Link IdP identity to existing account
    await db
      .update(users)
      .set({
        avatarUrl: opts.avatarUrl || undefined,
        idpProvider: opts.idpProvider,
        idpSubject: opts.sub,
      })
      .where(eq(users.id, byEmail.id));
    return byEmail;
  }

  // Auto-provision new user if enabled
  if (!opts.autoProvision) {
    throw new Error("User not found and auto-provisioning is disabled for this IdP");
  }

  const [created] = await db
    .insert(users)
    .values({
      email: opts.email,
      name: opts.name,
      avatarUrl: opts.avatarUrl || null,
      idpProvider: opts.idpProvider,
      idpSubject: opts.sub,
    })
    .returning({ id: users.id, rauthyUserId: users.rauthyUserId });

  log.info("JIT provisioned new user from OIDC", {
    userId: created.id,
    idpProvider: opts.idpProvider,
    email: opts.email,
  });

  return created;
}

/**
 * Build Rauthy `__session` + `__refresh` cookies for an OIDC-authenticated
 * user. Spec 106 FR-004: custom claims are produced by the standard
 * `setRauthyUserAttributes + refreshTokens` pair — never by admin-minted
 * sessions.
 */
export async function buildOidcSessionCookies(
  user: {
    id: string;
    rauthyUserId: string;
    email: string;
    name: string;
    idpProvider: string;
    idpLogin: string;
    avatarUrl: string;
  },
  org: ResolvedOrg,
  rauthyRefreshToken: string
): Promise<string[]> {
  const tokens: RauthyTokens = await mintSessionForOrg(
    {
      rauthyUserId: user.rauthyUserId,
      oapUserId: user.id,
      orgId: org.orgId,
      orgSlug: org.orgSlug,
      idpProvider: user.idpProvider,
      idpLogin: user.idpLogin,
      avatarUrl: user.avatarUrl,
      platformRole: org.platformRole,
    },
    rauthyRefreshToken
  );

  const maxAge = Math.min(tokens.expires_in, 14 * 24 * 60 * 60);
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return [
    `__session=${tokens.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge};${secure}`,
    `__refresh=${tokens.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 60 * 60};${secure}`,
  ];
}
