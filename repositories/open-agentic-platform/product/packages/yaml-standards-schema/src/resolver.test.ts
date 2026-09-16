import { describe, it, expect } from "vitest";
import type { CodingStandard } from "./types.js";
import type { TierResult } from "./loader.js";
import { resolveStandards } from "./resolver.js";

/** Helper to create a minimal CodingStandard. */
function makeStandard(overrides: Partial<CodingStandard> = {}): CodingStandard {
  return {
    id: "test-001",
    category: "testing",
    priority: "high",
    status: "active",
    rules: [{ verb: "ALWAYS", subject: "write tests", rationale: "correctness" }],
    ...overrides,
  };
}

/** Helper to create a TierResult. */
function makeTier(tier: TierResult["tier"], standards: CodingStandard[]): TierResult {
  const map = new Map<string, CodingStandard>();
  for (const s of standards) {
    map.set(s.id, s);
  }
  return { tier, standards: map, diagnostics: [] };
}

describe("resolveStandards", () => {
  it("merges standards from a single tier", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "naming-001", category: "naming" }),
        makeStandard({ id: "error-001", category: "error-handling" }),
      ]),
    ];
    const result = resolveStandards(tiers);
    expect(result.standards.size).toBe(2);
    expect(result.standards.get("naming-001")).toBeDefined();
    expect(result.standards.get("error-001")).toBeDefined();
  });

  it("later tier overrides earlier for same id (SC-002, FR-004)", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "naming-001", category: "naming", priority: "low" }),
      ]),
      makeTier("community", []),
      makeTier("local", [
        makeStandard({ id: "naming-001", category: "naming", priority: "critical" }),
      ]),
    ];
    const result = resolveStandards(tiers);
    expect(result.standards.size).toBe(1);
    expect(result.standards.get("naming-001")!.priority).toBe("critical");
  });

  it("community overrides official, local overrides community", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "test-001", context: "official" }),
      ]),
      makeTier("community", [
        makeStandard({ id: "test-001", context: "community" }),
      ]),
      makeTier("local", [
        makeStandard({ id: "test-001", context: "local" }),
      ]),
    ];
    const result = resolveStandards(tiers);
    expect(result.standards.get("test-001")!.context).toBe("local");
  });

  it("excludes candidate standards (SC-003)", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "active-001", status: "active" }),
        makeStandard({ id: "candidate-001", status: "candidate" }),
      ]),
    ];
    const result = resolveStandards(tiers);
    expect(result.standards.size).toBe(1);
    expect(result.standards.has("active-001")).toBe(true);
    expect(result.standards.has("candidate-001")).toBe(false);
  });

  it("candidate in later tier does not override active from earlier tier", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "test-001", status: "active", context: "official" }),
      ]),
      makeTier("local", [
        makeStandard({ id: "test-001", status: "candidate", context: "local" }),
      ]),
    ];
    const result = resolveStandards(tiers);
    expect(result.standards.get("test-001")!.context).toBe("official");
  });

  it("filters by category (FR-008)", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "naming-001", category: "naming" }),
        makeStandard({ id: "error-001", category: "error-handling" }),
        makeStandard({ id: "naming-002", category: "naming" }),
      ]),
    ];
    const result = resolveStandards(tiers, { category: "naming" });
    expect(result.standards.size).toBe(2);
    expect(result.standards.has("naming-001")).toBe(true);
    expect(result.standards.has("naming-002")).toBe(true);
    expect(result.standards.has("error-001")).toBe(false);
  });

  it("filters by tags — at least one must match (FR-008)", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "ts-001", tags: ["typescript", "async"] }),
        makeStandard({ id: "go-001", tags: ["go", "concurrency"] }),
        makeStandard({ id: "js-001", tags: ["javascript", "async"] }),
      ]),
    ];
    const result = resolveStandards(tiers, { tags: ["async"] });
    expect(result.standards.size).toBe(2);
    expect(result.standards.has("ts-001")).toBe(true);
    expect(result.standards.has("js-001")).toBe(true);
    expect(result.standards.has("go-001")).toBe(false);
  });

  it("filters by both category and tags", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "ts-err-001", category: "error-handling", tags: ["typescript"] }),
        makeStandard({ id: "ts-name-001", category: "naming", tags: ["typescript"] }),
        makeStandard({ id: "go-err-001", category: "error-handling", tags: ["go"] }),
      ]),
    ];
    const result = resolveStandards(tiers, { category: "error-handling", tags: ["typescript"] });
    expect(result.standards.size).toBe(1);
    expect(result.standards.has("ts-err-001")).toBe(true);
  });

  it("standards without tags are excluded when filtering by tags", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "tagged-001", tags: ["typescript"] }),
        makeStandard({ id: "untagged-001" }),
      ]),
    ];
    const result = resolveStandards(tiers, { tags: ["typescript"] });
    expect(result.standards.size).toBe(1);
    expect(result.standards.has("tagged-001")).toBe(true);
  });

  it("returns empty when no standards match filter", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "naming-001", category: "naming" }),
      ]),
    ];
    const result = resolveStandards(tiers, { category: "nonexistent" });
    expect(result.standards.size).toBe(0);
  });

  it("returns empty for empty tiers", () => {
    const result = resolveStandards([]);
    expect(result.standards.size).toBe(0);
  });

  it("preserves all standards when no filter given", () => {
    const tiers = [
      makeTier("official", [
        makeStandard({ id: "a", category: "one" }),
        makeStandard({ id: "b", category: "two" }),
      ]),
      makeTier("local", [
        makeStandard({ id: "c", category: "three" }),
      ]),
    ];
    const result = resolveStandards(tiers);
    expect(result.standards.size).toBe(3);
  });

  it("handles many standards across tiers with correct precedence", () => {
    const official = Array.from({ length: 50 }, (_, i) =>
      makeStandard({ id: `std-${String(i).padStart(3, "0")}`, context: "official" }),
    );
    const local = Array.from({ length: 10 }, (_, i) =>
      makeStandard({ id: `std-${String(i).padStart(3, "0")}`, context: "local" }),
    );
    const tiers = [makeTier("official", official), makeTier("local", local)];
    const result = resolveStandards(tiers);
    expect(result.standards.size).toBe(50);
    // First 10 should be local overrides
    for (let i = 0; i < 10; i++) {
      expect(result.standards.get(`std-${String(i).padStart(3, "0")}`)!.context).toBe("local");
    }
    // Rest should be official
    for (let i = 10; i < 50; i++) {
      expect(result.standards.get(`std-${String(i).padStart(3, "0")}`)!.context).toBe("official");
    }
  });
});
