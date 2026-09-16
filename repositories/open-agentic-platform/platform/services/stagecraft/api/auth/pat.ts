/**
 * GitHub Personal Access Token CRUD + validation (spec 106 FR-006).
 *
 * The PAT is the documented fallback when the GitHub App installation
 * strategy cannot resolve a user's org memberships (e.g. the org refuses
 * to install the statecraft app). All endpoints are user-scoped — a user
 * can only ever touch their own row.
 *
 * Design notes:
 *
 *   • Tokens are encrypted at rest via patCrypto (AES-256-GCM).
 *   • Only one active row per user (enforced by a partial unique index on
 *     user_github_pats where revoked_at IS NULL). POST replaces any
 *     existing active row.
 *   • Format classification: fine-grained tokens start with `github_pat_`,
 *     classic tokens with `ghp_` / `ghs_` / `gho_` / `ghu_`. Anything else
 *     is rejected before we call GitHub.
 *   • Validation: we probe `GET /user` and `GET /user/orgs` with the token
 *     and capture the X-OAuth-Scopes header when present (classic tokens).
 *   • GET returns metadata only — never the token.
 */

import { api, APIError } from "encore.dev/api";
import { CronJob } from "encore.dev/cron";
import log from "encore.dev/log";
import { getAuthData } from "~encore/auth";
import { db } from "../db/drizzle";
import { userGithubPats, auditLog } from "../db/schema";
import { and, eq, isNull, lt } from "drizzle-orm";
import { encryptPat, decryptPat } from "./patCrypto";
import { errorForLog } from "./errorLog";
import { classifyFormat, probeGitHub, tokenPrefix } from "./patProbe";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatMetadata {
  exists: boolean;
  tokenPrefix?: string;
  isFineGrained?: boolean;
  scopes?: string[];
  lastUsedAt?: string;
  lastCheckedAt?: string;
  createdAt?: string;
}

export interface PatValidationResult {
  ok: boolean;
  tokenPrefix: string;
  isFineGrained: boolean;
  scopes: string[];
  lastCheckedAt: string;
  githubLogin?: string;
  /** When ok === false, the reason code (see spec 106 FR-006 error table). */
  reason?: "pat_invalid" | "pat_rate_limited" | "pat_saml_not_authorized";
}

// ---------------------------------------------------------------------------
// GET /auth/pat — metadata only, never the token
// ---------------------------------------------------------------------------

export const getPat = api(
  { expose: true, auth: true, method: "GET", path: "/auth/pat" },
  async (): Promise<PatMetadata> => {
    const auth = getAuthData()!;

    const [row] = await db
      .select()
      .from(userGithubPats)
      .where(and(eq(userGithubPats.userId, auth.userID), isNull(userGithubPats.revokedAt)))
      .limit(1);

    if (!row) return { exists: false };

    return {
      exists: true,
      tokenPrefix: row.tokenPrefix,
      isFineGrained: row.isFineGrained,
      scopes: row.scopes,
      lastUsedAt: row.lastUsedAt?.toISOString(),
      lastCheckedAt: row.lastCheckedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
);

// ---------------------------------------------------------------------------
// POST /auth/pat — store / replace PAT
// ---------------------------------------------------------------------------

interface StorePatRequest {
  token: string;
}

export const storePat = api<StorePatRequest, PatValidationResult>(
  { expose: true, auth: true, method: "POST", path: "/auth/pat" },
  async (req) => {
    const auth = getAuthData()!;
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

    // Validate against GitHub before storing.
    let probe: Awaited<ReturnType<typeof probeGitHub>>;
    try {
      probe = await probeGitHub(token);
    } catch (err) {
      log.warn("PAT probe failed", { userId: auth.userID, error: errorForLog(err) });
      throw APIError.unavailable("Could not reach GitHub to validate PAT");
    }

    const now = new Date();
    const prefix = tokenPrefix(token);

    if (!probe.ok) {
      // Don't persist an invalid token.
      return {
        ok: false,
        tokenPrefix: prefix,
        isFineGrained: fmt.isFineGrained,
        scopes: [],
        lastCheckedAt: now.toISOString(),
        reason: probe.reason,
      };
    }

    // Replace-semantics: revoke any existing active row, then insert.
    // The partial unique index enforces at most one active row per user.
    await db
      .update(userGithubPats)
      .set({ revokedAt: now })
      .where(
        and(eq(userGithubPats.userId, auth.userID), isNull(userGithubPats.revokedAt))
      );

    let tokenEnc: Buffer;
    let tokenNonce: Buffer;
    try {
      ({ tokenEnc, tokenNonce } = encryptPat(token));
    } catch (err) {
      log.error("PAT encryption failed", {
        userId: auth.userID,
        error: errorForLog(err),
      });
      throw APIError.internal(
        "PAT encryption is not configured (set the PAT_ENCRYPTION_KEY secret)"
      );
    }

    await db.insert(userGithubPats).values({
      userId: auth.userID,
      tokenEnc,
      tokenNonce,
      tokenPrefix: prefix,
      scopes: probe.scopes,
      isFineGrained: fmt.isFineGrained,
      lastCheckedAt: now,
    });

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "pat.stored",
      targetType: "user",
      targetId: auth.userID,
      metadata: {
        prefix,
        is_fine_grained: fmt.isFineGrained,
        scopes: probe.scopes,
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
// DELETE /auth/pat — revoke active PAT
// ---------------------------------------------------------------------------

export const revokePat = api(
  { expose: true, auth: true, method: "DELETE", path: "/auth/pat" },
  async (): Promise<{ revoked: boolean }> => {
    const auth = getAuthData()!;

    const updated = await db
      .update(userGithubPats)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(userGithubPats.userId, auth.userID), isNull(userGithubPats.revokedAt))
      )
      .returning({ id: userGithubPats.id });

    if (updated.length === 0) return { revoked: false };

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "pat.revoked",
      targetType: "user",
      targetId: auth.userID,
      metadata: { reason: "user_requested" },
    });

    return { revoked: true };
  }
);

// ---------------------------------------------------------------------------
// POST /auth/pat/validate — re-probe stored PAT without rotating it
// ---------------------------------------------------------------------------

export const validatePat = api(
  { expose: true, auth: true, method: "POST", path: "/auth/pat/validate" },
  async (): Promise<PatValidationResult> => {
    const auth = getAuthData()!;

    const [row] = await db
      .select()
      .from(userGithubPats)
      .where(and(eq(userGithubPats.userId, auth.userID), isNull(userGithubPats.revokedAt)))
      .limit(1);

    if (!row) {
      throw APIError.notFound("No active PAT stored");
    }

    let token: string;
    try {
      token = decryptPat(row.tokenEnc, row.tokenNonce);
    } catch (err) {
      log.error("PAT decryption failed during validate", {
        userId: auth.userID,
        error: errorForLog(err),
      });
      throw APIError.internal("Stored PAT could not be decrypted");
    }

    let probe: Awaited<ReturnType<typeof probeGitHub>>;
    try {
      probe = await probeGitHub(token);
    } catch (err) {
      log.warn("PAT re-probe failed", { userId: auth.userID, error: errorForLog(err) });
      throw APIError.unavailable("Could not reach GitHub");
    }

    const now = new Date();

    if (!probe.ok) {
      if (probe.reason === "pat_invalid") {
        // Clear the row — next login will prompt the user for a new PAT.
        await db
          .update(userGithubPats)
          .set({ revokedAt: now })
          .where(eq(userGithubPats.id, row.id));
        await db.insert(auditLog).values({
          actorUserId: auth.userID,
          action: "pat.revoked",
          targetType: "user",
          targetId: auth.userID,
          metadata: { reason: "validation_failed_401" },
        });
      } else {
        await db
          .update(userGithubPats)
          .set({ lastCheckedAt: now })
          .where(eq(userGithubPats.id, row.id));
      }
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
      .update(userGithubPats)
      .set({
        lastCheckedAt: now,
        scopes: probe.scopes,
      })
      .where(eq(userGithubPats.id, row.id));

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
// Weekly re-validation cron (spec 106 FR-006: "background task re-validates
// PATs weekly (last_checked_at > 7d) and marks as revoked any returning 401")
// ---------------------------------------------------------------------------

export const runPatRevalidation = api(
  { expose: false, method: "POST", path: "/internal/auth/pat-revalidate" },
  async (): Promise<void> => {
    const staleBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const stale = await db
      .select()
      .from(userGithubPats)
      .where(
        and(
          isNull(userGithubPats.revokedAt),
          lt(userGithubPats.lastCheckedAt, staleBefore)
        )
      );

    log.info("PAT revalidation sweep starting", { candidates: stale.length });

    let revoked = 0;
    let refreshed = 0;
    let skipped = 0;

    for (const row of stale) {
      let token: string;
      try {
        token = decryptPat(row.tokenEnc, row.tokenNonce);
      } catch (err) {
        log.error("PAT decryption failed in cron; revoking", {
          rowId: row.id,
          userId: row.userId,
          error: errorForLog(err),
        });
        await db
          .update(userGithubPats)
          .set({ revokedAt: new Date() })
          .where(eq(userGithubPats.id, row.id));
        revoked++;
        continue;
      }

      let probe: Awaited<ReturnType<typeof probeGitHub>>;
      try {
        probe = await probeGitHub(token);
      } catch (err) {
        log.warn("PAT probe network failure; will retry next run", {
          rowId: row.id,
          userId: row.userId,
          error: errorForLog(err),
        });
        skipped++;
        continue;
      }

      const now = new Date();
      if (!probe.ok && probe.reason === "pat_invalid") {
        await db
          .update(userGithubPats)
          .set({ revokedAt: now })
          .where(eq(userGithubPats.id, row.id));
        await db.insert(auditLog).values({
          actorUserId: SYSTEM_USER_ID,
          action: "pat.revoked",
          targetType: "user",
          targetId: row.userId,
          metadata: { reason: "revalidation_401" },
        });
        revoked++;
      } else if (probe.ok) {
        await db
          .update(userGithubPats)
          .set({ lastCheckedAt: now, scopes: probe.scopes })
          .where(eq(userGithubPats.id, row.id));
        refreshed++;
      } else {
        // Rate-limited or SAML — don't revoke, just stamp the check.
        await db
          .update(userGithubPats)
          .set({ lastCheckedAt: now })
          .where(eq(userGithubPats.id, row.id));
        skipped++;
      }
    }

    log.info("PAT revalidation sweep completed", {
      candidates: stale.length,
      revoked,
      refreshed,
      skipped,
    });
  }
);

const _patRevalidationCron = new CronJob("pat-revalidation", {
  title: "GitHub PAT weekly revalidation",
  every: "24h",
  endpoint: runPatRevalidation,
});
void _patRevalidationCron;
