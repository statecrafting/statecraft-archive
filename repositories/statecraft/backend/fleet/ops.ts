/**
 * Fleet state machines (spec 006 §2/§3), kept as data so they are unit-testable.
 *
 * `FleetOp` is the per-verb intent journal: running -> succeeded | failed.
 * `FleetApp` is the app lifecycle; `removed` is terminal, and every live state
 * can be removed. Observed status from the addon is written directly (it is a
 * fact about the cluster, not a command), so the app machine only constrains the
 * intentful transitions the endpoints drive.
 */
import type { FleetAppStatus } from "./entities";

export type FleetOpKind = "deploy" | "update" | "backup" | "remove";
export type FleetOpStatus = "pending" | "running" | "succeeded" | "failed";

const ALLOWED_OP: Record<FleetOpStatus, readonly FleetOpStatus[]> = {
  pending: ["running", "failed"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

export function canTransitionOp(from: FleetOpStatus, to: FleetOpStatus): boolean {
  return (ALLOWED_OP[from] ?? []).includes(to);
}

export class InvalidOpTransitionError extends Error {
  constructor(from: FleetOpStatus, to: FleetOpStatus) {
    super(`invalid fleet-op transition: ${from} -> ${to}`);
    this.name = "InvalidOpTransitionError";
  }
}

const ALLOWED_APP: Record<FleetAppStatus, readonly FleetAppStatus[]> = {
  placing: ["running", "failed", "removed"],
  running: ["updating", "failed", "removed"],
  updating: ["running", "failed", "removed"],
  failed: ["placing", "running", "updating", "removed"],
  removed: [],
};

export function canTransitionApp(from: FleetAppStatus, to: FleetAppStatus): boolean {
  return (ALLOWED_APP[from] ?? []).includes(to);
}

export function isRemoved(status: FleetAppStatus): boolean {
  return status === "removed";
}

/**
 * The row that still holds an app name, given every row carrying it.
 *
 * A name is only reserved by an app that still exists: `removed` is terminal
 * and its cluster resources are gone with it, so the name returns to the pool
 * while the row stays for the audit trail.
 *
 * Normally one row at most is live, because deploy checks this before it
 * places. That is a property of the happy path, not an invariant this code or
 * the schema enforces: the check and the insert are not atomic, so a race can
 * leave two live rows (spec 006, amendment 2026-07-25). Returning the first is
 * still correct for every caller, since all of them use the result as an
 * occupancy gate rather than as an identity.
 */
export function liveHolder<T extends { status: FleetAppStatus }>(
  rows: readonly T[],
): T | null {
  return rows.find((row) => !isRemoved(row.status)) ?? null;
}

export class InvalidAppTransitionError extends Error {
  constructor(from: FleetAppStatus, to: FleetAppStatus) {
    super(`invalid fleet-app transition: ${from} -> ${to}`);
    this.name = "InvalidAppTransitionError";
  }
}

/**
 * A DNS-1123 label. The app name is both a Kubernetes resource name and the
 * `<name>.<FLEET_BASE_DOMAIN>` subdomain label, so it must be a lowercase label.
 */
export function isValidAppName(name: string): boolean {
  return name.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name);
}

/** The addon's default container port, applied when deploy names none. */
export const FLEET_DEFAULT_PORT = 4000;

/**
 * The deploy-chosen container port. Privileged ports are rejected up front:
 * placed pods run as a non-root UID with no NET_BIND_SERVICE, so a port
 * below 1024 cannot be bound and would hang the rollout wait on a probe
 * aimed at a port nothing can listen on.
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}
