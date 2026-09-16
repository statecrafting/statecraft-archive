// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-041
//
// ProvenanceReport smoke tests. Pin three invariants:
//   1. The summary badges render counts for each of the four modes.
//   2. Rejected claims surface the three-action remediation panel
//      (Supply citation + Downgrade buttons).
//   3. Assumption claims with `candidatePromotion` populated surface a
//      one-click "Promote to DERIVED" button; without it, no button.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
import {
  ProvenanceReport,
  type ValidationReport,
  type ClaimRecord,
  type CitationDto,
} from "../ProvenanceReport";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const sampleCitation: CitationDto = {
  source: "doc.txt",
  lineRange: [1, 1],
  quote: "x",
  quoteHash: "0".repeat(64),
};

const claim = (
  id: string,
  mode: ClaimRecord["provenanceMode"],
  extras: Partial<ClaimRecord> = {},
): ClaimRecord => ({
  id,
  kind: "BR",
  anchorHash: "abc".repeat(20),
  provenanceMode: mode,
  namesExternalEntity: false,
  extractedEntityCandidates: [],
  entitySearch: [],
  ...extras,
});

const buildReport = (claims: ClaimRecord[]): ValidationReport => ({
  schemaVersion: "1.0.0",
  provenanceSchemaVersion: "1.0.0",
  validatorVersion: "0.1.0",
  extractedCorpusHash: "f".repeat(64),
  allowlistVersionHash: "9".repeat(64),
  claims,
  summary: {
    total: claims.length,
    derivedCount: claims.filter((c) => c.provenanceMode.mode === "derived").length,
    derivedWeakCount: 0,
    assumptionCount: claims.filter(
      (c) => c.provenanceMode.mode === "assumption",
    ).length,
    assumptionOrphanedCount: claims.filter(
      (c) => c.provenanceMode.mode === "assumptionOrphaned",
    ).length,
    rejectedCount: claims.filter((c) => c.provenanceMode.mode === "rejected")
      .length,
    assumptionSlotsConsumed: 0,
  },
});

describe("ProvenanceReport", () => {
  it("renders summary badges for each mode", () => {
    const report = buildReport([
      claim("BR-001", { mode: "derived" }),
      claim("INT-001", { mode: "assumption" }),
      claim("INT-002", { mode: "assumptionOrphaned" }),
      claim("STK-13", {
        mode: "rejected",
        reason: "no_citation_for_external_entity",
      }),
    ]);
    render(
      <ProvenanceReport projectPath="/tmp/p" initialReport={report} />,
    );
    expect(screen.getByTestId("count-derived")).toHaveTextContent("Derived: 1");
    expect(screen.getByTestId("count-assumption")).toHaveTextContent(
      "Assumption: 1",
    );
    expect(screen.getByTestId("count-orphaned")).toHaveTextContent(
      "Orphaned: 1",
    );
    expect(screen.getByTestId("count-rejected")).toHaveTextContent(
      "Rejected: 1",
    );
  });

  it("shows the three-action remediation panel for Rejected claims", () => {
    const report = buildReport([
      claim("STK-13", {
        mode: "rejected",
        reason: "no_citation_for_external_entity",
      }),
    ]);
    render(
      <ProvenanceReport projectPath="/tmp/p" initialReport={report} />,
    );
    const panel = screen.getByTestId("remediation-STK-13");
    expect(panel).toBeInTheDocument();
    expect(
      panel.querySelector("button:nth-child(1)")?.textContent,
    ).toMatch(/Supply citation/i);
    expect(
      panel.querySelector("button:nth-child(2)")?.textContent,
    ).toMatch(/Downgrade to ASSUMPTION/i);
  });

  it("does not show the promote button when candidatePromotion is absent", () => {
    const report = buildReport([
      claim("INT-001", { mode: "assumption" }),
    ]);
    render(
      <ProvenanceReport projectPath="/tmp/p" initialReport={report} />,
    );
    expect(screen.queryByTestId("promote-INT-001")).toBeNull();
  });

  it("shows the one-click promote button when candidatePromotion is set", () => {
    const report = buildReport([
      claim("INT-001", { mode: "assumption" }, {
        candidatePromotion: {
          citation: sampleCitation,
          pendingOperatorReview: true,
        },
      }),
    ]);
    render(
      <ProvenanceReport projectPath="/tmp/p" initialReport={report} />,
    );
    expect(screen.getByTestId("promote-INT-001")).toBeInTheDocument();
    expect(screen.getByTestId("promote-INT-001").textContent).toMatch(
      /Promote to DERIVED/,
    );
  });

  it("renders the panic banner when validator panicked", () => {
    const report: ValidationReport = {
      ...buildReport([]),
      panicReason: "qg13_validator_panic: simulated",
    };
    render(
      <ProvenanceReport projectPath="/tmp/p" initialReport={report} />,
    );
    expect(screen.getByTestId("provenance-panic")).toBeInTheDocument();
  });
});
