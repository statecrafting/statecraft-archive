/**
 * Service-level acceptance for the governance spine (spec 008 §4).
 *
 * These run under the chassis vitest once the app shell (spec 002) lands and
 * the governance-native addon is built; they are inert until then (there is no
 * vitest in this repo pre-002). The addon's own logic is proven now by
 * `cargo test --no-default-features` in the statecrafting repo (spec 005).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import native from "./native";
import { gate } from "./gate";
import { list, record, verify } from "./records";

beforeAll(() => {
  process.env.STATECRAFT_GOVERNANCE_STATE_DIR = mkdtempSync(
    join(tmpdir(), "gov-svc-"),
  );
});

describe("governance records", () => {
  it("round-trips: index row + chain growth + verify ok", async () => {
    const res = await record({
      kind: "stamp",
      subject: "app-1",
      actor: "agent:factory",
      payload: { app: "app-1", posture: "supervised" },
    });
    expect(res.seq).toBe(0);
    expect(res.recordHash).toMatch(/^sha256:/);

    const listed = await list({ subject: "app-1" });
    expect(listed.records).toHaveLength(1);
    expect(listed.records[0].recordHash).toBe(res.recordHash);

    const verified = await verify();
    expect(verified.ok).toBe(true);
    expect(verified.seq).toBe(1);
  });

  it("payloadHash equals an independently computed keysorted sha256", async () => {
    const payload = { z: 1, a: { n: 2, b: 3 } };
    const res = await record({
      kind: "deploy",
      subject: "app-2",
      actor: "agent:fleet",
      payload,
    });
    // key order must not matter: a differently-ordered payload hashes the same.
    const independent = native.canonicalize(
      JSON.stringify({ a: { b: 3, n: 2 }, z: 1 }),
    ).sha256;
    expect(res.payloadHash).toBe(independent);
  });
});

describe("governance gate", () => {
  it("surfaces a deny to the caller", async () => {
    // A stamp with no posture is denied by posture-required.
    const decision = await gate({
      action: "stamp",
      attributes: { actor: "agent:x", authenticated: true },
    });
    expect(decision.outcome).toBe("deny");
    expect(decision.blocking).toBe(true);
    expect(decision.checkIds).toContain("posture-required");
    expect(decision.configHash).toMatch(/^sha256:/);
  });
});
