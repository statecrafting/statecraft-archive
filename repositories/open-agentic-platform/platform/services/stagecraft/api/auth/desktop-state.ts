/**
 * Shared state for desktop OAuth flows (spec 080 Phase 1).
 *
 * Separated to avoid circular imports between github.ts and desktop.ts.
 */
import crypto from "crypto";

export interface PendingDesktopFlow {
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  desktopState: string; // The state OPC sent (returned in the deep-link)
  createdAt: number;
  // PKCE verifier for the statecraft ↔ Rauthy leg (spec 106 sequence step 4).
  // The `codeChallenge` field above is the OPC ↔ statecraft PKCE.
  rauthyCodeVerifier: string;
}

export interface PendingDesktopSession {
  userId: string;
  rauthyUserId: string;
  email: string;
  name: string;
  githubLogin: string;      // empty for enterprise IdP users
  idpProvider: string;       // github | azure-ad | okta | etc.
  idpLogin: string;          // provider-specific display name
  avatarUrl: string;
  codeChallenge: string; // Passed through from PendingDesktopFlow for PKCE verification
  // Spec 119: workspace collapsed into project; matched orgs no longer carry
  // an active-workspace id. Project scope is per-request after login.
  matchedOrgs: Array<{
    orgId: string;
    orgSlug: string;
    githubOrgLogin: string;  // empty for enterprise orgs
    orgDisplayName: string;  // best display name (githubOrgLogin || orgSlug)
    platformRole: string;
  }>;
  createdAt: number;
  // Spec 106 FR-004: Rauthy-minted tokens from the callback.
  // Single-org path: access+refresh+expires populated from the post-attribute-write refresh.
  // Multi-org path: only rauthyRefreshToken is populated; access/expires are minted after
  // the user picks an org via finalizeDesktopRauthyOrg.
  rauthyAccessToken?: string;
  rauthyRefreshToken?: string;
  rauthyExpiresIn?: number;
}

// Maps keyed by the GITHUB OAuth state (used in the callback)
export const pendingDesktopFlows = new Map<string, PendingDesktopFlow>();

// Maps keyed by a one-time auth code (returned to OPC in the deep-link)
export const pendingDesktopSessions = new Map<string, PendingDesktopSession>();

const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function cleanupDesktopState(): void {
  const now = Date.now();
  for (const [key, val] of pendingDesktopFlows) {
    if (now - val.createdAt > FLOW_TTL_MS) pendingDesktopFlows.delete(key);
  }
  for (const [key, val] of pendingDesktopSessions) {
    if (now - val.createdAt > SESSION_TTL_MS) pendingDesktopSessions.delete(key);
  }
}

/** Check whether a GitHub OAuth callback state belongs to a desktop flow. */
export function isDesktopFlow(githubState: string): boolean {
  return pendingDesktopFlows.has(githubState);
}

/** Consume a desktop flow entry (returns and deletes it). */
export function consumeDesktopFlow(githubState: string): PendingDesktopFlow | undefined {
  const flow = pendingDesktopFlows.get(githubState);
  if (flow) pendingDesktopFlows.delete(githubState);
  return flow;
}

/** Generate a one-time auth code and store the pending session. */
export function storeDesktopSession(session: PendingDesktopSession): string {
  const authCode = crypto.randomBytes(32).toString("base64url");
  pendingDesktopSessions.set(authCode, session);
  return authCode;
}

/** Consume a pending desktop session (returns and deletes it). */
export function consumeDesktopSession(authCode: string): PendingDesktopSession | undefined {
  const session = pendingDesktopSessions.get(authCode);
  if (session) pendingDesktopSessions.delete(authCode);
  return session;
}
