import { describe, expect, it } from "vitest";

import { isStampMode, STAMP_MODES, stampAttestationPayload, stampSubject } from "./attest";

describe("stamp mode guard", () => {
  it("accepts the two modes and rejects anything else", () => {
    expect(STAMP_MODES).toEqual(["create", "adopt"]);
    expect(isStampMode("create")).toBe(true);
    expect(isStampMode("adopt")).toBe(true);
    expect(isStampMode("")).toBe(false);
    expect(isStampMode("Create")).toBe(false);
    expect(isStampMode("delete")).toBe(false);
  });
});

describe("stamp attestation", () => {
  const base = {
    mode: "adopt" as const,
    appName: "chancery",
    org: "statecrafting",
    templateCommit: "34134f9a48ddff75cca1df4f9a15e06140357bdd",
    contractVersion: "0.5.0",
    posture: "assisted" as const,
  };

  it("builds the subject as <org>/<appName>", () => {
    expect(stampSubject(base)).toBe("statecrafting/chancery");
  });

  it("carries the mode so create vs adopt is remembered in the ledger", () => {
    expect(stampAttestationPayload(base).mode).toBe("adopt");
    expect(stampAttestationPayload({ ...base, mode: "create" }).mode).toBe("create");
  });

  it("records the exact template commit, contract version, and posture", () => {
    expect(stampAttestationPayload(base)).toEqual({
      mode: "adopt",
      appName: "chancery",
      org: "statecrafting",
      templateCommit: "34134f9a48ddff75cca1df4f9a15e06140357bdd",
      contractVersion: "0.5.0",
      posture: "assisted",
    });
  });
});
