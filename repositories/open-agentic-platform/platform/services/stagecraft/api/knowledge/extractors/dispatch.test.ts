// Spec 115 — pure-logic tests for the extractor dispatcher.
//
// The full end-to-end CAS / sweeper / publish path is exercised in the
// `extractionCore` integration tests under `encore test` (DB-bound).
// These tests pin the dispatch contract (cost-ascending walk + maxBytes
// gate + policy gate) so regressions to FR-011/FR-012/FR-013 fail fast
// without needing the Encore runtime.

import { afterEach, describe, expect, test } from "vitest";
import {
  _resetExtractorsForTesting,
  pickExtractor,
  pickExtractorVersion,
  registerExtractor,
} from "./dispatch";
import type { Extractor } from "./types";
import type { ExtractionPolicy } from "../extractionPolicy";
import type { ExtractionOutput } from "../extractionOutput";
import type { ExtractorInput } from "./types";

const POLICY: ExtractionPolicy = {
  visionAllowed: false,
  audioAllowed: false,
  costCeilingUsdPerCall: 0,
  costCeilingUsdPerDay: 0,
  source: "default_fallback",
};

function fakeExtractor(args: {
  kind: string;
  version?: string;
  maxBytes?: number;
  predicate: (input: ExtractorInput, policy: ExtractionPolicy) => boolean;
}): Extractor {
  return {
    kind: args.kind,
    version: args.version ?? "1",
    maxBytes: args.maxBytes ?? 1024 * 1024,
    canHandle: args.predicate,
    extract: async (): Promise<ExtractionOutput> => ({
      text: "ignored — never called in dispatch tests",
      metadata: {},
      extractor: { kind: args.kind, version: args.version ?? "1" },
    }),
  };
}

function fakeInput(args: Partial<ExtractorInput> = {}): ExtractorInput {
  return {
    knowledgeObjectId: "ko-1",
    projectId: "proj-1",
    filename: "doc.txt",
    mimeType: "text/plain",
    sizeBytes: 1000,
    contentHash: "h",
    buffer: null,
    downloadUrl: "",
    bucket: "ws-1-bucket",
    storageKey: "knowledge/ko-1/doc.txt",
    ...args,
  };
}

describe("pickExtractor", () => {
  afterEach(() => _resetExtractorsForTesting());

  test("returns null when registry is empty", () => {
    expect(pickExtractor(fakeInput(), POLICY)).toBeNull();
  });

  test("picks the first extractor whose predicate matches", () => {
    registerExtractor(
      fakeExtractor({
        kind: "first",
        predicate: (i) => i.mimeType === "text/plain",
      }),
    );
    registerExtractor(
      fakeExtractor({
        kind: "second",
        predicate: () => true, // would match too, but order wins
      }),
    );
    const result = pickExtractor(
      fakeInput({ mimeType: "text/plain" }),
      POLICY,
    );
    expect(result?.kind).toBe("first");
  });

  test("walks past extractors whose predicate returns false", () => {
    registerExtractor(
      fakeExtractor({
        kind: "pdf-only",
        predicate: (i) => i.mimeType === "application/pdf",
      }),
    );
    registerExtractor(
      fakeExtractor({
        kind: "text-only",
        predicate: (i) => i.mimeType === "text/plain",
      }),
    );
    const result = pickExtractor(
      fakeInput({ mimeType: "text/plain" }),
      POLICY,
    );
    expect(result?.kind).toBe("text-only");
  });

  test("walks past extractors whose maxBytes ceiling is exceeded (FR-013)", () => {
    registerExtractor(
      fakeExtractor({
        kind: "small-only",
        maxBytes: 500,
        predicate: () => true,
      }),
    );
    registerExtractor(
      fakeExtractor({
        kind: "any-size",
        maxBytes: Number.MAX_SAFE_INTEGER,
        predicate: () => true,
      }),
    );
    const result = pickExtractor(fakeInput({ sizeBytes: 1000 }), POLICY);
    expect(result?.kind).toBe("any-size");
  });

  test("policy can disqualify an extractor via canHandle", () => {
    registerExtractor(
      fakeExtractor({
        kind: "vision-required",
        predicate: (_i, p) => p.visionAllowed,
      }),
    );
    expect(pickExtractor(fakeInput(), POLICY)).toBeNull();
    const visionPolicy = { ...POLICY, visionAllowed: true };
    const result = pickExtractor(fakeInput(), visionPolicy);
    expect(result?.kind).toBe("vision-required");
  });
});

describe("pickExtractorVersion", () => {
  afterEach(() => _resetExtractorsForTesting());

  test("returns the placeholder when no extractor matches", () => {
    const result = pickExtractorVersion(fakeInput(), POLICY);
    expect(result.kind).toBe("unresolved");
    expect(result.version).toBe("unresolved");
  });

  test("returns the matched extractor's kind+version", () => {
    registerExtractor(
      fakeExtractor({
        kind: "deterministic-text",
        version: "v3",
        predicate: () => true,
      }),
    );
    const result = pickExtractorVersion(fakeInput(), POLICY);
    expect(result).toEqual({ kind: "deterministic-text", version: "v3" });
  });
});
