import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests import Encore primitives (APIError, middleware), so the napi binding
 * needs ENCORE_RUNTIME_LIB. It ships with the Encore CLI; we derive its path from
 * the installed binary so `npm test` runs under plain vitest (fast, no Docker)
 * rather than `encore test` (which provisions infra per run). Falls back to
 * undefined when the CLI is absent, so pure tests still run.
 */
function encoreRuntimeLib(): string | undefined {
  if (process.env.ENCORE_RUNTIME_LIB) return process.env.ENCORE_RUNTIME_LIB;
  try {
    const bin = execSync("which encore", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const real = execSync(`readlink -f "${bin}" 2>/dev/null || echo "${bin}"`).toString().trim();
    const prefix = resolve(dirname(real), "..");
    const candidates = [
      join(prefix, "libexec", "runtimes", "js", "encore-runtime.node"),
      join(prefix, "runtimes", "js", "encore-runtime.node"),
    ];
    return candidates.find((candidate) => existsSync(candidate));
  } catch {
    return undefined;
  }
}

const runtimeLib = encoreRuntimeLib();

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    include: ["**/*.test.ts"],
    exclude: ["node_modules", "encore.gen", "web/build"],
    env: runtimeLib ? { ENCORE_RUNTIME_LIB: runtimeLib } : {},
  },
});
