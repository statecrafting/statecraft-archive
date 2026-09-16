// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-030, FR-031, FR-032

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// -----------------------------------------------------------------------
// TypeScript wire shapes mirroring the Rust types in
// `crates/factory-engine/src/stages/stage_cd_comparator.rs` and
// `stage_cd_gate.rs`. Hand-rolled rather than ts-rs auto-generated
// (same convention as ProvenanceReport.tsx, spec 121).
// -----------------------------------------------------------------------

export type DiffClass =
  | "wording"
  | "structural"
  | "scope"
  | "external-entity"
  | "ownership"
  | "citation";

export interface DiffResolution {
  action: "rejected" | "accepted" | "force-approved";
  actor: string;
  at: string;
  reason?: string;
}

export interface StageCdDiffFinding {
  doc: string;
  anchor: string;
  class: DiffClass | string;
  authoredExcerpt?: string;
  candidateExcerpt?: string;
  pairing: "exact-anchor" | "exact-hash" | "jaccard" | "unmatched" | string;
  resolution?: DiffResolution;
}

export interface StageCdDiffCounts {
  wording: number;
  structural: number;
  scope: number;
  externalEntity: number;
  ownership: number;
  citation: number;
}

export interface StageCdDiff {
  generatedAt: string;
  mode: string;
  findings: StageCdDiffFinding[];
  counts: StageCdDiffCounts;
}

export interface BlockingDiff {
  doc: string;
  anchor: string;
  class: string;
  reason: string;
}

export interface GateResult {
  decision: "pass" | "passWithWarnings" | "fail";
  blocking: BlockingDiff[];
}

export interface GateResultDto {
  diff: StageCdDiff;
  gate: GateResult;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export interface StageCdReviewProps {
  /** Run-scoped artifact-store directory for this Stage CD invocation
   * (the same path the Rust orchestrator wrote `stage-cd-diff.json`
   * into). */
  artifactStore: string;
  projectSlug: string;
  /** Authored doc paths used by the Accept action. */
  authoredCharter: string;
  authoredClientDocument: string;
  /** Candidate doc paths produced by Phase 1. */
  candidateCharter: string;
  candidateClientDocument: string;
  /** Run id stamped onto every applied-from audit entry. */
  runId: string;
  /** Workspace member id used as the actor on each operator action. */
  actor: string;
  /** Tests pass `initialDiff` to skip the initial fetch. */
  initialDiff?: StageCdDiff | null;
  /** Optional handler for the "Open Stage 1 review" navigation link
   * (FR-031 — the surface routes the operator to the upstream
   * provenance review). */
  onOpenStage1Review?: (anchor: string) => void;
  /** Optional handler called after every successful operator action so
   * the parent can refresh its own state / re-evaluate the gate. */
  onActionApplied?: (diff: StageCdDiff) => void;
}

/**
 * Stage CD review surface (spec 122 FR-030, FR-031, FR-032).
 *
 * Renders `stage-cd-diff.json` per-section with side-by-side authored
 * vs candidate excerpts, the diff classification label, and the three
 * operator actions (Reject / Accept / Force approve). The seed-ready
 * signal renders distinctly from the compare-blocked signal — green
 * banner for `mode: "seed"` (positive milestone), red banner with
 * blocking diffs listed for `mode: "compare"` with any blockers
 * (remediation needed). FR-026's empty-reason rejection is enforced
 * client-side too (the Force approve button stays disabled until the
 * operator types a reason); the Tauri command also rejects empty as
 * the authoritative boundary.
 */
export function StageCdReview({
  artifactStore,
  projectSlug,
  authoredCharter,
  authoredClientDocument,
  candidateCharter,
  candidateClientDocument,
  runId,
  actor,
  initialDiff,
  onOpenStage1Review,
  onActionApplied,
}: StageCdReviewProps): React.ReactElement {
  const [diff, setDiff] = useState<StageCdDiff | null>(initialDiff ?? null);
  const [gate, setGate] = useState<GateResult | null>(null);
  const [loading, setLoading] = useState<boolean>(initialDiff == null);
  const [error, setError] = useState<string | null>(null);

  const loadDiff = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<GateResultDto>(
        "stage_cd_evaluate_gate",
        {
          artifactStore,
          projectSlug,
        },
      );
      setDiff(result.diff);
      setGate(result.gate);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [artifactStore, projectSlug]);

  useEffect(() => {
    if (initialDiff != null) {
      return;
    }
    void loadDiff();
  }, [initialDiff, loadDiff]);

  const onReject = useCallback(
    async (finding: StageCdDiffFinding) => {
      try {
        const result = await invoke<{ diff: StageCdDiff }>(
          "stage_cd_reject_candidate",
          {
            artifactStore,
            projectSlug,
            doc: finding.doc,
            anchor: finding.anchor,
            actor,
          },
        );
        setDiff(result.diff);
        if (onActionApplied) onActionApplied(result.diff);
        await loadDiff();
      } catch (e) {
        setError(String(e));
      }
    },
    [actor, artifactStore, loadDiff, onActionApplied, projectSlug],
  );

  const onAccept = useCallback(
    async (finding: StageCdDiffFinding) => {
      const ok = window.confirm(
        `Apply candidate to authored ${finding.doc} at ${finding.anchor}? The authored doc will be rewritten and version bumped.`,
      );
      if (!ok) return;
      try {
        const authoredPath =
          finding.doc === "client-document.md"
            ? authoredClientDocument
            : authoredCharter;
        const candidatePath =
          finding.doc === "client-document.md"
            ? candidateClientDocument
            : candidateCharter;
        const result = await invoke<{ diff: StageCdDiff }>(
          "stage_cd_accept_candidate",
          {
            artifactStore,
            projectSlug,
            authoredPath,
            candidatePath,
            anchor: finding.anchor,
            actor,
            runId,
          },
        );
        setDiff(result.diff);
        if (onActionApplied) onActionApplied(result.diff);
        await loadDiff();
      } catch (e) {
        setError(String(e));
      }
    },
    [
      actor,
      artifactStore,
      authoredCharter,
      authoredClientDocument,
      candidateCharter,
      candidateClientDocument,
      loadDiff,
      onActionApplied,
      projectSlug,
      runId,
    ],
  );

  const onForceApprove = useCallback(
    async (finding: StageCdDiffFinding, reason: string) => {
      if (reason.trim().length === 0) {
        setError("Force approve requires a non-empty reason (FR-026).");
        return;
      }
      try {
        const result = await invoke<{ diff: StageCdDiff }>(
          "stage_cd_force_approve",
          {
            artifactStore,
            projectSlug,
            doc: finding.doc,
            anchor: finding.anchor,
            actor,
            reason,
          },
        );
        setDiff(result.diff);
        if (onActionApplied) onActionApplied(result.diff);
        await loadDiff();
      } catch (e) {
        setError(String(e));
      }
    },
    [actor, artifactStore, loadDiff, onActionApplied, projectSlug],
  );

  if (loading) {
    return (
      <div
        className="stage-cd-review stage-cd-review--loading"
        data-testid="stage-cd-review-loading"
      >
        Loading Stage CD diff…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="stage-cd-review stage-cd-review--error"
        role="alert"
        data-testid="stage-cd-review-error"
      >
        Stage CD review error: {error}
      </div>
    );
  }

  if (!diff) {
    return (
      <div
        className="stage-cd-review stage-cd-review--empty"
        data-testid="stage-cd-review-empty"
      >
        No Stage CD diff yet — run a factory pipeline through Stage CD to
        generate one.
      </div>
    );
  }

  return (
    <section
      className="stage-cd-review"
      data-testid="stage-cd-review"
      aria-label="Stage CD review (spec 122)"
    >
      <Banner mode={diff.mode} gate={gate} />
      <Counts counts={diff.counts} />
      <ol className="stage-cd-review__findings">
        {diff.findings.map((f) => (
          <FindingRow
            key={`${f.doc}::${f.anchor}::${f.class}`}
            finding={f}
            onReject={() => void onReject(f)}
            onAccept={() => void onAccept(f)}
            onForceApprove={(reason) => void onForceApprove(f, reason)}
            onOpenStage1Review={
              onOpenStage1Review
                ? () => onOpenStage1Review(f.anchor)
                : undefined
            }
          />
        ))}
      </ol>
    </section>
  );
}

// -----------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------

function Banner({
  mode,
  gate,
}: {
  mode: string;
  gate: GateResult | null;
}): React.ReactElement {
  if (mode === "seed") {
    // FR-032: seed-ready is a positive milestone, distinct from
    // compare-blocked. Operators see green; this is forward progress.
    return (
      <header
        className="stage-cd-banner stage-cd-banner--seed-ready"
        data-testid="stage-cd-banner-seed"
        role="status"
      >
        <strong>Seed candidates ready for review.</strong>
        <p>
          This project has no authored stakeholder docs yet. Stage CD is
          running in <code>seed</code> mode; review the candidates and
          commit them under{" "}
          <code>requirements/stakeholder/</code> to switch the next run
          to <code>compare</code> mode.
        </p>
      </header>
    );
  }
  if (gate && gate.decision === "fail") {
    return (
      <header
        className="stage-cd-banner stage-cd-banner--compare-blocked"
        data-testid="stage-cd-banner-blocked"
        role="alert"
      >
        <strong>QG-CD-01 blocked the gate.</strong>
        <p>{gate.blocking.length} unresolved diff(s) require remediation.</p>
        <ul>
          {gate.blocking.map((b) => (
            <li key={`${b.doc}::${b.anchor}`}>
              <code>{b.doc}</code> {b.anchor}{" "}
              <span className="badge badge--red">{b.class}</span>
              <span className="stage-cd-banner__reason"> — {b.reason}</span>
            </li>
          ))}
        </ul>
      </header>
    );
  }
  if (gate && gate.decision === "passWithWarnings") {
    return (
      <header
        className="stage-cd-banner stage-cd-banner--pass-with-warnings"
        data-testid="stage-cd-banner-pass-warn"
        role="status"
      >
        <strong>QG-CD-01 passed with wording-only warnings.</strong>
        <p>The pipeline advances; the wording diffs are recorded for audit.</p>
      </header>
    );
  }
  return (
    <header
      className="stage-cd-banner stage-cd-banner--pass"
      data-testid="stage-cd-banner-pass"
      role="status"
    >
      <strong>QG-CD-01 passed.</strong>
    </header>
  );
}

function Counts({
  counts,
}: {
  counts: StageCdDiffCounts;
}): React.ReactElement {
  return (
    <ul className="stage-cd-review__counts" data-testid="stage-cd-counts">
      <li className="badge badge--neutral">Wording: {counts.wording}</li>
      <li className="badge badge--orange">Structural: {counts.structural}</li>
      <li className="badge badge--red">Scope: {counts.scope}</li>
      <li className="badge badge--red">
        External entity: {counts.externalEntity}
      </li>
      <li className="badge badge--red">Ownership: {counts.ownership}</li>
      <li className="badge badge--red">Citation: {counts.citation}</li>
    </ul>
  );
}

function FindingRow({
  finding,
  onReject,
  onAccept,
  onForceApprove,
  onOpenStage1Review,
}: {
  finding: StageCdDiffFinding;
  onReject: () => void;
  onAccept: () => void;
  onForceApprove: (reason: string) => void;
  onOpenStage1Review?: () => void;
}): React.ReactElement {
  const [reason, setReason] = useState<string>("");
  const reasonValid = reason.trim().length > 0;
  const resolved = finding.resolution != null;

  return (
    <li
      className={`stage-cd-finding stage-cd-finding--${finding.class}`}
      data-testid={`stage-cd-finding-${finding.doc}-${finding.anchor}`}
    >
      <header className="stage-cd-finding__header">
        <code className="stage-cd-finding__doc">{finding.doc}</code>
        <code className="stage-cd-finding__anchor">{finding.anchor}</code>
        <span className={`badge badge--${finding.class}`}>{finding.class}</span>
        <span
          className="stage-cd-finding__pairing"
          title={`Pairing path: ${finding.pairing}`}
        >
          ({finding.pairing})
        </span>
      </header>
      <div className="stage-cd-finding__excerpts">
        <article className="stage-cd-finding__authored">
          <h4>Authored</h4>
          <pre>{finding.authoredExcerpt ?? "<absent>"}</pre>
        </article>
        <article className="stage-cd-finding__candidate">
          <h4>Candidate</h4>
          <pre>{finding.candidateExcerpt ?? "<absent>"}</pre>
        </article>
      </div>
      {resolved ? (
        <p
          className="stage-cd-finding__resolution"
          data-testid={`stage-cd-resolution-${finding.doc}-${finding.anchor}`}
        >
          Resolved by <strong>{finding.resolution!.actor}</strong>:{" "}
          <em>{finding.resolution!.action}</em>
          {finding.resolution!.reason
            ? ` — "${finding.resolution!.reason}"`
            : ""}
        </p>
      ) : (
        <div className="stage-cd-finding__actions">
          <button
            type="button"
            onClick={onReject}
            data-testid={`stage-cd-reject-${finding.doc}-${finding.anchor}`}
          >
            Reject candidate
          </button>
          <button
            type="button"
            onClick={onAccept}
            data-testid={`stage-cd-accept-${finding.doc}-${finding.anchor}`}
          >
            Accept candidate
          </button>
          <div className="stage-cd-finding__force-approve">
            <input
              type="text"
              placeholder="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              data-testid={`stage-cd-force-reason-${finding.doc}-${finding.anchor}`}
            />
            <button
              type="button"
              disabled={!reasonValid}
              onClick={() => onForceApprove(reason)}
              data-testid={`stage-cd-force-approve-${finding.doc}-${finding.anchor}`}
            >
              Force approve
            </button>
          </div>
          {onOpenStage1Review && (
            <button
              type="button"
              onClick={onOpenStage1Review}
              data-testid={`stage-cd-open-stage1-${finding.doc}-${finding.anchor}`}
            >
              Open Stage 1 review
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default StageCdReview;
