/**
 * In-memory sliding-window rate limiter for auth endpoints (spec 080 Phase 6 FR-029).
 *
 * IP-based, 20 requests per 60-second window. Returns 429 with Retry-After header
 * when exceeded. Expired entries pruned every 5 minutes.
 */

const WINDOW_MS = 60_000;      // 1 minute
const MAX_REQUESTS = 20;
const CLEANUP_INTERVAL_MS = 300_000; // 5 minutes

interface BucketEntry {
  timestamps: number[];
}

const buckets = new Map<string, BucketEntry>();

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);
    if (entry.timestamps.length === 0) buckets.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Check rate limit for an IP. Returns null if allowed,
 * or the number of seconds to wait if rate-limited.
 */
export function checkRateLimit(ip: string): number | null {
  const now = Date.now();
  let entry = buckets.get(ip);

  if (!entry) {
    entry = { timestamps: [] };
    buckets.set(ip, entry);
  }

  // Prune timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);

  if (entry.timestamps.length >= MAX_REQUESTS) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = WINDOW_MS - (now - oldestInWindow);
    return Math.ceil(retryAfterMs / 1000);
  }

  entry.timestamps.push(now);
  return null;
}

/**
 * Express/raw middleware helper: extracts IP and applies rate limit.
 * Uses socket.remoteAddress (not X-Forwarded-For) to prevent header spoofing.
 * Returns true if the request was rate-limited (response already sent).
 */
export function applyRateLimit(
  req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } },
  resp: { writeHead(code: number, headers?: Record<string, string>): void; end(body?: string): void }
): boolean {
  // Use socket IP only — X-Forwarded-For can be spoofed without a trusted proxy layer
  const ip = req.socket?.remoteAddress ?? "unknown";

  const retryAfter = checkRateLimit(ip);
  if (retryAfter !== null) {
    resp.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
    });
    resp.end(JSON.stringify({ error: "Too many requests", retryAfter }));
    return true;
  }
  return false;
}
