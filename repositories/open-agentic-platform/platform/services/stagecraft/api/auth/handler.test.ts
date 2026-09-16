// Spec 143: the Encore gateway auth handler runs for EVERY request that
// carries an Authorization header, including the platform's `auth: false` M2M
// endpoints (audit, policy, grants, knowledge-sweep). A `client_credentials`
// token fails the session audience check in `validateJwt` (its audience is the
// caller's own client, not `statecraft-server`), so the handler must return
// `null` (unauthenticated) rather than throw. Returning null lets Encore treat
// the request as having no user session: `auth: true` endpoints reject it,
// while `auth: false` M2M endpoints proceed to their own `validateM2mRequest`.
// Throwing here 401'd the knowledge-orphan-imported sweeper before its handler
// ran. This suite is the regression cover for that fix.
//
// Runs under `encore test` (see vite.config.ts): the module constructs an
// Encore `Gateway` at import time, so it needs the native runtime.

import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ validateJwt: vi.fn() }));
vi.mock("./rauthy", () => ({ validateJwt: fixture.validateJwt }));

import { auth } from "./handler";

describe("gateway auth handler: non-session tokens return null, not 401 (spec 143)", () => {
  beforeEach(() => {
    fixture.validateJwt.mockReset();
  });

  it("returns null (does not throw) when validateJwt rejects the token, so an M2M client_credentials token reaches per-endpoint validateM2mRequest", async () => {
    fixture.validateJwt.mockResolvedValue(null);
    await expect(
      auth({ authorization: "Bearer m2m.client-credentials.token" }),
    ).resolves.toBeNull();
  });

  it("returns null for a session cookie whose token no longer validates", async () => {
    fixture.validateJwt.mockResolvedValue(null);
    await expect(
      auth({ cookie: "__session=expired.session.jwt" }),
    ).resolves.toBeNull();
  });

  it("returns a user AuthData for a valid Rauthy session JWT (happy path unchanged)", async () => {
    fixture.validateJwt.mockResolvedValue({
      oap_user_id: "00000000-0000-0000-0000-0000000000a1",
      oap_org_id: "00000000-0000-0000-0000-0000000000b2",
      oap_org_slug: "acme",
      github_login: "octocat",
      idp_provider: "github",
      idp_login: "octocat",
      platform_role: "member",
    });
    const data = await auth({ authorization: "Bearer valid.session.jwt" });
    expect(data).not.toBeNull();
    expect(data?.userID).toBe("00000000-0000-0000-0000-0000000000a1");
    expect(data?.orgSlug).toBe("acme");
  });
});
