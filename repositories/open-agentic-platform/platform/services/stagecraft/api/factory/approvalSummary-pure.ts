/**
 * Spec 201 FR-001 — the `ApprovalSummary` contract: a typed, fact-grounded
 * approval basis assembled from recorded substrate state, never from model
 * output. The hash recorded in the audit row (FR-004) lets the certificate
 * chain prove what the approver saw, not just that they clicked.
 *
 * Pure half: shape + assembly over already-fetched facts + hash rules.
 * Split out from `approvalSummary.ts` so unit tests can exercise assembly
 * and hash stability without loading the Encore runtime (which the DB
 * wrapper needs). Same pattern as `signing-pure.ts` / `patCrypto-pure.ts`.
 */

import { sha256Hex } from "./substrate";
import type { AdmissionEvaluation } from "./admission";

/**
 * The reserved gate-predicate id for the override-verify surface. The
 * obligation that surface ratifies — the org's filed override-consumption
 * policy — is declared by the admitted envelope's `overrides:` section
 * rather than `gates[]` (spec 201 amendment 2026-06-11).
 */
export const OVERRIDE_VERIFICATION_PREDICATE = "overrides.require_verified";

// Interfaces (not type aliases): these cross the Encore wire boundary in
// `ArtifactApprovalSummaryResponse`, and Encore's static analysis accepts
// named interface types only.
export interface ApprovalProvenanceLink {
  artifactId: string;
  contentHash: string;
  kind: string;
  path: string;
}

export interface ApprovalConsumedOverride {
  artifactId: string;
  contentHash: string;
  path: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  requireVerifiedSatisfied: boolean;
}

export interface ApprovalSummary {
  /** sha256 over the hashed field set — every field below except
   * `summaryHash` itself and `assembledAt` (FR-001 rule 3: the timestamp
   * is outside the hash so the FR-003 (b) replay guard can compare a
   * fresh assembly across page loads and AC-4 can recompute from DB
   * state alone). */
  summaryHash: string;
  gatePredicate: string;
  blastRadiusStatement: string;
  provenanceLinks: ApprovalProvenanceLink[];
  consumedOverrides: ApprovalConsumedOverride[];
  assembledAt: string;
  actorId: string;
}

export type ApprovalSummaryResult =
  | { ok: true; summary: ApprovalSummary }
  | { ok: false; reason: string };

/** Admission facts the assembly consumes — the wrapper feeds these from
 * `isFactoryAdmitted` + `loadLatestAdmission`. */
export type AdmissionFacts = {
  admitted: boolean;
  /** Refusal reason when not admitted (revocation, refused, unevaluated). */
  reason: string | null;
  envelopeHash: string | null;
  composed: AdmissionEvaluation["composed"];
};

/** Substrate-row slice for provenance rows (governance-envelope +
 * adapter-manifest kinds) and consumed-override rows. */
export type ProvenanceRowFacts = {
  id: string;
  path: string;
  kind: string;
  contentHash: string;
};

export type OverrideRowFacts = {
  id: string;
  path: string;
  contentHash: string;
  userBodyVerified: boolean;
  verifiedBy: string | null;
  verifiedAt: Date | null;
};

export type ApprovalSummaryFacts = {
  gatePredicate: string;
  actorId: string;
  /** Injected clock (ISO-8601) — the only non-DB-derived value (FR-001). */
  assembledAt: string;
  admission: AdmissionFacts;
  provenanceRows: ProvenanceRowFacts[];
  overrideRows: OverrideRowFacts[];
};

/**
 * FR-001 assembly over already-fetched facts. Deterministic: same facts
 * (regardless of `assembledAt`) produce the same `summaryHash`. Returns
 * `ok: false` whenever a required field cannot be assembled from recorded
 * facts — callers refuse to render an approve control on that (FR-002).
 */
export function assembleApprovalSummaryFromFacts(
  facts: ApprovalSummaryFacts,
): ApprovalSummaryResult {
  const { admission } = facts;

  if (!admission.admitted) {
    return {
      ok: false,
      reason:
        admission.reason ??
        "factory is not admitted — no approval basis exists (spec 201 FR-001)",
    };
  }
  const process = admission.composed?.process;
  if (!process) {
    return {
      ok: false,
      reason:
        "admission record carries no composed envelope — re-sync to " +
        "re-admit (spec 201 FR-001)",
    };
  }

  // gatePredicate must be declared by the admitted envelope (or be the
  // reserved override-verification id) — never a free label.
  const declared = process.gates.map((g) => g.predicate);
  if (
    facts.gatePredicate !== OVERRIDE_VERIFICATION_PREDICATE &&
    !declared.includes(facts.gatePredicate)
  ) {
    return {
      ok: false,
      reason:
        `gate predicate '${facts.gatePredicate}' is not declared by the ` +
        `admitted envelope (declared: ${declared.join(", ") || "(none)"}) — ` +
        `spec 201 FR-001`,
    };
  }

  // Provenance: the admitted envelope's own row must still be present at
  // the admitted hash; every admitted adapter manifest likewise. A
  // mismatch means the substrate moved since admission — fail closed.
  const envelopeRow = facts.provenanceRows.find(
    (r) =>
      r.kind === "governance-envelope" &&
      r.contentHash === admission.envelopeHash,
  );
  if (!envelopeRow) {
    return {
      ok: false,
      reason:
        "admitted envelope hash is no longer present in the substrate — " +
        "the factory content moved since admission; re-sync to re-admit " +
        "(spec 201 FR-001)",
    };
  }
  const provenanceLinks: ApprovalProvenanceLink[] = [toLink(envelopeRow)];
  const adapters = admission.composed?.adapters ?? {};
  for (const name of Object.keys(adapters).sort()) {
    const manifestRow = facts.provenanceRows.find(
      (r) =>
        r.kind === "adapter-manifest" &&
        r.contentHash === adapters[name].manifestHash,
    );
    if (!manifestRow) {
      return {
        ok: false,
        reason:
          `admitted adapter '${name}' manifest hash is no longer present ` +
          `in the substrate — re-sync to re-admit (spec 201 FR-001)`,
      };
    }
    provenanceLinks.push(toLink(manifestRow));
  }

  const requireVerified = process.overrides.require_verified === true;
  const consumedOverrides: ApprovalConsumedOverride[] = facts.overrideRows.map(
    (r) => ({
      artifactId: r.id,
      contentHash: r.contentHash,
      path: r.path,
      verifiedBy: r.verifiedBy,
      verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
      requireVerifiedSatisfied: !requireVerified || r.userBodyVerified,
    }),
  );

  const blastRadiusStatement = buildBlastRadiusStatement(
    facts.gatePredicate,
    adapters,
    process.emits.map((e) => e.kind),
    consumedOverrides.length,
  );

  const hashedFields = {
    gatePredicate: facts.gatePredicate,
    blastRadiusStatement,
    provenanceLinks,
    consumedOverrides,
    actorId: facts.actorId,
  };

  return {
    ok: true,
    summary: {
      summaryHash: sha256Hex(JSON.stringify(hashedFields)),
      ...hashedFields,
      assembledAt: facts.assembledAt,
    },
  };
}

/**
 * Recompute a summary's hash from its own fields (AC-4: deterministic from
 * recorded state; `summaryHash` and `assembledAt` are outside the set).
 */
export function computeApprovalSummaryHash(
  summary: Omit<ApprovalSummary, "summaryHash" | "assembledAt">,
): string {
  return sha256Hex(
    JSON.stringify({
      gatePredicate: summary.gatePredicate,
      blastRadiusStatement: summary.blastRadiusStatement,
      provenanceLinks: summary.provenanceLinks,
      consumedOverrides: summary.consumedOverrides,
      actorId: summary.actorId,
    }),
  );
}

/**
 * Spec 201 phase 3 — deterministic run-gate predicate selection. OAP never
 * models predicate→stage binding (spec 198 P-2: that is run topology, the
 * engine's domain), so the run surface records a deterministically-chosen
 * declared predicate: the first declared `gates[].predicate` containing
 * "approval", else the first declared. Returns null when the envelope
 * declares no gates — the surface fails closed (nothing to ratify).
 */
export function pickRunGatePredicate(declared: string[]): string | null {
  if (declared.length === 0) return null;
  return declared.find((p) => p.includes("approval")) ?? declared[0];
}

/** Plain language from envelope facts only — no model inference (FR-001). */
function buildBlastRadiusStatement(
  gatePredicate: string,
  adapters: Record<string, { governance: { file_write_scope: string[] } }>,
  emitKinds: string[],
  overrideCount: number,
): string {
  const adapterNames = Object.keys(adapters).sort();
  const scopeClauses = adapterNames.map((name) => {
    const scopes = adapters[name].governance.file_write_scope;
    return `adapter '${name}' may write within: ${scopes.join(", ")}`;
  });
  const parts = [
    `Ratifying '${gatePredicate}' authorises a run where ` +
      (scopeClauses.length > 0
        ? scopeClauses.join("; ")
        : "no adapter declares a file write scope"),
    `the run emits artifact kinds: ${emitKinds.join(", ") || "(none declared)"}`,
    overrideCount === 0
      ? "no per-org content overrides are in scope"
      : `${overrideCount} per-org content override(s) are in scope`,
  ];
  return `${parts.join(". ")}.`;
}

function toLink(row: ProvenanceRowFacts): ApprovalProvenanceLink {
  return {
    artifactId: row.id,
    contentHash: row.contentHash,
    kind: row.kind,
    path: row.path,
  };
}
