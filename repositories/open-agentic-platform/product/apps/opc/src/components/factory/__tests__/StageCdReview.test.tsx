// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-030, FR-031, FR-032
//
// StageCdReview smoke tests. Pin the load-bearing UX invariants:
//   1. Seed-ready banner renders distinctly from compare-blocked
//      (FR-032 — positive milestone vs remediation prompt).
//   2. Each finding surfaces the three operator actions inline
//      (Reject / Accept / Force approve).
//   3. Force approve button stays DISABLED while the reason field is
//      empty or whitespace-only (FR-026 enforced client-side).
//   4. Resolved findings render their resolution metadata instead of
//      action buttons.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

import {
  StageCdReview,
  type StageCdDiff,
} from "../StageCdReview";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const baseProps = {
  artifactStore: "/p/runs/run-001",
  projectSlug: "example",
  authoredCharter: "/p/requirements/stakeholder/charter.md",
  authoredClientDocument: "/p/requirements/stakeholder/client-document.md",
  candidateCharter: "/p/runs/run-001/stage-cd/charter.candidate.md",
  candidateClientDocument:
    "/p/runs/run-001/stage-cd/client-document.candidate.md",
  runId: "run-001",
  actor: "alice",
};

function diffWith(
  partial: Partial<StageCdDiff> & { findings?: StageCdDiff["findings"] } = {},
): StageCdDiff {
  return {
    generatedAt: "2026-04-30T12:00:00Z",
    mode: "compare",
    findings: [],
    counts: {
      wording: 0,
      structural: 0,
      scope: 0,
      externalEntity: 0,
      ownership: 0,
      citation: 0,
    },
    ...partial,
  };
}

describe("StageCdReview", () => {
  it("renders seed-ready banner distinctly when mode is 'seed' (FR-032)", () => {
    render(
      <StageCdReview
        {...baseProps}
        initialDiff={diffWith({ mode: "seed" })}
      />,
    );
    const banner = screen.getByTestId("stage-cd-banner-seed");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("Seed candidates ready");
    expect(screen.queryByTestId("stage-cd-banner-blocked")).toBeNull();
  });

  it("renders compare-blocked banner when gate fails", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      diff: diffWith({
        findings: [
          {
            doc: "charter.md",
            anchor: "OUT-SCOPE-3",
            class: "scope",
            authoredExcerpt: "Out of scope.",
            candidateExcerpt: "In scope now.",
            pairing: "jaccard",
          },
        ],
        counts: {
          wording: 0,
          structural: 0,
          scope: 1,
          externalEntity: 0,
          ownership: 0,
          citation: 0,
        },
      }),
      gate: {
        decision: "fail",
        blocking: [
          {
            doc: "charter.md",
            anchor: "OUT-SCOPE-3",
            class: "scope",
            reason: "scope diffs are gate-blocking unless force-approved",
          },
        ],
      },
    });
    render(<StageCdReview {...baseProps} />);
    const banner = await screen.findByTestId("stage-cd-banner-blocked");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("QG-CD-01 blocked the gate");
  });

  it("surfaces the three operator actions inline per finding (FR-030)", () => {
    render(
      <StageCdReview
        {...baseProps}
        initialDiff={diffWith({
          findings: [
            {
              doc: "charter.md",
              anchor: "OUT-SCOPE-3",
              class: "scope",
              authoredExcerpt: "Out of scope.",
              candidateExcerpt: "In scope now.",
              pairing: "jaccard",
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByTestId("stage-cd-reject-charter.md-OUT-SCOPE-3"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("stage-cd-accept-charter.md-OUT-SCOPE-3"),
    ).toBeTruthy();
    expect(
      screen.getByTestId(
        "stage-cd-force-approve-charter.md-OUT-SCOPE-3",
      ),
    ).toBeTruthy();
  });

  it("keeps Force approve disabled until the reason field is non-empty (FR-026)", () => {
    render(
      <StageCdReview
        {...baseProps}
        initialDiff={diffWith({
          findings: [
            {
              doc: "charter.md",
              anchor: "OUT-SCOPE-3",
              class: "scope",
              authoredExcerpt: "Out of scope.",
              candidateExcerpt: "In scope now.",
              pairing: "jaccard",
            },
          ],
        })}
      />,
    );
    const button = screen.getByTestId(
      "stage-cd-force-approve-charter.md-OUT-SCOPE-3",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const input = screen.getByTestId(
      "stage-cd-force-reason-charter.md-OUT-SCOPE-3",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "policy approved" } });
    expect(button.disabled).toBe(false);
    // Whitespace-only re-disables.
    fireEvent.change(input, { target: { value: "   \t  " } });
    expect(button.disabled).toBe(true);
  });

  it("renders resolution metadata instead of action buttons for resolved findings", () => {
    render(
      <StageCdReview
        {...baseProps}
        initialDiff={diffWith({
          findings: [
            {
              doc: "charter.md",
              anchor: "OUT-SCOPE-3",
              class: "scope",
              authoredExcerpt: "Out of scope.",
              candidateExcerpt: "In scope now.",
              pairing: "jaccard",
              resolution: {
                action: "force-approved",
                actor: "alice",
                at: "2026-04-30T12:30:00Z",
                reason: "policy approved",
              },
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByTestId("stage-cd-resolution-charter.md-OUT-SCOPE-3"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("stage-cd-reject-charter.md-OUT-SCOPE-3"),
    ).toBeNull();
  });

  it("offers an Open Stage 1 review action when the handler is supplied (FR-031)", () => {
    const handler = vi.fn();
    render(
      <StageCdReview
        {...baseProps}
        onOpenStage1Review={handler}
        initialDiff={diffWith({
          findings: [
            {
              doc: "charter.md",
              anchor: "OBJ-1",
              class: "scope",
              authoredExcerpt: "Authored.",
              candidateExcerpt: "Candidate.",
              pairing: "jaccard",
            },
          ],
        })}
      />,
    );
    const link = screen.getByTestId(
      "stage-cd-open-stage1-charter.md-OBJ-1",
    );
    fireEvent.click(link);
    expect(handler).toHaveBeenCalledWith("OBJ-1");
  });
});
