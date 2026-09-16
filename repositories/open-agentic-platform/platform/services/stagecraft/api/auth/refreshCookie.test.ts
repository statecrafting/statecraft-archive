import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";

// Hoist-safe mock: `vi.hoisted` runs before `vi.mock` factories, so the mock
// fn is initialised by the time refreshCookie imports ./rauthy.
const { refreshTokensMock } = vi.hoisted(() => ({
  refreshTokensMock: vi.fn(),
}));
vi.mock("./rauthy", () => ({
  refreshTokens: refreshTokensMock,
}));

import { refreshCookie } from "./refreshCookie";

interface CapturedResp {
  status: number;
  headers: Record<string, string | string[]> | undefined;
  body: string;
}

function mockReq(cookieHeader?: string): IncomingMessage {
  return {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    socket: { remoteAddress: `test-${Math.random().toString(36).slice(2)}` },
  } as unknown as IncomingMessage;
}

function mockResp(): { resp: ServerResponse; captured: CapturedResp } {
  const captured: CapturedResp = { status: 0, headers: undefined, body: "" };
  const resp = {
    writeHead(code: number, headers?: Record<string, string | string[]>) {
      captured.status = code;
      captured.headers = headers;
    },
    end(body?: string) {
      captured.body = body ?? "";
    },
  } as unknown as ServerResponse;
  return { resp, captured };
}

// `refreshCookie` is `api.raw(...)` — under the vitest mock at
// `test/__mocks__/encore-api.ts`, `api.raw(opts, handler)` returns the
// handler directly, so we can call it as a function.
type RawHandler = (req: IncomingMessage, resp: ServerResponse) => Promise<void>;
const handler = refreshCookie as unknown as RawHandler;

describe("POST /auth/refresh (refreshCookie endpoint)", () => {
  beforeEach(() => {
    refreshTokensMock.mockReset();
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  test("returns 401 when the __refresh cookie is absent", async () => {
    const { resp, captured } = mockResp();
    await handler(mockReq(), resp);
    expect(captured.status).toBe(401);
    expect(JSON.parse(captured.body)).toEqual({ error: "Missing refresh cookie" });
    expect(refreshTokensMock).not.toHaveBeenCalled();
  });

  test("returns 204 with rotated cookies when Rauthy returns fresh tokens", async () => {
    refreshTokensMock.mockResolvedValue({
      access_token: "NEW_ACCESS",
      refresh_token: "NEW_REFRESH",
      id_token: "NEW_ID",
      expires_in: 1800,
      token_type: "Bearer",
    });

    const { resp, captured } = mockResp();
    await handler(mockReq("__refresh=OLD_REFRESH"), resp);

    expect(refreshTokensMock).toHaveBeenCalledExactlyOnceWith("OLD_REFRESH");
    expect(captured.status).toBe(204);
    expect(captured.body).toBe("");
    const setCookies = captured.headers!["Set-Cookie"] as string[];
    expect(setCookies).toHaveLength(2);
    expect(setCookies[0]).toContain("__session=NEW_ACCESS;");
    expect(setCookies[0]).toContain("Max-Age=1800;");
    expect(setCookies[1]).toContain("__refresh=NEW_REFRESH;");
    expect(setCookies[1]).toContain("Max-Age=1209600;");
  });

  test("appends Secure attribute when NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    refreshTokensMock.mockResolvedValue({
      access_token: "A",
      refresh_token: "R",
      id_token: "I",
      expires_in: 60,
      token_type: "Bearer",
    });

    const { resp, captured } = mockResp();
    await handler(mockReq("__refresh=tok"), resp);

    const setCookies = captured.headers!["Set-Cookie"] as string[];
    expect(setCookies[0].endsWith(" Secure;")).toBe(true);
    expect(setCookies[1].endsWith(" Secure;")).toBe(true);
  });

  test("returns 401 when Rauthy rejects the refresh token", async () => {
    refreshTokensMock.mockRejectedValue(
      new Error("Rauthy token refresh failed: 400 invalid_grant")
    );

    const { resp, captured } = mockResp();
    await handler(mockReq("__refresh=BAD"), resp);

    expect(captured.status).toBe(401);
    expect(JSON.parse(captured.body)).toEqual({ error: "Refresh rejected" });
  });

  test("ignores other cookies and reads __refresh by name", async () => {
    refreshTokensMock.mockResolvedValue({
      access_token: "A",
      refresh_token: "R",
      id_token: "I",
      expires_in: 1800,
      token_type: "Bearer",
    });

    const { resp, captured } = mockResp();
    await handler(
      mockReq("__session=expired_jwt; __refresh=THE_TOKEN; analytics=xyz"),
      resp
    );

    expect(refreshTokensMock).toHaveBeenCalledExactlyOnceWith("THE_TOKEN");
    expect(captured.status).toBe(204);
  });
});
