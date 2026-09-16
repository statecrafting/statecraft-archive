// Spec 115 FR-015 — single interface every extractor implements.
//
// Adding a new extractor is one new file under `extractors/` plus a row
// in `dispatch.ts` — no edits to `extractionWorker.ts` or
// `extractionCore.ts` (FR-012).

import type { ExtractionOutput, TokenSpend } from "../extractionOutput";
import type { ExtractionPolicy } from "../extractionPolicy";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Bytes-and-metadata view of a knowledge_objects row that the worker hands
 * to an extractor. The worker owns S3 access; extractors receive a
 * presigned download URL OR a buffer (worker decides per extractor — small
 * objects are loaded eagerly, large objects stream via the URL).
 */
export type ExtractorInput = {
  knowledgeObjectId: string;
  /** Spec 119: knowledge objects are project-scoped. */
  projectId: string;
  filename: string;
  // Mime type AFTER magic-number sniff (FR-014). Trustworthy.
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  /**
   * Eagerly-loaded bytes. Set when sizeBytes is below the worker's eager
   * threshold; null when the extractor must stream from `downloadUrl`.
   */
  buffer: Buffer | null;
  /**
   * Presigned S3 URL valid for the duration of the run. Always set so
   * extractors can fall back to streaming if the buffer is null OR if
   * they need ranged access (e.g. PDF page-by-page).
   */
  downloadUrl: string;
  /**
   * Project S3 bucket name. Extractors that need ranged or large reads
   * use `loadBytes(bucket, storageKey)` against the in-process storage
   * helper rather than re-deriving credentials from the presigned URL.
   */
  bucket: string;
  /** S3 object key inside `bucket`. */
  storageKey: string;
};

// ---------------------------------------------------------------------------
// Logger (structural type — avoids hard-coupling to encore.dev/log so tests
// can pass a mock)
// ---------------------------------------------------------------------------

export type ExtractorLogger = {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

// ---------------------------------------------------------------------------
// Token-spend reporter
// ---------------------------------------------------------------------------

/**
 * Agent extractors call this once per model invocation. The worker
 * accumulates the spend and writes it to
 * `knowledge_extraction_runs.token_spend` on completion. Deterministic
 * extractors never call it.
 */
export type TokenSpendReporter = (spend: TokenSpend, costUsd: number) => void;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * What an extractor receives at invocation time. Deterministic extractors
 * use only `policy`, `log`. Agent extractors additionally use
 * `anthropicClient` and `reportTokenSpend`.
 */
export type ExtractorContext = {
  policy: ExtractionPolicy;
  log: ExtractorLogger;
  reportTokenSpend: TokenSpendReporter;
  /**
   * Set only for agent-kind extractors. Phase 0 carries it as `unknown`;
   * Phase 2 (spec 115 task T048) replaces this with the real
   * `@anthropic-ai/sdk` client type. Deterministic extractors MUST NOT
   * read this field.
   */
  anthropicClient?: unknown;
};

// ---------------------------------------------------------------------------
// Extractor interface
// ---------------------------------------------------------------------------

export interface Extractor {
  readonly kind: string;
  readonly version: string;
  /** Hard cap; objects above this size route to the next eligible extractor (FR-013). */
  readonly maxBytes: number;

  /**
   * Pure predicate. MUST NOT mutate state, MUST NOT issue network calls.
   * Called by the dispatcher to decide whether this extractor can handle
   * the input under the given policy.
   */
  canHandle(input: ExtractorInput, policy: ExtractionPolicy): boolean;

  /**
   * Run the extraction. Returns a typed payload that the worker will
   * validate via `validateExtractionOutput` before persisting.
   *
   * Throw to fail the run. The worker maps thrown errors to
   * `error.code = "extractor_failed"` unless the throw is a typed
   * `ExtractorError` carrying its own code.
   */
  extract(input: ExtractorInput, ctx: ExtractorContext): Promise<ExtractionOutput>;
}

// ---------------------------------------------------------------------------
// Typed extractor errors
// ---------------------------------------------------------------------------

/**
 * Extractors throw this (instead of bare Error) when they want to surface
 * a specific error code on the run row and `lastExtractionError`. Untyped
 * throws map to `extractor_failed` with the message preserved.
 */
export class ExtractorError extends Error {
  readonly code: string;
  readonly extractorKind: string;
  readonly retriable: boolean;

  constructor(args: {
    code: string;
    extractorKind: string;
    message: string;
    retriable?: boolean;
  }) {
    super(args.message);
    this.code = args.code;
    this.extractorKind = args.extractorKind;
    this.retriable = args.retriable ?? false;
  }
}
