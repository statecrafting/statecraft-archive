// Spec 175 — typed shapes for the project dashboard snapshot.
//
// `ProjectDashboardSnapshot` is the response shape of
// `GET /api/projects/:projectId/dashboard`. Every panel is a discriminated
// `{ available: true, ... } | { available: false, reason: string }` so the
// route can degrade gracefully when one panel's underlying read fails
// without breaking the others (spec 175 §6 edge cases).

import type { SpecListRow } from "../specRegistry/types";

// ---------------------------------------------------------------------------
// Lifecycle posture (FR-003)
// ---------------------------------------------------------------------------

export interface LifecycleCounts {
  byStatus: Record<string, number>;
  byImplementation: Record<string, number>;
  total: number;
}

export type LifecyclePanel =
  | {
      available: true;
      registryAvailable: boolean;
      counts: LifecycleCounts;
    }
  | { available: false; reason: string };

// ---------------------------------------------------------------------------
// Recent governance certificate (FR-004)
//
// Spec 168 emits `governance-certificate.json` per factory run to the
// tenant's filesystem; there is no statecraft-side store for cert hash
// or verifier exit code today. The dashboard surfaces what is derivable
// from `factory_runs` (emission timestamp = `completedAt`, run id) and
// leaves `hashPrefix` / `verifierExitCode` null until the future plumbing
// records them. The spec's FR-004 requires we MUST NOT re-run the
// verifier on load; the displayed state is "last-known" — for unverified
// runs the last-known state is `not-yet-verified`.
// ---------------------------------------------------------------------------

export type VerifierStatus = "clean" | "tampered" | "not-yet-verified";

export type CertificatePanel =
  | {
      available: true;
      runId: string;
      emittedAt: string;
      /** First 16 chars of the certificate SHA-256, when recorded. */
      hashPrefix: string | null;
      /** Exit code from the last verifier run, when recorded. */
      verifierExitCode: number | null;
      verifierStatus: VerifierStatus;
    }
  | { available: false; reason: string };

// ---------------------------------------------------------------------------
// Recent factory runs (FR-005)
// ---------------------------------------------------------------------------

export interface RecentRunRow {
  id: string;
  status: string;
  /** Most-recently-completed stage id, when present. */
  currentStage: string | null;
  lastEventAt: string;
  completedAt: string | null;
}

export type RunsPanel =
  | { available: true; runs: RecentRunRow[] }
  | { available: false; reason: string };

// ---------------------------------------------------------------------------
// Risk banner (FR-006)
// ---------------------------------------------------------------------------

export type RiskSeverity = "ok" | "warning" | "critical";

export type RiskSignalKind =
  | "stale-extractions"
  | "failed-runs-24h"
  | "failed-runs-1h"
  | "coupling-gate-failures-24h"
  | "missing-prereq";

export interface RiskSignal {
  kind: RiskSignalKind;
  /** Number of occurrences contributing this signal. */
  count: number;
  /** Short human-readable label for the banner. */
  label: string;
}

export type RiskPanel =
  | { available: true; severity: RiskSeverity; signals: RiskSignal[] }
  | { available: false; reason: string };

// ---------------------------------------------------------------------------
// Audit summary (FR-007)
// ---------------------------------------------------------------------------

export type AuditAuthSource = "session" | "api_key" | "m2m" | "unknown";

export interface AuditSummaryRow {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  authSource: AuditAuthSource;
}

export type AuditPanel =
  | { available: true; rows: AuditSummaryRow[] }
  | { available: false; reason: string };

// ---------------------------------------------------------------------------
// Snapshot aggregate (FR-002)
// ---------------------------------------------------------------------------

export interface ProjectDashboardSnapshot {
  projectId: string;
  generatedAt: string;
  lifecycle: LifecyclePanel;
  certificate: CertificatePanel;
  runs: RunsPanel;
  risk: RiskPanel;
  audit: AuditPanel;
}

/**
 * Inputs to `assessRisk` — every signal as a count. Keeping the shape
 * count-only (rather than the underlying rows) makes the rule pure and
 * easy to property-test. Callers must reuse `STATECRAFT_EXTRACT_STALE_AFTER_SEC`
 * when building `staleExtractions`.
 */
export interface RiskInputs {
  staleExtractions: number;
  failedRuns24h: number;
  failedRuns1h: number;
  couplingGateFailures24h: number;
  /** Pre-resolved list of missing prerequisite blockers (e.g. no repo, no env). */
  missingPrereqs: string[];
  /** Tampered governance certificate count detected by the last verifier sweep. */
  tamperedCertificates: number;
}

/**
 * Helper consumed by `dashboard.ts` to project a list of spec rows into
 * `LifecycleCounts`. Lives next to the types so test fixtures can build
 * the same shape the endpoint emits.
 */
export function countLifecyclePosture(rows: SpecListRow[]): LifecycleCounts {
  const byStatus: Record<string, number> = {};
  const byImplementation: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byImplementation[r.implementation] =
      (byImplementation[r.implementation] ?? 0) + 1;
  }
  return { byStatus, byImplementation, total: rows.length };
}
