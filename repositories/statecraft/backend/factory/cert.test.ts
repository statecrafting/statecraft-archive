import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CertError, buildCert, certHash } from "./cert";

/**
 * The golden hash is the sha256 of the keysorted-canonical form of the shared
 * born-with example fixture, and equals the value scripts/verify-born-with.mjs
 * (the template's own verifier) independently computes. Matching it proves the
 * factory's TS canonicalization is byte-identical to the verifier's.
 */
const GOLDEN_SHA256 = "f3c34ae79e000bb4e2ef6ea850186db57cd5c2338d6885270a66bd7b76b97da9";

const exampleCert = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/fixtures/born-with.example.json"), "utf8"),
);

describe("certHash", () => {
  it("matches the independently computed golden hash of the example cert", () => {
    expect(certHash(exampleCert)).toBe(GOLDEN_SHA256);
  });

  it("is order-independent in object keys but sensitive to values", () => {
    const reordered = {
      stampedBy: exampleCert.stampedBy,
      app: exampleCert.app,
      certVersion: exampleCert.certVersion,
      template: exampleCert.template,
      agenticPostureBinding: exampleCert.agenticPostureBinding,
      stampedAt: exampleCert.stampedAt,
    };
    expect(certHash(reordered)).toBe(GOLDEN_SHA256);
    expect(certHash({ ...exampleCert, stampedAt: "2020-01-01T00:00:00Z" })).not.toBe(GOLDEN_SHA256);
  });
});

describe("buildCert", () => {
  const base = {
    appName: "smoke-app",
    org: "statecrafting",
    templateName: "enrahitu",
    templateVersion: "0.1.0",
    contractVersion: "0.5.0",
    commit: "34134f9a48ddff75cca1df4f9a15e06140357bdd",
    stampedById: "statecraft/factory@1",
    stampedAt: new Date("2026-07-15T12:00:00Z"),
  };

  it("builds a schema-shaped cert with an explicit posture and defaulted:false", () => {
    const cert = buildCert({ ...base, posture: "assisted" });
    expect(cert.certVersion).toBe("1");
    expect(cert.app).toEqual({ name: "smoke-app", org: "statecrafting" });
    expect(cert.template.commit).toBe(base.commit);
    expect(cert.agenticPostureBinding).toEqual({ posture: "assisted", defaulted: false });
    expect(cert.stampedBy).toEqual({ kind: "factory", id: "statecraft/factory@1" });
    expect(cert.stampedAt).toBe("2026-07-15T12:00:00.000Z");
  });

  it("rejects an invalid posture", () => {
    // @ts-expect-error posture is intentionally invalid for this test
    expect(() => buildCert({ ...base, posture: "yolo" })).toThrow(CertError);
  });

  it("rejects a non-40-hex template commit", () => {
    expect(() => buildCert({ ...base, commit: "short", posture: "none" })).toThrow(CertError);
  });
});
