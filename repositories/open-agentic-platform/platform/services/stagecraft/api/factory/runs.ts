// Spec 124 §4 — `/api/factory/runs` REST surface.
//
// The only mutation surface for `factory_runs`. After this reservation
// returns, all subsequent state changes flow over the duplex bus
// (`factory.run.*` envelopes — Phase 3). Reads are list + detail; both are
// org-scoped and rely on `getAuthData()` for tenancy.
//
// Idempotency: `(org_id, client_run_id)` is unique per the migration's
// partial unique index. The reservation uses `INSERT … ON CONFLICT DO
// NOTHING` so a second concurrent caller with the same `clientRunId`
// observes the existing row instead of erroring out.

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, desc, eq, lt, type SQL } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  factoryRuns,
  projects,
  auditLog,
  type FactoryRunStatus,
  type FactoryRunStageProgressEntry,
  type FactoryRunSourceShas,
  type FactoryRunTokenSpend,
} from "../db/schema";
import { FACTORY_RUN_RESERVED } from "./auditActions";
import {
  resolveProcessAgentRefs,
  buildSourceShas,
  RetiredAgentError,
  AgentReferenceNotFoundError,
  QuarantinedAgentError,
} from "./runAgentRefs";
import { loadSubstrateForOrg } from "./substrateBrowser";
import { findAdapterView, findEnvelopeProcess } from "./adapterView";
import { isFactoryAdmitted } from "./admission";
import { detectQueueStorm } from "./queueStormGate";

/** Spec 139 Phase 4 — must match `browse.ts::synthesiseId`. */
function synthesiseAdapterId(orgId: string, name: string): string {
  return `synthetic-adapter-${orgId.slice(0, 8)}-${name}`;
}

/** Spec 139 Phase 4 — synthesise a process id stable across reservations. */
function synthesiseProcessId(
  orgId: string,
  name: string,
  version: string,
): string {
  return `synthetic-process-${orgId.slice(0, 8)}-${name}-${version}`;
}

// ---------------------------------------------------------------------------
// Wire shapes — camelCase per the existing statecraft convention. The
// JSONB columns persist the snake_case form per spec §3 (the platform
// handler converts at the boundary; see `runAgentRefs.ts`).
// ---------------------------------------------------------------------------

/**
 * Spec 124 §3 — projection of spec-123 `ResolvedAgent` returned to the
 * desktop on `POST /api/factory/runs`. T088 grep gate enforces the field
 * names match exactly. The DB column shape is snake_case
 * (`{ org_agent_id, version, content_hash }`); the wire shape is
 * camelCase (`{ orgAgentId, version, contentHash }`).
 */
export interface FactoryAgentRef {
  orgAgentId: string;
  version: number;
  contentHash: string;
}

export interface FactoryRunSourceShasResponse {
  adapter: string;
  process: string;
  contracts: Record<string, string>;
  agents: FactoryAgentRef[];
}

export interface ReserveRunRequest {
  /** Adapter name on `factory_adapters`. */
  adapterName: string;
  /** Process name on `factory_processes`. The reservation picks the
   *  highest-version row for the (org, name) pair. */
  processName: string;
  /** Optional project binding. NULL/undefined = ad-hoc run. */
  projectId?: string;
  /** Idempotency key from the desktop. Unique per `(org_id, client_run_id)`
   *  on the platform; second call with same key returns the existing row. */
  clientRunId: string;
}

export interface ReserveRunResponse {
  runId: string;
  sourceShas: FactoryRunSourceShasResponse;
  /** Whether the row was newly created on this call. `false` indicates
   *  an idempotent replay against an existing row (the body of `sourceShas`
   *  reflects what was recorded at first-call time, NOT a fresh resolve). */
  reserved: boolean;
}

export interface RunSummary {
  id: string;
  orgId: string;
  projectId: string | null;
  triggeredBy: string;
  adapterId: string;
  processId: string;
  clientRunId: string;
  status: FactoryRunStatus;
  startedAt: string;
  completedAt: string | null;
  lastEventAt: string;
  error: string | null;
}

export interface RunDetail extends RunSummary {
  stageProgress: FactoryRunStageProgressEntry[];
  sourceShas: FactoryRunSourceShasResponse;
  tokenSpend: FactoryRunTokenSpend | null;
}

export interface ListRunsRequest {
  /** Filter by status. */
  status?: FactoryRunStatus;
  /** Filter by adapter name (resolved to `adapter_id` server-side). */
  adapter?: string;
  /** Page size, default 50, max 200. */
  limit?: number;
  /** Cursor: ISO-8601 `started_at` of the last row on the previous page.
   *  The next page is rows with `started_at < before`. */
  before?: string;
}

export interface ListRunsResponse {
  runs: RunSummary[];
  /** ISO-8601 `started_at` to pass back as `before` for the next page.
   *  Omitted when there are no more rows. */
  nextCursor?: string;
}

export interface GetRunRequest {
  /** UUID of the `factory_runs` row. */
  id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbAgentsToWire(
  agents: FactoryRunSourceShas["agents"],
): FactoryAgentRef[] {
  return agents.map((a) => ({
    orgAgentId: a.org_agent_id,
    version: a.version,
    contentHash: a.content_hash,
  }));
}

function sourceShasToWire(
  shas: FactoryRunSourceShas,
): FactoryRunSourceShasResponse {
  return {
    adapter: shas.adapter,
    process: shas.process,
    contracts: shas.contracts,
    agents: dbAgentsToWire(shas.agents),
  };
}

function rowToSummary(row: typeof factoryRuns.$inferSelect): RunSummary {
  return {
    id: row.id,
    orgId: row.orgId,
    projectId: row.projectId,
    triggeredBy: row.triggeredBy,
    adapterId: row.adapterId,
    processId: row.processId,
    clientRunId: row.clientRunId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    lastEventAt: row.lastEventAt.toISOString(),
    error: row.error,
  };
}

function rowToDetail(row: typeof factoryRuns.$inferSelect): RunDetail {
  return {
    ...rowToSummary(row),
    stageProgress: row.stageProgress,
    sourceShas: sourceShasToWire(row.sourceShas),
    tokenSpend: row.tokenSpend,
  };
}

// ---------------------------------------------------------------------------
// Core implementations — auth is passed explicitly so integration tests can
// exercise the business logic without touching `getAuthData()`. The api()
// handlers below are thin wrappers that read auth from the Encore context.
// ---------------------------------------------------------------------------

/** Subset of the Encore auth payload the run endpoints depend on. */
export interface RunAuth {
  orgId: string;
  userID: string;
}

export async function reserveRunCore(
  req: ReserveRunRequest,
  auth: RunAuth,
): Promise<ReserveRunResponse> {

    // Body validation. We accept anything non-empty for `clientRunId`; the
    // desktop generates UUIDs but tests use shorter values.
    if (!req.clientRunId || req.clientRunId.trim() === "") {
      throw APIError.invalidArgument("clientRunId is required");
    }
    if (!req.adapterName || req.adapterName.trim() === "") {
      throw APIError.invalidArgument("adapterName is required");
    }
    if (!req.processName || req.processName.trim() === "") {
      throw APIError.invalidArgument("processName is required");
    }

    // Idempotent fast path: existing row with the same `(orgId, clientRunId)`.
    // Saves the resolver work on a clean replay. The conflict handling
    // below covers the racing-INSERT case.
    const [existing] = await db
      .select()
      .from(factoryRuns)
      .where(
        and(
          eq(factoryRuns.orgId, auth.orgId),
          eq(factoryRuns.clientRunId, req.clientRunId),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        runId: existing.id,
        sourceShas: sourceShasToWire(existing.sourceShas),
        reserved: false,
      };
    }

    // region: queue-storm-gate (spec 202 FR-003c)
    // Detection-only: counts the org's in-flight runs and, at/over the
    // configured ceiling, logs a warning and writes a
    // `factory.run.storm_detected` audit row. Never throws; the run is
    // still admitted below regardless of the outcome.
    await detectQueueStorm({
      orgId: auth.orgId,
      userID: auth.userID,
      clientRunId: req.clientRunId,
    });
    // endregion

    // Spec 199 FR-002/FR-004 — adapters resolve by manifest-declared
    // identity; the process is the envelope-declared process.id. Both are
    // admission-gated (spec 198 FR-001: an inadmissible factory's content
    // is never reserved into a run).
    const substrate = await loadSubstrateForOrg(auth.orgId);
    const adapter = findAdapterView(substrate, req.adapterName);
    if (!adapter) {
      throw APIError.notFound(`adapter "${req.adapterName}" not found`);
    }
    const adapterAdmission = await isFactoryAdmitted(auth.orgId, adapter.origin);
    if (!adapterAdmission.admitted) {
      throw APIError.failedPrecondition(
        `adapter "${req.adapterName}" cannot start a run: ${adapterAdmission.reason}`,
      );
    }
    const envelopeProcess = findEnvelopeProcess(substrate);
    if (!envelopeProcess || envelopeProcess.name !== req.processName) {
      throw APIError.notFound(`process "${req.processName}" not found`);
    }
    // Spec 199 FR-004 — the definition is opaque-by-kind. It carries no
    // embedded AgentReference tokens (those were a categorical-projection
    // shape); the engine materialises agents from the substrate-aware
    // VirtualRoot, and `resolveProcessAgentRefs` walking this shape simply
    // resolves zero legacy refs.
    const processByKind: Record<
      string,
      Array<{ path: string; contentHash: string }>
    > = {};
    for (const row of substrate.rows) {
      if (row.origin !== substrate.factoryOriginId) continue;
      (processByKind[row.kind] ??= []).push({
        path: row.path,
        contentHash: row.contentHash,
      });
    }
    const process = {
      name: envelopeProcess.name,
      version: substrate.factorySourceSha.slice(0, 12),
      sourceSha: substrate.factorySourceSha,
      definition: { byKind: processByKind } as Record<string, unknown>,
    };

    // Validate the project (when provided) belongs to this org.
    if (req.projectId) {
      const [proj] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, req.projectId),
            eq(projects.orgId, auth.orgId),
          ),
        )
        .limit(1);
      if (!proj) {
        throw APIError.notFound("project not found in this org");
      }
    }

    // Walk the process for AgentReference instances and resolve each
    // against `agent_catalog` + (optionally) `project_agent_bindings`.
    let agentTriples;
    try {
      agentTriples = await resolveProcessAgentRefs({
        orgId: auth.orgId,
        projectId: req.projectId ?? null,
        processDefinition: process.definition,
      });
    } catch (e) {
      if (e instanceof RetiredAgentError) {
        // failedPrecondition surfaces as 412 — the run is well-formed but
        // the catalog state has moved beyond what the project's binding
        // allows. The desktop deep-links the user to the binding page.
        throw APIError.failedPrecondition(e.message);
      }
      if (e instanceof AgentReferenceNotFoundError) {
        throw APIError.failedPrecondition(e.message);
      }
      if (e instanceof QuarantinedAgentError) {
        // Spec 200 FR-003(c) — FR-010-class fail-closed refusal: the run
        // cannot consume a quarantined agent revision.
        throw APIError.failedPrecondition(e.message);
      }
      throw e;
    }

    const sourceShas = buildSourceShas({
      adapterSha: adapter.sourceSha,
      processSha: process.sourceSha,
      // Contracts walk is a follow-up — the per-run cache materialiser
      // (Phase 4 T043) will populate this from the platform-side contract
      // index. For now reservation records an empty map; the desktop pulls
      // contracts on demand via `GET /api/factory/contracts/:name`.
      contracts: {},
      agents: agentTriples,
    });

    // Insert with ON CONFLICT DO NOTHING so a concurrent caller with the
    // same `(orgId, clientRunId)` does not produce a unique-violation —
    // instead `inserted` is `undefined` and we re-select.
    const [inserted] = await db
      .insert(factoryRuns)
      .values({
        orgId: auth.orgId,
        projectId: req.projectId ?? null,
        triggeredBy: auth.userID,
        // Spec 139 Phase 4 (T091) — synthesised stable ids; the legacy
        // UUIDs were dropped with the spec 108 trio.
        adapterId: synthesiseAdapterId(auth.orgId, adapter.name),
        processId: synthesiseProcessId(auth.orgId, process.name, process.version),
        clientRunId: req.clientRunId,
        status: "queued",
        sourceShas,
      })
      .onConflictDoNothing({
        target: [factoryRuns.orgId, factoryRuns.clientRunId],
      })
      .returning();

    if (!inserted) {
      // Race: another caller won the INSERT. Fetch the existing row.
      const [row] = await db
        .select()
        .from(factoryRuns)
        .where(
          and(
            eq(factoryRuns.orgId, auth.orgId),
            eq(factoryRuns.clientRunId, req.clientRunId),
          ),
        )
        .limit(1);
      if (!row) {
        // Should not happen; the unique constraint guarantees the row
        // exists if the INSERT lost. Surface as 500 if reality disagrees.
        throw APIError.internal(
          "reservation conflict but no existing row found",
        );
      }
      return {
        runId: row.id,
        sourceShas: sourceShasToWire(row.sourceShas),
        reserved: false,
      };
    }

    // New row — emit audit. (The race-loser path skips audit; the
    // first-call audit is the only one that records the reservation.)
    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: FACTORY_RUN_RESERVED,
      targetType: "factory_runs",
      targetId: inserted.id,
      metadata: {
        adapter: adapter.name,
        process: process.name,
        processVersion: process.version,
        projectId: req.projectId ?? null,
        clientRunId: req.clientRunId,
        agentCount: agentTriples.length,
      },
    });

    return {
      runId: inserted.id,
      sourceShas: sourceShasToWire(inserted.sourceShas),
      reserved: true,
    };
}

export const reserveRun = api(
  { expose: true, auth: true, method: "POST", path: "/api/factory/runs" },
  async (req: ReserveRunRequest): Promise<ReserveRunResponse> => {
    const auth = getAuthData()!;
    return reserveRunCore(req, { orgId: auth.orgId, userID: auth.userID });
  },
);

// ---------------------------------------------------------------------------
// GET /api/factory/runs — list (org-scoped, paginated)
// ---------------------------------------------------------------------------

export async function listRunsCore(
  req: ListRunsRequest,
  auth: RunAuth,
): Promise<ListRunsResponse> {
    const limit = Math.min(Math.max(req.limit ?? 50, 1), 200);

    const conditions: SQL[] = [eq(factoryRuns.orgId, auth.orgId)];

    if (req.status) {
      conditions.push(eq(factoryRuns.status, req.status));
    }

    if (req.adapter) {
      // Spec 139 Phase 4 (T091): the legacy `factory_adapters.id` UUID
      // is dropped; `factory_runs.adapterId` was previously written from
      // that UUID at reservation time. Existing runs continue to reference
      // their stored adapter UUID; we filter via the substrate-derived
      // synthetic id when the caller passes a name. The substrate
      // projection's adapter list is small per org (≤ a handful) so an
      // exact-match scan is cheap.
      const substrateForFilter = await loadSubstrateForOrg(auth.orgId);
      const adapter = findAdapterView(substrateForFilter, req.adapter);
      if (!adapter) {
        return { runs: [] };
      }
      conditions.push(
        eq(
          factoryRuns.adapterId,
          synthesiseAdapterId(auth.orgId, adapter.name),
        ),
      );
    }

    if (req.before) {
      const beforeDate = new Date(req.before);
      if (Number.isNaN(beforeDate.getTime())) {
        throw APIError.invalidArgument("before must be an ISO-8601 timestamp");
      }
      conditions.push(lt(factoryRuns.startedAt, beforeDate));
    }

    const rows = await db
      .select()
      .from(factoryRuns)
      .where(and(...conditions))
      .orderBy(desc(factoryRuns.startedAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      runs: page.map(rowToSummary),
      nextCursor: hasMore
        ? page[page.length - 1].startedAt.toISOString()
        : undefined,
    };
}

export const listRuns = api(
  { expose: true, auth: true, method: "GET", path: "/api/factory/runs" },
  async (req: ListRunsRequest): Promise<ListRunsResponse> => {
    const auth = getAuthData()!;
    return listRunsCore(req, { orgId: auth.orgId, userID: auth.userID });
  },
);

// ---------------------------------------------------------------------------
// GET /api/factory/runs/:id — single-run detail
// ---------------------------------------------------------------------------

export async function getRunCore(
  req: GetRunRequest,
  auth: RunAuth,
): Promise<RunDetail> {
    const [row] = await db
      .select()
      .from(factoryRuns)
      .where(
        and(eq(factoryRuns.id, req.id), eq(factoryRuns.orgId, auth.orgId)),
      )
      .limit(1);
    // 404 covers both "no such row" and "row in another org" — the same
    // error surface in either case avoids leaking row existence
    // cross-org.
    if (!row) {
      throw APIError.notFound("run not found");
    }
    return rowToDetail(row);
}

export const getRun = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/runs/:id",
  },
  async (req: GetRunRequest): Promise<RunDetail> => {
    const auth = getAuthData()!;
    return getRunCore(req, { orgId: auth.orgId, userID: auth.userID });
  },
);
