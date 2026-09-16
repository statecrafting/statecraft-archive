import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkillLibrary, resolveSkillRef, type SkillLibrary } from "./loader.js";
import { getDefaultSkills } from "./defaults.js";

const VALID_SKILL_YAML = `
name: custom-lint
description: "Custom project linter"
determinism: deterministic
safety_tier: safe
steps:
  - command: "./lint.sh"
    timeout: 60
    read_only: true
    network: deny
`.trim();

const VALID_SKILL_B_YAML = `
name: security-scan
description: "Run security scanner"
determinism: non_deterministic
safety_tier: cautious
steps:
  - command: "npm audit"
    timeout: 120
    read_only: true
    network: allow
`.trim();

/** A local skill with the same name as a platform default — should override. */
const OVERRIDE_LINT_YAML = `
name: lint
description: "Project-specific lint override"
determinism: deterministic
safety_tier: safe
steps:
  - command: "./custom-lint.sh"
    timeout: 90
    read_only: true
    network: deny
`.trim();

const INVALID_SKILL_YAML = `
name: bad
description: "Missing required fields"
`.trim();

const DUPLICATE_SKILL_YAML = `
name: custom-lint
description: "Duplicate of custom-lint"
determinism: deterministic
safety_tier: safe
steps:
  - command: "echo dup"
    timeout: 10
    read_only: true
    network: deny
`.trim();

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "vp-loader-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeSkill(filename: string, content: string): Promise<void> {
  const skillsDir = join(tempDir, ".verification", "skills");
  await mkdir(skillsDir, { recursive: true });
  await writeFile(join(skillsDir, filename), content, "utf-8");
}

describe("getDefaultSkills", () => {
  it("returns bundled platform defaults", () => {
    const defaults = getDefaultSkills();
    expect(defaults.size).toBe(5);
    expect(defaults.has("lint")).toBe(true);
    expect(defaults.has("type-check")).toBe(true);
    expect(defaults.has("unit-tests")).toBe(true);
    expect(defaults.has("security-scan")).toBe(true);
    expect(defaults.has("license-check")).toBe(true);

    const lint = defaults.get("lint")!;
    expect(lint.determinism).toBe("deterministic");
    expect(lint.safety_tier).toBe("safe");
    expect(lint.steps.length).toBeGreaterThan(0);
  });
});

describe("loadSkillLibrary", () => {
  it("returns only defaults when no .verification/skills/ directory exists", async () => {
    const lib = await loadSkillLibrary(tempDir);
    expect(lib.diagnostics).toHaveLength(0);
    expect(lib.skills.size).toBe(5); // 5 platform defaults
    expect(lib.skills.has("lint")).toBe(true);
  });

  it("returns only defaults when .verification/skills/ is empty", async () => {
    await mkdir(join(tempDir, ".verification", "skills"), { recursive: true });
    const lib = await loadSkillLibrary(tempDir);
    expect(lib.diagnostics).toHaveLength(0);
    expect(lib.skills.size).toBe(5);
  });

  it("discovers and parses local .yaml skill files", async () => {
    await writeSkill("custom-lint.yaml", VALID_SKILL_YAML);
    await writeSkill("security-scan.yaml", VALID_SKILL_B_YAML);

    const lib = await loadSkillLibrary(tempDir);
    expect(lib.diagnostics).toHaveLength(0);
    // 5 defaults + 2 local, with local security-scan overriding bundled one
    expect(lib.skills.size).toBe(6);
    expect(lib.skills.has("custom-lint")).toBe(true);
    expect(lib.skills.has("security-scan")).toBe(true);
    expect(lib.skills.get("custom-lint")!.steps[0].command).toBe("./lint.sh");
  });

  it("discovers .yml files alongside .yaml files", async () => {
    await writeSkill("custom-lint.yml", VALID_SKILL_YAML);

    const lib = await loadSkillLibrary(tempDir);
    expect(lib.diagnostics).toHaveLength(0);
    expect(lib.skills.has("custom-lint")).toBe(true);
  });

  it("ignores non-YAML files in skills directory", async () => {
    await writeSkill("README.md", "# not a skill");
    await writeSkill("custom-lint.yaml", VALID_SKILL_YAML);

    const lib = await loadSkillLibrary(tempDir);
    expect(lib.diagnostics).toHaveLength(0);
    // 5 defaults + 1 local (README.md ignored)
    expect(lib.skills.size).toBe(6);
  });

  it("local skill overrides platform default with same name (R-004)", async () => {
    await writeSkill("lint.yaml", OVERRIDE_LINT_YAML);

    const lib = await loadSkillLibrary(tempDir);
    expect(lib.diagnostics).toHaveLength(0);
    // Still 5 skills — local "lint" replaced default "lint"
    expect(lib.skills.size).toBe(5);
    const lint = lib.skills.get("lint")!;
    expect(lint.description).toBe("Project-specific lint override");
    expect(lint.steps[0].command).toBe("./custom-lint.sh");
  });

  it("reports diagnostics for invalid skill files without blocking others", async () => {
    await writeSkill("bad.yaml", INVALID_SKILL_YAML);
    await writeSkill("good.yaml", VALID_SKILL_YAML);

    const lib = await loadSkillLibrary(tempDir);
    // bad.yaml produces validation diagnostics
    expect(lib.diagnostics.length).toBeGreaterThan(0);
    expect(lib.diagnostics.some((d) => d.filePath.includes("bad.yaml"))).toBe(true);
    // good skill still loaded
    expect(lib.skills.has("custom-lint")).toBe(true);
  });

  it("warns on duplicate local skill names", async () => {
    await writeSkill("a-custom.yaml", VALID_SKILL_YAML);
    await writeSkill("b-duplicate.yaml", DUPLICATE_SKILL_YAML);

    const lib = await loadSkillLibrary(tempDir);
    const dupWarnings = lib.diagnostics.filter(
      (d) => d.code === "VP_SKILL_DUPLICATE_NAME",
    );
    expect(dupWarnings).toHaveLength(1);
    expect(dupWarnings[0].severity).toBe("warning");
    expect(dupWarnings[0].message).toContain("custom-lint");
    // The later file (b-duplicate.yaml) wins since files are sorted alphabetically
    expect(lib.skills.get("custom-lint")!.steps[0].command).toBe("echo dup");
  });
});

describe("resolveSkillRef", () => {
  let library: SkillLibrary;

  beforeEach(() => {
    library = {
      skills: new Map([
        [
          "lint",
          {
            name: "lint",
            description: "Lint",
            determinism: "deterministic" as const,
            safety_tier: "safe" as const,
            steps: [
              { command: "npm run lint", timeout: 60, read_only: true, network: "deny" as const },
            ],
          },
        ],
      ]),
      diagnostics: [],
    };
  });

  it("resolves an existing skill by name", () => {
    const result = resolveSkillRef("lint", library);
    expect(result.skill).not.toBeNull();
    expect(result.skill!.name).toBe("lint");
    expect(result.diagnostic).toBeNull();
  });

  it("returns diagnostic for missing skill", () => {
    const result = resolveSkillRef("nonexistent", library);
    expect(result.skill).toBeNull();
    expect(result.diagnostic).not.toBeNull();
    expect(result.diagnostic!.code).toBe("VP_SKILL_NOT_FOUND");
    expect(result.diagnostic!.message).toContain("nonexistent");
    expect(result.diagnostic!.message).toContain("lint"); // lists available
  });

  it("returns diagnostic listing available skills when not found", () => {
    library.skills.set("type-check", {
      name: "type-check",
      description: "TC",
      determinism: "deterministic",
      safety_tier: "safe",
      steps: [{ command: "tsc", timeout: 60, read_only: true, network: "deny" }],
    });

    const result = resolveSkillRef("missing", library);
    expect(result.diagnostic!.message).toContain("lint");
    expect(result.diagnostic!.message).toContain("type-check");
  });

  it("returns empty available list for empty library", () => {
    const emptyLib: SkillLibrary = { skills: new Map(), diagnostics: [] };
    const result = resolveSkillRef("anything", emptyLib);
    expect(result.diagnostic!.message).toContain("(none)");
  });
});
