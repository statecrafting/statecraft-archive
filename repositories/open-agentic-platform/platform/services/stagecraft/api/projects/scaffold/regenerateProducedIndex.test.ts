// Spec 112 §5.3 + spec 220 AC-2: regenerateProducedIndex unit tests.
//
// The function shells the pinned `spec-spine` binary over the produced tree.
// These tests drive it against a stub binary (a small shell script that
// records each invocation's argv and can fail on `index check`), so the
// compile, index, index-check sequence and the fail-closed contract are
// verified without a real spec-spine binary or spec corpus.

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
import { regenerateProducedIndex } from "./perRequestScaffold";

/**
 * A stub `spec-spine` binary: appends each invocation's argv to a log file
 * and, when `failCheck` is set, exits 1 on `index check` (simulating a stale
 * index). `compile` / `index` create the `.derived` tree so the produced
 * state looks real.
 */
function makeStub(dir: string, opts: { failCheck?: boolean }): string {
  const bin = join(dir, "spec-spine-stub.sh");
  const logFile = join(dir, "invocations.log");
  const checkExit = opts.failCheck ? "1" : "0";
  const script =
    [
      "#!/bin/sh",
      `echo "$@" >> "${logFile}"`,
      'if [ "$1" = "index" ] && [ "$2" = "check" ]; then',
      `  exit ${checkExit}`,
      "fi",
      'mkdir -p ".derived/codebase-index"',
      "exit 0",
    ].join("\n") + "\n";
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return bin;
}

function makeTree(prefix: string): { root: string; dest: string; ws: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dest = join(root, "produced");
  const ws = join(root, "ws");
  mkdirSync(dest, { recursive: true });
  mkdirSync(ws, { recursive: true });
  return { root, dest, ws };
}

describe("regenerateProducedIndex (spec 112 / spec 220 AC-2)", () => {
  test("runs compile, then index, then index check, in that order over the dest", async () => {
    const { root, dest, ws } = makeTree("regen-ok-");
    const bin = makeStub(root, {});

    await regenerateProducedIndex({
      dest,
      specSpineBin: bin,
      workspaceDir: ws,
    });

    const invocations = readFileSync(join(root, "invocations.log"), "utf8")
      .trim()
      .split("\n");
    expect(invocations).toEqual(["compile", "index", "index check"]);
    // The regen ran with cwd = dest, so the stub's `.derived` landed there.
    expect(existsSync(join(dest, ".derived", "codebase-index"))).toBe(true);
  });

  test("fails closed: throws when the freshly generated index is not fresh", async () => {
    const { root, dest, ws } = makeTree("regen-fail-");
    const bin = makeStub(root, { failCheck: true });

    await expect(
      regenerateProducedIndex({ dest, specSpineBin: bin, workspaceDir: ws })
    ).rejects.toThrow(/exited 1/);

    // compile + index still ran before the failing check (no skip-as-pass).
    const invocations = readFileSync(join(root, "invocations.log"), "utf8")
      .trim()
      .split("\n");
    expect(invocations).toEqual(["compile", "index", "index check"]);
  });
});
