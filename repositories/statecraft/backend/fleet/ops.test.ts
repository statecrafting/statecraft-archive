import { describe, expect, it } from "vitest";

import type { FleetAppStatus } from "./entities";
import {
  FLEET_DEFAULT_PORT,
  canTransitionApp,
  canTransitionOp,
  type FleetOpStatus,
  isValidAppName,
  isValidPort,
  liveHolder,
} from "./ops";

describe("fleet-op state machine", () => {
  it("walks running -> succeeded and running -> failed", () => {
    expect(canTransitionOp("running", "succeeded")).toBe(true);
    expect(canTransitionOp("running", "failed")).toBe(true);
  });

  it("treats succeeded and failed as terminal", () => {
    for (const s of ["succeeded", "failed"] as FleetOpStatus[]) {
      expect(canTransitionOp(s, "running")).toBe(false);
      expect(canTransitionOp(s, "succeeded")).toBe(false);
    }
  });

  it("rejects skipping straight to succeeded from pending", () => {
    expect(canTransitionOp("pending", "succeeded")).toBe(false);
    expect(canTransitionOp("pending", "running")).toBe(true);
  });
});

describe("fleet-app state machine", () => {
  it("allows the deploy and update happy paths", () => {
    expect(canTransitionApp("placing", "running")).toBe(true);
    expect(canTransitionApp("running", "updating")).toBe(true);
    expect(canTransitionApp("updating", "running")).toBe(true);
  });

  it("allows removal from every live state", () => {
    for (const s of ["placing", "running", "updating", "failed"] as FleetAppStatus[]) {
      expect(canTransitionApp(s, "removed")).toBe(true);
    }
  });

  it("treats removed as terminal", () => {
    for (const s of ["running", "placing", "updating", "failed"] as FleetAppStatus[]) {
      expect(canTransitionApp("removed", s)).toBe(false);
    }
  });

  it("lets a failed app recover", () => {
    expect(canTransitionApp("failed", "running")).toBe(true);
    expect(canTransitionApp("failed", "updating")).toBe(true);
  });
});

describe("app name validation (DNS-1123 label)", () => {
  it("accepts well-formed labels", () => {
    for (const n of ["a", "acme", "acme-store", "app123", "a1-b2-c3"]) {
      expect(isValidAppName(n)).toBe(true);
    }
  });

  it("rejects malformed labels", () => {
    for (const n of ["", "-lead", "trail-", "Upper", "under_score", "dot.dot", "sla/sh", "a".repeat(64)]) {
      expect(isValidAppName(n)).toBe(false);
    }
  });
});

describe("container port validation", () => {
  it("accepts the unprivileged range boundaries and the defaults in use", () => {
    for (const p of [1024, FLEET_DEFAULT_PORT, 8080, 65535]) {
      expect(isValidPort(p)).toBe(true);
    }
  });

  it("rejects privileged, out-of-range, and non-integer ports", () => {
    for (const p of [0, 1, 80, 443, 1023, 65536, -8080, 8080.5, Number.NaN, Infinity]) {
      expect(isValidPort(p)).toBe(false);
    }
  });

  it("treats float-typed integers as integers (JS number semantics)", () => {
    expect(isValidPort(8080.0)).toBe(true);
  });
});

describe("app-name holder selection", () => {
  const row = (id: string, status: FleetAppStatus) => ({ id, status });

  it("frees the name once every row carrying it is removed", () => {
    expect(liveHolder([])).toBeNull();
    expect(liveHolder([row("a", "removed")])).toBeNull();
    expect(liveHolder([row("a", "removed"), row("b", "removed")])).toBeNull();
  });

  it("reports the live holder in every non-terminal state", () => {
    for (const status of ["placing", "running", "updating", "failed"] as const) {
      expect(liveHolder([row("a", "removed"), row("b", status)])?.id).toBe("b");
    }
  });

  it("counts a failed placement as holding the name", () => {
    // A failed deploy can leave cluster objects behind, so its name is not free
    // until it is removed through the governed verb.
    expect(liveHolder([row("a", "failed")])?.id).toBe("a");
  });
});
