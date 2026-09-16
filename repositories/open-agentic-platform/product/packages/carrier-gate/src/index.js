// @opc/carrier-gate: canonical carrier-class write-gate rules (spec 204 FR-001).
//
// Imported by both the factory substrate gate (statecraft overrideGate.ts) and
// the session-memory write gate so the carrier-class rule set has one home,
// not two drifting copies. Runtime is plain ESM JS (Node-loadable across the
// Encore boundary); consumer types are in index.d.ts.

export {
  runCarrierGate,
  checkUtf8,
  checkCarriers,
  checkSecrets,
  ENCODED_BLOB_RUN_CHARS,
} from "./rules.js";

export { CARRIER_FIXTURE, CLEAN_FIXTURE } from "./fixture.js";
