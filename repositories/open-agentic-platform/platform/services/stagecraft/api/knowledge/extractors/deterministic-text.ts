// Spec 115 §5.1 / FR-011 row 1 — text/markdown/json/csv extractor.
//
// Decodes the buffer with a best-effort encoding sniff and returns the body
// as `text` plus a `lineCount` metadatum. No agent involved, ever.

import type { Extractor, ExtractorContext, ExtractorInput } from "./types";
import type { ExtractionOutput } from "../extractionOutput";
import { getObject } from "../storage";
import { countLines, decodeTextBytes } from "./deterministic-text-helpers";

const KIND = "deterministic-text";
const VERSION = "1";
const MAX_BYTES = 50 * 1024 * 1024; // 50MB

const HANDLED_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
]);

async function loadBuffer(input: ExtractorInput): Promise<Buffer> {
  if (input.buffer) return input.buffer;
  return getObject(input.bucket, input.storageKey);
}

export const deterministicTextExtractor: Extractor = {
  kind: KIND,
  version: VERSION,
  maxBytes: MAX_BYTES,
  canHandle(input: ExtractorInput): boolean {
    return HANDLED_MIMES.has(input.mimeType);
  },
  async extract(
    input: ExtractorInput,
    _ctx: ExtractorContext,
  ): Promise<ExtractionOutput> {
    const buf = await loadBuffer(input);
    const text = decodeTextBytes(buf);
    const lineCount = countLines(text);
    const metadata: Record<string, unknown> = {
      lineCount,
      bytesDecoded: buf.length,
      declaredMime: input.mimeType,
    };
    return {
      text,
      metadata,
      extractor: { kind: KIND, version: VERSION },
    };
  },
};
