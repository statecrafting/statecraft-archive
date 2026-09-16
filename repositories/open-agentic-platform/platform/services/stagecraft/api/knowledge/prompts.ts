// Spec 115 FR-020 — versioned, fingerprintable prompt registry for agent
// extractors. Inline string-literal prompts inside `extractors/agent-*.ts`
// are forbidden; every agent extractor MUST import its prompt from this
// module so `promptFingerprint = sha256(template + key params)` is
// reproducible across runs.
//
// In a future upgrade this can be replaced by the `@opc/prompt-assembly`
// package (spec 070). The interface here mirrors what the assembly cache
// would expose so the swap is mechanical: `getExtractionPrompt(kind)`
// returns `{ system, fingerprint, version }`.

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
//
// Each entry's `system` text is the cache-friendly prefix Anthropic will
// hash for prompt-cache hits; the per-call `user` payload (image bytes /
// PDF bytes / audio bytes) is the variable part. Bumping `version` on
// content edit changes the fingerprint, which is what audit reviewers
// pivot on.

type PromptTemplate = {
  kind: string;
  version: string;
  system: string;
};

const TEMPLATES: Record<string, PromptTemplate> = {
  "knowledge-extract.agent-pdf-vision": {
    kind: "knowledge-extract.agent-pdf-vision",
    version: "1",
    system: [
      "You extract the textual content of a PDF page image with high fidelity.",
      "Rules:",
      "  1. Output the text exactly as it appears, preserving paragraph breaks.",
      "  2. Do NOT summarise, translate, or interpret.",
      "  3. Do NOT include any commentary, headers, or markdown formatting beyond what the page itself shows.",
      "  4. Tables: emit row-major plaintext with cells separated by ' | '. Headers on the first row.",
      "  5. Mathematical notation: use Unicode where unambiguous, otherwise plain ASCII.",
      "  6. If a region is illegible, write '[illegible]' inline rather than omitting it.",
      "  7. If the page is blank or pure decoration, output the literal string '[blank]'.",
      "Return ONLY the page text. No XML, no JSON, no preamble.",
    ].join("\n"),
  },
  "knowledge-extract.agent-image-vision": {
    kind: "knowledge-extract.agent-image-vision",
    version: "1",
    system: [
      "You extract the textual content of a single image with high fidelity.",
      "Rules:",
      "  1. Output the visible text exactly as it appears, preserving line breaks where meaningful.",
      "  2. Do NOT summarise, translate, or interpret.",
      "  3. If the image is a screenshot of a document, treat it as a page (paragraph-preserving plaintext).",
      "  4. If the image is a photograph with no text, return the literal string '[no_text]'.",
      "  5. If text exists but is illegible, return '[illegible]'.",
      "Return ONLY the extracted text. No commentary, no JSON.",
    ].join("\n"),
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AssembledPrompt = {
  kind: string;
  version: string;
  system: string;
  fingerprint: string;
};

function fingerprintFor(template: PromptTemplate): string {
  // sha256 over `kind|version|system` so a rename, a version bump, or a
  // content edit each produces a fresh fingerprint. This is what the audit
  // row keys on (FR-020).
  const h = createHash("sha256");
  h.update(template.kind);
  h.update("|");
  h.update(template.version);
  h.update("|");
  h.update(template.system);
  return h.digest("hex");
}

/**
 * Resolve the prompt for an extractor kind. Throws when the registry has
 * no entry for the kind — extractors MUST add their template here before
 * they can ship.
 */
export function getExtractionPrompt(kind: string): AssembledPrompt {
  const template = TEMPLATES[kind];
  if (!template) {
    throw new Error(
      `getExtractionPrompt: no registered template for "${kind}"; add it to api/knowledge/prompts.ts`,
    );
  }
  return {
    kind: template.kind,
    version: template.version,
    system: template.system,
    fingerprint: fingerprintFor(template),
  };
}

/** Visible for tests / debug — does NOT expose the full template body. */
export function listExtractionPromptKinds(): string[] {
  return Object.keys(TEMPLATES);
}
