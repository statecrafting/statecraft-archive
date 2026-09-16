// Spec 112 Phase 6 — unit tests for import-path pure helpers.
//
// End-to-end cloning + DB insertion require live GitHub + Postgres and
// are covered by integration testing. This file pins the pure helpers
// extracted into `importHelpers.ts` so they can be exercised without
// loading the Encore native runtime.

import { describe, expect, test } from "vitest";
import { guessMimeType, parseRepoUrlImpl, TRANSLATOR_VERSION } from "./importHelpers";

describe("parseRepoUrlImpl", () => {
  test("accepts short form owner/repo", () => {
    expect(parseRepoUrlImpl("acme/foo")).toEqual({ owner: "acme", repo: "foo" });
  });

  test("accepts short form with .git suffix", () => {
    expect(parseRepoUrlImpl("acme/foo.git")).toEqual({ owner: "acme", repo: "foo" });
  });

  test("accepts full github URL", () => {
    expect(parseRepoUrlImpl("https://github.com/acme/foo")).toEqual({
      owner: "acme",
      repo: "foo",
    });
  });

  test("accepts github URL with .git suffix", () => {
    expect(parseRepoUrlImpl("https://github.com/acme/foo.git")).toEqual({
      owner: "acme",
      repo: "foo",
    });
  });

  test("accepts www.github.com host", () => {
    expect(parseRepoUrlImpl("https://www.github.com/acme/foo")).toEqual({
      owner: "acme",
      repo: "foo",
    });
  });

  test("rejects non-github hosts", () => {
    expect(() => parseRepoUrlImpl("https://gitlab.com/acme/foo")).toThrow(
      /Expected github\.com/
    );
  });

  test("rejects URLs without repo component", () => {
    expect(() => parseRepoUrlImpl("https://github.com/acme")).toThrow(
      /parse owner\/repo/
    );
  });
});

describe("TRANSLATOR_VERSION", () => {
  test("is a stable non-empty identifier", () => {
    expect(TRANSLATOR_VERSION).toBe("spec-112-v1");
  });
});

describe("guessMimeType", () => {
  test("maps office formats to their OOXML MIME types", () => {
    expect(guessMimeType("foo.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(guessMimeType("bar.XLSX")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(guessMimeType("baz.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
  });

  test("maps pdf, zip, and common text formats", () => {
    expect(guessMimeType("x.pdf")).toBe("application/pdf");
    expect(guessMimeType("x.zip")).toBe("application/zip");
    expect(guessMimeType("x.json")).toBe("application/json");
    expect(guessMimeType("notes.md")).toBe("text/markdown");
    expect(guessMimeType("notes.txt")).toBe("text/plain");
  });

  test("falls back to octet-stream for unknown extensions", () => {
    expect(guessMimeType("weird.xyz")).toBe("application/octet-stream");
    expect(guessMimeType("no-extension")).toBe("application/octet-stream");
  });
});
