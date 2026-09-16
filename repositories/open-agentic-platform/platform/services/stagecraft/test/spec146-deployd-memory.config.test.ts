// Spec 146 — three static assertions pinning the deployd-api memory-fix
// chart configuration. See spec 146 §2.5 for the assertion semantics and
// spec 143 §13 2026-05-10 ~17:00 UTC for the source-read findings that
// reduced FU-021's three-leg template to one load-bearing leg + two
// documented-N/A legs.
//
// Mirror of spec 143 spec143-fu015.config.test.ts in shape, but the
// underlying workload is Rust (axum + hiqlite) — no managed-heap
// env-var, no application-level fan-out surface. Assertions (i) and
// (ii) cover the load-bearing cgroup leg; assertion (iii) is an inverse-
// polarity guard against a future drive-by NODE_OPTIONS edit ("let's add
// it for parity with statecraft-api") that would silently pretend Rust
// has a managed heap to cap.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const VALUES_YAML = resolve(
  REPO_ROOT,
  "platform/charts/deployd-api/values.yaml",
);

function normalizeMemoryToMiB(s: string): number {
  // K8s resource units: Ki/Mi/Gi (binary) or K/M/G (decimal). Spec 146
  // uses binary; reject decimal forms loudly so a future Gi → G edit
  // doesn't silently halve the limit.
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

describe("spec 146 — deployd-api memory-hardening configuration assertions", () => {
  it("(i) values.yaml resources.limits.memory is ≥ 512Mi", () => {
    // Floor below the chart-default 1Gi so a future override that drops
    // to 512Mi for resource-constrained environments still passes; below
    // 512Mi and the cold-start hiqlite WAL spike has no headroom over
    // observed steady-state ~250MB.
    const yaml = readFileSync(VALUES_YAML, "utf-8");
    const parsed = parseYaml(yaml) as {
      resources?: { limits?: { memory?: string } };
    };
    const memStr = parsed?.resources?.limits?.memory;
    expect(
      memStr,
      "resources.limits.memory must be set in deployd-api values.yaml — empty {} reverts the FU-021 fix",
    ).toBeTruthy();
    const memMiB = normalizeMemoryToMiB(memStr!);
    expect(
      memMiB,
      `memory limit ${memMiB}MiB is below the 512MiB floor; cold-start hiqlite WAL spikes need headroom over the ~250MB steady-state`,
    ).toBeGreaterThanOrEqual(512);
  });

  it("(ii) values.yaml resources.requests.memory is ≥ 128Mi", () => {
    // Requests floor catches reverts that would let the kubelet
    // over-commit the node and recreate the unbounded-cgroup symptom in
    // a different shape.
    const yaml = readFileSync(VALUES_YAML, "utf-8");
    const parsed = parseYaml(yaml) as {
      resources?: { requests?: { memory?: string } };
    };
    const memStr = parsed?.resources?.requests?.memory;
    expect(
      memStr,
      "resources.requests.memory must be set in deployd-api values.yaml",
    ).toBeTruthy();
    const memMiB = normalizeMemoryToMiB(memStr!);
    expect(
      memMiB,
      `memory request ${memMiB}MiB is below the 128MiB floor`,
    ).toBeGreaterThanOrEqual(128);
  });

  it("(iii) values.yaml does NOT declare NODE_OPTIONS or --max-old-space-size", () => {
    // Inverse-polarity assertion. Rust has no managed heap;
    // --max-old-space-size has no analog. Spec 146 §2.2 documents this
    // as a deliberate N/A leg. A future drive-by edit ("let's add
    // NODE_OPTIONS for parity with statecraft-api") would either be a
    // no-op (Rust ignores the env var) or a mis-signal that this binary
    // somehow runs Node — both are wrong. Catch it loudly.
    const yaml = readFileSync(VALUES_YAML, "utf-8");
    expect(
      yaml,
      "deployd-api values.yaml must not declare NODE_OPTIONS — Rust has no managed heap; see spec 146 §2.2",
    ).not.toMatch(/NODE_OPTIONS/);
    expect(
      yaml,
      "deployd-api values.yaml must not declare --max-old-space-size — V8 flag, no Rust analog",
    ).not.toMatch(/--max-old-space-size/);
  });
});
