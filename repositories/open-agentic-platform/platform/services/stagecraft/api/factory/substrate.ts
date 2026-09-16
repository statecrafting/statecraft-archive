// Spec 139 Phase 1 — factory artifact substrate (TS side).
//
// Provides:
//   - SUBSTRATE_VERSION compile-time const (mirrored in
//     `crates/factory-engine/src/substrate_version.rs`). Bump on every
//     row-shape change; mismatches across the TS/Rust pair fail at build
//     per project-memory schema-version discipline.
//   - SubstrateRow type — the runtime view of one `factory_artifacts` row
//     (joined with the SQL-generated `effective_body` column).
//   - Pure-functional state machine `applyOp(row, op)` + `initialRow(...)`
//     for unit-testable transitions (T011).
//
// The DB-bound writers (syncPipeline.ts / artifacts.ts handlers) call
// `applyOp` to compute the next row, then UPDATE the row + insert an
// audit event in the same transaction.

import { createHash } from "node:crypto";
import type {
  ArtifactKind,
  ArtifactStatus,
  ArtifactConflictState,
} from "../db/schema";
// Re-export the state aliases so consumers (handlers, tests) can import
// them from `./substrate` without reaching into the schema module.
export type { ArtifactKind, ArtifactStatus, ArtifactConflictState };

// ---------------------------------------------------------------------------
// Schema version (project-memory: schema versions are compile-time consts;
// mismatches between the TS const and the Rust mirror MUST fail at build
// before any runtime drift can land).
//
// Bump whenever the row shape changes (column add / remove / rename / type
// change) AND update `crates/factory-engine/src/substrate_version.rs` in
// the same commit.
// ---------------------------------------------------------------------------

// v2 (spec 198 FR-013 c, migration 45): + user_body_verified / verified_by /
// verified_at — the override trust-class columns.
export const SUBSTRATE_VERSION = 2 as const;
export type SubstrateVersion = typeof SUBSTRATE_VERSION;

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

export type SubstrateRow = {
  id: string;
  orgId: string;
  origin: string;
  path: string;
  kind: ArtifactKind;
  bundleId: string | null;
  version: number;
  status: ArtifactStatus;

  upstreamSha: string | null;
  upstreamBody: string | null;
  userBody: string | null;
  userModifiedAt: Date | null;
  userModifiedBy: string | null;
  /** Spec 198 FR-013(c) — override trust class. A new override revision
   * always resets to unverified; only the privileged verify-override
   * endpoint flips it. */
  userBodyVerified: boolean;
  verifiedBy: string | null;
  verifiedAt: Date | null;

  /** Generated stored at the SQL level: COALESCE(userBody, upstreamBody). */
  effectiveBody: string;
  contentHash: string;
  frontmatter: Record<string, unknown> | null;

  conflictState: ArtifactConflictState;
  conflictUpstreamSha: string | null;
  conflictResolvedAt: Date | null;
  conflictResolvedBy: string | null;

  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// State-machine operations (Spec 139 §5 + §6)
// ---------------------------------------------------------------------------

export type SyncOp = {
  kind: "sync";
  upstreamSha: string;
  /** Null permitted only for testing the "upstream removed" path. */
  upstreamBody: string | null;
};

export type OverrideOp = {
  kind: "override";
  userBody: string;
  userId: string;
};

export type ClearOverrideOp = {
  kind: "clear_override";
  userId: string;
};

export type ResolveOp = {
  kind: "resolve";
  action: "keep_mine" | "take_upstream";
  userId: string;
};

export type RetireOp = { kind: "retire" };

export type Op = SyncOp | OverrideOp | ClearOverrideOp | ResolveOp | RetireOp;

// ---------------------------------------------------------------------------
// sha256 — exported for translator + projection so the new and legacy
// pipelines compute hashes the same way.
// ---------------------------------------------------------------------------

export function sha256Hex(input: string | null): string {
  return createHash("sha256")
    .update(input ?? "", "utf8")
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Initial row (Sync flow §5 first insert)
// ---------------------------------------------------------------------------

export type InitialRowInput = {
  orgId: string;
  origin: string;
  path: string;
  kind: ArtifactKind;
  bundleId?: string | null;
  upstreamSha: string | null;
  upstreamBody: string | null;
  frontmatter: Record<string, unknown> | null;
};

/**
 * Construct an in-memory `SubstrateRow` representing a fresh sync insert.
 * Mostly used by the property test (T011) and as a reference for the
 * SQL-side INSERT … RETURNING flow.
 *
 * The DB-side row will have a real UUID id and timestamps; here we mint
 * placeholders so the state machine can be exercised purely in memory.
 */
export function initialRow(input: InitialRowInput): SubstrateRow {
  const upstreamBody = input.upstreamBody ?? "";
  const effectiveBody = upstreamBody;
  return {
    id: `mem-${input.origin}-${input.path}`,
    orgId: input.orgId,
    origin: input.origin,
    path: input.path,
    kind: input.kind,
    bundleId: input.bundleId ?? null,
    version: 1,
    status: "active",
    upstreamSha: input.upstreamSha,
    upstreamBody: input.upstreamBody,
    userBody: null,
    userModifiedAt: null,
    userModifiedBy: null,
    userBodyVerified: false,
    verifiedBy: null,
    verifiedAt: null,
    effectiveBody,
    contentHash: sha256Hex(effectiveBody),
    frontmatter: input.frontmatter,
    conflictState: "ok",
    conflictUpstreamSha: null,
    conflictResolvedAt: null,
    conflictResolvedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

// ---------------------------------------------------------------------------
// applyOp — pure transition function over (row, op) → row'.
//
// Mirrors the DB-side per-row logic in syncPipeline.ts so the property
// test can exercise the state machine without a database. The row's
// `effectiveBody` is recomputed locally to mirror the SQL-generated
// stored column.
// ---------------------------------------------------------------------------

export function applyOp(row: SubstrateRow, op: Op): SubstrateRow {
  switch (op.kind) {
    case "sync":
      return applySync(row, op);
    case "override":
      return applyOverride(row, op);
    case "clear_override":
      return applyClearOverride(row, op);
    case "resolve":
      return applyResolve(row, op);
    case "retire":
      return applyRetire(row);
  }
}

function recomputeEffective(
  userBody: string | null,
  upstreamBody: string | null,
): { effectiveBody: string; contentHash: string } {
  const effectiveBody = userBody ?? upstreamBody ?? "";
  return { effectiveBody, contentHash: sha256Hex(effectiveBody) };
}

function applySync(row: SubstrateRow, op: SyncOp): SubstrateRow {
  // Spec §5 per-row decision matrix.
  const upstreamUnchanged = row.upstreamBody === op.upstreamBody;
  if (upstreamUnchanged) {
    // No-op fast-forward — even sha may be identical; just refresh sha.
    if (row.upstreamSha === op.upstreamSha) {
      return row;
    }
    return {
      ...row,
      upstreamSha: op.upstreamSha,
      // No conflict state change; user_body untouched; effective unchanged.
      conflictState: row.userBody !== null ? row.conflictState : "ok",
    };
  }

  // Upstream content changed.
  if (row.userBody === null) {
    // No override — fast-forward, version bumps when content changes.
    const eff = recomputeEffective(null, op.upstreamBody);
    return {
      ...row,
      upstreamSha: op.upstreamSha,
      upstreamBody: op.upstreamBody,
      version: row.version + 1,
      effectiveBody: eff.effectiveBody,
      contentHash: eff.contentHash,
      conflictState: "ok",
    };
  }

  // Override present — mark diverged. user_body untouched.
  const eff = recomputeEffective(row.userBody, op.upstreamBody);
  return {
    ...row,
    upstreamSha: op.upstreamSha,
    upstreamBody: op.upstreamBody,
    effectiveBody: eff.effectiveBody,
    contentHash: eff.contentHash,
    conflictState: "diverged",
  };
}

function applyOverride(row: SubstrateRow, op: OverrideOp): SubstrateRow {
  const eff = recomputeEffective(op.userBody, row.upstreamBody);
  return {
    ...row,
    userBody: op.userBody,
    userModifiedAt: new Date(0),
    userModifiedBy: op.userId,
    // FR-013(c): a new override revision is always unverified.
    userBodyVerified: false,
    verifiedBy: null,
    verifiedAt: null,
    effectiveBody: eff.effectiveBody,
    contentHash: eff.contentHash,
    // Pin the upstream sha at the moment of override — used by sync's
    // divergence detection.
    conflictUpstreamSha: row.upstreamSha,
    // Override on top of an already-diverged row "accepts mine" with new
    // content; clear the conflict.
    conflictState: "ok",
  };
}

function applyClearOverride(
  row: SubstrateRow,
  op: ClearOverrideOp,
): SubstrateRow {
  const eff = recomputeEffective(null, row.upstreamBody);
  return {
    ...row,
    userBody: null,
    userModifiedAt: new Date(0),
    userModifiedBy: op.userId,
    userBodyVerified: false,
    verifiedBy: null,
    verifiedAt: null,
    effectiveBody: eff.effectiveBody,
    contentHash: eff.contentHash,
    conflictState: "ok",
    conflictUpstreamSha: null,
  };
}

function applyResolve(row: SubstrateRow, op: ResolveOp): SubstrateRow {
  if (op.action === "keep_mine") {
    return {
      ...row,
      conflictState: "ok",
      conflictResolvedAt: new Date(0),
      conflictResolvedBy: op.userId,
    };
  }
  // take_upstream — drop the override.
  const eff = recomputeEffective(null, row.upstreamBody);
  return {
    ...row,
    userBody: null,
    userModifiedAt: new Date(0),
    userModifiedBy: op.userId,
    userBodyVerified: false,
    verifiedBy: null,
    verifiedAt: null,
    effectiveBody: eff.effectiveBody,
    contentHash: eff.contentHash,
    conflictState: "ok",
    conflictUpstreamSha: null,
    conflictResolvedAt: new Date(0),
    conflictResolvedBy: op.userId,
  };
}

function applyRetire(row: SubstrateRow): SubstrateRow {
  return { ...row, status: "retired" };
}
