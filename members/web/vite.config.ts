// The SPA's build (spec 024 FR-001). `bun run web:build` writes `web/dist`,
// which src/orchestrator/api/static.ts serves same-origin from the daemon.
//
// Two settings are load-bearing rather than taste. `base: "/"` makes the
// emitted asset URLs absolute, which is what the daemon serves them at.
// `assetsInlineLimit: 0` keeps every asset a real file rather than a data
// URL, so what the page loads is exactly what is on disk under `dist/assets`
// and nothing is smuggled into the HTML.
import { fileURLToPath } from "node:url";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { devProxyOrigin } from "../src/orchestrator/api/origin-guard";

const here = fileURLToPath(new URL(".", import.meta.url));

// The loopback daemon the dev server forwards to, and so the only origin the
// daemon's guard admits (spec 128 B-2): 022's default address, or
// `STATECRAFT_DEV_DAEMON_URL` for a contributor whose default port is taken by
// a daemon they are not developing against (128 D-14). Only a loopback name is
// accepted; anything else stops the dev server rather than proxying off-host.
export const DEV_DAEMON_URL_ENV = "STATECRAFT_DEV_DAEMON_URL";

export function devDaemonOrigin(value: string | undefined): string {
  if (value === undefined || value.length === 0) return "http://127.0.0.1:4519";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${DEV_DAEMON_URL_ENV}=${value} is not a URL`);
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(`${DEV_DAEMON_URL_ENV}=${value} must be an http URL at 127.0.0.1, localhost or [::1]`);
  }
  return url.origin;
}

export const DEV_DAEMON_ORIGIN = devDaemonOrigin(process.env[DEV_DAEMON_URL_ENV]);

// The two halves of a proxied request this config touches, as narrow shapes
// so a test can drive them without a socket.
export interface ProxiedRequest {
  getHeader(name: string): number | string | string[] | undefined;
  setHeader(name: string, value: string): void;
}

export interface IncomingDevRequest {
  readonly headers: { readonly host?: string; readonly origin?: string };
}

// Spec 128 B-9: the dev UI reaches the daemon as the daemon's own page.
// `changeOrigin` already gives the daemon its own `Host`; this sets `Origin`
// to the daemon's only when the browser's `Origin` is exactly the dev
// server's own, and leaves any other value, and its absence, as it came, for
// the daemon's guard to judge. The daemon has no development exception (D-6).
export function rewriteProxiedOrigin(proxyReq: ProxiedRequest, req: IncomingDevRequest, daemonOrigin: string = DEV_DAEMON_ORIGIN): void {
  const incoming = req.headers.origin ?? null;
  const outgoing = devProxyOrigin(incoming, req.headers.host ?? null, daemonOrigin);
  if (outgoing !== null && outgoing !== incoming) proxyReq.setHeader("origin", outgoing);
}

export const devApiProxy: ProxyOptions = {
  target: DEV_DAEMON_ORIGIN,
  changeOrigin: true,
  configure(proxy) {
    proxy.on("proxyReq", (proxyReq, req) => rewriteProxiedOrigin(proxyReq, req as IncomingDevRequest));
  },
};

export default defineConfig({
  root: here,
  base: "/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    // Sourcemaps stay out of the shipped bundle: they would be the only
    // artifact here that quietly references paths outside the checkout.
    sourcemap: false,
  },
  // Development only, and still same-origin from the browser's point of view:
  // the dev server forwards `/api` (reads, controls, and the SSE stream) to a
  // loopback daemon, so the app never learns a second origin exists. In dev
  // mode the rebinding defense for the dev server itself is Vite's own host
  // check (`server.allowedHosts`), not the daemon's B-1 (128 D-6).
  server: {
    proxy: {
      "/api": devApiProxy,
    },
  },
});
