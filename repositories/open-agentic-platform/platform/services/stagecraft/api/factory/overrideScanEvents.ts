// Spec 200 FR-001 — PubSub topic that drives the override scan worker.
//
// The three `user_body` write sites (artifacts.ts::applyOverrideCore, the
// conflicts.ts `edit_and_accept` arm, agents/catalog.ts create+patch)
// insert a `factory_override_scan_runs` row INSIDE the write transaction,
// then publish the run id here after commit. The subscription worker
// (overrideScanWorker.ts) CAS-transitions queued → running and runs the
// policy gate → model → verdict path. Mirrors the spec 115
// KnowledgeExtractionRequestTopic shape so operators keep one mental model.

import { Topic } from "encore.dev/pubsub";

export interface OverrideScanRequest {
  scanRunId: string;
}

export const OverrideScanRequestTopic = new Topic<OverrideScanRequest>(
  "factory-override-scan-request",
  {
    deliveryGuarantee: "at-least-once",
  },
);
