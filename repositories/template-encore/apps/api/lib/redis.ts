/**
 * Optional Redis client (spec 018), the single baseline seam that reads the
 * typed REDIS_HOST / REDIS_USER / REDIS_PASSWORD connection triple (parallel to
 * the app's Postgres SQL_HOST / SQL_USERNAME / SQL_PASSWORD contract). There is
 * no REDIS_URL: one typed triple is the whole contract.
 *
 * Redis is opt-in. The `redis` block that declares the resource is composed into
 * apps/api/infra.config.json only when the factory data-redis module is selected
 * (factory-encore spec 008); the lean baseline carries this client but not the
 * block. The client is constructed lazily, so an app that never sets REDIS_HOST
 * opens no socket and pays nothing.
 *
 * Redis is NOT the rate-limit backend (that is Postgres, INV-6) and NOT a session
 * store (sessions are stateless JWT, INV-3 / INV-7). Its first concrete consumer
 * is the cron scheduler's large-scale distributed lock.
 */
import { Redis } from "ioredis";

/** True when a Redis connection is configured (REDIS_HOST set and non-empty). */
export function isRedisConfigured(): boolean {
  return (process.env.REDIS_HOST ?? "") !== "";
}

/**
 * Split a REDIS_HOST value ("host" or "host:port") into typed parts. Defaults to
 * port 6379 when no port is given or the port is not a finite number.
 */
export function parseRedisHost(hostPort: string): { host: string; port: number } {
  const [host, portStr] = hostPort.split(":");
  const parsed = portStr === undefined ? NaN : Number(portStr);
  return { host: host ?? "", port: Number.isFinite(parsed) ? parsed : 6379 };
}

let client: Redis | null = null;

/**
 * Lazily construct and memoize the Redis client from the typed triple. Opens no
 * socket until called. Throws when REDIS_HOST is unset so a misuse fails loudly
 * rather than silently connecting to a default localhost; guard callers with
 * isRedisConfigured() when Redis is optional (the small vs large tier branch).
 */
export function getRedis(): Redis {
  if (client) return client;
  const hostPort = process.env.REDIS_HOST ?? "";
  if (hostPort === "") {
    throw new Error(
      "getRedis() called while REDIS_HOST is unset. Guard optional-Redis paths with isRedisConfigured().",
    );
  }
  const { host, port } = parseRedisHost(hostPort);
  client = new Redis({
    host,
    port,
    username: process.env.REDIS_USER || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
  });
  return client;
}
