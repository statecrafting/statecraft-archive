/**
 * Cookie names and default options (INV-3).
 *
 * Access, refresh, and CSRF cookies are all httpOnly + sameSite=lax, and secure
 * in production. No token is readable from JavaScript; the CSRF token is also
 * delivered in the csrf-token response body so the SPA can replay it as a header
 * (double-submit, INV-4).
 */
import { env } from "./env";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
export const CSRF_COOKIE = "csrf_token";

export const ACCESS_TOKEN_MAX_AGE = 15 * 60;
export const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60;

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
  path: string;
  maxAge?: number;
}

export function authCookieOptions(maxAge?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "Lax",
    path: "/",
    maxAge,
  };
}
