import { describe, it, expect } from "vitest";
import { executeStep, executeSkill, executeProfile } from "./runner.js";
import type { VerificationStep, VerificationSkill, VerificationProfile } from "./types.js";
import type { SkillLibrary } from "./loader.js";

// --- Helpers ---

function makeStep(overrides: Partial<VerificationStep> = {}): VerificationStep {
  return {
    command: 'echo "hello"',
    timeout: 10,
    read_only: true,
    network: "deny",
    ...overrides,
  };
}

function makeSkill(overrides: Partial<VerificationSkill> & { steps?: VerificationStep[] } = {}): VerificationSkill {
  return {
    name: "test-skill",
    description: "A test skill",
    determinism: "deterministic",
    safety_tier: "safe",
    steps: [makeStep()],
    ...overrides,
  };
}

function makeLibrary(skills: VerificationSkill[]): SkillLibrary {
  const map = new Map<string, VerificationSkill>();
  for (const s of skills) map.set(s.name, s);
  return { skills: map, diagnostics: [] };
}

// --- executeStep ---

describe("executeStep", () => {
  it("captures stdout and exit code 0 on success", async () => {
    const step = makeStep({ command: 'echo "ok"' });
    const result = await executeStep(step);
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).toBe("ok");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures stderr and non-zero exit code on failure", async () => {
    const step = makeStep({ command: 'echo "err" >&2 && exit 1' });
    const result = await executeStep(step);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.stderr.trim()).toBe("err");
  });

  it("kills process on timeout and marks timedOut", async () => {
    const step = makeStep({ command: "sleep 30", timeout: 0.3 });
    const result = await executeStep(step, { killGraceMs: 200 });
    expect(result.passed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(5000);
  });

  it("sets NO_PROXY when network is deny (advisory, R-005)", async () => {
    // Verify NO_PROXY is set by echoing it from the child process
    const step = makeStep({ command: 'echo "$NO_PROXY"', network: "deny" });
    const result = await executeStep(step);
    expect(result.passed).toBe(true);
    expect(result.stdout.trim()).toBe("*");
  });

  it("does not set NO_PROXY when network is allow", async () => {
    const step = makeStep({ command: 'echo "${NO_PROXY:-unset}"', network: "allow" });
    const result = await executeStep(step, { env: {} });
    expect(result.passed).toBe(true);
    // Should not be "*" — either inherited or "unset"
    expect(result.stdout.trim()).not.toBe("*");
  });

  it("uses provided cwd", async () => {
    const step = makeStep({ command: "pwd" });
    const result = await executeStep(step, { cwd: "/tmp" });
    expect(result.passed).toBe(true);
    // macOS /tmp is a symlink to /private/tmp
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });

  it("handles spawn error for non-existent command", async () => {
    const step = makeStep({ command: "__nonexistent_command_xyz__" });
    const result = await executeStep(step);
    expect(result.passed).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });
});

// --- executeSkill ---

describe("executeSkill", () => {
  it("runs all steps sequentially when all pass", async () => {
    const skill = makeSkill({
      steps: [
        makeStep({ command: 'echo "step1"' }),
        makeStep({ command: 'echo "step2"' }),
      ],
    });
    const result = await executeSkill(skill);
    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].stdout.trim()).toBe("step1");
    expect(result.steps[1].stdout.trim()).toBe("step2");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("stops at first failing step", async () => {
    const skill = makeSkill({
      steps: [
        makeStep({ command: 'echo "ok"' }),
        makeStep({ command: "exit 1" }),
        makeStep({ command: 'echo "should not run"' }),
      ],
    });
    const result = await executeSkill(skill);
    expect(result.passed).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.name).toBe("test-skill");
  });

  it("stops at timed-out step", async () => {
    const skill = makeSkill({
      steps: [
        makeStep({ command: "sleep 30", timeout: 0.3 }),
        makeStep({ command: 'echo "after"' }),
      ],
    });
    const result = await executeSkill(skill, { killGraceMs: 200 });
    expect(result.passed).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].timedOut).toBe(true);
  });
});

// --- executeProfile ---

describe("executeProfile", () => {
  it("runs all skills and reports pass when all succeed", async () => {
    const s1 = makeSkill({ name: "s1", steps: [makeStep({ command: 'echo "a"' })] });
    const s2 = makeSkill({ name: "s2", steps: [makeStep({ command: 'echo "b"' })] });
    const profile: VerificationProfile = {
      name: "pr",
      gate: true,
      skills: ["s1", "s2"],
    };
    const result = await executeProfile(profile, makeLibrary([s1, s2]));
    expect(result.passed).toBe(true);
    expect(result.skills).toHaveLength(2);
    expect(result.failedSkills).toEqual([]);
    expect(result.profile).toBe("pr");
  });

  it("records failed skill in failedSkills and sets passed=false", async () => {
    const passing = makeSkill({ name: "pass", steps: [makeStep({ command: 'echo "ok"' })] });
    const failing = makeSkill({ name: "fail", steps: [makeStep({ command: "exit 1" })] });
    const profile: VerificationProfile = {
      name: "pr",
      gate: true,
      skills: ["pass", "fail"],
    };
    const result = await executeProfile(profile, makeLibrary([passing, failing]));
    expect(result.passed).toBe(false);
    expect(result.failedSkills).toEqual(["fail"]);
    expect(result.skills).toHaveLength(2);
  });

  it("continues executing remaining skills after a failure for complete report", async () => {
    const s1 = makeSkill({ name: "s1", steps: [makeStep({ command: "exit 1" })] });
    const s2 = makeSkill({ name: "s2", steps: [makeStep({ command: 'echo "still runs"' })] });
    const profile: VerificationProfile = {
      name: "release",
      gate: true,
      skills: ["s1", "s2"],
    };
    const result = await executeProfile(profile, makeLibrary([s1, s2]));
    expect(result.passed).toBe(false);
    expect(result.failedSkills).toEqual(["s1"]);
    // Both skills were executed
    expect(result.skills).toHaveLength(2);
    expect(result.skills[1].passed).toBe(true);
  });

  it("fails immediately on unresolved skill reference", async () => {
    const s1 = makeSkill({ name: "s1", steps: [makeStep({ command: 'echo "ok"' })] });
    const profile: VerificationProfile = {
      name: "bad",
      gate: true,
      skills: ["s1", "nonexistent"],
    };
    const result = await executeProfile(profile, makeLibrary([s1]));
    expect(result.passed).toBe(false);
    expect(result.failedSkills).toEqual(["nonexistent"]);
    // No skills were executed because resolution failed
    expect(result.skills).toHaveLength(0);
  });

  it("passes when gate is false even with no skills (edge case)", async () => {
    const profile: VerificationProfile = {
      name: "empty",
      gate: false,
      skills: [],
    };
    const result = await executeProfile(profile, makeLibrary([]));
    expect(result.passed).toBe(true);
    expect(result.skills).toEqual([]);
  });
});
