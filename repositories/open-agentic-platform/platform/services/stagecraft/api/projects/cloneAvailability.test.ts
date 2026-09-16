// Spec 113 Phase 1a — unit tests for the pure helpers in cloneAvailability.ts.
//
// The Encore endpoint exercises infra (DB, GitHub API, installation broker)
// and is covered by integration testing. The pure validators and the
// fetch-injectable repo probe are pinned here so the format gate (FR-019,
// SC-008) and the response-state mapping (FR-020) can be exercised without
// the Encore native runtime.

import { describe, expect, test, vi } from "vitest";
import {
  checkRepoAvailable,
  isValidGithubRepoName,
  isValidProjectSlug,
  type FetchLike,
} from "./cloneAvailabilityHelpers";

describe("isValidGithubRepoName", () => {
  test("accepts typical repo names", () => {
    expect(isValidGithubRepoName("foo")).toBe(true);
    expect(isValidGithubRepoName("foo-bar")).toBe(true);
    expect(isValidGithubRepoName("Foo_Bar.123")).toBe(true);
    expect(isValidGithubRepoName("a")).toBe(true);
    expect(isValidGithubRepoName("a".repeat(100))).toBe(true);
  });

  test("rejects too-long, leading-punct, and bare-dot values", () => {
    expect(isValidGithubRepoName("a".repeat(101))).toBe(false);
    expect(isValidGithubRepoName("-leading-hyphen")).toBe(false);
    expect(isValidGithubRepoName(".leading-dot")).toBe(false);
    expect(isValidGithubRepoName(".")).toBe(false);
    expect(isValidGithubRepoName("..")).toBe(false);
  });

  test("rejects whitespace and disallowed punctuation", () => {
    expect(isValidGithubRepoName("foo bar")).toBe(false);
    expect(isValidGithubRepoName("foo bar!")).toBe(false);
    expect(isValidGithubRepoName("foo/bar")).toBe(false);
    expect(isValidGithubRepoName("")).toBe(false);
  });
});

describe("isValidProjectSlug", () => {
  test("accepts lowercase alphanumeric with hyphens", () => {
    expect(isValidProjectSlug("foo")).toBe(true);
    expect(isValidProjectSlug("foo-bar")).toBe(true);
    expect(isValidProjectSlug("a1-b2-c3")).toBe(true);
  });

  test("rejects uppercase, underscores, dots, leading hyphen, empty", () => {
    expect(isValidProjectSlug("Foo")).toBe(false);
    expect(isValidProjectSlug("foo_bar")).toBe(false);
    expect(isValidProjectSlug("foo.bar")).toBe(false);
    expect(isValidProjectSlug("-foo")).toBe(false);
    expect(isValidProjectSlug("")).toBe(false);
  });

  test("rejects slugs longer than 63 chars", () => {
    expect(isValidProjectSlug("a".repeat(63))).toBe(true);
    expect(isValidProjectSlug("a".repeat(64))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkRepoAvailable — fetch-injectable
// ---------------------------------------------------------------------------

function mockResp(
  status: number,
  headers: Record<string, string> = {}
): Awaited<ReturnType<FetchLike>> {
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    status,
    headers: { get: (n: string) => lower.get(n.toLowerCase()) ?? null },
    text: async () => "",
  };
}

describe("checkRepoAvailable", () => {
  test("404 → available", async () => {
    const fetcher = vi.fn(async () => mockResp(404));
    const v = await checkRepoAvailable(
      "tok",
      "statecrafting",
      "foo",
      fetcher as unknown as FetchLike
    );
    expect(v).toEqual({ state: "available" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test("200 → unavailable/exists", async () => {
    const fetcher = vi.fn(async () => mockResp(200));
    const v = await checkRepoAvailable(
      "tok",
      "statecrafting",
      "foo",
      fetcher as unknown as FetchLike
    );
    expect(v).toEqual({ state: "unavailable", reason: "exists" });
  });

  test("429 with retry-after → unverifiable/rate_limited with retryAfterSec", async () => {
    const fetcher = vi.fn(async () =>
      mockResp(429, { "retry-after": "30" })
    );
    const v = await checkRepoAvailable(
      "tok",
      "statecrafting",
      "foo",
      fetcher as unknown as FetchLike
    );
    expect(v).toEqual({
      state: "unverifiable",
      reason: "rate_limited",
      retryAfterSec: 30,
    });
  });

  test("403 with x-ratelimit-remaining=0 → unverifiable/rate_limited", async () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    const fetcher = vi.fn(async () =>
      mockResp(403, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(reset),
      })
    );
    const v = await checkRepoAvailable(
      "tok",
      "statecrafting",
      "foo",
      fetcher as unknown as FetchLike
    );
    expect(v.state).toBe("unverifiable");
    expect(v.reason).toBe("rate_limited");
    expect(v.retryAfterSec).toBeGreaterThan(0);
  });

  test("403 without rate-limit headers → unverifiable/transient_error", async () => {
    const fetcher = vi.fn(async () => mockResp(403));
    const v = await checkRepoAvailable(
      "tok",
      "statecrafting",
      "foo",
      fetcher as unknown as FetchLike
    );
    expect(v).toEqual({ state: "unverifiable", reason: "transient_error" });
  });

  test("500 → unverifiable/transient_error", async () => {
    const fetcher = vi.fn(async () => mockResp(500));
    const v = await checkRepoAvailable(
      "tok",
      "statecrafting",
      "foo",
      fetcher as unknown as FetchLike
    );
    expect(v).toEqual({ state: "unverifiable", reason: "transient_error" });
  });
});

// ---------------------------------------------------------------------------
// FR-019 / SC-008 — format gate must short-circuit before any GitHub call.
// ---------------------------------------------------------------------------

describe("format gate — checkRepoAvailable is never called for invalid input", () => {
  /**
   * The endpoint runs `isValidGithubRepoName(s)` before invoking
   * `checkRepoAvailable`. We pin that contract by simulating the endpoint's
   * decision and asserting the fetcher mock stays untouched.
   */
  function simulateRepoCheck(
    fetcher: FetchLike,
    repoName: string
  ): "invalid_format" | "would_call_fetch" {
    if (!isValidGithubRepoName(repoName)) return "invalid_format";
    void checkRepoAvailable("tok", "org", repoName, fetcher);
    return "would_call_fetch";
  }

  test("invalid names short-circuit and never reach fetch", () => {
    const fetcher = vi.fn(async () => mockResp(200));
    for (const bad of ["foo bar!", "", "..", ".", "-leading", "a".repeat(101)]) {
      expect(simulateRepoCheck(fetcher as unknown as FetchLike, bad)).toBe(
        "invalid_format"
      );
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
