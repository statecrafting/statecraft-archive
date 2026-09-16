import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  fetchWithRefresh,
  __resetRefreshInFlightForTests,
} from "./fetchWithRefresh";

type FetchInput = RequestInfo | URL;
type Recorded = { input: FetchInput; init?: RequestInit };
type Responder = (call: Recorded) => Response;

function installMockFetch(): { calls: Recorded[]; setResponder: (fn: Responder) => void } {
  const calls: Recorded[] = [];
  let responder: Responder = () => new Response(null, { status: 200 });
  const mock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
    const call: Recorded = { input, init };
    calls.push(call);
    return responder(call);
  });
  vi.stubGlobal("fetch", mock);
  return { calls, setResponder: (fn) => (responder = fn) };
}

function urlOf(input: FetchInput): string {
  return typeof input === "string" ? input : input.toString();
}

describe("fetchWithRefresh", () => {
  beforeEach(() => {
    __resetRefreshInFlightForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("passes through a 200 response without calling /auth/refresh", async () => {
    const { calls, setResponder } = installMockFetch();
    setResponder(() => new Response("ok", { status: 200 }));

    const resp = await fetchWithRefresh("/api/foo", { method: "GET" });

    expect(resp.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(urlOf(calls[0].input)).toBe("/api/foo");
  });

  test("on 401 → POSTs /auth/refresh → on 204 retries the original request once", async () => {
    const { calls, setResponder } = installMockFetch();
    setResponder((call) => {
      const url = urlOf(call.input);
      if (url === "/auth/refresh") return new Response(null, { status: 204 });
      // Original /api/foo: 401 the first time, 200 the second.
      if (calls.filter((c) => urlOf(c.input) === "/api/foo").length === 1) {
        return new Response(null, { status: 401 });
      }
      return new Response(null, { status: 200 });
    });

    const resp = await fetchWithRefresh("/api/foo", { method: "POST" });

    expect(resp.status).toBe(200);
    expect(calls.map((c) => urlOf(c.input))).toEqual([
      "/api/foo",
      "/auth/refresh",
      "/api/foo",
    ]);
    const refreshCall = calls.find((c) => urlOf(c.input) === "/auth/refresh")!;
    expect(refreshCall.init?.method).toBe("POST");
    expect(refreshCall.init?.credentials).toBe("same-origin");
  });

  test("on 401 + refresh non-204 → returns the original 401 without retry", async () => {
    const { calls, setResponder } = installMockFetch();
    setResponder((call) => {
      const url = urlOf(call.input);
      if (url === "/auth/refresh") return new Response(null, { status: 401 });
      return new Response(null, { status: 401 });
    });

    const resp = await fetchWithRefresh("/api/foo");

    expect(resp.status).toBe(401);
    expect(calls.map((c) => urlOf(c.input))).toEqual([
      "/api/foo",
      "/auth/refresh",
    ]);
  });

  test("on 401 + refresh fetch throws → returns the original 401", async () => {
    const { calls, setResponder } = installMockFetch();
    setResponder((call) => {
      if (urlOf(call.input) === "/auth/refresh") {
        throw new TypeError("network down");
      }
      return new Response(null, { status: 401 });
    });

    const resp = await fetchWithRefresh("/api/foo");

    expect(resp.status).toBe(401);
    expect(calls.map((c) => urlOf(c.input))).toEqual([
      "/api/foo",
      "/auth/refresh",
    ]);
  });

  test("single-flights /auth/refresh under N concurrent 401s", async () => {
    const { calls, setResponder } = installMockFetch();

    // Gate the refresh so all concurrent requests pile up on the same
    // in-flight promise before any of them resolves and clears the slot.
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((r) => (releaseRefresh = r));

    // Per-URL state: first hit returns 401, retry returns 200.
    const hitsByUrl = new Map<string, number>();
    setResponder(async (call) => {
      const url = urlOf(call.input);
      if (url === "/auth/refresh") {
        await refreshGate;
        return new Response(null, { status: 204 });
      }
      const prev = hitsByUrl.get(url) ?? 0;
      hitsByUrl.set(url, prev + 1);
      return new Response(null, { status: prev === 0 ? 401 : 200 });
    });

    // Kick off 5 concurrent requests; they all 401 on the first hit and
    // should converge on a single /auth/refresh promise.
    const pending = Array.from({ length: 5 }, (_, i) =>
      fetchWithRefresh(`/api/foo?n=${i}`)
    );

    // Yield enough microtasks for each fetch to land its 401 and register
    // for the in-flight refresh.
    await new Promise((r) => setTimeout(r, 10));

    // Exactly one /auth/refresh should be in flight.
    expect(
      calls.filter((c) => urlOf(c.input) === "/auth/refresh").length
    ).toBe(1);

    releaseRefresh();
    const responses = await Promise.all(pending);

    expect(responses.every((r) => r.status === 200)).toBe(true);
    // One refresh covered all five concurrent retries.
    expect(
      calls.filter((c) => urlOf(c.input) === "/auth/refresh").length
    ).toBe(1);
  });

  test("a fresh 401 after a previous refresh window starts a new refresh", async () => {
    const { calls, setResponder } = installMockFetch();
    let refreshCount = 0;
    setResponder((call) => {
      const url = urlOf(call.input);
      if (url === "/auth/refresh") {
        refreshCount++;
        return new Response(null, { status: 204 });
      }
      // Each /api/foo call: first hit 401, second 200.
      const hits = calls.filter((c) => urlOf(c.input) === url).length;
      return new Response(null, { status: hits === 1 ? 401 : 200 });
    });

    const r1 = await fetchWithRefresh("/api/foo");
    const r2 = await fetchWithRefresh("/api/bar");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Two separate batches → two refreshes (slot is cleared after each).
    expect(refreshCount).toBe(2);
  });
});
