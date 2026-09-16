// Spec 112 §5.3 — scaffold-output invariant: the per-request copy hands
// gitInitAndPush a VCS-free tree. Regression for the 2026-06-09 production
// create failure: template's dual generator runs `git init` per
// variant, and the embedded commit-less repos made `git add -A` fail with
// "'internal/' does not have a commit checked out".
//
// Pure-filesystem test (profile "dual" applies no extras, so the function
// never shells npm/tsx) — runs under bare vitest.

import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldFromPrebuilt } from "./perRequestScaffold";

function makeWorkspaceWithDualPrebuilt(): string {
  const ws = mkdtempSync(join(tmpdir(), "scaffold-vcs-test-"));
  // Spec 112 §5.3.1: prebuilds are SHA-stamped immutable snapshots behind a
  // `current` pointer (`_prebuilt/<combined-sha>/<profile>`).
  const sha = "tmpl00000000-fact00000000";
  const prebuilt = join(ws, "_prebuilt", sha, "dual");

  // Mirror what setup-dual-app.ts emits: two variant trees, each with an
  // embedded `git init` (.git dir, no commits), plus a root-level .git
  // (the legacy single-profile shape) and a node_modules to confirm the
  // existing exclusion still holds.
  for (const variant of ["public", "internal"]) {
    const root = join(prebuilt, variant);
    mkdirSync(join(root, ".git", "refs"), { recursive: true });
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeFileSync(join(root, "apps", "api", "main.ts"), "export {};\n");
    // The born-with kernel pin (spec 167): the spec-spine devDependency the
    // .kernel-version stamp reads. dual copies the base per-variant, so the
    // pin lives in each variant's package.json (no root package.json).
    writeFileSync(
      join(root, "package.json"),
      `{"name":"${variant}","devDependencies":{"spec-spine":"0.2.0"}}\n`
    );
    // .gitignore (a FILE starting with ".git") must survive the filter.
    writeFileSync(join(root, ".gitignore"), "node_modules\n");
    // Nested node_modules — the exclusion must hold at any depth, and must
    // drop the directory itself, not just its contents.
    mkdirSync(join(root, "node_modules", "is-even"), { recursive: true });
    writeFileSync(join(root, "node_modules", "is-even", "index.js"), "");
  }
  mkdirSync(join(prebuilt, ".git"), { recursive: true });
  writeFileSync(join(prebuilt, ".git", "HEAD"), "ref: refs/heads/main\n");
  mkdirSync(join(prebuilt, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(join(prebuilt, "node_modules", "left-pad", "index.js"), "");
  writeFileSync(join(prebuilt, "README.md"), "# dual\n");
  // Publish the snapshot pointer the per-request copy resolves.
  writeFileSync(join(ws, "_prebuilt", "current"), sha);
  return ws;
}

describe("scaffoldFromPrebuilt — VCS-free output (spec 112 §5.3)", () => {
  test("strips .git at any depth, keeps real files and .gitignore", async () => {
    const ws = makeWorkspaceWithDualPrebuilt();
    const dest = join(ws, "out", "june-test");
    try {
      const result = await scaffoldFromPrebuilt({
        workspaceDir: ws,
        profile: "dual",
        selectedModules: [],
        // dual composes no extras, so the catalog is unused on this path.
        catalog: [],
        destDir: dest,
        pipelineStateSeed: { level: "L0" },
        adapter: {
          id: "adapter-id",
          name: "acme-vue-encore",
          version: "0.1.0",
          sourceSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        },
        manifest: { adapter: { name: "acme-vue-encore", version: "0.1.0" } },
      });
      expect(result.destDir).toBe(dest);

      // The poison: embedded per-variant repos and the root carryover.
      expect(existsSync(join(dest, ".git"))).toBe(false);
      expect(existsSync(join(dest, "public", ".git"))).toBe(false);
      expect(existsSync(join(dest, "internal", ".git"))).toBe(false);

      // The payload survives.
      expect(existsSync(join(dest, "README.md"))).toBe(true);
      expect(existsSync(join(dest, "public", "apps", "api", "main.ts"))).toBe(true);
      expect(existsSync(join(dest, "internal", "package.json"))).toBe(true);
      expect(existsSync(join(dest, "public", ".gitignore"))).toBe(true);

      // node_modules is dropped entirely — no empty directory shell at
      // dest (the old contents-only `${sep}node_modules${sep}` pattern
      // left one), and the exclusion holds at depth.
      expect(existsSync(join(dest, "node_modules"))).toBe(false);
      expect(existsSync(join(dest, "public", "node_modules"))).toBe(false);
      expect(existsSync(join(dest, "internal", "node_modules"))).toBe(false);

      // The L0 seed still lands (step 4).
      expect(existsSync(join(dest, ".factory", "pipeline-state.json"))).toBe(true);

      // The .kernel-version born-with stamp lands at the project root (step 5,
      // spec 167), with the resolved pin read from a variant's package.json
      // (dual has no root package.json) and the pinned-toolchain mode.
      const stampPath = join(dest, ".kernel-version");
      expect(existsSync(stampPath)).toBe(true);
      const stamp = readFileSync(stampPath, "utf8");
      expect(stamp).toContain("toolchain_mode: pinned-toolchain");
      expect(stamp).toContain("spec_spine_version: 0.2.0");
      expect(stamp).toContain("acme-vue-encore");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
