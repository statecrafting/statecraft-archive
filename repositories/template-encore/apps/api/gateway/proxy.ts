/**
 * BFF proxy (spec 004, INV-10): an api.raw catch-all at /api/v1/data/* that
 * forwards authenticated requests to the private backend with an injected S2S
 * OAuth Bearer token. Enforces path-traversal sanitisation, 5xx masking to 502,
 * upstream timeout to 504, a per-access audit line, and a 503 availability gate.
 *
 * All five handlers run behind the Gateway authHandler (auth:true), so an
 * unauthenticated caller is rejected with 401 before the body runs (FR-001).
 *
 * CC-006: logging and audit here route through lib/logger.ts and lib/audit.ts
 * (PII redaction); never log raw upstream bodies, tokens, or headers.
 */
import { api } from "encore.dev/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAuthData } from "~encore/auth";
import { env } from "../lib/env";
import { writeAudit } from "../lib/audit";
import { logSecurityEvent } from "../lib/logger";
import { getAccessToken, isGatewayConfigured } from "./token-cache";
import { sanitizePath } from "./path";
import { isServerError, isTimeoutError, stripErrorStack } from "./masking";

const PREFIX = "/api/v1/data";

function clientIp(req: IncomingMessage): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  const value = Array.isArray(xff) ? xff[0] : xff;
  if (value) return value.split(",")[0]!.trim();
  return req.socket?.remoteAddress ?? undefined;
}

function writeError(res: ServerResponse, status: number, code: string, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ code, message }));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function handleProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isGatewayConfigured()) {
    writeError(res, 503, "unavailable", "gateway is not configured");
    return;
  }

  const incoming = new URL(req.url ?? "/", "http://localhost");
  const rawForward = incoming.pathname.startsWith(PREFIX)
    ? incoming.pathname.slice(PREFIX.length)
    : incoming.pathname;
  const safePath = sanitizePath(rawForward || "/");
  if (safePath === null) {
    logSecurityEvent("gateway.blocked.path_traversal", { path: rawForward });
    writeError(res, 400, "invalid_argument", "invalid request path");
    return;
  }

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    writeError(res, 502, "bad_gateway", "upstream authentication failed");
    return;
  }

  const auth = getAuthData();
  const method = req.method ?? "GET";
  const upstreamUrl = `${env.privateApiBaseUrl}${safePath}${incoming.search}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.gatewayTimeoutMs);

  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const contentType = req.headers["content-type"];
    if (contentType) headers["Content-Type"] = Array.isArray(contentType) ? contentType[0]! : contentType;
    const accept = req.headers["accept"];
    if (accept) headers["Accept"] = Array.isArray(accept) ? accept[0]! : accept;

    const hasBody = method !== "GET" && method !== "HEAD";
    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body: hasBody ? await readBody(req) : undefined,
      signal: controller.signal,
    });

    await writeAudit({
      action: "gateway.access",
      recordId: safePath,
      actorId: auth?.userID,
      actorEmail: auth?.email,
      newData: { method, status: upstream.status },
      ipAddress: clientIp(req),
      userAgent: Array.isArray(req.headers["user-agent"]) ? undefined : req.headers["user-agent"],
    });

    // INV-10: upstream 5xx never leaks; collapse to a generic 502.
    if (isServerError(upstream.status)) {
      writeError(res, 502, "bad_gateway", "upstream service error");
      return;
    }

    const text = await upstream.text();
    res.statusCode = upstream.status;
    const respContentType = upstream.headers.get("content-type");
    if (respContentType) res.setHeader("Content-Type", respContentType);

    // Strip any stack trace from a 4xx JSON error body before forwarding.
    if (upstream.status >= 400 && respContentType?.includes("application/json")) {
      try {
        const parsed = stripErrorStack(JSON.parse(text));
        res.end(JSON.stringify(parsed));
        return;
      } catch {
        // fall through to raw body
      }
    }
    res.end(text);
  } catch (err) {
    if (isTimeoutError(err)) {
      writeError(res, 504, "deadline_exceeded", "upstream request timed out");
      return;
    }
    writeError(res, 502, "bad_gateway", "upstream request failed");
  } finally {
    clearTimeout(timer);
  }
}

export const dataGet = api.raw(
  { expose: true, auth: true, method: "GET", path: "/api/v1/data/*path" },
  handleProxy,
);
export const dataPost = api.raw(
  { expose: true, auth: true, method: "POST", path: "/api/v1/data/*path" },
  handleProxy,
);
export const dataPut = api.raw(
  { expose: true, auth: true, method: "PUT", path: "/api/v1/data/*path" },
  handleProxy,
);
export const dataPatch = api.raw(
  { expose: true, auth: true, method: "PATCH", path: "/api/v1/data/*path" },
  handleProxy,
);
export const dataDelete = api.raw(
  { expose: true, auth: true, method: "DELETE", path: "/api/v1/data/*path" },
  handleProxy,
);
