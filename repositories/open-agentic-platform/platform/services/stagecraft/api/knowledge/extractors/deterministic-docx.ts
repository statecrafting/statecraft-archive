// Spec 115 §5.1 / FR-011 row 6 — DOCX extractor.
//
// Uses `mammoth` to convert DOCX to plain text + an outline derived from
// heading runs. Agent fallback only on failure (handled by the worker via
// the dispatcher's retry path; nothing extractor-side).

import type { Extractor, ExtractorContext, ExtractorInput } from "./types";
import type { ExtractionOutput, OutlineEntry } from "../extractionOutput";
import { getObject } from "../storage";

const KIND = "deterministic-docx";
const VERSION = "1";
const MAX_BYTES = 100 * 1024 * 1024; // 100MB

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type MammothExtractRawTextResult = {
  value: string;
  messages: Array<{ type: string; message: string }>;
};

type MammothConvertToHtmlResult = MammothExtractRawTextResult;

async function loadBuffer(input: ExtractorInput): Promise<Buffer> {
  if (input.buffer) return input.buffer;
  return getObject(input.bucket, input.storageKey);
}

async function loadMammoth(): Promise<{
  extractRawText: (args: { buffer: Buffer }) => Promise<MammothExtractRawTextResult>;
  convertToHtml: (args: { buffer: Buffer }) => Promise<MammothConvertToHtmlResult>;
}> {
  const mod = await import("mammoth");
  // mammoth ships either CJS default-exported or as a namespace object.
  const candidate = (mod as { default?: unknown }).default ?? mod;
  return candidate as {
    extractRawText: (a: { buffer: Buffer }) => Promise<MammothExtractRawTextResult>;
    convertToHtml: (a: { buffer: Buffer }) => Promise<MammothConvertToHtmlResult>;
  };
}

const HEADING_RE = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;

function parseOutline(html: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = HEADING_RE.exec(html)) !== null) {
    const level = Number.parseInt(match[1] ?? "1", 10);
    const text = match[2]
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (text.length === 0) continue;
    entries.push({ level, text });
  }
  return entries;
}

export const deterministicDocxExtractor: Extractor = {
  kind: KIND,
  version: VERSION,
  maxBytes: MAX_BYTES,
  canHandle(input: ExtractorInput): boolean {
    if (input.sizeBytes > MAX_BYTES) return false;
    return input.mimeType === DOCX_MIME;
  },
  async extract(
    input: ExtractorInput,
    _ctx: ExtractorContext,
  ): Promise<ExtractionOutput> {
    const buf = await loadBuffer(input);
    const mammoth = await loadMammoth();

    const [textResult, htmlResult] = await Promise.all([
      mammoth.extractRawText({ buffer: buf }),
      mammoth.convertToHtml({ buffer: buf }),
    ]);

    const text = textResult.value ?? "";
    const outline = parseOutline(htmlResult.value ?? "");

    const wordCount = text
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    const metadata: Record<string, unknown> = {
      wordCount,
      mammothMessages: textResult.messages.map((m) => ({
        type: m.type,
        message: m.message,
      })),
    };

    return {
      text,
      outline,
      metadata,
      extractor: { kind: KIND, version: VERSION },
    };
  },
};
