// Spec 113 Phase 1b — unit tests for the pure helpers in cloneHelpers.ts.
//
// Mirror clone, push, and the GitHub HTTP fixups exercise live infra and
// are covered by manual end-to-end verification (Phase 4 / T072–T073).
// This file pins the parts that are fully pure — default-name derivation,
// suffix candidates, and the size-cap decision — so a regression on
// FR-029/FR-030/FR-036 fails CI loudly.

import { describe, expect, test } from "vitest";
import {
  DEFAULT_CLONE_MAX_BYTES,
  DEFAULT_CLONE_MAX_COMMITS,
  defaultProjectSlug,
  defaultRepoName,
  isOverSizeCap,
  resolveSizeCaps,
  suffixCandidate,
} from "./cloneHelpers";

describe("defaultRepoName / defaultProjectSlug", () => {
  test("appends -clone to the source identifier", () => {
    expect(defaultRepoName("foo")).toBe("foo-clone");
    expect(defaultRepoName("foo-bar")).toBe("foo-bar-clone");
    expect(defaultProjectSlug("foo")).toBe("foo-clone");
    expect(defaultProjectSlug("foo-bar")).toBe("foo-bar-clone");
  });
});

describe("suffixCandidate", () => {
  test("index 0 is the bare base", () => {
    expect(suffixCandidate("foo-clone", 0)).toBe("foo-clone");
  });

  test("index N >= 1 appends -<N+1>", () => {
    expect(suffixCandidate("foo-clone", 1)).toBe("foo-clone-2");
    expect(suffixCandidate("foo-clone", 2)).toBe("foo-clone-3");
    expect(suffixCandidate("foo-clone", 24)).toBe("foo-clone-25");
  });
});

describe("resolveSizeCaps", () => {
  test("falls back to defaults when env is absent", () => {
    const out = resolveSizeCaps({});
    expect(out.maxBytes).toBe(DEFAULT_CLONE_MAX_BYTES);
    expect(out.maxCommits).toBe(DEFAULT_CLONE_MAX_COMMITS);
  });

  test("honours STATECRAFT_CLONE_MAX_BYTES / _MAX_COMMITS", () => {
    const out = resolveSizeCaps({
      STATECRAFT_CLONE_MAX_BYTES: "1024",
      STATECRAFT_CLONE_MAX_COMMITS: "10",
    });
    expect(out.maxBytes).toBe(1024);
    expect(out.maxCommits).toBe(10);
  });

  test("ignores non-numeric env values", () => {
    const out = resolveSizeCaps({
      STATECRAFT_CLONE_MAX_BYTES: "not-a-number",
    });
    expect(out.maxBytes).toBe(DEFAULT_CLONE_MAX_BYTES);
  });
});

describe("isOverSizeCap", () => {
  test("under both caps → over=false", () => {
    expect(
      isOverSizeCap({
        bytes: 100,
        commits: 5,
        maxBytes: 1000,
        maxCommits: 50,
      })
    ).toEqual({ over: false });
  });

  test("bytes exceed cap → reason=bytes", () => {
    expect(
      isOverSizeCap({
        bytes: 2000,
        commits: 5,
        maxBytes: 1000,
        maxCommits: 50,
      })
    ).toEqual({ over: true, reason: "bytes" });
  });

  test("commits exceed cap → reason=commits", () => {
    expect(
      isOverSizeCap({
        bytes: 100,
        commits: 100,
        maxBytes: 1000,
        maxCommits: 50,
      })
    ).toEqual({ over: true, reason: "commits" });
  });

  test("bytes wins when both exceed (deterministic ordering)", () => {
    expect(
      isOverSizeCap({
        bytes: 2000,
        commits: 100,
        maxBytes: 1000,
        maxCommits: 50,
      })
    ).toEqual({ over: true, reason: "bytes" });
  });
});
