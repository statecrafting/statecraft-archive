// Spec 117 FR-004: the production wiring follows a project's profile to the
// driver it names, at every spawn. A managed member directory holds the Rust
// Codex driver (built here, over a fake codex script) and a fake Claude
// driver member; the profile source flips between two sessions and each
// goes where the profile said at that moment.
import { test, expect } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createProductionDaemonDeps } from "./daemon";
import { openJournal } from "./journal";
import type { ExecutionProfile } from "./profile";

const REPO = join(import.meta.dir, "..", "..", "..");
const RUST_CODEX_DRIVER = join(REPO, "target", "debug", "statecraft-driver-codex");

function executable(path: string, body: string): string {
  writeFileSync(path, body.endsWith("\n") ? body : `${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("the Rust Codex driver builds", async () => {
  const proc = Bun.spawn(["cargo", "build", "-p", "statecraft-driver-codex"], { cwd: REPO, stdout: "ignore", stderr: "pipe" });
  expect(await proc.exited).toBe(0);
}, 600_000);

test("117 FR-004: the daemon's deps drive the driver the project's profile names, per spawn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "project-driver-"));
  const members = join(dir, "members");
  mkdirSync(members);
  // The managed directory (043 B-5): the real Rust Codex driver, and a fake
  // Claude driver member that answers the manifest and plays one session.
  copyFileSync(RUST_CODEX_DRIVER, join(members, "statecraft-driver-codex"));
  chmodSync(join(members, "statecraft-driver-codex"), 0o755);
  executable(
    join(members, "statecraft-driver-claude"),
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "--member-manifest" ]; then',
      `  echo '{"schemaVersion":"1","name":"statecraft-driver-claude","version":"0","contract":"042","verbs":["models","session"],"capabilityTier":"reference","exitCodes":{"0":"ok"},"envelope":"ok-data"}'`,
      "  exit 0",
      "fi",
      `cat > "${join(dir, "claude-request.json")}"`,
      `echo '{"event":"journal","kind":"session.init","payload":{"claudeBin":"fake-claude","repo":"${dir}","model":null,"maxTurns":null,"timeoutMs":1,"sessionId":"sess-claude","profile":{"mode":"bypass","allowedTools":null,"disallowedTools":null,"models":null,"driver":null}}}'`,
      `echo '{"event":"journal","kind":"session.result","payload":{"classification":"completed","resetAtMs":null,"detail":"fake","exitCode":0}}'`,
      `echo '{"event":"result","result":{"classification":{"kind":"completed","resetAtMs":null,"detail":"fake"},"exitCode":0,"durationMs":1,"numTurns":1,"costMicroUsd":null,"usage":null,"sessionId":"sess-claude","transcriptPath":null,"overflow":{"lines":[],"truncatedCount":0},"stderrTail":""}}'`,
      "exit 0",
    ].join("\n")
  );
  // The fake codex the Rust driver spawns: one completed turn.
  const codex = executable(
    join(dir, "fake-codex.sh"),
    [
      "#!/usr/bin/env bash",
      "cat > /dev/null",
      `echo '{"type":"thread.started","thread_id":"01a08750-bdaa-79f0-90b5-bc60371a2f53"}'`,
      `echo '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}'`,
      `echo '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}'`,
      "exit 0",
    ].join("\n")
  );

  let profile: ExecutionProfile = { mode: "guarded", driver: "codex" };
  const env: NodeJS.ProcessEnv = { ...process.env, STATECRAFT_MEMBER_DIR: members, STATECRAFT_CODEX_BIN: codex, PATH: "/usr/bin:/bin" };
  delete env.STATECRAFT_DRIVER_BIN;
  const deps = createProductionDaemonDeps({ dataDir: dir, repoDir: dir, profile: () => profile, driverEnv: env });

  const journal = openJournal(join(dir, "journal"), "orchestrator");
  try {
    // First spawn: the profile says codex, so the Rust Codex driver runs the
    // fake codex, and the journal says so on both the init and the result.
    const first = await deps.runner.runSession({ prompt: "one", tier: "fast", journal });
    expect(first.classification.kind).toBe("completed");
    expect(first.sessionId).toBe("01a08750-bdaa-79f0-90b5-bc60371a2f53");
    const records = () => journal.fold().records.map((r) => ({ kind: r.kind, payload: r.payload as Record<string, unknown> }));
    const init = records().find((r) => r.kind === "session.init")!;
    expect(init.payload.codexBin).toBe(codex);
    expect((init.payload.profile as Record<string, unknown>).driver).toBe("codex");
    // 120 B-6: a guarded posture asks for the tool allowlist (the baseline
    // list), which Codex cannot apply; the sandbox and the hooks are what
    // it did apply.
    expect(init.payload.degraded).toEqual(["tool-allowlist", "cost"]);
    expect(init.payload.applied).toEqual(["workspace-write", "hook-enforcement"]);

    // The profile flips between spawns; the deps were built once, above, and
    // the second session goes to the fake Claude driver member.
    profile = { mode: "bypass" };
    const second = await deps.runner.runSession({ prompt: "two", tier: "fast", journal });
    expect(second.sessionId).toBe("sess-claude");
    const request = JSON.parse(await Bun.file(join(dir, "claude-request.json")).text()) as { prompt: string; profile: { driver: string | null } };
    expect(request.prompt).toBe("two");
    expect(request.profile.driver).toBeNull();
    // 120 B-5: the Codex session's two preferred tokens were journaled as
    // degraded before its spawn; the fake Claude member declares the
    // reference tokens and degrades nothing.
    // 124 B-6: each process driver (one per name) reports its unqualified
    // binary once, after its first init.
    expect(records().map((r) => r.kind)).toEqual([
      "driver.degraded",
      "driver.degraded",
      "session.init",
      "driver.unqualified",
      "session.result",
      "session.init",
      "driver.unqualified",
      "session.result",
    ]);
  } finally {
    journal.close();
  }
}, 60_000);
