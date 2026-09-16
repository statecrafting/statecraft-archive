/**
 * Spec 215 FR-003: `environment_deployments` record writer.
 *
 * Statecraft's durable record of every deploy dispatch (UI trigger or PR
 * webhook), keyed to deployd-api's `rel_<uuid>` release id. This module owns
 * all writes to the table; every dispatch path goes through it. It is the
 * source of truth for the env detail page (FR-004) and the preview-destroy
 * release-id lookup (FR-005), and the read side of lazy status reconciliation
 * (FR-008).
 *
 * Pure DB access only: no deployd-api network calls live here, so the module
 * is straightforward to exercise against a real test database (`encore test`).
 * Reconciliation (which does call deployd-api) composes this module's reads
 * with the deployd client at the endpoint layer.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  environmentDeployments,
  type DeploymentStatus,
  type EnvironmentDeployment,
} from "../db/schema";

/**
 * Map deployd-api's status string onto our DeploymentStatus enum. deployd's
 * terminal states are ROLLED_OUT / FAILED; anything else (DEPLOYING, etc.) is
 * recorded as PENDING and reconciled later (FR-008). Shared by the UI trigger
 * and the PR webhook so both record statuses consistently.
 */
export function mapDeploydStatus(status: string | null): DeploymentStatus {
  if (status === "ROLLED_OUT") return "ROLLED_OUT";
  if (status === "FAILED") return "FAILED";
  return "PENDING";
}

/** Fields accepted when recording a fresh dispatch. */
export interface NewDeploymentRecord {
  environmentId: string;
  projectId: string;
  releaseSha: string;
  artifactRef: string;
  /** `public` (default), `internal`, or `root` (see migration 49 CHECK). */
  variant?: string;
  status: DeploymentStatus;
  /** deployd's `rel_<uuid>`; null until the create response arrives. */
  releaseId?: string | null;
  endpoints?: string[];
  /** OAP user id, or the literal `webhook` for PR-driven dispatches. */
  dispatchedBy: string;
  diagnostic?: string | null;
}

/** Mutable fields on an existing record. `undefined` keys are left untouched;
 *  an explicit `null` clears a nullable column. */
export interface DeploymentPatch {
  status?: DeploymentStatus;
  releaseId?: string | null;
  endpoints?: string[];
  diagnostic?: string | null;
}

/** Drop `undefined` keys so a patch never nulls a column it omitted. An
 *  explicit `null` is preserved (it intentionally clears the column). */
function definedOnly<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Insert a deployment record and return the persisted row. */
export async function createDeploymentRecord(
  input: NewDeploymentRecord,
): Promise<EnvironmentDeployment> {
  const [row] = await db
    .insert(environmentDeployments)
    .values({
      environmentId: input.environmentId,
      projectId: input.projectId,
      releaseSha: input.releaseSha,
      artifactRef: input.artifactRef,
      variant: input.variant ?? "public",
      status: input.status,
      releaseId: input.releaseId ?? null,
      endpoints: input.endpoints ?? [],
      dispatchedBy: input.dispatchedBy,
      diagnostic: input.diagnostic ?? null,
    })
    .returning();
  return row;
}

/** Patch a record by primary key. Returns the updated row, or undefined if no
 *  row matched. Always bumps `updatedAt`. */
export async function updateDeploymentRecord(
  id: string,
  patch: DeploymentPatch,
): Promise<EnvironmentDeployment | undefined> {
  const [row] = await db
    .update(environmentDeployments)
    .set({ ...definedOnly(patch), updatedAt: new Date() })
    .where(eq(environmentDeployments.id, id))
    .returning();
  return row;
}

/** Patch the record carrying a given deployd release id. Used by status
 *  reconciliation (FR-008) and the webhook destroy path (FR-005). */
export async function updateDeploymentByReleaseId(
  releaseId: string,
  patch: DeploymentPatch,
): Promise<EnvironmentDeployment | undefined> {
  const [row] = await db
    .update(environmentDeployments)
    .set({ ...definedOnly(patch), updatedAt: new Date() })
    .where(eq(environmentDeployments.releaseId, releaseId))
    .returning();
  return row;
}

/** Latest record for an environment (FR-004 render, FR-005 destroy lookup,
 *  FR-008 reconciliation seed). Newest by `created_at`. */
export async function getLatestDeploymentForEnv(
  environmentId: string,
): Promise<EnvironmentDeployment | undefined> {
  const [row] = await db
    .select()
    .from(environmentDeployments)
    .where(eq(environmentDeployments.environmentId, environmentId))
    .orderBy(desc(environmentDeployments.createdAt))
    .limit(1);
  return row;
}

/** Look up a record by deployd release id. */
export async function getDeploymentByReleaseId(
  releaseId: string,
): Promise<EnvironmentDeployment | undefined> {
  const [row] = await db
    .select()
    .from(environmentDeployments)
    .where(eq(environmentDeployments.releaseId, releaseId))
    .limit(1);
  return row;
}
