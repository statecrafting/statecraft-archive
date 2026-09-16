import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluatePostSessionGate, loadProfileDiagnostics } from "./gate.js";

// --- Helpers ---

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "vp-gate-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeProfile(name: string, content: string): Promise<void> {
  const dir = join(tmpDir, ".verification", "profiles");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.yaml`), content, "utf-8");
}

async function writeSkill(name: string, content: string): Promise<void> {
  const dir = join(tmpDir, ".verification", "skills");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.yaml`), content, "utf-8");
}

const passingSkillYaml = `
name: pass-skill
description: "A skill that passes"
determinism: deterministic
safety_tier: safe
steps:
  - command: 'echo "ok"'
    timeout: 10
    read_only: true
    network: deny
`;

const failingSkillYaml = `
name: fail-skill
description: "A skill that fails"
determinism: deterministic
safety_tier: safe
steps:
  - command: 'exit 1'
    timeout: 10
    read_only: true
    network: deny
`;

// --- evaluatePostSessionGate ---

describe("evaluatePostSessionGate", () => {
  it("returns passed=true for a gated profile when all skills pass (FR-004)", async () => {
    await writeSkill("pass-skill", passingSkillYaml);
    await writeProfile("pr", `
name: pr
gate: true
skills:
  - pass-skill
`);

    const result = await evaluatePostSessionGate("pr", tmpDir);
    expect(result.passed).toBe(true);
    expect(result.gated).toBe(true);
    expect(result.profile).toBe("pr");
    expect(result.results).toHaveLength(1);
    expect(result.failedSkills).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns passed=false for a gated profile when a skill fails (FR-004, FR-008)", async () => {
    await writeSkill("pass-skill", passingSkillYaml);
    await writeSkill("fail-skill", failingSkillYaml);
    await writeProfile("pr", `
name: pr
gate: true
skills:
  - pass-skill
  - fail-skill
`);

    const result = await evaluatePostSessionGate("pr", tmpDir);
    expect(result.passed).toBe(false);
    expect(result.gated).toBe(true);
    expect(result.failedSkills).toEqual(["fail-skill"]);
    expect(result.results).toHaveLength(2);
    // First skill passed, second failed — both executed for complete report
    expect(result.results[0].passed).toBe(true);
    expect(result.results[1].passed).toBe(false);
  });

  it("returns passed=true for an ungated profile even when a skill fails (SC-002)", async () => {
    await writeSkill("fail-skill", failingSkillYaml);
    await writeProfile("advisory", `
name: advisory
gate: false
skills:
  - fail-skill
`);

    const result = await evaluatePostSessionGate("advisory", tmpDir);
    expect(result.passed).toBe(true);
    expect(result.gated).toBe(false);
    expect(result.failedSkills).toEqual(["fail-skill"]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].passed).toBe(false);
  });

  it("returns passed=false when profile file is not found", async () => {
    const result = await evaluatePostSessionGate("nonexistent", tmpDir);
    expect(result.passed).toBe(false);
    expect(result.profile).toBe("nonexistent");
    expect(result.results).toEqual([]);
  });

  it("returns passed=false when profile YAML is invalid", async () => {
    await writeProfile("bad", "not: [valid: profile");

    const result = await evaluatePostSessionGate("bad", tmpDir);
    expect(result.passed).toBe(false);
    expect(result.profile).toBe("bad");
  });

  it("returns passed=false when profile references an unknown skill", async () => {
    await writeProfile("broken", `
name: broken
gate: true
skills:
  - nonexistent-skill
`);

    const result = await evaluatePostSessionGate("broken", tmpDir);
    expect(result.passed).toBe(false);
    expect(result.failedSkills).toEqual(["nonexistent-skill"]);
  });

  it("loads .yml profile files as fallback", async () => {
    await writeSkill("pass-skill", passingSkillYaml);
    // Write as .yml instead of .yaml
    const dir = join(tmpDir, ".verification", "profiles");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "alt.yml"), `
name: alt
gate: true
skills:
  - pass-skill
`, "utf-8");

    const result = await evaluatePostSessionGate("alt", tmpDir);
    expect(result.passed).toBe(true);
    expect(result.profile).toBe("alt");
  });

  it("runs multiple skills in order with correct results", async () => {
    await writeSkill("pass-skill", passingSkillYaml);
    const secondPassSkill = `
name: second-pass
description: "Another passing skill"
determinism: deterministic
safety_tier: safe
steps:
  - command: 'echo "second"'
    timeout: 10
    read_only: true
    network: allow
`;
    await writeSkill("second-pass", secondPassSkill);
    await writeProfile("full", `
name: full
gate: true
skills:
  - pass-skill
  - second-pass
`);

    const result = await evaluatePostSessionGate("full", tmpDir);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("pass-skill");
    expect(result.results[1].name).toBe("second-pass");
  });

  it("uses platform default skills when no local skills exist", async () => {
    // Profile references a platform default skill (lint)
    await writeProfile("defaults", `
name: defaults
gate: true
skills:
  - lint
`);

    const result = await evaluatePostSessionGate("defaults", tmpDir);
    // The default 'lint' skill runs 'npm run lint' which will fail in tmpDir (no package.json)
    // but the important thing is that it was resolved from defaults, not treated as not-found
    expect(result.profile).toBe("defaults");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("lint");
  });

  it("respects execution options (cwd)", async () => {
    await writeSkill("pwd-skill", `
name: pwd-skill
description: "Print working directory"
determinism: deterministic
safety_tier: safe
steps:
  - command: 'pwd'
    timeout: 10
    read_only: true
    network: allow
`);
    await writeProfile("cwd-test", `
name: cwd-test
gate: false
skills:
  - pwd-skill
`);

    const result = await evaluatePostSessionGate("cwd-test", tmpDir, { cwd: "/tmp" });
    expect(result.results[0].steps[0].stdout.trim()).toMatch(/\/tmp$/);
  });

  it("uses bundled hotfix profile when no local profile exists", async () => {
    const fastPass = `
name: REPLACE_ME
description: "Fast pass override"
determinism: deterministic
safety_tier: safe
steps:
  - command: 'echo "ok"'
    timeout: 5
    read_only: true
    network: deny
`;
    for (const skillName of ["lint", "type-check", "unit-tests", "security-scan"]) {
      await writeSkill(skillName, fastPass.replace("REPLACE_ME", skillName));
    }

    const result = await evaluatePostSessionGate("hotfix", tmpDir);
    expect(result.profile).toBe("hotfix");
    expect(result.gated).toBe(true);
    // The profile should resolve bundled skills and execute each one.
    expect(result.results.length).toBeGreaterThan(0);
  });
});

// --- loadProfileDiagnostics ---

describe("loadProfileDiagnostics", () => {
  it("returns VP_PROFILE_NOT_FOUND for missing profile", async () => {
    const diags = await loadProfileDiagnostics("missing", tmpDir);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("VP_PROFILE_NOT_FOUND");
    expect(diags[0].message).toContain("missing");
  });

  it("returns empty diagnostics for bundled profiles", async () => {
    const diags = await loadProfileDiagnostics("hotfix", tmpDir);
    expect(diags).toEqual([]);
  });

  it("returns parse diagnostics for invalid profile YAML", async () => {
    await writeProfile("bad", "not: [valid: profile");
    const diags = await loadProfileDiagnostics("bad", tmpDir);
    expect(diags.length).toBeGreaterThan(0);
  });

  it("returns skill-not-found diagnostics for unresolvable references", async () => {
    await writeProfile("refs", `
name: refs
gate: true
skills:
  - nonexistent
`);
    const diags = await loadProfileDiagnostics("refs", tmpDir);
    const notFound = diags.filter((d) => d.code === "VP_SKILL_NOT_FOUND");
    expect(notFound).toHaveLength(1);
    expect(notFound[0].message).toContain("nonexistent");
  });

  it("returns empty diagnostics for a valid profile with resolvable skills", async () => {
    await writeSkill("pass-skill", passingSkillYaml);
    await writeProfile("valid", `
name: valid
gate: true
skills:
  - pass-skill
`);
    const diags = await loadProfileDiagnostics("valid", tmpDir);
    expect(diags).toEqual([]);
  });

  it("uses .yml file path in diagnostics when .yaml is absent", async () => {
    const dir = join(tmpDir, ".verification", "profiles");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "diag.yml"), "name: diag\ngate: true\nskills:\n  - missing\n", "utf-8");

    const diags = await loadProfileDiagnostics("diag", tmpDir);
    const notFound = diags.find((d) => d.code === "VP_SKILL_NOT_FOUND");
    expect(notFound).toBeDefined();
    expect(notFound?.filePath).toMatch(/diag\.yml$/);
  });
});
