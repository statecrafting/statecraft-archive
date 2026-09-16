// Spec 175 FR-010 — `riskAssessor` purity test suite.

import { describe, expect, it } from "vitest";
import { assessRisk } from "./riskAssessor";
import type { RiskInputs } from "./types";

function inputs(overrides: Partial<RiskInputs> = {}): RiskInputs {
  return {
    staleExtractions: 0,
    failedRuns24h: 0,
    failedRuns1h: 0,
    couplingGateFailures24h: 0,
    missingPrereqs: [],
    tamperedCertificates: 0,
    ...overrides,
  };
}

describe("assessRisk severity rule", () => {
  it("returns ok when every signal is zero", () => {
    const panel = assessRisk(inputs());
    expect(panel).toEqual({
      available: true,
      severity: "ok",
      signals: [],
    });
  });

  it("returns warning on stale extractions alone", () => {
    const panel = assessRisk(inputs({ staleExtractions: 3 }));
    expect(panel.available).toBe(true);
    if (panel.available) {
      expect(panel.severity).toBe("warning");
      expect(panel.signals[0].kind).toBe("stale-extractions");
      expect(panel.signals[0].count).toBe(3);
    }
  });

  it("returns warning on failed runs in the 24h band but not the 1h band", () => {
    const panel = assessRisk(inputs({ failedRuns24h: 2, failedRuns1h: 0 }));
    expect(panel.available).toBe(true);
    if (panel.available) {
      expect(panel.severity).toBe("warning");
      expect(panel.signals.some((s) => s.kind === "failed-runs-24h")).toBe(true);
    }
  });

  it("returns critical on any failed run in the last hour", () => {
    const panel = assessRisk(
      inputs({ failedRuns24h: 5, failedRuns1h: 1 })
    );
    expect(panel.available).toBe(true);
    if (panel.available) {
      expect(panel.severity).toBe("critical");
    }
  });

  it("returns critical on a tampered certificate alone", () => {
    const panel = assessRisk(inputs({ tamperedCertificates: 1 }));
    expect(panel.available).toBe(true);
    if (panel.available) {
      expect(panel.severity).toBe("critical");
    }
  });

  it("returns warning on coupling-gate failures alone", () => {
    const panel = assessRisk(inputs({ couplingGateFailures24h: 4 }));
    expect(panel.available).toBe(true);
    if (panel.available) {
      expect(panel.severity).toBe("warning");
    }
  });

  it("returns warning when only missing prerequisites are present", () => {
    const panel = assessRisk(inputs({ missingPrereqs: ["no-environments"] }));
    expect(panel.available).toBe(true);
    if (panel.available) {
      expect(panel.severity).toBe("warning");
      expect(panel.signals[0].label).toBe("No environments configured");
    }
  });

  it("labels missing prereqs that have no human-readable mapping with their raw id", () => {
    const panel = assessRisk(inputs({ missingPrereqs: ["custom-blocker"] }));
    if (panel.available) {
      expect(panel.signals[0].label).toBe("custom-blocker");
    }
  });

  it("rolls up the 24h failed-run count net of the 1h band", () => {
    const panel = assessRisk(inputs({ failedRuns24h: 5, failedRuns1h: 2 }));
    if (panel.available) {
      const last1h = panel.signals.find((s) => s.kind === "failed-runs-1h");
      const last24h = panel.signals.find((s) => s.kind === "failed-runs-24h");
      expect(last1h?.count).toBe(2);
      expect(last24h?.count).toBe(3);
    }
  });

  it("does not emit a 24h band when it equals the 1h band", () => {
    const panel = assessRisk(inputs({ failedRuns24h: 1, failedRuns1h: 1 }));
    if (panel.available) {
      expect(panel.signals.find((s) => s.kind === "failed-runs-24h")).toBeUndefined();
    }
  });

  it("orders signals highest-impact-first (critical before warning bands)", () => {
    const panel = assessRisk(
      inputs({
        staleExtractions: 1,
        failedRuns1h: 1,
        couplingGateFailures24h: 1,
      })
    );
    if (panel.available) {
      // First signal is the critical band (failed-runs-1h).
      expect(panel.signals[0].kind).toBe("failed-runs-1h");
    }
  });

  it("handles plural / singular labelling correctly", () => {
    const one = assessRisk(inputs({ staleExtractions: 1 }));
    const many = assessRisk(inputs({ staleExtractions: 2 }));
    if (one.available && many.available) {
      expect(one.signals[0].label).toContain("1 stale extraction run");
      expect(many.signals[0].label).toContain("2 stale extraction runs");
    }
  });
});
