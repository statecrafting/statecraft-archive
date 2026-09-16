/**
 * Shared login finalization (spec 003 service helpers): mint the RS256 token
 * pair, persist the refresh-token hash, set httpOnly cookies, and write the
 * best-effort login audit record (INV-3, INV-7, INV-8).
 */
import type { ServerResponse } from "node:http";
import { signAccessToken, signRefreshToken } from "../lib/jwt";
import { setAuthCookies } from "../lib/cookies";
import { writeAudit } from "../lib/audit";
import { env } from "../lib/env";
import { upsertUserFromProfile } from "./user-model";
import { storeRefreshToken } from "./refresh-token-model";
import type { SSOProfile, UserRecord } from "./types";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function issueTokenPair(
  user: UserRecord,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<TokenPair> {
  const accessToken = await signAccessToken({
    userID: user.id,
    email: user.email,
    name: user.name,
    roles: user.user_roles,
    ssoProvider: user.sso_provider,
  });
  const refresh = await signRefreshToken(user.id);
  await storeRefreshToken({
    userID: user.id,
    token: refresh.token,
    expiresAt: refresh.expiresAt,
    userAgent: meta?.userAgent,
    ipAddress: meta?.ipAddress,
  });
  return { accessToken, refreshToken: refresh.token };
}

export async function finalizeLogin(
  res: ServerResponse,
  profile: SSOProfile,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<UserRecord> {
  const user = await upsertUserFromProfile(profile);
  const pair = await issueTokenPair(user, meta);
  setAuthCookies(res, pair);
  await writeAudit({
    action: "auth.login",
    tableName: "user_account",
    recordId: user.id,
    actorId: user.id,
    actorEmail: user.email,
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    newData: { ssoProvider: profile.ssoProvider },
  });
  return user;
}

export function frontendUrl(path = "/"): string {
  return new URL(path, env.frontendUrl).toString();
}
