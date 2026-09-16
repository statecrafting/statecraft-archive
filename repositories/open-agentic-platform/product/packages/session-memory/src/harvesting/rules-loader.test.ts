import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadHarvestRules, configToRule, validateRuleConfig } from "./rules-loader.js";
import { BUILTIN_RULES } from "./rules.js";
import { harvest } from "./engine.js";

describe("loadHarvestRules", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rules-loader-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns builtin rules when no config file exists", () => {
    const result = loadHarvestRules(tempDir);
    expect(result.rules).toHaveLength(BUILTIN_RULES.length);
    expect(result.customCount).toBe(0);
    expect(result.overriddenCount).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("loads custom rules from YAML config (FR-004)", () => {
    const configDir = join(tempDir, ".session-memory");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "harvest-rules.yaml"),
      `rules:
  - id: custom-fixme
    pattern: "FIXME:\\\\s*(.+?)(?:\\\\.|$)"
    kind: note
    importance: short-term
    template: "FIXME: $1"
`,
    );

    const result = loadHarvestRules(tempDir);
    expect(result.customCount).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.rules.length).toBe(BUILTIN_RULES.length + 1);
    expect(result.rules.some((r) => r.id === "custom-fixme")).toBe(true);
  });

  it("custom rules override builtin rules with same id", () => {
    const configDir = join(tempDir, ".session-memory");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "harvest-rules.yaml"),
      `rules:
  - id: decision-lets-go-with
    pattern: "let us go with (.+?)(?:\\\\.|$)"
    kind: decision
    importance: permanent
    template: "Team decision: $1"
`,
    );

    const result = loadHarvestRules(tempDir);
    expect(result.overriddenCount).toBe(1);
    expect(result.customCount).toBe(1);
    // Total should be builtins - 1 override + 1 custom = same count
    expect(result.rules.length).toBe(BUILTIN_RULES.length);
    const overridden = result.rules.find((r) => r.id === "decision-lets-go-with");
    expect(overridden).toBeTruthy();
    expect(overridden!.importance).toBe("permanent");
  });

  it("reports validation errors for invalid rules", () => {
    const configDir = join(tempDir, ".session-memory");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "harvest-rules.yaml"),
      `rules:
  - id: bad-rule
    pattern: "valid"
    kind: invalid-kind
    importance: long-term
    template: "test"
`,
    );

    const result = loadHarvestRules(tempDir);
    expect(result.customCount).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("invalid kind");
  });

  it("reports error for invalid regex pattern", () => {
    const configDir = join(tempDir, ".session-memory");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "harvest-rules.yaml"),
      `rules:
  - id: bad-regex
    pattern: "[invalid"
    kind: note
    importance: long-term
    template: "test"
`,
    );

    const result = loadHarvestRules(tempDir);
    expect(result.errors.some((e) => e.includes("invalid regex"))).toBe(true);
  });

  it("reports error for missing required fields", () => {
    const configDir = join(tempDir, ".session-memory");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "harvest-rules.yaml"),
      `rules:
  - id: no-template
    pattern: "test"
    kind: note
    importance: long-term
`,
    );

    const result = loadHarvestRules(tempDir);
    expect(result.errors.some((e) => e.includes("template"))).toBe(true);
  });

  it("reports error for malformed YAML", () => {
    const configDir = join(tempDir, ".session-memory");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "harvest-rules.yaml"), "{{{{bad yaml");

    const result = loadHarvestRules(tempDir);
    expect(result.errors.length).toBeGreaterThan(0);
    // Falls back to builtins
    expect(result.rules).toHaveLength(BUILTIN_RULES.length);
  });

  it("reports error when rules is not an array", () => {
    const configDir = join(tempDir, ".session-memory");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "harvest-rules.yaml"), "rules: not-an-array\n");

    const result = loadHarvestRules(tempDir);
    expect(result.errors.some((e) => e.includes("must be an array"))).toBe(true);
  });

  it("custom rules work with harvest engine end-to-end", () => {
    const configDir = join(tempDir, ".session-memory");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "harvest-rules.yaml"),
      `rules:
  - id: custom-todo
    pattern: "TODO:\\\\s*(.+?)(?:\\\\.|$)"
    kind: note
    importance: short-term
    template: "TODO: $1"
`,
    );

    const { rules } = loadHarvestRules(tempDir);
    const result = harvest("TODO: fix the login page.", { rules });
    expect(result.signals.some((s) => s.ruleId === "custom-todo")).toBe(true);
    expect(result.signals.some((s) => s.content.includes("fix the login page"))).toBe(true);
  });
});

describe("configToRule", () => {
  it("converts config to HarvestRule", () => {
    const rule = configToRule({
      id: "test-rule",
      pattern: "test\\s+(\\w+)",
      kind: "note",
      importance: "long-term",
      template: "Tested: $1",
    });

    expect(rule.id).toBe("test-rule");
    expect(rule.kind).toBe("note");
    expect(rule.importance).toBe("long-term");

    const match = rule.pattern.exec("test something");
    expect(match).not.toBeNull();
    const content = rule.extractContent(match!, "test something");
    expect(content).toBe("Tested: something");
  });

  it("uses default flags gi when not specified", () => {
    const rule = configToRule({
      id: "test",
      pattern: "hello",
      kind: "note",
      importance: "long-term",
      template: "$0",
    });
    expect(rule.pattern.flags).toBe("gi");
  });

  it("uses custom flags when specified", () => {
    const rule = configToRule({
      id: "test",
      pattern: "hello",
      flags: "g",
      kind: "note",
      importance: "long-term",
      template: "$0",
    });
    expect(rule.pattern.flags).toBe("g");
  });
});

describe("validateRuleConfig", () => {
  it("returns empty array for valid config", () => {
    const errors = validateRuleConfig({
      id: "valid",
      pattern: "test",
      kind: "note",
      importance: "long-term",
      template: "test",
    });
    expect(errors).toEqual([]);
  });

  it("catches missing id", () => {
    const errors = validateRuleConfig({
      id: "",
      pattern: "test",
      kind: "note",
      importance: "long-term",
      template: "test",
    });
    expect(errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("catches invalid kind", () => {
    const errors = validateRuleConfig({
      id: "test",
      pattern: "test",
      kind: "invalid" as never,
      importance: "long-term",
      template: "test",
    });
    expect(errors.some((e) => e.includes("kind"))).toBe(true);
  });

  it("catches invalid importance", () => {
    const errors = validateRuleConfig({
      id: "test",
      pattern: "test",
      kind: "note",
      importance: "invalid" as never,
      template: "test",
    });
    expect(errors.some((e) => e.includes("importance"))).toBe(true);
  });
});
