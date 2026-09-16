import { describe, it, expect } from "vitest";
import { runConformanceKit } from "./conformance.js";

describe("conformance kit (FR-011, SC-006)", () => {
  const results = runConformanceKit();

  it("runs at least 10 acceptance tests", () => {
    expect(results.length).toBeGreaterThanOrEqual(10);
  });

  for (const result of results) {
    it(result.name, () => {
      expect(result.passed, result.detail).toBe(true);
    });
  }
});
