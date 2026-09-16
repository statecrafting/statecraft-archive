// Spec 121: the acceptance receipt (doc 04 D49). When the post-session gate
// passes on a candidate whose HEAD did not move and whose tree stayed clean
// across the run, the build stage journals a receipt that names what was
// judged: the repository and its base, the candidate revision, the suite
// and its digest, the policy (the folded gate contract and profile) and
// its digest, the verifier that answered, every command's exit code, and
// the policy-sensitive paths the candidate touched. The receipt's authority
// is the journal chain's: its record hash is its identity, and 122's broker
// consumes it before it publishes.

import type { JournalRecord, JsonValue } from "./journal";
import { sha256Hex, stableStringify } from "./journal";

export const RECEIPT_KIND = "acceptance.receipt";
export const UNSTABLE_KIND = "acceptance.unstable";
export const SENSITIVE_KIND = "acceptance.sensitive";
export const RECEIPT_SCHEMA_VERSION = 1;

// The paths a change to which is policy-sensitive (B-5): what judges the
// candidate, or what a session runs under. Recorded, never refused here;
// 123's lifecycle policy decides what a project does with them.
export const POLICY_SENSITIVE_PREFIXES: readonly string[] = [
  "Makefile",
  ".github/workflows/",
  ".claude/",
  ".codex/",
  ".agents/",
  "spec-spine.toml",
  "standards/",
  "scripts/",
];

// A directory entry (trailing slash) matches everything beneath it; a file
// entry matches that file alone.
export function sensitivePathsOf(paths: readonly string[]): string[] {
  return paths.filter((p) =>
    POLICY_SENSITIVE_PREFIXES.some((prefix) => (prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix))
  );
}

export interface ReceiptResult {
  readonly cmd: readonly string[];
  readonly exitCode: number;
}

export interface MintReceiptInput {
  readonly specId: string;
  readonly round: number;
  readonly origin: string | null;
  readonly baseSha: string;
  readonly candidateSha: string;
  readonly branch: string;
  readonly suite: readonly (readonly string[])[];
  // The folded gate contract and profile payloads, as the chain carries them.
  readonly gate: JsonValue;
  readonly profile: JsonValue;
  // What `spec-spine --version` printed, or null when it could not be read.
  readonly specSpineVersion: string | null;
  readonly results: readonly ReceiptResult[];
  readonly changedPaths: readonly string[];
}

export interface Receipt {
  readonly schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  readonly specId: string;
  readonly round: number;
  readonly repo: { readonly origin: string | null; readonly baseSha: string; readonly candidateSha: string; readonly branch: string };
  readonly suite: { readonly commands: readonly (readonly string[])[]; readonly digest: string };
  readonly policy: { readonly gate: JsonValue; readonly profile: JsonValue; readonly digest: string };
  readonly verifier: { readonly specSpine: string | null };
  readonly results: readonly ReceiptResult[];
  readonly sensitivePaths: readonly string[];
  readonly passing: true;
}

export function suiteDigest(suite: readonly (readonly string[])[]): string {
  return sha256Hex(stableStringify(suite.map((cmd) => [...cmd])));
}

export function policyDigest(gate: JsonValue, profile: JsonValue): string {
  return sha256Hex(stableStringify({ gate, profile }));
}

// A receipt is minted only for a passing suite; a red command is not a
// receipt with `passing: false`, it is no receipt (the build evidence
// carries the failure).
export function mintReceipt(input: MintReceiptInput): Receipt {
  if (input.results.some((r) => r.exitCode !== 0)) {
    throw new Error("receipt: a suite with a red command mints no receipt");
  }
  const commands = input.suite.map((cmd) => [...cmd]);
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    specId: input.specId,
    round: input.round,
    repo: { origin: input.origin, baseSha: input.baseSha, candidateSha: input.candidateSha, branch: input.branch },
    suite: { commands, digest: suiteDigest(commands) },
    policy: { gate: input.gate, profile: input.profile, digest: policyDigest(input.gate, input.profile) },
    verifier: { specSpine: input.specSpineVersion },
    results: input.results.map((r) => ({ cmd: [...r.cmd], exitCode: r.exitCode })),
    sensitivePaths: sensitivePathsOf(input.changedPaths),
    passing: true,
  };
}

export function receiptPayload(receipt: Receipt): Record<string, JsonValue> {
  return {
    schemaVersion: receipt.schemaVersion,
    specId: receipt.specId,
    round: receipt.round,
    repo: { origin: receipt.repo.origin, baseSha: receipt.repo.baseSha, candidateSha: receipt.repo.candidateSha, branch: receipt.repo.branch },
    suite: { commands: receipt.suite.commands.map((c) => [...c]), digest: receipt.suite.digest },
    policy: { gate: receipt.policy.gate, profile: receipt.policy.profile, digest: receipt.policy.digest },
    verifier: { specSpine: receipt.verifier.specSpine },
    results: receipt.results.map((r) => ({ cmd: [...r.cmd], exitCode: r.exitCode })),
    sensitivePaths: [...receipt.sensitivePaths],
    passing: true,
  };
}

// --- reading back (B-6) ------------------------------------------------------

export interface FoldedReceipt {
  readonly receipt: Receipt;
  // The journal record's hash: the receipt's identity.
  readonly hash: string;
  readonly seq: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Reads a receipt back from its record; a malformed one is null, never a
// receipt with guessed fields.
export function parseReceipt(payload: JsonValue): Receipt | null {
  if (!isRecord(payload)) return null;
  const repo = payload.repo;
  const suite = payload.suite;
  const policy = payload.policy;
  const verifier = payload.verifier;
  if (
    payload.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
    typeof payload.specId !== "string" ||
    typeof payload.round !== "number" ||
    payload.passing !== true ||
    !isRecord(repo) ||
    typeof repo.baseSha !== "string" ||
    typeof repo.candidateSha !== "string" ||
    typeof repo.branch !== "string" ||
    !isRecord(suite) ||
    !Array.isArray(suite.commands) ||
    typeof suite.digest !== "string" ||
    !isRecord(policy) ||
    typeof policy.digest !== "string" ||
    !isRecord(verifier) ||
    !Array.isArray(payload.results) ||
    !Array.isArray(payload.sensitivePaths)
  ) {
    return null;
  }
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    specId: payload.specId,
    round: payload.round,
    repo: {
      origin: typeof repo.origin === "string" ? repo.origin : null,
      baseSha: repo.baseSha,
      candidateSha: repo.candidateSha,
      branch: repo.branch,
    },
    suite: { commands: (suite.commands as string[][]).map((c) => [...c]), digest: suite.digest },
    policy: { gate: (policy.gate ?? null) as JsonValue, profile: (policy.profile ?? null) as JsonValue, digest: policy.digest },
    verifier: { specSpine: typeof verifier.specSpine === "string" ? verifier.specSpine : null },
    results: (payload.results as { cmd: string[]; exitCode: number }[]).map((r) => ({ cmd: [...r.cmd], exitCode: r.exitCode })),
    sensitivePaths: [...(payload.sensitivePaths as string[])],
    passing: true,
  };
}

// The newest passing receipt for a spec, or null when none was minted.
export function latestReceipt(records: readonly JournalRecord[], specId: string): FoldedReceipt | null {
  let found: FoldedReceipt | null = null;
  for (const record of records) {
    if (record.kind !== RECEIPT_KIND) continue;
    const receipt = parseReceipt(record.payload);
    if (receipt === null || receipt.specId !== specId) continue;
    found = { receipt, hash: record.recordHash, seq: record.seq };
  }
  return found;
}

// A receipt covers a publication of exactly the revision it judged.
export function receiptCovers(receipt: Receipt, headSha: string): boolean {
  return receipt.repo.candidateSha === headSha;
}
