// Spec 187 FR-T4 — time-bounded UI-state assertions.
//
// AC-8-class invariants ("the cockpit unmounts within an implementer-bounded
// window of the kill signal") need a bounded poller. `waitFor` is the generic
// engine; `waitForSubtree` is the canonical "which top-level component is
// mounted" convenience. The read function is injected so the timing logic is
// testable in isolation — Phase 4's driver passes a WebDriver read.
//
// The default cadence/timeout are harness config, NOT spec-bound (the spec
// pins the shape, not numeric ceilings — §3.4 / Tier 3 exclusion). Consumer
// fixtures override per-assertion (e.g. AC-8's ~2s window).

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_INTERVAL_MS = 250;

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Label woven into the timeout error for diagnosability. */
  description?: string;
}

/** Poll `read` on a bounded cadence until `predicate` holds; reject on timeout. */
export async function waitFor<T>(
  read: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  opts: WaitOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const label = opts.description ?? "waitFor";
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() >= deadline) {
      throw new Error(
        `${label} timed out after ${timeoutMs}ms (last value: ${stringify(value)})`,
      );
    }
    await sleep(intervalMs);
  }
}

/**
 * Resolve once the mounted top-level component equals `expected`; reject on
 * timeout. `readMounted` returns the name of the currently-mounted top-level
 * component (e.g. "boot" | "cockpit") — see the FR-T1 driver.
 */
export async function waitForSubtree(
  readMounted: () => Promise<string> | string,
  expected: string,
  opts: WaitOptions = {},
): Promise<void> {
  await waitFor(readMounted, (mounted) => mounted === expected, {
    ...opts,
    description: opts.description ?? `wait for "${expected}" subtree to mount`,
  });
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
