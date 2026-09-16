// Spec 115 FR-026 — audit action constants for the extraction pipeline.
//
// `audit_log.action` is a free-text column (api/db/schema.ts:275). Existing
// knowledge actions ("knowledge.upload_requested" etc) are inline string
// literals at the call sites. This module centralises the spec-115 actions
// so renames stay grep-able and so dashboards keying on these strings
// can't drift from the writers.

export const KNOWLEDGE_EXTRACTED = "knowledge.extracted" as const;
export const KNOWLEDGE_EXTRACTION_FAILED =
  "knowledge.extraction_failed" as const;
export const KNOWLEDGE_EXTRACTION_RETRY_REQUESTED =
  "knowledge.extraction_retry_requested" as const;
// Spec 120 FR-020 — resolver decision audit when multiple extraction
// records exist for the same `(object_id, content_hash)`.
export const KNOWLEDGE_EXTRACTION_RESOLVED =
  "knowledge.extraction_resolved" as const;
// Spec 143 FR-010 — orphan-imported sweeper Class A audit. Emitted
// when a row in `imported` state past the grace window has no blob
// in S3 (headObject returned 404) and the sweeper deletes it. Class B
// (blob present, no confirm) reuses the existing
// `knowledge.upload_confirmed` action with `metadata.source =
// "orphan_sweep_class_b"` so dashboards see all confirms uniformly.
export const KNOWLEDGE_UPLOAD_ORPHANED =
  "knowledge.upload_orphaned" as const;
// Spec 143 §12 FU-019 — emitted when the worker classifies an
// extraction run as `unsupported_type` because no registered
// extractor's `canHandle` predicate matches the MIME under any
// policy. Distinct from `knowledge.extraction_failed` (which lights
// the red dashboard badge); this action is informational.
export const KNOWLEDGE_UNSUPPORTED_TYPE =
  "knowledge.unsupported_type" as const;

export type KnowledgeExtractionAuditAction =
  | typeof KNOWLEDGE_EXTRACTED
  | typeof KNOWLEDGE_EXTRACTION_FAILED
  | typeof KNOWLEDGE_EXTRACTION_RETRY_REQUESTED
  | typeof KNOWLEDGE_EXTRACTION_RESOLVED
  | typeof KNOWLEDGE_UPLOAD_ORPHANED
  | typeof KNOWLEDGE_UNSUPPORTED_TYPE;
