import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import {
  organizations,
  projects,
  projectRepos,
  environments,
  projectMembers,
  githubInstallations,
  auditLog,
  knowledgeObjects,
  factoryArtifacts,
  factoryPipelines,
} from "../db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { hasOrgPermission } from "../auth/membership";
import {
  brokerInstallationToken,
  createGitHubRepo,
  seedRepoFromAdapter,
  configureBranchProtection,
  createOapWorkflow,
  seedOapBuildWorkflow,
} from "../github/repoInit";
import { publishProjectCatalogUpsert } from "../sync/projectCatalogRelay";
import { deleteObject } from "../knowledge/storage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrgRow = {
  id: string;
  name: string;
  slug: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectRow = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string;
  objectStoreBucket: string;
  factoryAdapterId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Spec 113 §FR-039 — `listProjects` augments each project with a precomputed
// flag so the SSR loader can hide the Clone affordance for projects with no
// primary repo without an extra round-trip. `primaryRepoName` is the source
// of the dialog's `<sourceRepoName>-clone` pre-fill (FR-009).
export type ProjectListRow = ProjectRow & {
  hasPrimaryRepo: boolean;
  primaryRepoName: string | null;
};

export interface ListProjectsResponse {
  projects: ProjectListRow[];
  /**
   * The OAP-current-org's active GitHub App installation login. Null when
   * the org has no active installation. The Clone Project dialog renders
   * this as a read-only field so the user knows where the new repo lands.
   */
  destinationGithubOrgLogin: string | null;
}

export type RepoRow = {
  id: string;
  projectId: string;
  githubOrg: string;
  repoName: string;
  defaultBranch: string;
  isPrimary: boolean;
  githubInstallId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EnvironmentRow = {
  id: string;
  projectId: string;
  name: string;
  kind: "preview" | "development" | "staging" | "production";
  k8sNamespace: string | null;
  autoDeployBranch: string | null;
  requiresApproval: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MemberRow = {
  id: string;
  projectId: string;
  userId: string;
  role: "viewer" | "developer" | "deployer" | "admin";
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const getOrg = api(
  { expose: true, auth: true, method: "GET", path: "/api/orgs/current" },
  async (): Promise<{ org: OrgRow }> => {
    const auth = getAuthData()!;

    const rows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, auth.orgId))
      .limit(1);

    if (rows.length === 0) {
      throw APIError.notFound("organization not found");
    }
    return { org: rows[0] };
  }
);

// ---------------------------------------------------------------------------
// Projects CRUD
// ---------------------------------------------------------------------------

export const listProjects = api(
  { expose: true, auth: true, method: "GET", path: "/api/projects" },
  async (): Promise<ListProjectsResponse> => {
    const auth = getAuthData()!;

    // Two-query shape (spec 113 §FR-039): pull projects, then pull
    // primary repos for that org, JS-merge. Replaces an inline EXISTS
    // subquery whose `${table.column} = true` rendering produced false
    // negatives that hid the Clone affordance for freshly-imported
    // projects. Matches projectCatalogRelay.ts which already used the
    // same two-query pattern.
    const projectRows = await db
      .select({
        id: projects.id,
        orgId: projects.orgId,
        name: projects.name,
        slug: projects.slug,
        description: projects.description,
        objectStoreBucket: projects.objectStoreBucket,
        factoryAdapterId: projects.factoryAdapterId,
        createdBy: projects.createdBy,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(eq(projects.orgId, auth.orgId))
      .orderBy(desc(projects.createdAt));

    const projectIds = projectRows.map((p) => p.id);
    const primaryByProject = new Map<string, string>();
    if (projectIds.length > 0) {
      const repoRows = await db
        .select({
          projectId: projectRepos.projectId,
          repoName: projectRepos.repoName,
        })
        .from(projectRepos)
        .where(
          and(
            inArray(projectRepos.projectId, projectIds),
            eq(projectRepos.isPrimary, true)
          )
        );
      for (const r of repoRows) {
        primaryByProject.set(r.projectId, r.repoName);
      }
    }

    const rows: ProjectListRow[] = projectRows.map((p) => ({
      ...p,
      hasPrimaryRepo: primaryByProject.has(p.id),
      primaryRepoName: primaryByProject.get(p.id) ?? null,
    }));

    // Spec 113 §FR-008 — surface the destination GitHub org login so the
    // dialog can show it (read-only) without a second round-trip.
    const [destInstallation] = await db
      .select({ githubOrgLogin: githubInstallations.githubOrgLogin })
      .from(githubInstallations)
      .where(
        and(
          eq(githubInstallations.orgId, auth.orgId),
          eq(githubInstallations.installationState, "active")
        )
      )
      .limit(1);

    return {
      projects: rows,
      destinationGithubOrgLogin: destInstallation?.githubOrgLogin ?? null,
    };
  }
);

export const getProject = api(
  { expose: true, auth: true, method: "GET", path: "/api/projects/:id" },
  async (req: { id: string }): Promise<{ project: ProjectRow }> => {
    const auth = getAuthData()!;

    const rows = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, req.id), eq(projects.orgId, auth.orgId))
      )
      .limit(1);

    if (rows.length === 0) {
      throw APIError.notFound("project not found");
    }
    return { project: rows[0] };
  }
);

type CreateProjectRequest = {
  name: string;
  slug: string;
  description?: string;
};

export const createProject = api(
  { expose: true, auth: true, method: "POST", path: "/api/projects" },
  async (req: CreateProjectRequest): Promise<{ project: ProjectRow }> => {
    const auth = getAuthData()!;

    if (!req.name || !req.slug) {
      throw APIError.invalidArgument("name and slug are required");
    }

    // Spec 119 §4.2 — every project owns its own bucket. Deterministic
    // derivation (matches the pre-collapse `oap-<org>-<workspace>` shape).
    const objectStoreBucket = `oap-${auth.orgSlug || "unknown"}-${req.slug}`;

    const [project] = await db
      .insert(projects)
      .values({
        orgId: auth.orgId,
        name: req.name,
        slug: req.slug,
        description: req.description ?? "",
        objectStoreBucket,
        createdBy: auth.userID,
      })
      .returning();

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "project.create",
      targetType: "project",
      targetId: project.id,
      metadata: { name: req.name, slug: req.slug, orgId: auth.orgId },
    });

    // Auto-add creator as project admin
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId: auth.userID,
      role: "admin",
    });

    return { project };
  }
);

type UpdateProjectRequest = {
  id: string;
  name?: string;
  description?: string;
};

export const updateProject = api(
  { expose: true, auth: true, method: "PUT", path: "/api/projects/:id" },
  async (req: UpdateProjectRequest): Promise<{ project: ProjectRow }> => {
    const auth = getAuthData()!;

    const existing = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, req.id), eq(projects.orgId, auth.orgId))
      )
      .limit(1);

    if (existing.length === 0) {
      throw APIError.notFound("project not found");
    }

    const [updated] = await db
      .update(projects)
      .set({
        ...(req.name !== undefined && { name: req.name }),
        ...(req.description !== undefined && { description: req.description }),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, req.id))
      .returning();

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "project.update",
      targetType: "project",
      targetId: req.id,
      metadata: { name: req.name, description: req.description },
    });

    return { project: updated };
  }
);

export const deleteProject = api(
  { expose: true, auth: true, method: "DELETE", path: "/api/projects/:id" },
  async (req: { id: string }): Promise<{ ok: true }> => {
    const auth = getAuthData()!;

    // FR-007: Only admin/owner can delete projects
    if (!hasOrgPermission(auth.platformRole, "project:delete")) {
      throw APIError.permissionDenied("Insufficient permissions to delete projects");
    }

    const existing = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, req.id), eq(projects.orgId, auth.orgId))
      )
      .limit(1);

    if (existing.length === 0) {
      throw APIError.notFound("project not found");
    }

    // Spec 119 §4.2 — bucket lives directly on the project row.
    const bucket = existing[0].objectStoreBucket;

    // Spec 119 §6.2 — knowledge objects are project-scoped (no longer
    // shareable via document_bindings). Every knowledge object owned by
    // this project is in scope for purge.
    const ownedKnowledge = await db
      .select({
        id: knowledgeObjects.id,
        storageKey: knowledgeObjects.storageKey,
        extractionOutput: knowledgeObjects.extractionOutput,
      })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.projectId, req.id));

    // Factory artifacts produced by this project's pipelines. The
    // factory_pipelines → projects FK already CASCADEs the rows; this
    // query just collects the storage_path values so the bytes don't
    // outlive the rows.
    const projectArtifacts = await db
      .select({ storagePath: factoryArtifacts.storagePath })
      .from(factoryArtifacts)
      .innerJoin(
        factoryPipelines,
        eq(factoryPipelines.id, factoryArtifacts.pipelineId)
      )
      .where(eq(factoryPipelines.projectId, req.id));

    const knowledgeIds = ownedKnowledge.map((k) => k.id);
    const knowledgeKeys = new Set<string>();
    for (const k of ownedKnowledge) {
      knowledgeKeys.add(k.storageKey);
      const extracted = readExtractedKey(k.extractionOutput);
      if (extracted) knowledgeKeys.add(extracted);
    }
    const artifactKeys = new Set(projectArtifacts.map((a) => a.storagePath));

    // SQL delete first. Project CASCADE cleans up the child rows
    // (project_repos, environments, project_members, factory_pipelines,
    // factory_artifacts, factory_policy_bundles, project_github_pats).
    // Knowledge object rows reference projects without ON DELETE CASCADE,
    // so we delete the project's owned set explicitly inside the same
    // transaction.
    await db.transaction(async (tx) => {
      // knowledge_objects has a non-cascading FK to projects, so it must
      // be cleared before the project row to avoid a constraint violation.
      if (knowledgeIds.length > 0) {
        await tx
          .delete(knowledgeObjects)
          .where(inArray(knowledgeObjects.id, knowledgeIds));
      }
      await tx.delete(projects).where(eq(projects.id, req.id));
      await tx.insert(auditLog).values({
        actorUserId: auth.userID,
        action: "project.delete",
        targetType: "project",
        targetId: req.id,
        metadata: {
          name: existing[0].name,
          slug: existing[0].slug,
          purgedKnowledgeObjects: knowledgeIds.length,
          purgedFactoryArtifacts: artifactKeys.size,
          bucket,
        },
      });
    });

    // S3 sweep runs after commit so a storage hiccup leaves orphaned
    // bytes (recoverable via the admin purge-orphans endpoint) rather
    // than rolling back a delete the user just confirmed. Per-key
    // failures are logged and swallowed.
    const allKeys = [...knowledgeKeys, ...artifactKeys];
    let purged = 0;
    let failed = 0;
    for (const key of allKeys) {
      try {
        await deleteObject(bucket, key);
        purged++;
      } catch (err) {
        failed++;
        log.warn("project.delete: object purge failed", {
          projectId: req.id,
          bucket,
          key,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    log.info("project.delete: storage sweep done", {
      projectId: req.id,
      bucket,
      purged,
      failed,
      candidateCount: allKeys.length,
    });

    // Spec 112 Phase 8 — broadcast a tombstone so connected OPCs prune
    // the row from their Projects panel without a restart. Fire-and-log.
    void publishProjectCatalogUpsert({
      orgId: existing[0].orgId,
      project: {
        id: existing[0].id,
        name: existing[0].name,
        slug: existing[0].slug,
        description: existing[0].description,
        factoryAdapterId: existing[0].factoryAdapterId,
        detectionLevel: null,
        updatedAt: new Date(),
      },
      repo: null,
      tombstone: true,
    }).catch((err) => {
      log.warn("project.delete: catalog tombstone broadcast failed", {
        projectId: req.id,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    return { ok: true };
  }
);

function readExtractedKey(extractionOutput: unknown): string | null {
  if (!extractionOutput || typeof extractionOutput !== "object") return null;
  const v = (extractionOutput as Record<string, unknown>).extractedStorageKey;
  return typeof v === "string" ? v : null;
}

// ---------------------------------------------------------------------------
// Self-Service Project Creation (spec 080 Phase 2 — FR-006)
// ---------------------------------------------------------------------------

type CreateProjectWithRepoRequest = {
  name: string;
  slug: string;
  description?: string;
  // Spec 199 FR-002 — adapter identity is manifest-declared, not a static
  // union; validated against the org's substrate at the call site.
  adapter: string;
  repoName: string;
  isPrivate?: boolean;
};

type CreateProjectWithRepoResponse = {
  project: ProjectRow;
  repo: RepoRow;
  environments: EnvironmentRow[];
  githubRepoUrl: string;
};

export const createProjectWithRepo = api(
  { expose: true, auth: true, method: "POST", path: "/api/projects/with-repo" },
  async (req: CreateProjectWithRepoRequest): Promise<CreateProjectWithRepoResponse> => {
    const auth = getAuthData()!;

    log.info("createProjectWithRepo invoked", {
      userID: auth.userID,
      orgId: auth.orgId,
      platformRole: auth.platformRole,
      slug: req.slug,
      repoName: req.repoName,
      adapter: req.adapter,
    });

    // Validate inputs
    if (!req.name || !req.slug || !req.repoName || !req.adapter) {
      throw APIError.invalidArgument("name, slug, repoName, and adapter are required");
    }

    // Sanitize slug and repoName to prevent path traversal/injection
    const slugPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
    if (req.slug.length < 2 || req.slug.length > 100 || !slugPattern.test(req.slug)) {
      throw APIError.invalidArgument("slug must be 2-100 chars, lowercase alphanumeric with hyphens");
    }
    const repoPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
    if (req.repoName.length > 100 || !repoPattern.test(req.repoName)) {
      throw APIError.invalidArgument("repoName must match GitHub repo naming rules");
    }

    // FR-007: Check org-level permission
    if (!hasOrgPermission(auth.platformRole, "project:create")) {
      throw APIError.permissionDenied("Insufficient permissions to create projects in this org");
    }

    // Look up the active GitHub App installation for this org
    const [installation] = await db
      .select({
        installationId: githubInstallations.installationId,
        githubOrgLogin: githubInstallations.githubOrgLogin,
      })
      .from(githubInstallations)
      .where(
        and(
          eq(githubInstallations.orgId, auth.orgId),
          eq(githubInstallations.installationState, "active")
        )
      )
      .limit(1);

    if (!installation) {
      throw APIError.failedPrecondition(
        "No active GitHub App installation for this org. Install the OAP GitHub App first."
      );
    }

    // Broker a scoped installation token with permissions for repo init
    let installToken: string;
    try {
      ({ token: installToken } = await brokerInstallationToken(
        installation.installationId,
        {
          contents: "write",
          administration: "write",
          actions: "write",
          workflows: "write",
        }
      ));
    } catch (err) {
      const msg = String(err);
      log.error("brokerInstallationToken failed", {
        installationId: installation.installationId,
        githubOrg: installation.githubOrgLogin,
        error: msg,
      });
      if (msg.includes("permissions requested are not granted")) {
        throw APIError.failedPrecondition(
          `GitHub App installation on ${installation.githubOrgLogin} is missing required permissions (contents: write, administration: write). An org admin must update the app's permissions at github.com/organizations/${installation.githubOrgLogin}/settings/installations/${installation.installationId} and approve the changes.`
        );
      }
      throw APIError.internal(`Failed to obtain GitHub installation token: ${msg}`);
    }

    // FR-008: Create GitHub repo
    let repoResult;
    try {
      repoResult = await createGitHubRepo(
        installToken,
        installation.githubOrgLogin,
        req.repoName,
        {
          isPrivate: req.isPrivate ?? true,
          description: req.description ?? "",
        }
      );
    } catch (err) {
      const msg = String(err);
      if (msg.includes("already exists")) {
        throw APIError.alreadyExists(`Repository ${installation.githubOrgLogin}/${req.repoName} already exists`);
      }
      log.error("GitHub repo creation failed", { error: msg });
      throw APIError.internal("Failed to create GitHub repository");
    }

    // FR-008: Seed adapter template, branch protection, workflow
    // These are best-effort — repo creation succeeded, so we continue even if these fail
    await seedRepoFromAdapter(installToken, repoResult.fullName, req.adapter);
    await configureBranchProtection(installToken, repoResult.fullName, repoResult.defaultBranch);
    await createOapWorkflow(installToken, repoResult.fullName);
    // Spec 213: oap-build.yml is NOT seeded here. This create path produces a
    // README-only repo (seedRepoFromAdapter) with no apps/api to build; the
    // active build workflow rides commit #1 of the factory-create scaffold
    // tree instead (scaffold/perRequestScaffold.ts, FR-001). Repos created
    // before this spec are covered by the retrofit endpoint below (FR-008).

    // FR-006: Create DB records atomically within a transaction.
    // Note: GitHub repo creation (above) cannot be rolled back. If the DB
    // transaction fails, the GitHub repo is orphaned. This is logged so an
    // operator can clean up manually.
    let project: ProjectRow;
    let repo: RepoRow;
    let envRows: EnvironmentRow[];

    try {
      // Spec 119 §4.2 — every project owns its bucket.
      const objectStoreBucket = `oap-${auth.orgSlug || "unknown"}-${req.slug}`;

      const txResult = await db.transaction(async (tx) => {
        // Insert project
        const [projectRow] = await tx
          .insert(projects)
          .values({
            orgId: auth.orgId,
            name: req.name,
            slug: req.slug,
            description: req.description ?? "",
            objectStoreBucket,
            createdBy: auth.userID,
          })
          .returning();

        // Insert project repo
        const [repoRow] = await tx
          .insert(projectRepos)
          .values({
            projectId: projectRow.id,
            githubOrg: installation.githubOrgLogin,
            repoName: req.repoName,
            defaultBranch: repoResult.defaultBranch,
            isPrimary: true,
            githubInstallId: installation.installationId,
          })
          .returning();

        // Insert default environments
        const envDefs: Array<{
          name: string;
          kind: "development" | "staging" | "production";
          autoDeployBranch: string | null;
          requiresApproval: boolean;
        }> = [
          { name: "development", kind: "development", autoDeployBranch: null, requiresApproval: false },
          { name: "staging", kind: "staging", autoDeployBranch: null, requiresApproval: false },
          { name: "production", kind: "production", autoDeployBranch: null, requiresApproval: true },
        ];

        const txEnvRows: EnvironmentRow[] = [];
        for (const envDef of envDefs) {
          const k8sNamespace = `proj--${req.slug}--${envDef.name}`;
          const [env] = await tx
            .insert(environments)
            .values({
              projectId: projectRow.id,
              name: envDef.name,
              kind: envDef.kind,
              k8sNamespace,
              autoDeployBranch: envDef.autoDeployBranch,
              requiresApproval: envDef.requiresApproval,
            })
            .returning();
          txEnvRows.push(env);
        }

        // Add creator as project admin
        await tx.insert(projectMembers).values({
          projectId: projectRow.id,
          userId: auth.userID,
          role: "admin",
        });

        // Audit log
        await tx.insert(auditLog).values({
          actorUserId: auth.userID,
          action: "project.created",
          targetType: "project",
          targetId: projectRow.id,
          metadata: {
            name: req.name,
            slug: req.slug,
            adapter: req.adapter,
            repoName: req.repoName,
            githubOrg: installation.githubOrgLogin,
            githubRepoUrl: repoResult.htmlUrl,
            orgId: auth.orgId,
          },
        });

        return { project: projectRow, repo: repoRow, envRows: txEnvRows };
      });

      project = txResult.project;
      repo = txResult.repo;
      envRows = txResult.envRows;
    } catch (err) {
      const msg = String(err);
      if (msg.includes("unique") || msg.includes("duplicate")) {
        throw APIError.alreadyExists(
          "A project with that slug already exists in this organization"
        );
      }
      log.error("Project DB transaction failed after GitHub repo creation", {
        error: msg,
        githubRepo: repoResult.fullName,
        githubRepoUrl: repoResult.htmlUrl,
      });
      throw APIError.internal("Failed to create project records");
    }

    return {
      project,
      repo,
      environments: envRows,
      githubRepoUrl: repoResult.htmlUrl,
    };
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function verifyProjectOwnership(
  projectId: string,
  orgId: string
): Promise<void> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.orgId, orgId))
    )
    .limit(1);

  if (!row) {
    throw APIError.notFound("project not found");
  }
}

// ---------------------------------------------------------------------------
// Build Workflow Retrofit (spec 213 FR-008)
// ---------------------------------------------------------------------------

/**
 * Idempotently seed (or update) the `oap-build.yml` container-build
 * workflow into a project's repo that was created before spec 213. Admin
 * API surface; UI exposure is spec 215's concern. Requires the same
 * org-level permission as project creation.
 */
export const retrofitBuildWorkflow = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/retrofit-build-workflow",
  },
  async (req: {
    projectId: string;
  }): Promise<{ action: "created" | "updated"; repo: string }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    if (!hasOrgPermission(auth.platformRole, "project:create")) {
      throw APIError.permissionDenied(
        "Insufficient permissions to retrofit the build workflow"
      );
    }

    // Prefer the primary repo; fall back to the most recently linked.
    const [repo] = await db
      .select()
      .from(projectRepos)
      .where(eq(projectRepos.projectId, req.projectId))
      .orderBy(desc(projectRepos.isPrimary), desc(projectRepos.createdAt))
      .limit(1);

    if (!repo) {
      throw APIError.failedPrecondition("project has no linked GitHub repo");
    }
    if (!repo.githubInstallId) {
      throw APIError.failedPrecondition(
        "repo has no active GitHub App installation"
      );
    }

    let token: string;
    try {
      ({ token } = await brokerInstallationToken(repo.githubInstallId, {
        contents: "write",
        workflows: "write",
      }));
    } catch (err) {
      throw APIError.internal(
        `Failed to obtain installation token: ${String(err)}`
      );
    }

    const fullName = `${repo.githubOrg}/${repo.repoName}`;
    const result = await seedOapBuildWorkflow(token, fullName);

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "project.build_workflow_retrofit",
      targetType: "project",
      targetId: req.projectId,
      metadata: { repo: fullName, action: result.action },
    });

    return { action: result.action, repo: fullName };
  }
);

// ---------------------------------------------------------------------------
// Project Repos
// ---------------------------------------------------------------------------

export const listProjectRepos = api(
  { expose: true, auth: true, method: "GET", path: "/api/projects/:projectId/repos" },
  async (req: { projectId: string }): Promise<{ repos: RepoRow[] }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    const rows = await db
      .select()
      .from(projectRepos)
      .where(eq(projectRepos.projectId, req.projectId))
      .orderBy(desc(projectRepos.createdAt));
    return { repos: rows };
  }
);

type AddRepoRequest = {
  projectId: string;
  githubOrg: string;
  repoName: string;
  defaultBranch?: string;
  isPrimary?: boolean;
};

export const addProjectRepo = api(
  { expose: true, auth: true, method: "POST", path: "/api/projects/:projectId/repos" },
  async (req: AddRepoRequest): Promise<{ repo: RepoRow }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    if (!req.githubOrg || !req.repoName) {
      throw APIError.invalidArgument("githubOrg and repoName are required");
    }

    // When promoting a new repo to primary, demote any existing primary
    // in the same transaction so the per-project "exactly one primary"
    // invariant the dashboard relies on for `canClone` (spec 113 §FR-007)
    // holds across the insert.
    const repo = await db.transaction(async (tx) => {
      if (req.isPrimary) {
        await tx
          .update(projectRepos)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(projectRepos.projectId, req.projectId),
              eq(projectRepos.isPrimary, true)
            )
          );
      }

      const [inserted] = await tx
        .insert(projectRepos)
        .values({
          projectId: req.projectId,
          githubOrg: req.githubOrg,
          repoName: req.repoName,
          defaultBranch: req.defaultBranch ?? "main",
          isPrimary: req.isPrimary ?? false,
        })
        .returning();

      await tx.insert(auditLog).values({
        actorUserId: auth.userID,
        action: "project_repo.add",
        targetType: "project_repo",
        targetId: inserted.id,
        metadata: {
          projectId: req.projectId,
          githubOrg: req.githubOrg,
          repoName: req.repoName,
          isPrimary: req.isPrimary ?? false,
        },
      });

      return inserted;
    });

    return { repo };
  }
);

// Spec 113 follow-up — explicit primary swap for the multi-repo workflow
// (dev / prod / experimental). Demotes the current primary and promotes
// the requested row in one transaction so the dashboard's `canClone`
// flag never observes a "no primary" or "two primaries" intermediate.
export const setPrimaryProjectRepo = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/repos/:id/primary",
  },
  async (req: { projectId: string; id: string }): Promise<{ repo: RepoRow }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    const [target] = await db
      .select()
      .from(projectRepos)
      .where(
        and(
          eq(projectRepos.id, req.id),
          eq(projectRepos.projectId, req.projectId)
        )
      )
      .limit(1);

    if (!target) {
      throw APIError.notFound("repo not found");
    }
    if (target.isPrimary) {
      return { repo: target };
    }

    const promoted = await db.transaction(async (tx) => {
      await tx
        .update(projectRepos)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(projectRepos.projectId, req.projectId),
            eq(projectRepos.isPrimary, true)
          )
        );

      const [row] = await tx
        .update(projectRepos)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(eq(projectRepos.id, req.id))
        .returning();

      await tx.insert(auditLog).values({
        actorUserId: auth.userID,
        action: "project_repo.set_primary",
        targetType: "project_repo",
        targetId: req.id,
        metadata: {
          projectId: req.projectId,
          githubOrg: row.githubOrg,
          repoName: row.repoName,
        },
      });

      return row;
    });

    return { repo: promoted };
  }
);

export const removeProjectRepo = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/projects/:projectId/repos/:id",
  },
  async (req: {
    projectId: string;
    id: string;
  }): Promise<{ ok: true }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    const existing = await db
      .select()
      .from(projectRepos)
      .where(
        and(
          eq(projectRepos.id, req.id),
          eq(projectRepos.projectId, req.projectId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      throw APIError.notFound("repo not found");
    }

    await db.delete(projectRepos).where(eq(projectRepos.id, req.id));

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "project_repo.remove",
      targetType: "project_repo",
      targetId: req.id,
      metadata: {
        projectId: req.projectId,
        githubOrg: existing[0].githubOrg,
        repoName: existing[0].repoName,
      },
    });

    return { ok: true };
  }
);

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

export const listEnvironments = api(
  { expose: true, auth: true, method: "GET", path: "/api/projects/:projectId/envs" },
  async (req: {
    projectId: string;
  }): Promise<{ environments: EnvironmentRow[] }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    const rows = await db
      .select()
      .from(environments)
      .where(eq(environments.projectId, req.projectId))
      .orderBy(environments.createdAt);
    return { environments: rows };
  }
);

type CreateEnvironmentRequest = {
  projectId: string;
  name: string;
  kind?: "preview" | "development" | "staging" | "production";
  autoDeployBranch?: string;
  requiresApproval?: boolean;
};

export const createEnvironment = api(
  { expose: true, auth: true, method: "POST", path: "/api/projects/:projectId/envs" },
  async (
    req: CreateEnvironmentRequest
  ): Promise<{ environment: EnvironmentRow }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    if (!req.name) {
      throw APIError.invalidArgument("name is required");
    }

    // Auto-derive k8s namespace from project slug + env name
    const projectRows = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.id, req.projectId))
      .limit(1);

    if (projectRows.length === 0) {
      throw APIError.notFound("project not found");
    }

    const k8sNamespace = `proj--${projectRows[0].slug}--${req.name}`;

    const [env] = await db
      .insert(environments)
      .values({
        projectId: req.projectId,
        name: req.name,
        kind: req.kind ?? "development",
        k8sNamespace,
        autoDeployBranch: req.autoDeployBranch,
        requiresApproval: req.requiresApproval ?? false,
      })
      .returning();

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "environment.create",
      targetType: "environment",
      targetId: env.id,
      metadata: {
        projectId: req.projectId,
        name: req.name,
        kind: req.kind ?? "development",
      },
    });

    return { environment: env };
  }
);

export const deleteEnvironment = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/projects/:projectId/envs/:id",
  },
  async (req: {
    projectId: string;
    id: string;
  }): Promise<{ ok: true }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    const existing = await db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.id, req.id),
          eq(environments.projectId, req.projectId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      throw APIError.notFound("environment not found");
    }

    await db.delete(environments).where(eq(environments.id, req.id));

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "environment.delete",
      targetType: "environment",
      targetId: req.id,
      metadata: {
        projectId: req.projectId,
        name: existing[0].name,
      },
    });

    return { ok: true };
  }
);

// ---------------------------------------------------------------------------
// Project Members
// ---------------------------------------------------------------------------

export const listProjectMembers = api(
  { expose: true, auth: true, method: "GET", path: "/api/projects/:projectId/members" },
  async (req: { projectId: string }): Promise<{ members: MemberRow[] }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    const rows = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, req.projectId))
      .orderBy(projectMembers.createdAt);
    return { members: rows };
  }
);

type SetMemberRequest = {
  projectId: string;
  userId: string;
  role: "viewer" | "developer" | "deployer" | "admin";
};

export const setProjectMember = api(
  { expose: true, auth: true, method: "POST", path: "/api/projects/:projectId/members" },
  async (req: SetMemberRequest): Promise<{ member: MemberRow }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    if (!req.userId || !req.role) {
      throw APIError.invalidArgument("userId and role are required");
    }

    const now = new Date();
    const existing = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, req.projectId),
          eq(projectMembers.userId, req.userId)
        )
      )
      .limit(1);

    let member: MemberRow;

    if (existing.length > 0) {
      const [updated] = await db
        .update(projectMembers)
        .set({ role: req.role, updatedAt: now })
        .where(eq(projectMembers.id, existing[0].id))
        .returning();
      member = updated;
    } else {
      const [inserted] = await db
        .insert(projectMembers)
        .values({
          projectId: req.projectId,
          userId: req.userId,
          role: req.role,
        })
        .returning();
      member = inserted;
    }

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "project_member.set",
      targetType: "project_member",
      targetId: member.id,
      metadata: {
        projectId: req.projectId,
        userId: req.userId,
        role: req.role,
      },
    });

    return { member };
  }
);

export const removeProjectMember = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/projects/:projectId/members/:userId",
  },
  async (req: {
    projectId: string;
    userId: string;
  }): Promise<{ ok: true }> => {
    const auth = getAuthData()!;
    await verifyProjectOwnership(req.projectId, auth.orgId);

    const existing = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, req.projectId),
          eq(projectMembers.userId, req.userId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      throw APIError.notFound("member not found");
    }

    await db
      .delete(projectMembers)
      .where(eq(projectMembers.id, existing[0].id));

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "project_member.remove",
      targetType: "project_member",
      targetId: existing[0].id,
      metadata: {
        projectId: req.projectId,
        userId: req.userId,
      },
    });

    return { ok: true };
  }
);
