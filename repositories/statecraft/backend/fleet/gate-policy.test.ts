import { describe, expect, it } from "vitest";

import { type GateDecision, resolveGate } from "./gate-policy";

const allow: GateDecision = { outcome: "allow", reason: "ok", blocking: false, configHash: "sha256:abc" };
const deny: GateDecision = { outcome: "deny", reason: "posture too low", blocking: true, configHash: "sha256:abc" };
const degrade: GateDecision = { outcome: "degrade", reason: "warn", blocking: false, configHash: "sha256:def" };

describe("gate policy", () => {
  it("passes an allow decision through with its config hash", () => {
    expect(resolveGate("strict", allow)).toEqual({ kind: "allow", configHash: "sha256:abc" });
    expect(resolveGate("soft", allow)).toEqual({ kind: "allow", configHash: "sha256:abc" });
  });

  it("treats a non-blocking degrade as allow", () => {
    expect(resolveGate("strict", degrade)).toEqual({ kind: "allow", configHash: "sha256:def" });
  });

  it("denies a blocking decision regardless of class", () => {
    expect(resolveGate("strict", deny)).toEqual({ kind: "deny", reason: "posture too low" });
    expect(resolveGate("soft", deny)).toEqual({ kind: "deny", reason: "posture too low" });
  });

  it("denies a strict verb when the gate is unreachable", () => {
    expect(resolveGate("strict", null)).toEqual({ kind: "unavailable" });
  });

  it("warns-and-proceeds a soft verb when the gate is unreachable", () => {
    expect(resolveGate("soft", null)).toEqual({ kind: "allow", configHash: null });
  });
});
