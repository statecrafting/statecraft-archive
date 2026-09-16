/**
 * Minimal Node req/res helpers for the tenants service's api.raw handlers
 * (the GitHub setup callback and webhook). Kept local so the service does not
 * reach into another service's private helpers; the shapes mirror the chassis.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export function clientIp(req: IncomingMessage): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  const value = Array.isArray(xff) ? xff[0] : xff;
  if (value) return value.split(",")[0]!.trim();
  return req.socket?.remoteAddress ?? undefined;
}

export function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://localhost");
}

export function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

export function endText(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

/** Read the exact request bytes (not re-encoded): required for HMAC verify. */
export async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
