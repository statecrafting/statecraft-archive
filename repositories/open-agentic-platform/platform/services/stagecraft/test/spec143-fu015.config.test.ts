// Spec 143 FU-015 — three static assertions pinning the OOM-fix
// configuration. See spec 143 §13 2026-05-10 ~07:48 UTC for the
// V8-heap-vs-cgroup root cause and the budget math behind the values.
//
// These assertions are deliberately NOT a load harness — they catch
// regressions where someone removes the literal cap or rolls back the
// chart values. A real batch-load harness is FU-020 (optional).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const EXTRACTION_WORKER = resolve(
  REPO_ROOT,
  "platform/services/statecraft/api/knowledge/extractionWorker.ts",
);
const VALUES_YAML = resolve(
  REPO_ROOT,
  "platform/charts/statecraft/values.yaml",
);

function normalizeMemoryToMiB(s: string): number {
  // K8s resource units: Ki/Mi/Gi (binary) or K/M/G (decimal). Spec 143
  // values use binary; reject decimal forms loudly so a future Gi → G
  // edit doesn't silently halve the limit.
  const m = s.trim().match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)?$/);
  if (!m) {
    throw new Error(
      `unparseable memory string: ${JSON.stringify(s)} (expected NN Ki|Mi|Gi)`,
    );
  }
  const value = Number(m[1]);
  switch (m[2]) {
    case "Gi":
      return value * 1024;
    case "Mi":
      return value;
    case "Ki":
      return value / 1024;
    case "Ti":
      return value * 1024 * 1024;
    default:
      throw new Error(
        `memory unit required (Ki|Mi|Gi|Ti); got: ${JSON.stringify(s)}`,
      );
  }
}

describe("spec 143 FU-015 — OOM-fix configuration assertions", () => {
  it("(i) extractionWorker.ts pins a literal-integer maxConcurrency in 1..8", () => {
    // Encore's Subscription parser accepts ONLY a literal integer for
    // maxConcurrency. The value bounds extraction fan-out memory under
    // FR-006 batch load (per-worker peak ~44MB worst-case; 4 × 44 =
    // 176MB extraction-side ceiling). Lower bound 1 catches accidental
    // removal; upper bound 8 catches over-eager raises that approach
    // V8's 896MB old-space ceiling without empirical evidence (FU-020).
    const src = readFileSync(EXTRACTION_WORKER, "utf-8");
    const match = src.match(/maxConcurrency:\s*(\d+)\b/);
    expect(
      match,
      "extractionWorker.ts must declare a literal-integer maxConcurrency in the Subscription config",
    ).not.toBeNull();
    const value = Number(match![1]);
    expect(value, "maxConcurrency must be ≥ 1 (zero would deadlock)").toBeGreaterThanOrEqual(1);
    expect(
      value,
      "maxConcurrency > 8 needs FU-020 empirical headroom evidence first",
    ).toBeLessThanOrEqual(8);
  });

  it("(ii) values.yaml resources.limits.memory is ≥ 1Gi", () => {
    // Spec 143 §13 2026-05-10 ~07:48 UTC. 512Mi was empirically
    // insufficient under FR-006 batch load.
    const yaml = readFileSync(VALUES_YAML, "utf-8");
    const parsed = parseYaml(yaml) as {
      resources?: { limits?: { memory?: string } };
    };
    const memStr = parsed?.resources?.limits?.memory;
    expect(memStr, "resources.limits.memory must be set in values.yaml").toBeTruthy();
    const memMiB = normalizeMemoryToMiB(memStr!);
    expect(
      memMiB,
      "memory limit must be ≥ 1Gi (1024 MiB) per FU-015",
    ).toBeGreaterThanOrEqual(1024);
  });

  it("(iii) values.yaml nodeOptions sets --max-old-space-size=N with 256 ≤ N ≤ (memMiB - 64)", () => {
    // V8's default ~256MB old-space is what crashed (exit 139) on
    // 2026-05-10 06:58:55Z. Lower bound 256 means "must actually move
    // the V8 ceiling beyond the default." Upper bound (memMiB - 64)
    // ensures a non-degenerate reserve for V8 internals + Node runtime
    // + off-heap buffers + OS — 64 MiB is the absolute floor; the
    // 1Gi/896MB pair carries 128 MiB which is the documented target.
    const yaml = readFileSync(VALUES_YAML, "utf-8");
    const parsed = parseYaml(yaml) as {
      nodeOptions?: string;
      resources?: { limits?: { memory?: string } };
    };
    const nodeOpts = parsed?.nodeOptions;
    expect(nodeOpts, "values.yaml must set nodeOptions per FU-015").toBeTruthy();
    const sizeMatch = nodeOpts!.match(/--max-old-space-size=(\d+)/);
    expect(
      sizeMatch,
      "nodeOptions must include --max-old-space-size=N (where N is MiB)",
    ).not.toBeNull();
    const oldSpaceMiB = Number(sizeMatch![1]);
    expect(oldSpaceMiB).toBeGreaterThanOrEqual(256);
    const memStr = parsed?.resources?.limits?.memory;
    expect(memStr, "resources.limits.memory must be set to bound the upper limit").toBeTruthy();
    const cgroupMiB = normalizeMemoryToMiB(memStr!);
    expect(
      oldSpaceMiB,
      `old-space ${oldSpaceMiB}MiB leaves <64MiB reserve under cgroup ${cgroupMiB}MiB; raise cgroup or lower old-space`,
    ).toBeLessThanOrEqual(cgroupMiB - 64);
  });
});
