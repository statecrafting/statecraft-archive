// Spec 187 [[opc-e2e-auth-state-seeding]]: SIGKILL a process by name.
//
// Companion to process_tree.ts (FR-T3). Where that helper ASKS "is X running?",
// this one TERMINATES X. Used by the spec-183 AC-8 fixture to kill the
// axiomregent sidecar out from under a signed-in cockpit and assert the boot
// gate reasserts. It matches by process NAME (comm), the same OS-portable basis
// process_tree.ts uses, never the command line (which is OS-fragmented).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface KillMatcher {
  /** Executable name (comm), matched the same way process_tree.ts matches. */
  name: string;
  /** Signal to send (default SIGKILL, the AC-8 hard-kill semantics). */
  signal?: NodeJS.Signals;
}

/**
 * SIGKILL (or `signal`) every process whose name matches. Returns the number
 * signalled. A no-match is not an error (returns 0), mirroring pgrep's exit-1
 * "absent" convention in process_tree.ts.
 */
export async function killProcess(matcher: KillMatcher): Promise<number> {
  const signal = matcher.signal ?? "SIGKILL";
  if (process.platform === "win32") return taskkill(matcher.name);
  return pkillByName(matcher.name, signal);
}

async function pkillByName(name: string, signal: NodeJS.Signals): Promise<number> {
  let pids: number[];
  try {
    // No -f: pgrep matches the process name (comm), not the argv (FR-T3b).
    const { stdout } = await execFileAsync("pgrep", [name]);
    pids = stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch (err) {
    if ((err as { code?: number }).code === 1) return 0; // pgrep exit 1 == no match
    throw err;
  }
  let killed = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      killed += 1;
    } catch (err) {
      // ESRCH: the process exited between pgrep and kill; that is a success for
      // "make it gone", not an error. Anything else propagates.
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
    }
  }
  return killed;
}

async function taskkill(name: string): Promise<number> {
  const image = name.toLowerCase().endsWith(".exe") ? name : `${name}.exe`;
  try {
    await execFileAsync("taskkill", ["/F", "/IM", image]);
    return 1;
  } catch (err) {
    // taskkill exits 128 when no matching image is found (the "absent" case).
    if ((err as { code?: number }).code === 128) return 0;
    throw err;
  }
}
