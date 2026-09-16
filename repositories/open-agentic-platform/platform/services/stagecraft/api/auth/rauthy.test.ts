import { describe, expect, test } from "vitest";
import { extractOapClaims, readIncumbentPlatformRole } from "./rauthy-pure";

describe("extractOapClaims", () => {
  test("reads claims from payload.custom.* (spec 106 FR-002 layout)", () => {
    const payload = {
      sub: "rauthy-user-1",
      iss: "https://rauthy.example.com/auth/v1",
      exp: 9999999999,
      iat: 1700000000,
      custom: {
        oap_user_id: "oap-user-1",
        oap_org_id: "org-1",
        oap_org_slug: "acme",
        github_login: "alice",
        idp_provider: "github",
        idp_login: "alice",
        avatar_url: "https://avatars.example.com/alice",
        platform_role: "member",
      },
    };

    const claims = extractOapClaims(payload);
    expect(claims).not.toBeNull();
    expect(claims!.oap_user_id).toBe("oap-user-1");
    expect(claims!.oap_org_id).toBe("org-1");
    expect(claims!.oap_org_slug).toBe("acme");
    expect(claims!.github_login).toBe("alice");
    expect(claims!.platform_role).toBe("member");
    expect(claims!.sub).toBe("rauthy-user-1");
  });

  test("falls back to top-level keys (legacy admin-mint layout)", () => {
    const payload = {
      sub: "rauthy-user-2",
      exp: 9999999999,
      iat: 1700000000,
      oap_user_id: "oap-user-2",
      oap_org_id: "org-2",
      oap_org_slug: "legacy",
      platform_role: "admin",
    };

    const claims = extractOapClaims(payload);
    expect(claims).not.toBeNull();
    expect(claims!.oap_user_id).toBe("oap-user-2");
    expect(claims!.oap_org_slug).toBe("legacy");
    expect(claims!.platform_role).toBe("admin");
  });

  test("custom.* takes precedence over top-level when both are present", () => {
    const payload = {
      sub: "rauthy-user-3",
      exp: 9999999999,
      iat: 1700000000,
      oap_user_id: "top-level",
      oap_org_id: "org-3",
      oap_org_slug: "mix",
      platform_role: "member",
      custom: {
        oap_user_id: "custom-wins",
        oap_org_id: "org-3",
        oap_org_slug: "mix",
        platform_role: "owner",
      },
    };

    const claims = extractOapClaims(payload);
    expect(claims!.oap_user_id).toBe("custom-wins");
    expect(claims!.platform_role).toBe("owner");
  });

  test("returns null when required claims are missing", () => {
    expect(
      extractOapClaims({
        sub: "x",
        exp: 9999999999,
        iat: 0,
        custom: {
          oap_user_id: "u",
          oap_org_id: "o",
          // missing oap_org_slug + platform_role
        },
      })
    ).toBeNull();
  });

  test("ignores empty-string claim values", () => {
    const payload = {
      sub: "x",
      exp: 9999999999,
      iat: 0,
      custom: {
        oap_user_id: "",
        oap_org_id: "o",
        oap_org_slug: "s",
        platform_role: "member",
      },
    };

    expect(extractOapClaims(payload)).toBeNull();
  });
});

describe("readIncumbentPlatformRole", () => {
  test("reads owner/admin/member from payload.custom.platform_role", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      expect(
        readIncumbentPlatformRole({ custom: { platform_role: role } })
      ).toBe(role);
    }
  });

  test("accepts the legacy top-level layout", () => {
    expect(readIncumbentPlatformRole({ platform_role: "admin" })).toBe("admin");
  });

  test("custom.* wins over a top-level value", () => {
    expect(
      readIncumbentPlatformRole({
        platform_role: "member",
        custom: { platform_role: "owner" },
      })
    ).toBe("owner");
  });

  test("returns null when absent or unrecognised", () => {
    expect(readIncumbentPlatformRole({})).toBeNull();
    expect(readIncumbentPlatformRole({ custom: {} })).toBeNull();
    expect(
      readIncumbentPlatformRole({ custom: { platform_role: "" } })
    ).toBeNull();
    expect(
      readIncumbentPlatformRole({ custom: { platform_role: "superuser" } })
    ).toBeNull();
  });
});
