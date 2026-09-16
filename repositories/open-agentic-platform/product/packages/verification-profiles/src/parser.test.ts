import { describe, expect, it } from "vitest";
import { parseProfileFile, parseSkillFile } from "./parser.js";

const PROFILE_PATH = "/test/profiles/pr.yaml";
const SKILL_PATH = "/test/skills/lint.yaml";

// --- Valid profile YAML ---

const VALID_PROFILE = `
name: pr
description: "Verification profile for pull request workflows"
gate: true
skills:
  - lint
  - type-check
  - unit-tests
`.trim();

const VALID_PROFILE_MINIMAL = `
name: hotfix
gate: false
skills:
  - smoke-test
`.trim();

// --- Valid skill YAML ---

const VALID_SKILL = `
name: lint
description: "Run linting across all source files"
determinism: deterministic
safety_tier: safe
steps:
  - command: "npm run lint"
    timeout: 120
    read_only: true
    network: deny
  - command: "npm run lint:styles"
    timeout: 60
    read_only: true
    network: deny
`.trim();

const VALID_SKILL_CAUTIOUS = `
name: security-scan
description: "Run dependency and code security scanning"
determinism: mostly_deterministic
safety_tier: cautious
steps:
  - command: "npm audit --audit-level=high"
    timeout: 180
    read_only: true
    network: allow
`.trim();

// --- Profile parsing ---

describe("parseProfileFile", () => {
  it("parses a valid profile with all fields", () => {
    const result = parseProfileFile(VALID_PROFILE, PROFILE_PATH);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.profile).not.toBeNull();
    expect(result.profile!.name).toBe("pr");
    expect(result.profile!.description).toBe("Verification profile for pull request workflows");
    expect(result.profile!.gate).toBe(true);
    expect(result.profile!.skills).toEqual(["lint", "type-check", "unit-tests"]);
  });

  it("parses a minimal profile (no description)", () => {
    const result = parseProfileFile(VALID_PROFILE_MINIMAL, PROFILE_PATH);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.profile).not.toBeNull();
    expect(result.profile!.name).toBe("hotfix");
    expect(result.profile!.description).toBeUndefined();
    expect(result.profile!.gate).toBe(false);
    expect(result.profile!.skills).toEqual(["smoke-test"]);
  });

  it("rejects invalid YAML syntax with line number", () => {
    const bad = "name: pr\nskills:\n  - lint\n  bad: [unclosed";
    const result = parseProfileFile(bad, PROFILE_PATH);
    expect(result.profile).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].code).toBe("VP_YAML_PARSE_ERROR");
    expect(result.diagnostics[0].filePath).toBe(PROFILE_PATH);
    // yaml library should provide a line number
    expect(result.diagnostics[0].line).toBeDefined();
  });

  it("rejects non-object YAML (array)", () => {
    const result = parseProfileFile("- item1\n- item2", PROFILE_PATH);
    expect(result.profile).toBeNull();
    expect(result.diagnostics[0].code).toBe("VP_YAML_NOT_OBJECT");
  });

  it("rejects null/empty YAML", () => {
    const result = parseProfileFile("", PROFILE_PATH);
    expect(result.profile).toBeNull();
    expect(result.diagnostics[0].code).toBe("VP_YAML_NOT_OBJECT");
  });

  it("rejects profile missing name", () => {
    const yaml = "gate: true\nskills:\n  - lint";
    const result = parseProfileFile(yaml, PROFILE_PATH);
    expect(result.profile).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_PROFILE_MISSING_NAME")).toBe(true);
  });

  it("rejects profile missing gate", () => {
    const yaml = "name: pr\nskills:\n  - lint";
    const result = parseProfileFile(yaml, PROFILE_PATH);
    expect(result.profile).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_PROFILE_MISSING_GATE")).toBe(true);
  });

  it("rejects profile missing skills", () => {
    const yaml = "name: pr\ngate: true";
    const result = parseProfileFile(yaml, PROFILE_PATH);
    expect(result.profile).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_PROFILE_MISSING_SKILLS")).toBe(true);
  });

  it("rejects profile with empty skills array", () => {
    const yaml = "name: pr\ngate: true\nskills: []";
    const result = parseProfileFile(yaml, PROFILE_PATH);
    expect(result.profile).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_PROFILE_EMPTY_SKILLS")).toBe(true);
  });

  it("rejects profile with non-string skill reference", () => {
    const yaml = "name: pr\ngate: true\nskills:\n  - 123";
    const result = parseProfileFile(yaml, PROFILE_PATH);
    expect(result.profile).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_PROFILE_BAD_SKILL_REF")).toBe(true);
  });

  it("includes file path in all diagnostics", () => {
    const yaml = "gate: true";
    const result = parseProfileFile(yaml, PROFILE_PATH);
    for (const d of result.diagnostics) {
      expect(d.filePath).toBe(PROFILE_PATH);
    }
  });
});

// --- Skill parsing ---

describe("parseSkillFile", () => {
  it("parses a valid skill with multiple steps", () => {
    const result = parseSkillFile(VALID_SKILL, SKILL_PATH);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.skill).not.toBeNull();
    expect(result.skill!.name).toBe("lint");
    expect(result.skill!.description).toBe("Run linting across all source files");
    expect(result.skill!.determinism).toBe("deterministic");
    expect(result.skill!.safety_tier).toBe("safe");
    expect(result.skill!.steps).toHaveLength(2);
    expect(result.skill!.steps[0]).toEqual({
      command: "npm run lint",
      timeout: 120,
      read_only: true,
      network: "deny",
    });
    expect(result.skill!.steps[1]).toEqual({
      command: "npm run lint:styles",
      timeout: 60,
      read_only: true,
      network: "deny",
    });
  });

  it("parses a cautious skill", () => {
    const result = parseSkillFile(VALID_SKILL_CAUTIOUS, SKILL_PATH);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.skill!.determinism).toBe("mostly_deterministic");
    expect(result.skill!.safety_tier).toBe("cautious");
    expect(result.skill!.steps[0].network).toBe("allow");
  });

  it("rejects skill missing name", () => {
    const yaml = `description: "x"\ndeterminism: deterministic\nsafety_tier: safe\nsteps:\n  - command: "echo"\n    timeout: 10\n    read_only: true\n    network: deny`;
    const result = parseSkillFile(yaml, SKILL_PATH);
    expect(result.skill).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_SKILL_MISSING_NAME")).toBe(true);
  });

  it("rejects skill missing description", () => {
    const yaml = `name: lint\ndeterminism: deterministic\nsafety_tier: safe\nsteps:\n  - command: "echo"\n    timeout: 10\n    read_only: true\n    network: deny`;
    const result = parseSkillFile(yaml, SKILL_PATH);
    expect(result.skill).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_SKILL_MISSING_DESCRIPTION")).toBe(true);
  });

  it("rejects invalid determinism value", () => {
    const yaml = `name: lint\ndescription: "x"\ndeterminism: random\nsafety_tier: safe\nsteps:\n  - command: "echo"\n    timeout: 10\n    read_only: true\n    network: deny`;
    const result = parseSkillFile(yaml, SKILL_PATH);
    expect(result.skill).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_SKILL_BAD_DETERMINISM")).toBe(true);
  });

  it("rejects invalid safety_tier value", () => {
    const yaml = `name: lint\ndescription: "x"\ndeterminism: deterministic\nsafety_tier: yolo\nsteps:\n  - command: "echo"\n    timeout: 10\n    read_only: true\n    network: deny`;
    const result = parseSkillFile(yaml, SKILL_PATH);
    expect(result.skill).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_SKILL_BAD_SAFETY_TIER")).toBe(true);
  });

  it("rejects skill with empty steps", () => {
    const yaml = `name: lint\ndescription: "x"\ndeterminism: deterministic\nsafety_tier: safe\nsteps: []`;
    const result = parseSkillFile(yaml, SKILL_PATH);
    expect(result.skill).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_SKILL_EMPTY_STEPS")).toBe(true);
  });

  it("rejects step missing command", () => {
    const yaml = `name: lint\ndescription: "x"\ndeterminism: deterministic\nsafety_tier: safe\nsteps:\n  - timeout: 10\n    read_only: true\n    network: deny`;
    const result = parseSkillFile(yaml, SKILL_PATH);
    expect(result.skill).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_STEP_MISSING_COMMAND")).toBe(true);
  });

  it("rejects step with non-positive timeout", () => {
    const yaml = `name: lint\ndescription: "x"\ndeterminism: deterministic\nsafety_tier: safe\nsteps:\n  - command: "echo"\n    timeout: 0\n    read_only: true\n    network: deny`;
    const result = parseSkillFile(yaml, SKILL_PATH);
    expect(result.skill).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_STEP_BAD_TIMEOUT")).toBe(true);
  });

  it("rejects step missing read_only", () => {
    const yaml = `name: lint\ndescription: "x"\ndeterminism: deterministic\nsafety_tier: safe\nsteps:\n  - command: "echo"\n    timeout: 10\n    network: deny`;
    const result = parseSkillFile(yaml, SKILL_PATH);
    expect(result.skill).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_STEP_MISSING_READ_ONLY")).toBe(true);
  });

  it("rejects step with invalid network policy", () => {
    const yaml = `name: lint\ndescription: "x"\ndeterminism: deterministic\nsafety_tier: safe\nsteps:\n  - command: "echo"\n    timeout: 10\n    read_only: true\n    network: maybe`;
    const result = parseSkillFile(yaml, SKILL_PATH);
    expect(result.skill).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "VP_STEP_BAD_NETWORK")).toBe(true);
  });

  it("reports multiple step errors at once", () => {
    const yaml = `name: lint\ndescription: "x"\ndeterminism: deterministic\nsafety_tier: safe\nsteps:\n  - timeout: -1\n    network: nope`;
    const result = parseSkillFile(yaml, SKILL_PATH);
    expect(result.skill).toBeNull();
    // Should have errors for command, timeout, read_only, and network
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects invalid YAML with line info", () => {
    const bad = "name: lint\nsteps:\n  - command: [unclosed";
    const result = parseSkillFile(bad, SKILL_PATH);
    expect(result.skill).toBeNull();
    expect(result.diagnostics[0].code).toBe("VP_YAML_PARSE_ERROR");
    expect(result.diagnostics[0].filePath).toBe(SKILL_PATH);
  });

  it("includes file path in all diagnostics", () => {
    const yaml = "name: 123";
    const result = parseSkillFile(yaml, SKILL_PATH);
    for (const d of result.diagnostics) {
      expect(d.filePath).toBe(SKILL_PATH);
    }
  });
});
