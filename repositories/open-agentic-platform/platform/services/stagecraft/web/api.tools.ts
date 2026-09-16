import { api } from "encore.dev/api";
import { createRequestHandler } from "react-router";
import { Readable } from "node:stream";

// @ts-ignore
const buildPromise = import("./build/server/index.js");

export const handlerPromise = (async () => {
  const build = await buildPromise;
  // mode optional: "development" | "production"
  return createRequestHandler(build, process.env.NODE_ENV === "production" ? "production" : "development");
})();

export const DEFAULT_PUBLIC_HOST = process.env.ENCORE_PUBLIC_HOST ?? "localhost:4000";

export function getOrigin(req: any) {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? (req.socket?.encrypted ? "https" : "http");
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? (req.headers["host"] as string | undefined) ?? DEFAULT_PUBLIC_HOST;

  // Ensure host has a port locally
  const hostFixed = (host === "localhost" || host === "127.0.0.1") && !host.includes(":") ? DEFAULT_PUBLIC_HOST : host;

  return `${proto}://${hostFixed}`;
}

export function toHeaders(nodeHeaders: Record<string, unknown>) {
  const h = new Headers();
  for (const [k, v] of Object.entries(nodeHeaders)) {
    if (v == null) continue;
    if (Array.isArray(v)) h.set(k, v.join(", "));
    else h.set(k, String(v));
  }
  return h;
}

export async function readBody(req: any): Promise<Uint8Array | null> {
  // GET/HEAD should not include body
  if (!req.method || req.method === "GET" || req.method === "HEAD") return null;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export async function sendFetchResponse(res: any, rr: Response) {
  res.statusCode = rr.status;

  rr.headers.forEach((value, key) => {
    // Node needs special handling for set-cookie
    if (key.toLowerCase() === "set-cookie") {
      // If multiple set-cookie headers exist, you’ll want to append rather than overwrite.
      // This is a minimal version:
      res.setHeader("set-cookie", value);
    } else {
      res.setHeader(key, value);
    }
  });

  if (!rr.body) {
    res.end();
    return;
  }

  // Stream the body back to Node response
  const nodeStream = Readable.fromWeb(rr.body as any);
  nodeStream.pipe(res);
}
