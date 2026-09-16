import { afterEach, describe, expect, it, vi } from "vitest";

import { rootLoader } from "./root";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("rootLoader (auth guard)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redirects unauthenticated visitors to /login", async () => {
    // /auth/me answers 401 and the refresh also fails: no session to rescue.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/v1/auth/refresh")) return new Response(null, { status: 401 });
      return jsonResponse(401, { code: "unauthenticated", message: "missing credentials" });
    });

    let thrown: unknown;
    try {
      await rootLoader();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Response);
    const res = thrown as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("returns the principal when authenticated", async () => {
    const me = {
      id: "u1",
      email: "casey@example.com",
      name: "Casey User",
      roles: ["user"],
      ssoProvider: "mock",
      isActive: true,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, me));

    const result = (await rootLoader()) as { me: typeof me };
    expect(result.me.email).toBe("casey@example.com");
  });
});
