import { describe, expect, it } from "vitest";
import { isGatewayConfigured } from "./token-cache";

describe("gateway availability gate (spec 004 FR-007, INV-10)", () => {
  it("reports unconfigured when the backend URL and OAuth inputs are absent", () => {
    // PRIVATE_API_BASE_URL and GATEWAY_OAUTH_* are unset in the test environment,
    // so the proxy must report itself unconfigured (and return 503 at runtime).
    expect(isGatewayConfigured()).toBe(false);
  });
});
