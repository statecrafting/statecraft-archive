/**
 * Integration tests for the BFF proxy handler (spec 004 AC-2, INV-10). Run under
 * `encore test` (npm run test:integration), which resolves `~encore/*` and the
 * runtime. Excluded from the fast `npm test` by the `.itest.ts` naming.
 *
 * token-cache and the audit/logger writers are mocked so the masking and timeout
 * decisions can be driven deterministically without a configured upstream; the
 * pure masking functions are additionally unit-tested in masking.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./token-cache", () => ({
  isGatewayConfigured: vi.fn(() => true),
  getAccessToken: vi.fn(async () => "s2s-token"),
}));
vi.mock("../lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("../lib/logger", () => ({ logSecurityEvent: vi.fn() }));

import { handleProxy } from "./proxy";
import { isGatewayConfigured, getAccessToken } from "./token-cache";
import { writeAudit } from "../lib/audit";

function makeReq(opts: { method?: string; url?: string; headers?: Record<string, string> } = {}) {
  return {
    method: opts.method ?? "GET",
    url: opts.url ?? "/api/v1/data/widgets",
    headers: opts.headers ?? {},
    socket: { remoteAddress: "203.0.113.5" },
  } as never;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    body: "",
    setHeader(key: string, value: string) {
      headers[key.toLowerCase()] = value;
    },
    end(chunk?: string) {
      if (chunk) res.body += chunk;
    },
    headers,
  };
  return res;
}

function upstream(status: number, body = "", contentType = "application/json") {
  return {
    status,
    headers: { get: (key: string) => (key.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isGatewayConfigured).mockReturnValue(true);
  vi.mocked(getAccessToken).mockResolvedValue("s2s-token");
});

describe("handleProxy masking and availability (spec 004, INV-10)", () => {
  it("returns 503 when the gateway is unconfigured", async () => {
    vi.mocked(isGatewayConfigured).mockReturnValue(false);
    const res = makeRes();
    await handleProxy(makeReq(), res as never);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe("unavailable");
  });

  it("returns 502 when the S2S token fetch fails, and does not call fetch", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new Error("token endpoint down"));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = makeRes();
    await handleProxy(makeReq(), res as never);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).message).toBe("upstream authentication failed");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each([500, 502, 503])("masks upstream %i to a generic 502 and drops the body", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => upstream(status, "secret upstream stack trace")));
    const res = makeRes();
    await handleProxy(makeReq(), res as never);
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("secret upstream");
    expect(JSON.parse(res.body).message).toBe("upstream service error");
    vi.unstubAllGlobals();
  });

  it("does not mask a 499 (boundary): forwards it unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => upstream(499, '{"ok":false}')));
    const res = makeRes();
    await handleProxy(makeReq(), res as never);
    expect(res.statusCode).toBe(499);
    vi.unstubAllGlobals();
  });

  it("maps an AbortError (timeout) to 504", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }));
    const res = makeRes();
    await handleProxy(makeReq(), res as never);
    expect(res.statusCode).toBe(504);
    expect(JSON.parse(res.body).code).toBe("deadline_exceeded");
    vi.unstubAllGlobals();
  });

  it("maps a generic network error to 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    const res = makeRes();
    await handleProxy(makeReq(), res as never);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).message).toBe("upstream request failed");
    vi.unstubAllGlobals();
  });

  it("strips error.stack from a 4xx JSON body before forwarding", async () => {
    const leaky = JSON.stringify({ error: { code: "bad_request", message: "no", stack: "at internal()" } });
    vi.stubGlobal("fetch", vi.fn(async () => upstream(400, leaky)));
    const res = makeRes();
    await handleProxy(makeReq(), res as never);
    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error.stack).toBeUndefined();
    expect(parsed.error.code).toBe("bad_request");
    vi.unstubAllGlobals();
  });

  it("passes a 2xx through, injects only the S2S Bearer token, and writes one audit record", async () => {
    const fetchSpy = vi.fn<(input: unknown, init?: { headers: Record<string, string> }) => Promise<unknown>>(
      async () => upstream(200, '{"data":1}'),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const res = makeRes();
    await handleProxy(makeReq({ headers: { authorization: "Bearer caller-token" } }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"data":1}');
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(init!.headers.Authorization).toBe("Bearer s2s-token");
    expect(JSON.stringify(init!.headers)).not.toContain("caller-token");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeAudit).mock.calls[0]?.[0].action).toBe("gateway.access");
    vi.unstubAllGlobals();
  });
});
