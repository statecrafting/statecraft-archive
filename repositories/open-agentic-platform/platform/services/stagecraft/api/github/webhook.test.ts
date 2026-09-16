// Spec 213 FR-009: one GitHub repo maps to exactly one project.
//
// Exercises the structural guarantee (unique index on project_repos) and the
// deterministic repo->project resolution against live Postgres. Regression
// cover for the 2026-06-20 cross-attribution incident: a build recorded under
// the wrong project because the (org, repo) edge was not 1:1 and the lookup
// returned an arbitrary row.
//
// Excluded from `npm test` and run only under `encore test` (see
// vite.config.ts) because it requires a real database (the unique index is
// created by migration 51, so the test DB must be migrated). project_repos has
// a FK on project_id -> projects(id), and projects FK org_id -> organizations
// and created_by -> users, so the suite seeds the full org/user/project chain.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { organizations, projectRepos, projects, users } from "../db/schema";
import { findRepoRow, isDefaultBranchPush } from "./webhook";

const ORG_ID = "f1009000-0000-0000-0000-0000000000c0";
const USER_ID = "f1009000-0000-0000-0000-0000000000d0";
const PROJECT_A = "f1009a00-0000-0000-0000-0000000000a1";
const PROJECT_B = "f1009b00-0000-0000-0000-0000000000b2";
// GitHub org login stored in project_repos.github_org (a text field), distinct
// from the organizations row above.
const TEST_ORG = "fr009-test-org";

async function cleanup(): Promise<void> {
  // Children before parents (FK order).
  await db.delete(projectRepos).where(eq(projectRepos.githubOrg, TEST_ORG));
  await db.delete(projects).where(eq(projects.orgId, ORG_ID));
  await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  await db.delete(users).where(eq(users.id, USER_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(users).values({
    id: USER_ID,
    email: "fr009-test-213@example.test",
    name: "FR-009 Test User",
  });
  await db.insert(organizations).values({
    id: ORG_ID,
    name: "FR-009 Test Org",
    slug: "fr009-test-org-213",
  });
  await db.insert(projects).values([
    {
      id: PROJECT_A,
      orgId: ORG_ID,
      name: "FR-009 Project A",
      slug: "fr009-proj-a",
      objectStoreBucket: "fr009-bucket-a",
      createdBy: USER_ID,
    },
    {
      id: PROJECT_B,
      orgId: ORG_ID,
      name: "FR-009 Project B",
      slug: "fr009-proj-b",
      objectStoreBucket: "fr009-bucket-b",
      createdBy: USER_ID,
    },
  ]);
});

afterAll(cleanup);

describe("project_repos one-repo-one-project (spec 213 FR-009)", () => {
  it("the unique index rejects a second project linking the same repo", async () => {
    await db.insert(projectRepos).values({
      projectId: PROJECT_A,
      githubOrg: TEST_ORG,
      repoName: "shared-repo",
      isPrimary: true,
    });

    await expect(
      db.insert(projectRepos).values({
        projectId: PROJECT_B,
        githubOrg: TEST_ORG,
        repoName: "shared-repo",
        isPrimary: false,
      }),
    ).rejects.toThrow();
  });

  it("findRepoRow resolves the single owning project for a registered repo", async () => {
    await db.insert(projectRepos).values({
      projectId: PROJECT_A,
      githubOrg: TEST_ORG,
      repoName: "owned-repo",
      isPrimary: true,
    });

    const row = await findRepoRow(`${TEST_ORG}/owned-repo`);
    expect(row).not.toBeNull();
    expect(row!.projectId).toBe(PROJECT_A);
    expect(row!.repoName).toBe("owned-repo");
  });

  it("findRepoRow returns null for an unregistered repo", async () => {
    expect(await findRepoRow(`${TEST_ORG}/never-linked`)).toBeNull();
  });

  it("findRepoRow returns null for a malformed full name", async () => {
    expect(await findRepoRow("no-slash")).toBeNull();
  });
});

describe("isDefaultBranchPush artifact-recording gate (spec 213 FR-006)", () => {
  it("accepts a default-branch push build", () => {
    expect(
      isDefaultBranchPush({ event: "push", head_branch: "main" }, "main"),
    ).toBe(true);
  });

  it("rejects a pull_request build (phantom-artifact regression)", () => {
    // A PR run reports head_branch = the PR branch and event = pull_request;
    // its head_sha never gets a `sha-<head_sha>` tag, so recording it created
    // the never-pushed `sha-8c65109b6020` row that blocked the deploy.
    expect(
      isDefaultBranchPush(
        { event: "pull_request", head_branch: "dependabot/npm_and_yarn/x" },
        "main",
      ),
    ).toBe(false);
  });

  it("rejects a push to a non-default branch", () => {
    expect(
      isDefaultBranchPush({ event: "push", head_branch: "feature/x" }, "main"),
    ).toBe(false);
  });

  it("fails closed when the default branch is unknown", () => {
    expect(
      isDefaultBranchPush({ event: "push", head_branch: "main" }, ""),
    ).toBe(false);
  });

  it("rejects a missing run", () => {
    expect(isDefaultBranchPush(null, "main")).toBe(false);
    expect(isDefaultBranchPush(undefined, "main")).toBe(false);
  });
});
