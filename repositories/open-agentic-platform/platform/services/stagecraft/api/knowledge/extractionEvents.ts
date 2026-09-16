// Spec 115 FR-001 — PubSub topic that drives the extraction worker.
//
// `confirmUpload` and connector sync insert a `knowledge_extraction_runs`
// row at `pending`, then publish the run id here. The subscription worker
// (extractionWorker.ts) loads the row, CAS-transitions pending → running,
// and runs the dispatcher → extractor → typed-output write. Mirrors the
// spec 114 ProjectCloneRequestTopic shape verbatim so operators reading
// the queue keep one mental model.

import { Topic } from "encore.dev/pubsub";

export interface KnowledgeExtractionRequest {
  extractionRunId: string;
}

export const KnowledgeExtractionRequestTopic =
  new Topic<KnowledgeExtractionRequest>("knowledge-extraction-request", {
    deliveryGuarantee: "at-least-once",
  });
