/**
 * Spec 202 FR-004: approval-velocity (governance-drift) counter, pure half.
 *
 * Bulk rubber-stamping is ASI08's governance-drift signature: a human (or an
 * agent acting for one) clicks APPROVE far faster than any real review of the
 * spec 201 `ApprovalSummary` (blast-radius statement, provenance links,
 * consumed overrides) could take. This module is the pure, Encore-free half:
 * the config readers plus the deterministic windowing that classifies a set
 * of an actor's recent approval timestamps as anomalous or not.
 *
 * Records, never blocks (FR-004): depth of approval policy is org-filed (the
 * spec 198 FR-013 posture), so the platform default is a detection signal, not
 * an enforcement ceiling. The DB half (`approvalVelocity.ts`) surfaces this on
 * the run-approval context response and writes a
 * `factory.run.approval_velocity_anomaly` audit row when the break trips;
 * neither path ever refuses an approval.
 *
 * Split out from `approvalVelocity.ts` (which imports the Encore DB client) so
 * the FR-004 core assertion runs under bare vitest without the runtime. Same
 * pure/wrapper split as `approvalSummary-pure.ts` / `approvalSummary.ts`.
 */

/** Default detection window. Long enough that a genuine reviewer's cadence
 *  (reading a blast-radius statement + provenance links takes seconds each)
 *  never fills it, short enough that a scripted or rubber-stamp burst does.
 *  Same reasoning shape as the `DEFAULT_MAX_RUNS_IN_FLIGHT = 25` platform
 *  default in FR-003(c): loose enough to never fire on normal usage, tight
 *  enough to be a meaningful detection signal, not an enforcement ceiling. */
const DEFAULT_WINDOW_SECS = 60;

/** Default approvals-per-window at or above which velocity is anomalous. Ten
 *  gate approvals inside one minute is under 6s per approval: below any
 *  plausible read-and-ratify cadence for the spec 201 summary, which is
 *  exactly the bulk-rubber-stamp shape FR-004 counts. Detection-only; orgs
 *  tune via env until the envelope carries an authoritative threshold. */
const DEFAULT_THRESHOLD = 10;

/** Override via `STATECRAFT_FACTORY_APPROVAL_VELOCITY_WINDOW_SEC=<secs>`. */
const ENV_WINDOW = "STATECRAFT_FACTORY_APPROVAL_VELOCITY_WINDOW_SEC";
/** Override via `STATECRAFT_FACTORY_APPROVAL_VELOCITY_THRESHOLD=<count>`. */
const ENV_THRESHOLD = "STATECRAFT_FACTORY_APPROVAL_VELOCITY_THRESHOLD";

/** Parse a positive-integer env override, falling back to `fallback` on an
 *  unset, non-numeric, or non-positive value (same posture as
 *  `maxRunsInFlight()` in `queueStormGate.ts`). */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function approvalVelocityWindowSecs(): number {
  return positiveIntEnv(ENV_WINDOW, DEFAULT_WINDOW_SECS);
}

export function approvalVelocityThreshold(): number {
  return positiveIntEnv(ENV_THRESHOLD, DEFAULT_THRESHOLD);
}

/**
 * FR-004 diagnostic, surfaced on the run-approval context response. It is
 * never folded into the hashed `ApprovalSummary`: velocity is actor- and
 * time-dependent, so putting it inside the summary hash would break the
 * FR-003(b) replay guard (a re-assembly moments later would differ).
 */
export interface ApprovalVelocity {
  /** Rolling window the count is measured over. */
  windowSecs: number;
  /** Count at or above which `anomalous` is set. */
  threshold: number;
  /** The actor's approvals inside `[now - windowSecs, now]`. */
  count: number;
  /** `count >= threshold`: bulk-rubber-stamp shape detected. */
  anomalous: boolean;
}

/**
 * FR-004 classification over already-fetched approval timestamps.
 * Deterministic for a given `nowIso`: an approval counts when its instant
 * falls inside `[now - windowSecs, now]`. Timestamps in the future relative
 * to `now` (clock skew) do not count. `anomalous` is `count >= threshold`,
 * mirroring `detectQueueStorm`'s "at or over the ceiling" convention
 * (FR-003c).
 */
export function computeApprovalVelocity(
  approvalTimestamps: string[],
  nowIso: string,
  windowSecs: number,
  threshold: number,
): ApprovalVelocity {
  const now = Date.parse(nowIso);
  const windowStart = now - windowSecs * 1000;
  let count = 0;
  for (const ts of approvalTimestamps) {
    const t = Date.parse(ts);
    if (Number.isNaN(t)) continue;
    if (t >= windowStart && t <= now) count += 1;
  }
  return {
    windowSecs,
    threshold,
    count,
    anomalous: count >= threshold,
  };
}
