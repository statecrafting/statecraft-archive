/**
 * Rauthy-native session minting (spec 106 FR-003/FR-004).
 *
 * Replaces the removed `issueRauthySession` admin-mint shortcut with the only
 * real path Rauthy 0.35 supports: write OAP custom attributes, then call
 * `/oidc/token` refresh so the next-issued JWT carries the attributes under
 * the `oap` scope.
 *
 * Callers supply the org/workspace/role context they want reflected in the
 * new JWT plus the Rauthy refresh token that the upstream OIDC exchange
 * produced (spec 106 §3.1 step "refresh_token"). Rauthy rotates the refresh
 * token on every call; callers MUST persist the returned refresh token for
 * the next refresh.
 */

import log from "encore.dev/log";
import {
  setRauthyUserAttributes,
  refreshTokens,
  type OapUserAttributes,
  type RauthyTokens,
} from "./rauthy";

export interface SessionMintContext {
  rauthyUserId: string;
  oapUserId: string;
  orgId: string;
  orgSlug: string;
  githubLogin?: string;
  idpProvider?: string;
  idpLogin?: string;
  avatarUrl?: string;
  platformRole: "owner" | "admin" | "member";
}

/**
 * Write attributes for the selected org context and refresh to produce a JWT
 * that carries the corresponding `custom.oap_*` claims.
 */
export async function mintSessionForOrg(
  ctx: SessionMintContext,
  rauthyRefreshToken: string
): Promise<RauthyTokens> {
  const attrs: OapUserAttributes = {
    oap_user_id: ctx.oapUserId,
    oap_org_id: ctx.orgId,
    oap_org_slug: ctx.orgSlug,
    github_login: ctx.githubLogin,
    idp_provider: ctx.idpProvider ?? (ctx.githubLogin ? "github" : ""),
    idp_login: ctx.idpLogin ?? ctx.githubLogin ?? "",
    avatar_url: ctx.avatarUrl,
    platform_role: ctx.platformRole,
  };

  await setRauthyUserAttributes(ctx.rauthyUserId, attrs);

  const tokens = await refreshTokens(rauthyRefreshToken);
  log.info("Rauthy session minted via attribute write + refresh", {
    rauthyUserId: ctx.rauthyUserId,
    orgId: ctx.orgId,
  });
  return tokens;
}
