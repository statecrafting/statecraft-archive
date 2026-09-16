import { describe, expect, test } from "vitest";
import { errorCodeForReason } from "./rauthyCallback-pure";

describe("errorCodeForReason (spec 106 FR-004 error mapping)", () => {
  test("maps PAT-specific reasons to explicit user-facing codes", () => {
    expect(errorCodeForReason("pat_required")).toBe("pat_required");
    expect(errorCodeForReason("pat_invalid")).toBe("pat_invalid");
    expect(errorCodeForReason("pat_saml_not_authorized")).toBe("pat_saml_not_authorized");
    expect(errorCodeForReason("pat_rate_limited")).toBe("pat_rate_limited");
  });

  test("maps transient resolver failures to membership_failed", () => {
    expect(errorCodeForReason("membership_api_failed")).toBe("membership_failed");
  });

  test("maps no_installed_orgs and ok to no_orgs (terminal no-match)", () => {
    expect(errorCodeForReason("no_installed_orgs")).toBe("no_orgs");
    expect(errorCodeForReason("ok")).toBe("no_orgs");
  });
});
