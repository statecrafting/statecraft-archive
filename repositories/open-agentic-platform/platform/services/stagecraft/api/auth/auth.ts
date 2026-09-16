/**
 * Auth endpoints — Phase 6 hardened (spec 080).
 *
 * Signout is now authenticated and performs server-side revocation:
 * revokes Rauthy sessions, deletes desktop refresh tokens, clears cookie.
 */

import { api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import { auditLog, desktopRefreshTokens, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { revokeSession } from "./rauthy";
import { errorForLog } from "./errorLog";

export interface AuthSignoutResponse {
  ok: boolean;
  setCookie?: string;
}

const USER_COOKIE = "__session";
const ADMIN_COOKIE = "__admin_session";

function clearCookieHeader(name: string, path: string): string {
  const secure =
    process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0;${secure}`;
}

export const signout = api(
  { expose: true, auth: true, method: "POST", path: "/auth/signout" },
  async (): Promise<AuthSignoutResponse> => {
    const auth = getAuthData()!;

    // Revoke Rauthy sessions for this user
    const [user] = await db
      .select({ rauthyUserId: users.rauthyUserId })
      .from(users)
      .where(eq(users.id, auth.userID))
      .limit(1);

    if (user?.rauthyUserId) {
      try {
        await revokeSession(user.rauthyUserId);
      } catch (err) {
        log.warn("Failed to revoke Rauthy session on signout", { error: errorForLog(err) });
      }
    }

    // Delete all desktop refresh tokens for this user
    await db.delete(desktopRefreshTokens).where(eq(desktopRefreshTokens.userId, auth.userID));

    // Audit log
    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "user.signout",
      targetType: "user",
      targetId: auth.userID,
      metadata: {},
    });

    return { ok: true, setCookie: clearCookieHeader(USER_COOKIE, "/") };
  }
);

export const adminSignout = api(
  { expose: true, auth: true, method: "POST", path: "/admin/auth/signout" },
  async (): Promise<AuthSignoutResponse> => {
    const auth = getAuthData()!;

    const [user] = await db
      .select({ rauthyUserId: users.rauthyUserId })
      .from(users)
      .where(eq(users.id, auth.userID))
      .limit(1);

    if (user?.rauthyUserId) {
      try {
        await revokeSession(user.rauthyUserId);
      } catch (err) {
        log.warn("Failed to revoke Rauthy session on admin signout", { error: errorForLog(err) });
      }
    }

    await db.delete(desktopRefreshTokens).where(eq(desktopRefreshTokens.userId, auth.userID));

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "user.signout",
      targetType: "user",
      targetId: auth.userID,
      metadata: { scope: "admin" },
    });

    return { ok: true, setCookie: clearCookieHeader(ADMIN_COOKIE, "/admin") };
  }
);
