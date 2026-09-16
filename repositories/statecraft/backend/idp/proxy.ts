/**
 * Raw passthrough proxy for rauthy.
 *
 * Everything under /auth/* (rauthy serves its whole surface below /auth/v1:
 * OIDC discovery, authorize, token, JWKS, the account and admin UIs) is
 * streamed to RAUTHY_UPSTREAM: in dev the docker-compose rauthy on
 * 127.0.0.1:8081, in the enrahitu container the co-resident rauthy process on
 * the same address. rauthy runs with PROXY_MODE=true and PUB_URL set to this
 * app's public host, so every absolute URL it mints stays on this origin.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { api } from "encore.dev/api";

const UPSTREAM = process.env.RAUTHY_UPSTREAM ?? "http://127.0.0.1:8081";

/** Hop-by-hop headers never forwarded in either direction (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Undici transparently decompresses, so these response headers would lie
// about the body we actually write back.
const RESPONSE_STRIP = new Set([...HOP_BY_HOP, "content-encoding", "content-length"]);

function forwardHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    const name = key.toLowerCase();
    if (HOP_BY_HOP.has(name) || name === "host") continue;
    // Drop the browser's Sec-Fetch-* metadata. This proxy forwards via undici
    // fetch(), which unconditionally rewrites Sec-Fetch-Mode to `cors` (it is a
    // forbidden request header a fetch() call always sets to its own mode). A
    // corrupted value is worse than none: rauthy's CSRF guard reads
    // Sec-Fetch-Mode and allows a top-level `navigate` but not `cors`, so the
    // rewrite makes every genuine cross-site navigation through this proxy look
    // like a forged cors request. That false-positive blocks rauthy's own
    // upstream-provider callback (GitHub -> /auth/v1/providers/callback) with
    // "cross-origin request forbidden". Forwarding none lets rauthy fall back to
    // its header-absent path and rely on its other CSRF defenses (the OAuth
    // `state` parameter, PKCE, and __Host- SameSite cookies), which this proxy
    // does not touch.
    if (name.startsWith("sec-fetch-")) continue;
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      headers.append(key, v);
    }
  }
  const clientIp = req.socket?.remoteAddress ?? "";
  const priorXff = req.headers["x-forwarded-for"];
  headers.set(
    "x-forwarded-for",
    priorXff ? `${Array.isArray(priorXff) ? priorXff[0] : priorXff}, ${clientIp}` : clientIp,
  );
  if (!headers.has("x-forwarded-proto")) headers.set("x-forwarded-proto", "http");
  if (req.headers.host) headers.set("x-forwarded-host", req.headers.host);
  return headers;
}

async function proxyToRauthy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const target = new URL(req.url ?? "/", UPSTREAM);
  const method = (req.method ?? "GET").toUpperCase();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: forwardHeaders(req),
      // Readable.from re-wraps Encore's RawRequest before toWeb: RawRequest
      // carries a non-EventEmitter `.req` (the napi handle), and node's
      // end-of-stream cleanup calls `.req.removeListener()` on any stream
      // that has one, crashing the process on the first body-bearing proxy
      // request (the browser login POST).
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : Readable.toWeb(Readable.from(req)),
      redirect: "manual", // rauthy's redirects belong to the browser, not the proxy
      // duplex is required by undici for streaming request bodies.
      duplex: "half",
    });
  } catch {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ code: "idp_unavailable", message: "rauthy upstream unreachable" }));
    return;
  }

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, name) => {
    if (RESPONSE_STRIP.has(name) || name === "set-cookie") return;
    res.setHeader(name, value);
  });
  const setCookies = upstream.headers.getSetCookie();
  if (setCookies.length > 0) res.setHeader("Set-Cookie", setCookies);

  if (upstream.body) {
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
  } else {
    res.end();
  }
}

// All methods, everything below /auth/.
export const proxy = api.raw(
  { expose: true, method: "*", path: "/auth/*rest" },
  proxyToRauthy,
);
