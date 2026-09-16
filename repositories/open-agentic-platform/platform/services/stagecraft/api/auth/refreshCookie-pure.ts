/**
 * Pure helpers for POST /auth/refresh (spec 143 FU-023).
 *
 * Kept side-effect-free so they can be unit-tested without an Encore harness.
 * The Encore endpoint wrapper lives in `./refreshCookie.ts`.
 */

import { type RauthyTokens } from "./rauthy";

/**
 * Parse the `__refresh` value out of a Cookie header.
 *
 * Mirrors the parsing pattern used by `orgSwitchCookie` (github.ts:333) and
 * the auth handler's `__session` parse (handler.ts:95). Returns null when
 * the cookie is absent.
 */
export function parseRefreshCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)__refresh=([^\s;]+)/);
  return match ? match[1] : null;
}

/**
 * Build the rotated Set-Cookie header pair for a successful refresh.
 *
 * Matches the cookie builder pattern in `rauthyCallback.ts:557-558` and
 * `oidc.ts:723-725` verbatim — same attribute order, same Max-Age math
 * (session = min(expires_in, 14d); refresh = 14d), same Secure-in-prod gate.
 *
 * Rauthy 0.35 emits a rotated refresh token on each refresh-token grant; the
 * stub's coordination flag asks for empirical confirmation during the
 * verification path (done-when leg d). If Rauthy returns the same refresh
 * token, rewriting __refresh is a harmless idempotent write.
 */
export function buildRefreshSetCookies(tokens: RauthyTokens, secure: boolean): string[] {
  const maxAge = Math.min(tokens.expires_in, 14 * 24 * 60 * 60);
  const secureAttr = secure ? " Secure;" : "";
  return [
    `__session=${tokens.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge};${secureAttr}`,
    `__refresh=${tokens.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 60 * 60};${secureAttr}`,
  ];
}
