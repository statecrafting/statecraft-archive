/**
 * Refresh-token persistence (INV-7). Only the SHA-256 hash of a token is stored;
 * rotation marks the presented token revoked and links it to its replacement.
 * Parameterized queries only (INV-2).
 */
import { db } from "../db/db";
import { hashRefreshToken } from "../lib/jwt";

export interface StoredRefreshToken {
  id: string;
  user_id: string;
}

export async function storeRefreshToken(params: {
  userID: string;
  token: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}): Promise<string> {
  const hash = hashRefreshToken(params.token);
  const row = await db.queryRow<{ id: string }>`
    INSERT INTO refresh_token (user_id, token_hash, expires_at, user_agent, ip_address)
    VALUES (${params.userID}, ${hash}, ${params.expiresAt}, ${params.userAgent ?? null}, ${params.ipAddress ?? null})
    RETURNING id
  `;
  return (row as { id: string }).id;
}

export async function findActiveRefreshToken(token: string): Promise<StoredRefreshToken | null> {
  const hash = hashRefreshToken(token);
  return db.queryRow<StoredRefreshToken>`
    SELECT id, user_id
    FROM refresh_token
    WHERE token_hash = ${hash} AND revoked_at IS NULL AND expires_at > now()
  `;
}

export async function revokeRefreshToken(id: string, replacedBy?: string): Promise<void> {
  await db.exec`
    UPDATE refresh_token
    SET revoked_at = now(), replaced_by = ${replacedBy ?? null}
    WHERE id = ${id} AND revoked_at IS NULL
  `;
}

export async function revokeAllUserTokens(userID: string): Promise<void> {
  await db.exec`
    UPDATE refresh_token SET revoked_at = now()
    WHERE user_id = ${userID} AND revoked_at IS NULL
  `;
}
