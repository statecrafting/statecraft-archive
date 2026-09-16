// Spec 115 FR-020 — prompt fingerprint reproducibility tests.
//
// Pinning the fingerprints makes accidental edits to the templates
// surface in CI (the audit row keys on these strings; if they change
// silently, prior agent runs become un-reconstructable).

import { describe, expect, test } from "vitest";
import {
  getExtractionPrompt,
  listExtractionPromptKinds,
} from "./prompts";

describe("getExtractionPrompt", () => {
  test("returns a stable shape for every registered kind", () => {
    for (const kind of listExtractionPromptKinds()) {
      const p = getExtractionPrompt(kind);
      expect(p.kind).toBe(kind);
      expect(p.version).toMatch(/^\d+$/);
      expect(p.system.length).toBeGreaterThan(20);
      expect(p.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("two calls for the same kind produce the same fingerprint", () => {
    const a = getExtractionPrompt("knowledge-extract.agent-pdf-vision");
    const b = getExtractionPrompt("knowledge-extract.agent-pdf-vision");
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  test("different kinds produce different fingerprints", () => {
    const pdf = getExtractionPrompt("knowledge-extract.agent-pdf-vision");
    const img = getExtractionPrompt("knowledge-extract.agent-image-vision");
    expect(pdf.fingerprint).not.toBe(img.fingerprint);
  });

  test("unknown kind throws (FR-020 — no inline prompts)", () => {
    expect(() =>
      getExtractionPrompt("knowledge-extract.totally-fake"),
    ).toThrow(/no registered template/);
  });

  test("listExtractionPromptKinds includes the expected kinds", () => {
    const kinds = listExtractionPromptKinds();
    expect(kinds).toContain("knowledge-extract.agent-pdf-vision");
    expect(kinds).toContain("knowledge-extract.agent-image-vision");
  });
});
