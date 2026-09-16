/**
 * Factory upstream PAT CRUD (spec 109 §6).
 *
 * Org-scoped operational credential used by the Factory sync worker to
 * clone the configured factory_source / template_source. Replaces the
 * silent-anonymous fallback for private upstreams. Reuses patCrypto for
 * storage-at-rest and patProbe for validation.
 */

import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { getAuthData } from "~encore/auth";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { auditLog, factoryUpstreamPats } from "../db/schema";
import { hasOrgPermission } from "../auth/membership";
import { encryptPat, decryptPat } from "../auth/patCrypto";
import { classifyFormat, probeGitHub, tokenPrefix } from "../auth/patProbe";
import { errorForLog } from "../auth/errorLog";

export interface FactoryUpstreamPatMetadata {
  exists: boolean;
  tokenPrefix?: string;
  isFineGrained?: boolean;
  scopes?: string[];
  githubLogin?: string | null;
  lastUsedAt?: string | null;
  lastCheckedAt?: string;
  createdAt?: string;
}

export interface FactoryUpstreamPatValidationResult {
  ok: boolean;
  tokenPrefix: string;
  isFineGrained: boolean;
  scopes: string[];
  lastCheckedAt: string;
  githubLogin?: string;
  reason?: "pat_invalid" | "pat_rate_limited" | "pat_saml_not_authorized";
}

// ---------------------------------------------------------------------------
// GET /api/factory/upstreams/pat — metadata only
// ---------------------------------------------------------------------------

export const getFactoryUpstreamPat = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/upstreams/pat",
  },
  async (): Promise<FactoryUpstreamPatMetadata> => {
    const auth = getAuthData()!;
    const [row] = await db
      .select()
      .from(factoryUpstreamPats)
      .where(eq(factoryUpstreamPats.orgId, auth.orgId))
      .limit(1);

    if (!row) return { exists: false };

    return {
      exists: true,
      tokenPrefix: row.tokenPrefix,
      isFineGrained: row.isFineGrained,
      scopes: row.scopes,
      githubLogin: row.githubLogin,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      lastCheckedAt: row.lastCheckedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
);

// ---------------------------------------------------------------------------
// POST /api/factory/upstreams/pat — store/replace
// ---------------------------------------------------------------------------

interface StoreFactoryUpstreamPatRequest {
  token: string;
}

export const storeFactoryUpstreamPat = api<
  StoreFactoryUpstreamPatRequest,
  FactoryUpstreamPatValidationResult
>(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/factory/upstreams/pat",
  },
  async (req) => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "factory:configure")) {
      throw APIError.permissionDenied(
        "Only org admins can configure the Factory upstream PAT"
      );
    }

    const token = (req.token ?? "").trim();
    if (!token) {
      throw APIError.invalidArgument("token is required");
    }

    const fmt = classifyFormat(token);
    if (!fmt) {
      throw APIError.invalidArgument(
        "Unrecognised token format. Expected a GitHub PAT (ghp_*, github_pat_*, ghs_*, gho_*, or ghu_*)"
      );
    }

    let probe: Awaited<ReturnType<typeof probeGitHub>>;
    try {
      probe = await probeGitHub(token);
    } catch (err) {
      log.warn("factory upstream PAT probe failed", {
        orgId: auth.orgId,
        error: errorForLog(err),
      });
      throw APIError.unavailable("Could not reach GitHub to validate token");
    }

    const now = new Date();
    const prefix = tokenPrefix(token);

    if (!probe.ok) {
      return {
        ok: false,
        tokenPrefix: prefix,
        isFineGrained: fmt.isFineGrained,
        scopes: [],
        lastCheckedAt: now.toISOString(),
        reason: probe.reason,
      };
    }

    let tokenEnc: Buffer;
    let tokenNonce: Buffer;
    try {
      ({ tokenEnc, tokenNonce } = encryptPat(token));
    } catch (err) {
      log.error("factory upstream PAT encryption failed", {
        orgId: auth.orgId,
        error: errorForLog(err),
      });
      throw APIError.internal(
        "PAT encryption is not configured (set the PAT_ENCRYPTION_KEY secret)"
      );
    }

    await db
      .insert(factoryUpstreamPats)
      .values({
        orgId: auth.orgId,
        tokenEnc,
        tokenNonce,
        tokenPrefix: prefix,
        scopes: probe.scopes,
        isFineGrained: fmt.isFineGrained,
        githubLogin: probe.githubLogin,
        lastCheckedAt: now,
        createdBy: auth.userID,
      })
      .onConflictDoUpdate({
        target: factoryUpstreamPats.orgId,
        set: {
          tokenEnc,
          tokenNonce,
          tokenPrefix: prefix,
          scopes: probe.scopes,
          isFineGrained: fmt.isFineGrained,
          githubLogin: probe.githubLogin,
          lastCheckedAt: now,
          lastUsedAt: null,
          createdBy: auth.userID,
          updatedAt: now,
        },
      });

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "pat.factory.stored",
      targetType: "factory_upstream_pats",
      targetId: auth.orgId,
      metadata: {
        prefix,
        is_fine_grained: fmt.isFineGrained,
        scopes: probe.scopes,
        github_login: probe.githubLogin,
      },
    });

    return {
      ok: true,
      tokenPrefix: prefix,
      isFineGrained: fmt.isFineGrained,
      scopes: probe.scopes,
      lastCheckedAt: now.toISOString(),
      githubLogin: probe.githubLogin,
    };
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/factory/upstreams/pat — hard delete
// ---------------------------------------------------------------------------

export const revokeFactoryUpstreamPat = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/factory/upstreams/pat",
  },
  async (): Promise<{ revoked: boolean }> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "factory:configure")) {
      throw APIError.permissionDenied(
        "Only org admins can revoke the Factory upstream PAT"
      );
    }

    const deleted = await db
      .delete(factoryUpstreamPats)
      .where(eq(factoryUpstreamPats.orgId, auth.orgId))
      .returning({ orgId: factoryUpstreamPats.orgId });

    if (deleted.length === 0) return { revoked: false };

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "pat.factory.revoked",
      targetType: "factory_upstream_pats",
      targetId: auth.orgId,
      metadata: { reason: "user_requested" },
    });

    return { revoked: true };
  }
);

// ---------------------------------------------------------------------------
// POST /api/factory/upstreams/pat/validate — re-probe without rotating
// ---------------------------------------------------------------------------

export const validateFactoryUpstreamPat = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/factory/upstreams/pat/validate",
  },
  async (): Promise<FactoryUpstreamPatValidationResult> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "factory:configure")) {
      throw APIError.permissionDenied(
        "Only org admins can revalidate the Factory upstream PAT"
      );
    }

    const [row] = await db
      .select()
      .from(factoryUpstreamPats)
      .where(eq(factoryUpstreamPats.orgId, auth.orgId))
      .limit(1);

    if (!row) {
      throw APIError.notFound("No Factory upstream PAT configured");
    }

    let token: string;
    try {
      token = decryptPat(row.tokenEnc, row.tokenNonce);
    } catch (err) {
      log.error("factory upstream PAT decryption failed", {
        orgId: auth.orgId,
        error: errorForLog(err),
      });
      throw APIError.internal("Stored token could not be decrypted");
    }

    let probe: Awaited<ReturnType<typeof probeGitHub>>;
    try {
      probe = await probeGitHub(token);
    } catch (err) {
      log.warn("factory upstream PAT re-probe failed", {
        orgId: auth.orgId,
        error: errorForLog(err),
      });
      throw APIError.unavailable("Could not reach GitHub");
    }

    const now = new Date();

    if (!probe.ok) {
      await db
        .update(factoryUpstreamPats)
        .set({ lastCheckedAt: now, updatedAt: now })
        .where(eq(factoryUpstreamPats.orgId, auth.orgId));

      return {
        ok: false,
        tokenPrefix: row.tokenPrefix,
        isFineGrained: row.isFineGrained,
        scopes: row.scopes,
        lastCheckedAt: now.toISOString(),
        reason: probe.reason,
      };
    }

    await db
      .update(factoryUpstreamPats)
      .set({
        lastCheckedAt: now,
        scopes: probe.scopes,
        githubLogin: probe.githubLogin,
        updatedAt: now,
      })
      .where(eq(factoryUpstreamPats.orgId, auth.orgId));

    return {
      ok: true,
      tokenPrefix: row.tokenPrefix,
      isFineGrained: row.isFineGrained,
      scopes: probe.scopes,
      lastCheckedAt: now.toISOString(),
      githubLogin: probe.githubLogin,
    };
  }
);

// ---------------------------------------------------------------------------
// Internal helper — used by the sync worker to resolve a token for an org.
// Returns plaintext token + decrypted metadata, or null if no PAT on file.
// Stamps last_used_at on read so the UI can surface when it was last used.
// ---------------------------------------------------------------------------

export async function loadFactoryUpstreamPatToken(
  orgId: string
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(factoryUpstreamPats)
    .where(eq(factoryUpstreamPats.orgId, orgId))
    .limit(1);

  if (!row) return null;

  let token: string;
  try {
    token = decryptPat(row.tokenEnc, row.tokenNonce);
  } catch (err) {
    log.error("factory upstream PAT decryption failed during load", {
      orgId,
      error: errorForLog(err),
    });
    throw new Error(
      "factory upstream PAT could not be decrypted — check PAT_ENCRYPTION_KEY and that the stored nonce/ciphertext have not been tampered with"
    );
  }
  await db
    .update(factoryUpstreamPats)
    .set({ lastUsedAt: new Date() })
    .where(eq(factoryUpstreamPats.orgId, orgId));
  return token;
}
