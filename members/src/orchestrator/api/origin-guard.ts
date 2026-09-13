// Spec 128: the origin guard. Spec 022 made the loopback interface the trust
// boundary, which keeps other machines out and does not keep out a page open
// in the operator's own browser: a browser sends a request to 127.0.0.1 for
// any page that asks. This module answers, before any route runs, whether a
// request came from something the daemon serves: a loopback name at the port
// it bound (B-1), its own origin or none (B-2), and, for anything that can
// change state, a header a cross-origin page cannot send without a preflight
// (B-3) that the server never grants (B-4).
//
// It is a pure function of the request's method and headers and the bound
// port. It compares text and never resolves a name (D-1): resolution is what a
// rebinding attack controls.
import { API_VERSION, API_VERSION_HEADER } from "./types";

export type GuardRule = "host" | "origin" | "preflight" | "header";

export interface GuardRequest {
  readonly method: string;
  readonly host: string | null;
  readonly origin: string | null;
  readonly apiVersion: string | null;
}

export type GuardVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly rule: GuardRule; readonly message: string };

// The three loopback names 022's bind accepts, in the form they take in an
// authority: an IPv6 literal is bracketed there.
const LOOPBACK_AUTHORITY_NAMES: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];

// A Host header omits the port when it is the scheme's default (RFC 9110
// §7.2), so at port 80 the bare name is the same authority (D-10).
const HTTP_DEFAULT_PORT = 80;

// A refusal names the value it saw; a header can be long, and the message is
// not the place to echo all of it.
const SEEN_VALUE_MAX_CHARS = 200;

export function loopbackAuthorities(port: number): readonly string[] {
  const withPort = LOOPBACK_AUTHORITY_NAMES.map((name) => `${name}:${port}`);
  return port === HTTP_DEFAULT_PORT ? [...withPort, ...LOOPBACK_AUTHORITY_NAMES] : withPort;
}

export function loopbackOrigins(port: number): readonly string[] {
  return loopbackAuthorities(port).map((authority) => `http://${authority}`);
}

function seen(value: string): string {
  const shown = value.length > SEEN_VALUE_MAX_CHARS ? `${value.slice(0, SEEN_VALUE_MAX_CHARS)}...` : value;
  return JSON.stringify(shown);
}

function refuse(rule: GuardRule, message: string): GuardVerdict {
  return { admitted: false, rule, message: `${rule}: ${message}` };
}

const STATE_SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export function admitRequest(request: GuardRequest, boundPort: number): GuardVerdict {
  const method = request.method.toUpperCase();

  // B-1: the Host header names the daemon, or nothing is served.
  if (request.host === null || request.host.trim().length === 0) {
    return refuse("host", "the request carries no Host header, and this daemon answers only a loopback name at its own port");
  }
  const authorities = loopbackAuthorities(boundPort);
  if (!authorities.includes(request.host.trim().toLowerCase())) {
    return refuse("host", `${seen(request.host)} is not a loopback name at port ${boundPort} (${authorities.join(", ")})`);
  }

  // B-2: an Origin, when present, is this daemon's own. `null` (a sandboxed
  // frame, a file: page) is a value, and not one of ours.
  if (request.origin !== null) {
    const origins = loopbackOrigins(boundPort);
    if (!origins.includes(request.origin.trim().toLowerCase())) {
      return refuse("origin", `${seen(request.origin)} is not this daemon's origin (${origins.join(", ")})`);
    }
  }

  // B-4: a preflight is refused here rather than routed, so no answer can
  // ever carry a grant of cross-origin access.
  if (method === "OPTIONS") {
    return refuse("preflight", "OPTIONS is refused: this daemon serves one origin and grants no cross-origin access");
  }

  // B-3: anything that can change state carries the version header, which
  // makes a cross-origin browser request a preflighted one (D-2).
  if (!STATE_SAFE_METHODS.has(method) && request.apiVersion === null) {
    return refuse(
      "header",
      `${method} needs ${API_VERSION_HEADER}: ${API_VERSION} (with curl: -H '${API_VERSION_HEADER}: ${API_VERSION}')`
    );
  }

  return { admitted: true };
}

export function guardRequestOf(request: Request): GuardRequest {
  return {
    method: request.method,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    apiVersion: request.headers.get(API_VERSION_HEADER),
  };
}

// --- the dev proxy (B-9) ----------------------------------------------------

// What the Vite dev server's proxy sets as `Origin` on a request it forwards to
// the daemon. A request whose Origin is exactly the dev server's own (the
// origin of the page the dev server served, `http://` plus the Host the browser
// addressed it by) is the dev UI and reaches the daemon as the daemon's own
// page. Any other Origin, `null` included, is forwarded unchanged, so B-2
// refuses it at the daemon. No Origin stays no Origin. The daemon carries no
// development exception (D-6).
export function devProxyOrigin(incomingOrigin: string | null, devServerHost: string | null, daemonOrigin: string): string | null {
  if (incomingOrigin === null) return null;
  if (devServerHost === null || devServerHost.length === 0) return incomingOrigin;
  return incomingOrigin.toLowerCase() === `http://${devServerHost.toLowerCase()}` ? daemonOrigin : incomingOrigin;
}
