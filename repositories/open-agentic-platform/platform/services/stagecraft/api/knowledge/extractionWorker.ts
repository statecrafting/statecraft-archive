// Spec 115 §5 / FR-004 — PubSub subscriber that drives the extraction worker.
//
// At-least-once delivery: the handler MUST be idempotent. CAS on
// `pending → running` happens inside `runExtractionWork`, so a redelivered
// message that finds the row already terminal is a no-op (FR-005).

import { Subscription } from "encore.dev/pubsub";
import log from "encore.dev/log";
import { runExtractionWork } from "./extractionCore";
import {
  KnowledgeExtractionRequestTopic,
  type KnowledgeExtractionRequest,
} from "./extractionEvents";
// Side-effect import: registers every deterministic / agent extractor
// into the dispatch table before any message can arrive.
import "./extractors";

async function handleExtractionRequest(
  req: KnowledgeExtractionRequest,
): Promise<void> {
  try {
    await runExtractionWork({ extractionRunId: req.extractionRunId });
  } catch (err) {
    // runExtractionWork already converts known throws into `failed` rows.
    // Anything that escapes is a bug — log loudly so the operator can
    // investigate, and re-throw so PubSub redelivery can retry once.
    // The auto-retry cap inside runExtractionWork stops the loop.
    log.error("extractionWorker: unhandled exception in handler", {
      runId: req.extractionRunId,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// Encore parses Subscription config at build time and only accepts literal
// integers for `maxConcurrency`. The literal here bounds parallel extraction
// fan-out so file-body buffers loaded by `getObject` (extractionCore.ts:796)
// stay within V8's old-space ceiling under FR-006 batch load. Per-run CAS
// and the day-aggregate cost gate dedupe and cap spend respectively, but
// neither bounds parallel-batch memory. See spec 143 §13 2026-05-10 ~07:48
// UTC for budget math and the value justification (FU-015).
const _extractionWorker = new Subscription(
  KnowledgeExtractionRequestTopic,
  "knowledge-extraction-worker",
  {
    handler: handleExtractionRequest,
    maxConcurrency: 4,
  },
);
void _extractionWorker;
