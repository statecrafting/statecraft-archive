// Feature: 070-prompt-assembly-cache

import { describe, it, expect } from "vitest";
import {
  createDefaultAssembler,
  DEFAULT_SECTIONS,
  identitySection,
} from "./defaults.js";
import type { AssemblyContext } from "./types.js";

const CTX: AssemblyContext = {
  sessionId: "test-session",
  modelContextWindow: 200_000,
  vars: {
    behavioralRules: "Rule 1: Be helpful",
    toolRegistrySchemas: '{"tools":[]}',
    claudeMd: "# Project\nInstructions here",
    orchestratorRules: "Execute steps in order",
    baseHookDefinitions: "hook: pre-commit",
    workflowState: "active task: implement spec 070",
    sessionMemory: "User prefers terse responses",
    mcpServerContext: "MCP server: local-files",
    conversationSummary: "Previously discussed prompt assembly",
    activeHooksSummary: "2 hooks active",
    environmentContext: "date: 2026-03-31, branch: main",
  },
};

describe("DEFAULT_SECTIONS", () => {
  it("contains exactly 13 sections", () => {
    expect(DEFAULT_SECTIONS).toHaveLength(13);
  });

  it("is sorted by priority descending", () => {
    for (let i = 1; i < DEFAULT_SECTIONS.length; i++) {
      expect(DEFAULT_SECTIONS[i - 1].priority).toBeGreaterThanOrEqual(
        DEFAULT_SECTIONS[i].priority,
      );
    }
  });

  it("has 7 static and 6 dynamic sections", () => {
    const staticSections = DEFAULT_SECTIONS.filter(
      (s) => s.cacheLifetime === "static",
    );
    const dynamicSections = DEFAULT_SECTIONS.filter(
      (s) => s.cacheLifetime === "dynamic",
    );
    expect(staticSections).toHaveLength(7);
    expect(dynamicSections).toHaveLength(6);
  });

  it("all static sections have priority >= 500", () => {
    const staticSections = DEFAULT_SECTIONS.filter(
      (s) => s.cacheLifetime === "static",
    );
    for (const s of staticSections) {
      expect(s.priority).toBeGreaterThanOrEqual(500);
    }
  });

  it("all dynamic sections have priority < 500", () => {
    const dynamicSections = DEFAULT_SECTIONS.filter(
      (s) => s.cacheLifetime === "dynamic",
    );
    for (const s of dynamicSections) {
      expect(s.priority).toBeLessThan(500);
    }
  });

  it("has unique names", () => {
    const names = DEFAULT_SECTIONS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("identitySection", () => {
  it("returns non-empty identity content", () => {
    const content = identitySection.contentFn(CTX);
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("Open Agentic Platform");
  });
});

describe("createDefaultAssembler", () => {
  it("creates assembler with all 12 default sections", () => {
    const asm = createDefaultAssembler();
    expect(asm.sectionNames).toHaveLength(13);
  });

  it("produces a prompt with static prefix, boundary, and dynamic suffix", () => {
    const asm = createDefaultAssembler();
    const result = asm.assemble(CTX);

    // Static prefix should contain identity and rules
    expect(result.staticPrefix).toContain("Open Agentic Platform");
    expect(result.staticPrefix).toContain("Rule 1: Be helpful");
    expect(result.staticPrefix).toContain("# Project");

    // Dynamic suffix should contain workflow and memory
    expect(result.dynamicSuffix).toContain("implement spec 070");
    expect(result.dynamicSuffix).toContain("terse responses");
    expect(result.dynamicSuffix).toContain("date: 2026-03-31");
  });

  it("sections with empty vars produce empty content", () => {
    const emptyCtx: AssemblyContext = {
      sessionId: "empty",
      modelContextWindow: 200_000,
      vars: {},
    };
    const asm = createDefaultAssembler();
    const result = asm.assemble(emptyCtx);

    // Identity section always has content
    expect(result.staticPrefix).toContain("Open Agentic Platform");
    // Metadata shows all 13 sections
    expect(result.metadata.sections).toHaveLength(13);
  });

  it("allows adding custom sections after creation (SC-002)", () => {
    const asm = createDefaultAssembler();
    asm.registerSection({
      name: "custom-plugin",
      contentFn: () => "Plugin content",
      cacheLifetime: "dynamic",
      priority: 250,
      maxBytes: 4_096,
    });

    expect(asm.sectionNames).toHaveLength(14);
    const result = asm.assemble(CTX);
    expect(result.dynamicSuffix).toContain("Plugin content");
  });
});
