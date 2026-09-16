// Spec 220 AC-2 (Option C): regenerateProducedClient unit tests.
//
// The function shells `npm install` then `npm run gen:client` in each produced
// `apps/api` that carries a gen:client script, with the pinned Encore CLI dir
// prepended to PATH. These tests drive it against a stub `npm` (a small shell
// script placed on the prepended dir, so spawn resolves it first) that records
// each invocation's argv and, on `run gen:client`, writes the client file where
// the real script would. No real npm or Encore CLI is needed.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { regenerateProducedClient } from "./perRequestScaffold";

/**
 * A stub `npm`: appends each invocation's argv to a log file and, on
 * `run gen:client` (run with cwd = apps/api), writes `../web/src/lib/encore-client.ts`
 * exactly where the app's real gen:client script targets. Returned as the bin
 * DIR, so it can be passed as `encoreBinDir` (which the function prepends to
 * PATH) and thus shadow any real `npm`.
 */
function makeStubNpmDir(root: string): { binDir: string; logFile: string } {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const logFile = join(root, "npm-invocations.log");
  const script =
    [
      "#!/bin/sh",
      `echo "$@" >> "${logFile}"`,
      'if [ "$1" = "run" ] && [ "$2" = "gen:client" ]; then',
      '  mkdir -p ../web/src/lib',
      '  echo "// generated client" > ../web/src/lib/encore-client.ts',
      "fi",
      "exit 0",
    ].join("\n") + "\n";
  const bin = join(binDir, "npm");
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return { binDir, logFile };
}

/** A produced `apps/api` under `dest/<rel>` with (or without) a gen:client script. */
function makeApi(dest: string, rel: string, withScript: boolean): void {
  const apiDir = join(dest, rel, "apps", "api");
  mkdirSync(apiDir, { recursive: true });
  const pkg = withScript
    ? { name: "@template/api", scripts: { "gen:client": "encore gen client" } }
    : { name: "@template/api", scripts: { build: "tsc" } };
  writeFileSync(join(apiDir, "package.json"), JSON.stringify(pkg), "utf8");
}

function makeTree(prefix: string): { root: string; dest: string; ws: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dest = join(root, "produced");
  const ws = join(root, "ws");
  mkdirSync(dest, { recursive: true });
  mkdirSync(ws, { recursive: true });
  return { root, dest, ws };
}

function readInvocations(logFile: string): string[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
}

describe("regenerateProducedClient (spec 220 AC-2, Option C)", () => {
  test("single-app layout: npm install then gen:client in apps/api, client written", async () => {
    const { root, dest, ws } = makeTree("regen-client-single-");
    const { binDir, logFile } = makeStubNpmDir(root);
    makeApi(dest, ".", true);

    await regenerateProducedClient({ dest, encoreBinDir: binDir, workspaceDir: ws });

    expect(readInvocations(logFile)).toEqual(["install", "run gen:client"]);
    // The gen:client stub ran with cwd = apps/api, so the client landed in apps/web.
    expect(existsSync(join(dest, "apps", "web", "src", "lib", "encore-client.ts"))).toBe(
      true
    );
  });

  test("dual layout: regenerates every apps/api that has a gen:client script", async () => {
    const { root, dest, ws } = makeTree("regen-client-dual-");
    const { binDir, logFile } = makeStubNpmDir(root);
    makeApi(dest, "public", true);
    makeApi(dest, "internal", true);

    await regenerateProducedClient({ dest, encoreBinDir: binDir, workspaceDir: ws });

    // Two api dirs -> two (install, run gen:client) pairs.
    expect(readInvocations(logFile)).toEqual([
      "install",
      "run gen:client",
      "install",
      "run gen:client",
    ]);
  });

  test("skips (no-op) when no apps/api carries a gen:client script", async () => {
    const { root, dest, ws } = makeTree("regen-client-skip-");
    const { binDir, logFile } = makeStubNpmDir(root);
    makeApi(dest, ".", false); // present but no gen:client script

    await regenerateProducedClient({ dest, encoreBinDir: binDir, workspaceDir: ws });

    expect(readInvocations(logFile)).toEqual([]);
  });
});
