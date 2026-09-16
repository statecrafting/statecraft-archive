// Spec 137 Phase 2 / T025 — Statecraft API access-gate handler tests.
//
// Two test surfaces:
//
//   1. `assertNoPasswordFields` — pure helper covering FR-007's
//      defense-in-depth password rejection. Runs under bare vitest.
//   2. End-to-end audit-log emission — gated to `encore test` because
//      it mutates live DB rows. Drives `putAccessGate` /
//      `addAllowlistEntry` / `removeAllowlistEntry` through the
//      exported handler functions and asserts an `audit_log` row
//      appears with the expected `action` + `target_id` shape.
//
// The bare-vitest unit tests run on every `npm test` invocation; the
// integration test is registered in `vite.config.ts` exclude list so
// only `encore test` exercises it (live DB).

import { describe, expect, test } from "vitest";
import { APIError } from "encore.dev/api";
import {
  assertNoPasswordFields,
  validateFederatedProviderPair,
} from "./accessGatesHelpers";

// ---------------------------------------------------------------------------
// Pure helper — assertNoPasswordFields (FR-007)
// ---------------------------------------------------------------------------

describe("assertNoPasswordFields (FR-007 defense-in-depth)", () => {
  test("accepts an empty object", () => {
    expect(() => assertNoPasswordFields({})).not.toThrow();
  });

  test("accepts payloads with normal access-gate fields", () => {
    expect(() =>
      assertNoPasswordFields({
        environmentId: "env-1",
        enabled: true,
        rauthyClientRef: "rauthy-client-1",
        loginMethodMagicLink: true,
        loginMethodFederatedProvider: "google",
        loginMethodFederatedProviderClientRef: "google-client-1",
      }),
    ).not.toThrow();
  });

  test("accepts non-object inputs (null, undefined, primitive)", () => {
    expect(() => assertNoPasswordFields(null)).not.toThrow();
    expect(() => assertNoPasswordFields(undefined)).not.toThrow();
    expect(() => assertNoPasswordFields("string")).not.toThrow();
    expect(() => assertNoPasswordFields(42)).not.toThrow();
  });

  test("rejects exact 'password' key", () => {
    expect(() =>
      assertNoPasswordFields({ password: "hunter2" }),
    ).toThrow(APIError);
    try {
      assertNoPasswordFields({ password: "hunter2" });
    } catch (e) {
      expect((e as APIError).code).toBe("invalid_argument");
      expect((e as Error).message).toContain("FR-007");
    }
  });

  test("rejects common password aliases (case-insensitive)", () => {
    for (const key of [
      "Password",
      "PASSWORD",
      "pwd",
      "PWD",
      "passwd",
      "user_password",
      "userPassword",
      "old_password",
      "newPasswordHash",
      "secret_password",
    ]) {
      expect(() => assertNoPasswordFields({ [key]: "x" })).toThrow(APIError);
    }
  });

  test("does NOT reject Rauthy client refs or other secret-named fields that aren't passwords", () => {
    // These fields contain the substring 'secret' but not 'password'.
    // The gate manages references to Rauthy-stored credentials, not the
    // credentials themselves; rejecting all 'secret' fields would prevent
    // legitimate descriptor updates.
    expect(() =>
      assertNoPasswordFields({
        rauthyClientRef: "rauthy-1",
        secretRef: "k8s-secret-1",
        client_secret_ref: "vault://secret/path",
      }),
    ).not.toThrow();
  });

  test("rejects when password-like field is present alongside legitimate fields", () => {
    expect(() =>
      assertNoPasswordFields({
        environmentId: "env-1",
        enabled: true,
        password: "leak",
      }),
    ).toThrow(/FR-007/);
  });
});

// ---------------------------------------------------------------------------
// Pure helper — validateFederatedProviderPair
// ---------------------------------------------------------------------------

describe("validateFederatedProviderPair", () => {
  test("accepts both-null (federated disabled)", () => {
    expect(validateFederatedProviderPair(null, null)).toEqual({
      provider: null,
      clientRef: null,
    });
    expect(validateFederatedProviderPair(undefined, undefined)).toEqual({
      provider: null,
      clientRef: null,
    });
  });

  test("accepts each known provider with a client ref", () => {
    for (const p of ["google", "microsoft", "github", "generic_oidc"]) {
      expect(validateFederatedProviderPair(p, "client-x")).toEqual({
        provider: p,
        clientRef: "client-x",
      });
    }
  });

  test("rejects unknown provider value", () => {
    expect(() => validateFederatedProviderPair("okta", "client-x")).toThrow(
      APIError,
    );
    try {
      validateFederatedProviderPair("okta", "client-x");
    } catch (e) {
      expect((e as APIError).code).toBe("invalid_argument");
    }
  });

  test("rejects pair inconsistency (provider without ref)", () => {
    expect(() => validateFederatedProviderPair("google", null)).toThrow(
      /both be set or both be null/,
    );
  });

  test("rejects pair inconsistency (ref without provider)", () => {
    expect(() =>
      validateFederatedProviderPair(null, "orphan-ref"),
    ).toThrow(/both be set or both be null/);
  });
});
