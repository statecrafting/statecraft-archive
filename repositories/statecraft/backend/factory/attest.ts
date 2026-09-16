/**
 * Attestation payload for a factory stamp (spec 005 §3 step 3; spec 008).
 *
 * After the born-with cert is built, the pipeline records an attestation to the
 * governance ledger carrying the cert's hash, so the repo-local cert and the
 * platform ledger are mutually checkable (enrahitu spec 012 §4). The payload
 * shape is built here as a pure function so it is unit-testable without the
 * Encore runtime; `pipeline.ts` owns the actual `governance.record` call (the IO
 * boundary, which imports the generated client and is exercised by the manual
 * E2E, not unit tests).
 *
 * The create-vs-adopt distinction lives in this payload (and on `StampJob.mode`),
 * NOT in the born-with cert: the cert stays schema-identical with
 * `stampedBy.kind: "factory"` because the factory genuinely performs the stamp in
 * both modes, and its two claims (stamped-from + posture) hold regardless of
 * whether the target repo pre-existed. The ledger record is the richer surface
 * that also remembers the mode.
 */
import type { Posture, StampMode } from "./entities";

export const STAMP_MODES: readonly StampMode[] = ["create", "adopt"];

/** Runtime guard for the request-supplied stamp mode. */
export function isStampMode(value: string): value is StampMode {
  return (STAMP_MODES as readonly string[]).includes(value);
}

export interface StampAttestationInput {
  mode: StampMode;
  appName: string;
  org: string;
  /** Full 40-hex SHA of the enrahitu commit stamped from. */
  templateCommit: string;
  contractVersion: string;
  posture: Posture;
}

/** The ledger subject id for a stamp: `<org>/<appName>`. */
export function stampSubject(input: Pick<StampAttestationInput, "org" | "appName">): string {
  return `${input.org}/${input.appName}`;
}

/** The full attestation payload whose keysorted sha256 the ledger records as payloadHash. */
export function stampAttestationPayload(input: StampAttestationInput): Record<string, unknown> {
  return {
    mode: input.mode,
    appName: input.appName,
    org: input.org,
    templateCommit: input.templateCommit,
    contractVersion: input.contractVersion,
    posture: input.posture,
  };
}
