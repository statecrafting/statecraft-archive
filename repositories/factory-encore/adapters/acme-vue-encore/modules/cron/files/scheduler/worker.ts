import { dueSchedules, advance } from "./store";
import { tryAcquire } from "./lock";

const POLL_INTERVAL_MS = Number(process.env.SCHEDULER_POLL_INTERVAL_MS ?? 10000);
// Fire against the app's own resolved base URL (FR-005), not a hardcoded loopback
// literal. Default is the same-process gateway for a single-container deploy.
const BASE_URL = process.env.SCHEDULER_BASE_URL ?? "http://127.0.0.1:4000";

let pollingInterval: ReturnType<typeof setInterval> | null = null;

// Started from encore.service.ts at service initialization (FR-005), not as a
// bare top-level import side-effect. Idempotent (double-start guarded).
export function startDaemon(): void {
  if (pollingInterval) return;
  pollingInterval = setInterval(processDueTasks, POLL_INTERVAL_MS);
}

export function stopDaemon(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// One poll tick. Wrapped so a transient database or network error is logged and
// the loop survives (FR-004).
export async function processDueTasks(): Promise<void> {
  try {
    for await (const task of dueSchedules()) {
      // The tier lock (Postgres atomic claim, or Redis when the data-redis
      // resource is provisioned) guarantees a single replica fires this job for
      // this window. The TTL spans the fire-and-advance window across replicas.
      const acquired = await tryAcquire(task.id, POLL_INTERVAL_MS * 2);
      if (!acquired) continue;

      fireEndpoint(task.endpoint);
      await advance(task.id, task.schedule);
    }
  } catch (err) {
    console.error("[scheduler] failed to process due tasks:", err);
  }
}

// Fire the job endpoint asynchronously: the daemon does not await the job.
function fireEndpoint(endpoint: string): void {
  fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).catch((err) => {
    console.error(`[scheduler] failed to trigger ${endpoint}:`, err);
  });
}
