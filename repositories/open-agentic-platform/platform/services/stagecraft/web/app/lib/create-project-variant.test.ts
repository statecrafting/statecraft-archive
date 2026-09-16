// Spec 227 Stage 2: the two-axis to variant/profile mapping.

import { describe, expect, test } from "vitest";
import {
  toVariant,
  profileName,
  DEFAULT_AUTH_DRIVER,
} from "./create-project-variant";

describe("toVariant", () => {
  test("single + public -> single-public", () => {
    expect(toVariant("single", "public")).toBe("single-public");
  });
  test("single + internal -> single-internal", () => {
    expect(toVariant("single", "internal")).toBe("single-internal");
  });
  test("dual collapses auth to dual", () => {
    expect(toVariant("dual", "public")).toBe("dual");
    expect(toVariant("dual", "internal")).toBe("dual");
  });
});

describe("profileName", () => {
  test("single resolves to the auth axis", () => {
    expect(profileName("single", "public")).toBe("public");
    expect(profileName("single", "internal")).toBe("internal");
  });
  test("dual resolves to dual regardless of auth", () => {
    expect(profileName("dual", "public")).toBe("dual");
    expect(profileName("dual", "internal")).toBe("dual");
  });
  test("minimal is never produced at this surface", () => {
    for (const t of ["single", "dual"] as const) {
      for (const a of ["public", "internal"] as const) {
        expect(profileName(t, a)).not.toBe("minimal");
      }
    }
  });
});

// Spec 229 auth-driver axis: orthogonal to topology/audience; not an input to
// toVariant/profileName. The OAP create surface defaults to production Rauthy.
describe("auth driver axis (spec 229)", () => {
  test("default driver at the OAP surface is rauthy", () => {
    expect(DEFAULT_AUTH_DRIVER).toBe("rauthy");
  });
});
