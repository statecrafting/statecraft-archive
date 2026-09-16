// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-042

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProvenanceHealthPanel } from "../ProvenanceHealthPanel";

afterEach(() => {
  cleanup();
});

describe("ProvenanceHealthPanel", () => {
  it("renders the empty state when no aggregation is supplied", () => {
    render(<ProvenanceHealthPanel aggregation={null} />);
    expect(screen.getByTestId("provenance-health-empty")).toBeInTheDocument();
    expect(screen.getByText(/run Factory Stage 1/i)).toBeInTheDocument();
  });

  it("renders the empty state when aggregation has zero runs", () => {
    render(
      <ProvenanceHealthPanel
        aggregation={{
          projectId: "p",
          projectSlug: "p",
          latestRunAt: null,
          runCount: 0,
          rejectionRateSeries: [],
          assumptionRateSeries: [],
        }}
      />,
    );
    expect(screen.getByTestId("provenance-health-empty")).toBeInTheDocument();
  });

  it("renders the data shape when at least one run is present", () => {
    render(
      <ProvenanceHealthPanel
        aggregation={{
          projectId: "p",
          projectSlug: "example",
          latestRunAt: "2026-05-01T00:00:00Z",
          runCount: 3,
          rejectionRateSeries: [],
          assumptionRateSeries: [],
        }}
      />,
    );
    expect(screen.getByTestId("provenance-health")).toBeInTheDocument();
    expect(screen.getByText(/example/)).toBeInTheDocument();
    expect(screen.getByText(/3 run/)).toBeInTheDocument();
  });
});
