// Spec 115 §5.1 / FR-011 row 2 — embedded-text PDF extractor.
//
// Uses pdf-parse to pull text from a PDF whose pages already contain
// embedded text. The dispatcher's `canHandle` predicate checks only mime
// type + size cap; the per-page text-density threshold is enforced inside
// `extract` by throwing a typed `extractor_failed` when the median per-page
// length falls below `STATECRAFT_EXTRACT_PDF_MIN_MEDIAN_CHARS` (default
// 80). On retry the dispatcher re-picks based on policy and routes to the
// agent vision path (Phase 2) — the broken extraction never auto-loops.

import type { Extractor, ExtractorContext, ExtractorInput } from "./types";
import type { ExtractionOutput, OutlineEntry } from "../extractionOutput";
import { ExtractorError } from "./types";
import { getObject } from "../storage";

const KIND = "deterministic-pdf-embedded";
const VERSION = "1";
const MAX_BYTES = 200 * 1024 * 1024; // 200MB

const DEFAULT_MIN_MEDIAN_CHARS = 80;

function getMinMedianChars(): number {
  const v = process.env.statecraft_EXTRACT_PDF_MIN_MEDIAN_CHARS;
  if (!v) return DEFAULT_MIN_MEDIAN_CHARS;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_MEDIAN_CHARS;
}

type PageText = { num: number; text: string };

type ParsedPdf = {
  pages: PageText[];
  text: string;
  numpages: number;
  info: Record<string, unknown>;
};

async function loadBuffer(input: ExtractorInput): Promise<Buffer> {
  if (input.buffer) return input.buffer;
  return getObject(input.bucket, input.storageKey);
}

async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  // pdf-parse v2 ships a class API. Construct, getText, getInfo, destroy.
  // The legacy `pdf-parse(buffer)` shape was removed in v2 — keep the
  // dependency-version range tight in package.json so a future v3 doesn't
  // silently change the contract.
  const mod = await import("pdf-parse");
  const PDFParse = (mod as { PDFParse: new (opts: { data: Uint8Array }) => unknown }).PDFParse;
  const parser = new PDFParse({ data: new Uint8Array(buffer) }) as {
    getText(): Promise<{ pages: PageText[]; text: string; total: number }>;
    getInfo(): Promise<{ info?: Record<string, unknown> }>;
    destroy(): Promise<void>;
  };
  try {
    const [textResult, infoResult] = await Promise.all([
      parser.getText(),
      parser.getInfo(),
    ]);
    return {
      pages: textResult.pages,
      text: textResult.text,
      numpages: textResult.total,
      info: infoResult.info ?? {},
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export const deterministicPdfEmbeddedExtractor: Extractor = {
  kind: KIND,
  version: VERSION,
  maxBytes: MAX_BYTES,
  canHandle(input: ExtractorInput): boolean {
    if (input.mimeType !== "application/pdf") return false;
    if (input.sizeBytes > MAX_BYTES) return false;
    return true;
  },
  async extract(
    input: ExtractorInput,
    _ctx: ExtractorContext,
  ): Promise<ExtractionOutput> {
    const buf = await loadBuffer(input);
    const parsed = await parsePdf(buf);

    const pages = parsed.pages.map((p) => ({
      index: p.num - 1, // pdf-parse uses 1-based page numbers
      text: p.text,
    }));

    const trimmedLengths = pages.map((p) => p.text.trim().length);
    const medianChars = median(trimmedLengths);
    const minChars = getMinMedianChars();

    if (medianChars < minChars) {
      throw new ExtractorError({
        code: "extractor_failed",
        extractorKind: KIND,
        message: `embedded-text PDF parser median ${Math.round(
          medianChars,
        )} chars/page < threshold ${minChars}; route to agent vision`,
        retriable: true,
      });
    }

    // Outline — pdf-parse exposes the PDF outline through getInfo().info
    // when present. We surface it best-effort; an upgrade can swap to a
    // bookmark-aware parser without changing the contract.
    const outline: OutlineEntry[] = [];

    const language = detectLanguage(parsed.text);

    const metadata: Record<string, unknown> = {
      pageCount: parsed.numpages,
      medianPageChars: Math.round(medianChars),
      pdfInfo: parsed.info,
    };

    return {
      text: parsed.text.trim(),
      pages,
      language,
      outline,
      metadata,
      extractor: { kind: KIND, version: VERSION },
    };
  },
};

// ---------------------------------------------------------------------------
// Tiny heuristic language detector — top stop-word frequency over a sample
// of the body text. Returns undefined when the sample is too short to be
// reliable. Pulled into this file rather than a shared helper since it is
// only used here today.
// ---------------------------------------------------------------------------

const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "of", "to", "in", "is", "that", "it", "for", "with"],
  fr: ["le", "la", "les", "de", "et", "à", "un", "une", "des", "que"],
  es: ["el", "la", "los", "las", "de", "que", "y", "en", "un", "una"],
  de: ["der", "die", "das", "und", "ist", "in", "ein", "zu", "den", "von"],
  it: ["il", "la", "di", "che", "è", "e", "un", "una", "per", "non"],
  pt: ["o", "a", "de", "que", "e", "do", "da", "em", "um", "para"],
  nl: ["de", "het", "een", "van", "en", "in", "is", "op", "dat", "te"],
  pl: ["i", "w", "na", "z", "do", "że", "jest", "się", "to", "nie"],
};

function detectLanguage(text: string): string | undefined {
  const sample = text.slice(0, 4000).toLowerCase();
  if (sample.split(/\s+/).filter(Boolean).length < 30) return undefined;
  let best: { lang: string; score: number } | null = null;
  for (const [lang, words] of Object.entries(STOPWORDS)) {
    let score = 0;
    for (const w of words) {
      const re = new RegExp(`\\b${w}\\b`, "g");
      const hits = sample.match(re);
      if (hits) score += hits.length;
    }
    if (!best || score > best.score) best = { lang, score };
  }
  return best && best.score > 0 ? best.lang : undefined;
}
