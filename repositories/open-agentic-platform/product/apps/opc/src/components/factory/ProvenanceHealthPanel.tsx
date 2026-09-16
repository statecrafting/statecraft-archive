// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-042

import * as React from "react";

/**
 * `Provenance Health` workspace dashboard surface.
 *
 * Spec 121 §FR-042 reserves this panel: per-project rejection +
 * assumption rates aggregated across runs. Phase 6 lands the route +
 * empty state + data shape only; aggregation is deferred to a
 * follow-up once statecraft exposes the per-run metric table.
 */

export interface ProvenanceHealthAggregation {
  projectId: string;
  projectSlug: string;
  /** ISO-8601 timestamp of the latest validator run we have data for. */
  latestRunAt: string | null;
  runCount: number;
  rejectionRateSeries: Array<{
    runAt: string;
    rejectedCount: number;
    totalClaims: number;
  }>;
  assumptionRateSeries: Array<{
    runAt: string;
    assumptionCount: number;
    totalClaims: number;
  }>;
}

interface ProvenanceHealthPanelProps {
  /** When provided, the panel renders the supplied aggregation. When
   * null/undefined the panel renders its empty state. Aggregation
   * fetching is deferred to a follow-up. */
  aggregation?: ProvenanceHealthAggregation | null;
}

export function ProvenanceHealthPanel({
  aggregation,
}: ProvenanceHealthPanelProps): React.ReactElement {
  if (!aggregation || aggregation.runCount === 0) {
    return (
      <section
        className="provenance-health provenance-health--empty"
        data-testid="provenance-health-empty"
        aria-label="Provenance health dashboard (empty)"
      >
        <h2>Provenance Health</h2>
        <p>
          No provenance data yet — run Factory Stage 1 against a project to
          see metrics.
        </p>
        <p className="provenance-health__hint">
          Spec 121 reserves this panel surface; per-project rejection and
          assumption-rate trends will appear here once statecraft exposes
          the per-run aggregation feed.
        </p>
      </section>
    );
  }

  return (
    <section
      className="provenance-health"
      data-testid="provenance-health"
      aria-label="Provenance health dashboard"
    >
      <h2>Provenance Health · {aggregation.projectSlug}</h2>
      <p className="provenance-health__meta">
        Latest run:{" "}
        {aggregation.latestRunAt ?? "—"} · {aggregation.runCount} run(s) on
        record
      </p>
      <p className="provenance-health__placeholder">
        TODO(spec-121 follow-up): chart `rejectionRateSeries` and
        `assumptionRateSeries` here once statecraft's aggregation
        endpoint lands.
      </p>
    </section>
  );
}
