// Spec 128 FR-001 and FR-009: the origin guard's table, at a port other than
// the default, for each loopback name, and the dev proxy's Origin rewrite as
// the Vite config wires it.
import { test, expect } from "bun:test";
import { admitRequest, devProxyOrigin, loopbackAuthorities, loopbackOrigins, type GuardRequest, type GuardVerdict } from "./origin-guard";
import { DEFAULT_API_PORT } from "./server";
import { API_VERSION_HEADER } from "./types";
import viteConfig, { DEV_DAEMON_ORIGIN, devApiProxy, devDaemonOrigin, rewriteProxiedOrigin } from "../../../web/vite.config";

const PORT = 51_234;

function request(overrides: Partial<GuardRequest>): GuardRequest {
  return { method: "GET", host: `127.0.0.1:${PORT}`, origin: null, apiVersion: null, ...overrides };
}

function refusedBy(verdict: GuardVerdict): string | null {
  return verdict.admitted ? null : verdict.rule;
}

test("the table is not the default port's, and names all three loopback forms", () => {
  expect(PORT).not.toBe(DEFAULT_API_PORT);
  expect(loopbackAuthorities(PORT)).toEqual([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
  expect(loopbackOrigins(PORT)).toEqual([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, `http://[::1]:${PORT}`]);
});

test("B-1: Host must be a loopback name at the bound port; nothing is resolved", () => {
  for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`, `LOCALHOST:${PORT}`]) {
    expect(admitRequest(request({ host }), PORT)).toEqual({ admitted: true });
  }
  const refusedHosts = [
    null,
    "",
    // The rebinding shape: the attacker's own name, once it resolves to 127.0.0.1.
    `rebind.attacker.example:${PORT}`,
    "rebind.attacker.example",
    // A loopback name at another port, or with no port at all.
    `127.0.0.1:${PORT + 1}`,
    "127.0.0.1",
    "localhost",
    // Names that resolve to loopback are still not the three names.
    `127.0.0.2:${PORT}`,
    `0.0.0.0:${PORT}`,
    `[0:0:0:0:0:0:0:1]:${PORT}`,
    `localhost.:${PORT}`,
  ];
  for (const host of refusedHosts) {
    expect(refusedBy(admitRequest(request({ host }), PORT))).toBe("host");
  }
  const message = admitRequest(request({ host: "rebind.attacker.example" }), PORT);
  expect(message.admitted).toBe(false);
  if (!message.admitted) expect(message.message).toContain('host: "rebind.attacker.example" is not a loopback name');
});

test("B-1 (D-10): at port 80 a Host without a port is the same authority", () => {
  expect(admitRequest(request({ host: "localhost" }), 80)).toEqual({ admitted: true });
  expect(admitRequest(request({ host: "localhost:80", origin: "http://localhost" }), 80)).toEqual({ admitted: true });
});

test("B-2: an Origin, when present, is the daemon's own; null and other ports are not", () => {
  for (const origin of [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, `http://[::1]:${PORT}`]) {
    expect(admitRequest(request({ method: "POST", origin, apiVersion: "2" }), PORT)).toEqual({ admitted: true });
  }
  // A request with no Origin is admitted: the CLI's client and curl send none.
  expect(admitRequest(request({ method: "POST", origin: null, apiVersion: "2" }), PORT)).toEqual({ admitted: true });
  for (const origin of [
    "https://attacker.example",
    "null",
    // The dev server's origin, which only the proxy may turn into the daemon's (B-9).
    "http://localhost:5173",
    `http://127.0.0.1:${PORT + 1}`,
    `https://127.0.0.1:${PORT}`,
    `http://127.0.0.1:${PORT}/`,
    `http://rebind.attacker.example:${PORT}`,
  ]) {
    // Refused with the header present, so the Origin rule alone is what refuses.
    expect(refusedBy(admitRequest(request({ method: "POST", origin, apiVersion: "2" }), PORT))).toBe("origin");
    expect(refusedBy(admitRequest(request({ method: "GET", origin }), PORT))).toBe("origin");
  }
});

test("B-3: every method but GET and HEAD carries X-Api-Version", () => {
  expect(admitRequest(request({ method: "GET" }), PORT)).toEqual({ admitted: true });
  expect(admitRequest(request({ method: "HEAD" }), PORT)).toEqual({ admitted: true });
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    const verdict = admitRequest(request({ method }), PORT);
    expect(refusedBy(verdict)).toBe("header");
    if (!verdict.admitted) expect(verdict.message).toContain(`-H '${API_VERSION_HEADER}: 2'`);
    expect(admitRequest(request({ method, apiVersion: "2" }), PORT)).toEqual({ admitted: true });
  }
  // Presence is the guard's rule; a wrong value is the version gate's (027 B-1).
  expect(admitRequest(request({ method: "POST", apiVersion: "1" }), PORT)).toEqual({ admitted: true });
});

test("B-4: a preflight is refused by the guard, whatever it carries", () => {
  expect(refusedBy(admitRequest(request({ method: "OPTIONS" }), PORT))).toBe("preflight");
  expect(refusedBy(admitRequest(request({ method: "OPTIONS", apiVersion: "2", origin: `http://127.0.0.1:${PORT}` }), PORT))).toBe(
    "preflight"
  );
});

test("B-5: a long value is shown bounded in the refusal", () => {
  const verdict = admitRequest(request({ origin: `https://${"a".repeat(1_000)}.example` }), PORT);
  expect(verdict.admitted).toBe(false);
  if (!verdict.admitted) expect(verdict.message.length).toBeLessThan(400);
});

// --- the dev proxy (B-9, FR-009) --------------------------------------------

test("FR-009: the proxy turns the dev server's own Origin into the daemon's, and forwards every other one unchanged", () => {
  const daemon = "http://127.0.0.1:4519";
  expect(devProxyOrigin("http://localhost:5173", "localhost:5173", daemon)).toBe(daemon);
  expect(devProxyOrigin("http://LOCALHOST:5173", "localhost:5173", daemon)).toBe(daemon);
  expect(devProxyOrigin(null, "localhost:5173", daemon)).toBeNull();
  for (const foreign of ["https://attacker.example", "null", "http://localhost:5174", "https://localhost:5173"]) {
    expect(devProxyOrigin(foreign, "localhost:5173", daemon)).toBe(foreign);
  }
  expect(devProxyOrigin("http://localhost:5173", null, daemon)).toBe("http://localhost:5173");
});

test("FR-009: the Vite config proxies /api with changeOrigin and rewrites Origin through the same function", () => {
  expect(devApiProxy.target).toBe(DEV_DAEMON_ORIGIN);
  expect(devApiProxy.changeOrigin).toBe(true);
  const config = viteConfig as { server?: { proxy?: Record<string, unknown> } };
  expect(config.server?.proxy?.["/api"]).toBe(devApiProxy);

  const set: Record<string, string> = {};
  const proxyReq = { getHeader: () => undefined, setHeader: (name: string, value: string) => void (set[name] = value) };
  rewriteProxiedOrigin(proxyReq, { headers: { host: "localhost:5173", origin: "http://localhost:5173" } });
  expect(set).toEqual({ origin: DEV_DAEMON_ORIGIN });

  const untouched: Record<string, string> = {};
  const foreignReq = { getHeader: () => undefined, setHeader: (name: string, value: string) => void (untouched[name] = value) };
  rewriteProxiedOrigin(foreignReq, { headers: { host: "localhost:5173", origin: "https://attacker.example" } });
  rewriteProxiedOrigin(foreignReq, { headers: { host: "localhost:5173" } });
  expect(untouched).toEqual({});

  // D-14: the target defaults to 022's address and moves only to another
  // loopback daemon; a non-loopback target stops the config from loading.
  expect(devDaemonOrigin(undefined)).toBe("http://127.0.0.1:4519");
  expect(devDaemonOrigin("http://127.0.0.1:4600/")).toBe("http://127.0.0.1:4600");
  expect(devDaemonOrigin("http://localhost:4600")).toBe("http://localhost:4600");
  expect(() => devDaemonOrigin("http://daemon.example:4519")).toThrow(/must be an http URL/);
  expect(() => devDaemonOrigin("https://127.0.0.1:4519")).toThrow(/must be an http URL/);
  expect(() => devDaemonOrigin("not a url")).toThrow(/is not a URL/);

  // The request the proxy then sends is one the daemon's guard admits.
  const daemonPort = Number(new URL(DEV_DAEMON_ORIGIN).port);
  expect(admitRequest({ method: "POST", host: `127.0.0.1:${daemonPort}`, origin: set.origin!, apiVersion: "2" }, daemonPort)).toEqual({
    admitted: true,
  });
});
