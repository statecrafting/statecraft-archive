/**
 * Typed facade over the `@statecrafting/governance-native` napi-rs addon
 * (spec 008; the addon itself is statecrafting spec 005).
 *
 * The addon is a CJS napi module; default-import then treat it as the typed
 * surface below. These interfaces mirror the `#[napi(object)]` structs the
 * addon exports; the published package's own `index.d.ts` supersedes them.
 */
import governanceNative from "@statecrafting/governance-native";

/** `{ canonical, sha256 }` for a JSON document (sha256 is bare lowercase hex). */
export interface CanonicalResult {
  canonical: string;
  sha256: string;
}

/** `{ seq, recordHash, chainHash }` after an append. */
export interface AppendResult {
  seq: number;
  recordHash: string;
  chainHash: string;
}

/** `{ ok, seq, error? }` from an independent chain verification. */
export interface VerifyResult {
  ok: boolean;
  seq: number;
  error?: string;
}

export type GateOutcome = "allow" | "deny" | "degrade";

/** A gate decision plus the gate's stable config hash. */
export interface GateResult {
  outcome: GateOutcome;
  reason: string;
  checkIds: string[];
  blocking: boolean;
  configHash: string;
}

export type TrustLevel = "full" | "restricted" | "read-only" | "suspended";

/** `{ level, score }` for a trust snapshot. */
export interface TrustLevelResult {
  level: TrustLevel;
  score: number;
}

interface GovernanceNative {
  canonicalize(json: string): CanonicalResult;
  ledgerAppend(stateDir: string, record: string): AppendResult;
  ledgerVerify(stateDir: string): VerifyResult;
  ledgerAnchor(stateDir: string, keyRef: string): string;
  gateEvaluate(configJson: string, actionContextJson: string): GateResult;
  trustSample(snapshotJson: string | null, sampleJson: string): string;
  trustLevel(snapshotJson: string): TrustLevelResult;
}

const native = governanceNative as unknown as GovernanceNative;

export default native;
