/**
 * Auth types for workspace-scoped identity (spec 087 section 6).
 *
 * One identity, two sessions:
 * - Web session: Rauthy-issued JWT in browser cookie
 * - Desktop session: Rauthy-issued JWT in OS keychain
 * Both obtained via GitHub OAuth.
 */

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export interface WorkspaceSession {
  userId: string;
  orgId: string;
  orgSlug: string;
  githubLogin: string;
  platformRole: PlatformRole;
  email: string;
  name: string;
  avatarUrl?: string;
}

export type PlatformRole = "owner" | "admin" | "member";

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export interface TokenClaims {
  sub: string;
  oap_user_id: string;
  oap_org_id: string;
  oap_org_slug: string;
  github_login: string;
  platform_role: PlatformRole;
  exp: number;
  iat: number;
}

// ---------------------------------------------------------------------------
// M2M auth (OPC ↔ Statecraft)
// ---------------------------------------------------------------------------

export interface M2MTokenRequest {
  clientId: string;
  clientSecret: string;
  scope: string;
}

export interface M2MTokenResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}
