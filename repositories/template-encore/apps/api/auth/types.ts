/** Identity surfaced by the authHandler to every auth:true endpoint (spec 003). */
export interface AuthData {
  userID: string;
  email: string;
  name: string;
  roles: string[];
  ssoProvider: string;
}

/** Normalized profile a driver returns before it is resolved to a user_account row. */
export interface SSOProfile {
  ssoProvider: string;
  ssoProviderId: string;
  email: string;
  name: string;
  roles: string[];
  attributes?: Record<string, unknown>;
}

/** A row of the user_account table (snake_case as returned by the database). */
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  user_roles: string[];
  sso_provider: string;
  sso_provider_id: string | null;
  attributes: Record<string, unknown>;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Bare profile payload returned by GET /api/v1/auth/me (spec 006 FR-001). */
export interface MeResponse {
  id: string;
  email: string;
  name: string;
  roles: string[];
  ssoProvider: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
