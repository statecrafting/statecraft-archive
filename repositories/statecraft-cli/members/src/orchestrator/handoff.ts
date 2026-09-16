// Spec 123: the handoff capsule (doc 04 D55). What a new session in any
// harness needs to resume a spec's work, folded from the journal chains and
// never from a transcript: the repository and candidate revisions, the spec
// and its pin, the policy digest, the posture, the latest receipt, the
// sealed decisions in scope, the outstanding gate diagnostics, the
// remaining allowance, and the prior sessions' driver, classification and
// denials. Printed by a verb, served by a route, and rendered into every
// remediation prompt so a session in either harness starts from the same
// record. Provider resume identifiers stay inside their driver (014 §6).

import type { CostCeiling, SpendFloor } from "./budget";
import { evaluateBudget } from "./budget";
import type { DecisionRecord } from "./decisions";
import { decisionRecordsFromChain, decisionsFor } from "./decisions";
import { foldState, type JournalRecord, type JsonValue } from "./journal";
import { latestReceipt, type Receipt } from "./receipt";

export const CAPSULE_SCHEMA_VERSION = 1;
// The prompt section's bound (B-5): the outstanding tails give way first.
export const CAPSULE_BUDGET_CHARS = 12_000;
const DECISION_BUDGET_CHARS = 6_000;

export interface CapsuleSession {
  readonly driver: string | null;
  readonly classification: string;
  readonly denials: number;
  readonly costMicroUsd: number | null;
}

export interface CapsuleOutstanding {
  readonly cmd: readonly string[];
  readonly exitCode: number;
  readonly stderrTail: string;
}

export interface Capsule {
  readonly schemaVersion: typeof CAPSULE_SCHEMA_VERSION;
  readonly project: { readonly name: string; readonly origin: string | null };
  readonly spec: { readonly id: string; readonly pin: string | null };
  readonly candidate: { readonly branch: string; readonly baseSha: string | null; readonly headSha: string | null } | null;
  readonly policy: { readonly digest: string | null };
  readonly profile: JsonValue | null;
  readonly receipt: { readonly hash: string; readonly candidateSha: string; readonly round: number; readonly sensitivePaths: readonly string[] } | null;
  readonly decisions: readonly DecisionRecord[];
  readonly outstanding: readonly CapsuleOutstanding[];
  readonly allowance: { readonly run: SpendFloor | null; readonly day: SpendFloor | null; readonly ceiling: CostCeiling | null };
  readonly sessions: readonly CapsuleSession[];
}

export interface BuildCapsuleParams {
  // The project's work journal, in order.
  readonly records: readonly JournalRecord[];
  // The decisions chain, in order (empty when none).
  readonly decisions?: readonly JournalRecord[];
  readonly specId: string;
  readonly project: { readonly name: string; readonly origin: string | null };
  readonly ceiling?: CostCeiling | null;
  readonly nowMs?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// B-5: every field is a fold over the chains.
export function buildCapsule(params: BuildCapsuleParams): Capsule {
  const { records, specId } = params;
  // The spec's newest execution, and where in the journal it began.
  let execSeqStart = -1;
  let pin: string | null = null;
  for (const record of records) {
    if (record.kind !== "specexec.created" || !isRecord(record.payload)) continue;
    if (record.payload.specId !== specId) continue;
    execSeqStart = record.seq;
    pin = str(record.payload.pin);
  }

  // The candidate: the bracket names the branch and base, the newest gate
  // or result names the head.
  let candidate: Capsule["candidate"] = null;
  let outstanding: CapsuleOutstanding[] = [];
  let profile: JsonValue | null = null;
  const sessions: CapsuleSession[] = [];
  let lastDriver: string | null = null;
  for (const record of records) {
    if (!isRecord(record.payload)) continue;
    const p = record.payload;
    switch (record.kind) {
      case "stage.build.bracket":
        if (p.specId === specId) candidate = { branch: str(p.branch) ?? specId, baseSha: str(p.baseSha), headSha: str(p.headSha) };
        break;
      case "stage.build.result":
      case "stage.ship.result":
        if (p.specId === specId && candidate !== null && str(p.headSha) !== null) {
          candidate = { branch: candidate.branch, baseSha: candidate.baseSha, headSha: str(p.headSha) };
        }
        break;
      case "stage.build.gate":
        if (p.specId === specId && Array.isArray(p.gates)) {
          outstanding = (p.gates as unknown[])
            .filter((g): g is Record<string, unknown> => isRecord(g) && typeof g.exitCode === "number" && g.exitCode !== 0)
            .map((g) => ({ cmd: Array.isArray(g.cmd) ? (g.cmd as string[]) : [], exitCode: g.exitCode as number, stderrTail: str(g.stderrTail) ?? "" }));
        }
        break;
      case "session.init":
        if (record.seq >= execSeqStart) {
          profile = (p.profile ?? null) as JsonValue;
          lastDriver = isRecord(p.profile) ? (str(p.profile.driver) ?? "claude") : "claude";
        }
        break;
      case "session.result":
        if (record.seq >= execSeqStart && execSeqStart >= 0) {
          sessions.push({
            driver: lastDriver,
            classification: str(p.classification) ?? "unknown",
            denials: typeof p.denials === "number" ? p.denials : 0,
            costMicroUsd: typeof p.costMicroUsd === "number" ? p.costMicroUsd : null,
          });
        }
        break;
      default:
        break;
    }
  }

  const receipt = latestReceipt(records, specId);
  if (receipt !== null && candidate !== null) {
    candidate = { branch: candidate.branch, baseSha: candidate.baseSha, headSha: receipt.receipt.repo.candidateSha };
  }

  // Decisions in scope: the spec's own and any naming its territory.
  const decisionsChain = params.decisions ?? [];
  const decisionRecords = decisionsChain.length === 0 ? [] : decisionRecordsFromChain(foldState(decisionsChain));
  const decisions = decisionsFor({ records: decisionRecords, specId, dependsOnClosure: [], territoryPaths: [], budgetChars: DECISION_BUDGET_CHARS }).included;

  // The allowance: the floors against the ceiling, as the budget sees them.
  const ceiling = params.ceiling ?? null;
  const evaluation = evaluateBudget({ records, ceiling, nowMs: params.nowMs ?? Date.now() });

  return {
    schemaVersion: CAPSULE_SCHEMA_VERSION,
    project: params.project,
    spec: { id: specId, pin },
    candidate,
    policy: { digest: receipt?.receipt.policy.digest ?? null },
    profile,
    receipt:
      receipt === null
        ? null
        : { hash: receipt.hash, candidateSha: receipt.receipt.repo.candidateSha, round: receipt.receipt.round, sensitivePaths: [...receipt.receipt.sensitivePaths] },
    decisions,
    outstanding,
    allowance: { run: evaluation.spend.run, day: evaluation.spend.day, ceiling },
    sessions,
  };
}

export function capsulePayload(capsule: Capsule): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(capsule)) as Record<string, JsonValue>;
}

// B-5: the prompt section, bounded. The outstanding tails give way first,
// then the decisions' rationales; the identifiers never do.
export function renderCapsule(capsule: Capsule, budgetChars: number = CAPSULE_BUDGET_CHARS): string {
  const head: string[] = [
    "## Handoff capsule",
    "",
    `project: ${capsule.project.name}${capsule.project.origin === null ? "" : ` (${capsule.project.origin})`}`,
    `spec: ${capsule.spec.id}${capsule.spec.pin === null ? "" : ` (pin ${capsule.spec.pin})`}`,
    capsule.candidate === null
      ? "candidate: none yet"
      : `candidate: branch ${capsule.candidate.branch}, base ${capsule.candidate.baseSha ?? "?"}, head ${capsule.candidate.headSha ?? "?"}`,
    `policy digest: ${capsule.policy.digest ?? "none"}`,
    `profile: ${capsule.profile === null ? "unknown" : JSON.stringify(capsule.profile)}`,
    capsule.receipt === null
      ? "receipt: none"
      : `receipt: ${capsule.receipt.hash} (round ${capsule.receipt.round}, covers ${capsule.receipt.candidateSha}${
          capsule.receipt.sensitivePaths.length === 0 ? "" : `, sensitive: ${capsule.receipt.sensitivePaths.join(", ")}`
        })`,
    `allowance: run ${floor(capsule.allowance.run)}, day ${floor(capsule.allowance.day)}, ceiling ${ceilingText(capsule.allowance.ceiling)}`,
    capsule.sessions.length === 0
      ? "sessions: none yet"
      : `sessions: ${capsule.sessions.map((s) => `${s.driver ?? "?"}:${s.classification}${s.denials > 0 ? ` (${s.denials} denial(s))` : ""}`).join(", ")}`,
  ];
  const decisionLines =
    capsule.decisions.length === 0
      ? ["decisions: none in scope"]
      : ["decisions:", ...capsule.decisions.map((d) => `  - ${d.id} (${d.specId}): ${d.title}: ${d.decision}`)];
  const outstandingLines =
    capsule.outstanding.length === 0
      ? ["outstanding: nothing red"]
      : ["outstanding:", ...capsule.outstanding.map((o) => `  - \`${o.cmd.join(" ")}\` exited ${o.exitCode}\n    ${o.stderrTail.replace(/\n/g, "\n    ")}`)];

  const fixed = head.join("\n") + "\n";
  let text = `${fixed}${decisionLines.join("\n")}\n${outstandingLines.join("\n")}\n`;
  if (text.length <= budgetChars) return text;
  // Trim the tails first.
  const trimmedOutstanding = capsule.outstanding.map((o) => `  - \`${o.cmd.join(" ")}\` exited ${o.exitCode}`);
  text = `${fixed}${decisionLines.join("\n")}\n${["outstanding (tails omitted for budget):", ...trimmedOutstanding].join("\n")}\n`;
  if (text.length <= budgetChars) return text;
  const shortDecisions = capsule.decisions.map((d) => `  - ${d.id} (${d.specId}): ${d.title}`);
  text = `${fixed}${["decisions (rationale omitted for budget):", ...shortDecisions].join("\n")}\n${["outstanding (tails omitted for budget):", ...trimmedOutstanding].join("\n")}\n`;
  return text.length <= budgetChars ? text : `${text.slice(0, budgetChars - 24)}\n(capsule truncated)\n`;
}

function floor(f: SpendFloor | null): string {
  if (f === null) return "unknown";
  return `${f.knownMicroUsd} micro-USD known over ${f.costKnownSessions} session(s)${f.costUnknownSessions > 0 ? `, ${f.costUnknownSessions} unknown` : ""}`;
}

function ceilingText(c: CostCeiling | null): string {
  if (c === null) return "none";
  const parts: string[] = [];
  if (c.perRunMicroUsd !== undefined) parts.push(`run ${c.perRunMicroUsd}`);
  if (c.perDayMicroUsd !== undefined) parts.push(`day ${c.perDayMicroUsd}`);
  return parts.length === 0 ? "none" : parts.join(", ");
}
