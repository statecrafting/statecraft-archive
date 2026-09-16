/**
 * The stamp job's status state machine (spec 005 §3).
 *
 * A job walks queued -> stamping -> pushing -> verifying -> green, and may drop
 * to failed from any non-terminal state. green and failed are terminal. Keeping
 * the transitions as data (not scattered across the pipeline) makes them
 * unit-testable and lets the pipeline stay a single-flight, status-driven
 * machine (resumable by status).
 */
export type StampStatus =
  | "queued"
  | "stamping"
  | "pushing"
  | "verifying"
  | "green"
  | "failed";

/** In-flight statuses: a job in one of these is "live" for idempotency. */
export const LIVE_STATUSES: readonly StampStatus[] = [
  "queued",
  "stamping",
  "pushing",
  "verifying",
];

const ALLOWED: Record<StampStatus, readonly StampStatus[]> = {
  queued: ["stamping", "failed"],
  stamping: ["pushing", "failed"],
  pushing: ["verifying", "failed"],
  verifying: ["green", "failed"],
  green: [],
  failed: [],
};

export function isTerminal(status: StampStatus): boolean {
  return (ALLOWED[status] ?? []).length === 0;
}

export function isLive(status: StampStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

/** Whether `from -> to` is a legal transition. Null-safe for off-type inputs. */
export function canTransition(from: StampStatus, to: StampStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(from: StampStatus, to: StampStatus) {
    super(`invalid stamp-job transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}
