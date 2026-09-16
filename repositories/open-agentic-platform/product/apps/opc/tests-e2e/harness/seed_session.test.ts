import { describe, it, expect } from "vitest";
import {
  buildSeedJwt,
  seedBinPath,
  KEYCHAIN_SERVICE,
  SESSION_ACCOUNT,
} from "./seed_session";

// Spec 187 [[opc-e2e-auth-state-seeding]]. The keychain write + read-back is
// nightly-only (it needs the built `e2e_seed_session` bin and a Secret Service
// daemon), so these unit tests cover the pure pieces that run on plain Node: the
// fake JWT builder OPC's boot path will decode, and the bin-path resolver.

function decodePayload(jwt: string): Record<string, unknown> {
  const seg = jwt.split(".");
  expect(seg).toHaveLength(3);
  return JSON.parse(Buffer.from(seg[1], "base64url").toString("utf8"));
}

describe("buildSeedJwt", () => {
  it("produces a 3-segment JWT whose payload decodes as JSON with a numeric exp", () => {
    const payload = decodePayload(buildSeedJwt());
    expect(typeof payload.exp).toBe("number");
  });

  it("carries oap_org_id under `custom` (where statecraft_client claim_str reads it)", () => {
    const payload = decodePayload(buildSeedJwt({ orgId: "org_123" })) as {
      custom?: Record<string, unknown>;
    };
    expect(payload.custom?.oap_org_id).toBe("org_123");
  });

  it("defaults the org id to org_mock (aligned with the mock's default)", () => {
    const payload = decodePayload(buildSeedJwt()) as {
      custom?: { oap_org_id?: string };
    };
    expect(payload.custom?.oap_org_id).toBe("org_mock");
  });

  it("sets exp in the future by the requested ttl", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = decodePayload(buildSeedJwt({ ttlSeconds: 7200 }));
    expect(payload.exp as number).toBeGreaterThan(now + 7000);
  });

  it("emits base64url segments (no +, /, or = padding)", () => {
    expect(buildSeedJwt()).not.toMatch(/[+/=]/);
  });
});

describe("seedBinPath", () => {
  it("resolves the release e2e_seed_session under src-tauri/target/release/examples", () => {
    expect(seedBinPath("linux")).toMatch(
      /product\/apps\/opc\/src-tauri\/target\/release\/examples\/e2e_seed_session$/,
    );
  });

  it("uses the .exe suffix on win32", () => {
    expect(seedBinPath("win32")).toMatch(/examples\/e2e_seed_session\.exe$/);
  });
});

describe("keychain constants mirror the OPC app slots", () => {
  it("service + account match dev.opc.statecraft / session", () => {
    expect(KEYCHAIN_SERVICE).toBe("dev.opc.statecraft");
    expect(SESSION_ACCOUNT).toBe("session");
  });
});
