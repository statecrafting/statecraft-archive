// Feature: 070-prompt-assembly-cache

import { describe, it, expect } from "vitest";
import {
  PromptAssembler,
  CACHE_BOUNDARY_MARKER,
  truncateToBytes,
} from "./assembler.js";
import type { AssemblyContext, PromptSection } from "./types.js";

const CTX: AssemblyContext = {
  sessionId: "test-session",
  modelContextWindow: 200_000,
  vars: {},
};

function makeSection(
  overrides: Partial<PromptSection> & { name: string },
): PromptSection {
  return {
    contentFn: () => `Content for ${overrides.name}`,
    cacheLifetime: "static",
    priority: 500,
    maxBytes: 10_000,
    ...overrides,
  };
}

describe("truncateToBytes", () => {
  it("returns content unchanged when within budget", () => {
    expect(truncateToBytes("hello", 100)).toBe("hello");
  });

  it("truncates content exceeding budget with notice", () => {
    const result = truncateToBytes("a".repeat(200), 50);
    expect(result.length).toBeLessThanOrEqual(60); // some slack for notice
    expect(result).toContain("[... truncated to fit budget ...]");
  });

  it("handles empty content", () => {
    expect(truncateToBytes("", 10)).toBe("");
  });
});

describe("PromptAssembler", () => {
  describe("section registration (FR-007)", () => {
    it("registers sections and returns names in priority order", () => {
      const asm = new PromptAssembler();
      asm.registerSection(makeSection({ name: "low", priority: 100 }));
      asm.registerSection(makeSection({ name: "high", priority: 900 }));
      asm.registerSection(makeSection({ name: "mid", priority: 500 }));

      expect(asm.sectionNames).toEqual(["high", "mid", "low"]);
    });

    it("removes sections by name", () => {
      const asm = new PromptAssembler();
      asm.registerSection(makeSection({ name: "a" }));
      asm.registerSection(makeSection({ name: "b" }));
      expect(asm.removeSection("a")).toBe(true);
      expect(asm.sectionNames).toEqual(["b"]);
    });

    it("returns false when removing non-existent section", () => {
      const asm = new PromptAssembler();
      expect(asm.removeSection("nope")).toBe(false);
    });
  });

  describe("assembly (FR-001)", () => {
    it("separates static and dynamic sections with cache boundary", () => {
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "static-1",
          cacheLifetime: "static",
          priority: 900,
          contentFn: () => "STATIC_CONTENT",
        }),
      );
      asm.registerSection(
        makeSection({
          name: "dynamic-1",
          cacheLifetime: "dynamic",
          priority: 100,
          contentFn: () => "DYNAMIC_CONTENT",
        }),
      );

      const result = asm.assemble(CTX);
      expect(result.staticPrefix).toContain("STATIC_CONTENT");
      expect(result.dynamicSuffix).toContain("DYNAMIC_CONTENT");
      expect(result.cacheBoundary).toBe(CACHE_BOUNDARY_MARKER);
    });

    it("per_session sections go to static prefix", () => {
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "session-1",
          cacheLifetime: "per_session",
          priority: 500,
          contentFn: () => "SESSION_CONTENT",
        }),
      );

      const result = asm.assemble(CTX);
      expect(result.staticPrefix).toContain("SESSION_CONTENT");
      expect(result.dynamicSuffix).toBe("");
    });

    it("orders sections by priority descending within each region", () => {
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "s-low",
          cacheLifetime: "static",
          priority: 100,
          contentFn: () => "LOW",
        }),
      );
      asm.registerSection(
        makeSection({
          name: "s-high",
          cacheLifetime: "static",
          priority: 900,
          contentFn: () => "HIGH",
        }),
      );

      const result = asm.assemble(CTX);
      const highIdx = result.staticPrefix.indexOf("HIGH");
      const lowIdx = result.staticPrefix.indexOf("LOW");
      expect(highIdx).toBeLessThan(lowIdx);
    });
  });

  describe("caching (NF-002, SC-001)", () => {
    it("caches static section content across assemblies", () => {
      let callCount = 0;
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "cached",
          cacheLifetime: "static",
          contentFn: () => {
            callCount++;
            return "CACHED";
          },
        }),
      );

      asm.assemble(CTX);
      asm.assemble(CTX);

      expect(callCount).toBe(1);

      // Verify cache hit in metadata
      const result = asm.assemble(CTX);
      const meta = result.metadata.sections.find((s) => s.name === "cached");
      expect(meta?.cacheHit).toBe(true);
    });

    it("does not cache dynamic section content", () => {
      let callCount = 0;
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "dynamic",
          cacheLifetime: "dynamic",
          contentFn: () => {
            callCount++;
            return "DYNAMIC";
          },
        }),
      );

      asm.assemble(CTX);
      asm.assemble(CTX);

      expect(callCount).toBe(2);
    });

    it("invalidateCache forces re-generation of static content", () => {
      let callCount = 0;
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "cached",
          cacheLifetime: "static",
          contentFn: () => {
            callCount++;
            return "V" + callCount;
          },
        }),
      );

      const r1 = asm.assemble(CTX);
      expect(r1.staticPrefix).toContain("V1");

      asm.invalidateCache("cached");
      const r2 = asm.assemble(CTX);
      expect(r2.staticPrefix).toContain("V2");
      expect(callCount).toBe(2);
    });

    it("produces byte-identical static output across turns (SC-001)", () => {
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "deterministic",
          cacheLifetime: "static",
          contentFn: () => "STABLE_OUTPUT",
        }),
      );

      const r1 = asm.assemble(CTX);
      const r2 = asm.assemble(CTX);
      expect(r1.staticPrefix).toBe(r2.staticPrefix);
    });
  });

  describe("budget enforcement (FR-005, SC-003)", () => {
    it("truncates per-section content exceeding maxBytes", () => {
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "big",
          maxBytes: 50,
          contentFn: () => "x".repeat(200),
        }),
      );

      const result = asm.assemble(CTX);
      const meta = result.metadata.sections.find((s) => s.name === "big");
      expect(meta?.truncated).toBe(true);
      expect(meta!.finalBytes).toBeLessThanOrEqual(50);
    });

    it("drops lowest-priority sections when total budget exceeded", () => {
      const asm = new PromptAssembler({ totalBudget: 100 });
      asm.registerSection(
        makeSection({
          name: "high",
          priority: 900,
          contentFn: () => "A".repeat(80),
        }),
      );
      asm.registerSection(
        makeSection({
          name: "low",
          priority: 100,
          contentFn: () => "B".repeat(80),
        }),
      );

      const result = asm.assemble(CTX);
      expect(result.metadata.budgetExceeded).toBe(true);
      expect(result.metadata.truncatedSections).toContain("low");

      // High priority section should be present
      expect(result.staticPrefix).toContain("A");
      // Low priority section should be dropped
      expect(result.staticPrefix).not.toContain("B");
    });

    it("emits metadata for all sections including dropped ones (FR-008)", () => {
      const asm = new PromptAssembler({ totalBudget: 100 });
      asm.registerSection(
        makeSection({
          name: "included",
          priority: 900,
          contentFn: () => "A".repeat(80),
        }),
      );
      asm.registerSection(
        makeSection({
          name: "dropped",
          priority: 100,
          contentFn: () => "B".repeat(80),
        }),
      );

      const result = asm.assemble(CTX);
      expect(result.metadata.sections).toHaveLength(2);

      const dropped = result.metadata.sections.find(
        (s) => s.name === "dropped",
      );
      expect(dropped?.finalBytes).toBe(0);
      expect(dropped?.truncated).toBe(true);
    });
  });

  describe("metadata (FR-008, SC-005)", () => {
    it("reports correct totalBytes and sectionCount", () => {
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "a",
          contentFn: () => "hello",
        }),
      );
      asm.registerSection(
        makeSection({
          name: "b",
          cacheLifetime: "dynamic",
          contentFn: () => "world",
        }),
      );

      const result = asm.assemble(CTX);
      expect(result.metadata.sectionCount).toBe(2);
      expect(result.metadata.totalBytes).toBeGreaterThan(0);
    });

    it("reports cache hits correctly per section", () => {
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "s",
          cacheLifetime: "static",
          contentFn: () => "content",
        }),
      );
      asm.registerSection(
        makeSection({
          name: "d",
          cacheLifetime: "dynamic",
          contentFn: () => "content",
        }),
      );

      // First assembly: no cache hits
      const r1 = asm.assemble(CTX);
      expect(r1.metadata.sections.find((s) => s.name === "s")?.cacheHit).toBe(
        false,
      );

      // Second assembly: static is cached, dynamic is not
      const r2 = asm.assemble(CTX);
      expect(r2.metadata.sections.find((s) => s.name === "s")?.cacheHit).toBe(
        true,
      );
      expect(r2.metadata.sections.find((s) => s.name === "d")?.cacheHit).toBe(
        false,
      );
    });
  });

  describe("assembleString", () => {
    it("returns static + boundary + dynamic as single string", () => {
      const asm = new PromptAssembler();
      asm.registerSection(
        makeSection({
          name: "s",
          cacheLifetime: "static",
          priority: 900,
          contentFn: () => "STATIC",
        }),
      );
      asm.registerSection(
        makeSection({
          name: "d",
          cacheLifetime: "dynamic",
          priority: 100,
          contentFn: () => "DYNAMIC",
        }),
      );

      const full = asm.assembleString(CTX);
      expect(full).toContain("STATIC");
      expect(full).toContain(CACHE_BOUNDARY_MARKER);
      expect(full).toContain("DYNAMIC");

      // Static comes before boundary, boundary before dynamic
      const sIdx = full.indexOf("STATIC");
      const bIdx = full.indexOf("═══ CACHE BOUNDARY ═══");
      const dIdx = full.indexOf("DYNAMIC");
      expect(sIdx).toBeLessThan(bIdx);
      expect(bIdx).toBeLessThan(dIdx);
    });
  });
});
