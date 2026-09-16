// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-041

import * as React from "react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// -----------------------------------------------------------------------
// TypeScript mirror of `provenance_validator::ValidationReport`. Hand-
// rolled rather than ts-rs auto-generated; the shapes are stable and
// the schema parity check (Phase 1) catches drift on the contract side.
// -----------------------------------------------------------------------

export type ProvenanceModeTag =
  | "derived"
  | "derivedWeak"
  | "assumption"
  | "assumptionOrphaned"
  | "rejected";

export interface ProvenanceModeRejected {
  mode: "rejected";
  reason: string;
}
export interface ProvenanceModeOther {
  mode: Exclude<ProvenanceModeTag, "rejected">;
}
export type ProvenanceMode = ProvenanceModeRejected | ProvenanceModeOther;

export interface CitationDto {
  source: string;
  lineRange: [number, number];
  quote: string;
  quoteHash: string;
}

export interface CandidatePromotion {
  citation: CitationDto;
  pendingOperatorReview: boolean;
}

export interface ClaimRecord {
  id: string;
  kind: string;
  anchorHash: string;
  provenanceMode: ProvenanceMode;
  namesExternalEntity: boolean;
  extractedEntityCandidates: string[];
  entitySearch: Array<{
    source: string;
    pagesSearched: number;
    hitCount: number;
    hits: Array<{ lineRange: [number, number]; quote: string }>;
  }>;
  candidatePromotion?: CandidatePromotion;
}

export interface ValidationSummary {
  total: number;
  derivedCount: number;
  derivedWeakCount: number;
  assumptionCount: number;
  assumptionOrphanedCount: number;
  rejectedCount: number;
  assumptionSlotsConsumed: number;
}

export interface ValidationReport {
  schemaVersion: string;
  provenanceSchemaVersion: string;
  validatorVersion: string;
  extractedCorpusHash: string;
  allowlistVersionHash: string;
  claims: ClaimRecord[];
  summary: ValidationSummary;
  panicReason?: string;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

interface ProvenanceReportProps {
  projectPath: string;
  /** When provided, the component renders this report directly and
   * skips the initial fetch. Tests use this; production callers pass
   * `null` and let the effect run. */
  initialReport?: ValidationReport | null;
  /** Called when the report is mutated (citation supplied, downgrade,
   * promotion). */
  onReportChange?: (report: ValidationReport) => void;
}

export function ProvenanceReport({
  projectPath,
  initialReport,
  onReportChange,
}: ProvenanceReportProps): React.ReactElement {
  const [report, setReport] = useState<ValidationReport | null>(
    initialReport ?? null,
  );
  const [loading, setLoading] = useState<boolean>(initialReport == null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialReport != null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        const raw = await invoke<unknown>("provenance_get_report", {
          projectPath,
        });
        if (cancelled) return;
        // The audit fallback returns an `AuditReport { validation, ... }`
        // wrapper; the persisted path returns a `ValidationReport`
        // directly. Accept both shapes.
        const r = raw as Record<string, unknown>;
        const validation =
          (r.validation as ValidationReport | undefined) ??
          (raw as ValidationReport);
        setReport(validation);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, initialReport]);

  if (loading) {
    return (
      <div className="provenance-report provenance-report--loading">
        Loading provenance report…
      </div>
    );
  }
  if (error) {
    return (
      <div className="provenance-report provenance-report--error" role="alert">
        Provenance report error: {error}
      </div>
    );
  }
  if (!report) {
    return (
      <div className="provenance-report provenance-report--empty">
        No provenance report yet — run Stage 1 to generate one.
      </div>
    );
  }
  if (report.panicReason) {
    return (
      <div
        className="provenance-report provenance-report--panic"
        role="alert"
        data-testid="provenance-panic"
      >
        <strong>QG-13 validator panicked — gate failed closed.</strong>
        <pre>{report.panicReason}</pre>
      </div>
    );
  }

  return (
    <section
      className="provenance-report"
      data-testid="provenance-report"
      aria-label="Spec 121 provenance report"
    >
      <header className="provenance-report__summary">
        <h3>Provenance Report</h3>
        <ul className="provenance-report__counts">
          <li className="badge badge--green" data-testid="count-derived">
            Derived: {report.summary.derivedCount}
          </li>
          <li className="badge badge--yellow" data-testid="count-assumption">
            Assumption: {report.summary.assumptionCount}
          </li>
          <li
            className="badge badge--orange"
            data-testid="count-orphaned"
          >
            Orphaned: {report.summary.assumptionOrphanedCount}
          </li>
          <li className="badge badge--red" data-testid="count-rejected">
            Rejected: {report.summary.rejectedCount}
          </li>
          <li className="badge badge--neutral">
            Total: {report.summary.total}
          </li>
        </ul>
        <p className="provenance-report__hashes">
          Corpus: <code>{shortHash(report.extractedCorpusHash)}</code>
          &nbsp;·&nbsp;Allowlist:{" "}
          <code>{shortHash(report.allowlistVersionHash)}</code>
        </p>
      </header>

      <table className="provenance-report__table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Kind</th>
            <th>Mode</th>
            <th>Anchor</th>
            <th>Entities</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {report.claims.map((c) => (
            <ClaimRow
              key={c.id}
              claim={c}
              projectPath={projectPath}
              onReportChange={(r) => {
                setReport(r);
                onReportChange?.(r);
              }}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

// -----------------------------------------------------------------------
// Per-claim row with the three-action remediation for Rejected /
// AssumptionOrphaned, plus one-click promotion for Assumption with
// candidatePromotion populated.
// -----------------------------------------------------------------------

function ClaimRow({
  claim,
  projectPath,
  onReportChange,
}: {
  claim: ClaimRecord;
  projectPath: string;
  onReportChange: (r: ValidationReport) => void;
}): React.ReactElement {
  const tag = claim.provenanceMode.mode;
  const reason =
    "reason" in claim.provenanceMode ? claim.provenanceMode.reason : "";

  return (
    <tr
      className={`provenance-row provenance-row--${tag}`}
      data-testid={`claim-row-${claim.id}`}
    >
      <td>
        <code>{claim.id}</code>
      </td>
      <td>{claim.kind}</td>
      <td>
        <span className={`badge badge--${badgeColour(tag)}`}>
          {tag}
          {reason ? `: ${reason}` : ""}
        </span>
      </td>
      <td>
        <code title={claim.anchorHash}>{shortHash(claim.anchorHash)}</code>
      </td>
      <td>
        {claim.extractedEntityCandidates.length === 0 ? (
          <em>—</em>
        ) : (
          <span>
            {claim.extractedEntityCandidates
              .map((c) => `\`${c}\``)
              .join(", ")}
          </span>
        )}
      </td>
      <td>
        {tag === "rejected" && (
          <RemediationButtons
            claim={claim}
            projectPath={projectPath}
            onReportChange={onReportChange}
          />
        )}
        {tag === "assumptionOrphaned" && (
          <span className="provenance-row__hint">
            re-cite or confirm drift
          </span>
        )}
        {tag === "assumption" && claim.candidatePromotion && (
          <PromoteButton
            claimId={claim.id}
            projectPath={projectPath}
            onReportChange={onReportChange}
          />
        )}
      </td>
    </tr>
  );
}

function RemediationButtons({
  claim,
  projectPath,
  onReportChange,
}: {
  claim: ClaimRecord;
  projectPath: string;
  onReportChange: (r: ValidationReport) => void;
}): React.ReactElement {
  return (
    <div
      className="provenance-row__remediation"
      data-testid={`remediation-${claim.id}`}
    >
      <button
        type="button"
        className="btn btn--small"
        onClick={() => openSupplyCitationModal(claim, projectPath, onReportChange)}
      >
        Supply citation
      </button>
      <button
        type="button"
        className="btn btn--small"
        onClick={() => openDowngradeModal(claim, projectPath, onReportChange)}
      >
        Downgrade to ASSUMPTION
      </button>
    </div>
  );
}

function PromoteButton({
  claimId,
  projectPath,
  onReportChange,
}: {
  claimId: string;
  projectPath: string;
  onReportChange: (r: ValidationReport) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="btn btn--small btn--primary"
      data-testid={`promote-${claimId}`}
      onClick={async () => {
        try {
          const result = await invoke<{ report: ValidationReport }>(
            "provenance_promote_assumption",
            {
              projectPath,
              claimId,
              actor: "operator", // Phase 6 stub; Phase 7 wires real workspace identity
            },
          );
          onReportChange(result.report);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[provenance] promote failed", e);
        }
      }}
    >
      Promote to DERIVED
    </button>
  );
}

// -----------------------------------------------------------------------
// Modal launchers — minimal Phase-6 implementation. Real modal chrome
// (form fields, validation) is the desktop's ProvenanceRemediationModal
// component; for Phase 6's first cut we use window.prompt to accept the
// minimum viable inputs so the three-action surface is testable.
// Phase 7's E2E will exercise these via the real modal.
// -----------------------------------------------------------------------

async function openSupplyCitationModal(
  claim: ClaimRecord,
  projectPath: string,
  onReportChange: (r: ValidationReport) => void,
): Promise<void> {
  const source = window.prompt(
    `[${claim.id}] Citation source path (relative to corpus):`,
  );
  if (!source) return;
  const range = window.prompt(
    `[${claim.id}] Line range (e.g. 21-23):`,
  );
  if (!range) return;
  const quote = window.prompt(`[${claim.id}] Quote text:`);
  if (!quote) return;
  const [startStr, endStr] = range.split("-");
  const start = parseInt(startStr ?? "0", 10);
  const end = parseInt(endStr ?? startStr ?? "0", 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    window.alert("Invalid line range");
    return;
  }
  // The UI doesn't compute quote_hash; the server-side command does
  // not currently validate the hash so we pass a placeholder. Real
  // implementation: invoke a `compute_quote_hash` command (deferred).
  const quoteHash = await computeQuoteHash(quote);
  try {
    const newReport = await invoke<ValidationReport>(
      "provenance_supply_citation",
      {
        projectPath,
        claimId: claim.id,
        citation: {
          source,
          lineRange: [start, end],
          quote,
          quoteHash,
        },
      },
    );
    onReportChange(newReport);
  } catch (e) {
    window.alert(`supply_citation failed: ${e}`);
  }
}

async function openDowngradeModal(
  claim: ClaimRecord,
  projectPath: string,
  onReportChange: (r: ValidationReport) => void,
): Promise<void> {
  const owner = window.prompt(
    `[${claim.id}] ASSUMPTION owner (workspace member id):`,
  );
  if (!owner) return;
  const rationale = window.prompt(`[${claim.id}] Rationale:`);
  if (!rationale) return;
  const expiresStr = window.prompt(
    `[${claim.id}] Expires (ISO-8601, default = +30d):`,
    isoPlusDays(30),
  );
  if (!expiresStr) return;
  try {
    const newReport = await invoke<ValidationReport>(
      "provenance_downgrade_to_assumption",
      {
        projectPath,
        claimId: claim.id,
        owner,
        rationale,
        expiresAt: expiresStr,
      },
    );
    onReportChange(newReport);
  } catch (e) {
    window.alert(`downgrade failed: ${e}`);
  }
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function shortHash(h: string): string {
  return h.length > 8 ? `${h.slice(0, 8)}…` : h;
}

function badgeColour(mode: ProvenanceModeTag): string {
  switch (mode) {
    case "derived":
      return "green";
    case "derivedWeak":
      return "yellow";
    case "assumption":
      return "yellow";
    case "assumptionOrphaned":
      return "orange";
    case "rejected":
      return "red";
  }
}

function isoPlusDays(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

/** Compute a SHA-256 hex digest in the browser via Web Crypto. */
async function computeQuoteHash(quote: string): Promise<string> {
  // NFC + collapsed whitespace, matching the Rust quote_hash() (FR-019).
  const normalised = quote.normalize("NFC").trim().replace(/\s+/g, " ");
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
