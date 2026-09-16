// Spec 187 FR-T3 — platform-portable process-tree introspection.
//
// Used by AC-9-class invariants ("no orphan sidecar after Quit"). The PID
// path is portable via `process.kill(pid, 0)` (an existence/permission probe
// that delivers no signal). The name path forks the platform's own tool and
// matches against the process *name* (comm), never the command line, which is
// OS-fragmented (FR-T3b). Wait helpers retry on a bounded cadence to tolerate
// the SIGKILL -> process-table-cleanup race (FR-T3c); the cadence/threshold are
// harness config, not spec-bound.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProcessMatcher {
  /** Executable name, matched against the process name (not the command line). */
  name?: string;
  /** Process id. Takes precedence over `name` when both are supplied. */
  pid?: number;
}

export interface WaitOptions {
  /** Poll cadence in ms (harness config, not spec-bound). */
  intervalMs?: number;
  /** Maximum time to wait in ms before giving up. */
  timeoutMs?: number;
}

const DEFAULT_INTERVAL_MS = 100;
const DEFAULT_TIMEOUT_MS = 5_000;

/** True if a process matching `matcher` is currently running. */
export async function isProcessRunning(matcher: ProcessMatcher): Promise<boolean> {
  if (matcher.pid !== undefined) return pidAlive(matcher.pid);
  if (matcher.name !== undefined) return nameAlive(matcher.name);
  throw new Error("isProcessRunning requires a `pid` or `name` matcher");
}

function pidAlive(pid: number): boolean {
  try {
    // Signal 0 checks existence + signalling permission without delivering it.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM => the process exists but we may not signal it (still running).
    // ESRCH / EINVAL / RangeError => not running.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function nameAlive(name: string): Promise<boolean> {
  return process.platform === "win32" ? tasklistHasImage(name) : pgrepHasName(name);
}

async function pgrepHasName(name: string): Promise<boolean> {
  try {
    // No -f: pgrep matches against the process name (comm), not the argv.
    const { stdout } = await execFileAsync("pgrep", [name]);
    return stdout.trim().length > 0;
  } catch (err) {
    // pgrep exits 1 when nothing matches — that is "absent", not an error.
    if ((err as { code?: number }).code === 1) return false;
    throw err;
  }
}

async function tasklistHasImage(name: string): Promise<boolean> {
  const image = name.toLowerCase().endsWith(".exe") ? name : `${name}.exe`;
  const { stdout } = await execFileAsync("tasklist", [
    "/FI",
    `IMAGENAME eq ${image}`,
    "/NH",
    "/FO",
    "CSV",
  ]);
  // tasklist prints an "INFO: No tasks..." banner (not CSV) when nothing matches.
  return stdout.toLowerCase().includes(image.toLowerCase());
}

/** Resolve once `matcher` is gone; reject if it outlives `timeoutMs`. */
export async function waitUntilGone(
  matcher: ProcessMatcher,
  opts: WaitOptions = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await isProcessRunning(matcher))) return;
    if (Date.now() >= deadline) {
      throw new Error(`process ${describeMatcher(matcher)} still running after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}

/**
 * AC-9 convenience: assert no orphan matching `matcher` survives. Waits with
 * bounded backoff (a freshly-killed process can linger briefly in the table)
 * and throws a descriptive error if one is still running at the deadline.
 */
export async function assertNoOrphan(
  matcher: ProcessMatcher,
  opts: WaitOptions = {},
): Promise<void> {
  try {
    await waitUntilGone(matcher, opts);
  } catch {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    throw new Error(
      `orphan process ${describeMatcher(matcher)} still running after ${timeoutMs}ms`,
    );
  }
}

function describeMatcher(m: ProcessMatcher): string {
  return m.pid !== undefined ? `pid=${m.pid}` : `name=${JSON.stringify(m.name)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
