/**
 * Parameterized data access for user_account (INV-2). Every query uses Encore's
 * tagged-template API; there is no string-concatenation path.
 */
import { db } from "../db/db";
import type { SSOProfile, UserRecord } from "./types";

export async function upsertUserFromProfile(profile: SSOProfile): Promise<UserRecord> {
  const attributes = JSON.stringify(profile.attributes ?? {});
  const row = await db.queryRow<UserRecord>`
    INSERT INTO user_account
      (email, name, user_roles, sso_provider, sso_provider_id, attributes, last_login_at)
    VALUES
      (${profile.email}, ${profile.name}, ${profile.roles}, ${profile.ssoProvider},
       ${profile.ssoProviderId}, ${attributes}::jsonb, now())
    ON CONFLICT (lower(email)) DO UPDATE SET
      name            = EXCLUDED.name,
      user_roles      = EXCLUDED.user_roles,
      sso_provider    = EXCLUDED.sso_provider,
      sso_provider_id = EXCLUDED.sso_provider_id,
      attributes      = EXCLUDED.attributes,
      last_login_at   = now(),
      updated_at      = now()
    RETURNING *
  `;
  // The upsert always returns a row.
  return row as UserRecord;
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  return db.queryRow<UserRecord>`SELECT * FROM user_account WHERE id = ${id}`;
}
