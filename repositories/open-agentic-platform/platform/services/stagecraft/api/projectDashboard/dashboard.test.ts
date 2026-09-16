// Spec 175 — pure-helper coverage for the dashboard endpoint.
//
// The DB-backed panel builders (`buildRunsPanel`, `buildAuditPanel`,
// `buildRiskPanel`, `buildCertificatePanel`) are exercised through the
// live `encore test` Postgres integration. These tests cover the small
// pure helpers in `./dashboardHelpers` that compose the shape of each
// panel — importing from the helper module keeps the test free of
// Encore / Drizzle runtime dependencies.

import { describe, expect, it, afterEach } from "vitest";
import {
  lastStageId,
  pickAuthSource,
  shortError,
  staleExtractionCutoffMs,
} from "./dashboardHelpers";

describe("lastStageId", () => {
  it("returns null on empty / undefined / non-array input", () => {
    expect(lastStageId(undefined)).toBeNull();
    expect(lastStageId(null)).toBeNull();
    expect(lastStageId([])).toBeNull();
    expect(lastStageId("not-an-array")).toBeNull();
  });
  it("returns the stage_id of the last entry", () => {
    expect(
      lastStageId([
        { stage_id: "s0", status: "ok" },
        { stage_id: "s1", status: "running" },
      ])
    ).toBe("s1");
  });
  it("returns null when the last entry has no stage_id", () => {
    expect(lastStageId([{ status: "ok" }])).toBeNull();
  });
});

describe("pickAuthSource", () => {
  it("returns 'unknown' for non-object metadata", () => {
    expect(pickAuthSource(undefined)).toBe("unknown");
    expect(pickAuthSource(null)).toBe("unknown");
    expect(pickAuthSource("session")).toBe("unknown");
  });
  it("returns the recognised value when present", () => {
    expect(pickAuthSource({ authSource: "session" })).toBe("session");
    expect(pickAuthSource({ authSource: "api_key" })).toBe("api_key");
    expect(pickAuthSource({ authSource: "m2m" })).toBe("m2m");
  });
  it("returns 'unknown' for unrecognised authSource values", () => {
    expect(pickAuthSource({ authSource: "other" })).toBe("unknown");
  });
});

describe("staleExtractionCutoffMs", () => {
  const originalEnv = process.env.statecraft_EXTRACT_STALE_AFTER_SEC;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.statecraft_EXTRACT_STALE_AFTER_SEC;
    } else {
      process.env.statecraft_EXTRACT_STALE_AFTER_SEC = originalEnv;
    }
  });
  it("defaults to 600s when the env knob is unset", () => {
    delete process.env.statecraft_EXTRACT_STALE_AFTER_SEC;
    expect(staleExtractionCutoffMs()).toBe(600_000);
  });
  it("honours the env knob in seconds", () => {
    process.env.statecraft_EXTRACT_STALE_AFTER_SEC = "120";
    expect(staleExtractionCutoffMs()).toBe(120_000);
  });
  it("falls back to default on a malformed env value", () => {
    process.env.statecraft_EXTRACT_STALE_AFTER_SEC = "not-a-number";
    expect(staleExtractionCutoffMs()).toBe(600_000);
  });
  it("falls back to default when the env value is non-positive", () => {
    process.env.statecraft_EXTRACT_STALE_AFTER_SEC = "0";
    expect(staleExtractionCutoffMs()).toBe(600_000);
    process.env.statecraft_EXTRACT_STALE_AFTER_SEC = "-10";
    expect(staleExtractionCutoffMs()).toBe(600_000);
  });
});

describe("shortError", () => {
  it("returns the message of an Error", () => {
    expect(shortError(new Error("boom"))).toBe("boom");
  });
  it("stringifies non-Error values", () => {
    expect(shortError("plain")).toBe("plain");
    expect(shortError(42)).toBe("42");
  });
  it("truncates messages over 160 chars with an ellipsis", () => {
    const long = "x".repeat(200);
    const out = shortError(new Error(long));
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("...")).toBe(true);
  });
});
