// Spec 175 — `GET /api/projects/:projectId/dashboard` — bundled
// observability snapshot for the statecraft project landing page.
//
// The endpoint composes existing reads (the spec-spine registry subprocess,
// `factory_runs` Drizzle, `knowledge_objects` Drizzle, project-scoped
// audit_log filter, scaffold-readiness blocker resolver) into a single
// typed `ProjectDashboardSnapshot`. Each panel is wrapped in a
// `{ available: true, ... } | { available: false, reason }` discriminator
// so a partial-failure (e.g. spec-spine read failing for one project) does
// not break the rest of the surface (spec 175 §6 edge cases).
//
// Governed-read discipline (spec 103, FR-003): the lifecycle posture
// panel reads through `api/specRegistry/registryReader.ts`. No direct
// `.derived/spec-registry/registry.json` parsing lives here.

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factoryRuns,
  knowledgeObjects,
  projects,
  projectRepos,
  environments,
} from "../db/schema";
import { listSpecs } from "../specRegistry/registryReader";
import { resolveProjectRegistry } from "../specRegistry/resolver";
import { assessRisk } from "./riskAssessor";
import {
  lastStageId,
  pickAuthSource,
  shortError,
  staleExtractionCutoffMs,
} from "./dashboardHelpers";
import {
  countLifecyclePosture,
  type AuditPanel,
  type CertificatePanel,
  type LifecyclePanel,
  type ProjectDashboardSnapshot,
  type RecentRunRow,
  type RiskInputs,
  type RiskPanel,
  type RunsPanel,
} from "./types";

// Re-export pure helpers from the helpers module so existing consumers
// (and tests) can import them from `./dashboard`.
export {
  lastStageId,
  pickAuthSource,
  shortError,
  staleExtractionCutoffMs,
} from "./dashboardHelpers";

async function assertProjectInOrg(projectId: string): Promise<void> {
  const auth = getAuthData();
  if (!auth) {
    throw APIError.unauthenticated("authentication required");
  }
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, auth.orgId)))
    .limit(1);
  if (rows.length === 0) {
    throw APIError.notFound("project not found");
  }
}

export const getProjectDashboard = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/dashboard",
  },
  async (req: {
    projectId: string;
  }): Promise<ProjectDashboardSnapshot> => {
    await assertProjectInOrg(req.projectId);

    const generatedAt = new Date().toISOString();

    // Panel reads run in parallel. Each builder swallows its own error
    // and produces an `{ available: false, reason }` panel so one
    // failed panel never short-circuits the snapshot (spec 175 §6).
    const [
      lifecyclePanel,
      runsPanel,
      certificatePanel,
      auditPanel,
      riskPanel,
    ] = await Promise.all([
      buildLifecyclePanel(req.projectId),
      buildRunsPanel(req.projectId),
      buildCertificatePanel(req.projectId),
      buildAuditPanel(req.projectId),
      buildRiskPanel(req.projectId),
    ]);

    return {
      projectId: req.projectId,
      generatedAt,
      lifecycle: lifecyclePanel,
      certificate: certificatePanel,
      runs: runsPanel,
      risk: riskPanel,
      audit: auditPanel,
    };
  }
);

// ---------------------------------------------------------------------------
// Lifecycle posture (FR-003)
// ---------------------------------------------------------------------------

export async function buildLifecyclePanel(
  projectId: string
): Promise<LifecyclePanel> {
  try {
    const roots = await resolveProjectRegistry(projectId);
    if (!roots) {
      return {
        available: true,
        registryAvailable: false,
        counts: { byStatus: {}, byImplementation: {}, total: 0 },
      };
    }
    const specs = await listSpecs(roots.projectRoot);
    return {
      available: true,
      registryAvailable: true,
      counts: countLifecyclePosture(specs),
    };
  } catch (err) {
    return {
      available: false,
      reason: shortError(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Recent factory runs (FR-005)
// ---------------------------------------------------------------------------

const RUNS_LIMIT = 5;

export async function buildRunsPanel(projectId: string): Promise<RunsPanel> {
  try {
    const rows = await db
      .select({
        id: factoryRuns.id,
        status: factoryRuns.status,
        stageProgress: factoryRuns.stageProgress,
        lastEventAt: factoryRuns.lastEventAt,
        completedAt: factoryRuns.completedAt,
      })
      .from(factoryRuns)
      .where(eq(factoryRuns.projectId, projectId))
      .orderBy(desc(factoryRuns.lastEventAt))
      .limit(RUNS_LIMIT);
    const runs: RecentRunRow[] = rows.map((r) => ({
      id: r.id,
      status: r.status,
      currentStage: lastStageId(r.stageProgress),
      lastEventAt: r.lastEventAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    }));
    return { available: true, runs };
  } catch (err) {
    return { available: false, reason: shortError(err) };
  }
}

// ---------------------------------------------------------------------------
// Recent governance certificate (FR-004)
//
// Spec 168 emits `governance-certificate.json` to the tenant's filesystem
// per factory run; there is no statecraft-side persistence for cert hash
// or verifier exit code today. The panel surfaces what is derivable from
// `factory_runs` (emission timestamp = `completedAt` of the most recent
// `ok` run, run id). `hashPrefix` / `verifierExitCode` are left null
// and `verifierStatus` defaults to `not-yet-verified`. FR-004's "MUST
// NOT re-run the verifier on load" is honoured by construction: there is
// no synchronous verifier call here.
// ---------------------------------------------------------------------------

export async function buildCertificatePanel(
  projectId: string
): Promise<CertificatePanel> {
  try {
    const [row] = await db
      .select({
        id: factoryRuns.id,
        completedAt: factoryRuns.completedAt,
      })
      .from(factoryRuns)
      .where(
        and(eq(factoryRuns.projectId, projectId), eq(factoryRuns.status, "ok"))
      )
      .orderBy(desc(factoryRuns.completedAt))
      .limit(1);
    if (!row || !row.completedAt) {
      return {
        available: false,
        reason: "no completed factory runs yet",
      };
    }
    return {
      available: true,
      runId: row.id,
      emittedAt: row.completedAt.toISOString(),
      hashPrefix: null,
      verifierExitCode: null,
      verifierStatus: "not-yet-verified",
    };
  } catch (err) {
    return { available: false, reason: shortError(err) };
  }
}

// ---------------------------------------------------------------------------
// Audit summary (FR-007)
// ---------------------------------------------------------------------------

const AUDIT_LIMIT = 5;

export async function buildAuditPanel(projectId: string): Promise<AuditPanel> {
  try {
    const rows = await db
      .select({
        id: auditLog.id,
        actorUserId: auditLog.actorUserId,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        sql`(${auditLog.targetType} = 'project' AND ${auditLog.targetId} = ${projectId})
           OR ${auditLog.metadata}->>'projectId' = ${projectId}`
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(AUDIT_LIMIT);
    return {
      available: true,
      rows: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        createdAt: r.createdAt.toISOString(),
        authSource: pickAuthSource(r.metadata),
      })),
    };
  } catch (err) {
    return { available: false, reason: shortError(err) };
  }
}

// ---------------------------------------------------------------------------
// Risk banner (FR-006)
// ---------------------------------------------------------------------------

export async function buildRiskPanel(projectId: string): Promise<RiskPanel> {
  try {
    const inputs = await collectRiskInputs(projectId);
    return assessRisk(inputs);
  } catch (err) {
    return { available: false, reason: shortError(err) };
  }
}

async function collectRiskInputs(projectId: string): Promise<RiskInputs> {
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
  const extractionStaleCutoff = new Date(now - staleExtractionCutoffMs());

  // Stale extractions — `knowledge_objects` rows stuck in `extracting`
  // past `STATECRAFT_EXTRACT_STALE_AFTER_SEC`. The sweeper flips these to
  // `failed`, so a non-zero count here represents in-flight stuckness the
  // sweeper has not yet processed.
  const staleExtractionsRows = await db
    .select({ id: knowledgeObjects.id })
    .from(knowledgeObjects)
    .where(
      and(
        eq(knowledgeObjects.projectId, projectId),
        eq(knowledgeObjects.state, "extracting"),
        sql`${knowledgeObjects.updatedAt} < ${extractionStaleCutoff}`
      )
    );

  // Failed factory runs in two bands. Two queries to avoid grouping
  // logic on a Drizzle SQL builder result.
  const failedRuns24hRows = await db
    .select({ id: factoryRuns.id })
    .from(factoryRuns)
    .where(
      and(
        eq(factoryRuns.projectId, projectId),
        eq(factoryRuns.status, "failed"),
        gte(factoryRuns.lastEventAt, twentyFourHoursAgo)
      )
    );
  const failedRuns1hRows = await db
    .select({ id: factoryRuns.id })
    .from(factoryRuns)
    .where(
      and(
        eq(factoryRuns.projectId, projectId),
        eq(factoryRuns.status, "failed"),
        gte(factoryRuns.lastEventAt, oneHourAgo)
      )
    );

  // Coupling-gate failures — audit rows whose action starts with
  // `coupling-gate.` and whose metadata records a failed result. The
  // event surface is not yet emitted by statecraft (spec 127 lives in
  // the spec-spine CI), so this returns 0 in practice. Wired here so the
  // signal lights up automatically when audit ingestion catches up.
  const couplingGateFailuresRows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        sql`${auditLog.action} LIKE 'coupling-gate.%'`,
        sql`${auditLog.metadata}->>'projectId' = ${projectId}`,
        sql`${auditLog.metadata}->>'result' = 'failed'`,
        gte(auditLog.createdAt, twentyFourHoursAgo)
      )
    );

  const missingPrereqs = await collectMissingPrereqs(projectId);

  return {
    staleExtractions: staleExtractionsRows.length,
    failedRuns24h: failedRuns24hRows.length,
    failedRuns1h: failedRuns1hRows.length,
    couplingGateFailures24h: couplingGateFailuresRows.length,
    missingPrereqs,
    // The cert tamper count is sourced from verifier persistence, which
    // does not yet exist in statecraft (see `buildCertificatePanel`
    // comment). Always 0 until that plumbing lands.
    tamperedCertificates: 0,
  };
}

async function collectMissingPrereqs(projectId: string): Promise<string[]> {
  const missing: string[] = [];

  // No environments configured.
  const envRows = await db
    .select({ id: environments.id })
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .limit(1);
  if (envRows.length === 0) missing.push("no-environments");

  // No primary repo bound.
  const repoRows = await db
    .select({ id: projectRepos.id })
    .from(projectRepos)
    .where(
      and(
        eq(projectRepos.projectId, projectId),
        eq(projectRepos.isPrimary, true)
      )
    )
    .limit(1);
  if (repoRows.length === 0) missing.push("no-repo");

  return missing;
}


