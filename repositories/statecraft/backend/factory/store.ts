/**
 * Stamp-job data access on CoreLedger (spec 005 §3).
 *
 * Schema is ensured eagerly at load. Status changes go through `transition`,
 * which enforces the state machine (jobs.ts); `createOrGetLiveJob` implements
 * the idempotency rule (a live job for the same tenant + appName is returned,
 * not duplicated). CoreLedger has no native upsert, so both use the
 * find-then-write-in-a-transaction idiom.
 */
import { ledger } from "../core/ledger";

import { type Posture, type StampMode, StampJob } from "./entities";
import { canTransition, InvalidTransitionError, isLive, isTerminal, type StampStatus } from "./jobs";

export const dbReady: Promise<void> = ledger().init([StampJob]);
dbReady.catch(() => {});

export { ledger };

export function jobs() {
  return ledger().repo(StampJob);
}

export async function getJob(id: string): Promise<StampJob | null> {
  await dbReady;
  return jobs().findById(id);
}

export async function listJobsForTenant(tenantId: string): Promise<StampJob[]> {
  await dbReady;
  return jobs().findWhere({ tenantId }, { orderBy: "createdAt", direction: "desc" });
}

export interface CreateJobInput {
  tenantId: string;
  installationId: string;
  appName: string;
  org: string;
  frontend: string;
  mode: StampMode;
  pages: boolean;
  templateRef: string;
  contractVersion: string;
  posture: Posture;
}

/**
 * Insert a queued job, unless a live job for (tenantId, appName) already exists,
 * in which case return that one (spec 005 §3 idempotency). `created` tells the
 * caller whether to kick the pipeline.
 */
export async function createOrGetLiveJob(
  input: CreateJobInput,
): Promise<{ job: StampJob; created: boolean }> {
  await dbReady;
  const now = new Date();
  return ledger().transaction(async ({ repo }) => {
    const rows = repo(StampJob);
    const existing = await rows.findWhere({
      tenantId: input.tenantId,
      appName: input.appName,
    } as Partial<StampJob>);
    const live = existing.find((j) => isLive(j.status));
    if (live) return { job: live, created: false };

    const job = Object.assign(new StampJob(), {
      tenantId: input.tenantId,
      installationId: input.installationId,
      appName: input.appName,
      org: input.org,
      frontend: input.frontend,
      mode: input.mode,
      pages: input.pages,
      templateRef: input.templateRef,
      contractVersion: input.contractVersion,
      posture: input.posture,
      status: "queued" as StampStatus,
      createdAt: now,
      updatedAt: now,
    });
    await rows.insert(job);
    return { job, created: true };
  });
}

/** Move a job to `to`, enforcing the state machine; optionally patch fields. */
export async function transition(
  id: string,
  to: StampStatus,
  patch: Partial<Pick<StampJob, "certHash" | "checksRunId" | "prUrl" | "error">> = {},
): Promise<StampJob> {
  await dbReady;
  const now = new Date();
  return ledger().transaction(async ({ repo }) => {
    const rows = repo(StampJob);
    const job = await rows.findById(id);
    if (!job) throw new Error(`stamp job ${id} not found`);
    if (!canTransition(job.status, to)) throw new InvalidTransitionError(job.status, to);
    await rows.updateById(id, { status: to, updatedAt: now, ...patch });
    return (await rows.findById(id))!;
  });
}

/** Set fields without a status change (e.g. contractVersion / certHash mid-stamping). */
export async function patchJob(
  id: string,
  patch: Partial<Pick<StampJob, "certHash" | "checksRunId" | "contractVersion" | "prUrl">>,
): Promise<void> {
  await dbReady;
  await jobs().updateById(id, { ...patch, updatedAt: new Date() });
}

/** Fail a live job (no-op if already terminal), recording a truncated error. */
export async function fail(id: string, error: string): Promise<void> {
  await dbReady;
  const now = new Date();
  await ledger().transaction(async ({ repo }) => {
    const rows = repo(StampJob);
    const job = await rows.findById(id);
    if (!job || isTerminal(job.status)) return;
    await rows.updateById(id, { status: "failed", error: error.slice(0, 500), updatedAt: now });
  });
}
