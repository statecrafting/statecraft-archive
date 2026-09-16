// Spec 139 Phase 1 — `/api/factory/artifacts/conflicts*` endpoints.
//
// Lists rows where `conflict_state='diverged'` and applies user-driven
// resolution (`keep_mine` | `take_upstream`). Phase 1 ships those two
// resolutions only; `edit_and_accept` is deferred to Phase 2 (per spec
// §11 risk 1) — the endpoint accepts the action shape but rejects it
// with a `failed_precondition` until Phase 2 lands the merge editor.
//
// All mutations write a `factory_artifact_substrate_audit` row with
// `action='artifact.conflict_resolved'` inside the same transaction.

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { factoryArtifactSubstrate, factoryArtifactSubstrateAudit } from "../db/schema";
import { hasOrgPermission } from "../auth/membership";
import { sha256Hex, type SubstrateRow } from "./substrate";
import { assertOverrideGate, type ArtifactDetail } from "./artifacts";
import {
  publishOverrideScanRun,
  recordOverrideScanIntent,
} from "./overrideScanCore";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export type ConflictsListResponse = {
  conflicts: ArtifactConflictSummary[];
};

export type ArtifactConflictSummary = {
  id: string;
  origin: string;
  path: string;
  kind: string;
  /** Upstream sha at the moment the user authored their override. */
  conflictUpstreamSha: string | null;
  /** Latest upstream sha — the one that triggered the divergence. */
  upstreamSha: string | null;
  upstreamBody: string | null;
  userBody: string | null;
  contentHash: string;
};

export type ResolveConflictAction =
  | "keep_mine"
  | "take_upstream"
  | "edit_and_accept";

export type ResolveConflictRequest = {
  action: ResolveConflictAction;
  /** Required when `action === 'edit_and_accept'` (Phase 2). */
  body?: string;
};

export interface ConflictsAuth {
  orgId: string;
  userID: string;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export async function listConflictsCore(
  auth: ConflictsAuth,
): Promise<ConflictsListResponse> {
  const rows = await db
    .select()
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, auth.orgId),
        eq(factoryArtifactSubstrate.conflictState, "diverged"),
      ),
    )
    .orderBy(asc(factoryArtifactSubstrate.origin), asc(factoryArtifactSubstrate.path));

  return {
    conflicts: rows.map((r) => ({
      id: r.id,
      origin: r.origin,
      path: r.path,
      kind: r.kind,
      conflictUpstreamSha: r.conflictUpstreamSha,
      upstreamSha: r.upstreamSha,
      upstreamBody: r.upstreamBody,
      userBody: r.userBody,
      contentHash: r.contentHash,
    })),
  };
}

export type ResolveConflictArgs = {
  orgId: string;
  userId: string;
  artifactId: string;
  action: ResolveConflictAction;
  body?: string;
};

export async function resolveConflictCore(
  args: ResolveConflictArgs,
): Promise<SubstrateRow> {
  const { row, scanRunId } = await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(factoryArtifactSubstrate)
      .where(
        and(
          eq(factoryArtifactSubstrate.orgId, args.orgId),
          eq(factoryArtifactSubstrate.id, args.artifactId),
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      throw APIError.notFound(`artifact ${args.artifactId} not found`);
    }
    if (existing.conflictState !== "diverged") {
      throw APIError.failedPrecondition(
        `artifact ${args.artifactId} is not in 'diverged' state (current: ${existing.conflictState ?? "null"})`,
      );
    }

    const now = new Date();
    let updateSet: Partial<typeof factoryArtifactSubstrate.$inferInsert>;

    switch (args.action) {
      case "keep_mine":
        updateSet = {
          conflictState: "ok",
          conflictResolvedAt: now,
          conflictResolvedBy: args.userId,
          updatedAt: now,
        };
        break;
      case "take_upstream":
        updateSet = {
          userBody: null,
          userModifiedAt: now,
          userModifiedBy: args.userId,
          // Spec 198 FR-013(c): verified state dies with the override.
          userBodyVerified: false,
          verifiedBy: null,
          verifiedAt: null,
          contentHash: sha256Hex(existing.upstreamBody ?? ""),
          conflictState: "ok",
          conflictUpstreamSha: null,
          conflictResolvedAt: now,
          conflictResolvedBy: args.userId,
          updatedAt: now,
        };
        break;
      case "edit_and_accept":
        // Spec 139 Phase 2 (T058) — accept a hand-merged body. The
        // server stores it as `user_body`, recomputes content_hash, and
        // clears divergence. The merge UI handles the three-way diff;
        // the server validates presence + length and runs the spec 198
        // FR-013(a) gate (this arm is an override revision by another door).
        if (typeof args.body !== "string") {
          throw APIError.invalidArgument(
            "edit_and_accept requires a `body` string",
          );
        }
        if (args.body.length === 0) {
          throw APIError.invalidArgument(
            "edit_and_accept body must be non-empty",
          );
        }
        await assertOverrideGate(
          {
            orgId: args.orgId,
            userId: args.userId,
            artifactId: existing.id,
            kind: existing.kind,
            path: existing.path,
          },
          args.body,
        );
        updateSet = {
          userBody: args.body,
          userModifiedAt: now,
          userModifiedBy: args.userId,
          // Spec 198 FR-013(c): a hand-merged body is a new, unverified
          // override revision.
          userBodyVerified: false,
          verifiedBy: null,
          verifiedAt: null,
          contentHash: sha256Hex(args.body),
          conflictState: "ok",
          conflictUpstreamSha: null,
          conflictResolvedAt: now,
          conflictResolvedBy: args.userId,
          updatedAt: now,
        };
        break;
      default:
        throw APIError.invalidArgument(
          `unknown resolve action: ${String(args.action)}`,
        );
    }

    const updatedRows = await tx
      .update(factoryArtifactSubstrate)
      .set(updateSet)
      .where(eq(factoryArtifactSubstrate.id, existing.id))
      .returning();
    const updated = updatedRows[0];

    await tx.insert(factoryArtifactSubstrateAudit).values({
      artifactId: updated.id,
      orgId: args.orgId,
      action: "artifact.conflict_resolved",
      actorUserId: args.userId,
      before: {
        conflictState: existing.conflictState,
        userBody: existing.userBody,
      },
      after: {
        conflictState: updated.conflictState,
        userBody: updated.userBody,
        action: args.action,
      },
    });

    // Spec 200 FR-001 — `edit_and_accept` is an override revision by
    // another door (the same write-path class as `applyOverrideCore`);
    // the accepted body enqueues a scan with durable intent in this
    // transaction, published after commit.
    let scanRunId: string | null = null;
    if (args.action === "edit_and_accept") {
      const intent = await recordOverrideScanIntent(
        tx as unknown as typeof db,
        {
          orgId: args.orgId,
          artifactId: updated.id,
          contentHash: updated.contentHash,
          reason: "conflict_edit_accepted",
        },
      );
      scanRunId = intent.outcome === "recorded" ? intent.scanRunId : null;
    }

    return { row: mapStoredRowToSubstrate(updated), scanRunId };
  });
  if (scanRunId) await publishOverrideScanRun(scanRunId);
  return row;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

export const listConflicts = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/artifacts/conflicts",
  },
  async (): Promise<ConflictsListResponse> => {
    const auth = getAuthData()!;
    return listConflictsCore({ orgId: auth.orgId, userID: auth.userID });
  },
);

export const resolveConflict = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/factory/artifacts/:id/resolve",
  },
  async (
    req: { id: string } & ResolveConflictRequest,
  ): Promise<ArtifactDetail> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "factory:configure")) {
      throw APIError.permissionDenied(
        "factory:configure permission required to resolve a conflict",
      );
    }
    const row = await resolveConflictCore({
      orgId: auth.orgId,
      userId: auth.userID,
      artifactId: req.id,
      action: req.action,
      body: req.body,
    });
    return {
      id: row.id,
      orgId: row.orgId,
      origin: row.origin,
      path: row.path,
      kind: row.kind,
      bundleId: row.bundleId,
      version: row.version,
      status: row.status,
      contentHash: row.contentHash,
      conflictState: row.conflictState,
      hasOverride: row.userBody !== null,
      overrideVerified: row.userBody !== null ? row.userBodyVerified : null,
      syncedAt: row.updatedAt.toISOString(),
      upstreamSha: row.upstreamSha,
      upstreamBody: row.upstreamBody,
      userBody: row.userBody,
      effectiveBody: row.effectiveBody,
      frontmatter: row.frontmatter,
      conflictUpstreamSha: row.conflictUpstreamSha,
      userModifiedAt: row.userModifiedAt
        ? row.userModifiedAt.toISOString()
        : null,
      userModifiedBy: row.userModifiedBy,
      verifiedBy: row.verifiedBy,
      verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    };
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StoredArtifactRow = typeof factoryArtifactSubstrate.$inferSelect;

function mapStoredRowToSubstrate(row: StoredArtifactRow): SubstrateRow {
  return {
    id: row.id,
    orgId: row.orgId,
    origin: row.origin,
    path: row.path,
    kind: row.kind,
    bundleId: row.bundleId,
    version: row.version,
    status: row.status,
    upstreamSha: row.upstreamSha,
    upstreamBody: row.upstreamBody,
    userBody: row.userBody,
    userModifiedAt: row.userModifiedAt,
    userModifiedBy: row.userModifiedBy,
    userBodyVerified: row.userBodyVerified,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    effectiveBody: row.effectiveBody,
    contentHash: row.contentHash,
    frontmatter: (row.frontmatter as Record<string, unknown> | null) ?? null,
    conflictState: row.conflictState ?? null,
    conflictUpstreamSha: row.conflictUpstreamSha,
    conflictResolvedAt: row.conflictResolvedAt,
    conflictResolvedBy: row.conflictResolvedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
