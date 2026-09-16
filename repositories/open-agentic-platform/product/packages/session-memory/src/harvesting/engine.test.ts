import { describe, it, expect } from "vitest";
import { harvest, signalsToStoreInputs } from "./engine.js";
import type { HarvestRule } from "./rules.js";

describe("harvest", () => {
  describe("decision signals (SC-003)", () => {
    it("detects 'let's go with X'", () => {
      const result = harvest("Let's go with TypeScript for this project.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("decision");
      expect(result.signals[0].content).toContain("TypeScript for this project");
    });

    it("detects 'we decided to X'", () => {
      const result = harvest("We decided to use ESM modules everywhere.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("decision");
      expect(result.signals[0].content).toContain("use ESM modules everywhere");
    });

    it("detects 'we're going with X'", () => {
      const result = harvest("We're going with vitest for testing.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("decision");
    });

    it("detects 'we will use X'", () => {
      const result = harvest("We will use SQLite for local storage.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("decision");
      expect(result.signals[0].content).toContain("SQLite");
    });
  });

  describe("correction signals (SC-003)", () => {
    it("detects 'actually, use Y'", () => {
      const result = harvest("Actually, use jest instead of vitest.");
      expect(result.signals.some((s) => s.kind === "correction")).toBe(true);
    });

    it("detects 'no, use Y'", () => {
      const result = harvest("No, use pnpm instead.");
      expect(result.signals.some((s) => s.kind === "correction")).toBe(true);
    });

    it("detects 'instead use Y'", () => {
      const result = harvest("Instead of npm use pnpm.");
      expect(result.signals.some((s) => s.kind === "correction")).toBe(true);
    });
  });

  describe("note signals", () => {
    it("detects 'remember that X'", () => {
      const result = harvest("Remember that the API key is in the env file.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("note");
      expect(result.signals[0].importance).toBe("permanent");
    });

    it("detects 'note: X'", () => {
      const result = harvest("Note: the database needs migration after deploy.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("note");
    });

    it("detects 'keep in mind that X'", () => {
      const result = harvest("Keep in mind that this API has rate limits.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("note");
    });
  });

  describe("pattern signals", () => {
    it("detects 'the pattern here is X'", () => {
      const result = harvest("The pattern here is to use factory functions.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("pattern");
      expect(result.signals[0].content).toContain("factory functions");
    });

    it("detects 'our convention is to X'", () => {
      const result = harvest("Our convention is to prefix interfaces with I.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("pattern");
    });
  });

  describe("preference signals", () => {
    it("detects 'always use X for Y'", () => {
      const result = harvest("Always use arrow functions for callbacks.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("preference");
      expect(result.signals[0].importance).toBe("permanent");
    });

    it("detects 'never use X for Y'", () => {
      const result = harvest("Never use var for variable declarations.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("preference");
    });

    it("detects 'I prefer X over Y'", () => {
      const result = harvest("I prefer const over let.");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("preference");
      expect(result.signals[0].content).toContain("const");
      expect(result.signals[0].content).toContain("let");
    });
  });

  describe("multiple signals in one text", () => {
    it("detects multiple distinct signals", () => {
      const text =
        "Let's go with TypeScript. Remember that we need strict mode. Always use const for immutable values.";
      const result = harvest(text);
      expect(result.signals.length).toBeGreaterThanOrEqual(3);
      const kinds = new Set(result.signals.map((s) => s.kind));
      expect(kinds.has("decision")).toBe(true);
      expect(kinds.has("note")).toBe(true);
      expect(kinds.has("preference")).toBe(true);
    });
  });

  describe("deduplication", () => {
    it("deduplicates identical content by default", () => {
      const text = "Let's go with ESM. Let's go with ESM.";
      const result = harvest(text);
      const esmSignals = result.signals.filter((s) => s.content.includes("ESM"));
      expect(esmSignals).toHaveLength(1);
    });

    it("allows duplicates when deduplicate is false", () => {
      const text = "Let's go with ESM. Let's go with ESM.";
      const result = harvest(text, { deduplicate: false });
      const esmSignals = result.signals.filter((s) => s.content.includes("ESM"));
      expect(esmSignals).toHaveLength(2);
    });
  });

  describe("custom rules", () => {
    it("uses custom rules when provided", () => {
      const customRules: HarvestRule[] = [
        {
          id: "custom-todo",
          pattern: /TODO:\s*(.+?)(?:\.|$)/gi,
          kind: "note",
          importance: "short-term",
          extractContent: (match) => `TODO: ${match[1].trim()}`,
        },
      ];
      const result = harvest("TODO: fix the login flow.", { rules: customRules });
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].ruleId).toBe("custom-todo");
      expect(result.signals[0].content).toContain("fix the login flow");
    });
  });

  describe("performance (NF-002)", () => {
    it("completes within 50ms for typical text", () => {
      const text = "Let's go with TypeScript. We decided to use ESM. Remember that strict mode is required. Always use const for bindings.";
      const result = harvest(text);
      expect(result.durationMs).toBeLessThan(50);
    });
  });

  describe("no signals", () => {
    it("returns empty array for text with no signals", () => {
      const result = harvest("This is a normal conversation about debugging.");
      expect(result.signals).toHaveLength(0);
    });
  });

  describe("empty input", () => {
    it("handles empty string", () => {
      const result = harvest("");
      expect(result.signals).toHaveLength(0);
    });
  });
});

describe("signalsToStoreInputs", () => {
  it("converts signals to store inputs", () => {
    const signals = [
      { ruleId: "decision-lets-go-with", kind: "decision" as const, importance: "long-term" as const, content: "Decision: TypeScript", matchText: "let's go with TypeScript" },
    ];
    const inputs = signalsToStoreInputs(signals, "/project", "session-1");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].content).toBe("Decision: TypeScript");
    expect(inputs[0].kind).toBe("decision");
    expect(inputs[0].importance).toBe("long-term");
    expect(inputs[0].projectScope).toBe("/project");
    expect(inputs[0].sourceSessionId).toBe("session-1");
    expect(inputs[0].tags).toEqual(["decision-lets-go-with"]);
  });
});
