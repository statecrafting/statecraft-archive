import { getRedis, isRedisConfigured } from "../lib/redis";
import { claimByPostgres } from "./store";

// The tiered distributed lock (spec 009 FR-003). tryAcquire returns true if THIS
// caller should fire the job now:
//   - small scale (postgres-only, default): the Postgres atomic claim is the lock;
//   - large scale (Redis configured): a Redis SET NX lock guards the fire window
//     across replicas, avoiding row-level contention on the schedule table.
// The backend is auto-detected from the typed REDIS_HOST / REDIS_USER /
// REDIS_PASSWORD connection via the baseline lib/redis client (template-encore
// spec 018): when the data-redis resource is composed and provisioned,
// isRedisConfigured() is true and the large tier engages; otherwise the small
// tier opens no Redis socket (FR-003, AC-4).

async function acquireRedis(id: string, ttlMs: number): Promise<boolean> {
  const redis = getRedis();
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await redis.set(`cron:lock:${id}`, token, "PX", ttlMs, "NX");
  return res === "OK";
}

export async function tryAcquire(id: string, ttlMs: number): Promise<boolean> {
  if (isRedisConfigured()) {
    return acquireRedis(id, ttlMs);
  }
  return claimByPostgres(id);
}
