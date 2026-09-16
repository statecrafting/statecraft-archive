import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { isProcessRunning, waitUntilGone, assertNoOrphan } from "./process_tree";

// Spec 187 FR-T3 + 187 AC-7. These run on the local OS (macOS here, Linux in
// the nightly). The PID path is portable via `process.kill(pid, 0)`; the name
// path forks pgrep/tasklist and matches the process *name*, not the command
// line (FR-T3b).

const execName = "node"; // the test runner's own executable — definitely alive

/** Spawn a detached-ish long sleeper and resolve once it has a PID. */
async function spawnSleeper(): Promise<{ pid: number; kill: () => void }> {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  return { pid: child.pid!, kill: () => child.kill("SIGKILL") };
}

describe("FR-T3 process-tree introspection", () => {
  it("detects a running process by PID (the runner itself)", async () => {
    expect(await isProcessRunning({ pid: process.pid })).toBe(true);
  });

  it("reports an unallocated PID as absent", async () => {
    expect(await isProcessRunning({ pid: 2_147_483_646 })).toBe(false);
  });

  it("detects a running process by executable name", async () => {
    expect(await isProcessRunning({ name: execName })).toBe(true);
  });

  it("reports an unknown executable name as absent", async () => {
    expect(await isProcessRunning({ name: "oap-no-such-proc-xyz123" })).toBe(false);
  });

  it("AC-7 negative: a spawned-then-killed process becomes absent", async () => {
    const proc = await spawnSleeper();
    expect(await isProcessRunning({ pid: proc.pid })).toBe(true);
    proc.kill();
    // bounded backoff tolerates the SIGKILL -> process-table cleanup race (FR-T3c)
    await waitUntilGone({ pid: proc.pid }, { timeoutMs: 5_000, intervalMs: 50 });
    expect(await isProcessRunning({ pid: proc.pid })).toBe(false);
  });

  it("assertNoOrphan resolves once a PID-scoped process is gone", async () => {
    const proc = await spawnSleeper();
    proc.kill();
    await expect(
      assertNoOrphan({ pid: proc.pid }, { timeoutMs: 5_000 }),
    ).resolves.toBeUndefined();
  });

  it("waitUntilGone rejects when the process outlives the timeout", async () => {
    await expect(
      waitUntilGone({ pid: process.pid }, { timeoutMs: 300, intervalMs: 50 }),
    ).rejects.toThrow(/still running/i);
  });
});
