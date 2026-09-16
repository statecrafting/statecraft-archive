// Spec 145 §2.2 — three static assertions pinning the removal of the
// `rm -rf /var/lib/deployd/data/*` boot scrub from the deployd-api
// chart's deployment.yaml. Mirrors spec146-deployd-memory.config.test.ts
// in shape.
//
// Why static and not an integration test: the full validation surface
// for spec 145 is AC-4 / T055 (pod restart against a populated PVC,
// verify `deployments` + `deployment_events` rowsets unchanged), which
// requires a live cluster + Hiqlite. That test lands with the full
// durability chain (§2.1 + §2.3 + §2.4). Until then, these static
// assertions catch the most-likely regression: a drive-by edit
// reintroducing the scrub "for safety" or "to clean up state on
// restart". Each assertion is inverse-polarity — they fail if the
// dangerous pattern reappears.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const DEPLOYMENT_YAML = resolve(
  REPO_ROOT,
  "platform/charts/deployd-api/templates/deployment.yaml",
);

describe("spec 145 §2.2 — deployd-api boot-scrub removal assertions", () => {
  it("(i) deployment.yaml does NOT contain `rm -rf /var/lib/deployd/data`", () => {
    // The exact wipe pattern the HIAS readiness assessment flagged.
    // The substring covers both the original `rm -rf /var/lib/deployd/data/*`
    // and a near-miss like `rm -rf /var/lib/deployd/data` without the glob.
    const yaml = readFileSync(DEPLOYMENT_YAML, "utf-8");
    expect(
      yaml,
      "deployd-api deployment.yaml must not wipe the Hiqlite data subtree on boot — spec 145 §2.2 removed this; the wipe destroys deployments + deployment_events rowsets even with persistence.enabled (the PVC survives, contents do not)",
    ).not.toMatch(/rm\s+-rf\s+\/var\/lib\/deployd\/data/);
  });

  it("(ii) deployd-api container does NOT redefine `command:` to wrap the entrypoint", () => {
    // The wider `rm -rf` was hosted inside a `/bin/sh -c` wrapper.
    // Per spec 145 §2.2 Option B, the chart falls back to the image's
    // default `CMD ["deployd-api"]` (Dockerfile L12). A reintroduced
    // `command: ["/bin/sh", "-c"]` is the most likely shape of a regression
    // — it's the wrapper that hosted the wipe in the first place.
    const yaml = readFileSync(DEPLOYMENT_YAML, "utf-8");
    expect(
      yaml,
      "deployd-api deployment.yaml must not declare `command: [\"/bin/sh\", \"-c\"]` — spec 145 §2.2 Option B requires falling back to the image's default entrypoint; any /bin/sh wrapper is the shape that hosted the boot-scrub regression",
    ).not.toMatch(/command:\s*\[\s*["']\/bin\/sh["']/);
  });

  it("(iii) deployment.yaml does NOT contain any `/bin/sh -c` invocation in args", () => {
    // Inverse-polarity guard against the wrapper being re-added in a
    // different yaml shape (multi-line array, single-quoted, etc.). If a
    // future regression needs a shell wrapper for some legitimate reason
    // (e.g. an explicitly-narrowed `rm -f` of just the state_machine lock
    // per spec 145 §2.2's Option-A reserve path), that change must amend
    // this spec/test pair, not slip past it.
    const yaml = readFileSync(DEPLOYMENT_YAML, "utf-8");
    expect(
      yaml,
      "deployd-api deployment.yaml must not invoke /bin/sh -c — see spec 145 §2.2; any shell-wrapped startup must amend this assertion and the spec together",
    ).not.toMatch(/\/bin\/sh\s+-c/);
  });
});
