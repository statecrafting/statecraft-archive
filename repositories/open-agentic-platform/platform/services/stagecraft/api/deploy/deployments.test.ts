// Spec 215 FR-003: environment_deployments record-writer tests.
//
// Exercises the pure-DB record module against live Postgres: insert with
// defaults, patch-by-id (definedOnly semantics), patch-by-release-id,
// latest-per-environment ordering, and release-id lookup.
//
// Excluded from `npm test` and run only under `encore test` (see
// vite.config.ts) because it requires a real database. The table has no FK
// constraints (migration 49), so synthetic environment/project UUIDs are
// sufficient; no org/project/environment fixture chain is needed.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { environmentDeployments } from "../db/schema";
import {
  createDeploymentRecord,
  getDeploymentByReleaseId,
  getLatestDeploymentForEnv,
  updateDeploymentByReleaseId,
  updateDeploymentRecord,
} from "./deployments";

// Unique test-family ids (avoid collisions with other suites' fixtures).
const PROJECT_ID = "21500000-0000-0000-0000-0000000000a1";
const ENV_ID = "21500000-0000-0000-0000-0000000000a2";
const ENV_ID_ORDER = "21500000-0000-0000-0000-0000000000a3";

async function cleanup(): Promise<void> {
  await db
    .delete(environmentDeployments)
    .where(eq(environmentDeployments.projectId, PROJECT_ID));
}

beforeAll(cleanup);
afterAll(cleanup);

describe("environment_deployments record writer (spec 215 FR-003)", () => {
  it("createDeploymentRecord inserts with defaults and returns the row", async () => {
    const row = await createDeploymentRecord({
      environmentId: ENV_ID,
      projectId: PROJECT_ID,
      releaseSha: "abc1234",
      artifactRef: "ghcr.io/example/app:abc1234",
      status: "REQUESTED",
      dispatchedBy: "webhook",
    });

    expect(row.id).toBeTruthy();
    expect(row.environmentId).toBe(ENV_ID);
    expect(row.status).toBe("REQUESTED");
    // Column defaults: public variant, empty endpoints, null releaseId/diagnostic.
    expect(row.variant).toBe("public");
    expect(row.endpoints).toEqual([]);
    expect(row.releaseId).toBeNull();
    expect(row.diagnostic).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("updateDeploymentRecord patches set keys, bumps updatedAt, leaves omitted keys untouched", async () => {
    const created = await createDeploymentRecord({
      environmentId: ENV_ID,
      projectId: PROJECT_ID,
      releaseSha: "def5678",
      artifactRef: "ghcr.io/example/app:def5678",
      status: "PENDING",
      dispatchedBy: "user-1",
      diagnostic: "initial note",
    });

    const updated = await updateDeploymentRecord(created.id, {
      status: "ROLLED_OUT",
      releaseId: "rel_00000000-0000-0000-0000-000000000001",
      endpoints: ["https://app.example.test"],
    });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("ROLLED_OUT");
    expect(updated!.releaseId).toBe("rel_00000000-0000-0000-0000-000000000001");
    expect(updated!.endpoints).toEqual(["https://app.example.test"]);
    // diagnostic was not in the patch (undefined) so it must survive.
    expect(updated!.diagnostic).toBe("initial note");
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      created.updatedAt.getTime(),
    );

    // An explicit null clears the nullable column (definedOnly preserves null).
    const cleared = await updateDeploymentRecord(created.id, { diagnostic: null });
    expect(cleared!.diagnostic).toBeNull();
    // status untouched by the diagnostic-only patch.
    expect(cleared!.status).toBe("ROLLED_OUT");
  });

  it("updateDeploymentRecord returns undefined for an unknown id", async () => {
    const missing = await updateDeploymentRecord(
      "21500000-0000-0000-0000-0000000000ff",
      { status: "FAILED" },
    );
    expect(missing).toBeUndefined();
  });

  it("getDeploymentByReleaseId / updateDeploymentByReleaseId resolve by deployd release id", async () => {
    const releaseId = "rel_00000000-0000-0000-0000-0000000000aa";
    await createDeploymentRecord({
      environmentId: ENV_ID,
      projectId: PROJECT_ID,
      releaseSha: "aaa0001",
      artifactRef: "ghcr.io/example/app:aaa0001",
      status: "ROLLED_OUT",
      dispatchedBy: "webhook",
      releaseId,
    });

    const found = await getDeploymentByReleaseId(releaseId);
    expect(found).toBeDefined();
    expect(found!.releaseSha).toBe("aaa0001");

    const destroyed = await updateDeploymentByReleaseId(releaseId, {
      status: "DESTROYED",
    });
    expect(destroyed!.status).toBe("DESTROYED");
    expect(await getDeploymentByReleaseId("rel_does-not-exist")).toBeUndefined();
  });

  it("getLatestDeploymentForEnv returns the newest record by created_at", async () => {
    // Explicit createdAt so ordering is deterministic (defaultNow() could tie
    // within the same millisecond for back-to-back inserts).
    await db.insert(environmentDeployments).values({
      environmentId: ENV_ID_ORDER,
      projectId: PROJECT_ID,
      releaseSha: "old0001",
      artifactRef: "ghcr.io/example/app:old0001",
      status: "ROLLED_OUT",
      dispatchedBy: "webhook",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    await db.insert(environmentDeployments).values({
      environmentId: ENV_ID_ORDER,
      projectId: PROJECT_ID,
      releaseSha: "new0002",
      artifactRef: "ghcr.io/example/app:new0002",
      status: "PENDING",
      dispatchedBy: "user-1",
      createdAt: new Date("2026-06-15T00:00:00Z"),
    });

    const latest = await getLatestDeploymentForEnv(ENV_ID_ORDER);
    expect(latest).toBeDefined();
    expect(latest!.releaseSha).toBe("new0002");

    expect(
      await getLatestDeploymentForEnv("21500000-0000-0000-0000-0000000000fe"),
    ).toBeUndefined();
  });
});
