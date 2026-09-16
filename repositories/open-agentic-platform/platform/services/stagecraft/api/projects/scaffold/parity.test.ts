// Spec 112 §5.3.1 parity: statecraft's warmup must produce a prebuild tree
// byte-identical to running the factory-encore generator directly.
//
// statecraft's value is that it is a thin orchestrator: the produced app is
// whatever `setup-app.ts --profile <p> --source <template>` emits. This test
// proves that, by running the REAL `ensurePrebuilts` (the sha-stamped snapshot
// layout, the factory-cache generator, the `--source` baseline, `--profile`
// only with the generator reading profiles[].modules) and diffing its output
// against a direct generator run for the same profile.
//
// The two owned upstreams are supplied as LOCAL checkouts (symlinked into the
// workspace caches, so the test runs offline and exercises generation without
// the github clone). Resolve them from env or sibling DevWork checkouts; the
// suite self-skips when they are absent (CI without the repos), matching the
// "local drift-detector" posture in spec 112 §5.3.1.

import { describe, expect, test } from "vitest";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ensurePrebuilts,
  prebuiltDir,
  resolveCurrentPrebuiltSha,
  type WarmupContext,
} from "./templateCache";

function resolveCheckout(envVar: string, sibling: string): string | null {
  const fromEnv = process.env[envVar];
  if (fromEnv && existsSync(fromEnv)) return resolve(fromEnv);
  const guess = resolve(process.env.HOME ?? "", "DevWork", sibling);
  if (existsSync(join(guess, "package.json"))) return guess;
  return null;
}

const FACTORY = resolveCheckout("STATECRAFT_PARITY_FACTORY", "factory-encore");
const TEMPLATE = resolveCheckout("STATECRAFT_PARITY_TEMPLATE", "template-encore");
const TSX = FACTORY
  ? join(FACTORY, "node_modules", "tsx", "dist", "cli.mjs")
  : "";
const READY = !!FACTORY && !!TEMPLATE && existsSync(TSX);

/** Recursive relpath -> file content map, excluding node_modules and VCS. */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name === "node_modules" || name === ".git") continue;
      const abs = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else if (entry.isFile()) {
        out.set(relPath, readFileSync(abs, "utf8"));
      }
    }
  };
  if (existsSync(root) && statSync(root).isDirectory()) walk(root, "");
  return out;
}

function runGeneratorDirect(profile: string, dest: string): void {
  const script = join(
    FACTORY!,
    "adapters",
    "acme-vue-encore",
    "scripts",
    profile === "dual" ? "setup-dual-app.ts" : "setup-app.ts"
  );
  const args = [
    TSX,
    script,
    ...(profile === "dual" ? [] : ["--profile", profile]),
    "--source",
    TEMPLATE!,
    "--dest",
    dest,
    "--yes",
  ];
  const res = spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, NO_INSTALL: "true" },
  });
  if (res.status !== 0) {
    throw new Error(
      `direct generator (${profile}) exited ${res.status}: ${res.stderr ?? ""}`
    );
  }
}

const maybe = READY ? describe : describe.skip;

maybe("spec 112 §5.3.1 parity: warmup tree == generator tree", () => {
  test("ensurePrebuilts(internal) matches a direct internal generator run", async () => {
    // realpathSync: the generator's run-when-entry guard compares argv[1] to a
    // symlink-resolved import.meta.url, and macOS tmpdir() lives under the
    // /var -> /private/var symlink, which would make the guard skip main().
    // Production workspaces are real paths, so this only bites the test.
    const ws = realpathSync(mkdtempSync(join(tmpdir(), "scaffold-parity-")));
    const ref = realpathSync(mkdtempSync(join(tmpdir(), "scaffold-parity-ref-")));
    try {
      // Pre-populate the two caches, then record commit shas so ensurePrebuilts
      // computes a combined key and runs the generator (it does not clone; that
      // is ensureTemplateCache's job). The factory source is COPIED (not
      // symlinked) so the generator script's real path is its own path: the
      // "run only when entry" guard compares argv[1] to a symlink-resolved
      // import.meta.url, so a symlinked script path would skip main(). Production
      // clones a real dir, so this matches it. node_modules is symlinked back
      // (tsx + deps) to keep the copy cheap; the template is read-only, so a
      // symlink is fine there.
      cpSync(FACTORY!, join(ws, "_factory-cache"), {
        recursive: true,
        filter: (src) => {
          const b = src.split("/").pop();
          return b !== "node_modules" && b !== ".git";
        },
      });
      symlinkSync(
        join(FACTORY!, "node_modules"),
        join(ws, "_factory-cache", "node_modules")
      );
      symlinkSync(TEMPLATE!, join(ws, "_template-cache"));
      // Hex shas (ensurePrebuilts validates the cache shas are hex before
      // using them as a path component).
      writeFileSync(join(ws, ".factory-commit"), "a1b2c3d4e5f60718293a");
      writeFileSync(join(ws, ".template-commit"), "0f1e2d3c4b5a69788796");

      const ctx: WarmupContext = {
        workspaceDir: ws,
        scaffoldRepoUrl: "local/template-encore",
        scaffoldRef: "main",
        factoryRepoUrl: "local/factory-encore",
        factoryRef: "main",
        patResolver: async () => null,
      };

      await ensurePrebuilts(ctx);
      const combined = await resolveCurrentPrebuiltSha(ws);
      expect(combined).toBeTruthy();
      const warmupTree = prebuiltDir(ws, combined!, "internal");
      expect(existsSync(warmupTree)).toBe(true);

      // All four profiles built in the one snapshot (coverage beyond internal).
      for (const p of ["minimal", "public", "internal", "dual"] as const) {
        expect(existsSync(prebuiltDir(ws, combined!, p))).toBe(true);
      }
      // public ships NO user-management: the profile-default authority differs
      // per profile, and warmup passed only --profile (no module translation).
      expect(
        existsSync(
          join(prebuiltDir(ws, combined!, "public"), "apps", "web", "src", "views", "admin", "UserListView.vue")
        )
      ).toBe(false);

      // internal ships user-management by default (manifest authority, read by
      // the generator): the prebuild must contain it, proving warmup passed
      // only --profile and the generator composed the default.
      expect(
        existsSync(join(warmupTree, "apps", "web", "src", "views", "admin", "UserListView.vue"))
      ).toBe(true);

      runGeneratorDirect("internal", ref);

      const a = snapshot(warmupTree);
      const b = snapshot(ref);
      // Same file set.
      expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
      // Same content for every file.
      const mismatches: string[] = [];
      for (const [k, v] of a) {
        if (b.get(k) !== v) mismatches.push(k);
      }
      expect(mismatches).toEqual([]);
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(ref, { recursive: true, force: true });
    }
  }, 240_000);
});

if (!READY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[parity.test] skipped: set STATECRAFT_PARITY_FACTORY / STATECRAFT_PARITY_TEMPLATE to local factory-encore / template-encore checkouts (with node_modules) to run"
  );
}
