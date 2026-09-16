import { spawn } from "node:child_process";
import type {
  VerificationStep,
  VerificationSkill,
  VerificationProfile,
  StepResult,
  SkillResult,
  ProfileResult,
} from "./types.js";
import type { SkillLibrary } from "./loader.js";
import { resolveSkillRef } from "./loader.js";

/** Options for skill/profile execution. */
export interface ExecutionOptions {
  /** Working directory for spawned commands. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Extra environment variables merged with `process.env`. */
  env?: Record<string, string>;
  /** Grace period in ms after SIGTERM before SIGKILL. Default: 5000. */
  killGraceMs?: number;
}

const DEFAULT_KILL_GRACE_MS = 5000;

/**
 * Execute a single verification step via `child_process.spawn`.
 *
 * - Enforces `timeout` (seconds) via SIGTERM → SIGKILL after grace period.
 * - `network: "deny"` sets `NO_PROXY=*` as advisory hint (R-005: best-effort on macOS).
 * - `read_only` is advisory — logged but not enforced at OS level.
 */
export async function executeStep(
  step: VerificationStep,
  opts?: ExecutionOptions,
): Promise<StepResult> {
  const cwd = opts?.cwd ?? process.cwd();
  const killGraceMs = opts?.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const timeoutMs = step.timeout * 1000;

  const env: Record<string, string | undefined> = { ...process.env, ...opts?.env };
  if (step.network === "deny") {
    env["NO_PROXY"] = "*";
    env["no_proxy"] = "*";
  }

  return new Promise<StepResult>((resolve) => {
    const start = Date.now();
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const child = spawn(step.command, {
      shell: true,
      cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, killGraceMs);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      const durationMs = Date.now() - start;
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const exitCode = code;
      const passed = !timedOut && code === 0;

      resolve({
        command: step.command,
        exitCode,
        passed,
        durationMs,
        timedOut,
        stdout,
        stderr,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      resolve({
        command: step.command,
        exitCode: null,
        passed: false,
        durationMs: Date.now() - start,
        timedOut: false,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: err.message,
      });
    });
  });
}

/**
 * Execute all steps in a skill sequentially.
 * Stops at the first failing step (FR-007: skills fail fast).
 */
export async function executeSkill(
  skill: VerificationSkill,
  opts?: ExecutionOptions,
): Promise<SkillResult> {
  const start = Date.now();
  const steps: StepResult[] = [];

  for (const step of skill.steps) {
    const result = await executeStep(step, opts);
    steps.push(result);
    if (!result.passed) {
      break;
    }
  }

  return {
    name: skill.name,
    passed: steps.every((s) => s.passed),
    steps,
    durationMs: Date.now() - start,
  };
}

/**
 * Execute an entire verification profile: resolve skill refs, run skills in order.
 *
 * - Skills run in declared order (FR-007).
 * - If `profile.gate` is true, a failed skill records in `failedSkills` but execution
 *   continues through remaining skills to produce a complete report.
 * - Returns `ProfileResult` with `passed` reflecting the gate decision.
 */
export async function executeProfile(
  profile: VerificationProfile,
  library: SkillLibrary,
  opts?: ExecutionOptions,
): Promise<ProfileResult> {
  const start = Date.now();
  const skills: SkillResult[] = [];
  const failedSkills: string[] = [];
  const resolutionErrors: string[] = [];

  // Resolve all skill refs first so resolution errors surface before execution.
  const resolvedSkills: VerificationSkill[] = [];
  for (const name of profile.skills) {
    const { skill, diagnostic } = resolveSkillRef(name, library);
    if (!skill) {
      resolutionErrors.push(diagnostic?.message ?? `Skill "${name}" not found.`);
      failedSkills.push(name);
    } else {
      resolvedSkills.push(skill);
    }
  }

  // If any skill reference failed to resolve, the profile fails.
  if (resolutionErrors.length > 0) {
    return {
      profile: profile.name,
      passed: false,
      skills,
      failedSkills,
      durationMs: Date.now() - start,
    };
  }

  for (const skill of resolvedSkills) {
    const result = await executeSkill(skill, opts);
    skills.push(result);
    if (!result.passed) {
      failedSkills.push(skill.name);
    }
  }

  const passed = failedSkills.length === 0;

  return {
    profile: profile.name,
    passed,
    skills,
    failedSkills,
    durationMs: Date.now() - start,
  };
}
