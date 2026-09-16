/**
 * User-management API types (spec 003). Response shapes are bare payloads
 * (no { success, data } envelope) — the Express envelope is retired.
 */

/** An app-managed role from the app_role catalog. */
export interface AppRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
}

/**
 * A user as seen by the admin surface: the user_account identity plus the two
 * role views — appRoles (this service's app_role assignments) and idpRoles
 * (the IdP-sourced user_account.user_roles the JWT carries).
 */
export interface UserSummary {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  appRoles: string[];
  idpRoles: string[];
}
