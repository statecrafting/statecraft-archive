// Spec 175 §2.1 (5), FR-006, FR-010 — pure risk-banner aggregator.
//
// The function is pure given its inputs so the severity rule can be
// unit-tested without standing up Encore infrastructure. Callers in
// `dashboard.ts` build `RiskInputs` from existing Drizzle queries and
// pass them here; the produced `RiskPanel` slots straight into the
// dashboard snapshot.
//
// Severity rule (spec 175 §2.1):
//   - `critical` when any failed factory run within the last hour OR
//     any tampered certificate is reported.
//   - `warning` when at least one non-critical signal is present (any
//     stale extractions, any failed runs in the past 24h, any coupling-
//     gate failures in the past 24h, or any missing prerequisite).
//   - `ok` otherwise.
//
// Output ordering: signals are emitted highest-impact-first so the
// banner's "top three" rule (FR-006) is just a slice — no additional
// sort needed on the client.

import type {
  RiskInputs,
  RiskPanel,
  RiskSeverity,
  RiskSignal,
} from "./types";

const MISSING_PREREQ_LABELS: Record<string, string> = {
  "no-environments": "No environments configured",
  "no-repo": "No primary repo bound",
  "no-pat": "No upstream PAT configured",
  "no-factory-adapter": "No factory adapter configured",
  "no-scaffold-source-resolved": "Scaffold source unresolved",
};

function labelForMissingPrereq(id: string): string {
  return MISSING_PREREQ_LABELS[id] ?? id;
}

export function assessRisk(inputs: RiskInputs): RiskPanel {
  const signals: RiskSignal[] = [];

  if (inputs.tamperedCertificates > 0) {
    signals.push({
      kind: "failed-runs-1h", // reuse kind for ordering; banner label differentiates
      count: inputs.tamperedCertificates,
      label: `${inputs.tamperedCertificates} tampered certificate${inputs.tamperedCertificates === 1 ? "" : "s"}`,
    });
  }
  if (inputs.failedRuns1h > 0) {
    signals.push({
      kind: "failed-runs-1h",
      count: inputs.failedRuns1h,
      label: `${inputs.failedRuns1h} failed factory run${inputs.failedRuns1h === 1 ? "" : "s"} in the last hour`,
    });
  }
  if (inputs.failedRuns24h > inputs.failedRuns1h) {
    // Roll-up of the 24h band, excluding the last hour already surfaced.
    const remainder = inputs.failedRuns24h - inputs.failedRuns1h;
    signals.push({
      kind: "failed-runs-24h",
      count: remainder,
      label: `${remainder} failed factory run${remainder === 1 ? "" : "s"} in the last 24h`,
    });
  }
  if (inputs.staleExtractions > 0) {
    signals.push({
      kind: "stale-extractions",
      count: inputs.staleExtractions,
      label: `${inputs.staleExtractions} stale extraction run${inputs.staleExtractions === 1 ? "" : "s"}`,
    });
  }
  if (inputs.couplingGateFailures24h > 0) {
    signals.push({
      kind: "coupling-gate-failures-24h",
      count: inputs.couplingGateFailures24h,
      label: `${inputs.couplingGateFailures24h} coupling-gate failure${inputs.couplingGateFailures24h === 1 ? "" : "s"} in the last 24h`,
    });
  }
  for (const id of inputs.missingPrereqs) {
    signals.push({
      kind: "missing-prereq",
      count: 1,
      label: labelForMissingPrereq(id),
    });
  }

  const severity = pickSeverity(inputs);
  return { available: true, severity, signals };
}

function pickSeverity(inputs: RiskInputs): RiskSeverity {
  if (inputs.failedRuns1h > 0 || inputs.tamperedCertificates > 0) {
    return "critical";
  }
  const anyWarning =
    inputs.staleExtractions > 0 ||
    inputs.failedRuns24h > 0 ||
    inputs.couplingGateFailures24h > 0 ||
    inputs.missingPrereqs.length > 0;
  return anyWarning ? "warning" : "ok";
}
