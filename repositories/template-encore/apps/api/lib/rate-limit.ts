/**
 * Rate limiting (INV-6), Postgres-backed. Two fixed-window tiers share the
 * application SQLDatabase("app") with no Redis and no separate cache: the
 * counter is a single UNLOGGED row per bucket (db/migrations/5_rate_limit.up.sql),
 * incremented with a lock-free upsert that resets the row when its window has
 * elapsed. A general API tier is mounted as service middleware; a tighter auth
 * tier is consumed inline by the login/callback endpoints. On any database error
 * the limiter fails open (availability over enforcement) and records the event;
 * only a real limit breach is rejected.
 */
import { APIError, middleware, type Middleware } from "encore.dev/api";
import { db } from "../db/db";
import { logSecurityEvent } from "./logger";

const API_LIMIT = 100;
const AUTH_LIMIT = 10;
const WINDOW_SECONDS = 60;

function clientKey(headers: Record<string, string | string[]>): string {
  const xff = headers["x-forwarded-for"];
  const forwarded = Array.isArray(xff) ? xff[0] : xff;
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const real = headers["x-real-ip"];
  return (Array.isArray(real) ? real[0] : real) ?? "anonymous";
}

/**
 * Atomically increment the fixed-window counter for `bucket` and return the new
 * count, or null if the backend is unavailable (the caller then fails open).
 * ON CONFLICT DO UPDATE serialises concurrent increments on the single bucket
 * row; the window-expiry CASE resets the count instead of letting it grow without
 * bound, so one row per bucket is reused across windows.
 */
async function increment(bucket: string): Promise<number | null> {
  try {
    const row = await db.queryRow<{ count: number }>`
      INSERT INTO rate_limit_counter (bucket, count, window_start, expires_at)
      VALUES (${bucket}, 1, now(), now() + ${WINDOW_SECONDS} * interval '1 second')
      ON CONFLICT (bucket) DO UPDATE SET
        count = CASE WHEN rate_limit_counter.expires_at < now()
                     THEN 1 ELSE rate_limit_counter.count + 1 END,
        window_start = CASE WHEN rate_limit_counter.expires_at < now()
                            THEN now() ELSE rate_limit_counter.window_start END,
        expires_at = CASE WHEN rate_limit_counter.expires_at < now()
                          THEN now() + ${WINDOW_SECONDS} * interval '1 second'
                          ELSE rate_limit_counter.expires_at END
      RETURNING count
    `;
    return row?.count ?? null;
  } catch {
    return null;
  }
}

async function withinLimit(tier: string, key: string, limit: number): Promise<boolean> {
  const count = await increment(`${tier}:${key}`);
  if (count === null) {
    // Backend unavailable: fail open so an outage never blocks legitimate traffic.
    logSecurityEvent("ratelimit.backend_error", { tier });
    return true;
  }
  if (count > limit) {
    logSecurityEvent("ratelimit.exceeded", { tier });
    return false;
  }
  return true;
}

/** General API tier, mounted as service middleware (spec 002 INV-6). */
export const apiRateLimit: Middleware = middleware(async (req, next) => {
  const meta = req.requestMeta;
  const key = meta && meta.type === "api-call" ? clientKey(meta.headers ?? {}) : "internal";
  if (!(await withinLimit("api", key, API_LIMIT))) {
    throw APIError.resourceExhausted("rate limit exceeded").withDetails({ code: "RATE_LIMITED" });
  }
  return next(req);
});

/**
 * Tighter auth tier, consumed inline by the login/callback raw handlers
 * (spec 003 FR-005). Keyed by client IP. Returns false when the caller has
 * exceeded the bucket so the handler can answer 429; fails open on a backend error.
 */
export async function withinAuthRateLimit(clientIp: string | undefined): Promise<boolean> {
  return withinLimit("auth", clientIp ?? "anonymous", AUTH_LIMIT);
}
