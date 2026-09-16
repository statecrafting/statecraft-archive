// Spec 202 FR-003(c): platform-side queue-storm detection.
//
// Detection-only (locked decision, spec 202 Sequencing): counts the
// submitting org's in-flight `factory_runs` at reservation time and, when
// the count is at or over the configured ceiling, emits a `log.warn` plus a
// `factory.run.storm_detected` audit row. The run is STILL ADMITTED either
// way; this gate never throws and never blocks. Enforcement (a 429-class
// refusal) rides a later envelope-carried threshold once the `budgets:`
// section (FR-001) lands; until then thresholds are platform config only
// (§Code reality 5, Sequencing).
//
// Mirrors the `staleAfterSeconds()` env-knob idiom in `runsScheduler.ts`.

import log from "encore.dev/log";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import { factoryRuns, auditLog } from "../db/schema";
import { FACTORY_RUN_STORM_DETECTED } from "./auditActions";
import { errorForLog } from "../auth/errorLog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default in-flight ceiling. A normal org's factory usage runs a handful
 *  of concurrent `queued`/`running` rows at once (one desktop session,
 *  occasionally two or three during a demo or a scripted batch kick-off);
 *  25 simultaneous in-flight runs for a single org is well past any
 *  legitimate interactive workflow and is the shape a runaway retry loop, a
 *  compromised credential, or a scripted abuse pattern produces. Same
 *  reasoning shape as the `max_repeats: 3` platform default in FR-003(a)
 *  (spec 202): loose enough to never fire on normal usage, tight enough to
 *  be a meaningful detection signal, not an enforcement ceiling. */
const DEFAULT_MAX_RUNS_IN_FLIGHT = 25;

/** Override via `STATECRAFT_FACTORY_MAX_RUNS_IN_FLIGHT=<count>`. Detection
 *  only, see module doc comment; documented in statecraft/CLAUDE.md. */
const ENV_MAX_RUNS_IN_FLIGHT = "STATECRAFT_FACTORY_MAX_RUNS_IN_FLIGHT";

/** In-flight = `queued` or `running`; terminal states (`ok`/`failed`/
 *  `cancelled`) never count (`FactoryRunStatus`, `api/db/schema.ts`). Served
 *  by the existing covering partial index `factory_runs_org_in_flight_idx`
 *  (no migration needed for this slice). */
const IN_FLIGHT_STATUSES = ["queued", "running"] as const;

export function maxRunsInFlight(): number {
  const raw = process.env[ENV_MAX_RUNS_IN_FLIGHT];
  if (!raw) return DEFAULT_MAX_RUNS_IN_FLIGHT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_RUNS_IN_FLIGHT;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface QueueStormContext {
  orgId: string;
  userID: string;
  clientRunId: string;
}

/**
 * Detection-only queue-storm gate (spec 202 FR-003c). Counts the org's
 * in-flight `factory_runs` rows and, when the count is at or over
 * `maxRunsInFlight()`, logs a warning and writes a
 * `factory.run.storm_detected` audit row naming the org, the observed
 * count, and the ceiling. Under-ceiling is a silent no-op (no log, no
 * audit). Always resolves; never throws and never blocks the caller's
 * reservation.
 */
export async function detectQueueStorm(ctx: QueueStormContext): Promise<void> {
  // Detection-only (spec 202 FR-003c): observation must never block a
  // reservation. Every DB interaction here is best-effort; a failure to
  // count in-flight runs or to record the storm is logged and swallowed so
  // the caller's run is still admitted. This makes the module's "never
  // throws, never blocks" contract real rather than aspirational (the caller
  // in `reserveRunCore` awaits this before the essential substrate load).
  try {
    const ceiling = maxRunsInFlight();
    // Counts the org's ALREADY-persisted in-flight runs; the current
    // submission's row is inserted later in `reserveRunCore`, so at a ceiling
    // of N this fires on the submission made while N runs are already
    // in-flight (i.e. the count reaches the ceiling before the new run lands).
    const [{ c }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(factoryRuns)
      .where(
        and(
          eq(factoryRuns.orgId, ctx.orgId),
          inArray(factoryRuns.status, IN_FLIGHT_STATUSES),
        ),
      );

    if (c < ceiling) return;

    log.warn("detectQueueStorm: org in-flight run count at/over ceiling", {
      orgId: ctx.orgId,
      inFlightCount: c,
      ceiling,
    });

    // Target is the ORG (the storm is an org-level aggregate; no run id
    // exists yet, the reservation is inserted later). `targetType` +
    // `targetId` must resolve consistently: an org id pairs with
    // `"organization"` (precedent: `api/github/webhook.ts`), never
    // `"factory_runs"` (which pairs with a run id, e.g. `approvalSummary.ts`).
    await db.insert(auditLog).values({
      actorUserId: ctx.userID,
      action: FACTORY_RUN_STORM_DETECTED,
      targetType: "organization",
      targetId: ctx.orgId,
      metadata: {
        orgId: ctx.orgId,
        clientRunId: ctx.clientRunId,
        inFlightCount: c,
        ceiling,
      },
    });
  } catch (err) {
    log.error("detectQueueStorm: detection failed; admitting run anyway", {
      orgId: ctx.orgId,
      error: errorForLog(err),
    });
  }
}
