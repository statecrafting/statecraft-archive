import { describe, it, expect } from "vitest";
import { isServerError, isTimeoutError, stripErrorStack } from "./masking";

describe("isServerError (5xx masking decision, FR-004)", () => {
  it("treats 500, 502, 503 as server errors (masked to 502)", () => {
    expect(isServerError(500)).toBe(true);
    expect(isServerError(502)).toBe(true);
    expect(isServerError(503)).toBe(true);
  });
  it("does not mask 4xx or 2xx (boundary at 500)", () => {
    expect(isServerError(499)).toBe(false);
    expect(isServerError(404)).toBe(false);
    expect(isServerError(200)).toBe(false);
  });
});

describe("isTimeoutError (504 mapping, FR-005)", () => {
  it("is true for an AbortError (the timeout abort)", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isTimeoutError(err)).toBe(true);
  });
  it("is false for a generic upstream error (maps to 502, not 504)", () => {
    expect(isTimeoutError(new Error("ECONNREFUSED"))).toBe(false);
  });
  it("is false for non-Error rejections", () => {
    expect(isTimeoutError("boom")).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
  });
});

describe("stripErrorStack (4xx body leak prevention, FR-004)", () => {
  it("removes a stack trace from an error body but keeps the rest", () => {
    const body = { error: { code: "bad_request", message: "nope", stack: "at foo()" } };
    const out = stripErrorStack(body) as { error: Record<string, unknown> };
    expect(out.error.stack).toBeUndefined();
    expect(out.error.code).toBe("bad_request");
    expect(out.error.message).toBe("nope");
  });
  it("leaves a body without an error object unchanged", () => {
    expect(stripErrorStack({ data: 1 })).toEqual({ data: 1 });
    expect(stripErrorStack(null)).toBeNull();
  });
});
