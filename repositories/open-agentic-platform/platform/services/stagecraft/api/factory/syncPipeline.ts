/**
 * Spec 139 Phase 1 — factory sync pipeline (substrate-authoritative).
 *
 * The pipeline walks the upstream end-to-end into the
 * `factory_artifact_substrate` substrate (verbatim mirror per spec 139 §5).
 * Spec 108's API surface (`/api/factory/{adapters,contracts,processes}`)
 * is served by `browse.ts` projecting the substrate at read time via
 * `loadSubstrateForOrg` + `projectSubstrateToLegacy`.
 *
 * **Spec 139 Phase 4 (T091):** the legacy projection write path was
 * retired. The substrate is the only store; legacy `factory_adapters` /
 * `factory_contracts` / `factory_processes` tables drop in migration 34.
 * The substrate write runs in one `db.transaction(...)` — no partial
 * state.
 */

import log from "encore.dev/log";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  factoryArtifactSubstrate,
  factoryArtifactSubstrateAudit,
  factoryUpstreams,
  type ArtifactKind,
} from "../db/schema";
import { withClonedRepo } from "./clone";
import {
  translateUpstreamsToSubstrate,
  type SubstrateRowDraft,
  type SubstrateTranslation,
} from "./translator";
import { loadOapOwnedSubstrateRows, OAP_SELF_ORIGIN } from "./oapContracts";
import { sha256Hex, type SubstrateRow } from "./substrate";
import { evaluateAndPersistFromSync } from "./admission";
import { FACTORY_SOURCE_ID } from "./upstreams";

// ---------------------------------------------------------------------------
// Public entry — full upstream sync.
// ---------------------------------------------------------------------------

export type SyncPipelineInputs = {
  orgId: string;
  factorySource: string;
  factoryRef: string;
  /** Spec 199 FR-003 — the `factory_upstreams.source_id` this sync mirrors;
   * becomes the substrate origin (origin-from-source, not a constant). */
  factorySourceId: string;
  templateSource: string;
  templateRef: string;
  templateSourceId: string;
  token: string | undefined;
};

export type SyncPipelineResult = {
  factorySha: string;
  templateSha: string;
  counts: { adapters: number; contracts: number; processes: number };
};

export async function runSyncPipeline(
  inputs: SyncPipelineInputs,
): Promise<SyncPipelineResult> {
  const translation = await cloneAndTranslate(inputs);
  const syncedAt = new Date();

  // Surface any binary files the translator skipped (NUL byte in body cannot
  // be stored in the UTF-8 TEXT substrate). Logged rather than dropped
  // silently so a stray binary in an upstream repo is visible, not invisible.
  if (translation.substrate.skippedBinaryPaths.length > 0) {
    log.warn("factory sync: skipped binary upstream files (not text-storable)", {
      orgId: inputs.orgId,
      count: translation.substrate.skippedBinaryPaths.length,
      paths: translation.substrate.skippedBinaryPaths.slice(0, 50),
    });
  }

  // Spec 139 Constitution Check (Principle II) + SC-004: OAP-owned
  // contract schemas (`standards/schemas/factory/`) ride into the
  // substrate as `(oap-self, contract-schema)`. The retired example-
  // adapter ingest (next-prisma / rust-axum / encore-react — spec 199
  // FR-007) no longer contributes rows; those adapters were removed
  // upstream and their `_tmp/` source dir never existed here.
  const oapSelfRows = await loadOapOwnedSubstrateRows();
  translation.substrate.rows.push(...oapSelfRows);

  await applyDualWrite({
    orgId: inputs.orgId,
    substrate: translation.substrate,
    factorySha: translation.factorySha,
    templateSha: translation.templateSha,
    syncedAt,
    extraOrigins: oapSelfRows.length > 0 ? [OAP_SELF_ORIGIN] : [],
  });

  // Spec 198 FR-001/FR-003 — evaluate and record the governance-envelope
  // admission verdict over the freshly-mirrored bytes. The mirror itself is
  // unconditional (verbatim substrate, spec 139); ADMISSION gates serving
  // and binding, not mirroring. A refusal is recorded with attributable
  // violations and the serve/bind paths consult it fail-closed.
  const admission = await evaluateAndPersistFromSync({
    orgId: inputs.orgId,
    factoryOrigin: translation.substrate.factoryOriginId,
    factorySha: translation.factorySha,
    rows: translation.substrate.rows,
  });
  if (admission.status === "refused") {
    log.warn("factory admission REFUSED — content will not serve or bind", {
      orgId: inputs.orgId,
      origin: translation.substrate.factoryOriginId,
      violations: admission.violations,
    });
  }

  // Per-kind counts come from the substrate now that the legacy projection
  // tables are retired. The wire shape of `SyncPipelineResult.counts` stays
  // the same so spec 108's `/api/factory/upstreams/sync` consumer doesn't
  // change.
  const counts = countByLegacyKind(translation.substrate);
  log.info("factory sync pipeline completed", {
    orgId: inputs.orgId,
    factorySha: translation.factorySha,
    templateSha: translation.templateSha,
    artifacts: translation.substrate.rows.length,
    ...counts,
  });

  return {
    factorySha: translation.factorySha,
    templateSha: translation.templateSha,
    counts,
  };
}

type CloneAndTranslateResult = {
  substrate: SubstrateTranslation;
  factorySha: string;
  templateSha: string;
};

async function cloneAndTranslate(
  inputs: SyncPipelineInputs,
): Promise<CloneAndTranslateResult> {
  return withClonedRepo(
    {
      repo: inputs.factorySource,
      ref: inputs.factoryRef,
      token: inputs.token,
    },
    async (factoryRepo) =>
      withClonedRepo(
        {
          repo: inputs.templateSource,
          ref: inputs.templateRef,
          token: inputs.token,
        },
        async (templateRepo) => {
          // Single walk → substrate. Substrate is the only authoritative
          // store from Phase 4 onward; consumers project at read time.
          // Spec 199 FR-003 — origins derive from the configured
          // `factory_upstreams.source_id` (origin-from-source); the static
          // legacy scaffold-config constants no longer reach the write path.
          // Scaffold URLs live in `factory_upstreams` and are resolved at
          // ADMISSION time (spec 198 / 199 FR-009); the admission record is
          // what the create path and scaffold scheduler read.
          const substrate = await translateUpstreamsToSubstrate({
            factorySourcePath: factoryRepo.path,
            factorySourceSha: factoryRepo.sha,
            templatePath: templateRepo.path,
            templateSha: templateRepo.sha,
            factoryOriginId: inputs.factorySourceId,
            templateOriginId: inputs.templateSourceId,
          });

          return {
            substrate,
            factorySha: factoryRepo.sha,
            templateSha: templateRepo.sha,
          };
        },
      ),
  );
}

/**
 * Approximate the legacy adapters/contracts/processes counts from the
 * substrate state. Used only for the sync-result wire shape compat with
 * spec 108 — the count values themselves aren't load-bearing for any
 * downstream gate; they're informational on the sync-runs admin view.
 */
function countByLegacyKind(substrate: SubstrateTranslation): {
  adapters: number;
  contracts: number;
  processes: number;
} {
  let adapters = 0;
  let contracts = 0;
  let processes = 0;
  // Contracts: every contract-schema row across all origins (upstream
  // factory/template repos AND `oap-self` for OAP-owned schemas under
  // `standards/schemas/factory/`).
  for (const row of substrate.rows) {
    if (row.kind === "contract-schema") contracts += 1;
  }
  // Adapters: one per `adapter-manifest` substrate row. The synthetic
  // template-orchestrator adapter is retired (spec 199 FR-002) —
  // adapter identity comes only from manifests.
  for (const row of substrate.rows) {
    if (row.kind === "adapter-manifest") adapters += 1;
  }
  if (
    substrate.rows.some(
      (r) =>
        r.origin === substrate.factoryOriginId &&
        r.kind === "pipeline-orchestrator",
    )
  ) {
    processes = 1;
  }
  return { adapters, contracts, processes };
}

// ---------------------------------------------------------------------------
// Dual-write — substrate (authoritative) + legacy projection, in one
// transaction.
// ---------------------------------------------------------------------------

type ApplyArgs = {
  orgId: string;
  substrate: SubstrateTranslation;
  factorySha: string;
  templateSha: string;
  syncedAt: Date;
  /**
   * Origin ids beyond the factory/template pair to include in the
   * prune-on-removal scan. Today: OAP-owned contract schemas under
   * `oap-self`. Empty when the schemas directory isn't resolvable.
   */
  extraOrigins?: string[];
};

async function applyDualWrite(args: ApplyArgs): Promise<void> {
  await db.transaction(async (tx) => {
    // ---------- Substrate (authoritative) ----------
    await applySubstrateRowsTx(tx, {
      orgId: args.orgId,
      origins: [
        args.substrate.factoryOriginId,
        args.substrate.templateOriginId,
        ...(args.extraOrigins ?? []),
      ],
      rows: args.substrate.rows,
    });

    // Spec 139 Phase 4 (T091): the legacy projection write path is
    // retired. `factory_adapters` / `factory_contracts` /
    // `factory_processes` are dropped by migration 34; consumers
    // (browse.ts, opcBundle.ts, create.ts, import.ts, scaffoldReadiness.ts,
    // scheduler.ts) project the legacy wire shape from the substrate at
    // read time via `loadSubstrateForOrg` + `projectSubstrateToLegacy`.

    // Denormalised "current state" mirror on factory_upstreams. Spec 139
    // Phase 4b: the legacy singleton wire shape composes from two
    // N-per-org rows (`factory` + `template`); only
    // the factory-side row carries the denormalised last-sync state.
    await tx
      .update(factoryUpstreams)
      .set({
        lastSyncedAt: args.syncedAt,
        lastSyncSha: {
          factory: args.factorySha,
          template: args.templateSha,
        },
        lastSyncStatus: "ok",
        lastSyncError: null,
        updatedAt: args.syncedAt,
      })
      .where(
        and(
          eq(factoryUpstreams.orgId, args.orgId),
          eq(factoryUpstreams.sourceId, FACTORY_SOURCE_ID),
        ),
      );
  });
}

// ---------------------------------------------------------------------------
// Substrate row writer — per-origin batch with per-row diff/insert/retire.
// ---------------------------------------------------------------------------

type ApplySubstrateArgs = {
  orgId: string;
  /**
   * The set of origin ids touched by this sync. Rows under these origins
   * that aren't in the new `rows` set will be retired (spec §5 prune step).
   */
  origins: string[];
  rows: SubstrateRowDraft[];
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function applySubstrateRowsTx(
  tx: Tx,
  args: ApplySubstrateArgs,
): Promise<void> {
  // Snapshot existing active rows under the touched origins so we can
  // identify retire candidates.
  const existingPathsByOrigin = new Map<string, Set<string>>();
  for (const origin of args.origins) {
    const existingRows = await tx
      .select({ path: factoryArtifactSubstrate.path })
      .from(factoryArtifactSubstrate)
      .where(
        and(
          eq(factoryArtifactSubstrate.orgId, args.orgId),
          eq(factoryArtifactSubstrate.origin, origin),
          eq(factoryArtifactSubstrate.status, "active"),
        ),
      );
    existingPathsByOrigin.set(
      origin,
      new Set(existingRows.map((r) => r.path)),
    );
  }

  // Apply each new/updated row.
  const seenPathsByOrigin = new Map<string, Set<string>>();
  for (const draft of args.rows) {
    if (!seenPathsByOrigin.has(draft.origin)) {
      seenPathsByOrigin.set(draft.origin, new Set());
    }
    seenPathsByOrigin.get(draft.origin)!.add(draft.path);

    await applyArtifactRowTx(tx, {
      orgId: args.orgId,
      origin: draft.origin,
      path: draft.path,
      kind: draft.kind,
      bundleId: draft.bundleId,
      upstreamSha: draft.upstreamSha,
      upstreamBody: draft.upstreamBody,
      frontmatter: draft.frontmatter,
    });
  }

  // Retire rows present before but absent now.
  for (const origin of args.origins) {
    const existing = existingPathsByOrigin.get(origin) ?? new Set<string>();
    const seen = seenPathsByOrigin.get(origin) ?? new Set<string>();
    for (const path of existing) {
      if (seen.has(path)) continue;
      const retired = await tx
        .update(factoryArtifactSubstrate)
        .set({ status: "retired", updatedAt: new Date() })
        .where(
          and(
            eq(factoryArtifactSubstrate.orgId, args.orgId),
            eq(factoryArtifactSubstrate.origin, origin),
            eq(factoryArtifactSubstrate.path, path),
            eq(factoryArtifactSubstrate.status, "active"),
          ),
        )
        .returning({ id: factoryArtifactSubstrate.id });
      for (const r of retired) {
        await tx.insert(factoryArtifactSubstrateAudit).values({
          artifactId: r.id,
          orgId: args.orgId,
          action: "artifact.retired",
          actorUserId: null,
          before: null,
          after: null,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-row sync decision (spec §5). Inserted, fast-forwarded, or marked
// diverged transactionally. Returns the live row after the decision is
// applied — used by both batch sync and single-row testing helpers.
// ---------------------------------------------------------------------------

type ArtifactRowArgs = {
  orgId: string;
  origin: string;
  path: string;
  kind: ArtifactKind;
  bundleId?: string | null;
  upstreamSha: string;
  upstreamBody: string;
  frontmatter: Record<string, unknown> | null;
};

async function applyArtifactRowTx(
  tx: Tx,
  args: ArtifactRowArgs,
): Promise<SubstrateRow> {
  const existingRows = await tx
    .select()
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, args.orgId),
        eq(factoryArtifactSubstrate.origin, args.origin),
        eq(factoryArtifactSubstrate.path, args.path),
      ),
    )
    .orderBy(sql`${factoryArtifactSubstrate.version} DESC`)
    .limit(1);
  const existing = existingRows[0];
  const now = new Date();

  if (!existing) {
    // No prior row — initial insert.
    const inserted = await tx
      .insert(factoryArtifactSubstrate)
      .values({
        orgId: args.orgId,
        origin: args.origin,
        path: args.path,
        kind: args.kind,
        bundleId: args.bundleId ?? null,
        version: 1,
        status: "active",
        upstreamSha: args.upstreamSha,
        upstreamBody: args.upstreamBody,
        userBody: null,
        contentHash: sha256Hex(args.upstreamBody),
        frontmatter: args.frontmatter,
        conflictState: "ok",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = mapInsertedRowToSubstrate(inserted[0]);
    await tx.insert(factoryArtifactSubstrateAudit).values({
      artifactId: row.id,
      orgId: args.orgId,
      action: "artifact.synced",
      actorUserId: null,
      before: null,
      after: { upstreamSha: args.upstreamSha, version: 1 },
    });
    return row;
  }

  const upstreamUnchanged = existing.upstreamBody === args.upstreamBody;
  const userBodyPresent = existing.userBody !== null;

  if (upstreamUnchanged) {
    // Either pure no-op or sha refresh. Don't bump version, don't audit
    // unless we changed something on the row.
    if (existing.upstreamSha === args.upstreamSha) {
      return mapStoredRowToSubstrate(existing);
    }
    const updated = await tx
      .update(factoryArtifactSubstrate)
      .set({ upstreamSha: args.upstreamSha, updatedAt: now })
      .where(eq(factoryArtifactSubstrate.id, existing.id))
      .returning();
    return mapStoredRowToSubstrate(updated[0]);
  }

  if (!userBodyPresent) {
    // Fast-forward — version bumps so historical bindings remain valid.
    const updated = await tx
      .update(factoryArtifactSubstrate)
      .set({
        version: existing.version + 1,
        upstreamSha: args.upstreamSha,
        upstreamBody: args.upstreamBody,
        contentHash: sha256Hex(args.upstreamBody),
        frontmatter: args.frontmatter,
        kind: args.kind,
        bundleId: args.bundleId ?? existing.bundleId ?? null,
        conflictState: "ok",
        updatedAt: now,
      })
      .where(eq(factoryArtifactSubstrate.id, existing.id))
      .returning();
    const row = mapStoredRowToSubstrate(updated[0]);
    await tx.insert(factoryArtifactSubstrateAudit).values({
      artifactId: row.id,
      orgId: args.orgId,
      action: "artifact.synced",
      actorUserId: null,
      before: { upstreamSha: existing.upstreamSha, version: existing.version },
      after: { upstreamSha: args.upstreamSha, version: row.version },
    });
    return row;
  }

  // Override present + upstream changed → diverged. user_body untouched.
  const updated = await tx
    .update(factoryArtifactSubstrate)
    .set({
      upstreamSha: args.upstreamSha,
      upstreamBody: args.upstreamBody,
      frontmatter: args.frontmatter,
      kind: args.kind,
      bundleId: args.bundleId ?? existing.bundleId ?? null,
      conflictState: "diverged",
      updatedAt: now,
    })
    .where(eq(factoryArtifactSubstrate.id, existing.id))
    .returning();
  const row = mapStoredRowToSubstrate(updated[0]);
  await tx.insert(factoryArtifactSubstrateAudit).values({
    artifactId: row.id,
    orgId: args.orgId,
    action: "artifact.conflict_detected",
    actorUserId: null,
    before: { upstreamSha: existing.upstreamSha },
    after: { upstreamSha: args.upstreamSha },
  });
  return row;
}

// ---------------------------------------------------------------------------
// Single-row sync helper (T012). Wraps `applyArtifactRowTx` in its own
// transaction so the test can drive the state machine without a full
// upstream walk.
// ---------------------------------------------------------------------------

export async function syncSubstrateRowCore(
  args: ArtifactRowArgs,
): Promise<SubstrateRow> {
  return db.transaction(async (tx) => applyArtifactRowTx(tx, args));
}

// ---------------------------------------------------------------------------
// Helpers — map raw Drizzle row shape to the SubstrateRow public type.
// Drizzle infers nullable/non-null from the schema; the public type is a
// stable handler-facing surface.
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

function mapInsertedRowToSubstrate(row: StoredArtifactRow): SubstrateRow {
  return mapStoredRowToSubstrate(row);
}
