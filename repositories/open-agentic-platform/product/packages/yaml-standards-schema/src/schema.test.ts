import { describe, it, expect } from "vitest";
import { validateStandardObject } from "./schema.js";

const VALID_STANDARD = {
  id: "error-handling-001",
  category: "error-handling",
  priority: "high",
  status: "active",
  context: "Applies to async TypeScript code.",
  tags: ["typescript", "async"],
  rules: [
    { verb: "ALWAYS", subject: "wrap async in try/catch", rationale: "Prevents unhandled rejections." },
  ],
  anti_patterns: [
    { pattern: "catch (e) {}", correction: "catch (e) { logger.error(e); }" },
  ],
  examples: [
    { good: "try { await f(); } catch (e) { handle(e); }", bad: "await f();", explanation: "Explicit error handling." },
  ],
};

describe("validateStandardObject", () => {
  it("returns no diagnostics for a valid standard", () => {
    const diags = validateStandardObject({ ...VALID_STANDARD }, "test.yaml");
    expect(diags).toHaveLength(0);
  });

  it("requires id", () => {
    const diags = validateStandardObject({ ...VALID_STANDARD, id: "" }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_MISSING_ID")).toBe(true);
  });

  it("requires kebab-case id", () => {
    const diags = validateStandardObject({ ...VALID_STANDARD, id: "Error_Handling" }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_BAD_ID")).toBe(true);
  });

  it("requires category", () => {
    const diags = validateStandardObject({ ...VALID_STANDARD, category: undefined }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_MISSING_CATEGORY")).toBe(true);
  });

  it("requires valid priority", () => {
    const diags = validateStandardObject({ ...VALID_STANDARD, priority: "urgent" }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_BAD_PRIORITY")).toBe(true);
  });

  it("rejects invalid status", () => {
    const diags = validateStandardObject({ ...VALID_STANDARD, status: "bogus" }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_BAD_STATUS")).toBe(true);
  });

  it("allows omitted status", () => {
    const { status, ...rest } = VALID_STANDARD;
    const diags = validateStandardObject(rest, "test.yaml");
    expect(diags).toHaveLength(0);
  });

  it("requires at least one rule", () => {
    const diags = validateStandardObject({ ...VALID_STANDARD, rules: [] }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_EMPTY_RULES")).toBe(true);
  });

  it("requires rules to be an array", () => {
    const diags = validateStandardObject({ ...VALID_STANDARD, rules: "not-array" }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_MISSING_RULES")).toBe(true);
  });

  it("validates rule verb", () => {
    const diags = validateStandardObject({
      ...VALID_STANDARD,
      rules: [{ verb: "SOMETIMES", subject: "x", rationale: "y" }],
    }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_RULE_BAD_VERB")).toBe(true);
  });

  it("validates all five verbs", () => {
    const verbs = ["ALWAYS", "NEVER", "USE", "PREFER", "AVOID"] as const;
    for (const verb of verbs) {
      const diags = validateStandardObject({
        ...VALID_STANDARD,
        rules: [{ verb, subject: "test subject", rationale: "test rationale" }],
      }, "test.yaml");
      expect(diags).toHaveLength(0);
    }
  });

  it("requires rule subject and rationale", () => {
    const diags = validateStandardObject({
      ...VALID_STANDARD,
      rules: [{ verb: "ALWAYS", subject: "", rationale: "" }],
    }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_RULE_MISSING_SUBJECT")).toBe(true);
    expect(diags.some((d) => d.code === "CS_RULE_MISSING_RATIONALE")).toBe(true);
  });

  it("validates anti_pattern fields", () => {
    const diags = validateStandardObject({
      ...VALID_STANDARD,
      anti_patterns: [{ pattern: "", correction: "" }],
    }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_ANTI_PATTERN_MISSING_PATTERN")).toBe(true);
    expect(diags.some((d) => d.code === "CS_ANTI_PATTERN_MISSING_CORRECTION")).toBe(true);
  });

  it("validates example fields", () => {
    const diags = validateStandardObject({
      ...VALID_STANDARD,
      examples: [{ good: "", bad: "", explanation: "" }],
    }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_EXAMPLE_MISSING_GOOD")).toBe(true);
    expect(diags.some((d) => d.code === "CS_EXAMPLE_MISSING_BAD")).toBe(true);
    expect(diags.some((d) => d.code === "CS_EXAMPLE_MISSING_EXPLANATION")).toBe(true);
  });

  it("rejects non-string tags", () => {
    const diags = validateStandardObject({
      ...VALID_STANDARD,
      tags: [123],
    }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_BAD_TAG_ENTRY")).toBe(true);
  });

  it("rejects non-object rules", () => {
    const diags = validateStandardObject({
      ...VALID_STANDARD,
      rules: ["not-an-object"],
    }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_BAD_RULE")).toBe(true);
  });

  it("rejects non-object anti_patterns", () => {
    const diags = validateStandardObject({
      ...VALID_STANDARD,
      anti_patterns: ["not-an-object"],
    }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_BAD_ANTI_PATTERN")).toBe(true);
  });

  it("rejects non-object examples", () => {
    const diags = validateStandardObject({
      ...VALID_STANDARD,
      examples: ["not-an-object"],
    }, "test.yaml");
    expect(diags.some((d) => d.code === "CS_BAD_EXAMPLE")).toBe(true);
  });

  it("includes filePath in all diagnostics", () => {
    const diags = validateStandardObject({}, "my/path.yaml");
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) {
      expect(d.filePath).toBe("my/path.yaml");
    }
  });
});
