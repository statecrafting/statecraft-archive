// Public type surface for @opc/carrier-gate (spec 204 FR-001).
//
// The runtime lives in rules.js / fixture.js (plain ESM JavaScript so it loads
// unchanged across the Encore service boundary, the pnpm workspace, and plain
// Node). These declarations give TypeScript consumers full types.

/** A refused rule: the id is attributable, the detail is human-facing. */
export interface CarrierRefusal {
  ruleId: string;
  detail: string;
}

/** Verdict of the carrier gate: pass, or the first refused rule. */
export type CarrierVerdict = { ok: true } | ({ ok: false } & CarrierRefusal);

/** A malicious fixture sample and the rule id it must be refused by. */
export interface CarrierSample {
  ruleId: string;
  label: string;
  sample: string;
}

/** Base64-ish runs longer than this are refused as encoded blobs (ASI01 m6). */
export declare const ENCODED_BLOB_RUN_CHARS: number;

/** gate.utf8: refuse lone surrogates. Null if well-formed. */
export declare function checkUtf8(content: string): CarrierRefusal | null;

/** Carrier-class refusals (zero-width/bidi, HTML comment, data URI, encoded blob, ANSI). */
export declare function checkCarriers(content: string): CarrierRefusal | null;

/** CONST-002 secret-shape refusals (PEM, token prefix, JWT). */
export declare function checkSecrets(content: string): CarrierRefusal | null;

/** Full carrier gate: utf8, then carriers, then secrets. First refusal wins. */
export declare function runCarrierGate(content: string): CarrierVerdict;

/** At least one refused sample per shared rule, in gate declaration order (AC-1). */
export declare const CARRIER_FIXTURE: ReadonlyArray<CarrierSample>;

/** Realistic content the gate must NOT refuse. */
export declare const CLEAN_FIXTURE: ReadonlyArray<string>;
