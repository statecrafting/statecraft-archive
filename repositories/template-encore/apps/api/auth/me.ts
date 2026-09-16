/**
 * GET /api/v1/auth/me: the current principal's bare profile (spec 003, spec 006).
 * auth:true, so the Gateway authHandler has already populated AuthData.
 */
import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { getUserById } from "./user-model";
import type { MeResponse } from "./types";

export const me = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/auth/me" },
  async (): Promise<MeResponse> => {
    const auth = getAuthData()!;
    const user = await getUserById(auth.userID);
    if (!user) {
      throw APIError.notFound("user not found");
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.user_roles,
      ssoProvider: user.sso_provider,
      isActive: user.is_active,
      lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
      createdAt: new Date(user.created_at).toISOString(),
    };
  },
);
